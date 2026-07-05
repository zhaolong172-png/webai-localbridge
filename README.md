# WebAI LocalBridge

[中文说明](./README.zh-CN.md)

Local file, MCP, browser, and tunnel gateway for Web AI agents.

## Download

- [Offline installer package](./output/WebAI-LocalBridge-offline-installer-v3.5.13.zip)
- [Release: v3.5.13](https://github.com/zhaolong172-png/webai-localbridge/releases/tag/v3.5.13)

## License

This project is released under The Unlicense.

---

## 1. Project Overview

### 1.1 What Is WebAI LocalBridge?

WebAI LocalBridge is an AI file gateway application that runs on the user’s local computer. With the user’s authorization, it allows ChatGPT, Claude, Doubao, Qianwen, Kimi, Gemini, DeepSeek, and other Web AI / Cloud Agents to access local files, local projects, and local tools through AI File Browser, MCP Server, and public tunnels.

It is not a conventional cloud drive or cloud synchronization service. The core positioning of WebAI LocalBridge is to build a controllable bridge between the local computer and Web AI, allowing AI to read, analyze, and, when necessary, operate on local projects.

WebAI LocalBridge mainly provides two entry points:

- AI File Browser: a read-only file browser suitable for allowing Web AI products that do not have a cloud Agent execution environment or an official MCP interface to view local files, such as Gemini and DeepSeek.

- MCP Server: a local operation interface suitable for MCP-capable clients, or AI systems with a cloud Agent execution environment, to call local tools through MCP.

### 1.2 Problems It Solves

Web AI usually runs in the cloud. By default, it cannot directly access local files on the user’s computer, call local commands, read local projects, inspect local directory structures, or operate on the local development environment.

WebAI LocalBridge solves this gap:

User’s local computer / remote computer
↕
WebAI LocalBridge
↕
Public tunnel / MCP / file browser
↕
ChatGPT / Claude / Doubao / Qianwen / Kimi / Gemini / DeepSeek / Cloud Agent

It allows users to expose designated local directories to AI in a controlled manner. Users can choose read-only browsing, or, after enabling MCP and permission controls, allow AI to perform deeper local operations.

In addition to handling files on the current computer, it can also be used for remote assistance. After WebAI LocalBridge is run on another computer, the user can use a fixed domain or temporary tunnel to allow AI to remotely view, analyze, and assist with projects, documents, configurations, or runtime status on that computer.

### 1.3 Applicable Scenarios

### 1.3 Applicable Scenarios

WebAI LocalBridge is suitable for the following scenarios:

- Allowing ChatGPT, Claude, or other Web AI to read local project code.
- Allowing Web AI to view local folder structures.
- Allowing AI to read local Markdown, TXT, JSON, CSV, and code files.
- Allowing AI to preview XLSX spreadsheet content.
- Allowing AI to extract text from PDF, DOCX, PPTX, HTML, RTF, and other files.
- Allowing AI to modify local project files through MCP.
- Allowing AI to execute commands in a local project directory.
- Allowing AI to assist with debugging, building, organizing, and migrating local projects.
- Allowing Doubao, Qianwen, Kimi, and other AI products that have a cloud Agent environment but no official MCP configuration interface to connect to local MCP through the Agent Connection Guide.
- Allowing Gemini, DeepSeek, and other Web AI products that do not have a cloud Agent execution environment or official MCP interface to view local files in read-only mode through AI File Browser.
- Remotely handling projects or files on another computer through a fixed domain.
- In remote assistance scenarios, allowing AI to help inspect, analyze, and handle project status on another computer.
- Acting as a lightweight file access entry point for individuals or small teams to temporarily share designated directories within a clearly authorized scope.
- Acting as a controlled remote file browsing entry point for viewing project files, documents, configuration files, or runtime logs on another computer.
- Acting as a lightweight remote assistance tool, allowing AI or authorized users to view specified directory content through a browser to assist with troubleshooting.
- Acting as a temporary public file entry point for a designated AI, Agent, or collaborator to access a specific folder instead of exposing the entire computer.

### 1.4 Non-Applicable Scenarios

WebAI LocalBridge is not suitable for the following scenarios:

- Publicly exposing the entire computer or the entire disk without restrictions.
- Long-term exposure of directories containing privacy data, keys, tokens, account data, browser data, or sensitive logs.
- Enabling write, delete, or command execution capabilities without understanding the shared directory and permission scope.
- Directly exposing the local control panel port to the public internet.
- Replacing a full enterprise-grade cloud drive, permission system, audit system, or remote operations platform.
- Using it as a long-term public file service without any access control or risk isolation.
- Connecting untrusted AI or untrusted users to an MCP Server with write, delete, or command execution permissions.

WebAI LocalBridge can be used for file sharing, remote file browsing, and remote assistance, but the recommended approach is: only expose the directories that clearly need to be accessed, only enable the necessary services, and only turn on high-permission MCP operations when needed.


---


## 3. Architecture Description

### 3.2 Port Description

WebAI LocalBridge uses the following local ports by default.

#### 3.2.1 33004: Human Control Panel

33004 is the local human control panel port.

Purpose:

- Managing services.
- Viewing status.
- Configuring shared directories.
- Configuring Tunnel.
- Managing permissions.
- Downloading the Agent Connection Guide.

Access method:

http://127.0.0.1:33004

33004 is the management entry point for the local user. It is not an entry point for Web AI to access directly.

#### 3.2.2 33005: Primary AI File Browser

33005 is the primary AI File Browser port.

Purpose:

- Read-only browsing of the primary shared directory.
- Allowing Web AI to view files and directories.
- Providing file preview, text extraction, spreadsheet preview, and other capabilities.

Local address:

http://127.0.0.1:33005

Public access is usually generated through Fast Tunnel or Fixed Domain Tunnel.

#### 3.2.3 33006: Secondary AI File Browser

33006 is the secondary AI File Browser port.

Purpose:

- Read-only browsing of the secondary shared directory.
- Providing AI with a second independent file entry point.
- Suitable for separating the main project directory from auxiliary material directories.

Local address:

http://127.0.0.1:33006

#### 3.2.4 33003: MCP Server

33003 is the MCP Server port.

Purpose:

- Allowing MCP-capable AI clients to call local tools.
- Allowing AI with a cloud Agent execution environment to call local tools through the MCP Streamable HTTP / SSE process.
- Providing capabilities such as file reading, file search, file writing, command execution, and task management.

Local MCP address:

http://127.0.0.1:33003/mcp

The public MCP address is usually in a form similar to:

https://mcp.example.com/mcp

or a temporary address generated by Fast Tunnel.


---


## 4. Quick Start

### 4.3 Open the Local Control Panel

After startup, the browser will open the local control panel:

http://127.0.0.1:33004

If the browser does not open automatically, you can manually visit this address.

If the page cannot be opened, check:

- Whether the launcher is running properly.
- Whether port 33004 is occupied.
- Whether Node Runtime exists.
- Whether the firewall or security software is blocking the local service.


---


## 5. AI File Browser Usage Guide

### 5.1 Suitable Use Cases

AI File Browser is suitable for read-only scenarios, especially for Web AI products that do not have a cloud Agent execution environment or an official MCP interface.

Examples include:

- Gemini
- DeepSeek
- Other Web AI products that can only open web pages, read links, or process page content

This type of AI is not suitable for direct MCP usage because it usually cannot stably perform MCP initialization, save the session id, call tools/list, and call tools/call. For them, AI File Browser is more direct.

Typical use cases include:

- Allowing AI to view a project directory structure.
- Allowing AI to read code files.
- Allowing AI to read Markdown, TXT, JSON, CSV, and other text files.
- Allowing AI to preview Excel spreadsheets.
- Allowing AI to extract text from PDF or DOCX files.
- Allowing AI to view image previews.
- Allowing AI to inspect the contents of ZIP archives.
- Allowing AI to analyze files without modifying local files.

If the task does not require writing files, deleting files, moving files, or executing commands, AI File Browser should be used first.


---


## 6. MCP Server Usage Guide

### 6.1 Suitable Use Cases

MCP Server is suitable for local operation scenarios.

Typical use cases include:

- Allowing AI to read project files.
- Allowing AI to search file names and file content.
- Allowing AI to modify code.
- Allowing AI to create new files.
- Allowing AI to move or rename files.
- Allowing AI to delete explicitly specified files.
- Allowing AI to execute local commands.
- Allowing AI to run build, test, installation, and other tasks.
- Allowing AI to read command output and task logs.
- Allowing AI to assist with multi-step local project maintenance.
- Remotely handling projects or files on another computer.
- In remote assistance scenarios, allowing AI to help analyze projects, configurations, and runtime status on another computer.

MCP Server is more powerful than AI File Browser, so it also carries higher risk. Before using MCP, users should confirm that the shared directories, permission switches, and AI client confirmation mechanism match their expectations.

### 6.4 ChatGPT / Claude / Other MCP Clients / Cloud Agent Configuration Method

If ChatGPT, Claude, or other MCP clients support remote MCP Endpoints, they can directly use the MCP URL displayed in the control panel to connect.

If the target AI does not have an official MCP configuration interface but has a cloud Agent execution environment, the Agent Connection Guide can also be used.

This type of AI includes but is not limited to:

- Doubao office task / Agent scenarios
- Qianwen task assistant / Agent scenarios
- Kimi Agent scenarios
- Other Cloud Agents that can run code, send HTTP requests, and maintain session state

Procedure:

1. Start the MCP Server.
2. Wait for the control panel to display the public MCP address.
3. Download the Agent Connection Guide.
4. Upload the Markdown file to the target AI Agent.
5. Ask the Agent to follow the guide to complete initialize, read the session id, then call tools/list and tools/call.

This type of Agent does not need an official MCP configuration interface, but it must have basic cloud execution capability. If the AI is only a normal chat window and cannot execute requests or maintain a session, AI File Browser should be used instead.

### 6.6 High-Risk Operations Such as Writing, Deleting, and Command Execution

High-risk MCP operations include:

- Writing files.
- Overwriting files.
- Modifying files.
- Moving files.
- Deleting files.
- Recursively deleting directories.
- Executing commands.
- Executing PowerShell.
- Starting long-running tasks.
- Stopping tasks.

At present, except for recursively deleting non-empty directories, the tool itself does not add an extra built-in layer of human confirmation for every high-risk operation. In other words, if the relevant permissions have already been enabled in the local control panel, and the AI client allows the tool call, the MCP Server will execute the operation according to the tool parameters.

Recursive deletion of non-empty directories is a special high-risk operation. It still requires explicit parameters, such as recursive:true, and the user should confirm whether the target path is correct.

Before using write, delete, or command execution capabilities, users should confirm:

- Whether the current shared directory is correct.
- Whether the AI understands the task objective.
- Whether the AI has already read the relevant files.
- Whether a backup is needed.
- Whether advanced permissions are enabled.
- Whether cross-root access is allowed.
- Whether command execution is allowed.
- Whether the delete operation is explicit and necessary.

### 6.7 Recommendation for ChatGPT Always Allow

ChatGPT may provide Allow once or Always allow for MCP tool calls.

The current recommendation is:

Initial use: Allow once
After stable high-frequency use for a period of time: try Always allow

During the first connection or the first few days of use, it is not recommended to directly rely on Always allow. The reason is that ChatGPT may experience disconnections, reauthorization, or unavailable tools when the MCP session, tool list, connection status, or risk judgment is not yet stable.

If you have used MCP frequently for a period of time, for example for about 5 consecutive days with stable tool calls, you can then try Always allow. Whether Always allow remains stable depends on the ChatGPT client’s MCP permission policy, tool risk judgment, and connection status at that time.

The positioning of WebAI LocalBridge is:

Read-only viewing: prioritize AI File Browser
Local operations: use MCP Server
Initial operations: recommend Allow once
After stability: try Always allow

If disconnection or tool unavailability occurs after using Always allow, it is recommended to switch back to Allow once first.

## 7. Agent Connection Guide

### 7.1 Function and Purpose

The Agent Connection Guide is intended for AI products that have a cloud Agent execution environment but no official MCP configuration entry.

This type of AI cannot directly enter an MCP Endpoint in an MCP configuration interface like ChatGPT, but it may have the following capabilities:

- It can run cloud tasks.
- It can send HTTP requests.
- It can execute Python, JavaScript, or similar scripts.
- It can save the session id returned by a request.
- It can call the MCP JSON-RPC interface according to the guide.

The function of the Agent Connection Guide is to write the current WebAI LocalBridge MCP Endpoint, request header requirements, initialization process, session usage method, and the calling sequence of tools/list and tools/call into a Markdown document, making it convenient for users to upload directly to this type of AI Agent.

It is not an ordinary instruction document for normal web chat windows. It is a connection guide for Cloud Agents with execution capability.

### 7.2 Applicable Targets

The Agent Connection Guide is suitable for the following types of AI:

- Doubao office task / Agent scenarios.
- Qianwen task assistant / Agent scenarios.
- Kimi Agent scenarios.
- Other Cloud Agents that can run code, send HTTP requests, and maintain session state.
- Web AI products that have no official MCP configuration interface but can execute HTTP / JSON-RPC requests according to documentation.

The key characteristic of this type of AI is that it can not only read the guide, but also actually send requests according to it.

If an AI is only a normal chat window and cannot execute HTTP requests, maintain mcp-session-id, or call JSON-RPC, then it is not suitable for using the Agent Connection Guide. In this case, AI File Browser should be used instead, and the file browser link should be given to it for read-only viewing.

### 7.3 Download Method

In the WebAI LocalBridge local control panel, start the MCP Server first, and wait until the control panel displays an available public MCP address.

Then, in the MCP section, click:

Download Agent Connection Guide

The corresponding button in the English interface is:

Download Agent Guide

The system will download a Markdown file. This file is an English guide, making it easier to upload to various Web AI / Cloud Agents.

When downloading, WebAI LocalBridge writes the currently available MCP Endpoint into the guide. For example:

https://mcp.example.com/mcp

If Fixed Domain Tunnel is available, the guide will prioritize the fixed-domain MCP address. Otherwise, it will use the currently available Fast Tunnel MCP address.

### 7.4 How to Upload and Use It with Web AI / Cloud Agent

After downloading the guide, upload the Markdown file to the target Web AI or Cloud Agent and clearly tell it:

Please follow this MCP Agent Connection Guide to connect to my WebAI LocalBridge MCP Endpoint.
First complete initialize, read the mcp-session-id, then call tools/list and tunnel_status.
Do not treat the MCP Endpoint as a normal web page.

Recommended process:

1. Start the MCP Server in the WebAI LocalBridge control panel.
2. Confirm that the public MCP address is available.
3. Download the Agent Connection Guide.
4. Upload the Markdown file to the target AI Agent.
5. Ask the Agent to follow the guide to complete MCP initialization.
6. Ask the Agent to first call tools/list to view available tools.
7. Ask the Agent to then call tunnel_status to obtain the current shared directory, permission status, and runtime status.
8. Continue calling file, search, command, or task tools as needed.

The Agent should not assume local paths, tool lists, permission states, or shared directories. It should read this information in real time from MCP return values.

### 7.5 MCP Streamable HTTP / SSE Connection Process

The WebAI LocalBridge MCP Endpoint uses MCP Streamable HTTP / SSE for connection. It is not a normal web page link or a file browser link.

MCP requests need to use JSON-RPC and include the correct request headers:

Content-Type: application/json
Accept: application/json, text/event-stream

The basic connection process is as follows:

1. Send an initialize JSON-RPC request to the MCP Endpoint.
2. Read mcp-session-id from the initialize response headers.
3. Save the mcp-session-id.
4. Include the same mcp-session-id request header in all subsequent requests.
5. Send notifications/initialized.
6. Call tools/list to obtain the tool list.
7. Call tools/call to execute a specific tool.
8. First call tunnel_status to obtain the current runtime status.
9. Continue calling file reading, file search, command execution, or task management tools according to the task.

Recommended first-call sequence:

initialize
notifications/initialized
tools/list
tools/call tunnel_status
tools/call skill list
tools/call skill read, if needed
Subsequent file / search / command / task tools

Common error handling:

- If Not Acceptable is returned, check whether the Accept request header includes both application/json and text/event-stream.
- If No session ID is returned, check whether subsequent requests include mcp-session-id.
- If a tool call fails, first review the tool name, parameters, and schema returned by tools/list.
- If the path does not exist, first call file_info to check the path.
- If the file is too large, prioritize file_read_lines or content_search.


---


## 8. Tunnel Usage Guide

### 8.1 Fast Tunnel

Fast Tunnel is a temporary public tunnel. It is suitable for quick testing, temporary connections, and short-term tasks.

Features of Fast Tunnel:

- Users do not need to prepare their own domain.
- A temporary public URL is automatically generated after startup.
- The URL may change.
- Suitable for temporarily sending to ChatGPT, Claude, Gemini, DeepSeek, or other Web AI.
- Suitable for first-time testing of AI File Browser or MCP Server.
- Not suitable as a long-term stable entry point.

Fast Tunnel may generate an address similar to:

https://xxxx-yyyy-zzzz.trycloudflare.com

If used for MCP, the final MCP Endpoint usually needs to include /mcp:

https://xxxx-yyyy-zzzz.trycloudflare.com/mcp

Fast Tunnel is more suitable for “use once immediately” scenarios. If a long-term fixed address is needed, Fixed Domain Tunnel is recommended.

### 8.2 Fixed Domain Tunnel

Fixed Domain Tunnel is a fixed-domain tunnel. It is suitable for long-term use, stable access, and fixed configuration.

The user only needs to enter a Base Domain. WebAI LocalBridge will automatically derive multiple service addresses:

mcp.<Base Domain>/mcp
files.<Base Domain>
files2.<Base Domain>
preview.<Base Domain>

For example, if the Base Domain is:

example.com

then the following addresses are automatically generated:

https://mcp.example.com/mcp
https://files.example.com
https://files2.example.com
https://preview.example.com

Fixed Domain Tunnel is suitable for the following scenarios:

- Long-term configuration of MCP Endpoint for ChatGPT.
- Long-term use of AI File Browser by Web AI.
- Remote access to project files on another computer.
- Remote assistance scenarios.
- Reusing the same set of local service addresses multiple times.
- Avoiding reconfiguration caused by Fast Tunnel address changes.

### 8.3 Base Domain Input Rules

Base Domain should contain only the domain name itself. Do not include protocol, path, or a specific subdomain.

Correct examples:

example.com
my-domain.pp.ua

Incorrect examples:

https://example.com
http://example.com
mcp.example.com
files.example.com
example.com/mcp
localhost
127.0.0.1
[::1]

After entering the Base Domain, WebAI LocalBridge will automatically generate fixed addresses for MCP, the primary file browser, the secondary file browser, and frontend preview. Users do not need to manually enter multiple full URLs.

### 8.4 Automatically Generated Fixed Domains

Fixed Domain Tunnel automatically generates multiple fixed entry points based on the Base Domain.

#### 8.4.1 MCP Fixed Domain

The MCP fixed domain is used to connect to the MCP Server.

Format:

https://mcp.<Base Domain>/mcp

Example:

https://mcp.example.com/mcp

Purpose:

- ChatGPT MCP configuration.
- Claude / other MCP client connections.
- Cloud Agents calling tools through MCP Streamable HTTP / SSE.
- MCP Endpoint in the Agent Connection Guide.

The MCP fixed domain is not a normal web page link. It is an MCP JSON-RPC interface.

#### 8.4.2 Primary AI File Browser Fixed Domain

The Primary AI File Browser fixed domain is used to access the primary file browser.

Format:

https://files.<Base Domain>

Example:

https://files.example.com

Purpose:

- Allowing Web AI to view the primary shared directory in read-only mode.
- Allowing AI to read local project files.
- Allowing AI to view code, documents, spreadsheets, PDF text, and image previews.
- Serving as the default file browser entry point for Gemini, DeepSeek, and other Web AI.

#### 8.4.3 Secondary AI File Browser Fixed Domain

The Secondary AI File Browser fixed domain is used to access the secondary file browser.

Format:

https://files2.<Base Domain>

Example:

https://files2.example.com

Purpose:

- Accessing the second shared directory.
- Separating the main project from auxiliary materials.
- Providing AI with another read-only file entry point.
- Separately exposing toolkits, knowledge bases, or reference folders in remote assistance scenarios.

#### 8.4.4 Frontend Preview Fixed Domain

The Frontend Preview fixed domain is used to access the local frontend preview service.

Format:

https://preview.<Base Domain>

Example:

https://preview.example.com

Purpose:

- Exposing the local frontend development preview page.
- Allowing Web AI to view locally running frontend pages.
- Remotely viewing page effects from Vite, React, Vue, or other local development servers.

Whether Frontend Preview is available depends on whether the local frontend preview service is running and whether the corresponding fixed-domain preview capability is enabled in the control panel.

### 8.5 Cloudflare Token Description

Fixed Domain Tunnel requires a Cloudflare Tunnel Token. This token is used to allow the local cloudflared process to connect to the user’s own Cloudflare Tunnel configuration.

The token is sensitive information and should be handled as follows:

- Store it only in the local machine configuration.
- Do not commit it to a Git repository.
- Do not write it into README files, screenshots, logs, or public issues.
- Do not package it into release configuration files.
- Do not send it to untrusted AI or untrusted users.
- When changing computers or reinstalling, reconfigure it or confirm whether the token is still valid.

The real runtime configuration file of WebAI LocalBridge is usually:

mcp-tunnel-config.json

This file may contain the Cloudflare Token, local paths, shared directories, and permission switches. When releasing a portable zip or installer package, the real mcp-tunnel-config.json should not be included.

The release package should use a safe example configuration:

mcp-tunnel-config.example.json

### 8.6 Common Connection Issues

Common issue 1: Fixed Domain Tunnel shows running, but the web page cannot be opened.

Possible causes:

- The corresponding local service has not started.
- Local ports 33005 / 33006 / 33003 are not listening.
- Cloudflare Tunnel is connected, but the origin service is unavailable.
- Base Domain or subdomain configuration is incorrect.
- DNS / Tunnel routing on the Cloudflare side is not configured correctly.

Handling method:

- First check whether the corresponding service is running in the control panel.
- For AI File Browser, confirm that 33005 or 33006 is working properly.
- For MCP, confirm that 33003 is working properly.
- Then check the Fixed Domain Tunnel status.
- Finally, check Cloudflare configuration and domain resolution.

Common issue 2: The MCP address does not look like a web page when opened in a browser.

This is normal. The MCP Endpoint is not a web page, but an MCP JSON-RPC interface. Opening it directly in a browser may not show a normal page.

If you want to give AI read-only access to files, use the AI File Browser address instead of the MCP Endpoint.

Common issue 3: Fast Tunnel address changes.

Fast Tunnel is a temporary address and may change after restarting. If a long-term fixed address is needed, Fixed Domain Tunnel should be used.

Common issue 4: Cloudflare logs show stream canceled.

If MCP or the file browser is still available, occasional stream canceled messages do not necessarily mean the service has failed. It may simply indicate that the client, an intermediate connection, or the SSE stream was actively closed. If access failure occurs at the same time, investigate together with the service status shown in the control panel.

Common issue 5: files / files2 access fails.

Check whether the Primary AI File Browser or Secondary AI File Browser has already been started. Fixed Tunnel running only means that the tunnel layer is running. It does not mean that every local origin service has started.


---


## 9. Permissions and Security

### 9.1 Local Control Panel Only Allows Local Access

The WebAI LocalBridge local control panel is the human management entry point. Its default address is:

http://127.0.0.1:33004

It is used to set shared directories, start services, configure Tunnel, manage MCP permissions, and view runtime status.

The control panel should only be accessible from the local machine. It is not a page for Web AI to access directly, nor is it a management backend to be publicly exposed to collaborators.

Web AI should access:

AI File Browser public address
MCP Endpoint public address
Frontend Preview public address

instead of the 33004 control panel.

### 9.2 Do Not Publicly Expose 33004

Do not directly expose the 33004 control panel port to the public internet through Tunnel, port forwarding, reverse proxy, or public servers.

The reason is simple: 33004 is the control plane, not the data plane. It can manage shared directories, permissions, Tunnel, and local services. If the control panel is exposed to the public internet, the risk is significantly higher than exposing the read-only file browser or MCP Endpoint.

Recommended boundary:

33004: for local user access only
33005: can be exposed to AI through Tunnel for read-only access
33006: can be exposed to AI through Tunnel for read-only access
33003/mcp: can be exposed to MCP clients through Tunnel

If remote management is needed, it is recommended to first enter the local machine through Remote Desktop, an internal VPN, Tailscale, ZeroTier, or another trusted remote access method, and then open the 33004 control panel.

### 9.3 MCP Advanced Permission Description

The capabilities of MCP Server depend on the permission configuration in the control panel.

Common permissions include:

- Whether file writing is allowed.
- Whether file deletion is allowed.
- Whether cross-root access is allowed.
- Whether command execution is allowed.
- Whether PowerShell execution is allowed.
- Whether task startup is allowed.
- Whether higher-risk local operations are allowed.

After advanced permissions are enabled, AI can call more powerful local tools through MCP. At that point, MCP is no longer merely “reading files”; it may modify projects, run commands, or change the local environment.

At present, except for recursively deleting non-empty directories, the tool itself does not add an extra built-in layer of human confirmation for every high-risk operation. In normal cases, as long as local permissions allow it, the AI client allows the tool call, and the tool parameters are valid, the MCP Server will execute the corresponding operation.

Before enabling advanced permissions, users should confirm:

- Whether the current shared directory is correct.
- Whether AI is allowed to modify this directory.
- Whether a backup is needed.
- Whether cross-root access is allowed.
- Whether command execution is allowed.
- Whether the current AI is trustworthy.
- Whether the current task is clear.

### 9.4 File Writing and Overwrite Rules

MCP file writing capabilities usually include creating new files, overwriting files, editing files, and moving files.

Common rules:

- Create new file: the target can be created when it does not exist.
- Overwrite file: when the target already exists, an explicit overwrite parameter is usually required.
- Edit file: replace content based on matching text.
- Move file: when the target exists, an explicit overwrite parameter is usually required.
- Backup: some edit operations can generate a .bak file using the backup option.

Before using file writing capabilities, it is recommended to first ask AI to:

1. Read the relevant files.
2. Explain which files it plans to modify.
3. Use small-scope modifications as much as possible.
4. Enable backup for critical files.
5. Run syntax checks or test commands after modification.

For project code, it is recommended to first ask AI to use file_read_lines, content_search, and file_info to clarify the context before performing write or edit operations.

### 9.5 Delete and Recursive Delete Rules

Delete operations carry higher risk than ordinary write operations.

File deletion is usually used to delete explicitly specified files. Directory deletion is divided into empty directory deletion and non-empty directory deletion.

Recommended rules:

- Before deleting a file, confirm the path first.
- Before deleting a directory, inspect the directory contents first.
- Empty directories can be deleted directly.
- Recursive deletion of non-empty directories requires special caution.
- Recursive deletion should only be used for clearly unnecessary build artifacts, cache directories, temporary directories, or directories explicitly specified by the user.

When recursively deleting a non-empty directory, the tool usually requires an explicit parameter, such as:

recursive:true

For non-empty directories, AI should not recursively delete them without confirming the path. Special care should be taken to avoid accidentally deleting:

- Project root directories.
- User home directories.
- Desktop directories.
- Documents directories.
- Git repository root directories.
- Directories containing source code, papers, business materials, or private data.

Recommended pre-deletion check:

First file_info
Then file_tree
Confirm directory contents
Finally dir_remove

### 9.6 Command Execution Risks

MCP Server can provide command execution capabilities, such as command_run, powershell_run, task_start, or similar tools.

Command execution is suitable for:

- Installing dependencies.
- Running tests.
- Building projects.
- Checking ports.
- Viewing Git status.
- Reading runtime logs.
- Starting development servers.
- Executing project scripts.

Command execution may also introduce risks, such as:

- Deleting files.
- Modifying system configuration.
- Installing untrusted dependencies.
- Uploading or leaking local data.
- Occupying resources for a long time.
- Starting unknown processes.
- Changing the Git working tree.

Before using command execution, it is recommended to:

- Specify a clear cwd.
- Prefer Windows absolute paths.
- Avoid running long commands when their meaning is unclear.
- Avoid directly running scripts from untrusted sources.
- Set reasonable timeouts for install, build, test, and similar commands.
- Use task tools for long-running tasks, and check results through task_status / task_logs.
- Do not allow AI to execute commands arbitrarily in system directories or the user home directory.

The current MCP tool requires the command cwd to use a Windows absolute path. Do not use:

cwd="/"

Use something like:

C:\Users<User>\Projects<ProjectName>

### 9.7 Configuration Files and Token Protection

The real runtime configuration of WebAI LocalBridge is usually stored in:

mcp-tunnel-config.json

This file may contain:

- Local shared directories.
- Secondary file browser directory.
- Fixed Domain Tunnel Base Domain.
- Cloudflare Tunnel Token.
- MCP permission switches.
- Root boundary mode.
- Command execution switch.
- Skill Folder configuration.

This file is local runtime configuration. It should not be committed to Git, nor should it be packaged into public releases.

The release package should use:

mcp-tunnel-config.example.json

The example configuration should not contain:

- Real tokens.
- Real domains.
- Real local paths.
- Real shared directories.
- Real user information.
- High-risk permissions enabled by default.

The recommended default configuration should remain safe:

mcpAdvancedPermission: false
commandExecution: false
fileFastConfirm: false
rootBoundaryMode: root-only
fixedTunnel.token: ""
fixedTunnel.enabled: false

If a token is leaked, it should be immediately revoked or reset on the Cloudflare side.