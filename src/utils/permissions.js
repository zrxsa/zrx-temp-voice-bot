/**
 * @file permissions.js
 * @description Permission overwrite builder for temporary voice channels.
 * Sanitizes overwrites against the bot's own guild permissions and 2FA constraints.
 */

const { PermissionsBitField, OverwriteType } = require('discord.js');

/**
 * Guild-wide moderation flags that should never be copied into voice channel overwrites
 * because they can trigger DiscordAPIError[50013] or [60003].
 */
const ELEVATED_MOD_FLAGS = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageWebhooks,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ModerateMembers
];

/**
 * Builds a sanitized array of permission overwrites inherited from the master channel,
 * while granting appropriate voice/text control flags to the room owner and the bot.
 * @param {import('discord.js').VoiceChannel} masterChannel Master creator channel
 * @param {string|null} ownerId Room owner User ID (null for public rooms)
 * @param {string|null} clientUserId Bot User ID
 * @returns {Array<object>} Sanitized permissionOverwrites array
 */
function getMasterPermissionOverwrites(masterChannel, ownerId, clientUserId) {
    const overwritesMap = new Map();
    const guild = masterChannel?.guild;
    const botMember = guild?.members?.me;
    const botPerms = botMember?.permissions;
    const isAdmin = botPerms ? botPerms.has(PermissionsBitField.Flags.Administrator) : true;
    const isMfaElevated = guild?.mfaLevel === 1;

    /**
     * Removes elevated moderation flags and intersects with the bot's own permissions.
     * @param {PermissionsBitField} bitfield Input permissions bitfield
     * @returns {PermissionsBitField} Sanitized permissions bitfield
     */
    const sanitizeFlags = (bitfield) => {
        const cleaned = new PermissionsBitField(bitfield.bitfield);
        cleaned.remove(ELEVATED_MOD_FLAGS);
        if (isMfaElevated) {
            cleaned.remove([
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.ManageThreads
            ]);
        }
        if (botPerms && !isAdmin) {
            return new PermissionsBitField(cleaned.bitfield & botPerms.bitfield);
        }
        return cleaned;
    };

    if (masterChannel?.permissionOverwrites?.cache) {
        for (const [id, overwrite] of masterChannel.permissionOverwrites.cache) {
            // Skip deleted roles or uncached members to avoid Unknown Overwrite (10009)
            if (overwrite.type === OverwriteType.Role && guild && !guild.roles.cache.has(id)) {
                continue;
            }
            if (
                overwrite.type === OverwriteType.Member &&
                guild &&
                id !== ownerId &&
                id !== clientUserId &&
                !guild.members.cache.has(id)
            ) {
                continue;
            }

            const allow = sanitizeFlags(new PermissionsBitField(overwrite.allow.bitfield));
            const deny = sanitizeFlags(new PermissionsBitField(overwrite.deny.bitfield));

            overwritesMap.set(id, {
                id: overwrite.id,
                type: overwrite.type,
                allow,
                deny
            });
        }
    }

    if (ownerId) {
        const ownerOverwrite = overwritesMap.get(ownerId) || {
            id: ownerId,
            type: OverwriteType.Member,
            allow: new PermissionsBitField(),
            deny: new PermissionsBitField()
        };

        const desiredOwnerFlags = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.MuteMembers,
            PermissionsBitField.Flags.DeafenMembers,
            PermissionsBitField.Flags.MoveMembers
        ];

        for (const flag of desiredOwnerFlags) {
            if (!botPerms || isAdmin || botPerms.has(flag)) {
                ownerOverwrite.allow.add(flag);
            }
        }
        overwritesMap.set(ownerId, ownerOverwrite);
    }

    if (clientUserId) {
        const botOverwrite = overwritesMap.get(clientUserId) || {
            id: clientUserId,
            type: OverwriteType.Member,
            allow: new PermissionsBitField(),
            deny: new PermissionsBitField()
        };

        const desiredBotFlags = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AttachFiles
        ];

        if (!isMfaElevated) {
            desiredBotFlags.push(PermissionsBitField.Flags.ManageChannels);
        }

        for (const flag of desiredBotFlags) {
            if (!botPerms || isAdmin || botPerms.has(flag)) {
                botOverwrite.allow.add(flag);
            }
        }
        overwritesMap.set(clientUserId, botOverwrite);
    }

    return Array.from(overwritesMap.values());
}

module.exports = {
    getMasterPermissionOverwrites
};
