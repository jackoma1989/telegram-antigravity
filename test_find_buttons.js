const OriginalCDP = require('chrome-remote-interface');
const http = require('http');

function httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', err => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('HTTP request timed out'));
        });
    });
}

async function run() {
    try {
        const raw = await httpGet(`http://127.0.0.1:9223/json`);
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            console.log("No targets found.");
            return;
        }

        console.log("Found", candidates.length, "targets. Connecting to the first one:", candidates[0].url);
        const client = await OriginalCDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
                    return allButtons.map(b => {
                        const rect = b.getBoundingClientRect();
                        return {
                            tag: b.tagName,
                            text: b.textContent,
                            cleanedText: (b.textContent || '').replace(/[↵\\n\\r\\t]/g, '').trim().toLowerCase(),
                            className: b.className,
                            width: rect.width,
                            height: rect.height,
                            disabled: b.disabled
                        };
                    });
                })()
            `,
            returnByValue: true
        });

        console.log("=== All buttons in DOM ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
