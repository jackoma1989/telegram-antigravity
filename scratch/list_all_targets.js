const http = require('http');

function listTargets(port) {
    http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const targets = JSON.parse(data);
                console.log('Total targets:', targets.length);
                targets.forEach((t, i) => {
                    console.log(`[Target ${i}]`);
                    console.log('  ID:', t.id);
                    console.log('  Title:', t.title);
                    console.log('  URL:', t.url);
                    console.log('  Type:', t.type);
                    console.log('  WebSocket:', t.webSocketDebuggerUrl);
                });
            } catch (e) {
                console.error('Failed to parse:', e.message);
            }
        });
    }).on('error', (e) => console.error('Error:', e.message));
}

listTargets(9223);
