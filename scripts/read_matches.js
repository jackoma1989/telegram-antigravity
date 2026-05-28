const fs = require('fs');
const path = require('path');

const targetPath = 'C:\\Users\\JackoMA\\.gemini\\antigravity\\brain\\3e53fdd1-f3f7-4b1c-b361-8ae659ac8fbe\\.system_generated\\logs\\transcript.jsonl';

async function run() {
    try {
        if (!fs.existsSync(targetPath)) {
            console.log("File does not exist.");
            return;
        }
        
        const content = fs.readFileSync(targetPath, 'utf8');
        const lines = content.split('\n');
        
        console.log(`Total lines: ${lines.length}`);
        
        // Print lines that contain quota, limit or search terms
        lines.forEach((line, idx) => {
            if (line.toLowerCase().includes('quota') || line.toLowerCase().includes('limit') || line.toLowerCase().includes('额度')) {
                console.log(`\n--- Line ${idx + 1} ---`);
                try {
                    const parsed = JSON.parse(line);
                    console.log(`Source: ${parsed.source}, Type: ${parsed.type}`);
                    if (parsed.thinking) {
                        console.log(`Thinking: ${parsed.thinking}`);
                    }
                    if (parsed.content) {
                        console.log(`Content: ${parsed.content}`);
                    }
                    if (parsed.tool_calls) {
                        console.log(`Tool Calls: ${JSON.stringify(parsed.tool_calls, null, 2)}`);
                    }
                } catch(e) {
                    console.log(line.substring(0, 500));
                }
            }
        });
    } catch(e) {
        console.error("Error:", e.message);
    }
}

run();
