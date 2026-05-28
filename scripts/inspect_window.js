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

        console.log(`Connecting to candidate: ${candidates[0].title}`);
        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const keys = Object.keys(window).filter(k => {
                        const kl = k.toLowerCase();
                        return kl.includes('anti') || kl.includes('gemini') || kl.includes('ai') || kl.includes('config') || kl.includes('user') || kl.includes('quota') || kl.includes('state') || kl.includes('store');
                    });
                    
                    // Get all visible text on the page
                    const allText = [];
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    let node;
                    while (node = walker.nextNode()) {
                        const txt = node.nodeValue.trim();
                        if (txt && txt.length < 200) {
                            allText.push(txt);
                        }
                    }

                    // Get all button, span and div elements that might be interactive or display info
                    const selectors = ['button', 'div.flex', 'span', 'a'];
                    const elTexts = [];
                    document.querySelectorAll(selectors.join(',')).forEach(el => {
                        if (el.innerText && el.innerText.trim().length > 0 && el.innerText.trim().length < 100) {
                            elTexts.push({
                                tag: el.tagName,
                                class: el.className,
                                text: el.innerText.trim().replace(/\\n/g, ' ')
                            });
                        }
                    });
                    
                    return {
                        globalKeys: keys,
                        allTextSample: allText.slice(0, 150),
                        elTextsSample: elTexts.slice(0, 100)
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("Global keys found:", res.result?.value?.globalKeys);
        console.log("\nAll Text Sample:");
        console.log(res.result?.value?.allTextSample);
        console.log("\nElement Texts Sample:");
        console.log(res.result?.value?.elTextsSample);
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
