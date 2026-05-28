const OriginalCDP = require('chrome-remote-interface');
const http = require('http');
require('dotenv').config();

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
            console.log("No active pages found.");
            return;
        }

        console.log("Connecting to target:", candidates[0].title);
        const client = await OriginalCDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                 (async () => {
                    try {
                        const editor = document.querySelector('[contenteditable="true"]');
                        if (!editor) return { error: "No editor found" };

                        editor.focus();
                        
                        // Let's create a range and select the editor node
                        const range = document.createRange();
                        range.selectNodeContents(editor);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                        
                        await new Promise(r => setTimeout(r, 100));
                        
                        // Select all and delete current text
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                        
                        // Wait a tiny bit
                        await new Promise(r => setTimeout(r, 100));

                        // Insert test text
                        const textToType = "Hello from automated test script! " + Date.now();
                        const inserted = document.execCommand('insertText', false, textToType);
                        
                        if (!inserted) {
                            // Fallback to textContent and event dispatch
                            editor.textContent = textToType;
                            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: textToType }));
                            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: textToType }));
                            editor.dispatchEvent(new Event("change", { bubbles: true }));
                        }

                        await new Promise(r => setTimeout(r, 200));

                        // Find the submit button
                        const btn = document.querySelector('button.bg-primary, button[class*="bg-primary"], button:has(svg.text-primary-foreground)');
                        
                        return {
                            editorText: editor.textContent,
                            inserted: inserted,
                            activeElementTag: document.activeElement ? document.activeElement.tagName : null,
                            activeElementClass: document.activeElement ? document.activeElement.className : null,
                            submitButtonFound: !!btn,
                            submitButtonClass: btn ? btn.className : null
                        };
                    } catch (e) {
                        return { error: e.message };
                    }
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log("TYPE TEST RESULT:");
        console.log(JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
