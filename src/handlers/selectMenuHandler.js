/**
 * @file selectMenuHandler.js
 * @description Handles User Select Menus and String Select Menus for temporary voice channels
 * (kick, ban, unban, trust, untrust, transfer ownership, privacy options, and RTC voice region).
 */

const { MessageFlags } = require('discord.js');
const db = require('../database/database');
const { updateControlPanelEmbed } = require('../components/controlPanel');

/**
 * Safely sends an error response for a select menu interaction regardless of whether it was deferred or replied.
 * @param {import('discord.js').AnySelectMenuInteraction} interaction Select menu interaction
 * @param {string} message Arabic error message
 * @returns {Promise<void>}
 */
async function safeSelectError(interaction, message) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: message, components: [] });
        } else {
            await interaction.reply({ content: message, flags: [MessageFlags.Ephemeral] });
        }
    } catch (err) {
        if (err.code !== 10062) {
            console.warn('[SelectMenu Warn] Could not send error reply:', err.message);
        }
    }
}

/**
 * Handles User Select Menu interactions (`kick`, `ban`, `transfer`, `trust`, `untrust`).
 * @param {import('discord.js').UserSelectMenuInteraction} interaction User select menu interaction
 * @param {object} activeChannel Active channel record from cache/DB
 * @returns {Promise<void>}
 */
async function handleUserSelectMenu(interaction, activeChannel) {
    const customId = interaction.customId;
    const targetId = interaction.values[0];

    try {
        await interaction.deferUpdate();

        if (customId === 'tempvc_select_kick') {
            const targetMember = interaction.guild.members.cache.get(targetId) ||
                                 await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: '❌ لم يتم العثور على العضو.', components: [] });
                return;
            }

            if (targetMember.voice.channelId !== interaction.channelId) {
                await interaction.editReply({
                    content: '❌ هذا العضو غير متواجد حالياً في رومك الصوتي لطرده!',
                    components: []
                });
                return;
            }

            await targetMember.voice.disconnect('طرد من الروم المؤقت').catch((err) => {
                console.warn('[SelectMenu Warn] Failed to disconnect kicked member:', err.message);
            });

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'طرد عضو',
                details: `طرد العضو: ${targetMember.user.tag}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log kick event:', err.message);
            });

            await interaction.editReply({
                content: `👢 تم طرد العضو **${targetMember.user.username}** من الروم الصوتي بنجاح!`,
                components: []
            });
            return;
        }

        if (customId === 'tempvc_select_ban') {
            const targetMember = interaction.guild.members.cache.get(targetId) ||
                                 await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: '❌ لم يتم العثور على العضو.', components: [] });
                return;
            }

            if (targetId === activeChannel.owner_id) {
                await interaction.editReply({ content: '❌ لا يمكنك حظر نفسك!', components: [] });
                return;
            }

            await interaction.channel.permissionOverwrites.edit(targetMember, {
                Connect: false,
                ViewChannel: false
            });

            if (targetMember.voice.channelId === interaction.channelId) {
                await targetMember.voice.disconnect('تم الحظر من الروم').catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to disconnect banned member:', err.message);
                });
            }

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'حظر عضو',
                details: `حظر العضو: ${targetMember.user.tag}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log ban event:', err.message);
            });

            await interaction.editReply({
                content: `🚫 تم حظر العضو **${targetMember.user.username}** ومنعه من دخول الروم بنجاح!`,
                components: []
            });
            return;
        }

        if (customId === 'tempvc_select_transfer') {
            if (targetId === activeChannel.owner_id) {
                await interaction.editReply({ content: '❌ أنت بالفعل مالك هذا الروم!', components: [] });
                return;
            }

            const targetMember = interaction.guild.members.cache.get(targetId) ||
                                 await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: '❌ لم يتم العثور على العضو المطلوب.', components: [] });
                return;
            }

            await interaction.channel.permissionOverwrites.edit(targetMember, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                SendMessages: true,
                MuteMembers: true,
                DeafenMembers: true,
                MoveMembers: true
            });

            await db.updateActiveChannelOwner(interaction.channelId, targetId);
            activeChannel.owner_id = targetId;

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'نقل ملكية',
                details: `نقل ملكية الروم إلى: ${targetMember.user.tag}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log transfer event:', err.message);
            });

            await updateControlPanelEmbed(
                interaction.channel,
                targetId,
                activeChannel.is_locked === 1,
                activeChannel.member_limit
            );

            await interaction.editReply({
                content: `👑 تم نقل ملكية هذا الروم المؤقت بنجاح للعضو: **${targetMember.user.username}**`,
                components: []
            });
            return;
        }

        if (customId === 'tempvc_select_trust') {
            const targetMember = interaction.guild.members.cache.get(targetId) ||
                                 await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: '❌ لم يتم العثور على العضو المطلوب.', components: [] });
                return;
            }

            await interaction.channel.permissionOverwrites.edit(targetMember, {
                Connect: true,
                ViewChannel: true
            });

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'منح ثقة',
                details: `منح العضو الثقة لتجاوز القفل: ${targetMember.user.tag}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log trust event:', err.message);
            });

            await interaction.editReply({
                content: `🤝 تم منح العضو **${targetMember.user.username}** الثقة بنجاح!`,
                components: []
            });
            return;
        }

        if (customId === 'tempvc_select_untrust') {
            const targetMember = interaction.guild.members.cache.get(targetId) ||
                                 await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: '❌ لم يتم العثور على العضو المطلوب.', components: [] });
                return;
            }

            await interaction.channel.permissionOverwrites.delete(targetId);

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'سحب ثقة',
                details: `سحب الثقة من العضو: ${targetMember.user.tag}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log untrust event:', err.message);
            });

            await interaction.editReply({
                content: `💔 تم سحب الثقة من العضو **${targetMember.user.username}** بنجاح!`,
                components: []
            });
        }
    } catch (err) {
        console.error('[User Select Menu Error]', err);
        await safeSelectError(interaction, '❌ حدث خطأ أثناء تنفيذ الإجراء.');
    }
}

/**
 * Handles String Select Menu interactions (`privacy_options`, `region`, `unban`).
 * @param {import('discord.js').StringSelectMenuInteraction} interaction String select menu interaction
 * @param {object} activeChannel Active channel record from cache/DB
 * @returns {Promise<void>}
 */
async function handleStringSelectMenu(interaction, activeChannel) {
    const customId = interaction.customId;
    const selectValue = interaction.values[0];

    try {
        await interaction.deferUpdate();

        if (customId === 'tempvc_select_privacy_options') {
            const everyoneRole = interaction.guild.roles.everyone;

            if (selectValue === 'lock') {
                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    Connect: false
                });
                if (activeChannel.owner_id) {
                    await interaction.channel.permissionOverwrites.edit(activeChannel.owner_id, {
                        Connect: true
                    });
                }
                await db.updateActiveChannelLock(interaction.channelId, true);
                activeChannel.is_locked = 1;
                await updateControlPanelEmbed(interaction.channel, activeChannel.owner_id, true, activeChannel.member_limit);

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'قفل الروم',
                    details: 'تم إغلاق الروم الصوتي (فقط الموثوقون يمكنهم الدخول)'
                }).catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to log lock event:', err.message);
                });

                await interaction.editReply({
                    content: '🔒 تم إغلاق الروم بنجاح! فقط المستخدمون الموثوقون بإمكانهم الدخول.',
                    components: []
                });
                return;
            }

            if (selectValue === 'unlock') {
                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    Connect: null
                });
                await db.updateActiveChannelLock(interaction.channelId, false);
                activeChannel.is_locked = 0;
                await updateControlPanelEmbed(interaction.channel, activeChannel.owner_id, false, activeChannel.member_limit);

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'فتح الروم',
                    details: 'تم فتح الروم الصوتي للجميع'
                }).catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to log unlock event:', err.message);
                });

                await interaction.editReply({
                    content: '🔓 تم فتح الروم بنجاح! الجميع بإمكانهم الدخول الآن.',
                    components: []
                });
                return;
            }

            if (selectValue === 'hide') {
                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    ViewChannel: false
                });
                if (activeChannel.owner_id) {
                    await interaction.channel.permissionOverwrites.edit(activeChannel.owner_id, {
                        ViewChannel: true,
                        Connect: true
                    });
                }

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'إخفاء الروم',
                    details: 'تم إخفاء الروم الصوتي (غير مرئي)'
                }).catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to log hide event:', err.message);
                });

                await interaction.editReply({
                    content: '🙈 تم إخفاء الروم بنجاح! فقط المستخدمون الموثوقون بإمكانهم رؤية الروم.',
                    components: []
                });
                return;
            }

            if (selectValue === 'show') {
                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    ViewChannel: null
                });

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'إظهار الروم',
                    details: 'تم إظهار الروم الصوتي للجميع'
                }).catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to log show event:', err.message);
                });

                await interaction.editReply({
                    content: '👁️ تم إظهار الروم بنجاح! الجميع سيملك الصلاحية لرؤية الروم.',
                    components: []
                });
                return;
            }

            if (selectValue === 'chat') {
                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    SendMessages: false
                });
                if (activeChannel.owner_id) {
                    await interaction.channel.permissionOverwrites.edit(activeChannel.owner_id, {
                        SendMessages: true
                    });
                }

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'محادثة خاصة',
                    details: 'تم قفل المحادثة النصية للروم (فقط الموثوقون يمكنهم الإرسال)'
                }).catch((err) => {
                    console.warn('[SelectMenu Warn] Failed to log chat lock event:', err.message);
                });

                await interaction.editReply({
                    content: '💬 تم تفعيل محادثة خاصة بنجاح! فقط الموثوقون بإمكانهم الإرسال في المحادثة.',
                    components: []
                });
                return;
            }
        }

        if (customId === 'tempvc_select_region') {
            const region = selectValue === 'null' ? null : selectValue;

            await interaction.channel.setRTCRegion(region);

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'تعديل منطقة الصوت',
                details: `تعديل المنطقة الجغرافية لخادم الصوت إلى: ${region || 'تلقائي'}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log region event:', err.message);
            });

            await interaction.editReply({
                content: `🌐 تم تعديل المنطقة الجغرافية لخادم الصوت بنجاح إلى: **${region || 'تلقائي (Automatic)'}**`,
                components: []
            });
            return;
        }

        if (customId === 'tempvc_select_unban') {
            const targetId = selectValue;

            await interaction.channel.permissionOverwrites.delete(targetId);

            const targetUser = interaction.client.users.cache.get(targetId) ||
                               await interaction.client.users.fetch(targetId).catch(() => null);

            db.logEvent(interaction.channelId, 'control', {
                user: { id: interaction.user.id, username: interaction.user.username },
                action: 'رفع حظر',
                details: `إلغاء حظر العضو: ${targetUser ? targetUser.tag : targetId}`
            }).catch((err) => {
                console.warn('[SelectMenu Warn] Failed to log unban event:', err.message);
            });

            await interaction.editReply({
                content: `🔓 تم إلغاء حظر العضو **${targetUser ? targetUser.username : targetId}** وتمكينه من الدخول مجدداً!`,
                components: []
            });
        }
    } catch (err) {
        console.error('[String Select Menu Error]', err);
        await safeSelectError(interaction, '❌ حدث خطأ أثناء تنفيذ الخيار.');
    }
}

module.exports = {
    handleUserSelectMenu,
    handleStringSelectMenu
};
