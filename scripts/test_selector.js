const CDP = require('chrome-remote-interface');
const http = require('http');
const { UI_LOCATORS_SCRIPT } = require('../src/ui_locators');

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

        console.log("Testing on candidate:", candidates[0].title);
        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    ${UI_LOCATORS_SCRIPT}
                    const btn = AG_UI.getNewChatButton();
                    if (!btn) return { found: false };
                    return {
                        found: true,
                        tagName: btn.tagName,
                        text: (btn.innerText || btn.textContent || '').trim().substring(0, 50),
                        className: btn.className || '',
                        ariaLabel: btn.getAttribute('aria-label') || '',
                        outerHTML: btn.outerHTML.substring(0, 300)
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("Evaluation Result:", JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error testing:", e.message);
    }
}

run();

