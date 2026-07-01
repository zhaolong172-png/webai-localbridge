---
name: bb-browser-repo-check
description: Use this when the user provides https://github.com/epiral/bb-browser or asks to inspect bb-browser, compare its browser automation model with this project, or extract useful ideas from its CLI/MCP design.
---

# bb-browser Repository Check

## Purpose

Check the bb-browser project and produce a concise technical note for this project.

bb-browser reference:

https://github.com/epiral/bb-browser

Known repo summary:

- Project name: bb-browser / BadBoy Browser.
- Positioning: "Your browser is the API."
- Main idea: let AI agents use the user's real Chrome/browser state through CLI or MCP.
- Main forms: CLI, local daemon, MCP server.
- MCP example command: `npx -y bb-browser --mcp`.
- Default daemon port mentioned by the project: `127.0.0.1:19824`.
- Typical capabilities: open page, snapshot, click, fill, eval, fetch, network capture, screenshot, site adapters.

## When to use

Use this skill when the task is about:

1. Understanding bb-browser.
2. Comparing bb-browser with WorkBuddy / mcp-tunnel / AI File Gateway.
3. Extracting product ideas from bb-browser.
4. Checking whether browser automation should be added to this project.
5. Designing a browser-control module, browser MCP bridge, or local browser gateway.

## Project boundary

This project is still centered on:

- local file gateway
- MCP file tools
- fixed domain tunnel
- AI file browser
- local control panel
- permission and action control

bb-browser should be treated as a reference project, not as the current architecture.

Do not merge browser automation into the main chain unless the user explicitly asks.

## Steps

1. Open or search the bb-browser repository.
2. Read the README and identify:
   - product positioning
   - install method
   - MCP usage
   - daemon architecture
   - browser command categories
   - adapter mechanism
3. Compare it with this project:
   - bb-browser controls browser/web pages
   - this project controls local files/MCP file access
   - both expose local capabilities to AI agents
   - both can use MCP as an interface
4. Identify reusable ideas:
   - CLI + MCP dual interface
   - local daemon pattern
   - adapter-based command catalog
   - command list / capability list
   - status endpoint and diagnostics
   - JSON output format
5. Identify ideas not to copy directly:
   - do not turn this file gateway into a browser automation project by default
   - do not add website adapters in the file gateway layer
   - do not mix browser session logic with file permission logic
6. Produce a short report directly in chat.

## Output format

Return:

1. What bb-browser is.
2. How it is similar to this project.
3. How it is different from this project.
4. What can be borrowed.
5. What should not be copied.
6. Suggested next action.

Do not create a report file unless the user explicitly asks.
Do not run install commands unless the user explicitly asks.
Do not modify project architecture unless the user explicitly asks.
