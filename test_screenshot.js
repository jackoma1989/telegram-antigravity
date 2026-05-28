const { captureFullIDEScreenshot } = require('./src/cdp_controller');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        console.log("Capturing screenshot from port 9223...");
        const buffer = await captureFullIDEScreenshot(9223);
        const dest = path.join(__dirname, 'scratch', 'screenshot.png');
        fs.writeFileSync(dest, buffer);
        console.log("Screenshot successfully saved to:", dest);
    } catch (e) {
        console.error("Failed to capture screenshot:", e.message);
    }
}

run();
