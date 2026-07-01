import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { classifyFileExt, getRecommendedMcpTool } from './file-classifier.mjs';
import { decodeTextBuffer, isBinaryBuffer } from './text-decoder.mjs';
import { clampInt } from './path-utils.mjs';

const require = createRequire(import.meta.url);

function normalizeInnerPath(innerPath) {
  const value = String(innerPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (value.includes('..')) throw new Error('Invalid innerPath: path traversal is not allowed.');
  return value;
}

function normalizeEntryName(entryName) {
  return String(entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function entryBaseName(entryName) {
  const normalized = normalizeEntryName(entryName);
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

export async function readArchive(fullPath, options = {}) {
  const resolvedPath = path.resolve(fullPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const archiveType = ext.replace(/^\./, '') || 'unknown';
  const warnings = [];
  const maxEntries = clampInt(options.maxEntries, 200, 1, 2000);
  const maxChars = clampInt(options.maxChars, 50000, 1, 500000);

  if (ext !== '.zip') {
    return {
      path: options.path || fullPath,
      resolvedPath,
      archiveType,
      entries: [],
      innerPath: options.innerPath || null,
      text: '',
      truncated: false,
      nextCursor: null,
      warnings: [`${archiveType || 'Archive'} is not supported yet. ZIP is supported.`],
      encoding: null,
    };
  }

  if (!fs.existsSync(resolvedPath)) throw new Error(`Archive not found: ${resolvedPath}`);
  let zip;
  try {
    const AdmZip = require('adm-zip');
    zip = new AdmZip(resolvedPath);
  } catch (e) {
    return {
      path: options.path || fullPath,
      resolvedPath,
      archiveType,
      entries: [],
      innerPath: options.innerPath || null,
      text: '',
      truncated: false,
      nextCursor: null,
      warnings: [`ZIP open failed: ${e.message}`],
      encoding: null,
    };
  }

  const allEntries = zip.getEntries();
  if (!options.innerPath) {
    const entries = allEntries.slice(0, maxEntries).map((entry) => {
      const normalizedPath = normalizeEntryName(entry.entryName);
      const eExt = path.extname(normalizedPath).toLowerCase();
      const c = entry.isDirectory ? { type: 'directory', readableAsText: false } : classifyFileExt(eExt);
      return {
        path: normalizedPath,
        rawPath: entry.entryName,
        name: entryBaseName(entry.entryName),
        isDirectory: entry.isDirectory,
        size: entry.header.size,
        compressedSize: entry.header.compressedSize,
        type: entry.isDirectory ? 'directory' : c.type,
        mime: entry.isDirectory ? null : c.mime,
        readableAsText: entry.isDirectory ? false : c.readableAsText,
        recommendedTool: entry.isDirectory ? 'archive_read' : getRecommendedMcpTool(c, entry.header.size),
      };
    });
    return {
      path: options.path || fullPath,
      resolvedPath,
      archiveType,
      entries,
      innerPath: null,
      text: '',
      truncated: allEntries.length > entries.length,
      nextCursor: allEntries.length > entries.length ? String(entries.length) : null,
      warnings,
      encoding: null,
      entryCount: allEntries.length,
    };
  }

  const innerPath = normalizeInnerPath(options.innerPath);
  let entry = zip.getEntry(innerPath);
  if (!entry) {
    const lower = innerPath.toLowerCase();
    entry = allEntries.find(e => normalizeEntryName(e.entryName).toLowerCase() === lower);
  }
  if (!entry) {
    const backslashPath = innerPath.replace(/\//g, '\\');
    entry = zip.getEntry(backslashPath);
  }
  if (!entry || entry.isDirectory) {
    return {
      path: options.path || fullPath,
      resolvedPath,
      archiveType,
      entries: [],
      innerPath,
      text: '',
      truncated: false,
      nextCursor: null,
      warnings: [`Archive entry not found or is a directory: ${innerPath}`],
      encoding: null,
    };
  }

  const eExt = path.extname(entry.entryName).toLowerCase();
  const c = classifyFileExt(eExt);
  const buffer = entry.getData();
  if (!c.readableAsText || isBinaryBuffer(buffer.subarray(0, Math.min(buffer.length, 4096)), entry.entryName)) {
    return {
      path: options.path || fullPath,
      resolvedPath,
      archiveType,
      entries: [],
      innerPath,
      text: '',
      truncated: false,
      nextCursor: null,
      warnings: [`Archive entry is not readable as text. type=${c.type}, recommendedTool=${getRecommendedMcpTool(c, buffer.length)}.`],
      encoding: null,
      recommendedTool: getRecommendedMcpTool(c, buffer.length),
    };
  }

  const decoded = decodeTextBuffer(buffer, options.encoding || 'auto');
  const start = clampInt(options.cursor, 0, 0, decoded.text.length);
  const text = decoded.text.slice(start, start + maxChars);
  const truncated = start + maxChars < decoded.text.length;
  return {
    path: options.path || fullPath,
    resolvedPath,
    archiveType,
    entries: [],
    innerPath,
    text,
    truncated,
    nextCursor: truncated ? String(start + maxChars) : null,
    warnings,
    encoding: decoded.encoding,
    size: buffer.length,
  };
}
