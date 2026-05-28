const CDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);
const logPath = path.join(__dirname, 'approval_elements.log');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', err => reject(err));
    });
}

async function run() {
    fs.writeFileSync(logPath, '=== START POLLING ===\n', 'utf8');
    console.log("Polling elements... Logging to", logPath);

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
            fs.appendFileSync(logPath, "No candidates found.\n");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const startTime = Date.now();
        // Poll for 20 seconds
        while (Date.now() - startTime < 20000) {
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const allEls = Array.from(document.querySelectorAll('*'));
                        const matches = [];
                        allEls.forEach(el => {
                            const text = (el.textContent || '').trim().toLowerCase();
                            // Look for elements with exact matching keywords
                            const exactKeywords = [
                                'yes, allow this time', 'yes, always allow', 'allow running this command',
                                'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
                                '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行', '确定', '确认', '同意并运行', '允许运行此命令',
                                'submit', '提交', '仅允许此次', '始终允许', '允许此次', '仅这一次'
                            ];
                            
                            const cleanedText = text.replace(/[↵\\n\\r\\t]/g, '').trim().toLowerCase();
                            const isExactKeyword = exactKeywords.includes(cleanedText);
                            const hasSubmitClass = el.className && typeof el.className === 'string' && (el.className.includes('submit') || el.className.includes('btn') || el.className.includes('button'));
                            
                            if (isExactKeyword || cleanedText === 'submit' || cleanedText === '提交') {
                                const rect = el.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    matches.push({
                                        tagName: el.tagName,
                                        className: el.className,
                                        id: el.id,
                                        role: el.getAttribute('role'),
                                        text: el.textContent.trim().substring(0, 100),
                                        outerHTML: el.outerHTML.substring(0, 300),
                                        width: rect.width,
                                        height: rect.height
                                    });
                                }
                            }
                        });
                        return JSON.stringify(matches, null, 2);
                    })()
                `,
                returnByValue: true
            });

            const val = res.result?.value;
            if (val && JSON.parse(val).length > 0) {
                fs.appendFileSync(logPath, `[${new Date().toISOString()}] Found elements:\n${val}\n---\n`);
            }
            await new Promise(r => setTimeout(r, 400));
        }

        await client.close();
        fs.appendFileSync(logPath, '=== END POLLING ===\n');
        console.log("Polling ended successfully.");
    } catch (e) {
        fs.appendFileSync(logPath, `Error: ${e.message}\n`);
    }
}

run();
