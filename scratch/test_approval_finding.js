const { findActiveApproval, resolveTargets } = require('../src/cdp_controller');
const CDP = require('chrome-remote-interface');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const port = parseInt(process.env.AGENT_CDP_PORT || '9223', 10);

async function run() {
    console.log("=== POLLING APPROVALS WITH FULL LOGGING ===");
    console.log("CDP Port:", port);
    
    const intervalId = setInterval(async () => {
        try {
            const approval = await findActiveApproval(port);
            if (approval) {
                console.log(`[${new Date().toLocaleTimeString()}] Active Approval Detected!`, approval);
            } else {
                process.stdout.write(".");
            }
        } catch (e) {
            console.error(`\n[${new Date().toLocaleTimeString()}] Error in findActiveApproval:`, e.message, e.stack);
        }
    }, 1000);
    
    // Stop after 60 seconds
    setTimeout(() => {
        clearInterval(intervalId);
        console.log("\nPolling ended.");
        process.exit(0);
    }, 60000);
}

run();
