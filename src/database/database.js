/**
 * @file database.js
 * @description Asynchronous SQLite database layer for the Temporary Voice Channels Bot.
 * Uses WAL mode, busy_timeout, singleton initialization lock, and atomic transactions.
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db = null;
let dbInitPromise = null;

/**
 * Safely parses a JSON string into an object without throwing on corrupted data.
 * @param {string} raw JSON string from database
 * @param {object} fallback Default value returned when parsing fails
 * @returns {object} Parsed object or fallback
 */
function safeJsonParse(raw, fallback = {}) {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.warn('[Database Warn] Malformed JSON payload in events table:', err.message);
        return fallback;
    }
}

/**
 * Initializes the SQLite database connection, configures WAL/performance PRAGMAs,
 * and ensures all required tables and indexes exist without modifying existing data.
 * @returns {Promise<import('sqlite').Database>} Initialized SQLite database instance
 */
async function initDB() {
    if (db) return db;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = (async () => {
        try {
            const dbPath = path.join(__dirname, '../../temp_voice.db');
            const instance = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });

            // Configure SQLite for concurrent reads/writes and avoid SQLITE_BUSY under high traffic
            await instance.exec('PRAGMA busy_timeout = 5000;');
            await instance.exec('PRAGMA journal_mode = WAL;');
            await instance.exec('PRAGMA synchronous = NORMAL;');
            await instance.exec('PRAGMA temp_store = MEMORY;');
            await instance.exec('PRAGMA cache_size = -2000;');

            // 1. Master Creator Channels Table
            await instance.exec(`
                CREATE TABLE IF NOT EXISTS master_channels (
                    channel_id TEXT PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    name_template TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_master_channels_guild ON master_channels (guild_id);
            `);

            // 2. Active Temporary Channels Table
            await instance.exec(`
                CREATE TABLE IF NOT EXISTS active_channels (
                    channel_id TEXT PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    master_id TEXT,
                    type TEXT NOT NULL,
                    owner_id TEXT,
                    created_at INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    is_locked INTEGER DEFAULT 0,
                    member_limit INTEGER DEFAULT 0,
                    panel_message_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_active_channels_guild ON active_channels (guild_id);
                CREATE INDEX IF NOT EXISTS idx_active_channels_master ON active_channels (master_id);
            `);

            // Backwards-compatible migration for panel_message_id
            const activeCols = await instance.all('PRAGMA table_info(active_channels);');
            if (!activeCols.some((col) => col.name === 'panel_message_id')) {
                await instance.exec('ALTER TABLE active_channels ADD COLUMN panel_message_id TEXT;');
            }

            // 3. Blackbox Events Table
            await instance.exec(`
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_channel_id_ts ON events (channel_id, timestamp);
            `);

            // 4. Guild Settings Table
            await instance.exec(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id TEXT PRIMARY KEY,
                    log_channel_id TEXT,
                    log_webhook_url TEXT
                );
            `);

            // Backwards-compatible migration for log_webhook_url
            const settingCols = await instance.all('PRAGMA table_info(guild_settings);');
            if (!settingCols.some((col) => col.name === 'log_webhook_url')) {
                await instance.exec('ALTER TABLE guild_settings ADD COLUMN log_webhook_url TEXT;');
            }

            db = instance;
            return db;
        } catch (err) {
            dbInitPromise = null;
            throw err;
        }
    })();

    return dbInitPromise;
}

/**
 * Sets or updates the custom log webhook URL for a guild.
 * @param {string} guildId Discord Guild ID
 * @param {string|null} logWebhookUrl Discord Webhook URL
 * @returns {Promise<void>}
 */
async function setGuildLogWebhook(guildId, logWebhookUrl) {
    const database = await initDB();
    await database.run(
        `INSERT INTO guild_settings (guild_id, log_webhook_url)
         VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET log_webhook_url = excluded.log_webhook_url`,
        [guildId, logWebhookUrl]
    );
}

/**
 * Retrieves the configured log webhook URL for a guild.
 * @param {string} guildId Discord Guild ID
 * @returns {Promise<string|null>} Webhook URL or null
 */
async function getGuildLogWebhook(guildId) {
    const database = await initDB();
    const row = await database.get('SELECT log_webhook_url FROM guild_settings WHERE guild_id = ?', [guildId]);
    return row ? row.log_webhook_url : null;
}

/**
 * Sets or updates the fallback log text channel ID for a guild.
 * @param {string} guildId Discord Guild ID
 * @param {string|null} logChannelId Discord Text Channel ID
 * @returns {Promise<void>}
 */
async function setGuildLogChannel(guildId, logChannelId) {
    const database = await initDB();
    await database.run(
        `INSERT INTO guild_settings (guild_id, log_channel_id)
         VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
        [guildId, logChannelId]
    );
}

/**
 * Retrieves the configured fallback log text channel ID for a guild.
 * @param {string} guildId Discord Guild ID
 * @returns {Promise<string|null>} Text Channel ID or null
 */
async function getGuildLogChannel(guildId) {
    const database = await initDB();
    const row = await database.get('SELECT log_channel_id FROM guild_settings WHERE guild_id = ?', [guildId]);
    return row ? row.log_channel_id : null;
}

/**
 * Retrieves all guild settings records.
 * @returns {Promise<Array<object>>} Array of guild settings rows
 */
async function getAllGuildSettings() {
    const database = await initDB();
    return await database.all('SELECT * FROM guild_settings');
}

/**
 * Registers or updates a master creator voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {string} guildId Discord Guild ID
 * @param {'owned'|'public'} type Channel spawning mode
 * @param {string|null} nameTemplate Optional name template using {user} or {num}
 * @returns {Promise<void>}
 */
async function addMasterChannel(channelId, guildId, type, nameTemplate = null) {
    const database = await initDB();
    await database.run(
        `INSERT OR REPLACE INTO master_channels (channel_id, guild_id, type, name_template)
         VALUES (?, ?, ?, ?)`,
        [channelId, guildId, type, nameTemplate]
    );
}

/**
 * Removes a master creator channel from the database.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<void>}
 */
async function removeMasterChannel(channelId) {
    const database = await initDB();
    await database.run('DELETE FROM master_channels WHERE channel_id = ?', [channelId]);
}

/**
 * Retrieves a single master channel record by ID.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<object|undefined>} Master channel row
 */
async function getMasterChannel(channelId) {
    const database = await initDB();
    return await database.get('SELECT * FROM master_channels WHERE channel_id = ?', [channelId]);
}

/**
 * Retrieves all registered master creator channels.
 * @returns {Promise<Array<object>>} List of master channel records
 */
async function getAllMasterChannels() {
    const database = await initDB();
    return await database.all('SELECT * FROM master_channels');
}

/**
 * Inserts or replaces an active temporary voice channel record.
 * @param {string} channelId Discord Voice Channel ID
 * @param {string} guildId Discord Guild ID
 * @param {string|null} masterId Parent Master Channel ID
 * @param {'owned'|'public'} type Channel mode
 * @param {string|null} ownerId Owner User ID (null for public rooms)
 * @param {string} name Channel name
 * @param {number} memberLimit User limit (0 for unlimited)
 * @param {string|null} panelMessageId Control panel message ID
 * @returns {Promise<void>}
 */
async function addActiveChannel(channelId, guildId, masterId, type, ownerId, name, memberLimit = 0, panelMessageId = null) {
    const database = await initDB();
    await database.run(
        `INSERT OR REPLACE INTO active_channels (channel_id, guild_id, master_id, type, owner_id, created_at, name, is_locked, member_limit, panel_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [channelId, guildId, masterId, type, ownerId, Date.now(), name, memberLimit || 0, panelMessageId]
    );
}

/**
 * Removes an active temporary voice channel record.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<void>}
 */
async function removeActiveChannel(channelId) {
    const database = await initDB();
    await database.run('DELETE FROM active_channels WHERE channel_id = ?', [channelId]);
}

/**
 * Atomically deletes both the active channel record and all associated blackbox events inside a transaction.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<void>}
 */
async function cleanupChannelRecords(channelId) {
    const database = await initDB();
    await database.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
        await database.run('DELETE FROM active_channels WHERE channel_id = ?', [channelId]);
        await database.run('DELETE FROM events WHERE channel_id = ?', [channelId]);
        await database.exec('COMMIT');
    } catch (err) {
        await database.exec('ROLLBACK').catch((rollbackErr) => {
            console.error('[Database Error] Failed to rollback transaction:', rollbackErr.message);
        });
        throw err;
    }
}

/**
 * Retrieves an active temporary voice channel record by ID.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<object|undefined>} Active channel record
 */
async function getActiveChannel(channelId) {
    const database = await initDB();
    return await database.get('SELECT * FROM active_channels WHERE channel_id = ?', [channelId]);
}

/**
 * Updates the owner of an active temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {string} newOwnerId New Owner Discord User ID
 * @returns {Promise<void>}
 */
async function updateActiveChannelOwner(channelId, newOwnerId) {
    const database = await initDB();
    await database.run('UPDATE active_channels SET owner_id = ? WHERE channel_id = ?', [newOwnerId, channelId]);
}

/**
 * Updates the name of an active temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {string} newName New channel name
 * @returns {Promise<void>}
 */
async function updateActiveChannelName(channelId, newName) {
    const database = await initDB();
    await database.run('UPDATE active_channels SET name = ? WHERE channel_id = ?', [newName, channelId]);
}

/**
 * Updates the user limit of an active temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {number} limit User limit (0-99)
 * @returns {Promise<void>}
 */
async function updateActiveChannelLimit(channelId, limit) {
    const database = await initDB();
    await database.run('UPDATE active_channels SET member_limit = ? WHERE channel_id = ?', [limit, channelId]);
}

/**
 * Updates the lock state of an active temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {boolean} isLocked Whether the channel is locked
 * @returns {Promise<void>}
 */
async function updateActiveChannelLock(channelId, isLocked) {
    const database = await initDB();
    await database.run('UPDATE active_channels SET is_locked = ? WHERE channel_id = ?', [isLocked ? 1 : 0, channelId]);
}

/**
 * Updates the control panel message ID for an active temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {string} panelMessageId Discord Message ID
 * @returns {Promise<void>}
 */
async function updateActiveChannelPanelMessage(channelId, panelMessageId) {
    const database = await initDB();
    await database.run('UPDATE active_channels SET panel_message_id = ? WHERE channel_id = ?', [panelMessageId, channelId]);
}

/**
 * Appends a blackbox event record for a temporary voice channel.
 * @param {string} channelId Discord Voice Channel ID
 * @param {'join'|'leave'|'move'|'message'|'control'} eventType Event category
 * @param {object} dataObj Event payload metadata
 * @returns {Promise<void>}
 */
async function logEvent(channelId, eventType, dataObj) {
    const database = await initDB();
    await database.run(
        'INSERT INTO events (channel_id, event_type, timestamp, data) VALUES (?, ?, ?, ?)',
        [channelId, eventType, Date.now(), JSON.stringify(dataObj || {})]
    );
}

/**
 * Retrieves all chronological blackbox events for a specific channel.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<Array<object>>} Array of parsed event objects
 */
async function getEvents(channelId) {
    const database = await initDB();
    const rows = await database.all('SELECT * FROM events WHERE channel_id = ? ORDER BY timestamp ASC', [channelId]);
    return rows.map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        eventType: row.event_type,
        timestamp: row.timestamp,
        data: safeJsonParse(row.data, {})
    }));
}

/**
 * Deletes all blackbox events for a specific channel.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {Promise<void>}
 */
async function clearEvents(channelId) {
    const database = await initDB();
    await database.run('DELETE FROM events WHERE channel_id = ?', [channelId]);
}

/**
 * Retrieves all active temporary channels spawned from a given master channel.
 * @param {string} masterId Master Voice Channel ID
 * @returns {Promise<Array<object>>} List of active channel rows
 */
async function getActiveChannelsByMaster(masterId) {
    const database = await initDB();
    return await database.all('SELECT * FROM active_channels WHERE master_id = ?', [masterId]);
}

/**
 * Retrieves all active temporary voice channels across all guilds.
 * @returns {Promise<Array<object>>} List of active channel rows
 */
async function getAllActiveChannels() {
    const database = await initDB();
    return await database.all('SELECT * FROM active_channels');
}

module.exports = {
    initDB,
    safeJsonParse,
    addMasterChannel,
    removeMasterChannel,
    getMasterChannel,
    getAllMasterChannels,
    addActiveChannel,
    removeActiveChannel,
    cleanupChannelRecords,
    getActiveChannel,
    updateActiveChannelOwner,
    updateActiveChannelName,
    updateActiveChannelLimit,
    updateActiveChannelLock,
    updateActiveChannelPanelMessage,
    logEvent,
    getEvents,
    clearEvents,
    getActiveChannelsByMaster,
    getAllActiveChannels,
    setGuildLogWebhook,
    getGuildLogWebhook,
    setGuildLogChannel,
    getGuildLogChannel,
    getAllGuildSettings
};
