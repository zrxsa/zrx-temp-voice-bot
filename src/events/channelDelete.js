/**
 * @file channelDelete.js
 * @description Handles manual channel deletions in Discord, ensuring active temporary channels
 * are archived once and deleted master channels are removed from the database and cache.
 */

const { Events } = require('discord.js');
const db = require('../database/database');
const {
    activeChannelsCache,
    masterChannelsCache,
    deletingChannelsLock
} = require('../services/cacheService');
const { archiveAndDeleteChannel } = require('../services/voiceService');

module.exports = {
    name: Events.ChannelDelete,
    once: false,
    /**
     * Executes when a guild channel is deleted.
     * @param {import('discord.js').DMChannel|import('discord.js').GuildChannel} channel Deleted channel
     * @returns {Promise<void>}
     */
    async execute(channel) {
        if (!channel || !channel.id) return;

        // Skip if archiveAndDeleteChannel is already processing this channel
        if (deletingChannelsLock.has(channel.id)) return;

        if (activeChannelsCache.has(channel.id)) {
            const activeRecord = activeChannelsCache.get(channel.id);
            console.log(`[DB Clean-up] Temporary channel ${channel.name} was deleted manually. Archiving and cleaning database records.`);
            await archiveAndDeleteChannel(null, activeRecord, 'تم حذف القناة يدوياً');
        }

        if (masterChannelsCache.has(channel.id)) {
            masterChannelsCache.delete(channel.id);
            console.log(`[DB Clean-up] Creator/Master channel ${channel.name} was deleted. Cleaning database records.`);
            await db.removeMasterChannel(channel.id).catch((err) => {
                console.error('[ChannelDelete Error] Failed to remove master channel from DB:', err.message);
            });
        }
    }
};
