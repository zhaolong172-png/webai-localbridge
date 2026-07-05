# WebAI LocalBridge

WebAI LocalBridge 是连接本地文件、本地工具、MCP Server、AI File Browser 和 Web AI / Cloud Agent 的本地网关。

## 下载

- [离线安装包](./output/WebAI-LocalBridge-offline-installer-v3.5.13.zip)
- [Release: v3.5.13](https://github.com/zhaolong172-png/webai-localbridge/releases/tag/v3.5.13)

## 许可

本项目使用 The Unlicense 发布。

---
1. 项目简介
1.1 WebAI LocalBridge 是什么
WebAI LocalBridge 是一个运行在用户本地电脑上的 AI 文件网关应用。它让 ChatGPT、Claude、豆包、千问、Kimi、Gemini、DeepSeek 以及其他 Web AI / Cloud Agent，在用户授权的前提下，通过 AI File Browser、MCP Server 和公网隧道访问本地文件、本地项目和本地工具。
它不是普通网盘，也不是云端同步盘。WebAI LocalBridge 的核心定位是：在本地电脑和 Web AI 之间建立一座可控的桥，让 AI 能够读取、分析和在需要时操作本地项目。
WebAI LocalBridge 主要包含两个入口：
•	AI File Browser：只读文件浏览器，适合让没有云端 Agent 环境、也没有官方 MCP 接口的 Web AI 查看本地文件，例如 Gemini、DeepSeek 等。
•	MCP Server：本地操作接口，适合让支持 MCP 的客户端，或具备云端 Agent 执行环境的 AI，通过 MCP 调用本地工具。
1.2 解决的问题
Web AI 通常运行在云端，默认无法直接访问用户电脑上的本地文件，也无法直接调用本地命令、读取本地项目、查看本地目录结构或操作本地开发环境。
WebAI LocalBridge 解决的是这个断层：
用户本地电脑 / 远程电脑
  ↕
WebAI LocalBridge
  ↕
公网隧道 / MCP / 文件浏览器
  ↕
ChatGPT / Claude / 豆包 / 千问 / Kimi / Gemini / DeepSeek / Cloud Agent
它让用户可以把指定的本地目录以受控方式暴露给 AI 使用。用户可以选择只读浏览，也可以在开启 MCP 和权限控制后，让 AI 执行更深层的本地操作。
除了处理当前电脑上的文件，它也可以用于远程协助：在另一台电脑上运行 WebAI LocalBridge 后，用户可以通过固定域名或临时隧道，让 AI 远程查看、分析和协助处理那台电脑上的项目、文档、配置或运行状态。
1.3 适用场景
1.3 适用场景
WebAI LocalBridge 适合以下场景：
•	让 ChatGPT、Claude 或其他 Web AI 阅读本地项目代码。
•	让 Web AI 查看本地文件夹结构。
•	让 AI 读取本地 Markdown、TXT、JSON、CSV、代码文件。
•	让 AI 预览 XLSX 表格内容。
•	让 AI 提取 PDF、DOCX、PPTX、HTML、RTF 等文件中的文本。
•	让 AI 通过 MCP 修改本地项目文件。
•	让 AI 在本地项目目录中执行命令。
•	让 AI 协助调试、构建、整理、迁移本地项目。
•	让豆包、千问、Kimi 等有云端 Agent 环境但没有官方 MCP 配置接口的 AI，通过 Agent 接入说明书连接本地 MCP。
•	让 Gemini、DeepSeek 等没有云端 Agent 执行环境、也没有官方 MCP 接口的 Web AI，通过 AI File Browser 只读查看本地文件。
•	通过固定域名远程处理另一台电脑上的项目或文件。
•	在远程协助场景中，让 AI 帮助查看、分析和处理另一台电脑上的项目状态。
•	作为个人或小团队的轻量级文件访问入口，在明确授权范围内临时分享指定目录。
•	作为受控的远程文件浏览入口，用于查看另一台电脑上的项目文件、文档资料、配置文件或运行日志。
•	作为轻量级远程协助工具，让 AI 或被授权的人通过浏览器查看指定目录内容，辅助排查问题。
•	作为临时公网文件入口，给指定 AI、Agent 或协作者访问特定文件夹，而不是开放整台电脑。
1.4 不适用场景
WebAI LocalBridge 不适合以下场景：
•	无限制公开整台电脑或整个磁盘。
•	长期暴露包含隐私、密钥、token、账号数据、浏览器数据或敏感日志的目录。
•	在不了解共享目录和权限范围的情况下开放写入、删除或命令执行能力。
•	把本地控制台端口直接暴露到公网。
•	替代完整的企业级网盘、权限系统、审计系统或远程运维平台。
•	在没有任何访问控制和风险隔离的情况下，作为长期公共文件服务使用。
•	把不可信 AI 或不可信用户接入到拥有写入、删除、命令执行权限的 MCP Server。
WebAI LocalBridge 可以用于文件分享、远程文件浏览和远程协助，但推荐方式是：只暴露明确需要访问的目录，只开放必要服务，只在需要时开启高权限 MCP 操作。

________________________________________
3. 架构说明
3.2 端口说明
WebAI LocalBridge 默认使用以下本地端口。
3.2.1 33004：Human Control Panel
33004 是本地人类控制台端口。
用途：
•	管理服务。
•	查看状态。
•	配置共享目录。
•	配置 Tunnel。
•	管理权限。
•	下载 Agent 接入说明书。
访问方式：
http://127.0.0.1:33004
33004 是给本地用户本人使用的管理入口，不是给 Web AI 直接访问的入口。
3.2.2 33005：Primary AI File Browser
33005 是主 AI File Browser 端口。
用途：
•	只读浏览主共享目录。
•	给 Web AI 查看文件和目录。
•	提供文件预览、文本提取、表格预览等能力。
本地地址：
http://127.0.0.1:33005
公网访问通常通过 Fast Tunnel 或 Fixed Domain Tunnel 生成。
3.2.3 33006：Secondary AI File Browser
33006 是副 AI File Browser 端口。
用途：
•	只读浏览副共享目录。
•	给 AI 提供第二个独立文件入口。
•	适合把主项目目录和辅助资料目录分开。
本地地址：
http://127.0.0.1:33006
3.2.4 33003：MCP Server
33003 是 MCP Server 端口。
用途：
•	给支持 MCP 的 AI 客户端调用本地工具。
•	给具备云端 Agent 执行环境的 AI 按 MCP Streamable HTTP / SSE 流程调用本地工具。
•	提供文件读取、文件搜索、文件写入、命令执行、任务管理等能力。
本地 MCP 地址：
http://127.0.0.1:33003/mcp
公网 MCP 地址通常形如：
https://mcp.example.com/mcp
或 Fast Tunnel 生成的临时地址。
________________________________________
4. 快速开始
4.3 打开本地控制台
启动后，浏览器会打开本地控制台：
http://127.0.0.1:33004
如果浏览器没有自动打开，可以手动访问该地址。
如果页面打不开，请检查：
•	启动器是否正常运行。
•	33004 端口是否被占用。
•	Node Runtime 是否存在。
•	防火墙或安全软件是否拦截本地服务。
________________________________________
5. AI File Browser 使用说明
5.1 适合用途
AI File Browser 适合只读场景，尤其适合那些没有云端 Agent 执行环境、也没有官方 MCP 接口的 Web AI。
例如：
•	Gemini
•	DeepSeek
•	其他只能打开网页、读取链接或处理页面内容的 Web AI
这类 AI 不适合直接使用 MCP，因为它们通常不能稳定执行 MCP 初始化、保存 session id、调用 tools/list 和 tools/call。对它们来说，AI File Browser 更直接。
典型用途包括：
•	让 AI 查看项目目录结构。
•	让 AI 阅读代码文件。
•	让 AI 阅读 Markdown、TXT、JSON、CSV 等文本文件。
•	让 AI 预览 Excel 表格。
•	让 AI 提取 PDF 或 DOCX 文本。
•	让 AI 查看图片预览。
•	让 AI 了解 ZIP 压缩包内容。
•	让 AI 在不修改本地文件的情况下进行分析。
如果任务不需要写文件、删文件、移动文件或执行命令，优先使用 AI File Browser。
________________________________________
6. MCP Server 使用说明
6.1 适合用途
MCP Server 适合本地操作场景。
典型用途包括：
•	让 AI 读取项目文件。
•	让 AI 搜索文件名和文件内容。
•	让 AI 修改代码。
•	让 AI 新建文件。
•	让 AI 移动或重命名文件。
•	让 AI 删除明确指定的文件。
•	让 AI 执行本地命令。
•	让 AI 运行构建、测试、安装等任务。
•	让 AI 读取命令输出和任务日志。
•	让 AI 协助完成多步骤本地项目维护。
•	远程处理另一台电脑上的项目或文件。
•	在远程协助场景中，让 AI 帮助分析另一台电脑上的项目、配置和运行状态。
MCP Server 的能力比 AI File Browser 更强，因此风险也更高。使用 MCP 前，应确认共享目录、权限开关和 AI 客户端确认机制符合你的预期。
6.4 Chatgpt /Claude / 其他 MCP 客户端 / 云端 Agent 配置方式
Chatgpt / Claude 或其他 MCP 客户端如果支持远程 MCP Endpoint，可以直接使用控制台显示的 MCP URL 连接。
如果目标 AI 没有官方 MCP 配置界面，但有云端 Agent 执行环境，也可以使用 Agent 接入说明书。
这类 AI 包括但不限于：
•	豆包的办公任务 / Agent 场景
•	千问的任务助理 / Agent 场景
•	Kimi 的 Agent 场景
•	其他可以运行代码、发送 HTTP 请求、维护会话状态的 Cloud Agent
处理方式：
1.	启动 MCP Server。
2.	等待控制台显示 MCP 公网地址。
3.	下载 Agent 接入说明书。
4.	把 Markdown 文件上传给目标 AI Agent。
5.	让 Agent 按说明书完成 initialize、session id 读取、tools/list 和 tools/call。
这类 Agent 不需要官方 MCP 配置界面，但必须具备基本的云端执行能力。如果 AI 只是普通聊天窗口，不能执行请求、不能维护 session，则应改用 AI File Browser。
6.6 写入、删除、命令执行等高风险操作说明
MCP 的高风险操作包括：
•	写入文件。
•	覆盖文件。
•	修改文件。
•	移动文件。
•	删除文件。
•	递归删除目录。
•	执行命令。
•	执行 PowerShell。
•	启动长期任务。
•	停止任务。
当前工具本身除了递归删除非空目录外，没有为每个高风险操作额外内置一层人工确认。也就是说，如果本地控制台已经开启相关权限，并且 AI 客户端允许该工具调用，MCP Server 会按工具参数执行操作。
递归删除非空目录属于特殊高风险操作，仍然需要明确参数，例如 recursive:true，并应由用户确认目标路径是否正确。
使用写入、删除、命令执行前，应确认：
•	当前共享目录是否正确。
•	AI 是否理解任务目标。
•	AI 是否已经读取相关文件。
•	是否需要备份。
•	是否开启了高级权限。
•	是否允许跨 root。
•	是否允许命令执行。
•	删除操作是否明确且必要。
6.7 ChatGPT Always allow 使用建议
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
7. Agent 接入说明书
7.1 功能用途
Agent 接入说明书用于那些有云端 Agent 执行环境，但没有官方 MCP 配置入口的 AI 产品。
这类 AI 不能像 ChatGPT MCP 配置界面那样直接填写 MCP Endpoint，但它们可能具备以下能力：
•	可以运行云端任务。
•	可以发送 HTTP 请求。
•	可以执行 Python、JavaScript 或类似脚本。
•	可以保存一次请求返回的 session id。
•	可以根据说明书调用 MCP JSON-RPC 接口。
Agent 接入说明书的作用是：把当前 WebAI LocalBridge 的 MCP Endpoint、请求头要求、初始化流程、session 使用方式、tools/list 和 tools/call 的调用顺序写成一份 Markdown 文档，方便用户直接上传给这类 AI Agent。
它不是给普通网页聊天窗口看的普通说明文档，而是给具备执行能力的 Cloud Agent 使用的连接指南。
7.2 适用对象
Agent 接入说明书适合以下类型的 AI：
•	豆包的办公任务 / Agent 场景。
•	千问的任务助理 / Agent 场景。
•	Kimi 的 Agent 场景。
•	其他可以运行代码、发送 HTTP 请求、维护会话状态的 Cloud Agent。
•	没有官方 MCP 配置界面，但可以根据文档执行 HTTP / JSON-RPC 请求的 Web AI。
这类 AI 的关键特征是：它不仅能阅读说明书，还能按照说明书实际发起请求。
如果某个 AI 只是普通聊天窗口，不能执行 HTTP 请求，不能维护 mcp-session-id，也不能调用 JSON-RPC，那么它不适合使用 Agent 接入说明书。此时应改用 AI File Browser，把文件浏览器链接发给它进行只读查看。
7.3 下载方式
在 WebAI LocalBridge 本地控制台中，先启动 MCP Server，并等待控制台显示可用的 MCP 公网地址。
然后在 MCP 区域点击：
下载 Agent 接入说明书
英文界面中对应按钮为：
Download Agent Guide
系统会下载一份 Markdown 文件。该文件是英文说明书，便于上传给各种 Web AI / Cloud Agent 使用。
下载时，WebAI LocalBridge 会把当前可用的 MCP Endpoint 写入说明书。例如：
https://mcp.example.com/mcp
如果 Fixed Domain Tunnel 可用，说明书会优先使用固定域名 MCP 地址。否则会使用当前可用的 Fast Tunnel MCP 地址。
7.4 上传给 Web AI / Cloud Agent 的使用方式
下载说明书后，将该 Markdown 文件上传给目标 Web AI 或 Cloud Agent，并明确告诉它：
请按照这份 MCP Agent Connection Guide 连接我的 WebAI LocalBridge MCP Endpoint。
先完成 initialize，读取 mcp-session-id，然后调用 tools/list 和 tunnel_status。
不要把 MCP Endpoint 当作普通网页打开。
推荐使用流程：
1.	在 WebAI LocalBridge 控制台启动 MCP Server。
2.	确认 MCP 公网地址可用。
3.	下载 Agent 接入说明书。
4.	上传 Markdown 文件给目标 AI Agent。
5.	要求 Agent 按说明书完成 MCP 初始化。
6.	要求 Agent 先调用 tools/list 查看可用工具。
7.	要求 Agent 再调用 tunnel_status 获取当前共享目录、权限状态和运行状态。
8.	根据任务需要继续调用文件、搜索、命令或任务工具。
Agent 不应假设本地路径、工具列表、权限状态或共享目录。它应通过 MCP 返回值实时读取这些信息。
7.5 MCP Streamable HTTP / SSE 连接流程
WebAI LocalBridge 的 MCP Endpoint 使用 MCP Streamable HTTP / SSE 方式连接。它不是普通网页链接，也不是文件浏览器链接。
MCP 请求需要使用 JSON-RPC，并带上正确请求头：
Content-Type: application/json
Accept: application/json, text/event-stream
基本连接流程如下：
1.	向 MCP Endpoint 发送 initialize JSON-RPC 请求。
2.	从 initialize 响应头中读取 mcp-session-id。
3.	保存该 mcp-session-id。
4.	后续请求都带上同一个 mcp-session-id 请求头。
5.	发送 notifications/initialized。
6.	调用 tools/list 获取工具列表。
7.	调用 tools/call 执行具体工具。
8.	先调用 tunnel_status 获取当前运行状态。
9.	根据任务继续调用文件读取、文件搜索、命令执行或任务管理工具。
推荐首次调用顺序：
initialize
notifications/initialized
tools/list
tools/call tunnel_status
tools/call skill list
tools/call skill read（如需要）
后续文件 / 搜索 / 命令 / 任务工具
常见错误处理：
•	如果返回 Not Acceptable，检查 Accept 请求头是否同时包含 application/json 和 text/event-stream。
•	如果返回 No session ID，检查后续请求是否带上了 mcp-session-id。
•	如果工具调用失败，先重新查看 tools/list 返回的工具名称、参数和 schema。
•	如果路径不存在，先调用 file_info 检查路径。
•	如果文件过大，优先使用 file_read_lines 或 content_search。
________________________________________
8. Tunnel 使用说明
8.1 Fast Tunnel
Fast Tunnel 是临时公网隧道。它适合快速测试、临时连接和短期任务。
Fast Tunnel 的特点：
•	不需要用户准备自己的域名。
•	启动后自动生成临时公网 URL。
•	URL 可能变化。
•	适合临时发给 ChatGPT、Claude、Gemini、DeepSeek 或其他 Web AI。
•	适合首次测试 AI File Browser 或 MCP Server。
•	不适合作为长期稳定入口。
Fast Tunnel 可能生成类似这样的地址：
https://xxxx-yyyy-zzzz.trycloudflare.com
如果用于 MCP，最终 MCP Endpoint 通常需要带 /mcp：
https://xxxx-yyyy-zzzz.trycloudflare.com/mcp
Fast Tunnel 更适合“马上用一次”的场景。如果需要长期固定地址，建议使用 Fixed Domain Tunnel。
8.2 Fixed Domain Tunnel
Fixed Domain Tunnel 是固定域名隧道。它适合长期使用、稳定接入和固定配置。
用户只需要填写一个 Base Domain，WebAI LocalBridge 会自动推导多个服务地址：
mcp.<Base Domain>/mcp
files.<Base Domain>
files2.<Base Domain>
preview.<Base Domain>
例如 Base Domain 为：
example.com
则自动生成：
https://mcp.example.com/mcp
https://files.example.com
https://files2.example.com
https://preview.example.com
Fixed Domain Tunnel 适合以下场景：
•	长期给 ChatGPT 配置 MCP Endpoint。
•	长期给 Web AI 使用 AI File Browser。
•	远程访问另一台电脑上的项目文件。
•	远程协助场景。
•	多次复用同一套本地服务地址。
•	避免 Fast Tunnel 地址变化导致重新配置。
8.3 Base Domain 填写规则
Base Domain 只填写域名本身，不填写协议、路径或具体子域名。
正确示例：
example.com
my-domain.pp.ua
错误示例：
https://example.com
http://example.com
mcp.example.com
files.example.com
example.com/mcp
localhost
127.0.0.1
[::1]
填写 Base Domain 后，WebAI LocalBridge 会自动生成 MCP、主文件浏览器、副文件浏览器和前端预览的固定地址。用户不需要手动填写多个完整 URL。
8.4 自动生成的固定域名
Fixed Domain Tunnel 会基于 Base Domain 自动生成多个固定入口。
8.4.1 MCP 固定域名
MCP 固定域名用于连接 MCP Server。
格式：
https://mcp.<Base Domain>/mcp
示例：
https://mcp.example.com/mcp
用途：
•	ChatGPT MCP 配置。
•	Claude / 其他 MCP 客户端连接。
•	Cloud Agent 按 MCP Streamable HTTP / SSE 调用工具。
•	Agent 接入说明书中的 MCP Endpoint。
MCP 固定域名不是普通网页链接。它是 MCP JSON-RPC 接口。
8.4.2 Primary AI File Browser 固定域名
Primary AI File Browser 固定域名用于访问主文件浏览器。
格式：
https://files.<Base Domain>
示例：
https://files.example.com
用途：
•	让 Web AI 只读查看主共享目录。
•	让 AI 阅读本地项目文件。
•	让 AI 查看代码、文档、表格、PDF 文本和图片预览。
•	作为默认文件浏览器入口发给 Gemini、DeepSeek 等 Web AI。
8.4.3 Secondary AI File Browser 固定域名
Secondary AI File Browser 固定域名用于访问副文件浏览器。
格式：
https://files2.<Base Domain>
示例：
https://files2.example.com
用途：
•	访问第二个共享目录。
•	把主项目和辅助资料分开。
•	给 AI 提供另一个只读文件入口。
•	在远程协助场景中单独开放工具箱、资料库或参考文件夹。
8.4.4 Frontend Preview 固定域名
Frontend Preview 固定域名用于访问本地前端预览服务。
格式：
https://preview.<Base Domain>
示例：
https://preview.example.com
用途：
•	暴露本地前端开发预览页面。
•	让 Web AI 查看本地运行的前端页面。
•	远程查看 Vite、React、Vue 或其他本地开发服务器的页面效果。
Frontend Preview 是否可用取决于本地前端预览服务是否正在运行，以及控制台中是否启用了对应的固定域名预览能力。
8.5 Cloudflare Token 说明
Fixed Domain Tunnel 需要 Cloudflare Tunnel Token。该 token 用于让本地 cloudflared 连接到用户自己的 Cloudflare Tunnel 配置。
Token 属于敏感信息，应按以下方式处理：
•	只保存在本机配置中。
•	不要提交到 Git 仓库。
•	不要写进 README、截图、日志或公开 issue。
•	不要打包进发布版配置文件。
•	不要发给不可信 AI 或不可信用户。
•	更换电脑或重新安装时，应重新配置或确认 token 是否仍然有效。
WebAI LocalBridge 的真实运行配置文件通常是：
mcp-tunnel-config.json
该文件可能包含 Cloudflare Token、本机路径、共享目录和权限开关。发布 portable zip 或安装包时，不应包含真实的 mcp-tunnel-config.json。
发布包中应使用安全的示例配置：
mcp-tunnel-config.example.json
8.6 常见连接问题
常见问题一：Fixed Domain Tunnel 显示 running，但网页打不开。
可能原因：
•	对应的本地服务没有启动。
•	33005 / 33006 / 33003 本地端口没有监听。
•	Cloudflare Tunnel 已连接，但 origin service 不可用。
•	Base Domain 或子域名配置不正确。
•	Cloudflare 侧 DNS / Tunnel 路由没有正确配置。
处理方式：
•	先检查控制台中对应服务是否 running。
•	AI File Browser 要确认 33005 或 33006 正常。
•	MCP 要确认 33003 正常。
•	再检查 Fixed Domain Tunnel 状态。
•	最后检查 Cloudflare 配置和域名解析。
常见问题二：MCP 地址在浏览器中打开不像网页。
这是正常的。MCP Endpoint 不是网页，而是 MCP JSON-RPC 接口。浏览器直接打开可能没有正常页面。
如果要给 AI 只读查看文件，应使用 AI File Browser 地址，而不是 MCP Endpoint。
常见问题三：Fast Tunnel 地址变化。
Fast Tunnel 是临时地址，重启后可能变化。需要长期固定地址时，应使用 Fixed Domain Tunnel。
常见问题四：Cloudflare 日志出现 stream canceled。
如果 MCP 或文件浏览器仍然可用，偶发 stream canceled 不一定代表服务失败。它可能只是客户端、中间连接或 SSE 流主动关闭。若同时出现访问失败，再结合控制台服务状态排查。
常见问题五：files / files2 访问失败。
检查 Primary AI File Browser 或 Secondary AI File Browser 是否已经启动。Fixed Tunnel running 只代表隧道层在运行，不代表每个本地 origin service 都已启动。
________________________________________
9. 权限与安全
9.1 本地控制台只允许本机访问
WebAI LocalBridge 的本地控制台是人类管理入口，默认地址为：
http://127.0.0.1:33004
它用于设置共享目录、启动服务、配置 Tunnel、管理 MCP 权限和查看运行状态。
控制台应只允许本机访问。它不是给 Web AI 直接访问的页面，也不是给协作者公开使用的管理后台。
Web AI 应访问的是：
AI File Browser 公网地址
MCP Endpoint 公网地址
Frontend Preview 公网地址
而不是 33004 控制台。
9.2 不要公网暴露 33004
不要把 33004 控制台端口通过 Tunnel、端口映射、反向代理或公网服务器直接暴露出去。
原因很简单：33004 是控制面，不是数据面。它可以管理共享目录、权限、Tunnel 和本地服务。如果将控制台暴露到公网，风险会明显高于暴露只读文件浏览器或 MCP Endpoint。
推荐边界：
33004：只给本机用户使用
33005：可通过 Tunnel 给 AI 只读访问
33006：可通过 Tunnel 给 AI 只读访问
33003/mcp：可通过 Tunnel 给 MCP 客户端访问
如果需要远程管理，建议先通过远程桌面、内网 VPN、Tailscale、ZeroTier 或其他可信远程访问方式进入本机，再打开 33004 控制台。
9.3 MCP 高级权限说明
MCP Server 的能力取决于控制台中的权限配置。
常见权限包括：
•	是否允许文件写入。
•	是否允许文件删除。
•	是否允许跨 root 访问。
•	是否允许命令执行。
•	是否允许 PowerShell 执行。
•	是否允许任务启动。
•	是否允许更高风险的本地操作。
开启高级权限后，AI 可以通过 MCP 调用更强的本地工具。此时 MCP 不再只是“读取文件”，而是可能修改项目、运行命令或改变本地环境。
当前工具本身除了递归删除非空目录外，没有为每个高风险操作额外内置一层人工确认。通常情况下，只要本地权限允许、AI 客户端允许工具调用、工具参数有效，MCP Server 就会执行对应操作。
因此，开启高级权限前应确认：
•	当前共享目录是否正确。
•	是否允许 AI 修改这个目录。
•	是否需要备份。
•	是否允许跨 root。
•	是否允许命令执行。
•	当前 AI 是否可信。
•	当前任务是否明确。
9.4 文件写入与覆盖规则
MCP 文件写入能力通常包括新建文件、覆盖文件、编辑文件和移动文件。
常见规则：
•	新建文件：目标不存在时可以创建。
•	覆盖文件：目标已存在时通常需要明确覆盖参数。
•	编辑文件：按匹配文本替换内容。
•	移动文件：目标存在时通常需要明确覆盖参数。
•	备份：部分编辑操作可以使用 backup 选项生成 .bak 文件。
使用文件写入能力前，建议先让 AI：
1.	读取相关文件。
2.	说明计划修改哪些文件。
3.	尽量使用小范围修改。
4.	对关键文件启用备份。
5.	修改后执行语法检查或测试命令。
对于项目代码，推荐先让 AI 使用 file_read_lines、content_search 和 file_info 明确上下文，再执行写入或编辑操作。
9.5 删除与递归删除规则
删除操作风险高于普通写入操作。
文件删除通常用于删除明确指定的文件。目录删除分为空目录删除和非空目录删除。
推荐规则：
•	删除文件前，先确认路径。
•	删除目录前，先查看目录内容。
•	空目录可以直接删除。
•	非空目录递归删除需要特别谨慎。
•	递归删除应只用于明确无用的构建产物、缓存目录、临时目录或用户明确指定的目录。
递归删除非空目录时，工具通常需要显式参数，例如：
recursive:true
对于非空目录，不应让 AI 在未确认路径的情况下直接递归删除。尤其要避免误删：
•	项目根目录。
•	用户主目录。
•	桌面目录。
•	文档目录。
•	Git 仓库根目录。
•	包含源码、论文、业务资料或隐私数据的目录。
推荐删除前检查：
先 file_info
再 file_tree
确认目录内容
最后再 dir_remove
9.6 命令执行风险
MCP Server 可以提供命令执行能力，例如 command_run、powershell_run、task_start 或类似工具。
命令执行适合：
•	安装依赖。
•	运行测试。
•	构建项目。
•	检查端口。
•	查看 Git 状态。
•	读取运行日志。
•	启动开发服务器。
•	执行项目脚本。
命令执行也可能带来风险，例如：
•	删除文件。
•	修改系统配置。
•	安装不可信依赖。
•	上传或泄露本地数据。
•	长时间占用资源。
•	启动未知进程。
•	改变 Git 工作区状态。
使用命令执行前，建议：
•	指定明确的 cwd。
•	优先使用 Windows 绝对路径。
•	避免在不清楚含义的情况下运行长命令。
•	避免直接运行来自不可信来源的脚本。
•	对 install、build、test 等命令设置合理超时。
•	对长期任务使用 task 工具，并通过 task_status / task_logs 查看结果。
•	不要让 AI 在系统目录或用户主目录中随意执行命令。
当前 MCP 工具要求命令 cwd 使用 Windows 绝对路径，不要使用：
cwd="/"
应使用类似：
C:\Users\<User>\Projects\<ProjectName>
9.7 配置文件与 Token 保护
WebAI LocalBridge 的真实运行配置通常保存在：
mcp-tunnel-config.json
该文件可能包含：
•	本机共享目录。
•	副文件浏览器目录。
•	Fixed Domain Tunnel Base Domain。
•	Cloudflare Tunnel Token。
•	MCP 权限开关。
•	Root 边界模式。
•	命令执行开关。
•	Skill Folder 配置。
该文件是本机运行态配置，不应提交到 Git，也不应打包进公开发布版。
发布包应使用：
mcp-tunnel-config.example.json
示例配置中不应包含：
•	真实 token。
•	真实域名。
•	真实本机路径。
•	真实共享目录。
•	真实用户信息。
•	高风险权限默认开启状态。
建议默认配置保持安全：
mcpAdvancedPermission: false
commandExecution: false
fileFastConfirm: false
rootBoundaryMode: root-only
fixedTunnel.token: ""
fixedTunnel.enabled: false
如果 token 泄露，应立即在 Cloudflare 侧撤销或重置相关 Tunnel Token。
