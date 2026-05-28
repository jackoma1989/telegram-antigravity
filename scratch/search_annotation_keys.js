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
                            
                            // Let's find occurrences of "annotations" and print properties that are read/written on it.
                            // We can search for words that appear around ".annotations." or inside "annotations:{"
                            const keywords = ['customTitle', 'userTitle', 'custom_title', 'user_title', 'customLabel', 'custom_label'];
                            const matches = {};
                            keywords.forEach(kw => {
                                const idx = text.indexOf(kw);
                                if (idx !== -1) {
                                    matches[kw] = text.substring(idx - 100, idx + 200);
                                }
                            });
                            
                            if (Object.keys(matches).length > 0) {
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

        console.log("ANNOTATION KEY MATCHES:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
