/**
 * @file dashboardServer.js
 * @description Express.js web dashboard server for real-time monitoring and management
 * of active temporary voice channels, master creator channels, guild settings, and blackbox logs.
 */

const express = require('express');
const path = require('path');
const { PermissionsBitField } = require('discord.js');
const db = require('../database/database');
const { getConfig } = require('../config/botConfig');
const { updateControlPanelEmbed } = require('../components/controlPanel');
const {
    activeChannelsCache,
    masterChannelsCache,
    guildSettingsCache,
    checkChannelRenameLimit
} = require('../services/cacheService');
const { archiveAndDeleteChannel } = require('../services/voiceService');

let discordClient = null;
let activeHttpServer = null;

/**
 * Starts the Express Web Dashboard server and binds all API endpoints.
 * Keeps in-memory caches synchronized with SQLite on every mutation.
 * @param {import('discord.js').Client} client Discord Client instance
 * @param {number|string} [port] HTTP port (defaults to process.env.PORT, config.json dashboardPort, or 6767)
 * @returns {import('http').Server} Running HTTP server instance
 */
function startDashboardServer(client, port = process.env.PORT || getConfig().dashboardPort || 6767) {
    discordClient = client;
    if (activeHttpServer) {
        return activeHttpServer;
    }

    const app = express();

    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../../public')));

    // API: Live Bot & Voice Statistics
    app.get('/api/stats', async (req, res) => {
        try {
            const database = await db.initDB();
            const [activeChannels, masterChannels, eventsCountRow] = await Promise.all([
                db.getAllActiveChannels(),
                db.getAllMasterChannels(),
                database.get('SELECT COUNT(*) as count FROM events')
            ]);

            let totalActiveUsers = 0;
            activeChannels.forEach((ac) => {
                const ch = discordClient?.channels.cache.get(ac.channel_id);
                if (ch && ch.members) {
                    totalActiveUsers += ch.members.size;
                }
            });

            const config = getConfig();
            res.json({
                success: true,
                stats: {
                    activeChannelsCount: activeChannels.length,
                    masterChannelsCount: masterChannels.length,
                    totalEventsLogged: eventsCountRow ? eventsCountRow.count : 0,
                    activeUsersCount: totalActiveUsers,
                    ping: discordClient?.ws.ping || 0,
                    uptime: discordClient?.uptime || 0,
                    guildsCount: discordClient?.guilds.cache.size || 0,
                    botTag: discordClient?.user?.tag || config.dashboardTitle,
                    brandTitle: config.dashboardTitle,
                    brandFooter: config.embedFooter
                }
            });
        } catch (err) {
            console.error('[Dashboard API Error] /api/stats:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Active Temporary Voice Channels
    app.get('/api/active-channels', async (req, res) => {
        try {
            const activeChannels = await db.getAllActiveChannels();

            const missingOwnerIds = [
                ...new Set(
                    activeChannels
                        .filter((ac) => ac.owner_id && !discordClient?.users.cache.has(ac.owner_id))
                        .map((ac) => ac.owner_id)
                )
            ];

            if (missingOwnerIds.length > 0 && discordClient) {
                await Promise.allSettled(missingOwnerIds.map((id) => discordClient.users.fetch(id)));
            }

            const enriched = activeChannels.map((ac) => {
                const ch = discordClient?.channels.cache.get(ac.channel_id);
                let membersList = [];
                let ownerUser = null;

                if (ac.owner_id) {
                    const ownerMember = discordClient?.users.cache.get(ac.owner_id);
                    if (ownerMember) {
                        ownerUser = {
                            id: ownerMember.id,
                            username: ownerMember.username,
                            tag: ownerMember.tag,
                            avatar: ownerMember.displayAvatarURL({ size: 64 })
                        };
                    }
                }

                if (ch && ch.members) {
                    membersList = ch.members.map((m) => ({
                        id: m.id,
                        displayName: m.displayName,
                        username: m.user.username,
                        avatar: m.user.displayAvatarURL({ size: 64 }),
                        deaf: m.voice.deaf,
                        mute: m.voice.mute
                    }));
                }

                return {
                    channelId: ac.channel_id,
                    guildId: ac.guild_id,
                    masterId: ac.master_id,
                    type: ac.type,
                    owner: ownerUser,
                    createdAt: ac.created_at,
                    name: ch ? ch.name : ac.name,
                    isLocked: ch
                        ? Boolean(ch.permissionOverwrites.cache.get(ch.guild.roles.everyone.id)?.deny.has(PermissionsBitField.Flags.Connect))
                        : ac.is_locked === 1,
                    memberLimit: ch ? ch.userLimit : ac.member_limit,
                    bitrate: ch ? ch.bitrate : 64000,
                    currentUsersCount: membersList.length,
                    members: membersList,
                    exists: Boolean(ch)
                };
            });

            res.json({ success: true, channels: enriched });
        } catch (err) {
            console.error('[Dashboard API Error] /api/active-channels:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Registered Master Creator Channels
    app.get('/api/master-channels', async (req, res) => {
        try {
            const masterChannels = await db.getAllMasterChannels();

            const enriched = masterChannels.map((mc) => {
                const ch = discordClient?.channels.cache.get(mc.channel_id);
                const guild = discordClient?.guilds.cache.get(mc.guild_id);
                return {
                    channelId: mc.channel_id,
                    guildId: mc.guild_id,
                    type: mc.type,
                    nameTemplate: mc.name_template,
                    channelName: ch ? ch.name : 'Unknown Channel',
                    guildName: guild ? guild.name : 'Unknown Guild'
                };
            });

            res.json({ success: true, masterChannels: enriched });
        } catch (err) {
            console.error('[Dashboard API Error] /api/master-channels:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: All Guild Voice Channels for Dropdown Selection
    app.get('/api/guild-voice-channels', async (req, res) => {
        try {
            const voiceChannels = [];
            if (discordClient) {
                discordClient.guilds.cache.forEach((guild) => {
                    guild.channels.cache.forEach((ch) => {
                        if (ch.type === 2 || ch.type === 'GUILD_VOICE') {
                            voiceChannels.push({
                                channelId: ch.id,
                                channelName: ch.name,
                                guildId: guild.id,
                                guildName: guild.name
                            });
                        }
                    });
                });
            }
            res.json({ success: true, voiceChannels });
        } catch (err) {
            console.error('[Dashboard API Error] /api/guild-voice-channels:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: All Guild Text Channels for Log Channel Selection
    app.get('/api/guild-text-channels', async (req, res) => {
        try {
            const textChannels = [];
            if (discordClient) {
                discordClient.guilds.cache.forEach((guild) => {
                    guild.channels.cache.forEach((ch) => {
                        if (ch.type === 0 || ch.type === 'GUILD_TEXT') {
                            textChannels.push({
                                channelId: ch.id,
                                channelName: ch.name,
                                guildId: guild.id,
                                guildName: guild.name
                            });
                        }
                    });
                });
            }
            res.json({ success: true, textChannels });
        } catch (err) {
            console.error('[Dashboard API Error] /api/guild-text-channels:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Guild Settings
    app.get('/api/settings', async (req, res) => {
        try {
            const settings = await db.getAllGuildSettings();
            res.json({ success: true, settings });
        } catch (err) {
            console.error('[Dashboard API Error] /api/settings:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Update Guild Log Webhook
    app.post('/api/settings/log-webhook', async (req, res) => {
        try {
            const { guildId, webhookUrl } = req.body || {};
            if (!guildId) {
                return res.status(400).json({ success: false, error: 'guildId is required' });
            }
            const cleanUrl = webhookUrl ? String(webhookUrl).trim() : null;
            await db.setGuildLogWebhook(guildId, cleanUrl);

            const currentSettings = guildSettingsCache.get(guildId) || { guild_id: guildId };
            guildSettingsCache.set(guildId, {
                ...currentSettings,
                log_webhook_url: cleanUrl
            });

            res.json({ success: true, message: 'تم تحديث رابط الويب هوك للوق بنجاح!' });
        } catch (err) {
            console.error('[Dashboard API Error] /api/settings/log-webhook:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Update Guild Log Channel
    app.post('/api/settings/log-channel', async (req, res) => {
        try {
            const { guildId, channelId } = req.body || {};
            if (!guildId) {
                return res.status(400).json({ success: false, error: 'guildId is required' });
            }
            const cleanChannelId = channelId ? String(channelId).trim() : null;
            await db.setGuildLogChannel(guildId, cleanChannelId);

            const currentSettings = guildSettingsCache.get(guildId) || { guild_id: guildId };
            guildSettingsCache.set(guildId, {
                ...currentSettings,
                log_channel_id: cleanChannelId
            });

            res.json({ success: true, message: 'تم تحديث روم اللوق بنجاح!' });
        } catch (err) {
            console.error('[Dashboard API Error] /api/settings/log-channel:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Register Master Creator Channel
    app.post('/api/master-channel/add', async (req, res) => {
        try {
            const { channelId, type, nameTemplate } = req.body || {};
            if (!channelId || !type) {
                return res.status(400).json({ success: false, error: 'القناة والنوع مطلوبان' });
            }

            const ch = discordClient?.channels.cache.get(channelId);
            const guildId = ch ? ch.guild.id : (req.body.guildId || '0');
            const cleanTemplate = nameTemplate ? String(nameTemplate).trim() : null;

            await db.addMasterChannel(channelId, guildId, type, cleanTemplate);
            masterChannelsCache.set(channelId, {
                channel_id: channelId,
                guild_id: guildId,
                type,
                name_template: cleanTemplate
            });

            res.json({
                success: true,
                message: `تم إضافة قناة الإنشاء (${ch ? ch.name : channelId}) بنجاح من السيرفر!`
            });
        } catch (err) {
            console.error('[Dashboard API Error] /api/master-channel/add:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Delete Master Creator Channel
    app.post('/api/master-channel/delete', async (req, res) => {
        try {
            const { channelId } = req.body || {};
            if (!channelId) {
                return res.status(400).json({ success: false, error: 'معرف القناة مطلوب' });
            }

            await db.removeMasterChannel(channelId);
            masterChannelsCache.delete(channelId);
            res.json({ success: true, message: 'تم إزالة قناة الإنشاء بنجاح!' });
        } catch (err) {
            console.error('[Dashboard API Error] /api/master-channel/delete:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Recent Blackbox Events
    app.get('/api/events', async (req, res) => {
        try {
            const database = await db.initDB();
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
            const rows = await database.all('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?', [limit]);

            const events = rows.map((r) => ({
                id: r.id,
                channelId: r.channel_id,
                eventType: r.event_type,
                timestamp: r.timestamp,
                data: db.safeJsonParse(r.data, {})
            }));

            res.json({ success: true, events });
        } catch (err) {
            console.error('[Dashboard API Error] /api/events:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API: Direct Channel Control Actions from Dashboard
    app.post('/api/channel/action', async (req, res) => {
        try {
            const { channelId, action, value } = req.body || {};
            if (!channelId || !action) {
                return res.status(400).json({ success: false, error: 'Missing channelId or action' });
            }

            const activeChannel = activeChannelsCache.get(channelId) || await db.getActiveChannel(channelId);
            if (!activeChannel) {
                return res.status(404).json({ success: false, error: 'Active temporary channel not found' });
            }

            const ch = discordClient?.channels.cache.get(channelId);
            if (!ch && action !== 'delete') {
                return res.status(404).json({ success: false, error: 'Channel does not exist in Discord cache' });
            }

            if (action === 'rename') {
                const newName = String(value || '').trim().slice(0, 100);
                if (!newName) return res.status(400).json({ success: false, error: 'Invalid name' });

                const { allowed, remainingSec } = checkChannelRenameLimit(channelId);
                if (!allowed) {
                    return res.status(429).json({
                        success: false,
                        error: `قيود ديسكورد تسمح بتغيير الاسم مرتين كل 10 دقائق. انتظر ${Math.ceil(remainingSec / 60)} دقيقة.`
                    });
                }

                await ch.setName(newName);
                await db.updateActiveChannelName(channelId, newName);
                if (activeChannelsCache.has(channelId)) {
                    activeChannelsCache.get(channelId).name = newName;
                }
                if (activeChannel.type === 'owned') {
                    await updateControlPanelEmbed(ch, activeChannel.owner_id, activeChannel.is_locked === 1, activeChannel.member_limit);
                }
                await db.logEvent(channelId, 'control', {
                    user: { username: 'Dashboard Admin' },
                    action: 'تغيير الاسم من لوحة التحكم',
                    details: `تعديل الاسم إلى: ${newName}`
                });
                return res.json({ success: true, message: `تم تغيير اسم الروم إلى ${newName}` });
            }

            if (action === 'lock') {
                const everyoneRole = ch.guild.roles.everyone;
                const lockState = Boolean(value);
                await ch.permissionOverwrites.edit(everyoneRole, {
                    Connect: lockState ? false : null
                });
                await db.updateActiveChannelLock(channelId, lockState);
                if (activeChannelsCache.has(channelId)) {
                    activeChannelsCache.get(channelId).is_locked = lockState ? 1 : 0;
                }
                if (activeChannel.type === 'owned') {
                    await updateControlPanelEmbed(ch, activeChannel.owner_id, lockState, activeChannel.member_limit);
                }
                await db.logEvent(channelId, 'control', {
                    user: { username: 'Dashboard Admin' },
                    action: lockState ? 'قفل الروم' : 'فتح الروم',
                    details: lockState ? 'تم قفل الروم من لوحة التحكم' : 'تم فتح الروم من لوحة التحكم'
                });
                return res.json({ success: true, message: lockState ? 'تم قفل الروم' : 'تم فتح الروم' });
            }

            if (action === 'limit') {
                const limitNum = parseInt(value, 10);
                if (isNaN(limitNum) || limitNum < 0 || limitNum > 99) {
                    return res.status(400).json({ success: false, error: 'Limit must be between 0 and 99' });
                }
                await ch.setUserLimit(limitNum);
                await db.updateActiveChannelLimit(channelId, limitNum);
                if (activeChannelsCache.has(channelId)) {
                    activeChannelsCache.get(channelId).member_limit = limitNum;
                }
                if (activeChannel.type === 'owned') {
                    await updateControlPanelEmbed(ch, activeChannel.owner_id, activeChannel.is_locked === 1, limitNum);
                }
                await db.logEvent(channelId, 'control', {
                    user: { username: 'Dashboard Admin' },
                    action: 'تحديد الحد الأقصى',
                    details: `تعديل الحد إلى: ${limitNum}`
                });
                return res.json({ success: true, message: `تم تحديد الحد الأقصى بـ ${limitNum}` });
            }

            if (action === 'kick') {
                const memberId = String(value);
                const targetMember = ch.members.get(memberId);
                if (!targetMember) return res.status(404).json({ success: false, error: 'Member not found in voice channel' });
                await targetMember.voice.disconnect('Kick from Dashboard');
                await db.logEvent(channelId, 'control', {
                    user: { username: 'Dashboard Admin' },
                    action: 'طرد عضو',
                    details: `طرد العضو: ${targetMember.user.tag}`
                });
                return res.json({ success: true, message: `تم طرد العضو ${targetMember.user.username}` });
            }

            if (action === 'delete') {
                await archiveAndDeleteChannel(ch || null, activeChannel, 'Deleted via Web Dashboard');
                return res.json({ success: true, message: 'تم أرشفة وحذف الروم بنجاح' });
            }

            return res.status(400).json({ success: false, error: 'Unknown action' });
        } catch (err) {
            console.error('[Dashboard API Error] /api/channel/action:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Global Express Error Middleware
    app.use((err, req, res, next) => {
        console.error('[Dashboard Express Error]', err.message);
        if (!res.headersSent) {
            res.status(400).json({ success: false, error: 'Invalid request payload' });
        }
    });

    const server = app.listen(port, () => {
        console.log(`[Dashboard] Web Dashboard listening at http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[Dashboard Warn] Port ${port} is already in use. Web Dashboard skipped binding to avoid crash.`);
        } else {
            console.error('[Dashboard Server Error]', err);
        }
    });

    activeHttpServer = server;
    return server;
}

module.exports = { startDashboardServer };
