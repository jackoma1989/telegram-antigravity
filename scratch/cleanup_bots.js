const { exec } = require('child_process');

function runCommand(cmd) {
    return new Promise((resolve) => {
        exec(cmd, (err, stdout, stderr) => {
            resolve({ err, stdout, stderr });
        });
    });
}

async function run() {
    console.log("=== ENHANCED ZOMBIE BOT CLEANUP ===");
    
    // Query all node.exe processes
    const queryCmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'node.exe'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"`;
    const { stdout } = await runCommand(queryCmd);
    
    let processes = [];
    try {
        processes = JSON.parse(stdout);
        if (!Array.isArray(processes)) {
            processes = [processes];
        }
    } catch (e) {
        // Fallback if parsing failed
    }

    let killCount = 0;
    const currentPid = process.pid;

    for (const proc of processes) {
        if (!proc || !proc.ProcessId || proc.ProcessId === currentPid) continue;
        const cmdLine = proc.CommandLine || '';
        
        // Target any node processes running telegravity, src/index.js, or index.js
        if (cmdLine.includes('index.js') || cmdLine.includes('telegravity') || cmdLine.includes('spawn_bg.js')) {
            console.log(`Killing target process PID ${proc.ProcessId}: ${cmdLine}`);
            await runCommand(`powershell -Command "Stop-Process -Id ${proc.ProcessId} -Force"`);
            killCount++;
        }
    }

    console.log(`Cleanup completed! Killed ${killCount} duplicate bot process(es).`);
    process.exit(0);
}

run();
