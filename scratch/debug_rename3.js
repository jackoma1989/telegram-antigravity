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

        const res1 = await Runtime.evaluate({
            expression: `
                (() => {
                    function safeStringify(obj) {
                        return JSON.stringify(obj, (key, value) => {
                            if (typeof value === 'bigint') return value.toString() + 'n';
                            if (typeof value === 'function') return '[Function]';
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
                        const pmf = provider.projectManagementFeature;
                        const ls = pmf.lsClient;
                        
                        // Get conversations
                        const conversations = provider.standaloneConversations || [];
                        
                        // First conversation: get keys and summary
                        const first = conversations[0];
                        let firstInfo = "none";
                        if (first) {
                            const keys = Object.keys(first);
                            let summaryInfo = {};
                            if (first.summary && typeof first.summary === 'object') {
                                const sk = Object.keys(first.summary);
                                summaryInfo = { keys: sk };
                                for (const k of sk) {
                                    const v = first.summary[k];
                                    if (typeof v === 'bigint') summaryInfo[k] = v.toString() + 'n';
                                    else if (typeof v === 'string') summaryInfo[k] = v.substring(0, 100);
                                    else if (typeof v === 'number') summaryInfo[k] = v;
                                    else if (typeof v === 'boolean') summaryInfo[k] = v;
                                    else if (v === null) summaryInfo[k] = null;
                                    else summaryInfo[k] = typeof v;
                                }
                            } else {
                                summaryInfo = { raw: String(first.summary) };
                            }
                            firstInfo = { keys, summary: summaryInfo, cascadeId: first.cascadeId };
                        }
                        
                        // lsClient methods
                        const lsKeys = Object.keys(ls);
                        const lsProto = Object.getOwnPropertyNames(Object.getPrototypeOf(ls) || {});
                        const allLs = [...new Set([...lsKeys, ...lsProto])];
                        const lsFiltered = allLs.filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('write');
                        });
                        
                        // pmf methods 
                        const pmfKeys = Object.keys(pmf);
                        const pmfProto = Object.getOwnPropertyNames(Object.getPrototypeOf(pmf) || {});
                        const allPmf = [...new Set([...pmfKeys, ...pmfProto])];
                        const pmfFiltered = allPmf.filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('conversation');
                        });
                        
                        return safeStringify({
                            conversationsCount: conversations.length,
                            firstInfo,
                            lsFiltered,
                            pmfFiltered,
                            lsAllKeys: allLs.sort()
                        });
                    } catch(e) {
                        return "Error: " + e.message;
                    }
                })()
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
