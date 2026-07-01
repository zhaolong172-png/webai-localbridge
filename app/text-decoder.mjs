/**
 * text-decoder.mjs — Shared text encoding detection module
 * ===========================================================
 * Used by both 33005 (ai-api-server.mjs) and 33003 (mcp-tunnel-server.js)
 * for consistent encoding auto-detection (GBK/GB18030/UTF-8 via iconv-lite + jschardet).
 *
 * v1.0.0
 */

import path from 'node:path';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';

// ── Binary detection ─────────────────────────────────────────────────────

export const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.sys', '.obj', '.lib', '.bin', '.dat',
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.zst',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mkv', '.wmv', '.flv', '.mov', '.wav', '.ogg',
  '.iso', '.img', '.vhd', '.vhdx', '.qcow2',
  '.ttf', '.otf', '.woff', '.woff2',
  '.sqlite', '.db', '.mdb',
  '.pyc', '.pyo', '.class', '.jar', '.war',
  '.msi', '.cab', '.deb', '.rpm', '.dmg',
  '.psd', '.ai', '.epub', '.mobi',
]);

export const TEXT_LIKE_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.tsv', '.log',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.html', '.htm', '.css', '.scss', '.less',
  '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bat', '.cmd', '.ps1', '.psm1',
  '.sql', '.r', '.rb', '.php', '.pl', '.lua', '.swift', '.kt',
  '.vue', '.svelte',
  '.env', '.gitignore', '.dockerignore', '.editorconfig', '.svg',
]);

export function isBinaryByExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isBinaryBuffer(buffer, filePath = '') {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return true;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_LIKE_EXTENSIONS.has(ext)) return false;
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      printable++;
    } else if (byte >= 0x80) {
      printable++;
    }
  }
  const ratio = printable / sample.length;
  return ratio < 0.85;
}

// ── Encoding detection ───────────────────────────────────────────────────

/**
 * Decode a text buffer with auto-detection or explicit encoding.
 *
 * Strategy (in order):
 *   1. Explicit encoding → iconv-lite directly
 *   2. BOM: UTF-8 (EF BB BF), UTF-16LE (FF FE), UTF-16BE (FE FF)
 *   3. Valid UTF-8 → use it
 *   4. jschardet → use detected encoding
 *   5. Fallback → GB18030
 *
 * Returns { text, encoding, confidence }
 */
export function decodeTextBuffer(buffer, requestedEncoding = 'auto') {
  if (requestedEncoding && requestedEncoding !== 'auto') {
    try {
      const text = iconv.decode(buffer, requestedEncoding);
      return { text, encoding: requestedEncoding, confidence: 1.0 };
    } catch { /* fall through */ }
  }

  // BOM detection
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8bom', confidence: 1.0 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    try {
      const text = iconv.decode(buffer.subarray(2), 'utf-16le');
      return { text, encoding: 'utf-16le', confidence: 1.0 };
    } catch { /* fall through */ }
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    try {
      const text = iconv.decode(buffer.subarray(2), 'utf-16be');
      return { text, encoding: 'utf-16be', confidence: 1.0 };
    } catch { /* fall through */ }
  }

  // Try valid UTF-8
  const utf8Text = buffer.toString('utf8');
  const hasReplacementChar = utf8Text.includes('\uFFFD');
  if (!hasReplacementChar && buffer.length > 0) {
    const reEncoded = Buffer.from(utf8Text, 'utf8');
    if (reEncoded.equals(buffer)) {
      return { text: utf8Text, encoding: 'utf8', confidence: 0.99 };
    }
  }

  // jschardet
  try {
    const detected = jschardet.detect(buffer);
    if (detected && detected.encoding && detected.confidence >= 0.5) {
      let enc = detected.encoding.toLowerCase();
      if (enc === 'ascii') enc = 'utf8';
      if (enc === 'gb2312') enc = 'gb18030';
      if (enc === 'windows-1252') enc = 'utf8';
      try {
        const text = iconv.decode(buffer, enc);
        return { text, encoding: detected.encoding, confidence: detected.confidence };
      } catch { /* fall through */ }
    }
  } catch { /* fall through */ }

  // Fallback: GB18030
  try {
    const text = iconv.decode(buffer, 'gb18030');
    return { text, encoding: 'gb18030', confidence: 0.4 };
  } catch {
    return { text: utf8Text, encoding: 'utf8', confidence: 0.1 };
  }
}
