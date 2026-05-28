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

        console.log("Connected to target:", candidates[0].title, "Url:", candidates[0].url);

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const pathname = window.location.pathname;
                    const convoIdMatch = pathname.match(/\/c\/([a-fA-F0-9-]+)/);
                    return convoIdMatch;
                })()
            `,
            returnByValue: true
        });

        console.log("=== Evaluation Result ===");
        console.log(res);
        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
