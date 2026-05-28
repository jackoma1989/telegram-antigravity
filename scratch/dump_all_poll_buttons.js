const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'approval_poll.log');
const content = fs.readFileSync(logPath, 'utf8');

const blocks = content.split('\n---\n');
const allUniqueButtonTexts = new Set();

for (const block of blocks) {
    if (block.trim() === '' || block.includes('=== POLLING START ===') || block.includes('=== POLLING END ===')) continue;
    try {
        const obj = JSON.parse(block.trim());
        obj.allVisibleButtons.forEach(b => {
            allUniqueButtonTexts.add(b.text);
        });
    } catch (e) {}
}

console.log("ALL UNIQUE BUTTON TEXTS FOUND IN POLL LOG:");
console.log(Array.from(allUniqueButtonTexts));
