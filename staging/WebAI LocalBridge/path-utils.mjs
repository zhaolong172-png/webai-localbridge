import fs from 'node:fs';
import path from 'node:path';

export function normalizePatterns(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

export function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchAnyPattern(nameOrPath, patterns = []) {
  if (!patterns || patterns.length === 0) return false;
  const value = String(nameOrPath).replace(/\\/g, '/');
  const base = path.basename(value);
  return patterns.some((pattern) => {
    const pat = String(pattern).replace(/\\/g, '/');
    if (!pat) return false;
    if (pat.includes('*') || pat.includes('?')) {
      const re = globToRegExp(pat);
      return re.test(value) || re.test(base);
    }
    return value.toLowerCase().includes(pat.toLowerCase()) || base.toLowerCase().includes(pat.toLowerCase());
  });
}

export function safeStat(fullPath) {
  try {
    return fs.statSync(fullPath);
  } catch {
    return null;
  }
}

export function readFileChunk(fullPath, offset = 0, length = 1024 * 1024) {
  const stat = fs.statSync(fullPath);
  const safeOffset = Math.min(Math.max(Number(offset) || 0, 0), stat.size);
  const safeLength = Math.min(Math.max(Number(length) || 0, 0), stat.size - safeOffset);
  const buffer = Buffer.alloc(safeLength);
  const fd = fs.openSync(fullPath, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, safeLength, safeOffset);
    return { buffer: buffer.subarray(0, bytesRead), offset: safeOffset, bytesRead, size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

export function clampInt(value, fallback, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return Math.min(Math.max(n, min), max);
}

export function sanitizeLogName(value) {
  return String(value || 'command').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 60) || 'command';
}
