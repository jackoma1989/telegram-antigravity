const { renameConversationViaCDP } = require('../src/cdp_controller');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function main() {
    const convoId = '1a9755e7-ff4c-47be-8ae7-77e68fa27de7';
    console.log(`Attempting to rename conversation ${convoId} to "test_rename_direct"...`);
    try {
        const success = await renameConversationViaCDP(convoId, 'test_rename_direct', port);
        console.log(`Result: ${success ? 'SUCCESS' : 'FAILED'}`);
    } catch (e) {
        console.error("Error occurred:", e);
    }
}

main();
