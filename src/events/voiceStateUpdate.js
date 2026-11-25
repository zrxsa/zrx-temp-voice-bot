/**
 * @file voiceStateUpdate.js
 * @description Dispatches voice state updates to `handleVoiceLeave` and `handleVoiceJoin`
 * inside independent error boundaries so a failure in one never blocks the other.
 */

const { Events } = require('discord.js');
const { handleVoiceLeave, handleVoiceJoin } = require('../services/voiceService');

module.exports = {
    name: Events.VoiceStateUpdate,
    once: false,
    /**
     * Executes on every guild member voice state update.
     * @param {import('discord.js').VoiceState} oldState Previous voice state
     * @param {import('discord.js').VoiceState} newState New voice state
     * @returns {Promise<void>}
     */
    async execute(oldState, newState) {
        try {
            await handleVoiceLeave(oldState, newState);
        } catch (err) {
            console.error('[VoiceStateUpdate Leave Error]', err);
        }

        try {
            await handleVoiceJoin(oldState, newState);
        } catch (err) {
            console.error('[VoiceStateUpdate Join Error]', err);
        }
    }
};
