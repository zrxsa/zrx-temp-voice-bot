/**
 * @file index.js
 * @description Main entry point for the Discord Temporary Voice Channels Bot.
 * Initializes environment variables, Discord Client, isolated event boundaries,
 * WebSocket/REST anti-crash listeners, and automatic login retry backoff.
 */

require('dotenv').config();
const { Client, Events } = require('discord.js');
const { clientOptions } = require('./src/config/clientOptions');

// Event Modules
const readyEvent = require('./src/events/ready');
const voiceStateUpdateEvent = require('./src/events/voiceStateUpdate');
const messageCreateEvent = require('./src/events/messageCreate');
const interactionCreateEvent = require('./src/events/interactionCreate');
const channelDeleteEvent = require('./src/events/channelDelete');

// Create Discord Client instance with bounded caches and sweepers
const client = new Client(clientOptions);

// Register all client events inside isolated async error boundaries
// so an unhandled exception inside one event listener can never crash the bot process.
const eventModules = [
    readyEvent,
    voiceStateUpdateEvent,
    messageCreateEvent,
    interactionCreateEvent,
    channelDeleteEvent
];

for (const eventModule of eventModules) {
    /**
     * Wraps an event handler execution in a try/catch block.
     * @param {...any} args
     * @returns {Promise<void>}
     */
    const safeEventWrapper = async (...args) => {
        try {
            await eventModule.execute(...args);
        } catch (err) {
            console.error(`[Event Error: ${eventModule.name}]`, err);
        }
    };

    if (eventModule.once) {
        client.once(eventModule.name, safeEventWrapper);
    } else {
        client.on(eventModule.name, safeEventWrapper);
    }
}

// Discord Gateway, Client & Shard Anti-Crash Listeners
client.on(Events.Error, (err) => {
    console.error('[Discord Client Error]', err);
});

client.on(Events.Warn, (warning) => {
    console.warn('[Discord Client Warn]', warning);
});

client.on(Events.ShardError, (err, shardId) => {
    console.error(`[Shard ${shardId} WebSocket Error]`, err);
});

client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    console.warn(`[Shard ${shardId} Disconnected] Close code: ${closeEvent?.code ?? 'unknown'}`);
});

client.on(Events.ShardReconnecting, (shardId) => {
    console.log(`[Shard ${shardId}] Reconnecting to Discord Gateway...`);
});

client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`[Shard ${shardId}] Gateway connection resumed (${replayedEvents} events replayed).`);
});

if (client.rest) {
    client.rest.on('rateLimited', (rateLimitInfo) => {
        if (rateLimitInfo.global || rateLimitInfo.timeToReset > 5000) {
            console.warn(
                `[REST RateLimit] Route: ${rateLimitInfo.route} | Retry after: ${rateLimitInfo.timeToReset}ms | Global: ${Boolean(rateLimitInfo.global)}`
            );
        }
    });
}

// Global Process Anti-Crash Handlers
process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('[Uncaught Exception]', err, origin);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error('[Uncaught Exception Monitor]', err.message, origin);
});

/**
 * Connects the Discord Client with automatic retry backoff if the initial network request fails.
 * Stops retrying only if the token itself is rejected as invalid by Discord.
 * @param {string} token Discord Bot Token from environment variables
 * @returns {Promise<void>}
 */
async function loginWithRetry(token) {
    const retryDelayMs = 5000;
    while (true) {
        try {
            await client.login(token);
            break;
        } catch (err) {
            console.error(`[Login Error] Failed to login to Discord (${err.message}). Retrying in ${retryDelayMs / 1000}s...`);
            if (err.code === 'TokenInvalid' || err.message?.toLowerCase().includes('invalid token')) {
                console.error('[Fatal Auth Error] DISCORD_TOKEN in .env is invalid. Stopping login retries to prevent IP ban.');
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }
}

// Start Bot
if (!process.env.DISCORD_TOKEN) {
    console.error('[Startup Error] DISCORD_TOKEN is missing from .env file.');
} else {
    loginWithRetry(process.env.DISCORD_TOKEN);
}
