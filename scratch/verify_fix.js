const CDP = require('chrome-remote-interface');
const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

// Load the FIXED ui_locators script
const { UI_LOCATORS_SCRIPT } = require('../src/ui_locators');

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
                ${UI_LOCATORS_SCRIPT}
                (() => {
                    const chatArea = AG_UI.getVisibleChatContainer();
                    const stopBtn = AG_UI.getStopButton();
                    const isLoading = AG_UI.isLoading();
                    const isThinking = !!(stopBtn || isLoading);
                    
                    return JSON.stringify({
                        chatAreaFound: !!chatArea,
                        chatAreaClass: chatArea ? (typeof chatArea.className === 'string' ? chatArea.className.substring(0, 100) : '') : null,
                        stopBtnFound: !!stopBtn,
                        stopBtnHtml: stopBtn ? stopBtn.outerHTML.substring(0, 200) : null,
                        isLoading,
                        isThinking
                    }, null, 2);
                })()
            `,
            returnByValue: true
        });

        console.log("FIXED checkAgentThinkingStatus RESULT:");
        console.log(res.result.value);
        await client.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
