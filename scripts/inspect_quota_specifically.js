const CDP = require('chrome-remote-interface');
const http = require('http');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    try {
        const raw = await httpGet('http://127.0.0.1:9223/json');
        const targets = JSON.parse(raw);
        const candidates = targets.filter(t => 
            (t.type === 'page' || t.type === 'webview') &&
            t.webSocketDebuggerUrl &&
            !t.url.includes('devtools://') &&
            t.title !== 'Manager'
        );

        if (candidates.length === 0) {
            console.log("No valid candidates found.");
            return;
        }

        const client = await CDP({ target: candidates[0].webSocketDebuggerUrl });
        const { Runtime } = client;
        await Runtime.enable();

        const res = await Runtime.evaluate({
            expression: `
                (() => {
                    const roots = Array.from(document.querySelectorAll('#root, #app, body > div'));
                    let syncedState = null;
                    
                    for (const root of roots) {
                        const key = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
                        if (key) {
                            let fiber = root[key];
                            let current = fiber;
                            for (let i = 0; i < 20; i++) {
                                if (current && current.pendingProps && current.pendingProps.syncedState) {
                                    syncedState = current.pendingProps.syncedState;
                                    break;
                                }
                                current = current ? current.child : null;
                            }
                            if (syncedState) break;
                        }
                    }
                    
                    if (!syncedState || !syncedState.userStatusProvider) return "No userStatusProvider found";
                    
                    const state = syncedState.userStatusProvider.getState();
                    if (!state) return "State is empty";
                    
                    // Extract only top-level fields (omitting huge model details list first, or showing it briefly)
                    const topKeys = Object.keys(state);
                    const modelQuotas = [];
                    
                    if (state.clientModelConfigs) {
                        state.clientModelConfigs.forEach(m => {
                            modelQuotas.push({
                                label: m.label,
                                pricingType: m.pricingType,
                                isPremium: m.isPremium,
                                remainingFraction: m.quotaInfo?.remainingFraction,
                                resetTimeSeconds: m.quotaInfo?.resetTime?.seconds ? String(m.quotaInfo.resetTime.seconds) : null
                            });
                        });
                    }

                    // Dump weekly/other limits if any in userTier
                    const tierInfo = state.userTier ? {
                        id: state.userTier.id,
                        name: state.userTier.name,
                        description: state.userTier.description,
                        availableCredits: state.userTier.availableCredits ? state.userTier.availableCredits.map(c => ({
                            creditType: c.creditType,
                            creditAmount: String(c.creditAmount),
                            minimumCreditAmountForUsage: String(c.minimumCreditAmountForUsage)
                        })) : null
                    } : null;
                    
                    return {
                        keys: topKeys,
                        userTier: tierInfo,
                        modelQuotas: modelQuotas,
                        rawStatusKeys: Object.keys(state)
                    };
                })()
            `,
            returnByValue: true
        });

        console.log("=== Specific Quota Details ===");
        console.log(JSON.stringify(res.result?.value, null, 2));
        
        await client.close();
    } catch (e) {
        console.error("Error inspecting synced state:", e.message);
    }
}

run();
