const CDP = require('chrome-remote-interface');

async function resolveTargets(port) {
    const http = require('http');
    return new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    resolve(targets.filter(t => t.webSocketDebuggerUrl));
                } catch (e) {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

async function run() {
    const port = 9223;
    const candidates = await resolveTargets(port);
    if (candidates.length === 0) {
        console.error('No CDP targets found on port', port);
        return;
    }
    
    console.log('Connecting to target:', candidates[0].webSocketDebuggerUrl);
    let client;
    try {
        client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const sidebarElements = Array.from(document.querySelectorAll('*')).filter(el => {
                        return el.textContent && el.textContent.includes('能够发送');
                    });
                    
                    return sidebarElements.map(el => ({
                        tagName: el.tagName,
                        className: el.className,
                        text: el.textContent ? el.textContent.substring(0, 100) : ''
                    }));
                })()
            `,
            returnByValue: true
        });
        
        console.log('Result:', JSON.stringify(res.result?.value, null, 2));
        await client.close();
    } catch (e) {
        console.error('Error:', e);
        if (client) await client.close();
    }
}

run();
