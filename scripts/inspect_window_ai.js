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

        console.log(`Connecting to candidate: ${candidates[0].title}`);
        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const info = {};
                    
                    // 1. Inspect window.ai
                    if (window.ai) {
                        info.windowAI = {
                            keys: Object.keys(window.ai),
                            toString: window.ai.toString(),
                            type: typeof window.ai
                        };
                        try {
                            // Try calling some standard window.ai functions if any
                            for (const k of Object.keys(window.ai)) {
                                info.windowAI[k] = typeof window.ai[k];
                            }
                        } catch(e) {}
                    }
                    
                    // 2. Dump entire LocalStorage
                    info.localStorage = {};
                    try {
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            info.localStorage[k] = localStorage.getItem(k);
                        }
                    } catch(e) {}

                    // 3. Dump SessionStorage
                    info.sessionStorage = {};
                    try {
                        for (let i = 0; i < sessionStorage.length; i++) {
                            const k = sessionStorage.key(i);
                            info.sessionStorage[k] = sessionStorage.getItem(k);
                        }
                    } catch(e) {}
                    
                    // 4. Find anything that looks like an avatar, settings menu, or user profile button and click it to reveal quota, or inspect its text.
                    // Let's find all buttons/elements in the sidebar or header and dump their text
                    const elements = [];
                    // Look for divs or buttons with text or tooltips
                    const candidateSelectors = [
                        'button', 
                        '[role="button"]', 
                        '[class*="profile"]', 
                        '[class*="user"]', 
                        '[class*="avatar"]',
                        '[class*="settings"]',
                        '[class*="quota"]',
                        '.sidebar button',
                        'header button'
                    ];
                    
                    document.querySelectorAll(candidateSelectors.join(', ')).forEach(el => {
                        const txt = (el.innerText || el.textContent || '').trim();
                        elements.push({
                            tag: el.tagName,
                            class: el.className,
                            id: el.id,
                            text: txt.substring(0, 100),
                            title: el.getAttribute('title'),
                            ariaLabel: el.getAttribute('aria-label'),
                            tooltip: el.getAttribute('data-tooltip-id')
                        });
                    });
                    
                    info.interactiveElements = elements;
                    
                    return info;
                })()
            `,
            returnByValue: true
        });

        console.log("=== WINDOW.AI INFO ===");
        console.log(JSON.stringify(res.result?.value?.windowAI, null, 2));
        
        console.log("\n=== LOCAL STORAGE ===");
        console.log(JSON.stringify(res.result?.value?.localStorage, null, 2));

        console.log("\n=== INTERACTIVE ELEMENTS ===");
        console.log(JSON.stringify(res.result?.value?.interactiveElements, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
