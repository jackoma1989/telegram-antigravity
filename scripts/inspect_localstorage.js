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
                    const info = {};
                    
                    // 1. Inspect window.ai
                    if (window.ai) {
                        info.windowAI = {
                            keys: Object.keys(window.ai),
                            toString: window.ai.toString(),
                            type: typeof window.ai
                        };
                        try {
                            for (const k of Object.keys(window.ai)) {
                                info.windowAI[k] = {
                                    type: typeof window.ai[k],
                                    value: String(window.ai[k])
                                };
                            }
                        } catch(e) {}
                    }
                    
                    // 2. LocalStorage keys
                    info.localStorage = {};
                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            info.localStorage[k] = localStorage.getItem(k);
                        }
                    } catch(e) {}
                    
                    return info;
                })()
            `,
            returnByValue: true
        });

        console.log("=== WINDOW.AI ===");
        console.log(JSON.stringify(res.result?.value?.windowAI, null, 2));
        
        console.log("\n=== LOCAL STORAGE ===");
        console.log(JSON.stringify(res.result?.value?.localStorage, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
