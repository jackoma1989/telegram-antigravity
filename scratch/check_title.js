const { resolveTargets } = require('../src/cdp_controller');
require('dotenv').config();
const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function run() {
    try {
        const targets = await resolveTargets(port);
        console.log(JSON.stringify(targets, null, 2));
    } catch(e) {
        console.error("Error:", e.message);
    }
}
run();
