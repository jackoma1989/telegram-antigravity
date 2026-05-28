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

        const targetName = "baidu-search"; // Let's try switching to baidu-search!
        console.log(`Attempting to switch project to: ${targetName}`);
        
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
                    if (!syncedState || !syncedState.sidebarSectionsProvider) {
                        return { success: false, reason: "syncedState or sidebarSectionsProvider not found" };
                    }
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const sidebarState = typeof provider.getState === 'function' ? provider.getState() : null;
                    if (!sidebarState || !sidebarState.sidebarSections) {
                        return { success: false, reason: "sidebarSections not found" };
                    }
                    
                    const targetName = ${JSON.stringify(targetName.toLowerCase())};
                    const targetSection = sidebarState.sidebarSections.find(s => 
                        s.label && s.label.toLowerCase() === targetName
                    );
                    if (!targetSection) {
                        return { success: false, reason: "Section not found in sidebar: " + targetName };
                    }
                    
                    const sectionId = targetSection.uri;
                    const conversations = targetSection.conversations || [];
                    if (conversations.length > 0) {
                        const convoId = conversations[0].conversationId;
                        const newUrl = "/c/" + convoId + "?section=" + sectionId;
                        window.location.href = newUrl;
                        return { success: true, method: "navigation", convoId, sectionId };
                    } else {
                        window.location.href = "/c/new?section=" + sectionId;
                        return { success: true, method: "new_chat_navigation", sectionId };
                    }
                })()
            `,
            returnByValue: true
        });

        console.log("Switch Result:", JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error switching project:", e.message);
    }
}

run();
