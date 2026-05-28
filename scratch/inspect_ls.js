const CDP = require('chrome-remote-interface');

async function resolveTargets(port) {
    const http = require('http');
    return new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    resolve(targets.filter(t => t.webSocketDebuggerUrl));
                } catch (e) {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

async function run() {
    const port = 9223;
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        console.error('No CDP targets found on port', port);
        return;
    }
    
    console.log('Connecting to target:', candidates[0].webSocketDebuggerUrl);
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
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
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    if (!provider) return { error: "No sidebarSectionsProvider found" };
                    
                    const pm = provider.projectManagementFeature;
                    const ls = pm ? pm.lsClient : null;
                    
                    // Inspect conversation object structure
                    const conversations = provider.standaloneConversations || [];
                    let sampleConvo = null;
                    if (conversations[0]) {
                        const keys = Object.keys(conversations[0]);
                        const summaryText = conversations[0].summary && typeof conversations[0].summary === 'object' 
                            ? conversations[0].summary.summary 
                            : String(conversations[0].summary);
                        sampleConvo = {
                            keys,
                            summaryType: typeof conversations[0].summary,
                            summaryText
                        };
                    }

                    // Inspect ls methods
                    const lsKeys = ls ? Object.keys(ls) : [];
                    const protoKeys = ls ? Object.keys(Object.getPrototypeOf(ls)) : [];
                    
                    const sidebarSectionsKeys = [];
                    if (provider.sidebarSections) {
                        provider.sidebarSections.forEach(s => {
                            let firstConvo = null;
                            if (s.conversations && s.conversations[0]) {
                                firstConvo = {
                                    keys: Object.keys(s.conversations[0]),
                                    summaryType: typeof s.conversations[0].summary,
                                    summaryText: s.conversations[0].summary && typeof s.conversations[0].summary === 'object'
                                        ? s.conversations[0].summary.summary
                                        : String(s.conversations[0].summary)
                                };
                            }
                            sidebarSectionsKeys.push({
                                uri: s.uri,
                                label: s.label,
                                conversationsCount: s.conversations ? s.conversations.length : 0,
                                firstConvo
                            });
                        });
                    }

                    // Inspect provider methods to see if there is an explicit rename or write method
                    const providerKeys = Object.keys(provider);
                    const providerProtoKeys = Object.keys(Object.getPrototypeOf(provider));
                    
                    return {
                        hasLs: !!ls,
                        lsKeys,
                        protoKeys,
                        sampleConvo,
                        sidebarSectionsKeys,
                        providerKeys,
                        providerProtoKeys
                    };
                })()
            `,
            returnByValue: true
        });
        
        console.log('Result:', JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error('Error:', e);
        if (client) await client.close();
    }
}

run();
