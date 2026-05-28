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
                            const innerHTML = svg.innerHTML || '';
                            return { className: svg.className?.baseVal || '', paths, innerHTML: innerHTML.substring(0, 100) };
                        });
                        return {
                            tagName: btn.tagName,
                            text: (btn.innerText || btn.textContent || '').trim().substring(0, 50),
                            className: btn.className || '',
                            ariaLabel: btn.getAttribute('aria-label') || '',
                            title: btn.getAttribute('title') || '',
                            dataTooltip: btn.getAttribute('data-tooltip-id') || '',
                            id: btn.getAttribute('id') || '',
                            outerHTML: btn.outerHTML.substring(0, 300),
                            svgs
                        };
                    });
                    
                    return buttons.map(b => ({
                        tag: b.tagName,
                        id: b.id,
                        txt: b.text,
                        cls: b.className,
                        lbl: b.ariaLabel,
                        ttl: b.title,
                        tooltip: b.dataTooltip,
                        svgs: b.svgs,
                        outer: b.outerHTML
                    }));
                })()
            `,
            returnByValue: true
        });

        const list = res.result?.value || [];
        const fs = require('fs');
        const logContent = [];
        logContent.push("Total buttons found: " + list.length);
        
        // 1. Search for buttons with text or labels containing new, chat, add, task, plus
        logContent.push("--- SUSPICIOUS NEW CHAT BUTTONS ---");
        const keywords = ['new', 'chat', 'add', 'task', 'plus', 'create', 'sohbet', 'yeni'];
        const matches = list.filter(b => {
            const txt = (b.txt || '').toLowerCase();
            const lbl = (b.lbl || '').toLowerCase();
            const ttl = (b.ttl || '').toLowerCase();
            const cls = (b.cls || '').toLowerCase();
            const tooltip = (b.tooltip || '').toLowerCase();
            return keywords.some(k => txt.includes(k) || lbl.includes(k) || ttl.includes(k) || cls.includes(k) || tooltip.includes(k));
        });

        logContent.push(JSON.stringify(matches, null, 2));

        // 2. Log first 20 buttons for general inspection
        logContent.push("--- FIRST 20 BUTTONS ---");
        logContent.push(JSON.stringify(list.slice(0, 20), null, 2));

        fs.writeFileSync('find_new_chat_btn.log', logContent.join('\n\n'), 'utf8');
        console.log("Results written to find_new_chat_btn.log successfully!");

        await client.close();
    } catch (e) {
        console.error("Error inspecting:", e.message);
    }
}

run();

