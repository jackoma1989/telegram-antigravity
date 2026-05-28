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
                    if (!syncedState) return { err: "No syncedState" };
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const targetId = "1a9755e7-ff4c-47be-8ae7-77e68fa27de7";
                    
                    let summaryInLatest = null;
                    if (provider.latestSummaries && provider.latestSummaries.summaries) {
                        summaryInLatest = provider.latestSummaries.summaries[targetId];
                    }
                    
                    let foundInConversations = null;
                    const conversations = provider.standaloneConversations || [];
                    const item = conversations.find(c => (c.conversationId || c.cascadeId || c.id) === targetId);
                    if (item) {
                        foundInConversations = {
                            keys: Object.keys(item),
                            summaryType: typeof item.summary,
                            summaryKeys: item.summary ? Object.keys(item.summary) : null,
                            summaryTrajectoryId: item.summary ? item.summary.trajectoryId : null,
                            summarySummary: item.summary ? item.summary.summary : null
                        };
                    }
                    
                    const state = typeof provider.getState === 'function' ? provider.getState() : null;
                    const sections = (state && Array.isArray(state.sidebarSections)) ? state.sidebarSections : (Array.isArray(provider.derivedSections) ? provider.derivedSections : []);
                    
                    let foundInSection = null;
                    for (const sec of sections) {
                        if (sec.conversations && Array.isArray(sec.conversations)) {
                            const cItem = sec.conversations.find(c => (c.conversationId || c.cascadeId || c.id) === targetId);
                            if (cItem) {
                                foundInSection = {
                                    sectionUri: sec.uri,
                                    sectionLabel: sec.label,
                                    summaryType: typeof cItem.summary,
                                    summaryKeys: cItem.summary ? Object.keys(cItem.summary) : null,
                                    summaryTrajectoryId: cItem.summary ? cItem.summary.trajectoryId : null,
                                    summarySummary: cItem.summary ? cItem.summary.summary : null
                                };
                                break;
                            }
                        }
                    }
                    
                    return {
                        summaryInLatest: summaryInLatest ? {
                            keys: Object.keys(summaryInLatest),
                            trajectoryId: summaryInLatest.trajectoryId,
                            summary: summaryInLatest.summary
                        } : null,
                        foundInConversations,
                        foundInSection
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("INSPECT TARGET CONVO:", JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}
run();
