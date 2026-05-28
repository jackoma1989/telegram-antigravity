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
        
        const targetId = '1a9755e7-ff4c-47be-8ae7-77e68fa27de7'; // Current convo ID
        const newTitle = '能够发送 但接收不到你的信息 (最终完美版)';
        
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
                    if (!syncedState) return { error: "No syncedState found" };
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    if (!provider) return { error: "No sidebarSectionsProvider found" };
                    
                    const targetId = ${JSON.stringify(targetId)};
                    const nTitle = ${JSON.stringify(newTitle)};
                    
                    // 1. Resolve real trajectoryId and existing summary cleanly
                    let realTrajectoryId = targetId;
                    let lastModifiedTime = undefined;
                    let existingSummary = null;
                    
                    if (provider.latestSummaries && provider.latestSummaries.summaries && provider.latestSummaries.summaries[targetId]) {
                        existingSummary = provider.latestSummaries.summaries[targetId];
                        if (existingSummary.trajectoryId) realTrajectoryId = existingSummary.trajectoryId;
                        if (existingSummary.lastModifiedTime) lastModifiedTime = existingSummary.lastModifiedTime;
                    }
                    
                    const pm = provider.projectManagementFeature;
                    const ls = pm ? pm.lsClient : null;
                    if (!ls) return { error: "No lsClient found" };
                    
                    try {
                        // 2. Write the new summary permanently to the backend using the correct trajectoryId
                        const writePayload = {
                            cascadeId: targetId,
                            summary: {
                                trajectoryId: realTrajectoryId,
                                summary: nTitle,
                                lastModifiedTime: lastModifiedTime
                            }
                        };
                        await ls.jetboxWriteSummary(writePayload);
                        
                        // 3. Update local React state objects cleanly using IMMUTABLE updates
                        
                        // Update standaloneConversations immutably
                        if (Array.isArray(provider.standaloneConversations)) {
                            provider.standaloneConversations = provider.standaloneConversations.map(c => {
                                const cid = c.conversationId || c.cascadeId || c.id;
                                if (cid === targetId) {
                                    return {
                                        ...c,
                                        summary: (c.summary && typeof c.summary === 'object') 
                                            ? { ...c.summary, summary: nTitle } 
                                            : nTitle
                                    };
                                }
                                return c;
                            });
                        }
                        
                        // Update latestSummaries immutably
                        if (provider.latestSummaries && provider.latestSummaries.summaries) {
                            const s = provider.latestSummaries.summaries[targetId];
                            if (s) {
                                provider.latestSummaries.summaries[targetId] = {
                                    ...s,
                                    summary: nTitle
                                };
                            }
                        }
                        
                        // Update sidebarSections immutably
                        const state = typeof provider.getState === 'function' ? provider.getState() : null;
                        if (state && Array.isArray(state.sidebarSections)) {
                            state.sidebarSections.forEach(sec => {
                                if (Array.isArray(sec.conversations)) {
                                    sec.conversations = sec.conversations.map(c => {
                                        const cid = c.conversationId || c.cascadeId || c.id;
                                        if (cid === targetId) {
                                            return {
                                                ...c,
                                                summary: (c.summary && typeof c.summary === 'object')
                                                    ? { ...c.summary, summary: nTitle }
                                                    : nTitle
                                            };
                                        }
                                        return c;
                                    });
                                }
                            });
                        }
                        
                        // Update derivedSections immutably
                        if (provider.derivedSections) {
                            if (provider.derivedSections instanceof Map) {
                                for (const [key, value] of provider.derivedSections.entries()) {
                                    if (value && Array.isArray(value.conversations)) {
                                        value.conversations = value.conversations.map(c => {
                                            const cid = c.conversationId || c.cascadeId || c.id;
                                            if (cid === targetId) {
                                                return {
                                                    ...c,
                                                    summary: (c.summary && typeof c.summary === 'object')
                                                        ? { ...c.summary, summary: nTitle }
                                                        : nTitle
                                                };
                                            }
                                            return c;
                                        });
                                    }
                                }
                            } else if (Array.isArray(provider.derivedSections)) {
                                provider.derivedSections.forEach(sec => {
                                    if (Array.isArray(sec.conversations)) {
                                        sec.conversations = sec.conversations.map(c => {
                                            const cid = c.conversationId || c.cascadeId || c.id;
                                            if (cid === targetId) {
                                                return {
                                                    ...c,
                                                    summary: (c.summary && typeof c.summary === 'object')
                                                        ? { ...c.summary, summary: nTitle }
                                                        : nTitle
                                                };
                                            }
                                            return c;
                                        });
                                    }
                                });
                            }
                        }
                        
                        // 4. Update document title
                        try {
                            if (document.title) {
                                const titleParts = document.title.split(' - ');
                                if (titleParts.length > 0) {
                                    titleParts[0] = nTitle;
                                    document.title = titleParts.join(' - ');
                                }
                            }
                        } catch(e) {}
                        
                        // 5. Force React re-render cleanly
                        const emitterKey = Object.keys(provider).find(k => k.includes('emitter'));
                        if (emitterKey && provider[emitterKey] && typeof provider[emitterKey].fire === 'function') {
                            provider[emitterKey].fire();
                        }
                        
                        return {
                            success: true,
                            trajectoryId: realTrajectoryId,
                            newSummaryText: nTitle
                        };
                    } catch (e) {
                        return { error: "Update failed: " + e.message };
                    }
                })()
            `,
            awaitPromise: true,
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
