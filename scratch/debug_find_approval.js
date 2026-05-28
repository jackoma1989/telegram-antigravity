const { resolveTargets } = require('../src/cdp_controller');
const CDP = require('chrome-remote-interface');
const http = require('http');
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
    console.log("=== DEBUGGING FIND ACTIVE APPROVAL ===");
    console.log("CDP Port:", port);
    
    try {
        const raw = await httpGet(`http://127.0.0.1:${port}/json`);
        const targets = JSON.parse(raw);
        console.log(`Resolved ${targets.length} total targets from CDP /json:`);
        targets.forEach((t, i) => {
            console.log(`[Target ${i}] Title: "${t.title}", Type: "${t.type}", URL: "${t.url}", DebuggerUrl: "${t.webSocketDebuggerUrl ? 'YES' : 'NO'}"`);
        });

        const candidates = await resolveTargets(port);
        console.log(`\nFiltered ${candidates.length} candidate page/webview targets:`);
        candidates.forEach((t, i) => {
            console.log(`[Candidate ${i}] Title: "${t.title}", URL: "${t.url}"`);
        });

        if (candidates.length === 0) {
            console.log("❌ ERROR: No candidate page targets found!");
            return;
        }

        for (let i = 0; i < candidates.length; i++) {
            const target = candidates[i];
            console.log(`\nTesting Candidate ${i}: "${target.title}"...`);
            let client;
            try {
                client = await CDP({ target: target.webSocketDebuggerUrl });
                console.log("  Successfully connected via CDP!");
                
                const { Runtime } = client;
                await Runtime.enable();
                console.log("  Enabled Runtime domain!");
                
                const res = await Runtime.evaluate({
                    expression: `
                        (() => {
                            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
                            const approvalButtonTexts = [
                                'yes, allow this time', 'yes, always allow', 'allow running this command',
                                'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
                                'çalıştır', 'kabul et', 'her zaman izin ver', 'izin ver',
                                '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行', '确定', '确认', '同意并运行', '允许运行此命令',
                                'submit', '提交', '仅允许此次', '始终允许', '允许此次', '仅这一次'
                            ];
                            
                            const btnMatches = allButtons.map(b => {
                                const text = (b.textContent || '').replace(/[↵\\n\\r\\t]/g, '').trim().toLowerCase();
                                const rect = b.getBoundingClientRect();
                                const inList = approvalButtonTexts.includes(text);
                                return {
                                    text: b.textContent.trim().replace(/\\s+/g, ' '),
                                    cleanedText: text,
                                    width: rect.width,
                                    height: rect.height,
                                    visible: rect.width > 0 && rect.height > 0,
                                    disabled: b.disabled,
                                    inList: inList
                                };
                            }).filter(b => b.visible);

                            return {
                                totalVisible: btnMatches.length,
                                matches: btnMatches.filter(b => b.inList),
                                allButtons: btnMatches
                            };
                        })()
                    `,
                    returnByValue: true
                });

                console.log("  Evaluation completed successfully!");
                console.log("  Results:", JSON.stringify(res.result?.value, null, 2));
                await client.close();
            } catch (err) {
                console.error(`  ❌ CDP TEST FAILED for "${target.title}":`, err.stack || err.message);
                if (client) {
                    try { await client.close(); } catch(_) {}
                }
            }
        }

    } catch (e) {
        console.error("❌ Debugger script failed:", e.stack || e.message);
    }
}

run();
