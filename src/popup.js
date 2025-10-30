
document.addEventListener('DOMContentLoaded', () => {
  const DEBUG = true; // set true for development, false for production
  const $ = id => document.getElementById(id) || null;
  const safeLog = (...a) => { try { if (DEBUG) console.log('[ClarityRead popup]', ...a); } catch (e) {} };
  const safeWarn = (...a) => { try { if (DEBUG) console.warn('[ClarityRead popup]', ...a); } catch (e) {} };
  const safeInfo = (...a) => { try { if (DEBUG) console.info('[ClarityRead popup]', ...a); } catch (e) {} };

  let opLock = false;

function wireSummaryDetailSelect() {
  const sel = document.getElementById('summaryDetailSelect');
  if (!sel) return;
  const allowed = new Set(['concise', 'normal', 'detailed']);
  // load pref
  chrome.storage.local.get(['summaryDetail'], (res) => {
    try {
      const v = (res && res.summaryDetail) || 'normal';
      sel.value = allowed.has(v) ? v : 'normal';
    } catch(e) { safeLog('loading summaryDetail failed', e); sel.value = 'normal'; }
  });
  sel.addEventListener('change', () => {
    try {
      const v = (sel.value || 'normal').toLowerCase();
      const final = allowed.has(v) ? v : 'normal';
      chrome.storage.local.set({ summaryDetail: final }, () => { toast(`Summary detail: ${final}`, 'info', 1200); });
    } catch (e) { safeLog('saving summaryDetail failed', e); }
  });
}


async function queryOverlayStateOnActiveTab() {
  try {
    const res = await sendMessageToActiveTabWithInject({ action: 'clarity_query_overlay' });
    const r = normalizeBgResponse(res);
    const btn = document.getElementById('focusModeBtn');
    const textEl = btn ? btn.querySelector('.action-text') : null;
    if (btn && textEl && r && typeof r.overlayActive !== 'undefined') {
      if (r.overlayActive) { btn.classList.add('active'); textEl.textContent = `Close ${_focusModeOriginalText}`; }
      else { btn.classList.remove('active'); textEl.textContent = _focusModeOriginalText; }
    }
  } catch (e) { safeLog('queryOverlayStateOnActiveTab failed', e); }
}

try { queryOverlayStateOnActiveTab(); } catch(e) {}


  try {
    const body = document.querySelector('body');
    if (body && typeof body.focus === 'function') {
      body.setAttribute('tabindex','0');
      body.focus({ preventScroll: true });
    }
  } catch (e) { /* noop */ }

  safeLog('DOMContentLoaded');
const CHUNK_SIZE_CHARS = 4000;
const MAX_INPUT_CHARS = 120000;

 const IDF_FILENAME = 'idf.json';

 let chart = null;

  let chartResizeObserver = null;


  function createToastContainer() {
    if (document.getElementById('clarityread-toast-container')) return;
    const c = document.createElement('div');
    c.id = 'clarityread-toast-container';
    c.style.position = 'fixed';
    c.style.right = '12px';
    c.style.bottom = '12px';
    c.style.zIndex = 2147483647;
    c.style.display = 'flex';
    c.style.flexDirection = 'column';
    c.style.gap = '8px';
    document.body.appendChild(c);
  }


const Toasts = (function() {
  const containerId = 'clarityread-toast-container';
  const recent = new Map();
  const instances = new Map();
  let nextId = 1;

  function ensureContainer() {
    let c = document.getElementById(containerId);
    if (!c) {
      c = document.createElement('div');
      c.id = containerId;
      c.style.position = 'fixed';
      c.style.right = '12px';
      c.style.bottom = '12px';
      c.style.zIndex = 2147483647;
      c.style.display = 'flex';
      c.style.flexDirection = 'column';
      c.style.gap = '8px';
      document.body.appendChild(c);
    }
    return c;
  }

  function makeEl(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'clarityread-toast';
    el.textContent = msg;
    el.style.padding = '8px 12px';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    el.style.background = (type === 'error' ? '#ffeced' : (type === 'success' ? '#e8f5e9' : '#fff7e6'));
    el.style.color = '#111';
    el.style.fontSize = '13px';
    el.style.maxWidth = '360px';
    el.style.wordBreak = 'break-word';
    el.style.transition = 'opacity 260ms ease, transform 260ms ease';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    return el;
  }

  function show(msg, type = 'info', ttl = 3500) {
    try {
      const now = Date.now();
      const last = recent.get(msg) || 0;
      if (now - last < 1500) return null;
      recent.set(msg, now);
      for (const [k, ts] of recent) if (now - ts > 10000) recent.delete(k);

      const c = ensureContainer();
      const el = makeEl(msg, type);
      const id = `toast-${nextId++}`;
      el.setAttribute('data-clarity-id', id);
      c.appendChild(el);
      instances.set(id, el);

      if (ttl > 0) {
        setTimeout(() => {
          try { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; } catch(e){}
        }, Math.max(200, ttl - 500));
        setTimeout(() => { try { el.remove(); instances.delete(id); } catch(e){} }, ttl);
      }
      return id;
    } catch (e) {
      if (DEBUG) console.warn('Toasts.show error', e);
      return null;
    }
  }

  function clear(id) {
    try {
      if (!id) return;
      const el = instances.get(id) || document.querySelector(`[data-clarity-id="${id}"]`);
      if (el) {
        try { el.remove(); } catch(e) {}
        instances.delete(id);
      }
    } catch (e) { if (DEBUG) console.warn('Toasts.clear error', e); }
  }

  function clearAll() {
    try {
      for (const [id, el] of Array.from(instances)) {
        try { el.remove(); } catch(e) {}
        instances.delete(id);
      }
      const c = document.getElementById(containerId);
      if (c) c.remove();
    } catch (e) { if (DEBUG) console.warn('Toasts.clearAll error', e); }
  }

  function showProgress(msg = 'Working...', timeoutMs = 60000) {
    return show(msg, 'info', timeoutMs);
  }

  return { show, clear, clearAll, showProgress };
})();

function toast(msg, type = 'info', ttl = 3500) {
  if (ttl === 0) return Toasts.show(msg, type, ttl);
  else Toasts.show(msg, type, ttl);
}
function clearToastsLocal() { Toasts.clearAll(); }

  function ensureChartReady(callback) {
    safeLog('ensureChartReady check Chart global', typeof Chart !== 'undefined');
    if (typeof Chart !== 'undefined') {
      if (typeof callback === 'function') callback();
      return;
    }
    const src = chrome.runtime.getURL('src/lib/chart.umd.min.js');
    if (document.querySelector('script[data-clarity-chart]')) {
      safeLog('chart script already injected, waiting briefly for global');
      setTimeout(() => { if (typeof callback === 'function') callback(); }, 200);
      return;
    }
    const s = document.createElement('script');
    s.setAttribute('data-clarity-chart', '1');
    s.src = src;
    s.onload = () => { safeLog('Chart.js injected and loaded'); if (typeof callback === 'function') callback(); };
    s.onerror = (e) => { console.warn('Failed to load Chart.js from', src, e); if (typeof callback === 'function') callback(); };
    document.head.appendChild(s);
    safeLog('ensureChartReady injected script', src);
  }

  const requiredIds = ['dyslexicToggle','reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];
  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
  safeLog('Popup element presence:', elPresence);

  ensureChartReady(() => { try { if (typeof loadStats === 'function') loadStats(); } catch (e) { safeLog('ensureChartReady callback loadStats threw', e); } });

  const dysToggle = $('dyslexicToggle');
  const reflowToggle = $('reflowToggle');
  const contrastToggle = $('contrastToggle');
  const invertToggle = $('invertToggle');
  const readBtn = $('readBtn');
  const pauseBtn = $('pauseBtn');
  const stopBtn = $('stopBtn');
  const pagesReadEl = $('pagesRead');
  const timeReadEl = $('timeRead');
  const avgSessionEl = $('avgSession');
  const readingStatusEl = $('readingStatus');
  const resetStatsBtn = $('resetStatsBtn');
  const sizeOptions = $('sizeOptions') || $('fontSizeControls');
  const fontSizeSlider = $('fontSizeSlider');
  const fontSizeValue = $('fontSizeValue') || $('fontSizeValue') || (document.querySelector('.size-value') ? document.querySelector('.size-value') : null);
  const profileSelect = $('profileSelect');
  const saveProfileBtn = $('saveProfileBtn');
  const voiceSelect = $('voiceSelect');
  const rateInput = $('rateInput');
  const pitchInput = $('pitchInput');
  const highlightCheckbox = $('highlightReading');
  const exportProfilesBtn = $('exportProfilesBtn');
  const importProfilesBtn = $('importProfilesBtn');
  const importProfilesInput = $('importProfilesInput');
  const statsChartEl = $('statsChart');
  const badgesContainer = $('badgesContainer');
  const themeToggleBtn = $('themeToggleBtn');
  const chartWrapper = document.querySelector('.chartWrapper') || document.querySelector('.chart-container');

  const speedToggle = $('speedToggle');
  const chunkSizeInput = $('chunkSize');
  const speedRateInput = $('speedRate');

  const saveSelectionBtn = $('saveSelectionBtn');
  const openSavedManagerBtn = $('openSavedManagerBtn');
  const savedListEl = $('savedList');
  const shareStatsBtn = $('shareStatsBtn');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    const btn = document.getElementById('focusModeBtn');
    const textEl = btn ? btn.querySelector('.action-text') : null;

    if (msg && msg.action === 'clarity_overlay_state') {
      if (!btn) return;
      if (msg.overlayActive) {
        btn.classList.add('active');
        if (textEl) textEl.textContent = `Close ${_focusModeOriginalText}`;
      } else {
        btn.classList.remove('active');
        if (textEl) textEl.textContent = _focusModeOriginalText;
      }
      return;
    }

    if (msg && (msg.action === 'readingStopped' || msg.action === 'readingPaused')) {
      if (btn && textEl) {
        btn.classList.remove('active');
        textEl.textContent = _focusModeOriginalText;
      }
      return;
    }

    if (msg && msg.action === 'readingResumed') {
      if (btn && textEl) {
        btn.classList.add('active');
        textEl.textContent = `Close ${_focusModeOriginalText}`;
      }
      return;
    }

  } catch (e) {
    safeLog('runtime.onMessage popup handler error', e);
  }
});

async function applyFontSizeToActiveTab(sizePx) {
  try {
    const sizeNum = Number(sizePx) || DEFAULTS.fontSize || 16;

    if (fontSizeSlider) { fontSizeSlider.disabled = true; }
    if (fontSizeValue) {
      try { fontSizeValue.textContent = `${sizeNum}px`; } catch(e){}
    }

    const MAX_RETRIES = 2;
    let attempt = 0;
    let lastNormalized = null;

    while (attempt <= MAX_RETRIES) {
      attempt++;
      const firstTry = await sendMessageToActiveTabWithInject({ action: 'clarity_apply_font_size', size: sizeNum });
      const normalized = normalizeBgResponse(firstTry);
      lastNormalized = normalized;

      if (normalized && normalized.ok) {
        toast(`Font set to ${sizeNum}px`, 'success', 900);
        break;
      }

      if (normalized && normalized.error === 'no-host-permission' && normalized.permissionPattern) {
        toast('Requesting permission to modify this site — approve the prompt in the browser.', 'info', 6000);

        const tab = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs && tabs[0])));
        const url = tab && tab.url ? tab.url : null;
        if (!url) { toast('Cannot determine tab URL to request permission.', 'error', 5000); lastNormalized = { ok:false, error:'no-url' }; break; }

        const permResp = await new Promise(resolve => {
          chrome.runtime.sendMessage({ __internal: 'requestHostPermission', url }, (resp) => {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: 'runtime-lastError', detail: chrome.runtime.lastError.message });
            resolve(resp || { ok: false });
          });
        });

        if (!permResp || !permResp.ok) {
          toast('Permission not granted. Cannot apply font size to this site.', 'error', 6000);
          lastNormalized = { ok:false, error: 'permission-denied', detail: permResp && permResp.detail };
          break;
        }

        attempt = 0;
        continue;
      }

      if (normalized && normalized.error === 'in-flight' && attempt <= MAX_RETRIES) {
        safeLog('applyFontSizeToActiveTab got in-flight; retrying', attempt);
        await new Promise(r => setTimeout(r, 180 + attempt * 120));
        continue;
      }

      toast('Unable to apply font on this page. Allow ClarityRead to access the site.', 'error', 6000);
      break;
    }

    if (lastNormalized && lastNormalized.ok) {
    } else if (lastNormalized && lastNormalized.error && lastNormalized.error !== 'in-flight') {
      safeLog('applyFontSizeToActiveTab final failure', lastNormalized);
    }

    return lastNormalized || { ok: false };
  } catch (e) {
    safeLog('applyFontSizeToActiveTab error', e);
    toast('Failed to apply font (see console).', 'error', 6000);
    return { ok: false, error: String(e) };
  } finally {
    if (fontSizeSlider) { fontSizeSlider.disabled = false; }
  }
}

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

const fontSlider = document.getElementById('fontSizeSlider');
if (fontSlider) {
  const debouncedApply = debounce((v) => applyFontSizeToActiveTab(v), 200);
  fontSlider.addEventListener('input', (ev) => {
    const v = ev.target.value;
    debouncedApply(v);
  });
  fontSlider.addEventListener('change', (ev) => {
    const v = ev.target.value;
    applyFontSizeToActiveTab(v);
  });
}

  let focusModeBtn = $('focusModeBtn');
  if (!focusModeBtn && document.querySelector('.themeRow')) {
    focusModeBtn = document.createElement('button');
    focusModeBtn.id = 'focusModeBtn';
    focusModeBtn.className = 'action-btn';
    const ico = document.createElement('span'); ico.className = 'action-icon'; ico.textContent = '🎯';
    const txt = document.createElement('span'); txt.className = 'action-text'; txt.textContent = 'Focus Mode';
    focusModeBtn.appendChild(ico);
    focusModeBtn.appendChild(txt);
    focusModeBtn.style.marginRight = '8px';
    document.querySelector('.themeRow').insertBefore(focusModeBtn, themeToggleBtn || null);
    safeLog('added dynamic focusModeBtn');
  } else if (focusModeBtn) {
    if (!focusModeBtn.querySelector('.action-text')) {
      const maybeText = document.createElement('span'); maybeText.className = 'action-text'; maybeText.textContent = focusModeBtn.textContent || 'Focus Mode';
      focusModeBtn.innerHTML = '';
      const ico = document.createElement('span'); ico.className = 'action-icon'; ico.textContent = '🎯';
      focusModeBtn.appendChild(ico); focusModeBtn.appendChild(maybeText);
    }
  }

 let summarizePageBtn = $('summarizePageBtn');
try {
  if (!summarizePageBtn) {
    const container = document.querySelector('.themeRow') || document.querySelector('.toolbar') || document.body;
    if (container) {
      summarizePageBtn = document.createElement('button');
      summarizePageBtn.id = 'summarizePageBtn';
      summarizePageBtn.className = 'action-btn';
      const ico = document.createElement('span'); ico.className = 'action-icon'; ico.textContent = '📝';
      const txt = document.createElement('span'); txt.className = 'action-text'; txt.textContent = 'Summarize';
      summarizePageBtn.appendChild(ico); summarizePageBtn.appendChild(txt);
      summarizePageBtn.style.marginRight = '8px';
      const ref = document.querySelector('.themeRow > *') || document.querySelector('.themeRow');
      if (document.querySelector('.themeRow')) {
        document.querySelector('.themeRow').insertBefore(summarizePageBtn, (focusModeBtn || themeToggleBtn || ref || null));
      } else {
        container.appendChild(summarizePageBtn);
      }
      safeLog('added dynamic summarizePageBtn');
    } else {
      safeLog('no container to add summarizePageBtn');
    }
  }
} catch (e) { safeLog('creating summarizePageBtn failed', e); }

  if (openSavedManagerBtn) {
    try { openSavedManagerBtn.style.display = 'none'; safeLog('hidden openSavedManagerBtn (Manage)'); } catch(e) {}
  }

  const _focusModeOriginalText = (focusModeBtn && focusModeBtn.querySelector('.action-text')) ? focusModeBtn.querySelector('.action-text').textContent : 'Focus Mode';

  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20 };
  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let settingsDebounce = null;
  let lastStatus = null;

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  }
  function lastNDates(n) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }

  function buildOriginPermissionPattern(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/*`;
    } catch (e) {
      return '<all_urls>';
    }
  }
  function isWebUrl(u = '') {
    if (!u) return false;
    const s = String(u).toLowerCase();
    return !/^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/|file:\/\/|view-source:|moz-extension:\/\/)/.test(s);
  }

  async function findBestWebTab() {
    return new Promise((resolve) => {
      chrome.windows.getAll({ populate: true }, (wins) => {
        if (chrome.runtime.lastError || !wins) return resolve(null);
        const focusedWin = wins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
        if (focusedWin) {
          const tab = focusedWin.tabs.find(t => t.active && isWebUrl(t.url));
          if (tab) return resolve(tab);
        }
        for (const w of wins) {
          if (w.type === 'normal' && Array.isArray(w.tabs)) {
            const tab = w.tabs.find(t => t.active && isWebUrl(t.url));
            if (tab) return resolve(tab);
          }
        }
        for (const w of wins) {
          if (!Array.isArray(w.tabs)) continue;
          for (const t of w.tabs) {
            if (t && isWebUrl(t.url)) return resolve(t);
          }
        }
        resolve(null);
      });
    });
  }

  function normalizeBgResponse(res) {
    try {
      let r = res;
      let depth = 0;
      while (r && typeof r === 'object' && ('response' in r) && (depth < 6)) {
        r = r.response;
        depth++;
      }
      return r;
    } catch (e) { safeLog('normalizeBgResponse threw', e); return res; }
  }

function normalizeSelectionResponse(raw) {
  try {
    if (!raw) return { text: '', title: '' };

    let obj = raw;

    const unwrapOnce = (o) => {
      if (!o || typeof o !== 'object') return o;
      if (Array.isArray(o) && o.length) return o[0];
      if ((o.ok === true || o.ok === false) && (o.response || o.data)) return (o.response || o.data);
      if (o.response && (typeof o.response === 'object')) return o.response;
      if (o.data && (typeof o.data === 'object')) return o.data;
      if (o.result && (typeof o.result === 'object')) return o.result;
      return o;
    };

    let prev = null;
    for (let i = 0; i < 6; i++) {
      const next = unwrapOnce(obj);
      if (next === obj || next == null) break;
      prev = obj;
      obj = next;
    }

    if (Array.isArray(obj) && obj.length) {
      const r0 = obj[0];
      if (r0 && typeof r0 === 'object' && 'result' in r0) obj = r0.result;
      else if (r0 && typeof r0 === 'object') obj = r0;
    }

    const maybe = (o, keys) => {
      if (!o || typeof o !== 'object') return '';
      for (const k of keys) {
        if (k in o && o[k] != null) {
          const v = o[k];
          if (typeof v === 'string') return v;
          try { return String(v); } catch(e) {}
        }
      }
      return '';
    };

    const text = maybe(obj, ['text', 'innerText', 'content', 'body', 'resultText', 'pageText', 'selectionText']);
    const title = maybe(obj, ['title', 'pageTitle', 'docTitle']);

    let finalText = (typeof text === 'string' ? text : '').trim();
    if (!finalText) {
      if (typeof obj === 'string' && obj.trim()) finalText = obj.trim();
      else {
        if (obj && typeof obj === 'object') {
          if (obj.result && typeof obj.result === 'string') finalText = obj.result.trim();
          else if (obj.response && typeof obj.response === 'string') finalText = obj.response.trim();
        }
      }
    }

    return { text: finalText, title: (typeof title === 'string' ? title.trim() : '') };
  } catch (e) {
    return { text: '', title: '' };
  }
}

async function sendMessageToActiveTabWithInject(message, _retry = 0) {
  const WAIT_MS = 1600;
  const POLL_MS = 50;
  let waited = 0;
  while (opLock && waited < WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    waited += POLL_MS;
  }
  if (opLock) {
    safeLog('sendMessageToActiveTabWithInject giving up due to opLock after wait');
    return { ok: false, error: 'in-flight' };
  }

  opLock = true;
  try {
    return await new Promise(resolve => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
        try {
          const tab = tabs && tabs[0];
          if (tab && tab.url && tab.url.startsWith('chrome-extension://')) {
            const webTab = await findBestWebTab().catch(() => null);
            if (webTab) {
              message._targetTabId = webTab.id;
              message._targetTabUrl = webTab.url;
              safeLog('Popup helper: selected best web tab', webTab.id, webTab.url);
            } else {
              delete message._targetTabId;
              delete message._targetTabUrl;
            }
          } else if (tab && tab.id && tab.url && isWebUrl(tab.url)) {
            message._targetTabId = tab.id;
            message._targetTabUrl = tab.url;
          } else if (tab && tab.id && tab.url && !isWebUrl(tab.url)) {
            const webTab = await findBestWebTab().catch(() => null);
            if (webTab) {
              message._targetTabId = webTab.id;
              message._targetTabUrl = webTab.url;
              safeLog('Popup helper: selected best web tab', webTab.id, webTab.url);
            } else {
              delete message._targetTabId;
              delete message._targetTabUrl;
            }
          }

          chrome.runtime.sendMessage(message, async (resRaw) => {
            if (chrome.runtime.lastError) {
              opLock = false;
              safeLog('popup > background send error:', chrome.runtime.lastError && chrome.runtime.lastError.message);
              return resolve({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
            }
            if (!resRaw) { opLock = false; return resolve({ ok: false, error: 'no-response' }); }

            const res = normalizeBgResponse(resRaw);

            if (res && res.ok === false && res.error === 'no-host-permission' && _retry < 1) {
              opLock = false;
              return resolve(res);
            }

            opLock = false;
            return resolve(res);
          });
        } catch (outer) {
          opLock = false;
          safeLog('sendMessageToActiveTabWithInject outer error', outer);
          return resolve({ ok: false, error: String(outer) });
        }
      });
    });
  } finally {
    opLock = false;
  }
}

  function build7DaySeries(daily = []) {
    const labels = lastNDates(7);
    const map = Object.fromEntries((daily || []).map(d => [d.date, d.pages || 0]));
    const data = labels.map(lbl => map[lbl] || 0);
    return { labels, data };
  }

  function loadStats() {
    safeLog('loadStats start');
    chrome.storage.local.get(['stats'], (res) => {
      const stats = res.stats || { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
      safeLog('loaded stats', stats);
      if (pagesReadEl) pagesReadEl.textContent = stats.totalPagesRead;
      if (timeReadEl) timeReadEl.textContent = formatTime(stats.totalTimeReadSec);
      const avg = stats.sessions > 0 ? stats.totalTimeReadSec / stats.sessions : 0;
      if (avgSessionEl) avgSessionEl.textContent = formatTime(avg);

      if (statsChartEl) {
        const ctx = (statsChartEl.getContext) ? statsChartEl.getContext('2d') : null;
        const series = build7DaySeries(stats.daily);
        if (chart) { try { chart.destroy(); } catch (err) { safeLog('chart.destroy error', err); } }
        if (typeof Chart === 'undefined') {
          safeLog('Chart.js not loaded — graph will be blank.');
        } else {
          chart = new Chart(ctx || statsChartEl, {
            type: 'bar',
            data: { labels: series.labels, datasets: [{ label: 'Pages Read', data: series.data, backgroundColor: '#4caf50' }] },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
              plugins: { legend: { display: false } }
            }
          });
          safeLog('chart created', { labels: series.labels, data: series.data });
          if (chartWrapper && chart) {
            try {
              if (chartResizeObserver) chartResizeObserver.disconnect();
              chartResizeObserver = new ResizeObserver(() => { try { chart.resize(); } catch (e) { safeLog('chart.resize error', e); } });
              chartResizeObserver.observe(chartWrapper);
              safeLog('chart ResizeObserver attached');
            } catch (e) { safeLog('chart ResizeObserver attach failed', e); }
          }
        }
      }
      if (badgesContainer) {
        badgesContainer.innerHTML = '';
        const milestones = [5,10,25,50,100];
        milestones.forEach(m => {
          const badge = document.createElement('span');
          badge.textContent = `📖${m}`; badge.style.marginRight='6px'; badge.style.opacity = (stats.totalPagesRead >= m ? '1' : '0.3');
          badgesContainer.appendChild(badge);
        });
      }
    });
  }

  function loadVoicesIntoSelect() {
    if (!voiceSelect) { safeLog('voiceSelect missing'); return; }
    const voices = speechSynthesis.getVoices() || [];
    safeLog('loadVoicesIntoSelect voices count', voices.length);
    voiceSelect.innerHTML = '';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });
    if (!voiceSelect.value && voices.length) {
      const defaultVoice = voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0];
      if (defaultVoice) voiceSelect.value = defaultVoice.name;
    }
  }
  speechSynthesis.onvoiceschanged = () => { safeLog('speechSynthesis.onvoiceschanged'); loadVoicesIntoSelect(); };
  loadVoicesIntoSelect();

  function selectVoiceByLang(langPrefix = 'en') {
    const voices = speechSynthesis.getVoices() || [];
    if (!voiceSelect) return;
    const voice = voices.find(v => v.lang && v.lang.startsWith(langPrefix));
    if (voice) {
      voiceSelect.value = voice.name;
      safeLog('selectVoiceByLang set voice', voice.name);
    } else safeLog('selectVoiceByLang no voice for', langPrefix);
  }

  function detectPageLanguageAndSelectVoice() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      safeLog('detectPageLanguage tab', tab && { id: tab.id, url: tab.url });
      if (!tab || !tab.id || !tab.url) return;
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
      try {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ lang: (document.documentElement && document.documentElement.lang) || navigator.language || 'en' })
        }, (results) => {
          if (chrome.runtime.lastError) { safeLog('detectPageLanguage exec lastError', chrome.runtime.lastError); return; }
          if (results && results[0] && results[0].result && results[0].result.lang) {
            const lang = (results[0].result.lang || 'en').split('-')[0];
            safeLog('detectPageLanguage detected', lang);
            selectVoiceByLang(lang);
          } else safeLog('detectPageLanguage no result');
        });
      } catch (err) { safeLog('detectPageLanguage caught', err); }
    });
  }

  function persistVoiceOverrideForCurrentSite(voiceName) {
    if (!currentHostname) { safeLog('persistVoiceOverrideForCurrentSite no hostname'); return; }
    chrome.storage.local.get([currentHostname], (res) => {
      const s = res[currentHostname] || {};
      s.voice = voiceName;
      const toSet = {}; toSet[currentHostname] = s;
      chrome.storage.local.set(toSet, () => safeLog('persistVoiceOverrideForCurrentSite saved', currentHostname, voiceName));
    });
  }
  
  function applyThemeFromStorage() {
    chrome.storage.local.get(['darkTheme'], (res) => {
      const isDark = !!(res && res.darkTheme);
      if (isDark) document.body.classList.add('dark-theme');
      else document.body.classList.remove('dark-theme');
      try {
        if (themeToggleBtn) {
          const ico = themeToggleBtn.querySelector('.theme-icon') || themeToggleBtn;
          if (ico) ico.textContent = isDark ? '☀️' : '🌙';
        }
      } catch (e) {}
    });
  }
  applyThemeFromStorage();

  safeOn(themeToggleBtn, 'click', () => {
    const isDark = !document.body.classList.contains('dark-theme');
    if (isDark) document.body.classList.add('dark-theme'); else document.body.classList.remove('dark-theme');
    try {
      const ico = themeToggleBtn.querySelector('.theme-icon') || themeToggleBtn;
      if (ico) ico.textContent = isDark ? '☀️' : '🌙';
    } catch (e) {}
    chrome.storage.local.set({ darkTheme: isDark }, () => { toast(isDark ? 'Dark theme on' : 'Dark theme off', 'info'); });
  });

  function initPerSiteUI() {
    safeLog('initPerSiteUI start');
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      safeLog('initPerSiteUI tab', tab && { id: tab.id, url: tab.url });
      if (!tab || !tab.url) {
        chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','voice','rate','pitch','highlight'], (syncRes) => {
          safeLog('initPerSiteUI no tab -> using sync defaults', syncRes);
          setUI({
            dys: syncRes.dys ?? DEFAULTS.dys,
            reflow: syncRes.reflow ?? DEFAULTS.reflow,
            contrast: syncRes.contrast ?? DEFAULTS.contrast,
            invert: syncRes.invert ?? DEFAULTS.invert,
            fontSize: syncRes.fontSize ?? DEFAULTS.fontSize,
            voice: syncRes.voice || '',
            rate: syncRes.rate || 1,
            pitch: syncRes.pitch || 1,
            highlight: syncRes.highlight || false
          });
        });
        return;
      }

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        safeLog('initPerSiteUI internal url, using sync settings');
        chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','voice','rate','pitch','highlight'], (syncRes) => {
          setUI({
            dys: syncRes.dys ?? DEFAULTS.dys,
            reflow: syncRes.reflow ?? DEFAULTS.reflow,
            contrast: syncRes.contrast ?? DEFAULTS.contrast,
            invert: syncRes.invert ?? DEFAULTS.invert,
            fontSize: syncRes.fontSize ?? DEFAULTS.fontSize,
            voice: syncRes.voice || '',
            rate: syncRes.rate || 1,
            pitch: syncRes.pitch || 1,
            highlight: syncRes.highlight || false
          });
        });
        return;
      }

      try { currentHostname = new URL(tab.url).hostname; } catch (e) { currentHostname = ''; safeLog('initPerSiteUI hostname parse failed', e); }
      safeLog('initPerSiteUI currentHostname', currentHostname);
      if (!currentHostname) return;

      chrome.storage.local.get([currentHostname], (localRes) => {
        const siteSettings = localRes[currentHostname];
        safeLog('initPerSiteUI siteSettings', siteSettings);
        if (siteSettings) {
          setUI(siteSettings);
          if (siteSettings.voice) setTimeout(() => { if (voiceSelect) voiceSelect.value = siteSettings.voice; safeLog('applied site voice override', siteSettings.voice); }, 200);
        } else {
          chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','voice','rate','pitch','highlight'], (syncRes) => {
            safeLog('initPerSiteUI no siteSettings, using sync', syncRes);
            setUI({
              dys: syncRes.dys ?? DEFAULTS.dys,
              reflow: syncRes.reflow ?? DEFAULTS.reflow,
              contrast: syncRes.contrast ?? DEFAULTS.contrast,
              invert: syncRes.invert ?? DEFAULTS.invert,
              fontSize: syncRes.fontSize ?? DEFAULTS.fontSize,
              voice: syncRes.voice || '',
              rate: syncRes.rate || 1,
              pitch: syncRes.pitch || 1,
              highlight: syncRes.highlight || false
            });
            detectPageLanguageAndSelectVoice();
          });
        }
      });
    });
  }

  function setUI(settings) {
    safeLog('setUI', settings);
    if (dysToggle) dysToggle.checked = !!settings.dys;
    if (reflowToggle) reflowToggle.checked = !!settings.reflow;
    if (contrastToggle) contrastToggle.checked = !!settings.contrast;
    if (invertToggle) invertToggle.checked = !!settings.invert;
    if (fontSizeSlider) fontSizeSlider.value = settings.fontSize ?? DEFAULTS.fontSize;
    if (fontSizeValue) fontSizeValue.textContent = `${settings.fontSize ?? DEFAULTS.fontSize}px`;
    if (sizeOptions) sizeOptions.hidden = !settings.reflow;
    if (voiceSelect) voiceSelect.value = settings.voice || '';
    if (rateInput) rateInput.value = settings.rate ?? 1;
    if (pitchInput) pitchInput.value = settings.pitch ?? 1;
    if (highlightCheckbox) highlightCheckbox.checked = !!settings.highlight;
  }

  function clamp(n, lo, hi) {
    n = Number(n) || 0;
    if (isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function gatherSettingsObject() {
    const obj = {
      dys: dysToggle?.checked ?? false,
      reflow: reflowToggle?.checked ?? false,
      contrast: contrastToggle?.checked ?? false,
      invert: invertToggle?.checked ?? false,
      fontSize: fontSizeSlider ? Number(fontSizeSlider.value) : DEFAULTS.fontSize,
      voice: voiceSelect?.value ?? '',
      rate: rateInput ? clamp(rateInput.value, 0.5, 3) : 1,
      pitch: pitchInput ? clamp(pitchInput.value, 0.5, 2) : 1,
      highlight: highlightCheckbox?.checked ?? false
    };
    safeLog('gatherSettingsObject', obj);
    return obj;
  }

  function sendSettingsAndToggles(settings, options = { showToast: false }) {
    safeLog('sendSettingsAndToggles', settings, options);
    return sendMessageToActiveTabWithInject({ action: 'applySettings', ...settings })
      .then((resRaw) => {
        const res = normalizeBgResponse(resRaw);
        safeLog('applySettings response', res);
        if (!res || !res.ok) {
          safeLog('applySettings failed:', JSON.stringify(res));
          if (options.showToast) toast('Failed to apply settings to page.', 'error');
        } else {
          if (options.showToast) toast('Settings applied.', 'success', 1800);
        }
try {
  if (res && res.ok) {
    sendMessageToActiveTabWithInject({ action: 'applySettings', dys: settings.dys, fontSize: settings.fontSize }).catch(() => {});
  }
} catch (e) { safeLog('overlay font immediate update failed', e); }

        return res;
      })
      .catch(err => { safeLog('applySettings err', err); if (options.showToast) toast('Failed to apply settings (see console).', 'error'); return { ok:false, error: String(err) }; });
  }

  function gatherAndSendSettings(options = { showToast: false }) {
    const settings = gatherSettingsObject();
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      let hostname = '';
      try { hostname = tab && tab.url ? new URL(tab.url).hostname : ''; } catch (e) { hostname = ''; safeLog('gatherAndSendSettings hostname parse failed', e); }
      safeLog('gatherAndSendSettings tab hostname', hostname);
      if (hostname) {
        const toSet = {}; toSet[hostname] = settings;
        chrome.storage.local.set(toSet, () => safeLog('saved per-site settings to storage.local', hostname));
      }
      chrome.storage.sync.set(settings, () => safeLog('saved settings to storage.sync', settings));
      setUI(settings);

      if (settingsDebounce) clearTimeout(settingsDebounce);
      settingsDebounce = setTimeout(() => { sendSettingsAndToggles(settings, options); settingsDebounce = null; }, 120);
    });
  }

  function setReadingStatus(status) {
    if (status === lastStatus) {
      safeLog('setReadingStatus skipped duplicate', status);
      return;
    }
    lastStatus = status;
    safeLog('setReadingStatus', status);
    if (readingStatusEl) readingStatusEl.textContent = status;
    if (status === 'Reading...') { isReading = true; isPaused = false; if (pauseBtn) pauseBtn.textContent = 'Pause'; if (readBtn) readBtn.disabled = true; }
    else if (status === 'Paused') { isReading = true; isPaused = true; if (pauseBtn) pauseBtn.textContent = 'Resume'; if (readBtn) readBtn.disabled = false; }
    else { isReading = false; isPaused = false; if (pauseBtn) pauseBtn.textContent = 'Pause'; if (readBtn) readBtn.disabled = false; }
  }

  safeOn(dysToggle, 'change', () => gatherAndSendSettings({ showToast: false }));
  safeOn(reflowToggle, 'change', () => { if (sizeOptions) sizeOptions.hidden = !reflowToggle.checked; gatherAndSendSettings({ showToast: false }); });
  safeOn(contrastToggle, 'change', () => { if (contrastToggle?.checked && invertToggle) invertToggle.checked = false; gatherAndSendSettings({ showToast: false }); });
  safeOn(invertToggle, 'change', () => { if (invertToggle?.checked && contrastToggle) contrastToggle.checked = false; gatherAndSendSettings({ showToast: false }); });
  safeOn(fontSizeSlider, 'input', () => { if (fontSizeValue) fontSizeValue.textContent = `${fontSizeSlider.value}px`; gatherAndSendSettings({ showToast: false }); });
  safeOn(rateInput, 'input', () => gatherAndSendSettings({ showToast: false }));
  safeOn(pitchInput, 'input', () => gatherAndSendSettings({ showToast: false }));
  safeOn(highlightCheckbox, 'change', () => gatherAndSendSettings({ showToast: false }));

  safeOn(voiceSelect, 'change', () => {
    const v = voiceSelect.value;
    safeLog('voiceSelect changed', v);
    persistVoiceOverrideForCurrentSite(v);
    chrome.storage.sync.set({ voice: v }, () => safeLog('voice persisted to sync', v));
  });

function ensureVoicesLoaded(timeoutMs = 1500) {
  const voices = speechSynthesis.getVoices() || [];
  if (voices.length) { safeLog('ensureVoicesLoaded already have voices', voices.length); return Promise.resolve(voices); }
  return new Promise(resolve => {
    let called = false;
    const onChange = () => {
      if (called) return;
      called = true;
      try { speechSynthesis.removeEventListener('voiceschanged', onChange); } catch (e) {}
      safeLog('voiceschanged event fired (ensureVoicesLoaded)');
      resolve(speechSynthesis.getVoices() || []);
    };
    speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => {
      if (!called) {
        called = true;
        try { speechSynthesis.removeEventListener('voiceschanged', onChange); } catch (e) {}
        safeLog('ensureVoicesLoaded timeout, returning whatever available');
        resolve(speechSynthesis.getVoices() || []);
      }
    }, timeoutMs);
  });
}

  function extractSelection(resRaw) {
    try {
      const r = normalizeBgResponse(resRaw);
      if (!r) return null;
      if (r.selection && typeof r.selection === 'object') return r.selection;
      if (typeof r.text === 'string' && r.text.trim().length) {
        return { text: r.text, title: r.title || '', url: r.url || '' };
      }
      if (r.response && typeof r.response === 'object') {
        if (r.response.selection && typeof r.response.selection === 'object') return r.response.selection;
        if (typeof r.response.text === 'string' && r.response.text.trim()) return { text: r.response.text, title: r.response.title || '', url: r.response.url || '' };
      }
      return null;
    } catch (e) { safeLog('extractSelection threw', e); return null; }
  }

  safeOn(readBtn, 'click', () => {
    safeLog('readBtn clicked', { isReading, isPaused });
    if (isReading) { toast('Already reading. Pause or stop before starting a new read.', 'info'); return; }
    const settings = gatherSettingsObject();
    chrome.storage.sync.set({ voice: settings.voice, rate: settings.rate, pitch: settings.pitch, highlight: settings.highlight }, async () => {
      const voices = await ensureVoicesLoaded(1500);
      safeLog('voices after ensure', voices.length);
      if (settings.voice && voices.length && !voices.find(v => v.name === settings.voice)) {
        const fallback = (voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0]);
        if (fallback) {
          settings.voice = fallback.name;
          chrome.storage.sync.set({ voice: settings.voice });
          persistVoiceOverrideForCurrentSite(settings.voice);
          safeLog('readBtn voice fallback applied', settings.voice);
          toast('Selected voice not available on this device — using fallback.', 'info', 3000);
        }
      }

      if (speedToggle && speedToggle.checked) {
        const chunkSize = Number(chunkSizeInput?.value || 3);
        const rate = Number(speedRateInput?.value || settings.rate || 1);
        safeLog('starting speedRead', { chunkSize, rate });
        readBtn.disabled = true;
        const res = await sendMessageToActiveTabWithInject({ action: 'speedRead', chunkSize, rate });
        readBtn.disabled = false;
        const r = normalizeBgResponse(res);
        if (!r || !r.ok) {
          safeLog('speedRead failed', r);
          toast('Speed-read failed. Falling back to normal read.', 'error', 3500);
          const fallback = await sendMessageToActiveTabWithInject({ action: 'readAloud', highlight: settings.highlight });
          if (normalizeBgResponse(fallback)?.ok) setReadingStatus('Reading...');
        } else {
          setReadingStatus('Reading...');
        }
        return;
      }

      safeLog('sending readAloud', settings);
      readBtn.disabled = true;
      const result = await sendMessageToActiveTabWithInject({ action: 'readAloud', highlight: settings.highlight, voice: settings.voice, rate: settings.rate, pitch: settings.pitch });
      readBtn.disabled = false;
      safeLog('readAloud send response', result);
      const r = normalizeBgResponse(result);
      if (!r || !r.ok) {
        safeLog('readAloud send failed:', JSON.stringify(r));
        if (r && r.error === 'no-host-permission') toast('Permission needed to access this site. Click the extension icon on the page and allow access.', 'error', 7000);
        else if (r && r.error === 'unsupported-page') toast('Cannot control this page (internal/extension page). Open the target tab and try again.', 'error', 6000);
        else if (r && r.error === 'tab-discarded') toast('Target tab is suspended. Reload the page and try again.', 'error', 6000);
        else if (r && r.error === 'no-tab') toast('No active tab found to read.', 'error', 4000);
        else toast('Failed to start reading. See console for details.', 'error', 5000);
      } else setReadingStatus('Reading...');
    });
  });

  safeOn(stopBtn, 'click', async () => {
    safeLog('stopBtn clicked');
    stopBtn.disabled = true;
    const res = await sendMessageToActiveTabWithInject({ action: 'stopReading' });
    stopBtn.disabled = false;
    safeLog('stopReading response', res);
    const r = normalizeBgResponse(res);
    if (!r || (!r.ok && r.error === 'unsupported-page')) toast('Stop failed: cannot control this page.', 'error', 4500);
    else toast('Stopped reading.', 'success', 1200);
    setReadingStatus('Not Reading');
  });

  safeOn(pauseBtn, 'click', async () => {
    safeLog('pauseBtn clicked', { isReading, isPaused });
    if (!isReading) { toast('Nothing is currently reading.', 'info'); return; }
    if (!isPaused) {
      pauseBtn.disabled = true;
      const r = await sendMessageToActiveTabWithInject({ action: 'pauseReading' });
      pauseBtn.disabled = false;
      safeLog('pauseReading response', r);
      if (normalizeBgResponse(r)?.ok) setReadingStatus('Paused');
      else toast('Pause failed.', 'error');
    } else {
      pauseBtn.disabled = true;
      const r2 = await sendMessageToActiveTabWithInject({ action: 'resumeReading' });
      pauseBtn.disabled = false;
      safeLog('resumeReading response', r2);
      if (normalizeBgResponse(r2)?.ok) setReadingStatus('Reading...');
      else toast('Resume failed.', 'error');
    }
  });

   safeOn(focusModeBtn, 'click', async () => {
    safeLog('focusModeBtn clicked');
    focusModeBtn.disabled = true;

    // prefer using background path first
    const res = await sendMessageToActiveTabWithInject({ action: 'toggleFocusMode' }).catch(e => ({ ok: false, error: String(e) }));
    safeLog('toggleFocusMode response', res);

    const r = normalizeBgResponse(res);
    const textEl = focusModeBtn ? focusModeBtn.querySelector('.action-text') : null;

    if (r && r.ok) {
      // normal happy path
      if (textEl) textEl.textContent = (r.overlayActive ? `Close ${_focusModeOriginalText}` : _focusModeOriginalText);
      else focusModeBtn.textContent = (r.overlayActive ? `Close ${_focusModeOriginalText}` : _focusModeOriginalText);
      toast(r.overlayActive ? 'Focus mode opened.' : 'Focus mode closed.', 'success', 1400);
      safeLog('focusModeBtn UI updated (bg)', focusModeBtn.textContent);
      focusModeBtn.disabled = false;
      return;
    }

    // If background says no-text (extractor couldn't find main content),
    // fall back to a minimal injected overlay so the user still gets focus mode.
    if (r && r.error === 'no-text') {
      safeLog('toggleFocusMode reported no-text — attempting inline fallback overlay');
      try {
        // get best web tab id (same helper you use elsewhere)
        const tab = await findBestWebTab();
        if (!tab || !tab.id) throw new Error('no-target-tab-for-fallback');

        const fallbackRes = await new Promise(resolve => {
          try {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                try {
                  // minimal toggle overlay (id: clarityread-fallback-overlay)
                  const ID = 'clarityread-fallback-overlay';
                  let el = document.getElementById(ID);
                  if (el) {
                    // toggle off
                    el.remove();
                    return { ok: true, overlayActive: false };
                  }
                  el = document.createElement('div');
                  el.id = ID;
                  el.style.position = 'fixed';
                  el.style.zIndex = 2147483646;
                  el.style.left = '0';
                  el.style.top = '0';
                  el.style.right = '0';
                  el.style.bottom = '0';
                  el.style.background = 'rgba(0,0,0,0.65)';
                  el.style.color = '#fff';
                  el.style.display = 'flex';
                  el.style.alignItems = 'center';
                  el.style.justifyContent = 'center';
                  el.style.fontSize = '18px';
                  el.style.fontFamily = 'sans-serif';
                  el.style.padding = '20px';
                  el.style.backdropFilter = 'blur(4px)';
                  el.textContent = 'Focus mode — press Esc or click this overlay to close.';
                  el.addEventListener('click', () => el.remove());
                  // allow Esc to close
                  const onKey = (ev) => { if (ev.key === 'Escape') { try { el.remove(); window.removeEventListener('keydown', onKey); } catch(e){} } };
                  window.addEventListener('keydown', onKey);
                  document.body.appendChild(el);
                  return { ok: true, overlayActive: true };
                } catch (e) { return { ok: false, error: String(e) }; }
              }
            }, (results) => {
              if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
              } else if (Array.isArray(results) && results[0] && results[0].result) {
                resolve(results[0].result);
              } else resolve({ ok: false, error: 'no-result' });
            });
          } catch (ee) { resolve({ ok: false, error: String(ee) }); }
        });

        const fallbackNorm = normalizeBgResponse(fallbackRes);
        if (fallbackNorm && fallbackNorm.ok) {
          if (textEl) textEl.textContent = (fallbackNorm.overlayActive ? `Close ${_focusModeOriginalText}` : _focusModeOriginalText);
          toast(fallbackNorm.overlayActive ? 'Focus mode opened (fallback).' : 'Focus mode closed (fallback).', 'success', 1600);
          safeLog('focusModeBtn UI updated (fallback)', fallbackNorm);
        } else {
          toast('Failed to show focus mode (fallback).' , 'error', 4500);
          safeLog('fallback overlay failed', fallbackNorm);
        }
      } catch (err) {
        safeLog('focus mode fallback threw', err);
        toast('Failed to toggle focus mode.', 'error', 4500);
      } finally {
        focusModeBtn.disabled = false;
      }
      return;
    }

    // Generic failures
    if (!r || !r.ok) {
      if (r && r.error === 'no-host-permission') toast('Permission required to show focus mode for this site.', 'error', 6000);
      else if (r && r.error === 'tab-discarded') toast('The target tab is suspended. Reload the page and try again.', 'error', 5000);
      else toast('Failed to toggle focus mode.', 'error', 4500);
    }

    focusModeBtn.disabled = false;
  });


// ========== IMPROVED SUMMARIZER FUNCTIONS START ==========

// ======= Summarizer + IDF loader (copy-paste ready) =======

let IDF_MAP = Object.create(null);

/**
 * Load idf.json from the extension bundle if it exists.
 * - IDF_FILENAME should be defined elsewhere in your code; if not, we skip.
 * - Uses AbortController when available to avoid hanging fetches (safe fallback if not available).
 */
(async function loadIdfFromExtension() {
  try {
    if (typeof IDF_FILENAME === 'undefined' || !IDF_FILENAME) {
      safeLog && safeLog('IDF_FILENAME not defined; skipping idf load.');
      IDF_MAP = Object.create(null);
      return;
    }

    const url = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL(IDF_FILENAME) : IDF_FILENAME;

    // short guarded fetch with AbortController if present
    let controller = null;
    let signal = undefined;
    try { if (typeof AbortController !== 'undefined') { controller = new AbortController(); signal = controller.signal; setTimeout(() => controller.abort(), 4000); } } catch (e) {}
    const resp = await fetch(url, { cache: 'no-cache', signal }).catch((err) => {
      // fetch aborted or network error - treat like missing idf
      safeLog && safeLog('fetch idf failed', err && (err.message || err));
      return null;
    });

    if (!resp || !resp.ok) {
      safeLog && safeLog('No idf.json found in extension bundle (ok if intentional).', { url, status: resp && resp.status });
      IDF_MAP = Object.create(null);
      return;
    }

    const parsed = await resp.json().catch(e => {
      safeLog && safeLog('idf.json parse failed', e && (e.stack || e));
      return null;
    });

    if (!parsed || typeof parsed !== 'object') {
      IDF_MAP = Object.create(null);
      return;
    }

    const m = Object.create(null);
    for (const k of Object.keys(parsed || {})) {
      try {
        if (!k) continue;
        m[String(k).toLowerCase()] = Number(parsed[k]) || 0;
      } catch (e) { /* ignore malformed entries */ }
    }
    IDF_MAP = m;
    safeLog && safeLog('Loaded idf.json into popup', { entries: Object.keys(IDF_MAP).length });
  } catch (e) {
    safeLog && safeLog('loadIdfFromExtension failed (continuing without idf)', e && (e.stack || e));
    IDF_MAP = Object.create(null);
  }
})();

// -------------------- Basic cleaners / tokenizers --------------------

function cleanTextLocal(input) {
  if (!input || typeof input !== 'string') return '';
  try {
    let t = input.replace(/\[\d+\]/g, ' ')
                 .replace(/\(\d+\)/g, ' ')
                 .replace(/\s+/g, ' ')
                 .replace(/ {2,}/g, ' ')
                 .trim();
    t = t.replace(/\b(References|External links|See also|Further reading)\b[\s\S]*$/i, '');
    return t.trim();
  } catch (e) {
    return String(input || '').trim();
  }
}

/**
 * Sentence splitter that's permissive and avoids fragile lookbehind.
 * It extracts sentence-like chunks ending with . ? or ! together with trailing quotes/parens.
 * Falls back to splitting on newlines or periods if the matcher yields nothing.
 */
function splitIntoSentencesLocal(text) {
  if (!text || typeof text !== 'string') return [];
  const s = text.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim();
  if (!s) return [];
  const re = /([^.!?]+[.!?]["')\]]*\s*)/g;
  const arr = [];
  try {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const piece = (m[1] || '').trim();
      if (piece) arr.push(piece);
      // safety break to avoid infinite loops
      if (re.lastIndex >= s.length) break;
    }
  } catch (e) { /* ignore */ }

  if (!arr.length) {
    // fallback: split on punctuation boundaries
    const fallback = s.split(/(?<=[.?!])\s+/).map(x => x.trim()).filter(Boolean);
    if (fallback.length) return fallback;
    // last-chance fallback: split words into pseudo-sentences
    return s.match(/.{1,200}/g) || [s];
  }

  return arr;
}

function splitIntoParagraphsLocal(text) {
  if (!text || typeof text !== 'string') return [];
  const parts = text.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

const STOPWORDS_LOCAL = new Set([
  'the','is','in','and','a','an','to','of','that','it','on','for','with','as','was','were',
  'this','by','are','or','be','from','at','which','but','not','have','has','had','they',
  'you','i','their','its','we','our','us','will','can','may','also'
]);

function tokenizeLocal(sentence) {
  if (!sentence || typeof sentence !== 'string') return [];
  return (sentence.toLowerCase().match(/\b[^\d\W]+\b/g) || []).filter(w => !STOPWORDS_LOCAL.has(w));
}

function buildTermFrequenciesLocal(text) {
  if (!text || typeof text !== 'string') return Object.create(null);
  const words = (text || '').toLowerCase().match(/\b[^\d\W]+\b/g) || [];
  const tf = Object.create(null);
  for (const w of words) {
    if (!w) continue;
    if (STOPWORDS_LOCAL.has(w)) continue;
    tf[w] = (tf[w] || 0) + 1;
  }
  return tf;
}

function sentenceSimilarityLocal(a, b) {
  if (!a || !b) return 0;
  try {
    const ta = new Set(tokenizeLocal(a));
    const tb = new Set(tokenizeLocal(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const w of ta) if (tb.has(w)) inter++;
    const uni = new Set([...ta, ...tb]).size || 1;
    return inter / uni;
  } catch (e) { return 0; }
}

function scrubInputForSummarizer(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    let t = raw;
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/\[[^\]]{1,80}\]/g, ' ');
    t = t.replace(/\{[\s\S]*?\}/g, ' ');
    t = t.replace(/(References|External links|See also|Further reading|Navigation|Contents|Categories|vte)\b[\s\S]*/ig, ' ');
    t = t.replace(/\.mw-parser-output[\s\S]{0,8000}\}/gi, ' ');
    t = t.replace(/<\/?[^>]+>/g, ' ');
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  } catch (e) {
    return String(raw || '').replace(/<\/?[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
}

function tokenizeForScoring(sentence) {
  if (!sentence || typeof sentence !== 'string') return [];
  return (sentence.toLowerCase().match(/\b[^\d\W]+\b/g) || []).filter(w => !STOPWORDS_LOCAL.has(w) && w.length > 1);
}

// -------------------- Sentence scoring --------------------

function sentenceScoreLocal(sentence, tfGlobal, positionWeight = 1, titleTokens = new Set(), opts = {}) {
  if (!sentence || typeof sentence !== 'string') return 0;
  try {
    const tokens = tokenizeForScoring(sentence);
    if (!tokens.length) return 0;
    let score = 0;

    const idfBoost = (typeof opts.idfBoost === 'number') ? opts.idfBoost : 0.7;
    const titleBoost = (typeof opts.titleBoost === 'number') ? opts.titleBoost : 1.2;

    for (const t of tokens) {
      const tf = (tfGlobal && tfGlobal[t]) ? tfGlobal[t] : 0;
      const idf = (IDF_MAP && typeof IDF_MAP[t] !== 'undefined') ? IDF_MAP[t] : 1;
      score += tf * (1 + idfBoost * idf);
    }

    score = score / Math.sqrt(Math.max(1, tokens.length));

    let titleOverlap = 0;
    for (const t of tokens) if (titleTokens && titleTokens.has(t)) titleOverlap++;
    score += titleOverlap * titleBoost;

    // heuristics
    try { if (/\b(18|19|20)\d{2}\b/.test(sentence)) score *= 1.08; } catch (e) {}
    try { if (/[€$\£¥¢%]/.test(sentence)) score *= 1.06; } catch (e) {}
    try { if (/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(sentence)) score *= 1.05; } catch (e) {}

    const nonAlphaRatio = (sentence.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, sentence.length);
    if (nonAlphaRatio > 0.25) score *= 0.7;
    if (/^[A-Z0-9\W]{5,40}$/.test(sentence) && sentence === sentence.toUpperCase()) score *= 0.6;
    if (sentence.length < 18) score *= 0.7;

    score *= positionWeight;
    return score;
  } catch (e) {
    return 0;
  }
}

function mmrSelectLocal(candidates, scoresArr, k = 3, lambda = 0.62) {
  try {
    const selected = [];
    const used = new Set();
    const candArr = candidates.map((s, i) => ({ sentence: s, score: (scoresArr[i] && scoresArr[i].score) || 0 }));
    candArr.sort((a,b) => b.score - a.score);

    const adaptLambda = (candidates.join(' ').length > 8000) ? Math.max(0.40, lambda - 0.18) : lambda;

    while (selected.length < k && candArr.length) {
      let bestIdx = -1, bestVal = -Infinity;
      for (let i = 0; i < candArr.length; i++) {
        const c = candArr[i];
        if (used.has(c.sentence)) continue;
        let novelty = 0;
        for (const s of selected) novelty = Math.max(novelty, sentenceSimilarityLocal(c.sentence, s));
        const mmr = (adaptLambda * c.score) - ((1 - adaptLambda) * novelty);
        if (mmr > bestVal) { bestVal = mmr; bestIdx = i; }
      }
      if (bestIdx === -1) break;
      selected.push(candArr[bestIdx].sentence);
      used.add(candArr[bestIdx].sentence);
      candArr.splice(bestIdx, 1);
    }
    return selected;
  } catch (e) {
    return candidates.slice(0, Math.max(1, Math.min(k, candidates.length)));
  }
}

// ========== IMPROVED CONFIG AND K COMPUTATION ==========

function summarizerConfigForPref(pref = 'normal') {
  const cfg = {
    concise: {
      lambda: 0.78,
      titleBoost: 2.0,
      minSentenceLen: 15,
      idfBoost: 0.8,
      wordScaleFactor: 0.015
    },
    normal: {
      lambda: 0.60,
      titleBoost: 1.4,
      minSentenceLen: 12,
      idfBoost: 1.1,
      wordScaleFactor: 0.025
    },
    detailed: {
      lambda: 0.45,
      titleBoost: 1.0,
      minSentenceLen: 8,
      idfBoost: 1.4,
      wordScaleFactor: 0.040
    }
  };
  return cfg[pref] || cfg.normal;
}

/**
 * compute base target without monotonic adjustments (helper for computeFinalKForPref)
 */
function computeFinalKBase(text = '', pref = 'normal') {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 0;

  if (words < 50) {
    return pref === 'concise' ? 1 : (pref === 'detailed' ? 3 : 2);
  }

  const cfg = summarizerConfigForPref(pref);

  // The original formula used wordScaleFactor / 100; preserve that behavior.
  const scaledSentences = Math.floor(words * cfg.wordScaleFactor / 100);

  let target;
  if (pref === 'concise') {
    target = Math.max(2, Math.min(8, 2 + scaledSentences));
  } else if (pref === 'normal') {
    target = Math.max(4, Math.min(18, 4 + scaledSentences));
  } else {
    target = Math.max(7, Math.min(30, 7 + scaledSentences));
  }

  return target;
}

function computeFinalKForPref(text = '', pref = 'normal') {
  try {
    // compute base for requested pref and ensure monotonic progression by computing the lower-tier targets directly
    const base = computeFinalKBase(text, pref);

    if (pref === 'normal') {
      const conciseEquiv = computeFinalKBase(text, 'concise');
      return Math.max(base, conciseEquiv + 2);
    } else if (pref === 'detailed') {
      const normalEquiv = computeFinalKBase(text, 'normal');
      return Math.max(base, normalEquiv + 3);
    }
    return base;
  } catch (e) {
    safeLog && safeLog('computeFinalKForPref error', e && (e.stack || e));
    return 3;
  }
}

function isQualitySentence(sentence, minLen = 10, pref = 'normal') {
  const s = (sentence || '').trim();
  if (!s || s.length < minLen) return false;
  if (!/[a-z]/i.test(s)) return false;

  const junkPatterns = [
    /^(Outline|History|See also|References|External links|Category|Navigation|Contents|Table of|Menu|Skip to|Related|Trending|Advertisement|Sponsored|Click here|Read more|Subscribe|Share|Follow us)$/i,
    /^(By |Author:|Written by|Updated on|Last edited|Copyright|©)/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^[\d\s\-\(\)]+$/
  ];
  if (junkPatterns.some(re => re.test(s))) return false;

  const alphaCount = (s.match(/[a-zA-Z]/g) || []).length;
  const totalCount = s.length;
  if (alphaCount / totalCount < 0.50) return false;

  if (pref === 'detailed') {
    return s.length >= 8 && alphaCount >= 5;
  }

  if (s.length >= 20 || /[.?!]$/.test(s)) return true;

  const wordCount = (s.match(/\b[a-z]{2,}\b/gi) || []).length;
  return wordCount >= 4;
}

// ===================== Main summarizer =====================

function summarizeTextLocal(rawText, maxSentencesArg = null, userPref = 'normal') {
  if (!rawText || typeof rawText !== 'string') return '';

  let cleaned = scrubInputForSummarizer(rawText);
  if (!cleaned) return '';

  try {
    cleaned = cleaned.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
    cleaned = cleaned.replace(/([^\s])By([A-Z])/g, '$1 By $2');
    cleaned = cleaned.replace(/(Updated on|updated on)([A-Z0-9])/g, '$1 $2');
  } catch (e) { /* ignore */ }

  const cfg = summarizerConfigForPref(userPref || 'normal');

  const plannedK = (typeof maxSentencesArg === 'number' && maxSentencesArg > 0)
    ? Math.min(30, Math.max(1, Math.floor(maxSentencesArg)))
    : computeFinalKForPref(cleaned, userPref);

  try {
    if (window.__clarity_debug_summary) {
      safeLog && safeLog('summarizer config', { userPref, plannedK, rawLen: cleaned.length, cfg });
    }
  } catch (e) {}

  // Short document fast path (by character length)
  if (cleaned.length < 300) {
    const sents = splitIntoSentencesLocal(cleaned);
    const k = Math.min(plannedK, sents.length);
    if (k <= 0 || sents.length <= k) return sents.join(' ').trim();

    const tf = buildTermFrequenciesLocal(cleaned);
    const scored = sents.map((sen, idx) => ({
      sentence: sen,
      score: sentenceScoreLocal(sen, tf, 1.0, new Set(), { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost })
    }));
    scored.sort((a,b) => b.score - a.score);

    const chosen = scored.slice(0, k).map(x => x.sentence);
    const ordered = sents.filter(s => chosen.includes(s));
    return ordered.join(' ').trim();
  }

  // Full document: per-paragraph aggregation
  const paragraphs = splitIntoParagraphsLocal(cleaned);
  const globalTF = buildTermFrequenciesLocal(cleaned);
  const firstLine = (cleaned.split('\n')[0] || '').trim();
  const titleTokens = new Set(tokenizeForScoring(firstLine).slice(0, 15));

  const paraSummaries = [];
  for (const p of paragraphs) {
    if (!p) continue;
    const sents = splitIntoSentencesLocal(p);
    if (!sents.length) continue;

    const scored = sents.map((sen, idx) => ({
      sentence: sen,
      score: sentenceScoreLocal(sen, globalTF, (idx === 0 ? 1.05 : 1.0), titleTokens, { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost })
    }));
    scored.sort((a,b) => b.score - a.score);

    const topCount = Math.max(1, Math.min(4, Math.ceil(scored.length * 0.35)));
    for (let i = 0; i < Math.min(topCount, scored.length); i++) {
      paraSummaries.push(scored[i].sentence);
    }

    if (paraSummaries.length > plannedK * 3) break;
  }

  let allCandidates = paraSummaries.length ? paraSummaries : splitIntoSentencesLocal(cleaned);

  const scoredCandidates = allCandidates.map((sen, idx) => ({
    sentence: sen,
    score: sentenceScoreLocal(sen, globalTF, 1.0, titleTokens, { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost })
  }));
  scoredCandidates.sort((a,b) => b.score - a.score);

  const candidatesList = scoredCandidates.map(x => x.sentence);
  const scoresList = scoredCandidates.map(x => ({ sentence: x.sentence, score: x.score }));

  const lambda = cfg.lambda;
  const k = Math.min(plannedK, candidatesList.length);

  let selected = mmrSelectLocal(candidatesList, scoresList, k, lambda);

  // Restore order
  const docSents = splitIntoSentencesLocal(cleaned);
  const orderedSelected = docSents.filter(s => selected.includes(s));
  let final = orderedSelected.join(' ').trim();

  // Improved quality filter (permissive)
  try {
    const parts = final.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
    const minLen = cfg.minSentenceLen;
    const quality = parts.filter(s => isQualitySentence(s, minLen, userPref));

    if (quality.length >= plannedK) {
      final = quality.slice(0, plannedK).join(' ').trim();
    } else if (quality.length >= Math.floor(plannedK * 0.7)) {
      const remaining = parts.filter(s => !quality.includes(s));
      const needed = plannedK - quality.length;
      remaining.sort((a, b) => {
        const scoreA = a.length * (a.match(/\b\w+\b/g) || []).length;
        const scoreB = b.length * (b.match(/\b\w+\b/g) || []).length;
        return scoreB - scoreA;
      });
      const padding = remaining.slice(0, needed).filter(s => s.length >= 8);
      final = [...quality, ...padding].join(' ').trim();
    } else {
      safeLog && safeLog('Quality filter too aggressive, using top scored', { quality: quality.length, need: plannedK });
      const topScored = scoredCandidates.slice(0, plannedK * 2).map(x => x.sentence).filter(s => s.length >= 10 && /[a-z]/i.test(s));
      const ordered = docSents.filter(s => topScored.includes(s));
      final = ordered.slice(0, plannedK).join(' ').trim();
    }
  } catch (e) {
    safeLog && safeLog('Post-filter threw, using unfiltered', e && (e.stack || e));
  }

  // Final trimming/padding to ensure exactly K sentences if possible
  try {
    let finalSents = final.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(s => s.length > 0);
    if (finalSents.length < plannedK) {
      const needed = plannedK - finalSents.length;
      const available = scoredCandidates.map(x => x.sentence).filter(s => !finalSents.includes(s) && s.length >= 10).slice(0, needed);
      if (available.length) {
        const combined = [...finalSents, ...available];
        const reordered = docSents.filter(s => combined.includes(s));
        return reordered.join(' ').trim();
      }
    }
    if (finalSents.length > plannedK) {
      return finalSents.slice(0, plannedK).join(' ').trim();
    }
    return finalSents.join(' ').trim();
  } catch (e) {
    safeLog && safeLog('Final trimming failed', e && (e.stack || e));
    return final.trim();
  }
}




function clearToastsLocal() {
  try {
    const selectors = ['.toast', '.toaster', '.cr-toast', '.notification', '[data-toast]'];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(n => { try { n.remove(); } catch(e){} }));
    ['#toast','#toaster','.popup-toast'].forEach(id => { const el = document.querySelector(id); if (el) el.remove(); });
    safeLog('clearToastsLocal executed');
  } catch (e) { safeLog('clearToastsLocal error', e); }
}

function createSummaryModal(title = 'Summary', content = '') {
  try {
    const old = document.getElementById('clarityread-summary-modal');
    if (old) old.remove();

    let bg = '#fff', fg = '#111', border = '#e6e6e6';
    try {
      const cs = window.getComputedStyle(document.body || document.documentElement);
      const bodyBg = cs && cs.backgroundColor ? cs.backgroundColor : '';
      const bodyColor = cs && cs.color ? cs.color : '';
      if (bodyBg) bg = bodyBg;
      if (bodyColor) fg = bodyColor;
      border = (typeof fg === 'string') ? fg : border;
    } catch (e) {}

    const modal = document.createElement('div');
    modal.id = 'clarityread-summary-modal';
    modal.style.position = 'fixed';
    modal.style.zIndex = 2147483647;
    modal.style.left = '8px';
    modal.style.right = '8px';
    modal.style.top = '8px';
    modal.style.bottom = '8px';
    modal.style.background = bg;
    modal.style.border = `1px solid ${border}`;
    modal.style.borderRadius = '8px';
    modal.style.padding = '12px';
    modal.style.overflow = 'auto';
    modal.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
    modal.style.fontSize = '13px';
    modal.style.color = fg;
    modal.style.backdropFilter = 'blur(4px)';

    const hdr = document.createElement('div');
    hdr.style.display = 'flex';
    hdr.style.justifyContent = 'space-between';
    hdr.style.alignItems = 'center';
    hdr.style.marginBottom = '8px';

    const hLeft = document.createElement('div');
    const h = document.createElement('strong');
    h.textContent = title;
    hLeft.appendChild(h);

    hdr.appendChild(hLeft);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(content);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        toast('Summary copied to clipboard.', 'success', 1400);
      } catch (e) { safeLog('summary copy failed', e); toast('Copy failed.', 'error'); }
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'summary.txt';
      a.click();
      URL.revokeObjectURL(url);
      toast('Summary downloaded.', 'success', 1400);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => modal.remove());

    actions.appendChild(downloadBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);

    hdr.appendChild(actions);
    modal.appendChild(hdr);

    const contentDiv = document.createElement('div');
    contentDiv.id = 'clarityread-summary-content';
    contentDiv.style.whiteSpace = 'pre-wrap';
    contentDiv.style.lineHeight = '1.5';
    contentDiv.style.color = fg;
    contentDiv.style.fontSize = '13px';
    contentDiv.textContent = content || '(no summary)';
    modal.appendChild(contentDiv);

    document.body.appendChild(modal);
    modal.tabIndex = -1;
    modal.focus();

    return modal;
  } catch (e) {
    safeLog('createSummaryModal error', e);
    return null;
  }
}

function stripCssLikeFragments(raw) {
  try {
    if (!raw || typeof raw !== 'string') return raw || '';
    let t = raw;
    t = t.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/\.mw-parser-output[\s\S]*?\}/gi, ' ');
    t = t.replace(/[\{\}<>\[\]]{3,}/g, ' ');
    t = t.replace(/\s{2,}/g, ' ');
    return t.trim();
  } catch (e) { return raw || ''; }
}

async function readSummaryPref() {
  try {
    return await new Promise(resolve => chrome.storage.local.get(['summaryDetail'], r => resolve((r && r.summaryDetail) || 'normal')));
  } catch (e) { return 'normal'; }
}

const _PROG_ID = 'clarityread-progress-toast-v1';

function createProgressToast(msg = 'Generating summary — please wait...', ttl = 60000) {
  try {
    let cont = document.getElementById('clarityread-toast-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'clarityread-toast-container';
      cont.style.position = 'fixed';
      cont.style.right = '12px';
      cont.style.bottom = '12px';
      cont.style.zIndex = 2147483647;
      cont.style.display = 'flex';
      cont.style.flexDirection = 'column';
      cont.style.gap = '8px';
      document.body.appendChild(cont);
    }
    const old = document.getElementById(_PROG_ID);
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = _PROG_ID;
    el.className = 'clarityread-toast';
    el.textContent = msg;
    el.style.padding = '10px 14px';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    el.style.background = '#fff7e6';
    el.style.color = '#111';
    el.style.fontSize = '13px';
    el.style.maxWidth = '360px';
    cont.appendChild(el);
    el._auto = setTimeout(() => { try { el.remove(); } catch(e){} }, ttl);
    return _PROG_ID;
  } catch (e) { safeLog && safeLog('createProgressToast error', e); return null; }
}

function clearProgressToast() {
  try {
    const el = document.getElementById(_PROG_ID);
    if (el) {
      if (el._auto) { clearTimeout(el._auto); el._auto = null; }
      el.remove();
    }
  } catch (e) { safeLog && safeLog('clearProgressToast error', e); }
}

async function fetchCleanPageText(tabId, tabUrl) {
  function tryBackgroundExtract() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'clarity_extract_main', _targetTabId: tabId }, (resp) => {
          if (chrome.runtime.lastError) {
            safeLog('background extract lastError', chrome.runtime.lastError && chrome.runtime.lastError.message);
            return resolve({ ok: false, reason: 'runtime-lastError', detail: chrome.runtime.lastError && chrome.runtime.lastError.message });
          }
          if (resp && resp.ok && (resp.text || resp.html)) {
            return resolve({ ok: true, text: (resp.text || '').toString(), html: resp.html || '', title: resp.title || '' });
          }
          resolve({ ok: false, reason: 'bg-no-data', detail: resp || null });
        });
      } catch (e) {
        safeLog('tryBackgroundExtract threw', e);
        resolve({ ok: false, reason: 'bg-exception', detail: String(e) });
      }
    });
  }

  function tryExecuteScriptExtract() {
    return new Promise((resolve) => {
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            function getMainNodeLocal() {
              try {
                const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text', '.mw-parser-output'];
                for (const s of prefer) {
                  const el = document.querySelector(s);
                  if (el && el.innerText && el.innerText.length > 200) return el;
                }
                const candidates = Array.from(document.querySelectorAll('article, main, section, div, p'))
                  .filter(el => el && el.innerText && el.innerText.trim().length > 200)
                  .map(el => ({ el, len: (el.innerText||'').trim().length }));
                if (candidates.length) {
                  candidates.sort((a,b) => b.len - a.len);
                  return candidates[0].el;
                }
                if (document.body && document.body.innerText && document.body.innerText.length > 200) return document.body;
              } catch (e) {}
              return document.documentElement || document.body;
            }

            try {
              const main = getMainNodeLocal();
              if (!main) return { text: '', title: document.title || '' };
              const clone = main.cloneNode(true);
              const rm = ['script','style','iframe','picture','svg','video','form','input','button','aside','nav','footer','header','table'];
              rm.forEach(s => {
                try { clone.querySelectorAll(s).forEach(n => { try { n.remove(); } catch(e){} }); } catch(e) {}
              });
              const noisy = ['.related','.related-articles','.advert','.ads','.share','.social','.newsletter','.subscribe','.promo'];
              noisy.forEach(s => { try { clone.querySelectorAll(s).forEach(n => { try { n.remove(); } catch(e){} }); } catch(e){} });
              let text = clone.innerText || '';
              text = text.replace(/\[\d+\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
              return { text: text, title: document.title || '' };
            } catch (ex) {
              return { text: '', title: document.title || '' };
            }
          }
        }, (res) => {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, reason: 'exec-failed', detail: chrome.runtime.lastError.message });
          }
          try {
            if (Array.isArray(res) && res.length && res[0] && res[0].result) {
              const r = res[0].result;
              return resolve({ ok: true, text: String(r.text || r || '').trim(), title: r.title || '' });
            }
            return resolve({ ok: false, reason: 'exec-no-result', detail: res });
          } catch (e) {
            return resolve({ ok: false, reason: 'exec-exception', detail: String(e) });
          }
        });
      } catch (e) {
        safeLog('tryExecuteScriptExtract threw', e);
        resolve({ ok: false, reason: 'exec-throw', detail: String(e) });
      }
    });
  }

  const bgRes = await tryBackgroundExtract();
  if (bgRes.ok) return bgRes;

  const execRes = await tryExecuteScriptExtract();
  if (execRes.ok) return execRes;

  const maybeNeedPermissionErrors = ['must request permission', 'cannot access contents of the page', 'has no access to', 'exec-failed', 'exec-throw'];
  const low = String(execRes.detail || '').toLowerCase();
  if (tabUrl && maybeNeedPermissionErrors.some(s => low.includes(s))) {
    try {
      const permRes = await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({ __internal: 'requestHostPermission', url: tabUrl }, (r) => {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: 'perm-lastError', detail: chrome.runtime.lastError && chrome.runtime.lastError.message });
            resolve(r || { ok: false });
          });
        } catch (e) { resolve({ ok: false, error: 'perm-exception', detail: String(e) }); }
      });
      if (permRes && permRes.ok) {
        const retry = await tryExecuteScriptExtract();
        if (retry.ok) return retry;
      }
      return { ok: false, reason: 'permission-not-granted', detail: permRes || execRes };
    } catch (e) {
      safeLog('permission request path failed', e);
      return { ok: false, reason: 'permission-exception', detail: String(e) };
    }
  }

  return { ok: false, reason: 'all-failed', detail: { bg: bgRes, exec: execRes } };
}

async function summarizeCurrentPageOrSelection_AiAware() {
  safeLog('summarizeCurrentPageOrSelection_AiAware (local-only) start');

  if (!summarizePageBtn) {
    safeLog('summarizePageBtn missing');
    return;
  }
  summarizePageBtn.disabled = true;

  try {
    let text = '';
    let usedSelection = false;

    // find a sensible web tab to target
    const tab = await findBestWebTab();
    if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || !/^https?:\/\//i.test(tab.url)) {
      toast('Cannot summarize internal or extension pages.', 'error');
      return;
    }

    // ----- SELECTION HANDLING (NEW, early) -----
    // Try to read *current* window selection first. Only if the user actually has
    // a selection do we offer to summarize the selection. If not, always summarize full page.
    try {
      const pageSelResult = await new Promise(resolve => {
        try {
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            func: () => {
              try {
                const s = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
                if ((!s || !s.trim()) && document.activeElement) {
                  const ae = document.activeElement;
                  const tag = (ae && ae.tagName) ? ae.tagName.toUpperCase() : '';
                  if ((tag === 'TEXTAREA' || (tag === 'INPUT' && ae.type && ae.type.toLowerCase() === 'text')) && typeof ae.selectionStart === 'number') {
                    const start = ae.selectionStart, end = ae.selectionEnd;
                    if (end > start) return ae.value.slice(start, end);
                  }
                }
                return s || '';
              } catch (e) {
                return '';
              }
            }
          }, (res) => resolve(res));
        } catch (ex) {
          safeLog('executeScript threw while checking selection', ex);
          resolve(null);
        }
      });

      // Normalize the returned shape: chrome.scripting returns an array of results for frames
      let selText = '';
      try {
        if (Array.isArray(pageSelResult) && pageSelResult.length) {
          // take first non-empty result
          for (const entry of pageSelResult) {
            if (!entry) continue;
            if (typeof entry.result === 'string' && entry.result.trim()) {
              selText = entry.result.trim();
              break;
            }
            if (entry && entry.result && typeof entry.result.text === 'string' && entry.result.text.trim()) {
              selText = entry.result.text.trim();
              break;
            }
          }
        } else if (pageSelResult && typeof pageSelResult.result === 'string') {
          selText = pageSelResult.result.trim();
        } else if (typeof pageSelResult === 'string') {
          selText = pageSelResult.trim();
        }
      } catch (e) {
        safeLog('selection normalization failed', e);
        selText = '';
      }

      if (selText) {
        // user currently has selection — ask whether to summarize it
        const wantSelection = confirm('Summarize selected text? Click OK to summarize selection, Cancel to summarize full page.');
        if (wantSelection) {
          text = selText;
          usedSelection = true;
        } else {
          // user chose full page; continue to full-page fetch
          text = '';
          usedSelection = false;
        }
      } else {
        // No active selection — do NOT use stored selection prompt; summarize full page.
        usedSelection = false;
        text = '';
      }
    } catch (e) {
      safeLog('early selection detection failed (continuing to full page)', e && (e.stack || e));
      text = '';
      usedSelection = false;
    }
    // ----- end selection handling -----

    // If selection chosen, skip fetching page
    if (!usedSelection) {
      // FALLBACK: full page extraction (may need host permission)
      const fetched = await fetchCleanPageText(tab.id, tab.url);
      if (fetched && fetched.ok && fetched.text) {
        text = String(fetched.text || '').trim();
      } else {
        if (fetched && fetched.reason === 'permission-not-granted') {
          toast('Permission required to read this page. Please grant site permission and try again.', 'error', 8000);
        } else {
          toast('Unable to access page content. Give ClarityRead permission for this site and try again.', 'error', 6000);
        }
        return;
      }
    }

    if (!text || !text.trim()) {
      toast('No text to summarize — select text on the page or ensure the page has readable content.', 'info');
      return;
    }

    // choose preference and planned K
    const pref = await readSummaryPref();
    const plannedK = computeFinalKForPref(text, pref);
    safeLog && safeLog('summary counts', { pref, plannedK });

    const pid = createProgressToast('Generating summary — please wait...', 60000);
    let summary = '(no summary produced)';

    try {
      // Pre-scrub / heuristics similar to what you had; non-destructive
      try {
        text = text.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
        text = text.replace(/([^\s])By([A-Z])/g, '$1 By $2');
        text = text.replace(/(Updated on|updated on)([A-Z0-9])/g, '$1 $2');

        text = text.replace(/^\s*(By|Author:|Written by)\s+[^\n]{0,200}$/gim, ' ');
        text = text.replace(/\b(last edited|last updated|published on|©|copyright|all rights reserved)\b[^\n]*/gi, ' ');
        text = text.replace(/^\s*(Contact|Contact us|Subscribe|Follow (us|@)|Related articles|Read more|Advert(isement)?|Sponsored)\b[^\n]*$/gim, ' ');
        text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');
        text = text.replace(/\b(?:https?:\/\/|www\.)\S+\b/gi, ' ');
        text = text.replace(/(?:\+?\d[\d() .-]{7,}\d)/g, ' ');

        // remove trivial short nav lines
        text = text.split(/\n/).filter(line => {
          const t = line.trim();
          if (!t) return false;
          if (t.length < 20 && /^(Read|More|Share|Related|Jump|Contents|Table of contents|Menu|Skip to|Explore|Diet & Nutrition)/i.test(t)) return false;
          if (/^(\/|#|\-|\*|:){2,}/.test(t)) return false;
          return true;
        }).join('\n');
      } catch (e) {
        safeLog('prescrub threw', e && (e.stack || e));
      }

      if (typeof summarizeTextLocal === 'function') {
        summary = summarizeTextLocal(text, plannedK, pref) || summary;
        safeLog && safeLog('summarizer invoked', { usedK: plannedK, pref });
      } else {
        summary = '(summarizer not available)';
      }
    } catch (e) {
      safeLog('summarizer error', e && (e.stack || e));
    } finally {
      clearProgressToast();
    }

    // Post-filter the summary to drop junk fragments
    try {
      const parts = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
      const filtered = parts.filter(s => {
        if (s.length < 30 && (pref !== 'detailed')) return false;
        if (/^(Outline|History|See also|References|External links|Category|vte)\b/i.test(s)) return false;
        const nonAlphaRatio = (s.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, s.length);
        if (nonAlphaRatio > 0.20) return false;
        return true;
      });
      if (filtered.length) summary = filtered.join(' ');
    } catch (e) {
      safeLog('post-filter threw', e && (e.stack || e));
    }

    // present modal with adaptive header
    const modeSubtitle = usedSelection ? 'Selection' : 'Full page';

    // Count sentences robustly (prefers sentences that end with .?!, otherwise counts fragments)
    let actualSentences = 0;
    try {
      const parts = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
      // Count ones that look like full sentences (end with punctuation)
      const punctCount = parts.filter(s => /[.?!]$/.test(s)).length;
      if (punctCount > 0) {
        actualSentences = punctCount;
      } else {
        // If no punctuation-delimited sentences found, fall back to counting reasonable fragments
        actualSentences = parts.filter(s => s.length > 10).length || (summary.trim() ? 1 : 0);
      }
    } catch (e) {
      // Very defensive fallback
      actualSentences = ((summary || '').match(/[.?!]+/g) || []).length || ((summary && summary.trim()) ? 1 : 0);
    }

    const headerTitle = `Page Summary — ${actualSentences} sentence${actualSentences === 1 ? '' : 's'} (${modeSubtitle}, ${pref})`;
    createSummaryModal(headerTitle, summary);

    toast('Summary ready', 'success', 3000);

  } catch (err) {
    safeLog('summarize error', err && (err.stack || err));
    clearProgressToast();
    clearToastsLocal && clearToastsLocal();
    toast('Failed to summarize (see console).', 'error', 6000);

    // attempt a local fallback summary if you have last text cached
    try {
      if (typeof summarizeTextLocal === 'function') {
        const fallback = summarizeTextLocal(window.__clarity_last_text || '', 3);
        createSummaryModal('Page Summary (Local fallback)', fallback);
      }
    } catch (e) {
      safeLog('fallback also failed', e && (e.stack || e));
    }
  } finally {
    summarizePageBtn.disabled = false;
  }
}

try {
  let btn = $('summarizePageBtn');
  if (btn) {
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = $('summarizePageBtn');
    if (newBtn) safeOn(newBtn, 'click', summarizeCurrentPageOrSelection_AiAware);
  }
} catch (e) { safeLog('hook summarize button failed', e); }

  function updateProfileDropdown(profiles = {}, selectedName = '') { if (!profileSelect) return; profileSelect.innerHTML = '<option value="">Select profile</option>'; for (const name in profiles) { const opt=document.createElement('option'); opt.value=name; opt.textContent=name; profileSelect.appendChild(opt);} if (selectedName) profileSelect.value = selectedName; }
  function saveProfile(name, profile) { chrome.storage.local.get(['profiles'], (res) => { const profiles = res.profiles || {}; profiles[name] = profile; chrome.storage.local.set({ profiles }, () => { chrome.storage.sync.set({ profiles }, () => { toast('Profile saved.', 'success'); updateProfileDropdown(profiles, name); safeLog('profile saved', name, profile); }); }); }); }
  chrome.storage.local.get(['profiles'], (res) => { safeLog('loaded profiles', Object.keys(res.profiles||{})); updateProfileDropdown(res.profiles || {}); });

  safeOn(profileSelect, 'change', (e) => { const name = e.target.value; if (!name) return; chrome.storage.local.get(['profiles'], (res) => { const settings = res.profiles?.[name]; safeLog('profile selected', name, settings); if (settings) setUI(settings); gatherAndSendSettings({ showToast: true }); }); });

  safeOn(saveProfileBtn, 'click', () => { const name = prompt('Enter profile name:'); if (!name) return; const profile = gatherSettingsObject(); saveProfile(name, profile); });

  safeOn(exportProfilesBtn, 'click', () => { chrome.storage.local.get(['profiles'], (res) => { const dataStr = JSON.stringify(res.profiles || {}); const blob = new Blob([dataStr], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadProfiles.json'; a.click(); URL.revokeObjectURL(url); toast('Profiles exported.', 'success'); safeLog('exported profiles'); }); });

let exportSettingsBtn = document.getElementById('exportSettingsBtn') || null;

if (!exportSettingsBtn) {
  const candidate = document.getElementById('exportProfilesBtn');
  if (candidate && /export\s*settings/i.test((candidate.textContent||'').trim())) {
    exportSettingsBtn = candidate;
    exportSettingsBtn.id = exportSettingsBtn.id || 'exportSettingsBtn';
  }
}

if (!exportSettingsBtn) {
  exportSettingsBtn = document.createElement('button');
  exportSettingsBtn.id = 'exportSettingsBtn';
  exportSettingsBtn.className = 'ghost';
  exportSettingsBtn.textContent = 'Export Settings';
  if (exportProfilesBtn && exportProfilesBtn.parentNode) exportProfilesBtn.parentNode.insertBefore(exportSettingsBtn, exportProfilesBtn.nextSibling);
  else document.body.appendChild(exportSettingsBtn);
}

exportSettingsBtn.addEventListener('click', () => {
  const settings = gatherSettingsObject();
  const dataStr = JSON.stringify(settings, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ClarityReadSettings.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Settings exported.', 'success');
});

let importSettingsInput = document.getElementById('importSettingsInput') || null;
let importSettingsBtn = document.getElementById('importSettingsBtn') || null;

if (!importSettingsInput) {
  importSettingsInput = document.createElement('input');
  importSettingsInput.id = 'importSettingsInput';
  importSettingsInput.type = 'file';
  importSettingsInput.accept = '.json,application/json';
  importSettingsInput.style.display = 'none';
  document.body.appendChild(importSettingsInput);
}

if (!importSettingsBtn) {
  const candidateImport = document.getElementById('importProfilesBtn');
  if (candidateImport && /import/i.test((candidateImport.textContent||'').trim()) && !document.getElementById('importSettingsBtn')) {
    importSettingsBtn = candidateImport;
    importSettingsBtn.id = importSettingsBtn.id || 'importSettingsBtn';
  } else {
    importSettingsBtn = document.createElement('button');
    importSettingsBtn.id = 'importSettingsBtn';
    importSettingsBtn.className = 'ghost';
    importSettingsBtn.textContent = 'Import Settings';
    if (exportSettingsBtn && exportSettingsBtn.parentNode) exportSettingsBtn.parentNode.insertBefore(importSettingsBtn, exportSettingsBtn.nextSibling);
    else document.body.appendChild(importSettingsBtn);
  }
}

importSettingsBtn.addEventListener('click', () => importSettingsInput.click());

importSettingsInput.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) { importSettingsInput.value = ''; return; }
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      const keys = ['dys','reflow','contrast','invert','fontSize','voice','rate','pitch','highlight'];
      const valid = keys.some(k => k in imported);
      if (!valid) { toast('Invalid settings file.', 'error'); importSettingsInput.value = ''; return; }

      const toApply = {};
      keys.forEach(k => { if (k in imported) toApply[k] = imported[k]; });

      const merged = Object.assign({}, gatherSettingsObject(), toApply);
      setUI(merged);

      chrome.storage.sync.get(null, (cur) => {
        const newSync = Object.assign({}, cur, toApply);
        chrome.storage.sync.set(newSync, () => {
          toast('Settings imported to extension.', 'success', 1200);
          gatherAndSendSettings({ showToast: true });
        });
      });
    } catch (err) {
      toast('Failed to import settings: invalid JSON.', 'error');
      safeLog('importSettings error', err);
    }
    importSettingsInput.value = '';
  };
  r.readAsText(file);
});

  safeOn(resetStatsBtn, 'click', () => { if (!confirm('Reset all reading stats?')) return; chrome.runtime.sendMessage({ action: 'resetStats' }, () => { safeLog('resetStats requested'); loadStats(); setReadingStatus('Not Reading'); toast('Stats reset.', 'success'); }); });

function renderSavedList() {
  try {
    const container = document.getElementById('savedList');
    if (!container) return;
    container.innerHTML = '';

    chrome.storage.local.get(['savedReads'], (res) => {
      const arr = (res && Array.isArray(res.savedReads)) ? res.savedReads : [];
      if (!arr.length) {
        container.innerHTML = '<div class="saved-empty">No saved selections</div>';
        return;
      }

      for (const it of arr.slice().reverse()) {
        const row = document.createElement('div');
        row.className = 'saved-item';
        row.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
        row.style.padding = '8px';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'flex-start';

        const left = document.createElement('div');
        left.style.flex = '1';
        const title = document.createElement('div');
        title.textContent = it.title || (it.text || '').slice(0, 80);
        title.style.fontWeight = '600';
        const preview = document.createElement('div');
        preview.textContent = (it.text || '').slice(0, 220);
        preview.style.fontSize = '12px';
        preview.style.marginTop = '6px';
        left.appendChild(title);
        left.appendChild(preview);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.flexDirection = 'column';
        actions.style.gap = '6px';

        const sumBtn = document.createElement('button');
        sumBtn.textContent = 'Summarize';
        sumBtn.className = 'btn btn-secondary';
        sumBtn.addEventListener('click', async () => {
          sumBtn.disabled = true;
          try {
            const pref = await readSummaryPref();
            const plannedK = computeFinalKForPref(it.text || '', pref);
            const prog = createProgressToast('Generating summary — please wait...', 60000);
            let out = '(no summary)';
            try { out = summarizeTextLocal(it.text || '', plannedK, pref) || out; } finally { clearProgressToast(); }
            createSummaryModal(`Saved Summary — ${((out||'').split(/(?<=[.?!])\s+/).filter(Boolean)||[]).length} sentences`, out);
          } catch (e) { safeLog('saved item summarize failed', e); toast('Failed to summarize', 'error'); }
          sumBtn.disabled = false;
        });

        const playBtn = document.createElement('button');
        playBtn.textContent = 'Read';
        playBtn.className = 'btn btn-secondary';
        playBtn.addEventListener('click', () => {
          try {
            const tab = null;
            chrome.runtime.sendMessage({ action: 'readAloud', _savedText: it.text }, (resp) => {
              if (chrome.runtime.lastError) safeLog('readAloud message lastError', chrome.runtime.lastError);
            });
          } catch (e) { safeLog('play saved read failed', e); }
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'btn btn-link';
        delBtn.addEventListener('click', () => {
          chrome.storage.local.get(['savedReads'], (r) => {
            let arr2 = r.savedReads || [];
            arr2 = arr2.filter(x => x.id !== it.id);
            chrome.storage.local.set({ savedReads: arr2 }, () => { toast('Saved item deleted', 'info'); renderSavedList(); });
          });
        });

        actions.appendChild(sumBtn);
        actions.appendChild(playBtn);
        actions.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(actions);
        container.appendChild(row);
      }
    });
  } catch (e) { safeLog('renderSavedList error', e); }
}

try { renderSavedList(); } catch (e) { safeLog('initial renderSavedList failed', e); }

  safeOn(saveSelectionBtn, 'click', async () => {
    safeLog('saveSelectionBtn clicked');
    if (!saveSelectionBtn) return;
    saveSelectionBtn.disabled = true;
    try {
      const resRaw = await sendMessageToActiveTabWithInject({ action: 'getSelection' });
      safeLog('getSelection via helper', resRaw);

      const res = normalizeBgResponse(resRaw);
      if (res && res.ok === false) {
        if (res.error === 'no-host-permission') {
          toast('ClarityRead lacks permission to access this site. Open the page and allow access.', 'error', 7000);
          saveSelectionBtn.disabled = false;
          return;
        }
      }

      const selection = extractSelection(resRaw);
      safeLog('selection from helper', selection && { textLen: selection.text && selection.text.length, title: selection.title });

      if (selection && selection.text && selection.text.trim()) {
        const item = { id: Date.now() + '-' + Math.floor(Math.random()*1000), text: selection.text, title: selection.title || selection.text.slice(0,80), url: selection.url, ts: Date.now() };
        chrome.storage.local.get(['savedReads'], (r) => {
          const arr = r.savedReads || [];
          arr.push(item);
          chrome.storage.local.set({ savedReads: arr }, () => {
            toast('Selection saved.', 'success');
            safeLog('selection saved', item.id);
            renderSavedList();
            saveSelectionBtn.disabled = false;
          });
        });
        return;
      }

      const tab = await findBestWebTab();
      safeLog('saveSelection fallback tab', tab && { id: tab.id, url: tab.url });
      if (!tab || !tab.id) {
        toast('No active page found.', 'error');
        safeLog('saveSelection fallback: no web tab');
        saveSelectionBtn.disabled = false;
        return;
      }

      try {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const s = window.getSelection();
            const text = s ? s.toString() : '';
            return { text: text, title: document.title || '', url: location.href || '' };
          }
        }, (results) => {
          saveSelectionBtn.disabled = false;
          if (chrome.runtime.lastError) {
            safeLog('scripting.executeScript failed', chrome.runtime.lastError);
            const msg = (chrome.runtime.lastError.message || '').toLowerCase();
            if (msg.includes('must request permission') || msg.includes('cannot access contents of the page')) {
              toast('Extension lacks permission to access this site. Open the page and allow access.', 'error', 7000);
            } else {
              toast('Failed to fetch selection (see console).', 'error');
            }
            return;
          }
          const result = results && results[0] && results[0].result;
          if (!result || !result.text || !result.text.trim()) {
            toast('No selection found on the page.', 'info');
            safeLog('scripting returned no selection');
            return;
          }
          const item = { id: Date.now() + '-' + Math.floor(Math.random()*1000), text: result.text, title: result.title || result.text.slice(0,80), url: result.url, ts: Date.now() };
          chrome.storage.local.get(['savedReads'], (r) => {
            const arr = r.savedReads || [];
            arr.push(item);
            chrome.storage.local.set({ savedReads: arr }, () => {
              toast('Selection saved.', 'success');
              safeLog('selection saved via scripting', item.id);
              renderSavedList();
            });
          });
        });
      } catch (err) {
        safeLog('save selection scripting failed', err);
        toast('Failed to fetch selection (see console).', 'error');
        saveSelectionBtn.disabled = false;
      }
    } catch (e) {
      safeLog('saveSelection exception', e);
      toast('Failed to save selection (see console).', 'error');
      saveSelectionBtn.disabled = false;
    }
  });

  async function generateStatsImageAndDownload() {
    safeLog('generateStatsImageAndDownload start');
    try {
      const res = await new Promise(resolve => chrome.storage.local.get(['stats'], resolve));
      const stats = (res && res.stats) || { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
      safeLog('generateStats got stats', stats);
      const w = 800, h = 420; const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111'; ctx.font = '20px Inter, Arial, sans-serif'; ctx.fillText('ClarityRead — Reading Stats', 20, 36);
      ctx.font = '16px Inter, Arial, sans-serif'; ctx.fillStyle = '#333'; ctx.fillText(`Pages read: ${stats.totalPagesRead}`, 20, 80);
      ctx.fillText(`Total time: ${formatTime(stats.totalTimeReadSec)}`, 20, 108);
      const avg = stats.sessions > 0 ? (stats.totalTimeReadSec / stats.sessions) : 0; ctx.fillText(`Avg session: ${formatTime(avg)}`, 20, 136);
      const series = (stats.daily || []).slice(-7); const labels = (series.length ? series.map(d => d.date) : lastNDates(7));
      const data = (series.length ? series.map(d => d.pages || 0) : lastNDates(7).map(() => 0));
      const chartX = 20, chartY = 180, chartW = 760, chartH = 200; ctx.strokeStyle = '#ddd'; ctx.strokeRect(chartX, chartY, chartW, chartH);
      const maxVal = Math.max(1, ...(data || [0])); const barW = Math.floor(chartW / Math.max(1, labels.length)) - 8;
      for (let i = 0; i < labels.length; i++) {
        const val = data[i] || 0; const bw = barW; const bx = chartX + i * (bw + 8) + 12; const bh = Math.round((val / maxVal) * (chartH - 30));
        ctx.fillStyle = '#4caf50'; ctx.fillRect(bx, chartY + chartH - bh - 10, bw, bh);
        ctx.fillStyle = '#666'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.fillText(labels[i].slice(5), bx, chartY + chartH + 16);
      }
      c.toBlob(async (blob) => {
        if (!blob) { toast('Failed to generate image.', 'error'); safeLog('canvas toBlob returned null'); return; }
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadStats.png'; a.click(); URL.revokeObjectURL(url);
        safeLog('stats image generated and downloaded');
        if (navigator.clipboard && window.ClipboardItem) {
          try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); toast('Image saved and copied to clipboard!', 'success'); safeLog('image copied to clipboard'); }
          catch (e) { safeLog('clipboard write failed', e); toast('Image downloaded. Clipboard copy not available.', 'info'); }
        } else { toast('Image downloaded. To copy to clipboard, allow clipboard access or use the downloaded file.', 'info'); }
      });
    } catch (e) { safeLog('generateStatsImage failed', e); toast('Failed to generate stats image (see console).', 'error'); }
  }

  safeOn(shareStatsBtn, 'click', generateStatsImageAndDownload);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  safeLog('chrome.runtime.onMessage received', msg, sender && sender.tab && { tabId: sender.tab.id, url: sender.tab.url });

  if (msg && msg.action === 'command' && msg.command) {
    try {
      safeLog('popup received command', msg.command);
      if (msg.command === 'read-aloud') {
        if (readBtn && !readBtn.disabled) { readBtn.click(); sendResponse({ ok: true }); return true; }
        sendResponse({ ok: false, error: 'read-btn-unavailable' }); return true;
      } else if (msg.command === 'stop-reading') {
        if (stopBtn && !stopBtn.disabled) { stopBtn.click(); sendResponse({ ok: true }); return true; }
        sendResponse({ ok: false, error: 'stop-btn-unavailable' }); return true;
      }
    } catch (e) {
      safeLog('popup command handler threw', e);
      sendResponse({ ok: false, error: String(e) });
      return true;
    }
  }

  if (!msg?.action) { sendResponse({ ok: false }); return true; }
  if (msg.action === 'statsUpdated') { safeLog('msg statsUpdated -> loadStats'); loadStats(); }
  else if (msg.action === 'readingStopped') { safeLog('msg readingStopped'); setReadingStatus('Not Reading'); toast('Reading stopped.', 'info'); }
  else if (msg.action === 'readingPaused') { safeLog('msg readingPaused'); setReadingStatus('Paused'); toast('Reading paused.', 'info'); }
  else if (msg.action === 'readingResumed') { safeLog('msg readingResumed'); setReadingStatus('Reading...'); toast('Reading started.', 'info'); }
  sendResponse({ ok: true });
  return true;
});

  window.addEventListener('keydown', (e) => {
    try {
      const activeTag = document.activeElement && document.activeElement.tagName && document.activeElement.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) return;

      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (readBtn && !readBtn.disabled) readBtn.click();
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (stopBtn && !stopBtn.disabled) stopBtn.click();
      }
    } catch (err) {}
  });

  safeLog('popup init: loadStats, initPerSiteUI, renderSavedList');
  loadStats();
  initPerSiteUI();
  wireSummaryDetailSelect();
  renderSavedList();
  setTimeout(() => { safeLog('delayed loadVoicesIntoSelect'); loadVoicesIntoSelect(); }, 300);
});