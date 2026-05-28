const CDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    const logPath = path.join(__dirname, 'approval_poll.log');
    fs.writeFileSync(logPath, '=== POLLING START ===\n', 'utf8');
    console.log("Polling started. Logging to", logPath);

    try {
        const raw = await httpGet(`http://127.0.0.1:${port}/json`);
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            fs.appendFileSync(logPath, "No active targets found.\n");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        // Poll for 20 seconds
        const startTime = Date.now();
        while (Date.now() - startTime < 20000) {
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
                        
                        const approvalButtonTexts = [
                            'yes, allow this time', 'yes, always allow', 'allow running this command',
                            'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
                            'çalıştır', 'kabul et', 'her zaman izin ver', 'izin ver',
                            '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行', '确定', '确认', '同意并运行', '允许运行此命令',
                            'submit', '提交'
                        ];
                        
                        const matchingButtons = allButtons.map(b => {
                            const text = (b.textContent || '').trim().toLowerCase();
                            const rect = b.getBoundingClientRect();
                            return {
                                tagName: b.tagName,
                                text: text,
                                visible: rect.width > 0 && rect.height > 0,
                                disabled: b.disabled,
                                isMatch: approvalButtonTexts.includes(text)
                            };
                        }).filter(b => b.visible && b.text.length > 0);

                        const activeMatch = matchingButtons.find(b => b.isMatch);

                        return {
                            hasMatch: !!activeMatch,
                            activeMatch: activeMatch,
                            allVisibleButtons: matchingButtons
                        };
                    })()
                `,
                returnByValue: true
            });

            const val = res.result?.value;
            fs.appendFileSync(logPath, JSON.stringify({
                time: new Date().toISOString(),
                ...val
            }, null, 2) + '\n---\n');

            await new Promise(r => setTimeout(r, 400));
        }

        await client.close();
        fs.appendFileSync(logPath, '=== POLLING END ===\n');
        console.log("Polling finished.");
    } catch (e) {
        fs.appendFileSync(logPath, `Error: ${e.message}\n`);
        console.error("Error:", e.message);
    }
}

run();
