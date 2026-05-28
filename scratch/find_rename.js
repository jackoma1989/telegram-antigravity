const fs = require('fs');
const content = fs.readFileSync('src/index.js', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('rename') || line.includes('awaiting_rename')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
