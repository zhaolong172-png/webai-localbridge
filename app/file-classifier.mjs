/**
 * file-classifier.mjs — Shared file classification module
 * ========================================================
 * Used by both 33005 (ai-api-server.mjs) and 33003 (mcp-tunnel-server.js)
 * for consistent MIME types, file type classification, and available actions.
 *
 * v1.0.0
 */

import path from 'node:path';

// ── File type categories ─────────────────────────────────────────────────

const TEXT_EXTS = new Set(
  'txt md ini log xml yml yaml toml lock css sql bat cmd ps1 sh'.split(' ')
);

const CODE_EXTS = new Set(
  'js mjs cjs ts mts cts jsx tsx py java c cpp h cs go rs php rb json mdx'.split(' ')
);

const DOCUMENT_EXTS = new Set('pdf doc docx html htm rtf'.split(' '));
const SPREADSHEET_EXTS = new Set('xls xlsx csv tsv'.split(' '));
const PRESENTATION_EXTS = new Set('pptx'.split(' '));

const IMAGE_EXTS = new Set(
  'png jpg jpeg gif webp bmp svg ico tiff tif'.split(' ')
);

const AUDIO_EXTS = new Set(
  'mp3 wav m4a flac ogg aac wma'.split(' ')
);

const VIDEO_EXTS = new Set(
  'mp4 webm mov avi mkv wmv flv mpeg mpg'.split(' ')
);

const ARCHIVE_EXTS = new Set(
  'zip 7z rar tar gz bz2 xz tgz'.split(' ')
);

const EXECUTABLE_EXTS = new Set('exe dll msi'.split(' '));

// ── MIME type map ────────────────────────────────────────────────────────

const MIME_MAP = {
  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ini': 'text/plain',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.yml': 'application/x-yaml',
  '.yaml': 'application/x-yaml',
  '.toml': 'application/toml',
  '.lock': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.sql': 'text/plain',
  '.bat': 'text/plain',
  '.cmd': 'text/plain',
  '.ps1': 'text/plain',
  '.sh': 'text/x-shellscript',

  // Code
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.mts': 'application/typescript',
  '.cts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.php': 'application/x-httpd-php',
  '.rb': 'text/x-ruby',
  '.json': 'application/json',
  '.vue': 'text/plain',
  '.svelte': 'text/plain',
  '.mdx': 'text/markdown',

  // Documents
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',

  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',

  // Archives
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/x-rar-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
  '.tgz': 'application/gzip',

  // Executables/Binaries
  '.exe': 'application/x-msdownload',
  '.dll': 'application/x-msdownload',
  '.msi': 'application/x-msi',
  '.bin': 'application/octet-stream',
  '.iso': 'application/x-iso9660-image',
  '.dat': 'application/octet-stream',
  '.jar': 'application/java-archive',
  '.class': 'application/java-vm',

  // Fonts
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Classify a file by extension.
 *
 * Returns:
 * {
 *   type: string,         // "text"|"code"|"document"|"spreadsheet"|"presentation"|"image"|"audio"|"video"|"archive"|"executable"|"binary"
 *   mime: string,         // MIME type
 *   readableAsText: bool,
 *   extractableText: bool,
 *   previewable: bool,
 *   downloadable: bool,
 *   hashAvailable: bool,
 * }
 */
export function classifyFileExt(ext) {
  const e = (ext || '').toLowerCase();
  const mime = MIME_MAP[e] || 'application/octet-stream';

  let type = 'binary';
  if (TEXT_EXTS.has(e.slice(1))) type = 'text';
  else if (CODE_EXTS.has(e.slice(1))) type = 'code';
  else if (DOCUMENT_EXTS.has(e.slice(1))) type = 'document';
  else if (SPREADSHEET_EXTS.has(e.slice(1))) type = 'spreadsheet';
  else if (PRESENTATION_EXTS.has(e.slice(1))) type = 'presentation';
  else if (IMAGE_EXTS.has(e.slice(1))) type = 'image';
  else if (AUDIO_EXTS.has(e.slice(1))) type = 'audio';
  else if (VIDEO_EXTS.has(e.slice(1))) type = 'video';
  else if (ARCHIVE_EXTS.has(e.slice(1))) type = 'archive';
  else if (EXECUTABLE_EXTS.has(e.slice(1))) type = 'executable';

  const readableAsText = type === 'text' || type === 'code';
  const extractableText = type === 'document' || type === 'presentation' || type === 'text' || type === 'code';
  const tablePreviewable = type === 'spreadsheet';
  const archiveReadable = type === 'archive';
  const binary = !readableAsText && !extractableText && !tablePreviewable && !archiveReadable;
  const previewable = type === 'text' || type === 'code' || type === 'image' || type === 'audio' || type === 'video' || type === 'document' || type === 'presentation';
  const downloadable = true;
  const hashAvailable = true;

  return { type, mime, readableAsText, extractableText, tablePreviewable, archiveReadable, binary, previewable, downloadable, hashAvailable };
}

/**
 * Full file classification from file path (no fs access required).
 */
export function classifyFile(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const classification = classifyFileExt(ext);
  return {
    path: filePath,
    name,
    extension: ext || null,
    ...classification,
  };
}

/**
 * Get available actions for a file type.
 */
export function getAvailableActions(type) {
  const actions = ['file-info', 'download'];
  switch (type) {
    case 'text':
    case 'code':
      actions.push('raw', 'preview', 'grep', 'read-lines', 'content-search');
      break;
    case 'document':
    case 'presentation':
      actions.push('extract-text');
      if (type === 'presentation') actions.push('preview');
      break;
    case 'spreadsheet':
      actions.push('table-preview');
      break;
    case 'image':
      actions.push('preview');
      break;
    case 'audio':
    case 'video':
      actions.push('media-info');
      if (type === 'video' || type === 'audio') actions.push('preview');
      break;
    case 'archive':
      actions.push('archive-list', 'archive-read');
      break;
    case 'executable':
      actions.push('pe-info', 'binary-info');
      break;
    case 'binary':
      actions.push('binary-info');
      break;
  }
  return actions;
}

/**
 * Build recommendedAction for a file by type.
 * Returns { label, endpoint, reason } object.
 * @param {string} relative - The relative path
 * @param {object} classification - From classifyFileExt or { type: 'directory' }
 * @param {number} [fileSize=0] - Optional file size in bytes, used to recommend read-lines for large files
 */
export function getRecommendedAction(relative, classification, fileSize = 0) {
  const enc = encodeURIComponent(relative);
  const LARGE_FILE_THRESHOLD = 100 * 1024; // 100KB
  const rules = {
    text:       { label: 'Read as text',        endpoint: `/raw?path=${enc}`,          reason: 'File is classified as text and readableAsText=true' },
    code:       { label: 'Read as code',         endpoint: `/raw?path=${enc}`,          reason: 'File is classified as code and readableAsText=true' },
    document:   { label: 'Extract text',         endpoint: `/extract-text?path=${enc}`, reason: 'File is classified as document with extractable text' },
    presentation:{ label: 'Extract text',        endpoint: `/extract-text?path=${enc}`, reason: 'File is classified as presentation with extractable text' },
    spreadsheet:{ label: 'Preview table',        endpoint: `/table-preview?path=${enc}`,
                                                                                         reason: 'File is classified as spreadsheet' },
    image:      { label: 'Preview image',        endpoint: `/preview?path=${enc}`,      reason: 'File is classified as image' },
    audio:      { label: 'Media info',           endpoint: `/media-info?path=${enc}`,   reason: 'File is classified as audio' },
    video:      { label: 'Media info',           endpoint: `/media-info?path=${enc}`,   reason: 'File is classified as video' },
    archive:    { label: 'List archive contents', endpoint: `/archive-list?path=${enc}`,
                                                                                         reason: 'File is classified as archive' },
    executable: { label: 'PE info',              endpoint: `/pe-info?path=${enc}`,      reason: 'File is classified as executable (PE)' },
    binary:     { label: 'Binary info',          endpoint: `/binary-info?path=${enc}`,  reason: 'File is classified as binary' },
    directory:  { label: 'List directory',       endpoint: `/list?path=${enc}`,         reason: 'Entry is a directory' },
  };
  const rule = rules[classification.type];
  if (!rule) return { label: 'File info', endpoint: `/file-info?path=${enc}`, reason: 'File type classification fallback' };

  // For text/code files larger than threshold, recommend read-lines instead of raw
  if ((classification.type === 'text' || classification.type === 'code') && fileSize > LARGE_FILE_THRESHOLD) {
    return {
      label: 'Read line range',
      endpoint: `/read-lines?path=${enc}&startLine=1&endLine=120`,
      reason: `Large ${classification.type} file (${fileSize > 1024*1024 ? (fileSize/(1024*1024)).toFixed(1)+' MB' : (fileSize/1024).toFixed(0)+' KB'}); structured line reads are better than full raw reads`,
    };
  }

  return rule;
}

export function getRecommendedMcpTool(classification, fileSize = 0) {
  if (!classification) return 'file_info';
  if (classification.type === 'directory') return 'file_list';
  if (classification.tablePreviewable || classification.type === 'spreadsheet') return 'table_preview';
  if (classification.archiveReadable || classification.type === 'archive') return 'archive_read';
  if (classification.type === 'document' || classification.type === 'presentation') return 'file_extract_text';
  if (classification.readableAsText) return fileSize > 1024 * 1024 ? 'file_read_lines' : 'file_read';
  return 'file_info';
}

export function buildFileWarnings(classification, ext = '') {
  const warnings = [];
  if (!classification) return warnings;
  if (classification.type === 'image' || classification.type === 'audio' || classification.type === 'video') {
    warnings.push('Media file: MCP will not dump binary content as text.');
  }
  if (classification.type === 'executable' || classification.type === 'binary') {
    warnings.push('Binary/executable file: use file_info for metadata or explicit base64 only when truly needed.');
  }
  if (classification.type === 'archive' && ext !== '.zip') {
    warnings.push(`${ext || 'Archive'} listing may be unsupported; ZIP is supported.`);
  }
  if (ext === '.doc' || ext === '.xls' || ext === '.ppt') {
    warnings.push(`${ext} legacy Office format is detected but may not be extractable without conversion.`);
  }
  if (ext === '.rtf') {
    warnings.push('RTF extraction is best-effort and may be unsupported for complex files.');
  }
  return warnings;
}

export { MIME_MAP };
