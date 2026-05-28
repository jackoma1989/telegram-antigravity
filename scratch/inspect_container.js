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

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const btn = document.querySelector('[aria-label=\"Cancel (Ctrl+D)\"]');
                    if (!btn) return "Cancel button not found";

                    const container = btn.parentElement;
                    
                    return JSON.stringify({
                        containerHtml: container.outerHTML,
                        btnStyles: {
                            display: window.getComputedStyle(btn).display,
                            visibility: window.getComputedStyle(btn).visibility,
                            opacity: window.getComputedStyle(btn).opacity,
                            w: btn.clientWidth,
                            h: btn.clientHeight
                        },
                        siblingStyles: Array.from(container.children).map(c => ({
                            tag: c.tagName,
                            html: c.outerHTML.substring(0, 300),
                            display: window.getComputedStyle(c).display,
                            visibility: window.getComputedStyle(c).visibility,
                            opacity: window.getComputedStyle(c).opacity,
                            w: c.clientWidth,
                            h: c.clientHeight
                        }))
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("CONTAINER STYLES DETAILS:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
