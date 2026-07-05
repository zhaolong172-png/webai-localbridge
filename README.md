# WebAI LocalBridge

WebAI LocalBridge 是连接本地文件、本地工具、MCP Server、AI File Browser 和 Web AI / Cloud Agent 的本地网关。  
WebAI LocalBridge is a local gateway connecting local files, local tools, MCP Server, AI File Browser, and Web AI / Cloud Agents.

## 下载 / Download

- [离线安装包 / Offline installer package](./output/WebAI-LocalBridge-offline-installer-v3.5.13.zip)
- [Release: v3.5.13](https://github.com/zhaolong172-png/webai-localbridge/releases/tag/v3.5.13)

## 许可 / License

本项目使用 The Unlicense 发布。  
This project is released under The Unlicense.

## 目录 / Contents

- [中文说明](#中文说明)
- [English README](#english-readme)

---

## 中文说明

## 1. 项目简介

### 1.1 WebAI LocalBridge 是什么

WebAI LocalBridge 是一个运行在用户本地电脑上的 AI 文件网关应用。它让 ChatGPT、Claude、豆包、千问、Kimi、Gemini、DeepSeek 以及其他 Web AI / Cloud Agent，在用户授权的前提下，通过 AI File Browser、MCP Server 和公网隧道访问本地文件、本地项目和本地工具。
它不是普通网盘，也不是云端同步盘。WebAI LocalBridge 的核心定位是：在本地电脑和 Web AI 之间建立一座可控的桥，让 AI 能够读取、分析和在需要时操作本地项目。
WebAI LocalBridge 主要包含两个入口：
- AI File Browser：只读文件浏览器，适合让没有云端 Agent 环境、也没有官方 MCP 接口的 Web AI 查看本地文件，例如 Gemini、DeepSeek 等。
- MCP Server：本地操作接口，适合让支持 MCP 的客户端，或具备云端 Agent 执行环境的 AI，通过 MCP 调用本地工具。
### 1.2 解决的问题

Web AI 通常运行在云端，默认无法直接访问用户电脑上的本地文件，也无法直接调用本地命令、读取本地项目、查看本地目录结构或操作本地开发环境。
WebAI LocalBridge 解决的是这个断层：

```text
用户本地电脑 / 远程电脑
↕
WebAI LocalBridge
↕
公网隧道 / MCP / 文件浏览器
↕
ChatGPT / Claude / 豆包 / 千问 / Kimi / Gemini / DeepSeek / Cloud Agent
```

它让用户可以把指定的本地目录以受控方式暴露给 AI 使用。用户可以选择只读浏览，也可以在开启 MCP 和权限控制后，让 AI 执行更深层的本地操作。
除了处理当前电脑上的文件，它也可以用于远程协助：在另一台电脑上运行 WebAI LocalBridge 后，用户可以通过固定域名或临时隧道，让 AI 远程查看、分析和协助处理那台电脑上的项目、文档、配置或运行状态。
### 1.3 适用场景

WebAI LocalBridge 适合以下场景：
- 让 ChatGPT、Claude 或其他 Web AI 阅读本地项目代码。
- 让 Web AI 查看本地文件夹结构。
- 让 AI 读取本地 Markdown、TXT、JSON、CSV、代码文件。
- 让 AI 预览 XLSX 表格内容。
- 让 AI 提取 PDF、DOCX、PPTX、HTML、RTF 等文件中的文本。
- 让 AI 通过 MCP 修改本地项目文件。
- 让 AI 在本地项目目录中执行命令。
- 让 AI 协助调试、构建、整理、迁移本地项目。
- 让豆包、千问、Kimi 等有云端 Agent 环境但没有官方 MCP 配置接口的 AI，通过 Agent 接入说明书连接本地 MCP。
- 让 Gemini、DeepSeek 等没有云端 Agent 执行环境、也没有官方 MCP 接口的 Web AI，通过 AI File Browser 只读查看本地文件。
- 通过固定域名远程处理另一台电脑上的项目或文件。
- 在远程协助场景中，让 AI 帮助查看、分析和处理另一台电脑上的项目状态。
- 作为个人或小团队的轻量级文件访问入口，在明确授权范围内临时分享指定目录。
- 作为受控的远程文件浏览入口，用于查看另一台电脑上的项目文件、文档资料、配置文件或运行日志。
- 作为轻量级远程协助工具，让 AI 或被授权的人通过浏览器查看指定目录内容，辅助排查问题。
- 作为临时公网文件入口，给指定 AI、Agent 或协作者访问特定文件夹，而不是开放整台电脑。
### 1.4 不适用场景

WebAI LocalBridge 不适合以下场景：
- 无限制公开整台电脑或整个磁盘。
- 长期暴露包含隐私、密钥、token、账号数据、浏览器数据或敏感日志的目录。
- 在不了解共享目录和权限范围的情况下开放写入、删除或命令执行能力。
- 把本地控制台端口直接暴露到公网。
- 替代完整的企业级网盘、权限系统、审计系统或远程运维平台。
- 在没有任何访问控制和风险隔离的情况下，作为长期公共文件服务使用。
- 把不可信 AI 或不可信用户接入到拥有写入、删除、命令执行权限的 MCP Server。
WebAI LocalBridge 可以用于文件分享、远程文件浏览和远程协助，但推荐方式是：只暴露明确需要访问的目录，只开放必要服务，只在需要时开启高权限 MCP 操作。

---

## 3. 架构说明

### 3.2 端口说明

WebAI LocalBridge 默认使用以下本地端口。
#### 3.2.1 33004：Human Control Panel

33004 是本地人类控制台端口。
用途：
- 管理服务。
- 查看状态。
- 配置共享目录。
- 配置 Tunnel。
- 管理权限。
- 下载 Agent 接入说明书。
访问方式：
`http://127.0.0.1:33004`
33004 是给本地用户本人使用的管理入口，不是给 Web AI 直接访问的入口。
#### 3.2.2 33005：Primary AI File Browser

33005 是主 AI File Browser 端口。
用途：
- 只读浏览主共享目录。
- 给 Web AI 查看文件和目录。
- 提供文件预览、文本提取、表格预览等能力。
本地地址：
`http://127.0.0.1:33005`
公网访问通常通过 Fast Tunnel 或 Fixed Domain Tunnel 生成。
#### 3.2.3 33006：Secondary AI File Browser

33006 是副 AI File Browser 端口。
用途：
- 只读浏览副共享目录。
- 给 AI 提供第二个独立文件入口。
- 适合把主项目目录和辅助资料目录分开。
本地地址：
`http://127.0.0.1:33006`
#### 3.2.4 33003：MCP Server

33003 是 MCP Server 端口。
用途：
- 给支持 MCP 的 AI 客户端调用本地工具。
- 给具备云端 Agent 执行环境的 AI 按 MCP Streamable HTTP / SSE 流程调用本地工具。
- 提供文件读取、文件搜索、文件写入、命令执行、任务管理等能力。
本地 MCP 地址：
`http://127.0.0.1:33003/mcp`
公网 MCP 地址通常形如：
`https://mcp.example.com/mcp`
或 Fast Tunnel 生成的临时地址。

---

## 4. 快速开始

### 4.3 打开本地控制台

启动后，浏览器会打开本地控制台：
`http://127.0.0.1:33004`
如果浏览器没有自动打开，可以手动访问该地址。
如果页面打不开，请检查：
- 启动器是否正常运行。
- 33004 端口是否被占用。
- Node Runtime 是否存在。
- 防火墙或安全软件是否拦截本地服务。

---

## 5. AI File Browser 使用说明

### 5.1 适合用途

AI File Browser 适合只读场景，尤其适合那些没有云端 Agent 执行环境、也没有官方 MCP 接口的 Web AI。
例如：
- Gemini
- DeepSeek
- 其他只能打开网页、读取链接或处理页面内容的 Web AI
这类 AI 不适合直接使用 MCP，因为它们通常不能稳定执行 MCP 初始化、保存 session id、调用 tools/list 和 tools/call。对它们来说，AI File Browser 更直接。
典型用途包括：
- 让 AI 查看项目目录结构。
- 让 AI 阅读代码文件。
- 让 AI 阅读 Markdown、TXT、JSON、CSV 等文本文件。
- 让 AI 预览 Excel 表格。
- 让 AI 提取 PDF 或 DOCX 文本。
- 让 AI 查看图片预览。
- 让 AI 了解 ZIP 压缩包内容。
- 让 AI 在不修改本地文件的情况下进行分析。
如果任务不需要写文件、删文件、移动文件或执行命令，优先使用 AI File Browser。

---

## 6. MCP Server 使用说明

### 6.1 适合用途

MCP Server 适合本地操作场景。
典型用途包括：
- 让 AI 读取项目文件。
- 让 AI 搜索文件名和文件内容。
- 让 AI 修改代码。
- 让 AI 新建文件。
- 让 AI 移动或重命名文件。
- 让 AI 删除明确指定的文件。
- 让 AI 执行本地命令。
- 让 AI 运行构建、测试、安装等任务。
- 让 AI 读取命令输出和任务日志。
- 让 AI 协助完成多步骤本地项目维护。
- 远程处理另一台电脑上的项目或文件。
- 在远程协助场景中，让 AI 帮助分析另一台电脑上的项目、配置和运行状态。
MCP Server 的能力比 AI File Browser 更强，因此风险也更高。使用 MCP 前，应确认共享目录、权限开关和 AI 客户端确认机制符合你的预期。
### 6.4 Chatgpt /Claude / 其他 MCP 客户端 / 云端 Agent 配置方式

Chatgpt / Claude 或其他 MCP 客户端如果支持远程 MCP Endpoint，可以直接使用控制台显示的 MCP URL 连接。
如果目标 AI 没有官方 MCP 配置界面，但有云端 Agent 执行环境，也可以使用 Agent 接入说明书。
这类 AI 包括但不限于：
- 豆包的办公任务 / Agent 场景
- 千问的任务助理 / Agent 场景
- Kimi 的 Agent 场景
- 其他可以运行代码、发送 HTTP 请求、维护会话状态的 Cloud Agent
处理方式：
1. 启动 MCP Server。
2. 等待控制台显示 MCP 公网地址。
3. 下载 Agent 接入说明书。
4. 把 Markdown 文件上传给目标 AI Agent。
5. 让 Agent 按说明书完成 initialize、session id 读取、tools/list 和 tools/call。
这类 Agent 不需要官方 MCP 配置界面，但必须具备基本的云端执行能力。如果 AI 只是普通聊天窗口，不能执行请求、不能维护 session，则应改用 AI File Browser。
### 6.6 写入、删除、命令执行等高风险操作说明

MCP 的高风险操作包括：
- 写入文件。
- 覆盖文件。
- 修改文件。
- 移动文件。
- 删除文件。
- 递归删除目录。
- 执行命令。
- 执行 PowerShell。
- 启动长期任务。
- 停止任务。
当前工具本身除了递归删除非空目录外，没有为每个高风险操作额外内置一层人工确认。也就是说，如果本地控制台已经开启相关权限，并且 AI 客户端允许该工具调用，MCP Server 会按工具参数执行操作。
递归删除非空目录属于特殊高风险操作，仍然需要明确参数，例如 recursive:true，并应由用户确认目标路径是否正确。
使用写入、删除、命令执行前，应确认：
- 当前共享目录是否正确。
- AI 是否理解任务目标。
- AI 是否已经读取相关文件。
- 是否需要备份。
- 是否开启了高级权限。
- 是否允许跨 root。
- 是否允许命令执行。
- 删除操作是否明确且必要。
### 6.7 ChatGPT Always allow 使用建议

ChatGPT 对 MCP 工具调用可能提供 Allow once 或 Always allow。
当前建议是：
前期使用：Allow once
高频稳定使用一段时间后：再尝试 Always allow
首次接入或前几天使用时，不建议直接依赖 Always allow。原因是 ChatGPT 可能在 MCP session、工具列表、连接状态或风险判断尚未稳定时出现断连、重新授权或工具不可用的问题。
如果你已经高频使用 MCP 一段时间，例如连续约 5 天都能稳定调用工具，可以再尝试 Always allow。Always allow 是否稳定，取决于 ChatGPT 客户端当时的 MCP 权限策略、工具风险判断和连接状态。
WebAI LocalBridge 这边的定位是：
只读查看：优先使用 AI File Browser
本地操作：使用 MCP Server
前期操作：推荐 Allow once
稳定后：可以尝试 Always allow
如果 Always allow 后出现断连或工具不可用，建议先切回 Allow once。
## 7. Agent 接入说明书

### 7.1 功能用途

Agent 接入说明书用于那些有云端 Agent 执行环境，但没有官方 MCP 配置入口的 AI 产品。
这类 AI 不能像 ChatGPT MCP 配置界面那样直接填写 MCP Endpoint，但它们可能具备以下能力：
- 可以运行云端任务。
- 可以发送 HTTP 请求。
- 可以执行 Python、JavaScript 或类似脚本。
- 可以保存一次请求返回的 session id。
- 可以根据说明书调用 MCP JSON-RPC 接口。
Agent 接入说明书的作用是：把当前 WebAI LocalBridge 的 MCP Endpoint、请求头要求、初始化流程、session 使用方式、tools/list 和 tools/call 的调用顺序写成一份 Markdown 文档，方便用户直接上传给这类 AI Agent。
它不是给普通网页聊天窗口看的普通说明文档，而是给具备执行能力的 Cloud Agent 使用的连接指南。
### 7.2 适用对象

Agent 接入说明书适合以下类型的 AI：
- 豆包的办公任务 / Agent 场景。
- 千问的任务助理 / Agent 场景。
- Kimi 的 Agent 场景。
- 其他可以运行代码、发送 HTTP 请求、维护会话状态的 Cloud Agent。
- 没有官方 MCP 配置界面，但可以根据文档执行 HTTP / JSON-RPC 请求的 Web AI。
这类 AI 的关键特征是：它不仅能阅读说明书，还能按照说明书实际发起请求。
如果某个 AI 只是普通聊天窗口，不能执行 HTTP 请求，不能维护 mcp-session-id，也不能调用 JSON-RPC，那么它不适合使用 Agent 接入说明书。此时应改用 AI File Browser，把文件浏览器链接发给它进行只读查看。
### 7.3 下载方式

在 WebAI LocalBridge 本地控制台中，先启动 MCP Server，并等待控制台显示可用的 MCP 公网地址。
然后在 MCP 区域点击：
下载 Agent 接入说明书
英文界面中对应按钮为：
Download Agent Guide
系统会下载一份 Markdown 文件。该文件是英文说明书，便于上传给各种 Web AI / Cloud Agent 使用。
下载时，WebAI LocalBridge 会把当前可用的 MCP Endpoint 写入说明书。例如：
`https://mcp.example.com/mcp`
如果 Fixed Domain Tunnel 可用，说明书会优先使用固定域名 MCP 地址。否则会使用当前可用的 Fast Tunnel MCP 地址。
### 7.4 上传给 Web AI / Cloud Agent 的使用方式

下载说明书后，将该 Markdown 文件上传给目标 Web AI 或 Cloud Agent，并明确告诉它：
请按照这份 MCP Agent Connection Guide 连接我的 WebAI LocalBridge MCP Endpoint。
先完成 initialize，读取 mcp-session-id，然后调用 tools/list 和 tunnel_status。
不要把 MCP Endpoint 当作普通网页打开。
推荐使用流程：
1. 在 WebAI LocalBridge 控制台启动 MCP Server。
2. 确认 MCP 公网地址可用。
3. 下载 Agent 接入说明书。
4. 上传 Markdown 文件给目标 AI Agent。
5. 要求 Agent 按说明书完成 MCP 初始化。
6. 要求 Agent 先调用 tools/list 查看可用工具。
7. 要求 Agent 再调用 tunnel_status 获取当前共享目录、权限状态和运行状态。
8. 根据任务需要继续调用文件、搜索、命令或任务工具。
Agent 不应假设本地路径、工具列表、权限状态或共享目录。它应通过 MCP 返回值实时读取这些信息。
### 7.5 MCP Streamable HTTP / SSE 连接流程

WebAI LocalBridge 的 MCP Endpoint 使用 MCP Streamable HTTP / SSE 方式连接。它不是普通网页链接，也不是文件浏览器链接。
MCP 请求需要使用 JSON-RPC，并带上正确请求头：
`Content-Type: application/json`
`Accept: application/json, text/event-stream`
基本连接流程如下：
1. 向 MCP Endpoint 发送 initialize JSON-RPC 请求。
2. 从 initialize 响应头中读取 mcp-session-id。
3. 保存该 mcp-session-id。
4. 后续请求都带上同一个 mcp-session-id 请求头。
5. 发送 notifications/initialized。
6. 调用 tools/list 获取工具列表。
7. 调用 tools/call 执行具体工具。
8. 先调用 tunnel_status 获取当前运行状态。
9. 根据任务继续调用文件读取、文件搜索、命令执行或任务管理工具。
推荐首次调用顺序：
initialize
notifications/initialized
tools/list
tools/call tunnel_status
tools/call skill list
tools/call skill read（如需要）
后续文件 / 搜索 / 命令 / 任务工具
常见错误处理：
- 如果返回 Not Acceptable，检查 Accept 请求头是否同时包含 application/json 和 text/event-stream。
- 如果返回 No session ID，检查后续请求是否带上了 mcp-session-id。
- 如果工具调用失败，先重新查看 tools/list 返回的工具名称、参数和 schema。
- 如果路径不存在，先调用 file_info 检查路径。
- 如果文件过大，优先使用 file_read_lines 或 content_search。

---

## 8. Tunnel 使用说明

### 8.1 Fast Tunnel

Fast Tunnel 是临时公网隧道。它适合快速测试、临时连接和短期任务。
Fast Tunnel 的特点：
- 不需要用户准备自己的域名。
- 启动后自动生成临时公网 URL。
- URL 可能变化。
- 适合临时发给 ChatGPT、Claude、Gemini、DeepSeek 或其他 Web AI。
- 适合首次测试 AI File Browser 或 MCP Server。
- 不适合作为长期稳定入口。
Fast Tunnel 可能生成类似这样的地址：
`https://xxxx-yyyy-zzzz.trycloudflare.com`
如果用于 MCP，最终 MCP Endpoint 通常需要带 /mcp：
`https://xxxx-yyyy-zzzz.trycloudflare.com/mcp`
Fast Tunnel 更适合“马上用一次”的场景。如果需要长期固定地址，建议使用 Fixed Domain Tunnel。
### 8.2 Fixed Domain Tunnel

Fixed Domain Tunnel 是固定域名隧道。它适合长期使用、稳定接入和固定配置。
用户只需要填写一个 Base Domain，WebAI LocalBridge 会自动推导多个服务地址：
`mcp.<Base Domain>/mcp`
`files.<Base Domain>`
`files2.<Base Domain>`
`preview.<Base Domain>`
例如 Base Domain 为：
example.com
则自动生成：
`https://mcp.example.com/mcp`
`https://files.example.com`
`https://files2.example.com`
`https://preview.example.com`
Fixed Domain Tunnel 适合以下场景：
- 长期给 ChatGPT 配置 MCP Endpoint。
- 长期给 Web AI 使用 AI File Browser。
- 远程访问另一台电脑上的项目文件。
- 远程协助场景。
- 多次复用同一套本地服务地址。
- 避免 Fast Tunnel 地址变化导致重新配置。
### 8.3 Base Domain 填写规则

Base Domain 只填写域名本身，不填写协议、路径或具体子域名。
正确示例：
example.com
my-domain.pp.ua
错误示例：
`https://example.com`
`http://example.com`
mcp.example.com
files.example.com
example.com/mcp
localhost
127. 0.0.1
[::1]
填写 Base Domain 后，WebAI LocalBridge 会自动生成 MCP、主文件浏览器、副文件浏览器和前端预览的固定地址。用户不需要手动填写多个完整 URL。
### 8.4 自动生成的固定域名

Fixed Domain Tunnel 会基于 Base Domain 自动生成多个固定入口。
#### 8.4.1 MCP 固定域名

MCP 固定域名用于连接 MCP Server。
格式：
https://mcp.<Base Domain>/mcp
示例：
`https://mcp.example.com/mcp`
用途：
- ChatGPT MCP 配置。
- Claude / 其他 MCP 客户端连接。
- Cloud Agent 按 MCP Streamable HTTP / SSE 调用工具。
- Agent 接入说明书中的 MCP Endpoint。
MCP 固定域名不是普通网页链接。它是 MCP JSON-RPC 接口。
#### 8.4.2 Primary AI File Browser 固定域名

Primary AI File Browser 固定域名用于访问主文件浏览器。
格式：
https://files.<Base Domain>
示例：
`https://files.example.com`
用途：
- 让 Web AI 只读查看主共享目录。
- 让 AI 阅读本地项目文件。
- 让 AI 查看代码、文档、表格、PDF 文本和图片预览。
- 作为默认文件浏览器入口发给 Gemini、DeepSeek 等 Web AI。
#### 8.4.3 Secondary AI File Browser 固定域名

Secondary AI File Browser 固定域名用于访问副文件浏览器。
格式：
https://files2.<Base Domain>
示例：
`https://files2.example.com`
用途：
- 访问第二个共享目录。
- 把主项目和辅助资料分开。
- 给 AI 提供另一个只读文件入口。
- 在远程协助场景中单独开放工具箱、资料库或参考文件夹。
#### 8.4.4 Frontend Preview 固定域名

Frontend Preview 固定域名用于访问本地前端预览服务。
格式：
https://preview.<Base Domain>
示例：
`https://preview.example.com`
用途：
- 暴露本地前端开发预览页面。
- 让 Web AI 查看本地运行的前端页面。
- 远程查看 Vite、React、Vue 或其他本地开发服务器的页面效果。
Frontend Preview 是否可用取决于本地前端预览服务是否正在运行，以及控制台中是否启用了对应的固定域名预览能力。
### 8.5 Cloudflare Token 说明

Fixed Domain Tunnel 需要 Cloudflare Tunnel Token。该 token 用于让本地 cloudflared 连接到用户自己的 Cloudflare Tunnel 配置。
Token 属于敏感信息，应按以下方式处理：
- 只保存在本机配置中。
- 不要提交到 Git 仓库。
- 不要写进 README、截图、日志或公开 issue。
- 不要打包进发布版配置文件。
- 不要发给不可信 AI 或不可信用户。
- 更换电脑或重新安装时，应重新配置或确认 token 是否仍然有效。
WebAI LocalBridge 的真实运行配置文件通常是：
`mcp-tunnel-config.json`
该文件可能包含 Cloudflare Token、本机路径、共享目录和权限开关。发布 portable zip 或安装包时，不应包含真实的 mcp-tunnel-config.json。
发布包中应使用安全的示例配置：
`mcp-tunnel-config.example.json`
### 8.6 常见连接问题

常见问题一：Fixed Domain Tunnel 显示 running，但网页打不开。
可能原因：
- 对应的本地服务没有启动。
- 33005 / 33006 / 33003 本地端口没有监听。
- Cloudflare Tunnel 已连接，但 origin service 不可用。
- Base Domain 或子域名配置不正确。
- Cloudflare 侧 DNS / Tunnel 路由没有正确配置。
处理方式：
- 先检查控制台中对应服务是否 running。
- AI File Browser 要确认 33005 或 33006 正常。
- MCP 要确认 33003 正常。
- 再检查 Fixed Domain Tunnel 状态。
- 最后检查 Cloudflare 配置和域名解析。
常见问题二：MCP 地址在浏览器中打开不像网页。
这是正常的。MCP Endpoint 不是网页，而是 MCP JSON-RPC 接口。浏览器直接打开可能没有正常页面。
如果要给 AI 只读查看文件，应使用 AI File Browser 地址，而不是 MCP Endpoint。
常见问题三：Fast Tunnel 地址变化。
Fast Tunnel 是临时地址，重启后可能变化。需要长期固定地址时，应使用 Fixed Domain Tunnel。
常见问题四：Cloudflare 日志出现 stream canceled。
如果 MCP 或文件浏览器仍然可用，偶发 stream canceled 不一定代表服务失败。它可能只是客户端、中间连接或 SSE 流主动关闭。若同时出现访问失败，再结合控制台服务状态排查。
常见问题五：files / files2 访问失败。
检查 Primary AI File Browser 或 Secondary AI File Browser 是否已经启动。Fixed Tunnel running 只代表隧道层在运行，不代表每个本地 origin service 都已启动。

---

## 9. 权限与安全

### 9.1 本地控制台只允许本机访问

WebAI LocalBridge 的本地控制台是人类管理入口，默认地址为：
`http://127.0.0.1:33004`
它用于设置共享目录、启动服务、配置 Tunnel、管理 MCP 权限和查看运行状态。
控制台应只允许本机访问。它不是给 Web AI 直接访问的页面，也不是给协作者公开使用的管理后台。
Web AI 应访问的是：
AI File Browser 公网地址
MCP Endpoint 公网地址
Frontend Preview 公网地址
而不是 33004 控制台。
### 9.2 不要公网暴露 33004

不要把 33004 控制台端口通过 Tunnel、端口映射、反向代理或公网服务器直接暴露出去。
原因很简单：33004 是控制面，不是数据面。它可以管理共享目录、权限、Tunnel 和本地服务。如果将控制台暴露到公网，风险会明显高于暴露只读文件浏览器或 MCP Endpoint。
推荐边界：
33004：只给本机用户使用
33005：可通过 Tunnel 给 AI 只读访问
33006：可通过 Tunnel 给 AI 只读访问
33003/mcp：可通过 Tunnel 给 MCP 客户端访问
如果需要远程管理，建议先通过远程桌面、内网 VPN、Tailscale、ZeroTier 或其他可信远程访问方式进入本机，再打开 33004 控制台。
### 9.3 MCP 高级权限说明

MCP Server 的能力取决于控制台中的权限配置。
常见权限包括：
- 是否允许文件写入。
- 是否允许文件删除。
- 是否允许跨 root 访问。
- 是否允许命令执行。
- 是否允许 PowerShell 执行。
- 是否允许任务启动。
- 是否允许更高风险的本地操作。
开启高级权限后，AI 可以通过 MCP 调用更强的本地工具。此时 MCP 不再只是“读取文件”，而是可能修改项目、运行命令或改变本地环境。
当前工具本身除了递归删除非空目录外，没有为每个高风险操作额外内置一层人工确认。通常情况下，只要本地权限允许、AI 客户端允许工具调用、工具参数有效，MCP Server 就会执行对应操作。
因此，开启高级权限前应确认：
- 当前共享目录是否正确。
- 是否允许 AI 修改这个目录。
- 是否需要备份。
- 是否允许跨 root。
- 是否允许命令执行。
- 当前 AI 是否可信。
- 当前任务是否明确。
### 9.4 文件写入与覆盖规则

MCP 文件写入能力通常包括新建文件、覆盖文件、编辑文件和移动文件。
常见规则：
- 新建文件：目标不存在时可以创建。
- 覆盖文件：目标已存在时通常需要明确覆盖参数。
- 编辑文件：按匹配文本替换内容。
- 移动文件：目标存在时通常需要明确覆盖参数。
- 备份：部分编辑操作可以使用 backup 选项生成 .bak 文件。
使用文件写入能力前，建议先让 AI：
1. 读取相关文件。
2. 说明计划修改哪些文件。
3. 尽量使用小范围修改。
4. 对关键文件启用备份。
5. 修改后执行语法检查或测试命令。
对于项目代码，推荐先让 AI 使用 file_read_lines、content_search 和 file_info 明确上下文，再执行写入或编辑操作。
### 9.5 删除与递归删除规则

删除操作风险高于普通写入操作。
文件删除通常用于删除明确指定的文件。目录删除分为空目录删除和非空目录删除。
推荐规则：
- 删除文件前，先确认路径。
- 删除目录前，先查看目录内容。
- 空目录可以直接删除。
- 非空目录递归删除需要特别谨慎。
- 递归删除应只用于明确无用的构建产物、缓存目录、临时目录或用户明确指定的目录。
递归删除非空目录时，工具通常需要显式参数，例如：
`recursive:true`
对于非空目录，不应让 AI 在未确认路径的情况下直接递归删除。尤其要避免误删：
- 项目根目录。
- 用户主目录。
- 桌面目录。
- 文档目录。
- Git 仓库根目录。
- 包含源码、论文、业务资料或隐私数据的目录。
推荐删除前检查：
先 file_info
再 file_tree
确认目录内容
最后再 dir_remove
### 9.6 命令执行风险

MCP Server 可以提供命令执行能力，例如 command_run、powershell_run、task_start 或类似工具。
命令执行适合：
- 安装依赖。
- 运行测试。
- 构建项目。
- 检查端口。
- 查看 Git 状态。
- 读取运行日志。
- 启动开发服务器。
- 执行项目脚本。
命令执行也可能带来风险，例如：
- 删除文件。
- 修改系统配置。
- 安装不可信依赖。
- 上传或泄露本地数据。
- 长时间占用资源。
- 启动未知进程。
- 改变 Git 工作区状态。
使用命令执行前，建议：
- 指定明确的 cwd。
- 优先使用 Windows 绝对路径。
- 避免在不清楚含义的情况下运行长命令。
- 避免直接运行来自不可信来源的脚本。
- 对 install、build、test 等命令设置合理超时。
- 对长期任务使用 task 工具，并通过 task_status / task_logs 查看结果。
- 不要让 AI 在系统目录或用户主目录中随意执行命令。
当前 MCP 工具要求命令 cwd 使用 Windows 绝对路径，不要使用：
`cwd="/"`
应使用类似：
C:\Users\<User>\Projects\<ProjectName>
### 9.7 配置文件与 Token 保护

WebAI LocalBridge 的真实运行配置通常保存在：
`mcp-tunnel-config.json`
该文件可能包含：
- 本机共享目录。
- 副文件浏览器目录。
- Fixed Domain Tunnel Base Domain。
- Cloudflare Tunnel Token。
- MCP 权限开关。
- Root 边界模式。
- 命令执行开关。
- Skill Folder 配置。
该文件是本机运行态配置，不应提交到 Git，也不应打包进公开发布版。
发布包应使用：
`mcp-tunnel-config.example.json`
示例配置中不应包含：
- 真实 token。
- 真实域名。
- 真实本机路径。
- 真实共享目录。
- 真实用户信息。
- 高风险权限默认开启状态。
建议默认配置保持安全：
`mcpAdvancedPermission: false`
`commandExecution: false`
`fileFastConfirm: false`
`rootBoundaryMode: root-only`
`fixedTunnel.token: ""`
`fixedTunnel.enabled: false`
如果 token 泄露，应立即在 Cloudflare 侧撤销或重置相关 Tunnel Token。

---

## English README

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