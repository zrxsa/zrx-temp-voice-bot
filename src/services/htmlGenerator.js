/**
 * @file htmlGenerator.js
 * @description Generates an authentic, ultra-sleek, Discord-styled HTML transcript file for temporary voice channel blackbox logs.
 * Includes interactive filtering, message search, Discord markdown parsing, media previews, and system timeline events.
 */

/**
 * Escapes unsafe HTML characters to prevent XSS.
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Parses basic Discord markdown (bold, italic, inline code, codeblocks, mentions, links) into HTML.
 * @param {string} text 
 * @returns {string}
 */
function parseDiscordMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);

    // Code blocks ```code```
    escaped = escaped.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
        return `<pre class="discord-codeblock"><code>${code}</code></pre>`;
    });

    // Inline code `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="discord-inline-code">$1</code>');

    // Bold **text**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *text* or _text_
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough ~~text~~
    escaped = escaped.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Mentions <@ID> or @User
    escaped = escaped.replace(/&lt;@!?(\d+)&gt;/g, '<span class="discord-mention">@مستخدم</span>');

    // URL links
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="discord-link">$1</a>');

    // Line breaks
    escaped = escaped.replace(/\n/g, '<br>');

    return escaped;
}

/**
 * Formats duration in milliseconds into a user-friendly Arabic string.
 * @param {number} ms 
 * @returns {string}
 */
function formatDurationArabic(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) {
        if (days === 1) parts.push('يوم');
        else if (days === 2) parts.push('يومين');
        else if (days >= 3 && days <= 10) parts.push(`${days} أيام`);
        else parts.push(`${days} يومًا`);
    }
    if (hours > 0) {
        if (hours === 1) parts.push('ساعة');
        else if (hours === 2) parts.push('ساعتين');
        else if (hours >= 3 && hours <= 10) parts.push(`${hours} ساعات`);
        else parts.push(`${hours} ساعة`);
    }
    if (minutes > 0) {
        if (minutes === 1) parts.push('دقيقة');
        else if (minutes === 2) parts.push('دقيقتين');
        else if (minutes >= 3 && minutes <= 10) parts.push(`${minutes} دقائق`);
        else parts.push(`${minutes} دقيقة`);
    }
    if (seconds > 0 || parts.length === 0) {
        if (seconds === 1) parts.push('ثانية');
        else if (seconds === 2) parts.push('ثانيتين');
        else if (seconds >= 3 && seconds <= 10) parts.push(`${seconds} ثوانٍ`);
        else parts.push(`${seconds} ثانية`);
    }

    return parts.join(' و ');
}

/**
 * Formats a timestamp into a full readable date/time string.
 * @param {number} timestamp 
 * @returns {string}
 */
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ar-EG', {
        timeZone: 'UTC',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + ' UTC';
}

/**
 * Formats a timestamp into a short time string (HH:MM AM/PM).
 * @param {number} timestamp 
 * @returns {string}
 */
function formatShortTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ar-EG', {
        timeZone: 'UTC',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Generates an authentic avatar element (IMG or SVG initial fallback).
 * @param {object} user 
 * @returns {string}
 */
function getAvatarHtml(user) {
    if (user && user.avatarUrl) {
        return `<img class="discord-avatar" src="${user.avatarUrl}" alt="${escapeHtml(user.username)}" onerror="this.onerror=null; this.outerHTML='<div class=\\'discord-avatar-fallback\\'>${escapeHtml((user.username || 'U')[0].toUpperCase())}</div>';">`;
    }

    const username = (user && user.username) || 'U';
    const initial = username[0].toUpperCase();
    const colors = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#1abc9c', '#9b59b6', '#3498db'];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const color = colors[hash % colors.length];

    return `<div class="discord-avatar-fallback" style="background-color: ${color};">${escapeHtml(initial)}</div>`;
}

/**
 * Renders attachment elements (Images, Audio, Video, Files) in Discord style.
 * @param {Array<string>} attachments 
 * @returns {string}
 */
function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';

    let html = '<div class="discord-attachments">';
    for (const url of attachments) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url.split('?')[0]);
        const isVideo = /\.(mp4|webm|mov)$/i.test(url.split('?')[0]);
        const filename = url.split('/').pop().split('?')[0] || 'ملف مرفق';

        if (isImage) {
            html += `
            <div class="attachment-image-card">
                <a href="${url}" target="_blank" rel="noopener noreferrer">
                    <img src="${url}" alt="صورة مرفقة" loading="lazy" />
                </a>
            </div>`;
        } else if (isVideo) {
            html += `
            <div class="attachment-video-card">
                <video controls preload="metadata">
                    <source src="${url}">
                    المتصفح لا يدعم تشغيل الفيديو.
                </video>
            </div>`;
        } else {
            html += `
            <div class="attachment-file-card">
                <div class="file-icon">📄</div>
                <div class="file-info">
                    <a href="${url}" target="_blank" rel="noopener noreferrer" class="file-name">${escapeHtml(filename)}</a>
                    <span class="file-sub">انقر للتنزيل أو العرض</span>
                </div>
            </div>`;
        }
    }
    html += '</div>';
    return html;
}

const { getConfig } = require('../config/botConfig');

/**
 * Generates the complete, authentic Discord-styled HTML transcript.
 * @param {object} channelInfo Record from `active_channels` table
 * @param {object|null} ownerUser Owner user details from Discord
 * @param {Array<object>} [events=[]] List of blackbox events
 * @param {string} [footerBrand] Optional configurable footer brand from `config.json`
 * @returns {string} Complete HTML string
 */
function generateHtmlTranscript(channelInfo, ownerUser, events = [], footerBrand = undefined) {
    const resolvedBrand =
        typeof footerBrand === 'string' ? footerBrand.trim() : getConfig().embedFooter.trim();
    const creationTime = channelInfo.created_at || Date.now();
    const deletionTime = Date.now();
    const durationMs = deletionTime - creationTime;

    const messageCount = events.filter(e => e.eventType === 'message').length;
    const joinCount = events.filter(e => e.eventType === 'join').length;
    const leaveCount = events.filter(e => e.eventType === 'leave').length;
    const moveCount = events.filter(e => e.eventType === 'move').length;
    const controlCount = events.filter(e => e.eventType === 'control').length;

    const ownerName = ownerUser ? `@${ownerUser.username}` : (channelInfo.owner_id ? `@${channelInfo.owner_id}` : 'روم عام');
    const channelTypeName = channelInfo.type === 'owned' ? 'روم تحكم خاص' : 'روم عام متسلسل';

    // Render Events Timeline
    let eventsHtml = '';
    if (events.length === 0) {
        eventsHtml = `
        <div class="discord-empty-state">
            <div class="empty-icon">💬</div>
            <h3>لا توجد رسائل أو أحداث</h3>
            <p>تم إغلاق هذا الروم الصوتي دون تسجيل أي رسائل نصية أو أحداث إضافية.</p>
        </div>`;
    } else {
        for (const event of events) {
            const data = event.data || {};
            const timeStr = formatShortTime(event.timestamp);
            const fullTimeStr = formatDateTime(event.timestamp);

            switch (event.eventType) {
                case 'message': {
                    const author = data.author || { username: 'مستخدم', bot: false };
                    const parsedContent = parseDiscordMarkdown(data.content || '');
                    const attachmentsHtml = renderAttachments(data.attachments);

                    eventsHtml += `
                    <div class="discord-message" data-type="message" data-user="${escapeHtml(author.username)}">
                        <div class="message-avatar-col">
                            ${getAvatarHtml(author)}
                        </div>
                        <div class="message-body-col">
                            <div class="message-header">
                                <span class="message-author">${escapeHtml(author.username)}</span>
                                ${author.bot ? '<span class="discord-bot-badge">بوت</span>' : ''}
                                <span class="message-timestamp" title="${fullTimeStr}">${timeStr}</span>
                            </div>
                            ${parsedContent ? `<div class="message-text">${parsedContent}</div>` : ''}
                            ${attachmentsHtml}
                        </div>
                    </div>`;
                    break;
                }

                case 'join': {
                    const user = data.user || { username: 'عضو' };
                    eventsHtml += `
                    <div class="discord-system-event event-join" data-type="voice" data-user="${escapeHtml(user.username)}">
                        <span class="system-icon">📥</span>
                        <div class="system-text">
                            انضم <strong>${escapeHtml(user.username)}</strong> إلى الروم الصوتي.
                        </div>
                        <span class="system-time" title="${fullTimeStr}">${timeStr}</span>
                    </div>`;
                    break;
                }

                case 'leave': {
                    const user = data.user || { username: 'عضو' };
                    eventsHtml += `
                    <div class="discord-system-event event-leave" data-type="voice" data-user="${escapeHtml(user.username)}">
                        <span class="system-icon">📤</span>
                        <div class="system-text">
                            غادر <strong>${escapeHtml(user.username)}</strong> الروم الصوتي.
                        </div>
                        <span class="system-time" title="${fullTimeStr}">${timeStr}</span>
                    </div>`;
                    break;
                }

                case 'move': {
                    const user = data.user || { username: 'عضو' };
                    eventsHtml += `
                    <div class="discord-system-event event-move" data-type="voice" data-user="${escapeHtml(user.username)}">
                        <span class="system-icon">🔁</span>
                        <div class="system-text">
                            انتقل <strong>${escapeHtml(user.username)}</strong> من <code class="discord-inline-code">${escapeHtml(data.fromChannel || 'قناة')}</code> إلى <code class="discord-inline-code">${escapeHtml(data.toChannel || 'قناة')}</code>.
                        </div>
                        <span class="system-time" title="${fullTimeStr}">${timeStr}</span>
                    </div>`;
                    break;
                }

                case 'control': {
                    const user = data.user || { username: 'المالك' };
                    eventsHtml += `
                    <div class="discord-system-event event-control" data-type="control" data-user="${escapeHtml(user.username)}">
                        <span class="system-icon">⚙️</span>
                        <div class="system-text">
                            <strong>إجراء تحكم:</strong> قام <strong>${escapeHtml(user.username)}</strong> بـ <strong>${escapeHtml(data.action || 'تعديل')}</strong> <span class="control-details">(${escapeHtml(data.details || '')})</span>
                        </div>
                        <span class="system-time" title="${fullTimeStr}">${timeStr}</span>
                    </div>`;
                    break;
                }
            }
        }
    }

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>أرشيف الروم الصوتي | ${escapeHtml(channelInfo.name)}</title>
    <!-- خط تجول العربي المتناسق مع ديسكورد -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #313338;
            --bg-secondary: #2b2d31;
            --bg-tertiary: #1e1f22;
            --bg-floating: #232428;
            --bg-modifier-hover: rgba(255, 255, 255, 0.04);
            --bg-modifier-active: rgba(255, 255, 255, 0.07);
            
            --text-normal: #dbdee1;
            --text-muted: #949ba4;
            --text-heading: #f2f3f5;
            --text-link: #00a8fc;
            
            --brand: #5865f2;
            --brand-light: #7983f5;
            --brand-subtle: rgba(88, 101, 242, 0.15);
            --success: #23a55a;
            --danger: #f23f43;
            --warning: #f0b232;
            
            --border-subtle: rgba(255, 255, 255, 0.06);
            --border-radius-sm: 4px;
            --border-radius-md: 8px;
            --border-radius-lg: 12px;
            --border-radius-xl: 16px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-tertiary);
            color: var(--text-normal);
            font-family: 'Tajawal', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.5;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            padding: 24px 16px;
        }

        .discord-app {
            width: 100%;
            max-width: 1000px;
            background-color: var(--bg-primary);
            border-radius: var(--border-radius-lg);
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid var(--border-subtle);
        }

        /* 1. Header Bar */
        .discord-header {
            background-color: var(--bg-secondary);
            border-bottom: 1px solid var(--border-subtle);
            padding: 20px 24px;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .channel-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
        }

        .channel-main-info {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .channel-icon-wrapper {
            width: 46px;
            height: 46px;
            border-radius: 12px;
            background: linear-gradient(135deg, var(--brand), #4752c4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(88, 101, 242, 0.35);
        }

        .channel-titles h1 {
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--text-heading);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .channel-badge {
            font-size: 0.72rem;
            font-weight: 600;
            background-color: var(--brand-subtle);
            color: #c9cdfb;
            padding: 2px 8px;
            border-radius: 20px;
            border: 1px solid rgba(88, 101, 242, 0.3);
        }

        .channel-subtitle {
            font-size: 0.85rem;
            color: var(--text-muted);
            margin-top: 2px;
        }

        .channel-stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-top: 18px;
            padding-top: 18px;
            border-top: 1px solid var(--border-subtle);
        }

        .stat-item {
            background-color: rgba(0, 0, 0, 0.15);
            padding: 10px 14px;
            border-radius: var(--border-radius-md);
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .stat-label {
            font-size: 0.75rem;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
        }

        .stat-value {
            font-size: 0.92rem;
            color: var(--text-normal);
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .stat-value.owner {
            color: var(--brand-light);
        }

        /* Quick Badges Counter */
        .counter-badges {
            display: flex;
            gap: 10px;
            margin-top: 14px;
            flex-wrap: wrap;
        }

        .count-pill {
            background-color: var(--bg-tertiary);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text-normal);
            display: flex;
            align-items: center;
            gap: 6px;
            border: 1px solid var(--border-subtle);
        }

        /* 2. Interactive Search & Filter Bar */
        .discord-toolbar {
            background-color: var(--bg-floating);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            border-bottom: 1px solid var(--border-subtle);
            flex-wrap: wrap;
        }

        .filter-buttons {
            display: flex;
            gap: 8px;
        }

        .filter-btn {
            background-color: transparent;
            border: 1px solid var(--border-subtle);
            color: var(--text-muted);
            padding: 6px 12px;
            border-radius: var(--border-radius-md);
            font-family: inherit;
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .filter-btn:hover {
            background-color: var(--bg-modifier-hover);
            color: var(--text-normal);
        }

        .filter-btn.active {
            background-color: var(--brand);
            border-color: var(--brand);
            color: #ffffff;
        }

        .search-container {
            position: relative;
            flex-grow: 1;
            max-width: 320px;
        }

        .search-input {
            width: 100%;
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--border-radius-md);
            padding: 7px 12px;
            color: var(--text-normal);
            font-family: inherit;
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.2s ease;
        }

        .search-input:focus {
            border-color: var(--brand);
        }

        /* 3. Messages Stream */
        .discord-messages-stream {
            padding: 24px 20px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex-grow: 1;
        }

        .discord-date-divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 16px 0 10px 0;
            color: var(--text-muted);
            font-size: 0.75rem;
            font-weight: 700;
        }

        .discord-date-divider::before,
        .discord-date-divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid var(--border-subtle);
        }

        .discord-date-divider span {
            padding: 0 12px;
        }

        /* User Message */
        .discord-message {
            display: flex;
            gap: 16px;
            padding: 6px 12px;
            border-radius: var(--border-radius-md);
            transition: background-color 0.1s ease;
            position: relative;
        }

        .discord-message:hover {
            background-color: var(--bg-modifier-hover);
        }

        .message-avatar-col {
            flex-shrink: 0;
            padding-top: 2px;
        }

        .discord-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            display: block;
        }

        .discord-avatar-fallback {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-weight: 700;
            font-size: 1.1rem;
        }

        .message-body-col {
            flex-grow: 1;
            min-width: 0;
        }

        .message-header {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 2px;
        }

        .message-author {
            font-size: 0.98rem;
            font-weight: 600;
            color: var(--text-heading);
        }

        .discord-bot-badge {
            background-color: var(--brand);
            color: #ffffff;
            font-size: 0.62rem;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 3px;
            text-transform: uppercase;
            line-height: 1.2;
            vertical-align: middle;
        }

        .message-timestamp {
            font-size: 0.72rem;
            color: var(--text-muted);
        }

        .message-text {
            font-size: 0.95rem;
            color: var(--text-normal);
            word-break: break-word;
            line-height: 1.45;
        }

        .discord-mention {
            background-color: var(--brand-subtle);
            color: #c9cdfb;
            padding: 0 4px;
            border-radius: 3px;
            font-weight: 600;
        }

        .discord-inline-code {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            padding: 1px 5px;
            border-radius: var(--border-radius-sm);
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.85rem;
            color: #e0e2e5;
        }

        .discord-codeblock {
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-subtle);
            padding: 10px 14px;
            border-radius: var(--border-radius-md);
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.85rem;
            margin-top: 6px;
            overflow-x: auto;
            color: #e0e2e5;
        }

        .discord-link {
            color: var(--text-link);
            text-decoration: none;
        }

        .discord-link:hover {
            text-decoration: underline;
        }

        /* Attachments */
        .discord-attachments {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .attachment-image-card img {
            max-width: 440px;
            max-height: 320px;
            border-radius: var(--border-radius-md);
            border: 1px solid var(--border-subtle);
            object-fit: contain;
            display: block;
        }

        .attachment-file-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--border-radius-md);
            padding: 10px 14px;
            display: inline-flex;
            align-items: center;
            gap: 12px;
            max-width: 400px;
        }

        .attachment-file-card .file-name {
            color: var(--text-link);
            font-weight: 600;
            font-size: 0.9rem;
            text-decoration: none;
        }

        .attachment-file-card .file-sub {
            font-size: 0.72rem;
            color: var(--text-muted);
            display: block;
        }

        /* System Events */
        .discord-system-event {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 14px;
            border-radius: var(--border-radius-md);
            font-size: 0.88rem;
            color: var(--text-muted);
            margin: 2px 0;
            transition: background-color 0.1s ease;
        }

        .discord-system-event:hover {
            background-color: var(--bg-modifier-hover);
        }

        .discord-system-event strong {
            color: var(--text-heading);
        }

        .system-icon {
            font-size: 1rem;
            width: 22px;
            display: flex;
            justify-content: center;
        }

        .system-text {
            flex-grow: 1;
        }

        .system-time {
            font-size: 0.72rem;
            color: var(--text-muted);
        }

        .control-details {
            font-size: 0.8rem;
            color: var(--text-muted);
        }

        .event-join { color: var(--success); }
        .event-leave { color: var(--danger); }
        .event-move { color: var(--text-link); }
        .event-control { color: var(--warning); }

        /* Empty State */
        .discord-empty-state {
            padding: 60px 20px;
            text-align: center;
            color: var(--text-muted);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        .discord-empty-state .empty-icon {
            font-size: 3.5rem;
            opacity: 0.4;
        }

        /* Footer */
        .discord-footer {
            background-color: var(--bg-secondary);
            border-top: 1px solid var(--border-subtle);
            padding: 16px 24px;
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }

        @media (max-width: 650px) {
            body { padding: 0; }
            .discord-app { border-radius: 0; border: none; }
            .channel-stats-row { grid-template-columns: 1fr; }
            .attachment-image-card img { max-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="discord-app">
        <!-- 1. Header Bar -->
        <header class="discord-header">
            <div class="channel-title-row">
                <div class="channel-main-info">
                    <div class="channel-icon-wrapper">🎙️</div>
                    <div class="channel-titles">
                        <h1>
                            ${escapeHtml(channelInfo.name)}
                            <span class="channel-badge">${escapeHtml(channelTypeName)}</span>
                        </h1>
                        <div class="channel-subtitle">سجل الصندوق الأسود وأرشيف الروم المؤقت المكتمل</div>
                    </div>
                </div>
            </div>

            <!-- Channel Stats Grid -->
            <div class="channel-stats-row">
                <div class="stat-item">
                    <span class="stat-label">مالك الروم</span>
                    <span class="stat-value owner">${escapeHtml(ownerName)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">تاريخ الإنشاء</span>
                    <span class="stat-value">${formatDateTime(creationTime)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">تاريخ الإغلاق</span>
                    <span class="stat-value">${formatDateTime(deletionTime)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">المدة النشطة</span>
                    <span class="stat-value">${formatDurationArabic(durationMs)}</span>
                </div>
            </div>

            <!-- Quick Pill Counters -->
            <div class="counter-badges">
                <div class="count-pill">💬 <strong>${messageCount}</strong> رسائل شات</div>
                <div class="count-pill">📥 <strong>${joinCount}</strong> انضمام</div>
                <div class="count-pill">📤 <strong>${leaveCount}</strong> مغادرة</div>
                <div class="count-pill">⚙️ <strong>${controlCount}</strong> إجراءات تحكم</div>
            </div>
        </header>

        <!-- 2. Interactive Search & Filters -->
        <div class="discord-toolbar">
            <div class="filter-buttons">
                <button class="filter-btn active" data-filter="all">الكل (${events.length})</button>
                <button class="filter-btn" data-filter="message">💬 الرسائل (${messageCount})</button>
                <button class="filter-btn" data-filter="voice">🎙️ الصوت (${joinCount + leaveCount + moveCount})</button>
                <button class="filter-btn" data-filter="control">⚙️ التحكم (${controlCount})</button>
            </div>
            <div class="search-container">
                <input type="text" class="search-input" id="transcriptSearch" placeholder="بحث في الرسائل أو أسماء الأعضاء...">
            </div>
        </div>

        <!-- 3. Message Stream -->
        <main class="discord-messages-stream" id="messagesStream">
            <div class="discord-date-divider">
                <span>سجل الأحداث الكامل للروم</span>
            </div>
            ${eventsHtml}
        </main>

        <!-- 4. Footer -->
        <footer class="discord-footer">
            <span>${resolvedBrand ? `تم إنشاء هذا السجل تلقائياً — ${escapeHtml(resolvedBrand)}` : 'تم إنشاء هذا السجل تلقائياً'}</span>
            <span>${formatDateTime(deletionTime)}</span>
        </footer>
    </div>

    <!-- Client-Side Filter & Search Script -->
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const filterBtns = document.querySelectorAll('.filter-btn');
            const searchInput = document.getElementById('transcriptSearch');
            const rows = document.querySelectorAll('#messagesStream > div[data-type]');

            let currentFilter = 'all';
            let searchQuery = '';

            function updateVisibility() {
                rows.forEach(row => {
                    const rowType = row.getAttribute('data-type');
                    const user = (row.getAttribute('data-user') || '').toLowerCase();
                    const text = (row.textContent || '').toLowerCase();

                    const matchesFilter = (currentFilter === 'all' || rowType === currentFilter);
                    const matchesSearch = !searchQuery || user.includes(searchQuery) || text.includes(searchQuery);

                    if (matchesFilter && matchesSearch) {
                        row.style.display = 'flex';
                    } else {
                        row.style.display = 'none';
                    }
                });
            }

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentFilter = btn.getAttribute('data-filter');
                    updateVisibility();
                });
            });

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value.trim().toLowerCase();
                    updateVisibility();
                });
            }
        });
    </script>
</body>
</html>`;
}

module.exports = {
    generateHtmlTranscript
};
