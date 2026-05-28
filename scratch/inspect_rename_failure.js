const OriginalCDP = require('chrome-remote-interface');
const http = require('http');
require('dotenv').config();
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
                    if (!syncedState) return { err: "No syncedState" };
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const ls = provider.projectManagementFeature.lsClient;
                    
                    const conversationId = "29a4e31a-dcbd-4735-be7f-af5a4d59d5e5";
                    const newTitle = "测试重命名-" + Date.now();
                    
                    try {
                        // 1. Write the new summary permanently to the backend
                        await ls.jetboxWriteSummary({
                            summary: {
                                trajectoryId: conversationId,
                                summary: newTitle
                            }
                        });
                        
                        // 2. Update local React state objects directly
                        const targetId = conversationId;
                        const nTitle = newTitle;
                        
                        // Mutate standaloneConversations safely
                        const conversations = provider.standaloneConversations || [];
                        const item = conversations.find(c => 
                            c.cascadeId === targetId || 
                            c.conversationId === targetId || 
                            c.id === targetId ||
                            (c.summary && typeof c.summary === 'object' && c.summary.trajectoryId === targetId)
                        );
                        if (item) {
                            if (item.summary && typeof item.summary === 'object') {
                                item.summary.summary = nTitle;
                            } else {
                                item.summary = nTitle;
                            }
                        }
                        
                        // Mutate latestSummaries safely
                        if (provider.latestSummaries && provider.latestSummaries.summaries) {
                            const pathname = window.location.pathname;
                            const convoIdMatch = pathname.match(/\\/c\\/([a-fA-F0-9-]+)/);
                            const currentConvoId = convoIdMatch ? convoIdMatch[1] : null;

                            let sumObj = provider.latestSummaries.summaries[targetId];
                            if (!sumObj) {
                                for (const k in provider.latestSummaries.summaries) {
                                    const s = provider.latestSummaries.summaries[k];
                                    if (s) {
                                        const isMatch = s.trajectoryId === targetId || 
                                                        k === targetId || 
                                                        (currentConvoId && targetId === currentConvoId && (s.trajectoryId === '' || k === ''));
                                        if (isMatch) {
                                            sumObj = s;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (sumObj) {
                                if (sumObj.summary && typeof sumObj.summary === 'object') {
                                    sumObj.summary.summary = nTitle;
                                } else {
                                    sumObj.summary = nTitle;
                                }
                            }
                        }
                        
                        // Mutate sidebarSections state safely
                        const state = typeof provider.getState === 'function' ? provider.getState() : null;
                        if (state && Array.isArray(state.sidebarSections)) {
                            for (const sec of state.sidebarSections) {
                                if (sec.conversations && Array.isArray(sec.conversations)) {
                                    const cItem = sec.conversations.find(c => 
                                        c.cascadeId === targetId || 
                                        c.conversationId === targetId || 
                                        c.id === targetId ||
                                        (c.summary && typeof c.summary === 'object' && c.summary.trajectoryId === targetId)
                                    );
                                    if (cItem) {
                                        if (cItem.summary && typeof cItem.summary === 'object') {
                                            cItem.summary.summary = nTitle;
                                        } else {
                                            cItem.summary = nTitle;
                                        }
                                    }
                                }
                            }
                        }

                        // Also mutate derivedSections state safely
                        if (Array.isArray(provider.derivedSections)) {
                            for (const sec of provider.derivedSections) {
                                if (sec.conversations && Array.isArray(sec.conversations)) {
                                    const cItem = sec.conversations.find(c => 
                                        c.cascadeId === targetId || 
                                        c.conversationId === targetId || 
                                        c.id === targetId ||
                                        (c.summary && typeof c.summary === 'object' && c.summary.trajectoryId === targetId)
                                    );
                                    if (cItem) {
                                        if (cItem.summary && typeof cItem.summary === 'object') {
                                            cItem.summary.summary = nTitle;
                                        } else {
                                            cItem.summary = nTitle;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 3. Update document title
                        try {
                            if (document.title) {
                                const titleParts = document.title.split(' - ');
                                if (titleParts.length > 0) {
                                    titleParts[0] = nTitle;
                                    document.title = titleParts.join(' - ');
                                }
                            }
                        } catch(e) {}
                        
                        // 4. Force React re-render cleanly
                        if (typeof provider.pushUpdate === 'function') {
                            try { provider.pushUpdate(conversations); } catch(e) {}
                        }
                        
                        const emitterKey = Object.keys(provider).find(k => k.includes('emitter'));
                        if (emitterKey && provider[emitterKey] && typeof provider[emitterKey].fire === 'function') {
                            try { provider[emitterKey].fire(); } catch(e) {}
                        }
                        
                        return { success: true };
                    } catch(e) {
                        return { success: false, errMsg: e.message, errStack: e.stack };
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("DETAILED TRACE:", JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}
run();
