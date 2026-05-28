const OriginalCDP = require('chrome-remote-interface');
const http = require('http');

const { UI_LOCATORS_SCRIPT } = require('./ui_locators');

// Cache for preferred targets if needed
let preferredTargetId = null;

function withTimeout(promise, ms, errorMsg) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(errorMsg || `Operation timed out after ${ms}ms`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

const CDP = async (options) => {
    const client = await withTimeout(OriginalCDP(options), 5000, "CDP Connect Timeout");
    if (typeof client.send === 'function') {
        const originalSend = client.send.bind(client);
        client.send = async (method, params) => {
            let timeoutMs = 8000;
            if (method.includes('captureScreenshot')) timeoutMs = 15000;
            if (method.includes('Runtime.evaluate') && params?.awaitPromise) timeoutMs = 12000;
            return await withTimeout(originalSend(method, params), timeoutMs, `CDP ${method} Timeout`);
        };
    }
    return client;
};

function httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', err => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('HTTP request timed out'));
        });
    });
}

/**
 * Shared target resolver — fetches CDP targets and filters candidates.
 */
async function resolveTargets(port) {
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

        // Sort candidates so the preferred target or the active agent workspace is first
        const preferredApp = process.env.ANTIGRAVITY_PREFERRED_APP || 'agent';
        candidates.sort((a, b) => {
            if (preferredTargetId) {
                if (a.id === preferredTargetId) return -1;
                if (b.id === preferredTargetId) return 1;
            }
            const aIsAgent = a.url && (a.url.includes('/c/') || a.url.includes('tab=') || (a.url.includes('127.0.0.1') && !a.url.includes('vscode-')));
            const bIsAgent = b.url && (b.url.includes('/c/') || b.url.includes('tab=') || (b.url.includes('127.0.0.1') && !b.url.includes('vscode-')));
            
            if (preferredApp === 'agent') {
                if (aIsAgent && !bIsAgent) return -1;
                if (!aIsAgent && bIsAgent) return 1;
            }
            return 0;
        });

        return candidates;
    } catch (e) {
        console.error('[resolveTargets] Failed to fetch CDP targets:', e.message);
        return [];
    }
}

/**
 * Injects prompt into the current focused chat input box and clicks send button.
 */
async function sendViaCDP(text, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        throw new Error("No active Antigravity targets found. Ensure Antigravity is running.");
    }

    const errors = [];
    // We try each target until one successfully processes the input
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime, Input } = client;
            await Runtime.enable();

            const focusResult = await Runtime.evaluate({
                expression: `
                    ${UI_LOCATORS_SCRIPT}
                    (async function() {
                        try {
                            const escapedText = ${JSON.stringify(text)};
                            const editor = AG_UI.getChatInput();
                            if (!editor) return { found: false, reason: "no_editor" };

                            editor.focus();
                            try {
                                const range = document.createRange();
                                range.selectNodeContents(editor);
                                const sel = window.getSelection();
                                sel.removeAllRanges();
                                sel.addRange(range);
                            } catch(e) {}

                            try {
                                document.execCommand("selectAll", false, null);
                                document.execCommand("delete", false, null);
                            } catch(e) {}

                            let inserted = false;
                            try { inserted = !!document.execCommand("insertText", false, escapedText); } catch(e) {}
                            
                            if (!inserted) {
                                if (editor.tagName === 'TEXTAREA') {
                                    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                                    if (setter) setter.call(editor, escapedText);
                                    else editor.value = escapedText;
                                } else {
                                    editor.textContent = escapedText;
                                }
                                editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: escapedText }));
                                editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: escapedText }));
                                editor.dispatchEvent(new Event("change", { bubbles: true }));
                            }

                            await new Promise(r => setTimeout(r, 150));

                            // Try clicking submit button
                            const panelContainer = editor.closest('#antigravity') || editor.closest('#conversation') || document;
                            const submit = panelContainer.querySelector("button.bg-primary, button[class*='bg-primary'], button:has(svg.text-primary-foreground), svg.lucide-arrow-right, svg.lucide-arrow-up, svg[class*='arrow-right'], svg[class*='arrow-up'], svg[class*='send']")?.closest("button") || panelContainer.querySelector("button.bg-primary, button[class*='bg-primary'], button:has(svg.text-primary-foreground)");
                            if (submit && !submit.disabled) {
                                setTimeout(() => submit.click(), 10);
                                return { found: true, method: 'button' };
                            }

                            // Fallback to Enter key event dispatch
                            setTimeout(() => {
                                ['keydown', 'keypress', 'keyup'].forEach(type => {
                                    editor.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
                                });
                            }, 10);
                            return { found: true, method: 'keyboard' };
                        } catch(err) {
                            return { found: false, reason: err.message };
                        }
                    })()
                `,
                awaitPromise: true,
                returnByValue: true
            });

            const val = focusResult?.result?.value;
            if (val && val.found) {
                // Ensure Enter key is cleanly dispatched to trigger submit
                await new Promise(r => setTimeout(r, 50));
                try {
                    await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                    await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                } catch(e) {}
                await client.close();
                preferredTargetId = target.id; // Remember successful target
                return target.id;
            }
            
            if (val) errors.push(`${target.title}: ${val.reason || 'no_editor'}`);
            await client.close();
        } catch (err) {
            if (err.message.includes('Promise was collected')) {
                try { if (client) await client.close(); } catch(_) {}
                preferredTargetId = target.id;
                return target.id;
            }
            errors.push(`${target.title}: ${err.message}`);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    throw new Error("Failed to send message: " + errors.join(' | '));
}

/**
 * Triggers a new chat/task in Antigravity.
 */
async function triggerNewChat(port) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        try {
            const client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            const res = await Runtime.evaluate({
                expression: `
                    ${UI_LOCATORS_SCRIPT}
                    (() => {
                        const btn = AG_UI.getNewChatButton();
                        if (btn && typeof btn.click === 'function') {
                            btn.click();
                            return { clicked: true };
                        }
                        return { clicked: false };
                    })()
                `, returnByValue: true
            });
            await client.close();
            const val = res.result?.value;
            if (val && val.clicked) return true;
        } catch (e) {
            console.error('[triggerNewChat] Failed on target:', e.message);
        }
    }
    return false;
}

/**
 * Captures full IDE window screenshot via CDP.
 */
async function captureFullIDEScreenshot(port) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        try {
            const client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Page } = client;
            await Page.enable();
            
            const screenshotResult = await Page.captureScreenshot({ format: 'jpeg', quality: 75 });
            await client.close();
            if (screenshotResult && screenshotResult.data) {
                return Buffer.from(screenshotResult.data, 'base64');
            }
        } catch (e) {
            console.error('[captureScreenshot] Failed on target:', e.message);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    throw new Error("Could not capture screenshot from any running target.");
}

/**
 * Selects an AI model via CDP in the active page.
 */
async function selectModelViaCDP(modelName, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        throw new Error("No active Antigravity targets found.");
    }
    
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            
            const res = await Runtime.evaluate({
                expression: `
                    ${UI_LOCATORS_SCRIPT}
                    (async () => {
                        const btn = AG_UI.getModelSelectorButton();
                        if (!btn) return { success: false, reason: "Model button not found" };
                        
                        const parent = btn.closest('[aria-expanded]');
                        const isOpen = parent && parent.getAttribute('aria-expanded') === 'true';
                        
                        if (!isOpen) {
                            btn.click();
                            await new Promise(r => setTimeout(r, 600));
                        }
                        
                        const options = AG_UI.getModelOptions();
                        
                        const targetOption = options.find(el => {
                            const text = (el.textContent || '').toLowerCase();
                            return text.includes(${JSON.stringify(modelName.toLowerCase())});
                        });
                        
                        if (targetOption) {
                            targetOption.click();
                            return { success: true };
                        }
                        
                        // Close menu if it was closed before and we opened it
                        if (!isOpen) {
                            btn.click();
                        }
                        return { success: false, reason: "Model option not found: " + ${JSON.stringify(modelName)} };
                    })()
                `,
                awaitPromise: true,
                returnByValue: true
            });
            await client.close();
            const val = res.result?.value;
            if (val && val.success) return true;
            else if (val && !val.success) {
                console.warn('[selectModelViaCDP] target failed:', val.reason);
            }
        } catch (e) {
            console.error('[selectModelViaCDP] Failed on target:', e.message);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    return false;
}

/**
 * Clicks the stop button in the active page to cancel AI generation.
 */
async function stopAgentViaCDP(port) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const chatArea = (document.getElementById('conversation') || document.querySelector('.interactive-session') || document.querySelector('.chat-container') || document);
                        const stopIcon = chatArea.querySelector(
                            "svg.lucide-square, [data-tooltip-id*='cancel'], [aria-label*='Stop'], [title*='Stop'], [aria-label*='Cancel'], [aria-label*='Durdur'], [title*='Durdur']"
                        );
                        const btn = stopIcon ? (stopIcon.closest('button') || stopIcon) : null;
                        
                        if (btn && typeof btn.click === 'function') {
                            btn.click();
                            return { clicked: true };
                        }
                        
                        const allBtns = Array.from(chatArea.querySelectorAll('button'));
                        const backupBtn = allBtns.find(b => {
                            const svg = b.querySelector('svg');
                            const text = (b.textContent || '').toLowerCase();
                            return (svg && (svg.classList.contains('lucide-square') || b.innerHTML.includes('square'))) ||
                                   text.includes('stop') || 
                                   text.includes('cancel');
                        });
                        
                        if (backupBtn && typeof backupBtn.click === 'function') {
                            backupBtn.click();
                            return { clicked: true };
                        }
                        
                        return { clicked: false };
                    })()
                `,
                returnByValue: true
            });
            await client.close();
            const val = res.result?.value;
            if (val && val.clicked) return true;
        } catch (e) {
            console.error('[stopAgentViaCDP] Failed on target:', e.message);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    return false;
}/**
 * Scans the active page DOM for visible tool permission prompts.
 */
async function findActiveApproval(port) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        // ANCHOR: Only real Antigravity approval popups have a visible "Skip" button.
                        // Using it as sole anchor prevents false positives from command history / sidebar.
                        const allBtns = Array.from(document.querySelectorAll('button, [role="button"], a, div.cursor-pointer, span.cursor-pointer, [class*="btn" i], [class*="button" i]'));
                        
                        const skipBtn = allBtns.slice().reverse().find(b => {
                            const text = (b.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim().toLowerCase();
                            const rect = b.getBoundingClientRect();
                            const isSkip = text === 'skip' || text === '跳过' || text.includes('skip') || text.includes('跳过') || text.includes('atla') || text.includes('pass') || text.includes('skip step');
                            return isSkip && rect.width > 0 && rect.height > 0 && !b.disabled;
                        });
                        
                        if (!skipBtn) return null;
                        
                        // --- CARD RESOLUTION from Skip button ---
                        let card = skipBtn.closest('[class*="group/run-command"],[class*="group/file-change"],[class*="group/tool-"],[class*="group/edit-file"],[class*="group/tool-call"]');
                        if (!card) card = skipBtn.closest('[role="dialog"],[class*="dialog"],[class*="modal"],[class*="overlay"],[class*="Radix"],[class*="popup"]');
                        if (!card) card = skipBtn.closest('[class*="bg-card-border"]');
                        if (!card) card = skipBtn.closest('[class*="bg-card"]');
                        if (!card) { const ib = skipBtn.closest('[id*="agentSidePanelInputBox"]'); if (ib) card = ib; }
                        if (!card) {
                            let el = skipBtn.parentElement;
                            for (let i = 0; i < 8 && el && el !== document.body; i++) {
                                const vis = Array.from(el.querySelectorAll('button,[role="button"]'))
                                    .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
                                if (vis.length >= 2) { card = el; break; }
                                el = el.parentElement;
                            }
                        }
                        if (!card) return null;
                        
                        // --- EXTRACT ACTION TEXT ---
                        let actionText = '';
                        const codeEl = card.querySelector('code, pre, [class*="command"], [class*="terminal"]');
                        if (codeEl) {
                            actionText = codeEl.textContent.trim();
                        } else {
                            const clone = card.cloneNode(true);
                            Array.from(clone.querySelectorAll('style,script,button,[role="button"],a')).forEach(el => el.remove());
                            actionText = clone.textContent.replace(/\\s+/g, ' ').trim().substring(0, 400);
                        }
                        
                        // --- EXTRACT BUTTONS ---
                        const cardButtons = [];
                        
                        // 1. Numbered radio options: "1 Yes, allow this time", "2 Yes, always allow..." etc.
                        Array.from(card.querySelectorAll('*')).forEach(el => {
                            const text = (el.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim();
                            // Enforce strict prefix matching to avoid false positives like "1 task running"
                            const isOption = /^[1-9]\\s*(Yes|No|Allow|Don't|Always|Only|是|否|允许|总是|始终|仅|只|同意|拒绝|Evet|Hayır|İzin)/i.test(text);
                            if (isOption && text.length < 120 && el.children.length <= 3) {
                                if (!cardButtons.some(cb => cb.text === text)) {
                                    cardButtons.push({ text, type: 'radio' });
                                }
                            }
                        });
                        
                        // 2. Skip button (exposed so user can choose to skip from phone)
                        const skipText = (skipBtn.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim();
                        if (skipText && !cardButtons.some(cb => cb.text === skipText)) {
                            cardButtons.push({ text: skipText, type: 'button' });
                        }
                        
                        // If no buttons found, suppress notification
                        if (cardButtons.length === 0) return null;
                        
                        // Clean up actionText from any button texts to avoid duplicating them in the details section
                        cardButtons.forEach(btn => {
                            actionText = actionText.split(btn.text).join('');
                        });
                        actionText = actionText.replace(/\\s+/g, ' ').trim();
                        
                        const path = skipBtn.className.substring(0, 60) + ':' + actionText.substring(0, 60);
                        return { found: true, actionText, buttons: cardButtons, path };
                    })()
                `,
                returnByValue: true
            });
            await client.close();
            if (res.result?.value) return res.result.value;
        } catch (e) {
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    return null;
}

/**
 * Responds (click allow/reject) to an active approval request.
 */
async function respondToApproval(port, action) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            const res = await Runtime.evaluate({
                expression: `
                    (() => {
                        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a, div.cursor-pointer, span.cursor-pointer, [class*="btn" i], [class*="button" i]'));
                        
                        // Find the ACTIVE submit/skip anchor button to locate the card
                        const anchorKeywords = [
                            'submit', 'skip', '提交', '跳过', 'confirm', '确定', '确认',
                            'yes, allow', 'yes', 'run', 'accept', 'approve', 'allow', '允许', '同意'
                        ];
                        const anchorBtn = allButtons.slice().reverse().find(b => {
                            const text = (b.textContent || '').replace(/[\\n\\r\\t]/g, '').trim().toLowerCase();
                            const ariaLabel = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                            const rect = b.getBoundingClientRect();
                            const isMatch = anchorKeywords.some(k =>
                                text === k || text.includes(k) ||
                                ariaLabel === k || ariaLabel.includes(k)
                            );
                            return isMatch && rect.width > 0 && rect.height > 0 && !b.disabled;
                        });
                        
                        if (!anchorBtn) return { clicked: false, reason: 'No anchor button found' };
                        
                        // --- SAME card-resolution as findActiveApproval ---
                        let card = anchorBtn.closest('[class*="group/run-command"],[class*="group/file-change"],[class*="group/tool-"],[class*="group/edit-file"],[class*="group/tool-call"]');
                        if (!card) card = anchorBtn.closest('[role="dialog"],[class*="dialog"],[class*="modal"],[class*="overlay"],[class*="Radix"],[class*="popup"]');
                        if (!card) card = anchorBtn.closest('[class*="bg-card-border"]');
                        if (!card) card = anchorBtn.closest('[class*="bg-card"]');
                        if (!card) {
                            const ib = anchorBtn.closest('[id*="agentSidePanelInputBox"]');
                            if (ib) card = ib;
                        }
                        if (!card) {
                            let el = anchorBtn.parentElement;
                            for (let i = 0; i < 8 && el && el !== document.body; i++) {
                                const vis = Array.from(el.querySelectorAll('button,[role="button"]')).filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
                                if (vis.length >= 2) { card = el; break; }
                                el = el.parentElement;
                            }
                        }
                        
                        if (!card) return { clicked: false, reason: 'No card container found' };
                        
                        const targetText = ${JSON.stringify(action.trim().toLowerCase())};
                        
                        // Case A: numbered radio option ("1", "2 yes...", "3 no..." etc.)
                        if (/^[1-9]/.test(targetText)) {
                            const optionNum = targetText.match(/^([1-9])/)[1];
                            // Search ALL elements in card for one whose direct text starts with that number and matches radio criteria
                            const allEls = Array.from(card.querySelectorAll('*'));
                            const optionEl = allEls.find(el => {
                                const txt = (el.textContent || '').replace(/[\\n\\r\\t]/g, ' ').trim().toLowerCase();
                                const isOption = /^[1-9]\\s*(Yes|No|Allow|Don't|Always|Only|是|否|允许|总是|始终|仅|只|同意|拒绝|Evet|Hayır|İzin)/i.test(txt);
                                return txt.startsWith(optionNum) && isOption && el.children.length <= 3 && txt.length < 150;
                            });
                            
                            if (optionEl) {
                                // Try clicking a radio input inside, otherwise click the element itself
                                const radio = optionEl.querySelector('input[type="radio"],[role="radio"]') || optionEl;
                                radio.click();
                                // Find the Submit button specifically and click it after delay
                                const submitBtn = Array.from(card.querySelectorAll('button,[role="button"]')).find(b => {
                                    const t = (b.textContent||'').replace(/[\\n\\r\\t]/g,' ').trim().toLowerCase();
                                    return (t === 'submit' || t.startsWith('submit')) && b.getBoundingClientRect().width > 0;
                                }) || anchorBtn;
                                setTimeout(() => submitBtn.click(), 200);
                                return { clicked: true, method: 'radio', option: optionNum };
                            }
                            // Fallback: couldn't find the option element; just click Submit
                            anchorBtn.click();
                            return { clicked: true, method: 'submit-fallback', option: optionNum };
                        }
                        
                        // Case B: named button ("skip", "submit", "approve", etc.)
                        const allCardBtns = Array.from(card.querySelectorAll('button,[role="button"],a,div.cursor-pointer,span.cursor-pointer'));
                        const btn = allCardBtns.slice().reverse().find(b => {
                            const t = (b.textContent||'').replace(/[\\n\\r\\t]/g,' ').trim().toLowerCase();
                            const al = (b.getAttribute('aria-label')||'').toLowerCase();
                            const rect = b.getBoundingClientRect();
                            return (t === targetText || t.includes(targetText) || al.includes(targetText))
                                && rect.width > 0 && rect.height > 0 && !b.disabled;
                        });
                        
                        if (btn) { btn.click(); return { clicked: true, method: 'named-button', target: targetText }; }
                        
                        return { clicked: false, reason: 'Button "' + targetText + '" not found in card' };
                    })()
                `,
                returnByValue: true
            });
            await client.close();
            const val = res.result?.value;
            if (val) {
                console.log('[respondToApproval]', JSON.stringify(val));
                if (val.clicked) return true;
            }
        } catch (e) {
            console.error('[respondToApproval] error:', e.message);
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    return false;
}

/**
 * Checks if the agent is currently thinking/generating (active).
 */
async function checkAgentThinkingStatus(port) {
    const candidates = await resolveTargets(port);
    for (const target of candidates) {
        let client;
        try {
            client = await CDP({ target: target.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            const res = await Runtime.evaluate({
                expression: `
                    ${UI_LOCATORS_SCRIPT}
                    (() => {
                        const stopBtn = AG_UI.getStopButton();
                        const isLoading = AG_UI.isLoading();
                        return !!(stopBtn || isLoading);
                    })()
                `,
                returnByValue: true
            });
            await client.close();
            const val = res.result?.value;
            if (val) return true;
        } catch (e) {
            try { if (client) await client.close(); } catch(_) {}
        }
    }
    return false;
}

/**
 * Queries Antigravity LLM and Plan Quota details via CDP.
 */
async function queryAntigravityQuota(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        throw new Error("No active Antigravity targets found. Ensure Antigravity is running.");
    }

    const target = candidates[0];
    let client;
    try {
        client = await CDP({ target: target.webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState || !syncedState.userStatusProvider) {
                        return JSON.stringify({ error: "Could not locate syncedState inside React Tree." });
                    }
                    
                    const state = syncedState.userStatusProvider.getState();
                    if (!state) {
                        return JSON.stringify({ error: "Antigravity state is currently empty or loading." });
                    }
                    
                    // Extract basic user info and credit plan status
                    const userTier = state.userTier ? {
                        id: state.userTier.id,
                        name: state.userTier.name,
                        description: state.userTier.description,
                        availableCredits: state.userTier.availableCredits ? state.userTier.availableCredits.map(c => ({
                            creditType: c.creditType,
                            creditAmount: String(c.creditAmount),
                            minimumCreditAmountForUsage: String(c.minimumCreditAmountForUsage)
                        })) : null
                    } : null;
                    
                    const planStatus = state.planStatus ? {
                        availablePromptCredits: state.planStatus.availablePromptCredits,
                        availableFlowCredits: state.planStatus.availableFlowCredits,
                        usedPromptCredits: state.planStatus.usedPromptCredits,
                        usedFlowCredits: state.planStatus.usedFlowCredits,
                        planInfo: state.planStatus.planInfo ? {
                            planName: state.planStatus.planInfo.planName,
                            monthlyPromptCredits: state.planStatus.planInfo.monthlyPromptCredits,
                            monthlyFlowCredits: state.planStatus.planInfo.monthlyFlowCredits,
                            isTeams: state.planStatus.planInfo.isTeams,
                            isEnterprise: state.planStatus.planInfo.isEnterprise
                        } : null
                    } : null;
                    
                    // Extract individual model limits
                    const modelQuotas = [];
                    const cascadeData = state.cascadeModelConfigData;
                    if (cascadeData && cascadeData.clientModelConfigs) {
                        cascadeData.clientModelConfigs.forEach(m => {
                            if (m.quotaInfo) {
                                modelQuotas.push({
                                    label: m.label,
                                    pricingType: m.pricingType,
                                    isPremium: m.isPremium,
                                    remainingFraction: m.quotaInfo.remainingFraction,
                                    resetTimeSeconds: m.quotaInfo.resetTime?.seconds ? String(m.quotaInfo.resetTime.seconds) : null
                                });
                            }
                        });
                    }
                    
                    const result = {
                        userTier,
                        planStatus,
                        modelQuotas,
                        serverTimeSeconds: Math.floor(Date.now() / 1000)
                    };
                    
                    return JSON.stringify(result);
                })()
            `,
            returnByValue: true
        });

        await client.close();
        
        if (res.result && res.result.value) {
            const data = JSON.parse(res.result.value);
            if (data.error) {
                throw new Error(data.error);
            }
            return data;
        } else {
            throw new Error("Empty evaluation result received from Antigravity.");
        }
    } catch (err) {
        try { if (client) await client.close(); } catch(_) {}
        throw err;
    }
}

/**
 * Retrieves the currently selected model name from the active IDE page DOM.
 */
async function getCurrentModelViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return null;
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const btn = document.querySelector('[aria-label*="Select model" i], [title*="Select model" i], [aria-label*="model" i]');
                    return btn ? btn.textContent.trim() : null;
                })()
            `,
            returnByValue: true
        });
        await client.close();
        return res.result?.value || null;
    } catch (e) {
        try { if (client) await client.close(); } catch(_) {}
        return null;
    }
}

/**
 * Resolves the active project name from the active target title.
 */
async function getActiveProjectNameViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return null;
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState || !syncedState.sidebarSectionsProvider) return null;
                    const provider = syncedState.sidebarSectionsProvider;
                    const sidebarState = typeof provider.getState === 'function' ? provider.getState() : null;
                    if (!sidebarState || !sidebarState.sidebarSections) return null;
                    
                    const urlParams = new URLSearchParams(window.location.search);
                    const currentSectionId = urlParams.get('section');
                    
                    const pathname = window.location.pathname;
                    const convoIdMatch = pathname.match(/\\/c\\/([a-fA-F0-9-]+)/);
                    const currentConvoId = convoIdMatch ? convoIdMatch[1] : null;
                    
                    // 1. Match by section query param
                    if (currentSectionId) {
                        const activeSec = sidebarState.sidebarSections.find(s => s.uri === currentSectionId);
                        if (activeSec && activeSec.label && activeSec.uri !== 'outside-of-project') {
                            return activeSec.label;
                        }
                    }
                    
                    // 2. Scan sections for active conversation ID
                    if (currentConvoId) {
                        for (const sec of sidebarState.sidebarSections) {
                            if (sec.conversations && Array.isArray(sec.conversations)) {
                                const hasConvo = sec.conversations.some(c => 
                                    c.cascadeId === currentConvoId || 
                                    c.conversationId === currentConvoId || 
                                    c.id === currentConvoId ||
                                    (c.summary && typeof c.summary === 'object' && c.summary.trajectoryId === currentConvoId)
                                );
                                if (hasConvo && sec.label && sec.uri !== 'outside-of-project') {
                                    return sec.label;
                                }
                            }
                        }
                    }
                    
                    // 3. Fallback to first project-like section label
                    const firstProjSec = sidebarState.sidebarSections.find(s => s.uri !== 'outside-of-project' && s.label);
                    if (firstProjSec) return firstProjSec.label;
                    
                    return null;
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        if (res.result?.value) {
            return res.result.value;
        }
    } catch (e) {
        try { if (client) await client.close(); } catch(_) {}
    }
    
    // Fallback: Title splitting
    try {
        const title = candidates[0].title;
        if (title) {
            const parts = title.split(' - ');
            // If length is 3 (e.g., "Conversation - Project - Antigravity")
            if (parts.length > 2) {
                let folderPart = parts[parts.length - 2].trim();
                if (folderPart && !folderPart.includes('Antigravity')) {
                    return folderPart;
                }
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Retrieves the human-readable title of the active conversation.
 */
async function getActiveConversationTitleViaCDP(port, conversationId) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return null;
    
    // Primary: try React syncedState lookup for exact precision
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState || !syncedState.sidebarSectionsProvider) return null;
                    const provider = syncedState.sidebarSectionsProvider;
                    const targetId = ${JSON.stringify(conversationId || '')};
                    
                    if (targetId) {
                        // Try 1: check latestSummaries.summaries
                        if (provider.latestSummaries && provider.latestSummaries.summaries) {
                            const sumObj = provider.latestSummaries.summaries[targetId];
                            if (sumObj && sumObj.summary) {
                                return sumObj.summary;
                            }
                        }
                        
                        // Try 2: check standaloneConversations
                        if (provider.standaloneConversations && Array.isArray(provider.standaloneConversations)) {
                            const item = provider.standaloneConversations.find(c => c.cascadeId === targetId);
                            if (item && item.summary && item.summary.summary) {
                                return item.summary.summary;
                            }
                        }
                    }
                    
                    // Fallback to searching any non-empty summary in standaloneConversations
                    if (provider.standaloneConversations && Array.isArray(provider.standaloneConversations)) {
                        const sorted = [...provider.standaloneConversations].sort((a, b) => {
                            const timeA = a.summary ? (a.summary.lastModifiedTime?.seconds || 0) : 0;
                            const timeB = b.summary ? (b.summary.lastModifiedTime?.seconds || 0) : 0;
                            return timeB - timeA;
                        });
                        if (sorted[0] && sorted[0].summary && sorted[0].summary.summary) {
                            return sorted[0].summary.summary;
                        }
                    }
                    
                    return null;
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        
        if (res.result?.value) {
            return res.result.value;
        }
    } catch (e) {
        try { if (client) await client.close(); } catch(_) {}
    }
    
    // Secondary Fallback: Use page/target title
    try {
        const title = candidates[0].title;
        if (title) {
            const parts = title.split(' - ');
            if (parts.length > 1) {
                return parts[0].trim();
            }
            return title.replace(/Antigravity (IDE|Agent)/i, '').replace(/ - $/, '').trim();
        }
    } catch (_) {}
    
    return null;
}

/**
 * Fetches all available standalone conversations in the React syncedState.
 */
async function getConversationsViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return [];
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState || !syncedState.sidebarSectionsProvider) return [];
                    const provider = syncedState.sidebarSectionsProvider;
                    
                    const pathname = window.location.pathname;
                    const convoIdMatch = pathname.match(/\\/c\\/([a-fA-F0-9-]+)/);
                    const currentConvoId = convoIdMatch ? convoIdMatch[1] : null;

                    const urlParams = new URLSearchParams(window.location.search);
                    const currentSectionId = urlParams.get('section');
                    
                    let conversations = [];
                    let foundSection = false;
                    
                    const state = typeof provider.getState === 'function' ? provider.getState() : null;
                    const sections = (state && Array.isArray(state.sidebarSections)) ? state.sidebarSections : (Array.isArray(provider.derivedSections) ? provider.derivedSections : []);

                    // 1. Try matching by section query param
                    if (currentSectionId && sections.length > 0) {
                        const activeSec = sections.find(s => s.uri === currentSectionId);
                        if (activeSec && Array.isArray(activeSec.conversations)) {
                            conversations = activeSec.conversations;
                            foundSection = true;
                        }
                    }
                    
                    // 2. Scan sections for active conversation ID to find the current active project
                    if (!foundSection && currentConvoId && sections.length > 0) {
                        const activeSec = sections.find(sec => {
                            if (sec.uri === 'outside-of-project') return false;
                            return sec.conversations && Array.isArray(sec.conversations) && sec.conversations.some(c => 
                                c.cascadeId === currentConvoId || 
                                c.conversationId === currentConvoId || 
                                c.id === currentConvoId ||
                                (c.summary && typeof c.summary === 'object' && c.summary.trajectoryId === currentConvoId)
                            );
                        });
                        if (activeSec && Array.isArray(activeSec.conversations)) {
                            conversations = activeSec.conversations;
                            foundSection = true;
                        }
                    }
                    
                    // 3. Fallback: if still not found, use the first project-like section that has conversations
                    if (!foundSection && sections.length > 0) {
                        const firstProjSec = sections.find(s => s.uri !== 'outside-of-project' && Array.isArray(s.conversations) && s.conversations.length > 0);
                        if (firstProjSec) {
                            conversations = firstProjSec.conversations;
                            foundSection = true;
                        }
                    }
                    
                    // 4. Ultimate fallback: use standaloneConversations
                    if (!foundSection) {
                        conversations = provider.standaloneConversations || [];
                    }
                    
                    return conversations.map(c => {
                        const summaryText = (c.summary && typeof c.summary === 'object') ? c.summary.summary : (c.summary || null);
                        const lastModifiedSeconds = (c.summary && c.summary.lastModifiedTime) ? c.summary.lastModifiedTime.seconds : null;
                        return {
                            cascadeId: c.conversationId || c.cascadeId || c.id || (c.summary && typeof c.summary === 'object' ? c.summary.trajectoryId : null) || null,
                            summary: summaryText || null,
                            lastModifiedSeconds: lastModifiedSeconds ? String(lastModifiedSeconds) : null
                        };
                    });
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        return res.result?.value || [];
    } catch (e) {
        console.error('[getConversationsViaCDP] Failed:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return [];
    }
}

/**
 * Switches the active conversation/chat by navigating to its URL via CDP.
 */
async function selectConversationViaCDP(conversationId, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return false;
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    try {
                        const currentUrl = window.location.href;
                        const urlObj = new URL(currentUrl);
                        urlObj.pathname = '/c/' + ${JSON.stringify(conversationId)};
                        window.location.href = urlObj.toString();
                        return true;
                    } catch(e) {
                        return false;
                    }
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        return !!res.result?.value;
    } catch (e) {
        console.error('[selectConversationViaCDP] Failed:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return false;
    }
}

/**
 * Renames the conversation title using lsClient.jetboxWriteSummary via CDP.
 */
async function renameConversationViaCDP(conversationId, newTitle, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return false;
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({
            expression: `
                (async () => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    if (!syncedState) return false;
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    if (!provider) return false;
                    
                    const targetId = ${JSON.stringify(conversationId)};
                    const nTitle = ${JSON.stringify(newTitle)};
                    
                    // 1. Resolve correct trajectoryId cleanly to preserve project-workspace association
                    let realTrajectoryId = targetId;
                    if (provider.latestSummaries && provider.latestSummaries.summaries && provider.latestSummaries.summaries[targetId]) {
                        const s = provider.latestSummaries.summaries[targetId];
                        if (s.trajectoryId) realTrajectoryId = s.trajectoryId;
                    }
                    
                    // Fallback to scanning sidebar sections conversations to find the real trajectoryId
                    if (realTrajectoryId === targetId) {
                        const state = typeof provider.getState === 'function' ? provider.getState() : null;
                        const sections = (state && Array.isArray(state.sidebarSections)) ? state.sidebarSections : (Array.isArray(provider.derivedSections) ? provider.derivedSections : []);
                        
                        let found = false;
                        for (const sec of sections) {
                            if (sec.conversations && Array.isArray(sec.conversations)) {
                                for (const c of sec.conversations) {
                                    const cid = c.conversationId || c.cascadeId || c.id;
                                    if (cid === targetId && c.summary && typeof c.summary === 'object' && c.summary.trajectoryId) {
                                        realTrajectoryId = c.summary.trajectoryId;
                                        found = true;
                                        break;
                                    }
                                }
                            }
                            if (found) break;
                        }
                    }
                    
                    const pm = provider.projectManagementFeature;
                    const ls = pm ? pm.lsClient : null;
                    if (!ls) return false;
                    
                    try {
                        // 2. Generate a fresh current timestamp to bypass optimistic concurrency checks
                        const nowSeconds = Math.floor(Date.now() / 1000);
                        const nowNanos = (Date.now() % 1000) * 1000000;
                        
                        // 3. Write the new summary permanently to the backend
                        await ls.jetboxWriteSummary({
                            cascadeId: targetId,
                            summary: {
                                trajectoryId: realTrajectoryId,
                                summary: nTitle,
                                lastModifiedTime: {
                                    seconds: nowSeconds,
                                    nanos: nowNanos
                                }
                            }
                        });
                        
                        // 4. Trigger UI push & re-render cleanly and safely (without dangerous manual in-place state mutations)
                        if (typeof provider.pushUpdate === 'function') {
                            try { provider.pushUpdate(); } catch(e) {}
                        }
                        
                        const emitterKey = Object.keys(provider).find(k => k.includes('emitter'));
                        if (emitterKey && provider[emitterKey] && typeof provider[emitterKey].fire === 'function') {
                            try { provider[emitterKey].fire(); } catch(e) {}
                        }
                        
                        // 5. Update document title
                        try {
                            if (document.title) {
                                const titleParts = document.title.split(' - ');
                                if (titleParts.length > 0) {
                                    titleParts[0] = nTitle;
                                    document.title = titleParts.join(' - ');
                                }
                            }
                        } catch(e) {}
                        
                        return true;
                    } catch(e) {
                        console.error("Rename failed:", e.message);
                        return false;
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });
        await client.close();
        return !!res.result?.value;
    } catch(e) {
        console.error('[renameConversationViaCDP] Error:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return false;
    }
}

/**
 * Switches the active project workspace by navigating to its section via CDP.
 */
async function switchProjectViaCDP(projectNameOrId, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return false;
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    if (!syncedState || !syncedState.sidebarSectionsProvider) {
                        return { success: false, reason: "syncedState or sidebarSectionsProvider not found" };
                    }
                    
                    const provider = syncedState.sidebarSectionsProvider;
                    const sidebarState = typeof provider.getState === 'function' ? provider.getState() : null;
                    if (!sidebarState || !sidebarState.sidebarSections) {
                        return { success: false, reason: "sidebarSections not found" };
                    }
                    
                    const target = ${JSON.stringify(projectNameOrId)};
                    const targetLower = target.toLowerCase();
                    
                    // 1. Try exact match by URI (sectionId)
                    let targetSection = sidebarState.sidebarSections.find(s => 
                        s.uri && s.uri === target
                    );
                    
                    // 2. Try match by label (exact)
                    if (!targetSection) {
                        targetSection = sidebarState.sidebarSections.find(s => 
                            s.label && s.label.toLowerCase() === targetLower
                        );
                    }
                    
                    // 3. Try match by label (includes)
                    if (!targetSection) {
                        targetSection = sidebarState.sidebarSections.find(s => 
                            s.label && s.label.toLowerCase().includes(targetLower)
                        );
                    }
                    
                    // 4. Try reverse match
                    if (!targetSection) {
                        targetSection = sidebarState.sidebarSections.find(s => 
                            s.label && s.label.length > 5 && targetLower.includes(s.label.toLowerCase())
                        );
                    }
                    
                    if (!targetSection) {
                        return { success: false, reason: "Section not found in sidebar: " + target };
                    }
                    
                    const sectionId = targetSection.uri;
                    const conversations = targetSection.conversations || [];
                    if (conversations.length > 0) {
                        const convo = conversations[0];
                        const convoId = convo.conversationId || convo.cascadeId || convo.id || (convo.summary && typeof convo.summary === 'object' ? convo.summary.trajectoryId : null);
                        const newUrl = "/c/" + convoId + "?section=" + sectionId;
                        window.location.href = newUrl;
                        return { success: true, method: "navigation", convoId, sectionId };
                    } else {
                        window.location.href = "/c/new?section=" + sectionId;
                        return { success: true, method: "new_chat_navigation", sectionId };
                    }
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        const val = res.result?.value;
        if (val && val.success) {
            console.log(`[switchProjectViaCDP] Successfully switched project to "${projectNameOrId}" using method: ${val.method}`);
            return true;
        } else {
            console.warn(`[switchProjectViaCDP] Switch failed: ${val ? val.reason : 'unknown evaluation error'}`);
            return false;
        }
    } catch (e) {
        console.error('[switchProjectViaCDP] Failed:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return false;
    }
}

/**
 * Fetches all available projects from the sidebarSections in the React syncedState.
 */
async function getAvailableProjectsViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return [];
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    if (!syncedState || !syncedState.sidebarSectionsProvider) return [];
                    const provider = syncedState.sidebarSectionsProvider;
                    const sidebarState = typeof provider.getState === 'function' ? provider.getState() : null;
                    if (!sidebarState || !sidebarState.sidebarSections) return [];
                    
                    return sidebarState.sidebarSections
                        .filter(s => s.uri !== 'outside-of-project' && s.label)
                        .map(s => ({
                            name: s.label,
                            uri: s.uri
                        }));
                })()
            `,
            returnByValue: true
        });
        await client.close();
        return res.result?.value || [];
    } catch (e) {
        console.error('[getAvailableProjectsViaCDP] Failed:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return [];
    }
}

/**
 * Resolves the currently active conversation ID from the active target.
 */
async function getActiveConversationIdViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return null;
    
    // Try to get it from target URL first (fast, no CDP roundtrip needed)
    for (const target of candidates) {
        if (target.url) {
            const match = target.url.match(/\/c\/([a-fA-F0-9-]+)/);
            if (match) return match[1];
        }
    }
    
    // Fallback: evaluate window.location.pathname via CDP
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const pathname = window.location.pathname;
                    const match = pathname.match(/\\/c\\/([a-fA-F0-9-]+)/);
                    return match ? match[1] : null;
                })()
            `,
            returnByValue: true
        });
        await client.close();
        return res.result?.value || null;
    } catch (e) {
        try { if (client) await client.close(); } catch(_) {}
        return null;
    }
}

/**
 * Uploads and sends an image file alongside an optional caption via CDP.
 */
async function sendImageViaCDP(filePath, captionText, port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        throw new Error("No active Antigravity targets found.");
    }
    
    const target = candidates[0];
    let client;
    try {
        client = await CDP({ target: target.webSocketDebuggerUrl });
        const { DOM, Runtime } = client;
        await DOM.enable();
        await Runtime.enable();
        
        // Ensure the DOM document is loaded and mapped in the CDP backend,
        // otherwise requestNode will fail with "Could not find node with given id"
        await DOM.getDocument();
        
        // 1. Find the file input element and get its remote object ID
        const evalResult = await Runtime.evaluate({
            expression: `document.querySelector('input[type="file"], .chat-input input[type="file"], [class*="chat-input"] input[type="file"], #antigravity input[type="file"], #conversation input[type="file"]')`,
            returnByValue: false
        });
        
        const objectId = evalResult.result?.objectId;
        if (!objectId) {
            throw new Error("Could not find file upload input element in Antigravity UI.");
        }
        
        // 2. Get the nodeId
        const nodeResult = await DOM.requestNode({ objectId });
        const nodeId = nodeResult.nodeId;
        
        // 3. Set the file input files (supports either single path string or array of paths)
        const fileList = Array.isArray(filePath) ? filePath : [filePath];
        await DOM.setFileInputFiles({
            files: fileList,
            nodeId: nodeId
        });
        
        // Note: Chromium's DOM.setFileInputFiles automatically dispatches the 'change' event natively.
        // Manual dispatch is removed to prevent duplicate uploads (e.g. 2 files uploading as 4).
        
        await client.close();
        
        // Wait 1.5 seconds to let the image upload and render in the UI
        await new Promise(r => setTimeout(r, 1500));
        
        // 5. If there is a caption, send it as text, otherwise just trigger the submit button!
        if (captionText && captionText.trim()) {
            await sendViaCDP(captionText, port);
        } else {
            // No caption, just click submit to send the uploaded image!
            client = await CDP({ target: target.webSocketDebuggerUrl });
            await client.Runtime.enable();
            await client.Runtime.evaluate({
                expression: `
                    (() => {
                        const editor = document.querySelector('textarea, [contenteditable="true"]');
                        const panelContainer = editor ? (editor.closest('#antigravity') || editor.closest('#conversation') || document) : document;
                        const submit = panelContainer.querySelector("button.bg-primary, button[class*='bg-primary'], button:has(svg.text-primary-foreground), svg.lucide-arrow-right, svg.lucide-arrow-up, svg[class*='arrow-right'], svg[class*='arrow-up'], svg[class*='send']")?.closest("button");
                        if (submit && !submit.disabled) {
                            submit.click();
                        }
                    })()
                `
            });
            await client.close();
        }
        return true;
    } catch (err) {
        try { if (client) await client.close(); } catch(_) {}
        throw err;
    }
}

/**
 * Safe polling helper to wait until a specific CDP condition is met.
 */
async function waitForTargetReady(port, checkFn, timeoutMs = 8000, intervalMs = 250) {
    const startTime = Date.now();
    let lastError = null;
    while (Date.now() - startTime < timeoutMs) {
        try {
            const res = await checkFn();
            if (res) return res;
        } catch (e) {
            lastError = e;
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for target condition. Last error: ${lastError ? lastError.message : 'none'}`);
}

async function getRunningTasksViaCDP(port) {
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) return [];
    
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const taskList = [];
                    const seen = new Set();
                    
                    const allElements = Array.from(document.querySelectorAll('span, div, p, code'));
                    for (const el of allElements) {
                        const txt = (el.innerText || '').trim();
                        const match = txt.match(/^(task-\\d+):\\s*(.*)/i);
                        if (match) {
                            const taskId = match[1];
                            const command = match[2].trim();
                            const key = taskId + ':' + command;
                            
                            if (!seen.has(key)) {
                                seen.add(key);
                                taskList.push({
                                    taskId: taskId,
                                    command: command
                                });
                            }
                        }
                    }
                    return taskList;
                })()
            `,
            returnByValue: true
        });
        
        await client.close();
        return res.result?.value || [];
    } catch (e) {
        console.error('[getRunningTasksViaCDP] Error:', e.message);
        try { if (client) await client.close(); } catch(_) {}
        return [];
    }
}

module.exports = {
    sendViaCDP,
    triggerNewChat,
    captureFullIDEScreenshot,
    resolveTargets,
    selectModelViaCDP,
    stopAgentViaCDP,
    findActiveApproval,
    respondToApproval,
    checkAgentThinkingStatus,
    queryAntigravityQuota,
    getCurrentModelViaCDP,
    getActiveProjectNameViaCDP,
    getActiveConversationTitleViaCDP,
    getConversationsViaCDP,
    selectConversationViaCDP,
    renameConversationViaCDP,
    switchProjectViaCDP,
    getAvailableProjectsViaCDP,
    sendImageViaCDP,
    getActiveConversationIdViaCDP,
    waitForTargetReady,
    getRunningTasksViaCDP
};


