/**
 * @file controlPanel.js
 * @description Builds and updates the 15-button interactive Arabic control panel for owned temporary voice channels.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');
const db = require('../database/database');
const { getConfig, resolveColor, applyEmbedFooter, getButtonEmoji } = require('../config/botConfig');
const cacheService = require('../services/cacheService');
const { activeChannelsCache } = cacheService;

/**
 * Generates the Discord message payload for the 15-button temporary voice channel control panel.
 * Gracefully handles missing `image.png` buffer without throwing filesystem errors.
 * @param {string} channelName Voice channel name
 * @param {string|null} ownerId Owner Discord User ID
 * @param {boolean} isLocked Whether the channel is locked
 * @param {number} memberLimit Channel member limit (0 for unlimited)
 * @returns {object} Discord message payload ({ embeds, files, components })
 */
function createControlPanel(channelName, ownerId, isLocked = false, memberLimit = 0) {
    const config = getConfig();
    const imgBuf = cacheService.getPanelImageBuffer();
    const files = [];

    const statusText = isLocked ? '🔒 مغلق' : '🔓 مفتوح';
    const limitText = memberLimit > 0 ? `${memberLimit} عضو` : 'غير محدود (∞)';
    const ownerMention = ownerId ? `<@${ownerId}>` : 'عام';

    const embed = new EmbedBuilder()
        .setColor(resolveColor(config.panelColor, 0x2B2D31))
        .setTitle(config.panelTitle)
        .setDescription(
            `${config.panelDescription}\n\n` +
            `👑 **المالك:** ${ownerMention} | **الحالة:** ${statusText} | **الحد:** ${limitText}\n` +
            `*يمكن استخدام هذه الواجهة بالنقر فوق الأزرار أدناه*`
        )
        .setTimestamp();

    applyEmbedFooter(embed, config.embedFooter);

    if (imgBuf) {
        files.push(new AttachmentBuilder(imgBuf, { name: 'image.png' }));
        embed.setImage('attachment://image.png');
    }

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tempvc_action_topic').setEmoji(getButtonEmoji('topic')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_waiting').setEmoji(getButtonEmoji('waiting')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_privacy').setEmoji(getButtonEmoji('privacy')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_limit').setEmoji(getButtonEmoji('limit')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_rename').setEmoji(getButtonEmoji('rename')).setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tempvc_action_region').setEmoji(getButtonEmoji('region')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_kick').setEmoji(getButtonEmoji('kick')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_invite').setEmoji(getButtonEmoji('invite')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_untrust').setEmoji(getButtonEmoji('untrust')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_trust').setEmoji(getButtonEmoji('trust')).setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tempvc_action_delete').setEmoji(getButtonEmoji('delete')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tempvc_action_transfer').setEmoji(getButtonEmoji('transfer')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_claim').setEmoji(getButtonEmoji('claim')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_unban').setEmoji(getButtonEmoji('unban')).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tempvc_action_ban').setEmoji(getButtonEmoji('ban')).setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], files, components: [row1, row2, row3] };
}

/**
 * Updates an existing control panel message embed in a temporary voice channel without re-uploading `image.png`.
 * @param {import('discord.js').VoiceChannel} channel Voice channel containing the control panel
 * @param {string|null} ownerId Current owner Discord User ID
 * @param {boolean} isLocked Whether the channel is locked
 * @param {number} memberLimit Current member limit
 * @returns {Promise<void>}
 */
async function updateControlPanelEmbed(channel, ownerId, isLocked, memberLimit) {
    try {
        if (!channel || !channel.messages) return;

        const cached = activeChannelsCache.get(channel.id);
        let panelMessage = null;

        if (cached?.panel_message_id) {
            panelMessage = channel.messages.cache.get(cached.panel_message_id) ||
                           await channel.messages.fetch(cached.panel_message_id).catch(() => null);
        }

        if (!panelMessage) {
            const recentMessages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
            if (recentMessages) {
                const panelTitle = getConfig().panelTitle;
                panelMessage = recentMessages.find((m) => {
                    if (m.author?.id !== channel.client.user?.id || m.embeds.length === 0) return false;
                    const hasPanelButtons = m.components?.some((row) =>
                        row.components?.some((comp) => comp.customId?.startsWith('tempvc_action_'))
                    );
                    return hasPanelButtons || m.embeds[0].title === panelTitle;
                });
                if (panelMessage) {
                    if (cached) cached.panel_message_id = panelMessage.id;
                    await db.updateActiveChannelPanelMessage(channel.id, panelMessage.id).catch((err) => {
                        console.warn('[ControlPanel Warn] Failed to persist panel message ID:', err.message);
                    });
                }
            }
        }

        if (panelMessage) {
            const panelData = createControlPanel(channel.name, ownerId, isLocked, memberLimit);
            await panelMessage.edit({
                embeds: panelData.embeds,
                components: panelData.components
            }).catch((err) => {
                console.warn('[ControlPanel Warn] Failed to edit control panel embed:', err.message);
            });
        }
    } catch (err) {
        console.error('[ControlPanel Error] Unexpected error updating control panel embed:', err);
    }
}

module.exports = {
    createControlPanel,
    updateControlPanelEmbed
};
