/**
 * @file commandHandler.js
 * @description Defines, registers, and handles application slash commands (`/setup-temp-voice`, `/set-temp-webhook`).
 */

const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    REST,
    Routes
} = require('discord.js');
const db = require('../database/database');
const { masterChannelsCache, guildSettingsCache } = require('../services/cacheService');

/**
 * Builds the JSON payload array of application slash commands.
 * @returns {Array<object>} Serialized slash command definitions
 */
function getSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('setup-temp-voice')
            .setDescription('إعداد قناة إنشاء رومات مؤقتة جديدة')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('القناة الصوتية التي ستصبح قناة الإنشاء (الماستر)')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildVoice)
            )
            .addStringOption((option) =>
                option
                    .setName('type')
                    .setDescription('نوع الرومات المؤقتة المنبثقة عنها')
                    .setRequired(true)
                    .addChoices(
                        { name: 'رومات تحكم خاصة بالمالك (Owned Controlling)', value: 'owned' },
                        { name: 'رومات عامة تلقائية متسلسلة (Public Auto-Increment)', value: 'public' }
                    )
            )
            .addStringOption((option) =>
                option
                    .setName('name_template')
                    .setDescription('قالب اسم القنوات الاختياري (تستخدم {user} أو {num})')
                    .setRequired(false)
            )
            .addStringOption((option) =>
                option
                    .setName('webhook_url')
                    .setDescription('رابط الويب هوك الاختياري لإرسال تقارير وسجلات الرومات (Webhook URL)')
                    .setRequired(false)
            ),

        new SlashCommandBuilder()
            .setName('set-temp-webhook')
            .setDescription('تحديد أو تغيير رابط الويب هوك (Webhook) لإرسال سجلات وأرشيف الرومات')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
            .addStringOption((option) =>
                option
                    .setName('url')
                    .setDescription('رابط الويب هوك (Webhook URL)')
                    .setRequired(true)
            )
    ].map((cmd) => cmd.toJSON());
}

/**
 * Registers application slash commands globally via the Discord REST API.
 * @param {string} token Discord Bot Token
 * @param {string} clientId Discord Application Client ID
 * @returns {Promise<void>}
 */
async function registerSlashCommands(token, clientId) {
    if (!token || !clientId) {
        console.warn('[Slash Commands] Missing DISCORD_TOKEN or CLIENT_ID. Skipping global command registration.');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('[Slash Commands] Started refreshing application (/) commands...');
        await rest.put(Routes.applicationCommands(clientId), {
            body: getSlashCommands()
        });
        console.log('[Slash Commands] Successfully reloaded application (/) commands globally.');
    } catch (err) {
        console.error('[Slash Commands Error] Failed to register application commands:', err.message || err);
    }
}

/**
 * Processes chat input slash commands (`/setup-temp-voice`, `/set-temp-webhook`).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction Slash command interaction
 * @returns {Promise<void>}
 */
async function handleChatInputCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: '❌ هذه الأوامر تعمل داخل السيرفرات فقط.',
            flags: [MessageFlags.Ephemeral]
        }).catch(() => null);
        return;
    }

    if (interaction.commandName === 'setup-temp-voice') {
        const channel = interaction.options.getChannel('channel');
        const type = interaction.options.getString('type');
        const template = interaction.options.getString('name_template');
        const webhookUrl = interaction.options.getString('webhook_url');

        if (webhookUrl && !webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
            await interaction.reply({
                content: '❌ رابط الويب هوك غير صالح. يجب أن يبدأ بـ https://',
                flags: [MessageFlags.Ephemeral]
            }).catch(() => null);
            return;
        }

        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            await db.addMasterChannel(channel.id, interaction.guildId, type, template);
            masterChannelsCache.set(channel.id, {
                channel_id: channel.id,
                guild_id: interaction.guildId,
                type,
                name_template: template
            });

            if (webhookUrl) {
                await db.setGuildLogWebhook(interaction.guildId, webhookUrl);
                const currentSettings = guildSettingsCache.get(interaction.guildId) || {};
                guildSettingsCache.set(interaction.guildId, {
                    ...currentSettings,
                    guild_id: interaction.guildId,
                    log_webhook_url: webhookUrl
                });
            }

            const typeLabel = type === 'owned' ? 'روم تحكم خاص بالمالك' : 'روم عام تلقائي';
            const logLabel = webhookUrl ? '✅ مفعل (عبر الويب هوك)' : 'غير محدد (أو من ملف .env)';

            await interaction.editReply({
                content:
                    `✅ تم إعداد قناة الإنشاء بنجاح!\n` +
                    `• **القناة:** <#${channel.id}>\n` +
                    `• **النوع:** ${typeLabel}\n` +
                    `• **القالب:** ${template || 'افتراضي'}\n` +
                    `• **إرسال اللوق:** ${logLabel}`
            });
        } catch (err) {
            console.error('[Command Error] Failed to register master channel in DB:', err);
            const errMsg = '❌ حدث خطأ أثناء محاولة تسجيل قناة الإنشاء في قاعدة البيانات.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errMsg }).catch(() => null);
            } else {
                await interaction.reply({ content: errMsg, flags: [MessageFlags.Ephemeral] }).catch(() => null);
            }
        }
        return;
    }

    if (interaction.commandName === 'set-temp-webhook') {
        const webhookUrl = interaction.options.getString('url');

        if (!webhookUrl || (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://'))) {
            await interaction.reply({
                content: '❌ يرجى إدخال رابط ويب هوك صالح يبدأ بـ https://',
                flags: [MessageFlags.Ephemeral]
            }).catch(() => null);
            return;
        }

        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            await db.setGuildLogWebhook(interaction.guildId, webhookUrl);
            const currentSettings = guildSettingsCache.get(interaction.guildId) || {};
            guildSettingsCache.set(interaction.guildId, {
                ...currentSettings,
                guild_id: interaction.guildId,
                log_webhook_url: webhookUrl
            });

            await interaction.editReply({
                content:
                    '📁 **تم تعيين رابط الويب هوك لسجلات وأرشيف الرومات المؤقتة بنجاح!**\n' +
                    'سيتم إرسال كافة تقارير الصندوق الأسود عبر الويب هوك مباشرة دون الحاجة لإنشاء روم في السيرفر.'
            });
        } catch (err) {
            console.error('[Command Error] Failed to set guild log webhook:', err);
            const errMsg = '❌ حدث خطأ أثناء حفظ رابط الويب هوك في قاعدة البيانات.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errMsg }).catch(() => null);
            } else {
                await interaction.reply({ content: errMsg, flags: [MessageFlags.Ephemeral] }).catch(() => null);
            }
        }
    }
}

module.exports = {
    getSlashCommands,
    registerSlashCommands,
    handleChatInputCommand
};
