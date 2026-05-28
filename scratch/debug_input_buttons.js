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
                    const inputArea = document.querySelector('.chat-input, .interactive-input-editor, [class*=\"input-editor\"], [class*=\"chat-input\"]');
                    if (!inputArea) return "No input area found";
                    
                    const buttons = Array.from(inputArea.querySelectorAll('button'));
                    const btnDetails = buttons.map(b => {
                        const isVisible = b.offsetParent !== null;
                        const w = b.clientWidth;
                        const h = b.clientHeight;
                        return {
                            ariaLabel: b.getAttribute('aria-label'),
                            title: b.getAttribute('title'),
                            id: b.getAttribute('id'),
                            className: b.className,
                            isVisible,
                            dimensions: \`\${w}x\${h}\`,
                            text: b.textContent.trim(),
                            html: b.outerHTML
                        };
                    });

                    return JSON.stringify({
                        inputAreaHtml: inputArea.outerHTML,
                        buttonsCount: buttons.length,
                        buttons: btnDetails
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("INPUT AREA DETAILS:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
