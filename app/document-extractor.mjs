import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { decodeTextBuffer } from './text-decoder.mjs';
import { clampInt } from './path-utils.mjs';

const require = createRequire(import.meta.url);
const DEFAULT_MAX_CHARS = 50000;

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ');
}

function sliceWithCursor(items, cursor, startIndex, endIndex, maxChars) {
  let index = cursor != null && cursor !== '' ? clampInt(cursor, startIndex, startIndex, endIndex) : startIndex;
  const selected = [];
  let chars = 0;
  let truncated = false;
  for (; index <= endIndex; index++) {
    const text = items[index - 1]?.text ?? '';
    const addition = selected.length ? `\n\n${text}` : text;
    if (chars + addition.length > maxChars) {
      const remaining = Math.max(maxChars - chars, 0);
      if (remaining > 0) selected.push(addition.slice(0, remaining));
      truncated = true;
      break;
    }
    selected.push(addition);
    chars += addition.length;
  }
  return {
    text: selected.join(''),
    truncated,
    nextCursor: truncated ? String(index) : null,
  };
}

function extractDocx(fullPath) {
  const warnings = [];
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(fullPath);
  const entry = zip.getEntry('word/document.xml')
    || zip.getEntry('word\\document.xml')
    || zip.getEntries().find(e => String(e.entryName || '').replace(/\\/g, '/').toLowerCase() === 'word/document.xml');
  if (!entry) return { items: [], warnings: ['DOCX has no word/document.xml entry.'], method: 'docx-xml' };
  let xml = entry.getData().toString('utf8');
  xml = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n');
  const paragraphs = [];
  const pRegex = /<w:p[\s\S]*?<\/w:p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const texts = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(match[0])) !== null) texts.push(decodeXmlEntities(tMatch[1]));
    const text = texts.join('').trim();
    if (text) paragraphs.push({ index: paragraphs.length + 1, text });
  }
  if (paragraphs.length === 0) warnings.push('No non-empty DOCX paragraphs found.');
  return { items: paragraphs, warnings, method: 'docx-xml' };
}

function extractPptx(fullPath) {
  const warnings = [];
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(fullPath);
  const entries = zip.getEntries()
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => {
      const an = Number((a.entryName.match(/slide(\d+)/i) || [])[1] || 0);
      const bn = Number((b.entryName.match(/slide(\d+)/i) || [])[1] || 0);
      return an - bn;
    });
  const slides = entries.map((entry, i) => {
    const xml = entry.getData().toString('utf8');
    const texts = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = re.exec(xml)) !== null) {
      const t = decodeXmlEntities(match[1]).trim();
      if (t) texts.push(t);
    }
    return { index: i + 1, text: texts.join('\n') };
  });
  if (slides.length === 0) warnings.push('No PPTX slide XML entries found.');
  if (slides.length > 0 && slides.every(s => !s.text)) warnings.push('No text box content found in PPTX slides.');
  return { items: slides, warnings, method: 'pptx-xml' };
}

function extractHtml(fullPath) {
  const buf = fs.readFileSync(fullPath);
  const decoded = decodeTextBuffer(buf, 'auto');
  let html = decoded.text;
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<\/(div|p|h[1-6]|li|tr|section|article|header|footer|main|aside|nav)>/gi, '\n');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  const text = decodeXmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const parts = text ? text.split(/\n{2,}|\n/).map((t, i) => ({ index: i + 1, text: t.trim() })).filter(p => p.text) : [];
  return { items: parts, warnings: [], method: 'html-strip', encoding: decoded.encoding };
}

function extractPdf(fullPath) {
  const buf = fs.readFileSync(fullPath);
  const raw = buf.toString('latin1');
  const pageCount = Math.max((raw.match(/\/Type\s*\/Page\b/g) || []).length, 0);
  const chunks = [];
  const warnings = [];
  const streamRegex = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let streamMatch;
  let chunkIndex = 1;
  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const stream = streamMatch[1];
    const textBits = [];
    const parenRegex = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
    let m;
    while ((m = parenRegex.exec(stream)) !== null) {
      textBits.push(m[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r'));
    }
    const arrayRegex = /\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*\.?\d*)+)\]\s*TJ/g;
    let a;
    while ((a = arrayRegex.exec(stream)) !== null) {
      const inner = a[1];
      const parts = [];
      const innerRegex = /\((?:\\.|[^\\)])*\)/g;
      let im;
      while ((im = innerRegex.exec(inner)) !== null) {
        parts.push(im[0].slice(1, -1).replace(/\\([()\\])/g, '$1'));
      }
      if (parts.length) textBits.push(parts.join(''));
    }
    const text = textBits.join(' ').replace(/\s+/g, ' ').trim();
    if (text) chunks.push({ index: chunkIndex++, text });
  }
  if (chunks.length === 0) warnings.push('No extractable text layer found. PDF may be scanned/image-only; OCR is not performed.');
  return { items: chunks, warnings, method: 'pdf-text-operators', pageCount };
}

function extractPlainText(fullPath) {
  const buf = fs.readFileSync(fullPath);
  const decoded = decodeTextBuffer(buf, 'auto');
  const items = decoded.text.split(/\r?\n/).map((text, i) => ({ index: i + 1, text }));
  return { items, warnings: [], method: 'text-decoder', encoding: decoded.encoding };
}

export async function extractTextFromDocument(fullPath, options = {}) {
  const resolvedPath = path.resolve(fullPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const stat = fs.statSync(resolvedPath);
  const maxChars = clampInt(options.maxChars, DEFAULT_MAX_CHARS, 1, 500000);
  const warnings = [];
  let extracted = { items: [], warnings: [], method: 'unsupported' };
  let fileType = ext.replace(/^\./, '') || 'unknown';
  let encoding = null;

  try {
    if (ext === '.docx') extracted = extractDocx(resolvedPath);
    else if (ext === '.pptx') extracted = extractPptx(resolvedPath);
    else if (ext === '.html' || ext === '.htm') extracted = extractHtml(resolvedPath);
    else if (ext === '.pdf') extracted = extractPdf(resolvedPath);
    else if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.log' || ext === '.xml' || ext === '.yml' || ext === '.yaml' || ext === '.ini' || ext === '.cfg') extracted = extractPlainText(resolvedPath);
    else if (ext === '.rtf') extracted = { items: [], warnings: ['RTF extraction is not supported yet.'], method: 'unsupported' };
    else extracted = { items: [], warnings: [`Text extraction is not supported for ${ext || 'this file type'}.`], method: 'unsupported' };
  } catch (e) {
    extracted = { items: [], warnings: [`Extraction failed: ${e.message}`], method: extracted.method || 'error' };
  }

  warnings.push(...(extracted.warnings || []));
  encoding = extracted.encoding || null;
  const items = extracted.items || [];
  const pageCount = ext === '.pdf' ? (extracted.pageCount || 0) : ext === '.pptx' ? items.length : null;
  const paragraphCount = ext === '.docx' || ext === '.html' || ext === '.htm' || ext === '.txt' || ext === '.md' ? items.length : null;

  let startIndex = 1;
  let endIndex = items.length;
  if (ext === '.pdf' || ext === '.pptx') {
    startIndex = clampInt(options.startPage, 1, 1, Math.max(items.length, 1));
    endIndex = clampInt(options.endPage, items.length || 1, startIndex, Math.max(items.length, startIndex));
  } else {
    startIndex = clampInt(options.startParagraph, 1, 1, Math.max(items.length, 1));
    endIndex = clampInt(options.endParagraph, items.length || 1, startIndex, Math.max(items.length, startIndex));
  }

  const sliced = sliceWithCursor(items, options.cursor, startIndex, endIndex, maxChars);
  return {
    path: options.path || fullPath,
    resolvedPath,
    fileType,
    size: stat.size,
    pageCount,
    paragraphCount,
    text: sliced.text,
    truncated: sliced.truncated,
    nextCursor: sliced.nextCursor,
    warnings,
    extractMethod: extracted.method,
    encoding,
  };
}
