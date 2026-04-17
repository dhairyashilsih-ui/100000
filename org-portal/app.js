// ══════════════════════════════════════════════════════════════════════════════
// CrowdPulse Org Portal — Full App Logic
// ══════════════════════════════════════════════════════════════════════════════

// ── Config & Persistent State ─────────────────────────────────────────────────
const BACKEND_KEY   = 'crowdpulse_org_backend';
const POLL_INTERVAL = 10_000;   // 10 seconds for unread polling

let backendBase = '';           // e.g. "http://localhost:8000"
let pollTimer   = null;
let activeTab   = 'unread';

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const backendUrlInput     = document.getElementById('backendUrlInput');
const connDot             = document.getElementById('connDot');
const connLabel           = document.getElementById('connLabel');
const reportsContainer    = document.getElementById('reportsContainer');
const allReportsContainer = document.getElementById('allReportsContainer');
const markAllBtn          = document.getElementById('markAllBtn');
const unreadCountBadge    = document.getElementById('unreadCount');
const pollIndicator       = document.getElementById('pollIndicator');
const toast               = document.getElementById('toast');
const statUnread          = document.getElementById('statUnread');
const statToday           = document.getElementById('statToday');
const statHighest         = document.getElementById('statHighest');
const statAvg             = document.getElementById('statAvg');

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
    const saved = localStorage.getItem(BACKEND_KEY);
    if (saved) {
        backendUrlInput.value = saved;
        backendBase = normalizeUrl(saved);
        startPolling();
        loadAvailableSessions();
    }
})();

// ── URL helper ────────────────────────────────────────────────────────────────
function normalizeUrl(raw) {
    raw = raw.trim().replace(/\/+$/, '');
    if (!raw.startsWith('http')) {
        const isLocal = raw.startsWith('localhost') || raw.startsWith('127.') || raw.startsWith('10.0.');
        raw = (isLocal ? 'http://' : 'https://') + raw;
    }
    return raw;
}

function getWsBase() {
    return backendBase.replace(/^http/, 'ws');
}

// ── Connect ───────────────────────────────────────────────────────────────────
function saveAndConnect() {
    const raw = backendUrlInput.value.trim();
    if (!raw) { showToast('⚠️ Please enter a backend URL.', 'warn'); return; }
    localStorage.setItem(BACKEND_KEY, raw);
    backendBase = normalizeUrl(raw);
    setConnStatus('connecting');
    startPolling();
    loadAvailableSessions();
}

function setConnStatus(state) {
    connDot.className = `status-dot ${state}`;
    connLabel.textContent = { connected: 'Connected', connecting: 'Connecting...', error: 'Unreachable' }[state] || 'Not connected';
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    fetchUnread();
    if (activeTab === 'all') fetchAll();
    pollTimer = setInterval(() => {
        fetchUnread();
        if (activeTab === 'all') fetchAll();
    }, POLL_INTERVAL);
}

// ── Fetch: Unread Reports ─────────────────────────────────────────────────────
async function fetchUnread() {
    if (!backendBase) return;
    try {
        const resp = await fetch(`${backendBase}/org/reports/unread`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setConnStatus('connected');
        renderUnread(data);
        updateStats(data);
        flashPollIndicator();
    } catch (e) {
        console.error('[OrgPortal] fetchUnread failed:', e);
        setConnStatus('error');
    }
}

// ── Fetch: All Reports ────────────────────────────────────────────────────────
async function fetchAll() {
    if (!backendBase) return;
    allReportsContainer.innerHTML = spinnerHtml();
    try {
        const resp = await fetch(`${backendBase}/org/reports?limit=100`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        renderAll(data);
    } catch (e) {
        allReportsContainer.innerHTML = errorHtml('Could not load reports. Check your backend URL.');
    }
}

// ── Mark Read ─────────────────────────────────────────────────────────────────
async function markRead(id, btn) {
    if (!backendBase) return;
    btn.disabled = true; btn.textContent = '...';
    try {
        const resp = await fetch(`${backendBase}/org/reports/${id}/mark_read`, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showToast('✓ Alert marked as read.');
        await fetchUnread();
    } catch {
        showToast('❌ Failed to mark as read.', 'error');
        btn.disabled = false; btn.textContent = 'Mark Read';
    }
}

async function markAllRead() {
    if (!backendBase) return;
    markAllBtn.disabled = true; markAllBtn.textContent = 'Working...';
    try {
        const resp = await fetch(`${backendBase}/org/reports/mark_all_read`, { method: 'POST' });
        if (!resp.ok) throw new Error();
        const r = await resp.json();
        showToast(`✓ Marked ${r.updated} report(s) as read.`);
        await fetchUnread();
    } catch { showToast('❌ Failed to mark all read.', 'error'); }
    finally { markAllBtn.disabled = false; markAllBtn.textContent = '✓ Mark All Read'; }
}

// ── Render: Unread ────────────────────────────────────────────────────────────
function renderUnread(reports) {
    if (reports.length > 0) {
        unreadCountBadge.style.display = 'inline-flex';
        unreadCountBadge.textContent   = reports.length > 99 ? '99+' : reports.length;
        markAllBtn.style.display = 'inline-flex';
    } else {
        unreadCountBadge.style.display = 'none';
        markAllBtn.style.display = 'none';
    }

    const redReports = reports.filter(r => r.status === 'RED' && !r.read);
    const otherReports = reports.filter(r => r.status !== 'RED' || r.read);

    const highAlertsBanner = document.getElementById('highAlertsBanner');
    const highAlertsContent = document.getElementById('highAlertsContent');

    if (redReports.length > 0) {
        if (highAlertsBanner) highAlertsBanner.style.display = 'block';
        if (highAlertsContent) {
            highAlertsContent.innerHTML = redReports.map(r => `
                <div style="background: white; padding: 1rem; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #fca5a5; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div>
                        <div style="font-size: 0.8rem; color: #ef4444; font-weight: 600; margin-bottom: 4px;">Session: ${r.session_code || '—'} &nbsp;•&nbsp; ${timeAgo(r.timestamp)}</div>
                        <div style="color: #450a0a; font-size: 0.95rem; font-weight: 500;">${escapeHtml(r.report || '')}</div>
                    </div>
                    <button class="btn btn-primary" style="background: #ef4444; border-color: #ef4444; color: white; white-space: nowrap; font-weight: bold; align-self: center;" onclick="dismissHighAlert('${r.id}', this)">
                        OK - DISMISS
                    </button>
                </div>
            `).join('');
        }
    } else {
        if (highAlertsBanner) highAlertsBanner.style.display = 'none';
    }

    reportsContainer.innerHTML = otherReports.length === 0
        ? emptyStateHtml('🎉 All caught up!', 'No unread standard alerts. New AI reports will appear here automatically.')
        : otherReports.map(r => reportCardHtml(r, true)).join('');
}

async function dismissHighAlert(id, btn) {
    if (!backendBase) return;
    btn.disabled = true; btn.textContent = '...';
    try {
        const resp = await fetch(`${backendBase}/org/reports/${id}/mark_read`, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showToast('✓ Critical alert acknowledged.');
        await fetchUnread();
    } catch {
        showToast('❌ Failed to acknowledge alert.', 'error');
        btn.disabled = false; btn.textContent = 'OK - DISMISS';
    }
}

function renderAll(reports) {
    allReportsContainer.innerHTML = reports.length === 0
        ? emptyStateHtml('📭 No reports yet', 'AI status reports will appear here once the system starts monitoring.')
        : reports.map(r => reportCardHtml(r, false)).join('');
}

// ── Report card template ──────────────────────────────────────────────────────
function reportCardHtml(r, showMarkRead) {
    const status   = r.status || 'GREEN';
    const isUnread = !r.read;
    const relTime  = r.timestamp ? timeAgo(r.timestamp) : '—';
    const fullTime = r.timestamp ? new Date(r.timestamp).toLocaleString() : '—';
    const emoji    = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' }[status] || '⚪';
    const markBtn  = (showMarkRead && isUnread)
        ? `<button class="btn btn-sm btn-mark-read" onclick="markRead('${r.id}', this)">Mark Read</button>` : '';

    return `
    <div class="report-card ${isUnread ? 'unread' : ''} status-${status}" id="card-${r.id}">
        <div class="report-card-header">
            <div class="report-meta">
                ${isUnread ? '<span class="unread-dot" title="Unread"></span>' : ''}
                <span class="status-chip ${status}">${emoji} ${status}</span>
                <span class="session-chip">${r.session_code || '—'}</span>
            </div>
            <span class="report-time" title="${fullTime}">${relTime}</span>
        </div>
        <p class="report-body">${escapeHtml(r.report || 'No report text.')}</p>
        <div class="report-footer">
            <span class="avg-count-label">Avg crowd: <span>${r.avg_count ?? '—'}</span> people</span>
            ${markBtn}
        </div>
    </div>`;
}

// ── Stats update ──────────────────────────────────────────────────────────────
function updateStats(reports) {
    statUnread.textContent = reports.length;
    if (!reports.length) return;
    const now = Date.now();
    statToday.textContent = reports.filter(r => (now - new Date(r.timestamp).getTime()) < 86_400_000).length;
    const order = ['GREEN', 'YELLOW', 'RED'];
    const highestIdx = reports.reduce((m, r) => { const i = order.indexOf(r.status); return i > m ? i : m; }, 0);
    const highest = order[highestIdx];
    statHighest.textContent = highest;
    statHighest.style.color = { GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444' }[highest];
    statAvg.textContent = (reports.reduce((s, r) => s + (r.avg_count || 0), 0) / reports.length).toFixed(1);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function showTab(tab) {
    activeTab = tab;
    ['unread', 'all', 'recording', 'live'].forEach(t => {
        document.getElementById(`tab${t.charAt(0).toUpperCase()+t.slice(1)}`).classList.toggle('active', t === tab);
        document.getElementById(`panel${t.charAt(0).toUpperCase()+t.slice(1)}`).style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'all' && backendBase) fetchAll();
    if (tab === 'recording' && backendBase) loadAvailableSessions();
}

// ── Poll flash ────────────────────────────────────────────────────────────────
function flashPollIndicator() {
    pollIndicator.textContent = `last polled ${new Date().toLocaleTimeString()}`;
    pollIndicator.style.color = '#7c3aed';
    setTimeout(() => { pollIndicator.style.color = 'var(--text-muted)'; }, 800);
}


// ══════════════════════════════════════════════════════════════════════════════
// RECORDING PLAYBACK
// ══════════════════════════════════════════════════════════════════════════════

let recordingFrames  = [];      // [{id, timestamp, count, status}]
let currentFrameIdx  = 0;
let isPlaying        = false;
let playbackTimer    = null;
let playbackSpeed    = 1;       // multiplier
const frameCache     = {};      // {frameId: blobUrl}
const BASE_INTERVAL  = 800;     // ms at 1× speed

// ── Load session list into dropdown ──────────────────────────────────────────
async function loadAvailableSessions() {
    if (!backendBase) return;
    try {
        const resp = await fetch(`${backendBase}/org/sessions`);
        if (!resp.ok) throw new Error();
        const sessions = await resp.json();
        const sel = document.getElementById('recordingSession');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Select Session —</option>';
        if (sessions.length === 0) {
            sel.innerHTML += '<option disabled>No recordings found yet</option>';
            return;
        }
        sessions.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.session_code;
            const start = s.first_frame_ts ? new Date(s.first_frame_ts * 1000).toLocaleDateString() : '?';
            const end   = s.last_frame_ts  ? new Date(s.last_frame_ts  * 1000).toLocaleDateString() : '?';
            opt.textContent = `${s.session_code} — ${s.frame_count} frames (${start} → ${end})`;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.warn('[Recording] Could not load sessions:', e);
    }
}

// Called when session dropdown changes — pre-fill date range
function onSessionChange() {
    // The backend returns sessions with time ranges but we don't prefill
    // to give users flexibility in filtering. Just keep fields empty.
}

// ── Load frame list for selected session + time range ─────────────────────────
async function loadRecording() {
    const sessionCode = document.getElementById('recordingSession').value;
    if (!sessionCode) { showToast('⚠️ Please select a session first.', 'warn'); return; }
    if (!backendBase) { showToast('⚠️ Set backend URL first.', 'warn'); return; }

    pausePlayback();

    // Clear old blob URLs from cache
    Object.values(frameCache).forEach(u => URL.revokeObjectURL(u));
    Object.keys(frameCache).forEach(k => delete frameCache[k]);

    document.getElementById('recFrameCount').textContent = 'Loading...';

    let url = `${backendBase}/org/playback/frames?session_code=${sessionCode}`;
    const startVal = document.getElementById('recordingStart').value;
    const endVal   = document.getElementById('recordingEnd').value;
    if (startVal) url += `&start_ts=${new Date(startVal).getTime() / 1000}`;
    if (endVal)   url += `&end_ts=${new Date(endVal).getTime() / 1000}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        recordingFrames = await resp.json();

        if (recordingFrames.length === 0) {
            showToast('⚠️ No frames found for that time range.', 'warn');
            document.getElementById('recFrameCount').textContent = '0 frames found';
            document.getElementById('playerArea').style.display = 'none';
            return;
        }

        document.getElementById('recFrameCount').textContent = `${recordingFrames.length} frames loaded`;
        document.getElementById('playerArea').style.display = 'block';
        document.getElementById('pbTotalFrames').textContent = recordingFrames.length;

        currentFrameIdx = 0;
        renderTimeline();
        displayFrame(0);
        preloadFrames(0, 5);

        // Populate timeline time labels
        const first = new Date(recordingFrames[0].timestamp * 1000);
        const last  = new Date(recordingFrames[recordingFrames.length - 1].timestamp * 1000);
        document.getElementById('tlStartLabel').textContent = first.toLocaleTimeString();
        document.getElementById('tlEndLabel').textContent   = last.toLocaleTimeString();

    } catch (e) {
        showToast('❌ Failed to load frames. Check backend connection.', 'error');
        document.getElementById('recFrameCount').textContent = 'Error loading frames';
        console.error('[Recording] loadRecording failed:', e);
    }
}

// ── Fetch a single frame JPEG (with cache) ────────────────────────────────────
async function fetchAndCacheFrame(frameId) {
    if (frameCache[frameId]) return frameCache[frameId];
    const resp = await fetch(`${backendBase}/org/playback/frame/${frameId}`);
    if (!resp.ok) throw new Error(`Frame fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    frameCache[frameId] = url;
    return url;
}

// ── Display a single frame by index ──────────────────────────────────────────
async function displayFrame(idx) {
    if (idx < 0 || idx >= recordingFrames.length) return;
    const frame = recordingFrames[idx];

    const pbLoading = document.getElementById('pbLoading');
    if (pbLoading) pbLoading.classList.remove('hidden');

    try {
        const url = await fetchAndCacheFrame(frame.id);
        const img = document.getElementById('playbackImg');
        img.src = url;
        img.classList.remove('hidden');
        document.getElementById('pbNoSignal').classList.add('hidden');
    } catch (e) {
        console.warn('[Recording] Failed to load frame:', e);
    } finally {
        if (pbLoading) pbLoading.classList.add('hidden');
    }

    // Overlay
    const statusColors = { GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444' };
    const pbStatus = document.getElementById('pbStatus');
    pbStatus.textContent  = frame.status;
    pbStatus.style.color  = statusColors[frame.status] || '#fff';
    document.getElementById('pbCount').textContent     = `${frame.count} people`;
    document.getElementById('pbCountLarge').textContent = frame.count;
    document.getElementById('pbCountLarge').style.color = statusColors[frame.status] || 'var(--text-primary)';

    const frameDate = new Date(frame.timestamp * 1000);
    document.getElementById('pbTime').textContent    = frameDate.toLocaleTimeString();
    document.getElementById('pbFullTime').textContent = frameDate.toLocaleString();
    document.getElementById('pbFrameInfo').textContent = `${idx + 1} / ${recordingFrames.length}`;

    updateTimelineCursor(idx);
    preloadFrames(idx, 5);
}

// ── Preload next N frames in background ──────────────────────────────────────
function preloadFrames(startIdx, count) {
    for (let i = startIdx + 1; i <= startIdx + count && i < recordingFrames.length; i++) {
        fetchAndCacheFrame(recordingFrames[i].id).catch(() => {});
    }
}

// ── Playback controls ─────────────────────────────────────────────────────────
function togglePlay() {
    if (isPlaying) { pausePlayback(); } else { startPlayback(); }
}

function startPlayback() {
    if (currentFrameIdx >= recordingFrames.length - 1) currentFrameIdx = 0;
    isPlaying = true;
    document.getElementById('pbPlayBtn').textContent = '⏸ Pause';
    scheduleNextFrame();
}

function pausePlayback() {
    isPlaying = false;
    if (playbackTimer) { clearTimeout(playbackTimer); playbackTimer = null; }
    document.getElementById('pbPlayBtn').textContent = '▶ Play';
}

function restartPlayback() {
    pausePlayback();
    currentFrameIdx = 0;
    displayFrame(0);
}

function scheduleNextFrame() {
    if (!isPlaying || currentFrameIdx >= recordingFrames.length - 1) {
        pausePlayback();
        if (currentFrameIdx >= recordingFrames.length - 1) showToast('⏹ Playback complete.');
        return;
    }
    // Use real timestamp delta for authentic speed, clamped for usability
    const curr = recordingFrames[currentFrameIdx];
    const next  = recordingFrames[currentFrameIdx + 1];
    const realDelta = (next.timestamp - curr.timestamp) * 1000;
    const interval  = Math.max(100, Math.min(realDelta / playbackSpeed, 4000));

    displayFrame(currentFrameIdx++).then(() => {
        if (isPlaying) {
            playbackTimer = setTimeout(scheduleNextFrame, interval);
        }
    });
}

function stepFrame(delta) {
    pausePlayback();
    currentFrameIdx = Math.max(0, Math.min(recordingFrames.length - 1, currentFrameIdx + delta));
    displayFrame(currentFrameIdx);
}

function changeSpeed(val) {
    playbackSpeed = parseFloat(val);
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function renderTimeline() {
    const tl = document.getElementById('pbTimeline');
    tl.innerHTML = '';
    const colors = { GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444' };
    recordingFrames.forEach((frame, idx) => {
        const seg = document.createElement('div');
        seg.className = 'timeline-seg';
        seg.style.background = colors[frame.status] || '#6b7280';
        seg.style.flex = '1';
        seg.title = `Frame ${idx + 1} • ${frame.status} • ${frame.count} people • ${new Date(frame.timestamp * 1000).toLocaleTimeString()}`;
        seg.addEventListener('click', () => {
            pausePlayback();
            currentFrameIdx = idx;
            displayFrame(idx);
        });
        tl.appendChild(seg);
    });
}

function updateTimelineCursor(idx) {
    const segs = document.querySelectorAll('.timeline-seg');
    segs.forEach((s, i) => s.classList.toggle('current', i === idx));
}


// ══════════════════════════════════════════════════════════════════════════════
// LIVE VIEW (WebSocket)
// ══════════════════════════════════════════════════════════════════════════════

let liveWs        = null;
let liveFrameId   = 0;
let livePrevUrl   = null;
let liveLastTs    = 0;

const liveVideoContainer = document.getElementById('live-video-container') || document.querySelector('.live-video-container');

// ── Connect ───────────────────────────────────────────────────────────────────
function connectLive() {
    const code = (document.getElementById('liveSessionCode').value || '').trim().toUpperCase();
    if (code.length < 6) { showToast('⚠️ Enter a valid 6-character session code.', 'warn'); return; }
    if (!backendBase) { showToast('⚠️ Set backend URL at the top first.', 'warn'); return; }

    if (liveWs) { liveWs.close(); liveWs = null; }

    const wsUrl = `${getWsBase()}/ws/dashboard/${code}`;
    setLiveStatus('connecting');

    liveWs = new WebSocket(wsUrl);
    liveWs.binaryType = 'arraybuffer';

    liveWs.onopen  = () => { setLiveStatus('connected'); showToast('📡 Live connection established.'); };
    liveWs.onclose = () => { setLiveStatus('disconnected'); };
    liveWs.onerror = () => { setLiveStatus('error'); showToast('❌ WebSocket error.', 'error'); };

    liveWs.onmessage = (event) => {
        if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            if (data.type === 'tts_instruction') {
                // Show AI instruction in live sidebar (don't speak — org portal is silent)
                updateLiveLlmPanel(data);
                return;
            }
            updateLiveOverlay(data);
        } else if (event.data instanceof ArrayBuffer) {
            renderLiveFrame(event.data);
        }
    };
}

function disconnectLive() {
    if (liveWs) { liveWs.close(); liveWs = null; }
    setLiveStatus('disconnected');
    document.getElementById('liveBadge').classList.add('hidden');
    document.getElementById('liveStatusChip').classList.add('hidden');
}

// ── Live status indicator ─────────────────────────────────────────────────────
function setLiveStatus(state) {
    const dot   = document.getElementById('liveDot');
    const label = document.getElementById('liveConnLabel');
    dot.className = `status-dot ${state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : 'error'}`;
    label.textContent = { connected: 'Live', connecting: 'Connecting...', disconnected: 'Disconnected', error: 'Error' }[state] || state;
}

// ── Render live frame ─────────────────────────────────────────────────────────
function renderLiveFrame(arrayBuffer) {
    const blob   = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const newUrl = URL.createObjectURL(blob);
    liveFrameId++;
    const thisId = liveFrameId;

    const img = new Image();
    img.onload = () => {
        if (thisId !== liveFrameId) { URL.revokeObjectURL(newUrl); return; }
        if (livePrevUrl) URL.revokeObjectURL(livePrevUrl);
        const liveImg = document.getElementById('liveImg');
        liveImg.src = newUrl;
        liveImg.classList.remove('hidden');
        document.getElementById('liveNoSignal').classList.add('hidden');
        livePrevUrl = newUrl;
        liveLastTs  = Date.now();
        document.getElementById('liveLastFrame').textContent = new Date().toLocaleTimeString();

        // Show LIVE badge
        document.getElementById('liveBadge').classList.remove('hidden');
        document.getElementById('liveReconnecting').classList.add('hidden');
    };
    img.onerror = () => URL.revokeObjectURL(newUrl);
    img.src     = newUrl;
}

// ── Update live overlay stats ─────────────────────────────────────────────────
function updateLiveOverlay(data) {
    const statusColors  = { GREEN: '#10b981', YELLOW: '#f59e0b', RED: '#ef4444' };
    const statusLabels  = { GREEN: '🟢 GREEN — Safe', YELLOW: '🟡 YELLOW — Monitor', RED: '🔴 RED — Alert' };

    document.getElementById('liveCount').textContent      = data.count ?? '—';
    document.getElementById('liveCount').style.color      = statusColors[data.status] || 'var(--text-primary)';
    document.getElementById('liveStatusLarge').textContent = data.status || 'IDLE';
    document.getElementById('liveStatusLarge').style.color = statusColors[data.status] || 'var(--text-secondary)';

    // Status chip overlay on video
    const chip = document.getElementById('liveStatusChip');
    chip.textContent = statusLabels[data.status] || data.status;
    chip.classList.remove('hidden');

    // Colored border on video container
    const vc = document.querySelector('.live-video-container');
    if (vc) {
        vc.className = `live-video-container status-${data.status || 'GREEN'}`;
    }
}

// ── AI instruction in live sidebar ───────────────────────────────────────────
function updateLiveLlmPanel(data) {
    const panel = document.getElementById('liveLlmPanel');
    const text  = document.getElementById('liveLlmText');
    if (!panel || !text) return;
    panel.classList.remove('hidden');
    text.textContent = data.text || '—';
}


// ══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'ok') {
    const colors = { ok: '#10b981', warn: '#f59e0b', error: '#ef4444' };
    toast.style.borderLeft = `3px solid ${colors[type] || colors.ok}`;
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function spinnerHtml() {
    return `<div class="spinner-wrap"><div class="spinner"></div></div>`;
}
function emptyStateHtml(title, subtitle) {
    return `<div class="empty-state">
        <svg width="52" height="52" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <strong style="color:var(--text-secondary); font-size:1rem;">${title}</strong>
        <p>${subtitle}</p>
    </div>`;
}
function errorHtml(msg) {
    return `<div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#ef4444"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <p style="color:#ef4444;">${msg}</p>
    </div>`;
}
function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(isoStr) {
    const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
    if (diff < 60)    return `${Math.floor(diff)}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(isoStr).toLocaleDateString();
}
