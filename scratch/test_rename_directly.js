const { renameConversationViaCDP } = require('../src/cdp_controller');
require('dotenv').config();
const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function run() {
    const activeConvoId = "29a4e31a-dcbd-4735-be7f-af5a4d59d5e5";
    const newTitle = "测试重命名-" + Date.now();
    console.log(`Attempting to rename conversation ${activeConvoId} to ${newTitle}...`);
    try {
        const success = await renameConversationViaCDP(activeConvoId, newTitle, port);
        console.log("Result:", success);
    } catch(e) {
        console.error("Crash:", e);
    }
}
run();
