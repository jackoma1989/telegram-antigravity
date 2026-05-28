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
        console.log("Targets found:", targets.map(t => ({ title: t.title, type: t.type, url: t.url, id: t.id })));

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

        console.log("Inspecting candidate:", candidates[0].title);
        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], [class*="new-"], [id*="new-"]')).map(btn => {
                        const svgs = Array.from(btn.querySelectorAll('svg')).map(svg => {
                            const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d'));
                            return { className: svg.className?.baseVal || '', paths };
                        });
                        return {
                            tagName: btn.tagName,
                            text: (btn.innerText || btn.textContent || '').trim().substring(0, 30),
                            className: btn.className || '',
                            ariaLabel: btn.getAttribute('aria-label') || '',
                            title: btn.getAttribute('title') || '',
                            dataTooltip: btn.getAttribute('data-tooltip-id') || '',
                            id: btn.getAttribute('id') || '',
                            svgs
                        };
                    });
                    
                    // Filter candidates
                    return buttons.map(b => ({
                        tag: b.tagName,
                        id: b.id,
                        txt: b.text,
                        cls: b.className,
                        lbl: b.ariaLabel,
                        ttl: b.title,
                        tooltip: b.dataTooltip,
                        svgCount: b.svgs.length
                    })).slice(0, 50); // Take first 50 elements to avoid truncation
                })()
            `,
            returnByValue: true
        });

        console.log("--- FOUND BUTTONS & INTERACTIVE ELEMENTS ---");
        console.log(JSON.stringify(res.result?.value, null, 2));

        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();
