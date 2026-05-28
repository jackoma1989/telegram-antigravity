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
                    
                    // Helper to search an object recursively for quota keys
                    const visited = new Set();
                    function searchObj(obj, path = '', depth = 0) {
                        if (depth > 6 || !obj || typeof obj !== 'object' || visited.has(obj)) return;
                        visited.add(obj);
                        
                        try {
                            const keys = Object.keys(obj);
                            for (const k of keys) {
                                const kl = k.toLowerCase();
                                if (kl.includes('quota') || kl.includes('limit') || kl.includes('sprint') || kl.includes('usage') || kl.includes('weekly')) {
                                    results.push({
                                        path: path + '.' + k,
                                        value: String(obj[k]).substring(0, 150),
                                        type: typeof obj[k],
                                        fullValue: typeof obj[k] === 'object' ? obj[k] : undefined
                                    });
                                }
                                if (typeof obj[k] === 'object' && obj[k] !== null) {
                                    searchObj(obj[k], path + '.' + k, depth + 1);
                                }
                            }
                        } catch(e) {}
                    }

                    // 1. Search React Fibers starting from the main root elements
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    roots.forEach((root, idx) => {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            const fiber = root[key];
                            searchObj(fiber, 'ReactRoot' + idx, 0);
                        }
                    });

                    // 2. Try inspecting local state / window globals as well
                    for (const gk of Object.keys(window)) {
                        if (gk.startsWith('__') || gk.includes('store') || gk.includes('state') || gk.includes('ai') || gk.includes('context')) {
                            try {
                                searchObj(window[gk], 'window.' + gk, 0);
                            } catch(e) {}
                        }
                    }
                    
                    return results.slice(0, 50).map(r => ({
                        path: r.path,
                        value: r.value,
                        type: r.type
                    }));
                })()
            `,
            returnByValue: true
        });

        console.log("=== React/Global State Search ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error searching React state:", e.message);
    }
}

run();
