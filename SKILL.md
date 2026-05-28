# ⚡ TeleGravity 用户使用手册 & 技能技能指南 (SKILL Guide)

**TeleGravity** 是一款专门为 **Antigravity AI 智能体** 深度定制的**高性能远程桥接控制器**。它通过高精度的 **Chrome DevTools Protocol (CDP)** 协议连接电脑端，让您只需通过手机 Telegram，就能跨屏、零延迟地掌控 AI 智能体的核心状态与研发进度。

---

## 🎯 核心定位与作用

在日常开发中，如果您需要离开电脑或进行长时间的 AI 研发任务，TeleGravity 能将电脑端的 AI 开发界面无缝延展到您的手机上：
1. **消息双向无缝流转**：在 Telegram 对话框中直接发送需求，机器人会 0.1s 注入到电脑端输入框中执行；电脑端 AI 的任何实时输出、状态更新，也会瞬间同步推送到手机。
2. **跨设备授权拦截（重点）**：当电脑端 AI 需要敏感权限（例如执行 Shell 脚本、读写系统文件、访问网页等）时，手机 Telegram 能够即时弹出带有 **“✅ 同意”** 和 **“❌ 拒绝”** 按钮的安全卡片，让您躺在沙发上也能随时跨屏批准操作。
3. **多模态图片/无损文件传送**：直接在手机 Telegram 上给机器人<b>发送图片或以文件形式上传截图</b>，机器人会自动将其下载并利用 CDP 协议注入到电脑端的图片上传区域。同时支持携带文字标题（Caption），一并提交给 AI，让 AI 能实时看懂您的设计图、架构图或报错截图！
4. **零门槛快捷面板**：集成 2x2 控制台核心管理面板，无需命令行记忆，一键即可切换项目、切换会话、切换大模型、以及查询账户额度用量。
5. **一键安全静默启停**：完美定制的 Windows VBS 脚本，双击即可无黑窗口、低占用地常驻运行，支持多项目 Node 环境共存，绝对安全不冲突。

---

## 🛠️ 一键静默控制小工具 (Windows 专属)

为了免去您开着 CMD 黑窗口的烦恼，并彻底解决智能体沙箱的超时自动清理问题，请使用我们为您特别研发的 VBS 脚本工具：

*   **🚀 一键静默启动**：[启动机器人.vbs](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity/启动机器人.vbs)
    *   *双击它，脚本会<b>自动向 127.0.0.1:9223 发送 HTTP 请求进行探测</b>。如果 9223 调试端口未开启，它会自动安全结束当前所有未开启调试的 `Antigravity.exe` 进程，并自动以调试模式拉起客户端（追加参数 `--remote-debugging-port=9223`）。然后自动在后台静默隐藏运行机器人，日志实时写入 `bg_out.log` 和 `bg_err.log`。*
*   **🛑 一键精准关闭**：[停止机器人.vbs](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity/停止机器人.vbs)
    *   *双击它，将在一秒内精准扫描并杀死所有的 TeleGravity 机器人后台进程，<b>绝不会影响您的 stock-monitor 或其他任何 Node 进程！</b>*

---

## 📱 核心功能与使用方法

### 1. 2x2 极简控制台管理面板
直接在手机端点击下方的**状态栏按键**（格式如 `📁 项目名 | 💬 会话名`），机器人会立刻清除旧对话，并为您展开以下 **2x2 布局的控制台管理菜单**：

| 按键功能 | 后台执行逻辑 | 体验说明 |
| :--- | :--- | :--- |
| **📁 切换项目 (Project)** | 实时拉取 PC 侧边栏项目列表并精准切换 | 优先根据 UUID (Section URI) 匹配，高精度防漂移。 |
| **💬 切换会话 (Chats)** | 调取当前项目的所有活动会话进行 inline 切换 | 按最后修改时间倒序排列，支持一键新建空白会话。 |
| **🤖 切换 AI 模型 (Model)** | 一键下发指令切换电脑端当前所用 AI 大语言模型 | 支持 Gemini 3.5 Flash/3.1 Pro、Claude 4.6 Sonnet/Opus 等。 |
| **💳 查询 Quota (Quota)** | 调取 API 瞬间查询并格式化输出当前用量详情 | 输出 5 小时内各模型限额、剩余占比、重置倒计时。 |

---

## 📖 手机端 Telegram 快捷指令大字典

您可以在 Telegram 对话框中发送斜杠指令来快速执行核心调度：

| 快捷命令 | 作用与功能说明 |
| :--- | :--- |
| `/start` | 📖 开启机器人并查看基础操作说明与指南 |
| `/status` | 📊 检查电脑端连接状态与绑定的活跃会话 ID |
| `/chat` | 💬 切换或管理当前项目中的活跃会话（弹窗按钮列表） |
| `/quota` | 💳 强制查询账户可用额度、各模型 5 小时限制与重置倒计时 |
| `/plan` | 📋 **【防乱码】**一键获取当前活跃会话的实施方案 (`implementation_plan.md`) |
| `/task` | 📝 **【防乱码】**一键获取当前活跃会话的任务进度清单 (`task.md`) |
| `/walkthrough` | 🏁 **【防乱码】**一键获取当前活跃会话的一站式总结文件 (`walkthrough.md`) |
| `/model` | 🤖 切换 AI 语言模型，可一键选取目标 LLM |
| `/project` | 📂 切换当前正在进行的项目文件夹或 React 工作区 |
| `/stop` | ⏹️ 远程终止/叫停电脑端 AI 的思考和代码生成过程 |
| `/new` | 🆕 触发电脑端 Antigravity 瞬间创建一个空白新会话 |
| `/screenshot` | 📸 实时截取当前电脑端 Antigravity 的运行界面（以图片形式回传） |
| `/latest` | 💬 强制获取最近一次 AI 生成的完整回复（防丢防漏兜底） |
| `/details` | 💭 开启/关闭显示中间思考过程（Verbose Mode 开关） |
| `/help` | 💡 随时调出并查看此快捷帮助说明 |

---

## 🔒 跨设备中文授权批准机制

当电脑端的 AI 智能体需要运行终端指令或写入文件时，您的手机 Telegram 将会收到高亮的紧急通知：

> ⚠️ **电脑端正在请求您的授权：**
> 
> **请求操作：**
> `npx pm2 restart tg-bot`
> 
> *请选择您的操作：*
> **[ ✅ 同意并运行 ]**  **[ ❌ 拒绝 ]**

*   **中文适配**：我们已深度重构了 CDP 控制层，无论您的电脑系统、IDE 为英文、土耳其语还是**纯中文界面**，机器人均能 **100% 精准拦截并代您执行**。
*   **一键跨屏**：直接点击手机上的内联按钮，就能零延迟向电脑发送 Allow/Reject 动作，无需走到电脑前敲击键盘！

---

## 🚀 完美乱码防护 (Windows UTF-8 BOM 级盾牌)

在手机端通过命令（如 `/plan`、`/task`、`/walkthrough`）或 Watcher 自动接收到的任何 `.md` 格式的文档：
*   **原理**：我们在字节传输的最底层，自动为每一个 markdown 文档流的前端注入了高精度的 **UTF-8 BOM 字节顺序标记 (`0xEF, 0xBB, 0xBF`)**。
*   **效果**：Windows 下的任何文本阅读器（如记事本 Notepad、MS Office Word 等）打开这些文档时，都会 **100% 自动识别编码，绝不会出现任何乱码或 garbled 字符**！

---

## 📁 关键项目路径与连接
*   项目根目录：[c:\Users\JackoMA\Downloads\antigravity\telegram 连接 antigravity](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity)
*   配置文件：[.env 配置文件](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity/.env)
*   本地运行日志：[bg_out.log 标准日志](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity/bg_out.log)
*   本地报错日志：[bg_err.log 错误日志](file:///c:/Users/JackoMA/Downloads/antigravity/telegram%20连接%20antigravity/bg_err.log)
