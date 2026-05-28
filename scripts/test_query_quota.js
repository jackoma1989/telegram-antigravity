const { queryAntigravityQuota } = require('../src/cdp_controller');

async function test() {
    try {
        console.log("Calling queryAntigravityQuota(9223)...");
        const data = await queryAntigravityQuota(9223);
        console.log("Success! Output:");
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error running test:", err.message);
    }
}

test();
