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

        // First: get the active conversation's summary object details
        const res1 = await Runtime.evaluate({
            expression: `
                (() => {
                    function safeStringify(obj) {
                        const seen = new WeakSet();
                        return JSON.stringify(obj, (key, value) => {
                            if (typeof value === 'bigint') return value.toString() + 'n';
                            if (typeof value === 'function') return '[Function: ' + key + ']';
                            if (typeof value === 'object' && value !== null) {
                                if (seen.has(value)) return '[Circular]';
                                seen.add(value);
                            }
                            return value;
                        }, 2);
                    }
                    
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
                        
                        // Get the active conversation
                        const first = conversations[0];
                        if (!first) return "No conversations";
                        
                        const summary = first.summary;
                        
                        // Check if summary has a $typeName (protobuf)
                        const typeName = summary ? summary.$typeName : null;
                        
                        // Check if there's a toJson or toJsonString method
                        const hasToJson = summary && typeof summary.toJson === 'function';
                        const hasToJsonString = summary && typeof summary.toJsonString === 'function';
                        const hasClone = summary && typeof summary.clone === 'function';
                        
                        // Check annotations
                        const annotations = first.summary ? first.summary.annotations : null;
                        let annotationInfo = null;
                        if (annotations) {
                            annotationInfo = {
                                typeName: annotations.$typeName,
                                keys: Object.keys(annotations),
                                hasCustomTitle: annotations.customTitle !== undefined,
                                customTitle: annotations.customTitle,
                                hasUserTitle: annotations.userTitle !== undefined,
                                userTitle: annotations.userTitle
                            };
                        }
                        
                        // Check if updateConversationAnnotations exists and what it expects
                        const updateAnno = typeof ls.updateConversationAnnotations;
                        
                        return safeStringify({
                            cascadeId: first.cascadeId,
                            summaryTypeName: typeName,
                            summaryText: summary ? summary.summary : null,
                            hasToJson,
                            hasToJsonString,
                            hasClone,
                            annotationInfo,
                            updateAnnoType: updateAnno,
                            trajectoryId: summary ? summary.trajectoryId : null
                        });
                    } catch(e) {
                        return "Error: " + e.message + "\\n" + e.stack;
                    }
                })()
            `,
            returnByValue: true
        });

        console.log("CONVERSATION SUMMARY DEEP DIVE:");
        console.log(res1.result.value);

        // Now let's try the actual rename with the current active conversation
        const res2 = await Runtime.evaluate({
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
                        const testTitle = "测试重命名-" + Date.now();
                        
                        // Try jetboxWriteSummary and capture the actual result/error
                        try {
                            const result = await ls.jetboxWriteSummary({
                                summary: {
                                    trajectoryId: tid,
                                    summary: testTitle
                                }
                            });
                            return "jetboxWriteSummary returned: " + JSON.stringify(result, (k,v) => typeof v === 'bigint' ? v.toString()+'n' : v);
                        } catch (e) {
                            return "jetboxWriteSummary error: " + e.message;
                        }
                    } catch(e) {
                        return "Outer error: " + e.message;
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("\nACTUAL RENAME TEST:");
        console.log(res2.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
