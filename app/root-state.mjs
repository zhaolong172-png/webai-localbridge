import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.join(__dirname, 'mcp-tunnel-config.json');

// Default values
const DEFAULTS = {
  rootDir: 'C:\\Users\\' + os.userInfo().username,
  mcpAdvancedPermission: false,
  secondaryAiBrowserRootDir: '',
  frontendPreviewLocalUrl: '',
  rootBoundaryMode: 'root-only',
  fileFastConfirm: false,
  commandExecution: false,
};

// ── Read helpers (all read from disk each time for cross-process freshness) ──

export function getRootDir() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const val = cfg.rootDir || DEFAULTS.rootDir;
    if (!fs.existsSync(val)) {
      const fallback = 'C:\\Users\\' + os.userInfo().username;
      if (fs.existsSync(fallback)) {
        console.warn(`[root-state] rootDir ${val} does not exist, falling back to ${fallback}`);
        return fallback;
      }
    }
    return val;
  } catch {
    return DEFAULTS.rootDir;
  }
}

export function getMcpAdvancedPermission() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.mcpAdvancedPermission || false;
  } catch {
    return false;
  }
}

export function getSecondaryAiBrowserRootDir() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.secondaryAiBrowserRootDir || '';
  } catch {
    return '';
  }
}

export function getFrontendPreviewLocalUrl() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.frontendPreviewLocalUrl || '';
  } catch {
    return '';
  }
}

export function getRootBoundaryMode() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.rootBoundaryMode || 'root-only';
  } catch {
    return 'root-only';
  }
}

export function getFileFastConfirm() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.fileFastConfirm || false;
  } catch {
    return false;
  }
}

export function getCommandExecution() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.commandExecution || false;
  } catch {
    return false;
  }
}

// ── Write helpers (atomic read-modify-write) ──

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(updates) {
  const cfg = readConfig();
  Object.assign(cfg, updates);
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function writeConfigField(key, value) {
  const cfg = readConfig();
  cfg[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

export function writeRootDir(dir) {
  if (!dir || typeof dir !== 'string') throw new Error('Invalid directory');
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  writeConfig({ rootDir: resolved });
  return resolved;
}

export function writeMcpAdvancedPermission(enabled) {
  writeConfig({ mcpAdvancedPermission: !!enabled });
}

export function writeSecondaryAiBrowserRootDir(dir) {
  if (!dir || typeof dir !== 'string') throw new Error('Invalid directory');
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  writeConfig({ secondaryAiBrowserRootDir: resolved });
  return resolved;
}

export function writeFrontendPreviewLocalUrl(url) {
  writeConfig({ frontendPreviewLocalUrl: url || '' });
}

export function writeRootBoundaryMode(mode) {
  writeConfig({ rootBoundaryMode: mode });
}

export function writeFileFastConfirm(enabled) {
  writeConfig({ fileFastConfirm: !!enabled });
}

export function writeCommandExecution(enabled) {
  writeConfig({ commandExecution: !!enabled });
}

// ── v3.4.3 Fixed Tunnel (base domain + token → auto-derived public URLs) ─────
// Stored as: { baseDomain: string, token: string, enabled: boolean, frontendPreviewFixedEnabled: boolean }
// The public URLs are derived automatically from baseDomain, not stored.
// When enabled=true, derived URLs take priority over trycloudflare temporary URLs.

const DEFAULT_FIXED_TUNNEL = { baseDomain: '', token: '', enabled: false, frontendPreviewFixedEnabled: false };

export function getFixedTunnel() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.fixedTunnel && typeof cfg.fixedTunnel === 'object') {
      return { ...DEFAULT_FIXED_TUNNEL, ...cfg.fixedTunnel };
    }
    return { ...DEFAULT_FIXED_TUNNEL };
  } catch {
    return { ...DEFAULT_FIXED_TUNNEL };
  }
}

// Keep reading old fixedPublicUrls for migration / backward compat
const DEFAULT_FIXED_PUBLIC_URLS = { mcp: '', aiBrowser: '', secondaryAiBrowser: '', frontendPreview: '' };

export function getFixedPublicUrls() {
  // With new fixedTunnel system, derive URLs from baseDomain if enabled AND token present
  const ft = getFixedTunnel();
  if (ft.enabled && ft.baseDomain && ft.token) {
    return deriveFixedUrls(ft.baseDomain, ft.frontendPreviewFixedEnabled);
  }
  // Fall back to legacy fixedPublicUrls
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.fixedPublicUrls && typeof cfg.fixedPublicUrls === 'object') {
      return { ...DEFAULT_FIXED_PUBLIC_URLS, ...cfg.fixedPublicUrls };
    }
    return { ...DEFAULT_FIXED_PUBLIC_URLS };
  } catch {
    return { ...DEFAULT_FIXED_PUBLIC_URLS };
  }
}

/**
 * Derive fixed public URLs from a base domain.
 * @param {string} baseDomain - e.g. "example.com"
 * @param {boolean} includeFrontend - whether to derive frontendPreview URL
 */
export function deriveFixedUrls(baseDomain, includeFrontend = false) {
  const d = String(baseDomain || '').trim();
  if (!d) return { mcp: '', aiBrowser: '', secondaryAiBrowser: '', frontendPreview: '' };
  return {
    mcp: `https://mcp.${d}/mcp`,
    aiBrowser: `https://files.${d}`,
    secondaryAiBrowser: `https://files2.${d}`,
    frontendPreview: includeFrontend ? `https://preview.${d}` : '',
  };
}

/**
 * Validate a base domain (NOT a full URL).
 * Accepts: example.com, example.com, my-domain.pp.ua
 * Rejects: https://example.com, http://example.com, mcp.example.com, example.com/path, localhost, 127.0.0.1, [::1]
 */
export function validateBaseDomain(value) {
  const v = String(value || '').trim();
  if (!v) return { ok: true, value: '' }; // empty = no fixed domain
  // Reject protocol
  if (/^https?:\/\//i.test(v)) return { ok: false, error: 'Do not include https:// or http:// — enter the bare domain only' };
  // Reject subdomains that look like our derived prefixes
  const knownPrefixes = ['mcp.', 'files.', 'files2.', 'preview.', 'panel.'];
  for (const prefix of knownPrefixes) {
    if (v.toLowerCase().startsWith(prefix)) {
      return { ok: false, error: `Do not include the "${prefix.slice(0, -1)}" subdomain — the system derives it automatically` };
    }
  }
  // Reject paths
  if (v.includes('/')) return { ok: false, error: 'Domain should not contain a path' };
  // Reject localhost / loopback / private IPs
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|::)$/i.test(v)) {
    return { ok: false, error: 'localhost / loopback not allowed' };
  }
  // Reject pure IP addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return { ok: false, error: 'IP addresses are not allowed — use a domain name' };
  }
  // Basic domain validation: at least one dot, valid chars
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(v)) {
    return { ok: false, error: 'Invalid domain format' };
  }
  if (v.split('.').length < 2) return { ok: false, error: 'Domain must include at least one dot (e.g. example.com)' };
  return { ok: true, value: v.toLowerCase() };
}

export function writeFixedTunnel(settings) {
  const current = getFixedTunnel();
  const next = { ...current };

  // baseDomain
  if (typeof settings.baseDomain === 'string') {
    if (settings.baseDomain.trim() === '') {
      next.baseDomain = '';
    } else {
      const v = validateBaseDomain(settings.baseDomain);
      if (!v.ok) throw new Error(`Invalid base domain: ${v.error}`);
      next.baseDomain = v.value;
    }
  }

  // token: save whatever is passed (empty string = delete token)
  if ('token' in settings && typeof settings.token === 'string') {
    next.token = settings.token.trim();
  }

  // enabled
  if (typeof settings.enabled === 'boolean') {
    next.enabled = settings.enabled;
  }

  // frontendPreviewFixedEnabled
  if (typeof settings.frontendPreviewFixedEnabled === 'boolean') {
    next.frontendPreviewFixedEnabled = settings.frontendPreviewFixedEnabled;
  }

  // ── v3.5.0 Normalization ──────────────────────────────────────
  // Rule 1: enabled=false → force frontendPreviewFixedEnabled=false
  if (!next.enabled) {
    next.frontendPreviewFixedEnabled = false;
  }
  // Rule 2: enabled=true but baseDomain or token empty → force enabled=false
  if (next.enabled && (!next.baseDomain || !next.token)) {
    next.enabled = false;
    next.frontendPreviewFixedEnabled = false;
  }

  writeConfigField('fixedTunnel', next);
  return getFixedTunnel();
}

/**
 * Returns true only when all Fixed Core Tunnel prerequisites are met.
 * Requires: enabled=true AND baseDomain non-empty AND token non-empty.
 */
export function isFixedCoreUsable(ft) {
  return !!(ft && ft.enabled && ft.baseDomain && ft.token);
}

/**
 * Returns true only when Frontend Preview should use the fixed domain.
 * Requires: fixed core usable AND frontendPreviewFixedEnabled=true.
 */
export function isFixedPreviewUsable(ft) {
  return !!(isFixedCoreUsable(ft) && ft.frontendPreviewFixedEnabled);
}

// Legacy: kept for backward compat but no longer used by the main flow
export function validateFixedUrl(value) {
  const v = String(value || '').trim();
  if (!v) return { ok: true, value: '' };
  let parsed;
  try { parsed = new URL(v); } catch { return { ok: false, error: 'Invalid URL format' }; }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Must use https:// or be empty' };
  if (!parsed.hostname) return { ok: false, error: 'Missing hostname' };
  const host = parsed.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return { ok: false, error: 'localhost / loopback not allowed' };
  }
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return { ok: false, error: 'Private IP not allowed' };
  }
  const port = parsed.port;
  if (port === '33004' || port === '8081') {
    return { ok: false, error: `Port ${port} is not allowed for public exposure` };
  }
  return { ok: true, value: v };
}

export function writeFixedPublicUrls(urls) {
  const fixed = { ...DEFAULT_FIXED_PUBLIC_URLS };
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.fixedPublicUrls && typeof cfg.fixedPublicUrls === 'object') {
      Object.assign(fixed, cfg.fixedPublicUrls);
    }
  } catch {}
  for (const key of ['mcp', 'aiBrowser', 'secondaryAiBrowser', 'frontendPreview']) {
    if (typeof urls[key] === 'string') {
      fixed[key] = urls[key].trim();
    }
  }
  writeConfigField('fixedPublicUrls', fixed);
  return fixed;
}

// ── Path Resolution (security) ──

const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:\\/;
const WINDOWS_UNC_RE = /^\\\\/;
const POSIX_RE = /^\//;

export function isAbsolute(p) {
  return WINDOWS_ABSOLUTE_RE.test(p) || WINDOWS_UNC_RE.test(p) || POSIX_RE.test(p);
}

export function resolveInsideRoot(relOrAbs, rootOverride = null) {
  const root = rootOverride ? path.resolve(String(rootOverride)) : getRootDir();
  if (!root) throw new Error('rootDir is not set');
  if (!relOrAbs || relOrAbs === '/') return { fullPath: root, relative: '' };
  if (isAbsolute(relOrAbs)) {
    const abs = path.resolve(relOrAbs);
    const normalizedRoot = path.resolve(root);
    if (!abs.startsWith(normalizedRoot) && abs !== normalizedRoot) {
      if (isCrossRootAllowed()) {
        return { fullPath: abs, relative: path.relative(root, abs) };
      }
      throw new Error(`Path outside root (cross-root disabled): ${relOrAbs}`);
    }
    return { fullPath: abs, relative: path.relative(root, abs) };
  }
  const abs = path.resolve(root, relOrAbs);
  const normalizedRoot = path.resolve(root);
  if (!abs.startsWith(normalizedRoot) && abs !== normalizedRoot) {
    if (isCrossRootAllowed()) {
      return { fullPath: abs, relative: path.relative(root, abs) };
    }
    throw new Error(`Path outside root (cross-root disabled): ${relOrAbs}`);
  }
  return { fullPath: abs, relative: path.relative(root, abs) };
}

export function isCrossRootAllowed() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg.rootBoundaryMode === 'cross-root';
  } catch {
    return false;
  }
}

// ── Skill Folder (v3.4.8) ───────────────────────────────────────────────────

export const DEFAULT_SKILL_FOLDER = '.agents/skills';

export function getSkillFolderRecord() {
  const cfg = readConfig();
  const skill = cfg.skill && typeof cfg.skill === 'object' ? cfg.skill : {};
  return {
    folder: typeof skill.folder === 'string' && skill.folder.trim() ? skill.folder.trim() : DEFAULT_SKILL_FOLDER,
    resolvedFolder: typeof skill.resolvedFolder === 'string' ? skill.resolvedFolder.trim() : '',
    mode: skill.mode === 'custom' ? 'custom' : 'default',
    updatedAt: typeof skill.updatedAt === 'string' ? skill.updatedAt : '',
  };
}

export function isDefaultSkillFolderConfig(value, serverRoot = __dirname) {
  const raw = String(value || '').trim();
  if (!raw) return true;

  // Fast path: literal '.agents/skills'
  const normalized = raw.replace(/\\/g, '/');
  if (normalized === DEFAULT_SKILL_FOLDER) return true;

  // Slow path: compare resolved absolute paths (case-insensitive on Windows)
  const resolvedInput = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(serverRoot, raw);
  const resolvedDefault = path.resolve(serverRoot, DEFAULT_SKILL_FOLDER);

  return resolvedInput.toLowerCase() === resolvedDefault.toLowerCase();
}

export function resolveSkillFolderForSave(inputFolder, serverRoot = __dirname) {
  const raw = String(inputFolder || '').trim();
  if (!raw) throw new Error('Invalid folder');

  const resolvedFolder = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(serverRoot, raw);

  return { folder: raw, resolvedFolder };
}

// For control-panel/config migration only. Do not use in MCP skill runtime.
export function resolveSkillFolderPath(serverRoot = __dirname) {
  const configValue = getSkillFolderConfig();
  if (path.isAbsolute(configValue)) {
    return path.resolve(configValue);
  }
  return path.resolve(serverRoot, configValue);
}

export function getSkillFolderConfig() {
  return getSkillFolderRecord().folder;
}

export function getSkillFolderRuntimeConfig() {
  const record = getSkillFolderRecord();
  const resolvedFolder = record.resolvedFolder;

  if (!resolvedFolder || !path.isAbsolute(resolvedFolder)) {
    throw new Error('Invalid Skill Folder config: skill.resolvedFolder must be an absolute path. Open Control Panel Settings and apply/reset Skill Folder.');
  }

  return {
    folder: record.folder,
    resolvedFolder: path.resolve(resolvedFolder),
    mode: record.mode,
    isDefault: record.mode === 'default',
  };
}

export function parseSkillFrontmatter(content, fallbackName) {
  let name = fallbackName;
  let description = '';
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const fm = match[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }
  return { name, description };
}

export function scanSkills(resolvedFolder) {
  const result = { skills: [], errors: [], exists: false, count: 0 };
  if (!fs.existsSync(resolvedFolder)) {
    return result;
  }
  result.exists = true;
  let stat;
  try {
    stat = fs.statSync(resolvedFolder);
  } catch (e) {
    result.errors.push(e.message);
    return result;
  }
  if (!stat.isDirectory()) {
    result.errors.push('Skill folder is not a directory');
    return result;
  }

  let entries;
  try {
    entries = fs.readdirSync(resolvedFolder, { withFileTypes: true });
  } catch (e) {
    result.errors.push(e.message);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(resolvedFolder, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    try {
      const content = fs.readFileSync(skillMd, 'utf8');
      const { name, description } = parseSkillFrontmatter(content, entry.name);
      result.skills.push({ name, description, path: skillMd });
    } catch (e) {
      result.errors.push(`${entry.name}: ${e.message}`);
    }
  }

  result.skills.sort((a, b) => a.name.localeCompare(b.name));
  result.count = result.skills.length;
  return result;
}

export function readSkillByName(resolvedFolder, skillName) {
  const scan = scanSkills(resolvedFolder);
  const match = scan.skills.find((s) => s.name === skillName);
  if (!match) {
    return {
      ok: false,
      error: `Skill not found: ${skillName}`,
      available: scan.skills.map((s) => s.name),
    };
  }
  const content = fs.readFileSync(match.path, 'utf8');
  const skillFile = path.resolve(match.path);
  const skillDir = path.dirname(skillFile);
  return {
    ok: true,
    name: match.name,
    description: match.description,
    path: skillFile,
    skillDir,
    skillFile,
    content,
  };
}

export function ensureSkillFolderConfigResolved(serverRoot = __dirname) {
  const cfg = readConfig();
  const skill = cfg.skill && typeof cfg.skill === 'object' ? cfg.skill : null;
  const hasResolved = skill
    && typeof skill.resolvedFolder === 'string'
    && path.isAbsolute(skill.resolvedFolder.trim());

  if (hasResolved) {
    return {
      folder: typeof skill.folder === 'string' && skill.folder.trim() ? skill.folder.trim() : DEFAULT_SKILL_FOLDER,
      resolvedFolder: path.resolve(skill.resolvedFolder.trim()),
      mode: skill.mode === 'custom' ? 'custom' : 'default',
      updatedAt: typeof skill.updatedAt === 'string' ? skill.updatedAt : '',
    };
  }

  const legacyFolder = skill && typeof skill.folder === 'string' && skill.folder.trim()
    ? skill.folder.trim()
    : DEFAULT_SKILL_FOLDER;
  const mode = legacyFolder.replace(/\\/g, '/') === DEFAULT_SKILL_FOLDER ? 'default' : 'custom';
  const { resolvedFolder } = resolveSkillFolderForSave(legacyFolder, serverRoot);

  cfg.skill = {
    folder: mode === 'default' ? DEFAULT_SKILL_FOLDER : legacyFolder,
    resolvedFolder,
    mode,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg.skill;
}

export function getSkillFolderStatus(serverRoot = __dirname) {
  const record = ensureSkillFolderConfigResolved(serverRoot);
  const scan = scanSkills(record.resolvedFolder);
  return {
    folder: record.folder,
    resolvedFolder: record.resolvedFolder,
    mode: record.mode,
    exists: scan.exists,
    count: scan.count,
    isDefault: record.mode === 'default',
  };
}

export function writeSkillFolder(folder, options = {}) {
  const mode = options.mode === 'default' ? 'default' : 'custom';
  const serverRoot = options.serverRoot || __dirname;
  const raw = String(folder || '').trim();
  if (!raw) throw new Error('Invalid folder');

  const { resolvedFolder } = resolveSkillFolderForSave(raw, serverRoot);
  if (!fs.existsSync(resolvedFolder) || !fs.statSync(resolvedFolder).isDirectory()) {
    throw new Error(`Directory does not exist: ${resolvedFolder}`);
  }

  const cfg = readConfig();
  cfg.skill = {
    folder: mode === 'default' ? DEFAULT_SKILL_FOLDER : raw,
    resolvedFolder,
    mode,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg.skill;
}

export function resetSkillFolder(serverRoot = __dirname) {
  return writeSkillFolder(DEFAULT_SKILL_FOLDER, { mode: 'default', serverRoot });
}

// ── Legacy aliases ──

export function normalizeDirPath(dir) {
  if (!dir) return '';
  return path.resolve(dir);
}

export function isDirWritable(p) {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

