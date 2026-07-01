/**
 * WebAI LocalBridge Control Panel v3.4.8 (MCP Absolute Path Ergonomics)
 * ================================
 * Three services:
 *   1. AI File Browser  (port 33005) — read-only file listing for AI/human
 *   2. MCP Server       (port 33003) — MCP protocol for AI with file tools
 *   3. Control Panel    (port 33004) — this UI, local only
 *
 * Legacy 8081 FileBrowser is retired and intentionally unsupported.
 *
 * Dashboard: http://127.0.0.1:33004
 */

import express from "express";
import { spawn, execSync, execFileSync } from "child_process";
import { createConnection } from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getRootDir, writeRootDir, getMcpAdvancedPermission, writeMcpAdvancedPermission, getSecondaryAiBrowserRootDir, writeSecondaryAiBrowserRootDir, getFrontendPreviewLocalUrl, writeFrontendPreviewLocalUrl, getRootBoundaryMode, writeRootBoundaryMode, getFileFastConfirm, writeFileFastConfirm, getCommandExecution, writeCommandExecution, getFixedPublicUrls, writeFixedPublicUrls, validateFixedUrl, getFixedTunnel, writeFixedTunnel, validateBaseDomain, deriveFixedUrls, isFixedCoreUsable, isFixedPreviewUsable, getSkillFolderStatus, writeSkillFolder, resetSkillFolder } from "./root-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PORT = 33004;
const AI_API_PORT = 33005;
const SECONDARY_AI_API_PORT = 33006;
const MCP_PORT = 33003;

const RUNTIME_NODE = path.join(__dirname, "runtime", "node", "node.exe");

function resolveNodeExecutable() {
  try {
    if (fs.existsSync(RUNTIME_NODE)) return RUNTIME_NODE;
  } catch {}
  if (process.execPath && /node(?:\.exe)?$/i.test(process.execPath)) {
    return process.execPath;
  }
  return "node";
}

const NODE = resolveNodeExecutable();
const CLOUDFLARED = path.join(__dirname, "cloudflared.exe");
const AI_API_SERVER = path.join(__dirname, "ai-api-server.mjs");

// ── Helpers ───────────────────────────────────────────────────────────────────

// isFixedCoreUsable / isFixedPreviewUsable imported from root-state.mjs

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  rootDir: getRootDir(),
  mcpAdvancedPermission: getMcpAdvancedPermission(),
  rootBoundaryMode: getRootBoundaryMode(),
  fileFastConfirm: getFileFastConfirm(),
  commandExecution: getCommandExecution(),
  // AI File Browser (33005)
  aiProc: null,
  aiStatus: "stopped",   // stopped | starting | running | error
  aiTunnelProc: null,
  aiTunnelStatus: "stopped",
  aiTunnelUrl: "",
  // Secondary AI File Browser (33006)
  secondaryAiProc: null,
  secondaryAiStatus: "stopped",
  secondaryAiTunnelProc: null,
  secondaryAiTunnelStatus: "stopped",
  secondaryAiTunnelUrl: "",
  secondaryAiRootDir: getSecondaryAiBrowserRootDir() || "",
  // MCP Server (33003)
  mcpProc: null,
  mcpStatus: "stopped",
  mcpTunnelProc: null,
  mcpTunnelStatus: "stopped",
  mcpTunnelUrl: "",
  // Frontend Preview Tunnel
  frontendPreviewLocalUrl: getFrontendPreviewLocalUrl() || "",
  frontendPreviewStatus: "stopped",   // stopped | starting | running | error
  frontendPreviewTunnelProc: null,
  frontendPreviewTunnelStatus: "stopped",
  // Fixed Public URLs (v3.4.3)
  fixedPublicUrls: getFixedPublicUrls(),
  // Fixed Tunnel (v3.4.3 base-domain mode)
  fixedTunnelProc: null,
  fixedTunnelStatus: "stopped",   // stopped | starting | running | error
  fixedTunnelStartedAt: null,
  fixedTunnelLastOutputAt: null,
  fixedTunnelLogTail: [],
  // v3.5.6: Startup recovery notice
  fixedTunnelStartupRecoveryNotice: null,
  frontendPreviewTunnelUrl: "",
  // Logs
  logs: [],
};

function addLog(msg, type = "info") {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  state.logs.push(entry);
  if (state.logs.length > 300) state.logs.shift();
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function killProcessOnPort(port) {
  try {
    const psScript = `
      Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess |
        ForEach-Object {
          Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
    `;

    execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-Command", psScript,
    ], {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { /* ignore */ }
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(2000);
    socket.on("connect", () => { socket.end(); resolve(true); });
    socket.on("error", () => { resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

// ── Cloudflare Tunnel ─────────────────────────────────────────────────────────

function startTunnel(label, localPort, tunnelVar, statusVar, urlVar) {
  if (state[tunnelVar]) {
    addLog(`${label} Tunnel already running`);
    return;
  }
  if (!fs.existsSync(CLOUDFLARED)) {
    addLog(`cloudflared not found, skipping ${label} Tunnel`, "warn");
    return;
  }

  addLog(`Starting ${label} Tunnel → port ${localPort}...`);
  const proc = spawn(CLOUDFLARED, [
    "tunnel", "--url", `http://127.0.0.1:${localPort}`,
    "--no-autoupdate",
  ], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  state[tunnelVar] = proc;
  state[statusVar] = "starting";
  let buf = "";

  function handleOutput(data) {
    const msg = data.toString();
    buf += msg;
    const match = buf.match(/(https?:\/\/[\w-]+\.trycloudflare\.com)/);
    if (match) {
      state[urlVar] = match[1];
      state[statusVar] = "running";
      addLog(`${label} Tunnel ready: ${match[1]} ✓`);
      buf = "";
    }
    for (const line of msg.split("\n").filter(l => l.trim())) {
      addLog(`[${label}Tunnel] ${line.trim()}`);
    }
  }

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);

  proc.on("close", (code) => {
    addLog(`${label} Tunnel closed (code: ${code})`);
    state[tunnelVar] = null;
    state[statusVar] = "stopped";
    state[urlVar] = "";
  });
}

function stopTunnel(label, tunnelVar, statusVar, urlVar) {
  if (state[tunnelVar]) {
    state[tunnelVar].kill("SIGTERM");
    state[tunnelVar] = null;
    addLog(`${label} Tunnel stopped`);
  }
  state[statusVar] = "stopped";
  state[urlVar] = "";
}

// ── AI File Browser (33005) ────────────────────────────────────────────────────

async function startAiBrowserLocal() {
  if (state.aiProc) { addLog("AI Browser already running"); return; }
  killProcessOnPort(AI_API_PORT);
  addLog("Starting AI File Browser...");
  const proc = spawn(NODE, [AI_API_SERVER], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  state.aiProc = proc;
  state.aiStatus = "starting";
  proc.stdout.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[AI] ${m}`); });
  proc.stderr.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[AI] ${m}`); });
  proc.on("close", (code) => {
    addLog(`AI File Browser exited (code: ${code})`);
    state.aiProc = null;
    state.aiStatus = "stopped";
  });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isPortListening(AI_API_PORT)) {
      state.aiStatus = "running";
      addLog("AI File Browser running on port 33005 ✓");
      return;
    }
  }
  state.aiStatus = "error";
  addLog("AI File Browser startup timed out", "error");
}

async function stopAiBrowserLocal() {
  stopTunnel("AI Browser", "aiTunnelProc", "aiTunnelStatus", "aiTunnelUrl");
  if (state.aiProc) {
    state.aiProc.kill("SIGTERM");
    state.aiProc = null;
  }
  killProcessOnPort(AI_API_PORT);
  // Wait for port to free
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (!await isPortListening(AI_API_PORT)) break;
  }
  state.aiStatus = "stopped";
  addLog("AI File Browser stopped");
}

// Aggregated: start local + tunnel
async function startAiBrowser() {
  await startAiBrowserLocal();
  if (state.aiStatus === "running") {
    startTunnel("AI Browser", AI_API_PORT, "aiTunnelProc", "aiTunnelStatus", "aiTunnelUrl");
  }
}

async function stopAiBrowser() {
  await stopAiBrowserLocal();
}

// ── Secondary AI File Browser (33006) ──────────────────────────────────────────

async function startSecondaryAiBrowserLocal() {
  if (state.secondaryAiProc) { addLog("Secondary AI Browser already running"); return; }
  if (!state.secondaryAiRootDir) {
    addLog("Secondary AI Browser: no root dir set", "error");
    state.secondaryAiStatus = "error";
    return;
  }
  killProcessOnPort(SECONDARY_AI_API_PORT);
  addLog("Starting Secondary AI File Browser...");
  const proc = spawn(NODE, [AI_API_SERVER], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PORT: String(SECONDARY_AI_API_PORT), AI_BROWSER_ROOT_DIR: state.secondaryAiRootDir },
  });
  state.secondaryAiProc = proc;
  state.secondaryAiStatus = "starting";
  proc.stdout.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[SecondaryAI] ${m}`); });
  proc.stderr.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[SecondaryAI] ${m}`); });
  proc.on("close", (code) => {
    addLog(`Secondary AI File Browser exited (code: ${code})`);
    state.secondaryAiProc = null;
    state.secondaryAiStatus = "stopped";
  });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isPortListening(SECONDARY_AI_API_PORT)) {
      state.secondaryAiStatus = "running";
      addLog("Secondary AI File Browser running on port 33006 ✓");
      return;
    }
  }
  state.secondaryAiStatus = "error";
  addLog("Secondary AI File Browser startup timed out", "error");
}

async function stopSecondaryAiBrowserLocal() {
  stopTunnel("Secondary AI Browser", "secondaryAiTunnelProc", "secondaryAiTunnelStatus", "secondaryAiTunnelUrl");
  if (state.secondaryAiProc) {
    state.secondaryAiProc.kill("SIGTERM");
    state.secondaryAiProc = null;
  }
  killProcessOnPort(SECONDARY_AI_API_PORT);
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (!await isPortListening(SECONDARY_AI_API_PORT)) break;
  }
  state.secondaryAiStatus = "stopped";
  addLog("Secondary AI File Browser stopped");
}

async function startSecondaryAiBrowser() {
  await startSecondaryAiBrowserLocal();
  if (state.secondaryAiStatus === "running") {
    startTunnel("Secondary AI Browser", SECONDARY_AI_API_PORT, "secondaryAiTunnelProc", "secondaryAiTunnelStatus", "secondaryAiTunnelUrl");
  }
}

async function stopSecondaryAiBrowser() {
  await stopSecondaryAiBrowserLocal();
}

// ── MCP Server (33003) ─────────────────────────────────────────────────────────

async function startMcpLocal() {
  if (state.mcpProc) { addLog("MCP Server already running"); return; }
  killProcessOnPort(MCP_PORT);
  addLog("Starting MCP Server...");
  const proc = spawn(NODE, [path.join(__dirname, "mcp-tunnel-server.js")], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      MCP_TUNNEL_PORT: String(MCP_PORT),
    },
  });
  state.mcpProc = proc;
  state.mcpStatus = "starting";
  proc.stdout.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[MCP] ${m}`); });
  proc.stderr.on("data", d => { const m = d.toString().trim(); if (m) addLog(`[MCP] ${m}`); });
  proc.on("close", (code) => {
    addLog(`MCP Server exited (code: ${code})`);
    state.mcpProc = null;
    state.mcpStatus = "stopped";
  });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isPortListening(MCP_PORT)) {
      state.mcpStatus = "running";
      addLog("MCP Server running on port 33003 ✓");
      return;
    }
  }
  state.mcpStatus = "error";
  addLog("MCP Server startup timed out", "error");
}

async function stopMcpLocal() {
  stopTunnel("MCP", "mcpTunnelProc", "mcpTunnelStatus", "mcpTunnelUrl");
  if (state.mcpProc) {
    state.mcpProc.kill("SIGTERM");
    state.mcpProc = null;
  }
  killProcessOnPort(MCP_PORT);
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (!await isPortListening(MCP_PORT)) break;
  }
  state.mcpStatus = "stopped";
  addLog("MCP Server stopped");
}

// Aggregated: start local + tunnel
async function startMcp() {
  await startMcpLocal();
  if (state.mcpStatus === "running") {
    startTunnel("MCP", MCP_PORT, "mcpTunnelProc", "mcpTunnelStatus", "mcpTunnelUrl");
  }
}

async function stopMcp() {
  await stopMcpLocal();
}

// ── Frontend Preview Tunnel ─────────────────────────────────────────────────

function validateFrontendPreviewUrl(url) {
  if (!url || typeof url !== 'string') return 'URL is required';
  url = url.trim();
  // Only http allowed
  if (!url.startsWith('http://')) return 'Only http:// is allowed';
  // Must have a port
  let parsed;
  try { parsed = new URL(url); } catch { return 'Invalid URL format'; }
  if (!parsed.port) return 'Port is required';
  // Only localhost / 127.0.0.1
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') return 'Only localhost / 127.0.0.1 is allowed';
  // Block 33004 (control panel)
  if (parsed.port === '33004') return 'Cannot expose the 33004 control panel';
  // Block 8081 (legacy)
  if (parsed.port === '8081') return 'Port 8081 is not allowed';
  return null; // valid
}

function startFrontendPreviewTunnel() {
  if (state.frontendPreviewTunnelProc) {
    addLog("Frontend Preview Tunnel already running");
    return;
  }
  if (!state.frontendPreviewLocalUrl) {
    addLog("Frontend Preview: no local URL set", "error");
    state.frontendPreviewStatus = "error";
    return;
  }
  const err = validateFrontendPreviewUrl(state.frontendPreviewLocalUrl);
  if (err) {
    addLog(`Frontend Preview: invalid URL — ${err}`, "error");
    state.frontendPreviewStatus = "error";
    return;
  }
  if (!fs.existsSync(CLOUDFLARED)) {
    addLog("cloudflared not found, skipping Frontend Preview Tunnel", "warn");
    state.frontendPreviewStatus = "error";
    return;
  }

  addLog(`Starting Frontend Preview Tunnel → ${state.frontendPreviewLocalUrl}...`);
  state.frontendPreviewStatus = "starting";
  state.frontendPreviewTunnelStatus = "starting";

  const proc = spawn(CLOUDFLARED, [
    "tunnel", "--url", state.frontendPreviewLocalUrl,
    "--no-autoupdate",
  ], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  state.frontendPreviewTunnelProc = proc;
  let buf = "";

  function handleOutput(data) {
    const msg = data.toString();
    buf += msg;
    const match = buf.match(/(https?:\/\/[\w-]+\.trycloudflare\.com)/);
    if (match) {
      state.frontendPreviewTunnelUrl = match[1];
      state.frontendPreviewStatus = "running";
      state.frontendPreviewTunnelStatus = "running";
      addLog(`Frontend Preview Tunnel ready: ${match[1]} ✓`);
      buf = "";
    }
    for (const line of msg.split("\n").filter(l => l.trim())) {
      addLog(`[FrontendPreviewTunnel] ${line.trim()}`);
    }
  }

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);

  proc.on("close", (code) => {
    addLog(`Frontend Preview Tunnel closed (code: ${code})`);
    state.frontendPreviewTunnelProc = null;
    state.frontendPreviewStatus = "stopped";
    state.frontendPreviewTunnelStatus = "stopped";
    state.frontendPreviewTunnelUrl = "";
  });

  proc.on("error", (err) => {
    addLog(`Frontend Preview Tunnel error: ${err.message}`, "error");
    state.frontendPreviewTunnelProc = null;
    state.frontendPreviewStatus = "error";
    state.frontendPreviewTunnelStatus = "error";
    state.frontendPreviewTunnelUrl = "";
  });
}

function stopFrontendPreviewTunnel() {
  if (state.frontendPreviewTunnelProc) {
    state.frontendPreviewTunnelProc.kill("SIGTERM");
    state.frontendPreviewTunnelProc = null;
    addLog("Frontend Preview Tunnel stopped");
  }
  state.frontendPreviewStatus = "stopped";
  state.frontendPreviewTunnelStatus = "stopped";
  state.frontendPreviewTunnelUrl = "";
}

// Legacy 8081 FileBrowser is retired and intentionally unsupported.

// ── Fixed Tunnel (v3.4.3 base-domain mode) ───────────────────────────────

function startFixedTunnel() {
  if (state.fixedTunnelProc) {
    addLog("Fixed Tunnel already running");
    return { ok: false, error: "Fixed Tunnel already running" };
  }
  const ft = getFixedTunnel();
  if (!ft.token) {
    addLog("Fixed Tunnel: no token set", "error");
    return { ok: false, error: "No token configured. Save a token in Settings first." };
  }
  if (!fs.existsSync(CLOUDFLARED)) {
    addLog("cloudflared not found, cannot start Fixed Tunnel", "error");
    state.fixedTunnelStatus = "error";
    return { ok: false, error: "cloudflared.exe not found" };
  }

  addLog(`Starting Fixed Tunnel (connector mode)...`);
  state.fixedTunnelStatus = "starting";
  state.fixedTunnelStartedAt = Date.now();
  state.fixedTunnelLogTail = [];

  const proc = spawn(CLOUDFLARED, [
    "tunnel", "run", "--token", ft.token,
  ], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  state.fixedTunnelProc = proc;

  function handleOutput(data) {
    const msg = data.toString();
    state.fixedTunnelLastOutputAt = Date.now();
    for (const line of msg.split("\n").filter(l => l.trim())) {
      const trimmed = line.trim();
      addLog(`[FixedTunnel] ${trimmed}`);
      state.fixedTunnelLogTail.push(`[${new Date().toLocaleTimeString()}] ${trimmed}`);
      if (state.fixedTunnelLogTail.length > 100) state.fixedTunnelLogTail.shift();
      // Detect connector registered
      if (state.fixedTunnelStatus === "starting") {
        if (trimmed.includes("Registered") || trimmed.includes("connector") || trimmed.includes("INF") || trimmed.includes("Updated")) {
          state.fixedTunnelStatus = "running";
          addLog("Fixed Tunnel connector registered with Cloudflare ✓");
        }
      }
    }
  }

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);

  proc.on("close", (code) => {
    addLog(`Fixed Tunnel closed (code: ${code})`);
    state.fixedTunnelProc = null;
    if (state.fixedTunnelStatus === "starting") {
      state.fixedTunnelStatus = "error";
    } else {
      state.fixedTunnelStatus = "stopped";
    }
  });

  proc.on("error", (err) => {
    addLog(`Fixed Tunnel error: ${err.message}`, "error");
    state.fixedTunnelProc = null;
    state.fixedTunnelStatus = "error";
  });

  // Auto-detect running after 5 seconds if no error
  setTimeout(() => {
    if (state.fixedTunnelStatus === "starting" && state.fixedTunnelProc) {
      state.fixedTunnelStatus = "running";
      addLog("Fixed Tunnel assumed running (no error after 5s) ✓");
    }
  }, 5000);

  return { ok: true, message: "Fixed Tunnel starting..." };
}

function stopFixedTunnel() {
  if (state.fixedTunnelProc) {
    state.fixedTunnelProc.kill("SIGTERM");
    state.fixedTunnelProc = null;
    addLog("Fixed Tunnel stopped");
  }
  // v3.5.1: Always clean up orphan named tunnel processes,
  // even when state.fixedTunnelProc is null (process handle lost)
  cleanupOrphanFixedTunnelProcesses('stopFixedTunnel');
  state.fixedTunnelStatus = "stopped";
  state.fixedTunnelStartedAt = null;
  state.fixedTunnelLastOutputAt = null;
  return { ok: true };
}

/**
 * v3.5.0: After fixed tunnel is disabled, start fast tunnels for
 * running local services that don't already have a fast tunnel.
 */
function reconcileFastTunnelTakeover() {
  // AI File Browser 33005
  if (state.aiStatus === "running" && !state.aiTunnelProc && !state.aiTunnelUrl) {
    addLog("[fixed-tunnel] Fast tunnel takeover: starting AI File Browser fast tunnel");
    startTunnel("AI Browser", AI_API_PORT, "aiTunnelProc", "aiTunnelStatus", "aiTunnelUrl");
  }
  // Secondary AI File Browser 33006
  if (state.secondaryAiStatus === "running" && !state.secondaryAiTunnelProc && !state.secondaryAiTunnelUrl) {
    addLog("[fixed-tunnel] Fast tunnel takeover: starting Secondary AI File Browser fast tunnel");
    startTunnel("Secondary AI Browser", SECONDARY_AI_API_PORT, "secondaryAiTunnelProc", "secondaryAiTunnelStatus", "secondaryAiTunnelUrl");
  }
  // MCP Server 33003
  if (state.mcpStatus === "running" && !state.mcpTunnelProc && !state.mcpTunnelUrl) {
    addLog("[fixed-tunnel] Fast tunnel takeover: starting MCP fast tunnel");
    startTunnel("MCP", MCP_PORT, "mcpTunnelProc", "mcpTunnelStatus", "mcpTunnelUrl");
  }
  // Frontend Preview — only if not using fixed preview
  const ft = getFixedTunnel();
  if (!isFixedPreviewUsable(ft) && state.frontendPreviewLocalUrl && !state.frontendPreviewTunnelProc && !state.frontendPreviewTunnelUrl) {
    addLog("[fixed-tunnel] Fast tunnel takeover: starting Frontend Preview fast tunnel");
    startFrontendPreviewTunnel();
  }
}

// ── v3.5.1: Orphan Fixed Tunnel Process Cleanup ──────────────────────────

/**
 * Windows-only: scan all cloudflared.exe processes and kill only
 * orphan named fixed tunnels (tunnel run --token), never fast tunnels
 * (tunnel --url).
 *
 * Must match ALL of these:
 *   1. Process name is cloudflared.exe
 *   2. CommandLine contains "tunnel run"
 *   3. CommandLine contains "--token"
 *   4. cloudflared.exe path belongs to current project directory
 *
 * Must NOT match any of:
 *   - tunnel --url (fast tunnel)
 *   - cloudflared from other directories
 *
 * Token must never be printed in logs.
 */
function cleanupOrphanFixedTunnelProcesses(reason = '') {
  // Skip if cloudflared not present
  if (!fs.existsSync(CLOUDFLARED)) return { ok: true, killed: 0 };

  const tmpDir = path.join(__dirname, '.tmp-cleanup');
  try {
    // Write PS script to temp file to avoid escaping + CLIXML issues
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const psFile = path.join(tmpDir, '_cleanup_orphan.ps1');

    // Step 1: Find candidate PIDs
    const findScript = [
      '$ProgressPreference = "SilentlyContinue"',
      '$procs = Get-CimInstance Win32_Process -Filter "Name=\'cloudflared.exe\'"',
      'foreach ($p in $procs) {',
      '  $cmd = $p.CommandLine',
      '  if (($cmd -match "tunnel run") -and ($cmd -match "--token") -and ($cmd -notmatch "tunnel\\s+--url")) {',
      '    Write-Output $p.ProcessId',
      '  }',
      '}'
    ].join('\r\n');

    fs.writeFileSync(psFile, findScript, 'utf8');
    const rawOutput = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "' + psFile + '"',
      { cwd: __dirname, encoding: 'utf8', timeout: 15000, windowsHide: true }
    );

    const pids = rawOutput.trim().split(/\r?\n/).filter(l => l.trim() && /^\d+$/.test(l.trim())).map(l => parseInt(l.trim(), 10)).filter(p => p && !isNaN(p));

    if (pids.length === 0) {
      addLog('[fixed-tunnel] orphan cleanup: no orphan named tunnel found (reason=' + reason + ')');
      return { ok: true, killed: 0 };
    }

    // Step 2: Verify each PID and kill only those with our cloudflared path
    let killed = 0;
    for (const pid of pids) {
      try {
        // Get this PID's command line
        const verifyScript = [
          '$ProgressPreference = "SilentlyContinue"',
          '$p = Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '"',
          'if ($p) {',
          '  Write-Output $p.CommandLine',
          '}'
        ].join('\r\n');
        fs.writeFileSync(psFile, verifyScript, 'utf8');

        const cmdOutput = execSync(
          'powershell -NoProfile -ExecutionPolicy Bypass -File "' + psFile + '"',
          { cwd: __dirname, encoding: 'utf8', timeout: 10000, windowsHide: true }
        );
        const cmdLine = cmdOutput.trim();

        if (!cmdLine) continue;

        // Final safety: must reference our project's cloudflared.exe
        if (!cmdLine.includes(CLOUDFLARED)) {
          addLog('[fixed-tunnel] orphan cleanup: skipping PID=' + pid + ' (different cloudflared instance) reason=' + reason);
          continue;
        }

        // Must match: "tunnel run" + "--token"
        if (!cmdLine.includes('tunnel run') || !cmdLine.includes('--token')) continue;

        // Must NOT be fast tunnel (tunnel --url)
        if (/tunnel\s+--url/.test(cmdLine)) continue;

        // Kill the orphan
        process.kill(pid, 'SIGTERM');
        killed++;
        addLog('[fixed-tunnel] orphan cleanup: killed named tunnel PID=' + pid + ' reason=' + reason);
      } catch (killErr) {
        // Process may have already exited
      }
    }

    if (killed === 0) {
      addLog('[fixed-tunnel] orphan cleanup: no orphan named tunnel found (reason=' + reason + ')');
    }

    return { ok: true, killed: killed };
  } catch (e) {
    addLog('[fixed-tunnel] orphan cleanup error: ' + e.message, 'error');
    return { ok: false, error: e.message };
  } finally {
    // Cleanup temp files
    try {
      const psFile = path.join(tmpDir, '_cleanup_orphan.ps1');
      if (fs.existsSync(psFile)) fs.unlinkSync(psFile);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
}

// ── Express App ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/brand", express.static(path.join(__dirname, "resources", "brand")));
app.get("/favicon.ico", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "resources", "brand", "webai-localbridge-icon.ico"));
});
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});

// ── API Routes ─────────────────────────────────────────────────────────────────

// GET /api/status — clean, minimal, canonical response
app.get("/api/status", async (req, res) => {
  state.rootDir = getRootDir();
  state.mcpAdvancedPermission = getMcpAdvancedPermission();
  state.rootBoundaryMode = getRootBoundaryMode();
  state.fileFastConfirm = getFileFastConfirm();
  state.commandExecution = getCommandExecution();
  state.secondaryAiRootDir = getSecondaryAiBrowserRootDir() || "";

  // Live check for AI Browser port
  const aiPortUp = await isPortListening(AI_API_PORT);
  if (aiPortUp && state.aiStatus === "stopped") state.aiStatus = "running";
  if (!aiPortUp && state.aiStatus === "running") state.aiStatus = "stopped";

  // Live check for Secondary AI Browser port
  const secondaryAiPortUp = await isPortListening(SECONDARY_AI_API_PORT);
  if (secondaryAiPortUp && state.secondaryAiStatus === "stopped") state.secondaryAiStatus = "running";
  if (!secondaryAiPortUp && state.secondaryAiStatus === "running") state.secondaryAiStatus = "stopped";

  // Live check for MCP port
  const mcpPortUp = await isPortListening(MCP_PORT);
  if (mcpPortUp && state.mcpStatus === "stopped") state.mcpStatus = "running";
  if (!mcpPortUp && state.mcpStatus === "running") state.mcpStatus = "stopped";

  // Compute display status for AI Browser
  let aiBrowserDisplay = state.aiStatus;
  if (state.aiStatus === "running" && !state.aiTunnelUrl) {
    aiBrowserDisplay = "本地运行，公网未连接";
  }
  if (state.aiTunnelUrl && !aiPortUp) {
    aiBrowserDisplay = "异常：公网存在但本地服务不可用";
  }

  // Compute display status for Secondary AI Browser
  let secondaryAiBrowserDisplay = state.secondaryAiStatus;
  if (state.secondaryAiStatus === "running" && !state.secondaryAiTunnelUrl) {
    secondaryAiBrowserDisplay = "本地运行，公网未连接";
  }
  if (state.secondaryAiTunnelUrl && !secondaryAiPortUp) {
    secondaryAiBrowserDisplay = "异常：公网存在但本地服务不可用";
  }

  // Compute display status for MCP
  let mcpDisplay = state.mcpStatus;
  if (state.mcpStatus === "running" && !state.mcpTunnelUrl) {
    mcpDisplay = "本地运行，公网未连接";
  }
  if (state.mcpTunnelUrl && !mcpPortUp) {
    mcpDisplay = "异常：公网存在但本地服务不可用";
  }

  // Compute display status for Frontend Preview
  const ftForDisplay = getFixedTunnel();
  let frontendPreviewDisplay = state.frontendPreviewStatus;
  const fpEffectiveUrl = isFixedPreviewUsable(ftForDisplay)
    ? deriveFixedUrls(ftForDisplay.baseDomain, true).frontendPreview
    : (state.frontendPreviewTunnelUrl || "");

  res.json({
    rootDir: state.rootDir,
    // AI Browser
    aiBrowser: state.aiStatus,
    aiBrowserDisplay,
    aiBrowserLocalUrl: `http://127.0.0.1:${AI_API_PORT}/`,
    aiBrowserTunnelUrl: state.aiTunnelUrl,
    // Secondary AI Browser
    secondaryAiBrowser: state.secondaryAiStatus,
    secondaryAiBrowserDisplay,
    secondaryAiBrowserLocalUrl: `http://127.0.0.1:${SECONDARY_AI_API_PORT}/`,
    secondaryAiBrowserTunnelUrl: state.secondaryAiTunnelUrl,
    secondaryAiBrowserRootDir: state.secondaryAiRootDir,
    // MCP
    mcp: state.mcpStatus,
    mcpDisplay,
    mcpLocalUrl: `http://127.0.0.1:${MCP_PORT}/mcp`,
    mcpTunnelUrl: state.mcpTunnelUrl,
    mcpTunnelMcpUrl: state.mcpTunnelUrl ? `${state.mcpTunnelUrl}/mcp` : "",
    mcpAdvancedPermission: state.mcpAdvancedPermission,
    rootBoundaryMode: state.rootBoundaryMode,
    fileFastConfirm: state.fileFastConfirm,
    commandExecution: state.commandExecution,
    // Frontend Preview
    frontendPreviewLocalUrl: state.frontendPreviewLocalUrl,
    frontendPreview: state.frontendPreviewStatus,
    frontendPreviewDisplay,
    frontendPreviewTunnelUrl: state.frontendPreviewTunnelUrl,
    frontendPreviewTunnelStatus: state.frontendPreviewTunnelStatus || state.frontendPreviewStatus,
    frontendPreviewEffectiveUrl: fpEffectiveUrl,
    // Fixed Public URLs (v3.4.3)
    fixedPublicUrls: getFixedPublicUrls(),
    // Fixed Tunnel (v3.4.3 base-domain mode)
    fixedTunnel: (() => {
      const ft = getFixedTunnel();
      return {
        baseDomain: ft.baseDomain,
        enabled: ft.enabled,
        frontendPreviewFixedEnabled: ft.frontendPreviewFixedEnabled,
        hasToken: !!ft.token,
      };
    })(),
    fixedTunnelStatus: state.fixedTunnelStatus,
    derivedFixedPublicUrls: (() => {
      const ft = getFixedTunnel();
      if (!ft.baseDomain) return { mcp: '', aiBrowser: '', secondaryAiBrowser: '', frontendPreview: '' };
      return deriveFixedUrls(ft.baseDomain, ft.frontendPreviewFixedEnabled);
    })(),
    effectivePublicUrls: (() => {
      const ft = getFixedTunnel();
      const coreUsable = isFixedCoreUsable(ft);
      const previewUsable = isFixedPreviewUsable(ft);
      const f = coreUsable ? deriveFixedUrls(ft.baseDomain, previewUsable) : {};
      const tunnelMcp = state.mcpTunnelUrl ? (state.mcpTunnelUrl + '/mcp') : '';
      return {
        mcp: f.mcp || tunnelMcp,
        aiBrowser: f.aiBrowser || state.aiTunnelUrl || '',
        secondaryAiBrowser: f.secondaryAiBrowser || state.secondaryAiTunnelUrl || '',
        frontendPreview: f.frontendPreview || state.frontendPreviewTunnelUrl || '',
      };
    })(),
    // Logs
    logs: state.logs.slice(-60),
    // v3.5.6: Startup recovery notice
    fixedTunnelStartupRecoveryNotice: state.fixedTunnelStartupRecoveryNotice || null,
    // Skill Folder (v3.4.8)
    skillFolder: (() => {
      const info = getSkillFolderStatus(__dirname);
      return {
        folder: info.folder,
        resolvedFolder: info.resolvedFolder,
        mode: info.mode,
        exists: info.exists,
        count: info.count,
        isDefault: info.isDefault,
      };
    })(),
  });
});

app.get("/api/logs", (req, res) => {
  res.json({ logs: state.logs });
});

// SET ROOT — single route, no duplicate
app.post("/api/set-root", async (req, res) => {
  const rawBody = req.body;
  addLog(`[set-root] rawBody keys=${Object.keys(rawBody).join(',')}`);
  const { dir } = rawBody;
  addLog(`[set-root] received dir="${dir}" (type=${typeof dir})`);
  if (!dir) return res.status(400).json({ error: "dir is required" });
  try {
    const prevRoot = state.rootDir;
    addLog(`[set-root] prevRoot="${prevRoot}"`);
    const resolved = writeRootDir(dir);
    state.rootDir = resolved;
    addLog(`[set-root] SUCCESS: rootDir changed from "${prevRoot}" → "${resolved}"`);
    // ai-api-server.mjs calls getRootDir() on every request (reads from mcp-tunnel-config.json), so it picks up the change.
    return res.json({ ok: true, rootDir: resolved });
  } catch (e) {
    addLog(`[set-root] ERROR: ${e.message}`, "error");
    return res.status(400).json({ error: e.message });
  }
});

// AGGREGATED: start AI Browser (local + tunnel)
app.post("/api/start-ai-browser", async (req, res) => {
  startAiBrowser(); // fire and forget — tunnel URL arrives async
  res.json({ ok: true, message: "AI File Browser starting..." });
});

// AGGREGATED: stop AI Browser (tunnel + local)
app.post("/api/stop-ai-browser", async (req, res) => {
  await stopAiBrowser();
  res.json({ ok: true, aiBrowser: "stopped" });
});

// AGGREGATED: start MCP (local + tunnel)
app.post("/api/start-mcp", async (req, res) => {
  startMcp(); // fire and forget
  res.json({ ok: true, message: "MCP Server starting..." });
});

// AGGREGATED: stop MCP (tunnel + local)
app.post("/api/stop-mcp", async (req, res) => {
  await stopMcp();
  res.json({ ok: true, mcp: "stopped" });
});

// ── MCP Agent Guide download (v3.6.x) ────────────────────────────────────
// Resolves the current MCP public endpoint using the same priority as
// the console display (fixed base-domain first, then temporary tunnel),
// then returns the English Markdown guide with {{MCP_ENDPOINT}} replaced.

function getCurrentMcpPublicEndpoint() {
  const ft = getFixedTunnel();
  const coreUsable = isFixedCoreUsable(ft);
  const previewUsable = isFixedPreviewUsable(ft);
  const fixedUrls = coreUsable ? deriveFixedUrls(ft.baseDomain, previewUsable) : {};
  const fixedMcp = fixedUrls.mcp || "";
  const tunnelMcp = state.mcpTunnelUrl ? (state.mcpTunnelUrl + "/mcp") : "";
  return fixedMcp || tunnelMcp || "";
}

app.get("/api/mcp-agent-guide/download", (req, res) => {
  try {
    const endpoint = getCurrentMcpPublicEndpoint();
    if (!endpoint) {
      return res.status(400).json({
        ok: false,
        error: "MCP public URL is not ready."
      });
    }

    const templatePath = path.join(__dirname, "resources", "templates", "mcp-agent-guide.md");

    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({
        ok: false,
        error: "Agent guide template not found."
      });
    }

    const template = fs.readFileSync(templatePath, "utf8");
    const content = template.replaceAll("{{MCP_ENDPOINT}}", endpoint);

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="mcp-agent-guide.md"');
    return res.send(content);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

// ── Skill Folder (v3.4.8) ────────────────────────────────────────────────

app.get("/api/skill-folder", (req, res) => {
  const info = getSkillFolderStatus(__dirname);
  res.json({ ok: true, ...info, restartRequired: false });
});

app.post("/api/skill-folder", (req, res) => {
  const { folder } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ ok: false, error: 'folder is required' });
  }
  try {
    const saved = writeSkillFolder(folder.trim(), { mode: 'custom', serverRoot: __dirname });
    addLog(`Skill folder applied: ${saved.folder}`);
    const info = getSkillFolderStatus(__dirname);
    res.json({ ok: true, ...info, applied: true, restartRequired: false });
  } catch (e) {
    addLog(`Skill folder apply failed: ${e.message}`, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/skill-folder/reset", (req, res) => {
  try {
    resetSkillFolder(__dirname);
    addLog('Skill folder reset to default: .agents/skills');
    const info = getSkillFolderStatus(__dirname);
    res.json({ ok: true, ...info, applied: true, restartRequired: false });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Fixed Public URLs (v3.4.3) ──────────────────────────────────────

app.get("/api/fixed-public-urls", (req, res) => {
  res.json({ fixedPublicUrls: getFixedPublicUrls() });
});

app.post("/api/fixed-public-urls", (req, res) => {
  const { urls } = req.body || {};
  if (!urls || typeof urls !== 'object') {
    return res.status(400).json({ error: 'urls object is required' });
  }
  // Validate each URL
  const errors = {};
  const warnings = {};
  const validated = {};
  for (const key of ['mcp', 'aiBrowser', 'secondaryAiBrowser', 'frontendPreview']) {
    const val = typeof urls[key] === 'string' ? urls[key].trim() : '';
    const result = validateFixedUrl(val);
    if (!result.ok) {
      errors[key] = result.error;
    } else {
      validated[key] = result.value;
      if (result.warning) warnings[key] = result.warning;
    }
  }
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }
  const saved = writeFixedPublicUrls(validated);
  state.fixedPublicUrls = saved;
  addLog(`[fixed-public-urls] Updated: ${JSON.stringify(saved)}`);
  res.json({ ok: true, fixedPublicUrls: saved, warnings: Object.keys(warnings).length ? warnings : undefined });
});

// ── Fixed Tunnel Settings (v3.4.3 base-domain mode) ─────────────────────

app.get("/api/fixed-tunnel-settings", (req, res) => {
  const ft = getFixedTunnel();
  const derived = deriveFixedUrls(ft.baseDomain, ft.frontendPreviewFixedEnabled);
  res.json({
    fixedTunnel: {
      baseDomain: ft.baseDomain,
      enabled: ft.enabled,
      frontendPreviewFixedEnabled: ft.frontendPreviewFixedEnabled,
      hasToken: !!ft.token,
      token: ft.token || "",
    },
    derivedFixedPublicUrls: derived,
    fixedTunnelStatus: state.fixedTunnelStatus,
  });
});

app.post("/api/fixed-tunnel-settings", (req, res) => {
  const { baseDomain, token, enabled, frontendPreviewFixedEnabled } = req.body || {};
  try {
    // Read prev config before saving (for transition comparison)
    const prev = getFixedTunnel();

    // Normalize inputs — simple form semantics: save whatever the user typed
    const nextBaseDomain = String(baseDomain || '').trim();
    const nextToken = String(token || '').trim();
    const requestedEnabled = !!enabled;

    // Validate baseDomain (only if non-empty)
    if (nextBaseDomain) {
      const v = validateBaseDomain(nextBaseDomain);
      if (!v.ok) throw new Error(v.error);
    }

    // Simple form semantics: canUseFixed uses the actual form values
    const canUseFixed = requestedEnabled && !!nextBaseDomain && !!nextToken;
    const normalizedFpEnabled = canUseFixed ? !!frontendPreviewFixedEnabled : false;

    // Build warning if user requested enabled but creds are missing
    let warning = null;
    if (requestedEnabled && !canUseFixed) {
      if (!nextBaseDomain) warning = 'Domain is empty, fixed domain disabled';
      else if (!nextToken) warning = 'Token is empty, fixed domain disabled';
    }

    // Save with normalization (writeFixedTunnel also enforces normalization)
    const saved = writeFixedTunnel({
      baseDomain: nextBaseDomain,
      token: nextToken,
      enabled: canUseFixed,
      frontendPreviewFixedEnabled: normalizedFpEnabled,
    });

    state.fixedPublicUrls = getFixedPublicUrls(); // refresh cached

    // Build safe message without printing token
    const tokenStatus = saved.token ? 'set' : 'cleared';
    addLog(`[fixed-tunnel] Settings saved: domain=${saved.baseDomain || '(none)'}, enabled=${saved.enabled}, frontendPreviewFixedEnabled=${saved.frontendPreviewFixedEnabled}, token=${tokenStatus}`);

    // ── v3.5.0/v3.5.1: Save transition — reconcile tunnel state ──
    const prevWasRunning = !!(prev.enabled && prev.baseDomain && prev.token && state.fixedTunnelProc);
    const shouldRun = isFixedCoreUsable(saved);

    // v3.5.1: Detect core config changes that require tunnel restart
    const coreChanged = prevWasRunning && shouldRun && (
      prev.baseDomain !== saved.baseDomain ||
      prev.token !== saved.token
    );

    if (coreChanged) {
      // v3.5.1: baseDomain or token changed — must restart fixed tunnel
      addLog('[fixed-tunnel] Save transition: core config changed, restarting fixed tunnel');
      stopFixedTunnel(); // includes orphan cleanup
      // Small delay to ensure old process fully exits before starting new
      setTimeout(() => startFixedTunnel(), 1000);
    } else if (shouldRun && !prevWasRunning) {
      // Fixed tunnel should be running but wasn't → start it
      addLog('[fixed-tunnel] Save transition: starting fixed tunnel');
      startFixedTunnel();
    } else if (!shouldRun && prevWasRunning) {
      // Fixed tunnel was running but should now stop → stop it
      addLog('[fixed-tunnel] Save transition: stopping fixed tunnel, fast tunnels will take over');
      stopFixedTunnel();
      // Fast tunnel takeover for running services
      reconcileFastTunnelTakeover();
    } else if (!shouldRun && !prevWasRunning) {
      // v3.5.1: Both prev and current are disabled — STILL clean up orphans
      // (state.fixedTunnelProc could have been lost across restarts)
      addLog('[fixed-tunnel] Save transition: fixed tunnel disabled, cleaning orphans');
      cleanupOrphanFixedTunnelProcesses('save-disabled');
      // Ensure fast tunnels are running for active services
      reconcileFastTunnelTakeover();
    } else if (shouldRun && prevWasRunning) {
      // Already running — keep it, but check if FP status changed
      // If frontendPreviewFixedEnabled changed from true→false, stop FP fast tunnel
      if (prev.frontendPreviewFixedEnabled && !saved.frontendPreviewFixedEnabled) {
        // FP was using fixed but now should use fast tunnel → start FP fast tunnel if local URL exists
        addLog('[fixed-tunnel] FP fixed disabled, switching FP to fast tunnel');
        if (state.frontendPreviewLocalUrl) {
          stopFrontendPreviewTunnel();
          startFrontendPreviewTunnel();
        }
      } else if (!prev.frontendPreviewFixedEnabled && saved.frontendPreviewFixedEnabled) {
        // FP was using fast but now should use fixed → stop FP fast tunnel
        addLog('[fixed-tunnel] FP fixed enabled, stopping FP fast tunnel');
        stopFrontendPreviewTunnel();
      }
    }

    res.json({
      ok: true,
      warning: warning || undefined,
      fixedTunnel: {
        baseDomain: saved.baseDomain,
        enabled: saved.enabled,
        frontendPreviewFixedEnabled: saved.frontendPreviewFixedEnabled,
        hasToken: !!saved.token,
      },
    });
  } catch (e) {
    addLog(`[fixed-tunnel] Settings save error: ${e.message}`, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/start-fixed-tunnel", (req, res) => {
  const result = startFixedTunnel();
  if (result.ok) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

app.post("/api/stop-fixed-tunnel", (req, res) => {
  stopFixedTunnel();
  res.json({ ok: true, fixedTunnelStatus: "stopped" });
});

// ── Advanced Permission ──────────────────────────────────────────────────
app.post("/api/toggle-advanced-permission", (req, res) => {
  const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : !state.mcpAdvancedPermission;
  writeMcpAdvancedPermission(enabled);
  writeFileFastConfirm(enabled);
  state.mcpAdvancedPermission = enabled;
  state.fileFastConfirm = enabled;
  addLog(`File Write/Delete: ${enabled ? 'On' : 'Off'}`);
  res.json({ ok: true, mcpAdvancedPermission: enabled, fileFastConfirm: enabled });
});

// ── Permission Center APIs ──────────────────────────────────────────────
app.post("/api/set-root-boundary-mode", (req, res) => {
  const { mode } = req.body;
  if (mode !== 'root-only' && mode !== 'cross-root') {
    return res.status(400).json({ error: 'mode must be "root-only" or "cross-root"' });
  }
  writeRootBoundaryMode(mode);
  state.rootBoundaryMode = mode;
  if (mode === 'root-only') {
    writeCommandExecution(false);
    state.commandExecution = false;
    addLog(`Root boundary mode: ${mode} (command execution auto-disabled)`);
    return res.json({
      ok: true,
      rootBoundaryMode: 'root-only',
      commandExecution: false,
      commandExecutionDisabledReason: 'requires-cross-root',
    });
  }
  addLog(`Root boundary mode: ${mode}`);
  res.json({
    ok: true,
    rootBoundaryMode: 'cross-root',
    commandExecution: state.commandExecution,
  });
});

app.post("/api/set-file-fast-confirm", (req, res) => {
  const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : !state.fileFastConfirm;
  writeFileFastConfirm(enabled);
  writeMcpAdvancedPermission(enabled);
  state.fileFastConfirm = enabled;
  state.mcpAdvancedPermission = enabled;
  addLog(`File Write/Delete: ${enabled ? 'On' : 'Off'}`);
  res.json({ ok: true, fileFastConfirm: enabled, mcpAdvancedPermission: enabled });
});

app.post("/api/set-command-execution", (req, res) => {
  const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : !state.commandExecution;
  state.rootBoundaryMode = getRootBoundaryMode();
  if (enabled && state.rootBoundaryMode !== 'cross-root') {
    writeCommandExecution(false);
    state.commandExecution = false;
    addLog('Command execution rejected: requires Cross Root mode', 'warn');
    return res.status(400).json({
      ok: false,
      error: 'Command Execution requires Cross Root mode',
      requiresCrossRoot: true,
      commandExecution: false,
    });
  }
  writeCommandExecution(enabled);
  state.commandExecution = enabled;
  addLog(`Command execution: ${enabled ? 'On' : 'Off'}`);
  res.json({ ok: true, commandExecution: enabled });
});

// ── Secondary AI Browser ─────────────────────────────────────────────────
app.post("/api/set-secondary-root", async (req, res) => {
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: "dir is required" });
  try {
    const resolved = writeSecondaryAiBrowserRootDir(dir);
    state.secondaryAiRootDir = resolved;
    addLog(`Secondary AI Browser root set: ${resolved}`);
    return res.json({ ok: true, secondaryAiBrowserRootDir: resolved });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/api/start-secondary-ai-browser", async (req, res) => {
  startSecondaryAiBrowser();
  res.json({ ok: true, message: "Secondary AI File Browser starting..." });
});

app.post("/api/stop-secondary-ai-browser", async (req, res) => {
  await stopSecondaryAiBrowser();
  res.json({ ok: true, secondaryAiBrowser: "stopped" });
});

// ── Frontend Preview Tunnel ─────────────────────────────────────────────────

app.post("/api/set-frontend-preview-url", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });
  const err = validateFrontendPreviewUrl(url);
  if (err) return res.status(400).json({ error: err });
  state.frontendPreviewLocalUrl = url.trim();
  writeFrontendPreviewLocalUrl(url.trim());
  addLog(`Frontend Preview local URL set: ${url.trim()}`);
  res.json({ ok: true, frontendPreviewLocalUrl: url.trim() });
});

app.post("/api/start-frontend-preview-tunnel", (req, res) => {
  if (!state.frontendPreviewLocalUrl) {
    return res.status(400).json({ error: "No local URL set. Call /api/set-frontend-preview-url first." });
  }
  const err = validateFrontendPreviewUrl(state.frontendPreviewLocalUrl);
  if (err) return res.status(400).json({ error: err });
  startFrontendPreviewTunnel();
  res.json({ ok: true, message: "Frontend Preview Tunnel starting..." });
});

app.post("/api/stop-frontend-preview-tunnel", (req, res) => {
  stopFrontendPreviewTunnel();
  res.json({ ok: true, frontendPreview: "stopped" });
});


// Local directory browser (for folder picker)
app.get("/api/local-dirs", (req, res) => {
  try {
    const reqPath = req.query.path || "/";
    if (reqPath === "/" || reqPath === "") {
      if (process.platform === "win32") {
        const drives = [];
        for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
          const drivePath = letter + ":\\";
          try { fs.accessSync(drivePath); drives.push({ name: letter + ":", path: drivePath, isDir: true }); } catch {}
        }
        return res.json({ items: drives, parent: null, currentPath: "/" });
      }
    }
    if (!path.isAbsolute(reqPath)) return res.status(400).json({ error: "Path must be absolute" });
    const stat = fs.statSync(reqPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: "Not a directory" });
    const items = fs.readdirSync(reqPath)
      .map(name => {
        try {
          const fullPath = path.join(reqPath, name);
          const s = fs.statSync(fullPath);
          return { name, path: fullPath, isDir: s.isDirectory() };
        } catch { return null; }
      })
      .filter(Boolean)
      .filter(i => i.isDir)
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(reqPath) !== reqPath ? path.dirname(reqPath) : null;
    res.json({ items, parent, currentPath: reqPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Redirect /files to 33005 with message
app.use("/files", (req, res) => {
  res.status(410).type("html").send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Moved</title></head>
<body style="font-family:sans-serif;background:#0d1117;color:#c9d1d9;margin:40px">
<h2>AI File Browser has moved to port 33005</h2>
<p><a href="http://127.0.0.1:${AI_API_PORT}/" style="color:#58a6ff;">http://127.0.0.1:${AI_API_PORT}/</a></p>
<p><a href="/" style="color:#58a6ff;">← Back to Control Panel</a></p>
</body></html>`);
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, root: state.rootDir, version: "3.0", panelPort: PANEL_PORT });
});

// ── Dashboard HTML ─────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.get("/", (req, res) => {
  const rootDirEscaped = escapeHtml(state.rootDir);
  res.type("html").send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebAI LocalBridge 控制台</title>
  <link rel="icon" href="/favicon.ico?v=webai-localbridge-2" sizes="any">
  <link rel="shortcut icon" href="/favicon.ico?v=webai-localbridge-2">
  <link rel="icon" type="image/png" href="/brand/webai-localbridge-icon.png?v=webai-localbridge-2">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; min-height: 100vh; }
    .container { max-width: 1180px; margin: 0 auto; padding: 28px 20px 48px; }
    h1 { display: flex; align-items: center; gap: 10px; font-size: 1.6em; color: #58a6ff; margin-bottom: 4px; }
    .brand-title-icon { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; box-shadow: 0 0 0 1px rgba(88,166,255,.28); }
    .subtitle { color: #8b949e; font-size: 0.9em; margin-bottom: 28px; }

    /* Cards */
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }
    .card-title { font-size: 1.05em; font-weight: 700; color: #e6edf3; margin-bottom: 4px; }
    .card-desc { color: #8b949e; font-size: 0.85em; margin-bottom: 14px; }
    .main-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; margin-bottom: 16px; }
    .primary-folder-card { border-color: #d2991d; }
    .secondary-folder-card { border-color: #79c0ff; padding: 18px 20px; }
    .folder-root-section { margin-top: 14px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
    .folder-root-section .rootdir-display { margin-bottom: 10px; }
    .primary-services { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-top: 16px; }
    .service-panel { min-width: 0; display: flex; flex-direction: column; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
    .service-panel .card-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .service-panel .btn-row { margin-top: auto; padding-top: 14px; }

    /* Primary service stack — horizontal rows */
    .primary-service-stack { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
    .service-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: start; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
    .service-row .service-main { min-width: 0; }
    .service-row .service-main .card-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; color: #e6edf3; font-size: 1.05em; margin-bottom: 4px; }
    .service-row .service-main .card-desc { color: #8b949e; font-size: 0.85em; margin-bottom: 10px; }
    .service-row .service-side { min-width: 260px; max-width: 360px; display: flex; flex-direction: column; gap: 10px; }
    .service-row .service-side .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 0; }
    @media (max-width: 900px) {
      .service-row { grid-template-columns: 1fr; }
      .service-row .service-side { min-width: 0; max-width: none; }
    }

    /* MCP wide row — full width with header actions */
    .mcp-wide-row { display: flex; flex-direction: column; gap: 14px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; }
    .service-header-inline { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .service-title-wrap { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .service-title-wrap .card-title { font-weight: 700; color: #e6edf3; font-size: 1.05em; display: flex; align-items: center; gap: 8px; }
    .service-actions-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .service-description { color: #8b949e; font-size: 0.85em; }
    .permission-center-wide { width: 100%; padding: 12px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; }
    .permission-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .permission-group { min-width: 0; }
    .permission-group-label { color: #8b949e; font-size: 0.78em; margin-bottom: 4px; }
    .permission-group-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
    .mcp-skill-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: -6px; font-size: 0.82em; }
    .skill-count-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 10px; border-radius: 999px; background: #102842; color: #58a6ff; font-weight: 700; }
    .skill-settings-link { appearance: none; border: 0; background: transparent; color: #58a6ff; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font: inherit; padding: 0; }
    .skill-settings-link:hover { color: #79c0ff; }
    @media (max-width: 900px) {
      .service-header-inline { align-items: flex-start; flex-direction: column; }
      .service-actions-inline { justify-content: flex-start; }
      .permission-row { grid-template-columns: 1fr; }
    }
    .secondary-folder-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; margin-top: 14px; }
    .secondary-folder-layout .folder-root-section { margin-top: 0; }
    .secondary-folder-layout .input-row { align-items: center; }
    .secondary-service { margin-top: 0; }
    .below-main-section { margin-top: 0; }

    /* Status badge */
    .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 0.78em; font-weight: 600; vertical-align: middle; margin-left: 8px; }
    .badge-running  { background: #1a3a1a; color: #3fb950; }
    .badge-starting { background: #3a2a0a; color: #d2991d; }
    .badge-stopped  { background: #2a1a1a; color: #f85149; }
    .badge-error    { background: #3a1a1a; color: #f85149; }
    .badge-other    { background: #1a2a3a; color: #79c0ff; }

    /* URL rows */
    .url-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .url-label { color: #8b949e; font-size: 0.82em; min-width: 72px; flex: 0 0 auto; }
    .url-value { font-family: monospace; font-size: 0.82em; color: #58a6ff; word-break: break-all; }
    .url-value.dim { color: #8b949e; }

    /* Buttons */
    .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    .btn { padding: 7px 16px; border: 1px solid #30363d; border-radius: 6px; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 0.85em; transition: background .15s; }
    .btn:hover { background: #30363d; }
    .btn-green  { border-color: #3fb950; color: #3fb950; }
    .btn-green:hover  { background: #1a3a1a; }
    .btn-red    { border-color: #f85149; color: #f85149; }
    .btn-red:hover    { background: #3a1a1a; }
    .btn-blue   { border-color: #58a6ff; color: #58a6ff; }
    .btn-blue:hover   { background: #1a2a4a; }

    /* Input */
    .input-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
    .dir-input { flex: 1; min-width: 240px; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: monospace; font-size: 0.85em; }
    .dir-input:focus { outline: none; border-color: #58a6ff; }

    /* Root dir display */
    .rootdir-display { font-family: monospace; font-size: 0.9em; color: #e6edf3; padding: 6px 10px; background: #0d1117; border-radius: 6px; border: 1px solid #30363d; margin-bottom: 12px; word-break: break-all; }

    /* Log box */
    .log-box { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px; max-height: 240px; overflow-y: auto; font-family: monospace; font-size: 0.78em; line-height: 1.6; }

    /* Toast */
    #toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #238636; color: #fff; padding: 10px 20px; border-radius: 6px; z-index: 9999; font-size: 0.9em; opacity: 0; transition: opacity .25s; pointer-events: none; }
    #toast.show { opacity: 1; }

    /* Language toggle */
    .lang-toggle { position: absolute; top: 28px; right: 20px; z-index: 100; }
    .lang-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 14px; cursor: pointer; font-size: 0.82em; transition: background .15s; }
    .lang-btn:first-child { border-radius: 6px 0 0 6px; }
    .lang-btn:last-child { border-radius: 0 6px 6px 0; }
    .lang-btn.active { background: #58a6ff; color: #0d1117; border-color: #58a6ff; }
    .lang-btn:hover:not(.active) { background: #30363d; }
    @media (max-width: 900px) {
      .container { max-width: 760px; padding-top: 22px; }
      .main-layout { grid-template-columns: 1fr; }
      .primary-services { grid-template-columns: 1fr; }
      .lang-toggle { position: static; margin-top: 12px; }
    }
    @media (max-width: 760px) {
      .secondary-folder-layout { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .card { padding: 16px; }
      .url-row { align-items: flex-start; flex-direction: column; gap: 3px; }
      .url-label { min-width: 0; }
      .dir-input { min-width: 0; width: 100%; }
      .btn { flex: 1 1 auto; }
    }

    /* Collapsible sections */
    /* Settings Modal (v3.4.3) */
    .settings-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.65); z-index: 9998; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity .2s; }
    .settings-modal-overlay.open { opacity: 1; pointer-events: auto; }
    .settings-modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 28px 32px; width: 600px; max-width: 95vw; max-height: 85vh; overflow-y: auto; position: relative; }
    .settings-modal h3 { color: #e6edf3; margin-bottom: 20px; font-size: 1.2em; }
    .settings-modal .close-btn { position: absolute; top: 16px; right: 20px; background: none; border: none; color: #8b949e; font-size: 1.4em; cursor: pointer; }
    .settings-modal .close-btn:hover { color: #e6edf3; }
    .settings-modal .section { margin-bottom: 24px; }
    .settings-modal .section-title { font-weight: 700; color: #58a6ff; font-size: 1em; margin-bottom: 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
    .settings-modal .field { margin-bottom: 12px; }
    .settings-modal .field label { display: block; color: #c9d1d9; font-size: 0.85em; margin-bottom: 4px; }
    .settings-modal .field input[type="text"],
    .settings-modal .field input[type="password"] { width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-family: monospace; font-size: 0.85em; }
    .settings-modal .field input:focus { outline: none; border-color: #58a6ff; }
    .settings-modal .toggle-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .settings-modal .toggle-row.disabled-row { opacity: 0.75; }
    .settings-modal .toggle-switch { position: relative; width: 40px; height: 22px; cursor: pointer; }
    .settings-modal .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .settings-modal .toggle-slider { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #21262d; border: 1px solid #30363d; border-radius: 22px; transition: background .2s; }
    .settings-modal .toggle-slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; background: #8b949e; border-radius: 50%; transition: transform .2s, background .2s; }
    .settings-modal .toggle-switch input:checked + .toggle-slider { background: #1a3a1a; border-color: #3fb950; }
    .settings-modal .toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); background: #3fb950; }
    .settings-modal .toggle-label { color: #c9d1d9; font-size: 0.85em; }
    .settings-modal .derived-urls { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-top: 8px; }
    .settings-modal .derived-urls .du-row { display: flex; gap: 8px; margin-bottom: 4px; font-size: 0.82em; }
    .settings-modal .derived-urls .du-label { color: #8b949e; min-width: 140px; }
    .settings-modal .derived-urls .du-value { color: #58a6ff; font-family: monospace; word-break: break-all; }
    .settings-modal .derived-urls .du-empty { color: #484f58; font-style: italic; }
    .settings-modal .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .settings-modal .error-text { color: #f85149; font-size: 0.82em; margin-top: 4px; }
    .settings-modal .success-text { color: #3fb950; font-size: 0.82em; margin-top: 4px; }
    .settings-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 14px; cursor: pointer; font-size: 0.82em; border-radius: 6px; transition: background .15s; }
    .settings-btn:hover { background: #30363d; }
    @media (max-width: 640px) {
      .settings-modal { padding: 16px; }
    }
    /* Collapsible sections */
    .collapsible { background: #161b22; border: 1px solid #30363d; border-radius: 10px; margin-bottom: 16px; }
    .collapsible-header { padding: 16px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; user-select: none; }
    .collapsible-header:hover { background: #1c2128; }
    .collapsible-title { font-size: 1.05em; font-weight: 700; color: #e6edf3; }
    .collapsible-arrow { color: #8b949e; font-size: 0.9em; transition: transform .2s; }
    .collapsible.open .collapsible-arrow { transform: rotate(90deg); }
    .collapsible-body { padding: 0 20px 20px; display: none; }
    .collapsible.open .collapsible-body { display: block; }
    .guide-step { margin-bottom: 16px; padding: 12px 16px; background: #0d1117; border-radius: 6px; border-left: 3px solid #58a6ff; }
    .guide-step h4 { color: #e6edf3; margin-bottom: 8px; font-size: 0.95em; }
    .guide-step p { color: #8b949e; font-size: 0.85em; line-height: 1.6; }
    .guide-note { margin-top: 8px; padding: 8px 12px; background: #1a2a3a; border-radius: 4px; color: #79c0ff; font-size: 0.82em; }
    .faq-item { margin-bottom: 12px; padding: 12px 16px; background: #0d1117; border-radius: 6px; }
    .faq-q { color: #e6edf3; font-weight: 600; margin-bottom: 8px; font-size: 0.9em; }
    .faq-a { color: #8b949e; font-size: 0.85em; line-height: 1.6; }

    /* Advanced section */
    details.advanced summary { cursor: pointer; color: #8b949e; font-size: 0.82em; margin-top: 12px; user-select: none; }
    details.advanced > .adv-content { margin-top: 12px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; }

    /* Permission buttons */
    .perm-btn { padding: 4px 12px; font-size: 0.78em; min-width: 80px; text-align: center; border: 1px solid #30363d; background: #21262d; color: #8b949e; transition: all .15s; }
    .perm-btn:hover { background: #30363d; }
    .perm-active { background: #1a3a1a !important; color: #3fb950 !important; border-color: #3fb950 !important; box-shadow: 0 0 0 1px #3fb950; }
    .perm-warn { background: #3a2a0a !important; color: #d2991d !important; border-color: #d2991d !important; box-shadow: 0 0 0 1px #d2991d; }
  </style>
</head>
<body>
<div class="container" style="position:relative;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;">
    <div>
      <h1><img class="brand-title-icon" src="/brand/webai-localbridge-icon.png?v=webai-localbridge-2" alt=""><span id="page-title-text">WebAI LocalBridge 控制台</span></h1>
      <p class="subtitle">本地文件 AI 访问枢纽 &mdash; 只在本机使用，端口 33004</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <button class="settings-btn" id="settings-btn" onclick="openSettingsModal()">⚙️ <span data-i18n="settingsBtn">设置</span></button>
      <button class="settings-btn" id="exit-btn" data-testid="exit-control-panel-button" onclick="exitControlPanel()" style="background:#da3633;border-color:#da3633;">⏻ <span data-i18n="exitBtn">退出</span></button>
      <div class="lang-toggle" style="position:static;">
        <button class="lang-btn active" id="lang-zh" onclick="switchLang('zh')">中文</button>
        <button class="lang-btn" id="lang-en" onclick="switchLang('en')">English</button>
      </div>
    </div>
  </div>

  <div class="main-layout">
    <section class="card primary-folder-card">
      <div class="card-title" id="primary-folder-title">📂 主文件夹</div>
      <div class="card-desc" id="primary-folder-desc">主文件夹同时供 MCP 和主 AI 文件浏览器使用。MCP 以此作为默认工作目录，具体能力按权限中心设置生效。</div>

      <div class="folder-root-section">
        <div class="rootdir-display" id="rootdir-display">${rootDirEscaped}</div>
        <div class="input-row">
          <input id="root-dir" class="dir-input" type="text" value="${rootDirEscaped}" placeholder="C:\\Users\\...">
          <button class="btn btn-blue" onclick="pickFolder()">选择文件夹</button>
          <button class="btn btn-green" onclick="setRoot()">应用更改</button>
        </div>
      </div>

      <div class="primary-service-stack">
        <section class="mcp-wide-row">
          <div class="service-header-inline">
            <div class="service-title-wrap">
              <span class="card-title">🤖 MCP</span>
              <span class="badge badge-stopped" id="mcp-badge">检查中...</span>
            </div>
            <div class="service-actions-inline">
              <button class="btn btn-green" onclick="doStart('mcp')">启动</button>
              <button class="btn btn-red"   onclick="doStop('mcp')">停止</button>
              <button class="btn"           onclick="copyMcp()">复制公网链接</button>
              <button class="btn" id="download-agent-guide-btn" onclick="downloadMcpAgentGuide()" data-i18n="downloadAgentGuide">下载 Agent 接入说明书</button>
            </div>
          </div>
          <div class="service-description" id="mcp-desc">给支持 MCP 的 AI 使用，按当前权限提供文件、文档、任务、日志和命令工具。</div>
          <div class="url-row">
            <span class="url-label">本地地址</span>
            <span class="url-value" id="mcp-local-url">http://127.0.0.1:${MCP_PORT}/mcp</span>
          </div>
          <div class="url-row">
            <span class="url-label">公网地址</span>
            <span class="url-value dim" id="mcp-public-url">未连接</span>
          </div>
          <div class="mcp-skill-summary" id="mcp-skill-summary">
            <span class="skill-count-pill" id="mcp-skill-count-pill">0 Skills Available</span>
            <button type="button" class="skill-settings-link" id="mcp-skill-settings-link" onclick="openSkillFolderSettings()">在设置中管理</button>
          </div>
          <div id="mcp-status-note" style="font-size:0.8em;color:#8b949e;margin-top:4px;display:none;"></div>
          <div class="permission-center-wide">
            <div style="font-weight:700;color:#58a6ff;font-size:0.9em;margin-bottom:10px;" id="perm-center-title">🔐 MCP 权限中心</div>
            <div class="permission-row">
              <div class="permission-group">
                <div class="permission-group-label" id="perm-root-label">Root 边界</div>
                <div class="permission-group-buttons">
                  <button class="btn perm-btn perm-active" id="perm-root-only-btn" onclick="setRootBoundary('root-only')">仅 root 内 ✅</button>
                  <button class="btn perm-btn" id="perm-cross-root-btn" onclick="setRootBoundary('cross-root')">允许跨 root</button>
                </div>
              </div>
              <div class="permission-group">
                <div class="permission-group-label" id="perm-cmd-label">命令执行</div>
                <div class="permission-group-buttons">
                  <button class="btn perm-btn" id="perm-cmd-off-btn" onclick="setCommandExecution(false)">关闭</button>
                  <button class="btn perm-btn perm-active" id="perm-cmd-on-btn" onclick="setCommandExecution(true)">开启 ✅</button>
                </div>
                <div id="perm-cmd-hint" style="font-size:0.72em;color:#8b949e;margin-top:6px;line-height:1.4;display:none;"></div>
              </div>
              <div class="permission-group">
                <div class="permission-group-label" id="perm-fast-label">文件写删权限</div>
                <div class="permission-group-buttons">
                  <button class="btn perm-btn" id="perm-fast-off-btn" onclick="setFileFastConfirm(false)">关闭</button>
                  <button class="btn perm-btn perm-active" id="perm-fast-on-btn" onclick="setFileFastConfirm(true)">开启 ✅</button>
                </div>
                <div id="perm-fast-hint" style="font-size:0.72em;color:#8b949e;margin-top:6px;line-height:1.4;"></div>
              </div>
            </div>
            <div class="collapsible" id="perm-notes" style="margin-top:10px;border:none;background:transparent;">
              <div class="collapsible-header" onclick="this.parentElement.classList.toggle('open')" style="padding:4px 0;">
                <span class="collapsible-title" style="font-size:0.78em;color:#58a6ff;" id="perm-notes-title">📖 权限说明</span>
                <span class="collapsible-arrow">▶</span>
              </div>
              <div class="collapsible-body" style="padding:0;">
                <div style="color:#8b949e;font-size:0.75em;line-height:1.6;" id="perm-notes-content"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="service-row ai-browser-row">
          <div class="service-main">
            <div class="card-title">🌐 主 AI 文件浏览器 <span class="badge badge-stopped" id="ai-badge">检查中...</span></div>
            <div class="card-desc">只读网页入口，用于让 Web AI 查看主文件夹。</div>
            <div class="url-row">
              <span class="url-label">本地地址</span>
              <span class="url-value" id="ai-local-url">http://127.0.0.1:${AI_API_PORT}/</span>
            </div>
            <div class="url-row">
              <span class="url-label">公网地址</span>
              <span class="url-value dim" id="ai-public-url">未连接</span>
            </div>
            <div id="ai-status-note" style="font-size:0.8em;color:#8b949e;margin-top:4px;display:none;"></div>
          </div>
          <div class="service-side">
            <div class="btn-row">
              <button class="btn btn-green" onclick="doStart('ai-browser')">启动</button>
              <button class="btn btn-red"   onclick="doStop('ai-browser')">停止</button>
              <button class="btn btn-blue"  onclick="openAiBrowser()">打开</button>
              <button class="btn"           onclick="copyAiBrowser()">复制公网链接</button>
            </div>
          </div>
        </section>
      </div>
    </section>

    <aside class="card secondary-folder-card">
      <div class="card-title" id="secondary-folder-title">📂 备用文件夹</div>
      <div class="card-desc" id="secondary-folder-desc">备用文件夹只供副 AI 文件浏览器使用，不影响 MCP 和主 AI 文件浏览器。</div>

      <div class="secondary-folder-layout">
        <div class="folder-root-section">
          <div class="rootdir-display" id="sec-rootdir-display">未设置</div>
          <div class="input-row">
            <input id="sec-root-dir" class="dir-input" type="text" value="" placeholder="C:\\Users\\...">
            <button class="btn btn-blue" onclick="pickSecondaryFolder()">选择文件夹</button>
            <button class="btn btn-green" onclick="setSecondaryRoot()">应用更改</button>
          </div>
        </div>

        <div class="service-panel secondary-service">
          <div class="card-title">🌐 副 AI 文件浏览器 <span class="badge badge-stopped" id="sec-ai-badge">检查中...</span></div>
          <div class="card-desc">只读网页入口，用于让 Web AI 查看备用文件夹。</div>

          <div class="url-row">
            <span class="url-label">本地地址</span>
            <span class="url-value" id="sec-ai-local-url">http://127.0.0.1:${SECONDARY_AI_API_PORT}/</span>
          </div>
          <div class="url-row">
            <span class="url-label">公网地址</span>
            <span class="url-value dim" id="sec-ai-public-url">未连接</span>
          </div>
          <div id="sec-ai-status-note" style="font-size:0.8em;color:#8b949e;margin-top:4px;display:none;"></div>

          <div class="btn-row">
            <button class="btn btn-green" id="sec-ai-start-btn" onclick="doStart('sec-ai-browser')">启动</button>
            <button class="btn btn-red"   id="sec-ai-stop-btn" onclick="doStop('sec-ai-browser')">停止</button>
            <button class="btn btn-blue"  onclick="openSecondaryAiBrowser()">打开</button>
            <button class="btn"           onclick="copySecondaryAiBrowser()">复制公网链接</button>
          </div>
        </div>
      </div>
    </aside>
  </div>

  <!-- Frontend Preview -->
  <div class="card" id="frontend-preview-card" style="border-color:#7ee787;">
    <div class="card-title" id="frontend-preview-title">🖥️ 前端预览 <span class="badge badge-stopped" id="fp-badge">检查中...</span></div>
    <div class="card-desc" id="frontend-preview-desc">把正在运行的本地前端页面临时暴露为公网链接，方便 Web AI 或浏览器 Agent 查看页面效果。</div>

    <div class="input-row" style="margin-bottom:12px;">
      <span class="url-label" id="fp-local-label">本地前端地址</span>
      <input id="fp-local-url" class="dir-input" type="text" placeholder="例如：http://127.0.0.1:5173" data-i18n-placeholder="fpPlaceholder">
      <button class="btn btn-green" id="fp-save-btn" onclick="saveFrontendPreviewUrl()">保存</button>
    </div>

    <div class="url-row">
      <span class="url-label" id="fp-pub-label">公网地址</span>
      <span class="url-value dim" id="fp-public-url">未连接</span>
    </div>
    <div id="fp-tunnel-status" style="display:none;"></div>
    <div id="fp-status-note" style="font-size:0.8em;color:#8b949e;margin-top:4px;display:none;"></div>

    <div class="btn-row">
      <button class="btn btn-green" id="fp-start-btn" onclick="doStartFrontendPreview()">启动</button>
      <button class="btn btn-red" id="fp-stop-btn" onclick="doStopFrontendPreview()">停止</button>
      <button class="btn btn-blue" id="fp-open-btn" onclick="openFrontendPreview()">打开</button>
      <button class="btn" id="fp-copy-btn" onclick="copyFrontendPreview()">复制公网链接</button>
    </div>
  </div>

  <!-- Logs -->
  <div class="card below-main-section">
    <div class="card-title" style="margin-bottom:10px;">📋 <span data-i18n="logs">运行日志</span></div>
    <div class="log-box" id="log-box">等待日志...</div>
  </div>

  <!-- User Guide -->
  <div class="collapsible" id="user-guide">
    <div class="collapsible-header" onclick="this.parentElement.classList.toggle('open')">
      <span class="collapsible-title" data-i18n="userGuide">📘 使用教学</span>
      <span class="collapsible-arrow">▶</span>
    </div>
    <div class="collapsible-body">
      <div class="guide-step">
        <h4 data-i18n="guideChatGPTTitle">ChatGPT MCP 配置教学</h4>
        <div class="lang-zh">
          <p>1. 打开 ChatGPT。</p>
          <p>2. 点击头像。</p>
          <p>3. 进入"设置"。</p>
          <p>4. 进入"应用"。</p>
          <p>5. 点击"创建应用"。</p>
          <p>6. 进入"高级设置"。</p>
          <p>7. 开启"开发人员模式"。</p>
          <p>8. 开启"在开发者模式下强制执行 CSP"。</p>
          <p>9. 在"连接"中填入本控制台 MCP 卡片里的公网链接。</p>
          <p>10. 身份验证选择"未授权"。</p>
          <p>11. 创建应用。</p>
          <p>12. 回到对话页面，点击输入框旁边的加号。</p>
          <p>13. 找到刚创建的 MCP，即可在对话中使用本地文件 MCP。</p>
          <div class="guide-note">
            <p>注意：请复制 MCP 卡片里的公网链接，通常以 /mcp 结尾。不要复制 AI 文件浏览器链接。</p>
            <p>如果服务重启后公网链接变化，需要回到 ChatGPT 应用配置中更新连接地址。</p>
          </div>
        </div>
        <div class="lang-en" style="display:none;">
          <p>1. Open ChatGPT.</p>
          <p>2. Click your profile avatar.</p>
          <p>3. Open Settings.</p>
          <p>4. Open Apps.</p>
          <p>5. Click Create app.</p>
          <p>6. Open Advanced settings.</p>
          <p>7. Enable Developer mode.</p>
          <p>8. Enable Enforce CSP in developer mode.</p>
          <p>9. In Connection, paste the MCP Public URL shown in the MCP card of this control panel.</p>
          <p>10. Set Authentication to No authentication / Unauthorized.</p>
          <p>11. Create the app.</p>
          <p>12. Return to a chat and click the plus button near the message box.</p>
          <p>13. Select the MCP app you created. You can now use the local file MCP in the conversation.</p>
          <div class="guide-note">
            <p>Use the Public URL from the MCP card. It usually ends with /mcp. Do not use the AI File Browser URL for MCP configuration.</p>
            <p>If the service restarts and the public URL changes, update the connection URL in the ChatGPT app configuration.</p>
          </div>
        </div>
      </div>
      <div class="guide-step">
        <h4 data-i18n="guideAgentGuideTitle">Agent 接入说明书使用方式</h4>
        <div class="lang-zh">
          <p>这个功能适合有云端执行环境、可以运行代码或发送 HTTP 请求，但没有官方 MCP 配置界面的 AI Agent。</p>
          <p>1. 先启动 MCP，并等待 MCP 卡片里的公网链接出现。</p>
          <p>2. 点击 MCP 卡片里的“下载 Agent 接入说明书”。</p>
          <p>3. 系统会下载一份英文 Markdown 文件，里面会自动填入当前可用的 MCP Endpoint。</p>
          <p>4. 把这份 Markdown 文件上传给 Web AI / 云端 Agent。</p>
          <p>5. 让它按照文档里的 MCP Streamable HTTP / SSE 流程初始化会话、读取 mcp-session-id、调用 tools/list 和 tools/call。</p>
          <div class="guide-note">
            <p>这个说明书不是给已经支持官方 MCP 配置界面的客户端用的；那类客户端应直接使用上面的 ChatGPT MCP 配置方式。</p>
            <p>如果 AI 只是需要只读查看文件，而不会自己发 MCP JSON-RPC 请求，优先使用下面的 AI 文件浏览器。</p>
          </div>
        </div>
        <div class="lang-en" style="display:none;">
          <p>This feature is for AI agents that have a cloud execution environment and can run code or send HTTP requests, but do not provide an official MCP configuration interface.</p>
          <p>1. Start MCP and wait until the MCP Public URL appears in the MCP card.</p>
          <p>2. Click Download Agent Guide in the MCP card.</p>
          <p>3. The system downloads an English Markdown file with the current MCP Endpoint filled in automatically.</p>
          <p>4. Upload this Markdown file to the Web AI or cloud agent.</p>
          <p>5. Ask the agent to follow the MCP Streamable HTTP / SSE flow in the guide: initialize the session, read mcp-session-id, then call tools/list and tools/call.</p>
          <div class="guide-note">
            <p>This guide is not for clients that already provide an official MCP configuration interface. For those clients, use the ChatGPT MCP configuration flow above.</p>
            <p>If the AI only needs read-only file viewing and will not send MCP JSON-RPC requests itself, use the AI File Browser below instead.</p>
          </div>
        </div>
      </div>
      <div class="guide-step">
        <h4 data-i18n="guideAiBrowserTitle">AI 文件浏览器使用教学</h4>
        <div class="lang-zh">
          <p>1. 在控制台点击"启动"主 AI 文件浏览器。</p>
          <p>2. 等待"公网地址"出现。</p>
          <p>3. 点击"复制公网链接"。</p>
          <p>4. 把该链接发给 Web AI / 浏览器 Agent / 需要查看文件的 AI。</p>
          <p>5. 打开后可以查看当前主共享目录中的文件。</p>
          <p>6. AI 文件浏览器是只读入口，只能查看、下载、预览、提取文本，不能修改或删除文件。</p>
          <div class="guide-note">
            <p>主 AI 文件浏览器绑定主共享目录，通常用于工作目录。</p>
            <p>副 AI 文件浏览器绑定副共享目录，适合同时暴露另一个本地文件夹给 Web Agent 查看。</p>
          </div>
        </div>
        <div class="lang-en" style="display:none;">
          <p>1. Click Start on the Primary AI File Browser.</p>
          <p>2. Wait until the Public URL appears.</p>
          <p>3. Click Copy Public URL.</p>
          <p>4. Send that URL to a Web AI, browser agent, or any AI that needs to inspect your local files.</p>
          <p>5. The page shows files from the current primary shared folder.</p>
          <p>6. The AI File Browser is read-only. It can view, download, preview, and extract text, but it cannot modify or delete files.</p>
          <div class="guide-note">
            <p>The Primary AI File Browser is bound to the primary shared folder. It is usually used for your working folder.</p>
            <p>The Secondary AI File Browser is bound to a separate secondary folder. It is useful when a web agent needs to inspect another local folder at the same time.</p>
          </div>
        </div>
      </div>
      <div class="guide-step">
        <h4 data-i18n="guideDifferenceTitle">MCP 与 AI 文件浏览器区别</h4>
        <div class="lang-zh">
          <p>MCP：给支持 MCP 的 AI 使用，按当前权限提供文件、文档、任务、日志和命令工具。</p>
          <p>AI 文件浏览器：给 Web AI / 浏览器 Agent 使用，只读，不会修改文件。</p>
          <p>副 AI 文件浏览器：第二个只读入口，目录独立，不影响 MCP 和主 AI 文件浏览器。</p>
        </div>
        <div class="lang-en" style="display:none;">
          <p>MCP: Used by AI clients that support MCP. It provides file, document, task, log, and command tools according to current permissions.</p>
          <p>AI File Browser: Used by Web AI or browser agents. It is read-only and cannot modify files.</p>
          <p>Secondary AI File Browser: A second read-only entry point with its own folder. It does not affect MCP or the Primary AI File Browser.</p>
        </div>
      </div>
      <div class="guide-step">
        <h4 data-i18n="guideFrontendPreviewTitle">前端预览使用教学</h4>
        <div class="lang-zh">
          <p>前端预览用于暴露正在运行的本地前端页面。先在你的项目里启动开发服务器，例如 npm run dev，然后把本地地址 http://127.0.0.1:5173 填入前端预览卡片，点击启动。生成公网链接后，可以把它发给 Web AI 或浏览器 Agent 查看页面效果。</p>
        </div>
        <div class="lang-en" style="display:none;">
          <p>Frontend Preview exposes a running local frontend page. Start your development server first, for example npm run dev. Then paste the local URL such as http://127.0.0.1:5173 into the Frontend Preview card and click Start. After the public URL appears, send it to a Web AI or browser agent to inspect the UI.</p>
        </div>
      </div>
      <div class="guide-step">
        <h4 data-i18n="guideFixedTunnelTitle">固定域名 Tunnel 配置</h4>
        <div class="lang-zh">
          <p>固定域名模式需要先在 Cloudflare Tunnel 中配置 Public Hostname。只需要一个基础域名，例如 example.com，然后分别添加 mcp、files、files2 子域名：mcp.example.com 转发到 127.0.0.1:33003，files.example.com 转发到 127.0.0.1:33005，files2.example.com 转发到 127.0.0.1:33006。不要配置 33004 控制台。</p>
          <p>配置好 Public Hostname 后，点击右上角 ⚙️ 设置，填写基础域名和 Tunnel Token，启用固定域名即可。系统会自动生成所有子域名公网地址。</p>
        </div>
        <div class="lang-en" style="display:none;">
          <p>If you have fixed domains, configure Cloudflare Tunnel to forward subdomains to local ports, e.g. mcp.example.com → 127.0.0.1:33003, files.example.com → 127.0.0.1:33005, files2.example.com → 127.0.0.1:33006. Do not expose port 33004 to the public.</p>
          <p>After configuring Public Hostnames, click ⚙️ Settings at the top right, enter your base domain and Tunnel Token, and enable fixed domain mode. The system will derive all subdomain URLs automatically.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Settings Modal is now at the top right — old bottom settings removed -->

  <!-- Legacy 8081 FileBrowser is retired -->
</div>

<!-- Settings Modal (v3.4.3) -->
<div class="settings-modal-overlay" id="cmd-risk-modal-overlay" style="z-index:10000;">
  <div class="settings-modal" style="width:480px;max-width:95vw;">
    <h3 id="cmd-risk-dialog-title" style="margin-bottom:12px;">开启命令执行？</h3>
    <p id="cmd-risk-dialog-body" style="color:#c9d1d9;font-size:0.9em;line-height:1.6;margin-bottom:20px;white-space:pre-line;"></p>
    <div class="btn-row" style="justify-content:flex-end;margin-top:0;">
      <button class="btn" id="cmd-risk-dialog-cancel" type="button" style="background:#30363d;color:#c9d1d9;">取消</button>
      <button class="btn btn-green" id="cmd-risk-dialog-confirm" type="button">我已了解，开启</button>
    </div>
  </div>
</div>

<div class="settings-modal-overlay" id="settings-modal-overlay">
  <div class="settings-modal">
    <button class="close-btn" onclick="closeSettingsModal()">✕</button>
    <h3 data-i18n="settingsModalTitle">⚙️ 设置</h3>

    <!-- Fixed Domain Tunnel Section -->
    <div class="section">
      <div class="section-title" data-i18n="fixedTunnelSectionTitle">🔗 固定域名 Tunnel</div>
      <div class="field">
        <label data-i18n="baseDomainLabel">基础域名 / Base Domain</label>
        <input type="text" id="fixed-base-domain" placeholder="example.com" spellcheck="false">
        <div class="error-text" id="fixed-domain-error" style="display:none;"></div>
      </div>
      <div class="field">
        <label data-i18n="tunnelTokenLabel">Tunnel Token</label>
        <div style="display:flex;align-items:center;gap:4px;">
          <input type="password" id="fixed-tunnel-token" placeholder="" spellcheck="false" style="flex:1;">
          <button type="button" id="token-eye-btn" onclick="toggleTokenVisibility()" title="显示" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;white-space:nowrap;" data-i18n-title="showToken">👁</button>
        </div>
        <div style="margin-top:4px;">
          <span id="fixed-token-status" style="font-size:0.82em;color:#8b949e;"></span>
        </div>
      </div>
      <div class="toggle-row">
        <label class="toggle-switch">
          <input type="checkbox" id="fixed-enabled-toggle">
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label" data-i18n="enableFixedDomain">启用固定域名</span>
      </div>
      <div class="toggle-row">
        <label class="toggle-switch">
          <input type="checkbox" id="fixed-fp-toggle">
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label" data-i18n="enableFixedFp">启用 Frontend Preview 固定域名</span>
      </div>
      <div style="color:#8b949e;font-size:0.82em;margin-top:8px;" data-i18n="derivedUrlsNote">系统将自动生成以下公网地址：</div>
      <div class="derived-urls" id="derived-urls-preview">
        <div class="du-row"><span class="du-label">MCP:</span><span class="du-value du-empty" id="du-mcp">—</span></div>
        <div class="du-row"><span class="du-label" data-i18n="duPrimaryBrowser">主 AI 文件浏览器:</span><span class="du-value du-empty" id="du-ai">—</span></div>
        <div class="du-row"><span class="du-label" data-i18n="duSecondaryBrowser">副 AI 文件浏览器:</span><span class="du-value du-empty" id="du-sec">—</span></div>
        <div class="du-row"><span class="du-label" data-i18n="duFpLabel">Frontend Preview:</span><span class="du-value du-empty" id="du-fp">—</span></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-green" onclick="saveFixedTunnelSettings()" data-i18n="saveSettings">保存设置</button>
      </div>
      <div id="fixed-tunnel-status-bar" style="margin-top:8px;font-size:0.82em;"></div>
    </div>


    <!-- Skill Folder Section -->
    <div class="section" id="settings-skill-folder-section">
      <div class="section-title" id="settings-skill-folder-title">📚 MCP Skill 文件夹</div>
      <div style="color:#8b949e;font-size:0.85em;line-height:1.5;margin-bottom:12px;" id="settings-skill-folder-desc">
        配置 MCP skill 工具读取的本地 Skill 文件夹。默认使用项目内 .agents/skills。
      </div>

      <div class="field">
        <label id="settings-skill-folder-saved-label">当前已保存路径</label>
        <div class="rootdir-display" id="skill-folder-display"></div>
      </div>

      <div class="field">
        <label id="settings-skill-folder-status-label">状态</label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="badge badge-other" id="skill-folder-mode-badge">默认</span>
          <span class="badge badge-other" id="skill-folder-count-badge">0</span>
        </div>
      </div>

      <div class="field">
        <label id="settings-skill-folder-change-label">修改 Skill 文件夹</label>
        <div class="input-row">
          <input id="skill-folder-input" class="dir-input" type="text" placeholder="">
          <button class="btn btn-blue" id="skill-folder-browse-btn" onclick="pickSkillFolder()">选择文件夹</button>
          <button class="btn btn-green" id="skill-folder-apply-btn" onclick="applySkillFolder()">应用</button>
        </div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn" id="skill-folder-reset-btn" onclick="resetSkillFolderDefault()">还原默认</button>
        </div>
        <div id="skill-folder-status-note" style="font-size:0.8em;color:#8b949e;margin-top:6px;"></div>
      </div>
    </div>

    <!-- FAQ Section -->
    <div class="section" style="border-top:1px solid #21262d;padding-top:16px;">
      <div class="section-title" data-i18n="faq">❓ 常见问题</div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq1q">为什么重启后可能需要重新配置 MCP？</div>
        <div class="faq-a lang-zh">如果你使用的是临时公网链接，Tunnel 重启后公网地址可能会变化，AI 里保存的旧 MCP 地址就会失效，需要复制新的 MCP 公网链接重新填入。如果你已经配置并启用了固定域名，MCP 地址会保持不变，正常重启服务后不需要重新配置。</div>
        <div class="faq-a lang-en" style="display:none;">If you are using a temporary public URL, the Tunnel may generate a new public address after restart. The old MCP URL saved in AI will no longer work, so you need to copy the new MCP public URL and update it. If you have configured and enabled a fixed domain, the MCP URL stays the same, so restarting the service normally does not require reconfiguration.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq2q">为什么每次公网链接都不一样？</div>
        <div class="faq-a lang-zh">这是因为当前使用的是临时 Tunnel。临时公网链接由 Cloudflare 随机生成，重启后可能变化，这是正常现象。如果你想长期使用固定不变的地址，请在设置里配置固定域名 Tunnel。配置完成后，MCP、主 AI 文件浏览器、副 AI 文件浏览器和前端预览都会使用稳定的固定公网地址。</div>
        <div class="faq-a lang-en" style="display:none;">This happens when you are using a temporary Tunnel. Temporary public URLs are randomly generated by Cloudflare and may change after restart. This is normal. If you want a stable long-term address, configure Fixed Domain Tunnel in Settings. After it is configured, MCP, the Primary AI File Browser, the Secondary AI File Browser, and Frontend Preview will use stable fixed public URLs.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq3q">为什么有一个副 AI 文件浏览器？</div>
        <div class="faq-a lang-zh">副 AI 文件浏览器用于同时暴露第二个本地文件夹。比如主 AI 文件浏览器给工作文件夹，副 AI 文件浏览器给本地 Agent 输出目录。这样 Web Agent 可以同时查看两个不同目录，而 MCP 仍然只绑定主 root。</div>
        <div class="faq-a lang-en" style="display:none;">The Secondary AI File Browser exposes a second local folder at the same time. For example, the Primary AI File Browser can show your working folder, while the Secondary AI File Browser shows a local agent output folder. A web agent can inspect both folders, while MCP remains bound only to the primary root.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq4q">MCP 和 AI 文件浏览器有什么区别？</div>
        <div class="faq-a lang-zh">MCP 是给支持 MCP 的 AI 使用的工具接口，按当前权限提供文件、文档、任务、日志和命令工具。AI 文件浏览器是网页只读入口，适合 Web AI 查看本地文件，但不能写入、删除或移动文件。</div>
        <div class="faq-a lang-en" style="display:none;">MCP is a tool interface for AI clients that support MCP. It provides file, document, task, log, and command tools according to current permissions. The AI File Browser is a read-only web interface for Web AI to inspect local files. It cannot write, delete, or move files.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq5q">为什么 MCP 连接不上？</div>
        <div class="faq-a lang-zh">常见原因包括：MCP 服务没有启动、公网链接已过期、复制的不是 MCP 公网链接、链接没有以 /mcp 结尾、ChatGPT 应用里身份验证没有选择未授权、开发人员模式或 CSP 设置没有开启。</div>
        <div class="faq-a lang-en" style="display:none;">Common causes: the MCP service is not running, the public URL has expired, the copied URL is not the MCP Public URL, the URL does not end with /mcp, authentication is not set to No authentication / Unauthorized, Developer mode is not enabled, or CSP enforcement in developer mode is not enabled.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq6q">为什么 AI 文件浏览器能打开，但 MCP 不能用？</div>
        <div class="faq-a lang-zh">AI 文件浏览器和 MCP 是两个不同服务。AI 文件浏览器通常是 33005 或 33006，MCP 是 33003/mcp。请确认复制的是 MCP 卡片里的公网链接，而不是 AI 文件浏览器链接。</div>
        <div class="faq-a lang-en" style="display:none;">The AI File Browser and MCP are different services. The AI File Browser usually runs on 33005 or 33006. MCP runs on 33003/mcp. Make sure you copied the Public URL from the MCP card, not from the AI File Browser card.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq7q">文件写删权限安全吗？</div>
        <div class="faq-a lang-zh">文件写删权限只控制 MCP 文件工具（写入、编辑、删除、移动、创建/删除目录）。关闭后为只读模式。删除非空目录需要 recursive:true。命令执行是独立的高权限能力，开启后命令可能绕过文件工具的写删限制。</div>
        <div class="faq-a lang-en" style="display:none;">File Write/Delete controls MCP file tools only (write, edit, delete, move, create/remove directories). When off, file tools are read-only. Removing a non-empty directory requires recursive:true. Command Execution is a separate high-privilege capability; when enabled, commands may bypass file-tool write/delete restrictions.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq8q">副 AI 文件浏览器会影响 MCP 吗？</div>
        <div class="faq-a lang-zh">不会。副 AI 文件浏览器是独立的只读网页入口。MCP 仍然只绑定主 root，不会自动获得副 root 权限。</div>
        <div class="faq-a lang-en" style="display:none;">No. The Secondary AI File Browser is an independent read-only web entry point. MCP remains bound to the primary root and does not automatically gain access to the secondary root.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq9q">前端预览和 AI 文件浏览器有什么区别？</div>
        <div class="faq-a lang-zh">AI 文件浏览器暴露的是文件夹内容，适合让 AI 查看代码和文件。前端预览暴露的是正在运行的本地网页，适合让 AI 查看页面效果。通常两者可以一起使用：AI 文件浏览器给 AI 看代码，前端预览给 AI 看运行效果。</div>
        <div class="faq-a lang-en" style="display:none;">The AI File Browser exposes folder contents, which is useful for inspecting code and files. Frontend Preview exposes a running local web page, which is useful for inspecting the UI. You can both together: AI File Browser for code, Frontend Preview for the running page.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq10q">固定域名和 trycloudflare 临时链接有什么区别？</div>
        <div class="faq-a lang-zh">trycloudflare 临时链接每次重启可能变化；固定域名地址稳定，适合长期填到 ChatGPT MCP 或浏览器 Agent 中。如果没有固定域名，保持设置为空即可继续使用临时链接。</div>
        <div class="faq-a lang-en" style="display:none;">A trycloudflare temporary URL may change after restart. A fixed domain is stable and better for long-term ChatGPT MCP or browser-agent configuration. If you do not have a fixed domain, leave the settings empty to keep using temporary URLs.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q" data-i18n="faq11q">为什么只填写一个基础域名？</div>
        <div class="faq-a lang-zh">因为系统会按约定自动生成 mcp、files、files2、preview 子域名，避免用户重复填写多个完整地址。你只需要在 Cloudflare Tunnel 里按相同规则配置 Public Hostname。</div>
        <div class="faq-a lang-en" style="display:none;">The system derives the mcp, files, files2, and preview subdomains automatically, so users do not need to enter multiple full URLs. Configure the same Public Hostnames in Cloudflare Tunnel.</div>
      </div>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
  // ── i18n ─────────────────────────────────────────────────────────────────────
  const translations = {
    zh: {
      title: 'WebAI LocalBridge 控制台',
      subtitle: '本地文件 AI 访问枢纽 — 只在本机使用，端口 33004',
      currentSharedFolder: '📂 当前共享目录',
      primaryRoot: '主共享目录',
      aiFileBrowser: '🌐 AI 文件浏览器',
      aiFileBrowserDesc: '只读文件浏览入口。给 ChatGPT Web / 普通 AI 使用，打开后直接展示当前共享目录。',
      mcp: '🤖 MCP',
      mcpDesc: '给支持 MCP 的 AI 使用，按当前权限提供文件、文档、任务、日志和命令工具。',
      secondaryAiBrowser: '📁 副 AI 文件浏览器',
      secondaryAiBrowserDesc: '独立的只读文件浏览器（端口 33006）。有自己的共享目录和公网链接，不影响主浏览器和 MCP。',
      localUrl: '本地地址',
      publicUrl: '公网地址',
      notConnected: '未连接',
      notSet: '未设置',
      start: '▶ 启动',
      stop: '■ 停止',
      open: '🔗 打开',
      copyPublicUrl: '📋 复制公网链接',
      copyLocalUrl: '📋 复制本地链接',
      selectFolder: '📁 选择文件夹',
      apply: '✅ 应用更改',
      advancedPermission: '⚠️ 文件写删权限',
      advancedPermissionDesc: '关闭后，MCP 文件工具只读；开启后，允许写入、编辑、删除、移动、创建目录和删除目录。删除非空目录需要 recursive:true。',
      advancedPermissionNote: '只影响 MCP 文件工具，不影响命令执行',
      permCenter: '🔐 MCP 权限中心',
      rootBoundary: 'Root 边界',
      rootOnly: '仅 root 内',
      crossRoot: '允许跨 root',
      fileFastConfirm: '文件写删权限',
      fileWriteDeleteDesc: '关闭后，MCP 文件工具只读；开启后，允许写入、编辑、删除、移动、创建目录和删除目录。删除非空目录需要 recursive:true。',
      commandExecution: '命令执行',
      cmdRequiresCrossRootToast: '请先开启 Cross Root，才能开启命令执行',
      cmdRequiresCrossRootHint: '需先允许跨 root',
      cmdShortHint: '高风险能力，需先允许跨 root。',
      cmdRiskDialogTitle: '开启命令执行？',
      cmdRiskDialogBody: '开启后，AI 可以运行本地命令。命令可能读写、移动或删除文件，也可能绕过文件工具的写删权限限制。\\n\\n请只在确实需要时开启。',
      cmdRiskDialogConfirm: '我已了解，开启',
      cmdRiskDialogCancel: '取消',
      fileWriteDeleteShortDesc: '控制 MCP 文件工具是否可写入、编辑、删除和移动文件。',
      rootOnlyReadOnlyMode: '当前为 root 内只读模式',
      crossRootFileAccessMode: '当前为跨 root 文件访问模式',
      permNotes: '📖 权限说明',
      on: '开启',
      off: '关闭',
      running: '运行中',
      stopped: '已停止',
      starting: '启动中',
      error: '错误',
      copySuccess: '已复制',
      copyPublicUrlToast: '已复制公网链接',
      publicUrlNotReady: '公网链接未生成，请先启动服务并等待公网地址出现。',
      userGuide: '📘 使用教学',
      faq: '❓ 常见问题',
      // User Guide
      guideChatGPTTitle: 'ChatGPT MCP 配置教学',
      guideAgentGuideTitle: 'Agent 接入说明书使用方式',
      guideAiBrowserTitle: 'AI 文件浏览器使用教学',
      guideDifferenceTitle: 'MCP 与 AI 文件浏览器区别',
      guideFrontendPreviewTitle: '前端预览使用教学',
      // FAQ
      faq1q: '为什么重启后可能需要重新配置 MCP？',
      faq1a: '如果你使用的是临时公网链接，Tunnel 重启后公网地址可能会变化，AI 里保存的旧 MCP 地址就会失效，需要复制新的 MCP 公网链接重新填入。如果你已经配置并启用了固定域名，MCP 地址会保持不变，正常重启服务后不需要重新配置。',
      faq2q: '为什么每次公网链接都不一样？',
      faq2a: '这是因为当前使用的是临时 Tunnel。临时公网链接由 Cloudflare 随机生成，重启后可能变化，这是正常现象。如果你想长期使用固定不变的地址，请在设置里配置固定域名 Tunnel。配置完成后，MCP、主 AI 文件浏览器、副 AI 文件浏览器和前端预览都会使用稳定的固定公网地址。',
      faq3q: '为什么有一个副 AI 文件浏览器？',
      faq3a: '副 AI 文件浏览器用于同时暴露第二个本地文件夹。比如主 AI 文件浏览器给工作文件夹，副 AI 文件浏览器给本地 Agent 输出目录。这样 Web Agent 可以同时查看两个不同目录，而 MCP 仍然只绑定主 root。',
      faq4q: 'MCP 和 AI 文件浏览器有什么区别？',
      faq4a: 'MCP 是给支持 MCP 的 AI 使用的工具接口，按当前权限提供文件、文档、任务、日志和命令工具。AI 文件浏览器是网页只读入口，适合 Web AI 查看本地文件，但不能写入、删除或移动文件。',
      faq5q: '为什么 MCP 连接不上？',
      faq5a: '常见原因包括：MCP 服务没有启动、公网链接已过期、复制的不是 MCP 公网链接、链接没有以 /mcp 结尾、ChatGPT 应用里身份验证没有选择未授权、开发人员模式或 CSP 设置没有开启。',
      faq6q: '为什么 AI 文件浏览器能打开，但 MCP 不能用？',
      faq6a: 'AI 文件浏览器和 MCP 是两个不同服务。AI 文件浏览器通常是 33005 或 33006，MCP 是 33003/mcp。请确认复制的是 MCP 卡片里的公网链接，而不是 AI 文件浏览器链接。',
      faq7q: '文件写删权限安全吗？',
      faq7a: '文件写删权限只控制 MCP 文件工具。关闭后为只读模式。删除非空目录需要 recursive:true。命令执行是独立能力，开启后命令可能绕过文件工具的写删限制。',
      faq8q: '副 AI 文件浏览器会影响 MCP 吗？',
      faq8a: '不会。副 AI 文件浏览器是独立的只读网页入口。MCP 仍然只绑定主 root，不会自动获得副 root 权限。',
      faq9q: '前端预览和 AI 文件浏览器有什么区别？',
      faq9a: 'AI 文件浏览器暴露的是文件夹内容，适合让 AI 查看代码和文件。前端预览暴露的是正在运行的本地网页，适合让 AI 查看页面效果。通常两者可以一起使用：AI 文件浏览器给 AI 看代码，前端预览给 AI 看运行效果。',
      faq10q: '固定域名和 trycloudflare 临时链接有什么区别？',
      faq10a: 'trycloudflare 临时链接每次重启可能变化；固定域名地址稳定，适合长期填到 ChatGPT MCP 或浏览器 Agent 中。如果没有固定域名，保持设置为空即可继续使用临时链接。',
      faq11q: '为什么只填写一个基础域名？',
      faq11a: '因为系统会按约定自动生成 mcp、files、files2、preview 子域名，避免用户重复填写多个完整地址。你只需要在 Cloudflare Tunnel 里按相同规则配置 Public Hostname。',
      settings: '⚙️ 设置',
      settingsBtn: '设置',
      settingsModalTitle: '⚙️ 设置',
      fixedTunnelSectionTitle: '🔗 固定域名 Tunnel',
      baseDomainLabel: '基础域名 / Base Domain',
      tunnelTokenLabel: 'Tunnel Token',
      enableFixedDomain: '启用固定域名',
      enableFixedFp: '启用前端预览固定域名',
      derivedUrlsNote: '系统将自动生成以下公网地址：',
      duPrimaryBrowser: '主 AI 文件浏览器:',
      duSecondaryBrowser: '副 AI 文件浏览器:',
      duFpLabel: '前端预览：',
      saveSettings: '保存设置',
      startFixedTunnel: '启动固定 Tunnel',
      stopFixedTunnel: '停止固定 Tunnel',
      clearToken: '清空 Token',
      fixedUrlsTitle: '固定公网地址',
      save: '保存',
      guideFixedTunnelTitle: '固定域名 Tunnel 配置',
      exitBtn: '退出',
      exitConfirm: '确定退出控制台吗？本地子服务和 Tunnel 会被停止。',
      exitExiting: '控制台正在退出...',
      exitExitingHint: '正在停止本地子服务和 Tunnel。',
      exitExited: '控制台已退出',
      exitMaybeRunning: '控制台可能仍在运行',
      exitMaybeRunningHint: '请检查本地进程或端口 33004。',
      exitFailed: '退出控制台失败',
      showToken: '显示',
      hideToken: '隐藏',
      fixedDomainEnabled: '固定域名已启用',
      fixedDomainDisabledFastTunnel: '固定域名未启用，正在使用 Fast Tunnel',
      tokenOrDomainEmptyFallback: 'Token 或基础域名为空，已回退到 Fast Tunnel',
      invalidBaseDomain: '基础域名格式错误',
      skillFolder: 'MCP Skill 文件夹',
      skillFolderTitle: '📚 MCP Skill 文件夹',
      skillFolderDesc: '配置 MCP skill 工具读取的本地 Skill 文件夹。默认使用项目内 .agents/skills。',
      skillFolderCurrent: '当前 MCP Skill 文件夹',
      skillFolderDefault: '默认',
      skillFolderCustom: '自定义',
      skillsAvailable: '可用 Skill',
      skillFolderApplied: '已应用',
      skillFolderRestartRequired: '需要重启',
      skillFolderNotExists: '文件夹不存在',
      skillFolderApplyFailed: '应用 Skill 文件夹失败',
      resetSkillFolderDefault: '还原默认',
      skillFolderSavedPath: '当前已保存路径',
      skillFolderStatus: '状态',
      skillFolderChange: '修改 Skill 文件夹',
      skillFolderManageInSettings: '在设置中管理',
      // Agent Guide Download
      downloadAgentGuide: '下载 Agent 接入说明书',
      agentGuideDownloaded: 'Agent 接入说明书已下载',
      agentGuideNoMcpUrl: 'MCP 公网链接未生成，请先启动 MCP 并等待公网地址出现。',
    },
    en: {
      title: 'WebAI LocalBridge Control Panel',
      subtitle: 'Local file AI access hub — for local use only, port 33004',
      currentSharedFolder: '📂 Current Shared Folder',
      primaryRoot: 'Primary Root',
      aiFileBrowser: '🌐 AI File Browser',
      aiFileBrowserDesc: 'Read-only file browser. For ChatGPT Web / general AI. Opens the current shared folder.',
      mcp: '🤖 MCP',
      mcpDesc: 'For AI clients that support MCP. Provides file, document, task, log, and command tools according to current permissions.',
      secondaryAiBrowser: '📁 Secondary AI File Browser',
      secondaryAiBrowserDesc: 'Independent read-only file browser (port 33006). Has its own shared folder and public URL. Does not affect the primary browser or MCP.',
      localUrl: 'Local URL',
      publicUrl: 'Public URL',
      notConnected: 'Not connected',
      notSet: 'Not set',
      start: '▶ Start',
      stop: '■ Stop',
      open: '🔗 Open',
      copyPublicUrl: '📋 Copy Public URL',
      copyLocalUrl: '📋 Copy Local URL',
      selectFolder: '📁 Select Folder',
      apply: '✅ Apply',
      advancedPermission: '⚠️ File Write/Delete',
      advancedPermissionDesc: 'When off, MCP file tools are read-only. When on, MCP may write, edit, delete, move files, create directories, and remove directories. Removing a non-empty directory requires recursive:true.',
      advancedPermissionNote: 'Affects MCP file tools only, not Command Execution',
      permCenter: '🔐 MCP Permission Center',
      rootBoundary: 'Root Boundary',
      rootOnly: 'Root Only',
      crossRoot: 'Cross Root',
      fileFastConfirm: 'File Write/Delete',
      fileWriteDeleteDesc: 'When off, MCP file tools are read-only. When on, MCP may write, edit, delete, move files, create directories, and remove directories. Removing a non-empty directory requires recursive:true.',
      commandExecution: 'Command Execution',
      cmdRequiresCrossRootToast: 'Enable Cross Root before enabling Command Execution',
      cmdRequiresCrossRootHint: 'Requires Cross Root',
      cmdShortHint: 'High-risk capability. Requires Cross Root.',
      cmdRiskDialogTitle: 'Enable Command Execution?',
      cmdRiskDialogBody: 'After enabling this, AI can run local commands. Commands may read, write, move, or delete files, and may bypass file-tool write/delete restrictions.\\n\\nEnable only when needed.',
      cmdRiskDialogConfirm: 'I understand, enable',
      cmdRiskDialogCancel: 'Cancel',
      fileWriteDeleteShortDesc: 'Controls whether MCP file tools can write, edit, delete, and move files.',
      rootOnlyReadOnlyMode: 'Current mode is root-only read-only',
      crossRootFileAccessMode: 'Current mode allows cross-root file access',
      permNotes: '📖 Permission Notes',
      on: 'On',
      off: 'Off',
      running: 'running',
      stopped: 'stopped',
      starting: 'starting',
      error: 'error',
      copySuccess: 'Copied',
      copyPublicUrlToast: 'Public URL copied',
      publicUrlNotReady: 'Public URL is not ready. Start the service and wait for the public URL to appear.',
      userGuide: '📘 User Guide',
      faq: '❓ FAQ',
      // User Guide
      guideChatGPTTitle: 'ChatGPT MCP Configuration',
      guideAgentGuideTitle: 'Agent Guide Usage',
      guideAiBrowserTitle: 'AI File Browser Usage',
      guideDifferenceTitle: 'MCP vs AI File Browser',
      guideFrontendPreviewTitle: 'Frontend Preview Usage',
      // FAQ
      faq1q: 'Why might I need to reconfigure MCP after restarting?',
      faq1a: 'If you are using a temporary public URL, the Tunnel may generate a new public address after restart. The old MCP URL saved in AI will no longer work, so you need to copy the new MCP public URL and update it. If you have configured and enabled a fixed domain, the MCP URL stays the same, so restarting the service normally does not require reconfiguration.',
      faq2q: 'Why is the public URL different each time?',
      faq2a: 'This happens when you are using a temporary Tunnel. Temporary public URLs are randomly generated by Cloudflare and may change after restart. This is normal. If you want a stable long-term address, configure Fixed Domain Tunnel in Settings. After it is configured, MCP, the Primary AI File Browser, the Secondary AI File Browser, and Frontend Preview will use stable fixed public URLs.',
      faq3q: 'Why is there a Secondary AI File Browser?',
      faq3a: 'The Secondary AI File Browser exposes a second local folder at the same time. For example, the Primary AI File Browser can show your working folder, while the Secondary AI File Browser shows a local agent output folder. A web agent can inspect both folders, while MCP remains bound only to the primary root.',
      faq4q: 'What is the difference between MCP and AI File Browser?',
      faq4a: 'MCP is a tool interface for AI clients that support MCP. It provides file, document, task, log, and command tools according to current permissions. The AI File Browser is a read-only web interface for Web AI to inspect local files. It cannot write, delete, or move files.',
      faq5q: 'Why am I unable to connect to MCP?',
      faq5a: 'Common causes: the MCP service is not running, the public URL has expired, the copied URL is not the MCP Public URL, the URL does not end with /mcp, authentication is not set to No authentication / Unauthorized, Developer mode is not enabled, or CSP enforcement in developer mode is not enabled.',
      faq6q: 'Why does the AI File Browser work but MCP does not?',
      faq6a: 'The AI File Browser and MCP are different services. The AI File Browser usually runs on 33005 or 33006. MCP runs on 33003/mcp. Make sure you copied the Public URL from the MCP card, not from the AI File Browser card.',
      faq7q: 'Is File Write/Delete safe?',
      faq7a: 'File Write/Delete controls MCP file tools only. When off, file tools are read-only. Removing a non-empty directory requires recursive:true. Command Execution is separate; when enabled, commands may bypass file-tool write/delete restrictions.',
      faq8q: 'Does the Secondary AI File Browser affect MCP?',
      faq8a: 'No. The Secondary AI File Browser is an independent read-only web entry point. MCP remains bound to the primary root and does not automatically gain access to the secondary root.',
      faq9q: 'What is the difference between Frontend Preview and AI File Browser?',
      faq9a: 'The AI File Browser exposes folder contents, which is useful for inspecting code and files. Frontend Preview exposes a running local web page, which is useful for inspecting the UI. You can use both together: AI File Browser for code, Frontend Preview for the running page.',
      faq10q: 'What is the difference between a fixed domain and a trycloudflare temporary URL?',
      faq10a: 'A trycloudflare temporary URL may change after restart. A fixed domain is stable and better for long-term ChatGPT MCP or browser-agent configuration. If you do not have a fixed domain, leave the settings empty to keep using temporary URLs.',
      faq11q: 'Why only enter one base domain?',
      faq11a: 'The system derives the mcp, files, files2, and preview subdomains automatically, so users do not need to enter multiple full URLs. Configure the same Public Hostnames in Cloudflare Tunnel.',
      settings: '⚙️ Settings',
      settingsBtn: 'Settings',
      settingsModalTitle: '⚙️ Settings',
      fixedTunnelSectionTitle: '🔗 Fixed Domain Tunnel',
      baseDomainLabel: 'Base Domain',
      tunnelTokenLabel: 'Tunnel Token',
      enableFixedDomain: 'Enable Fixed Domain',
      enableFixedFp: 'Enable Fixed Domain for Frontend Preview',
      derivedUrlsNote: 'The system will derive these public URLs automatically:',
      duPrimaryBrowser: 'Primary AI File Browser:',
      duSecondaryBrowser: 'Secondary AI File Browser:',
      duFpLabel: 'Frontend Preview:',
      saveSettings: 'Save Settings',
      startFixedTunnel: 'Start Fixed Tunnel',
      stopFixedTunnel: 'Stop Fixed Tunnel',
      clearToken: 'Clear Token',
      fixedUrlsTitle: 'Fixed Public URLs',
      save: 'Save',
      guideFixedTunnelTitle: 'Fixed Domain Tunnel Configuration',
      exitBtn: 'Exit',
      exitConfirm: 'Exit the control panel? Local child services and tunnels will be stopped.',
      exitExiting: 'Control panel is exiting...',
      exitExitingHint: 'Stopping local child services and tunnels.',
      exitExited: 'Control panel exited',
      exitMaybeRunning: 'The control panel may still be running',
      exitMaybeRunningHint: 'Check the local process or port 33004.',
      exitFailed: 'Failed to exit control panel',
      showToken: 'Show',
      hideToken: 'Hide',
      fixedDomainEnabled: 'Fixed Domain enabled',
      fixedDomainDisabledFastTunnel: 'Fixed Domain disabled, using Fast Tunnel',
      tokenOrDomainEmptyFallback: 'Token or Base Domain is empty, reverted to Fast Tunnel',
      invalidBaseDomain: 'Invalid base domain',
      skillFolder: 'MCP Skill Folder',
      skillFolderTitle: '📚 MCP Skill Folder',
      skillFolderDesc: 'Configure the local Skill Folder used by the MCP skill tool. Default: .agents/skills inside this project.',
      skillFolderCurrent: 'Current MCP Skill Folder',
      skillFolderDefault: 'Default',
      skillFolderCustom: 'Custom',
      skillsAvailable: 'Skills Available',
      skillFolderApplied: 'Applied',
      skillFolderRestartRequired: 'Restart required',
      skillFolderNotExists: 'Folder does not exist',
      skillFolderApplyFailed: 'Failed to apply Skill Folder',
      resetSkillFolderDefault: 'Reset to Default',
      skillFolderSavedPath: 'Current saved path',
      skillFolderStatus: 'Status',
      skillFolderChange: 'Change Skill Folder',
      skillFolderManageInSettings: 'Manage in Settings',
      // Agent Guide Download
      downloadAgentGuide: 'Download Agent Guide',
      agentGuideDownloaded: 'Agent guide downloaded',
      agentGuideNoMcpUrl: 'MCP public URL is not ready. Start MCP and wait for the public URL to appear.',
    }
  };

  let currentLang = localStorage.getItem('mcpTunnelLang') || 'zh';
  let lastFixedTunnelStartupNoticeTs = 0;

  function switchLang(lang) {
    currentLang = lang;
    localStorage.setItem('mcpTunnelLang', lang);
    document.getElementById('lang-zh').classList.toggle('active', lang === 'zh');
    document.getElementById('lang-en').classList.toggle('active', lang === 'en');
    applyTranslations();
  }

  function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) || key;
  }

  function applyTranslations() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && translations[currentLang] && translations[currentLang][key]) {
        el.textContent = translations[currentLang][key];
      }
    });
    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && translations[currentLang] && translations[currentLang][key]) {
        el.placeholder = translations[currentLang][key];
      }
    });
    // Update language button active state
    const langZhBtn = document.getElementById('lang-zh');
    const langEnBtn = document.getElementById('lang-en');
    if (langZhBtn) langZhBtn.classList.toggle('active', currentLang === 'zh');
    if (langEnBtn) langEnBtn.classList.toggle('active', currentLang === 'en');
    // Show/hide language-specific content
    document.querySelectorAll('.lang-zh').forEach(el => el.style.display = currentLang === 'zh' ? '' : 'none');
    document.querySelectorAll('.lang-en').forEach(el => el.style.display = currentLang === 'en' ? '' : 'none');
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  let _toastTimer;
  function showToast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#da3633' : '#238636';
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ── Generic API call ───────────────────────────────────────────────────────
  async function call(url, method, body) {
    try {
      const opts = { method: method || 'POST', headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) { showToast('错误: ' + (data.error || res.status), true); }
      return data;
    } catch(e) { showToast('请求失败: ' + e.message, true); return null; }
  }

  // ── Start / Stop ───────────────────────────────────────────────────────────
  async function doStart(service) {
    const map = { 'ai-browser': '/api/start-ai-browser', 'mcp': '/api/start-mcp', 'sec-ai-browser': '/api/start-secondary-ai-browser' };
    const labels = { 'ai-browser': 'AI 文件浏览器', 'mcp': 'MCP', 'sec-ai-browser': '副 AI 文件浏览器' };
    const url = map[service]; const label = labels[service];
    showToast(label + ' 正在启动，Tunnel 就绪后公网 URL 会自动显示...');
    await call(url);
    // Poll for 60s until tunnel URL appears
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
      await sleep(2000);
      const s = await fetchStatus();
      if (!s) break;
      if (service === 'ai-browser' && s.aiBrowserTunnelUrl) { showToast('AI 文件浏览器已就绪 ✓'); break; }
      if (service === 'mcp' && s.mcpTunnelMcpUrl) { showToast('MCP 已就绪 ✓'); break; }
      if (service === 'sec-ai-browser' && s.secondaryAiBrowserTunnelUrl) { showToast('副 AI 文件浏览器已就绪 ✓'); break; }
      if (service === 'ai-browser' && s.aiBrowser === 'error') { showToast('AI 文件浏览器启动失败', true); break; }
      if (service === 'mcp' && s.mcp === 'error') { showToast('MCP 启动失败', true); break; }
      if (service === 'sec-ai-browser' && s.secondaryAiBrowser === 'error') { showToast('副 AI 文件浏览器启动失败', true); break; }
    }
    refresh();
  }

  async function doStop(service) {
    const map = { 'ai-browser': '/api/stop-ai-browser', 'mcp': '/api/stop-mcp', 'sec-ai-browser': '/api/stop-secondary-ai-browser' };
    const labels = { 'ai-browser': 'AI 文件浏览器', 'mcp': 'MCP', 'sec-ai-browser': '副 AI 文件浏览器' };
    const url = map[service]; const label = labels[service];
    showToast(label + ' 正在停止...');
    await call(url);
    showToast(label + ' 已停止');
    refresh();
  }

  // ── Open / Copy ────────────────────────────────────────────────────────────
  function openAiBrowser() {
    const pub = document.getElementById('ai-public-url').textContent.trim();
    const loc = 'http://127.0.0.1:${AI_API_PORT}/';
    const url = (pub && pub !== '未连接') ? pub : loc;
    if (url === loc) showToast('公网未连接，打开本地地址');
    window.open(url, '_blank');
  }

  async function copyAiBrowser() {
    const pub = document.getElementById('ai-public-url').textContent.trim();
    if (pub && pub !== '未连接' && !pub.startsWith('http')) {
      // In case the text is some status message, not a URL
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
      return;
    }
    if (pub && pub.startsWith('http')) {
      await copyToClipboard(pub);
      showToast('已复制公网 AI 文件浏览器链接');
    } else {
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
    }
  }

  async function copyMcp() {
    const pub = document.getElementById('mcp-public-url').textContent.trim();
    if (pub && pub !== '未连接' && !pub.startsWith('http')) {
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
      return;
    }
    if (pub && pub.startsWith('http')) {
      await copyToClipboard(pub);
      showToast('已复制公网 MCP 链接');
    } else {
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
    }
  }

  // Download the MCP Agent connection guide. The guide is served by the
  // backend at /api/mcp-agent-guide/download; the frontend only triggers
  // the download and does not embed the guide text.
  function downloadMcpAgentGuide() {
    const visibleUrl = getVisiblePublicUrl('mcp-public-url');
    if (!visibleUrl) {
      showToast(ui('agentGuideNoMcpUrl'), true);
      return;
    }
    window.location.href = '/api/mcp-agent-guide/download';
    showToast(ui('agentGuideDownloaded'));
  }
  window.downloadMcpAgentGuide = downloadMcpAgentGuide;

  // ── Secondary AI Browser Open / Copy ──────────────────────────────────────
  function openSecondaryAiBrowser() {
    const pub = document.getElementById('sec-ai-public-url').textContent.trim();
    const loc = 'http://127.0.0.1:${SECONDARY_AI_API_PORT}/';
    const url = (pub && pub !== '未连接') ? pub : loc;
    if (url === loc) showToast('公网未连接，打开本地地址');
    window.open(url, '_blank');
  }

  async function copySecondaryAiBrowser() {
    const pub = document.getElementById('sec-ai-public-url').textContent.trim();
    if (pub && pub !== '未连接' && !pub.startsWith('http')) {
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
      return;
    }
    if (pub && pub.startsWith('http')) {
      await copyToClipboard(pub);
      showToast('已复制副 AI 文件浏览器公网链接');
    } else {
      showToast('公网链接未生成，请先启动服务并等待公网地址出现。', true);
    }
  }

  // ── Fixed Public URLs (v3.4.3) ─────────────────────────────────────────────
  async function loadFixedUrls() {
    try {
      const res = await fetch('/api/fixed-public-urls');
      const data = await res.json();
      const urls = data.fixedPublicUrls || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('fixed-url-mcp', urls.mcp);
      set('fixed-url-aibrowser', urls.aiBrowser);
      set('fixed-url-secondary', urls.secondaryAiBrowser);
      set('fixed-url-frontend', urls.frontendPreview);
    } catch {}
  }

  window.saveFixedUrls = async function() {
    const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const urls = {
      mcp: get('fixed-url-mcp'),
      aiBrowser: get('fixed-url-aibrowser'),
      secondaryAiBrowser: get('fixed-url-secondary'),
      frontendPreview: get('fixed-url-frontend'),
    };
    const errEl = document.getElementById('fixed-url-errors');
    const statusEl = document.getElementById('fixed-url-status');
    if (errEl) errEl.textContent = '';
    if (statusEl) statusEl.textContent = '';
    try {
      const res = await fetch('/api/fixed-public-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (data.ok) {
        if (statusEl) { statusEl.textContent = '✅ 已保存'; statusEl.style.color = '#3fb950'; }
        // Show warnings
        if (data.warnings && errEl) {
          const msgs = Object.entries(data.warnings).map(function(e) { return e[0] + ': ' + e[1]; });
          errEl.textContent = '⚠️ ' + msgs.join('; ');
          errEl.style.color = '#d2991d';
        }
        // Refresh status to pick up new effective URLs
        refresh();
      } else {
        if (errEl && data.errors) {
          const msgs = Object.entries(data.errors).map(function(e) { return e[0] + ': ' + e[1]; });
          errEl.textContent = '❌ ' + msgs.join('; ');
          errEl.style.color = '#f85149';
        }
      }
    } catch (e) {
      if (errEl) { errEl.textContent = '❌ ' + e.message; errEl.style.color = '#f85149'; }
    }
  };

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch(e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // ── Status refresh ─────────────────────────────────────────────────────────
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      return await res.json();
    } catch { return null; }
  }

  function badgeClass(status) {
    if (status === 'running') return 'badge-running';
    if (status === 'starting') return 'badge-starting';
    if (status === 'error') return 'badge-error';
    if (status === 'stopped') return 'badge-stopped';
    return 'badge-other';
  }

  async function refresh() {
    const s = await fetchStatus();
    if (!s) return;

    // Root dir
    const rdEl = document.getElementById('rootdir-display');
    if (rdEl) rdEl.textContent = s.rootDir || '';
    const inputEl = document.getElementById('root-dir');
    if (inputEl && document.activeElement !== inputEl) inputEl.value = s.rootDir || '';

    // AI Browser badge
    const aiBadge = document.getElementById('ai-badge');
    if (aiBadge) {
      aiBadge.textContent = formatServiceDisplay(s.aiBrowser, s.aiBrowserDisplay);
      aiBadge.className = 'badge ' + badgeClass(s.aiBrowser);
    }
    // AI Browser URLs — fixed URL priority (effectivePublicUrls handles fixedTunnel logic)
    const aiPubEl = document.getElementById('ai-public-url');
    if (aiPubEl) {
      const fixedAi = s.effectivePublicUrls?.aiBrowser || '';
      const tunnelAi = s.aiBrowserTunnelUrl || '';
      const aiPub = fixedAi || tunnelAi;
      if (aiPub) {
        aiPubEl.textContent = aiPub;
        aiPubEl.classList.remove('dim');
      } else {
        aiPubEl.textContent = ui('notConnected');
        aiPubEl.classList.add('dim');
      }
    }
    // AI status note — badge already shows aiBrowserDisplay via formatServiceDisplay
    const aiNote = document.getElementById('ai-status-note');
    if (aiNote) {
      aiNote.textContent = '';
      aiNote.style.display = 'none';
    }

    // MCP badge
    const mcpBadge = document.getElementById('mcp-badge');
    if (mcpBadge) {
      mcpBadge.textContent = formatServiceDisplay(s.mcp, s.mcpDisplay);
      mcpBadge.className = 'badge ' + badgeClass(s.mcp);
    }
    // MCP URLs — fixed URL priority (effectivePublicUrls handles fixedTunnel logic)
    const mcpPubEl = document.getElementById('mcp-public-url');
    if (mcpPubEl) {
      const fixedMcp = s.effectivePublicUrls?.mcp || '';
      const tunnelMcp = s.mcpTunnelMcpUrl || '';
      const mcpPub = fixedMcp || tunnelMcp;
      if (mcpPub) {
        mcpPubEl.textContent = mcpPub;
        mcpPubEl.classList.remove('dim');
        if (fixedMcp) mcpPubEl.title = '固定地址';
        else mcpPubEl.title = '';
      } else {
        mcpPubEl.textContent = ui('notConnected');
        mcpPubEl.classList.add('dim');
      }
    }
    // MCP status note — badge already shows mcpDisplay via formatServiceDisplay
    const mcpNote = document.getElementById('mcp-status-note');
    if (mcpNote) {
      mcpNote.textContent = '';
      mcpNote.style.display = 'none';
    }

    // ── Permission Center ───────────────────────────────────────────────
    renderPermissionCenter();

    // ── Secondary AI Browser ──────────────────────────────────────────────
    // Badge
    const secBadge = document.getElementById('sec-ai-badge');
    if (secBadge) {
      secBadge.textContent = formatServiceDisplay(s.secondaryAiBrowser, s.secondaryAiBrowserDisplay);
      secBadge.className = 'badge ' + badgeClass(s.secondaryAiBrowser);
    }
    // URLs — fixed URL priority (effectivePublicUrls handles fixedTunnel logic)
    const secPubEl = document.getElementById('sec-ai-public-url');
    if (secPubEl) {
      const fixedSec = s.effectivePublicUrls?.secondaryAiBrowser || '';
      const tunnelSec = s.secondaryAiBrowserTunnelUrl || '';
      const secPub = fixedSec || tunnelSec;
      if (secPub) {
        secPubEl.textContent = secPub;
        secPubEl.classList.remove('dim');
      } else {
        secPubEl.textContent = ui('notConnected');
        secPubEl.classList.add('dim');
      }
    }
    // Secondary AI status note — badge already shows display via formatServiceDisplay
    const secNote = document.getElementById('sec-ai-status-note');
    if (secNote) {
      secNote.textContent = '';
      secNote.style.display = 'none';
    }
    // Root dir display
    const secRdEl = document.getElementById('sec-rootdir-display');
    if (secRdEl) secRdEl.textContent = s.secondaryAiBrowserRootDir || '未设置';
    const secInputEl = document.getElementById('sec-root-dir');
    if (secInputEl && document.activeElement !== secInputEl) secInputEl.value = s.secondaryAiBrowserRootDir || '';

    // Skill Folder
    if (s.skillFolder) renderSkillFolderUI(s.skillFolder);

    // Logs
    const logBox = document.getElementById('log-box');
    if (logBox && s.logs && s.logs.length > 0) {
      logBox.innerHTML = s.logs.map(l => '<div>' + l + '</div>').join('');
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  // ── Skill Folder dirty/pendin state (v3.4.8) ────────────────────────────
  // Prevent refresh() from overwriting user's un-saved input.
  let skillFolderInputDirty = false;
  function bindSkillFolderInputDirtyTracking() {
    const input = document.getElementById('skill-folder-input');
    if (!input || input._dirtyBound) return;
    input.addEventListener('input', () => { skillFolderInputDirty = true; });
    input._dirtyBound = true;
  }

  function renderSkillFolderUI(info) {
    renderSkillFolderSettingsUI(info);
    renderSkillFolderMainUI(info);
  }

  function renderSkillFolderMainUI(info) {
    const countPill = document.getElementById('mcp-skill-count-pill');
    const settingsLink = document.getElementById('mcp-skill-settings-link');
    if (!countPill) return;
    const count = Number.isFinite(Number(info?.count)) ? Number(info.count) : 0;
    countPill.textContent = String(count) + ' ' + ui('skillsAvailable');
    countPill.title = info?.resolvedFolder || '';
    if (settingsLink) settingsLink.textContent = ui('skillFolderManageInSettings');
  }

  function renderSkillFolderSettingsUI(info) {
    const display = document.getElementById('skill-folder-display');
    const input = document.getElementById('skill-folder-input');
    const modeBadge = document.getElementById('skill-folder-mode-badge');
    const countBadge = document.getElementById('skill-folder-count-badge');
    const note = document.getElementById('skill-folder-status-note');
    if (!info || !display) return;
    const resolved = info.resolvedFolder || '';
    display.textContent = resolved;
    // Only overwrite input if user has no un-saved changes
    if (input && document.activeElement !== input && !skillFolderInputDirty) {
      input.value = resolved;
    }
    if (modeBadge) modeBadge.textContent = info.isDefault ? ui('skillFolderDefault') : ui('skillFolderCustom');
    if (countBadge) countBadge.textContent = String(info.count ?? 0) + ' ' + ui('skillsAvailable');
    if (note) {
      if (!info.exists) {
        note.textContent = ui('skillFolderNotExists');
        note.style.color = '#d29922';
      } else {
        note.textContent = '';
        note.style.color = '#8b949e';
      }
    }
  }

  async function applySkillFolder() {
    const folder = (document.getElementById('skill-folder-input')?.value || '').trim();
    if (!folder) return showToast(ui('selectFolderFirst'), true);
    try {
      const data = await requestJson('/api/skill-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      });
      if (data && data.ok) {
        skillFolderInputDirty = false;
        renderSkillFolderUI(data);
        showToast(ui('skillFolderApplied'));
        refresh();
      } else {
        showToast((data && data.error) || ui('skillFolderApplyFailed'), true);
      }
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
    }
  }

  async function resetSkillFolderDefault() {
    try {
      const data = await requestJson('/api/skill-folder/reset', { method: 'POST' });
      if (data && data.ok) {
        skillFolderInputDirty = false;
        renderSkillFolderUI(data);
        showToast(ui('skillFolderApplied'));
        refresh();
      } else {
        showToast((data && data.error) || ui('skillFolderApplyFailed'), true);
      }
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
    }
  }

  window.applySkillFolder = applySkillFolder;
  window.resetSkillFolderDefault = resetSkillFolderDefault;

  // ── sleep ──────────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── v3.1.0 UI i18n normalization ──────────────────────────────────────────
  const uiText = {
    zh: {
      pageTitle: 'WebAI LocalBridge 控制台',
      subtitle: '本地文件 AI 访问枢纽 — 只在本机使用，端口 33004',
      primaryFolder: '📂 主文件夹',
      primaryFolderDesc: '主文件夹同时供 MCP 和主 AI 文件浏览器使用。MCP 以此作为默认工作目录，具体能力按权限中心设置生效。',
      secondaryFolder: '📂 备用文件夹',
      secondaryFolderDesc: '备用文件夹只供副 AI 文件浏览器使用，不影响 MCP 和主 AI 文件浏览器。',
      currentSharedFolder: '📂 当前共享目录',
      currentSharedFolderDesc: '切换后，AI 文件浏览器和 MCP 会立刻读取新目录，无需重启服务。',
      primaryAiBrowser: '🌐 主 AI 文件浏览器',
      primaryAiBrowserDesc: '只读网页入口，用于让 Web AI 查看主文件夹。',
      mcp: '🤖 MCP',
      mcpDesc: '给支持 MCP 的 AI 使用，按当前权限提供文件、文档、任务、日志和命令工具。',
      secondaryAiBrowser: '🌐 副 AI 文件浏览器',
      secondaryAiBrowserDesc: '只读网页入口，用于让 Web AI 查看备用文件夹。',
      localUrl: '本地地址',
      publicUrl: '公网地址',
      selectFolder: '选择文件夹',
      apply: '应用更改',
      start: '启动',
      stop: '停止',
      open: '打开',
      copyPublicUrl: '复制公网链接',
      runtimeLogs: '📋 运行日志',
      waitingLogs: '等待日志...',
      notConnected: '未连接',
      notSet: '未设置',
      checking: '检查中...',
      runningLocalNoPublic: '本地运行，公网未连接',
      publicWithoutLocal: '异常：公网存在但本地服务不可用',
      aiBrowserStarting: 'AI 文件浏览器 正在启动，Tunnel 就绪后公网 URL 会自动显示...',
      aiBrowserStopping: 'AI 文件浏览器 正在停止...',
      aiBrowserReady: 'AI 文件浏览器已就绪 ✓',
      aiBrowserFailed: 'AI 文件浏览器启动失败',
      mcpStarting: 'MCP 正在启动，Tunnel 就绪后公网 URL 会自动显示...',
      mcpStopping: 'MCP 正在停止...',
      mcpReady: 'MCP 已就绪 ✓',
      mcpFailed: 'MCP 启动失败',
      secondaryStarting: '副 AI 文件浏览器 正在启动，Tunnel 就绪后公网 URL 会自动显示...',
      secondaryStopping: '副 AI 文件浏览器 正在停止...',
      secondaryReady: '副 AI 文件浏览器已就绪 ✓',
      secondaryFailed: '副 AI 文件浏览器启动失败',
      stoppedToast: '已停止',
      copiedPublicUrl: '已复制公网链接',
      publicUrlNotReady: '公网链接未生成，请先启动服务并等待公网地址出现。',
      openLocalUrl: '公网未连接，打开本地地址',
      rootChanged: '共享目录已切换为: ',
      secondaryRootChanged: '副浏览器目录已设置',
      requestFailed: '请求失败: ',
      requestError: '错误: ',
      inputPathRequired: '请输入目录路径',
      setFailed: '设置失败: ',
      switchFailed: '切换失败: ',
      selectFolderTitle: '选择文件夹',
      selectSecondaryFolderTitle: '选择副浏览器共享目录',
      enterPathOrBrowse: '输入路径或浏览...',
      enterPath: '输入路径...',
      go: '前往',
      cancel: '取消',
      selectThisFolder: '选择此文件夹',
      applying: '应用中...',
      loading: '加载中...',
      parentFolder: '上级目录',
      noSubfolders: '无子文件夹',
      selectFolderFirst: '请先选择一个文件夹',
      advancedPermission: '文件写删权限',
      advDesc: '关闭后，MCP 文件工具只读；开启后，允许写入、编辑、删除、移动、创建目录和删除目录。删除非空目录需要 recursive:true。',
      advOff: '已关闭',
      advOn: '已开启',
      advOffNote: '当前状态：文件写删权限已关闭。MCP 文件工具为只读模式。',
      advOnNote: '当前状态：文件写删权限已开启。MCP 文件工具可写删。',
      advFixedNote: '删除非空目录需要 recursive:true。',
      // Permission Center
      permCenter: '🔐 MCP 权限中心',
      rootBoundary: 'Root 边界',
      rootOnly: '仅 root 内',
      crossRoot: '允许跨 root',
      fileFastConfirm: '文件写删权限',
      fileWriteDeleteDesc: '关闭后，MCP 文件工具只读；开启后，允许写入、编辑、删除、移动、创建目录和删除目录。删除非空目录需要 recursive:true。',
      commandExecution: '命令执行',
      cmdRequiresCrossRootToast: '请先开启 Cross Root，才能开启命令执行',
      cmdRequiresCrossRootHint: '需先允许跨 root',
      cmdShortHint: '高风险能力，需先允许跨 root。',
      cmdRiskDialogTitle: '开启命令执行？',
      cmdRiskDialogBody: '开启后，AI 可以运行本地命令。命令可能读写、移动或删除文件，也可能绕过文件工具的写删权限限制。\\n\\n请只在确实需要时开启。',
      cmdRiskDialogConfirm: '我已了解，开启',
      cmdRiskDialogCancel: '取消',
      fileWriteDeleteShortDesc: '控制 MCP 文件工具是否可写入、编辑、删除和移动文件。',
      rootOnlyReadOnlyMode: '当前为 root 内只读模式',
      crossRootFileAccessMode: '当前为跨 root 文件访问模式',
      permNotes: '📖 权限说明',
      permNotesBody: '<b>Root 边界</b><br>仅 root 内：文件工具只能操作 rootDir 内路径；命令执行不可用。<br>允许跨 root：文件工具可以使用绝对路径访问 root 外路径；命令执行的前置条件。<br><br><b>命令执行</b><br>必须先开启 Cross Root 才能开启。开启时需确认风险提示。<br>关闭后，禁止启动新命令，但 process_list、process_logs、process_stop、task_list 等仍可用于查看和管理已启动进程。<br><br><b>文件写删权限</b><br>关闭后，MCP 文件工具只读。<br>开启后，允许写入、编辑、删除、移动、创建目录和删除目录。删除非空目录需要 recursive:true。<br>只影响文件工具，不影响命令执行。',
      on: '开启',
      off: '关闭',
      running: '运行中',
      stopped: '已停止',
      starting: '启动中',
      error: '错误',
      // Frontend Preview
      frontendPreview: '🖥️ 前端预览',
      frontendPreviewDesc: '把正在运行的本地前端页面临时暴露为公网链接，方便 Web AI 或浏览器 Agent 查看页面效果。',
      fpLocalUrl: '本地前端地址',
      fpPublicUrl: '公网地址',
      fpOpen: '打开',
      fpCopyPublicUrl: '复制公网链接',
      fpNotConnected: '未连接',
      tunnelPrefix: 'Tunnel：',
      fpPlaceholder: '例如：http://127.0.0.1:5173',
      fpValidationError: '请输入有效的本地前端地址，例如 http://127.0.0.1:5173。只允许 localhost / 127.0.0.1，不能暴露 33004 控制台或 8081。',
      fpPublicUrlNotReady: '公网链接未生成，请先启动并等待公网地址出现。',
      fpStarting: '前端预览 正在启动，Tunnel 就绪后公网 URL 会自动显示...',
      fpStopping: '前端预览 正在停止...',
      fpReady: '前端预览已就绪 ✓',
      fpFailed: '前端预览启动失败',
      fpSaved: '前端预览地址已保存 ✓',
      fpCopied: '已复制前端预览公网链接',
      fpOpenLocal: '公网未连接，打开本地前端地址',
      // Guide
      guideFrontendPreviewTitle: '前端预览使用教学',
      // FAQ
      faq9q: '前端预览和 AI 文件浏览器有什么区别？',
      faq9a: 'AI 文件浏览器暴露的是文件夹内容，适合让 AI 查看代码和文件。前端预览暴露的是正在运行的本地网页，适合让 AI 查看页面效果。通常两者可以一起使用：AI 文件浏览器给 AI 看代码，前端预览给 AI 看运行效果。',
      skillFolderTitle: '📚 MCP Skill 文件夹',
      skillFolderDesc: '配置 MCP skill 工具读取的本地 Skill 文件夹。默认使用项目内 .agents/skills。',
      skillFolderCurrent: '当前 MCP Skill 文件夹',
      skillFolderDefault: '默认',
      skillFolderCustom: '自定义',
      skillsAvailable: '可用 Skill',
      skillFolderApplied: '已应用',
      skillFolderRestartRequired: '需要重启',
      skillFolderNotExists: '文件夹不存在',
      skillFolderApplyFailed: '应用 Skill 文件夹失败',
      resetSkillFolderDefault: '还原默认',
      skillFolderSavedPath: '当前已保存路径',
      skillFolderStatus: '状态',
      skillFolderChange: '修改 Skill 文件夹',
      skillFolderManageInSettings: '在设置中管理',
      // Agent Guide Download
      downloadAgentGuide: '下载 Agent 接入说明书',
      agentGuideDownloaded: 'Agent 接入说明书已下载',
      agentGuideNoMcpUrl: 'MCP 公网链接未生成，请先启动 MCP 并等待公网地址出现。',
    },
    en: {
      pageTitle: 'WebAI LocalBridge Control Panel',
      subtitle: 'Local file AI access hub — local-only control panel, port 33004',
      primaryFolder: '📂 Primary Folder',
      primaryFolderDesc: 'The primary folder is used by both MCP and the Primary AI File Browser. MCP uses it as the default working folder; available actions follow the Permission Center settings.',
      secondaryFolder: '📂 Secondary Folder',
      secondaryFolderDesc: 'The secondary folder is used only by the Secondary AI File Browser. It does not affect MCP or the Primary AI File Browser.',
      currentSharedFolder: '📂 Current Shared Folder',
      currentSharedFolderDesc: 'After changing it, the AI File Browser and MCP will read the new folder immediately. No service restart is required.',
      primaryAiBrowser: '🌐 Primary AI File Browser',
      primaryAiBrowserDesc: 'Read-only web entry point for Web AI to inspect the primary folder.',
      mcp: '🤖 MCP',
      mcpDesc: 'For AI clients that support MCP. It provides file, document, task, log, and command tools according to current permissions.',
      secondaryAiBrowser: '🌐 Secondary AI File Browser',
      secondaryAiBrowserDesc: 'Read-only web entry point for Web AI to inspect the secondary folder.',
      localUrl: 'Local URL',
      publicUrl: 'Public URL',
      selectFolder: 'Select Folder',
      apply: 'Apply',
      start: 'Start',
      stop: 'Stop',
      open: 'Open',
      copyPublicUrl: 'Copy Public URL',
      runtimeLogs: '📋 Runtime Logs',
      waitingLogs: 'Waiting for logs...',
      notConnected: 'Not connected',
      notSet: 'Not set',
      checking: 'Checking...',
      runningLocalNoPublic: 'Running locally, public URL not connected',
      publicWithoutLocal: 'Error: public URL exists but local service is unavailable',
      aiBrowserStarting: 'AI File Browser is starting. The public URL will appear when the tunnel is ready...',
      aiBrowserStopping: 'AI File Browser is stopping...',
      aiBrowserReady: 'AI File Browser is ready ✓',
      aiBrowserFailed: 'AI File Browser failed to start',
      mcpStarting: 'MCP is starting. The public URL will appear when the tunnel is ready...',
      mcpStopping: 'MCP is stopping...',
      mcpReady: 'MCP is ready ✓',
      mcpFailed: 'MCP failed to start',
      secondaryStarting: 'Secondary AI File Browser is starting. The public URL will appear when the tunnel is ready...',
      secondaryStopping: 'Secondary AI File Browser is stopping...',
      secondaryReady: 'Secondary AI File Browser is ready ✓',
      secondaryFailed: 'Secondary AI File Browser failed to start',
      stoppedToast: 'stopped',
      copiedPublicUrl: 'Public URL copied',
      publicUrlNotReady: 'Public URL is not ready. Start the service and wait for the public URL to appear.',
      openLocalUrl: 'Public URL is not connected. Opening the local URL.',
      rootChanged: 'Shared folder changed to: ',
      secondaryRootChanged: 'Secondary browser folder has been set',
      requestFailed: 'Request failed: ',
      requestError: 'Error: ',
      inputPathRequired: 'Enter a folder path',
      setFailed: 'Set failed: ',
      switchFailed: 'Switch failed: ',
      selectFolderTitle: 'Select Folder',
      selectSecondaryFolderTitle: 'Select Secondary Browser Folder',
      enterPathOrBrowse: 'Enter a path or browse...',
      enterPath: 'Enter a path...',
      go: 'Go',
      cancel: 'Cancel',
      selectThisFolder: 'Select This Folder',
      applying: 'Applying...',
      loading: 'Loading...',
      parentFolder: 'Parent folder',
      noSubfolders: 'No subfolders',
      selectFolderFirst: 'Select a folder first',
      advancedPermission: 'File Write/Delete',
      advDesc: 'When off, MCP file tools are read-only. When on, MCP may write, edit, delete, move files, create directories, and remove directories. Removing a non-empty directory requires recursive:true.',
      advOff: 'Off',
      advOn: 'On',
      advOffNote: 'Current status: File Write/Delete is Off. MCP file tools are read-only.',
      advOnNote: 'Current status: File Write/Delete is On. MCP file tools may write and delete.',
      advFixedNote: 'Removing a non-empty directory requires recursive:true.',
      // Permission Center
      permCenter: '🔐 MCP Permission Center',
      rootBoundary: 'Root Boundary',
      rootOnly: 'Root Only',
      crossRoot: 'Cross Root',
      fileFastConfirm: 'File Write/Delete',
      fileWriteDeleteDesc: 'When off, MCP file tools are read-only. When on, MCP may write, edit, delete, move files, create directories, and remove directories. Removing a non-empty directory requires recursive:true.',
      commandExecution: 'Command Execution',
      cmdRequiresCrossRootToast: 'Enable Cross Root before enabling Command Execution',
      cmdRequiresCrossRootHint: 'Requires Cross Root',
      cmdShortHint: 'High-risk capability. Requires Cross Root.',
      cmdRiskDialogTitle: 'Enable Command Execution?',
      cmdRiskDialogBody: 'After enabling this, AI can run local commands. Commands may read, write, move, or delete files, and may bypass file-tool write/delete restrictions.\\n\\nEnable only when needed.',
      cmdRiskDialogConfirm: 'I understand, enable',
      cmdRiskDialogCancel: 'Cancel',
      fileWriteDeleteShortDesc: 'Controls whether MCP file tools can write, edit, delete, and move files.',
      rootOnlyReadOnlyMode: 'Current mode is root-only read-only',
      crossRootFileAccessMode: 'Current mode allows cross-root file access',
      permNotes: '📖 Permission Notes',
      permNotesBody: '<b>Root Boundary</b><br>Root Only: file tools can only operate inside rootDir. Command Execution cannot be enabled.<br>Cross Root: file tools may use absolute paths outside rootDir. Required before Command Execution.<br><br><b>Command Execution</b><br>Requires Cross Root first. A risk confirmation is shown when enabling.<br>When disabled, starting new commands is rejected, but process_list, process_logs, process_stop, and task_list remain available.<br><br><b>File Write/Delete</b><br>When off, MCP file tools are read-only.<br>When on, MCP may write, edit, delete, move files, create directories, and remove directories. Removing a non-empty directory requires recursive:true.<br>Affects file tools only, not Command Execution.',
      on: 'On',
      off: 'Off',
      running: 'running',
      stopped: 'stopped',
      starting: 'starting',
      error: 'error',
      // Frontend Preview
      frontendPreview: '🖥️ Frontend Preview',
      frontendPreviewDesc: 'Expose a running local frontend page as a temporary public URL so Web AI or browser agents can inspect the UI.',
      fpLocalUrl: 'Local Frontend URL',
      fpPublicUrl: 'Public URL',
      fpOpen: 'Open',
      fpCopyPublicUrl: 'Copy Public URL',
      fpNotConnected: 'Not connected',
      tunnelPrefix: 'Tunnel: ',
      fpPlaceholder: 'Example: http://127.0.0.1:5173',
      fpValidationError: 'Enter a valid local frontend URL, for example http://127.0.0.1:5173. Only localhost / 127.0.0.1 is allowed. Do not expose the 33004 control panel or 8081.',
      fpPublicUrlNotReady: 'Public URL is not ready. Start first and wait for the public URL to appear.',
      fpStarting: 'Frontend Preview is starting. The public URL will appear when the tunnel is ready...',
      fpStopping: 'Frontend Preview is stopping...',
      fpReady: 'Frontend Preview is ready ✓',
      fpFailed: 'Frontend Preview failed to start',
      fpSaved: 'Frontend Preview URL saved ✓',
      fpCopied: 'Frontend Preview public URL copied',
      fpOpenLocal: 'Public URL is not connected. Opening the local frontend URL.',
      // Guide
      guideFrontendPreviewTitle: 'Frontend Preview Usage',
      // FAQ
      faq9q: 'What is the difference between Frontend Preview and AI File Browser?',
      faq9a: 'The AI File Browser exposes folder contents, which is useful for inspecting code and files. Frontend Preview exposes a running local web page, which is useful for inspecting the UI. You can use both together: AI File Browser for code, Frontend Preview for the running page.',
      skillFolderTitle: '📚 MCP Skill Folder',
      skillFolderDesc: 'Configure the local Skill Folder used by the MCP skill tool. Default: .agents/skills inside this project.',
      skillFolderCurrent: 'Current MCP Skill Folder',
      skillFolderDefault: 'Default',
      skillFolderCustom: 'Custom',
      skillsAvailable: 'Skills Available',
      skillFolderApplied: 'Applied',
      skillFolderRestartRequired: 'Restart required',
      skillFolderNotExists: 'Folder does not exist',
      skillFolderApplyFailed: 'Failed to apply Skill Folder',
      resetSkillFolderDefault: 'Reset to Default',
      skillFolderSavedPath: 'Current saved path',
      skillFolderStatus: 'Status',
      skillFolderChange: 'Change Skill Folder',
      skillFolderManageInSettings: 'Manage in Settings',
      // Agent Guide Download
      downloadAgentGuide: 'Download Agent Guide',
      agentGuideDownloaded: 'Agent guide downloaded',
      agentGuideNoMcpUrl: 'MCP public URL is not ready. Start MCP and wait for the public URL to appear.',
    }
  };

  let lastStatus = null;
  function ui(key) {
    return (uiText[currentLang] && uiText[currentLang][key]) || key;
  }
  function isHttpUrl(value) {
    return typeof value === 'string' && new RegExp('^https?://', 'i').test(value.trim());
  }
  function formatConnectionText(value) {
    return isHttpUrl(value) ? value.trim() : ui('notConnected');
  }
  function formatOptionalPath(value) {
    return value ? value : ui('notSet');
  }
  function formatStatusLabel(status) {
    const raw = status || 'stopped';
    if (['running', 'stopped', 'starting', 'error'].includes(raw)) {
      return ui(raw);
    }
    return raw;
  }
  function formatServiceDisplay(rawStatus, displayText) {
    const raw = rawStatus || 'stopped';
    const text = displayText || raw;
    if (typeof text === 'string' && text.includes('本地运行')) return ui('runningLocalNoPublic');
    if (typeof text === 'string' && text.includes('公网存在')) return ui('publicWithoutLocal');
    if (['running', 'stopped', 'starting', 'error'].includes(raw)) {
      return ui(raw);
    }
    return text;
  }
  function setText(el, value) {
    if (el) el.textContent = value;
  }
  function setButtonText(button, value) {
    if (button) button.textContent = value;
  }
  function setCardText(card, title, desc) {
    if (!card) return;
    setText(card.querySelector('.card-title'), title);
    setText(card.querySelector('.card-desc'), desc);
  }
  function setServicePanelText(panel, title, desc) {
    if (!panel) return;
    const titleEl = panel.querySelector('.card-title');
    if (titleEl) {
      let textNode = Array.from(titleEl.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (!textNode) {
        textNode = document.createTextNode('');
        titleEl.insertBefore(textNode, titleEl.firstChild);
      }
      textNode.nodeValue = title + ' ';
    }
    setText(panel.querySelector('.card-desc'), desc);
  }
  function enforceUrlEmptyStates() {
    const fallback = ui('notConnected');
    const writeFallback = (node, value) => {
      if (!node) return;
      while (node.firstChild) node.removeChild(node.firstChild);
      node.appendChild(document.createTextNode(value));
    };
    ['ai-public-url', 'mcp-public-url', 'sec-ai-public-url', 'fp-public-url'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      let fallbackEl = el.parentElement ? el.parentElement.querySelector('.url-empty-state') : null;
      if (!fallbackEl && el.parentElement) {
        fallbackEl = document.createElement('span');
        fallbackEl.className = 'url-value dim url-empty-state';
        el.parentElement.appendChild(fallbackEl);
      }
      if (!new RegExp('^https?://', 'i').test((el.textContent || '').trim())) {
        el.textContent = '';
        writeFallback(fallbackEl, fallback);
      } else if (fallbackEl) {
        writeFallback(fallbackEl, '');
      }
    });
  }
  function renderPublicUrl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    let fallbackEl = el.parentElement ? el.parentElement.querySelector('.url-empty-state') : null;
    if (!fallbackEl && el.parentElement) {
      fallbackEl = document.createElement('span');
      fallbackEl.className = 'url-value dim url-empty-state';
      el.parentElement.appendChild(fallbackEl);
    }
    if (new RegExp('^https?://', 'i').test((value || '').trim())) {
      el.textContent = value.trim();
      el.classList.remove('dim');
      if (fallbackEl) fallbackEl.textContent = '';
    } else {
      el.textContent = '';
      el.classList.add('dim');
      if (fallbackEl) {
        while (fallbackEl.firstChild) fallbackEl.removeChild(fallbackEl.firstChild);
        fallbackEl.appendChild(document.createTextNode(ui('notConnected')));
      }
    }
  }
  function applyMainI18n() {
    document.title = ui('pageTitle');
    setText(document.querySelector('#page-title-text'), ui('pageTitle'));
    setText(document.querySelector('.subtitle'), ui('subtitle'));

    const primaryCard = document.querySelector('.primary-folder-card');
    const secondaryCard = document.querySelector('.secondary-folder-card');
    const mcpPanel = document.querySelector('.mcp-wide-row');
    const primaryAiPanel = document.querySelector('.ai-browser-row');
    const secondaryAiPanel = document.querySelector('.secondary-service');

    setText(document.getElementById('primary-folder-title'), ui('primaryFolder'));
    setText(document.getElementById('primary-folder-desc'), ui('primaryFolderDesc'));
    const rootButtons = primaryCard ? primaryCard.querySelector('.folder-root-section').querySelectorAll('button') : [];
    setButtonText(rootButtons[0], ui('selectFolder'));
    setButtonText(rootButtons[1], ui('apply'));

    setText(document.getElementById('secondary-folder-title'), ui('secondaryFolder'));
    setText(document.getElementById('secondary-folder-desc'), ui('secondaryFolderDesc'));
    const secRootButtons = secondaryCard ? secondaryCard.querySelector('.folder-root-section').querySelectorAll('button') : [];
    setButtonText(secRootButtons[0], ui('selectFolder'));
    setButtonText(secRootButtons[1], ui('apply'));

    // MCP uses different structure (service-title-wrap + service-description)
    if (mcpPanel) {
      const mcpTitleEl = mcpPanel.querySelector('.service-title-wrap .card-title');
      if (mcpTitleEl) {
        let textNode = Array.from(mcpTitleEl.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        if (!textNode) {
          textNode = document.createTextNode('');
          mcpTitleEl.insertBefore(textNode, mcpTitleEl.firstChild);
        }
        textNode.nodeValue = ui('mcp') + ' ';
      }
      setText(document.getElementById('mcp-desc'), ui('mcpDesc'));
    }
    setServicePanelText(primaryAiPanel, ui('primaryAiBrowser'), ui('primaryAiBrowserDesc'));
    setServicePanelText(secondaryAiPanel, ui('secondaryAiBrowser'), ui('secondaryAiBrowserDesc'));
    [primaryAiPanel, secondaryAiPanel].forEach(panel => {
      if (!panel) return;
      const labels = panel.querySelectorAll('.url-label');
      setText(labels[0], ui('localUrl'));
      setText(labels[1], ui('publicUrl'));
    });
    // MCP URL labels
    if (mcpPanel) {
      const mcpLabels = mcpPanel.querySelectorAll('.url-label');
      setText(mcpLabels[0], ui('localUrl'));
      setText(mcpLabels[1], ui('publicUrl'));
    }

    const mcpButtons = mcpPanel ? mcpPanel.querySelectorAll('.service-actions-inline button') : [];
    setButtonText(mcpButtons[0], ui('start'));
    setButtonText(mcpButtons[1], ui('stop'));
    setButtonText(mcpButtons[2], ui('copyPublicUrl'));

    const aiButtons = primaryAiPanel ? primaryAiPanel.querySelectorAll('.btn-row button') : [];
    setButtonText(aiButtons[0], ui('start'));
    setButtonText(aiButtons[1], ui('stop'));
    setButtonText(aiButtons[2], ui('open'));
    setButtonText(aiButtons[3], ui('copyPublicUrl'));

    const secButtons = secondaryAiPanel ? secondaryAiPanel.querySelectorAll('.btn-row button') : [];
    setButtonText(secButtons[0], ui('start'));
    setButtonText(secButtons[1], ui('stop'));
    setButtonText(secButtons[2], ui('open'));
    setButtonText(secButtons[3], ui('copyPublicUrl'));

    const logTitle = document.querySelector('.below-main-section .card-title');
    setText(logTitle, ui('runtimeLogs'));
    const logBox = document.getElementById('log-box');
    if (logBox && (!lastStatus || !lastStatus.logs || lastStatus.logs.length === 0)) {
      logBox.textContent = ui('waitingLogs');
    }
    ['ai-public-url', 'mcp-public-url', 'sec-ai-public-url', 'fp-public-url'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !isHttpUrl(el.textContent)) {
        el.textContent = ui('notConnected');
        el.classList.add('dim');
      }
    });
    const secRootDisplay = document.getElementById('sec-rootdir-display');
    if (secRootDisplay && !secRootDisplay.textContent.trim()) {
      secRootDisplay.textContent = ui('notSet');
    }

    // Permission Center labels
    setText(document.getElementById('perm-center-title'), ui('permCenter'));
    setText(document.getElementById('perm-root-label'), ui('rootBoundary'));
    setText(document.getElementById('perm-fast-label'), ui('fileFastConfirm'));
    setText(document.getElementById('perm-cmd-label'), ui('commandExecution'));
    const fastHint = document.getElementById('perm-fast-hint');
    if (fastHint) fastHint.textContent = ui('fileWriteDeleteShortDesc');
    setText(document.getElementById('cmd-risk-dialog-title'), ui('cmdRiskDialogTitle'));
    const riskBody = document.getElementById('cmd-risk-dialog-body');
    if (riskBody) riskBody.textContent = ui('cmdRiskDialogBody');
    setButtonText(document.getElementById('cmd-risk-dialog-cancel'), ui('cmdRiskDialogCancel'));
    setButtonText(document.getElementById('cmd-risk-dialog-confirm'), ui('cmdRiskDialogConfirm'));
    setText(document.getElementById('perm-notes-title'), ui('permNotes'));
    const permNotesContent = document.getElementById('perm-notes-content');
    if (permNotesContent) permNotesContent.innerHTML = ui('permNotesBody');
    renderPermissionCenter();
    setText(document.getElementById('mcp-skill-settings-link'), ui('skillFolderManageInSettings'));

    // Skill Folder Settings Section
    setText(document.getElementById('settings-skill-folder-title'), ui('skillFolderTitle'));
    setText(document.getElementById('settings-skill-folder-desc'), ui('skillFolderDesc'));
    setText(document.getElementById('settings-skill-folder-saved-label'), ui('skillFolderSavedPath'));
    setText(document.getElementById('settings-skill-folder-status-label'), ui('skillFolderStatus'));
    setText(document.getElementById('settings-skill-folder-change-label'), ui('skillFolderChange'));
    setButtonText(document.getElementById('skill-folder-browse-btn'), ui('selectFolder'));
    setButtonText(document.getElementById('skill-folder-apply-btn'), ui('apply'));
    setButtonText(document.getElementById('skill-folder-reset-btn'), ui('resetSkillFolderDefault'));
    if (lastStatus && lastStatus.skillFolder) renderSkillFolderUI(lastStatus.skillFolder);

    // Frontend Preview card i18n
    const fpTitleEl = document.getElementById('frontend-preview-title');
    if (fpTitleEl) {
      let textNode = Array.from(fpTitleEl.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (!textNode) {
        textNode = document.createTextNode('');
        fpTitleEl.insertBefore(textNode, fpTitleEl.firstChild);
      }
      textNode.nodeValue = ui('frontendPreview') + ' ';
    }
    setText(document.getElementById('frontend-preview-desc'), ui('frontendPreviewDesc'));
    setText(document.getElementById('fp-local-label'), ui('fpLocalUrl'));
    setText(document.getElementById('fp-pub-label'), ui('fpPublicUrl'));
    setButtonText(document.getElementById('fp-save-btn'), currentLang === 'en' ? 'Save' : '保存');
    setButtonText(document.getElementById('fp-start-btn'), ui('start'));
    setButtonText(document.getElementById('fp-stop-btn'), ui('stop'));
    setButtonText(document.getElementById('fp-open-btn'), ui('fpOpen'));
    setButtonText(document.getElementById('fp-copy-btn'), ui('fpCopyPublicUrl'));
    const fpLocalInput = document.getElementById('fp-local-url');
    if (fpLocalInput) fpLocalInput.placeholder = ui('fpPlaceholder');
    // Update public URL empty state
    const fpPubEl = document.getElementById('fp-public-url');
    if (fpPubEl && !isHttpUrl(fpPubEl.textContent)) {
      fpPubEl.textContent = ui('fpNotConnected');
      fpPubEl.classList.add('dim');
    }

    enforceUrlEmptyStates();
  }
  function renderPermissionCenter() {
    const s = lastStatus || {};
    const rootMode = s.rootBoundaryMode || 'root-only';
    const fastConfirm = !!s.fileFastConfirm;
    const cmdExec = !!s.commandExecution;
    const crossRoot = rootMode === 'cross-root';

    // Root boundary buttons
    const rootOnlyBtn = document.getElementById('perm-root-only-btn');
    const crossRootBtn = document.getElementById('perm-cross-root-btn');
    if (rootOnlyBtn && crossRootBtn) {
      rootOnlyBtn.className = 'btn perm-btn' + (rootMode === 'root-only' ? ' perm-active' : '');
      rootOnlyBtn.textContent = rootMode === 'root-only' ? (currentLang === 'en' ? 'Root Only ✅' : '仅 root 内 ✅') : (currentLang === 'en' ? 'Root Only' : '仅 root 内');
      crossRootBtn.className = 'btn perm-btn' + (rootMode === 'cross-root' ? ' perm-warn' : '');
      crossRootBtn.textContent = rootMode === 'cross-root' ? (currentLang === 'en' ? 'Cross Root ✅' : '允许跨 root ✅') : (currentLang === 'en' ? 'Cross Root' : '允许跨 root');
    }

    // File Write/Delete buttons
    const fastOffBtn = document.getElementById('perm-fast-off-btn');
    const fastOnBtn = document.getElementById('perm-fast-on-btn');
    if (fastOffBtn && fastOnBtn) {
      fastOffBtn.className = 'btn perm-btn' + (!fastConfirm ? ' perm-active' : '');
      fastOffBtn.textContent = !fastConfirm ? (currentLang === 'en' ? 'Off ✅' : '关闭 ✅') : (currentLang === 'en' ? 'Off' : '关闭');
      fastOnBtn.className = 'btn perm-btn' + (fastConfirm ? ' perm-active' : '');
      fastOnBtn.textContent = fastConfirm ? (currentLang === 'en' ? 'On ✅' : '开启 ✅') : (currentLang === 'en' ? 'On' : '开启');
    }

    // Command execution buttons
    const cmdOffBtn = document.getElementById('perm-cmd-off-btn');
    const cmdOnBtn = document.getElementById('perm-cmd-on-btn');
    const cmdHint = document.getElementById('perm-cmd-hint');
    if (cmdOffBtn && cmdOnBtn) {
      const effectiveCmd = crossRoot ? cmdExec : false;
      cmdOffBtn.className = 'btn perm-btn' + (!effectiveCmd ? ' perm-active' : '');
      cmdOffBtn.textContent = !effectiveCmd ? (currentLang === 'en' ? 'Off ✅' : '关闭 ✅') : (currentLang === 'en' ? 'Off' : '关闭');
      cmdOnBtn.className = 'btn perm-btn' + (effectiveCmd ? ' perm-active' : '');
      cmdOnBtn.textContent = effectiveCmd ? (currentLang === 'en' ? 'On ✅' : '开启 ✅') : (currentLang === 'en' ? 'On' : '开启');
      cmdOnBtn.disabled = !crossRoot;
      cmdOnBtn.style.opacity = crossRoot ? '1' : '0.45';
      cmdOnBtn.style.cursor = crossRoot ? 'pointer' : 'not-allowed';
    }
    if (cmdHint) {
      if (!crossRoot) {
        cmdHint.textContent = ui('cmdRequiresCrossRootHint');
        cmdHint.style.display = 'block';
      } else {
        cmdHint.style.display = 'none';
        cmdHint.textContent = '';
      }
    }
    const fastHint = document.getElementById('perm-fast-hint');
    if (fastHint) fastHint.textContent = ui('fileWriteDeleteShortDesc');
  }

  let cmdRiskDialogResolver = null;
  function showCommandExecutionRiskDialog() {
    return new Promise((resolve) => {
      const overlay = document.getElementById('cmd-risk-modal-overlay');
      if (!overlay) {
        resolve(false);
        return;
      }
      setText(document.getElementById('cmd-risk-dialog-title'), ui('cmdRiskDialogTitle'));
      const bodyEl = document.getElementById('cmd-risk-dialog-body');
      if (bodyEl) bodyEl.textContent = ui('cmdRiskDialogBody');
      setButtonText(document.getElementById('cmd-risk-dialog-cancel'), ui('cmdRiskDialogCancel'));
      setButtonText(document.getElementById('cmd-risk-dialog-confirm'), ui('cmdRiskDialogConfirm'));
      cmdRiskDialogResolver = resolve;
      overlay.classList.add('open');
    });
  }
  function closeCommandExecutionRiskDialog(confirmed) {
    const overlay = document.getElementById('cmd-risk-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    if (cmdRiskDialogResolver) {
      cmdRiskDialogResolver(!!confirmed);
      cmdRiskDialogResolver = null;
    }
  }
  function renderStatusI18n(s) {
    if (!s) return;
    lastStatus = s;
    const rdEl = document.getElementById('rootdir-display');
    setText(rdEl, s.rootDir || '');
    const inputEl = document.getElementById('root-dir');
    if (inputEl && document.activeElement !== inputEl) inputEl.value = s.rootDir || '';

    const aiBadge = document.getElementById('ai-badge');
    if (aiBadge) {
      aiBadge.textContent = formatServiceDisplay(s.aiBrowser, s.aiBrowserDisplay);
      aiBadge.className = 'badge ' + badgeClass(s.aiBrowser);
    }
    const aiPubEl = document.getElementById('ai-public-url');
    if (aiPubEl) {
      renderPublicUrl('ai-public-url', s.effectivePublicUrls?.aiBrowser || s.aiBrowserTunnelUrl);
    }
    const aiNote = document.getElementById('ai-status-note');
    if (aiNote) {
      aiNote.textContent = '';
      aiNote.style.display = 'none';
    }

    const mcpBadge = document.getElementById('mcp-badge');
    if (mcpBadge) {
      mcpBadge.textContent = formatServiceDisplay(s.mcp, s.mcpDisplay);
      mcpBadge.className = 'badge ' + badgeClass(s.mcp);
    }
    const mcpPubEl = document.getElementById('mcp-public-url');
    if (mcpPubEl) {
      renderPublicUrl('mcp-public-url', s.effectivePublicUrls?.mcp || s.mcpTunnelMcpUrl || '');
    }
    const mcpNote = document.getElementById('mcp-status-note');
    if (mcpNote) {
      mcpNote.textContent = '';
      mcpNote.style.display = 'none';
    }

    renderPermissionCenter();

    const secBadge = document.getElementById('sec-ai-badge');
    if (secBadge) {
      secBadge.textContent = formatServiceDisplay(s.secondaryAiBrowser, s.secondaryAiBrowserDisplay);
      secBadge.className = 'badge ' + badgeClass(s.secondaryAiBrowser);
    }
    const secPubEl = document.getElementById('sec-ai-public-url');
    if (secPubEl) {
      renderPublicUrl('sec-ai-public-url', s.effectivePublicUrls?.secondaryAiBrowser || s.secondaryAiBrowserTunnelUrl);
    }
    const secNote = document.getElementById('sec-ai-status-note');
    if (secNote) {
      secNote.textContent = '';
      secNote.style.display = 'none';
    }
    const secRdEl = document.getElementById('sec-rootdir-display');
    setText(secRdEl, formatOptionalPath(s.secondaryAiBrowserRootDir));
    const secInputEl = document.getElementById('sec-root-dir');
    if (secInputEl && document.activeElement !== secInputEl) secInputEl.value = s.secondaryAiBrowserRootDir || '';

    // ── Frontend Preview ─────────────────────────────────────────────────
    // Badge
    const fpBadge = document.getElementById('fp-badge');
    if (fpBadge) {
      fpBadge.textContent = formatServiceDisplay(s.frontendPreview, s.frontendPreviewDisplay);
      fpBadge.className = 'badge ' + badgeClass(s.frontendPreview);
    }
    // Fixed domain mode: lock local URL to 127.0.0.1:5173
    const fpLocalInput = document.getElementById('fp-local-url');
    const fpSaveBtn = document.getElementById('fp-save-btn');
    const fpFixedEnabled = s.fixedTunnel && s.fixedTunnel.enabled && s.fixedTunnel.frontendPreviewFixedEnabled && s.fixedTunnel.baseDomain;
    if (fpFixedEnabled) {
      if (fpLocalInput) {
        fpLocalInput.value = 'http://127.0.0.1:5173/';
        fpLocalInput.readOnly = true;
        fpLocalInput.style.opacity = '0.6';
      }
      if (fpSaveBtn) fpSaveBtn.style.display = 'none';
    } else {
      if (fpLocalInput) {
        if (document.activeElement !== fpLocalInput) {
          fpLocalInput.value = s.frontendPreviewLocalUrl || '';
        }
        fpLocalInput.readOnly = false;
        fpLocalInput.style.opacity = '1';
      }
      if (fpSaveBtn) fpSaveBtn.style.display = '';
    }
    // Public URL — fixed URL priority (effectivePublicUrls handles fixedTunnel logic)
    renderPublicUrl('fp-public-url', s.effectivePublicUrls?.frontendPreview || s.frontendPreviewTunnelUrl);
    const fpNote = document.getElementById('fp-status-note');
    if (fpNote) {
      const note = s.frontendPreviewDisplay && s.frontendPreviewDisplay !== s.frontendPreview ? formatServiceDisplay(s.frontendPreview, s.frontendPreviewDisplay) : '';
      fpNote.textContent = note;
      fpNote.style.display = note ? 'block' : 'none';
    }

    const logBox = document.getElementById('log-box');
    if (logBox) {
      if (s.logs && s.logs.length > 0) {
        logBox.innerHTML = s.logs.map(l => '<div>' + l + '</div>').join('');
        logBox.scrollTop = logBox.scrollHeight;
      } else {
        logBox.textContent = ui('waitingLogs');
      }
    }
    // Update fixed tunnel status bar in settings modal (if open)
    if (typeof updateFixedTunnelStatusBar === 'function' && s.fixedTunnelStatus) {
      updateFixedTunnelStatusBar(s.fixedTunnelStatus);
    }
    // v3.5.6: Show notification if startup recovery triggered and tunnel is now running
    if (s.fixedTunnelStartupRecoveryNotice && s.fixedTunnelStartupRecoveryNotice.type === 'fixedTunnelStarted') {
      const noticeTs = s.fixedTunnelStartupRecoveryNotice.ts || 0;
      if (noticeTs > lastFixedTunnelStartupNoticeTs && s.fixedTunnelStatus === 'running') {
        const msg = currentLang === 'en' ? 'Fixed Domain Tunnel started' : '固定域名 Tunnel 已启动';
        if (typeof showToast === 'function') showToast(msg);
        lastFixedTunnelStartupNoticeTs = noticeTs;
      }
    }
    enforceUrlEmptyStates();

    // Skill Folder (v3.4.8) — render from status
    if (s.skillFolder) renderSkillFolderUI(s.skillFolder);
  }

  // ── Skill Folder independent loader (v3.4.8) ─────────────────────────────
  // Used on page init and as fallback when /api/status does not include skillFolder.
  let _skillFolderLoading = false;
  async function loadSkillFolder() {
    if (_skillFolderLoading) return;
    _skillFolderLoading = true;
    try {
      const data = await requestJson('/api/skill-folder', { method: 'GET' });
      if (data && data.ok) renderSkillFolderUI(data);
    } catch (e) {
      // Do not break the control panel if this fails.
    } finally {
      _skillFolderLoading = false;
    }
  }

  const baseApplyTranslations = applyTranslations;
  applyTranslations = function() {
    baseApplyTranslations();
    applyMainI18n();
    if (lastStatus) renderStatusI18n(lastStatus);
  };
  switchLang = function(lang) {
    currentLang = lang;
    localStorage.setItem('mcpTunnelLang', lang);
    applyTranslations();
    refresh();
  };
  showToast = function(msg, isError) {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.background = isError ? '#da3633' : '#238636';
    toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  };
  function requestJson(url, options) {
    const opts = options || {};
    if (typeof fetch === 'function') {
      return fetch(url, opts).then(async res => {
        const data = await res.json();
        if (!res.ok) {
          const err = new Error((data && data.error) || res.status);
          err.data = data;
          throw err;
        }
        return data;
      });
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(opts.method || 'GET', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function() {
        let data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = {}; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          const err = new Error((data && data.error) || xhr.status);
          err.data = data;
          reject(err);
        }
      };
      xhr.onerror = function() { reject(new Error('network error')); };
      xhr.send(opts.body || null);
    });
  }
  call = async function(url, method, body) {
    try {
      const opts = { method: method || 'POST', headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      return await requestJson(url, opts);
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
      return null;
    }
  };
  fetchStatus = async function() {
    try {
      return await requestJson('/api/status', { method: 'GET' });
    } catch {
      return null;
    }
  };
  refresh = async function() {
    const s = await fetchStatus();
    if (!s) return;
    renderStatusI18n(s);
  };
  doStart = async function(service) {
    const map = { 'ai-browser': '/api/start-ai-browser', 'mcp': '/api/start-mcp', 'sec-ai-browser': '/api/start-secondary-ai-browser' };
    const startMsg = { 'ai-browser': 'aiBrowserStarting', 'mcp': 'mcpStarting', 'sec-ai-browser': 'secondaryStarting' };
    const readyMsg = { 'ai-browser': 'aiBrowserReady', 'mcp': 'mcpReady', 'sec-ai-browser': 'secondaryReady' };
    const failMsg = { 'ai-browser': 'aiBrowserFailed', 'mcp': 'mcpFailed', 'sec-ai-browser': 'secondaryFailed' };
    showToast(ui(startMsg[service]));
    await call(map[service]);
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
      await sleep(2000);
      const s = await fetchStatus();
      if (!s) break;
      renderStatusI18n(s);
      if (service === 'ai-browser' && s.aiBrowserTunnelUrl) { showToast(ui(readyMsg[service])); break; }
      if (service === 'mcp' && s.mcpTunnelMcpUrl) { showToast(ui(readyMsg[service])); break; }
      if (service === 'sec-ai-browser' && s.secondaryAiBrowserTunnelUrl) { showToast(ui(readyMsg[service])); break; }
      if (service === 'ai-browser' && s.aiBrowser === 'error') { showToast(ui(failMsg[service]), true); break; }
      if (service === 'mcp' && s.mcp === 'error') { showToast(ui(failMsg[service]), true); break; }
      if (service === 'sec-ai-browser' && s.secondaryAiBrowser === 'error') { showToast(ui(failMsg[service]), true); break; }
    }
    refresh();
  };
  doStop = async function(service) {
    const map = { 'ai-browser': '/api/stop-ai-browser', 'mcp': '/api/stop-mcp', 'sec-ai-browser': '/api/stop-secondary-ai-browser' };
    const stopMsg = { 'ai-browser': 'aiBrowserStopping', 'mcp': 'mcpStopping', 'sec-ai-browser': 'secondaryStopping' };
    showToast(ui(stopMsg[service]));
    await call(map[service]);
    showToast(ui('stoppedToast'));
    refresh();
  };
  function getVisiblePublicUrl(id) {
    const value = (document.getElementById(id)?.textContent || '').trim();
    return isHttpUrl(value) ? value : '';
  }
  openAiBrowser = function() {
    const url = getVisiblePublicUrl('ai-public-url') || 'http://127.0.0.1:${AI_API_PORT}/';
    if (!getVisiblePublicUrl('ai-public-url')) showToast(ui('openLocalUrl'));
    window.open(url, '_blank');
  };
  openSecondaryAiBrowser = function() {
    const url = getVisiblePublicUrl('sec-ai-public-url') || 'http://127.0.0.1:${SECONDARY_AI_API_PORT}/';
    if (!getVisiblePublicUrl('sec-ai-public-url')) showToast(ui('openLocalUrl'));
    window.open(url, '_blank');
  };
  copyAiBrowser = async function() {
    const url = getVisiblePublicUrl('ai-public-url');
    if (!url) return showToast(ui('publicUrlNotReady'), true);
    await copyToClipboard(url);
    showToast(ui('copiedPublicUrl'));
  };
  copyMcp = async function() {
    const url = getVisiblePublicUrl('mcp-public-url');
    if (!url) return showToast(ui('publicUrlNotReady'), true);
    await copyToClipboard(url);
    showToast(ui('copiedPublicUrl'));
  };
  copySecondaryAiBrowser = async function() {
    const url = getVisiblePublicUrl('sec-ai-public-url');
    if (!url) return showToast(ui('publicUrlNotReady'), true);
    await copyToClipboard(url);
    showToast(ui('copiedPublicUrl'));
  };
  // ── Frontend Preview functions ─────────────────────────────────────────
  saveFrontendPreviewUrl = async function() {
    const input = document.getElementById('fp-local-url');
    const url = input ? input.value.trim() : '';
    if (!url) return showToast(ui('fpValidationError'), true);
    const data = await call('/api/set-frontend-preview-url', 'POST', { url });
    if (data && data.ok) {
      showToast(ui('fpSaved'));
      refresh();
    }
  };
  doStartFrontendPreview = async function() {
    // Save URL first if input has a value
    const input = document.getElementById('fp-local-url');
    const url = input ? input.value.trim() : '';
    if (url) {
      const saveData = await call('/api/set-frontend-preview-url', 'POST', { url });
      if (!saveData || !saveData.ok) return;
    }
    showToast(ui('fpStarting'));
    await call('/api/start-frontend-preview-tunnel');
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
      await sleep(2000);
      const s = await fetchStatus();
      if (!s) break;
      renderStatusI18n(s);
      if (s.frontendPreviewTunnelUrl) { showToast(ui('fpReady')); break; }
      if (s.frontendPreview === 'error') { showToast(ui('fpFailed'), true); break; }
    }
    refresh();
  };
  doStopFrontendPreview = async function() {
    showToast(ui('fpStopping'));
    await call('/api/stop-frontend-preview-tunnel');
    showToast(ui('stoppedToast'));
    refresh();
  };
  openFrontendPreview = function() {
    const pub = getVisiblePublicUrl('fp-public-url');
    const localInput = document.getElementById('fp-local-url');
    const local = localInput ? localInput.value.trim() : '';
    const url = pub || local;
    if (!url) return showToast(ui('fpValidationError'), true);
    if (!pub && local) showToast(ui('fpOpenLocal'));
    window.open(url, '_blank');
  };
  copyFrontendPreview = async function() {
    const url = getVisiblePublicUrl('fp-public-url');
    if (!url) return showToast(ui('fpPublicUrlNotReady'), true);
    await copyToClipboard(url);
    showToast(ui('fpCopied'));
  };
  // ── Permission Center Functions ──────────────────────────────────────────
  setRootBoundary = async function(mode) {
    if (mode === 'cross-root') {
      const msg = currentLang === 'en'
        ? 'You are allowing MCP to access paths outside rootDir. After enabling this, file tools and command tools may read, write, or delete files outside the root.'
        : '你正在允许 MCP 访问 rootDir 之外的路径。开启后，文件工具和命令工具都可能读取、写入、删除 root 外文件。';
      const confirmBtn = currentLang === 'en' ? 'Confirm Cross Root' : '确认允许跨 root';
      if (!confirm(msg + '\\n\\n' + confirmBtn + '?')) return;
    }
    const data = await call('/api/set-root-boundary-mode', 'POST', { mode });
    if (data && data.ok) {
      if (data.commandExecution === false) {
        lastStatus = Object.assign({}, lastStatus || {}, { rootBoundaryMode: data.rootBoundaryMode, commandExecution: false });
      }
      renderPermissionCenter();
      showToast(ui('rootBoundary') + ': ' + (mode === 'cross-root' ? ui('crossRoot') : ui('rootOnly')));
      refresh();
    }
  };
  setFileFastConfirm = async function(enabled) {
    const data = await call('/api/set-file-fast-confirm', 'POST', { enabled });
    if (data && data.ok) {
      renderPermissionCenter();
      showToast(ui('fileFastConfirm') + ': ' + (enabled ? ui('on') : ui('off')));
    }
  };
  setCommandExecution = async function(enabled) {
    const s = lastStatus || {};
    const rootMode = s.rootBoundaryMode || 'root-only';
    const cmdExec = s.commandExecution === true;

    if (enabled) {
      if (rootMode !== 'cross-root') {
        showToast(ui('cmdRequiresCrossRootToast'), true);
        return;
      }
      if (!cmdExec) {
        const confirmed = await showCommandExecutionRiskDialog();
        if (!confirmed) return;
      }
    }

    const data = await call('/api/set-command-execution', 'POST', { enabled });
    if (data && data.ok) {
      await refresh();
      showToast(ui('commandExecution') + ': ' + (enabled ? ui('on') : ui('off')));
    } else if (data && data.requiresCrossRoot) {
      showToast(ui('cmdRequiresCrossRootToast'), true);
      renderPermissionCenter();
    }
  };
  toggleAdvancedPermission = async function() {
    const data = await call('/api/toggle-advanced-permission', 'POST');
    if (data && data.ok) {
      renderPermissionCenter();
      showToast(ui('fileFastConfirm') + ': ' + (data.fileFastConfirm ? ui('on') : ui('off')));
    }
  };
  setRoot = async function() {
    const dir = (document.getElementById('root-dir')?.value || '').trim();
    if (!dir) return showToast(ui('inputPathRequired'), true);
    const data = await call('/api/set-root', 'POST', { dir });
    if (data && data.ok) {
      showToast(ui('rootChanged') + data.rootDir);
      refresh();
    }
  };
  setSecondaryRoot = async function() {
    const dir = (document.getElementById('sec-root-dir')?.value || '').trim();
    if (!dir) return showToast(ui('inputPathRequired'), true);
    const data = await call('/api/set-secondary-root', 'POST', { dir });
    if (data && data.ok) {
      showToast(ui('secondaryRootChanged'));
      refresh();
    }
  };
  function openFolderPicker(mode) {
    const isSecondary = mode === 'secondary';
    const isSkill = mode === 'skill';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#161b22;padding:20px;border-radius:10px;width:600px;max-height:82vh;overflow:auto;border:1px solid #30363d;';
    const title = document.createElement('h3');
    title.style.cssText = 'margin-bottom:12px;color:#e6edf3;';
    title.textContent = isSkill ? ui('skillFolderTitle') : (isSecondary ? ui('selectSecondaryFolderTitle') : ui('selectFolderTitle'));
    dialog.appendChild(title);
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.placeholder = isSecondary ? ui('enterPath') : ui('enterPathOrBrowse');
    pathInput.style.cssText = 'flex:1;padding:8px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-family:monospace;font-size:0.85em;';
    const goBtn = document.createElement('button');
    goBtn.textContent = ui('go');
    goBtn.style.cssText = 'padding:8px 16px;background:#238636;color:white;border:none;border-radius:6px;cursor:pointer;';
    inputRow.appendChild(pathInput);
    inputRow.appendChild(goBtn);
    dialog.appendChild(inputRow);
    const crumb = document.createElement('div');
    crumb.style.cssText = 'font-size:12px;color:#8b949e;margin-bottom:8px;';
    dialog.appendChild(crumb);
    const list = document.createElement('div');
    list.style.cssText = 'border:1px solid #30363d;border-radius:6px;min-height:280px;max-height:360px;overflow:auto;padding:8px;background:#0d1117;';
    dialog.appendChild(list);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top:14px;display:flex;justify-content:flex-end;gap:8px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = ui('cancel');
    cancelBtn.style.cssText = 'padding:8px 16px;background:#30363d;color:#c9d1d9;border:none;border-radius:6px;cursor:pointer;';
    const selectBtn = document.createElement('button');
    selectBtn.textContent = ui('selectThisFolder');
    selectBtn.style.cssText = 'padding:8px 16px;background:#238636;color:white;border:none;border-radius:6px;cursor:pointer;';
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(selectBtn);
    dialog.appendChild(btnRow);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    let currentPath = '/';
    function loadDir(p) {
      currentPath = p;
      pathInput.value = p;
      crumb.textContent = p;
      list.innerHTML = '<div style="padding:16px;text-align:center;color:#8b949e;">' + ui('loading') + '</div>';
      requestJson('/api/local-dirs?path=' + encodeURIComponent(p), { method: 'GET' })
        .then(data => {
          if (data.error) {
            list.innerHTML = '<div style="padding:16px;color:#f85149;">' + data.error + '</div>';
            return;
          }
          list.innerHTML = '';
          if (data.parent) {
            const parent = document.createElement('div');
            parent.textContent = '.. (' + ui('parentFolder') + ')';
            parent.style.cssText = 'padding:8px;cursor:pointer;color:#58a6ff;border-radius:4px;';
            parent.onmouseover = function() { this.style.background = '#161b22'; };
            parent.onmouseout = function() { this.style.background = ''; };
            parent.onclick = function() { loadDir(data.parent); };
            list.appendChild(parent);
          }
          (data.items || []).forEach(item => {
            const row = document.createElement('div');
            row.textContent = '📁 ' + item.name;
            row.style.cssText = 'padding:8px;cursor:pointer;border-radius:4px;';
            row.onmouseover = function() { this.style.background = '#161b22'; };
            row.onmouseout = function() { this.style.background = ''; };
            row.onclick = function() { loadDir(item.path); };
            list.appendChild(row);
          });
          if (!data.items || data.items.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = ui('noSubfolders');
            empty.style.cssText = 'padding:16px;text-align:center;color:#8b949e;';
            list.appendChild(empty);
          }
        })
        .catch(e => { list.innerHTML = '<div style="padding:16px;color:#f85149;">' + e.message + '</div>'; });
    }
    goBtn.onclick = function() { if (pathInput.value.trim()) loadDir(pathInput.value.trim()); };
    pathInput.onkeypress = function(e) { if (e.key === 'Enter' && pathInput.value.trim()) loadDir(pathInput.value.trim()); };
    cancelBtn.onclick = function() { document.body.removeChild(modal); };
    selectBtn.onclick = async function() {
      const selected = pathInput.value.trim() || currentPath;
      if (!selected || selected === '/') return showToast(ui('selectFolderFirst'), true);
      if (isSkill) {
        const skillInput = document.getElementById('skill-folder-input');
        if (skillInput) { skillInput.value = selected; skillFolderInputDirty = true; }
        document.body.removeChild(modal);
        return;
      }
      selectBtn.disabled = true;
      selectBtn.textContent = ui('applying');
      const endpoint = isSecondary ? '/api/set-secondary-root' : '/api/set-root';
      try {
        const data = await requestJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: selected })
        });
        if (data && data.ok) {
          if (isSecondary) {
            document.getElementById('sec-root-dir').value = data.secondaryAiBrowserRootDir;
            document.getElementById('sec-rootdir-display').textContent = data.secondaryAiBrowserRootDir;
            showToast(ui('secondaryRootChanged'));
          } else {
            document.getElementById('root-dir').value = data.rootDir;
            document.getElementById('rootdir-display').textContent = data.rootDir;
            showToast(ui('rootChanged') + data.rootDir);
          }
          document.body.removeChild(modal);
          refresh();
        } else {
          showToast((isSecondary ? ui('setFailed') : ui('switchFailed')) + ((data && data.error) || 'unknown'), true);
          selectBtn.disabled = false;
          selectBtn.textContent = ui('selectThisFolder');
        }
      } catch (e) {
        showToast(ui('requestFailed') + e.message, true);
        selectBtn.disabled = false;
        selectBtn.textContent = ui('selectThisFolder');
      }
    };
    loadDir('/');
  }
  pickFolder = function() { openFolderPicker('primary'); };
  pickSecondaryFolder = function() { openFolderPicker('secondary'); };
  pickSkillFolder = function() { openFolderPicker('skill'); };
  window.pickSkillFolder = pickSkillFolder;

  // ── Settings Modal (v3.4.3) ────────────────────────────────────────────────

  function openSettingsModal() {
    document.getElementById('settings-modal-overlay').classList.add('open');
    loadFixedTunnelSettings();
    loadSkillFolder();
    bindSkillFolderInputDirtyTracking();
  }
  window.openSettingsModal = openSettingsModal;

  function openSkillFolderSettings() {
    openSettingsModal();
    setTimeout(() => {
      const section = document.getElementById('settings-skill-folder-section');
      if (section) {
        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        section.style.transition = 'box-shadow .2s, border-color .2s';
        section.style.boxShadow = '0 0 0 1px rgba(88,166,255,.65)';
        section.style.borderRadius = '8px';
        setTimeout(() => { section.style.boxShadow = ''; }, 900);
      }
      const input = document.getElementById('skill-folder-input');
      if (input) input.focus({ preventScroll: true });
    }, 80);
  }
  window.openSkillFolderSettings = openSkillFolderSettings;

  function closeSettingsModal() {
    document.getElementById('settings-modal-overlay').classList.remove('open');
  }
  window.closeSettingsModal = closeSettingsModal;

  // Close modal on overlay click
  document.getElementById('settings-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeSettingsModal();
  });

  // Command Execution risk dialog (v3.5.10)
  const cmdRiskOverlay = document.getElementById('cmd-risk-modal-overlay');
  const cmdRiskCancel = document.getElementById('cmd-risk-dialog-cancel');
  const cmdRiskConfirm = document.getElementById('cmd-risk-dialog-confirm');
  if (cmdRiskCancel) cmdRiskCancel.addEventListener('click', () => closeCommandExecutionRiskDialog(false));
  if (cmdRiskConfirm) cmdRiskConfirm.addEventListener('click', () => closeCommandExecutionRiskDialog(true));
  if (cmdRiskOverlay) {
    cmdRiskOverlay.addEventListener('click', function(e) {
      if (e.target === this) closeCommandExecutionRiskDialog(false);
    });
  }

  async function loadFixedTunnelSettings() {
    try {
      const data = await requestJson('/api/fixed-tunnel-settings', { method: 'GET' });
      if (!data) return;
      const ft = data.fixedTunnel || {};
      document.getElementById('fixed-base-domain').value = ft.baseDomain || '';
      document.getElementById('fixed-enabled-toggle').checked = !!ft.enabled;
      document.getElementById('fixed-fp-toggle').checked = !!ft.frontendPreviewFixedEnabled;
      // Token: show directly in password field (toggle visibility with eye button)
      const tokenInput = document.getElementById('fixed-tunnel-token');
      const tokenStatusEl = document.getElementById('fixed-token-status');
      if (ft.hasToken) {
        tokenInput.value = ft.token || '';
        tokenInput.placeholder = '';
        tokenStatusEl.textContent = currentLang === 'en' ? '✅ Token saved' : '✅ Token 已保存';
        tokenStatusEl.style.color = '#3fb950';
      } else {
        tokenInput.value = '';
        tokenInput.placeholder = '';
        tokenStatusEl.textContent = currentLang === 'en' ? '⚠️ No token saved' : '⚠️ 尚未保存 Token';
        tokenStatusEl.style.color = '#8b949e';
      }
      // Keep password type by default
      tokenInput.type = 'password';
      const eyeBtn = document.getElementById('token-eye-btn');
      if (eyeBtn) {
        eyeBtn.innerHTML = '👁';
        eyeBtn.title = currentLang === 'en' ? 'Show' : '显示';
      }
      // Update derived URLs preview
      updateDerivedUrlsPreview(ft.baseDomain || '', ft.frontendPreviewFixedEnabled);
      // Update tunnel status bar
      updateFixedTunnelStatusBar(data.fixedTunnelStatus);
      // v3.5.0: Sync checkbox dependency UI
      syncFixedDraftUiOnly();
    } catch (e) {
      console.error('loadFixedTunnelSettings error:', e);
    }
  }

  function updateDerivedUrlsPreview(baseDomain, includeFp) {
    const d = (baseDomain || '').trim();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (val) {
        el.textContent = val;
        el.classList.remove('du-empty');
      } else {
        el.textContent = '—';
        el.classList.add('du-empty');
      }
    };
    if (d) {
      set('du-mcp', 'https://mcp.' + d + '/mcp');
      set('du-ai', 'https://files.' + d);
      set('du-sec', 'https://files2.' + d);
      set('du-fp', includeFp ? 'https://preview.' + d : '');
    } else {
      set('du-mcp', '');
      set('du-ai', '');
      set('du-sec', '');
      set('du-fp', '');
    }
  }

  // Live preview update on base domain input
  document.getElementById('fixed-base-domain').addEventListener('input', function() {
    const domain = this.value.trim();
    const fpEnabled = document.getElementById('fixed-fp-toggle').checked;
    // Clear error
    const errEl = document.getElementById('fixed-domain-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    updateDerivedUrlsPreview(domain, fpEnabled);
  });
  document.getElementById('fixed-fp-toggle').addEventListener('change', function() {
    const domain = document.getElementById('fixed-base-domain').value.trim();
    updateDerivedUrlsPreview(domain, this.checked);
  });

  // v3.5.0: Main toggle change — only updates UI draft state, never starts/stops tunnels
  document.getElementById('fixed-enabled-toggle').addEventListener('change', function() {
    syncFixedDraftUiOnly();
  });

  /**
   * v3.5.0: Sync Settings checkbox UI draft state only.
   * Disables/enables the Frontend Preview toggle based on main toggle.
   * Does NOT start/stop any tunnel, does NOT call any API, does NOT write config.
   */
  function syncFixedDraftUiOnly() {
    const fixedEnabled = document.getElementById('fixed-enabled-toggle').checked;
    const fpToggle = document.getElementById('fixed-fp-toggle');
    const fpRow = fpToggle ? fpToggle.closest('.toggle-row') : null;
    const domain = document.getElementById('fixed-base-domain').value.trim();

    if (!fixedEnabled) {
      fpToggle.checked = false;
      fpToggle.disabled = true;
      if (fpRow) fpRow.classList.add('disabled-row');
      updateDerivedUrlsPreview(domain, false);
    } else {
      fpToggle.disabled = false;
      if (fpRow) fpRow.classList.remove('disabled-row');
      updateDerivedUrlsPreview(domain, fpToggle.checked);
    }
  }

  function updateFixedTunnelStatusBar(status) {
    const bar = document.getElementById('fixed-tunnel-status-bar');
    if (!bar) return;
    if (!status || status === 'stopped') {
      bar.innerHTML = '<span style="color:#8b949e;">' + (currentLang === 'en' ? 'Fixed Tunnel: stopped' : '固定 Tunnel：已停止') + '</span>';
    } else if (status === 'starting') {
      bar.innerHTML = '<span style="color:#d2991d;">' + (currentLang === 'en' ? 'Fixed Tunnel: starting...' : '固定 Tunnel：启动中...') + '</span>';
    } else if (status === 'running') {
      bar.innerHTML = '<span style="color:#3fb950;">' + (currentLang === 'en' ? 'Fixed Tunnel: running ✓' : '固定 Tunnel：运行中 ✓') + '</span>';
    } else if (status === 'error') {
      bar.innerHTML = '<span style="color:#f85149;">' + (currentLang === 'en' ? 'Fixed Tunnel: error' : '固定 Tunnel：错误') + '</span>';
    }
  }

  window.saveFixedTunnelSettings = async function() {
    const baseDomain = document.getElementById('fixed-base-domain').value.trim();
    const token = document.getElementById('fixed-tunnel-token').value.trim();
    const enabled = document.getElementById('fixed-enabled-toggle').checked;
    const fpEnabled = document.getElementById('fixed-fp-toggle').checked;
    const errEl = document.getElementById('fixed-domain-error');

    // Validate base domain on client side
    if (baseDomain) {
      if (/^https?:\\/\\//i.test(baseDomain)) {
        errEl.textContent = currentLang === 'en' ? 'Do not include https:// or http:// — enter the bare domain only' : '不要包含 https:// 或 http:// — 只填写裸域名';
        errEl.style.display = 'block';
        return;
      }
      if (baseDomain.includes('/')) {
        errEl.textContent = currentLang === 'en' ? 'Domain should not contain a path' : '域名不应包含路径';
        errEl.style.display = 'block';
        return;
      }
      if (/^(localhost|127\\.0\\.0\\.1|\\[?::1\\]?)$/i.test(baseDomain)) {
        errEl.textContent = currentLang === 'en' ? 'localhost / loopback not allowed' : '不允许使用 localhost / loopback';
        errEl.style.display = 'block';
        return;
      }
    }

    // Build request body — always include token and baseDomain (even if empty)
    const body = { baseDomain, token, enabled, frontendPreviewFixedEnabled: fpEnabled };

    try {
      const data = await requestJson('/api/fixed-tunnel-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (data && data.ok) {
        showToast(currentLang === 'en' ? 'Settings saved ✓' : '设置已保存 ✓');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        // Show fixed domain status message
        if (data.fixedTunnel && data.fixedTunnel.enabled) {
          showToast(ui('fixedDomainEnabled'));
        } else if (!baseDomain || !token) {
          showToast(ui('tokenOrDomainEmptyFallback'));
        } else {
          showToast(ui('fixedDomainDisabledFastTunnel'));
        }
        // Reload to show updated token status
        await loadFixedTunnelSettings();
        refresh();
        syncFixedDraftUiOnly();
      } else {
        if (errEl && data && data.error) {
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        }
        showToast(currentLang === 'en' ? 'Save failed' : '保存失败', true);
      }
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
    }
  };

  // ── Token visibility toggle (eye button) ──
  window.toggleTokenVisibility = function() {
    const input = document.getElementById('fixed-tunnel-token');
    const btn = document.getElementById('token-eye-btn');
    if (!input || !btn) return;
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = '👁‍🗨';
      btn.title = currentLang === 'en' ? 'Hide' : '隐藏';
    } else {
      input.type = 'password';
      btn.innerHTML = '👁';
      btn.title = currentLang === 'en' ? 'Show' : '显示';
    }
  };

  // ── Exit control panel ──

  /** Poll /health until the control panel becomes unreachable. Returns true if exited, false if timeout. */
  async function waitForControlPanelExit(timeoutMs = 10000) {
    const started = Date.now();
    let failedCount = 0;
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const resp = await fetch('/health', { cache: 'no-store' });
        if (!resp.ok) failedCount++;
        else failedCount = 0;
      } catch (e) {
        failedCount++;
        if (failedCount >= 2) return true; // panel is gone
      }
    }
    return false;
  }

  /** Render the exit page with the given status: 'exiting' | 'exited' | 'maybe-running' */
  function renderExitPage(status, lang) {
    const isEn = lang === 'en';
    let html = '';
    if (status === 'exiting') {
      html = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#c9d1d9;text-align:center;gap:12px;">' +
        '<p style="font-size:1.3em;margin:0;">' + (isEn ? 'Control panel is exiting...' : '控制台正在退出...') + '</p>' +
        '<p style="font-size:0.95em;color:#8b949e;margin:0;">' + (isEn ? 'Stopping local child services and tunnels.' : '正在停止本地子服务和 Tunnel。') + '</p>' +
        '</div>';
    } else if (status === 'exited') {
      html = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#c9d1d9;text-align:center;gap:12px;">' +
        '<p style="font-size:1.3em;margin:0;">' + (isEn ? 'Control panel exited' : '控制台已退出') + '</p>' +
        '</div>';
    } else {
      html = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#c9d1d9;text-align:center;gap:12px;">' +
        '<p style="font-size:1.3em;margin:0;">' + (isEn ? 'The control panel may still be running' : '控制台可能仍在运行') + '</p>' +
        '<p style="font-size:0.95em;color:#8b949e;margin:0;">' + (isEn ? 'Check the local process or port 33004.' : '请检查本地进程或端口 33004。') + '</p>' +
        '</div>';
    }
    document.body.innerHTML = html;
  }

  window.exitControlPanel = function() {
    const confirmMsg = currentLang === 'en'
      ? 'Exit the control panel? Local child services and tunnels will be stopped.'
      : '确定退出控制台吗？本地子服务和 Tunnel 会被停止。';
    if (!confirm(confirmMsg)) return;
    requestJson('/api/exit-control-panel', { method: 'POST' })
      .then(data => {
        if (data && data.ok) {
          renderExitPage('exiting', currentLang);
          waitForControlPanelExit(10000).then(exited => {
            renderExitPage(exited ? 'exited' : 'maybe-running', currentLang);
          });
        } else {
          showToast(currentLang === 'en' ? 'Failed to exit control panel' : '退出控制台失败', true);
        }
      })
      .catch(e => {
        showToast((currentLang === 'en' ? 'Failed to exit control panel' : '退出控制台失败') + ': ' + e.message, true);
      });
  };

  window.startFixedTunnelAction = async function() {
    showToast(currentLang === 'en' ? 'Starting Fixed Tunnel...' : '正在启动固定 Tunnel...');
    try {
      const data = await requestJson('/api/start-fixed-tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (data && data.ok) {
        showToast(currentLang === 'en' ? 'Fixed Tunnel starting...' : '固定 Tunnel 启动中...');
        // Poll for status
        const startTime = Date.now();
        while (Date.now() - startTime < 15000) {
          await sleep(2000);
          const s = await fetchStatus();
          if (!s) break;
          updateFixedTunnelStatusBar(s.fixedTunnelStatus);
          if (s.fixedTunnelStatus === 'running') {
            showToast(currentLang === 'en' ? 'Fixed Tunnel running ✓' : '固定 Tunnel 已运行 ✓');
            break;
          }
          if (s.fixedTunnelStatus === 'error') {
            showToast(currentLang === 'en' ? 'Fixed Tunnel error' : '固定 Tunnel 启动失败', true);
            break;
          }
        }
      } else {
        showToast((data && data.error) || 'Failed to start', true);
      }
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
    }
  };

  window.stopFixedTunnelAction = async function() {
    showToast(currentLang === 'en' ? 'Stopping Fixed Tunnel...' : '正在停止固定 Tunnel...');
    try {
      await requestJson('/api/stop-fixed-tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      showToast(currentLang === 'en' ? 'Fixed Tunnel stopped' : '固定 Tunnel 已停止');
      updateFixedTunnelStatusBar('stopped');
      refresh();
    } catch (e) {
      showToast(ui('requestFailed') + e.message, true);
    }
  };

  // v3.5.4: Simple form semantics — just clear the input, user must click Save to confirm
  window.clearFixedToken = function() {
    const input = document.getElementById('fixed-tunnel-token');
    if (input) {
      input.value = '';
      input.type = 'password';
      showToast(currentLang === 'en' ? 'Token input cleared — click Save to confirm' : 'Token 输入框已清空 — 请点击保存确认');
    }
  };

  // ── Init ───────────────────────────────────────────────────────────────────
  // Initialize i18n and status in a stable order.
  currentLang = localStorage.getItem('mcpTunnelLang') || currentLang || 'zh';
  applyTranslations();
  enforceUrlEmptyStates();
  loadFixedUrls();
  bindSkillFolderInputDirtyTracking();
  loadSkillFolder();  // v3.4.8: eagerly load Skill Folder on page open
  setInterval(refresh, 2500);
  setInterval(enforceUrlEmptyStates, 500);
  refresh();
</script>
</body>
</html>`);
});

// ── v3.5.6: Fixed Tunnel Startup Recovery ─────────────────────────

/**
 * On control panel startup, automatically start fixed tunnel if:
 *   - fixedTunnel.enabled === true
 *   - fixedTunnel.baseDomain is non-empty
 *   - fixedTunnel.token is non-empty
 *   - tunnel is not already starting/running
 */
function scheduleFixedTunnelStartupRecovery() {
  setTimeout(() => {
    try {
      const ft = getFixedTunnel();

      if (!isFixedCoreUsable(ft)) {
        addLog('[fixed-tunnel] Startup recovery skipped: fixed tunnel is not enabled or missing baseDomain/token');
        return;
      }

      if (state.fixedTunnelStatus === 'starting' || state.fixedTunnelStatus === 'running') {
        addLog('[fixed-tunnel] Startup recovery skipped: fixed tunnel already starting/running');
        return;
      }

      if (state.fixedTunnelProc) {
        addLog('[fixed-tunnel] Startup recovery skipped: fixed tunnel process already exists');
        return;
      }

      addLog('[fixed-tunnel] Startup recovery: starting saved fixed tunnel');
      state.fixedTunnelStartupRecoveryNotice = {
        type: 'fixedTunnelStarted',
        ts: Date.now()
      };
      startFixedTunnel();
    } catch (e) {
      addLog(`[fixed-tunnel] Startup recovery error: ${e.message}`, 'error');
    }
  }, 1000);
}


// ── Single-Instance Guard (v3.4.8) ───────────────────────────────
// If a healthy control panel already runs on PANEL_PORT, re-use it
// instead of starting a second instance or crashing with EADDRINUSE.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const http = require('http');
const { exec } = require('child_process');

async function detectExistingControlPanel() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: PANEL_PORT, path: '/api/status', timeout: 2000 },
      (res) => {
        let buf = '';
        res.on('data', (d) => buf += d);
        res.on('end', () => {
          try {
            const d = JSON.parse(buf);
            if (
              d &&
              typeof d === 'object' &&
              ('rootDir' in d || 'mcp' in d || 'aiBrowser' in d || 'skillFolder' in d)
            ) {
              return resolve(true);
            }
            resolve(false);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openExistingControlPanel() {
  const url = `http://127.0.0.1:${PANEL_PORT}`;
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, (err) => {
      if (err) console.log(`[single-instance] Could not open browser: ${err.message}`);
    });
  } else {
    exec(`open "${url}"`, (err) => {
      if (err) console.log(`[single-instance] Could not open browser: ${err.message}`);
    });
  }
}

function startPanelServer() {
  const srv = app.listen(PANEL_PORT, () => {
    scheduleFixedTunnelStartupRecovery();
    console.log(`
╔════════════════════════════════════════════════════╗
║     WebAI LocalBridge 控制台 v3.4.8                    ║
╠══════════════════════════════════════════════════════╣
║  Dashboard:  http://127.0.0.1:${PANEL_PORT}                    ║
╠════════════════════════════════════════════════════════╣
║  AI Browser  → port ${AI_API_PORT}  (start from UI)             ║
║  MCP Server  → port ${MCP_PORT}  (start from UI)             ║
╚════════════════════════════════════════════════════════╝
`);
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('');
      console.log(`[single-instance] Port ${PANEL_PORT} already in use.`);
      console.log('[single-instance] Checking if it is a healthy WebAI LocalBridge control panel...');
      detectExistingControlPanel().then((existing) => {
        if (existing) {
          console.log('[single-instance] Healthy control panel detected. Opening existing dashboard...');
          openExistingControlPanel();
          console.log('[single-instance] New process exiting; old control panel remains running.');
          process.exit(0);
        } else {
          console.log(`[single-instance] Port ${PANEL_PORT} is occupied by an unknown process.`);
          console.log('[single-instance] Please free the port or stop the unknown process, then try again.');
          console.log('[single-instance] Aborting startup to avoid killing the unknown process.');
          process.exit(1);
        }
      });
    } else {
      console.error('[control-panel] Failed to start:', err.message);
      process.exit(1);
    }
  });
}

async function bootstrap() {
  const existing = await detectExistingControlPanel();
  if (existing) {
    console.log('[single-instance] Healthy control panel already running. Opening dashboard...');
    openExistingControlPanel();
    console.log('[single-instance] This process will now exit; the old control panel remains running.');
    process.exit(0);
    return;
  }
  startPanelServer();
}

bootstrap();

// ── Unified graceful shutdown (reused by SIGINT, SIGTERM, and exit API) ──
function gracefulShutdown() {
  // v3.5.1: Clean up orphan fixed named tunnels first
  cleanupOrphanFixedTunnelProcesses('gracefulShutdown');
  stopTunnel("AI Browser", "aiTunnelProc", "aiTunnelStatus", "aiTunnelUrl");
  stopTunnel("Secondary AI Browser", "secondaryAiTunnelProc", "secondaryAiTunnelStatus", "secondaryAiTunnelUrl");
  stopTunnel("MCP", "mcpTunnelProc", "mcpTunnelStatus", "mcpTunnelUrl");
  stopFrontendPreviewTunnel();
  stopFixedTunnel();
  try { if (state.aiProc) state.aiProc.kill(); } catch (_) {}
  try { if (state.secondaryAiProc) state.secondaryAiProc.kill(); } catch (_) {}
  try { if (state.mcpProc) state.mcpProc.kill(); } catch (_) {}
}

process.on("SIGINT", () => {
  gracefulShutdown();
  process.exit(0);
});
process.on("SIGTERM", () => process.emit("SIGINT"));

// ── Exit Control Panel API ─────────────────────────────────────────────────
app.post("/api/exit-control-panel", (req, res) => {
  addLog("[control-panel] Exit requested via UI button");
  res.json({ ok: true, message: "Control panel exiting" });
  setTimeout(() => {
    process.emit("SIGINT");
  }, 500);
});

