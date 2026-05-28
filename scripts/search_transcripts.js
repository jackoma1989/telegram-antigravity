const fs = require('fs');
const path = require('path');
const os = require('os');

const brainPath = 'C:\\Users\\JackoMA\\.gemini\\antigravity\\brain';

async function run() {
    try {
        if (!fs.existsSync(brainPath)) {
            console.log("Brain path does not exist.");
            return;
        }

        const dirs = fs.readdirSync(brainPath);
        console.log(`Found ${dirs.length} items in brain path.`);

        const keywords = ['quota', '额度', '5小时', '每周', 'limit'];

        for (const dirName of dirs) {
            const transcriptPath = path.join(brainPath, dirName, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                try {
                    const content = fs.readFileSync(transcriptPath, 'utf8');
                    const lines = content.split('\n');
                    let found = false;
                    let matchLines = [];
                    
                    lines.forEach((line, idx) => {
                        if (keywords.some(k => line.toLowerCase().includes(k))) {
                            found = true;
                            matchLines.push({ lineNum: idx + 1, content: line.substring(0, 150) });
                        }
                    });
                    
                    if (found) {
                        console.log(`\n========================================`);
                        console.log(`MATCH in folder: ${dirName}`);
                        console.log(`Number of matching lines: ${matchLines.length}`);
                        matchLines.slice(0, 5).forEach(m => {
                            console.log(`  Line ${m.lineNum}: ${m.content}`);
                        });
                    }
                } catch(e) {
                    // Ignore errors reading individual files
                }
            }
        }
    } catch(e) {
        console.error("Error:", e.message);
    }
}

run();
