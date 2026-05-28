const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'approval_poll.log');
const content = fs.readFileSync(logPath, 'utf8');

const blocks = content.split('\n---\n');
const matchedEntries = [];

for (const block of blocks) {
    if (block.trim() === '' || block.includes('=== POLLING START ===') || block.includes('=== POLLING END ===')) continue;
    try {
        const obj = JSON.parse(block.trim());
        // Find if any button text contains Chinese characters or matches typical popup buttons
        const hasInterestingButtons = obj.allVisibleButtons.some(b => {
            const t = b.text;
            return t.includes('仅') || t.includes('允许') || t.includes('始终') || t.includes('同意') || t.includes('运行') || t.includes('拒绝');
        });

        if (hasInterestingButtons) {
            matchedEntries.push({
                time: obj.time,
                interestingButtons: obj.allVisibleButtons.filter(b => {
                    const t = b.text;
                    return t.includes('仅') || t.includes('允许') || t.includes('始终') || t.includes('同意') || t.includes('运行') || t.includes('拒绝');
                })
            });
        }
    } catch (e) {
        // ignore malformed blocks
    }
}

console.log("INTERESTING ENTRIES FOUND:", matchedEntries.length);
console.log(JSON.stringify(matchedEntries.slice(0, 15), null, 2));
