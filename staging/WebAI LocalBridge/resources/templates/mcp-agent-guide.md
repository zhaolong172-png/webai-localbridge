# MCP Agent Connection Guide

## Purpose

This guide is for cloud-based AI agents that can run code but do not provide a native MCP configuration interface.

The goal is to connect to the WebAI LocalBridge endpoint through MCP Streamable HTTP and use the standard MCP `tools/list` and `tools/call` flow to discover and call local tools.

Typical environments include AI agents that can run Python, JavaScript, or HTTP requests in a cloud execution environment.

## MCP Endpoint

Current MCP Endpoint:

{{MCP_ENDPOINT}}

## Endpoint Type

This is an MCP Streamable HTTP / SSE endpoint.

It is not a normal web page URL.

Use MCP JSON-RPC requests to communicate with it.

## Required Request Headers

Use these headers for MCP requests:

```http
Content-Type: application/json
Accept: application/json, text/event-stream
```

## Connection Flow

1. Send an `initialize` JSON-RPC request to the MCP Endpoint.
2. Read the `mcp-session-id` value from the `initialize` response headers.
3. Store the `mcp-session-id`.
4. Send all later requests with the same `mcp-session-id` request header.
5. Send `notifications/initialized`.
6. Call `tools/list`.
7. Use `tools/call` to call a specific tool.

## Recommended First Calls

After the MCP session is initialized, use this order:

1. `tools/list`
2. `tools/call` with `tunnel_status`
3. `tools/call` with `skill` and `action: "list"`
4. If a skill is needed, call `skill` with `action: "read"` and the skill name.
5. Continue with file or command tools according to the task.

## Runtime Discovery

Runtime information is discovered through MCP tools. The local shared directory, Skill Folder, available skill count, permission state, MCP version, transport protocol, available tools, root boundary mode, file write/delete permission, and command execution permission are NOT hardcoded in this guide — the agent must read them at runtime from MCP responses such as `tunnel_status`, `tools/list`, and `skill list`.

## Tool Discovery

Always treat `tools/list` as the source of truth for available tools, tool descriptions, and input schemas.

Common tools may include:

* `tunnel_status`: inspect MCP runtime status.
* `skill`: list or read local Skill documents.
* `file_tree`: inspect directory structure.
* `file_read`: read a whole file.
* `file_read_lines`: read selected lines from a larger file.
* `content_search`: search inside files.
* `file_info`: inspect path status and file type.
* `command_run`: run a short command when command execution is enabled.
* `task_start`, `task_status`, `task_logs`: run and inspect longer tasks.
* `process_start`, `process_logs`, `process_list`: manage longer-running processes.

Actual tool names, descriptions, and parameters are defined by `tools/list`.

## Skill Usage

A Skill is a local capability document.

Use `skill list` to list available skills.

Use `skill read` to read a specific `SKILL.md`.

A skill is usually a folder. Its entry file is `SKILL.md`.

`skill read` returns the `SKILL.md` content.

If available, `skillDir` is the absolute path of the skill folder.

If available, `skillFile` is the absolute path of the `SKILL.md` file.

If the agent needs to inspect other files inside the skill folder, call `file_tree`.

If the agent needs to read a script, template, or example file, call `file_read`.

If the agent needs to run a script or command, call `command_run` only when command execution is enabled and appropriate.

## Path Usage

Use absolute Windows paths when calling file and command tools.

Use `tunnel_status` to discover the current shared directory and Skill Folder.

Use `file_info` to check a path before reading or modifying it.

Use `file_tree` to inspect directory structure.

Use `content_search` to search file contents.

Use an absolute Windows path as `cwd` when calling `command_run`.

## Context-Efficient Workflow

For efficient context usage:

1. Call `tunnel_status` first.
2. Call `file_tree` to understand the directory structure.
3. Use `content_search` to locate relevant files or code.
4. Use `file_read_lines` to read relevant line ranges.
5. Use `file_read` only when full-file reading is necessary.

For large files, prefer `file_read_lines` or `content_search`.

## Common Error Handling

If the response says `Not Acceptable`, check that the `Accept` header includes both `application/json` and `text/event-stream`.

If the response says `No session ID`, check that later requests include the `mcp-session-id` returned by `initialize`.

If `tools/call` fails, check the tool name and parameters against the schema returned by `tools/list`.

If a path does not exist, call `file_info`.

If a file is too large, use `file_read_lines` or `content_search`.

## Successful Connection Criteria

A successful connection means:

1. `initialize` succeeds.
2. The response headers include `mcp-session-id`.
3. Later requests include that `mcp-session-id`.
4. `notifications/initialized` succeeds.
5. `tools/list` succeeds.
6. `tunnel_status` succeeds.
7. `skill list` succeeds.
8. `skill read` can read a selected `SKILL.md` when a skill is available.

## Minimal Working Flow

1. Connect to the MCP Endpoint.
2. Send `initialize`.
3. Save `mcp-session-id`.
4. Send `notifications/initialized`.
5. Call `tools/list`.
6. Call `tools/call tunnel_status`.
7. Call `tools/call skill list`.
8. Call `tools/call skill read` if needed.
9. Continue with file, search, or command tools according to the task.

## Final Note

This guide only describes how to connect to the MCP Endpoint.

After connection, runtime status, the available tool list, and any other runtime values are determined by MCP responses, not by this document.
