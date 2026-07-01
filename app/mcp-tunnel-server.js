/**
 * WebAI LocalBridge MCP Server v3.4.3
 * =================
 * Provides MCP tools over Streamable HTTP + SSE transport,
 * operating directly on the local filesystem via root-state.mjs.
 *
 * v3.4.0: Task Runner (task_start, task_status, task_logs, task_list, task_stop)
 * v3.4.3: command_run Windows .cmd/.bat fix, path escaping fix, crash protection, fixed public URLs
 *         for long-running install/build/deploy tasks. Disk-backed log files,
 *         ring buffer, timeout, cwd support, permission-center integration.
 * v3.1.0: Advanced permission support, normalizeDirPath fix
 * v3.1.0: Uses shared text-decoder.mjs + file-classifier.mjs modules
 * v2.3.0: Chinese encoding auto-detection (iconv-lite + jschardet) for file_read
 * v2.2.0: Direct filesystem backend, 8081/FileBrowser removed
 *
 * Architecture:
 *   AI Client → MCP Protocol (SSE/StreamableHTTP) → This Server → Local Filesystem
 *
 * Supports:
 *   - Streamable HTTP (protocol 2025-11-25) on /mcp
 *   - Legacy SSE (protocol 2024-11-05) on /sse + /messages
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getRootDir, resolveInsideRoot, getMcpAdvancedPermission, getRootBoundaryMode, getFileFastConfirm, getCommandExecution, getSkillFolderRuntimeConfig, scanSkills, readSkillByName } from './root-state.mjs';
import { isBinaryByExtension, isBinaryBuffer, decodeTextBuffer } from './text-decoder.mjs';
import { classifyFileExt, getAvailableActions, getRecommendedMcpTool, buildFileWarnings } from './file-classifier.mjs';
import { extractTextFromDocument } from './document-extractor.mjs';
import { previewTable } from './table-reader.mjs';
import { readArchive } from './archive-reader.mjs';
import { createLogFile, writeCommandLogs, appendProcessLog, readLogChunk } from './log-store.mjs';
import { clampInt, matchAnyPattern, normalizePatterns } from './path-utils.mjs';

// ─── Global crash protection ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (server continues):', err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection (server continues):', reason?.message || reason);
});

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  port: parseInt(process.env.MCP_TUNNEL_PORT || '33003', 10),
  maxFileSize: 10 * 1024 * 1024, // 10MB read limit
};
const SERVER_STARTED_AT = new Date();
const TOOL_SCHEMA_VERSION = '3.4.8-skill-folder-ui-2';
const CLOSED_SESSION_TTL_MS = 10 * 60 * 1000;
const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url));

function getSkillFolderContext() {
  const ctx = getSkillFolderRuntimeConfig();
  return {
    folder: ctx.folder,
    resolvedFolder: ctx.resolvedFolder,
    mode: ctx.mode,
    isDefault: ctx.isDefault,
  };
}

// ─── Direct Filesystem Backend ────────────────────────────────────────────────
// All file operations go directly to the local filesystem via root-state.mjs.
// The function is named fsRequest for historical reasons but does NOT contact
// port 8081 or filebrowser.exe — it reads/writes files directly.

async function fsRequest(method, resourcePath, body = null, pathResolver = null) {
  try {
    const resolve = pathResolver || resolveInsideRoot;
    // FIX: Do NOT use new URL() — it misinterprets Windows backslashes (\t → tab, etc.)
    // Instead, split pathname and query string manually
    const queryIdx = resourcePath.indexOf('?');
    const pathname = decodeURIComponent(queryIdx >= 0 ? resourcePath.slice(0, queryIdx) : resourcePath);
    const urlSearchParams = queryIdx >= 0 ? new URLSearchParams(resourcePath.slice(queryIdx + 1)) : null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    const text = (data, status = 200) => new Response(data ?? '', {
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
    const empty = (status = 204) => new Response(null, { status });

    function statToResource(fullPath, relPath) {
      const stat = fs.statSync(fullPath);
      const isDir = stat.isDirectory();
      const resource = {
        name: relPath ? path.basename(relPath) : '',
        path: '/' + relPath.replaceAll('\\', '/'),
        isDir,
        type: isDir ? 'directory' : 'file',
        size: isDir ? 0 : stat.size,
        modified: stat.mtime.toISOString(),
      };
      if (isDir) {
        resource.items = fs.readdirSync(fullPath, { withFileTypes: true }).map((entry) => {
          const childFull = path.join(fullPath, entry.name);
          const childRel = path.join(relPath, entry.name);
          const childStat = fs.statSync(childFull);
          return {
            name: entry.name,
            path: '/' + childRel.replaceAll('\\', '/'),
            isDir: entry.isDirectory(),
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isDirectory() ? 0 : childStat.size,
            modified: childStat.mtime.toISOString(),
          };
        });
      }
      return resource;
    }

    if (pathname.startsWith('/api/raw')) {
      const rel = pathname.slice('/api/raw'.length).replace(/^\/+/, '');
      const target = resolve(rel);
      if (method !== 'GET') return text('Method not allowed', 405);
      if (!fs.statSync(target.fullPath).isFile()) return text('Not a file', 400);

      // Read as buffer for encoding auto-detection (v2.3.0)
      const buf = fs.readFileSync(target.fullPath);
      const encodingParam = urlSearchParams?.get('encoding') || 'auto';

      // Binary detection
      if (isBinaryByExtension(target.fullPath)) {
        return text('[Binary file — use encoding=base64]', 415);
      }
      if (isBinaryBuffer(buf, target.fullPath)) {
        return text('[Binary file content detected — use encoding=base64]', 415);
      }

      const { text: decoded, encoding: detected } = decodeTextBuffer(buf, encodingParam);
      return new Response(decoded, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Detected-Encoding': detected,
        },
      });
    }

    if (pathname.startsWith('/api/resources')) {
      const rel = pathname.slice('/api/resources'.length).replace(/^\/+/, '');
      const target = resolve(rel);

      if (method === 'GET') {
        if (!fs.existsSync(target.fullPath)) return text('Not found', 404);
        return json(statToResource(target.fullPath, target.relative));
      }

      if (method === 'POST' || method === 'PUT') {
        if (rel.endsWith('/')) {
          fs.mkdirSync(target.fullPath, { recursive: true });
          return empty(201);
        }
        fs.mkdirSync(path.dirname(target.fullPath), { recursive: true });
        fs.writeFileSync(target.fullPath, body ?? '', 'utf8');
        return empty(method === 'POST' ? 201 : 200);
      }

      if (method === 'DELETE') {
        if (!fs.existsSync(target.fullPath)) return text('Not found', 404);
        fs.rmSync(target.fullPath, { recursive: true, force: true });
        return empty(204);
      }

      if (method === 'PATCH' && urlSearchParams?.get('action') === 'rename') {
        const destination = urlSearchParams?.get('destination') || '';
        const dst = resolve(destination.replace(/^\/+/, ''));
        fs.mkdirSync(path.dirname(dst.fullPath), { recursive: true });
        fs.renameSync(target.fullPath, dst.fullPath);
        return empty(204);
      }
    }

    return text('Not found', 404);
  } catch (e) {
    return new Response(e.message, { status: 400 });
  }
}

function normalizePath(p) {
  // Remove leading slash if present
  if (!p) return '/';
  return p.startsWith('/') ? p : '/' + p;
}

function validatePath(p) {
  let decoded = String(p || '/');
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const withoutLeadingSlash = decoded.replace(/^\/+/, '');
  if (path.isAbsolute(withoutLeadingSlash) || withoutLeadingSlash.includes(':')) {
    throw new Error(`Invalid path: absolute paths are not allowed: ${p}`);
  }
  const segments = decoded.replace(/\\/g, '/').split('/').filter(s => s.length > 0);
  if (segments.includes('..')) {
    throw new Error(`路径包含 ".." 不允许: ${p}`);
  }
  return normalizePath(segments.join('/'));
}

// FIX: Windows paths with \t, \n, \r etc. get mangled by JSON/JS string escaping.
// e.g. "D:\test folder" → "D:\test folder" (TAB) instead of "D:\test folder" (backslash-t)
// This function detects and repairs common Windows path escape sequences.
function fixWindowsPathEscaping(p) {
  if (!p || typeof p !== 'string') return p;
  // Only fix if it looks like a Windows drive path (e.g. X:\...) or UNC path
  // Check for drive letter pattern even with mangled escapes
  const hasDriveLetter = /^[A-Za-z]:/.test(p) || /^[A-Za-z]\x00/.test(p); // \0 from \0
  // Include ALL common escape chars: TAB(0x09), LF(0x0A), CR(0x0D), etc.
  const hasControlChars = /[\x00-\x1f]/.test(p);
  if (!hasDriveLetter && !hasControlChars) return p;
  // If path has no control chars, it's fine
  if (!hasControlChars) return p;
  // Map common escape sequences back to backslash + letter
  // \t(0x09) → \t, \n(0x0a) → \n, \r(0x0d) → \r, \0(0x00) → \0, \a(0x07) → \a, \b(0x08) → \b, \f(0x0c) → \f, \v(0x0b) → \v
  const escapeMap = { '\x00': '\\0', '\x07': '\\a', '\x08': '\\b', '\x09': '\\t', '\x0a': '\\n', '\x0b': '\\v', '\x0c': '\\f', '\x0d': '\\r' };
  let fixed = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    const code = ch.charCodeAt(0);
    if (escapeMap[ch]) {
      fixed += escapeMap[ch];
    } else {
      fixed += ch;
    }
  }
  if (fixed !== p) {
    console.log(`[path-fix] Repaired mangled path: ${JSON.stringify(p)} → ${JSON.stringify(fixed)}`);
  }
  return fixed;
}

// Resolve a path that may be absolute (cross-root mode) or virtual (root-only mode)
function resolvePathWithBoundary(p) {
  p = fixWindowsPathEscaping(p);
  const mode = getRootBoundaryMode();
  if (mode === 'cross-root') {
    // Allow absolute Windows paths
    let decoded = String(p || '');
    for (let i = 0; i < 3; i++) {
      try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
    }
    // Reject relative paths (ambiguous)
    if (!path.isAbsolute(decoded) && !decoded.includes(':') && !decoded.startsWith('\\\\')) {
      throw new Error('In cross-root mode, paths must be absolute (e.g. D:\\folder\\file.txt)');
    }
    // Reject traversal
    if (decoded.includes('..')) {
      throw new Error('Path traversal is not allowed');
    }
    const resolved = path.resolve(decoded);
    return { rootDir: path.parse(resolved).root, relative: resolved, fullPath: resolved };
  }
  // root-only: use existing strict resolver
  return resolveInsideRoot(p.replace(/^\/+/, ''));
}

// Check if a command/script contains obvious cross-root absolute paths
const CROSS_ROOT_PATH_RE = /(?:[A-Za-z]:\\|\\\\[a-zA-Z]|\/\.\.\/)/;
function checkCommandBoundary(command, args, script) {
  const mode = getRootBoundaryMode();
  if (mode === 'cross-root') return; // allowed

  // root-only: check for obvious cross-root paths
  const parts = [command || '', ...(args || [])];
  if (script) parts.push(script);
  for (const part of parts) {
    if (CROSS_ROOT_PATH_RE.test(part)) {
      throw new Error(`Root-only mode: command contains cross-root path "${part}". Switch to cross-root mode to access paths outside rootDir.`);
    }
  }
}

// v3.5.9: Simplified permission model helpers
const FILE_WRITE_DELETE_OFF_MSG = 'File Write/Delete is disabled. Current mode is read-only.';
const CMD_EXEC_DISABLED_MSG = 'Command Execution is off.';
const CMD_EXEC_REQUIRES_CROSS_ROOT_MSG = 'Command Execution requires Cross Root mode.';

function requireFileWriteDelete() {
  if (!getFileFastConfirm()) {
    return { ok: false, text: FILE_WRITE_DELETE_OFF_MSG };
  }
  return { ok: true };
}

function requireCommandExecutionAllowed() {
  if (!getCommandExecution()) {
    return { ok: false, text: CMD_EXEC_DISABLED_MSG };
  }
  if (getRootBoundaryMode() !== 'cross-root') {
    return {
      ok: false,
      text: CMD_EXEC_REQUIRES_CROSS_ROOT_MSG,
      requiresCrossRoot: true,
    };
  }
  return { ok: true };
}

function denyFileWriteDelete(check) {
  return { content: [{ type: 'text', text: `❌ ${check.text}` }] };
}

function denyCommandExecution(check) {
  return { content: [{ type: 'text', text: `❌ ${check.text}` }] };
}

// Cross-root path resolver for fsRequest
function crossRootResolve(rel) {
  let decoded = String(rel || '');
  for (let i = 0; i < 3; i++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  decoded = decoded.replace(/^\/+/, '');
  decoded = fixWindowsPathEscaping(decoded);
  if (decoded.includes('..')) throw new Error('Path traversal is not allowed');
  if (path.isAbsolute(decoded) || /^[A-Za-z]:/.test(decoded) || decoded.startsWith('\\\\')) {
    const fullPath = path.resolve(decoded);
    return { rootDir: path.parse(fullPath).root, relative: fullPath, fullPath };
  }
  // Fallback to root-only
  return resolveInsideRoot(decoded);
}

// Prepare file path for tool handlers (handles both root-only and cross-root)
function prepareFilePath(p) {
  p = fixWindowsPathEscaping(p);
  const mode = getRootBoundaryMode();
  if (mode === 'cross-root') {
    if (String(p || '').includes('..')) throw new Error('Path traversal is not allowed');
    return { np: p, resolver: crossRootResolve };
  }
  return { np: validatePath(p), resolver: null };
}

function jsonTool(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function resolveMcpPath(inputPath) {
  const { np, resolver } = prepareFilePath(inputPath);
  const target = resolver ? resolver(String(np).replace(/^\//, '')) : resolveInsideRoot(String(np).replace(/^\//, ''));
  return { requestedPath: inputPath, np, resolver, ...target };
}

function basicFileInfo(inputPath) {
  const warnings = [];
  let resolvedPath = null;
  try {
    const target = resolveMcpPath(inputPath);
    resolvedPath = target.fullPath;
    if (!fs.existsSync(resolvedPath)) {
      return {
        path: inputPath,
        resolvedPath,
        exists: false,
        type: 'missing',
        mime: null,
        size: null,
        extension: path.extname(resolvedPath).toLowerCase() || null,
        encoding: null,
        readableAsText: false,
        extractableText: false,
        tablePreviewable: false,
        archiveReadable: false,
        binary: false,
        recommendedTool: 'file_info',
        warnings: ['Path does not exist.'],
      };
    }
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      let itemCount = null;
      try { itemCount = fs.readdirSync(resolvedPath).length; } catch (e) { warnings.push(`Directory read warning: ${e.message}`); }
      return {
        path: inputPath,
        resolvedPath,
        exists: true,
        type: 'directory',
        mime: null,
        size: 0,
        extension: null,
        encoding: null,
        readableAsText: false,
        extractableText: false,
        tablePreviewable: false,
        archiveReadable: false,
        binary: false,
        recommendedTool: 'file_list',
        warnings,
        itemCount,
        modifiedTime: stat.mtime.toISOString(),
      };
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const classification = classifyFileExt(ext);
    let encoding = null;
    let confidence = null;
    let binary = classification.binary;
    try {
      const probeSize = Math.min(stat.size, 256 * 1024);
      const fd = fs.openSync(resolvedPath, 'r');
      const buf = Buffer.alloc(probeSize);
      const bytes = fs.readSync(fd, buf, 0, probeSize, 0);
      fs.closeSync(fd);
      const sample = buf.subarray(0, bytes);
      if (classification.readableAsText || (!isBinaryByExtension(resolvedPath) && !isBinaryBuffer(sample, resolvedPath))) {
        const decoded = decodeTextBuffer(sample, 'auto');
        encoding = decoded.encoding;
        confidence = decoded.confidence;
        binary = false;
      } else {
        binary = true;
      }
    } catch (e) {
      warnings.push(`Encoding probe failed: ${e.message}`);
    }
    warnings.push(...buildFileWarnings(classification, ext));
    return {
      path: inputPath,
      resolvedPath,
      exists: true,
      type: classification.type,
      mime: classification.mime,
      size: stat.size,
      extension: ext || null,
      encoding,
      encodingConfidence: confidence,
      readableAsText: classification.readableAsText && !binary,
      extractableText: classification.extractableText,
      tablePreviewable: classification.tablePreviewable,
      archiveReadable: classification.archiveReadable,
      binary,
      recommendedTool: getRecommendedMcpTool(classification, stat.size),
      warnings,
      modifiedTime: stat.mtime.toISOString(),
    };
  } catch (e) {
    return {
      path: inputPath,
      resolvedPath,
      exists: false,
      type: 'error',
      mime: null,
      size: null,
      extension: null,
      encoding: null,
      readableAsText: false,
      extractableText: false,
      tablePreviewable: false,
      archiveReadable: false,
      binary: false,
      recommendedTool: 'file_info',
      warnings: [e.message],
    };
  }
}

function readTextFileWindow(resolvedPath, options = {}) {
  const stat = fs.statSync(resolvedPath);
  const offset = clampInt(options.cursor, 0, 0, stat.size);
  const maxBytes = clampInt(options.maxBytes, CONFIG.maxFileSize, 1, CONFIG.maxFileSize);
  const bytesToRead = Math.min(maxBytes, stat.size - offset);
  const fd = fs.openSync(resolvedPath, 'r');
  try {
    const buf = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, offset);
    const decoded = decodeTextBuffer(buf.subarray(0, bytesRead), options.encoding || 'auto');
    const nextCursor = offset + bytesRead < stat.size ? String(offset + bytesRead) : null;
    return {
      text: decoded.text,
      encoding: decoded.encoding,
      encodingConfidence: decoded.confidence,
      truncated: nextCursor !== null,
      nextCursor,
      totalBytes: stat.size,
      cursor: offset,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function decodeOutputPreview(buffer, maxBytes) {
  let end = Math.min(Math.max(maxBytes, 0), buffer.length);
  let decoded = decodeTextBuffer(buffer.subarray(0, end), 'auto');
  while (end > 0 && decoded.text.includes('\uFFFD')) {
    end--;
    decoded = decodeTextBuffer(buffer.subarray(0, end), 'auto');
  }
  return {
    text: decoded.text,
    encoding: decoded.encoding,
    confidence: decoded.confidence,
    bytes: end,
    truncated: end < buffer.length,
  };
}

function readLinesPayload(inputPath, startLine, endLine, options = {}) {
  const target = resolveMcpPath(inputPath);
  const resolvedPath = target.fullPath;
  if (!fs.existsSync(resolvedPath)) throw new Error(`File does not exist: ${inputPath}`);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) throw new Error('Path is not a file.');
  const info = basicFileInfo(inputPath);
  if (!info.readableAsText) throw new Error(`Path is not readable as text; recommendedTool=${info.recommendedTool}`);
  const maxChars = clampInt(options.maxChars, 200000, 1000, 1000000);
  const buf = fs.readFileSync(resolvedPath);
  if (isBinaryBuffer(buf.subarray(0, Math.min(buf.length, 4096)), resolvedPath)) throw new Error('Binary content detected.');
  const decoded = decodeTextBuffer(buf, options.encoding || 'auto');
  const allLines = decoded.text.split(/\r?\n/);
  const totalLines = allLines.length;
  const safeStart = clampInt(startLine, 1, 1, Math.max(totalLines, 1));
  const requestedEnd = clampInt(endLine, safeStart, safeStart, Number.MAX_SAFE_INTEGER);
  let actualEnd = Math.min(requestedEnd, totalLines);
  const lines = [];
  let chars = 0;
  let truncated = false;
  for (let i = safeStart - 1; i < actualEnd; i++) {
    const text = allLines[i] ?? '';
    if (chars + text.length > maxChars) {
      truncated = true;
      actualEnd = i;
      break;
    }
    chars += text.length + 1;
    lines.push({ line: i + 1, text });
  }
  const hasMore = truncated || actualEnd < totalLines;
  return {
    ok: true,
    path: inputPath,
    resolvedPath,
    startLine: safeStart,
    endLine: actualEnd,
    requestedEndLine: endLine,
    totalLines,
    hasMore,
    nextStartLine: hasMore ? Math.max(actualEnd + 1, safeStart) : null,
    maxChars,
    encoding: decoded.encoding,
    truncated,
    lines,
  };
}

// ─── MCP Server Setup ────────────────────────────────────────────────────────

// ── Long-running process registry ──────────────────────────────────────
const managedProcesses = new Map(); // id -> { proc, name, command, args, cwd, status, startedAt, endedAt, exitCode, signal, stdoutBuf, stderrBuf }
const RING_BUFFER_MAX = 200 * 1024; // 200KB per stream

// ── Task Runner registry ────────────────────────────────────────────────
// Separate from managedProcesses so task_* and process_* are independent.
// task entry: { proc, name, command, args, cwd, env, status, startedAt, endedAt,
//               exitCode, signal, durationMs, stdoutBuf, stderrBuf, combinedBuf,
//               logFile, logStream, timeoutHandle }
const managedTasks = new Map();
const TASK_RING_MAX = 500 * 1024; // 500KB per stream for tasks

/**
 * Resolve command name to full path for common tools.
 * If command is already an absolute path, return as-is.
 * Otherwise, check well-known locations on Windows.
 */
const KNOWN_COMMANDS = {
  'node': ['node.exe'],
  'node.exe': ['node.exe'],
  'npm': ['npm.cmd', 'npm'],
  'npm.cmd': ['npm.cmd'],
  'pnpm': ['pnpm.cmd', 'pnpm'],
  'pnpm.cmd': ['pnpm.cmd'],
  'git': ['git.exe', 'git'],
  'git.exe': ['git.exe'],
  'vite': ['vite.cmd', 'vite'],
  'vite.cmd': ['vite.cmd'],
  'npx': ['npx.cmd', 'npx'],
  'npx.cmd': ['npx.cmd'],
};

function resolveCommand(command) {
  if (!command) return command;
  // Already an absolute path — return as-is
  if (path.isAbsolute(command) || /^[A-Za-z]:/.test(command)) return command;
  // UNC path
  if (command.startsWith('\\\\')) return command;

  const lower = command.toLowerCase();
  const candidates = KNOWN_COMMANDS[lower] || [command];

  // 1. Try system PATH via where.exe (Windows)
  for (const cmd of candidates) {
    try {
      const result = execSync(`where.exe "${cmd}" 2>nul`, {
        encoding: 'utf8', timeout: 5000, windowsHide: true,
      }).trim().split(/\r?\n/)[0];
      if (result && fs.existsSync(result)) return result;
    } catch {}
  }

  // 2. Try well-known Windows locations
  const home = os.homedir();
  const knownPaths = [
    // .workbuddy managed node
    path.join(home, '.workbuddy', 'binaries', 'node', 'versions'),
    // npm global
    path.join(home, 'AppData', 'Roaming', 'npm'),
    // Program Files
    'C:\\Program Files\\nodejs',
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files (x86)\\nodejs',
  ];

  for (const basePath of knownPaths) {
    for (const cmd of candidates) {
      // For .workbuddy, check subdirectories (version folders)
      if (basePath.includes('.workbuddy')) {
        try {
          const versions = fs.readdirSync(basePath);
          for (const ver of versions) {
            const full = path.join(basePath, ver, cmd);
            if (fs.existsSync(full)) return full;
          }
        } catch {}
      } else {
        const full = path.join(basePath, cmd);
        if (fs.existsSync(full)) return full;
      }
    }
  }

  // 3. Return original — let spawn handle the error
  return command;
}

/**
 * Resolve cwd for task_start: supports absolute paths (cross-root) and
 * virtual root-relative paths (root-only).
 */
function resolveTaskCwd(cwd) {
  cwd = fixWindowsPathEscaping(cwd);
  if (!cwd) return getRootDir();
  // Absolute Windows path
  if (path.isAbsolute(cwd) || /^[A-Za-z]:/.test(cwd)) {
    const mode = getRootBoundaryMode();
    if (mode !== 'cross-root') {
      throw new Error(`Root-only mode: absolute cwd "${cwd}" is not allowed. Switch to cross-root mode.`);
    }
    if (cwd.includes('..')) throw new Error('Path traversal is not allowed in cwd');
    const resolved = path.resolve(cwd);
    if (!fs.existsSync(resolved)) {
      throw new Error(`cwd does not exist: ${resolved}`);
    }
    return resolved;
  }
  // Virtual root-relative path
  const rel = cwd.replace(/^\/+/, '');
  const target = resolveInsideRoot(rel);
  return target.fullPath;
}

/**
 * Get or create the .mcp-tasks log directory next to cwd.
 */
function getTaskLogDir(cwd) {
  const dir = path.join(cwd, '.mcp-tasks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format a date as YYYYMMDD-HHmmss for filenames.
 */
function formatDateForFilename(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function appendRingBuffer(buf, data) {
  const combined = Buffer.concat([buf, data]);
  if (combined.length > RING_BUFFER_MAX) {
    return combined.subarray(combined.length - RING_BUFFER_MAX);
  }
  return combined;
}

function cleanupAllProcesses() {
  for (const [id, entry] of managedProcesses) {
    if (entry.proc && !entry.proc.killed) {
      try { entry.proc.kill('SIGTERM'); } catch {}
    }
  }
  // Also cleanup task runner processes
  for (const [id, entry] of managedTasks) {
    if (entry.status === 'running' && entry.proc && !entry.proc.killed) {
      try { entry.proc.kill('SIGTERM'); } catch {}
      try { entry.logStream.end('\n=== SERVER SHUTDOWN ===\n'); } catch {}
    }
  }
}

function createServer() {
  const server = new McpServer({
    name: 'mcp-tunnel',
    version: '3.4.8',
  }, { capabilities: { logging: {} } });

  // ── file_read ──────────────────────────────────────────────────────────
  server.registerTool('file_read', {
    description: `Read file content. Text files are read directly. PDF/DOCX files use text extraction. XLSX, ZIP, EXE, media, and binary files return a recommended tool and notice. Supports auto, utf8, gbk, gb18030, and base64 encodings. Large files may return truncated, nextCursor, and totalBytes.`,
    inputSchema: {
      path: z.string().describe('File path to read'),
      encoding: z.enum(['auto', 'utf8', 'base64', 'gbk', 'gb18030']).optional().default('auto').describe('Encoding: auto, utf8, gbk, gb18030, or base64'),
      cursor: z.string().optional().describe('Continuation cursor for large files (byte offset)'),
      maxBytes: z.number().optional().default(CONFIG.maxFileSize).describe('Maximum bytes to read'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path, encoding, cursor, maxBytes }) => {
    try {
      const info = basicFileInfo(path);
      if (!info.exists) return jsonTool({ ok: false, ...info });
      if (info.type === 'directory') return jsonTool({ ok: false, ...info, warning: 'Path is a directory; use file_list or file_tree.' });
      const resolvedPath = info.resolvedPath;

      // Base64: read file directly as binary (bypass /api/raw encoding detection)
      if (encoding === 'base64') {
        const buf = fs.readFileSync(resolvedPath);
        // Truncate large binary files
        if (buf.length > CONFIG.maxFileSize) {
          const truncated = buf.subarray(0, CONFIG.maxFileSize);
          return jsonTool({ ok: true, path, resolvedPath, encoding: 'base64', text: truncated.toString('base64'), truncated: true, nextCursor: String(CONFIG.maxFileSize), totalBytes: buf.length });
        }
        return jsonTool({ ok: true, path, resolvedPath, encoding: 'base64', text: buf.toString('base64'), truncated: false, nextCursor: null, totalBytes: buf.length });
      }

      if (info.recommendedTool === 'file_extract_text' && ['.pdf', '.docx'].includes(info.extension)) {
        const extracted = await extractTextFromDocument(resolvedPath, { path, maxChars: maxBytes || CONFIG.maxFileSize });
        return jsonTool({ ok: true, delegatedTo: 'file_extract_text', ...extracted });
      }

      if (!info.readableAsText) {
        return jsonTool({
          ok: false,
          ...info,
          warnings: [...(info.warnings || []), `This file is not read as raw text. Use ${info.recommendedTool}.`],
        });
      }

      const result = readTextFileWindow(resolvedPath, { encoding, cursor, maxBytes });
      return jsonTool({
        ok: true,
        path,
        resolvedPath,
        ...result,
      });
    } catch (err) {
      return jsonTool({ ok: false, error: `file_read error: ${err.message}` });
    }
  });

  // ── file_extract_text ─────────────────────────────────────────────────
  server.registerTool('file_extract_text', {
    description: `Extract text from PDF, DOCX, PPTX, RTF, and HTML files. Scanned PDFs without a text layer return a corresponding notice.`,
    inputSchema: {
      path: z.string().describe('File path'),
      startPage: z.number().optional().describe('PDF/PPTX start page or slide, 1-based'),
      endPage: z.number().optional().describe('PDF/PPTX end page or slide, 1-based'),
      startParagraph: z.number().optional().describe('DOCX/HTML start paragraph, 1-based'),
      endParagraph: z.number().optional().describe('DOCX/HTML end paragraph, 1-based'),
      maxChars: z.number().optional().default(50000).describe('Maximum characters to return'),
      cursor: z.string().optional().describe('Continuation cursor'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path, startPage, endPage, startParagraph, endParagraph, maxChars, cursor }) => {
    try {
      const info = basicFileInfo(path);
      if (!info.exists) return jsonTool({ ok: false, ...info });
      if (!info.extractableText) return jsonTool({ ok: false, ...info, warnings: [...(info.warnings || []), 'File is not extractable as text.'] });
      const result = await extractTextFromDocument(info.resolvedPath, { path, startPage, endPage, startParagraph, endParagraph, maxChars, cursor });
      return jsonTool({ ok: true, ...result });
    } catch (err) {
      return jsonTool({ ok: false, path, warnings: [`file_extract_text error: ${err.message}`] });
    }
  });

  // ── table_preview ─────────────────────────────────────────────────────
  server.registerTool('table_preview', {
    description: `Preview XLSX, CSV, or TSV table content. XLSX supports sheet selection. CSV/TSV auto-detect encoding and delimiter. Returns preview data only.`,
    inputSchema: {
      path: z.string().describe('Table file path'),
      sheet: z.string().optional().describe('XLSX sheet name'),
      range: z.string().optional().describe('Cell range, for example A1:D20'),
      maxRows: z.number().optional().default(50).describe('Maximum data rows to return'),
      maxCols: z.number().optional().default(30).describe('Maximum columns to return'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path, sheet, range, maxRows, maxCols }) => {
    try {
      const info = basicFileInfo(path);
      if (!info.exists) return jsonTool({ ok: false, ...info });
      if (!info.tablePreviewable) return jsonTool({ ok: false, ...info, warnings: [...(info.warnings || []), 'File is not previewable as a table.'] });
      const result = await previewTable(info.resolvedPath, { path, sheet, range, maxRows, maxCols });
      return jsonTool({ ok: true, ...result });
    } catch (err) {
      return jsonTool({ ok: false, path, warnings: [`table_preview error: ${err.message}`] });
    }
  });

  // ── archive_read ──────────────────────────────────────────────────────
  server.registerTool('archive_read', {
    description: `Read archive content. Without innerPath, list archive entries. With innerPath, read a text entry inside a ZIP archive. 7Z/RAR currently return a format notice.`,
    inputSchema: {
      path: z.string().describe('Archive file path'),
      innerPath: z.string().optional().describe('Inner archive path. Omit to list entries'),
      maxEntries: z.number().optional().default(200).describe('Maximum entries to list'),
      maxChars: z.number().optional().default(50000).describe('Maximum characters to read from inner text'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path, innerPath, maxEntries, maxChars }) => {
    try {
      const info = basicFileInfo(path);
      if (!info.exists) return jsonTool({ ok: false, ...info });
      if (!info.archiveReadable && info.type !== 'archive') return jsonTool({ ok: false, ...info, warnings: [...(info.warnings || []), 'File is not an archive.'] });
      const result = await readArchive(info.resolvedPath, { path, innerPath, maxEntries, maxChars });
      return jsonTool({ ok: true, ...result });
    } catch (err) {
      return jsonTool({ ok: false, path, warnings: [`archive_read error: ${err.message}`] });
    }
  });

  // ── read_log_chunk ────────────────────────────────────────────────────
  server.registerTool('read_log_chunk', {
    description: `Read a long log file by offset from command_run, powershell_run, task_logs, or process_logs. Supports stdout, stderr, and combined streams.`,
    inputSchema: {
      logFile: z.string().describe('Log file path'),
      stream: z.enum(['stdout', 'stderr', 'combined']).optional().default('combined').describe('Stream to read: stdout, stderr, or combined'),
      offset: z.number().optional().default(0).describe('Byte offset starting at 0'),
      length: z.number().optional().default(65536).describe('Number of bytes to read (max 512KB)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ logFile, stream, offset, length }) => {
    try {
      return jsonTool({ ok: true, ...readLogChunk(logFile, { stream, offset, length }) });
    } catch (err) {
      return jsonTool({ ok: false, logFile, stream, warnings: [`read_log_chunk error: ${err.message}`] });
    }
  });

  // ── file_read_lines ─────────────────────────────────────────────────────
  server.registerTool('file_read_lines', {
    description: `Read a text file by line range. Returns the requested lines with line and text fields. Useful for reading a selected portion of a large file. Prefer Windows absolute paths.`,
    inputSchema: {
      path: z.string().describe('File path. Prefer Windows absolute paths such as C:\\Users\\name\\project\\file.js'),
      startLine: z.number().describe('Start line number, 1-based, must be >= 1'),
      endLine: z.number().describe('End line number, 1-based, must be >= startLine'),
      encoding: z.enum(['auto', 'utf8', 'gbk', 'gb18030']).optional().default('auto').describe('Encoding: auto, utf8, gbk, or gb18030'),
      maxChars: z.number().optional().default(200000).describe('Maximum characters to return'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path: filePath, startLine, endLine, encoding, maxChars }) => {
    try {
      if (!filePath) return jsonTool({ ok: false, error: 'path is required' });
      if (!Number.isInteger(startLine) || startLine < 1) return jsonTool({ ok: false, error: 'startLine must be >= 1' });
      if (!Number.isInteger(endLine) || endLine < startLine) return jsonTool({ ok: false, error: `endLine (${endLine}) must be >= startLine (${startLine})` });
      return jsonTool(readLinesPayload(filePath, startLine, endLine, { encoding, maxChars }));
    } catch (err) {
      return jsonTool({ ok: false, error: `file_read_lines error: ${err.message}` });
    }
  });

  // ── file_write ─────────────────────────────────────────────────────────
  server.registerTool('file_write', {
    description: `Create or update file content. If the target does not exist, create it. If the target exists, overwrite:true is required. If overwrite is omitted or false, the existing file remains unchanged and a message is returned.`,
    inputSchema: {
      path: z.string().describe('Target file path'),
      content: z.string().describe('File content to write'),
      overwrite: z.boolean().optional().default(false).describe('Whether to update an existing file. If omitted or false, the existing file remains unchanged and a message is returned.'),
    },
  }, async ({ path, content, overwrite }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np, resolver } = prepareFilePath(path);
      // Check if file exists
      let exists = false;
      try {
        const check = await fsRequest('GET', `/api/resources${np}`, null, resolver);
        exists = check.ok;
      } catch { /* ignore */ }

      if (exists && !overwrite) {
        return { content: [{ type: 'text', text: `文件 "${path}" 已存在，且 overwrite=false。未执行写入。` }] };
      }

      const method = exists ? 'PUT' : 'POST';
      const res = await fsRequest(method, `/api/resources${np}`, content, resolver);
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: 'text', text: `❌ 写入失败: HTTP ${res.status} - ${errText}` }] };
      }
      return { content: [{ type: 'text', text: `✅ 文件已${exists ? '更新' : '创建'}: ${path}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 写入错误: ${err.message}` }] };
    }
  });

  // ── file_edit ──────────────────────────────────────────────────────────
  server.registerTool('file_edit', {
    description: `Replace matching text in an existing file. If no match is found, the file remains unchanged. backup:true creates a .bak copy first.`,
    inputSchema: {
      path: z.string().describe('File path to edit'),
      oldText: z.string().describe('Original text to find'),
      newText: z.string().describe('Replacement text'),
      backup: z.boolean().optional().default(false).describe('Whether to create a .bak copy first. If omitted or false, no copy is created.'),
    },
  }, async ({ path, oldText, newText, backup }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np, resolver } = prepareFilePath(path);
      const readRes = await fsRequest('GET', `/api/raw${np}`, null, resolver);
      if (!readRes.ok) {
        return { content: [{ type: 'text', text: `❌ 读取文件失败: HTTP ${readRes.status}` }] };
      }
      let text = await readRes.text();

      if (backup) {
        const bakPath = np + '.bak';
        try { await fsRequest('POST', `/api/resources${bakPath}`, text, resolver); } catch (e) { /* ignore */ }
      }

      const newTextContent = text.replaceAll(oldText, newText);
      if (newTextContent === text) {
        return { content: [{ type: 'text', text: `未找到匹配 "${oldText}" 的文本，文件未修改。` }] };
      }

      const writeRes = await fsRequest('PUT', `/api/resources${np}`, newTextContent, resolver);
      if (!writeRes.ok) {
        const errText = await writeRes.text();
        return { content: [{ type: 'text', text: `❌ 写入文件失败: HTTP ${writeRes.status} - ${errText}` }] };
      }

      const replacedCount = text.split(oldText).length - 1;
      return { content: [{ type: 'text', text: `✅ 文件已更新: ${path} (替换了 ${replacedCount} 处)` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 编辑错误: ${err.message}` }] };
    }
  });

  // ── file_delete ────────────────────────────────────────────────────────
  server.registerTool('file_delete', {
    description: `Remove a specified file. Use dir_remove for directory paths.`,
    inputSchema: {
      path: z.string().describe('Target file path. Use dir_remove for directory paths.'),
    },
  }, async ({ path }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np, resolver } = prepareFilePath(path);

      // Check if target is a directory
      try {
        const checkRes = await fsRequest('GET', `/api/resources${np}`, null, resolver);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.isDir) {
            return { content: [{ type: 'text', text: `❌ "${path}" 是目录。删除目录请使用 dir_remove 工具（非空目录需 recursive:true）。` }] };
          }
        }
      } catch { /* target may not exist yet */ }

      const res = await fsRequest('DELETE', `/api/resources${np}`, null, resolver);
      if (res.status === 204 || res.ok) {
        return { content: [{ type: 'text', text: `✅ 已删除: ${path}` }] };
      }
      const errText = await res.text();
      return { content: [{ type: 'text', text: `❌ 删除失败: HTTP ${res.status} - ${errText}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 删除错误: ${err.message}` }] };
    }
  });

  // ── file_list ──────────────────────────────────────────────────────────
  server.registerTool('file_list', {
    description: `List files and subdirectories in a directory. If path is omitted, the current shared root is used.`,
    inputSchema: {
      path: z.string().optional().default('/').describe('Directory path to list. Defaults to the shared root'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path }) => {
    try {
      const { np, resolver } = prepareFilePath(path);
      const res = await fsRequest('GET', `/api/resources${np}`, null, resolver);
      if (!res.ok) {
        return { content: [{ type: 'text', text: `❌ 列出目录失败: HTTP ${res.status}` }] };
      }
      const data = await res.json();
      if (!data.items) {
        return { content: [{ type: 'text', text: `路径 "${path}" 的内容:\n${JSON.stringify(data, null, 2)}` }] };
      }

      // Build readable listing
      const lines = [`📁 目录: ${path} (共 ${data.items.length} 项)`, ''];
      // Sort: directories first, then files
      const sorted = [...data.items].sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      
      for (const item of sorted) {
        const icon = item.isDir ? '📁' : '📄';
        const size = item.isDir ? '-' : formatSize(item.size);
        const date = item.modified ? new Date(item.modified).toLocaleString('zh-CN') : '?';
        lines.push(`${icon} ${item.name.padEnd(40)} ${size.padStart(10)}  ${date}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 列表错误: ${err.message}` }] };
    }
  });

  // ── file_move ──────────────────────────────────────────────────────────
  // ── file_move ──────────────────────────────────────────────────
  server.registerTool('file_move', {
    description: `Move or rename a file or directory. If the destination does not exist, move directly. If the destination exists, overwrite:true is required. If overwrite is omitted or false, the destination remains unchanged and a message is returned.`,
    inputSchema: {
      source: z.string().describe('Source file or directory path'),
      destination: z.string().describe('Destination file or directory path'),
      overwrite: z.boolean().optional().default(false).describe('Whether to update the destination when it already exists. If omitted or false, the destination remains unchanged and a message is returned.'),
    },
  }, async ({ source, destination, overwrite }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np: src, resolver } = prepareFilePath(source);
      const { np: dst } = getRootBoundaryMode() === 'cross-root'
        ? prepareFilePath(destination)
        : { np: validatePath(destination), resolver: null };

      // Check if destination exists
      let dstExists = false;
      try {
        const dstCheck = await fsRequest('GET', `/api/resources${dst}`, null, resolver);
        dstExists = dstCheck.ok;
      } catch { /* dst does not exist */ }

      // Reject if destination exists and overwrite is not true
      if (dstExists && !overwrite) {
        return { content: [{ type: 'text', text: `❌ 目标已存在: ${destination}。传 overwrite:true 以覆盖。` }] };
      }

      // If overwrite:true and destination exists, delete destination first
      if (dstExists && overwrite) {
        const delRes = await fsRequest('DELETE', `/api/resources${dst}`, null, resolver);
        if (delRes.status !== 204 && !delRes.ok) {
          const delErr = await delRes.text();
          return { content: [{ type: 'text', text: `❌ 删除已存在目标失败: HTTP ${delRes.status} - ${delErr}` }] };
        }
      }

      const url = `/api/resources${src}?action=rename&destination=${encodeURIComponent(dst)}`;
      const res = await fsRequest('PATCH', url, null, resolver);
      if (res.status === 204 || res.ok) {
        return { content: [{ type: 'text', text: `✅ 已移动: ${source} → ${destination}${overwrite ? ' (已覆盖)' : ''}` }] };
      }
      const errText = await res.text();
      return { content: [{ type: 'text', text: `❌ 移动失败: HTTP ${res.status} - ${errText}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 移动错误: ${err.message}` }] };
    }
  });

  server.registerTool('file_info', {
    description: `Return path capability information, including resolvedPath, exists, type, mime, size, extension, encoding, readableAsText, extractableText, tablePreviewable, archiveReadable, binary, recommendedTool, and warnings.`,
    inputSchema: {
      path: z.string().describe('File or directory path'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path }) => {
    try {
      return jsonTool({ ok: true, ...basicFileInfo(path) });
    } catch (err) {
      return jsonTool({ ok: false, path, warnings: [`file_info error: ${err.message}`] });
    }
  });

  // ── dir_create ─────────────────────────────────────────────────────────
  server.registerTool('dir_create', {
    description: `Create a directory.`,
    inputSchema: {
      path: z.string().describe('Directory path to create'),
    },
  }, async ({ path }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np, resolver } = prepareFilePath(path);
      let p = np;
      if (!p.endsWith('/')) p += '/';
      const res = await fsRequest('POST', `/api/resources${p}`, null, resolver);
      if (res.ok || res.status === 201) {
        return { content: [{ type: 'text', text: `✅ 目录已创建: ${path}` }] };
      }
      const errText = await res.text();
      return { content: [{ type: 'text', text: `❌ 创建失败: HTTP ${res.status} - ${errText}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 创建错误: ${err.message}` }] };
    }
  });

  // ── dir_remove ────────────────────────────────────────────────────────
  // ── dir_remove ──────────────────────────────────────────────────
  server.registerTool('dir_remove', {
    description: `Remove a directory. Empty directories can be removed directly. Non-empty directories require recursive:true. If recursive is omitted or false, non-empty directories remain unchanged and a message is returned.`,
    inputSchema: {
      path: z.string().describe('Directory path to remove'),
      recursive: z.boolean().optional().describe('Used for non-empty directories. true processes the directory tree. If omitted or false, non-empty directories remain unchanged and a message is returned.'),
    },
  }, async ({ path, recursive }) => {
    try {
      const writeCheck = requireFileWriteDelete();
      if (!writeCheck.ok) return denyFileWriteDelete(writeCheck);

      const { np, resolver } = prepareFilePath(path);
      // Verify it's a directory
      const infoRes = await fsRequest('GET', `/api/resources${np}`, null, resolver);
      if (!infoRes.ok) {
        return { content: [{ type: 'text', text: `❌ 路径不存在: ${path}` }] };
      }
      const info = await infoRes.json();
      if (!info.isDir) {
        return { content: [{ type: 'text', text: `❌ "${path}" 不是目录，请使用 file_delete 删除文件。` }] };
      }

      // Check if directory is empty
      const items = info.items || [];
      const isEmpty = items.length === 0;

      // Non-empty dir protection
      if (!isEmpty && !recursive) {
        return { content: [{ type: 'text', text: `❌ 目录非空: ${path}（含 ${items.length} 项）。删除非空目录需要 recursive:true。` }] };
      }

      // Proceed with deletion (empty dir, or non-empty with recursive:true)
      const res = await fsRequest('DELETE', `/api/resources${np}`, null, resolver);
      if (res.status === 204 || res.ok) {
        const msg = !isEmpty ? `✅ 目录已递归删除: ${path}` : `✅ 目录已删除: ${path}`;
        return { content: [{ type: 'text', text: msg }] };
      }
      const errText = await res.text();
      return { content: [{ type: 'text', text: `❌ 删除失败: HTTP ${res.status} - ${errText}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ 删除错误: ${err.message}` }] };
    }
  });

  server.registerTool('file_search', {
    description: `Search by file or directory name. If recursive is omitted or false, search the current directory. recursive:true includes subdirectories. Returns hasMore, nextCursor, and resolvedPath.`,
    inputSchema: {
      directory: z.string().optional().default('/').describe('Starting directory (virtual path or cross-root absolute path)'),
      query: z.string().describe('Search keyword matching file or directory names'),
      recursive: z.boolean().optional().describe('Optional. Omitted or false searches the current directory only; true includes subdirectories.'),
      maxResults: z.number().optional().default(100).describe('Maximum number of results'),
      cursor: z.string().optional().describe('Pagination cursor'),
      includePatterns: z.array(z.string()).optional().describe('Include patterns, for example ["*.js", "*.md"]'),
      excludePatterns: z.array(z.string()).optional().describe('Exclude patterns, for example ["node_modules", "*.png"]'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ directory, query, recursive, maxResults, cursor, includePatterns, excludePatterns }) => {
    try {
      const target = resolveMcpPath(directory || '/');
      const resolvedPath = target.fullPath;
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        return jsonTool({ ok: false, directory, resolvedPath, error: 'Directory does not exist or is not a directory.' });
      }
      const safeMax = clampInt(maxResults, 100, 1, 1000);
      const startIndex = clampInt(cursor, 0, 0, Number.MAX_SAFE_INTEGER);
      const include = normalizePatterns(includePatterns);
      const exclude = normalizePatterns(excludePatterns);
      const q = String(query || '').toLowerCase();
      const all = [];
      let visited = 0;
      const MAX_VISIT = 100000;

      function walk(dir) {
        if (visited >= MAX_VISIT) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (visited >= MAX_VISIT) return;
          visited++;
          const full = path.join(dir, entry.name);
          const rel = path.relative(resolvedPath, full).replace(/\\/g, '/');
          if (matchAnyPattern(rel, exclude)) continue;
          const isDir = entry.isDirectory();
          const ext = isDir ? null : path.extname(full).toLowerCase();
          const includeOk = include.length === 0 || matchAnyPattern(rel, include);
          if (entry.name.toLowerCase().includes(q) && includeOk) {
            const stat = fs.statSync(full);
            const classification = isDir ? { type: 'directory' } : classifyFileExt(ext);
            all.push({
              path: full,
              relativePath: rel,
              name: entry.name,
              isDirectory: isDir,
              type: classification.type,
              extension: ext,
              size: isDir ? 0 : stat.size,
              modifiedTime: stat.mtime.toISOString(),
            });
          }
          if (recursive && isDir) walk(full);
        }
      }
      walk(resolvedPath);
      const results = all.slice(startIndex, startIndex + safeMax);
      const hasMore = startIndex + results.length < all.length || visited >= MAX_VISIT;
      return jsonTool({
        ok: true,
        query,
        directory,
        resolvedPath,
        recursive,
        maxResults: safeMax,
        cursor: cursor || null,
        nextCursor: hasMore ? String(startIndex + results.length) : null,
        hasMore,
        includePatterns: include,
        excludePatterns: exclude,
        totalMatches: all.length,
        visited,
        results,
      });
    } catch (err) {
      return jsonTool({ ok: false, directory, query, error: `file_search error: ${err.message}` });
    }
  });

  // ── content_search ──────────────────────────────────────────────────────
  server.registerTool('content_search', {
    description: `Search file content. recursive defaults to true; recursive:false searches only the current directory. By default, searches text, code, and log files. includeExtractableDocuments:true also searches extracted text from PDF, DOCX, PPTX, HTML, and RTF files.`,
    inputSchema: {
      directory: z.string().describe('Starting directory. Prefer Windows absolute paths such as C:\\Users\\name\\project'),
      query: z.string().describe('Search keyword or regular expression when regex=true'),
      recursive: z.boolean().optional().describe('Optional. Omitted defaults to true; false searches only the current directory.'),
      maxResults: z.number().optional().default(50).describe('Maximum number of results'),
      cursor: z.string().optional().describe('Pagination cursor'),
      maxOutputBytes: z.number().optional().default(200000).describe('Maximum JSON output budget in bytes'),
      contextLines: z.number().optional().default(0).describe('Context lines before and after a match (0-10)'),
      caseSensitive: z.boolean().optional().default(false).describe('Whether matching is case sensitive'),
      regex: z.boolean().optional().default(false).describe('Whether query is treated as a regular expression'),
      includePattern: z.string().optional().describe('Single filename pattern, for example *.js'),
      includePatterns: z.array(z.string()).optional().describe('Filename patterns, for example ["*.js", "*.mjs"]'),
      excludePatterns: z.array(z.string()).optional().describe('Exclude patterns for files or directories'),
      includeExtractableDocuments: z.boolean().optional().default(false).describe('Whether to search extracted text from PDF, DOCX, PPTX, HTML, and RTF files'),
      maxFileSizeMB: z.number().optional().default(5).describe('Skip files larger than this size in MB'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ directory, query, recursive, maxResults, cursor, maxOutputBytes, contextLines, caseSensitive, regex: useRegex, includePattern, includePatterns, excludePatterns, includeExtractableDocuments, maxFileSizeMB }) => {
    const startTime = Date.now();
    try {
      const target = resolveMcpPath(directory);
      const resolvedDir = target.fullPath;
      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
        return jsonTool({ ok: false, directory, resolvedPath: resolvedDir, error: 'Directory does not exist or is not a directory.' });
      }
      const safeMax = clampInt(maxResults, 50, 1, 1000);
      const startIndex = clampInt(cursor, 0, 0, Number.MAX_SAFE_INTEGER);
      const outputLimit = clampInt(maxOutputBytes, 200000, 20000, 1000000);
      const ctxLines = clampInt(contextLines, 0, 0, 10);
      const include = normalizePatterns(includePatterns && includePatterns.length ? includePatterns : includePattern ? [includePattern] : []);
      const exclude = normalizePatterns(excludePatterns && excludePatterns.length ? excludePatterns : ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__']);
      const fileSizeLimit = (maxFileSizeMB || 5) * 1024 * 1024;
      let matcher;
      if (useRegex) {
        const re = new RegExp(query, caseSensitive ? '' : 'i');
        matcher = (text) => {
          const m = text.match(re);
          return m ? { match: m[0], index: m.index ?? 0 } : null;
        };
      } else {
        const needle = caseSensitive ? query : String(query).toLowerCase();
        matcher = (text) => {
          const hay = caseSensitive ? text : text.toLowerCase();
          const idx = hay.indexOf(needle);
          return idx >= 0 ? { match: text.slice(idx, idx + String(query).length), index: idx } : null;
        };
      }

      const allMatches = [];
      const errors = [];
      let searchedFiles = 0;
      let skippedFiles = 0;
      let outputBytes = 0;
      let totalMatches = 0;
      const MAX_VISIT = 100000;
      let visited = 0;

      function addResult(result) {
        totalMatches++;
        if (totalMatches <= startIndex) {
          return true;
        }
        if (allMatches.filter(Boolean).length >= safeMax) return false;
        const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
        if (outputBytes + bytes > outputLimit) return false;
        outputBytes += bytes;
        allMatches.push(result);
        return true;
      }

      async function searchFile(fullPath) {
        const rel = path.relative(resolvedDir, fullPath).replace(/\\/g, '/');
        if (matchAnyPattern(rel, exclude)) { skippedFiles++; return true; }
        if (include.length && !matchAnyPattern(rel, include)) { skippedFiles++; return true; }
        const stat = fs.statSync(fullPath);
        if (stat.size > fileSizeLimit) { skippedFiles++; return true; }
        const ext = path.extname(fullPath).toLowerCase();
        const classification = classifyFileExt(ext);
        searchedFiles++;
        try {
          if (classification.readableAsText) {
            const buffer = fs.readFileSync(fullPath);
            if (isBinaryBuffer(buffer.subarray(0, Math.min(buffer.length, 4096)), fullPath)) { skippedFiles++; return true; }
            const decoded = decodeTextBuffer(buffer, 'auto');
            const lines = decoded.text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const m = matcher(lines[i]);
              if (m) {
                const ok = addResult({
                  path: rel,
                  resolvedPath: fullPath,
                  sourceKind: 'text',
                  line: i + 1,
                  column: m.index + 1,
                  match: m.match,
                  text: lines[i],
                  contextBefore: ctxLines ? lines.slice(Math.max(0, i - ctxLines), i).map((text, idx) => ({ line: Math.max(0, i - ctxLines) + idx + 1, text })) : [],
                  contextAfter: ctxLines ? lines.slice(i + 1, i + 1 + ctxLines).map((text, idx) => ({ line: i + idx + 2, text })) : [],
                });
                if (!ok) return false;
              }
            }
          } else if (includeExtractableDocuments && classification.extractableText) {
            const extracted = await extractTextFromDocument(fullPath, { path: rel, maxChars: Math.min(fileSizeLimit, 500000) });
            const units = extracted.text.split(/\r?\n/);
            for (let i = 0; i < units.length; i++) {
              const m = matcher(units[i]);
              if (m) {
                const sourceKind = ext === '.pdf' ? 'pdf-page-or-text-block' : ext === '.pptx' ? 'pptx-slide' : ext === '.docx' ? 'docx-paragraph' : 'document-text';
                const ok = addResult({
                  path: rel,
                  resolvedPath: fullPath,
                  sourceKind,
                  paragraph: ext === '.docx' ? i + 1 : undefined,
                  page: ext === '.pdf' ? i + 1 : undefined,
                  slide: ext === '.pptx' ? i + 1 : undefined,
                  line: i + 1,
                  column: m.index + 1,
                  match: m.match,
                  text: units[i],
                  warnings: extracted.warnings,
                });
                if (!ok) return false;
              }
            }
          } else {
            skippedFiles++;
          }
        } catch (e) {
          errors.push(`Error reading file: ${fullPath} - ${e.message}`);
        }
        return true;
      }

      async function walk(dir) {
        if (visited >= MAX_VISIT) return false;
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries) {
          visited++;
          const full = path.join(dir, entry.name);
          const rel = path.relative(resolvedDir, full).replace(/\\/g, '/');
          if (matchAnyPattern(rel, exclude)) { skippedFiles++; continue; }
          if (entry.isDirectory()) {
            if (recursive !== false) {
              const ok = await walk(full);
              if (!ok) return false;
            }
          } else if (entry.isFile()) {
            const ok = await searchFile(full);
            if (!ok) return false;
          }
          if (allMatches.filter(Boolean).length >= safeMax || outputBytes >= outputLimit || visited >= MAX_VISIT) return false;
        }
        return true;
      }

      const completed = await walk(resolvedDir);
      const results = allMatches.filter(Boolean);
      return jsonTool({
        ok: true,
        query,
        directory,
        resolvedPath: resolvedDir,
        caseSensitive: !!caseSensitive,
        regex: !!useRegex,
        contextLines: ctxLines,
        includeExtractableDocuments: !!includeExtractableDocuments,
        cursor: cursor || null,
        nextCursor: completed ? null : String(startIndex + results.length),
        hasMore: !completed,
        totalMatches,
        maxOutputBytes: outputLimit,
        includePatterns: include,
        excludePatterns: exclude,
        totalFilesScanned: searchedFiles,
        skippedFiles,
        durationMs: Date.now() - startTime,
        results,
        errors,
      });
    } catch (err) {
      return jsonTool({ ok: false, error: `content_search error: ${err.message}` });
    }
  });

  // ── file_tree ──────────────────────────────────────────────────────────
  server.registerTool('file_tree', {
    description: `Return a structured directory tree. Depth is controlled by maxDepth or depth. Supports maxItems, includeFiles, showSize, showModifiedTime, and excludePatterns. Dot-prefixed directories are not skipped by default.`,
    inputSchema: {
      path: z.string().optional().default('/').describe('Directory path for the tree. Defaults to the shared root'),
      depth: z.number().optional().default(3).describe('Maximum recursion depth, default 3, max 5'),
      maxDepth: z.number().optional().describe('Maximum recursion depth. Takes priority over depth'),
      maxItems: z.number().optional().default(500).describe('Maximum number of nodes to return'),
      includeFiles: z.boolean().optional().default(true).describe('Whether to include files'),
      showSize: z.boolean().optional().default(false).describe('Whether to include file sizes'),
      showModifiedTime: z.boolean().optional().default(false).describe('Whether to include modified times'),
      excludePatterns: z.array(z.string()).optional().describe('Exclude patterns'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ path: inputPath, depth, maxDepth, maxItems, includeFiles, showSize, showModifiedTime, excludePatterns }) => {
    try {
      const target = resolveMcpPath(inputPath || '/');
      const resolvedPath = target.fullPath;
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        return jsonTool({ ok: false, path: inputPath, resolvedPath, error: 'Path is not a directory.' });
      }
      const safeDepth = clampInt(maxDepth ?? depth, 3, 0, 20);
      const safeItems = clampInt(maxItems, 500, 1, 10000);
      const exclude = normalizePatterns(excludePatterns);
      let count = 0;
      let hasMore = false;
      const errors = [];

      function nodeFor(full, rel, depthNow) {
        if (count >= safeItems) {
          hasMore = true;
          return null;
        }
        if (rel && matchAnyPattern(rel, exclude)) return null;
        let stat;
        try { stat = fs.statSync(full); } catch (e) { errors.push(`${full}: ${e.message}`); return null; }
        const isDir = stat.isDirectory();
        if (!isDir && includeFiles === false) return null;
        count++;
        const ext = isDir ? null : path.extname(full).toLowerCase();
        const classification = isDir ? { type: 'directory' } : classifyFileExt(ext);
        const node = {
          name: path.basename(full),
          path: full,
          relativePath: rel,
          type: classification.type,
          isDirectory: isDir,
          extension: ext,
        };
        if (showSize) node.size = isDir ? 0 : stat.size;
        if (showModifiedTime) node.modifiedTime = stat.mtime.toISOString();
        if (isDir && depthNow < safeDepth) {
          let entries = [];
          try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch (e) { errors.push(`${full}: ${e.message}`); }
          node.children = entries
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .map(entry => nodeFor(path.join(full, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depthNow + 1))
            .filter(Boolean);
        }
        return node;
      }

      const tree = nodeFor(resolvedPath, '', 0);
      return jsonTool({
        ok: true,
        path: inputPath,
        resolvedPath,
        maxDepth: safeDepth,
        maxItems: safeItems,
        includeFiles: includeFiles !== false,
        showSize: !!showSize,
        showModifiedTime: !!showModifiedTime,
        excludePatterns: exclude,
        hasMore,
        itemCount: count,
        tree,
        errors,
      });
    } catch (err) {
      return jsonTool({ ok: false, path: inputPath, error: `file_tree error: ${err.message}` });
    }
  });

  // ── skill ─────────────────────────────────────────────────────────────
  server.registerTool('skill', {
    description: `Read local AI skills from the configured Skill Folder. If action is omitted or list, list available skills. If action is read, read the specified SKILL.md by name.`,
    inputSchema: {
      action: z.enum(['list', 'read']).optional().default('list').describe('Action type. list shows available skills. read reads a specified skill. If omitted, list is used.'),
      name: z.string().optional().describe('Skill name. Used when action is read.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ action, name }) => {
    try {
      const { folder, resolvedFolder, mode } = getSkillFolderContext();
      const act = action || 'list';

      if (act === 'list') {
        const scan = scanSkills(resolvedFolder);
        return jsonTool({
          ok: true,
          action: 'list',
          folder,
          resolvedFolder,
          mode,
          exists: scan.exists,
          count: scan.count,
          skills: scan.skills,
          errors: scan.errors,
        });
      }

      if (act === 'read') {
        if (!name) {
          const scan = scanSkills(resolvedFolder);
          return jsonTool({
            ok: false,
            action: 'read',
            folder,
            resolvedFolder,
            mode,
            error: 'name is required when action is read',
            available: scan.skills.map((s) => s.name),
          });
        }
        const readResult = readSkillByName(resolvedFolder, name);
        if (!readResult.ok) {
          return jsonTool({
            ok: false,
            action: 'read',
            folder,
            resolvedFolder,
            mode,
            name,
            error: readResult.error,
            available: readResult.available || [],
          });
        }
        return jsonTool({
          ok: true,
          action: 'read',
          folder,
          resolvedFolder,
          mode,
          name: readResult.name,
          description: readResult.description,
          path: readResult.path,
          skillDir: readResult.skillDir,
          skillFile: readResult.skillFile,
          content: readResult.content,
        });
      }

      return jsonTool({ ok: false, error: `Unknown action: ${act}` });
    } catch (err) {
      return jsonTool({ ok: false, error: `skill error: ${err.message}` });
    }
  });

  // ── tunnel_status ──────────────────────────────────────────────────────
  server.registerTool('tunnel_status', {
    description: `Show the current WebAI LocalBridge status, including version, schema, process, sessions, shared directory, permission switches, tool list, skill folder, and task summary.`,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const rootHealthy = checkRootHealth();
      const rootDir = getRootDir();
      let skillFolderConfig = '-';
      let resolvedFolder = '-';
      let skillFolderMode = '-';
      let skillFolderError = '';
      let skillScan = { count: 0, exists: false, skills: [], errors: [] };
      try {
        const skillCtx = getSkillFolderContext();
        skillFolderConfig = skillCtx.folder;
        resolvedFolder = skillCtx.resolvedFolder;
        skillFolderMode = skillCtx.mode;
        skillScan = scanSkills(resolvedFolder);
      } catch (err) {
        skillFolderError = err?.message || String(err);
      }
      const status = {
        'WebAI LocalBridge 版本': '3.4.8',
        'Tool Schema Version': TOOL_SCHEMA_VERSION,
        'MCP PID': process.pid,
        'MCP 启动时间': SERVER_STARTED_AT.toISOString(),
        'MCP 运行时长': `${Math.round(process.uptime())}s`,
        'Node 路径': process.execPath,
        'CWD': process.cwd(),
        'Active MCP Sessions': Object.keys(transports).length,
        'Closed Session Tombstones': closedSessions.size,
        'Closed Session Tombstone TTL': `${Math.floor(CLOSED_SESSION_TTL_MS / 1000)}s`,
        'Last Session Initialized At': sessionDiagnostics.lastSessionInitializedAt || '-',
        'Last Session Closed At': sessionDiagnostics.lastSessionClosedAt || '-',
        'Last Unknown Session At': sessionDiagnostics.lastUnknownSessionAt || '-',
        'Last No Session Request At': sessionDiagnostics.lastNoSessionRequestAt || '-',
        'Last Closed Session Reused At': sessionDiagnostics.lastClosedSessionReusedAt || '-',
        'Last Stream Error At': sessionDiagnostics.lastStreamErrorAt || '-',
        'Last Stream Error': sessionDiagnostics.lastStreamError || '-',
        'Total Sessions Initialized': sessionDiagnostics.totalSessionsInitialized,
        'Total Sessions Closed': sessionDiagnostics.totalSessionsClosed,
        'Total Unknown Session Requests': sessionDiagnostics.totalUnknownSessionRequests,
        'Total No Session Requests': sessionDiagnostics.totalNoSessionRequests,
        'Total Closed Session Reuse Attempts': sessionDiagnostics.totalClosedSessionReuseAttempts,
        'Skill Tool': 'skill',
        'Skill Folder Config': skillFolderConfig,
        'Skill Folder': resolvedFolder,
        'Skill Folder Mode': skillFolderMode,
        'Skill Folder Error': skillFolderError || '-',
        'Skills': `${skillScan.count} available`,
        '传输协议': 'Streamable HTTP (2025-11-25) + SSE (2024-11-05)',
        '共享目录': rootDir,
        '目录状态': rootHealthy ? '✅ 正常' : '❌ 无法访问',
        'Root 边界': getRootBoundaryMode() === 'cross-root' ? '允许跨 root' : '仅 root 内',
        '文件写删权限': getFileFastConfirm() ? '开启' : '关闭',
        '命令执行': (getCommandExecution() && getRootBoundaryMode() === 'cross-root') ? '开启' : '关闭',
        '最大文件读取': formatSize(CONFIG.maxFileSize),
        '后端': '直接文件系统（不依赖 8081 File Browser）',
        '可用工具': 'file_read, file_extract_text, table_preview, archive_read, read_log_chunk, file_write, file_edit, file_delete, file_list, file_move, file_info, dir_create, dir_remove, file_search, file_tree, file_read_lines, content_search, command_run, powershell_run, process_start, process_list, process_logs, process_stop, task_start, task_status, task_logs, task_list, task_stop, task_summary, pnpm_approve_builds, skill',
        '活跃 Task': managedTasks.size + ' 个',
      };
      const lines = ['🔧 WebAI LocalBridge 状态:', ''];
      for (const [k, v] of Object.entries(status)) {
        lines.push(`  ${k}: ${v}`);
      }
      lines.push('');
      lines.push('💡 AI 使用提示:');
      lines.push('  - 使用 file_list 浏览目录结构，path 使用 Windows 绝对路径');
      lines.push('  - 使用 file_read 读取小文件或完整文件，path 使用 Windows 绝对路径');
      lines.push('  - 使用 file_read_lines 按行号读取大文件片段，path 使用 Windows 绝对路径');
      lines.push('  - 使用 file_search 搜索文件名，directory 使用 Windows 绝对路径');
      lines.push('  - 使用 content_search 搜索文件内容/代码内容，directory 使用 Windows 绝对路径');
      lines.push('  - 使用 command_run 执行短命令，cwd 必须使用 Windows 绝对路径');
      lines.push('  - 不要使用 cwd="/"');
      lines.push('  - root-only / cross-root 只控制是否允许跨 root，不改变路径格式');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `WebAI LocalBridge 状态获取错误: ${err.message}` }] };
    }
  });

  // ── command_run ─────────────────────────────────────────────────────────
  server.registerTool('command_run', {
    description: `Run a short command in a specified Windows working directory and return stdout, stderr, exitCode, signal, durationMs, and timedOut after the command exits. Pass command arguments through the args array. cwd must be a Windows absolute path. Virtual paths are not supported.`,
    inputSchema: {
      command: z.string().describe('Command or executable path'),
      args: z.array(z.string()).optional().default([]).describe('Command argument array. Put arguments in this array instead of concatenating them into the command string.'),
      cwd: z.string().describe('Windows absolute working directory.'),
      timeoutMs: z.number().optional().default(60000).describe('Timeout in milliseconds (max 300000)'),
      maxOutputBytes: z.number().optional().default(40000).describe('Max output bytes to return'),
    },
  }, async ({ command, args, cwd, timeoutMs, maxOutputBytes }) => {
    try {
      if (!command) return { content: [{ type: 'text', text: '❌ command is required' }] };
      const cmdCheck = requireCommandExecutionAllowed();
      if (!cmdCheck.ok) return denyCommandExecution(cmdCheck);
      checkCommandBoundary(command, args, null);
      const safeTimeout = Math.min(Math.max(timeoutMs || 60000, 1000), 300000);
      const safeMaxOutput = Math.min(Math.max(maxOutputBytes || 40000, 1), 200000);

      // P1: Use same resolveCommand logic as task_start
      const resolvedCommand = resolveCommand(command);

      // Validate cwd: must be Windows absolute path
      if (!cwd || !path.isAbsolute(cwd) || !/^[A-Za-z]:[\\\/]/.test(cwd)) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: 'cwd must be a Windows absolute path (e.g. C:\\\\Users\\\\name\\\\project). Virtual paths like "/" are not supported.',
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }

      // Resolve cwd
      let realCwd;
      try {
        realCwd = resolveTaskCwd(cwd);
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: `cwd error: ${e.message}`,
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }
      const logFile = createLogFile(realCwd, path.basename(command || 'command_run'));

      // Windows: .cmd/.bat files require shell:true (same logic as task_start)
      const isCmdBat = /\.(cmd|bat)$/i.test(resolvedCommand);
      const useSingleString = isCmdBat && process.platform === 'win32' && resolvedCommand.includes(' ');
      let spawnFile, spawnArgs;
      if (useSingleString) {
        const quotedCmd = `"${resolvedCommand}"`;
        const argsStr = (args || []).join(' ');
        spawnFile = `${quotedCmd} ${argsStr}`.trim();
        spawnArgs = [];
      } else {
        spawnFile = resolvedCommand;
        spawnArgs = args || [];
      }

      const startTime = Date.now();
      const result = await new Promise((resolve) => {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        const stdoutChunks = [];
        const stderrChunks = [];
        let timedOut = false;
        let proc;

        try {
          proc = spawn(spawnFile, spawnArgs, {
            cwd: realCwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isCmdBat,
            windowsHide: true,
          });
        } catch (err) {
          resolve({ ok: false, exitCode: -1, signal: null, error: err.message, timedOut: false });
          return;
        }

        proc.stdout.on('data', (d) => { stdoutChunks.push(d); stdout = appendRingBuffer(stdout, d); });
        proc.stderr.on('data', (d) => { stderrChunks.push(d); stderr = appendRingBuffer(stderr, d); });

        const timer = setTimeout(() => {
          timedOut = true;
          try { proc.kill('SIGTERM'); } catch {}
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
        }, safeTimeout);

        proc.on('close', (code, signal) => {
          clearTimeout(timer);
          const stdoutFull = Buffer.concat(stdoutChunks);
          const stderrFull = Buffer.concat(stderrChunks);
          writeCommandLogs(logFile, stdoutFull, stderrFull, {
            kind: 'command_run',
            command: `${resolvedCommand} ${(args || []).join(' ')}`.trim(),
            cwd: realCwd,
            startedAt: new Date(startTime).toISOString(),
            exitCode: code,
          });
          const stdoutDecoded = decodeOutputPreview(stdoutFull, safeMaxOutput);
          const stderrDecoded = decodeOutputPreview(stderrFull, safeMaxOutput);
          resolve({
            ok: code === 0 && !timedOut,
            exitCode: code,
            signal,
            command,
            resolvedCommand: resolvedCommand !== command ? resolvedCommand : undefined,
            args: args || [],
            cwd: realCwd,
            cwdPolicy: 'absolute-path-required',
            durationMs: Date.now() - startTime,
            timedOut,
            stdout: stdoutDecoded.text,
            stderr: stderrDecoded.text,
            stdoutEncoding: stdoutDecoded.encoding,
            stderrEncoding: stderrDecoded.encoding,
            stdoutTruncated: stdoutDecoded.truncated,
            stderrTruncated: stderrDecoded.truncated,
            logFile,
            nextStdoutOffset: stdoutDecoded.truncated ? stdoutDecoded.bytes : null,
            nextStderrOffset: stderrDecoded.truncated ? stderrDecoded.bytes : null,
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          try { writeCommandLogs(logFile, Buffer.alloc(0), Buffer.from(err.message, 'utf8'), { kind: 'command_run', command: resolvedCommand, cwd: realCwd, startedAt: new Date(startTime).toISOString(), exitCode: -1 }); } catch {}
          resolve({ ok: false, exitCode: -1, signal: null, error: err.message, timedOut: false });
        });
      });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ command_run error: ${err.message}` }] };
    }
  });

  // ── process_start ───────────────────────────────────────────────────────
  server.registerTool('process_start', {
    description: `Start a managed long-running process, such as a dev server, watcher, or build process. Returns process id and pid immediately. Use process_list, process_logs, and process_stop for management.`,
    inputSchema: {
      command: z.string().describe('Command or executable path'),
      args: z.array(z.string()).optional().default([]).describe('Command arguments'),
      cwd: z.string().describe('Windows absolute working directory.'),
      name: z.string().optional().default('').describe('Friendly name for this process'),
      shell: z.boolean().optional().default(false).describe('Run in shell'),
    },
  }, async ({ command, args, cwd, name, shell }) => {
    try {
      if (!command) return { content: [{ type: 'text', text: '❌ command is required' }] };
      const cmdCheck = requireCommandExecutionAllowed();
      if (!cmdCheck.ok) return denyCommandExecution(cmdCheck);
      checkCommandBoundary(command, args, null);

      // Validate cwd: must be Windows absolute path
      if (!cwd || !/^[A-Za-z]:[\\\/]/.test(cwd)) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: 'cwd must be a Windows absolute path (e.g. C:\\Users\\name\\project). Virtual paths like "/" are not supported.',
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }

      // Resolve cwd
      let realCwd;
      try {
        realCwd = resolveTaskCwd(cwd);
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: `cwd error: ${e.message}`,
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }
      const id = randomUUID();
      const logFile = createLogFile(realCwd, name || command || 'process');
      try { fs.writeFileSync(logFile, `=== process_start: ${command} ${(args || []).join(' ')} ===\n=== cwd: ${realCwd} ===\n`, 'utf8'); } catch {}
      try { fs.writeFileSync(`${logFile}.stdout`, ''); fs.writeFileSync(`${logFile}.stderr`, ''); } catch {}

      let proc;
      try {
        proc = spawn(command, args || [], {
          cwd: realCwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: shell || false,
          windowsHide: true,
        });
      } catch (err) {
        return { content: [{ type: 'text', text: `❌ Failed to start process: ${err.message}` }] };
      }

      const entry = {
        proc,
        name: name || command,
        command,
        args: args || [],
        cwd: realCwd,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        signal: null,
        stdoutBuf: Buffer.alloc(0),
        stderrBuf: Buffer.alloc(0),
        combinedBuf: Buffer.alloc(0),
        logFile,
      };

      proc.stdout.on('data', (d) => {
        entry.stdoutBuf = appendRingBuffer(entry.stdoutBuf, d);
        entry.combinedBuf = appendRingBuffer(entry.combinedBuf, d);
        try { appendProcessLog(entry.logFile, 'stdout', d); } catch {}
      });
      proc.stderr.on('data', (d) => {
        entry.stderrBuf = appendRingBuffer(entry.stderrBuf, d);
        entry.combinedBuf = appendRingBuffer(entry.combinedBuf, Buffer.concat([Buffer.from('[stderr] '), d]));
        try { appendProcessLog(entry.logFile, 'stderr', d); } catch {}
      });

      proc.on('close', (code, sig) => {
        entry.status = 'exited';
        entry.exitCode = code;
        entry.signal = sig;
        entry.endedAt = new Date().toISOString();
        try { fs.appendFileSync(entry.logFile, `\n=== process exited: ${code} signal=${sig || ''} ===\n`, 'utf8'); } catch {}
      });

      proc.on('error', (err) => {
        entry.status = 'error';
        entry.endedAt = new Date().toISOString();
        entry.stderrBuf = appendRingBuffer(entry.stderrBuf, Buffer.from(`Process error: ${err.message}\n`));
      });

      managedProcesses.set(id, entry);

      return { content: [{ type: 'text', text: JSON.stringify({
        id,
        pid: proc.pid,
        name: entry.name,
        command: entry.command,
        args: entry.args,
        cwd: realCwd,
        cwdPolicy: 'absolute-path-required',
        status: entry.status,
        startedAt: entry.startedAt,
        logFile: entry.logFile,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ process_start error: ${err.message}` }] };
    }
  });

  // ── process_list ────────────────────────────────────────────────────────
  server.registerTool('process_list', {
    description: `List managed processes created by process_start, including id, pid, name, status, startedAt, endedAt, and exitCode.`,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const list = [];
      for (const [id, e] of managedProcesses) {
        list.push({
          id,
          pid: e.proc ? e.proc.pid : null,
          name: e.name,
          command: e.command,
          args: e.args,
          cwd: e.cwd,
          status: e.status,
          startedAt: e.startedAt,
          endedAt: e.endedAt,
          exitCode: e.exitCode,
          signal: e.signal,
          logFile: e.logFile,
        });
      }
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ process_list error: ${err.message}` }] };
    }
  });

  // ── process_logs ────────────────────────────────────────────────────────
  server.registerTool('process_logs', {
    description: `Read logs from a managed process. Supports stdout, stderr, and combined streams. Use offset and length for chunked reads, or tailBytes for tail output.`,
    inputSchema: {
      id: z.string().describe('Process id from process_start'),
      tailBytes: z.number().optional().default(40000).describe('Max bytes to return from each stream tail'),
      stream: z.enum(['stdout', 'stderr', 'combined']).optional().default('combined').describe('Stream to read'),
      offset: z.number().optional().default(0).describe('Log byte offset'),
      length: z.number().optional().default(60000).describe('Number of bytes to read'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ id, tailBytes, stream, offset, length }) => {
    try {
      const entry = managedProcesses.get(id);
      if (!entry) return { content: [{ type: 'text', text: `❌ Process not found: ${id}` }] };

      const safeTail = Math.min(Math.max(tailBytes || 40000, 1000), 200000);
      const tail = (buf) => {
        if (buf.length <= safeTail) return buf.toString('utf8');
        return '...[truncated]...' + buf.subarray(buf.length - safeTail).toString('utf8');
      };
      const chunk = readLogChunk(entry.logFile, { stream, offset, length });

      return { content: [{ type: 'text', text: JSON.stringify({
        id,
        status: entry.status,
        exitCode: entry.exitCode,
        signal: entry.signal,
        logFile: entry.logFile,
        ...chunk,
        truncated: chunk.eof === false,
        stdout: tail(entry.stdoutBuf),
        stderr: tail(entry.stderrBuf),
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ process_logs error: ${err.message}` }] };
    }
  });

  // ── process_stop ────────────────────────────────────────────────────────
  server.registerTool('process_stop', {
    description: `Stop a managed process created by process_start. force:false uses normal stop. force:true uses force stop.`,
    inputSchema: {
      id: z.string().describe('Process id from process_start'),
      force: z.boolean().optional().default(false).describe('Whether to use force stop. If omitted or false, normal stop is used.'),
    },
  }, async ({ id, force }) => {
    try {
      const entry = managedProcesses.get(id);
      if (!entry) return { content: [{ type: 'text', text: `❌ Process not found: ${id}` }] };

      if (entry.status !== 'running') {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true, id, pid: entry.proc ? entry.proc.pid : null,
          status: entry.status, message: `Process already ${entry.status}`,
        }, null, 2) }] };
      }

      const signal = force ? 'SIGKILL' : 'SIGTERM';
      try {
        entry.proc.kill(signal);
      } catch (err) {
        return { content: [{ type: 'text', text: `❌ Failed to kill process: ${err.message}` }] };
      }

      // Wait briefly for close event
      await new Promise(r => setTimeout(r, 1500));

      return { content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        id,
        pid: entry.proc.pid,
        status: entry.status,
        message: `Sent ${signal}`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ process_stop error: ${err.message}` }] };
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ── TASK RUNNER ─────────────────────────────────────────────────────
  // task_start / task_status / task_logs / task_list / task_stop
  // Designed for long install/build/deploy tasks. Non-blocking spawn,
  // disk-backed log file, ring buffer, timeout, permission-center aware.
  // ═══════════════════════════════════════════════════════════════════

  // ── task_start ──────────────────────────────────────────────────────
  server.registerTool('task_start', {
    description: `Start a managed long-running task, such as install, build, clone, or batch work. Returns task id immediately. Use task_status, task_logs, and task_stop for management. cwd must be a Windows absolute path.`,
    inputSchema: {
      name: z.string().describe('Friendly name for this task'),
      command: z.string().describe('Executable path or name'),
      args: z.array(z.string()).optional().default([]).describe('Arguments array'),
      cwd: z.string().describe('Windows absolute working directory.'),
      timeoutMs: z.number().optional().default(1800000).describe('Timeout in ms. Default 30 min. Max 7200000 (2h)'),
      env: z.record(z.string(), z.string()).optional().default({}).describe('Extra environment variables to merge'),
      shell: z.boolean().optional().default(false).describe('Run through shell (use only for built-in commands like echo, dir)'),
    },
  }, async ({ name, command, args, cwd, timeoutMs, env, shell }) => {
    try {
      if (!command) return { content: [{ type: 'text', text: '❌ command is required' }] };
      const cmdCheck = requireCommandExecutionAllowed();
      if (!cmdCheck.ok) return denyCommandExecution(cmdCheck);

      // P2: Auto-resolve common command names to full paths
      const resolvedCommand = resolveCommand(command);

      const safeTimeout = Math.min(Math.max(timeoutMs || 1800000, 5000), 7200000);
      const taskName = name || command;

      // Validate cwd: must be Windows absolute path
      if (!cwd || !/^[A-Za-z]:[\\\/]/.test(cwd)) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: 'cwd must be a Windows absolute path (e.g. C:\\Users\\name\\project). Virtual paths like "/" are not supported.',
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }

      // Resolve cwd
      let realCwd;
      try {
        realCwd = resolveTaskCwd(cwd);
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: `cwd error: ${e.message}`,
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }

      // Prepare log file
      let logDir, logFile, logStream;
      try {
        logDir = getTaskLogDir(realCwd);
        const safeName = taskName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
        const ts = formatDateForFilename(new Date());
        logFile = path.join(logDir, `${ts}-${safeName}.log`);
        logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
        logStream.write(`=== Task: ${taskName} ===\n`);
        logStream.write(`=== Command: ${resolvedCommand} ${(args || []).join(' ')} ===\n`);
        if (resolvedCommand !== command) logStream.write(`=== Resolved from: ${command} ===\n`);
        logStream.write(`=== CWD: ${realCwd} ===\n`);
        logStream.write(`=== Started: ${new Date().toISOString()} ===\n\n`);
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ task_start: failed to create log file — ${e.message}` }] };
      }

      // Spawn
      const id = randomUUID();
      const mergedEnv = { ...process.env, ...(env || {}) };

      // Windows: .cmd/.bat files require shell:true to spawn correctly (EINVAL otherwise).
      // BUT shell:true + path with spaces causes cmd.exe to split on the space.
      // Fix: for .cmd/.bat with spaces on Windows, bypass shell:true and manually
      // spawn cmd.exe /d /s /c with the command properly quoted.
      // Windows: .cmd/.bat files need shell to execute. But shell:true + spaces
      // in the command path causes cmd.exe to split on the space (double-quoting).
      // Fix: for .cmd/.bat with spaces on Windows, manually invoke cmd.exe with
      // the path properly quoted, WITHOUT shell:true (shell:false).
      // Windows: .cmd/.bat files need shell to execute. But shell:true + spaces
      // in the command path causes cmd.exe to split on the space.
      // Fix: for .cmd/.bat with spaces on Windows, use shell:true but pass
      // the ENTIRE command line as a single string (args[0]), so Node.js
      // constructs: cmd.exe /d /s /c "full command line"
      const isCmdBat = /\.(cmd|bat)$/i.test(resolvedCommand);
      const needsShell = shell || isCmdBat;
      const useSingleString = isCmdBat && process.platform === 'win32' && resolvedCommand.includes(' ');
      let spawnFile, spawnArgs;
      if (useSingleString) {
        const quotedCmd = `"${resolvedCommand}"`;
        const argsStr = (args || []).join(' ');
        spawnFile = `${quotedCmd} ${argsStr}`.trim();
        spawnArgs = [];
      } else {
        spawnFile = resolvedCommand;
        spawnArgs = args || [];
      }
      let proc;
      try {
        proc = spawn(spawnFile, spawnArgs, {
          cwd: realCwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: needsShell,
          windowsHide: true,
          env: mergedEnv,
        });
      } catch (err) {
        try { logStream.end(`SPAWN ERROR: ${err.message}\n`); } catch {}
        return { content: [{ type: 'text', text: `❌ task_start: spawn failed — ${err.message}` }] };
      }

      const startedAt = new Date().toISOString();
      const entry = {
        proc,
        name: taskName,
        command,
        resolvedCommand,
        args: args || [],
        cwd: realCwd,
        env: env || {},
        status: 'running',
        startedAt,
        endedAt: null,
        exitCode: null,
        signal: null,
        durationMs: null,
        stdoutBuf: Buffer.alloc(0),
        stderrBuf: Buffer.alloc(0),
        combinedBuf: Buffer.alloc(0),
        logFile,
        logStream,
        timeoutHandle: null,
        _startMs: Date.now(),
        _lastOutputAt: null,
        _stoppedByUser: false,
        _timedOut: false,
      };

      const appendBufs = (buf, field, data) => {
        const combined = Buffer.concat([buf, data]);
        return combined.length > TASK_RING_MAX
          ? combined.subarray(combined.length - TASK_RING_MAX)
          : combined;
      };

      proc.stdout.on('data', (d) => {
        entry.stdoutBuf = appendBufs(entry.stdoutBuf, 'stdout', d);
        entry.combinedBuf = appendBufs(entry.combinedBuf, 'combined', d);
        entry._lastOutputAt = Date.now();
        try { logStream.write(d.toString('utf8')); } catch {}
      });

      proc.stderr.on('data', (d) => {
        entry.stderrBuf = appendBufs(entry.stderrBuf, 'stderr', d);
        entry.combinedBuf = appendBufs(entry.combinedBuf, 'combined', Buffer.concat([Buffer.from('[STDERR] '), d]));
        entry._lastOutputAt = Date.now();
        try { logStream.write('[STDERR] ' + d.toString('utf8')); } catch {}
      });

      const finalize = (status, code, sig) => {
        if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle);
        // Never overwrite stopped/timedOut with 'failed' from close event
        if (entry.status === 'stopped' || entry.status === 'timedOut') return;
        entry.status = status;
        entry.exitCode = code;
        entry.signal = sig;
        entry.endedAt = new Date().toISOString();
        entry.durationMs = Date.now() - entry._startMs;
        try {
          logStream.write(`\n=== Ended: ${entry.endedAt} | exitCode: ${code} | status: ${status} | duration: ${entry.durationMs}ms ===\n`);
          logStream.end();
        } catch {}
      };

      proc.on('close', (code, sig) => {
        // Guard: if already stopped by user or timed out, don't overwrite status
        if (entry._stoppedByUser || entry._timedOut || entry.status === 'stopped' || entry.status === 'timedOut') {
          if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle);
          return;
        }
        const st = code === 0 ? 'exited' : 'failed';
        finalize(st, code, sig);
      });

      proc.on('error', (err) => {
        entry.stderrBuf = appendBufs(entry.stderrBuf, 'stderr', Buffer.from(`Process error: ${err.message}\n`));
        try { logStream.write(`Process error: ${err.message}\n`); } catch {}
        finalize('failed', -1, null);
      });

      // Timeout
      entry.timeoutHandle = setTimeout(() => {
        if (entry.status === 'running') {
          entry._timedOut = true;
          try { proc.kill('SIGTERM'); setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000); } catch {}
          try { logStream.write(`\n=== TIMEOUT after ${safeTimeout}ms ===\n`); } catch {}
          finalize('timedOut', null, null);
        }
      }, safeTimeout);

      managedTasks.set(id, entry);

      return { content: [{ type: 'text', text: JSON.stringify({
        id,
        name: entry.name,
        pid: proc.pid,
        command: entry.command,
        resolvedCommand: entry.resolvedCommand !== entry.command ? entry.resolvedCommand : undefined,
        args: entry.args,
        cwd: realCwd,
        status: entry.status,
        startedAt: entry.startedAt,
        logFile: entry.logFile,
        timeoutMs: safeTimeout,
        message: `Task started. Poll with task_status/${id} and task_logs/${id}`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_start error: ${err.message}` }] };
    }
  });

  // ── task_status ─────────────────────────────────────────────────────
  server.registerTool('task_status', {
    description: `Get the status of a task created by task_start, including id, name, status, pid, exitCode, signal, startedAt, endedAt, durationMs, cwd, command, args, and logFile.`,
    inputSchema: {
      id: z.string().describe('Task id returned by task_start'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    try {
      const entry = managedTasks.get(id);
      if (!entry) return { content: [{ type: 'text', text: `❌ Task not found: ${id}` }] };

      const nowMs = entry.status === 'running' ? Date.now() - entry._startMs : entry.durationMs;
      const logBytes = entry.combinedBuf ? entry.combinedBuf.length : 0;
      const lastOutputAt = entry._lastOutputAt ? new Date(entry._lastOutputAt).toISOString() : entry.startedAt;
      const idleMs = entry._lastOutputAt ? Date.now() - entry._lastOutputAt : (entry.status === 'running' ? Date.now() - entry._startMs : 0);

      // resultKind: richer than just status
      let resultKind = entry.status;
      if (entry.status === 'exited' && entry.exitCode === 0) resultKind = 'success';
      else if (entry.status === 'exited' && entry.exitCode !== 0) resultKind = 'failed';
      else if (entry.status === 'failed') resultKind = 'failed';
      else if (entry.status === 'stopped') resultKind = 'stopped';
      else if (entry.status === 'timedOut') resultKind = 'timedOut';
      else if (entry.status === 'running') resultKind = 'running';

      // P1: Detect pnpm ERR_PNPM_IGNORED_BUILDS — downgrade to 'warning'
      // when node_modules exists (deps are installed, only lifecycle scripts skipped)
      let pnpmDiagnostic = null;
      if (resultKind === 'failed' && entry.combinedBuf) {
        const logText = entry.combinedBuf.toString('utf8');
        if (logText.includes('ERR_PNPM_IGNORED_BUILDS')) {
          const nmExists = fs.existsSync(path.join(entry.cwd, 'node_modules'));
          const nmBinExists = fs.existsSync(path.join(entry.cwd, 'node_modules', '.bin'));
          if (nmExists && nmBinExists) {
            resultKind = 'warning';
          }
          // Extract ignored package list
          const match = logText.match(/Ignored build scripts:\s*(.+?)[\r\n]/);
          const ignoredPkgs = match ? match[1].split(',').map(s => s.trim()) : [];
          pnpmDiagnostic = {
            issue: 'ERR_PNPM_IGNORED_BUILDS',
            ignoredPackages: ignoredPkgs,
            nodeModulesExists: nmExists,
            nodeModulesBinExists: nmBinExists,
            suggestion: nmExists
              ? 'Dependencies installed but lifecycle scripts skipped. Build tools may work. Run pnpm approve-builds to allow scripts.'
              : 'Dependencies not fully installed. Run pnpm approve-builds then pnpm install.',
          };
        }
      }

      // suggestedPollMs: adaptive based on idle time
      let suggestedPollMs = 5000;
      if (entry.status === 'running') {
        if (idleMs > 120000) suggestedPollMs = 15000; // >2min idle → poll slower
        else if (idleMs > 30000) suggestedPollMs = 10000; // >30s idle
        else suggestedPollMs = 5000; // active → poll fast
      }

      const result = {
        id,
        name: entry.name,
        status: entry.status,
        pid: entry.proc ? entry.proc.pid : null,
        exitCode: entry.exitCode,
        signal: entry.signal,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        durationMs: nowMs,
        cwd: entry.cwd,
        command: entry.command,
        resolvedCommand: entry.resolvedCommand !== entry.command ? entry.resolvedCommand : undefined,
        args: entry.args,
        logFile: entry.logFile,
        logBytes,
        lastOutputAt,
        idleMs: Math.round(idleMs),
        suggestedPollMs,
        resultKind,
      };
      if (pnpmDiagnostic) result.pnpmDiagnostic = pnpmDiagnostic;

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_status error: ${err.message}` }] };
    }
  });

  // ── task_logs ────────────────────────────────────────────────────────
  server.registerTool('task_logs', {
    description: `Read task logs. Returns stdout, stderr, combined output, and log file path. Repeated calls do not reset the buffer. Supports stream, offset, length, and tailBytes.`,
    inputSchema: {
      id: z.string().describe('Task id returned by task_start'),
      tailBytes: z.number().optional().default(60000).describe('Max bytes to return from each stream tail'),
      stream: z.enum(['stdout', 'stderr', 'combined']).optional().default('combined').describe('Stream to read'),
      offset: z.number().optional().default(0).describe('Log byte offset'),
      length: z.number().optional().default(60000).describe('Number of bytes to read'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ id, tailBytes, stream, offset, length }) => {
    try {
      const entry = managedTasks.get(id);
      if (!entry) return { content: [{ type: 'text', text: `❌ Task not found: ${id}` }] };

      const safe = Math.min(Math.max(tailBytes || 60000, 1000), 500000);
      const tail = (buf) => {
        if (!buf || buf.length === 0) return '(empty)';
        if (buf.length <= safe) return buf.toString('utf8');
        return `...[truncated ${(buf.length - safe)} bytes]...\n` + buf.subarray(buf.length - safe).toString('utf8');
      };

      const logBytes = entry.combinedBuf ? entry.combinedBuf.length : 0;
      const lastOutputAt = entry._lastOutputAt ? new Date(entry._lastOutputAt).toISOString() : entry.startedAt;
      const idleMs = entry._lastOutputAt ? Date.now() - entry._lastOutputAt : (entry.status === 'running' ? Date.now() - entry._startMs : 0);
      const chunk = readLogChunk(entry.logFile, { stream, offset, length });

      return { content: [{ type: 'text', text: JSON.stringify({
        id,
        name: entry.name,
        status: entry.status,
        exitCode: entry.exitCode,
        logFile: entry.logFile,
        offset: chunk.offset,
        length,
        nextOffset: chunk.nextOffset,
        eof: chunk.eof,
        truncated: chunk.eof === false,
        encoding: chunk.encoding,
        stream: chunk.stream,
        text: chunk.text,
        warnings: chunk.warnings,
        stdoutTail: tail(entry.stdoutBuf),
        stderrTail: tail(entry.stderrBuf),
        combinedTail: tail(entry.combinedBuf),
        tailBytes: safe,
        logBytes,
        lastOutputAt,
        idleMs: Math.round(idleMs),
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_logs error: ${err.message}` }] };
    }
  });

  // ── task_list ────────────────────────────────────────────────────────
  server.registerTool('task_list', {
    description: `List tasks created by task_start, including id, name, status, pid, startedAt, endedAt, exitCode, and cwd.`,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const list = [];
      for (const [id, e] of managedTasks) {
        list.push({
          id,
          name: e.name,
          status: e.status,
          pid: e.proc ? e.proc.pid : null,
          command: e.command,
          args: e.args,
          cwd: e.cwd,
          startedAt: e.startedAt,
          endedAt: e.endedAt,
          exitCode: e.exitCode,
          durationMs: e.status === 'running' ? Date.now() - e._startMs : e.durationMs,
          logFile: e.logFile,
        });
      }
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_list error: ${err.message}` }] };
    }
  });

  // ── task_stop ─────────────────────────────────────────────────────────
  server.registerTool('task_stop', {
    description: `Stop a managed task created by task_start. force:false uses normal stop. force:true uses force stop. task_status and task_logs remain readable after stopping.`,
    inputSchema: {
      id: z.string().describe('Task id returned by task_start'),
      force: z.boolean().optional().default(false).describe('Whether to use force stop. If omitted or false, normal stop is used.'),
    },
  }, async ({ id, force }) => {
    try {
      const entry = managedTasks.get(id);
      if (!entry) return { content: [{ type: 'text', text: `❌ Task not found: ${id}` }] };

      if (entry.status !== 'running') {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true, id, name: entry.name,
          pid: entry.proc ? entry.proc.pid : null,
          status: entry.status,
          message: `Task already ${entry.status} — nothing to stop`,
        }, null, 2) }] };
      }

      if (entry.timeoutHandle) { clearTimeout(entry.timeoutHandle); entry.timeoutHandle = null; }

      const signal = force ? 'SIGKILL' : 'SIGTERM';
      try {
        entry.proc.kill(signal);
        if (!force) {
          // Grace period, then SIGKILL
          setTimeout(() => {
            if (entry.status === 'running') {
              try { entry.proc.kill('SIGKILL'); } catch {}
            }
          }, 5000);
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `❌ task_stop: kill failed — ${err.message}` }] };
      }

      // Mark stopped BEFORE close event fires to prevent status overwrite
      entry._stoppedByUser = true;
      entry.status = 'stopped';
      entry.endedAt = new Date().toISOString();
      entry.durationMs = Date.now() - entry._startMs;
      try {
        entry.logStream.write(`\n=== STOPPED by task_stop (signal: ${signal}) at ${entry.endedAt} ===\n`);
        entry.logStream.end();
      } catch {}

      return { content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        id,
        name: entry.name,
        pid: entry.proc.pid,
        status: entry.status,
        signal,
        durationMs: entry.durationMs,
        message: `Sent ${signal} to task "${entry.name}"`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_stop error: ${err.message}` }] };
    }
  });

  // ── task_summary ─────────────────────────────────────────────────────
  server.registerTool('task_summary', {
    description: `Return a human-readable summary of all tasks in the current server session for quick status and result review.`,
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const lines = ['📋 Task Runner Summary:', ''];
      for (const [id, e] of managedTasks) {
        const icon = e.status === 'exited' ? '✅' :
                     e.status === 'running' ? '🔄' :
                     e.status === 'failed' ? '❌' :
                     e.status === 'timedOut' ? '⏰' :
                     e.status === 'stopped' ? '⛔' : '❓';
        const dur = e.status === 'running'
          ? `${((Date.now() - e._startMs) / 1000).toFixed(0)}s (running)`
          : e.durationMs != null ? `${(e.durationMs / 1000).toFixed(1)}s` : '-';
        const exit = e.exitCode != null ? ` exit=${e.exitCode}` : '';
        lines.push(`${icon} [${e.status.padEnd(8)}] ${e.name.padEnd(35)} ${dur}${exit}`);
        lines.push(`     id: ${id}`);
        lines.push(`     cwd: ${e.cwd}`);
        lines.push(`     log: ${e.logFile}`);
        lines.push('');
      }
      if (managedTasks.size === 0) lines.push('  (no tasks started yet)');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ task_summary error: ${err.message}` }] };
    }
  });

  // ── pnpm_approve_builds ────────────────────────────────────────────────
  server.registerTool('pnpm_approve_builds', {
    description: `Handle a pnpm ignored builds case. Reads pnpmDiagnostic from a failed task log, writes .pnpm-approve-builds.json, and reruns pnpm install. Use when task_status returns the corresponding pnpmDiagnostic.`,
    inputSchema: {
      cwd: z.string().describe('Working directory of the project'),
      taskId: z.string().optional().describe('Optional: task ID of the failed pnpm install to extract package list from'),
    },
  }, async ({ cwd, taskId }) => {
    try {
      // Resolve cwd
      let realCwd;
      try {
        realCwd = resolveTaskCwd(cwd);
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ cwd error: ${e.message}` }] };
      }

      // Collect ignored packages from task logs or scan .npmrc
      let ignoredPkgs = [];

      if (taskId) {
        const entry = managedTasks.get(taskId);
        if (entry && entry.combinedBuf) {
          const logText = entry.combinedBuf.toString('utf8');
          const match = logText.match(/Ignored build scripts:\s*(.+?)[\r\n]/);
          if (match) {
            ignoredPkgs = match[1].split(',').map(s => s.trim()).filter(Boolean);
          }
        }
      }

      // Fallback: try to get from the most recent failed task in this cwd
      if (ignoredPkgs.length === 0) {
        for (const [, entry] of managedTasks) {
          if (entry.cwd === realCwd && entry.combinedBuf) {
            const logText = entry.combinedBuf.toString('utf8');
            const match = logText.match(/Ignored build scripts:\s*(.+?)[\r\n]/);
            if (match) {
              ignoredPkgs = match[1].split(',').map(s => s.trim()).filter(Boolean);
              break;
            }
          }
        }
      }

      if (ignoredPkgs.length === 0) {
        return { content: [{ type: 'text', text: '⚠️ No ignored packages found. Run pnpm install first, or provide a taskId with ERR_PNPM_IGNORED_BUILDS in its logs.' }] };
      }

      // Build the approval object — all packages approved
      const approval = {};
      for (const pkg of ignoredPkgs) {
        approval[pkg] = true;
      }

      // Write .pnpm-approve-builds.json
      const approvePath = path.join(realCwd, '.pnpm-approve-builds.json');
      fs.writeFileSync(approvePath, JSON.stringify(approval, null, 2) + '\n', 'utf8');

      return { content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        file: approvePath,
        approvedPackages: ignoredPkgs,
        count: ignoredPkgs.length,
        message: `Created .pnpm-approve-builds.json with ${ignoredPkgs.length} approved packages. Now run pnpm install again.`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ pnpm_approve_builds error: ${err.message}` }] };
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ── END TASK RUNNER ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // ── powershell_run ────────────────────────────────────────────────────
  server.registerTool('powershell_run', {
    description: `Run a PowerShell script in a specified Windows working directory and return the result after the script exits. cwd must be a Windows absolute path. Virtual paths are not supported.`,
    inputSchema: {
      script: z.string().describe('PowerShell script content to run'),
      cwd: z.string().describe('Windows absolute working directory.'),
      timeoutMs: z.number().optional().default(60000).describe('Timeout in milliseconds (max 300000)'),
      maxOutputBytes: z.number().optional().default(40000).describe('Max output bytes to return'),
      executionPolicy: z.enum(['Bypass', 'RemoteSigned', 'Unrestricted', 'Default']).optional().default('Bypass').describe('PowerShell execution policy'),
    },
  }, async ({ script, cwd, timeoutMs, maxOutputBytes, executionPolicy }) => {
    try {
      if (!script) return { content: [{ type: 'text', text: '❌ script is required' }] };
      const cmdCheck = requireCommandExecutionAllowed();
      if (!cmdCheck.ok) return denyCommandExecution(cmdCheck);
      checkCommandBoundary(null, null, script);
      const safeTimeout = Math.min(Math.max(timeoutMs || 60000, 1000), 300000);
      const safeMaxOutput = Math.min(Math.max(maxOutputBytes || 40000, 1), 200000);
      const policy = executionPolicy || 'Bypass';

      // Validate cwd: must be Windows absolute path
      if (!cwd || !path.isAbsolute(cwd) || !/^[A-Za-z]:[\\\/]/.test(cwd)) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: 'cwd must be a Windows absolute path (e.g. C:\\Users\\name\\project). Virtual paths like "/" are not supported.',
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }

      // Resolve cwd
      let realCwd;
      try {
        realCwd = resolveTaskCwd(cwd);
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          error: `cwd error: ${e.message}`,
          cwdPolicy: 'absolute-path-required'
        }, null, 2) }] };
      }
      const logFile = createLogFile(realCwd, 'powershell_run');
      const wrappedScript = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
${script}`;

      const startTime = Date.now();
      const result = await new Promise((resolve) => {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        const stdoutChunks = [];
        const stderrChunks = [];
        let timedOut = false;
        let proc;

        const args = [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle", "Hidden",
          "-ExecutionPolicy", policy,
          "-Command", wrappedScript,
        ];

        try {
          proc = spawn('powershell.exe', args, { cwd: realCwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (err) {
          resolve({ ok: false, exitCode: -1, signal: null, error: err.message, timedOut: false });
          return;
        }

        proc.stdout.on('data', (d) => { stdoutChunks.push(d); stdout = appendRingBuffer(stdout, d); });
        proc.stderr.on('data', (d) => { stderrChunks.push(d); stderr = appendRingBuffer(stderr, d); });

        const timer = setTimeout(() => {
          timedOut = true;
          try { proc.kill('SIGTERM'); } catch {}
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
        }, safeTimeout);

        proc.on('close', (code, signal) => {
          clearTimeout(timer);
          const stdoutFull = Buffer.concat(stdoutChunks);
          const stderrFull = Buffer.concat(stderrChunks);
          writeCommandLogs(logFile, stdoutFull, stderrFull, {
            kind: 'powershell_run',
            command: 'powershell.exe -Command <script>',
            cwd: realCwd,
            startedAt: new Date(startTime).toISOString(),
            exitCode: code,
          });
          const stdoutDecoded = decodeOutputPreview(stdoutFull, safeMaxOutput);
          const stderrDecoded = decodeOutputPreview(stderrFull, safeMaxOutput);
          resolve({
            ok: code === 0 && !timedOut,
            exitCode: code,
            signal,
            command: 'powershell.exe',
            args,
            cwd: realCwd,
            cwdPolicy: 'absolute-path-required',
            durationMs: Date.now() - startTime,
            timedOut,
            stdout: stdoutDecoded.text,
            stderr: stderrDecoded.text,
            stdoutEncoding: stdoutDecoded.encoding,
            stderrEncoding: stderrDecoded.encoding,
            stdoutTruncated: stdoutDecoded.truncated,
            stderrTruncated: stderrDecoded.truncated,
            logFile,
            nextStdoutOffset: stdoutDecoded.truncated ? stdoutDecoded.bytes : null,
            nextStderrOffset: stderrDecoded.truncated ? stderrDecoded.bytes : null,
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          try { writeCommandLogs(logFile, Buffer.alloc(0), Buffer.from(err.message, 'utf8'), { kind: 'powershell_run', command: 'powershell.exe -Command <script>', cwd: realCwd, startedAt: new Date(startTime).toISOString(), exitCode: -1 }); } catch {}
          resolve({ ok: false, exitCode: -1, signal: null, error: err.message, timedOut: false });
        });
      });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ powershell_run error: ${err.message}` }] };
    }
  });

  return server;
}

// ─── Health Check ────────────────────────────────────────────────────────────

// ─── Root Health Check ───────────────────────────────────────────────────────

function checkRootHealth() {
  try {
    const root = getRootDir();
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// ─── Express App Setup ───────────────────────────────────────────────────────

// host: '0.0.0.0' disables DNS rebinding protection entirely,
// allowing access via Cloudflare Tunnel and any other hostname.
const app = createMcpExpressApp({ host: '0.0.0.0' });
const transports = {};
const sessionMeta = new Map();
const closedSessions = new Map();
const closedSessionCleanupTimers = new Map();
const sessionDiagnostics = {
  lastSessionInitializedAt: null,
  lastSessionClosedAt: null,
  lastUnknownSessionAt: null,
  lastNoSessionRequestAt: null,
  lastClosedSessionReusedAt: null,
  lastStreamErrorAt: null,
  lastStreamError: null,
  totalSessionsInitialized: 0,
  totalSessionsClosed: 0,
  totalUnknownSessionRequests: 0,
  totalNoSessionRequests: 0,
  totalClosedSessionReuseAttempts: 0,
};

function shortSessionId(sid) {
  return sid ? String(sid).slice(0, 8) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function clearClosedSessionTimer(sid) {
  const oldTimer = closedSessionCleanupTimers.get(sid);
  if (oldTimer) {
    clearTimeout(oldTimer);
    closedSessionCleanupTimers.delete(sid);
  }
}

function clearClosedSessionTimers() {
  for (const timer of closedSessionCleanupTimers.values()) {
    clearTimeout(timer);
  }
  closedSessionCleanupTimers.clear();
}

function recordSessionClosed(sid) {
  if (!sid) return;
  const now = nowIso();
  const existing = sessionMeta.get(sid) || {
    sidPrefix: shortSessionId(sid),
    initializedAt: null,
    requestCount: 0,
  };
  const tombstone = {
    ...existing,
    closed: true,
    closedAt: now,
    lastSeenAt: now,
  };

  closedSessions.set(sid, tombstone);
  if (transports[sid]) delete transports[sid];
  sessionMeta.delete(sid);
  clearClosedSessionTimer(sid);

  const cleanupTimer = setTimeout(() => {
    closedSessions.delete(sid);
    closedSessionCleanupTimers.delete(sid);
  }, CLOSED_SESSION_TTL_MS);

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  closedSessionCleanupTimers.set(sid, cleanupTimer);
  sessionDiagnostics.lastSessionClosedAt = now;
  sessionDiagnostics.totalSessionsClosed += 1;

  console.warn(`[MCP session] closed sid=${shortSessionId(sid)} active=${Object.keys(transports).length} closedTombstones=${closedSessions.size}`);
}

// ── P0 Fix: JSON Parse Error Handler ────────────────────────
// Catches invalid JSON (e.g. unescaped \w in paths like C:\Windows\win.ini)
// and returns a proper JSON-RPC error instead of crashing the server.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.warn('[P0-FIX] JSON parse error (possible invalid escape sequence):', err.message);
    if (!res.headersSent) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32700, message: `Parse error: ${err.message}` },
        id: null,
      });
    }
  }
  next(err);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const rootHealthy = checkRootHealth();
  res.json({
    status: 'ok',
    version: '3.4.8',
    rootDir: getRootDir(),
    root: rootHealthy ? 'available' : 'unavailable',
    transports: Object.keys(transports).length,
    activeTasks: managedTasks.size,
    sessionDiagnostics: {
      activeSessions: Object.keys(transports).length,
      closedSessionTombstones: closedSessions.size,
      lastSessionClosedAt: sessionDiagnostics.lastSessionClosedAt,
      lastUnknownSessionAt: sessionDiagnostics.lastUnknownSessionAt,
    },
  });
});

// ── Streamable HTTP (Protocol 2025-11-25) ────────────────────────────────
app.all('/mcp', async (req, res) => {
  try {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    let transport;

    if (sessionId && transports[sessionId]) {
      const existing = transports[sessionId];
      if (existing instanceof StreamableHTTPServerTransport) {
        transport = existing;
        const meta = sessionMeta.get(sessionId);
        if (meta) {
          meta.lastSeenAt = nowIso();
          meta.requestCount = (meta.requestCount || 0) + 1;
        }
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session uses different transport' },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && req.body && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sid) => {
          const now = nowIso();
          transports[sid] = transport;
          sessionMeta.set(sid, {
            sidPrefix: shortSessionId(sid),
            initializedAt: now,
            lastSeenAt: now,
            closed: false,
            closedAt: null,
            requestCount: 0,
          });
          if (closedSessions.has(sid)) {
            closedSessions.delete(sid);
          }
          clearClosedSessionTimer(sid);
          sessionDiagnostics.lastSessionInitializedAt = now;
          sessionDiagnostics.totalSessionsInitialized += 1;
          console.log(`[MCP session] initialized sid=${shortSessionId(sid)} active=${Object.keys(transports).length}`);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        recordSessionClosed(sid);
      };
      const server = createServer();
      await server.connect(transport);
    } else if (!sessionId) {
      sessionDiagnostics.lastNoSessionRequestAt = nowIso();
      sessionDiagnostics.totalNoSessionRequests += 1;
      console.warn(`[MCP session] no session id method=${req.method} active=${Object.keys(transports).length}`);
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No session ID. Send initialize request first.' },
        id: null,
      });
      return;
    } else {
      const now = nowIso();
      const closed = closedSessions.get(sessionId);
      if (closed) {
        sessionDiagnostics.lastClosedSessionReusedAt = now;
        sessionDiagnostics.totalClosedSessionReuseAttempts += 1;
        console.warn(`[MCP session] closed session reused sid=${shortSessionId(sessionId)} closedAt=${closed.closedAt} active=${Object.keys(transports).length}`);
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `Session was closed at ${closed.closedAt}. Please reconnect/reinitialize MCP session.`,
            data: {
              reason: 'session_closed',
              sidPrefix: shortSessionId(sessionId),
              closedAt: closed.closedAt,
              ttlSeconds: Math.floor(CLOSED_SESSION_TTL_MS / 1000),
              activeSessions: Object.keys(transports).length,
            },
          },
          id: null,
        });
        return;
      }

      sessionDiagnostics.lastUnknownSessionAt = now;
      sessionDiagnostics.totalUnknownSessionRequests += 1;
      console.warn(`[MCP session] unknown session id sid=${shortSessionId(sessionId)} active=${Object.keys(transports).length} closedTombstones=${closedSessions.size}`);
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unknown session ID. Please reconnect/reinitialize MCP session.',
          data: {
            reason: 'unknown_session',
            sidPrefix: shortSessionId(sessionId),
            activeSessions: Object.keys(transports).length,
            closedSessionTombstones: closedSessions.size,
            lastSessionClosedAt: sessionDiagnostics.lastSessionClosedAt,
          },
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    sessionDiagnostics.lastStreamErrorAt = nowIso();
    sessionDiagnostics.lastStreamError = err?.message || String(err);
    console.error('MCP Streamable HTTP error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      });
    }
  }
});

// ── Legacy SSE (Protocol 2024-11-05) ─────────────────────────────────────
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  res.on('close', () => {
    delete transports[transport.sessionId];
  });
  const server = createServer();
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport instanceof SSEServerTransport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'No SSE session found' },
      id: null,
    });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(CONFIG.port, (err) => {
  if (err) {
    console.error('Failed to start WebAI LocalBridge MCP Server:', err);
    process.exit(1);
  }
  console.log(`
╔══════════════════════════════════════════════════════╗
║        WebAI LocalBridge MCP Server v3.4.3            ║
╠══════════════════════════════════════════════════════╣
║  Streamable HTTP:  http://127.0.0.1:${CONFIG.port}/mcp      ║
║  SSE (legacy):     http://127.0.0.1:${CONFIG.port}/sse      ║
║  Health:           http://127.0.0.1:${CONFIG.port}/health   ║
║  Shared root:      ${getRootDir()}             ║
║  后端: 直接文件系统 (不依赖 8081)             ║
╠══════════════════════════════════════════════════════╣
║  Tools (25): file_read, file_write, file_edit,      ║
║         file_delete, file_list, file_move,          ║
║         file_info, dir_create, dir_remove,          ║
║         file_search, content_search, file_tree,     ║
║         tunnel_status,                              ║
║         command_run, powershell_run,                ║
║         process_start, process_list, process_logs,  ║
║         process_stop,                               ║
║  [NEW]  task_start, task_status, task_logs,         ║
║         task_list, task_stop, task_summary,         ║
║         pnpm_approve_builds                         ║
╚══════════════════════════════════════════════════════╝
`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('\nShutting down WebAI LocalBridge MCP Server...');
  cleanupAllProcesses();
  for (const sid in transports) {
    try {
      await transports[sid].close();
      delete transports[sid];
    } catch (e) { /* ignore */ }
  }
  clearClosedSessionTimers();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down WebAI LocalBridge MCP Server...');
  cleanupAllProcesses();
  for (const sid in transports) {
    try {
      await transports[sid].close();
      delete transports[sid];
    } catch (e) { /* ignore */ }
  }
  clearClosedSessionTimers();
  process.exit(0);
});
