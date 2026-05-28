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
            console.log("No candidates found!");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime, Page } = client;
        await Runtime.enable();
        await Page.enable();

        // Let's get the page tree / frame tree to see if there are nested frames
        const frameTreeRes = await Page.getFrameTree();
        console.log("=== FRAME TREE ===");
        console.log(JSON.stringify(frameTreeRes, null, 2));

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const iframes = Array.from(document.querySelectorAll('iframe'));
                    const iframeInfo = iframes.map((f, i) => {
                        let buttonCount = 0;
                        let src = f.src;
                        let innerHtmlPreview = "";
                        try {
                            const doc = f.contentDocument || f.contentWindow.document;
                            buttonCount = doc.querySelectorAll('button').length;
                            innerHtmlPreview = doc.body.innerHTML.substring(0, 300);
                        } catch(e) {
                            innerHtmlPreview = "Cross-origin iframe: " + e.message;
                        }
                        return {
                            index: i,
                            src,
                            className: f.className,
                            id: f.id,
                            buttonCount,
                            innerHtmlPreview
                        };
                    });
                    
                    return JSON.stringify(iframeInfo, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("\n=== IFRAMES IN DOM ===");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
