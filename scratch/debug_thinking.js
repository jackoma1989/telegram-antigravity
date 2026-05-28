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
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const selectors = [
                        '.codicon-loading', 
                        '.loading', 
                        '[class*="animate-spin"]', 
                        '[class*="spinner"]', 
                        '[class*="loader"]',
                        '.thinking-indicator'
                    ];
                    
                    const matches = Array.from(document.querySelectorAll(selectors.join(', ')));
                    const results = matches.map(el => {
                        const isVisible = el.offsetParent !== null;
                        const w = el.clientWidth;
                        const h = el.clientHeight;
                        let text = el.outerHTML.substring(0, 150);
                        return {
                            tag: el.tagName,
                            className: el.className,
                            isVisible,
                            dimensions: \`\${w}x\${h}\`,
                            html: text
                        };
                    });

                    // Also check for stop buttons
                    const stopIcon = document.querySelector(
                        "svg.lucide-square, [data-tooltip-id*='cancel'], [aria-label*='Stop'], [title*='Stop'], [aria-label*='Cancel'], [aria-label*='Durdur'], [title*='Durdur']"
                    );
                    const stopBtn = stopIcon ? (stopIcon.closest('button') || stopIcon) : null;
                    const stopBtnHtml = stopBtn ? stopBtn.outerHTML.substring(0, 150) : null;

                    return JSON.stringify({
                        isLoading: matches.length > 0,
                        matchesCount: matches.length,
                        matches: results,
                        stopBtnHtml
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("DOM CHECK RESULTS:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
