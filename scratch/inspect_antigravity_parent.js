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
                    const inputWrapper = document.getElementById('antigravity');
                    if (!inputWrapper) return "DIV#antigravity not found";

                    let curr = inputWrapper;
                    let path = [];
                    while (curr) {
                        let desc = curr.tagName;
                        if (curr.id) desc += '#' + curr.id;
                        if (curr.className && typeof curr.className === 'string') {
                            desc += '.' + Array.from(curr.classList).join('.');
                        }
                        path.unshift(desc);
                        curr = curr.parentElement;
                    }

                    // Let's also look at all direct children of the body
                    const bodyChildren = Array.from(document.body.children).map(c => ({
                        tag: c.tagName,
                        id: c.id,
                        className: c.className
                    }));

                    return JSON.stringify({
                        path,
                        bodyChildren
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("PARENT PATH OF DIV#antigravity:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
