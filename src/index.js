require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Telegraf } = require('telegraf');
const fs = require('fs');

process.on('uncaughtException', (err) => {
    fs.writeSync(2, `🔥 UNCAUGHT EXCEPTION: ${err.stack || err}\n`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    fs.writeSync(2, `🔥 UNHANDLED REJECTION: ${reason}\n`);
});
const path = require('path');
const os = require('os');
const { 
    sendViaCDP, 
    triggerNewChat, 
    captureFullIDEScreenshot,
    selectModelViaCDP,
    stopAgentViaCDP,
    findActiveApproval,
    respondToApproval,
    checkAgentThinkingStatus,
    queryAntigravityQuota,
    getCurrentModelViaCDP,
    getActiveProjectNameViaCDP,
    getActiveConversationTitleViaCDP,
    getConversationsViaCDP,
    selectConversationViaCDP,
    renameConversationViaCDP,
    switchProjectViaCDP,
    getAvailableProjectsViaCDP,
    sendImageViaCDP,
    getActiveConversationIdViaCDP,
    waitForTargetReady
} = require('./cdp_controller');
const { launchIDE, config } = require('./platform');

// ===== SECURITY & CONFIGURATION =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_ID ? process.env.ALLOWED_CHAT_ID.split(',').map(id => id.trim()) : [];
const CDP_PORT = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

if (!BOT_TOKEN || ALLOWED_CHAT_IDS.length === 0) {
    console.error("❌ ERROR: BOT_TOKEN and ALLOWED_CHAT_ID are mandatory in your .env file!");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Auth Middleware: Strictly only allow configuration owner
bot.use((ctx, next) => {
    const chatOwner = ALLOWED_CHAT_IDS.includes(ctx.chat.id.toString());
    if (!chatOwner) {
        console.warn(`[Security] Unauthorized access attempted by Chat ID: ${ctx.chat.id}`);
        ctx.reply(`⚠️ Unauthorized access. Your Chat ID is ${ctx.chat.id}. Add it to ALLOWED_CHAT_ID in .env to use this bot.`).catch(()=>{});
        return;
    }
    return next();
});

// ===== MARKDOWN TO TELEGRAM HTML CONVERTER =====
function markdownToTelegramHtml(text) {
    if (!text) return '';

    // 1. Escape basic HTML entities so they are safe from being interpreted as tags by Telegram.
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Placeholders array to hold protected code content
    const placeholders = [];
    const uniquePrefix = `TGSAFECODEBLOCK${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    let placeholderIndex = 0;

    // 2. Protect triple-backtick code blocks
    // This matches: ```[optional language]\n[code content]```
    html = html.replace(/```([a-z0-9]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const id = `${uniquePrefix}${placeholderIndex++}`;
        let formattedCode = '';
        if (lang) {
            formattedCode = `<pre><code class="language-${lang}">${code}</code></pre>`;
        } else {
            formattedCode = `<pre>${code}</pre>`;
        }
        placeholders.push({ id, content: formattedCode });
        return id;
    });

    // 3. Protect inline code (single backtick)
    // Matches standard `code` blocks on a single line or multiple lines without crossing backticks
    html = html.replace(/`([^`]+)`/g, (match, code) => {
        const id = `${uniquePrefix}${placeholderIndex++}`;
        const formattedCode = `<code>${code}</code>`;
        placeholders.push({ id, content: formattedCode });
        return id;
    });

    // 4. Now perform all other formatting substitutions on the safe text
    
    // Headers: # Header -> <b>Header</b>
    html = html.replace(/^(#{1,6})\s+(.+)$/gm, '<b>$2</b>');

    // Bold: **bold** -> <b>bold</b>
    html = html.replace(/\*\*([^\*]+)\*\*/g, '<b>$1</b>');

    // Italic (*italic* and _italic_)
    html = html.replace(/(?<![A-Za-z0-9])\*([^\*]+)\*(?![A-Za-z0-9])/g, '<i>$1</i>');
    html = html.replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<i>$1</i>');

    // Inline URL: [text](url) -> <a href="$2">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Checkboxes
    html = html.replace(/\[x\]/ig, '✅');
    html = html.replace(/\[ \]/g, '⬜');
    html = html.replace(/\[\/\]/g, '🔄');

    // 5. Restore all code blocks by replacing their placeholders
    for (const placeholder of placeholders) {
        html = html.replace(placeholder.id, placeholder.content);
    }

    return html;
}

// Safely sends long HTML messages without violating Telegram's 4096 character limit
let lastKnownModel = null;
let lastKnownProject = null;
let lastKnownChatTitle = null;

function getModelShortName(modelName) {
    if (!modelName) return '获取中...';
    const lower = modelName.toLowerCase();
    
    // Callback value mappings
    if (lower === 'flash (high)') return 'g3.5 f high';
    if (lower === 'flash (medium)') return 'g3.5 f med';
    if (lower === 'pro (high)') return 'g3.1 p high';
    if (lower === 'pro (low)') return 'g3.1 p low';
    if (lower === 'sonnet') return 'c4.6 s think';
    if (lower === 'opus') return 'c4.6 o think';
    if (lower === 'gpt-oss') return 'gpt-oss 120b';
    
    // Explicit mappings
    if (lower.includes('gemini 3.5 flash') && lower.includes('high')) return 'g3.5 f high';
    if (lower.includes('gemini 3.5 flash') && lower.includes('medium')) return 'g3.5 f med';
    if (lower.includes('gemini 3.1 pro') && lower.includes('high')) return 'g3.1 p high';
    if (lower.includes('gemini 3.1 pro') && lower.includes('low')) return 'g3.1 p low';
    if (lower.includes('claude sonnet') && lower.includes('thinking')) return 'c4.6 s think';
    if (lower.includes('claude opus') && lower.includes('thinking')) return 'c4.6 o think';
    if (lower.includes('gpt-oss') && lower.includes('120b')) return 'gpt-oss 120b';
    
    // General heuristics for other models
    let short = modelName
        .replace(/gemini/i, 'g')
        .replace(/claude/i, 'c')
        .replace(/flash/i, 'f')
        .replace(/pro/i, 'p')
        .replace(/medium/i, 'med')
        .replace(/thinking/i, 'think')
        .replace(/[\(\)]/g, '') // remove parentheses
        .trim();
        
    // Lowercase and collapse multiple spaces
    return short.toLowerCase().replace(/\s+/g, ' ');
}

function getStatusKeyboard(modelName) {
    return {
        reply_markup: {
            keyboard: [
                [
                    { text: 'Switch & Quota' }
                ]
            ],
            resize_keyboard: true,
            is_persistent: true,
            input_field_placeholder: `模型: ${getModelShortName(modelName)}`
        }
    };
}

async function refreshInputPlaceholder(ctx) {
    await updatePinnedDashboard().catch(() => {});
}

async function globalRefreshInputPlaceholder() {
    await updatePinnedDashboard().catch(() => {});
}


async function sendLongMessage(ctx, text, header = '', extraOptions = {}) {
    const MAX_LEN = 3500;
    const htmlText = header ? `${header}\n\n${markdownToTelegramHtml(text)}` : markdownToTelegramHtml(text);

    async function replyChunk(content) {
        try {
            return await ctx.reply(content, { parse_mode: 'HTML', ...extraOptions });
        } catch (err) {
            console.error('[sendLongMessage] Error sending chunk:', err.message);
            // Fallback to plain text if HTML parsing crashes
            const plain = content.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return await ctx.reply(plain.substring(0, 4000), extraOptions);
        }
    }

    try {
        const lines = htmlText.split('\n');
        let currentChunk = '';
        let inPre = false;
        let preLang = '';

        for (let line of lines) {
            if (line.length > MAX_LEN) {
                line = line.substring(0, MAX_LEN) + '...';
            }

            const preMatch = line.match(/<pre>(?:<code class="language-([^"]+)">)?/);
            if (preMatch) {
                inPre = true;
                preLang = preMatch[1] || '';
            }
            if (line.includes('</pre>')) {
                inPre = false;
            }

            if (currentChunk.length + line.length > MAX_LEN) {
                if (inPre) {
                    currentChunk += preLang ? '</code></pre>' : '</pre>';
                }
                await replyChunk(currentChunk);
                currentChunk = inPre ? (preLang ? `<pre><code class="language-${preLang}">\n` : '<pre>\n') : '';
            }
            currentChunk += line + '\n';
        }

        if (currentChunk.trim().length > 0) {
            await replyChunk(currentChunk);
        }
    } catch (err) {
        console.error('sendLongMessage final failure:', err.message);
    }
}

// ===== LOCAL TRANSCRIPT WATCHER & ACTIVE SESSION AUTO-PUSH =====
const appDataName = (process.env.ANTIGRAVITY_PREFERRED_APP || 'agent') === 'ide' ? 'antigravity-ide' : 'antigravity';
const brainPath = path.join(os.homedir(), '.gemini', appDataName, 'brain');

let currentSessionId = null;
let currentFilePath = null;
let lastFileOffset = 0;
const lastArtifactStats = {};
let lastNotifiedApprovalPath = null;
let consecutiveNoApprovalTicks = 0;
let lastTypingSentTime = 0;
let lastModelLogTime = 0;
let showDetails = false;
const userStates = {};

const { exec } = require('child_process');

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getRunningTerminalTasks() {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'get_tasks.ps1');
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) {
                return resolve([]);
            }
            try {
                const processes = JSON.parse(stdout.trim());
                if (!Array.isArray(processes)) return resolve([]);
                
                const processIdSet = new Set(processes.map(p => p.ProcessId));
                const tasks = [];
                
                for (const p of processes) {
                    const pid = p.ProcessId;
                    const parentPid = p.ParentProcessId;
                    const name = p.Name || '';
                    const cmdLine = p.CommandLine || '';
                    
                    // A process is a direct child of the language server if its parent is not in our list
                    const isDirectChild = !processIdSet.has(parentPid);
                    if (!isDirectChild) continue;
                    
                    // Filter out system and utility processes
                    const nameLower = name.toLowerCase();
                    if (nameLower === 'conhost.exe' || nameLower === 'vcxsrv.exe') continue;
                    
                    const cmdLower = cmdLine.toLowerCase();
                    // Allow listing other index.js processes (e.g. duplicates to kill),
                    // but skip the current active bot PID to prevent accidental self-termination.
                    if (pid === process.pid) {
                        continue;
                    }
                    if (cmdLower.includes('启动机器人') || 
                        cmdLower.includes('get_tasks.ps1') ||
                        cmdLower.includes('wscript.exe')) {
                        continue;
                    }
                    
                    // Clean up command line for display
                    let cleanCmd = cmdLine;
                    if (nameLower === 'powershell.exe') {
                        const match = cmdLine.match(/-Command\s+"?([^"]+)"?/i) || cmdLine.match(/-c\s+"?([^"]+)"?/i);
                        if (match) cleanCmd = match[1];
                    } else if (nameLower === 'cmd.exe') {
                        const match = cmdLine.match(/\/c\s+"?([^"]+)"?/i) || cmdLine.match(/\/k\s+"?([^"]+)"?/i);
                        if (match) cleanCmd = match[1];
                    }
                    
                    cleanCmd = cleanCmd.replace(/\\"/g, '"').trim();
                    
                    tasks.push({
                        pid: pid,
                        name: name,
                        command: cleanCmd,
                        originalCommand: cmdLine
                    });
                }
                
                resolve(tasks);
            } catch (e) {
                console.error('[TerminalWatcher] Error parsing tasks:', e.message);
                resolve([]);
            }
        });
    });
}

const pinnedStatusFile = path.join(__dirname, '..', 'scratch', 'pinned_status.json');
let lastDashboardTextMap = {};
let lastDashboardKeyboardMap = {};
let lastActiveTerminalTasks = [];

function getPinnedMessageId(chatId) {
    try {
        if (fs.existsSync(pinnedStatusFile)) {
            const data = JSON.parse(fs.readFileSync(pinnedStatusFile, 'utf8'));
            return data[chatId] || null;
        }
    } catch (e) {}
    return null;
}

function savePinnedMessageId(chatId, msgId) {
    try {
        const scratchDir = path.dirname(pinnedStatusFile);
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        let data = {};
        if (fs.existsSync(pinnedStatusFile)) {
            data = JSON.parse(fs.readFileSync(pinnedStatusFile, 'utf8'));
        }
        data[chatId] = msgId;
        fs.writeFileSync(pinnedStatusFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}

async function updatePinnedDashboard() {
    const proj = lastKnownProject || '获取中...';
    const chatTitle = lastKnownChatTitle || '新会话';
    const model = lastKnownModel || '获取中...';
    
    let text = `P: <b>${proj}</b> | C: <b>${chatTitle}</b>`;
    
    // Fetch running terminal tasks
    const tasks = await getRunningTerminalTasks().catch(() => []);
    lastActiveTerminalTasks = tasks;
    
    if (tasks.length > 0) {
        text += `\n━━━━━━━━━━━━━━━━━━━`;
        text += `\n<b>活动后台终端任务 (${tasks.length}):</b>`;
        tasks.forEach(t => {
            let cmdDisp = t.command;
            if (cmdDisp.length > 40) {
                cmdDisp = cmdDisp.substring(0, 37) + '...';
            }
            text += `\n• <code>[${t.pid}]</code> <b>${t.name.replace('.exe', '')}</b>: <code>${escapeHtml(cmdDisp)}</code>`;
        });
    }
                 
    for (const chatId of ALLOWED_CHAT_IDS) {
        if (text === lastDashboardTextMap[chatId]) {
            continue; // Avoid double sends
        }
        
        lastDashboardTextMap[chatId] = text;
        
        let msgId = getPinnedMessageId(chatId);
        let editSuccess = false;
        
        if (msgId) {
            try {
                // Edit dashboard in place cleanly without reply_markup to prevent 400 Bad Request
                await bot.telegram.editMessageText(chatId, msgId, null, text, { parse_mode: 'HTML' });
                editSuccess = true;
            } catch (err) {
                console.log(`[Dashboard] Edit failed for chat ${chatId}, recreating:`, err.message);
            }
        }
        
        if (!editSuccess) {
            try {
                if (msgId) {
                    try {
                        await bot.telegram.deleteMessage(chatId, msgId);
                    } catch (delErr) {
                        console.log('[Dashboard] Delete old message failed:', delErr.message);
                    }
                }
                
                const newMsg = await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
                savePinnedMessageId(chatId, newMsg.message_id);
                try {
                    await bot.telegram.pinChatMessage(chatId, newMsg.message_id, { disable_notification: true });
                } catch (pinErr) {
                    console.error('[Dashboard] Pin message failed:', pinErr.message);
                }
            } catch (err) {
                console.error('[Dashboard] Send fresh dashboard failed:', err.message);
            }
        }
    }
}

function getLatestActiveSession() {
    try {
        if (!fs.existsSync(brainPath)) return null;
        const dirs = fs.readdirSync(brainPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && /^[0-9a-fA-F-]{36}$/.test(d.name));

        let latestFile = null;
        let latestMtime = 0;
        let latestUUID = null;

        for (const dir of dirs) {
            const transcriptPath = path.join(brainPath, dir.name, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                const stat = fs.statSync(transcriptPath);
                if (stat.mtimeMs > latestMtime) {
                    latestMtime = stat.mtimeMs;
                    latestFile = transcriptPath;
                    latestUUID = dir.name;
                }
            }
        }
        return latestFile ? { filePath: latestFile, uuid: latestUUID } : null;
    } catch (e) {
        console.error('[getLatestActiveSession] Error scanning directories:', e.message);
        return null;
    }
}

// Push direct notifications to the ALLOWED_CHAT_IDS
// Push direct notifications to the ALLOWED_CHAT_IDS
function pushToUser(text, header = '', extraOptions = {}) {
    ALLOWED_CHAT_IDS.forEach(chatId => {
        const dummyCtx = { reply: (content, opts) => bot.telegram.sendMessage(chatId, content, opts) };
        const mergedOptions = { ...getStatusKeyboard(lastKnownModel), ...extraOptions };
        sendLongMessage(dummyCtx, text, header, mergedOptions).catch(err => {
            console.error('[pushToUser] Failed to send push message:', err.message);
        });
    });
}

// Active polling check for logs filesystem updates
function startLogsWatcher() {
    console.log(`🤖 Logs Watcher active! Scanning brain path: ${brainPath}`);
    
    async function initAnchor() {
        let activeUUID = null;
        try {
            activeUUID = await getActiveConversationIdViaCDP(CDP_PORT);
        } catch (e) {}

        let initialUUID = null;
        let initialFile = null;

        if (activeUUID && /^[0-9a-fA-F-]{36}$/.test(activeUUID)) {
            const transcriptPath = path.join(brainPath, activeUUID, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                initialUUID = activeUUID;
                initialFile = transcriptPath;
            }
        }

        if (!initialUUID) {
            const fallback = getLatestActiveSession();
            if (fallback) {
                initialUUID = fallback.uuid;
                initialFile = fallback.filePath;
            }
        }

        if (initialUUID && initialFile) {
            currentSessionId = initialUUID;
            currentFilePath = initialFile;
            
            const stat = fs.statSync(currentFilePath);
            const ageMs = Date.now() - stat.birthtimeMs;
            lastFileOffset = (ageMs < 60000) ? 0 : stat.size;
            
            console.log(`📡 Anchored active session at startup: ${currentSessionId.substring(0, 8)}... (Size: ${lastFileOffset}B, Age: ${Math.round(ageMs/1000)}s)`);
            
            // Anchor artifacts on startup
            const sessionDir = path.join(brainPath, currentSessionId);
            ['implementation_plan.md', 'task.md', 'walkthrough.md'].forEach(art => {
                const p = path.join(sessionDir, art);
                if (fs.existsSync(p)) {
                    lastArtifactStats[art] = fs.statSync(p).mtimeMs;
                }
            });
            
            // Query initial chat title asynchronously
            getActiveConversationTitleViaCDP(CDP_PORT, currentSessionId).then(title => {
                if (title) {
                    lastKnownChatTitle = title;
                    console.log(`💬 Anchored active chat title at startup: ${title}`);
                }
            }).catch(() => {}).finally(() => {
                updatePinnedDashboard().catch(() => {});
            });
        }
    }

    initAnchor().finally(() => {
        setInterval(async () => {
            let activeUUID = null;
            try {
                activeUUID = await getActiveConversationIdViaCDP(CDP_PORT);
            } catch (err) {
                console.error('[LogsWatcher] Failed to get active conversation ID via CDP:', err.message);
            }

            let latestFile = null;
            let latestUUID = null;

            if (activeUUID && /^[0-9a-fA-F-]{36}$/.test(activeUUID)) {
                const transcriptPath = path.join(brainPath, activeUUID, '.system_generated', 'logs', 'transcript.jsonl');
                if (fs.existsSync(transcriptPath)) {
                    latestUUID = activeUUID;
                    latestFile = transcriptPath;
                }
            }

            // Fallback to directory scanning if CDP target is not resolved or file doesn't exist yet
            if (!latestUUID) {
                const fallback = getLatestActiveSession();
                if (fallback) {
                    latestUUID = fallback.uuid;
                    latestFile = fallback.filePath;
                }
            }

            if (!latestUUID) return;

            // 1. Detection of Session / Project Switch
            if (latestUUID !== currentSessionId) {
                currentSessionId = latestUUID;
                currentFilePath = latestFile;
                
                const stat = fs.statSync(currentFilePath);
                const ageMs = Date.now() - stat.birthtimeMs;
                lastFileOffset = (ageMs < 60000) ? 0 : stat.size;
                
                lastKnownChatTitle = null; // Reset chat title so it gets queried on the next tick
                
                // Anchor artifact stats for the new session so we don't send old historical files immediately
                const newSessionDir = path.join(brainPath, currentSessionId);
                ['implementation_plan.md', 'task.md', 'walkthrough.md'].forEach(art => {
                    const p = path.join(newSessionDir, art);
                    if (fs.existsSync(p)) {
                        lastArtifactStats[art] = fs.statSync(p).mtimeMs;
                    } else {
                        lastArtifactStats[art] = 0;
                    }
                });
                
                // pushToUser(`• 已绑定至新会话: <code>${currentSessionId.substring(0, 8)}...</code>`);
                updatePinnedDashboard().catch(() => {}); // Update dashboard on session switch!
                return;
            }

        // 2. Scan for newly appended logs in the active session
        try {
            const stat = fs.statSync(currentFilePath);
            if (stat.size > lastFileOffset) {
                const newBytesSize = stat.size - lastFileOffset;
                const fd = fs.openSync(currentFilePath, 'r');
                const buffer = Buffer.alloc(newBytesSize);
                fs.readSync(fd, buffer, 0, newBytesSize, lastFileOffset);
                fs.closeSync(fd);

                const lastNewlineInBuf = buffer.lastIndexOf('\n');
                if (lastNewlineInBuf !== -1) {
                    const completeBuffer = buffer.subarray ? buffer.subarray(0, lastNewlineInBuf + 1) : buffer.slice(0, lastNewlineInBuf + 1);
                    lastFileOffset += (lastNewlineInBuf + 1);

                    const appendedText = completeBuffer.toString('utf8');
                    const lines = appendedText.split('\n').filter(line => line.trim());

                    for (const line of lines) {
                        try {
                            const entry = JSON.parse(line);
                            lastModelLogTime = Date.now();
                            // Precision Filter: MODEL's response blocks (including thinking & content)
                            if (entry.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE') {
                                const hasThinking = entry.thinking && entry.thinking.trim();
                                const hasContent = entry.content && entry.content.trim();

                                if (showDetails && hasThinking) {
                                    console.log(`✨ Captured intermediate thinking in session ${currentSessionId.substring(0, 8)}`);
                                    pushToUser(entry.thinking, `💭 <b>Antigravity 思考过程：</b>`);
                                }

                                if (hasContent) {
                                    const isIntermediate = entry.tool_calls && entry.tool_calls.length > 0;
                                    if (isIntermediate && !showDetails) {
                                        console.log(`🤫 Suppressed intermediate thinking step in session ${currentSessionId.substring(0, 8)}`);
                                        continue;
                                    }
                                    console.log(`✨ Captured new AI response in session ${currentSessionId.substring(0, 8)}`);
                                    pushToUser(entry.content);
                                    
                                    // Refresh pinned dashboard at the end of the conversation turn to capture any started/ended background terminal tasks
                                    if (!isIntermediate) {
                                        setTimeout(async () => {
                                            updatePinnedDashboard().catch(() => {});
                                        }, 1200);
                                    }
                                }
                            }
                        } catch (_) {
                            // ignore malformed JSON or partial lines
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[LogsWatcher] Failed to read appended text:', e.message);
        }

        // 3. Scan for artifact updates
        try {
            const sessionDir = path.join(brainPath, currentSessionId);
            const artifacts = ['implementation_plan.md', 'task.md', 'walkthrough.md'];

            for (const artifact of artifacts) {
                const filePath = path.join(sessionDir, artifact);
                if (fs.existsSync(filePath)) {
                    const stat = fs.statSync(filePath);
                    const lastTime = lastArtifactStats[artifact] || 0;
                    if (stat.mtimeMs > lastTime && stat.size > 0) {
                        lastArtifactStats[artifact] = stat.mtimeMs;
                        console.log(`✨ Artifact updated: ${artifact}`);
                        
                        let title = '';
                        if (artifact === 'implementation_plan.md') {
                            title = '📋 <b>Antigravity 提出了新的实施方案 (Implementation Plan)</b>';
                        } else if (artifact === 'task.md') {
                            title = '📝 <b>任务清单已更新 (Task List Updated)</b>';
                        } else if (artifact === 'walkthrough.md') {
                            title = '🏁 <b>工作总结已生成 (Walkthrough Generated)</b>';
                        }
                        
                        const content = fs.readFileSync(filePath, 'utf8');
                        const preview = content.substring(0, 800) + (content.length > 800 ? '\n\n...' : '');
                        
                        pushToUser(preview, `${title}\n\n<i>👇 完整 markdown 文件已发送在下方：</i>`);
                        
                        try {
                            const fileContent = fs.readFileSync(filePath);
                            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
                            const hasBom = fileContent.length >= 3 && fileContent[0] === 0xEF && fileContent[1] === 0xBB && fileContent[2] === 0xBF;
                            const sourceBuffer = hasBom ? fileContent : Buffer.concat([bom, fileContent]);
                            
                            ALLOWED_CHAT_IDS.forEach(chatId => {
                                bot.telegram.sendDocument(chatId, { 
                                    source: sourceBuffer, 
                                    filename: artifact 
                                }).catch(err => {
                                    console.error(`[ArtifactWatcher] Failed to send document ${artifact}:`, err.message);
                                });
                            });
                        } catch (err) {
                            console.error(`[ArtifactWatcher] Error reading artifact to send:`, err.message);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[ArtifactWatcher] Check error:', e.message);
        }

        // 4. Scan for active approvals
        try {
            findActiveApproval(CDP_PORT).then(approval => {
                if (approval) {
                    consecutiveNoApprovalTicks = 0;
                    if (approval.path !== lastNotifiedApprovalPath) {
                        lastNotifiedApprovalPath = approval.path;
                        console.log(`⚠️ Active approval found: ${approval.actionText.substring(0, 50)}`);
                        
                        const text = `⚠️ <b>电脑端正在请求您的授权：</b>\n\n🛠️ <b>请求操作详情：</b>\n<pre>${approval.actionText}</pre>\n\n<i>👇 请点击下方按钮完成授权：</i>`;
                        
                        const keyboardButtons = approval.buttons.map(btn => {
                            return {
                                text: btn.text,
                                callback_data: `approve_action:${btn.text}`
                            };
                        });
                        
                        // Group buttons into rows (max 2 buttons per row)
                        const rows = [];
                        for (let i = 0; i < keyboardButtons.length; i += 2) {
                            rows.push(keyboardButtons.slice(i, i + 2));
                        }
                        
                        const inlineKeyboard = {
                            reply_markup: {
                                inline_keyboard: rows
                            }
                        };
                        
                        ALLOWED_CHAT_IDS.forEach(chatId => {
                            bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...inlineKeyboard }).catch(() => {});
                        });
                    }
                } else {
                    consecutiveNoApprovalTicks++;
                    if (consecutiveNoApprovalTicks >= 3) {
                        lastNotifiedApprovalPath = null;
                    }
                }
            }).catch(() => {});
        } catch (_) {}

        // 5. Continuous typing status check
        try {
            const isThinkingCDP = await checkAgentThinkingStatus(CDP_PORT).catch(() => false);
            const isThinkingLogs = (Date.now() - lastModelLogTime < 15000);
            const isThinking = isThinkingCDP || isThinkingLogs;
            
            if (isThinking) {
                const now = Date.now();
                if (now - lastTypingSentTime > 4000) {
                    lastTypingSentTime = now;
                    ALLOWED_CHAT_IDS.forEach(chatId => {
                        bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
                    });
                }
            }
        } catch (_) {}

        // 6. Polling current active model via CDP
        try {
            const modelName = await getCurrentModelViaCDP(CDP_PORT);
            if (modelName && getModelShortName(modelName) !== getModelShortName(lastKnownModel)) {
                const oldModel = lastKnownModel;
                lastKnownModel = modelName;
                if (oldModel !== null) {
                    pushToUser(`🤖 模型已自动同步为: <code>${getModelShortName(modelName)}</code>`);
                    await globalRefreshInputPlaceholder();
                    updatePinnedDashboard().catch(() => {}); // Sync dashboard on model switch
                } else {
                    console.log(`🤖 Initial active model detected: ${modelName}`);
                    await globalRefreshInputPlaceholder();
                    updatePinnedDashboard().catch(() => {});
                }
            }
        } catch (e) {
            console.error('[LogsWatcher] Failed to fetch current model via CDP:', e.message);
        }

        // 7. Polling current active project via CDP
        try {
            const projName = await getActiveProjectNameViaCDP(CDP_PORT);
            if (projName && projName !== lastKnownProject) {
                const oldProj = lastKnownProject;
                lastKnownProject = projName;
                if (oldProj !== null) {
                    pushToUser(`📁 项目已自动同步为: <code>${projName}</code>`);
                    updatePinnedDashboard().catch(() => {}); // Sync dashboard on project switch
                } else {
                    console.log(`📂 Initial active project detected: ${projName}`);
                    updatePinnedDashboard().catch(() => {});
                }
            }
        } catch (e) {
            console.error('[LogsWatcher] Failed to fetch current project via CDP:', e.message);
        }

        // 8. Polling current active conversation/chat title via CDP
        try {
            const chatTitle = await getActiveConversationTitleViaCDP(CDP_PORT, currentSessionId);
            if (chatTitle && chatTitle !== lastKnownChatTitle) {
                const oldChat = lastKnownChatTitle;
                lastKnownChatTitle = chatTitle;
                if (oldChat !== null) {
                    pushToUser(`💬 会话已自动同步为: <code>${chatTitle}</code>`);
                    updatePinnedDashboard().catch(() => {}); // Sync dashboard on chat title switch
                } else {
                    console.log(`💬 Initial active chat title detected: ${chatTitle}`);
                    updatePinnedDashboard().catch(() => {});
                }
            }
        } catch (e) {
            console.error('[LogsWatcher] Failed to fetch current chat title via CDP:', e.message);
        }
    }, 1000);
    });
}

// ===== TELEGRAM BOT COMMAND HANDLERS =====

bot.command('start', (ctx) => {
    const helpMsg = `
👋 <b>欢迎使用极简 TeleGravity 控制台！</b>

这是一个已彻底重构的全新套件，支持<b>100% 自动实时对话推送</b>和<b>项目无感切换</b>。所有的输入均直接通过 Telegram 键盘发送即可，无需复杂的界面点击。

🛠️ <b>命令指南：</b>
/start - 📖 查看操作说明与指南
/status - 📊 检查电脑端连接状态及绑定的活跃会话
/chat - 💬 切换或管理当前项目中的活跃会话
/details - 💭 控制是否显示中间思考过程
/terminal - 🖥️ 查看或终止后台运行的脚本与进程
/killall - ⏹️ 一键强制终止所有活跃的后台终端任务
/new - 🆕 新建会话 (New Chat)
/screenshot - 📸 截取电脑端的 Antigravity 界面
/latest - 💬 强制获取最近一次 AI 回复（防丢防漏兜底）

💡 <b>直接聊天：</b>
您可以像平时聊天一样在对话框里直接打字发送，机器人将自动将其投递到电脑的 Antigravity 窗口中，并自动为您推送回复！
    `.trim();
    ctx.reply(helpMsg, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
});

bot.command('status', async (ctx) => {
    let msg = `<b>系统状态报告</b>\n\n`;
    msg += `• 调试端口: <code>${CDP_PORT}</code>\n`;
    
    if (currentSessionId) {
        msg += `• 活动会话: <code>${currentSessionId}</code>\n`;
        msg += `• 日志监测: 运行中\n`;
    } else {
        msg += `• 活动会话: 未开启\n`;
        msg += `• 日志监测: 未开启\n`;
    }
    
    msg += `• 消息推送: 正常\n\n`;
    msg += `<i>提示：如果连接失败，请确保电脑端的 Antigravity 客户端已运行，且开启了调试端口。</i>`;
    ctx.reply(msg, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
});

function formatTimeRemaining(resetTimeSeconds, serverTimeSeconds) {
    if (!resetTimeSeconds) return 'Fully Charged';
    const resetTime = parseInt(resetTimeSeconds, 10);
    const diff = resetTime - serverTimeSeconds;
    if (diff <= 0) return 'Fully Charged';
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        return `${m}m ${s}s`;
    }
    if (diff < 86400) {
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        return `${h}h ${m}m`;
    }
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    return `${d}d ${h}h`;
}

// Shared Quota command logic helper
async function handleQuota(ctx) {
    ctx.sendChatAction('typing').catch(() => {});
    try {
        const data = await queryAntigravityQuota(CDP_PORT);
        
        let msg = `<b>模型额度报告</b>\n\n`;
        
        if (data.userTier) {
            msg += `• 账户等级: <code>${data.userTier.name}</code>\n`;
        }
        
        if (data.planStatus) {
            const plan = data.planStatus.planInfo;
            if (plan) {
                msg += `• 订阅方案: <code>${plan.planName}</code>\n`;
            }
            
            const promptTotal = plan?.monthlyPromptCredits || 0;
            const promptAvailable = data.planStatus.availablePromptCredits || 0;
            msg += `• Prompt 额度: <code>${promptAvailable} / ${promptTotal}</code>\n`;
            
            const flowTotal = plan?.monthlyFlowCredits || 0;
            const flowAvailable = data.planStatus.availableFlowCredits || 0;
            msg += `• Flow 额度: <code>${flowAvailable} / ${flowTotal}</code>\n`;
        }
        
        msg += `\n<b>5小时限额详情:</b>\n`;
        
        if (data.modelQuotas && data.modelQuotas.length > 0) {
            data.modelQuotas.forEach(m => {
                const percentage = Math.round(m.remainingFraction * 100);
                const timeRemaining = formatTimeRemaining(m.resetTimeSeconds, data.serverTimeSeconds);
                const timeStr = timeRemaining === 'Fully Charged' ? '就绪' : `${timeRemaining} 后重置`;
                msg += `▫️ <b>${m.label}:</b> <code>${percentage}%</code> (${timeStr})\n`;
            });
        } else {
            msg += `<i>未获取到任何模型限额信息。</i>\n`;
        }
        
        msg += `\n<pre>更新时间: ${new Date(data.serverTimeSeconds * 1000).toLocaleString('zh-CN')}</pre>`;
        
        ctx.reply(msg, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
    } catch (e) {
        ctx.reply(`❌ 额度查询失败: <code>${e.message}</code>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
    }
}

bot.command('quota', handleQuota);

bot.command('new', async (ctx) => {
    try {
        const success = await triggerNewChat(CDP_PORT);
        if (success) {
            await new Promise(r => setTimeout(r, 800));
            const newId = await getActiveConversationIdViaCDP(CDP_PORT).catch(() => null);
            if (newId) {
                currentSessionId = newId;
                const newSessionDir = path.join(brainPath, currentSessionId);
                currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                lastKnownChatTitle = '新会话';
            }
            updatePinnedDashboard().catch(() => {});
            await ctx.reply(`🆕 已成功创建并绑定至全新会话！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
        } else {
            ctx.reply("❌ 无法新建会话，请检查电脑端界面。", getStatusKeyboard(lastKnownModel));
        }
    } catch (e) {
        ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.command('chat', async (ctx) => {
    ctx.sendChatAction('typing').catch(() => {});
    const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    try {
        const conversations = await getConversationsViaCDP(CDP_PORT);
        
        if (args) {
            const argsLower = args.toLowerCase();
            
            // Subcase: check if they want to create a new chat
            if (['new', '新建', '新建会话', '空白'].includes(argsLower)) {
                const success = await triggerNewChat(CDP_PORT);
                if (success) {
                    await new Promise(r => setTimeout(r, 800));
                    const newId = await getActiveConversationIdViaCDP(CDP_PORT).catch(() => null);
                    if (newId) {
                        currentSessionId = newId;
                        const newSessionDir = path.join(brainPath, currentSessionId);
                        currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                        lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                        lastKnownChatTitle = '新会话';
                    }
                    updatePinnedDashboard().catch(() => {});
                } else {
                    ctx.reply("❌ 无法新建会话，请检查电脑端界面。", getStatusKeyboard(lastKnownModel));
                }
                return;
            }
            
            // Subcase: switch to matched conversation
            const matchedConvo = conversations.find(c => 
                c.summary && (
                    c.summary.toLowerCase() === argsLower ||
                    c.summary.toLowerCase().includes(argsLower) ||
                    argsLower.includes(c.summary.toLowerCase())
                )
            );
            
            if (matchedConvo) {
                const success = await selectConversationViaCDP(matchedConvo.cascadeId, CDP_PORT);
                if (success) {
                    await waitForTargetReady(CDP_PORT, async () => {
                        const currentId = await getActiveConversationIdViaCDP(CDP_PORT);
                        return currentId === matchedConvo.cascadeId;
                    }, 8000, 250);
                    
                    // Bind states
                    currentSessionId = matchedConvo.cascadeId;
                    const newSessionDir = path.join(brainPath, currentSessionId);
                    currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                    lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                    lastKnownChatTitle = matchedConvo.summary || '已切换会话';
                    
                    updatePinnedDashboard().catch(() => {});
                    await ctx.reply(`🟢 已成功切换至项目: <b>${lastKnownProject || '默认项目'}</b>\n💬 当前会话: <b>${lastKnownChatTitle}</b>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
                } else {
                    const dispTitle = matchedConvo.summary || matchedConvo.cascadeId.substring(0, 8);
                    ctx.reply(`❌ 切换至会话 "${dispTitle}" 失败，请在电脑端重试。`, getStatusKeyboard(lastKnownModel));
                }
                return;
            }
            
            await ctx.reply(`⚠️ 未找到名字包含 "${args}" 的活跃会话。下面是所有可用会话：`, getStatusKeyboard(lastKnownModel));
        }

        if (conversations.length === 0) {
            return ctx.reply("⚠️ 未在电脑端 Antigravity 中找到任何活跃会话。", getStatusKeyboard(lastKnownModel));
        }

        // Sort by lastModifiedSeconds descending
        conversations.sort((a, b) => {
            const timeA = a.lastModifiedSeconds ? parseInt(a.lastModifiedSeconds, 10) : 0;
            const timeB = b.lastModifiedSeconds ? parseInt(b.lastModifiedSeconds, 10) : 0;
            return timeB - timeA;
        });

        let msg = `💬 <b>切换活跃会话：</b>\n\n`;
        msg += `当前检测到 <b>${conversations.length}</b> 个可用会话。请点击下方按钮选择切换以继续沟通：`;

        const buttons = [];
        const topConversations = conversations.slice(0, 10);
        
        topConversations.forEach((conv) => {
            const isActive = conv.cascadeId === currentSessionId;
            const prefix = isActive ? '🟢 ' : '💬 ';
            const displayTitle = conv.summary 
                ? (conv.summary.length > 22 ? conv.summary.substring(0, 22) + '...' : conv.summary) 
                : `未命名会话 (${conv.cascadeId ? conv.cascadeId.substring(0, 6) : '未知'})`;
            
            buttons.push([{
                text: `${prefix}${displayTitle}`,
                callback_data: `chat:${conv.cascadeId}`
            }]);
        });
        
        // Add a "Create New Chat" shortcut button at the end
        buttons.push([{
            text: '🆕 新建空白会话 (New Chat)',
            callback_data: 'chat:new'
        }]);

        ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    } catch (e) {
        ctx.reply(`❌ 获取或切换会话失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.command('screenshot', async (ctx) => {
    ctx.reply("📸 正在截取电脑端 Antigravity 界面...", getStatusKeyboard(lastKnownModel));
    try {
        const buffer = await captureFullIDEScreenshot(CDP_PORT);
        ctx.replyWithPhoto({ source: buffer }, getStatusKeyboard(lastKnownModel)).catch(err => {
            ctx.reply(`❌ 截图发送失败: ${err.message}`, getStatusKeyboard(lastKnownModel));
        });
    } catch (e) {
        ctx.reply(`❌ 截图抓取失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.command('latest', async (ctx) => {
    if (!currentFilePath || !fs.existsSync(currentFilePath)) {
        return ctx.reply("⚠️ 当前没有活跃追踪的日志文件，无法获取最近答复。", getStatusKeyboard(lastKnownModel));
    }
    
    try {
        const content = fs.readFileSync(currentFilePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        let lastResponse = null;

        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE' && entry.content && entry.content.trim()) {
                    lastResponse = entry.content;
                    break;
                }
            } catch (_) {}
        }

        if (lastResponse) {
            await sendLongMessage(ctx, lastResponse, `💬 <b>最近一次 AI 回复内容：</b>`, getStatusKeyboard(lastKnownModel));
        } else {
            ctx.reply("ℹ️ 当前会话中尚未发现 AI 生成的回复记录。", getStatusKeyboard(lastKnownModel));
        }
    } catch (e) {
        ctx.reply(`❌ 读取失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

async function sendArtifactFile(ctx, filename) {
    if (!currentSessionId) {
        return ctx.reply("⚠️ 当前没有活跃的会话，无法获取 md 文件。", getStatusKeyboard(lastKnownModel));
    }
    const filePath = path.join(brainPath, currentSessionId, filename);
    if (!fs.existsSync(filePath)) {
        return ctx.reply(`ℹ️ 当前会话中尚未生成 <code>${filename}</code> 文件。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
    }
    
    try {
        const content = fs.readFileSync(filePath);
        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        const hasBom = content.length >= 3 && content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF;
        const sourceBuffer = hasBom ? content : Buffer.concat([bom, content]);
        
        ctx.sendChatAction('upload_document').catch(() => {});
        await ctx.replyWithDocument({
            source: sourceBuffer,
            filename: filename
        }, {
            caption: `📄 <b>${filename}</b>`,
            parse_mode: 'HTML',
            ...getStatusKeyboard(lastKnownModel)
        });
    } catch (e) {
        ctx.reply(`❌ 发送文件失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
}

bot.command('plan', async (ctx) => {
    await sendArtifactFile(ctx, 'implementation_plan.md');
});

bot.command('task', async (ctx) => {
    await sendArtifactFile(ctx, 'task.md');
});

bot.command('walkthrough', async (ctx) => {
    await sendArtifactFile(ctx, 'walkthrough.md');
});

bot.command('details', (ctx) => {
    showDetails = !showDetails;
    const statusText = showDetails ? '🟢 <b>已开启</b>（将实时推送中间思考与工具调用过程）' : '🔴 <b>已关闭</b>（仅推送最终回复，保持聊天框简洁）';
    ctx.reply(`ℹ️ <b>思考过程输出控制：</b>\n\n当前状态：${statusText}`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
});

bot.command('help', (ctx) => {
    const helpMsg = `
💡 <b>TeleGravity 快捷指令帮助</b>

这是一个完全重构的高性能 Telegram 桥接 Bot，所有命令均已重置更新：

/start - 📖 查看操作说明与指南
/status - 📊 检查电脑端连接状态与活跃会话 ID
/chat - 💬 切换或管理当前项目中的活跃会话
/details - 💭 控制是否显示中间思考过程
/terminal - 🖥️ 查看或终止后台运行的脚本与进程
/killall - ⏹️ 一键强制终止所有活跃的后台终端任务 (Kill All Tasks)
/model - 🤖 切换 AI 语言模型
/project - 📂 切换当前进行的项目
/stop - ⏹️ 停止电脑端 Agent 生成
/new - 🆕 触发电脑端新建空白会话
/screenshot - 📸 实时截取电脑端的 Antigravity 界面
/latest - 💬 强制获取本会话的最近一次 AI 回复
/plan - 📋 获取当前实施方案 (Implementation Plan)
/task - 📝 获取当前任务清单 (Task List)
/walkthrough - 🏁 获取当前工作总结 (Walkthrough)
/help - 💡 查看本帮助说明

🌟 <b>如何与 AI 聊天？</b>
直接在 Telegram 对话框中发送您的文字需求即可，机器人会自动将其注入到电脑端 Antigravity 输入框并发送。
电脑端的任何 AI 回复，都会在 0.1 秒内自动实时推送到手机 Telegram 上，对话 100% 连续！
    `.trim();
    ctx.reply(helpMsg, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
});

bot.command('killall', async (ctx) => {
    ctx.sendChatAction('typing').catch(() => {});
    try {
        const tasks = await getRunningTerminalTasks();
        if (tasks.length === 0) {
            return ctx.reply("⚠️ 未找到任何活动中的后台终端任务。", { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        }
        
        const { execSync } = require('child_process');
        let count = 0;
        for (const task of tasks) {
            try {
                execSync(`taskkill /F /PID ${task.pid} /T`);
                count++;
            } catch (_) {}
        }
        
        ctx.reply(`✅ 已成功强制终止全部 <b>${count}</b> 个活动后台终端任务及其关联的进程树！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        updatePinnedDashboard().catch(() => {});
        await refreshInputPlaceholder(ctx);
    } catch (e) {
        ctx.reply(`❌ 一键终止失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

// Smart project scanner helper
function getAvailableProjects() {
    let projDir = config.projectsDir;
    if (!fs.existsSync(projDir)) {
        // Fallback to the suite's parent directory
        projDir = path.join(__dirname, '..', '..');
    }
    try {
        if (!fs.existsSync(projDir)) return [];
        return fs.readdirSync(projDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
            .map(dirent => ({
                name: dirent.name,
                path: path.join(projDir, dirent.name)
            }));
    } catch (e) {
        console.error('[getAvailableProjects] Error reading projects dir:', e.message);
        return [];
    }
}

// Model switching inline keyboard config
const modelKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '⚡ Gemini 3.5 Flash (High)', callback_data: 'model:flash (high)' },
                { text: '⚡ Gemini 3.5 Flash (Medium)', callback_data: 'model:flash (medium)' }
            ],
            [
                { text: '🧠 Gemini 3.1 Pro (High)', callback_data: 'model:pro (high)' },
                { text: '🧠 Gemini 3.1 Pro (Low)', callback_data: 'model:pro (low)' }
            ],
            [
                { text: '🚀 Claude Sonnet 4.6 (Thinking)', callback_data: 'model:sonnet' },
                { text: '🚀 Claude Opus 4.6 (Thinking)', callback_data: 'model:opus' }
            ],
            [
                { text: '🤖 GPT-OSS 120B (Medium)', callback_data: 'model:gpt-oss' }
            ]
        ]
    }
};

// Commands Implementation
bot.command('model', (ctx) => {
    const modelMsg = `🤖 <b>切换 AI 语言模型：</b>\n\n请在下方选择您想要切换的目标模型：`;
    ctx.reply(modelMsg, { parse_mode: 'HTML', ...modelKeyboard });
});

bot.command('project', async (ctx) => {
    ctx.sendChatAction('typing').catch(() => {});
    const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    try {
        const projects = await getAvailableProjectsViaCDP(CDP_PORT);
        
        if (args) {
            const argsLower = args.toLowerCase();
            const matchedProject = projects.find(p => 
                p.name.toLowerCase() === argsLower ||
                p.name.toLowerCase().includes(argsLower) ||
                argsLower.includes(p.name.toLowerCase()) ||
                p.uri === args
            );
            
            if (matchedProject) {
                const success = await switchProjectViaCDP(matchedProject.uri, CDP_PORT);
                if (success) {
                    await waitForTargetReady(CDP_PORT, async () => {
                        const activeProj = await getActiveProjectNameViaCDP(CDP_PORT);
                        return activeProj && activeProj.toLowerCase() === matchedProject.name.toLowerCase();
                    }, 8000, 250);
                    
                    lastKnownProject = matchedProject.name;
                    updatePinnedDashboard().catch(() => {});
                    await ctx.reply(`🟢 已成功切换至项目: <b>${lastKnownProject}</b>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
                } else {
                    ctx.reply(`❌ 切换项目失败，请确认选择项目是否可见，或在电脑端重试。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
                }
                return;
            }
            
            await ctx.reply(`⚠️ 未找到名字包含 "${args}" 的活跃项目。下面是所有可用项目：`, getStatusKeyboard(lastKnownModel));
        }

        if (projects.length === 0) {
            return ctx.reply("⚠️ 未在电脑端 Antigravity 中找到任何活跃项目。");
        }
        
        let projMsg = `📂 <b>切换当前进行的项目：</b>\n\n当前检测到 <b>${projects.length}</b> 个可用项目，请点击选择切换：\n\n`;
        
        const buttons = [];
        projects.forEach((proj, idx) => {
            const btn = { text: `📁 ${proj.name}`, callback_data: `proj:${proj.uri}` };
            if (idx % 2 === 0) {
                buttons.push([btn]);
            } else {
                buttons[buttons.length - 1].push(btn);
            }
        });
        
        ctx.reply(projMsg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    } catch (e) {
        ctx.reply(`❌ 获取项目列表失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.command('stop', async (ctx) => {
    ctx.reply("⏹️ 正在尝试停止电脑端 Agent 的思考与生成...", getStatusKeyboard(lastKnownModel));
    try {
        const success = await stopAgentViaCDP(CDP_PORT);
        if (success) {
            ctx.reply("✅ 已成功发送停止/取消指令。", getStatusKeyboard(lastKnownModel));
        } else {
            ctx.reply("❌ 未检测到正在运行的 Agent 思考过程，或停止指令发送失败。", getStatusKeyboard(lastKnownModel));
        }
    } catch (e) {
        ctx.reply(`❌ 停止指令执行出错: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.command('terminal', async (ctx) => {
    ctx.sendChatAction('typing').catch(() => {});
    const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    try {
        const tasks = await getRunningTerminalTasks();
        
        if (args) {
            const parts = args.split(/\s+/);
            const action = parts[0].toLowerCase();
            const pidArg = parts[1];
            
            if ((action === 'kill' || action === 'stop') && pidArg) {
                const pid = parseInt(pidArg, 10);
                if (isNaN(pid)) {
                    return ctx.reply(`❌ 无效的 PID: <code>${pidArg}</code>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
                }
                
                const task = tasks.find(t => t.pid === pid);
                if (!task) {
                    return ctx.reply(`❌ 未找到 PID 为 <code>${pid}</code> 的活动终端任务，或该任务不是由 Antigravity 启动的（出于安全限制）。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
                }
                
                ctx.reply(`⏹️ 正在终止任务 <b>${task.name}</b> (PID: <code>${pid}</code>)...`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
                
                try {
                    const { execSync } = require('child_process');
                    execSync(`taskkill /F /PID ${pid} /T`);
                    
                    ctx.reply(`✅ 已成功强制终止 PID <code>${pid}</code> 及其所有子进程树！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
                    updatePinnedDashboard().catch(() => {});
                } catch (err) {
                    ctx.reply(`❌ 终止进程树失败: ${err.message}`, getStatusKeyboard(lastKnownModel));
                }
                return;
            }
            
            return ctx.reply(`💡 <b>/terminal 使用帮助:</b>\n\n• 输入 <code>/terminal</code> 列出运行中的后台脚本\n• 输入 <code>/terminal kill &lt;PID&gt;</code> 终止指定的进程树`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        }
        
        if (tasks.length === 0) {
            return ctx.reply("🖥️ <b>当前没有运行中的后台终端任务。</b>", { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        }
        
        let msg = `🖥️ <b>活动后台终端任务列表 (${tasks.length}):</b>\n\n`;
        const buttons = [];
        
        tasks.forEach((t, idx) => {
            msg += `${idx + 1}. <code>[PID: ${t.pid}]</code> <b>${t.name.replace('.exe', '')}</b>\n`;
            msg += `   命令: <code>${escapeHtml(t.command)}</code>\n\n`;
            
            buttons.push([{
                text: `⏹️ 终止 PID: ${t.pid} (${t.name.replace('.exe', '')})`,
                callback_data: `kill_task:${t.pid}`
            }]);
        });
        
        msg += `<i>👇 您可以直接点击下方按钮强制关闭指定的进程：</i>`;
        
        ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    } catch (e) {
        ctx.reply(`❌ 查询后台任务出错: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

// Action queries (Callbacks)
bot.action('approve_action', async (ctx) => {
    try {
        await ctx.answerCbQuery("正在同意并执行...").catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        await respondToApproval(CDP_PORT, 'approve');
    } catch (e) {
        await ctx.reply(`❌ 执行出错: ${e.message}`).catch(() => {});
    }
});

bot.action('reject_action', async (ctx) => {
    try {
        await ctx.answerCbQuery("正在拒绝...").catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        await respondToApproval(CDP_PORT, 'reject');
    } catch (e) {
        await ctx.reply(`❌ 执行出错: ${e.message}`).catch(() => {});
    }
});

bot.action(/^approve_action:(.+)$/, async (ctx) => {
    const buttonText = ctx.match[1];
    try {
        await ctx.answerCbQuery(`正在点击: ${buttonText}...`).catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        await respondToApproval(CDP_PORT, buttonText);
    } catch (e) {
        await ctx.reply(`❌ 执行出错: ${e.message}`).catch(() => {});
    }
});

bot.action(/^kill_task:(.+)$/, async (ctx) => {
    const targetPid = parseInt(ctx.match[1], 10);
    try {
        await ctx.answerCbQuery(`正在终止进程 PID: ${targetPid}...`).catch(() => {});
        
        const tasks = await getRunningTerminalTasks();
        const task = tasks.find(t => t.pid === targetPid);
        
        if (!task) {
            return ctx.reply(`❌ 终止失败：未找到 PID 为 <code>${targetPid}</code> 的活动终端任务。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        }
        
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        
        const { execSync } = require('child_process');
        execSync(`taskkill /F /PID ${targetPid} /T`);
        
        ctx.reply(`✅ 已成功强制终止 PID <code>${targetPid}</code> <b>${task.name}</b> (命令: <code>${escapeHtml(task.command)}</code>) 及其所有子进程树！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        updatePinnedDashboard().catch(() => {});
    } catch (e) {
        ctx.reply(`❌ 强制终止进程 PID ${targetPid} 失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
    }
});

bot.action('kill_all_tasks', async (ctx) => {
    try {
        await ctx.answerCbQuery("正在终止所有后台进程...").catch(() => {});
        
        const tasks = await getRunningTerminalTasks();
        if (tasks.length === 0) {
            ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
            return ctx.reply("⚠️ 未找到任何活动中的后台终端任务。", { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        }
        
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        
        const { execSync } = require('child_process');
        let count = 0;
        for (const task of tasks) {
            try {
                execSync(`taskkill /F /PID ${task.pid} /T`);
                count++;
            } catch (_) {}
        }
        
        ctx.reply(`✅ 已成功强制终止全部 <b>${count}</b> 个活动后台终端任务及其关联的进程树！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
        updatePinnedDashboard().catch(() => {});
    } catch (e) {
        ctx.reply(`❌ 一键终止后台进程失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
    }
});

bot.action('session:show_projects', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        
        const projects = await getAvailableProjectsViaCDP(CDP_PORT);
        if (projects.length === 0) {
            return ctx.reply("⚠️ 未在电脑端 Antigravity 中找到任何活跃项目。", getStatusKeyboard(lastKnownModel));
        }
        
        let projMsg = `📂 <b>切换当前进行的项目：</b>\n\n请在下方点击选择切换项目：`;
        const buttons = [];
        projects.forEach((proj, idx) => {
            const btn = { text: `📁 ${proj.name}`, callback_data: `proj:${proj.uri}` };
            if (idx % 2 === 0) {
                buttons.push([btn]);
            } else {
                buttons[buttons.length - 1].push(btn);
            }
        });
        ctx.reply(projMsg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    } catch (e) {
        ctx.reply(`❌ 获取项目列表失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.action('session:show_models', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        
        const modelMsg = `🤖 <b>切换 AI 语言模型：</b>\n\n请在下方选择您想要切换的目标模型：`;
        ctx.reply(modelMsg, { parse_mode: 'HTML', ...modelKeyboard });
    } catch (e) {
        ctx.reply(`❌ 切换模型菜单失败: ${e.message}`).catch(() => {});
    }
});

bot.action('session:show_quota', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        await handleQuota(ctx);
    } catch (e) {
        ctx.reply(`❌ 查询 Quota 失败: ${e.message}`).catch(() => {});
    }
});

// Helper to render conversation list menu dynamically
async function showConversationsMenu(ctx) {
    try {
        const conversations = await getConversationsViaCDP(CDP_PORT);
        if (conversations.length === 0) {
            return ctx.reply("⚠️ 未在电脑端 Antigravity 中找到任何活跃会话。", getStatusKeyboard(lastKnownModel));
        }

        // Sort by lastModifiedSeconds descending
        conversations.sort((a, b) => {
            const timeA = a.lastModifiedSeconds ? parseInt(a.lastModifiedSeconds, 10) : 0;
            const timeB = b.lastModifiedSeconds ? parseInt(b.lastModifiedSeconds, 10) : 0;
            return timeB - timeA;
        });

        let msg = `💬 <b>切换活跃会话：</b>\n\n`;
        msg += `当前检测到 <b>${conversations.length}</b> 个可用会话。请点击下方按钮选择切换以继续沟通：`;

        const buttons = [];
        const topConversations = conversations.slice(0, 10);
        
        topConversations.forEach((conv) => {
            const isActive = conv.cascadeId === currentSessionId;
            const prefix = isActive ? '🟢 ' : '💬 ';
            const displayTitle = conv.summary 
                ? (conv.summary.length > 22 ? conv.summary.substring(0, 22) + '...' : conv.summary) 
                : `未命名会话 (${conv.cascadeId ? conv.cascadeId.substring(0, 6) : '未知'})`;
            
            buttons.push([{
                text: `${prefix}${displayTitle}`,
                callback_data: `chat:${conv.cascadeId}`
            }]);
        });
        
        // Add a "Create New Chat" shortcut button at the end
        buttons.push([{
            text: '🆕 新建空白会话 (New Chat)',
            callback_data: 'chat:new'
        }]);

        await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'HTML' }).catch(() => {});
    } catch (e) {
        await ctx.reply(`❌ 获取会话列表出错: ${e.message}`).catch(() => {});
    }
}

bot.action('session:show_chats', async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        await showConversationsMenu(ctx);
    } catch (e) {
        ctx.reply(`❌ 执行出错: ${e.message}`).catch(() => {});
    }
});

bot.action(/^chat:(.+)$/, async (ctx) => {
    const targetChatId = ctx.match[1];
    ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
    
    if (targetChatId === 'new') {
        try {
            await ctx.answerCbQuery("正在新建会话...").catch(() => {});
            const success = await triggerNewChat(CDP_PORT);
            if (success) {
                await new Promise(r => setTimeout(r, 800));
                const newId = await getActiveConversationIdViaCDP(CDP_PORT).catch(() => null);
                if (newId) {
                    currentSessionId = newId;
                    const newSessionDir = path.join(brainPath, currentSessionId);
                    currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                    lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                    lastKnownChatTitle = '新会话';
                }
                updatePinnedDashboard().catch(() => {});
                await ctx.reply(`🆕 已成功创建并绑定至全新会话！`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
            } else {
                ctx.reply("❌ 无法新建会话，请检查电脑端界面。", getStatusKeyboard(lastKnownModel));
            }
        } catch (e) {
            ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
        }
        return;
    }
    
    try {
        await ctx.answerCbQuery("正在切换会话...").catch(() => {});
        
        const success = await selectConversationViaCDP(targetChatId, CDP_PORT);
        if (success) {
            // Update local tracking variables immediately
            currentSessionId = targetChatId;
            const newSessionDir = path.join(brainPath, currentSessionId);
            currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
            
            // Set offset to current file size to avoid dumping history
            if (fs.existsSync(currentFilePath)) {
                lastFileOffset = fs.statSync(currentFilePath).size;
            } else {
                lastFileOffset = 0;
            }
            
            // Reset artifact tracking for this session
            ['implementation_plan.md', 'task.md', 'walkthrough.md'].forEach(art => {
                const p = path.join(newSessionDir, art);
                lastArtifactStats[art] = fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0;
            });
            
            // Wait for switch to complete
            await waitForTargetReady(CDP_PORT, async () => {
                const currentId = await getActiveConversationIdViaCDP(CDP_PORT);
                return currentId === targetChatId;
            }, 8000, 250);
            
            // Query new chat title
            const title = await getActiveConversationTitleViaCDP(CDP_PORT, currentSessionId).catch(() => null);
            if (title) {
                lastKnownChatTitle = title;
            } else {
                lastKnownChatTitle = '已切换会话';
            }
            
            updatePinnedDashboard().catch(() => {});
            await refreshInputPlaceholder(ctx);
            await ctx.reply(`🟢 已成功切换至项目: <b>${lastKnownProject || '默认项目'}</b>\n💬 当前会话: <b>${lastKnownChatTitle}</b>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
        } else {
            ctx.reply(`❌ 切换会话失败，请确认 CDP 端口 ${CDP_PORT} 连接正常并重试。`, getStatusKeyboard(lastKnownModel));
        }
    } catch (e) {
        ctx.reply(`❌ 切换会话出错: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

bot.action(/^model:(.+)$/, async (ctx) => {
    const targetModel = ctx.match[1];
    try {
        await ctx.answerCbQuery(`切换模型至 ${targetModel}...`).catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        const success = await selectModelViaCDP(targetModel, CDP_PORT);
        if (success) {
            lastKnownModel = targetModel;
            updatePinnedDashboard().catch(() => {});
            await refreshInputPlaceholder(ctx);
            await ctx.reply(`🤖 模型已成功切换为：<b>${getModelShortName(targetModel)}</b>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
        } else {
            ctx.reply(`❌ 切换模型失败，请确认选择菜单是否可见。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
        }
    } catch (e) {
        ctx.reply(`❌ 执行出错: ${e.message}`).catch(() => {});
    }
});

bot.action(/^proj:(.+)$/, async (ctx) => {
    const targetProjIdOrName = ctx.match[1];
    
    try {
        await ctx.answerCbQuery("正在尝试切换项目...").catch(() => {});
        ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
        
        // Find the project name from the current available projects in sidebar via CDP
        const projects = await getAvailableProjectsViaCDP(CDP_PORT);
        const targetProj = projects.find(p => p.uri === targetProjIdOrName || p.name.toLowerCase() === targetProjIdOrName.toLowerCase());
        
        const projDisplayName = targetProj ? targetProj.name : targetProjIdOrName;
        
        const success = await switchProjectViaCDP(targetProjIdOrName, CDP_PORT);
        if (success) {
            // Wait for switch ready
            await waitForTargetReady(CDP_PORT, async () => {
                const activeProj = await getActiveProjectNameViaCDP(CDP_PORT);
                return activeProj && activeProj.toLowerCase() === projDisplayName.toLowerCase();
            }, 8000, 250);
            
            // If switch succeeded, we update the last known project directly
            lastKnownProject = projDisplayName;
            updatePinnedDashboard().catch(() => {});
            
            // Automatically trigger the conversation list popup for this new project!
            await showConversationsMenu(ctx);
            await refreshInputPlaceholder(ctx);
            return;
        }
        ctx.reply(`❌ 切换项目失败，请确认选择项目是否可见，或在电脑端重试。`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
    } catch (e) {
        ctx.reply(`❌ 切换项目失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
    }
});


// DEFAULT MESSAGE INTERCEPTION (Acts as text input prompt)
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // Avoid catching potential typo commands

    // Reset thinking check baseline time to bridge startup latency
    lastModelLogTime = Date.now();

    const chatId = ctx.chat.id.toString();
    
    // Intercept status button click (e.g. "Switch & Quota")
    if (text.toLowerCase() === 'switch & quota' || (text.startsWith('📁') && text.includes('| 💬'))) {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        
        // Show interactive management menu
        const menuText = `🛠️ <b>控制台管理菜单</b>\n\n您点击了底部的状态栏。请选择您要执行的操作：`;
        const inlineKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📁 切换项目 (Project)', callback_data: 'session:show_projects' },
                        { text: '💬 切换会话 (Chats)', callback_data: 'session:show_chats' }
                    ],
                    [
                        { text: '🤖 切换 AI 模型 (Model)', callback_data: 'session:show_models' },
                        { text: '💳 查询 Quota (Quota)', callback_data: 'session:show_quota' }
                    ]
                ]
            }
        };
        ctx.reply(menuText, { parse_mode: 'HTML', ...inlineKeyboard });
        return;
    }

    // Handle session rename text input state
    const state = userStates[chatId];
    if (state && state.action === 'awaiting_rename') {
        const newTitle = text;
        const convoId = state.conversationId;
        
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        if (state.promptMsgId) {
            ctx.deleteMessage(state.promptMsgId).catch(() => {});
        }
        
        delete userStates[chatId];
        
        if (!newTitle) {
            ctx.reply("❌ 会话名字不能为空！操作已取消。", getStatusKeyboard(lastKnownModel));
            return;
        }
        
        await ctx.sendChatAction('typing').catch(() => {});
        try {
            const success = await renameConversationViaCDP(convoId, newTitle, CDP_PORT);
            if (success) {
                lastKnownChatTitle = newTitle;
                ctx.reply(`✅ 成功修改当前会话标题为：\n<b>${newTitle}</b>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) });
            } else {
                ctx.reply("❌ 修改会话标题失败，请确认 CDP 连接正常并在电脑端重试。", getStatusKeyboard(lastKnownModel));
            }
        } catch (e) {
            ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel));
        }
        return;
    }

    // Intercept minimalist model / status button
    if (text === '🤖' || text === '.' || text.startsWith('📁')) {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        return;
    }

    // 3. Dynamic Prefix Routing (Unified brackets & @-mentions Parser)
    const prefixRegex = /^(?:(?:\[([^\]]+)\]|@([a-zA-Z0-9_\u4e00-\u9fa5-]+))\s*)+/i;
    const match = text.match(prefixRegex);
    
    if (match) {
        const prefixPart = match[0];
        const remainingText = text.slice(prefixPart.length).trim();
        
        // Extract all tokens sequentially preserving precise user order
        const tokens = [];
        const tokenRegex = /(?:\[([^\]]+)\]|@([a-zA-Z0-9_\u4e00-\u9fa5-]+))/gi;
        let tMatch;
        while ((tMatch = tokenRegex.exec(prefixPart)) !== null) {
            const token = (tMatch[1] || tMatch[2] || '').trim();
            if (token) {
                tokens.push(token);
            }
        }
        
        try {
            await ctx.sendChatAction('typing').catch(() => {});
            
            // Fetch available projects at the start of routing
            const projects = await getAvailableProjectsViaCDP(CDP_PORT).catch(() => []);
            
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const tokenLower = token.toLowerCase();
                
                // Case A: Check if token matches a project
                const matchedProject = projects.find(p => 
                    p.name.toLowerCase() === tokenLower || 
                    p.name.toLowerCase().includes(tokenLower) ||
                    tokenLower.includes(p.name.toLowerCase()) ||
                    p.uri === token
                );
                
                if (matchedProject) {
                    const currentProj = lastKnownProject || await getActiveProjectNameViaCDP(CDP_PORT).catch(() => null);
                    if (!currentProj || currentProj.toLowerCase() !== matchedProject.name.toLowerCase()) {
                        const success = await switchProjectViaCDP(matchedProject.uri, CDP_PORT);
                        if (!success) {
                            throw new Error(`切换项目至 "${matchedProject.name}" 失败，请确认该项目在电脑端 sidebar 中可见。`);
                        }
                        // Wait for switch to complete in DOM/React
                        await waitForTargetReady(CDP_PORT, async () => {
                            const activeProj = await getActiveProjectNameViaCDP(CDP_PORT);
                            return activeProj && activeProj.toLowerCase() === matchedProject.name.toLowerCase();
                        }, 8000, 250);
                        
                        lastKnownProject = matchedProject.name;
                        await new Promise(r => setTimeout(r, 600)); // Short stabilizing buffer
                    }
                    continue; // Process next token
                }
                
                // Case B: Check if token is a new chat action
                if (['new', '新建', '新建会话', '空白'].includes(tokenLower)) {
                    const success = await triggerNewChat(CDP_PORT);
                    if (!success) {
                        throw new Error("新建会话失败，请检查电脑端界面是否处于空闲状态。");
                    }
                    
                    // Wait 800ms for new chat page loading & stabilization
                    await new Promise(r => setTimeout(r, 800));
                    
                    // Query and bind new conversation ID asynchronously
                    const newId = await getActiveConversationIdViaCDP(CDP_PORT).catch(() => null);
                    if (newId) {
                        currentSessionId = newId;
                        const newSessionDir = path.join(brainPath, currentSessionId);
                        currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                        lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                        lastKnownChatTitle = '新会话';
                    }
                    continue;
                }
                
                // Case C: Check if token is an existing conversation in the active project
                const conversations = await getConversationsViaCDP(CDP_PORT).catch(() => []);
                const matchedConvo = conversations.find(c => 
                    c.summary && (
                        c.summary.toLowerCase() === tokenLower ||
                        c.summary.toLowerCase().includes(tokenLower) ||
                        tokenLower.includes(c.summary.toLowerCase())
                    )
                );
                
                if (matchedConvo) {
                    if (currentSessionId !== matchedConvo.cascadeId) {
                        const dispTitle = matchedConvo.summary || matchedConvo.cascadeId.substring(0, 8);
                        const success = await selectConversationViaCDP(matchedConvo.cascadeId, CDP_PORT);
                        if (!success) {
                            throw new Error(`切换至会话 "${dispTitle}" 失败。`);
                        }
                        
                        // Wait for switch to complete
                        await waitForTargetReady(CDP_PORT, async () => {
                            const currentId = await getActiveConversationIdViaCDP(CDP_PORT);
                            return currentId === matchedConvo.cascadeId;
                        }, 8000, 250);
                        
                        // Bind new conversation states immediately
                        currentSessionId = matchedConvo.cascadeId;
                        const newSessionDir = path.join(brainPath, currentSessionId);
                        currentFilePath = path.join(newSessionDir, '.system_generated', 'logs', 'transcript.jsonl');
                        lastFileOffset = fs.existsSync(currentFilePath) ? fs.statSync(currentFilePath).size : 0;
                        lastKnownChatTitle = matchedConvo.summary || '已切换会话';
                        
                        await new Promise(r => setTimeout(r, 400));
                    }
                    continue;
                }
                
                // Case D: Token did not match anything, warn and continue
                await ctx.reply(`⚠️ 前缀 [${token}] 既非已知项目也非活跃会话，已忽略该前缀。`, getStatusKeyboard(lastKnownModel)).catch(() => {});
            }
            
            // If message query is empty, switch is complete, return success
            if (!remainingText) {
                // Instantly refresh pinned live dashboard status
                updatePinnedDashboard().catch(() => {});
                return;
            }
            
            // Proceed to deliver the actual message
            await ctx.sendChatAction('typing').catch(() => {});
            await sendViaCDP(remainingText, CDP_PORT);
            
        } catch (e) {
            await ctx.reply(`❌ 动态路由切换或消息投递失败：\n<code>${e.message}</code>`, { parse_mode: 'HTML', ...getStatusKeyboard(lastKnownModel) }).catch(() => {});
        }
        return;
    }

    // Show "typing" status to indicate background processing
    await ctx.sendChatAction('typing').catch(() => {});

    try {
        await sendViaCDP(text, CDP_PORT);
    } catch (e) {
        ctx.reply(`❌ 投递消息失败，请确认 CDP 端口 ${CDP_PORT} 连接正常。\n错误信息: ${e.message}`, getStatusKeyboard(lastKnownModel));
    }
});

// HELPER FOR DOWNLOADING IMAGE FILE
const https = require('https');
function downloadTelegramFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

// DUAL-LAYER IMAGE DE-DUPLICATION CACHE
const processedFiles = new Set();
const mediaGroupQueues = {};

// HANDLE PHOTO/IMAGE UPLOAD FROM TELEGRAM
bot.on('photo', async (ctx) => {
    lastModelLogTime = Date.now();
    try {
        const photo = ctx.message.photo.at(-1);
        const fileUniqueId = photo.file_unique_id;
        
        // 1. File Uniqueness De-duplication (prevent double sends of exact same file)
        if (fileUniqueId) {
            if (processedFiles.has(fileUniqueId)) {
                console.log(`[Photo] File already processed: ${fileUniqueId}, skipping.`);
                return;
            }
            processedFiles.add(fileUniqueId);
            setTimeout(() => processedFiles.delete(fileUniqueId), 8000);
        }

        ctx.sendChatAction('upload_photo').catch(() => {});
        
        const fileId = photo.file_id;
        const fileUrl = await ctx.telegram.getFileLink(fileId);
        
        // Save to local scratch directory as temporary file
        const scratchDir = path.join(__dirname, '..', 'scratch');
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        const tempPath = path.join(scratchDir, `tg_upload_${Date.now()}_${fileUniqueId || 'file'}.jpg`);
        
        await downloadTelegramFile(fileUrl.href, tempPath);
        
        const caption = ctx.message.caption || "";
        const mediaGroupId = ctx.message.media_group_id;
        
        // 2. Album / Media Group Aggregation Logic
        if (mediaGroupId) {
            if (!mediaGroupQueues[mediaGroupId]) {
                mediaGroupQueues[mediaGroupId] = {
                    paths: [],
                    captions: [],
                    timer: null
                };
            }
            
            mediaGroupQueues[mediaGroupId].paths.push(tempPath);
            if (caption) {
                mediaGroupQueues[mediaGroupId].captions.push(caption);
            }
            
            if (mediaGroupQueues[mediaGroupId].timer) {
                clearTimeout(mediaGroupQueues[mediaGroupId].timer);
            }
            
            mediaGroupQueues[mediaGroupId].timer = setTimeout(async () => {
                const queue = mediaGroupQueues[mediaGroupId];
                delete mediaGroupQueues[mediaGroupId];
                
                try {
                    ctx.reply(`📸 正在向电脑端 Antigravity 传送 ${queue.paths.length} 张图片...`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                    
                    const finalCaption = queue.captions.join("\n");
                    const success = await sendImageViaCDP(queue.paths, finalCaption, CDP_PORT);
                    
                    if (success) {
                        ctx.reply(`✅ 成功传送并提交 ${queue.paths.length} 张图片！`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                    } else {
                        ctx.reply("❌ 图片传送失败，请确认 CDP 连接正常并在电脑端重试。", getStatusKeyboard(lastKnownModel)).catch(() => {});
                    }
                } catch (e) {
                    ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                } finally {
                    setTimeout(() => {
                        queue.paths.forEach(p => {
                            fs.unlink(p, () => {});
                        });
                    }, 5000);
                }
            }, 600);
            return;
        } else {
            // Single image direct upload
            ctx.reply("📸 正在向电脑端 Antigravity 传送图片...", getStatusKeyboard(lastKnownModel)).catch(() => {});
            const success = await sendImageViaCDP(tempPath, caption, CDP_PORT);
            
            if (success) {
                ctx.reply("✅ 图片传送并提交成功！", getStatusKeyboard(lastKnownModel)).catch(() => {});
            } else {
                ctx.reply("❌ 图片传送失败，请确认 CDP 连接正常并在电脑端重试。", getStatusKeyboard(lastKnownModel)).catch(() => {});
            }
            
            setTimeout(() => {
                fs.unlink(tempPath, () => {});
            }, 5000);
        }
    } catch (e) {
        ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
    }
});

// HANDLE DOCUMENT IMAGE UPLOAD FROM TELEGRAM (e.g. uncompressed images)
bot.on('document', async (ctx) => {
    const mime = ctx.message.document.mime_type || "";
    if (!mime.startsWith('image/')) return; // Ignore non-image documents

    lastModelLogTime = Date.now();
    
    try {
        const fileUniqueId = ctx.message.document.file_unique_id;
        
        // 1. File Uniqueness De-duplication
        if (fileUniqueId) {
            if (processedFiles.has(fileUniqueId)) {
                console.log(`[Document] File already processed: ${fileUniqueId}, skipping.`);
                return;
            }
            processedFiles.add(fileUniqueId);
            setTimeout(() => processedFiles.delete(fileUniqueId), 8000);
        }

        ctx.sendChatAction('upload_photo').catch(() => {});
        
        const fileId = ctx.message.document.file_id;
        const filename = ctx.message.document.file_name || 'upload.jpg';
        const fileUrl = await ctx.telegram.getFileLink(fileId);
        
        const scratchDir = path.join(__dirname, '..', 'scratch');
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }
        const tempPath = path.join(scratchDir, `tg_doc_${Date.now()}_${fileUniqueId || 'file'}_${filename}`);
        
        await downloadTelegramFile(fileUrl.href, tempPath);
        
        const caption = ctx.message.caption || "";
        const mediaGroupId = ctx.message.media_group_id;
        
        // 2. Album / Media Group Aggregation Logic
        if (mediaGroupId) {
            if (!mediaGroupQueues[mediaGroupId]) {
                mediaGroupQueues[mediaGroupId] = {
                    paths: [],
                    captions: [],
                    timer: null
                };
            }
            
            mediaGroupQueues[mediaGroupId].paths.push(tempPath);
            if (caption) {
                mediaGroupQueues[mediaGroupId].captions.push(caption);
            }
            
            if (mediaGroupQueues[mediaGroupId].timer) {
                clearTimeout(mediaGroupQueues[mediaGroupId].timer);
            }
            
            mediaGroupQueues[mediaGroupId].timer = setTimeout(async () => {
                const queue = mediaGroupQueues[mediaGroupId];
                delete mediaGroupQueues[mediaGroupId];
                
                try {
                    ctx.reply(`📸 正在向电脑端 Antigravity 传送 ${queue.paths.length} 张无损图片...`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                    
                    const finalCaption = queue.captions.join("\n");
                    const success = await sendImageViaCDP(queue.paths, finalCaption, CDP_PORT);
                    
                    if (success) {
                        ctx.reply(`✅ 成功传送并提交 ${queue.paths.length} 张无损图片！`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                    } else {
                        ctx.reply("❌ 图片传送失败，请确认 CDP 连接正常并在电脑端重试。", getStatusKeyboard(lastKnownModel)).catch(() => {});
                    }
                } catch (e) {
                    ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
                } finally {
                    setTimeout(() => {
                        queue.paths.forEach(p => {
                            fs.unlink(p, () => {});
                        });
                    }, 5000);
                }
            }, 600);
            return;
        } else {
            // Single document image direct upload
            ctx.reply("📸 正在以无损文件向电脑端 Antigravity 传送图片...", getStatusKeyboard(lastKnownModel)).catch(() => {});
            const success = await sendImageViaCDP(tempPath, caption, CDP_PORT);
            
            if (success) {
                ctx.reply("✅ 无损图片传送并提交成功！", getStatusKeyboard(lastKnownModel)).catch(() => {});
            } else {
                ctx.reply("❌ 图片传送失败，请确认 CDP 连接正常并在电脑端重试。", getStatusKeyboard(lastKnownModel)).catch(() => {});
            }
            
            setTimeout(() => {
                fs.unlink(tempPath, () => {});
            }, 5000);
        }
    } catch (e) {
        ctx.reply(`❌ 执行失败: ${e.message}`, getStatusKeyboard(lastKnownModel)).catch(() => {});
    }
});

// ===== START THE SERVICES =====
bot.launch().catch(err => {
    console.error("❌ Failed to launch Telegram Bot:", err.message);
});

console.log("⚡ Telegram Bot Client successfully launched!");

// 重置并注册 Telegram 的快捷命令行菜单
bot.telegram.setMyCommands([
    { command: 'start', description: '📖 查看操作说明与指南' },
    { command: 'status', description: '📊 检查电脑端连接状态' },
    { command: 'chat', description: '💬 切换或管理活跃会话 (List & Switch Chats)' },
    { command: 'quota', description: '💳 查询 Antigravity 额度/限额与刷新时间' },
    { command: 'plan', description: '📋 获取当前实施方案 (Implementation Plan)' },
    { command: 'task', description: '📝 获取当前任务清单 (Task List)' },
    { command: 'walkthrough', description: '🏁 获取当前工作总结 (Walkthrough)' },
    { command: 'details', description: '💭 控制是否显示中间思考过程' },
    { command: 'terminal', description: '🖥️ 查看/终止后台运行脚本与进程' },
    { command: 'killall', description: '⏹️ 一键强制终止所有活跃的后台终端任务' },
    { command: 'model', description: '🤖 切换 AI 语言模型' },
    { command: 'project', description: '📂 切换当前进行的项目' },
    { command: 'stop', description: '⏹️ 停止电脑端 Agent 生成' },
    { command: 'new', description: '🆕 新建空白会话 (New Chat)' },
    { command: 'screenshot', description: '📸 截取电脑端 Antigravity 界面' },
    { command: 'latest', description: '💬 获取最近一次 AI 完整回复' },
    { command: 'help', description: '💡 查看快速帮助说明' }
]).then(() => {
    console.log("✅ Telegram menu commands successfully reset!");
}).catch(err => {
    console.error("❌ Failed to set Telegram commands:", err.message);
});

// Resolve initial model and project asynchronously at startup
Promise.all([
    getCurrentModelViaCDP(CDP_PORT).catch(() => null),
    getActiveProjectNameViaCDP(CDP_PORT).catch(() => null)
]).then(async ([model, project]) => {
    if (model) {
        lastKnownModel = model;
        console.log(`🤖 Anchored initial model: ${lastKnownModel}`);
    }
    if (project) {
        lastKnownProject = project;
        console.log(`📂 Anchored initial project: ${lastKnownProject}`);
    }
    // Force sync the keyboard and placeholder on startup!
    await globalRefreshInputPlaceholder().catch(() => {});
}).catch(err => {
    console.error('[Startup] Failed to fetch initial state:', err.message);
}).finally(() => {
    startLogsWatcher();
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
