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

        // Check syncedState fields
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
                    
                    const keys = Object.keys(syncedState);
                    
                    // Check active project
                    let projectInfo = {};
                    if (syncedState.sidebarSectionsProvider) {
                        const provider = syncedState.sidebarSectionsProvider;
                        projectInfo.providerKeys = Object.keys(provider);
                        
                        // Check projectManagementFeature
                        if (provider.projectManagementFeature) {
                            const pmf = provider.projectManagementFeature;
                            projectInfo.pmfKeys = Object.keys(pmf);
                            if (pmf.activeProject) {
                                projectInfo.activeProject = {
                                    keys: Object.keys(pmf.activeProject),
                                    name: pmf.activeProject.name,
                                    label: pmf.activeProject.label,
                                    path: pmf.activeProject.path
                                };
                            }
                        }
                    }
                    
                    return JSON.stringify({
                        keys,
                        projectInfo
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("PROJECT STATE DEEP DIVE:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
