const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logDir = __dirname;
const out = fs.openSync(path.join(logDir, 'bg_out.log'), 'w');
const err = fs.openSync(path.join(logDir, 'bg_err.log'), 'w');

const child = spawn(process.execPath, [path.join(__dirname, 'src', 'index.js')], {
  detached: true,
  stdio: [ 'ignore', out, err ],
  cwd: __dirname
});

child.unref();
console.log(`🤖 Bot spawned successfully in background with PID: ${child.pid}`);
process.exit(0);
