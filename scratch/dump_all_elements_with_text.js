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
                    const allEls = Array.from(document.querySelectorAll('*'));
                    const matches = [];
                    allEls.forEach(el => {
                        const text = (el.textContent || '').trim().toLowerCase();
                        if (text.includes('submit') || text.includes('提交') || text.includes('allow this time') || text.includes('允许此')) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                matches.push({
                                    tag: el.tagName,
                                    id: el.id,
                                    className: el.className,
                                    role: el.getAttribute('role'),
                                    text: el.textContent.trim().substring(0, 100),
                                    outerHTML: el.outerHTML.substring(0, 200),
                                    childrenCount: el.children.length
                                });
                            }
                        }
                    });
                    return JSON.stringify(matches.slice(-40), null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("=== ELEMENTS CONTAINING 'SUBMIT' OR 'ALLOW' ===");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
