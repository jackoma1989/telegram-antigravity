const OriginalCDP = require('chrome-remote-interface');
const http = require('http');

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

async function scan() {
    try {
        const targets = JSON.parse(await httpGet('http://127.0.0.1:9223/json'))
            .filter(t => (t.type === 'page' || t.type === 'webview') &&
                t.webSocketDebuggerUrl &&
                !t.url.includes('devtools://') &&
                t.title !== 'Manager');

        for (const target of targets) {
            let client;
            try {
                client = await OriginalCDP({ target: target.webSocketDebuggerUrl });
                await client.Runtime.enable();

                const r = await client.Runtime.evaluate({
                    expression: `(() => {
                        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                        
                        // Find Skip or Submit button
                        const actionBtn = btns.find(b => {
                            const tx = (b.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim().toLowerCase();
                            const rect = b.getBoundingClientRect();
                            return (tx === 'skip' || tx === 'submit' || tx.startsWith('submit')) 
                                && rect.width > 0 && rect.height > 0 && !b.disabled;
                        });
                        
                        if (!actionBtn) return null;
                        
                        // Check parent chain for agentSidePanelInputBox
                        const inputBox = actionBtn.closest('[id*="agentSidePanelInputBox"]');
                        
                        // Collect full ancestor chain (10 levels)
                        const ancestors = [];
                        let el = actionBtn.parentElement;
                        for (let i = 0; i < 10 && el && el !== document.body; i++) {
                            ancestors.push({
                                tag: el.tagName,
                                id: el.id || '',
                                cls: (el.className || '').substring(0, 100)
                            });
                            el = el.parentElement;
                        }
                        
                        return {
                            btnText: (actionBtn.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim().substring(0, 40),
                            btnTag: actionBtn.tagName,
                            btnCls: (actionBtn.className || '').substring(0, 80),
                            inInputBox: !!inputBox,
                            inputBoxId: inputBox ? (inputBox.id || 'no-id') : 'N/A',
                            ancestors: ancestors
                        };
                    })()`,
                    returnByValue: true
                });

                await client.close();

                const v = r.result && r.result.value;
                if (v) {
                    console.log('\n=== POPUP DETECTED! ===');
                    console.log('Button:', v.btnText, '[' + v.btnTag + ']');
                    console.log('Button class:', v.btnCls);
                    console.log('In agentSidePanelInputBox:', v.inInputBox, '(id=' + v.inputBoxId + ')');
                    console.log('\nAncestor chain:');
                    v.ancestors.forEach((a, i) => {
                        console.log('  Level ' + (i+1) + ': <' + a.tag + '> id="' + a.id + '" cls="' + a.cls + '"');
                    });
                    process.exit(0);
                }
            } catch (e) {
                try { if (client) await client.close(); } catch (_) {}
            }
        }
    } catch (e) {}
}

console.log('=== Waiting for Skip/Submit popup (30s timeout) ===');
const iv = setInterval(() => scan().catch(() => {}), 800);
setTimeout(() => {
    clearInterval(iv);
    console.log('Timeout - no popup detected in 30 seconds');
    process.exit(0);
}, 30000);
