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
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState) return JSON.stringify({ error: "No syncedState found" });
                    
                    function getProviderData(prov) {
                        if (!prov) return null;
                        const data = {};
                        
                        const methods = ['getState', 'getSnapshot', 'getCurrentValue', 'getData'];
                        for (const m of methods) {
                            if (typeof prov[m] === 'function') {
                                try {
                                    data[m + 'Result'] = prov[m]();
                                } catch(e) {
                                    data[m + 'Error'] = e.message;
                                }
                            }
                        }
                        
                        const privateProps = ['_store', '_state', '_value', '_data', 'state', 'value'];
                        for (const p of privateProps) {
                            if (prov[p] !== undefined) {
                                data[p + 'Property'] = prov[p];
                            }
                        }
                        
                        data.keys = Object.keys(prov);
                        return data;
                    }
                    
                    const result = {
                        userStatus: getProviderData(syncedState.userStatusProvider),
                        credits: getProviderData(syncedState.creditsProvider),
                        authState: getProviderData(syncedState.authStateProvider)
                    };
                    
                    // Circular-safe and BigInt-safe JSON stringifier
                    const cache = new Set();
                    const jsonStr = JSON.stringify(result, (key, value) => {
                        if (typeof value === 'bigint') {
                            return value.toString() + 'n';
                        }
                        if (typeof value === 'object' && value !== null) {
                            if (cache.has(value)) {
                                return '[Circular]';
                            }
                            cache.add(value);
                        }
                        if (typeof value === 'function') {
                            return '[Function: ' + (value.name || 'anonymous') + ']';
                        }
                        return value;
                    }, 2);
                    
                    return jsonStr;
                })()
            `,
            returnByValue: true
        });

        console.log("=== Synced State Providers (BigInt-safe JSON) ===");
        if (res.result && res.result.value) {
            console.log(res.result.value);
        } else {
            console.log("No value returned, details:", res);
        }
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting synced state:", e.message);
    }
}

run();
