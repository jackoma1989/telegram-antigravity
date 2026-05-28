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

        // Step 1: Get conversations and their structure
        const res1 = await Runtime.evaluate({
            expression: `
                JSON.stringify((() => {
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
                        if (!syncedState) return { error: "No syncedState" };
                        
                        const provider = syncedState.sidebarSectionsProvider;
                        const pmf = provider.projectManagementFeature;
                        const ls = pmf.lsClient;
                        
                        // Get conversations
                        const conversations = provider.standaloneConversations || [];
                        
                        // First conversation details
                        const first = conversations[0];
                        let firstDetails = null;
                        if (first) {
                            firstDetails = {
                                keys: Object.keys(first),
                                cascadeId: first.cascadeId,
                                summaryType: typeof first.summary,
                                summaryIsNull: first.summary === null,
                                summaryIsObject: typeof first.summary === 'object' && first.summary !== null
                            };
                            if (first.summary && typeof first.summary === 'object') {
                                firstDetails.summaryKeys = Object.keys(first.summary);
                                firstDetails.summaryObj = {};
                                for (const k of Object.keys(first.summary)) {
                                    const v = first.summary[k];
                                    firstDetails.summaryObj[k] = typeof v === 'object' ? JSON.stringify(v).substring(0, 100) : v;
                                }
                            } else {
                                firstDetails.summaryValue = String(first.summary).substring(0, 200);
                            }
                        }
                        
                        // lsClient methods containing rename/summary/title/write/update
                        const lsAllKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(ls) || {}).concat(Object.keys(ls));
                        const lsFiltered = lsAllKeys.filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('write');
                        });
                        
                        // pmf methods
                        const pmfAllKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(pmf) || {}).concat(Object.keys(pmf));
                        const pmfFiltered = pmfAllKeys.filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('conversation');
                        });
                        
                        return {
                            conversationsCount: conversations.length,
                            firstDetails,
                            lsFiltered,
                            pmfFiltered
                        };
                    } catch(e) {
                        return { error: e.message, stack: e.stack };
                    }
                })())
            `,
            returnByValue: true
        });

        console.log("RESULT:");
        console.log(res1.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
