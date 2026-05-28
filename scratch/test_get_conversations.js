const { getConversationsViaCDP, resolveTargets } = require('../src/cdp_controller');

async function test() {
    try {
        const targets = await resolveTargets(9223);
        console.log("=== Resolved Targets ===");
        console.log(targets.map(t => ({ id: t.id, title: t.title, url: t.url, type: t.type })));
        
        const convos = await getConversationsViaCDP(9223);
        console.log("=== Conversations fetched ===");
        console.log(convos);
    } catch(e) {
        console.error("Failed to fetch:", e);
    }
}

test();
