/**
 * @file app.js
 * @description Frontend client script for the TempVoice Web Dashboard.
 * Handles tab navigation, real-time polling, search filtering, and room/master channel actions.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Navigation & Layout Elements
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const manualRefreshBtn = document.getElementById('manual-refresh-btn');
    const activeRoomsCountBadge = document.getElementById('active-rooms-count');
    const pageTitle = document.getElementById('current-page-title');
    const pageDesc = document.getElementById('current-page-desc');

    // Overview Stat Elements
    const statActiveChannels = document.getElementById('stat-active-channels');
    const statActiveUsers = document.getElementById('stat-active-users');
    const statMasterChannels = document.getElementById('stat-master-channels');
    const statTotalEvents = document.getElementById('stat-total-events');
    const botPing = document.getElementById('bot-ping');
    const botUptime = document.getElementById('bot-uptime');
    const botTag = document.getElementById('bot-tag');
    const brandTitleEl = document.getElementById('brand-title');
    const brandFooterEl = document.getElementById('brand-footer');

    // Containers & Tables
    const overviewRoomsList = document.getElementById('overview-rooms-list');
    const overviewRecentLogs = document.getElementById('overview-recent-logs');
    const roomsCardsGrid = document.getElementById('rooms-cards-grid');
    const masterChannelsTbody = document.getElementById('master-channels-tbody');
    const logsTbody = document.getElementById('logs-tbody');

    // Search Inputs
    const searchRoomsInput = document.getElementById('search-rooms-input');
    const searchLogsInput = document.getElementById('search-logs-input');

    // Modal Elements
    const actionModal = document.getElementById('action-modal');
    const modalTitle = document.getElementById('modal-title');
    const actionForm = document.getElementById('action-form');
    const modalChannelId = document.getElementById('modal-channel-id');
    const modalActionType = document.getElementById('modal-action-type');
    const modalInputLabel = document.getElementById('modal-input-label');
    const modalInputValue = document.getElementById('modal-input-value');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    let currentChannels = [];
    let currentLogs = [];

    const tabHeadings = {
        overview: { title: 'نظرة عامة وإحصائيات البوت', desc: 'متابعة وإدارة الرومات الصوتية المؤقتة في الوقت الفعلي' },
        'active-rooms': { title: 'الرومات الصوتية النشطة', desc: 'إدارة والتحكم المباشر في الرومات الصوتية المفتوحة حالياً' },
        'master-channels': { title: 'قنوات الإنشاء المعتمدة', desc: 'قنوات الماستر المسجلة التي تنبثق منها الرومات المؤقتة' },
        logs: { title: 'سجلات الصندوق الأسود', desc: 'سجل التغييرات وأنشطة الأعضاء والمحادثات النصية' }
    };

    navItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = item.dataset.tab;

            navItems.forEach((n) => n.classList.remove('active'));
            tabContents.forEach((t) => t.classList.remove('active'));

            item.classList.add('active');
            document.getElementById(`tab-${targetTab}`)?.classList.add('active');

            if (tabHeadings[targetTab]) {
                pageTitle.textContent = tabHeadings[targetTab].title;
                pageDesc.textContent = tabHeadings[targetTab].desc;
            }
        });
    });

    /**
     * Displays a temporary toast notification in the bottom-left corner.
     * @param {string} message Notification message
     */
    function showToast(message) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3500);
    }

    /**
     * Formats uptime milliseconds into a compact Arabic duration string.
     * @param {number} ms Uptime in milliseconds
     * @returns {string} Formatted duration
     */
    function formatUptime(ms) {
        if (!ms) return '0د';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}ي ${hours % 24}س`;
        if (hours > 0) return `${hours}س ${minutes % 60}د`;
        return `${minutes}د`;
    }

    /**
     * Escapes unsafe HTML characters to prevent XSS.
     * @param {string} str Raw input string
     * @returns {string} Escaped HTML string
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m]));
    }

    /**
     * Fetches general bot statistics from `/api/stats`.
     * @returns {Promise<void>}
     */
    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            if (data.success) {
                const s = data.stats;
                statActiveChannels.textContent = s.activeChannelsCount;
                statActiveUsers.textContent = s.activeUsersCount;
                statMasterChannels.textContent = s.masterChannelsCount;
                statTotalEvents.textContent = s.totalEventsLogged;
                activeRoomsCountBadge.textContent = s.activeChannelsCount;
                botPing.textContent = `${s.ping}ms`;
                botUptime.textContent = formatUptime(s.uptime);
                if (botTag && s.botTag) {
                    botTag.textContent = s.botTag;
                }
                if (brandTitleEl && s.brandTitle) {
                    brandTitleEl.textContent = s.brandTitle;
                    document.title = `${s.brandTitle} | لوحة التحكم`;
                }
                if (brandFooterEl) {
                    const footerText = typeof s.brandFooter === 'string' ? s.brandFooter.trim() : '';
                    if (footerText) {
                        brandFooterEl.textContent = footerText;
                        brandFooterEl.style.display = 'block';
                    } else {
                        brandFooterEl.textContent = '';
                        brandFooterEl.style.display = 'none';
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }

    /**
     * Fetches currently active temporary voice channels from `/api/active-channels`.
     * @returns {Promise<void>}
     */
    async function fetchActiveChannels() {
        try {
            const res = await fetch('/api/active-channels');
            const data = await res.json();
            if (data.success) {
                currentChannels = data.channels;
                renderActiveChannels(currentChannels);
                renderOverviewRooms(currentChannels);
            }
        } catch (err) {
            console.error('Error fetching active channels:', err);
        }
    }

    /**
     * Renders active room cards inside the Active Rooms tab.
     * @param {Array<object>} channels Active channel objects
     */
    function renderActiveChannels(channels) {
        const query = (searchRoomsInput.value || '').toLowerCase().trim();
        const filtered = channels.filter(
            (c) =>
                c.name.toLowerCase().includes(query) ||
                (c.owner && c.owner.username.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
            roomsCardsGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 40px;">
                    <i class="fa-solid fa-headset" style="font-size: 32px; margin-bottom: 12px;"></i>
                    <p>لا توجد رومات صوتية نشطة حالياً</p>
                </div>
            `;
            return;
        }

        roomsCardsGrid.innerHTML = filtered.map((c) => `
            <div class="room-card">
                <div class="room-card-header">
                    <div class="room-title-box">
                        <div class="room-icon"><i class="fa-solid fa-volume-high"></i></div>
                        <div>
                            <div class="room-name">${escapeHtml(c.name)}</div>
                            <span class="room-type-tag ${c.type === 'owned' ? 'tag-owned' : 'tag-public'}">
                                ${c.type === 'owned' ? 'روم مالك خاص' : 'روم عام'}
                            </span>
                        </div>
                    </div>
                    <div>
                        ${c.isLocked
                            ? '<i class="fa-solid fa-lock" style="color: var(--accent-orange);" title="مغلق"></i>'
                            : '<i class="fa-solid fa-lock-open" style="color: var(--accent-green);" title="مفتوح"></i>'}
                    </div>
                </div>

                <div class="room-owner">
                    <i class="fa-solid fa-crown" style="color: #FEE75C;"></i>
                    <span>المالك: ${c.owner ? escapeHtml(c.owner.username) : 'عام تلقائي'}</span>
                </div>

                <div class="room-members-section">
                    <div class="members-title">
                        <span>الأعضاء المتواجدون:</span>
                        <span>${c.currentUsersCount} / ${c.memberLimit === 0 ? '∞' : c.memberLimit}</span>
                    </div>
                    <div class="members-list">
                        ${c.members.length > 0
                            ? c.members.map((m) => `
                                <div class="member-chip" title="${escapeHtml(m.username)}">
                                    <img src="${m.avatar}" alt="avatar">
                                    <span>${escapeHtml(m.displayName)}</span>
                                </div>
                            `).join('')
                            : '<span style="font-size: 12px; color: var(--text-muted);">لا يوجد أعضاء في الصوت الآن</span>'}
                    </div>
                </div>

                <div class="room-controls">
                    <button class="btn btn-secondary" onclick="openActionModal('${escapeHtml(c.channelId)}', 'rename')">
                        <i class="fa-solid fa-pen"></i> تسمية
                    </button>
                    <button class="btn ${c.isLocked ? 'btn-primary' : 'btn-secondary'}" onclick="toggleLockRoom('${escapeHtml(c.channelId)}', ${!c.isLocked})">
                        <i class="fa-solid ${c.isLocked ? 'fa-lock-open' : 'fa-lock'}"></i> ${c.isLocked ? 'فتح' : 'قفل'}
                    </button>
                    <button class="btn btn-secondary" onclick="openActionModal('${escapeHtml(c.channelId)}', 'limit')">
                        <i class="fa-solid fa-users-gear"></i> الحد
                    </button>
                    <button class="btn btn-danger" onclick="deleteRoom('${escapeHtml(c.channelId)}')">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Renders the top active rooms widget on the Overview tab.
     * @param {Array<object>} channels Active channel objects
     */
    function renderOverviewRooms(channels) {
        const topChannels = channels.slice(0, 4);
        if (topChannels.length === 0) {
            overviewRoomsList.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">لا توجد رومات مؤقتة نشطة.</p>';
            return;
        }

        overviewRoomsList.innerHTML = topChannels.map((c) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-microphone" style="color: var(--accent-purple);"></i>
                    <div>
                        <strong style="font-size: 14px;">${escapeHtml(c.name)}</strong>
                        <div style="font-size: 12px; color: var(--text-secondary);">${c.owner ? 'مالك: ' + escapeHtml(c.owner.username) : 'عام تلقائي'}</div>
                    </div>
                </div>
                <span class="badge" style="background: rgba(255,255,255,0.08); font-size: 12px; padding: 2px 8px; border-radius: 10px;">
                    <i class="fa-solid fa-user"></i> ${c.currentUsersCount}
                </span>
            </div>
        `).join('');
    }

    /**
     * Populates the guild voice channel dropdown selector if the user has not selected a value yet.
     * @returns {Promise<void>}
     */
    async function fetchGuildVoiceChannels() {
        try {
            const selectEl = document.getElementById('master-channel-select');
            if (!selectEl || selectEl.value) return;

            const res = await fetch('/api/guild-voice-channels');
            const data = await res.json();
            if (data.success) {
                if (data.voiceChannels.length === 0) {
                    selectEl.innerHTML = '<option value="">لا توجد قنوات صوتية متاحة</option>';
                    return;
                }
                selectEl.innerHTML =
                    '<option value="">-- اختر القناة الصوتية الماستر --</option>' +
                    data.voiceChannels
                        .map((vc) => `<option value="${vc.channelId}">${escapeHtml(vc.guildName)} ➔ ${escapeHtml(vc.channelName)} (${vc.channelId})</option>`)
                        .join('');
            }
        } catch (err) {
            console.error('Error fetching voice channels:', err);
        }
    }

    /**
     * Fetches registered master creator channels from `/api/master-channels`.
     * @returns {Promise<void>}
     */
    async function fetchMasterChannels() {
        try {
            const res = await fetch('/api/master-channels');
            const data = await res.json();
            if (data.success) {
                renderMasterChannels(data.masterChannels);
            }
        } catch (err) {
            console.error('Error fetching master channels:', err);
        }
    }

    /**
     * Renders the table of registered master channels.
     * @param {Array<object>} masters Master channel rows
     */
    function renderMasterChannels(masters) {
        if (masters.length === 0) {
            masterChannelsTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">لا توجد قنوات إنشاء مسجلة بعد. قم بإضافتها أعلاه أو باستخدام الأمر.</td></tr>';
            return;
        }

        masterChannelsTbody.innerHTML = masters.map((m) => `
            <tr>
                <td><strong>${escapeHtml(m.channelName)}</strong></td>
                <td>${escapeHtml(m.guildName)}</td>
                <td><span class="room-type-tag ${m.type === 'owned' ? 'tag-owned' : 'tag-public'}">${m.type === 'owned' ? 'تحكم مالك خاص' : 'عام متسلسل'}</span></td>
                <td><code>${escapeHtml(m.nameTemplate || 'افتراضي')}</code></td>
                <td><code style="font-size: 12px; color: var(--text-muted);">${m.channelId}</code></td>
                <td>
                    <button class="btn btn-danger" onclick="deleteMasterChannel('${m.channelId}')" style="padding: 4px 10px; font-size: 12px;">
                        <i class="fa-solid fa-trash"></i> حذف
                    </button>
                </td>
            </tr>
        `).join('');
    }

    const addMasterForm = document.getElementById('add-master-form');
    if (addMasterForm) {
        addMasterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const selectVal = document.getElementById('master-channel-select').value;
            const inputVal = document.getElementById('master-channel-id-input').value.trim();
            const channelId = inputVal || selectVal;
            const type = document.getElementById('master-type-select').value;
            const nameTemplate = document.getElementById('master-template-input').value.trim();

            if (!channelId) {
                showToast('يرجى اختيار القناة أو إدخال معرف القناة (ID)');
                return;
            }

            try {
                const res = await fetch('/api/master-channel/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channelId, type, nameTemplate })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'تم تسجيل قناة الإنشاء بنجاح!');
                    addMasterForm.reset();
                    fetchMasterChannels();
                } else {
                    showToast(`خطأ: ${data.error}`);
                }
            } catch (err) {
                console.error('Error adding master channel:', err);
                showToast('حدث خطأ أثناء إضافة قناة الإنشاء');
            }
        });
    }

    window.deleteMasterChannel = async function (channelId) {
        if (!confirm('هل أنت متأكد من رغبتك في إزالة قناة الإنشاء هذه؟')) return;

        try {
            const res = await fetch('/api/master-channel/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId })
            });
            const data = await res.json();
            if (data.success) {
                showToast('تم إزالة قناة الإنشاء بنجاح');
                fetchMasterChannels();
            } else {
                showToast(`خطأ: ${data.error}`);
            }
        } catch (err) {
            console.error('Error deleting master channel:', err);
        }
    };

    /**
     * Fetches the 50 most recent blackbox events from `/api/events`.
     * @returns {Promise<void>}
     */
    async function fetchEvents() {
        try {
            const res = await fetch('/api/events?limit=50');
            const data = await res.json();
            if (data.success) {
                currentLogs = data.events;
                renderLogs(currentLogs);
                renderOverviewLogs(currentLogs);
            }
        } catch (err) {
            console.error('Error fetching events:', err);
        }
    }

    /**
     * Renders the blackbox events table on the Logs tab.
     * @param {Array<object>} logs Event rows
     */
    function renderLogs(logs) {
        const query = (searchLogsInput.value || '').toLowerCase().trim();
        const filtered = logs.filter(
            (l) =>
                l.eventType.toLowerCase().includes(query) ||
                JSON.stringify(l.data).toLowerCase().includes(query)
        );

        if (filtered.length === 0) {
            logsTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد سجلات مطابقة.</td></tr>';
            return;
        }

        logsTbody.innerHTML = filtered.map((l) => {
            const dateStr = new Date(l.timestamp).toLocaleTimeString('ar-EG');
            let details = '';
            if (l.eventType === 'join') details = `انضم العضو <strong>${escapeHtml(l.data.user?.username || '')}</strong> للروم`;
            else if (l.eventType === 'leave') details = `غادر العضو <strong>${escapeHtml(l.data.user?.username || '')}</strong> الروم`;
            else if (l.eventType === 'control') details = `<strong>${escapeHtml(l.data.action || '')}</strong>: ${escapeHtml(l.data.details || '')}`;
            else details = escapeHtml(JSON.stringify(l.data));

            return `
                <tr>
                    <td style="font-size: 12px; color: var(--text-muted);">${dateStr}</td>
                    <td><span class="badge" style="background: rgba(255,255,255,0.08); font-size: 12px;">${escapeHtml(l.eventType)}</span></td>
                    <td><code>${escapeHtml(l.channelId)}</code></td>
                    <td>${details}</td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Renders the recent activity widget on the Overview tab.
     * @param {Array<object>} logs Event rows
     */
    function renderOverviewLogs(logs) {
        const recent = logs.slice(0, 5);
        if (recent.length === 0) {
            overviewRecentLogs.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">لا توجد أنشطة مسجلة حديثاً.</p>';
            return;
        }

        overviewRecentLogs.innerHTML = recent.map((l) => {
            const timeAgo = `${Math.max(0, Math.floor((Date.now() - l.timestamp) / 1000 / 60))}د`;
            let icon = '<i class="fa-solid fa-circle-info" style="color: var(--accent-blue);"></i>';
            if (l.eventType === 'join') icon = '<i class="fa-solid fa-right-to-bracket" style="color: var(--accent-green);"></i>';
            if (l.eventType === 'leave') icon = '<i class="fa-solid fa-right-from-bracket" style="color: var(--accent-red);"></i>';
            if (l.eventType === 'control') icon = '<i class="fa-solid fa-sliders" style="color: var(--accent-orange);"></i>';

            let label = l.data.user?.username ? l.data.user.username : 'نظام';
            if (l.eventType === 'control') label = l.data.action || 'تحكم';

            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                        ${icon}
                        <span>${escapeHtml(label)}</span>
                    </div>
                    <span style="font-size: 11px; color: var(--text-muted);">${timeAgo}</span>
                </div>
            `;
        }).join('');
    }

    window.openActionModal = function (channelId, action, currentValue = null) {
        const channelObj = currentChannels.find((ch) => ch.channelId === channelId);
        modalChannelId.value = channelId;
        modalActionType.value = action;

        if (action === 'rename') {
            modalTitle.textContent = '📝 تغيير اسم الروم الصوتي';
            modalInputLabel.textContent = 'اسم الروم الجديد:';
            modalInputValue.value = currentValue !== null ? currentValue : (channelObj?.name || '');
        } else if (action === 'limit') {
            modalTitle.textContent = '👥 تحديد الحد الأقصى للأعضاء';
            modalInputLabel.textContent = 'الحد الأقصى (0 لإلغاء الحد):';
            modalInputValue.value = currentValue !== null ? currentValue : String(channelObj?.memberLimit ?? 0);
        }

        actionModal.classList.add('active');
    };

    function closeModal() {
        actionModal.classList.remove('active');
        actionForm.reset();
    }

    modalCloseBtn.addEventListener('click', closeModal);
    modalCancelBtn.addEventListener('click', closeModal);

    actionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelId = modalChannelId.value;
        const action = modalActionType.value;
        const value = modalInputValue.value;

        try {
            const res = await fetch('/api/channel/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId, action, value })
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message || 'تم تنفيذ الإجراء بنجاح!');
                closeModal();
                refreshAll();
            } else {
                showToast(`خطأ: ${data.error}`);
            }
        } catch (err) {
            console.error('Error executing action:', err);
            showToast('حدث خطأ أثناء التواصل مع السيرفر');
        }
    });

    window.toggleLockRoom = async function (channelId, lockState) {
        try {
            const res = await fetch('/api/channel/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId, action: 'lock', value: lockState })
            });
            const data = await res.json();
            if (data.success) {
                showToast(lockState ? '🔒 تم قفل الروم بنجاح' : '🔓 تم فتح الروم بنجاح');
                refreshAll();
            } else {
                showToast(`خطأ: ${data.error}`);
            }
        } catch (err) {
            console.error('Error locking/unlocking room:', err);
        }
    };

    window.deleteRoom = async function (channelId) {
        if (!confirm('هل أنت متأكد من رغبتك في حذف وحل هذا الروم الصوتي؟')) return;

        try {
            const res = await fetch('/api/channel/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channelId, action: 'delete' })
            });
            const data = await res.json();
            if (data.success) {
                showToast('🗑️ تم حذف الروم الصوتي بنجاح');
                refreshAll();
            } else {
                showToast(`خطأ: ${data.error}`);
            }
        } catch (err) {
            console.error('Error deleting room:', err);
        }
    };

    searchRoomsInput.addEventListener('input', () => renderActiveChannels(currentChannels));
    searchLogsInput.addEventListener('input', () => renderLogs(currentLogs));

    function refreshAll() {
        fetchStats();
        fetchActiveChannels();
        fetchMasterChannels();
        fetchGuildVoiceChannels();
        fetchEvents();
    }

    manualRefreshBtn.addEventListener('click', () => {
        refreshAll();
        showToast('تم تحديث البيانات');
    });

    refreshAll();
    setInterval(refreshAll, 5000);
});
