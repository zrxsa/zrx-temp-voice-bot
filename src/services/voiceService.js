/**
 * @file voiceService.js
 * @description Core business logic for creating, managing, archiving, and deleting temporary voice channels.
 * Protected by atomic in-memory concurrency locks to prevent duplicate transcripts or double-room spawning.
 */

const {
    ChannelType,
    EmbedBuilder,
    AttachmentBuilder,
    WebhookClient
} = require('discord.js');
const db = require('../database/database');
const { getConfig, resolveColor, applyEmbedFooter } = require('../config/botConfig');
const { generateHtmlTranscript } = require('./htmlGenerator');
const { createControlPanel } = require('../components/controlPanel');
const { getMasterPermissionOverwrites } = require('../utils/permissions');
const {
    activeChannelsCache,
    masterChannelsCache,
    guildSettingsCache,
    deletingChannelsLock,
    creatingUsersLock,
    guildMfaWarningTimestamps,
    checkCreationCooldown,
    clearCreationCooldown
} = require('./cacheService');

/**
 * Generates an HTML blackbox transcript, dispatches it via Webhook or log channel,
 * cleans up SQLite records inside a transaction, and deletes the Discord voice channel.
 * Protected by `deletingChannelsLock` so concurrent leave/delete events never duplicate work.
 * @param {import('discord.js').VoiceChannel|null} channel Discord Voice Channel (or null if already deleted)
 * @param {object} activeChannel Active channel record from cache/DB
 * @param {string} reason Audit log deletion reason
 * @returns {Promise<void>}
 */
async function archiveAndDeleteChannel(channel, activeChannel, reason = 'الروم المؤقت فارغ') {
    const channelId = activeChannel?.channel_id || channel?.id;
    if (!channelId) return;

    // Acquire atomic in-memory lock before any asynchronous await
    if (deletingChannelsLock.has(channelId)) return;
    deletingChannelsLock.add(channelId);
    activeChannelsCache.delete(channelId);

    try {
        console.log(`[VoiceService] Channel ${activeChannel.name} is empty. Archiving and deleting...`);

        const events = await db.getEvents(channelId).catch((err) => {
            console.warn('[VoiceService Warn] Failed to read channel events for archive:', err.message);
            return [];
        });

        const client = channel?.client;
        let ownerUser = null;
        if (activeChannel.owner_id && client) {
            ownerUser = client.users.cache.get(activeChannel.owner_id) ||
                        await client.users.fetch(activeChannel.owner_id).catch(() => null);
        }

        const config = getConfig();
        const htmlContent = generateHtmlTranscript(activeChannel, ownerUser, events, config.embedFooter);
        const guild = channel?.guild;
        const guildId = guild?.id || activeChannel.guild_id;
        const durationMs = Math.max(0, Date.now() - (activeChannel.created_at || Date.now()));
        const durationStr = `${Math.floor(durationMs / 1000 / 60)} دقيقة`;
        const messageCount = events.filter((e) => e.eventType === 'message').length;

        const attachment = new AttachmentBuilder(Buffer.from(htmlContent, 'utf-8'), {
            name: `transcript-${channelId}.html`
        });

        const archiveEmbed = applyEmbedFooter(
            new EmbedBuilder()
                .setColor(resolveColor(config.panelColor, 0x2B2D31))
                .setTitle(`📁 أرشيف الروم المؤقت: ${activeChannel.name}`)
                .addFields(
                    { name: 'نوع الروم', value: activeChannel.type === 'owned' ? 'روم مالك خاص' : 'روم عام تلقائي', inline: true },
                    { name: 'المالك', value: activeChannel.owner_id ? `<@${activeChannel.owner_id}>` : 'لا يوجد (روم عام)', inline: true },
                    { name: 'المدة النشطة', value: durationStr, inline: true },
                    { name: 'عدد رسائل الشات', value: `${messageCount} رسالة`, inline: true },
                    { name: 'تاريخ الإنشاء', value: `<t:${Math.floor((activeChannel.created_at || Date.now()) / 1000)}:F>`, inline: false }
                )
                .setTimestamp(),
            config.embedFooter
        );

        // 1. Send via Webhook if configured
        const webhookUrl = guildSettingsCache.get(guildId)?.log_webhook_url ||
                           process.env.LOG_WEBHOOK_URL ||
                           process.env.WEBHOOK_URL;

        if (webhookUrl && webhookUrl.trim().startsWith('http')) {
            let webhookClient = null;
            try {
                webhookClient = new WebhookClient({ url: webhookUrl.trim() });
                await webhookClient.send({ embeds: [archiveEmbed], files: [attachment] });
                console.log(`[VoiceService] Successfully sent transcript for channel ${activeChannel.name} via Webhook.`);
            } catch (err) {
                console.error('[Webhook Archive Error] Failed to send transcript via webhook:', err.message);
            } finally {
                if (webhookClient) {
                    webhookClient.destroy();
                }
            }
        } else if (guild) {
            // 2. Fallback: Send to configured log text channel
            const customLogChannelId = guildSettingsCache.get(guildId)?.log_channel_id || process.env.LOG_CHANNEL_ID;
            if (customLogChannelId) {
                try {
                    const textChannel = guild.channels.cache.get(customLogChannelId) ||
                                        await guild.channels.fetch(customLogChannelId).catch(() => null);
                    if (textChannel) {
                        await textChannel.send({ embeds: [archiveEmbed], files: [attachment] });
                        console.log(`[VoiceService] Successfully sent transcript for channel ${activeChannel.name} to text channel <#${customLogChannelId}>.`);
                    } else {
                        console.warn(`[VoiceService] Log channel ${customLogChannelId} not found in guild.`);
                    }
                } catch (err) {
                    console.error('[Channel Archive Error] Failed to send transcript to log channel:', err.message);
                }
            } else {
                console.log(`[VoiceService] Neither Webhook nor LOG_CHANNEL_ID configured for guild ${guildId}. Skipping archive log.`);
            }
        }

        // Remove active channel and its blackbox events inside an atomic SQLite transaction
        await db.cleanupChannelRecords(channelId).catch((err) => {
            console.error('[VoiceService DB Error] Failed to clean up channel records:', err.message);
        });

        // Delete the Discord voice channel if it still exists
        if (channel && channel.deletable !== false) {
            await channel.delete(reason).catch((err) => {
                if (err.code !== 10003) {
                    console.warn(`[VoiceService Warn] Could not delete channel ${channelId}:`, err.message);
                }
            });
        }

        console.log(`[VoiceService] Channel ${activeChannel.name} deleted and database cleared.`);
    } catch (err) {
        console.error('[VoiceService Error] Unexpected error during channel archive and deletion:', err);
    } finally {
        deletingChannelsLock.delete(channelId);
    }
}

/**
 * Handles a member leaving a temporary voice channel and triggers archiving/deletion when the channel becomes empty.
 * @param {import('discord.js').VoiceState} oldState Previous voice state
 * @param {import('discord.js').VoiceState} newState Current voice state
 * @returns {Promise<void>}
 */
async function handleVoiceLeave(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (!oldChannelId || oldChannelId === newChannelId) return;
    if (deletingChannelsLock.has(oldChannelId)) return;

    const activeChannel = activeChannelsCache.get(oldChannelId);
    if (!activeChannel) return;

    await db.logEvent(oldChannelId, 'leave', {
        user: { id: member.id, username: member.user.username, tag: member.user.tag }
    }).catch((err) => {
        console.warn('[VoiceService Warn] Failed to log leave event:', err.message);
    });

    const oldChannel = oldState.channel;
    if (!oldChannel || oldChannel.members.size > 0) return;

    await archiveAndDeleteChannel(oldChannel, activeChannel, 'الروم المؤقت فارغ');
}

/**
 * Creates a temporary voice channel with automatic fallback stages if custom permission overwrites
 * or category channel limits cause a Discord API error.
 * @param {import('discord.js').Guild} guild Discord Guild
 * @param {import('discord.js').VoiceChannel} masterChannel Master creator voice channel
 * @param {import('discord.js').CategoryChannel|null} category Parent category channel
 * @param {string} chName Desired channel name
 * @param {Array<object>} permissionOverwrites Sanitized permission overwrites
 * @returns {Promise<import('discord.js').VoiceChannel>} Created voice channel
 */
async function createVoiceChannelSafely(guild, masterChannel, category, chName, permissionOverwrites) {
    const safeName = (chName || '🎙️ | روم صوتي').slice(0, 100);
    const maxBitrate = guild.maximumBitrate || 96000;
    const safeBitrate = Math.min(masterChannel.bitrate || 64000, maxBitrate);
    const safeUserLimit = Math.min(Math.max(masterChannel.userLimit || 0, 0), 99);

    const targetParent = (category && category.children && category.children.cache.size >= 50)
        ? null
        : (category || null);

    const baseOptions = {
        name: safeName,
        type: ChannelType.GuildVoice,
        parent: targetParent,
        bitrate: safeBitrate,
        userLimit: safeUserLimit,
        rtcRegion: masterChannel.rtcRegion || null,
        videoQualityMode: masterChannel.videoQualityMode || null
    };

    try {
        return await guild.channels.create({
            ...baseOptions,
            permissionOverwrites
        });
    } catch (firstErr) {
        if (firstErr.code === 50013 || firstErr.code === 50035 || firstErr.code === 60003 || firstErr.code === 10009 || firstErr.code === 30013) {
            try {
                return await guild.channels.create(baseOptions);
            } catch (secondErr) {
                if (targetParent) {
                    return await guild.channels.create({
                        ...baseOptions,
                        parent: null
                    });
                }
                throw secondErr;
            }
        }
        throw firstErr;
    }
}

/**
 * Handles a member joining a master creator channel or moving between active temporary channels.
 * @param {import('discord.js').VoiceState} oldState Previous voice state
 * @param {import('discord.js').VoiceState} newState Current voice state
 * @returns {Promise<void>}
 */
async function handleVoiceJoin(oldState, newState) {
    const member = newState.member;
    if (!member || member.user?.bot) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Ignore state updates inside the same channel (mute, deafen, stream, camera)
    if (!newChannelId || oldChannelId === newChannelId) return;

    // Log move between two active temporary channels
    if (oldChannelId && oldChannelId !== newChannelId) {
        const activeOld = activeChannelsCache.get(oldChannelId);
        const activeNew = activeChannelsCache.get(newChannelId);
        if (activeOld && activeNew) {
            db.logEvent(newChannelId, 'move', {
                user: { id: member.id, username: member.user.username, tag: member.user.tag },
                fromChannel: activeOld.name,
                toChannel: activeNew.name
            }).catch((err) => {
                console.warn('[VoiceService Warn] Failed to log move event:', err.message);
            });
        }
    }

    // Check if the joined channel is a registered master creator channel
    const masterConfig = masterChannelsCache.get(newChannelId);
    let isMaster = Boolean(masterConfig);
    let type = masterConfig?.type;
    let template = masterConfig?.name_template;

    // Keyword fallback recognition for unregistered creator channels
    if (!isMaster && newState.channel) {
        const chanName = newState.channel.name;
        if (chanName.includes('خاص') || chanName.toLowerCase().includes('private')) {
            isMaster = true;
            type = 'owned';
            template = '🎙️ | روم {user}';
        } else if (chanName.includes('عام') || chanName.toLowerCase().includes('public')) {
            isMaster = true;
            type = 'public';
            template = 'Voice Chat {num}';
        }
    }

    if (!isMaster) {
        if (activeChannelsCache.has(newChannelId)) {
            db.logEvent(newChannelId, 'join', {
                user: { id: member.id, username: member.user.username, tag: member.user.tag }
            }).catch((err) => {
                console.warn('[VoiceService Warn] Failed to log join event:', err.message);
            });
        }
        return;
    }

    // Prevent concurrent room creation for the same user
    if (creatingUsersLock.has(member.id)) return;

    // Enforce 5-second creation cooldown
    if (checkCreationCooldown(member.id, 5000)) {
        console.log(`[VoiceService Cooldown] Member ${member.user.tag} is on cooldown. Disconnecting...`);
        await member.voice.disconnect('يرجى الانتظار 5 ثوانٍ قبل إنشاء روم مؤقت آخر (Cooldown)').catch((err) => {
            console.warn('[VoiceService Warn] Could not disconnect member on cooldown:', err.message);
        });
        return;
    }

    creatingUsersLock.add(member.id);

    try {
        const guild = newState.guild;
        const masterChannel = newState.channel;
        if (!guild || !masterChannel) return;

        const category = masterChannel.parent;
        const client = newState.client;

        if (type === 'owned') {
            const chName = (template ? template.replace('{user}', member.displayName) : `🎙️ | روم ${member.displayName}`).slice(0, 100);
            const permissionOverwrites = getMasterPermissionOverwrites(masterChannel, member.id, client.user.id);

            const newTempChannel = await createVoiceChannelSafely(
                guild,
                masterChannel,
                category,
                chName,
                permissionOverwrites
            );

            const activeRecord = {
                channel_id: newTempChannel.id,
                guild_id: guild.id,
                master_id: masterConfig?.channel_id || null,
                type: 'owned',
                owner_id: member.id,
                created_at: Date.now(),
                name: chName,
                is_locked: 0,
                member_limit: masterChannel.userLimit || 0,
                panel_message_id: null
            };
            activeChannelsCache.set(newTempChannel.id, activeRecord);

            await db.addActiveChannel(
                newTempChannel.id,
                guild.id,
                masterConfig?.channel_id || null,
                'owned',
                member.id,
                chName,
                masterChannel.userLimit || 0
            );

            let movedSuccessfully = false;
            if (member.voice.channelId) {
                movedSuccessfully = await member.voice.setChannel(newTempChannel).then(() => true).catch(() => false);
            }

            if (!movedSuccessfully && newTempChannel.members.size === 0) {
                console.log(`[VoiceService] Member ${member.user.tag} left before move completed. Cleaning up empty channel ${chName}.`);
                await archiveAndDeleteChannel(newTempChannel, activeRecord, 'غادر العضو قبل اكتمال النقل');
                return;
            }

            db.logEvent(newTempChannel.id, 'join', {
                user: { id: member.id, username: member.user.username, tag: member.user.tag }
            }).catch((err) => {
                console.warn('[VoiceService Warn] Failed to log initial join event:', err.message);
            });

            const panelPayload = createControlPanel(chName, member.id, false, masterChannel.userLimit || 0);
            const sentPanelMsg = await newTempChannel.send(panelPayload).catch((err) => {
                console.error('[Panel Error] Failed to send control panel message:', err.message);
                return null;
            });

            if (sentPanelMsg) {
                activeRecord.panel_message_id = sentPanelMsg.id;
                db.updateActiveChannelPanelMessage(newTempChannel.id, sentPanelMsg.id).catch((err) => {
                    console.warn('[VoiceService Warn] Failed to update panel message ID:', err.message);
                });
            }

            console.log(`[VoiceService] Created Owned Controlling Channel: ${chName} for owner ${member.user.tag}`);
        } else if (type === 'public') {
            let currentTemplate = template;
            if (!currentTemplate) {
                let prefix = masterChannel.name
                    .replace(/[🔊🎙️💬]/g, '')
                    .replace(/عام/g, '')
                    .replace(/public/g, '')
                    .replace(/[-|]/g, '')
                    .trim();
                if (!prefix) prefix = 'Voice Chat';
                currentTemplate = `${prefix} {num}`;
            } else if (!currentTemplate.includes('{num}')) {
                currentTemplate = `${currentTemplate} {num}`;
            }

            const escapedTemplate = currentTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regexStr = `^${escapedTemplate.replace('\\{num\\}', '(\\d+)')}$`;
            const templateRegex = new RegExp(regexStr, 'i');

            const activeNumbers = new Set();
            if (category && category.children) {
                const siblings = category.children.cache.filter((c) => c.type === ChannelType.GuildVoice);
                siblings.forEach((s) => {
                    const match = s.name.match(templateRegex);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num)) {
                            activeNumbers.add(num);
                        }
                    }
                });
            }

            let targetNum = 1;
            while (activeNumbers.has(targetNum) && targetNum < 1000) {
                targetNum++;
            }

            const chName = currentTemplate.replace('{num}', targetNum).slice(0, 100);
            const permissionOverwrites = getMasterPermissionOverwrites(masterChannel, null, client.user.id);

            const newTempChannel = await createVoiceChannelSafely(
                guild,
                masterChannel,
                category,
                chName,
                permissionOverwrites
            );

            const activeRecord = {
                channel_id: newTempChannel.id,
                guild_id: guild.id,
                master_id: masterConfig?.channel_id || null,
                type: 'public',
                owner_id: null,
                created_at: Date.now(),
                name: chName,
                is_locked: 0,
                member_limit: masterChannel.userLimit || 0,
                panel_message_id: null
            };
            activeChannelsCache.set(newTempChannel.id, activeRecord);

            await db.addActiveChannel(
                newTempChannel.id,
                guild.id,
                masterConfig?.channel_id || null,
                'public',
                null,
                chName,
                masterChannel.userLimit || 0
            );

            let movedSuccessfully = false;
            if (member.voice.channelId) {
                movedSuccessfully = await member.voice.setChannel(newTempChannel).then(() => true).catch(() => false);
            }

            if (!movedSuccessfully && newTempChannel.members.size === 0) {
                console.log(`[VoiceService] Member ${member.user.tag} left before move completed. Cleaning up empty channel ${chName}.`);
                await archiveAndDeleteChannel(newTempChannel, activeRecord, 'غادر العضو قبل اكتمال النقل');
                return;
            }

            db.logEvent(newTempChannel.id, 'join', {
                user: { id: member.id, username: member.user.username, tag: member.user.tag }
            }).catch((err) => {
                console.warn('[VoiceService Warn] Failed to log initial join event:', err.message);
            });

            console.log(`[VoiceService] Created Public Auto-Increment Channel: ${chName}`);
        }
    } catch (err) {
        clearCreationCooldown(member.id);

        if (err.code === 60003) {
            const guildId = newState.guild?.id || 'unknown';
            const lastLog = guildMfaWarningTimestamps.get(guildId) || 0;
            if (Date.now() - lastLog > 60000) {
                guildMfaWarningTimestamps.set(guildId, Date.now());
                let ownerInfo = 'غير معروف';
                try {
                    const app = await newState.client?.application?.fetch();
                    if (app?.owner) {
                        if (app.owner.tag || app.owner.username) {
                            ownerInfo = `${app.owner.tag || app.owner.username} (ID: ${app.owner.id})`;
                        } else if (app.owner.ownerId) {
                            ownerInfo = `Team "${app.owner.name}" (Owner ID: ${app.owner.ownerId})`;
                        }
                    }
                } catch {
                    // Ignore application fetch error
                }
                console.error(
                    `[VoiceService 2FA Error - Code 60003] فشل إنشاء الروم في سيرفر "${newState.guild?.name || guildId}": ` +
                    `السيرفر يفعّل شرط التحقق بخطوتين (2FA) للإجراءات الإدارية بينما حساب مالك البوت في Discord Portal [${ownerInfo}] غير مفعّل فيه تطبيق المصادقة (Authenticator App 2FA). ` +
                    `الحل: فعّل Authenticator App في حساب [${ownerInfo}]، أو أوقف خيار (Require 2FA for moderator actions) من إعدادات الأمان في السيرفر.`
                );
            }
            await member.voice.disconnect('السيرفر يتطلب تفعيل 2FA على حساب مالك البوت لإنشاء الرومات (Code 60003)').catch(() => null);
        } else if (err.code === 50013) {
            console.error(`[VoiceService Permission Error - Code 50013] البوت يفتقد صلاحية Manage Channels أو Move Members في سيرفر "${newState.guild?.name}".`);
        } else {
            console.error('[VoiceService Creation Error] Failed to create temporary voice channel:', err.message || err);
        }
    } finally {
        creatingUsersLock.delete(member.id);
    }
}

module.exports = {
    handleVoiceLeave,
    handleVoiceJoin,
    archiveAndDeleteChannel
};
