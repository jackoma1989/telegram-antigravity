const CDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

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
    console.log("DOM capture script started. Monitoring CDP port", port);
    const results = [];
    const startTime = Date.now();
    const duration = 15000; // monitor for 15 seconds

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
            console.log("No targets found!");
            return;
        }

        const target = candidates[0];
        console.log(`Connected to target: ${target.title}`);
        
        const client = await CDP({ target: target.webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        while (Date.now() - startTime < duration) {
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const allElements = Array.from(document.querySelectorAll('button, [role="button"], a, div.cursor-pointer, [class*="dialog"], [class*="modal"]'));
                        return allElements.map(el => {
                            const rect = el.getBoundingClientRect();
                            const attribs = {};
                            if (el.attributes) {
                                for (let i = 0; i < el.attributes.length; i++) {
                                    attribs[el.attributes[i].name] = el.attributes[i].value;
                                }
                            }
                            return {
                                tagName: el.tagName,
                                text: (el.textContent || '').trim().replace(/\\s+/g, ' '),
                                className: el.className,
                                width: rect.width,
                                height: rect.height,
                                visible: rect.width > 0 && rect.height > 0,
                                attributes: attribs
                            };
                        }).filter(el => el.visible && (el.text.length > 0 || el.tagName === 'BUTTON'));
                    })()
                `,
                returnByValue: true
            });

            const elements = res.result?.value || [];
            if (elements.length > 0) {
                results.push({
                    timestamp: new Date().toISOString(),
                    elements: elements
                });
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        await client.close();

        const outputPath = path.join(__dirname, 'approval_dom.json');
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
        console.log(`DOM capture completed. Data written to ${outputPath}`);
    } catch (e) {
        console.error("Capture Error:", e.message);
    }
}

run();
