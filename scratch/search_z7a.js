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
        if (candidates.length === 0) return;

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (async () => {
                    const bundles = Array.from(document.querySelectorAll('script'))
                        .map(s => s.src)
                        .filter(src => src && src.includes('.js'));
                    
                    const results = [];
                    for (const src of bundles) {
                        try {
                            const r = await fetch(src);
                            const text = await r.text();
                            
                            let idx = 0;
                            const matches = [];
                            while (true) {
                                idx = text.indexOf('z7a(this', idx);
                                if (idx === -1) break;
                                matches.push(text.substring(idx - 600, idx + 200));
                                idx += 'z7a(this'.length;
                                if (matches.length > 5) break;
                             }
                            
                            if (matches.length > 0) {
                                results.push({ src, matches });
                            }
                        } catch(e) {
                            results.push({ src, err: e.message });
                        }
                    }
                    return JSON.stringify(results, null, 2);
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("z7a USAGES:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
