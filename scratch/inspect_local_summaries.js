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
        if (candidates.length === 0) return;

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
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
                    if (!syncedState) return "No syncedState";
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const ls = provider.localSummaries;
                    if (!ls) return "No localSummaries";
                    
                    const keys = Object.keys(ls);
                    if (keys.length === 0) return "localSummaries has 0 keys";
                    
                    const samples = {};
                    keys.slice(0, 3).forEach(k => {
                        const s = ls[k];
                        samples[k] = {
                            keys: Object.keys(s),
                            summaryType: typeof s.summary,
                            summaryVal: s.summary,
                            annotationsType: typeof s.annotations,
                            annotationsKeys: s.annotations ? Object.keys(s.annotations) : null,
                            annotationsVal: s.annotations
                        };
                    });
                    return JSON.stringify({
                        count: keys.length,
                        keys: keys,
                        samples: samples
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("LOCAL SUMMARIES:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
