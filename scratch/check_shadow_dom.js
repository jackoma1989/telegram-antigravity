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
                    function findElementsInShadow(root, matches = []) {
                        if (!root) return matches;
                        
                        // Find all elements under this root (or shadow root)
                        const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
                        all.forEach(el => {
                            const text = (el.textContent || '').trim().toLowerCase();
                            if (text.includes('allow') || text.includes('submit') || text.includes('提交') || text.includes('允许')) {
                                const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
                                if (rect.width > 0 && rect.height > 0) {
                                    matches.push({
                                        tagName: el.tagName,
                                        className: el.className,
                                        text: el.textContent.trim().substring(0, 100),
                                        outerHTML: el.outerHTML ? el.outerHTML.substring(0, 200) : "",
                                        inShadow: root !== document
                                    });
                                }
                            }
                            
                            // Recurse into open shadow root if exists
                            if (el.shadowRoot) {
                                findElementsInShadow(el.shadowRoot, matches);
                            }
                        });
                        return matches;
                    }
                    
                    const matches = findElementsInShadow(document);
                    
                    // Let's also check for shadow roots in the document at all
                    const allWithShadow = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot);
                    const shadowRootsInfo = allWithShadow.map(el => ({
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id
                    }));
                    
                    return JSON.stringify({
                        totalShadowElements: allWithShadow.length,
                        shadowRootsInfo,
                        matches: matches.slice(-30)
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("=== SHADOW DOM DIAGNOSTICS ===");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
