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

        // Part 1: Understand the full page layout
        const res1 = await Runtime.evaluate({
            expression: `
                (() => {
                    // Get body's direct children
                    const bodyChildren = Array.from(document.body.children).map(c => ({
                        tag: c.tagName,
                        id: c.id,
                        className: typeof c.className === 'string' ? c.className.substring(0, 200) : '',
                        childCount: c.children.length,
                        isVisible: c.offsetParent !== null || c === document.body,
                        w: c.clientWidth,
                        h: c.clientHeight
                    }));

                    // Look for the main content area that holds the chat
                    const chatInput = document.querySelector('[aria-label="Message input"]');
                    let chatInputPath = [];
                    if (chatInput) {
                        let curr = chatInput;
                        while (curr && curr !== document.body) {
                            let desc = curr.tagName;
                            if (curr.id) desc += '#' + curr.id;
                            if (curr.className && typeof curr.className === 'string') {
                                const cls = curr.className.substring(0, 120);
                                desc += '.' + cls.split(' ').join('.');
                            }
                            chatInputPath.unshift(desc);
                            curr = curr.parentElement;
                        }
                    }

                    // Find the sidebar vs main content split
                    const sidebar = document.querySelector('[class*="sidebar"]');
                    let sidebarInfo = null;
                    if (sidebar) {
                        sidebarInfo = {
                            tag: sidebar.tagName,
                            id: sidebar.id,
                            className: typeof sidebar.className === 'string' ? sidebar.className.substring(0, 200) : '',
                            w: sidebar.clientWidth,
                            h: sidebar.clientHeight
                        };
                    }

                    // Check for the cancel button context - is it truly in the "thinking" state?
                    const cancelBtn = document.querySelector('[aria-label="Cancel (Ctrl+D)"]');
                    const sendBtn = document.querySelector('[aria-label*="Send"]');
                    
                    return JSON.stringify({
                        bodyChildren,
                        chatInputPath,
                        sidebarInfo,
                        hasCancelBtn: !!cancelBtn,
                        hasSendBtn: !!sendBtn,
                        sendBtnHtml: sendBtn ? sendBtn.outerHTML.substring(0, 200) : null,
                        cancelBtnVisible: cancelBtn ? cancelBtn.offsetParent !== null : false
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("PAGE STRUCTURE:");
        console.log(res1.result.value);

        // Part 2: Check what the spinners' parents look like
        const res2 = await Runtime.evaluate({
            expression: `
                (() => {
                    const spinners = Array.from(document.querySelectorAll('[class*="animate-spin"]'));
                    
                    // Group spinners by their grandparent context
                    const contexts = spinners.map(el => {
                        // Check if this spinner is inside the sidebar
                        const inSidebar = !!el.closest('[class*="sidebar"]');
                        // Check if inside the main chat area
                        const inInputBox = !!el.closest('.agentSidePanelInputBox, [class*="input"]');
                        // Check dimensions
                        const w = parseInt(el.getAttribute('width') || '0');
                        const h = parseInt(el.getAttribute('height') || '0');
                        // Check if parent has class "hidden"
                        const parentHidden = el.parentElement ? 
                            (el.parentElement.className && typeof el.parentElement.className === 'string' ? 
                                el.parentElement.className.includes('hidden') : false) : false;
                        
                        return { inSidebar, inInputBox, w, h, parentHidden };
                    });

                    // Count by context
                    const sidebarCount = contexts.filter(c => c.inSidebar).length;
                    const inputCount = contexts.filter(c => c.inInputBox).length;
                    const otherCount = contexts.filter(c => !c.inSidebar && !c.inInputBox).length;
                    const hiddenCount = contexts.filter(c => c.parentHidden).length;
                    const smallCount = contexts.filter(c => c.w <= 12 && c.h <= 12).length;

                    return JSON.stringify({
                        totalSpinners: spinners.length,
                        sidebarCount,
                        inputCount, 
                        otherCount,
                        hiddenCount,
                        smallCount,
                        first3Contexts: contexts.slice(0, 3)
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("\nSPINNER CONTEXT ANALYSIS:");
        console.log(res2.result.value);

        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
