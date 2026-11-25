/**
 * @file messageCreate.js
 * @description Logs text chat messages sent inside active temporary voice channels for the Blackbox HTML archive.
 */

const { Events } = require('discord.js');
const db = require('../database/database');
const { activeChannelsCache } = require('../services/cacheService');

module.exports = {
    name: Events.MessageCreate,
    once: false,
    /**
     * Executes when a message is sent in a channel visible to the bot.
     * @param {import('discord.js').Message} message Discord message instance
     * @returns {Promise<void>}
     */
    async execute(message) {
        if (!message || !message.author || message.author.bot) return;

        if (activeChannelsCache.has(message.channelId)) {
            const attachmentUrls = message.attachments
                ? message.attachments.map((att) => att.url)
                : [];

            await db.logEvent(message.channelId, 'message', {
                author: {
                    id: message.author.id,
                    username: message.author.username,
                    tag: message.author.tag,
                    avatarUrl: message.author.displayAvatarURL({ size: 128 }),
                    bot: message.author.bot
                },
                content: message.content || '',
                attachments: attachmentUrls
            }).catch((err) => {
                console.warn('[MessageCreate Warn] Failed to log message event:', err.message);
            });
        }
    }
};
