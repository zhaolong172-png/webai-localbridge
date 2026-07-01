/**
 * AI File Gateway — Read-only file HTTP API.
 * Port 33005. Read-only. No writes, no deletes, no rootDir changes, no command execution.
 *
 * v3.4.9 — AI file browser readonly parity
 *   - New endpoints: /list, /read-lines, /content-search, /inspect
 *   - Enhanced: /capabilities (AI-first machine-readable manual)
 *   - Enhanced: /search (searchType:filename, resolvedDirectory, recursive, includeFiles/includeDirs)
 *   - Enhanced: /grep (compat, default caseSensitive=false, supports .mjs)
 *   - Fixed: file-classifier.mjs .mjs/.cjs/.mts/.cts/.mdx classification
 *   - All text/code extensions (.mjs/.js/.md/.json) now readable via /raw, /read-lines, /content-search
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { getRootDir, resolveInsideRoot } from './root-state.mjs';
import { isBinaryByExtension, isBinaryBuffer, decodeTextBuffer } from './text-decoder.mjs';
import { classifyFileExt, getAvailableActions, getRecommendedAction, MIME_MAP } from './file-classifier.mjs';
import { extractTextFromDocument } from './document-extractor.mjs';
import { previewTable } from './table-reader.mjs';
import { readArchive } from './archive-reader.mjs';

const PORT = parseInt(process.env.PORT || '33005', 10);

// Env-var override for secondary browser instance
function resolveRootDir() {
  if (process.env.AI_BROWSER_ROOT_DIR) {
    const dir = process.env.AI_BROWSER_ROOT_DIR;
    if (!fs.existsSync(dir)) throw new Error(`AI_BROWSER_ROOT_DIR does not exist: ${dir}`);
    return dir;
  }
  return getRootDir();
}

// Resolve path relative to the current root dir (supports secondary browser)
function resolvePath(rel) {
  return resolveInsideRoot(rel || '', resolveRootDir());
}
const MAX_RAW_SIZE = 5 * 1024 * 1024;       // 5MB max for /raw
const DEFAULT_RAW_SIZE = 1 * 1024 * 1024;     // 1MB default
const MAX_WALK_ITEMS = 5000;
const MAX_GREP_RESULTS = 100;
const MAX_GREP_FILE_SIZE = 512 * 1024;        // 512KB per file for grep

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function urlPathSafe(relPath) {
  return relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') : '';
}

/**
 * Build a classified file record for /tree, /manifest.json, /file-info.
 */
function buildFileRecord(fullPath, relative, stat, includeActions = true) {
  const isDir = stat.isDirectory();
  const ext = path.extname(fullPath).toLowerCase();
  const classification = classifyFileExt(ext);
  const record = {
    path: relative,
    name: path.basename(fullPath),
    extension: ext || null,
    type: isDir ? 'directory' : classification.type,
    mime: isDir ? null : classification.mime,
    size: isDir ? 0 : stat.size,
    mtime: stat.mtime.toISOString(),
    readableAsText: isDir ? false : classification.readableAsText,
    extractableText: isDir ? false : classification.extractableText,
    previewable: isDir ? false : classification.previewable,
    downloadable: !isDir,
    hashAvailable: !isDir,
    recommendedAction: getRecommendedAction(relative, isDir ? { type: 'directory' } : classification, isDir ? 0 : stat.size),
  };
  if (!isDir && includeActions) {
    record.availableActions = getAvailableActions(classification.type);
  }
  return record;
}

// ── Express App ──────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── / — HTML directory browser ───────────────────────────────────────────

app.get(['/', '/files', '/files/'], (req, res) => {
  try {
    const rootDir = resolveRootDir();
    const items = fs.readdirSync(rootDir, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(rootDir, entry.name);
        let stat;
        try { stat = fs.statSync(full); } catch { return null; }
        return { name: entry.name, isDir: entry.isDirectory(), size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

    const rows = items.map((item) => {
      const href = item.isDir
        ? `/files/${encodeURIComponent(item.name)}/`
        : `/raw?path=${encodeURIComponent(item.name)}`;
      return `<tr>
        <td><a href="${href}">${item.isDir ? 'DIR' : 'FILE'} ${escapeHtml(item.name)}${item.isDir ? '/' : ''}</a></td>
        <td>${item.isDir ? 'directory' : 'file'}</td>
        <td>${item.isDir ? '-' : formatSize(item.size)}</td>
        <td>${escapeHtml(item.mtime)}</td>
      </tr>`;
    }).join('');

    res.type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI File Gateway</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; line-height: 1.5; color: #1f2328; }
    code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border-bottom: 1px solid #d0d7de; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; }
    a { color: #0969da; text-decoration: none; }
    .api-list { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    .api-list a { background:#f6f8fa; padding:2px 8px; border-radius:4px; font-size:13px; font-family:monospace; }
  </style>
</head>
<body>
  <h1>AI File Gateway</h1>
  <p><strong>Root:</strong> <code>${escapeHtml(rootDir)}</code></p>
  <p><strong>Read-only HTTP File Browser — Primary AI entrypoint:</strong> <a href="/capabilities">/capabilities</a></p>
  <p class="api-list">
    <a href="/capabilities">/capabilities</a>
    <a href="/list">/list</a> <a href="/search?q=">/search</a> <a href="/content-search?q=">/content-search</a>
    <a href="/read-lines?path=">/read-lines</a> <a href="/inspect?path=">/inspect</a>
    <a href="/tree">/tree</a> <a href="/manifest.json">/manifest.json</a>
    <a href="/file-info?path=">/file-info</a> <a href="/raw?path=">/raw</a> <a href="/download?path=">/download</a>
    <a href="/extract-text?path=">/extract-text</a>
    <a href="/table-preview?path=">/table-preview</a> <a href="/preview?path=">/preview</a>
    <a href="/archive-list?path=">/archive-list</a>
    <a href="/archive-read?path=&innerPath=">/archive-read</a>
    <a href="/grep?q=">/grep</a>
    <a href="/pe-info?path=">/pe-info</a> <a href="/media-info?path=">/media-info</a> <a href="/binary-info?path=">/binary-info</a>
    <a href="/health">/health</a>
  </p>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">Empty directory</td></tr>'}</tbody>
  </table>
</body>
</html>`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── /files/:path — subdirectory browser ─────────────────────────────────

app.get('/files/*path', (req, res) => {
  try {
    const rel = Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path;
    const { rootDir, fullPath, relative } = resolvePath(rel || '');
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return res.redirect(`/raw?path=${encodeURIComponent(relative)}`);
    }
    const items = fs.readdirSync(fullPath, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(fullPath, entry.name);
        let s; try { s = fs.statSync(full); } catch { return null; }
        return { name: entry.name, isDir: entry.isDirectory(), size: s.size, mtime: s.mtime.toISOString() };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

    const parent = relative ? path.dirname(relative) : '';
    const rows = items.map((item) => {
      const href = item.isDir
        ? `/files/${urlPathSafe(path.join(relative, item.name))}/`
        : `/raw?path=${encodeURIComponent(path.join(relative, item.name))}`;
      return `<tr>
        <td><a href="${href}">${item.isDir ? 'DIR' : 'FILE'} ${escapeHtml(item.name)}${item.isDir ? '/' : ''}</a></td>
        <td>${item.isDir ? 'directory' : 'file'}</td>
        <td>${item.isDir ? '-' : formatSize(item.size)}</td>
        <td>${escapeHtml(item.mtime)}</td>
      </tr>`;
    }).join('');

    res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(relative || '/')} - AI File Gateway</title>
<style>body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; line-height: 1.5; color: #1f2328; }
code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin-top: 16px; }
th, td { border-bottom: 1px solid #d0d7de; padding: 8px; text-align: left; }
th { background: #f6f8fa; } a { color: #0969da; text-decoration: none; }</style></head>
<body>
  <h1>AI File Gateway</h1>
  <p><strong>Root:</strong> <code>${escapeHtml(rootDir)}</code> | <strong>Path:</strong> <code>/${escapeHtml(relative)}</code></p>
  <p><a href="/files/${urlPathSafe(parent === '.' ? '' : parent)}">Up</a></p>
  <table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4">Empty directory</td></tr>'}</tbody></table>
</body></html>`);
  } catch (e) {
    res.status(400).type('html').send(`<p>${escapeHtml(e.message)}</p>`);
  }
});

// ── /list — one-level directory listing (MCP file_list parity) ───────────

app.get('/list', (req, res) => {
  try {
    const rel = req.query.path || '';
    const { rootDir, fullPath, relative } = resolvePath(rel);
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory', path: relative });

    const items = fs.readdirSync(fullPath, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(fullPath, entry.name);
        let s;
        try { s = fs.statSync(full); } catch { return null; }
        const relPath = relative ? path.join(relative, entry.name) : entry.name;
        const isDir = entry.isDirectory();
        const ext = path.extname(full).toLowerCase();
        const classification = classifyFileExt(ext);
        const encRel = encodeURIComponent(relPath);

        if (isDir) {
          return {
            name: entry.name,
            path: relPath,
            type: 'directory',
            isDirectory: true,
            size: 0,
            mtime: s.mtime.toISOString(),
            availableActions: [
              `/list?path=${encRel}`,
              `/tree?path=${encRel}&depth=2`,
              `/search?q=&path=${encRel}`,
              `/content-search?q=&path=${encRel}`,
              `/inspect?path=${encRel}`,
            ],
          };
        }

        const record = {
          name: entry.name,
          path: relPath,
          type: classification.type,
          isDirectory: false,
          extension: ext || null,
          mime: classification.mime,
          size: s.size,
          sizeFormatted: formatSize(s.size),
          mtime: s.mtime.toISOString(),
          readableAsText: classification.readableAsText,
          extractableText: classification.extractableText,
          previewable: classification.previewable,
          downloadable: true,
          recommendedAction: getRecommendedAction(relPath, classification, s.size),
          availableActions: getAvailableActions(classification.type).map(a => `/${a}?path=${encRel}`),
        };
        // Ensure read-lines and content-search are in available actions URL form
        const rawUrlBase = getAvailableActions(classification.type);
        const actions = rawUrlBase.map(a => `/${a}?path=${encRel}`);
        record.availableActions = actions;
        return record;
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

    res.json({
      ok: true,
      service: 'AI File Gateway',
      version: '3.4.9',
      path: relative,
      root: rootDir,
      resolvedDirectory: fullPath,
      count: items.length,
      items,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── /read-lines — structured line range reading (MCP file_read_lines parity) ─

const MAX_READ_LINES = 500;

app.get('/read-lines', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ ok: false, error: 'Missing parameter: path' });

    const startLine = parseInt(req.query.startLine);
    const endLine = parseInt(req.query.endLine);
    if (isNaN(startLine) || isNaN(endLine)) {
      return res.status(400).json({ ok: false, error: 'Missing parameters: startLine and endLine (both required)' });
    }
    if (startLine < 1) return res.status(400).json({ ok: false, error: 'startLine must be >= 1', startLine });
    if (endLine < startLine) return res.status(400).json({ ok: false, error: 'endLine must be >= startLine', startLine, endLine });
    if (endLine - startLine + 1 > MAX_READ_LINES) {
      // Auto-truncate
      const adjusted = startLine + MAX_READ_LINES - 1;
      // We'll set truncated flag; proceed with adjusted endLine
    }

    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ ok: false, error: 'Not a file', path: relative });
    if (stat.isDirectory()) return res.status(400).json({ ok: false, error: 'Cannot read-lines on a directory', path: relative });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);

    // Binary rejection
    if (!classification.readableAsText) {
      const encRel = encodeURIComponent(relative);
      return res.status(415).json({
        ok: false,
        error: 'This file is not readable as text',
        path: relative,
        type: classification.type,
        mime: classification.mime,
        suggestedActions: [
          `/file-info?path=${encRel}`,
          `/binary-info?path=${encRel}`,
          `/download?path=${encRel}`,
        ],
      });
    }

    // Read file with encoding
    const encodingParam = String(req.query.encoding || 'auto').toLowerCase();
    const buffer = fs.readFileSync(fullPath);
    const { text, encoding, confidence } = decodeTextBuffer(buffer, encodingParam);

    const allLines = text.split('\n');
    const totalLines = allLines.length;
    let actualEnd = endLine;
    let truncated = false;

    if (actualEnd > totalLines) actualEnd = totalLines;
    if (endLine - startLine + 1 > MAX_READ_LINES) {
      actualEnd = Math.min(startLine + MAX_READ_LINES - 1, totalLines);
      truncated = startLine + MAX_READ_LINES - 1 < totalLines;
    }

    const lines = [];
    for (let i = startLine - 1; i < actualEnd; i++) {
      lines.push({ line: i + 1, text: allLines[i] });
    }

    res.json({
      ok: true,
      service: 'AI File Gateway',
      version: '3.4.9',
      path: relative,
      resolvedPath: fullPath,
      startLine,
      endLine: actualEnd,
      requestedStartLine: startLine,
      requestedEndLine: endLine,
      totalLines,
      encoding,
      encodingConfidence: Math.round(confidence * 100) / 100,
      truncated,
      maxLinesPerRequest: MAX_READ_LINES,
      lines,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── /content-search — official content search (MCP content_search parity) ─

const CONTENT_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.next', '.nuxt', 'vendor']);

app.get('/content-search', (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Missing query parameter: q' });

    const rootDir = resolveRootDir();
    const rel = req.query.path || '';
    const { fullPath: startPath, relative: startRel } = resolvePath(rel);
    const startStat = fs.statSync(startPath);

    const recursive = req.query.recursive !== 'false'; // default true
    const caseSensitive = req.query.caseSensitive === 'true'; // default false
    const regex = req.query.regex === 'true'; // default false
    const contextLines = Math.min(Math.max(parseInt(req.query.contextLines) || 0, 0), 10);
    const maxResults = Math.min(parseInt(req.query.maxResults) || 50, 200);
    const maxFileSizeMB = Math.min(parseFloat(req.query.maxFileSizeMB) || 5, 20);
    const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

    // Parse includePatterns (comma-separated) and includePattern (single)
    let includePatterns = null;
    if (req.query.includePatterns) {
      includePatterns = req.query.includePatterns.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    } else if (req.query.includePattern) {
      includePatterns = [req.query.includePattern.trim().toLowerCase()];
    }

    // Build test function
    let testFn;
    if (regex) {
      try {
        const re = new RegExp(query, caseSensitive ? 'g' : 'gi');
        testFn = (line) => re.test(line);
      } catch (e) {
        return res.status(400).json({ ok: false, error: `Invalid regex: ${e.message}` });
      }
    } else if (caseSensitive) {
      testFn = (line) => line.includes(query);
    } else {
      const lowerQuery = query.toLowerCase();
      testFn = (line) => line.toLowerCase().includes(lowerQuery);
    }

    const results = [];
    let filesScanned = 0;
    let filesSkipped = 0;

    function walk(dir, depth) {
      if (results.length >= maxResults) return;

      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const full = path.join(dir, entry.name);
        const relPath = path.relative(rootDir, full);

        if (entry.isDirectory()) {
          if (CONTENT_SKIP_DIRS.has(entry.name)) { filesSkipped++; continue; }
          if (depth === 0 || recursive) walk(full, depth + 1);
          continue;
        }

        // File filtering
        const eExt = path.extname(full).toLowerCase();
        const classification = classifyFileExt(eExt);
        if (!classification.readableAsText) { filesSkipped++; continue; }
        if (includePatterns) {
          const matches = includePatterns.some(pat => {
            if (pat.startsWith('*.')) return eExt === pat.substring(1);
            if (pat === '*') return true;
            return eExt === '.' + pat || eExt === pat;
          });
          if (!matches) { filesSkipped++; continue; }
        }

        let stat;
        try { stat = fs.statSync(full); } catch { filesSkipped++; continue; }
        if (stat.size > maxFileSizeBytes) { filesSkipped++; continue; }

        filesScanned++;
        try {
          const buf = fs.readFileSync(full);
          const { text } = decodeTextBuffer(buf);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            const line = lines[i];
            if (testFn(line)) {
              const col = caseSensitive ? line.indexOf(query) : line.toLowerCase().indexOf(query.toLowerCase());
              const matchText = col >= 0 ? line.substring(col, col + query.length) : query;
              const before = contextLines > 0 ? lines.slice(Math.max(0, i - contextLines), i).map((t, idx) => ({
                line: i - contextLines + idx + 1, text: t,
              })) : [];
              const after = contextLines > 0 ? lines.slice(i + 1, i + 1 + contextLines).map((t, idx) => ({
                line: i + 2 + idx, text: t,
              })) : [];
              results.push({
                path: relPath,
                resolvedPath: full,
                extension: eExt || null,
                type: classification.type,
                line: i + 1,
                column: col >= 0 ? col + 1 : 1,
                match: matchText,
                text: line.length > 500 ? line.substring(0, 500) + '...' : line,
                contextBefore: before,
                contextAfter: after,
                rawUrl: `/raw?path=${encodeURIComponent(relPath)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
                readLinesUrl: `/read-lines?path=${encodeURIComponent(relPath)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
                fileInfoUrl: `/file-info?path=${encodeURIComponent(relPath)}`,
              });
            }
          }
        } catch { filesSkipped++; }
      }
    }

    if (startStat.isDirectory()) {
      walk(startPath, 0);
    } else {
      // Single file search
      const eExt = path.extname(startPath).toLowerCase();
      const classification = classifyFileExt(eExt);
      if (!classification.readableAsText) {
        return res.status(415).json({ ok: false, error: 'File is not searchable as text', path: startRel, type: classification.type });
      }
      if (startStat.size <= maxFileSizeBytes) {
        filesScanned = 1;
        const buf = fs.readFileSync(startPath);
        const { text } = decodeTextBuffer(buf);
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const line = lines[i];
          if (testFn(line)) {
            const col = caseSensitive ? line.indexOf(query) : line.toLowerCase().indexOf(query.toLowerCase());
            const matchText = col >= 0 ? line.substring(col, col + query.length) : query;
            const before = contextLines > 0 ? lines.slice(Math.max(0, i - contextLines), i).map((t, idx) => ({
              line: i - contextLines + idx + 1, text: t,
            })) : [];
            const after = contextLines > 0 ? lines.slice(i + 1, i + 1 + contextLines).map((t, idx) => ({
              line: i + 2 + idx, text: t,
            })) : [];
            results.push({
              path: startRel,
              resolvedPath: startPath,
              extension: eExt || null,
              type: classification.type,
              line: i + 1,
              column: col >= 0 ? col + 1 : 1,
              match: matchText,
              text: line.length > 500 ? line.substring(0, 500) + '...' : line,
              contextBefore: before,
              contextAfter: after,
              rawUrl: `/raw?path=${encodeURIComponent(startRel)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
              readLinesUrl: `/read-lines?path=${encodeURIComponent(startRel)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
              fileInfoUrl: `/file-info?path=${encodeURIComponent(startRel)}`,
            });
          }
        }
      }
    }

    res.json({
      ok: true,
      service: 'AI File Gateway',
      version: '3.4.9',
      searchType: 'content',
      query,
      path: startRel,
      resolvedDirectory: startStat.isDirectory() ? startPath : path.dirname(startPath),
      recursive,
      caseSensitive,
      regex,
      contextLines,
      includePatterns: includePatterns || [],
      maxResults,
      maxFileSizeMB,
      totalMatches: results.length,
      filesScanned,
      filesSkipped,
      truncated: results.length >= maxResults,
      results,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── /inspect — aggregated file/directory inspection ──────────────────────

const MAX_INSPECT_PREVIEW_LINES = 40;

app.get('/inspect', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ ok: false, error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    const isDir = stat.isDirectory();
    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);
    const encRel = encodeURIComponent(relative);
    const name = path.basename(fullPath);

    const base = {
      ok: true,
      service: 'AI File Gateway',
      version: '3.4.9',
      path: relative,
      resolvedPath: fullPath,
      name,
      type: isDir ? 'directory' : classification.type,
      extension: isDir ? null : (ext || null),
      mime: isDir ? null : classification.mime,
      size: isDir ? 0 : stat.size,
      sizeFormatted: isDir ? '0 B' : formatSize(stat.size),
      mtime: stat.mtime.toISOString(),
    };

    if (isDir) {
      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const dirCount = items.filter(e => e.isDirectory()).length;
      const fileCount = items.filter(e => !e.isDirectory()).length;
      return res.json({
        ...base,
        isDirectory: true,
        readableAsText: false,
        extractableText: false,
        previewable: false,
        downloadable: false,
        itemCount: items.length,
        dirCount,
        fileCount,
        recommendedAction: {
          label: 'List directory contents',
          endpoint: `/list?path=${encRel}`,
          reason: 'Directory — use /list for immediate children or /tree for recursive structure',
        },
        availableActions: {
          list: `/list?path=${encRel}`,
          tree: `/tree?path=${encRel}&depth=3`,
          search: `/search?q=&path=${encRel}`,
          contentSearch: `/content-search?q=&path=${encRel}`,
          inspect: `/inspect?path=${encRel}`,
        },
      });
    }

    // File inspection
    const result = {
      ...base,
      isDirectory: false,
      readableAsText: classification.readableAsText,
      extractableText: classification.extractableText,
      previewable: classification.previewable,
      downloadable: true,
      recommendedAction: getRecommendedAction(relative, classification, stat.size),
      availableActions: {},
    };

    // Build availableActions as an object keyed by action name
    const rawActions = getAvailableActions(classification.type);
    for (const action of rawActions) {
      const url = action === 'content-search' || action === 'read-lines'
        ? `/${action}?path=${encRel}`
        : `/${action}?path=${encRel}`;
      const key = action.replace(/-/g, ''); // camelCase key
      result.availableActions[key] = url;
    }

    // Preview for text/code files
    if (classification.readableAsText && stat.size > 0) {
      try {
        const buf = stat.size > 2 * 1024 * 1024
          ? (() => { const fd = fs.openSync(fullPath, 'r'); const b = Buffer.alloc(2 * 1024 * 1024); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); return b; })()
          : fs.readFileSync(fullPath);
        const { text, encoding } = decodeTextBuffer(buf);
        const allLines = text.split('\n');
        const previewLines = allLines.slice(0, MAX_INSPECT_PREVIEW_LINES);
        result.preview = {
          kind: 'lines',
          startLine: 1,
          endLine: Math.min(previewLines.length, MAX_INSPECT_PREVIEW_LINES),
          totalLines: allLines.length,
          encoding,
          lines: previewLines.map((t, i) => ({ line: i + 1, text: t.length > 300 ? t.substring(0, 300) + '...' : t })),
        };
      } catch { /* skip preview on error */ }
    }

    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── /health ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    root: resolveRootDir(),
    version: '3.4.9',
    name: 'AI File Gateway',
    port: PORT,
    readOnly: true,
    writeOperations: false,
    deleteOperations: false,
    moveOperations: false,
    commandExecution: false,
    endpoints: [
      '/', '/health', '/capabilities', '/list', '/search', '/content-search',
      '/read-lines', '/inspect', '/tree', '/manifest.json', '/raw', '/file-info',
      '/download', '/extract-text', '/table-preview',
      '/preview', '/archive-list', '/archive-read', '/grep', '/media-info', '/binary-info', '/pe-info',
    ],
  });
});

// ── /capabilities — machine-readable API discovery ──────────────────────

app.get('/capabilities', (req, res) => {
  res.json({
    service: 'AI File Gateway',
    version: '3.4.9',
    readOnly: true,
    rootDirVisible: true,
    writeOperations: false,
    deleteOperations: false,
    moveOperations: false,
    commandExecution: false,
    processExecution: false,
    taskExecution: false,
    primaryAIEntrypoint: '/capabilities',
    purpose: 'HTTP-based read-only file browser for AI agents. All endpoints are GET-only. No JS required.',
    mcpParity: {
      file_list: '/list?path=',
      file_tree: '/tree?path=&depth=3',
      file_search: '/search?q=&path=&recursive=true',
      content_search: '/content-search?q=&path=&contextLines=2',
      file_read: '/raw?path=',
      file_read_lines: '/read-lines?path=&startLine=1&endLine=120',
      file_info: '/file-info?path=',
    },
    endpoints: {
      list: {
        url: '/list?path=...',
        purpose: 'List immediate children of a directory as structured JSON',
        returns: 'JSON',
      },
      filenameSearch: {
        url: '/search?q=...&path=...',
        purpose: 'Search file and directory names only — NOT content',
        returns: 'JSON',
      },
      contentSearch: {
        url: '/content-search?q=...&path=...&contextLines=2',
        purpose: 'Search inside text/code files with line numbers and context',
        returns: 'JSON',
      },
      readLines: {
        url: '/read-lines?path=...&startLine=1&endLine=120',
        purpose: 'Read a line range from a text/code file as structured JSON',
        returns: 'JSON',
      },
      inspect: {
        url: '/inspect?path=...',
        purpose: 'Inspect one path and get recommended actions, preview, and metadata',
        returns: 'JSON',
      },
      raw: {
        url: '/raw?path=...',
        purpose: 'Read text/code/json/csv files as plain text',
        returns: 'text/plain',
      },
      fileInfo: {
        url: '/file-info?path=...',
        purpose: 'Get metadata and classification for any file or directory',
        returns: 'JSON',
      },
      tree: {
        url: '/tree?path=...&depth=3',
        purpose: 'List directory structure recursively with file capabilities',
        returns: 'JSON',
      },
      manifest: {
        url: '/manifest.json',
        purpose: 'Flat file list with metadata and recommended actions',
        returns: 'JSON',
      },
      extractText: {
        url: '/extract-text?path=...',
        purpose: 'Extract text from PDF/DOCX/PPTX',
        returns: 'JSON',
      },
      tablePreview: {
        url: '/table-preview?path=...',
        purpose: 'Preview CSV/XLSX table data',
        returns: 'JSON',
      },
      archiveList: {
        url: '/archive-list?path=...',
        purpose: 'List archive contents',
        returns: 'JSON',
      },
      archiveRead: {
        url: '/archive-read?path=...&innerPath=...',
        purpose: 'Read a text file inside an archive',
        returns: 'JSON',
      },
      binaryInfo: {
        url: '/binary-info?path=...',
        purpose: 'Inspect binary file metadata',
        returns: 'JSON',
      },
      mediaInfo: {
        url: '/media-info?path=...',
        purpose: 'Inspect audio/video technical metadata',
        returns: 'JSON',
      },
      peInfo: {
        url: '/pe-info?path=...',
        purpose: 'Inspect Windows PE executable metadata',
        returns: 'JSON',
      },
      grep: {
        url: '/grep?q=...',
        purpose: 'Backward-compatible content search endpoint',
        replacement: '/content-search?q=...',
        returns: 'JSON',
      },
      download: {
        url: '/download?path=...',
        purpose: 'Download file for tools that can process it',
        returns: 'binary',
      },
    },
    routingRules: {
      textOrCode: '/raw?path=... or /read-lines?path=...&startLine=1&endLine=120',
      pdfDocxPptx: '/extract-text?path=...',
      xlsxCsv: '/table-preview?path=...',
      image: '/preview?path=...',
      archive: '/archive-list?path=...',
      archiveInnerText: '/archive-read?path=...&innerPath=...',
      executableOrBinary: '/binary-info?path=...',
      peExecutable: '/pe-info?path=...',
      audioVideo: '/media-info?path=...',
      unknown: '/inspect?path=...',
    },
    aiUsageHints: [
      'Use /capabilities first to discover available APIs.',
      'Use /list for one-level directory listing.',
      'Use /search for filename search only (searchType=filename).',
      'Use /content-search for code or text content search (searchType=content).',
      'Use /read-lines for reading large code files in structured line ranges.',
      'Use /inspect when unsure which endpoint to use for a given path.',
      'Use /raw for plain text files when the file is small enough.',
      'Write/edit/delete/move/command operations are NOT available in File Browser; use MCP only if explicitly required.',
      'All endpoints are GET-only. No POST, PUT, DELETE, or PATCH methods.',
      'This is a read-only gateway. No file modification capabilities exist.',
    ],
    knownReadableTextExtensions: [
      '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
      '.json', '.md', '.mdx', '.txt', '.csv', '.log', '.xml', '.yml', '.yaml',
      '.toml', '.lock', '.html', '.htm', '.css', '.sql', '.ps1', '.bat', '.cmd', '.sh',
    ],
    mcp: {
      writeOperationsRequireMcp: true,
      description: 'Use MCP endpoint for create/edit/delete/move operations.',
    },
  });
});

// ── /tree — directory tree with classification ──────────────────────────

function buildTree(fullPath, relative, depth, counters) {
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return buildFileRecord(fullPath, relative, stat, false);
  }
  const node = buildFileRecord(fullPath, relative, stat, false);
  if (depth <= 0 || counters.count > MAX_WALK_ITEMS) {
    node.children = [];
    return node;
  }
  node.children = fs.readdirSync(fullPath, { withFileTypes: true })
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => {
      counters.count += 1;
      const childRel = relative ? path.join(relative, entry.name) : entry.name;
      const childFull = path.join(fullPath, entry.name);
      try { return buildTree(childFull, childRel, depth - 1, counters); } catch { return null; }
    })
    .filter(Boolean);
  return node;
}

app.get('/tree', (req, res) => {
  try {
    const depth = Math.min(Math.max(parseInt(req.query.depth || '3', 10) || 3, 1), 8);
    const rel = req.query.path || '';
    const { fullPath, relative } = resolvePath(rel);
    res.json({
      root: resolveRootDir(),
      version: '3.4.9',
      tree: buildTree(fullPath, relative, depth, { count: 0 }),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /manifest.json — flat file manifest with classification ──────────────

app.get('/manifest.json', (req, res) => {
  try {
    const rootDir = resolveRootDir();
    const files = [];
    const dirs = [];
    let count = 0;

    function walk(dir, rel) {
      if (count > MAX_WALK_ITEMS) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        count += 1;
        if (count > MAX_WALK_ITEMS) return;
        const full = path.join(dir, entry.name);
        const relPath = rel ? path.join(rel, entry.name) : entry.name;
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (entry.isDirectory()) {
          dirs.push({
            path: relPath,
            name: entry.name,
            type: 'directory',
            mtime: stat.mtime.toISOString(),
          });
          walk(full, relPath);
        } else {
          files.push(buildFileRecord(full, relPath, stat, true));
        }
      }
    }

    walk(rootDir, '');
    res.json({
      root: rootDir,
      generatedAt: new Date().toISOString(),
      version: '3.4.9',
      files,
      dirs,
      truncated: count > MAX_WALK_ITEMS,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── /search — filename search ────────────────────────────────────────────

app.get('/search', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });
  try {
    const rootDir = resolveRootDir();
    const start = resolvePath(req.query.path || '');
    const recursive = req.query.recursive !== 'false'; // default true
    const includeFiles = req.query.includeFiles !== 'false'; // default true
    const includeDirs = req.query.includeDirs !== 'false'; // default true
    const maxResults = Math.min(parseInt(req.query.maxResults) || 200, 500);
    const results = [];
    let count = 0;
    function walk(dir) {
      if (count > MAX_WALK_ITEMS || results.length >= maxResults) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (count > MAX_WALK_ITEMS || results.length >= maxResults) return;
        count += 1;
        const full = path.join(dir, entry.name);
        const rel = path.relative(rootDir, full);
        if (entry.name.toLowerCase().includes(query)) {
          const isDir = entry.isDirectory();
          if ((isDir && !includeDirs) || (!isDir && !includeFiles)) continue;
          const stat = fs.statSync(full);
          const ext = path.extname(full).toLowerCase();
          const classification = isDir ? null : classifyFileExt(ext);
          results.push({
            path: rel,
            name: entry.name,
            type: isDir ? 'directory' : (classification ? classification.type : 'file'),
            extension: isDir ? null : (ext || null),
            size: isDir ? 0 : stat.size,
            sizeFormatted: isDir ? '0 B' : formatSize(stat.size),
            mtime: stat.mtime.toISOString(),
          });
        }
        if (recursive && entry.isDirectory()) walk(full);
      }
    }
    walk(start.fullPath);
    res.json({
      ok: true,
      service: 'AI File Gateway',
      version: '3.4.9',
      searchType: 'filename',
      query: req.query.q,
      path: start.relative,
      resolvedDirectory: start.fullPath,
      recursive,
      includeFiles,
      includeDirs,
      count: results.length,
      results,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /raw — read text/code file with encoding auto-detection ──────────────

app.get('/raw', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);

    // Reject non-readable files
    if (!classification.readableAsText) {
      const actions = getAvailableActions(classification.type);
      const actionUrls = actions.map(a => `/${a}?path=${encodeURIComponent(relative)}`);
      return res.status(415).json({
        error: 'This file is not readable as raw text',
        type: classification.type,
        path: relative,
        mime: classification.mime,
        availableActions: actionUrls,
      });
    }

    // Size check
    const encodingParam = String(req.query.encoding || 'auto').toLowerCase();
    const maxBytes = Math.min(
      parseInt(req.query.maxBytes) || DEFAULT_RAW_SIZE,
      MAX_RAW_SIZE
    );
    const useMax = stat.size > maxBytes;
    const readSize = useMax ? maxBytes : stat.size;

    // Read buffer (truncated if needed)
    let buffer;
    if (useMax) {
      const fd = fs.openSync(fullPath, 'r');
      buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);
    } else {
      buffer = fs.readFileSync(fullPath);
    }

    // Decode
    const { text: rawText, encoding, confidence } = decodeTextBuffer(buffer, encodingParam);

    // Line range filter
    let text = rawText;
    const startLine = parseInt(req.query.startLine);
    const endLine = parseInt(req.query.endLine);
    if (!isNaN(startLine) || !isNaN(endLine)) {
      const lines = text.split('\n');
      const s = Math.max(0, (isNaN(startLine) ? 0 : startLine - 1));
      const e = isNaN(endLine) ? lines.length : Math.min(endLine, lines.length);
      text = lines.slice(s, e).join('\n');
    }

    // Truncation header
    if (useMax && !req.query.startLine && !req.query.endLine) {
      text = `[文件被截断: 显示 ${formatSize(readSize)} / 总计 ${formatSize(stat.size)}]
[编码: ${encoding}, 置信度: ${(confidence * 100).toFixed(0)}%]
[使用 ?maxBytes= 增大限制, 或 /download 下载完整文件]

${text}`;
    }

    res
      .type('text/plain; charset=utf-8')
      .set('X-Detected-Encoding', encoding)
      .set('X-Encoding-Confidence', String(Math.round(confidence * 100) / 100))
      .set('X-Requested-Encoding', encodingParam)
      .set('X-Truncated', useMax ? 'true' : 'false')
      .set('X-File-Size', String(stat.size))
      .send(text);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /file-info — file metadata with classification ───────────────────────

app.get('/file-info', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    const isDir = stat.isDirectory();
    const ext = path.extname(fullPath).toLowerCase();

    if (isDir) {
      // Count items
      const items = fs.readdirSync(fullPath);
      return res.json({
        path: relative,
        name: path.basename(fullPath),
        extension: null,
        type: 'directory',
        mime: null,
        size: 0,
        mtime: stat.mtime.toISOString(),
        ctime: stat.ctime.toISOString(),
        itemCount: items.length,
        readableAsText: false,
        extractableText: false,
        previewable: false,
        downloadable: false,
        hashAvailable: false,
        availableActions: [],
      });
    }

    const classification = classifyFileExt(ext);
    const buffer = fs.readFileSync(fullPath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    const info = {
      path: relative,
      name: path.basename(fullPath),
      extension: ext || null,
      type: classification.type,
      mime: classification.mime,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString(),
      sha256,
      readableAsText: classification.readableAsText,
      extractableText: classification.extractableText,
      previewable: classification.previewable,
      downloadable: true,
      hashAvailable: true,
      availableActions: getAvailableActions(classification.type),
    };

    // Text encoding detection
    if (classification.readableAsText) {
      const { encoding, confidence } = decodeTextBuffer(buffer, 'auto');
      info.detectedEncoding = encoding;
      info.encodingConfidence = Math.round(confidence * 100) / 100;
      try {
        info.lineCount = buffer.toString('utf8').split('\n').length;
      } catch { info.lineCount = null; }
    }

    // Image dimensions (basic)
    if (classification.type === 'image') {
      try {
        if (ext === '.png') {
          const w = buffer.readUInt32BE(16);
          const h = buffer.readUInt32BE(20);
          info.width = w; info.height = h;
        } else if (ext === '.jpg' || ext === '.jpeg') {
          let offset = 2;
          while (offset < buffer.length) {
            if (buffer[offset] !== 0xFF) break;
            const marker = buffer[offset + 1];
            if (marker === 0xC0 || marker === 0xC2) {
              info.height = buffer.readUInt16BE(offset + 5);
              info.width = buffer.readUInt16BE(offset + 7);
              break;
            }
            offset += 2 + buffer.readUInt16BE(offset + 2);
            if (offset >= buffer.length) break;
          }
        } else if (ext === '.gif') {
          info.width = buffer.readUInt16LE(6);
          info.height = buffer.readUInt16LE(8);
        } else if (ext === '.webp' && buffer.length > 30) {
          if (buffer.toString('ascii', 12, 16) === 'VP8 ') {
            info.width = buffer.readUInt16LE(26) & 0x3FFF;
            info.height = buffer.readUInt16LE(28) & 0x3FFF;
          } else if (buffer.toString('ascii', 12, 16) === 'VP8L') {
            const bits = buffer.readUInt32LE(21);
            info.width = (bits & 0x3FFF) + 1;
            info.height = ((bits >> 14) & 0x3FFF) + 1;
          }
        } else if (ext === '.bmp') {
          info.width = buffer.readInt32LE(18);
          info.height = Math.abs(buffer.readInt32LE(22));
        }
      } catch { /* dimension detection failed, skip */ }
    }

    res.json(info);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /download — download any file with correct MIME and filename ─────────

app.get('/download', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

    const filename = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    // RFC 5987: use only filename*= for non-ASCII names
    // ASCII-only fallback filename for older clients
    const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
    const encodedFilename = encodeURIComponent(filename);

    res
      .set('Content-Type', mime)
      .set('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedFilename}`)
      .set('Content-Length', String(stat.size))
      .set('X-File-Name', asciiName);

    // Stream for large files
    if (stat.size > 10 * 1024 * 1024) {
      const stream = fs.createReadStream(fullPath);
      stream.pipe(res);
    } else {
      res.sendFile(fullPath);
    }
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
});

// ── /extract-text — extract text from documents ──────────────────────────

const MAX_EXTRACT_CHARS = 50000;

function extractFromDocx(fullPath) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(fullPath);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return { text: '', error: 'No word/document.xml found' };
    let xml = entry.getData().toString('utf8');
    // Strip XML tags, keep text
    xml = xml.replace(/<w:p[^>]*>/g, '\n').replace(/<w:br[^>]*\/>/g, '\n');
    const text = xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x2019;/g, "'").replace(/&#x201C;/g, '"').replace(/&#x201D;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
    return { text, sections: text.split('\n').filter(l => l.trim()).map(l => ({ content: l })) };
  } catch (e) {
    return { text: '', error: `DOCX extraction failed: ${e.message}` };
  }
}

function extractFromPptx(fullPath) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(fullPath);
    const entries = zip.getEntries().filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/));
    const slides = [];
    for (const entry of entries.sort((a, b) => {
      const an = parseInt((a.entryName.match(/slide(\d+)/) || [])[1] || '0');
      const bn = parseInt((b.entryName.match(/slide(\d+)/) || [])[1] || '0');
      return an - bn;
    })) {
      let xml = entry.getData().toString('utf8');
      // Extract text from <a:t> nodes (DrawingML text)
      const textMatches = [];
      const tRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(xml)) !== null) {
        const t = tMatch[1].trim();
        if (t) textMatches.push(t);
      }
      const slideText = textMatches.join('\n');
      slides.push({
        slide: slides.length + 1,
        text: slideText,
      });
    }
    const allText = slides.filter(s => s.text).map(s => `[Slide ${s.slide}]\n${s.text}`).join('\n\n');
    return { text: allText, slides, slideCount: slides.length };
  } catch (e) {
    return { text: '', error: `PPTX extraction failed: ${e.message}` };
  }
}

function extractFromHtml(fullPath) {
  try {
    let html = fs.readFileSync(fullPath, 'utf8');
    // Remove script and style blocks
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    // Replace block elements with newlines
    html = html.replace(/<\/(div|p|h[1-6]|li|tr|br|section|article|header|footer|main|aside|nav)>/gi, '\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');
    const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    return { text };
  } catch (e) {
    return { text: '', error: `HTML extraction failed: ${e.message}` };
  }
}

function extractFromPdf(fullPath) {
  try {
    const buf = fs.readFileSync(fullPath);
    // Simple PDF text extraction — look for text between stream/endstream, BT/ET blocks
    let text = '';
    const content = buf.toString('latin1');
    // Match text objects: BT ... ET
    const btRegex = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btRegex.exec(content)) !== null) {
      const block = match[1];
      // Extract Tj, TJ, ' operators
      const tjRegex = /\((.*?)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        text += tjMatch[1] + ' ';
      }
    }
    text = text.replace(/\\([()\\])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!text) return { text: '', extractableText: false, requiresOcr: true, message: 'No extractable text found — PDF may be scanned/image-based' };
    return { text };
  } catch (e) {
    return { text: '', error: `PDF extraction failed: ${e.message}` };
  }
}

app.get('/extract-text', async (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);
    const maxChars = Math.min(parseInt(req.query.maxChars) || MAX_EXTRACT_CHARS, MAX_EXTRACT_CHARS);
    const sharedExtractResult = await extractTextFromDocument(fullPath, {
      path: relative,
      startPage: req.query.startPage,
      endPage: req.query.endPage,
      startParagraph: req.query.startParagraph,
      endParagraph: req.query.endParagraph,
      maxChars,
      cursor: req.query.cursor,
    });
    return res.json({
      ...sharedExtractResult,
      type: classification.type,
      format: ext.slice(1),
      requiresOcr: sharedExtractResult.warnings?.some(w => /OCR|image-only|No extractable text layer/i.test(w)) || false,
    });

    let result;

    switch (ext) {
      case '.docx': {
        result = extractFromDocx(fullPath);
        break;
      }
      case '.pptx': {
        result = extractFromPptx(fullPath);
        break;
      }
      case '.pdf': {
        result = extractFromPdf(fullPath);
        break;
      }
      case '.html':
      case '.htm': {
        result = extractFromHtml(fullPath);
        break;
      }
      case '.txt':
      case '.md':
      case '.json':
      case '.csv':
      case '.log':
      case '.xml':
      case '.yml':
      case '.yaml':
      case '.ini':
      case '.cfg': {
        // Text files: just read with encoding detection
        const buf = fs.readFileSync(fullPath);
        const { text } = decodeTextBuffer(buf);
        result = { text };
        break;
      }
      default:
        return res.status(415).json({
          error: 'Text extraction not supported for this file type',
          type: classification.type,
          path: relative,
          availableActions: [
            `/file-info?path=${encodeURIComponent(relative)}`,
            `/download?path=${encodeURIComponent(relative)}`,
          ],
        });
    }

    if (result.error) {
      return res.status(500).json({ error: result.error, path: relative });
    }

    if (result.requiresOcr) {
      return res.status(200).json({
        path: relative,
        type: classification.type,
        format: ext.slice(1),
        extractableText: false,
        requiresOcr: true,
        message: result.message || 'No extractable text found',
      });
    }

    const truncated = result.text && result.text.length > maxChars;
    const text = truncated ? result.text.substring(0, maxChars) + '\n\n[截断...]' : (result.text || '');

    const resp = {
      path: relative,
      type: classification.type,
      format: ext.slice(1),
      text,
      sections: result.sections || [],
      pages: result.slides || result.pages || [],
      slides: result.slides || [],
      truncated,
      truncatedAt: truncated ? maxChars : undefined,
      requiresOcr: false,
    };

    // PPTX specific: slideCount
    if (result.slideCount !== undefined) {
      resp.slideCount = result.slideCount;
    }

    // PPTX warning: no text found
    if (!text && ext === '.pptx' && result.slideCount > 0) {
      resp.warning = 'No text nodes found in slides';
    }

    res.json(resp);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /table-preview — preview spreadsheet data ────────────────────────────

app.get('/table-preview', async (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);
    const maxRows = Math.min(parseInt(req.query.maxRows) || 50, 200);
    return res.json(await previewTable(fullPath, {
      path: relative,
      sheet: req.query.sheet,
      range: req.query.range,
      maxRows,
      maxCols: parseInt(req.query.maxCols) || 30,
    }));

    if (ext === '.csv' || ext === '.tsv') {
      const buf = fs.readFileSync(fullPath);
      const { text } = decodeTextBuffer(buf);
      const delimiter = ext === '.tsv' ? '\t' : ',';
      const lines = text.split('\n').filter(l => l.trim());
      const rows = lines.map(l => {
        // Basic CSV parsing (handle quoted fields)
        const fields = [];
        let current = '';
        let inQuotes = false;
        for (const ch of l) {
          if (ch === '"') { inQuotes = !inQuotes; }
          else if (ch === delimiter && !inQuotes) { fields.push(current.trim()); current = ''; }
          else { current += ch; }
        }
        fields.push(current.trim());
        return fields;
      });

      const columns = rows[0] || [];
      const sampleRows = rows.slice(1, maxRows + 1);

      return res.json({
        path: relative,
        type: classification.type,
        format: ext.slice(1),
        sheetNames: ['default'],
        sheets: [{
          name: 'default',
          columns,
          sampleRows,
          rowCount: rows.length - 1,
          truncated: rows.length - 1 > maxRows,
        }],
      });
    }

    if (ext === '.xlsx') {
      try {
        // Dynamic import xlsx
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(fullPath);
        const sheets = [];
        const sheetName = req.query.sheet || workbook.SheetNames[0];

        for (const name of (sheetName ? [sheetName] : workbook.SheetNames)) {
          const ws = workbook.Sheets[name];
          if (!ws) continue;
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          const columns = data[0] || [];
          const sampleRows = data.slice(1, maxRows + 1).map(r =>
            r.map(c => (c === null || c === undefined ? '' : String(c)))
          );
          sheets.push({
            name,
            columns: columns.map(c => (c === null || c === undefined ? '' : String(c))),
            sampleRows,
            rowCount: data.length - 1,
            truncated: data.length - 1 > maxRows,
          });
        }

        return res.json({
          path: relative,
          type: classification.type,
          format: 'xlsx',
          sheetNames: workbook.SheetNames,
          sheets,
        });
      } catch (e) {
        return res.status(500).json({ error: `XLSX parsing failed: ${e.message}`, path: relative });
      }
    }

    res.status(415).json({
      error: 'Table preview not supported for this file type',
      type: classification.type,
      path: relative,
      supported: ['.csv', '.tsv', '.xlsx'],
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /preview — HTML preview for various file types ───────────────────────

app.get('/preview', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    if (!fs.statSync(fullPath).isFile()) return res.status(400).json({ error: 'Not a file' });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);
    const encodedPath = encodeURIComponent(relative);
    const filename = escapeHtml(path.basename(fullPath));

    // Text / Code → syntax-highlighted HTML
    if (classification.type === 'text' || classification.type === 'code') {
      const buf = fs.readFileSync(fullPath);
      const { text, encoding } = decodeTextBuffer(buf);
      return res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { font-family: "Cascadia Code", "Fira Code", "Consolas", monospace; margin: 0; background: #1e1e1e; color: #d4d4d4; }
  .header { background: #252526; padding: 8px 16px; font-size: 12px; color: #888; border-bottom: 1px solid #3c3c3c; }
  pre { margin: 0; padding: 16px; font-size: 13px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
  a { color: #569cd6; }
</style></head>
<body>
  <div class="header">
    <strong>${filename}</strong> | encoding: ${encoding}
    | <a href="/raw?path=${encodedPath}">raw</a>
    | <a href="/download?path=${encodedPath}">download</a>
  </div>
  <pre>${escapeHtml(text)}</pre>
</body></html>`);
    }

    // Image → img tag
    if (classification.type === 'image') {
      return res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1e1e1e; }
  img { max-width: 95vw; max-height: 95vh; object-fit: contain; }
  .header { position: fixed; top: 0; left: 0; right: 0; background: #252526; padding: 8px 16px; font-size: 12px; color: #888; }
  a { color: #569cd6; }
</style></head>
<body>
  <div class="header">
    <strong>${filename}</strong>
    | <a href="/download?path=${encodedPath}">download</a>
    | <a href="/file-info?path=${encodedPath}">info</a>
  </div>
  <img src="/download?path=${encodedPath}" alt="${filename}">
</body></html>`);
    }

    // PDF → embed
    if (classification.type === 'document' && ext === '.pdf') {
      return res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { margin: 0; }
  iframe { width: 100%; height: 100vh; border: none; }
  .header { position: fixed; top: 0; right: 0; padding: 8px 16px; font-size: 12px; z-index: 10; }
  a { color: #569cd6; background: rgba(30,30,30,0.8); padding: 4px 8px; border-radius: 4px; text-decoration: none; margin: 0 4px; }
</style></head>
<body>
  <div class="header">
    <a href="/download?path=${encodedPath}">download</a>
    <a href="/extract-text?path=${encodedPath}">extract text</a>
  </div>
  <iframe src="/download?path=${encodedPath}"></iframe>
</body></html>`);
    }

    // PPTX → show as extract-text
    if (classification.type === 'presentation') {
      return res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #f6f8fa; }
  .header { margin-bottom: 16px; }
  a { color: #0969da; }
  pre { background: #fff; padding: 16px; border: 1px solid #d0d7de; border-radius: 6px; white-space: pre-wrap; font-size: 13px; }
  .loading { color: #666; }
</style></head>
<body>
  <div class="header">
    <strong>${filename}</strong>
    | <a href="/download?path=${encodedPath}">download</a>
    | <a href="/extract-text?path=${encodedPath}">extract text (JSON)</a>
  </div>
  <p class="loading">PPTX preview requires extraction. <a href="/extract-text?path=${encodedPath}">View extracted text</a></p>
</body></html>`);
    }

    // Audio/Video → HTML5 player
    if (classification.type === 'audio' || classification.type === 'video') {
      const dlUrl = `/download?path=${encodedPath}`;
      const tag = classification.type === 'video'
        ? `<video controls style="max-width:95vw;max-height:80vh"><source src="${dlUrl}">Your browser does not support video.</video>`
        : `<audio controls style="width:100%;max-width:600px"><source src="${dlUrl}">Your browser does not support audio.</audio>`;
      return res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { margin: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; background: #1e1e1e; color: #d4d4d4; font-family: sans-serif; }
  .header { position: fixed; top: 0; left: 0; right: 0; padding: 8px 16px; font-size: 12px; background: #252526; }
  a { color: #569cd6; margin: 0 8px; }
</style></head>
<body>
  <div class="header">
    <strong>${filename}</strong>
    | <a href="${dlUrl}">download</a>
    | <a href="/file-info?path=${encodedPath}">info</a>
  </div>
  ${tag}
</body></html>`);
    }

    // Default: redirect to download
    res.redirect(`/download?path=${encodedPath}`);
  } catch (e) {
    res.status(400).type('html').send(`<p>${escapeHtml(e.message)}</p>`);
  }
});

// ── /archive-list — list ZIP archive contents ────────────────────────────

app.get('/archive-list', async (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const ext = path.extname(fullPath).toLowerCase();
    return res.json(await readArchive(fullPath, {
      path: relative,
      maxEntries: parseInt(req.query.maxEntries) || 200,
    }));

    if (ext !== '.zip') {
      return res.status(415).json({
        error: 'Archive listing only supports .zip files currently',
        path: relative,
        supported: ['.zip'],
      });
    }

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(fullPath);
    const entries = zip.getEntries().map(entry => {
      const isDir = entry.isDirectory;
      const eExt = path.extname(entry.entryName).toLowerCase();
      const eClass = isDir ? { type: 'directory', readableAsText: false } : classifyFileExt(eExt);
      return {
        path: entry.entryName,
        name: entry.entryName.split('/').filter(Boolean).pop() || entry.entryName,
        size: entry.header.size,
        compressedSize: entry.header.compressedSize,
        isDirectory: isDir,
        type: isDir ? 'directory' : eClass.type,
        readableAsText: isDir ? false : eClass.readableAsText,
      };
    });

    res.json({
      path: relative,
      type: 'archive',
      format: 'zip',
      entryCount: entries.length,
      entries,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /archive-read — read a text file inside a ZIP archive ────────────────

const MAX_ARCHIVE_INNER_SIZE = 1 * 1024 * 1024; // 1MB limit for files inside archives

app.get('/archive-read', async (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });

    const { fullPath, relative } = resolvePath(req.query.path);
    const ext = path.extname(fullPath).toLowerCase();
    return res.json(await readArchive(fullPath, {
      path: relative,
      innerPath: req.query.innerPath,
      maxEntries: parseInt(req.query.maxEntries) || 200,
      maxChars: parseInt(req.query.maxChars) || MAX_EXTRACT_CHARS,
    }));

    if (ext !== '.zip') {
      return res.status(415).json({
        error: 'Archive reading only supports .zip files currently',
        path: relative,
        supported: ['.zip'],
      });
    }

    // Prevent zip slip — innerPath must not start with / or contain ..
    const innerPath = String(req.query.innerPath).trim().replace(/\\/g, '/');
    if (innerPath.startsWith('/') || innerPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid innerPath: path traversal not allowed' });
    }

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(fullPath);

    // Look for the entry (try exact match, then case-insensitive)
    let entry = zip.getEntry(innerPath);
    if (!entry) {
      // Try case-insensitive match
      const lowerInner = innerPath.toLowerCase();
      const matches = zip.getEntries().filter(e => e.entryName.toLowerCase() === lowerInner);
      if (matches.length > 0) entry = matches[0];
    }
    if (!entry || entry.isDirectory) {
      return res.status(404).json({
        error: 'File not found in archive',
        archivePath: relative,
        innerPath,
        hint: `Use /archive-list?path=${encodeURIComponent(relative)} to see contents`,
      });
    }

    const size = entry.header.size;
    if (size > MAX_ARCHIVE_INNER_SIZE) {
      return res.status(413).json({
        error: 'File inside archive is too large',
        archivePath: relative,
        innerPath,
        size,
        maxSize: MAX_ARCHIVE_INNER_SIZE,
        hint: 'Download the archive and extract locally for large files',
      });
    }

    // Check if it's a readable text file
    const innerExt = path.extname(innerPath).toLowerCase();
    const innerClass = classifyFileExt(innerExt);

    if (!innerClass.readableAsText) {
      return res.status(415).json({
        error: 'File inside archive is not readable as text',
        archivePath: relative,
        innerPath,
        type: innerClass.type,
        mime: innerClass.mime,
        suggestedActions: [
          `/archive-list?path=${encodeURIComponent(relative)}`,
          `/file-info?path=${encodeURIComponent(relative)}`,
        ],
      });
    }

    // Read and decode
    const buffer = entry.getData();
    const { text, encoding, confidence } = decodeTextBuffer(buffer);
    const truncated = text.length > MAX_EXTRACT_CHARS;

    res.json({
      archivePath: relative,
      innerPath,
      encoding,
      encodingConfidence: Math.round(confidence * 100) / 100,
      size,
      truncated,
      content: truncated ? text.substring(0, MAX_EXTRACT_CHARS) + '\n\n[截断...]' : text,
    });
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
});

// ── /grep — search file contents (enhanced v3.1) ────────────────────────

const GREP_DEFAULT_EXCLUDE = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.next', '.nuxt', 'vendor']);

app.get('/grep', (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });

    const rootDir = resolveRootDir();
    const extFilter = req.query.ext ? req.query.ext.split(',').map(e => {
      const t = e.trim().toLowerCase();
      return t.startsWith('.') ? t : '.' + t;
    }).filter(Boolean) : null;
    const maxResults = Math.min(parseInt(req.query.maxResults) || MAX_GREP_RESULTS, 200);
    const caseSensitive = req.query.caseSensitive === 'true'; // fixed: default false
    const contextLines = Math.min(Math.max(parseInt(req.query.contextLines) || 2, 0), 10);
    const includeDirs = req.query.include ? new Set(req.query.include.split(',').map(s => s.trim()).filter(Boolean)) : null;
    const excludeDirs = req.query.exclude
      ? new Set([...GREP_DEFAULT_EXCLUDE, ...req.query.exclude.split(',').map(s => s.trim()).filter(Boolean)])
      : GREP_DEFAULT_EXCLUDE;

    const searchQuery = caseSensitive ? query : query.toLowerCase();
    const results = [];
    let filesScanned = 0;
    let skipped = 0;

    function walk(dir, depth) {
      if (results.length >= maxResults) return;
      const dirName = path.basename(dir);
      if (excludeDirs.has(dirName) && depth > 0) { skipped++; return; }

      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const full = path.join(dir, entry.name);
        const rel = path.relative(rootDir, full);

        if (entry.isDirectory()) {
          if (includeDirs && depth === 0) {
            if (includeDirs.has(entry.name)) walk(full, depth + 1);
            continue;
          }
          walk(full, depth + 1);
          continue;
        }

        if (includeDirs && depth === 0) continue;

        const eExt = path.extname(full).toLowerCase();
        const classification = classifyFileExt(eExt);
        if (!classification.readableAsText) { skipped++; continue; }
        if (extFilter && !extFilter.includes(eExt)) { skipped++; continue; }

        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.size > MAX_GREP_FILE_SIZE) { skipped++; continue; }

        filesScanned++;
        try {
          const buf = fs.readFileSync(full);
          const { text } = decodeTextBuffer(buf);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            const line = lines[i];
            const compareLine = caseSensitive ? line : line.toLowerCase();
            const col = compareLine.indexOf(searchQuery);
            if (col >= 0) {
              const snippet = line.length > 300 ? line.substring(0, 300) + '...' : line;
              const before = contextLines > 0 ? lines.slice(Math.max(0, i - contextLines), i).map((t, idx) => ({
                line: i - contextLines + idx + 1, text: t,
              })) : [];
              const after = contextLines > 0 ? lines.slice(i + 1, i + 1 + contextLines).map((t, idx) => ({
                line: i + 2 + idx, text: t,
              })) : [];
              results.push({
                path: rel,
                extension: eExt || null,
                type: classification.type,
                line: i + 1,
                column: col + 1,
                snippet,
                contextBefore: before,
                contextAfter: after,
                rawUrl: `/raw?path=${encodeURIComponent(rel)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
                readLinesUrl: `/read-lines?path=${encodeURIComponent(rel)}&startLine=${Math.max(1, i + 1 - contextLines)}&endLine=${i + 1 + contextLines}`,
                fileInfoUrl: `/file-info?path=${encodeURIComponent(rel)}`,
              });
            }
          }
        } catch { skipped++; }
      }
    }

    walk(rootDir, 0);

    res.json({
      compatEndpoint: '/grep',
      replacement: '/content-search',
      query,
      caseSensitive,
      contextLines,
      totalMatches: results.length,
      filesScanned,
      filesSkipped: skipped,
      truncated: results.length >= maxResults,
      results,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /media-info — media file metadata (enhanced v3.1) ────────────────────

// Try to resolve ffprobe path once at startup
let ffprobePath = null;
try {
  const out = execSync('where ffprobe 2>nul || which ffprobe 2>/dev/null || echo ""', {
    shell: true,
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().split('\n')[0];
  if (out && out.length > 0) ffprobePath = out;
} catch { ffprobePath = null; }

function getMediaInfoFromFfprobe(filePath) {
  if (!ffprobePath || !execSync) return null;
  try {
    const out = execSync(
      `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const data = JSON.parse(out);
    const format = data.format || {};
    const streams = (data.streams || []).map(s => ({
      index: s.index,
      codecType: s.codec_type,
      codecName: s.codec_name,
      codecLongName: s.codec_long_name,
      width: s.width || undefined,
      height: s.height || undefined,
      sampleRate: s.sample_rate ? parseInt(s.sample_rate) : undefined,
      channels: s.channels || undefined,
      bitRate: s.bit_rate ? parseInt(s.bit_rate) : undefined,
      duration: s.duration ? parseFloat(s.duration) : undefined,
      frameRate: s.r_frame_rate || s.avg_frame_rate || undefined,
    }));

    return {
      detailed: true,
      source: 'ffprobe',
      duration: format.duration ? parseFloat(format.duration) : undefined,
      bitrate: format.bit_rate ? parseInt(format.bit_rate) : undefined,
      formatName: format.format_name,
      formatLongName: format.format_long_name,
      streamCount: streams.length,
      streams,
    };
  } catch (e) {
    return { detailed: false, reason: `ffprobe error: ${e.message}` };
  }
}

app.get('/media-info', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);

    if (classification.type !== 'audio' && classification.type !== 'video') {
      return res.status(415).json({
        error: 'Media info only available for audio/video files',
        type: classification.type,
        path: relative,
      });
    }

    const buf = fs.readFileSync(fullPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const magicBytes = buf.subarray(0, Math.min(16, buf.length)).toString('hex').toUpperCase();

    const info = {
      path: relative,
      name: path.basename(fullPath),
      type: classification.type,
      format: ext.slice(1),
      mime: classification.mime,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      mtime: stat.mtime.toISOString(),
      sha256,
      magicBytes,
    };

    // Try ffprobe for detailed metadata
    if (ffprobePath) {
      const detailed = getMediaInfoFromFfprobe(fullPath);
      if (detailed && detailed.detailed) {
        Object.assign(info, detailed);
      } else {
        info.detailed = false;
        info.reason = detailed?.reason || 'ffprobe could not parse file';
      }
    } else {
      info.detailed = false;
      info.reason = 'ffprobe not available — install ffmpeg for detailed media metadata';
    }

    res.json(info);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /binary-info — binary file info ──────────────────────────────────────

app.get('/binary-info', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    const ext = path.extname(fullPath).toLowerCase();
    const classification = classifyFileExt(ext);

    // Read first 256 bytes
    let buf;
    if (stat.size > 256) {
      const fd = fs.openSync(fullPath, 'r');
      buf = Buffer.alloc(256);
      fs.readSync(fd, buf, 0, 256, 0);
      fs.closeSync(fd);
    } else {
      buf = fs.readFileSync(fullPath);
    }

    const sha256 = crypto.createHash('sha256').update(
      stat.size <= 256 ? buf : fs.readFileSync(fullPath)
    ).digest('hex');

    // Calculate entropy
    const freq = new Array(256).fill(0);
    for (const b of buf) freq[b]++;
    let entropy = 0;
    for (const f of freq) {
      if (f > 0) {
        const p = f / buf.length;
        entropy -= p * Math.log2(p);
      }
    }

    const magicBytes = buf.subarray(0, Math.min(16, buf.length)).toString('hex').toUpperCase().match(/.{2}/g).join(' ');

    // PE header detection
    let peInfo = null;
    if (buf.length >= 2 && buf[0] === 0x4D && buf[1] === 0x5A) {
      peInfo = { isPE: true, magic: 'MZ' };
      if (buf.length >= 64) {
        const peOffset = buf.readUInt32LE(0x3C);
        if (peOffset + 4 < buf.length && buf[peOffset] === 0x50 && buf[peOffset + 1] === 0x45) {
          peInfo.peHeader = 'PE';
          const machine = buf.readUInt16LE(peOffset + 4);
          const machines = { 0x014C: 'i386', 0x8664: 'x64', 0x0200: 'IA64', 0x01C4: 'ARM', 0xAA64: 'ARM64' };
          peInfo.machine = machines[machine] || `0x${machine.toString(16)}`;
        }
      }
    }

    res.json({
      path: relative,
      name: path.basename(fullPath),
      type: classification.type,
      extension: ext || null,
      mime: classification.mime,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      mtime: stat.mtime.toISOString(),
      sha256,
      magicBytes,
      entropy: Math.round(entropy * 100) / 100,
      readableAsText: false,
      extractableText: false,
      previewable: false,
      downloadable: true,
      peInfo,
      availableActions: ['file-info', 'download', 'binary-info'],
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /pe-info — Windows PE executable metadata (v3.1) ─────────────────────

const PE_MACHINES = {
  0x014C: 'i386', 0x8664: 'x64', 0x0200: 'IA64', 0x01C4: 'ARM',
  0x01C0: 'ARM', 0xAA64: 'ARM64', 0x01EB: 'ARM64', 0x01F0: 'ARM64',
  0x00E0: 'IA64',
};

const PE_SUBSYSTEMS = {
  1: 'Native', 2: 'Windows GUI', 3: 'Windows Console',
  5: 'OS/2 Console', 7: 'POSIX Console', 9: 'Windows CE GUI',
  10: 'EFI Application', 11: 'EFI Boot Service Driver', 12: 'EFI Runtime Driver',
};

const PE_CHARACTERISTICS = {
  0x0001: 'RELOCS_STRIPPED', 0x0002: 'EXECUTABLE_IMAGE',
  0x0020: 'LARGE_ADDRESS_AWARE', 0x0100: '32BIT_MACHINE',
  0x2000: 'DLL', 0x4000: 'SYSTEM',
};

function parsePEInfo(buffer, filePath) {
  if (buffer.length < 64) return { isPE: false, error: 'File too small to be PE' };
  if (buffer[0] !== 0x4D || buffer[1] !== 0x5A) return { isPE: false, error: 'Not a PE file (missing MZ signature)' };

  const peOffset = buffer.readUInt32LE(0x3C);
  if (peOffset + 4 > buffer.length) return { isPE: false, error: 'Invalid PE offset' };
  if (buffer[peOffset] !== 0x50 || buffer[peOffset + 1] !== 0x45) return { isPE: false, error: 'PE signature not found at offset' };

  const coffStart = peOffset + 4;
  if (coffStart + 20 > buffer.length) return { isPE: false, error: 'File truncated at COFF header' };

  const machine = buffer.readUInt16LE(coffStart);
  const numberOfSections = buffer.readUInt16LE(coffStart + 2);
  const timestamp = buffer.readUInt32LE(coffStart + 4);
  const characteristics = buffer.readUInt16LE(coffStart + 18);
  const sizeOfOptionalHeader = buffer.readUInt16LE(coffStart + 16);

  const optStart = coffStart + 20;
  if (optStart + sizeOfOptionalHeader > buffer.length) return { isPE: false, error: 'File truncated at Optional header' };

  const magic = buffer.readUInt16LE(optStart); // 0x10B = PE32, 0x20B = PE32+
  const isPE32Plus = magic === 0x20B;

  let subsystem = 'Unknown';
  if (sizeOfOptionalHeader >= 72) {
    subsystem = PE_SUBSYSTEMS[buffer.readUInt16LE(optStart + 68)] || `0x${buffer.readUInt16LE(optStart + 68).toString(16)}`;
  }

  const isDLL = !!(characteristics & 0x2000);

  // Parse characteristics
  const chars = [];
  for (const [flag, name] of Object.entries(PE_CHARACTERISTICS)) {
    if (characteristics & parseInt(flag)) chars.push(name);
  }

  // Section headers
  const sectionsStart = optStart + sizeOfOptionalHeader;
  const sections = [];
  for (let i = 0; i < numberOfSections; i++) {
    const secStart = sectionsStart + i * 40;
    if (secStart + 40 > buffer.length) break;
    const name = buffer.toString('ascii', secStart, secStart + 8).replace(/\x00/g, '').trim();
    const virtualSize = buffer.readUInt32LE(secStart + 8);
    const rawSize = buffer.readUInt32LE(secStart + 16);
    const secChars = buffer.readUInt32LE(secStart + 36);
    const secFlags = [];
    if (secChars & 0x20000000) secFlags.push('EXECUTE');
    if (secChars & 0x40000000) secFlags.push('READ');
    if (secChars & 0x80000000) secFlags.push('WRITE');
    sections.push({ name, virtualSize, rawSize, characteristics: secFlags });
  }

  // Version info (basic — look for VS_VERSION_INFO resource)
  let versionInfo = null;
  // Signature check (basic)
  let signature = { present: false, verified: null };
  // Look for WIN_CERTIFICATE in security directory (simplified)
  const securityDirRva = isPE32Plus ? buffer.readUInt32LE(optStart + 144) : buffer.readUInt32LE(optStart + 128);
  const securityDirSize = isPE32Plus ? buffer.readUInt32LE(optStart + 148) : buffer.readUInt32LE(optStart + 132);
  if (securityDirRva > 0 && securityDirSize > 0) {
    signature.present = true;
    signature.verified = 'cannot verify — use sigcheck or signtool';
  }

  return {
    isPE: true,
    path: path.basename(filePath),
    machine: PE_MACHINES[machine] || `0x${machine.toString(16)}`,
    machineHex: `0x${machine.toString(16).toUpperCase().padStart(4, '0')}`,
    numberOfSections,
    timestamp: new Date(timestamp * 1000).toISOString(),
    timestampUnix: timestamp,
    subsystem,
    magic: isPE32Plus ? 'PE32+' : 'PE32',
    isDLL,
    characteristics: chars,
    sections,
    versionInfo,
    signature,
  };
}

app.get('/pe-info', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'Missing parameter: path' });
    const { fullPath, relative } = resolvePath(req.query.path);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });

    // Read enough of the file for PE parsing (headers + sections)
    // For full analysis we need: DOS(64) + stub + PE sig(4) + COFF(20) + opt(<=256) + sections*40
    // Most PE files fit headers in first 4096 bytes, but we'll read up to 65536
    const readSize = Math.min(stat.size, 65536);
    let buffer;
    if (stat.size <= readSize) {
      buffer = fs.readFileSync(fullPath);
    } else {
      const fd = fs.openSync(fullPath, 'r');
      buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);
    }

    const sha256 = crypto.createHash('sha256').update(
      stat.size <= 65536 ? buffer : fs.readFileSync(fullPath)
    ).digest('hex');

    const peInfo = parsePEInfo(buffer, relative);

    if (!peInfo.isPE) {
      return res.json({
        path: relative,
        isPE: false,
        error: peInfo.error,
        name: path.basename(fullPath),
        size: stat.size,
        sizeFormatted: formatSize(stat.size),
        mtime: stat.mtime.toISOString(),
        sha256,
        availableActions: ['file-info', 'download', 'binary-info'],
      });
    }

    res.json({
      ...peInfo,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      mtime: stat.mtime.toISOString(),
      sha256,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── 404 ─────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.url}` });
});

// ── Start ────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     AI File Gateway v3.4.9 (Port ${PORT})               ║
╠══════════════════════════════════════════════════════╣
║  /                   HTML directory browser          ║
║  /capabilities       AI-first API discovery          ║
║  /health             Health check                    ║
║  /list               One-level dir list (JSON)       ║
║  /search             Filename search (JSON)          ║
║  /content-search     Content search (JSON)           ║
║  /read-lines         Line range read (JSON)          ║
║  /inspect            Aggregated metadata (JSON)      ║
║  /tree               Directory tree                  ║
║  /manifest.json      Flat file manifest              ║
║  /raw                Read text/code with encoding    ║
║  /file-info          File metadata + classification  ║
║  /download           Download any file               ║
║  /grep               Content search (legacy)         ║
║  /extract-text       Extract text from documents     ║
║  /table-preview      Preview spreadsheets            ║
║  /preview            HTML preview                    ║
║  /archive-list       List ZIP contents               ║
║  /archive-read       Read file inside ZIP            ║
║  /media-info         Media metadata (ffprobe)        ║
║  /binary-info        Binary file analysis            ║
║  /pe-info            PE executable metadata          ║
╠══════════════════════════════════════════════════════╣
║  Read-only. No writes, no deletes, no rootDir change ║
║  Shared root: ${resolveRootDir().substring(0, 35)}...   ║
╚══════════════════════════════════════════════════════╝
`);
});
