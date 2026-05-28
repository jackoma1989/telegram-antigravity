# 🚀 TeleGravity

> **通过 Telegram 远程深度掌控您的 Antigravity AI 编程助手**

`TeleGravity` 是一个专门为 **Antigravity**（AI 编程助手）打造的高性能、低延迟的远程连接与控制套件。无论您是在出行、会议还是休息，只需打开手机上的 Telegram 客户端，就可以完美同步电脑端的 AI 对话、实时进行项目切换、授权指令运行，甚至一键给电脑截屏！

---

## ✨ 核心特性

* 📬 **100% 自动实时对话推送**：利用极速日志追踪技术，在 AI 生成最终回复的 **0.1 秒内** 自动抓取并将其推送到您的手机上，对话无缝衔接。
* 💭 **智能思考状态刷新（正在输入...）**：彻底解决 Telegram 5 秒自动失效的痛点，在 AI 思考或执行工具期间，手机端保持**持续显示“正在输入...”**状态，坚决防止“死机或断线”假象。
* ⚡ **远程一键交互授权卡片**：当电脑端 AI 发起终端命令（如 `npm run dev`）或文件修改请求需要授权时，手机端会立刻收到卡片推送。您可以点击 **[✅ 同意并运行]** 或 **[❌ 拒绝]**，点击事件将通过 CDP 直接回传并控制电脑！
* 🤖 **`/details` 独立思考开关**：支持一键开关中间思考与工具调用过程（`/details`）。关闭时仅推送最终答复，给您最干净的聊天面板；开启时可实时深入探究 AI 的每一条工具调用逻辑。
* 📂 **`/project` 智能项目无感切换**：一键列出您电脑端的所有可用项目，点击对应的 inline 按钮即可让电脑端自动关闭旧项目、启动新项目、并且 Bot 的日志监听会自动跟随项目无感切换！
* 🧠 **`/model` 实时切换 AI 语言模型**：提供高级 inline 键盘，涵盖 Gemini 3.5 (Flash/Pro)、Claude 3.5 (Sonnet/Opus) 等，点击即可在电脑上物理切换模型。
* ⏹️ **`/stop` 强制中断生成**：发现 AI 生成内容有偏差？手机端轻点 `/stop` 即可瞬间强行中止电脑端的 AI 生成。
* 📸 **`/screenshot` 实时界面抓取**：一键截取电脑端 Antigravity IDE 软件界面，并以高清图片形式发送到手机，实时监控开发状态。
* 📋 **自动同步 Markdown 交付文档**：自动监听 `implementation_plan.md`（实施方案）、`task.md`（任务清单）、`walkthrough.md`（工作总结），并自动在手机端提供简洁预览与 **`.md` 原文件直接下载**。

---

## 🛠️ 电脑端极速配置与运行

### 1. 基础环境
确保您的电脑已安装 [Node.js](https://nodejs.org/)（v18.0.0 或更高版本）。

### 2. 申请 Telegram Bot
1. 在 Telegram 中搜索官方机器人 **`@BotFather`**，发送 `/newbot` 指令。
2. 按照提示设置机器人名称，获取您的专属 **`BOT_TOKEN`**。
3. 搜索您新建的机器人，点击 `Start` 激活它。
4. 向专门获取 ID 的机器人（如 `@userinfobot`）发送任意消息以获取您的个人 Telegram **`Chat ID`**。

### 3. 安装与配置项目
1. 将本项目解压到本地或克隆至本地。
2. 在项目根目录下打开终端，安装全部依赖：
   ```bash
   npm install
   ```
3. 在根目录下复制 `.env.example`（或新建 `.env` 文件），填入您的专属配置：
   ```env
   # Telegram 机器人 Token
   BOT_TOKEN=您的_BOT_TOKEN
   
   # 您的个人 Telegram Chat ID（支持多个，用逗号分隔）
   ALLOWED_CHAT_ID=您的_CHAT_ID
   
   # 调试端口（必须与电脑端 Antigravity 的调试端口一致，默认 9223）
   AGENT_CDP_PORT=9223
   ```

### 4. 启动与管理（Windows 推荐 PM2 后台模式）
为了防止控制台在 Antigravity 中持续占用任务列表，推荐使用 **PM2** 进行系统后台守护运行（无感运行，显示为 `0 tasks running`）：

* **一键启动后台服务**：
  ```bash
  npx pm2 start src/index.js --name "tg-bot"
  ```
* **查看运行状态**：
  ```bash
  npx pm2 list
  ```
* **重启服务**：
  ```bash
  npx pm2 restart tg-bot
  ```
* **停止服务**：
  ```bash
  npx pm2 stop tg-bot
  ```
* **查看实时日志**：
  ```bash
  npx pm2 logs tg-bot
  ```

---

## 🎮 Telegram 快捷指令指南

| 指令 | 描述 |
| :--- | :--- |
| `/start` | 📖 查看操作说明与指南 |
| `/status` | 📊 检查电脑端连接状态与绑定的活跃会话 ID |
| `/details` | 💭 开启/关闭中间思考与工具调用过程（默认关闭） |
| `/model` | 🤖 切换 AI 语言模型 |
| `/project` | 📂 切换当前进行的项目 |
| `/stop` | ⏹️ 停止电脑端 Agent 的思考与生成 |
| `/new` | 🆕 触发电脑端新建空白会话 |
| `/screenshot` | 📸 实时截取电脑端的 Antigravity 界面 |
| `/latest` | 💬 获取最近一次 AI 完整回复 |
| `/help` | 💡 查看快速帮助说明 |

---

## 📝 打包交付与发布 GitHub 指南

如果您希望将这个强大的项目分享给别人，或者提交到个人的 GitHub 仓库中，请参考以下标准化指南：

### 📦 方案 A：直接打包发送给他人 (Zip 打包)
打包发送时，**切记不要包含大体积依赖文件夹和您的隐私密钥**。
1. **必须忽略的文件夹/文件**：
   * `node_modules/`（体积巨大，别人拿到后运行 `npm install` 即可自动安装）
   * `.env`（包含您个人的 `BOT_TOKEN` 和 `Chat ID` 敏感隐私，严禁泄露！）
   * `bg_out.log` 和 `bg_err.log`（本地运行产生的日志文件）
2. **打包建议**：
   * 将上述忽略项排除后，直接将项目根目录压缩为 `.zip` 文件即可。
   * 别人收到您的压缩包后，只需在解压目录下运行：
     ```bash
     npm install
     # 随后参考 README.md 新建自己的 .env 文件并运行启动命令
     ```

### 🐙 方案 B：发布至 GitHub 仓库
发布到 GitHub 时，可以使用项目里已经配置好的 `.gitignore`，确保敏感信息不会意外开源。

1. **新建 GitHub 仓库**：
   * 登录您的 GitHub，点击右上角 `New repository`，填入仓库名（例如 `telegravity`），选择 Public 或 Private，点击 `Create repository`。
2. **在本地初始化 Git 并提交**：
   * 在项目根目录下打开终端，依次运行：
     ```bash
     # 1. 初始化 Git 仓库
     git init
     
     # 2. 检查 .gitignore 是否存在（确保已忽略 .env 和 node_modules）
     # 3. 添加所有文件到暂存区
     git add .
     
     # 4. 提交更改
     git commit -m "feat: init premium telegravity with interactive approvals and /details toggle"
     
     # 5. 关联 GitHub 远程仓库（将下面链接换成您新建仓库的真实链接）
     git remote add origin https://github.com/您的用户名/您的仓库名.git
     
     # 6. 重命名主分支为 main
     git branch -M main
     
     # 7. 推送至 GitHub
     git push -u origin main
     ```
