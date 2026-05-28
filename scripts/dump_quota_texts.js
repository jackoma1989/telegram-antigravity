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

        console.log(`Scanning targets (found ${candidates.length}):`);
        for (const candidate of candidates) {
            console.log(`\n--- Target: ${candidate.title} ---`);
            const client = await CDP({ target: candidate.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();

            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const results = [];
                        
                        // 1. Check all elements with text content containing quota-related keywords
                        const keywords = ['quota', '额度', 'hour', 'week', '5h', '5小时', '每周', '刷新', 'refresh', '剩余', 'limit', 'token'];
                        
                        function searchNode(node) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.nodeValue.trim();
                                if (text && keywords.some(k => text.toLowerCase().includes(k))) {
                                    // Get some context
                                    const parent = node.parentElement;
                                    if (parent) {
                                        results.push({
                                            text: text,
                                            parentTag: parent.tagName,
                                            parentClass: parent.className,
                                            parentId: parent.id
                                        });
                                    }
                                }
                            } else if (node.childNodes) {
                                for (const child of node.childNodes) {
                                    searchNode(child);
                                }
                            }
                        }
                        
                        searchNode(document.body);
                        
                        // 2. Also search input, placeholder, aria-label, etc.
                        const allElems = document.querySelectorAll('*');
                        allElems.forEach(el => {
                            const attrs = ['placeholder', 'aria-label', 'title', 'data-tooltip-id', 'data-tooltip'];
                            attrs.forEach(attr => {
                                const val = el.getAttribute(attr);
                                if (val && keywords.some(k => val.toLowerCase().includes(k))) {
                                    results.push({
                                        attribute: attr,
                                        value: val,
                                        tag: el.tagName,
                                        class: el.className,
                                        id: el.id
                                    });
                                }
                            });
                        });
                        
                        // 3. Check for window globals or local storage
                        const storage = {};
                        try {
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                if (keywords.some(k => key.toLowerCase().includes(k))) {
                                    storage[key] = localStorage.getItem(key);
                                }
                            }
                        } catch(e) {}
                        
                        return {
                            texts: results.slice(0, 80),
                            storage: storage
                        };
                    })()
                `,
                returnByValue: true
            });

            console.log("Evaluation Result:", JSON.stringify(res.result?.value, null, 2));
            await client.close();
        }
    } catch (e) {
        console.error("Error testing:", e.message);
    }
}

run();
