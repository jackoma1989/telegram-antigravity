// A simple infinite loop script for testing TeleGravity's task monitoring and /killall command
console.log("🚀 Test loop started successfully! This process will run infinitely until terminated.");

setInterval(() => {
    console.log(`[TestLoop] Active tick at ${new Date().toLocaleTimeString()}...`);
}, 2000);
