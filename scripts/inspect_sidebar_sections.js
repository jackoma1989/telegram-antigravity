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
                    if (!syncedState || !syncedState.sidebarSectionsProvider) {
                        return { error: "syncedState or sidebarSectionsProvider not found" };
                    }
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const sidebarState = typeof provider.getState === 'function' ? provider.getState() : null;
                    if (!sidebarState || !sidebarState.sidebarSections) {
                        return { error: "sidebarSections not found" };
                    }
                    
                    // Map each section to a simplified object showing all its keys and values
                    return sidebarState.sidebarSections.map(s => {
                        const info = {};
                        for (const k of Object.keys(s)) {
                            if (k === 'conversations') {
                                info.conversationsCount = s.conversations ? s.conversations.length : 0;
                            } else if (typeof s[k] !== 'function' && typeof s[k] !== 'object') {
                                info[k] = s[k];
                            } else if (s[k] && typeof s[k] === 'object') {
                                // Include simplified object info
                                info[k] = Object.keys(s[k]);
                            }
                        }
                        return info;
                    });
                })()
            `,
            returnByValue: true
        });

        console.log("=== Sidebar Sections Structure ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error inspecting sidebar sections:", e.message);
    }
}

run();
