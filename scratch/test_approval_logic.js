// Quick test of the EXACT findActiveApproval logic from cdp_controller.js
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

async function test() {
    const port = 9223;
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets = JSON.parse(raw).filter(t =>
        (t.type === 'page' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://') &&
        !(t.title && t.title.includes('Launchpad')) &&
        t.title !== 'Manager'
    );
    console.log(`[test] ${targets.length} target(s) found`);

    for (const target of targets) {
        console.log(`\n[target] "${target.title}"`);
        let client;
        try {
            client = await OriginalCDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();

            // Step 1: find activeBtn
            const step1 = await Runtime.evaluate({
                expression: `
                (() => {
                    const approvalKeywords = [
                        'yes, allow this time','yes, always allow','allow running this command',
                        'run','accept changes','accept','always allow','allow','approve',
                        '同意','允许','运行','接受','总是允许','允许一次','允许执行','确定','确认',
                        'submit','提交','仅允许此次','始终允许','允许此次','仅这一次',
                        '是，允许此次','是，仅允许此次','yes, allow','yes, allow always'
                    ];
                    const allButtons = Array.from(document.querySelectorAll(
                        'button, [role="button"], a, div.cursor-pointer, span.cursor-pointer, [class*="btn" i], [class*="button" i]'
                    ));
                    const found = [];
                    for (const b of allButtons.slice().reverse()) {
                        const text = (b.textContent||'').replace(/[\\n\\r\\t]+/g,' ').trim().toLowerCase();
                        const ariaLabel = (b.getAttribute('aria-label')||'').toLowerCase();
                        const rect = b.getBoundingClientRect();
                        const isVis = rect.width>0 && rect.height>0 && !b.disabled;
                        const isMatch = approvalKeywords.some(k => text===k||text.includes(k)||ariaLabel.includes(k));
                        if (isMatch && isVis) {
                            found.push({ text: (b.textContent||'').replace(/[\\n\\r\\t]+/g,' ').trim().substring(0,50), tag: b.tagName, cls: (b.className||'').substring(0,80) });
                            if (found.length >= 5) break;
                        }
                    }
                    return found;
                })()
                `,
                returnByValue: true
            });
            const activeBtns = step1.result?.value || [];
            console.log(`  Step1 - matching buttons: ${activeBtns.length}`);
            activeBtns.forEach((b, i) => console.log(`    #${i+1} "${b.text}" [${b.tag}]`));

            if (activeBtns.length === 0) {
                await client.close();
                continue;
            }

            // Step 2: card resolution
            const step2 = await Runtime.evaluate({
                expression: `
                (() => {
                    const approvalKeywords = [
                        'yes, allow this time','yes, always allow','allow running this command',
                        'run','accept changes','accept','always allow','allow','approve',
                        '同意','允许','运行','接受','总是允许','允许一次','允许执行','确定','确认',
                        'submit','提交','仅允许此次','始终允许','允许此次','仅这一次',
                        '是，允许此次','是，仅允许此次','yes, allow','yes, allow always'
                    ];
                    const allButtons = Array.from(document.querySelectorAll(
                        'button, [role="button"], a, div.cursor-pointer, span.cursor-pointer, [class*="btn" i], [class*="button" i]'
                    ));
                    const activeBtn = allButtons.slice().reverse().find(b => {
                        const text = (b.textContent||'').replace(/[\\n\\r\\t]+/g,' ').trim().toLowerCase();
                        const ariaLabel = (b.getAttribute('aria-label')||'').toLowerCase();
                        const rect = b.getBoundingClientRect();
                        const isMatch = approvalKeywords.some(k => text===k||text.includes(k)||ariaLabel.includes(k));
                        return isMatch && rect.width>0 && rect.height>0 && !b.disabled;
                    });
                    if (!activeBtn) return { error: 'no activeBtn' };

                    let card = activeBtn.closest('[class*="group/run-command"],[class*="group/file-change"],[class*="group/tool-"],[class*="group/edit-file"],[class*="group/tool-call"]');
                    let strategy = 1;
                    if (!card) {
                        card = activeBtn.closest('[role="dialog"],[class*="dialog"],[class*="modal"],[class*="overlay"],[class*="Radix"],[class*="popup"]');
                        strategy = 2;
                    }
                    if (!card) {
                        const inputBox = activeBtn.closest('[id*="agentSidePanelInputBox"]');
                        if (inputBox) {
                            card = activeBtn.closest('[class*="rounded-"][class*="bg-card"],[class*="bg-card-border"]');
                            if (!card) card = inputBox;
                            strategy = 3;
                        }
                    }
                    if (!card) {
                        let el = activeBtn.parentElement;
                        for (let i=0; i<8 && el && el!==document.body; i++) {
                            const btns = Array.from(el.querySelectorAll('button,[role="button"]')).filter(b=>{ const r=b.getBoundingClientRect(); return r.width>0&&r.height>0; });
                            if (btns.length>=2) { card=el; strategy=4; break; }
                            el=el.parentElement;
                        }
                    }

                    return {
                        activeBtn: { text: (activeBtn.textContent||'').replace(/[\\n\\r\\t]+/g,' ').trim().substring(0,50), tag: activeBtn.tagName },
                        strategy: strategy,
                        cardFound: !!card,
                        cardId: card ? (card.id||'') : '',
                        cardCls: card ? (card.className||'').substring(0,100) : '',
                        inputBoxFound: !!activeBtn.closest('[id*="agentSidePanelInputBox"]'),
                        inputBoxId: (activeBtn.closest('[id*="agentSidePanelInputBox"]')||{id:''}).id
                    };
                })()
                `,
                returnByValue: true
            });
            const r = step2.result?.value || {};
            console.log(`  Step2 - activeBtn: "${r.activeBtn?.text}" [${r.activeBtn?.tag}]`);
            console.log(`  Step2 - strategy used: ${r.strategy}`);
            console.log(`  Step2 - cardFound: ${r.cardFound}`);
            console.log(`  Step2 - cardId: "${r.cardId}"`);
            console.log(`  Step2 - cardCls: "${r.cardCls}"`);
            console.log(`  Step2 - inputBoxFound: ${r.inputBoxFound} (id="${r.inputBoxId}")`);

            await client.close();
        } catch (e) {
            console.error(`  [error] ${e.message}`);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
}

test().catch(console.error);
