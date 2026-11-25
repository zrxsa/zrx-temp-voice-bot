/**
 * @file buttonHandler.js
 * @description Handles all 15 control panel button interactions for temporary voice channels.
 * Uses deferred replies for multi-step Discord API operations to prevent 3-second interaction timeouts.
 */

const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    PermissionsBitField,
    MessageFlags,
    OverwriteType
} = require('discord.js');
const db = require('../database/database');
const { updateControlPanelEmbed } = require('../components/controlPanel');
const { archiveAndDeleteChannel } = require('../services/voiceService');

/**
 * Safely sends an error response to a button interaction regardless of whether it was already deferred or replied.
 * @param {import('discord.js').ButtonInteraction} interaction Button interaction
 * @param {string} message Arabic error message to display
 * @returns {Promise<void>}
 */
async function safeErrorReply(interaction, message) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: message, components: [] });
        } else {
            await interaction.reply({ content: message, flags: [MessageFlags.Ephemeral] });
        }
    } catch (err) {
        if (err.code !== 10062) {
            console.warn('[ButtonHandler Warn] Could not send error reply:', err.message);
        }
    }
}

/**
 * Processes a control panel button interaction.
 * @param {import('discord.js').ButtonInteraction} interaction Button interaction
 * @param {object} activeChannel Active channel record from cache/DB
 * @returns {Promise<void>}
 */
async function handleButtonInteraction(interaction, activeChannel) {
    const customId = interaction.customId;

    try {
        switch (customId) {
            case 'tempvc_action_rename': {
                const modal = new ModalBuilder()
                    .setCustomId('tempvc_modal_rename')
                    .setTitle('📝 تعديل اسم الروم الصوتي');

                const nameInput = new TextInputBuilder()
                    .setCustomId('tempvc_input_name')
                    .setLabel('الاسم الجديد للروم')
                    .setPlaceholder((activeChannel.name || 'روم صوتي').slice(0, 50))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(50)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(modal);
                break;
            }

            case 'tempvc_action_limit': {
                const modal = new ModalBuilder()
                    .setCustomId('tempvc_modal_limit')
                    .setTitle('👥 تحديد عدد الأعضاء');

                const limitInput = new TextInputBuilder()
                    .setCustomId('tempvc_input_limit')
                    .setLabel('العدد الأقصى المسموح به (0 لإلغاء الحد)')
                    .setPlaceholder(String(activeChannel.member_limit ?? 0))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
                await interaction.showModal(modal);
                break;
            }

            case 'tempvc_action_privacy': {
                const select = new StringSelectMenuBuilder()
                    .setCustomId('tempvc_select_privacy_options')
                    .setPlaceholder('حدد خيار الخصوصية')
                    .addOptions(
                        {
                            label: 'إغلاق',
                            description: 'فقط المستخدمون الموثوقون بإمكانهم الدخول إلى الروم الخاص بك الصوتي',
                            value: 'lock',
                            emoji: '🔒'
                        },
                        {
                            label: 'فتح',
                            description: 'الجميع بإمكانهم الدخول إلى الروم الخاص بك الصوتي',
                            value: 'unlock',
                            emoji: '🔓'
                        },
                        {
                            label: 'غير مرئي',
                            description: 'فقط المستخدمون الموثوقون بإمكانهم رؤية الروم الخاص بك الصوتي',
                            value: 'hide',
                            emoji: '🙈'
                        },
                        {
                            label: 'مرئي',
                            description: 'الجميع سيملك الصلاحية لرؤية الروم الصوتي الخاصة بك',
                            value: 'show',
                            emoji: '👁️'
                        },
                        {
                            label: 'محادثة خاصة',
                            description: 'فقط المستخدمون الموثوقون بإمكانهم الإرسال في المحادثة الخاصة بك',
                            value: 'chat',
                            emoji: '💬'
                        }
                    );

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '⚙️ **خيارات الخصوصية والأمان للروم الصوتي:**',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_waiting': {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                const everyoneRole = interaction.guild.roles.everyone;
                const currentOverwrites = interaction.channel.permissionOverwrites.cache.get(everyoneRole.id);
                const isLocked = Boolean(currentOverwrites?.deny.has(PermissionsBitField.Flags.Connect));
                const nextLockState = !isLocked;

                await interaction.channel.permissionOverwrites.edit(everyoneRole, {
                    Connect: nextLockState ? false : null
                });

                await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
                    Connect: true
                });

                await db.updateActiveChannelLock(interaction.channelId, nextLockState);
                activeChannel.is_locked = nextLockState ? 1 : 0;
                await updateControlPanelEmbed(interaction.channel, activeChannel.owner_id, nextLockState, activeChannel.member_limit);

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'غرفة الانتظار',
                    details: nextLockState ? 'تفعيل غرفة الانتظار (منع الدخول)' : 'إلغاء تفعيل غرفة الانتظار (السماح بالدخول)'
                }).catch((err) => {
                    console.warn('[ButtonHandler Warn] Failed to log waiting room event:', err.message);
                });

                await interaction.editReply({
                    content: nextLockState
                        ? '🕒 تم تفعيل غرفة الانتظار (تم قفل الروم)!'
                        : '🕒 تم إلغاء غرفة الانتظار (يمكن للجميع الدخول الآن)!'
                });
                break;
            }

            case 'tempvc_action_topic': {
                const modal = new ModalBuilder()
                    .setCustomId('tempvc_modal_topic')
                    .setTitle('#️⃣ تعديل حالة الروم (Topic)');

                const topicInput = new TextInputBuilder()
                    .setCustomId('tempvc_input_topic')
                    .setLabel('حالة الروم الصوتي الحالية')
                    .setPlaceholder('مثال: لعب وتسلية / نقاشات')
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(100)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(topicInput));
                await interaction.showModal(modal);
                break;
            }

            case 'tempvc_action_trust': {
                const select = new UserSelectMenuBuilder()
                    .setCustomId('tempvc_select_trust')
                    .setPlaceholder('اختر العضو لمنحه الثقة...')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '👤 اختر العضو الذي تريد منحه الثقة للدخول وتجاوز القيود:',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_untrust': {
                const select = new UserSelectMenuBuilder()
                    .setCustomId('tempvc_select_untrust')
                    .setPlaceholder('اختر العضو لإلغاء ثقته...')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '👤 اختر العضو لسحب صلاحية الثقة وتجاوز القيود منه:',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_invite': {
                const invite = await interaction.channel.createInvite({
                    maxAge: 86400,
                    maxUses: 10
                }).catch(() => null);

                if (!invite) {
                    await interaction.reply({
                        content: '❌ فشل إنشاء رابط الدعوة. تأكد من امتلاك البوت صلاحية Create Instant Invite.',
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'توليد دعوة',
                    details: `توليد دعوة: ${invite.url}`
                }).catch((err) => {
                    console.warn('[ButtonHandler Warn] Failed to log invite event:', err.message);
                });

                await interaction.reply({
                    content: `📩 رابط الدعوة الخاص بك (صالح لمدة 24 ساعة، 10 استخدامات):\n**${invite.url}**`,
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_kick': {
                const select = new UserSelectMenuBuilder()
                    .setCustomId('tempvc_select_kick')
                    .setPlaceholder('اختر العضو المراد طرده...')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '👢 اختر العضو الذي تود طرده من الروم الصوتي:',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_region': {
                const select = new StringSelectMenuBuilder()
                    .setCustomId('tempvc_select_region')
                    .setPlaceholder('اختر المنطقة الجغرافية...')
                    .addOptions(
                        { label: 'تلقائي (Automatic)', value: 'null' },
                        { label: 'روتردام (Rotterdam - Europe)', value: 'rotterdam' },
                        { label: 'سنغافورة (Singapore - Asia)', value: 'singapore' },
                        { label: 'سيدني (Sydney - Australia)', value: 'sydney' },
                        { label: 'هونج كونج (Hong Kong)', value: 'hongkong' },
                        { label: 'الهند (India)', value: 'india' },
                        { label: 'وسط أمريكا (US Central)', value: 'us-central' }
                    );

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '🌐 اختر موقع خادم الصوت الجغرافي لتقليل سرعة البينغ (Ping):',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_ban': {
                const select = new UserSelectMenuBuilder()
                    .setCustomId('tempvc_select_ban')
                    .setPlaceholder('اختر العضو لحظره...')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '🚫 اختر العضو الذي تريد حظره نهائياً من دخول الروم الصوتي:',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_unban': {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                const overwrites = interaction.channel.permissionOverwrites.cache;
                const bannedIds = [];

                for (const [id, overwrite] of overwrites) {
                    if (overwrite.type === OverwriteType.Member && overwrite.deny.has(PermissionsBitField.Flags.Connect)) {
                        bannedIds.push(id);
                    }
                }

                if (bannedIds.length === 0) {
                    await interaction.editReply({
                        content: '🔓 لا يوجد أي أعضاء محظورين في هذا الروم حالياً!'
                    });
                    return;
                }

                const targetIds = bannedIds.slice(0, 25);
                const resolvedUsers = await Promise.all(
                    targetIds.map(
                        (id) =>
                            interaction.client.users.cache.get(id) ||
                            interaction.client.users.fetch(id).catch(() => null)
                    )
                );

                const bannedOptions = resolvedUsers
                    .filter(Boolean)
                    .map((targetUser) => ({
                        label: targetUser.username,
                        value: targetUser.id
                    }));

                if (bannedOptions.length === 0) {
                    await interaction.editReply({
                        content: '🔓 لا يوجد أي أعضاء محظورين في هذا الروم حالياً!'
                    });
                    return;
                }

                const select = new StringSelectMenuBuilder()
                    .setCustomId('tempvc_select_unban')
                    .setPlaceholder('اختر العضو لإلغاء حظره...')
                    .addOptions(bannedOptions);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.editReply({
                    content: '🔓 اختر العضو لإلغاء حظره والسماح له بالدخول للروم مجدداً:',
                    components: [row]
                });
                break;
            }

            case 'tempvc_action_claim': {
                const callerVoiceChannelId = interaction.member?.voice?.channelId;
                if (callerVoiceChannelId !== interaction.channelId) {
                    await interaction.reply({
                        content: '❌ يجب أن تكون متواجداً داخل الروم الصوتي لتتمكن من المطالبة بالملكية!',
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                const ownerInChannel = activeChannel.owner_id && interaction.channel.members.has(activeChannel.owner_id);
                if (ownerInChannel) {
                    await interaction.reply({
                        content: '❌ لا يمكنك أخذ الملكية لأن مالك الروم متواجد حالياً في القناة!',
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                await interaction.deferReply();

                await db.updateActiveChannelOwner(interaction.channelId, interaction.user.id);
                activeChannel.owner_id = interaction.user.id;

                await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    SendMessages: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true
                });

                db.logEvent(interaction.channelId, 'control', {
                    user: { id: interaction.user.id, username: interaction.user.username },
                    action: 'أخذ الملكية',
                    details: 'قام العضو بأخذ ملكية الروم لغياب المالك'
                }).catch((err) => {
                    console.warn('[ButtonHandler Warn] Failed to log claim event:', err.message);
                });

                await updateControlPanelEmbed(
                    interaction.channel,
                    interaction.user.id,
                    activeChannel.is_locked === 1,
                    activeChannel.member_limit
                );

                await interaction.editReply({
                    content: `👑 تم نقل ملكية الروم الصوتي بنجاح إلى المالك الجديد: <@${interaction.user.id}>`
                });
                break;
            }

            case 'tempvc_action_transfer': {
                const select = new UserSelectMenuBuilder()
                    .setCustomId('tempvc_select_transfer')
                    .setPlaceholder('اختر العضو لنقل الملكية له...')
                    .setMinValues(1)
                    .setMaxValues(1);

                const row = new ActionRowBuilder().addComponents(select);
                await interaction.reply({
                    content: '👑 اختر العضو لتسليمه ملكية هذا الروم الصوتي:',
                    components: [row],
                    flags: [MessageFlags.Ephemeral]
                });
                break;
            }

            case 'tempvc_action_delete': {
                await interaction.reply({
                    content: '🗑️ جاري حذف الروم الصوتي وأرشفته حالياً...',
                    flags: [MessageFlags.Ephemeral]
                });
                await archiveAndDeleteChannel(
                    interaction.channel,
                    activeChannel,
                    'تم الحذف بواسطة المالك عبر لوحة التحكم'
                );
                break;
            }
        }
    } catch (err) {
        console.error('[Button Handler Error]', err);
        await safeErrorReply(interaction, '❌ حدث خطأ أثناء تنفيذ الإجراء.');
    }
}

module.exports = {
    handleButtonInteraction
};
