const { getConversationsViaCDP } = require('./src/cdp_controller');
require('dotenv').config();

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function run() {
    try {
        console.log(`Calling getConversationsViaCDP on port ${port}...`);
        const conversations = await getConversationsViaCDP(port);
        console.log("CONVERSATIONS OBTAINED:");
        console.log(JSON.stringify(conversations, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
