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

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const results = [];
                    const allText = [];
                    
                    // Recursive function to search for any element containing specific terms
                    const keywords = ['quota', 'limit', '额度', '5h', 'hour', 'week', 'refresh', '刷新', 'usage'];
                    
                    function checkElement(el) {
                        const html = el.outerHTML || '';
                        if (keywords.some(k => html.toLowerCase().includes(k))) {
                            // If it's a leaf node containing the text directly, or has no children with matches
                            let childHasMatch = false;
                            for (const child of el.children) {
                                if (keywords.some(k => child.outerHTML?.toLowerCase().includes(k))) {
                                    childHasMatch = true;
                                    break;
                                }
                            }
                            if (!childHasMatch && el.innerText?.trim()) {
                                results.push({
                                    tag: el.tagName,
                                    class: el.className,
                                    id: el.id,
                                    text: el.innerText.trim().substring(0, 200),
                                    html: el.outerHTML.substring(0, 400)
                                });
                            }
                        }
                        
                        for (const child of el.children) {
                            checkElement(child);
                        }
                    }
                    
                    checkElement(document.body);
                    return results.slice(0, 50);
                })()
            `,
            returnByValue: true
        });

        console.log("=== Matching DOM Nodes ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error searching DOM:", e.message);
    }
}

run();
