/**
 * @file clientOptions.js
 * @description Discord.js Client configuration including Gateway intents, partials,
 * bounded memory caches, and periodic message sweepers to prevent memory leaks.
 */

const { GatewayIntentBits, Partials, Options } = require('discord.js');

const clientOptions = {
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember
    ],
    // Bound unused caches to 0 so long-running bot sessions never leak memory
    makeCache: Options.cacheWithLimits({
        MessageManager: 25,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0,
        ThreadMemberManager: 0,
        GuildScheduledEventManager: 0,
        AutoModerationRuleManager: 0
    }),
    sweepers: {
        messages: {
            interval: 300,
            lifetime: 900
        }
    }
};

module.exports = { clientOptions };
