const CDP = require('chrome-remote-interface');
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

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (async () => {
                    try {
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
                        if (!syncedState) return "No syncedState";
                        
                        const provider = syncedState.sidebarSectionsProvider;
                        const ls = provider.projectManagementFeature.lsClient;
                        const conversations = provider.standaloneConversations || [];
                        const first = conversations[0];
                        if (!first || !first.summary) return "No conversation or no summary";
                        
                        const tid = first.summary.trajectoryId;
                        const newTitle = "TeleGravity 重命名成功";
                        
                        // 1. Write to backend
                        await ls.jetboxWriteSummary({
                            summary: {
                                trajectoryId: tid,
                                summary: newTitle
                            }
                        });
                        
                        // 2. Mutate local state
                        first.summary.summary = newTitle;
                        
                        // 3. Explore pushUpdate and emitter
                        const pushUpdateType = typeof provider.pushUpdate;
                        const emitterKey = Object.keys(provider).find(k => k.includes('emitter'));
                        let emitterInfo = null;
                        if (emitterKey) {
                            const emitter = provider[emitterKey];
                            emitterInfo = {
                                type: typeof emitter,
                                keys: emitter ? Object.keys(emitter) : [],
                                protoKeys: emitter ? Object.getOwnPropertyNames(Object.getPrototypeOf(emitter) || {}) : []
                            };
                        }
                        
                        // 4. Try pushUpdate
                        let pushResult = "not called";
                        if (typeof provider.pushUpdate === 'function') {
                            try {
                                // Try with the conversations array
                                provider.pushUpdate(conversations);
                                pushResult = "pushUpdate(conversations) - success";
                            } catch(e) {
                                pushResult = "pushUpdate error: " + e.message;
                                // Try no args
                                try {
                                    provider.pushUpdate();
                                    pushResult += " | pushUpdate() - success";
                                } catch(e2) {
                                    pushResult += " | pushUpdate() error: " + e2.message;
                                }
                            }
                        }
                        
                        // 5. Try using the emitter to fire an event
                        let emitResult = "not tried";
                        if (emitterKey && provider[emitterKey]) {
                            const emitter = provider[emitterKey];
                            if (typeof emitter.fire === 'function') {
                                try {
                                    emitter.fire();
                                    emitResult = "emitter.fire() - success";
                                } catch(e) {
                                    emitResult = "emitter.fire() error: " + e.message;
                                }
                            } else if (typeof emitter.emit === 'function') {
                                try {
                                    emitter.emit();
                                    emitResult = "emitter.emit() - success";
                                } catch(e) {
                                    emitResult = "emitter.emit() error: " + e.message;
                                }
                            } else {
                                emitResult = "no fire/emit method. Proto: " + Object.getOwnPropertyNames(Object.getPrototypeOf(emitter) || {}).join(', ');
                            }
                        }
                        
                        // 6. Also check getState()
                        let stateInfo = null;
                        if (typeof provider.getState === 'function') {
                            const state = provider.getState();
                            stateInfo = {
                                type: typeof state,
                                keys: state ? Object.keys(state).slice(0, 20) : []
                            };
                        }
                        
                        return JSON.stringify({
                            newTitle,
                            pushUpdateType,
                            pushResult,
                            emitterKey,
                            emitterInfo,
                            emitResult,
                            stateInfo
                        }, null, 2);
                    } catch(e) {
                        return "Error: " + e.message;
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("RENAME + PUSH UPDATE TEST:");
        console.log(res.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
