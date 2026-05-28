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
            console.log("No targets found!");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime, Log } = client;
        
        const logs = [];
        client.on('Runtime.consoleAPICalled', (params) => {
            if (params.type === 'error' || params.type === 'warning') {
                const text = params.args.map(arg => arg.value || arg.description || JSON.stringify(arg)).join(' ');
                logs.push(`[Console ${params.type}] ${text}`);
            }
        });
        
        client.on('Log.entryAdded', (params) => {
            if (params.entry.level === 'error') {
                logs.push(`[Log Error] ${params.entry.text} (${params.entry.url})`);
            }
        });

        await Runtime.enable();
        await Log.enable();

        console.log("Listening for 3 seconds to gather console errors...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log("--- CONSOLE ERRORS ---");
        if (logs.length === 0) {
            console.log("No console errors captured in 3 seconds.");
        } else {
            logs.forEach(l => console.log(l));
        }

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
