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
            t.webSocketDebuggerUrl
        );
        if (candidates.length === 0) {
            console.log("No candidates found!");
            return;
        }

        const client = await OriginalCDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        // Let's test what the regex is in the evaluated string
        const testCode = `
            (() => {
                try {
                    const pathname = "/c/29a4e31a-dcbd-4735-be7f-af5a4d59d5e5";
                    const convoIdMatch = pathname.match(/\/c\/([a-fA-F0-9-]+)/);
                    return { success: true, match: convoIdMatch ? convoIdMatch[1] : null };
                } catch(e) {
                    return { success: false, err: e.message };
                }
            })()
        `;
        
        console.log("Evaluating testCode...");
        const res = await Runtime.evaluate({
            expression: testCode,
            returnByValue: true
        });
        console.log("Result:", res.result.value);
        await client.close();
    } catch(e) {
        console.error("CDP Error:", e.message);
    }
}
run();
