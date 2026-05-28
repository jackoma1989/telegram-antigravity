const CDP = require('chrome-remote-interface');
const http = require('http');

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
    try {
        const raw = await httpGet('http://127.0.0.1:9223/json');
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            console.log("No valid candidates found.");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const results = [];
                    const keywords = ['task', 'running', 'kill', 'terminal', 'background'];
                    
                    function checkElement(el) {
                        if (!el || !el.innerText) return;
                        const txt = el.innerText.trim().toLowerCase();
                        if (keywords.some(k => txt.includes(k))) {
                            let childHasMatch = false;
                            for (const child of el.children) {
                                const childTxt = (child.innerText || '').trim().toLowerCase();
                                if (keywords.some(k => childTxt.includes(k))) {
                                    childHasMatch = true;
                                    break;
                                }
                            }
                            if (!childHasMatch && el.innerText.trim()) {
                                results.push({
                                    tag: el.tagName,
                                    class: el.className,
                                    id: el.id,
                                    text: el.innerText.trim().substring(0, 300)
                                });
                            }
                        }
                        
                        for (const child of el.children) {
                            checkElement(child);
                        }
                    }
                    
                    checkElement(document.body);
                    return results;
                })()
            `,
            returnByValue: true
        });

        console.log(JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
