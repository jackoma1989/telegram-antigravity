const { resolveTargets } = require('../src/cdp_controller');
const http = require('http');
require('dotenv').config();

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    try {
        const raw = await httpGet(`http://127.0.0.1:${port}/json`);
        const targets = JSON.parse(raw);
        console.log("=== ALL CDP TARGETS ===");
        targets.forEach((t, i) => {
            console.log(`Target ${i}: Title="${t.title}" Type="${t.type}" URL="${t.url}"`);
        });

        const candidates = await resolveTargets(port);
        console.log("\n=== FILTERED CANDIDATES ===");
        candidates.forEach((t, i) => {
            console.log(`Candidate ${i}: Title="${t.title}" URL="${t.url}"`);
        });
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
