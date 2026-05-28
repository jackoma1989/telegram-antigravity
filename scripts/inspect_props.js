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
                    let pendingProps = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            // Traverse down some steps to find a fiber with pendingProps
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps) {
                                    pendingProps = current.pendingProps;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (pendingProps) break;
                        }
                    }
                    
                    if (!pendingProps) return "No pendingProps found";
                    
                    // Carefully extract properties without circular reference crash
                    const cleanProps = {};
                    for (const k of Object.keys(pendingProps)) {
                        const val = pendingProps[k];
                        if (val === null || val === undefined) {
                            cleanProps[k] = val;
                        } else if (typeof val === 'function') {
                            cleanProps[k] = '[Function: ' + val.name + ']';
                        } else if (typeof val === 'object') {
                            // If it's a simple object or array, extract some keys
                            const childKeys = Object.keys(val);
                            cleanProps[k] = {
                                _type: val.constructor?.name || 'Object',
                                keys: childKeys.slice(0, 30),
                                sample: childKeys.length > 0 ? String(val[childKeys[0]]).substring(0, 100) : ''
                            };
                            
                            // Check if it's user or client or query manager
                            if (k === 'featureManager' || k === 'user' || k === 'client' || k === 'config') {
                                const subObj = {};
                                childKeys.forEach(sk => {
                                    if (typeof val[sk] !== 'object' && typeof val[sk] !== 'function') {
                                        subObj[sk] = val[sk];
                                    } else {
                                        subObj[sk] = typeof val[sk];
                                    }
                                });
                                cleanProps[k]._details = subObj;
                            }
                        } else {
                            cleanProps[k] = val;
                        }
                    }
                    
                    return cleanProps;
                })()
            `,
            returnByValue: true
        });

        console.log("=== React Root Component Props ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting props:", e.message);
    }
}

run();
