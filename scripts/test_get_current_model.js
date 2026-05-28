const { resolveTargets } = require('../src/cdp_controller');
const CDP = require('chrome-remote-interface');

async function run() {
    try {
        const targets = await resolveTargets(9223);
        if (!targets.length) {
            console.log('No targets found');
            return;
        }
        const client = await CDP({ target: targets[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const btn = document.querySelector('[aria-label*="Select model" i], [title*="Select model" i], [aria-label*="model" i]');
                    if (!btn) return { error: "Button not found" };
                    return {
                        text: btn.textContent.trim(),
                        ariaLabel: btn.getAttribute('aria-label'),
                        title: btn.getAttribute('title'),
                        innerHTML: btn.innerHTML
                    };
                })()
            `,
            returnByValue: true
        });
        console.log(JSON.stringify(res.result.value, null, 2));
        await client.close();
    } catch(e) {
        console.error("Error:", e.message);
    }
}
run();
