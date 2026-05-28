const CDP = require('chrome-remote-interface');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

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
    try {
        const raw = await httpGet(`http://127.0.0.1:${port}/json`);
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') && 
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            !(t.title && t.title.includes('Launchpad')) &&
            t.title !== 'Manager'
        );
        if (candidates.length === 0) {
            console.log("No candidates found!");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

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
                            tagName: b.tagName,
                            outerHTML: b.outerHTML.substring(0, 150),
                            text: b.textContent.trim(),
                            cleanedText: text,
                            visible: rect.width > 0 && rect.height > 0,
                            disabled: b.disabled,
                            inList: inList
                        };
                    });

                    const matches = btnMatches.filter(b => b.inList);
                    const visibleButtons = btnMatches.filter(b => b.visible);

                    return JSON.stringify({
                        url: window.location.href,
                        totalMatches: matches.length,
                        matches,
                        visibleButtonsCount: visibleButtons.length,
                        topVisibleButtons: visibleButtons.slice(-20)
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("=== EXACT MATCH DETAILS ===");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
