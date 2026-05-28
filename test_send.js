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
            console.log("No active pages found.");
            return;
        }

        console.log("Connecting to target:", candidates[0].title);
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

                    // Locate editor elements
                    const textareas = Array.from(document.querySelectorAll('textarea'));
                    const contenteditables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
                    
                    const editorInfos = [];
                    textareas.forEach(el => {
                        editorInfos.push({
                            type: 'textarea',
                            id: el.id,
                            className: el.className,
                            placeholder: el.placeholder,
                            visible: el.offsetParent !== null,
                            value: el.value
                        });
                    });
                    contenteditables.forEach(el => {
                        editorInfos.push({
                            type: 'contenteditable',
                            id: el.id,
                            className: el.className,
                            placeholder: el.getAttribute('placeholder'),
                            visible: el.offsetParent !== null,
                            text: el.textContent
                        });
                    });

                    // Check submit buttons
                    const submitButtons = Array.from(document.querySelectorAll('button')).map(btn => {
                        const svg = btn.querySelector('svg');
                        return {
                            text: btn.textContent.trim(),
                            className: btn.className,
                            disabled: btn.disabled,
                            svgClass: svg ? svg.className.baseVal : null,
                            visible: btn.offsetParent !== null
                        };
                    }).filter(b => b.visible);

                    return {
                        hasSyncedState: !!syncedState,
                        editors: editorInfos
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("DOM INFO RESULT:");
        console.log(JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
