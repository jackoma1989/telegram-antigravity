const fs = require('fs');
const content = fs.readFileSync('src/cdp_controller.js', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('\\${')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
