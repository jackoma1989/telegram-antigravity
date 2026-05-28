const OriginalCDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9223;
const OUT_FILE = path.join(__dirname, 'approval_dom_dump.json');

let lastDumpTime = 0;

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function scanOnce() {
    let targets = [];
    try {
        const raw = await httpGet(`http://127.0.0.1:${PORT}/json`);
        targets = JSON.parse(raw).filter(t =>
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            !(t.title && t.title.includes('Launchpad')) &&
            t.title !== 'Manager'
        );
    } catch (e) { return; }

    for (const target of targets) {
        let client;
        try {
            client = await OriginalCDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();

            const res = await Runtime.evaluate({
                expression: `
                (() => {
                    // Collect ALL visible buttons with full DOM path
                    const allEls = Array.from(document.querySelectorAll(
                        'button, [role="button"], [role="radio"], input[type="radio"], ' +
                        'div.cursor-pointer, span.cursor-pointer, ' +
                        '[class*="btn" i], [class*="button" i]'
                    ));

                    const approvalKeywords = [
                        'yes, allow this time', 'yes, always allow', 'allow running this command',
                        'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
                        'submit', 'skip', 'confirm', 'deny', 'reject', 'cancel',
                        '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行',
                        '确定', '确认', '提交', '仅允许此次', '始终允许', '允许此次',
                        '仅这一次', '跳过', '拒绝', '取消', 'yes, allow', 'yes, allow always'
                    ];

                    const results = [];
                    for (const b of allEls) {
                        const text = (b.textContent || '').replace(/[\\n\\r\\t]+/g, ' ').trim();
                        const title = b.getAttribute('title') || '';
                        const ariaLabel = b.getAttribute('aria-label') || '';
                        const rect = b.getBoundingClientRect();
                        const isVisible = rect.width > 0 && rect.height > 0 && !b.disabled;
                        const ltext = text.toLowerCase();
                        const isMatch = approvalKeywords.some(k =>
                            ltext === k || ltext.includes(k) ||
                            title.toLowerCase().includes(k) ||
                            ariaLabel.toLowerCase().includes(k)
                        );

                        if (!isMatch || !isVisible) continue;

                        // Climb ancestor chain — collect full path
                        const ancestors = [];
                        let el = b.parentElement;
                        for (let i = 0; i < 12 && el && el !== document.body; i++) {
                            ancestors.push({
                                tag: el.tagName,
                                id: el.id || '',
                                role: el.getAttribute('role') || '',
                                cls: (el.className || '').substring(0, 120)
                            });
                            el = el.parentElement;
                        }

                        results.push({
                            text: text.substring(0, 100),
                            tag: b.tagName,
                            cls: (b.className || '').substring(0, 120),
                            ariaLabel,
                            title,
                            role: b.getAttribute('role') || '',
                            rect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
                            ancestors
                        });
                    }
                    return results;
                })()
                `,
                returnByValue: true
            });

            await client.close();

            const buttons = res.result?.value || [];
            // Filter: must have >= 2 matching buttons to be interesting (avoid false positives)
            if (buttons.length >= 2) {
                const now = Date.now();
                if (now - lastDumpTime > 3000) {
                    lastDumpTime = now;
                    const dump = {
                        timestamp: new Date().toISOString(),
                        target: { title: target.title, url: target.url.substring(0, 100) },
                        buttons
                    };
                    fs.writeFileSync(OUT_FILE, JSON.stringify(dump, null, 2), 'utf8');
                    console.log('[CAPTURED] Approval popup detected! Dumped to approval_dom_dump.json  buttons=' + buttons.length);
                    console.log('Buttons found:');
                    buttons.forEach((b, i) => console.log('  #' + (i+1) + ' "' + b.text.substring(0,60) + '"  tag=' + b.tag));
                }
            }
        } catch (e) {
            try { if (client) await client.close(); } catch(_) {}
        }
    }
}

console.log('=== Approval Monitor Started ===');
console.log('Will auto-capture when approval popup appears...');
console.log('Output: ' + OUT_FILE);
console.log('');

setInterval(() => {
    scanOnce().catch(() => {});
}, 1500);
