const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
    console.error('DIAGNOSE uncaughtException:', err.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('DIAGNOSE unhandledRejection:', reason);
});

console.log('Starting diagnose.js...');
try {
    require('../src/index.js');
    console.log('src/index.js loaded successfully!');
} catch (e) {
    console.error('DIAGNOSE load error:', e.stack || e);
}

// Keep event loop alive
setInterval(() => {
    console.log('diagnose.js heart-beat...');
}, 5000);
