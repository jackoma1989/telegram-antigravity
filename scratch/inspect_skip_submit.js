const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'approval_poll.log');
const content = fs.readFileSync(logPath, 'utf8');

const blocks = content.split('\n---\n');

for (const block of blocks) {
    if (block.trim() === '' || block.includes('=== POLLING START ===') || block.includes('=== POLLING END ===')) continue;
    try {
        const obj = JSON.parse(block.trim());
        const targetBtn = obj.allVisibleButtons.find(b => b.text.includes('skip') || b.text.includes('submit'));
        if (targetBtn) {
            console.log("MATCHING BUTTON ENTRY:");
            console.log(JSON.stringify({
                time: obj.time,
                button: targetBtn
            }, null, 2));
            break;
        }
    } catch (e) {}
}
