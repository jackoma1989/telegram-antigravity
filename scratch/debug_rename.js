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

        // Step 1: Get the full conversation object structure
        const res1 = await Runtime.evaluate({
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
                    if (!syncedState) return "No syncedState";
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const pmf = provider.projectManagementFeature;
                    const ls = pmf.lsClient;
                    
                    // Get all conversations
                    const conversations = provider.standaloneConversations || [];
                    
                    // Get the first conversation's full summary object
                    const firstConv = conversations[0];
                    const convDetails = firstConv ? {
                        keys: Object.keys(firstConv),
                        conversationId: firstConv.conversationId,
                        cascadeId: firstConv.cascadeId,
                        id: firstConv.id,
                        summaryType: typeof firstConv.summary,
                        summaryKeys: firstConv.summary ? Object.keys(firstConv.summary) : null,
                        summary: firstConv.summary,
                        title: firstConv.title
                    } : null;
                    
                    // Check what methods are available on lsClient for rename
                    const lsMethods = Object.keys(ls).filter(k => {
                        const lower = k.toLowerCase();
                        return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('write');
                    });
                    
                    // Check what methods are on projectManagementFeature
                    const pmfMethods = Object.keys(pmf).filter(k => {
                        const lower = k.toLowerCase();
                        return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update') || lower.includes('write') || lower.includes('conversation');
                    });
                    
                    // Also check provider methods
                    const providerMethods = Object.keys(provider).filter(k => {
                        const lower = k.toLowerCase();
                        return lower.includes('rename') || lower.includes('summary') || lower.includes('title') || lower.includes('update');
                    });
                    
                    return JSON.stringify({
                        conversationsCount: conversations.length,
                        firstConvDetails: convDetails,
                        lsRenameMethods: lsMethods,
                        pmfRenameMethods: pmfMethods,
                        providerRenameMethods: providerMethods
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("CONVERSATION & RENAME API STRUCTURE:");
        console.log(res1.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
