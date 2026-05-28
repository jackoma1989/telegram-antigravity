const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'approval_poll.log');
const content = fs.readFileSync(logPath, 'utf8');

const blocks = content.split('\n---\n');

const approvalButtonTexts = [
    'yes, allow this time', 'yes, always allow', 'allow running this command',
    'run', 'accept changes', 'accept', 'always allow', 'allow', 'approve',
    'çalıştır', 'kabul et', 'her zaman izin ver', 'izin ver',
    '同意', '允许', '运行', '接受', '总是允许', '允许一次', '允许执行', '确定', '确认', '同意并运行', '允许运行此命令',
    'submit', '提交', '仅允许此次', '始终允许', '允许此次', '仅这一次'
];

let matchCount = 0;

for (const block of blocks) {
    if (block.trim() === '' || block.includes('=== POLLING START ===') || block.includes('=== POLLING END ===')) continue;
    try {
        const obj = JSON.parse(block.trim());
        const activeMatch = obj.allVisibleButtons.find(b => {
            const text = b.text.toLowerCase();
            return approvalButtonTexts.some(kw => text.includes(kw));
        });

        if (activeMatch) {
            console.log(`[${obj.time}] Match Found:`, activeMatch);
            matchCount++;
        }
    } catch (e) {}
}

console.log("TOTAL MATCHES FOUND WITH FUZZY LOGIC:", matchCount);
