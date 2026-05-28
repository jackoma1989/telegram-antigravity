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
                    
                    if (!syncedState) return { error: "No syncedState found" };
                    
                    function safeClone(obj, depth = 0) {
                        if (depth > 4) return "[Max Depth]";
                        if (obj === null || obj === undefined) return obj;
                        if (typeof obj === 'function') return "[Function]";
                        if (typeof obj !== 'object') return obj;
                        
                        if (Array.isArray(obj)) {
                            return obj.map(item => safeClone(item, depth + 1));
                        }
                        
                        const clone = {};
                        try {
                            const keys = Object.keys(obj);
                            for (const k of keys) {
                                // Skip large or potentially circular React internals
                                if (k.startsWith('__') || k === '_owner' || k === 'fiber') continue;
                                clone[k] = safeClone(obj[k], depth + 1);
                            }
                        } catch(e) {
                            return "[Error: " + e.message + "]";
                        }
                        return clone;
                    }
                    
                    function getProviderData(prov) {
                        if (!prov) return null;
                        const data = {};
                        
                        // Try typical state getter methods
                        const methods = ['getState', 'getSnapshot', 'getCurrentValue', 'getData'];
                        for (const m of methods) {
                            if (typeof prov[m] === 'function') {
                                try {
                                    const val = prov[m]();
                                    data[m + 'Result'] = safeClone(val);
                                } catch(e) {
                                    data[m + 'Error'] = e.message;
                                }
                            }
                        }
                        
                        // Try typical private state properties
                        const privateProps = ['_store', '_state', '_value', '_data', 'state', 'value'];
                        for (const p of privateProps) {
                            if (prov[p] !== undefined) {
                                data[p + 'Property'] = safeClone(prov[p]);
                            }
                        }
                        
                        // If nothing could be extracted, dump keys
                        data.keys = Object.keys(prov);
                        return data;
                    }
                    
                    return {
                        userStatus: getProviderData(syncedState.userStatusProvider),
                        credits: getProviderData(syncedState.creditsProvider),
                        authState: getProviderData(syncedState.authStateProvider)
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("=== Synced State Providers (Safe) ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting synced state:", e.message);
    }
}

run();
