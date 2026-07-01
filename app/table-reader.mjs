import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { decodeTextBuffer } from './text-decoder.mjs';
import { clampInt } from './path-utils.mjs';

const require = createRequire(import.meta.url);

function parseCsvLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function detectDelimiter(text, ext) {
  if (ext === '.tsv') return '\t';
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const comma = (sample.match(/,/g) || []).length;
  const tab = (sample.match(/\t/g) || []).length;
  const semicolon = (sample.match(/;/g) || []).length;
  if (tab > comma && tab >= semicolon) return '\t';
  if (semicolon > comma) return ';';
  return ',';
}

function parseRange(range) {
  if (!range) return { startRow: 1, startCol: 1 };
  const m = String(range).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!m) return { startRow: 1, startCol: 1 };
  const colToNum = (letters) => {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  };
  return {
    startCol: colToNum(m[1]),
    startRow: Number(m[2]),
    endCol: m[3] ? colToNum(m[3]) : undefined,
    endRow: m[4] ? Number(m[4]) : undefined,
  };
}

function toStringCell(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function previewMatrix(matrix, options) {
  const maxRows = clampInt(options.maxRows, 50, 1, 1000);
  const maxCols = clampInt(options.maxCols, 30, 1, 200);
  const range = parseRange(options.range);
  const startRowIdx = Math.max(range.startRow - 1, 0);
  const startColIdx = Math.max(range.startCol - 1, 0);
  const endRowIdx = range.endRow ? Math.min(range.endRow, matrix.length) : matrix.length;
  const endColIdx = range.endCol ? Math.min(range.endCol, Math.max(...matrix.map(r => r.length), 0)) : undefined;
  const windowRows = matrix.slice(startRowIdx, endRowIdx).map(row => {
    const sliced = row.slice(startColIdx, endColIdx).slice(0, maxCols);
    while (sliced.length < Math.min(maxCols, endColIdx ? endColIdx - startColIdx : sliced.length)) sliced.push('');
    return sliced.map(toStringCell);
  });
  const headers = (windowRows[0] || []).slice(0, maxCols);
  const rows = windowRows.slice(1, maxRows + 1).map(r => r.slice(0, maxCols));
  const totalRows = Math.max(matrix.length - 1, 0);
  const colCount = Math.max(...matrix.map(r => r.length), 0);
  const truncated = totalRows > rows.length || colCount > maxCols || (range.endRow && range.endRow < matrix.length ? false : false);
  const nextStart = startRowIdx + rows.length + 2;
  return {
    headers,
    rows,
    rowCount: totalRows,
    colCount,
    truncated,
    nextRange: truncated ? `A${nextStart}` : null,
  };
}

export async function previewTable(fullPath, options = {}) {
  const resolvedPath = path.resolve(fullPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const stat = fs.statSync(resolvedPath);
  const warnings = [];
  let encoding = null;

  if (ext === '.csv' || ext === '.tsv') {
    const buf = fs.readFileSync(resolvedPath);
    const decoded = decodeTextBuffer(buf, options.encoding || 'auto');
    encoding = decoded.encoding;
    const delimiter = detectDelimiter(decoded.text, ext);
    const lines = decoded.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const matrix = lines.map(line => parseCsvLine(line, delimiter));
    const preview = previewMatrix(matrix, options);
    return {
      path: options.path || fullPath,
      resolvedPath,
      fileType: ext.slice(1),
      sheets: ['default'],
      activeSheet: 'default',
      ...preview,
      warnings,
      encoding,
      delimiter,
      size: stat.size,
    };
  }

  if (ext === '.xlsx' || ext === '.xls') {
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(resolvedPath, { cellDates: false });
      const sheetName = options.sheet || workbook.SheetNames[0];
      const ws = workbook.Sheets[sheetName];
      if (!ws) {
        return {
          path: options.path || fullPath,
          resolvedPath,
          fileType: ext.slice(1),
          sheets: workbook.SheetNames,
          activeSheet: sheetName,
          headers: [],
          rows: [],
          rowCount: 0,
          colCount: 0,
          truncated: false,
          nextRange: null,
          warnings: [`Sheet not found: ${sheetName}`],
          encoding: null,
        };
      }
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const preview = previewMatrix(matrix, options);
      return {
        path: options.path || fullPath,
        resolvedPath,
        fileType: ext.slice(1),
        sheets: workbook.SheetNames,
        activeSheet: sheetName,
        ...preview,
        warnings,
        encoding: null,
        size: stat.size,
      };
    } catch (e) {
      return {
        path: options.path || fullPath,
        resolvedPath,
        fileType: ext.slice(1),
        sheets: [],
        activeSheet: options.sheet || null,
        headers: [],
        rows: [],
        rowCount: 0,
        colCount: 0,
        truncated: false,
        nextRange: null,
        warnings: [`Spreadsheet parsing failed: ${e.message}`],
        encoding: null,
      };
    }
  }

  return {
    path: options.path || fullPath,
    resolvedPath,
    fileType: ext.slice(1) || 'unknown',
    sheets: [],
    activeSheet: null,
    headers: [],
    rows: [],
    rowCount: 0,
    colCount: 0,
    truncated: false,
    nextRange: null,
    warnings: [`Table preview is not supported for ${ext || 'this file type'}.`],
    encoding: null,
  };
}
