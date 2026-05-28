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

        // Try: write summary AND mutate the local conversation object's summary field
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
                        const newTitle = "重命名测试-OK";
                        
                        // 1. Write to backend
                        await ls.jetboxWriteSummary({
                            summary: {
                                trajectoryId: tid,
                                summary: newTitle
                            }
                        });
                        
                        // 2. Also mutate the local React state object directly
                        const oldTitle = first.summary.summary;
                        first.summary.summary = newTitle;
                        
                        // 3. Try to find and use a state setter to trigger React re-render
                        // Look for a zustand store or setState function
                        let storeFound = false;
                        
                        // Check if provider has a setState, dispatch, or notify method
                        const providerMethods = Object.keys(provider).filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('set') || lower.includes('dispatch') || lower.includes('notify') || 
                                   lower.includes('emit') || lower.includes('update') || lower.includes('refresh') ||
                                   lower.includes('invalidate') || lower.includes('trigger');
                        });
                        
                        // Check if there's a zustand store
                        const hasGetState = typeof provider.getState === 'function';
                        const hasSetState = typeof provider.setState === 'function';
                        const hasSubscribe = typeof provider.subscribe === 'function';
                        
                        // Check the parent syncedState itself
                        const syncedMethods = Object.keys(syncedState).filter(k => {
                            const lower = k.toLowerCase();
                            return lower.includes('set') || lower.includes('dispatch') || lower.includes('notify') || 
                                   lower.includes('emit') || lower.includes('refresh') || lower.includes('invalidate');
                        });
                        
                        // Try to call provider.notifySubscribers or similar if available
                        let refreshResult = "no_refresh_method";
                        for (const method of providerMethods) {
                            if (typeof provider[method] === 'function' && 
                                (method.toLowerCase().includes('notify') || method.toLowerCase().includes('emit') || method.toLowerCase().includes('refresh'))) {
                                try {
                                    provider[method]();
                                    refreshResult = "called: " + method;
                                    break;
                                } catch(e) {
                                    refreshResult = "tried " + method + ": " + e.message;
                                }
                            }
                        }
                        
                        return JSON.stringify({
                            success: true,
                            oldTitle,
                            newTitle,
                            localMutated: first.summary.summary === newTitle,
                            providerMethods,
                            hasGetState,
                            hasSetState,
                            hasSubscribe,
                            syncedMethods,
                            refreshResult
                        }, null, 2);
                    } catch(e) {
                        return "Error: " + e.message;
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("RENAME + REFRESH TEST:");
        console.log(res.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
