import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { decodeTextBuffer } from './text-decoder.mjs';
import { clampInt, readFileChunk, sanitizeLogName } from './path-utils.mjs';

export const MAX_LOG_CHUNK_LENGTH = 512 * 1024;

export function ensureLogDir(cwd = process.cwd(), subdir = '.mcp-logs') {
  const base = cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory() ? cwd : os.tmpdir();
  const dir = path.join(base, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createLogFile(cwd, name = 'command') {
  const dir = ensureLogDir(cwd);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}-${sanitizeLogName(name)}.log`);
}

export function streamPath(logFile, stream = 'combined') {
  if (stream === 'stdout') return `${logFile}.stdout`;
  if (stream === 'stderr') return `${logFile}.stderr`;
  return logFile;
}

export function writeCommandLogs(logFile, stdoutBuffer, stderrBuffer, meta = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stdout = Buffer.isBuffer(stdoutBuffer) ? stdoutBuffer : Buffer.from(stdoutBuffer || '');
  const stderr = Buffer.isBuffer(stderrBuffer) ? stderrBuffer : Buffer.from(stderrBuffer || '');
  const header = [
    `=== ${meta.kind || 'command'} ===`,
    meta.command ? `command: ${meta.command}` : null,
    meta.cwd ? `cwd: ${meta.cwd}` : null,
    `startedAt: ${meta.startedAt || ''}`,
    `endedAt: ${meta.endedAt || new Date().toISOString()}`,
    `exitCode: ${meta.exitCode ?? ''}`,
    '',
  ].filter(v => v !== null).join('\n');
  const combined = Buffer.concat([
    Buffer.from(header, 'utf8'),
    stdout.length ? Buffer.concat([Buffer.from('[stdout]\n', 'utf8'), stdout, Buffer.from('\n', 'utf8')]) : Buffer.alloc(0),
    stderr.length ? Buffer.concat([Buffer.from('[stderr]\n', 'utf8'), stderr, Buffer.from('\n', 'utf8')]) : Buffer.alloc(0),
  ]);
  fs.writeFileSync(logFile, combined);
  fs.writeFileSync(streamPath(logFile, 'stdout'), stdout);
  fs.writeFileSync(streamPath(logFile, 'stderr'), stderr);
}

export function appendProcessLog(logFile, stream, chunk) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
  fs.appendFileSync(streamPath(logFile, stream), buf);
  const prefix = stream === 'stderr' ? '[stderr] ' : '';
  fs.appendFileSync(logFile, Buffer.concat([Buffer.from(prefix, 'utf8'), buf]));
}

export function readLogChunk(logFile, options = {}) {
  const stream = options.stream || 'combined';
  let target = streamPath(logFile, stream);
  const warnings = [];
  if (!fs.existsSync(target)) {
    if (stream !== 'combined' && fs.existsSync(logFile)) {
      target = logFile;
      warnings.push(`Stream-specific log not found for ${stream}; returned combined log instead.`);
    } else {
      throw new Error(`Log file not found: ${target}`);
    }
  }
  const length = clampInt(options.length, 65536, 1, MAX_LOG_CHUNK_LENGTH);
  const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const { buffer, bytesRead, size } = readFileChunk(target, offset, Math.min(length, MAX_LOG_CHUNK_LENGTH));
  const decoded = decodeTextBuffer(buffer, options.encoding || 'auto');
  const nextOffset = offset + bytesRead;
  return {
    logFile,
    stream,
    text: decoded.text,
    offset,
    nextOffset,
    eof: nextOffset >= size,
    encoding: decoded.encoding,
    size,
    warnings,
  };
}
