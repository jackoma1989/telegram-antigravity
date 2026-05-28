const CDP = require('chrome-remote-interface');
const http = require('http');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    try {
        const raw = await httpGet('http://127.0.0.1:9223/json');
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            console.log("No valid candidates found.");
            return;
        }

        console.log("Connected to target:", candidates[0].title, "Url:", candidates[0].url);

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    let fiberKey = null;
                    let rootFound = null;
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            fiberKey = key;
                            rootFound = root.id || root.className || root.tagName;
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
                    
                    if (!syncedState) {
                        return { error: "syncedState not found in React tree", fiberKey, rootFound };
                    }
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    if (!provider) {
                        return { error: "sidebarSectionsProvider not found on syncedState", keys: Object.keys(syncedState) };
                    }
                    
                    const pathname = window.location.pathname;
                    const convoIdMatch = pathname.match(/\\/c\\/([a-fA-F0-9-]+)/);
                    const currentConvoId = convoIdMatch ? convoIdMatch[1] : null;

                    const urlParams = new URLSearchParams(window.location.search);
                    const currentSectionId = urlParams.get('section');
                    
                    const state = typeof provider.getState === 'function' ? provider.getState() : null;
                    const sections = (state && Array.isArray(state.sidebarSections)) ? state.sidebarSections : (Array.isArray(provider.derivedSections) ? provider.derivedSections : []);
                    
                    const sectionsSummary = sections.map(s => ({
                        uri: s.uri,
                        label: s.label,
                        conversationsCount: s.conversations ? s.conversations.length : 0,
                        conversationsKeys: s.conversations && s.conversations[0] ? Object.keys(s.conversations[0]) : []
                    }));

                    const firstSectionConvos = sections[0] && sections[0].conversations ? sections[0].conversations : [];
                    
                    return {
                        pathname,
                        currentConvoId,
                        currentSectionId,
                        hasState: !!state,
                        sectionsCount: sections.length,
                        firstSectionConvos,
                        standaloneCount: provider.standaloneConversations ? provider.standaloneConversations.length : 0
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("=== Debugging Result ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
