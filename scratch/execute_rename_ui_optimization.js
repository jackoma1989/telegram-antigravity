const OriginalCDP = require('chrome-remote-interface');
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

        const client = await OriginalCDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (async () => {
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
                    if (!syncedState) return { success: false, reason: "No syncedState" };
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const ls = provider.projectManagementFeature.lsClient;
                    
                    const targetId = "29a4e31a-dcbd-4735-be7f-af5a4d59d5e5";
                    const nTitle = "UI 优化";
                    
                    try {
                        // 1. Write the new summary permanently to the backend
                        await ls.jetboxWriteSummary({
                            cascadeId: targetId,
                            summary: {
                                trajectoryId: targetId,
                                summary: nTitle
                            }
                        });
                        
                        // 2. Mutate standaloneConversations safely
                        const conversations = provider.standaloneConversations || [];
                        conversations.forEach(c => {
                            const cid = c.conversationId || c.cascadeId || c.id || (c.summary && c.summary.trajectoryId);
                            if (cid === targetId) {
                                if (c.summary && typeof c.summary === 'object') {
                                    c.summary.summary = nTitle;
                                } else {
                                    c.summary = nTitle;
                                }
                            }
                        });
                        
                        // 3. Mutate latestSummaries safely
                        if (provider.latestSummaries && provider.latestSummaries.summaries) {
                            for (const k in provider.latestSummaries.summaries) {
                                const s = provider.latestSummaries.summaries[k];
                                if (s && (s.trajectoryId === targetId || k === targetId)) {
                                    if (s.summary && typeof s.summary === 'object') {
                                        s.summary.summary = nTitle;
                                    } else {
                                        s.summary = nTitle;
                                    }
                                }
                            }
                        }
                        
                        // 4. Mutate sidebarSections state safely
                        const state = typeof provider.getState === 'function' ? provider.getState() : null;
                        if (state && Array.isArray(state.sidebarSections)) {
                            state.sidebarSections.forEach(sec => {
                                if (Array.isArray(sec.conversations)) {
                                    sec.conversations.forEach(c => {
                                        const cid = c.conversationId || c.cascadeId || c.id || (c.summary && c.summary.trajectoryId);
                                        if (cid === targetId) {
                                            if (c.summary && typeof c.summary === 'object') {
                                                c.summary.summary = nTitle;
                                            } else {
                                                c.summary = nTitle;
                                            }
                                        }
                                    });
                                }
                            });
                        }

                        // 5. Mutate derivedSections Map/Array safely
                        if (provider.derivedSections) {
                            if (provider.derivedSections instanceof Map) {
                                for (const [key, value] of provider.derivedSections.entries()) {
                                    if (value && Array.isArray(value.conversations)) {
                                        value.conversations.forEach(c => {
                                            const cid = c.conversationId || c.cascadeId || c.id || (c.summary && c.summary.trajectoryId);
                                            if (cid === targetId) {
                                                if (c.summary && typeof c.summary === 'object') {
                                                    c.summary.summary = nTitle;
                                                } else {
                                                    c.summary = nTitle;
                                                }
                                            }
                                        });
                                    }
                                }
                            } else if (Array.isArray(provider.derivedSections)) {
                                provider.derivedSections.forEach(sec => {
                                    if (Array.isArray(sec.conversations)) {
                                        sec.conversations.forEach(c => {
                                            const cid = c.conversationId || c.cascadeId || c.id || (c.summary && c.summary.trajectoryId);
                                            if (cid === targetId) {
                                                if (c.summary && typeof c.summary === 'object') {
                                                    c.summary.summary = nTitle;
                                                } else {
                                                    c.summary = nTitle;
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                        }
                        
                        // 6. Update document title
                        try {
                            if (document.title) {
                                const titleParts = document.title.split(' - ');
                                if (titleParts.length > 0) {
                                    titleParts[0] = nTitle;
                                    document.title = titleParts.join(' - ');
                                }
                            }
                        } catch(e) {}
                        
                        // 7. Force React re-render cleanly
                        const emitterKey = Object.keys(provider).find(k => k.includes('emitter'));
                        if (emitterKey && provider[emitterKey] && typeof provider[emitterKey].fire === 'function') {
                            provider[emitterKey].fire();
                        }
                        
                        return { success: true };
                    } catch(e) {
                        return { success: false, error: e.message };
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("EXECUTE RENAME RESULT:", JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
