const { getActiveProjectNameViaCDP } = require('../src/cdp_controller');
require('dotenv').config();
const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function run() {
    try {
        const name = await getActiveProjectNameViaCDP(port);
        console.log("Returned project name:", name);
    } catch(e) {
        console.error("Error:", e.message);
    }
}
run();
