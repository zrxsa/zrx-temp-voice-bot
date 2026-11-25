/**
 * @file botConfig.js
 * @description Loads user-editable settings (branding, embed footer, panel texts, dashboard port,
 * and button emojis) from `config.json` with safe fallback defaults.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BUTTON_EMOJIS = {
    topic: '#️⃣',
    waiting: '🕒',
    privacy: '🔒',
    limit: '👥',
    rename: '📝',
    region: '🌐',
    kick: '👢',
    invite: '📩',
    untrust: '💔',
    trust: '🤝',
    delete: '🗑️',
    transfer: '👑',
    claim: '✋',
    unban: '🔓',
    ban: '🚫'
};

const DEFAULT_CONFIG = {
    embedFooter: 'zrx',
    panelTitle: 'TempVoice Interface',
    panelDescription:
        'يمكنك استخدام **الأوامر** للتحكم في الروم الصوتي المؤقت الخاص بك. المزيد من الخيارات متاحة من خلال الأزرار أدناه:',
    panelColor: '#2B2D31',
    dashboardTitle: 'TempVoice',
    dashboardPort: 6767,
    buttonEmojis: { ...DEFAULT_BUTTON_EMOJIS }
};

let cachedConfig = null;

/**
 * Loads and caches `config.json` from the project root with safe fallback defaults.
 * Preserves an intentionally empty `embedFooter` (`""`) so users can disable footers completely.
 * @param {boolean} [forceReload=false] Whether to bypass the in-memory cache
 * @returns {object} Resolved configuration object
 */
function getConfig(forceReload = false) {
    if (cachedConfig && !forceReload) {
        return cachedConfig;
    }

    const configPath = path.join(__dirname, '../../config.json');
    let raw = {};

    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                raw = parsed;
            }
        }
    } catch (err) {
        console.warn('[Config Warn] Failed to parse config.json, using defaults:', err.message);
    }

    const parsedPort = Number(raw.dashboardPort);
    const mergedEmojis = { ...DEFAULT_BUTTON_EMOJIS };
    if (raw.buttonEmojis && typeof raw.buttonEmojis === 'object') {
        for (const key of Object.keys(DEFAULT_BUTTON_EMOJIS)) {
            const val = raw.buttonEmojis[key];
            if (typeof val === 'string' && val.trim().length > 0) {
                mergedEmojis[key] = val.trim();
            }
        }
    }

    cachedConfig = {
        embedFooter: typeof raw.embedFooter === 'string' ? raw.embedFooter : DEFAULT_CONFIG.embedFooter,
        panelTitle:
            typeof raw.panelTitle === 'string' && raw.panelTitle.trim()
                ? raw.panelTitle.trim()
                : DEFAULT_CONFIG.panelTitle,
        panelDescription:
            typeof raw.panelDescription === 'string' && raw.panelDescription.trim()
                ? raw.panelDescription.trim()
                : DEFAULT_CONFIG.panelDescription,
        panelColor:
            typeof raw.panelColor === 'string' && raw.panelColor.trim()
                ? raw.panelColor.trim()
                : DEFAULT_CONFIG.panelColor,
        dashboardTitle:
            typeof raw.dashboardTitle === 'string' && raw.dashboardTitle.trim()
                ? raw.dashboardTitle.trim()
                : DEFAULT_CONFIG.dashboardTitle,
        dashboardPort:
            Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
                ? parsedPort
                : DEFAULT_CONFIG.dashboardPort,
        buttonEmojis: mergedEmojis
    };

    return cachedConfig;
}

/**
 * Resolves a hex color string (e.g. `#2B2D31`) or integer into a Discord numeric color.
 * @param {string|number} colorValue Configured color value
 * @param {number} [fallback=0x2B2D31] Fallback numeric color
 * @returns {number} 24-bit integer color
 */
function resolveColor(colorValue, fallback = 0x2B2D31) {
    if (typeof colorValue === 'number' && Number.isInteger(colorValue) && colorValue >= 0 && colorValue <= 0xFFFFFF) {
        return colorValue;
    }
    if (typeof colorValue === 'string') {
        const cleaned = colorValue.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
            return parseInt(cleaned, 16);
        }
    }
    return fallback;
}

/**
 * Attaches a configurable embed footer only when `footerText` is non-empty.
 * Avoids Discord.js errors when a user intentionally clears `embedFooter` to `""`.
 * @param {import('discord.js').EmbedBuilder} embed Target embed builder
 * @param {string|null|undefined} footerText Configured footer text
 * @returns {import('discord.js').EmbedBuilder} The same embed builder
 */
function applyEmbedFooter(embed, footerText) {
    const trimmed = typeof footerText === 'string' ? footerText.trim() : '';
    if (trimmed) {
        embed.setFooter({ text: trimmed });
    }
    return embed;
}

/**
 * Returns the configured emoji (Unicode or custom Discord emoji ID) for a control panel button.
 * @param {string} key Button emoji key in `config.json`
 * @returns {string} Valid emoji string or ID
 */
function getButtonEmoji(key) {
    const cfg = getConfig();
    return cfg.buttonEmojis[key] || DEFAULT_BUTTON_EMOJIS[key] || '⚙️';
}

module.exports = {
    DEFAULT_CONFIG,
    DEFAULT_BUTTON_EMOJIS,
    getConfig,
    resolveColor,
    applyEmbedFooter,
    getButtonEmoji
};
