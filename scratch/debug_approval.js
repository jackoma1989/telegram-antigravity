const OriginalCDP = require('chrome-remote-interface');
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

async function debug() {
    const port = 9223;
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets = JSON.parse(raw);
    const candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://') &&
        !(t.title && t.title.includes('Launchpad')) &&
        t.title !== 'Manager'
    );

    console.log(`[debug] Found ${candidates.length} candidate target(s)`);

    for (const target of candidates) {
        console.log(`\n[target] title="${target.title}" url="${target.url.substring(0, 80)}"`);
        let client;
        try {
            client = await OriginalCDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();

            const res = await Runtime.evaluate({
                expression: `
                (() => {
                    const approvalKeywords = [
                        'yes, allow this time', 'yes, always allow', 'allow running this command',
                        'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
                        '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行', '确定', '确认',
                        'submit', '提交', '仅允许此次', '始终允许', '允许此次', '仅这一次',
                        '是，允许此次', '是，仅允许此次', 'yes, allow', 'yes, allow always',
                        'skip', '跳过'
                    ];

                    const allButtons = Array.from(document.querySelectorAll(
                        'button, [role="button"], a, div.cursor-pointer, span.cursor-pointer, [class*="btn" i], [class*="button" i]'
                    ));

                    const matched = [];
                    for (const b of allButtons.slice().reverse()) {
                        const text = (b.textContent || '').replace(/[↵\\n\\r\\t]/g, '').trim();
                        const title = b.getAttribute('title') || '';
                        const ariaLabel = b.getAttribute('aria-label') || '';
                        const rect = b.getBoundingClientRect();

                        const ltext = text.toLowerCase();
                        const isMatch = approvalKeywords.some(k => ltext === k || ltext.includes(k) || title.toLowerCase().includes(k) || ariaLabel.toLowerCase().includes(k));
                        const isVisible = rect.width > 0 && rect.height > 0 && !b.disabled;

                        if (isMatch && isVisible) {
                            // Climb up ancestors to find card
                            const cardSelectors = [
                                '[class*="group/run-command"]', '[class*="group/file-change"]',
                                '[class*="group/tool-"]', '[class*="group/edit-file"]',
                                '[class*="group/tool-call"]',
                                '[role="dialog"]', '[class*="dialog"]', '[class*="modal"]',
                                '[class*="overlay"]', '[class*="Radix"]', '[class*="popup"]',
                                '[class*="panel"]'
                            ];

                            let card = null;
                            let cardInfo = 'NOT FOUND';
                            for (const sel of cardSelectors) {
                                card = b.closest(sel);
                                if (card) { cardInfo = sel + ' | class: ' + card.className.substring(0, 80); break; }
                            }

                            // Also check parent chain
                            let parentInfo = [];
                            let el = b.parentElement;
                            for (let i = 0; i < 6 && el; i++) {
                                parentInfo.push(el.tagName + '.' + (el.className||'').substring(0,40));
                                el = el.parentElement;
                            }

                            matched.push({
                                text: text.substring(0, 60),
                                tag: b.tagName,
                                className: (b.className || '').substring(0, 80),
                                ariaLabel,
                                title,
                                cardFound: !!card,
                                cardInfo: cardInfo.substring(0, 120),
                                parents: parentInfo
                            });
                            if (matched.length >= 8) break;
                        }
                    }
                    return matched;
                })()
                `,
                returnByValue: true
            });

            const matched = res.result?.value || [];
            if (matched.length === 0) {
                console.log('  [result] No matching approval buttons found in this target.');
            } else {
                console.log(`  [result] Found ${matched.length} matching button(s):`);
                matched.forEach((m, i) => {
                    console.log(`\n  --- Button #${i+1} ---`);
                    console.log(`    text:      "${m.text}"`);
                    console.log(`    tag:       ${m.tag}`);
                    console.log(`    class:     ${m.className}`);
                    console.log(`    ariaLabel: ${m.ariaLabel}`);
                    console.log(`    title:     ${m.title}`);
                    console.log(`    cardFound: ${m.cardFound}`);
                    console.log(`    cardInfo:  ${m.cardInfo}`);
                    console.log(`    parents:   ${m.parents.join(' > ')}`);
                });
            }

            await client.close();
        } catch (e) {
            console.error(`  [error] ${e.message}`);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
}

debug().catch(console.error);
