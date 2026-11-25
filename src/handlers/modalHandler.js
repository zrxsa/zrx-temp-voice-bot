/**
 * @file modalHandler.js
 * @description Handles modal form submissions for temporary voice channels (rename, member limit, voice topic).
 * Enforces Discord's 2-renames-per-10-minutes channel rate limit before calling `channel.setName`.
 */

const { MessageFlags } = require('discord.js');
const db = require('../database/database');
const { updateControlPanelEmbed } = require('../components/controlPanel');
const { checkChannelRenameLimit } = require('../services/cacheService');

/**
 * Processes modal submit interactions for temporary voice channels.
 * @param {import('discord.js').ModalSubmitInteraction} interaction Modal interaction
 * @param {object} activeChannel Active channel record from cache/DB
 * @returns {Promise<void>}
 */
async function handleModalSubmit(interaction, activeChannel) {
    const customId = interaction.customId;

    try {
        if (customId === 'tempvc_modal_rename') {
            const newName = (interaction.fields.getTextInputValue('tempvc_input_name') || '').trim().slice(0, 100);
            if (!newName) {
                await interaction.reply({
                    content: '❌ الاسم المدخل غير صالح.',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Guard against Discord's 2-renames-per-10-minutes limit so the REST queue never blocks for 10 mins
            const { allowed, remainingSec } = checkChannelRenameLimit(interaction.channelId);
            if (!allowed) {
                const mins = Math.ceil(remainingSec / 60);
                await interaction.reply({
                    content: `⏳ قيود ديسكورد تسمح بتغيير اسم الروم مرتين فقط كل 10 دقائق. يرجى الانتظار حوالي **${mins} دقيقة** (${remainingSec} ثانية) قبل تغيير الاسم مجدداً.`,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            await interaction.channel.setName(newName);
            await db.updateActiveChannelName(interaction.channelId, newName);
            activeChannel.name = newName;

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'تغيير الاسم',
                details: `تعديل الاسم إلى: ${newName}`
            }).catch((err) => {
                console.warn('[ModalHandler Warn] Failed to log rename event:', err.message);
            });

            await updateControlPanelEmbed(
                interaction.channel,
                activeChannel.owner_id,
                activeChannel.is_locked === 1,
                activeChannel.member_limit
            );

            await interaction.editReply({
                content: `📝 تم تغيير اسم الروم الصوتي بنجاح إلى: **${newName}**`
            });
            return;
        }

        if (customId === 'tempvc_modal_limit') {
            const limitStr = interaction.fields.getTextInputValue('tempvc_input_limit');
            const limit = parseInt(limitStr, 10);

            if (isNaN(limit) || limit < 0 || limit > 99) {
                await interaction.reply({
                    content: '❌ عدد الأعضاء يجب أن يكون رقماً صحيحاً بين 0 و 99.',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            await interaction.channel.setUserLimit(limit);
            await db.updateActiveChannelLimit(interaction.channelId, limit);
            activeChannel.member_limit = limit;

            const detailsLabel = limit === 0 ? 'إلغاء الحد الأقصى' : `تحديد الحد بـ ${limit} أعضاء`;
            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'تعديل الحد الأقصى',
                details: detailsLabel
            }).catch((err) => {
                console.warn('[ModalHandler Warn] Failed to log limit event:', err.message);
            });

            await updateControlPanelEmbed(
                interaction.channel,
                activeChannel.owner_id,
                activeChannel.is_locked === 1,
                limit
            );

            await interaction.editReply({
                content: limit === 0
                    ? '👥 تم إلغاء الحد الأقصى للأعضاء بنجاح!'
                    : `👥 تم تحديد الحد الأقصى بـ **${limit}** عضو بنجاح!`
            });
            return;
        }

        if (customId === 'tempvc_modal_topic') {
            const topicText = (interaction.fields.getTextInputValue('tempvc_input_topic') || '').trim().slice(0, 100);

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            await interaction.client.rest.put(`/channels/${interaction.channelId}/voice-status`, {
                body: { status: topicText }
            }).catch((err) => {
                console.warn('[ModalHandler Warn] Could not set voice status:', err.message);
            });

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'تعديل الحالة (Topic)',
                details: `تعديل الحالة إلى: ${topicText}`
            }).catch((err) => {
                console.warn('[ModalHandler Warn] Failed to log topic event:', err.message);
            });

            await interaction.editReply({
                content: `#️⃣ تم تعديل حالة الروم الصوتي إلى:\n**${topicText}**`
            });
        }
    } catch (err) {
        console.error('[Modal Handler Error]', err);
        const errorMsg = '❌ فشل تحديث خصائص الروم. يرجى التحقق من صلاحيات البوت.';
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMsg }).catch(() => null);
        } else {
            await interaction.reply({ content: errorMsg, flags: [MessageFlags.Ephemeral] }).catch(() => null);
        }
    }
}

module.exports = {
    handleModalSubmit
};
