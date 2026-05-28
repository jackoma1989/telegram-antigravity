const http = require('http');

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
        const raw = await httpGet('http://127.0.0.1:9223/json');
        console.log(JSON.stringify(JSON.parse(raw), null, 2));
    } catch (e) {
        console.error("Error fetching targets:", e.message);
    }
}

run();
