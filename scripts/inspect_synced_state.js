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
                    
                    if (!syncedState) return "No syncedState found";
                    
                    const info = {};
                    
                    function dumpProvider(prov, name) {
                        if (!prov) return { error: name + " not found" };
                        const details = {
                            keys: Object.keys(prov),
                            constructor: prov.constructor?.name
                        };
                        
                        // Try typical state getter methods
                        const methods = ['getState', 'getSnapshot', 'getCurrentValue', 'value', 'state', 'get', 'getData'];
                        methods.forEach(m => {
                            if (typeof prov[m] === 'function') {
                                try {
                                    const val = prov[m]();
                                    details[m + 'Result'] = val;
                                } catch(e) {
                                    details[m + 'Error'] = e.message;
                                }
                            } else if (prov[m] !== undefined) {
                                details[m + 'Property'] = prov[m];
                            }
                        });
                        
                        // If it has a private store/state
                        ['_store', '_state', '_value', '_data'].forEach(p => {
                            if (prov[p] !== undefined) {
                                details[p + 'Property'] = prov[p];
                            }
                        });
                        
                        return details;
                    }
                    
                    info.userStatusProvider = dumpProvider(syncedState.userStatusProvider, 'userStatusProvider');
                    info.creditsProvider = dumpProvider(syncedState.creditsProvider, 'creditsProvider');
                    info.authStateProvider = dumpProvider(syncedState.authStateProvider, 'authStateProvider');
                    
                    return info;
                })()
            `,
            returnByValue: true
        });

        console.log("=== Synced State Providers ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting synced state:", e.message);
    }
}

run();
