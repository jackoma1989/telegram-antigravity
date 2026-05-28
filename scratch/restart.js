const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Kill old bot processes using WMIC or PowerShell
function killOldBot() {
    return new Promise((resolve) => {
        // Query processes via PowerShell since it is native on Windows
        const psCommand = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'node.exe'\\" | Where-Object { $_.CommandLine -like '*src/index.js*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
        
        exec(psCommand, (err, stdout, stderr) => {
            console.log("Kill output:", stdout, stderr);
            resolve();
        });
    });
}

async function run() {
    console.log("Stopping old bot instances...");
    await killOldBot();
    
    console.log("Starting new bot instance...");
    const spawnBgPath = path.join(__dirname, '..', 'spawn_bg.js');
    exec(`node "${spawnBgPath}"`, (err, stdout, stderr) => {
        if (err) {
            console.error("Failed to start bot:", err.message);
        } else {
            console.log(stdout.trim());
        }
        process.exit(0);
    });
}

run();
