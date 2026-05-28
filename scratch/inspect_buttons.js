const CDP = require('chrome-remote-interface');
const http = require('http');
require('dotenv').config();

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

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
        const raw = await httpGet(`http://127.0.0.1:${port}/json`);
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            console.log("No targets found!");
            return;
        }

        console.log(`Found ${candidates.length} targets. Inspecting: ${candidates[0].title}`);
        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a, div.cursor-pointer'));
                    return allButtons
                        .map(b => {
                            const rect = b.getBoundingClientRect();
                            return {
                                tagName: b.tagName,
                                text: (b.textContent || '').trim().replace(/\\s+/g, ' '),
                                className: b.className,
                                width: rect.width,
                                height: rect.height,
                                visible: rect.width > 0 && rect.height > 0
                            };
                        })
                        .filter(b => b.text.length > 0 && b.visible);
                })()
            `,
            returnByValue: true
        });

        console.log("TEXT BUTTONS FOUND:");
        console.log(JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
