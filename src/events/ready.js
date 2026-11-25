/**
 * @file ready.js
 * @description Handles the `ClientReady` event: initializes caches, starts the web dashboard,
 * registers slash commands, checks 2FA status, and reconciles orphaned temporary voice channels.
 */

const { Events } = require('discord.js');
const db = require('../database/database');
const { initCaches, activeChannelsCache } = require('../services/cacheService');
const { archiveAndDeleteChannel } = require('../services/voiceService');
const { registerSlashCommands } = require('../handlers/commandHandler');
const { startDashboardServer } = require('../server/dashboardServer');

/**
 * Reconciles active temporary channels stored in SQLite with Discord's live channel state on startup.
 * Removes records for deleted channels and archives/deletes channels that became empty while offline.
 * @param {import('discord.js').Client} client Discord Client instance
 * @returns {Promise<void>}
 */
async function reconcileActiveChannelsOnStartup(client) {
    const entries = Array.from(activeChannelsCache.entries());
    if (entries.length === 0) return;

    for (const [channelId, activeRecord] of entries) {
        try {
            const channel = client.channels.cache.get(channelId) ||
                            await client.channels.fetch(channelId).catch(() => null);

            if (!channel) {
                activeChannelsCache.delete(channelId);
                await db.cleanupChannelRecords(channelId);
                console.log(`[Startup Clean-up] Removed stale record for deleted channel: ${activeRecord.name} (${channelId})`);
                continue;
            }

            if (channel.members && channel.members.size === 0) {
                await archiveAndDeleteChannel(channel, activeRecord, 'الروم المؤقت فارغ عند تشغيل البوت');
            }
        } catch (err) {
            console.warn(`[Startup Clean-up Warn] Failed to reconcile channel ${channelId}:`, err.message);
        }
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    /**
     * Executes the client ready workflow once upon login.
     * @param {import('discord.js').Client} client Discord Client instance
     * @returns {Promise<void>}
     */
    async execute(client) {
        console.log(`[Bot Ready] Logged in as ${client.user.tag}`);

        // Check Bot Owner 2FA status on startup
        if (client.user.mfaEnabled === false) {
            try {
                const app = await client.application?.fetch();
                const ownerTag = app?.owner
                    ? `${app.owner.username || app.owner.name} (ID: ${app.owner.id})`
                    : 'غير معروف';
                console.warn(
                    `[Security Warn] حالة 2FA للبوت في ديسكورد هي (mfa_enabled: false). ` +
                    `الحساب المالك للبوت في Developer Portal هو: [${ownerTag}]. ` +
                    `لن يتمكن البوت من إنشاء رومات في السيرفرات التي تفعّل شرط (Require 2FA for moderator actions) حتى يتم تفعيل تطبيق المصادقة (Authenticator App) في الحساب [${ownerTag}].`
                );
            } catch {
                // Ignore application fetch error
            }
        }

        // Initialize SQLite & hot in-memory caches
        await initCaches();

        // Start Express Web Dashboard
        try {
            startDashboardServer(client);
        } catch (err) {
            console.error('[Dashboard Error] Failed to start Dashboard server:', err);
        }

        // Register global slash commands
        await registerSlashCommands(process.env.DISCORD_TOKEN, process.env.CLIENT_ID || client.user.id);

        // Clean up any orphaned or empty active channels from prior sessions
        await reconcileActiveChannelsOnStartup(client);
    }
};
