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
        const newTitle = '能够发送 但接收不到你的信息 (已验证2)';
        
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
                    
                    // 1. Resolve real trajectoryId
                    let realTrajectoryId = targetId;
                    if (provider.latestSummaries && provider.latestSummaries.summaries && provider.latestSummaries.summaries[targetId]) {
                        const s = provider.latestSummaries.summaries[targetId];
                        if (s.trajectoryId) realTrajectoryId = s.trajectoryId;
                    }
                    
                    const pm = provider.projectManagementFeature;
                    const ls = pm ? pm.lsClient : null;
                    if (!ls) return { error: "No lsClient found" };
                    
                    try {
                        // Generate a fresh, current timestamp for protobuf lastModifiedTime
                        const nowSeconds = Math.floor(Date.now() / 1000);
                        const nowNanos = (Date.now() % 1000) * 1000000;
                        
                        const writePayload = {
                            cascadeId: targetId,
                            summary: {
                                trajectoryId: realTrajectoryId,
                                summary: nTitle,
                                lastModifiedTime: {
                                    seconds: nowSeconds,
                                    nanos: nowNanos
                                }
                            }
                        };
                        
                        await ls.jetboxWriteSummary(writePayload);
                        
                        return {
                            success: true,
                            trajectoryId: realTrajectoryId,
                            timestamp: { seconds: nowSeconds, nanos: nowNanos }
                        };
                    } catch (e) {
                        return { error: "jetboxWriteSummary failed: " + e.message };
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
