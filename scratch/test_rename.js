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
                    const conversations = provider.standaloneConversations || [];
                    if (conversations.length === 0) {
                        return { success: false, reason: "No conversations found" };
                    }
                    
                    const conv = conversations[0];
                    const conversationId = conv.conversationId || conv.cascadeId || conv.id || (conv.summary && conv.summary.trajectoryId);
                    const oldSummaryText = (conv.summary && typeof conv.summary === 'object') ? conv.summary.summary : (conv.summary || "Untitled");
                    const newSummaryText = oldSummaryText + " (Test)";
                    
                    const ls = provider.projectManagementFeature.lsClient;
                    
                    // Format A: { summary: { trajectoryId, summary } }
                    try {
                        console.log("Trying Format A...");
                        const resA = await ls.jetboxWriteSummary({
                            summary: {
                                trajectoryId: conversationId,
                                summary: newSummaryText
                            }
                        });
                        return { success: true, format: "Format A", result: resA };
                    } catch (eA) {
                        console.log("Format A failed:", eA.message);
                        
                        // Format B: Pass modified conv.summary object directly
                        try {
                            console.log("Trying Format B...");
                            // Clone or use the original
                            const clone = Object.assign({}, conv.summary);
                            clone.summary = newSummaryText;
                            
                            const resB = await ls.jetboxWriteSummary(clone);
                            return { success: true, format: "Format B", result: resB };
                        } catch (eB) {
                            console.log("Format B failed:", eB.message);
                            
                            // Format C: { summary: modified conv.summary object }
                            try {
                                console.log("Trying Format C...");
                                const clone = Object.assign({}, conv.summary);
                                clone.summary = newSummaryText;
                                
                                const resC = await ls.jetboxWriteSummary({
                                    summary: clone
                                });
                                return { success: true, format: "Format C", result: resC };
                            } catch (eC) {
                                return {
                                    success: false,
                                    eA: eA.message,
                                    eB: eB.message,
                                    eC: eC.message
                                };
                            }
                        }
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("RENAME TEST RESULT:", JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
