const fs = require('fs');
const content = fs.readFileSync('src/cdp_controller.js', 'utf8');

const lines = content.split('\n');
let insideBackticks = false;
lines.forEach((line, idx) => {
    if (line.includes('`')) {
        // Toggle (simplified, ignores multiple backticks on same line)
        const occurrences = (line.match(/`/g) || []).length;
        if (occurrences % 2 !== 0) {
            insideBackticks = !insideBackticks;
        }
    }
    if (insideBackticks) {
        if (line.includes('match(/') || line.includes('replace(/') || line.includes('.test(/')) {
            console.log(`Line ${idx + 1}: ${line.trim()}`);
        }
    }
});
