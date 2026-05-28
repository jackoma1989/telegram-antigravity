const {
    selectModel,
    sendViaCDP,
    snapshotChatState,
    waitForAgentResponse,
    getFullLatestResponse,
} = require('./cdp_controller');
const { t } = require('./i18n');

/**
 * Runs the Multi-Agent "Agents Council" workflow.
 * Phase 1: Planning (Claude)
 * Phase 2: Execution (Gemini)
 * Phase 3: Review (Claude)
 * Phase 4: Fix (Gemini) [Conditional]
 */
async function runTurboOrchestration(query, CDP_PORT, explicitTargetId, ctx, createProgressHandler, stripQueryFromResponse) {
    let statusMsgId = null;

    try {
        // Send initial status
        const statusMsg = await ctx.reply(t('turbo.p1_start') || '🚀 <b>Turbo Mod Başlatıldı:</b>\n\n⏳ <b>Faz 1:</b> Model seçiliyor (Claude)...', { parse_mode: 'HTML' });
        statusMsgId = statusMsg.message_id;

        // --- PHASE 1: PLANNING (Claude) ---
        await selectModel(CDP_PORT, "Claude Opus 4.6 (Thinking)", explicitTargetId);
        await new Promise(r => setTimeout(r, 800));

        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsgId, null,
            t('turbo.p1_planning') || '🚀 <b>Turbo Mod Başlatıldı:</b>\n\n⏳ <b>Faz 1:</b> Claude planı hazırlıyor...',
            { parse_mode: 'HTML' }
        ).catch(() => {});

        const pmPrompt = `You are the Project Manager and Lead Architect. Create a detailed, step-by-step implementation plan for the following request. List the files to create/modify, the architecture decisions, and define clear tasks. Do NOT write the final code yet.\n\nUser Request: ${query}`;
        
        const sentTargetId = await sendViaCDP(pmPrompt, CDP_PORT, explicitTargetId);
        await new Promise(r => setTimeout(r, 2000));
        await snapshotChatState(CDP_PORT, explicitTargetId).catch(() => {});
        
        let isDone = await waitForAgentResponse(CDP_PORT, 600000, createProgressHandler(ctx), sentTargetId);
        if (!isDone) throw new Error(t('turbo.p1_error') || "Claude planlama aşamasında zaman aşımına uğradı.");

        let planText = await getFullLatestResponse(CDP_PORT, sentTargetId);
        planText = stripQueryFromResponse(planText, pmPrompt);

        // Update Telegram Status
        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsgId, null,
            t('turbo.p2_switching') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Claude planı tamamladı.\n⏳ <b>Faz 2:</b> Model değiştiriliyor (Gemini)...',
            { parse_mode: 'HTML' }
        ).catch(() => {});

        // --- PHASE 2: EXECUTION (Gemini) ---
        await selectModel(CDP_PORT, "Gemini 3.1 Pro (High)", sentTargetId);
        await new Promise(r => setTimeout(r, 800));

        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsgId, null,
            t('turbo.p2_coding') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Claude planı tamamladı.\n⏳ <b>Faz 2:</b> Gemini kodları yazıyor...',
            { parse_mode: 'HTML' }
        ).catch(() => {});

        const coderPrompt = `You are the Lead Developer. The Project Manager (Claude) has created the following implementation plan. Execute it precisely — write the code, create/modify the files as specified. Follow the plan strictly.\n\n--- PLAN ---\n${planText}\n--- END PLAN ---`;
        
        const sentTargetId2 = await sendViaCDP(coderPrompt, CDP_PORT, sentTargetId);
        await new Promise(r => setTimeout(r, 2000));
        await snapshotChatState(CDP_PORT, sentTargetId).catch(() => {});
        
        isDone = await waitForAgentResponse(CDP_PORT, 600000, createProgressHandler(ctx), sentTargetId2);
        if (!isDone) throw new Error(t('turbo.p2_error') || "Gemini kodlama aşamasında zaman aşımına uğradı.");

        let codeText = await getFullLatestResponse(CDP_PORT, sentTargetId2);
        codeText = stripQueryFromResponse(codeText, coderPrompt);

        // --- PHASE 3: REVIEW (Claude) ---
        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsgId, null,
            t('turbo.p3_switching') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Planlama\n✅ <b>Faz 2:</b> Kodlama\n⏳ <b>Faz 3:</b> Model değiştiriliyor (Claude) - İnceleme...',
            { parse_mode: 'HTML' }
        ).catch(() => {});

        await selectModel(CDP_PORT, "Claude Opus 4.6 (Thinking)", sentTargetId2);
        await new Promise(r => setTimeout(r, 800));

        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsgId, null,
            t('turbo.p3_reviewing') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Planlama\n✅ <b>Faz 2:</b> Kodlama\n⏳ <b>Faz 3:</b> Claude yazılan kodu inceliyor...',
            { parse_mode: 'HTML' }
        ).catch(() => {});

        const reviewPrompt = `You are the Security Auditor and Code Reviewer. Review the code that was just written.\nIf you find critical bugs or security issues, list them clearly with "ISSUES_FOUND: true".\nIf everything looks good, respond with "ISSUES_FOUND: false".`;
        
        const sentTargetId3 = await sendViaCDP(reviewPrompt, CDP_PORT, sentTargetId2);
        await new Promise(r => setTimeout(r, 2000));
        await snapshotChatState(CDP_PORT, sentTargetId2).catch(() => {});
        
        isDone = await waitForAgentResponse(CDP_PORT, 600000, createProgressHandler(ctx), sentTargetId3);
        if (!isDone) throw new Error(t('turbo.p3_error') || "Claude inceleme aşamasında zaman aşımına uğradı.");

        let reviewText = await getFullLatestResponse(CDP_PORT, sentTargetId3);
        reviewText = stripQueryFromResponse(reviewText, reviewPrompt);
        
        let fixText = "N/A";
        const hasIssues = reviewText.includes("ISSUES_FOUND: true");

        if (hasIssues) {
            // --- PHASE 4: FIX (Gemini) ---
            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsgId, null,
                t('turbo.p4_switching') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Planlama\n✅ <b>Faz 2:</b> Kodlama\n⚠️ <b>Faz 3:</b> Hatalar bulundu!\n⏳ <b>Faz 4:</b> Model değiştiriliyor (Gemini) - Düzeltme...',
                { parse_mode: 'HTML' }
            ).catch(() => {});

            await selectModel(CDP_PORT, "Gemini 3.1 Pro (High)", sentTargetId3);
            await new Promise(r => setTimeout(r, 800));

            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsgId, null,
                t('turbo.p4_fixing') || '🚀 <b>Turbo Mod Aktif:</b>\n\n✅ <b>Faz 1:</b> Planlama\n✅ <b>Faz 2:</b> Kodlama\n⚠️ <b>Faz 3:</b> Hatalar bulundu!\n⏳ <b>Faz 4:</b> Gemini hataları düzeltiyor...',
                { parse_mode: 'HTML' }
            ).catch(() => {});

            const fixPrompt = `You are the Lead Developer. The Security Auditor found issues in the previous implementation. Please fix all the issues mentioned by the Auditor.`;
            
            const sentTargetId4 = await sendViaCDP(fixPrompt, CDP_PORT, sentTargetId3);
            await new Promise(r => setTimeout(r, 2000));
            await snapshotChatState(CDP_PORT, sentTargetId3).catch(() => {});
            
            isDone = await waitForAgentResponse(CDP_PORT, 600000, createProgressHandler(ctx), sentTargetId4);
            if (!isDone) throw new Error(t('turbo.p4_error') || "Gemini düzeltme aşamasında zaman aşımına uğradı.");

            fixText = await getFullLatestResponse(CDP_PORT, sentTargetId4);
            fixText = stripQueryFromResponse(fixText, fixPrompt);

        }

        let fallbackText = hasIssues ? fixText : reviewText;

        // --- PHASE 5: EXECUTIVE SUMMARY (Gemini) ---
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsgId, null,
                t('turbo.p5_summarizing') || '⏳ Faz 5: Sonuç özeti hazırlanıyor...',
                { parse_mode: 'HTML' }
            ).catch(() => {});

        if (!hasIssues) {
            // Model is currently Claude (from Review phase), switch to Gemini for summary
            await selectModel(CDP_PORT, "Gemini 3.1 Pro (High)", sentTargetId3);
            await new Promise(r => setTimeout(r, 800));
        }

        const summaryPrompt = `You are a Project Manager summarizing a completed multi-agent coding session for the user.

Here is what happened:
- PHASE 1 (Planning):
${planText.substring(0, 500)}...

- PHASE 2 (Coding):
${codeText.substring(0, 500)}...

- PHASE 3 (Review):
${reviewText.substring(0, 500)}...

- PHASE 4 (Fix):
${hasIssues ? fixText.substring(0, 500) + "..." : "N/A"}

Write a brief, user-friendly summary in the user's language. Include:
1. What was requested
2. What files were created/modified
3. Key decisions made
4. Current status (ready to test, needs attention, etc.)

Keep it concise (max 10 lines). Use emoji for readability.`;

        const lastTargetId = hasIssues ? sentTargetId4 : sentTargetId3;
        const sentTargetId5 = await sendViaCDP(summaryPrompt, CDP_PORT, lastTargetId);
        await new Promise(r => setTimeout(r, 2000));
        await snapshotChatState(CDP_PORT, lastTargetId).catch(() => {});
        
        isDone = await waitForAgentResponse(CDP_PORT, 300000, createProgressHandler(ctx), sentTargetId5);
        if (!isDone) throw new Error(t('turbo.p5_error') || "Özet aşamasında zaman aşımına uğradı.");

            let summaryText = await getFullLatestResponse(CDP_PORT, sentTargetId5);
            summaryText = stripQueryFromResponse(summaryText, summaryPrompt);

            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsgId, null,
                t('turbo.done_summary') || '✨ Turbo Mod Tamamlandı (Özet hazır)',
                { parse_mode: 'HTML' }
            ).catch(() => {});

            return summaryText;
        } catch (summaryErr) {
            console.error('[turbo] Phase 5 (Summary) failed, falling back to raw output:', summaryErr.message);
            // Revert status message to done_issues / done_no_issues
            if (hasIssues) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, statusMsgId, null,
                    t('turbo.done_issues') || '🚀 <b>Turbo Mod Tamamlandı:</b>\n\n✅ <b>Faz 1:</b> Planlama (Claude)\n✅ <b>Faz 2:</b> Kodlama (Gemini)\n⚠️ <b>Faz 3:</b> İnceleme (Claude)\n✅ <b>Faz 4:</b> Düzeltme (Gemini)\n\n✨ Sonuçlar geliyor...',
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, statusMsgId, null,
                    t('turbo.done_no_issues') || '🚀 <b>Turbo Mod Tamamlandı:</b>\n\n✅ <b>Faz 1:</b> Planlama (Claude)\n✅ <b>Faz 2:</b> Kodlama (Gemini)\n✅ <b>Faz 3:</b> İnceleme - Sorun Yok (Claude)\n\n✨ Sonuçlar geliyor...',
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
            return fallbackText;
        }

    } catch (err) {
        console.error('[turbo] Orchestration error:', err.message);
        if (statusMsgId) {
            const errTitle = t('turbo.error_title') ? t('turbo.error_title').replace('{error}', err.message) : `❌ <b>Turbo Mod Hatası:</b>\n\n${err.message}`;
            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsgId, null,
                errTitle,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
        throw err;
    }
}

module.exports = {
    runTurboOrchestration
};
