/**
 * @file cacheService.js
 * @description In-memory hot caches, concurrency locks, non-blocking asset loader,
 * and rate-limit/cooldown trackers with automatic memory garbage collection.
 */

const fs = require('fs');
const path = require('path');
const db = require('../database/database');

// Hot In-Memory Lookup Maps
const activeChannelsCache = new Map(); // channel_id -> active_channels row
const masterChannelsCache = new Map(); // channel_id -> master_channels row
const guildSettingsCache = new Map();  // guild_id -> guild_settings row

// Concurrency Locks to prevent race conditions on simultaneous voice events
const deletingChannelsLock = new Set(); // channel_id currently being archived/deleted
const creatingUsersLock = new Set();    // user_id currently spawning a temporary room

// Cooldown & Rate-Limit State Maps
const buttonCooldowns = new Map();           // user_id -> last click timestamp
const channelCreationCooldowns = new Map();  // user_id -> last creation timestamp
const channelRenameHistory = new Map();      // channel_id -> number[] of rename timestamps
const guildMfaWarningTimestamps = new Map(); // guild_id -> last 60003 warning timestamp

// Cached Control Panel Banner Image Buffer
let panelImageBuffer = null;

/**
 * Loads `image.png` into memory asynchronously so file I/O never blocks the Node.js event loop.
 * @returns {Promise<Buffer|null>} Image buffer or null if missing
 */
async function loadPanelImageAsync() {
    try {
        const imagePath = path.join(__dirname, '../../image.png');
        await fs.promises.access(imagePath, fs.constants.R_OK);
        panelImageBuffer = await fs.promises.readFile(imagePath);
        return panelImageBuffer;
    } catch (err) {
        console.warn('[CacheService Warn] Could not pre-load image.png into memory:', err.message);
        panelImageBuffer = null;
        return null;
    }
}

/**
 * Returns the pre-loaded control panel image buffer.
 * @returns {Buffer|null} Cached buffer or null
 */
function getPanelImageBuffer() {
    return panelImageBuffer;
}

// Periodic cleanup timer (every 5 minutes) to prevent unbounded Map growth
const cleanupInterval = setInterval(() => {
    const now = Date.now();

    for (const [userId, timestamp] of buttonCooldowns.entries()) {
        if (now - timestamp > 30000) buttonCooldowns.delete(userId);
    }

    for (const [userId, timestamp] of channelCreationCooldowns.entries()) {
        if (now - timestamp > 30000) channelCreationCooldowns.delete(userId);
    }

    for (const [channelId, timestamps] of channelRenameHistory.entries()) {
        const recent = timestamps.filter((ts) => now - ts < 600000);
        if (recent.length === 0) {
            channelRenameHistory.delete(channelId);
        } else {
            channelRenameHistory.set(channelId, recent);
        }
    }

    for (const [guildId, timestamp] of guildMfaWarningTimestamps.entries()) {
        if (now - timestamp > 300000) guildMfaWarningTimestamps.delete(guildId);
    }
}, 300000);

if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
}

/**
 * Initializes the SQLite database, preloads `image.png`, and populates all in-memory caches.
 * @returns {Promise<void>}
 */
async function initCaches() {
    try {
        await Promise.all([
            db.initDB(),
            loadPanelImageAsync()
        ]);

        const [activeList, masterList, settingsList] = await Promise.all([
            db.getAllActiveChannels(),
            db.getAllMasterChannels(),
            db.getAllGuildSettings()
        ]);

        activeChannelsCache.clear();
        masterChannelsCache.clear();
        guildSettingsCache.clear();

        for (const ac of activeList) {
            activeChannelsCache.set(ac.channel_id, ac);
        }
        for (const mc of masterList) {
            masterChannelsCache.set(mc.channel_id, mc);
        }
        for (const setting of settingsList) {
            guildSettingsCache.set(setting.guild_id, setting);
        }

        console.log(
            `[CacheService] Loaded ${activeList.length} active channels, ${masterList.length} master channels, and ${settingsList.length} guild settings into RAM.`
        );
    } catch (err) {
        console.error('[CacheService Error] Failed to initialize caches:', err);
    }
}

/**
 * Checks and sets a user's button interaction cooldown.
 * @param {string} userId Discord User ID
 * @param {number} cooldownMs Cooldown duration in milliseconds
 * @returns {{ onCooldown: boolean, remainingSec: string }} Cooldown status
 */
function checkButtonCooldown(userId, cooldownMs = 3000) {
    const now = Date.now();
    const last = buttonCooldowns.get(userId);

    if (last && now - last < cooldownMs) {
        const remainingSec = ((cooldownMs - (now - last)) / 1000).toFixed(1);
        return { onCooldown: true, remainingSec };
    }

    buttonCooldowns.set(userId, now);
    return { onCooldown: false, remainingSec: '0' };
}

/**
 * Checks and sets a user's room creation cooldown.
 * @param {string} userId Discord User ID
 * @param {number} cooldownMs Cooldown duration in milliseconds
 * @returns {boolean} True if user is currently on cooldown
 */
function checkCreationCooldown(userId, cooldownMs = 5000) {
    const now = Date.now();
    const last = channelCreationCooldowns.get(userId);

    if (last && now - last < cooldownMs) {
        return true;
    }

    channelCreationCooldowns.set(userId, now);
    return false;
}

/**
 * Clears a user's room creation cooldown (used when channel creation fails due to an API error).
 * @param {string} userId Discord User ID
 * @returns {void}
 */
function clearCreationCooldown(userId) {
    channelCreationCooldowns.delete(userId);
}

/**
 * Enforces Discord's channel rename limit (max 2 renames per 10 minutes per channel)
 * so the bot never blocks on a 10-minute REST rate limit bucket.
 * @param {string} channelId Discord Voice Channel ID
 * @returns {{ allowed: boolean, remainingSec: number }} Rate limit check result
 */
function checkChannelRenameLimit(channelId) {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const history = (channelRenameHistory.get(channelId) || []).filter((ts) => now - ts < windowMs);

    if (history.length >= 2) {
        const oldest = history[0];
        const remainingSec = Math.ceil((windowMs - (now - oldest)) / 1000);
        channelRenameHistory.set(channelId, history);
        return { allowed: false, remainingSec };
    }

    history.push(now);
    channelRenameHistory.set(channelId, history);
    return { allowed: true, remainingSec: 0 };
}

module.exports = {
    activeChannelsCache,
    masterChannelsCache,
    guildSettingsCache,
    deletingChannelsLock,
    creatingUsersLock,
    guildMfaWarningTimestamps,
    get panelImageBuffer() {
        return panelImageBuffer;
    },
    getPanelImageBuffer,
    initCaches,
    checkButtonCooldown,
    checkCreationCooldown,
    clearCreationCooldown,
    checkChannelRenameLimit
};
