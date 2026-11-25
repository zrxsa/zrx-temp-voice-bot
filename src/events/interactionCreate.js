/**
 * @file interactionCreate.js
 * @description Central interaction router for slash commands, control panel buttons, modals, and select menus.
 */

const { Events, MessageFlags } = require('discord.js');
const db = require('../database/database');
const { activeChannelsCache, checkButtonCooldown } = require('../services/cacheService');
const { handleChatInputCommand } = require('../handlers/commandHandler');
const { handleButtonInteraction } = require('../handlers/buttonHandler');
const { handleModalSubmit } = require('../handlers/modalHandler');
const { handleUserSelectMenu, handleStringSelectMenu } = require('../handlers/selectMenuHandler');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    /**
     * Routes incoming Discord interactions to the appropriate handler.
     * @param {import('discord.js').Interaction} interaction Discord interaction
     * @returns {Promise<void>}
     */
    async execute(interaction) {
        try {
            // 1. Application Slash Commands
            if (interaction.isChatInputCommand()) {
                await handleChatInputCommand(interaction);
                return;
            }

            // 2. TempVoice Control Panel Components
            const customId = interaction.customId;
            if (!customId || !customId.startsWith('tempvc_')) return;

            // Enforce 3-second interaction cooldown per user
            const { onCooldown, remainingSec } = checkButtonCooldown(interaction.user.id, 3000);
            if (onCooldown) {
                await interaction.reply({
                    content: `⏳ **هدئ من سرعتك!** يرجى الانتظار **${remainingSec}** ثانية قبل الضغط مجدداً لتجنب الضغط على البوت.`,
                    flags: [MessageFlags.Ephemeral]
                }).catch((err) => {
                    if (err.code !== 10062) console.warn('[Interaction Warn] Cooldown reply failed:', err.message);
                });
                return;
            }

            // Fast in-memory lookup with SQLite fallback
            let activeChannel = activeChannelsCache.get(interaction.channelId);
            if (!activeChannel) {
                activeChannel = await db.getActiveChannel(interaction.channelId).catch(() => null);
                if (activeChannel) {
                    activeChannelsCache.set(interaction.channelId, activeChannel);
                }
            }

            if (!activeChannel) {
                await interaction.reply({
                    content: '❌ عذراً، لا يمكن تطبيق هذا الإجراء. يبدو أن هذا الروم ليس روماً مؤقتاً مسجلاً.',
                    flags: [MessageFlags.Ephemeral]
                }).catch((err) => {
                    if (err.code !== 10062) console.warn('[Interaction Warn] Invalid channel reply failed:', err.message);
                });
                return;
            }

            // Verify ownership for owned channels (except when claiming an abandoned channel)
            if (
                activeChannel.type === 'owned' &&
                activeChannel.owner_id !== interaction.user.id &&
                customId !== 'tempvc_action_claim'
            ) {
                await interaction.reply({
                    content: '❌ عذراً، أنت لست مالك هذا الروم! لا يمكنك التحكم به.',
                    flags: [MessageFlags.Ephemeral]
                }).catch((err) => {
                    if (err.code !== 10062) console.warn('[Interaction Warn] Non-owner reply failed:', err.message);
                });
                return;
            }

            // 3. Dispatch to specific component handler
            if (interaction.isButton()) {
                await handleButtonInteraction(interaction, activeChannel);
                return;
            }

            if (interaction.isModalSubmit()) {
                await handleModalSubmit(interaction, activeChannel);
                return;
            }

            if (interaction.isUserSelectMenu()) {
                await handleUserSelectMenu(interaction, activeChannel);
                return;
            }

            if (interaction.isStringSelectMenu()) {
                await handleStringSelectMenu(interaction, activeChannel);
            }
        } catch (err) {
            console.error('[InteractionCreate Error]', err);
        }
    }
};
