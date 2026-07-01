# WebAI LocalBridge Backup

Private backup of the local WebAI LocalBridge / MCP tunnel tool.

## Included

- `app/` - LocalBridge source files, launcher scripts, package metadata, lockfile, and example config.
- `resources/brand/` - WebAI LocalBridge icon assets.
- `resources/templates/` - agent guide template files.
- `agents/skills/` - local agent skill instructions bundled with this bridge.

## Excluded

- `mcp-tunnel-config.json` because it contains local paths and fixed tunnel token values.
- `.mcp-logs/`, runtime state, generated logs, caches, and local session files.
- `node_modules/`, bundled `runtime/node/node.exe`, and `cloudflared.exe`; restore these from `npm install`, Node.js, and Cloudflare's official cloudflared release.

## Restore Notes

1. Copy `app/mcp-tunnel-config.example.json` to `mcp-tunnel-config.json`.
2. Fill local paths and tunnel settings manually.
3. Run `npm install` inside `app/`.
4. Start with `npm run start` or `npm run start:mcp`.

This repository is intended as a private operational backup, not a public release.
