// src/popup.js - production-ready edits
// Merged & finalized from user's chunks. Features: DEBUG flag, toast improvements, keyboard shortcuts,
// import/export dedupe+apply, focus label preserved, theme persistence, single-instance export/import buttons.

document.addEventListener('DOMContentLoaded', () => {
  // ---------- CONFIG ----------
  const DEBUG = false; // set true for development, false for production
  const $ = id => document.getElementById(id) || null;
  const safeLog = (...a) => { try { if (DEBUG) console.log('[ClarityRead popup]', ...a); } catch(e){} };
  // wire summaryDetailSelect -> chrome.storage.local
// wire summaryDetailSelect -> chrome.storage.local (call this inside DOMContentLoaded)
function wireSummaryDetailSelect() {
  const sel = document.getElementById('summaryDetailSelect');
  if (!sel) return;
  // load pref
  chrome.storage.local.get(['summaryDetail'], (res) => {
    try { sel.value = (res && res.summaryDetail) || 'normal'; } catch(e) {}
  });
  // save on change
  sel.addEventListener('change', () => {
    try {
      const v = sel.value || 'normal';
      chrome.storage.local.set({ summaryDetail: v }, () => { toast(`Summary detail: ${v}`, 'info', 1200); });
    } catch (e) { safeLog('saving summaryDetail failed', e); }
  });
}


  // ensure popup can receive keyboard events immediately
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

 const IDF_FILENAME = 'idf.json'; // place idf.json in your extension's root/public so chrome.runtime.getURL finds it

 let chart = null;

  let chartResizeObserver = null;
  // -------------------------------------------------------------------------------


  // ---------- Toast: deduped + queued, non-spammy ----------
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

 // ---------- Toast manager: deterministic, clearable ----------
// Replace older toast functions with this manager.
// Keeps backward compatibility for calls like toast(msg, type, ttl)
// and also provides progressToast = toasts.showProgress(...)

const Toasts = (function() {
  const containerId = 'clarityread-toast-container';
  const recent = new Map(); // msg -> timestamp (dedupe)
  const instances = new Map(); // id -> element
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
  // Promise wrapper around chrome.storage.local.get/set for small prefs
function getFromStorage(keys) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(keys, (res) => resolve(res || {})); }
    catch (e) { resolve({}); }
  });
}
function setToStorage(obj) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set(obj, () => resolve()); }
    catch (e) { resolve(); }
  });
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

  // Promise wrapper around chrome.storage.local.get/set for small prefs
function getFromStorage(keys) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(keys, (res) => resolve(res || {})); }
    catch (e) { resolve({}); }
  });
}
function setToStorage(obj) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set(obj, () => resolve()); }
    catch (e) { resolve(); }
  });
}


  function show(msg, type = 'info', ttl = 3500) {
    try {
      // dedupe identical messages within 1500ms
      const now = Date.now();
      const last = recent.get(msg) || 0;
      if (now - last < 1500) return null;
      recent.set(msg, now);
      // cleanup
      for (const [k, ts] of recent) if (now - ts > 10000) recent.delete(k);

      const c = ensureContainer();
      const el = makeEl(msg, type);
      const id = `toast-${nextId++}`;
      el.setAttribute('data-clarity-id', id);
      c.appendChild(el);
      instances.set(id, el);

      if (ttl > 0) {
        // fade then remove
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

  // progress helper (returns id). Caller must call clear(id).
  function showProgress(msg = 'Working...', timeoutMs = 60000) {
    return show(msg, 'info', timeoutMs);
  }

  return { show, clear, clearAll, showProgress };
})();

// Back-compat shim so existing code `toast(msg,type,ttl)` keeps working
function toast(msg, type = 'info', ttl = 3500) {
  // If ttl === 0, create a non-autoclearing toast and return its id
  if (ttl === 0) return Toasts.show(msg, type, ttl);
  else Toasts.show(msg, type, ttl);
}
function clearToastsLocal() { Toasts.clearAll(); }

  // ---------- Ensure Chart.js loaded if popup opened as standalone window ----------
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

  // ---------- Quick element presence check ----------
  const requiredIds = ['dyslexicToggle','reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];
  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
  safeLog('Popup element presence:', elPresence);

  ensureChartReady(() => { try { if (typeof loadStats === 'function') loadStats(); } catch (e) { safeLog('ensureChartReady callback loadStats threw', e); } });

  // ---------- Elements ----------
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
  // Note: some HTML variants use fontSizeSlider/id fontSizeValue or fontSizeSlider id different. try both.
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
// CONFIG

// ---------------- Toast cleanup helper ---------------


  // dynamic focusMode + summarize presence
  let focusModeBtn = $('focusModeBtn');
  if (!focusModeBtn && document.querySelector('.themeRow')) {
    // create button with the same internal structure as your HTML (action-icon + action-text)
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
    // ensure it has the inner text node we expect
    if (!focusModeBtn.querySelector('.action-text')) {
      const maybeText = document.createElement('span'); maybeText.className = 'action-text'; maybeText.textContent = focusModeBtn.textContent || 'Focus Mode';
      focusModeBtn.innerHTML = ''; // clear and rebuild to standard structure
      const ico = document.createElement('span'); ico.className = 'action-icon'; ico.textContent = '🎯';
      focusModeBtn.appendChild(ico); focusModeBtn.appendChild(maybeText);
    }
  }

  let summarizePageBtn = $('summarizePageBtn');
  if (!summarizePageBtn && document.querySelector('.themeRow')) {
    summarizePageBtn = document.createElement('button');
    summarizePageBtn.id = 'summarizePageBtn';
    summarizePageBtn.className = 'action-btn';
    const ico = document.createElement('span'); ico.className = 'action-icon'; ico.textContent = '📝';
    const txt = document.createElement('span'); txt.className = 'action-text'; txt.textContent = 'Summarize';
    summarizePageBtn.appendChild(ico); summarizePageBtn.appendChild(txt);
    summarizePageBtn.style.marginRight = '8px';
    document.querySelector('.themeRow').insertBefore(summarizePageBtn, focusModeBtn || themeToggleBtn || null);
    safeLog('added dynamic summarizePageBtn');
  }

  // hide redundant "Manage" saved button to reduce UI clutter (you can remove it from HTML later)
  if (openSavedManagerBtn) {
    try { openSavedManagerBtn.style.display = 'none'; safeLog('hidden openSavedManagerBtn (Manage)'); } catch(e) {}
  }

  // preserve the original focus button text (only the action-text, not icon)
  const _focusModeOriginalText = (focusModeBtn && focusModeBtn.querySelector('.action-text')) ? focusModeBtn.querySelector('.action-text').textContent : 'Focus Mode';

  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20 };
  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let settingsDebounce = null;
  let opLock = false;            // prevent concurrent sends
  let lastStatus = null;         // dedupe repeated identical status updates

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

    // If the wrapper is { ok: true, response: X } or { ok: true, data: X } or { status, data }
    let obj = raw;

    // Unwrap repeatedly while there's a known wrapper key to avoid shallow unwrap issues
    const unwrapOnce = (o) => {
      if (!o || typeof o !== 'object') return o;
      if (Array.isArray(o) && o.length) return o[0];              // array -> first element (likely injection result)
      if ((o.ok === true || o.ok === false) && (o.response || o.data)) return (o.response || o.data);
      if (o.response && (typeof o.response === 'object')) return o.response;
      if (o.data && (typeof o.data === 'object')) return o.data;
      if (o.result && (typeof o.result === 'object')) return o.result;
      return o;
    };

    // Keep unwrapping until stable or up to N times
    let prev = null;
    for (let i = 0; i < 6; i++) {
      const next = unwrapOnce(obj);
      if (next === obj || next == null) break;
      prev = obj;
      obj = next;
    }

    // If it's still an array (executeScript typical shape), prefer first element's result/fields
    if (Array.isArray(obj) && obj.length) {
      const r0 = obj[0];
      if (r0 && typeof r0 === 'object' && 'result' in r0) obj = r0.result;
      else if (r0 && typeof r0 === 'object') obj = r0;
    }

    // Now try to locate text/title in common places
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

    // If we still don't have text, try stringifying the object (safe small fallback)
    let finalText = (typeof text === 'string' ? text : '').trim();
    if (!finalText) {
      // Sometimes the object *is* a direct string (rare), or contains nested text fields
      if (typeof obj === 'string' && obj.trim()) finalText = obj.trim();
      else {
        // inspect nested known fields inside a 'result' property if present
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



  // Robust send helper - popup -> background forward wrapper
  async function sendMessageToActiveTabWithInject(message, _retry = 0) {
    if (opLock) {
      safeLog('sendMessageToActiveTabWithInject blocked: opLock active');
      return { ok: false, error: 'in-flight' };
    }
    opLock = true;
    try {
      return await new Promise((resolve) => {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
          const tab = tabs && tabs[0];
          if (tab && tab.url && tab.url.startsWith('chrome-extension://')) {
            safeLog('Popup helper: active tab is extension page — looking for best web tab');
            try {
              const webTab = await findBestWebTab();
              if (webTab) {
                message._targetTabId = webTab.id;
                message._targetTabUrl = webTab.url;
                safeLog('Popup helper: selected best web tab', webTab.id, webTab.url);
              } else {
                delete message._targetTabId;
                delete message._targetTabUrl;
              }
            } catch (e) { safeLog('Popup helper: findBestWebTab error', e); delete message._targetTabId; delete message._targetTabUrl; }
          } else if (tab && tab.id && tab.url && isWebUrl(tab.url)) {
            message._targetTabId = tab.id;
            message._targetTabUrl = tab.url;
          } else if (tab && tab.id && tab.url && !isWebUrl(tab.url)) {
            safeLog('Popup helper: active tab is internal page, trying to find best web tab');
            try {
              const webTab = await findBestWebTab();
              if (webTab) {
                message._targetTabId = webTab.id;
                message._targetTabUrl = webTab.url;
                safeLog('Popup helper: selected best web tab', webTab.id, webTab.url);
              } else {
                delete message._targetTabId;
                delete message._targetTabUrl;
              }
            } catch (e) { delete message._targetTabId; delete message._targetTabUrl; }
          }

          try {
            chrome.runtime.sendMessage(message, async (resRaw) => {
              if (chrome.runtime.lastError) {
                safeLog('popup > background send error:', chrome.runtime.lastError && chrome.runtime.lastError.message);
                opLock = false;
                return resolve({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
              }
              if (!resRaw) { opLock = false; return resolve({ ok: false, error: 'no-response' }); }

              const res = normalizeBgResponse(resRaw);

              // background requests host permission -> prompt user once
              if (res && res.ok === false && res.error === 'no-host-permission' && _retry < 1) {
                const pattern = res.permissionPattern || (message._targetTabUrl ? buildOriginPermissionPattern(message._targetTabUrl) : null);
                const friendlyHost = pattern ? (pattern.replace('/*','')) : (message._targetTabUrl || 'this site');
                try {
                  const want = confirm(`ClarityRead needs permission to access ${friendlyHost} to operate on that page. Grant access for this site?`);
                  if (!want) { opLock = false; return resolve(res); }
                  chrome.permissions.request({ origins: [pattern] }, (granted) => {
                    if (chrome.runtime.lastError) {
                      safeLog('permissions.request error', chrome.runtime.lastError);
                      opLock = false;
                      return resolve({ ok: false, error: 'permission-request-failed', detail: chrome.runtime.lastError.message });
                    }
                    if (!granted) { opLock = false; return resolve({ ok: false, error: 'permission-denied' }); }
                    setTimeout(() => {
                      sendMessageToActiveTabWithInject(message, _retry + 1).then(r => { opLock = false; resolve(r); }).catch((e) => { opLock = false; resolve({ ok: false, error: String(e) }); });
                    }, 250);
                  });
                } catch (e) { safeLog('permission flow threw', e); opLock = false; return resolve({ ok: false, error: 'permission-flow-exception', detail: String(e) }); }
                return;
              }

              opLock = false;
              return resolve(res);
            });
          } catch (ex) { safeLog('popup send wrapper threw', ex); opLock = false; return resolve({ ok: false, error: String(ex) }); }
        });
      });
    } finally { opLock = false; }
  }

  // ---------- Stats / chart ----------
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

  // ---------- Voices ----------
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

  // ---------- Theme handling (single, persistent) ----------
  function applyThemeFromStorage() {
    chrome.storage.local.get(['darkTheme'], (res) => {
      const isDark = !!(res && res.darkTheme);
      if (isDark) document.body.classList.add('dark-theme');
      else document.body.classList.remove('dark-theme');
      // update icon if present
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
    // update icon
    try {
      const ico = themeToggleBtn.querySelector('.theme-icon') || themeToggleBtn;
      if (ico) ico.textContent = isDark ? '☀️' : '🌙';
    } catch (e) {}
    chrome.storage.local.set({ darkTheme: isDark }, () => { toast(isDark ? 'Dark theme on' : 'Dark theme off', 'info'); });
  });

  // ---------- Per-site UI init ----------
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

  // ---------- UI helpers ----------
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

  // send settings (single applySettings message)
  // Default behavior: do not show toast to avoid spamming during slider changes.
  // Optionally pass { showToast: true } to show a success toast.
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
        return res;
      })
      .catch(err => { safeLog('applySettings err', err); if (options.showToast) toast('Failed to apply settings (see console).', 'error'); return { ok:false, error: String(err) }; });
  }

  // gather settings and save to sync/local; by default do not show toast (to avoid slider spam)
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

  // ---------- Events hookup ----------
  safeOn(dysToggle, 'change', () => gatherAndSendSettings({ showToast: false }));
  safeOn(reflowToggle, 'change', () => { if (sizeOptions) sizeOptions.hidden = !reflowToggle.checked; gatherAndSendSettings({ showToast: false }); });
  safeOn(contrastToggle, 'change', () => { if (contrastToggle?.checked && invertToggle) invertToggle.checked = false; gatherAndSendSettings({ showToast: false }); });
  safeOn(invertToggle, 'change', () => { if (invertToggle?.checked && contrastToggle) contrastToggle.checked = false; gatherAndSendSettings({ showToast: false }); });
  // slider uses input -> don't show toast on each input event (silent)
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

  // ensure voices loaded
  function ensureVoicesLoaded(timeoutMs = 500) {
    const voices = speechSynthesis.getVoices() || [];
    if (voices.length) { safeLog('ensureVoicesLoaded already have voices', voices.length); return Promise.resolve(voices); }
    return new Promise(resolve => {
      let called = false;
      const onChange = () => {
        if (called) return;
        called = true;
        speechSynthesis.removeEventListener('voiceschanged', onChange);
        safeLog('voiceschanged event fired');
        resolve(speechSynthesis.getVoices() || []);
      };
      speechSynthesis.addEventListener('voiceschanged', onChange);
      setTimeout(() => {
        if (!called) {
          called = true;
          speechSynthesis.removeEventListener('voiceschanged', onChange);
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

  // Read button
  safeOn(readBtn, 'click', () => {
    safeLog('readBtn clicked', { isReading, isPaused });
    if (isReading) { toast('Already reading. Pause or stop before starting a new read.', 'info'); return; }
    const settings = gatherSettingsObject();
    chrome.storage.sync.set({ voice: settings.voice, rate: settings.rate, pitch: settings.pitch, highlight: settings.highlight }, async () => {
      const voices = await ensureVoicesLoaded(500);
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

  // Stop
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

  // Pause / Resume
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

  // Focus mode toggle — preserve original label (emoji) by only mutating .action-text
  safeOn(focusModeBtn, 'click', async () => {
    safeLog('focusModeBtn clicked');
    focusModeBtn.disabled = true;
    const res = await sendMessageToActiveTabWithInject({ action: 'toggleFocusMode' });
    focusModeBtn.disabled = false;
    safeLog('toggleFocusMode response', res);
    const r = normalizeBgResponse(res);
    const textEl = focusModeBtn ? focusModeBtn.querySelector('.action-text') : null;
    if (!r || !r.ok) {
      if (r && r.error === 'no-host-permission') toast('Permission required to show focus mode for this site.', 'error', 6000);
      else if (r && r.error === 'tab-discarded') toast('The target tab is suspended. Reload the page and try again.', 'error', 5000);
      else toast('Failed to toggle focus mode.', 'error', 4500);
    } else {
      // only change the text portion so emoji/icon stays intact
      if (textEl) {
        textEl.textContent = (r.overlayActive ? `Close ${_focusModeOriginalText}` : _focusModeOriginalText);
      } else {
        // fallback: replace textContent of whole button but keep simple string
        focusModeBtn.textContent = (r.overlayActive ? `Close ${_focusModeOriginalText}` : _focusModeOriginalText);
      }
      toast(r.overlayActive ? 'Focus mode opened.' : 'Focus mode closed.', 'success', 1400);
      safeLog('focusModeBtn UI updated', focusModeBtn.textContent);
    }
  });
// ------------------ Local-only summarizer integration (replace server / AI paths) ------------------
// Drop-in replacement: removes all remote calls and uses an in-extension summarizer.
// It will try to load an optional idf.json from the extension public folder to improve scoring.



// IDF map (optional)
let IDF_MAP = Object.create(null);

// Try to load idf.json shipped with the extension (non-blocking)
(async function loadIdfFromExtension() {
  try {
    // runtime.getURL will resolve extension relative path
    const url = chrome && chrome.runtime ? chrome.runtime.getURL(IDF_FILENAME) : IDF_FILENAME;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.info('No idf.json found in extension bundle (ok if intentional).');
      IDF_MAP = Object.create(null);
      return;
    }
    const parsed = await resp.json();
    const m = Object.create(null);
    for (const k of Object.keys(parsed || {})) m[k.toLowerCase()] = Number(parsed[k]) || 0;
    IDF_MAP = m;
    safeLog('Loaded idf.json into popup', { entries: Object.keys(IDF_MAP).length });
  } catch (e) {
    safeLog('loadIdfFromExtension failed (continuing without idf)', e && (e.stack || e));
    IDF_MAP = Object.create(null);
  }
})();

// Small utilities (kept minimal and robust)
function cleanTextLocal(input) {
  if (!input) return '';
  let t = input.replace(/\[\d+\]/g, ' ')
               .replace(/\(\d+\)/g, ' ')
               .replace(/\s+/g, ' ')
               .replace(/ {2,}/g, ' ')
               .trim();
  t = t.replace(/\b(References|External links|See also|Further reading)\b[\s\S]*$/i, '');
  return t;
}
function splitIntoSentencesLocal(text) {
  if (!text) return [];
  const s = text.replace(/\n+/g, ' ');
  const raw = s.split(/(?<=[.?!])\s+(?=[A-Z0-9"'“”‘’])/g).map(x => x.trim()).filter(Boolean);
  if (raw.length <= 1) return s.split(/(?<=[.?!])/g).map(x => x.trim()).filter(Boolean);
  return raw;
}
function splitIntoParagraphsLocal(text) {
  if (!text) return [];
  const parts = text.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}
const STOPWORDS_LOCAL = new Set(['the','is','in','and','a','an','to','of','that','it','on','for','with','as','was','were','this','by','are','or','be','from','at','which','but','not','have','has','had','they','you','i','their','its','we','our','us','will','can','may','also']);
function tokenizeLocal(sentence) {
  if (!sentence) return [];
  return (sentence.toLowerCase().match(/\b[^\d\W]+\b/g) || []).filter(w => !STOPWORDS_LOCAL.has(w));
}
function buildTermFrequenciesLocal(text) {
  const words = (text || '').toLowerCase().match(/\b[^\d\W]+\b/g) || [];
  const tf = Object.create(null);
  for (const w of words) {
    if (STOPWORDS_LOCAL.has(w)) continue;
    tf[w] = (tf[w] || 0) + 1;
  }
  return tf;
}
function sentenceSimilarityLocal(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(tokenizeLocal(a));
  const tb = new Set(tokenizeLocal(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const uni = new Set([...ta, ...tb]).size || 1;
  return inter / uni;
}

// MMR selection helper (diverse + relevant)
// ---------- Improved summarizer and helpers (drop-in replace) ----------

/** Helper: decide number of sentences based on content length + user preference.
 *  userPref: 'concise'|'normal'|'detailed' (default 'normal')
 */
/** Helper: decide number of sentences based on content length + user preference.
 *  userPref: 'concise'|'normal'|'detailed' (default 'normal')
 */
function getAdaptiveMaxSentences(text, userPref = 'normal') {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  // baseline: roughly 1 sentence per 90-240 words depending on preference
  let ratio = 140; // normal
  if (userPref === 'concise') ratio = 240;
  else if (userPref === 'detailed') ratio = 90;
  // compute and clamp
  const est = Math.max(1, Math.round(words / ratio));
  // raise cap for very long documents
  const cap = 20;
  return Math.min(cap, Math.max(1, est));
}

/** Small content cleaner to drop nav/TOC junk, scripts, styles, and obvious boilerplate.
 *  Called early to improve scoring.
 */
function scrubInputForSummarizer(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw;
  // strip common wiki / nav markers and style/script blocks
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/\[[^\]]{1,80}\]/g, ' '); // bracketed refs like [1], [citation needed]
  t = t.replace(/\{[\s\S]*?\}/g, ' '); // template-like curly blobs
  t = t.replace(/(References|External links|See also|Further reading|Navigation|Contents|Categories|vte)\b[\s\S]*/ig, ' ');
  // remove long runs of non-text (like CSS fragments that leaked)
  t = t.replace(/\.mw-parser-output[\s\S]{0,8000}\}/gi, ' ');
  // remove any remaining HTML tags
  t = t.replace(/<\/?[^>]+>/g, ' ');
  // collapse whitespace
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

// Slightly stricter tokenization that drops tokens with numbers-only, but keeps named entities
function tokenizeForScoring(sentence) {
  if (!sentence) return [];
  return (sentence.toLowerCase().match(/\b[^\d\W]+\b/g) || []).filter(w => !STOPWORDS_LOCAL.has(w) && w.length > 1);
}

/** Improved sentence score:
 * - stronger IDF influence when IDF present
 * - title overlap more influential
 * - penalize TOC-like or punctuation heavy lines (but not too aggressively)
 */
function sentenceScoreLocal(sentence, tfGlobal, positionWeight = 1, titleTokens = new Set()) {
  const tokens = tokenizeForScoring(sentence);
  if (!tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    const tf = tfGlobal[t] || 0;
    // prefer IDF if available; fallback to 1
    const idf = (IDF_MAP && typeof IDF_MAP[t] !== 'undefined') ? IDF_MAP[t] : 1;
    // amplify idf slightly to favor rarer terms
    score += tf * (1 + 0.7 * idf);
  }

  // normalize by length
  score = score / Math.sqrt(Math.max(1, tokens.length));

  // title overlap (bump)
  let titleOverlap = 0;
  for (const t of tokens) if (titleTokens.has(t)) titleOverlap++;
  score += titleOverlap * 1.2;

  // heuristics
  if (/\b(18|19|20)\d{2}\b/.test(sentence)) score *= 1.08;
  if (/[€$\£¥¢%]/.test(sentence)) score *= 1.06;
  if (/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(sentence)) score *= 1.05; // named entity bump

  // penalty: headings/TOC-like (short uppercase lines, lots of punctuation or many commas)
  const nonAlphaRatio = (sentence.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, sentence.length);
  if (nonAlphaRatio > 0.25) score *= 0.7;            // less aggressive than before
  if (/^[A-Z0-9\W]{5,40}$/.test(sentence) && sentence === sentence.toUpperCase()) score *= 0.6;
  if (sentence.length < 18) score *= 0.7;            // allow shorter sentences a little more

  score *= positionWeight;
  return score;
}

/** MMR: same algorithm but lambda can be slightly adaptive */
function mmrSelectLocal(candidates, scoresArr, k = 3, lambda = 0.62) {
  const selected = [];
  const used = new Set();
  const candArr = candidates.map((s, i) => ({ sentence: s, score: (scoresArr[i] && scoresArr[i].score) || 0 }));
  candArr.sort((a,b) => b.score - a.score);

  // adapt lambda slightly: if document is large prefer novelty more (smaller lambda)
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
}

/** Main summarizer: uses the above helpers and adaptive sentence count.
 *  maxSentencesArg: if number>0, will be used (but still clamped).
 *  userPref: 'concise'|'normal'|'detailed' - affects adaptive decisions and post-filtering.
 */
function summarizeTextLocal(rawText, maxSentencesArg = null, userPref = 'normal') {
  if (!rawText || typeof rawText !== 'string') return '';
  // 1) scrub TONS of junk early
  const cleaned = scrubInputForSummarizer(rawText);
  if (!cleaned) return '';

  // adaptive max sentences if not explicitly provided
  const adaptiveMax = (typeof maxSentencesArg === 'number' && maxSentencesArg > 0)
    ? Math.min(20, Math.max(1, Math.floor(maxSentencesArg)))
    : getAdaptiveMaxSentences(cleaned, userPref);

  // short text fast path
  if (cleaned.length < 220) {
    const sents = splitIntoSentencesLocal(cleaned);
    if (sents.length <= adaptiveMax) return sents.join(' ');
    const tf = buildTermFrequenciesLocal(cleaned);
    const scored = sents.map((sen, idx) => ({ sentence: sen, score: sentenceScoreLocal(sen, tf, ((idx === 0 || idx === sents.length-1) ? 1.12 : 1)) }));
    scored.sort((a,b) => b.score - a.score);
    const chosen = scored.slice(0, adaptiveMax).map(x => x.sentence);
    const ordered = sents.filter(s => chosen.includes(s));
    return (ordered.length ? ordered.join(' ') : chosen.join(' ')).trim();
  }

  // paragraphs -> candidate extraction
  const paragraphs = splitIntoParagraphsLocal(cleaned);
  const globalTF = buildTermFrequenciesLocal(cleaned);
  const firstLine = (cleaned.split('\n')[0] || '').trim();
  const titleTokens = new Set(tokenizeForScoring(firstLine).slice(0, 12));

  const paraSummaries = [];
  for (const p of paragraphs) {
    if (!p) continue;
    const sents = splitIntoSentencesLocal(p);
    if (!sents.length) continue;
    const scored = sents.map((sen, idx) => ({ sentence: sen, score: sentenceScoreLocal(sen, globalTF, (idx === 0 ? 1.08 : (idx === sents.length - 1 ? 1.03 : 1)), titleTokens) }));
    scored.sort((a,b) => b.score - a.score);

    // choose top N: for long paragraphs allow more candidates
    const longPara = p.length > 800;
    const topCount = longPara ? Math.min(3, Math.max(1, Math.ceil(scored.length * 0.33))) : Math.min(2, Math.max(1, Math.ceil(scored.length * 0.20)));
    for (let i = 0; i < Math.min(topCount, scored.length); i++) {
      const candidate = scored[i].sentence.trim();
      // relax small-sentence cutoff (allow shorter candidates)
      if (candidate && candidate.length > 18) paraSummaries.push(candidate);
    }
    // limit candidate gathering to avoid exploding memory
    if (paraSummaries.join(' ').length > Math.max(CHUNK_SIZE_CHARS || 10000, 3 * (CHUNK_SIZE_CHARS || 10000))) break;
  }

  let allCandidates = [];
  if (!paraSummaries.length) allCandidates = splitIntoSentencesLocal(cleaned);
  else {
    const combined = paraSummaries.join(' ');
    allCandidates = splitIntoSentencesLocal(combined);
    if (!allCandidates.length) allCandidates = paraSummaries.slice();
  }

  // score candidates globally
  const scoredCandidates = allCandidates.map((sen, idx) => ({ sentence: sen, score: sentenceScoreLocal(sen, globalTF, (idx === 0 || idx === allCandidates.length - 1) ? 1.05 : 1, titleTokens) }));
  scoredCandidates.sort((a,b) => b.score - a.score);

  const candidatesList = scoredCandidates.map(x => x.sentence);
  const scoresList = scoredCandidates.map(x => ({ sentence: x.sentence, score: x.score }));

  // MMR with adaptive lambda; k = adaptiveMax but clamp to available candidates
  const lambda = 0.62;
  const k = Math.max(1, Math.min(adaptiveMax, Math.max(1, candidatesList.length)));
  let selected = mmrSelectLocal(candidatesList, scoresList, k, lambda);

  // trim to adaptiveMax
  if (selected.length > adaptiveMax) selected = selected.slice(0, adaptiveMax);

  // fallback if selection fails or weird
  const joinedSel = selected.join(' ');
  if (!joinedSel || (joinedSel.length / Math.max(1, cleaned.length) > 0.95) || selected.length === 0) {
    const firstSents = splitIntoSentencesLocal(cleaned).slice(0, adaptiveMax);
    if (firstSents && firstSents.length) return firstSents.join(' ').trim();
  }

  // keep document order
  const docSents = splitIntoSentencesLocal(cleaned);
  const orderedSelected = docSents.filter(s => selected.includes(s));
  let final = (orderedSelected.length ? orderedSelected.join(' ') : selected.join(' ')).trim();

  // final post-filter to remove TOC-like fragments or repeated nav junk
  try {
    const parts = final.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
    const filtered = parts.filter(s => {
      // allow shorter sentences when user asked for detailed output
      const minLen = (userPref === 'detailed') ? 16 : 28;
      if (s.length < minLen) return false;
      if (/^(Outline|History|See also|References|External links|Category|vte|Navigation)\b/i.test(s)) return false;
      const nonAlphaRatio = (s.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, s.length);
      if (nonAlphaRatio > 0.30) return false; // slightly relaxed
      if (/^[\u2000-\u206F\u2E00-\u2E7F\W]+$/.test(s)) return false;
      return true;
    });
    if (filtered.length) final = filtered.join(' ');
  } catch (e) {}

  try {
    if (!final) return cleaned.slice(0, 800);
    const finalSents = splitIntoSentencesLocal(final);
    return finalSents.slice(0, Math.max(1, Math.min(adaptiveMax, finalSents.length))).join(' ').trim();
  } catch (e) {
    return final.slice(0, 800);
  }
}




// ---------------- Toast cleanup helper ----------------
function clearToastsLocal() {
  try {
    const selectors = ['.toast', '.toaster', '.cr-toast', '.notification', '[data-toast]'];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(n => { try { n.remove(); } catch(e){} }));
    ['#toast','#toaster','.popup-toast'].forEach(id => { const el = document.querySelector(id); if (el) el.remove(); });
    safeLog('clearToastsLocal executed');
  } catch (e) { safeLog('clearToastsLocal error', e); }
}
// Minimal createSummaryModal (used by summarizer). Put this above summarizeCurrentPageOrSelection_AiAware.
// Minimal createSummaryModal (used by summarizer) - theme-aware
function createSummaryModal(title = 'Summary', content = '') {
  try {
    const old = document.getElementById('clarityread-summary-modal');
    if (old) old.remove();

    // compute theme colors from page so modal text is readable in dark mode
    let bg = '#fff', fg = '#111', border = '#e6e6e6';
    try {
      const cs = window.getComputedStyle(document.body || document.documentElement);
      const bodyBg = cs && cs.backgroundColor ? cs.backgroundColor : '';
      const bodyColor = cs && cs.color ? cs.color : '';
      if (bodyBg) bg = bodyBg;
      if (bodyColor) fg = bodyColor;
      // pick border with some transparency of fg
      border = (typeof fg === 'string') ? fg : border;
    } catch (e) { /* ignore */ }

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

    // show sentence count / small subtitle if available in title already
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
    // focus for easy keyboard close
    modal.tabIndex = -1;
    modal.focus();

    return modal;
  } catch (e) {
    safeLog('createSummaryModal error', e);
    return null;
  }
}


// ---------------- Replacement: summarizeCurrentPageOrSelection_AiAware (local-only) ----------------
// ----------------- Summarizer helpers -----------------
function stripCssLikeFragments(raw) {
  try {
    if (!raw || typeof raw !== 'string') return raw || '';
    let t = raw;
    t = t.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
    // remove big wiki css blobs and repeated brace junk
    t = t.replace(/\.mw-parser-output[\s\S]*?\}/gi, ' ');
    t = t.replace(/[\{\}<>\[\]]{3,}/g, ' ');
    t = t.replace(/\s{2,}/g, ' ');
    return t.trim();
  } catch (e) { return raw || ''; }
}

// preference read
async function readSummaryPref() {
  try {
    return await new Promise(resolve => chrome.storage.local.get(['summaryDetail'], r => resolve((r && r.summaryDetail) || 'normal')));
  } catch (e) { return 'normal'; }
}

// adaptive sentence count (pref + length-based mild scaling)
function computeAdaptiveMax(text = '', pref = 'normal') {
  const len = (text || '').length;
  let base = 3; // normal
  if (pref === 'concise') base = 2;
  if (pref === 'detailed') base = 5;
  if (len > 2000) base += 1;
  if (len > 8000) base += 2;
  if (len > 20000) base += 2;
  const cap = 12;
  return Math.max(1, Math.min(cap, Math.round(base)));
}

// deterministic progress toast helpers (if you already have similar ones, this will be compatible)
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

// ----------------- Summarizer main function -----------------
async function summarizeCurrentPageOrSelection_AiAware() {
  safeLog('summarizeCurrentPageOrSelection_AiAware (local-only) start');
  if (!summarizePageBtn) { safeLog('summarizePageBtn missing'); return; }
  summarizePageBtn.disabled = true;

  try {
    let text = '';
    let usedSelection = false;

    // 1) pick best web tab
    const tab = await findBestWebTab();
    if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      toast('Cannot summarize internal or extension pages.', 'error');
      summarizePageBtn.disabled = false;
      return;
    }

    // 2) try stored selection (content script may have saved it recently)
    try {
      const stored = await new Promise(resolve => chrome.storage.local.get(['clarity_last_selection'], r => resolve(r && r.clarity_last_selection)));
      if (stored && stored.text && stored.ts && ((Date.now() - stored.ts) < 20000) && stored.url && stored.url.split('#')[0] === (tab.url || '').split('#')[0]) {
        const wantSelection = confirm('Summarize selected text? Click OK to summarize selection, Cancel to summarize full page.');
        if (wantSelection) { text = stored.text; usedSelection = true; }
      }
    } catch (e) { safeLog('reading stored selection failed', e); }

    // 3) try window.getSelection directly if no stored selection
    if (!text) {
      try {
        const pageSelResult = await new Promise(resolve => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                const s = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
                if ((!s || !s.trim()) && document.activeElement) {
                  const ae = document.activeElement;
                  if ((ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text')) && typeof ae.selectionStart === 'number') {
                    const start = ae.selectionStart, end = ae.selectionEnd;
                    if (end > start) return ae.value.slice(start, end);
                  }
                }
                return s || '';
              } catch (e) { return ''; }
            }
          }, (res) => resolve(res));
        });

        let selText = '';
        if (Array.isArray(pageSelResult) && pageSelResult.length && pageSelResult[0]) {
          const r0 = pageSelResult[0];
          if (typeof r0.result === 'string') selText = r0.result;
          else if (r0 && r0.result && typeof r0.result.text === 'string') selText = r0.result.text;
        } else if (typeof pageSelResult === 'string') selText = pageSelResult;
        else if (pageSelResult && typeof pageSelResult.result === 'string') selText = pageSelResult.result;

        if (selText && selText.trim()) {
          const wantSelection = confirm('Summarize selected text? Click OK to summarize selection, Cancel to summarize full page.');
          if (wantSelection) { text = selText.trim(); usedSelection = true; }
        }
      } catch (e) { safeLog('page selection execScript failed', e); }
    }

    // 4) if still nothing, extract main page content
    if (!text) {
      try {
        const execResult = await new Promise(resolve => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              function removeNodes(selectors = []) {
                try { selectors.forEach(s => document.querySelectorAll(s).forEach(n => { try { n.remove(); } catch(e){} })); } catch(e) {}
              }
              try {
                removeNodes(['header','footer','nav','aside','.navbox','.vertical-navbox','.toc','#toc','.infobox','.sidebar','.mw-jump-link','.mw-references-wrap','.reference','.references','.reflist','.mw-editsection','.hatnote']);
                const prefer = ['article','main','[role="main"]','#content','#primary','.post','.article','#mw-content-text','.mw-parser-output'];
                for (const sel of prefer) {
                  const el = document.querySelector(sel);
                  if (el && el.innerText && el.innerText.length > 200) {
                    const clone = el.cloneNode(true);
                    clone.querySelectorAll('img, svg, picture, table, .toc, .infobox, aside, nav, footer, header, style, script').forEach(n => n.remove());
                    return { text: clone.innerText || '', title: document.title || '' };
                  }
                }
                if (document.body && document.body.innerText && document.body.innerText.length > 200) {
                  const b = document.body.cloneNode(true);
                  b.querySelectorAll('script, style, img, svg, picture, table, aside, nav, header, footer').forEach(n => n.remove());
                  return { text: b.innerText || '', title: document.title || '' };
                }
                return { text: '', title: document.title || '' };
              } catch (e) { return { text: '', title: document.title || '' }; }
            }
          }, (res) => resolve(res));
        });

        let pageText = '';
        if (Array.isArray(execResult) && execResult.length && execResult[0]) {
          const r0 = execResult[0];
          if (r0 && r0.result && typeof r0.result.text === 'string') pageText = r0.result.text;
          else if (r0 && typeof r0.result === 'string') pageText = r0.result;
        } else if (execResult && execResult.result && execResult.result.text) {
          pageText = execResult.result.text;
        } else if (execResult && typeof execResult.text === 'string') {
          pageText = execResult.text;
        } else if (typeof execResult === 'string') {
          pageText = execResult;
        }

        text = stripCssLikeFragments(String(pageText || '')).trim();
      } catch (e) {
        safeLog('full page exec failed', e);
        toast('Unable to access page content. Give ClarityRead permission for this site and try again.', 'error');
        summarizePageBtn.disabled = false;
        return;
      }
    }

    // guard
    if (!text || !text.trim()) {
      toast('No text to summarize — select text on the page or ensure the page has readable content.', 'info');
      summarizePageBtn.disabled = false;
      return;
    }

    // read preference + compute sentences
    const pref = await readSummaryPref();
    const adaptiveMax = computeAdaptiveMax(text, pref);

    // run summarizer with deterministic progress toast
    const pid = createProgressToast('Generating summary — please wait...', 60000);
let summary = '(no summary produced)';
try {
  if (typeof summarizeTextLocal === 'function') summary = summarizeTextLocal(text, null, pref) || summary;
  else summary = '(summarizer not available)';
} catch (e) { safeLog('summarizer error', e); }
finally { clearProgressToast(); }


    // lightweight post-filter to remove TOC-like garbage
    try {
      const parts = summary.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
      const filtered = parts.filter(s => {
        if (s.length < 30) return false;
        if (/^(Outline|History|See also|References|External links|Category|vte)\b/i.test(s)) return false;
        const nonAlphaRatio = (s.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, s.length);
        if (nonAlphaRatio > 0.20) return false;
        return true;
      });
      if (filtered.length) summary = filtered.join(' ');
    } catch (e) { safeLog('post-filter threw', e); }

    // present modal with adaptive header
   const modeSubtitle = usedSelection ? 'Selection' : 'Full page';
// count sentences in produced summary (best-effort)
const actualSentences = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean).length || 0;
const headerTitle = `Page Summary — ${actualSentences} sentence${actualSentences === 1 ? '' : 's'} (${modeSubtitle})`;
createSummaryModal(headerTitle, summary);

    toast('Summary ready', 'success', 3000);

  } catch (err) {
    safeLog('summarize error', err && (err.stack || err));
    clearProgressToast();
    clearToastsLocal();
    toast('Failed to summarize (see console).', 'error', 6000);
    try {
      const fallback = summarizeTextLocal(window.__clarity_last_text || '', 3);
      createSummaryModal('Page Summary (Local fallback)', fallback);
    } catch (e) { safeLog('fallback also failed', e); }
  } finally {
    summarizePageBtn.disabled = false;
  }
}




// Hook up summary button: replace old handler with the local-only summarizer
try {
  let btn = $('summarizePageBtn');
  if (btn) {
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = $('summarizePageBtn');
    if (newBtn) safeOn(newBtn, 'click', summarizeCurrentPageOrSelection_AiAware);
  }
} catch (e) { safeLog('hook summarize button failed', e); }





  // ---------- Profiles and saved reads ----------
  function updateProfileDropdown(profiles = {}, selectedName = '') { if (!profileSelect) return; profileSelect.innerHTML = '<option value="">Select profile</option>'; for (const name in profiles) { const opt=document.createElement('option'); opt.value=name; opt.textContent=name; profileSelect.appendChild(opt);} if (selectedName) profileSelect.value = selectedName; }
  function saveProfile(name, profile) { chrome.storage.local.get(['profiles'], (res) => { const profiles = res.profiles || {}; profiles[name] = profile; chrome.storage.local.set({ profiles }, () => { chrome.storage.sync.set({ profiles }, () => { toast('Profile saved.', 'success'); updateProfileDropdown(profiles, name); safeLog('profile saved', name, profile); }); }); }); }
  chrome.storage.local.get(['profiles'], (res) => { safeLog('loaded profiles', Object.keys(res.profiles||{})); updateProfileDropdown(res.profiles || {}); });

  safeOn(profileSelect, 'change', (e) => { const name = e.target.value; if (!name) return; chrome.storage.local.get(['profiles'], (res) => { const settings = res.profiles?.[name]; safeLog('profile selected', name, settings); if (settings) setUI(settings); gatherAndSendSettings({ showToast: true }); }); });

  safeOn(saveProfileBtn, 'click', () => { const name = prompt('Enter profile name:'); if (!name) return; const profile = gatherSettingsObject(); saveProfile(name, profile); });

  safeOn(exportProfilesBtn, 'click', () => { chrome.storage.local.get(['profiles'], (res) => { const dataStr = JSON.stringify(res.profiles || {}); const blob = new Blob([dataStr], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadProfiles.json'; a.click(); URL.revokeObjectURL(url); toast('Profiles exported.', 'success'); safeLog('exported profiles'); }); });

// Try to find/reuse existing "Export Settings" button in DOM (avoid duplicate buttons)
let exportSettingsBtn = document.getElementById('exportSettingsBtn') || null;

// prefer to reuse it but keep its id consistent for future checks
if (!exportSettingsBtn) {
  const candidate = document.getElementById('exportProfilesBtn');
  if (candidate && /export\s*settings/i.test((candidate.textContent||'').trim())) {
    exportSettingsBtn = candidate;
    exportSettingsBtn.id = exportSettingsBtn.id || 'exportSettingsBtn';
  }
}

// create only if not present
if (!exportSettingsBtn) {
  exportSettingsBtn = document.createElement('button');
  exportSettingsBtn.id = 'exportSettingsBtn';
  exportSettingsBtn.className = 'ghost';
  exportSettingsBtn.textContent = 'Export Settings';
  // attach to UI near profiles export if possible
  if (exportProfilesBtn && exportProfilesBtn.parentNode) exportProfilesBtn.parentNode.insertBefore(exportSettingsBtn, exportProfilesBtn.nextSibling);
  else document.body.appendChild(exportSettingsBtn);
}

// export handler (settings)
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

// Import settings - reuse existing input/button if present, else create
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
  // try to reuse importProfilesBtn if it looks like a general Import button
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

// wire import button to hidden input
importSettingsBtn.addEventListener('click', () => importSettingsInput.click());

// import input handler (apply imported settings gracefully)
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

      // Build an object with only the known keys (graceful apply)
      const toApply = {};
      keys.forEach(k => { if (k in imported) toApply[k] = imported[k]; });

      // Apply to UI
      const merged = Object.assign({}, gatherSettingsObject(), toApply);
      setUI(merged);

      // Persist globally: merge into existing sync keys (don't wipe unrelated keys)
      chrome.storage.sync.get(null, (cur) => {
        const newSync = Object.assign({}, cur, toApply);
        chrome.storage.sync.set(newSync, () => {
          toast('Settings imported to extension.', 'success', 1200);
          // Apply to active tab
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

  // ---------------- Saved reads UI + summarization helpers ----------------

// Render saved reads list into #savedList
async function renderSavedList() {
  try {
    const container = document.getElementById('savedList');
    if (!container) return;
    container.innerHTML = '';

    // header actions
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const htitle = document.createElement('strong');
    htitle.textContent = 'Saved Selections';
    header.appendChild(htitle);

    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'flex';
    actionWrap.style.gap = '6px';

    const summarizeAllBtn = document.createElement('button');
    summarizeAllBtn.className = 'btn btn-secondary';
    summarizeAllBtn.textContent = 'Summarize All Saved';
    summarizeAllBtn.addEventListener('click', summarizeAllSaved);
    actionWrap.appendChild(summarizeAllBtn);

    const clearAllBtn = document.createElement('button');
    clearAllBtn.className = 'btn btn-secondary';
    clearAllBtn.textContent = 'Clear Saved';
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Delete all saved selections? This cannot be undone.')) return;
      chrome.storage.local.set({ savedReads: [] }, () => {
        toast('Saved selections cleared.', 'info', 1200);
        renderSavedList();
      });
    });
    actionWrap.appendChild(clearAllBtn);

    header.appendChild(actionWrap);
    container.appendChild(header);

    // load saved reads
    chrome.storage.local.get(['savedReads'], (res) => {
      const arr = Array.isArray(res && res.savedReads) ? res.savedReads.slice().reverse() : [];
      if (!arr.length) {
        const msg = document.createElement('div');
        msg.style.opacity = '0.85';
        msg.style.fontSize = '13px';
        msg.textContent = 'No saved selections yet — select text on a page and click "Save Selection".';
        container.appendChild(msg);
        return;
      }

      const list = document.createElement('div');
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '8px';

      for (const item of arr) {
        const row = document.createElement('div');
        row.className = 'saved-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'flex-start';
        row.style.padding = '8px';
        row.style.borderRadius = '6px';
        row.style.border = '1px solid rgba(0,0,0,0.06)';
        row.style.background = 'var(--surface, rgba(0,0,0,0.02))';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.style.marginRight = '12px';

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.marginBottom = '6px';
        title.textContent = item.title || (item.text || '').slice(0, 80);

        const meta = document.createElement('div');
        meta.style.fontSize = '12px';
        meta.style.opacity = '0.8';
        const date = new Date(item.ts || Date.now());
        meta.textContent = `${item.url ? (new URL(item.url)).hostname : 'Unknown site'} • ${date.toLocaleString()}`;

        const preview = document.createElement('div');
        preview.style.fontSize = '13px';
        preview.style.marginTop = '6px';
        preview.style.whiteSpace = 'nowrap';
        preview.style.overflow = 'hidden';
        preview.style.textOverflow = 'ellipsis';
        preview.title = (item.text || '').trim();
        preview.textContent = (item.text || '').trim().slice(0, 300);

        left.appendChild(title);
        left.appendChild(meta);
        left.appendChild(preview);

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.flexDirection = 'column';
        right.style.gap = '6px';
        right.style.alignItems = 'flex-end';

        const sumBtn = document.createElement('button');
        sumBtn.className = 'btn btn-primary';
        sumBtn.textContent = 'Summarize';
        sumBtn.addEventListener('click', () => summarizeSavedItem(item));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-secondary';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          if (!confirm('Delete saved selection?')) return;
          chrome.storage.local.get(['savedReads'], (r) => {
            const cur = Array.isArray(r && r.savedReads) ? r.savedReads : [];
            const keep = cur.filter(x => x.id !== item.id);
            chrome.storage.local.set({ savedReads: keep }, () => {
              toast('Saved selection deleted.', 'info', 1000);
              renderSavedList();
            });
          });
        });

        right.appendChild(sumBtn);
        right.appendChild(deleteBtn);

        row.appendChild(left);
        row.appendChild(right);
        list.appendChild(row);
      }

      container.appendChild(list);
    });
  } catch (e) {
    safeLog('renderSavedList error', e);
  }
}

// Summarize a single saved item (shows modal)
async function summarizeSavedItem(item) {
  try {
    if (!item || !item.text) return toast('Nothing to summarize.', 'info');
    const pref = await readSummaryPref();
    const adaptiveMax = computeAdaptiveMax(item.text, pref);

    const pid = createProgressToast('Generating summary — please wait...', 60000);
    let summary = '(no summary produced)';
    try {
      summary = summarizeTextLocal(item.text, adaptiveMax, pref) || summary;
    } catch (e) {
      safeLog('summarizer error (saved item)', e);
    } finally {
      clearProgressToast();
    }

    // post-filter and header
    const actualSentences = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean).length || 0;
    const headerTitle = `Saved Selection — ${actualSentences} sentence${actualSentences === 1 ? '' : 's'}`;
    createSummaryModal(headerTitle, summary);
  } catch (e) {
    safeLog('summarizeSavedItem error', e);
    toast('Failed to summarize saved selection.', 'error');
  }
}

// Summarize all saved selections (concatenate & summarize)
async function summarizeAllSaved() {
  try {
    chrome.storage.local.get(['savedReads'], async (r) => {
      const arr = Array.isArray(r && r.savedReads) ? r.savedReads : [];
      if (!arr.length) { toast('No saved selections to summarize.', 'info'); return; }

      // join saved texts with paragraph breaks; if combined text is huge, consider truncation
      const combined = arr.map(x => (x.text || '').trim()).filter(Boolean).join('\n\n');
      if (!combined) { toast('No textual content found in saved selections.', 'info'); return; }

      const pref = await readSummaryPref();
      const adaptiveMax = computeAdaptiveMax(combined, pref);

      const pid = createProgressToast('Generating combined summary — please wait...', 60000);
      let summary = '(no summary produced)';
      try {
        summary = summarizeTextLocal(combined, adaptiveMax, pref) || summary;
      } catch (e) {
        safeLog('summarizer error (all saved)', e);
      } finally {
        clearProgressToast();
      }

      const actualSentences = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean).length || 0;
      const headerTitle = `Saved Selections — ${actualSentences} sentence${actualSentences === 1 ? '' : 's'}`;
      createSummaryModal(headerTitle, summary);
    });
  } catch (e) {
    safeLog('summarizeAllSaved error', e);
    toast('Failed to summarize saved selections.', 'error');
  }
}

// Ensure saved list is rendered at startup
try { renderSavedList(); } catch (e) { safeLog('initial renderSavedList failed', e); }


  // Save selection -> use background/content messaging helper which handles injecting + permission flow
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
          toast('Extension lacks permission to access this site. Open the page and allow access.', 'error', 7000);
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

      // Fallback: use scripting on best web tab
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

  // ---------- Sharing stats image ----------
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

  // ---------- Messages from background/content ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  safeLog('chrome.runtime.onMessage received', msg, sender && sender.tab && { tabId: sender.tab.id, url: sender.tab.url });

  // handle command routed from background when no web tab is available
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

  // existing handling (statsUpdated, readingStopped, readingPaused, readingResumed)
  if (!msg?.action) { sendResponse({ ok: false }); return true; }
  if (msg.action === 'statsUpdated') { safeLog('msg statsUpdated -> loadStats'); loadStats(); }
  else if (msg.action === 'readingStopped') { safeLog('msg readingStopped'); setReadingStatus('Not Reading'); toast('Reading stopped.', 'info'); }
  else if (msg.action === 'readingPaused') { safeLog('msg readingPaused'); setReadingStatus('Paused'); toast('Reading paused.', 'info'); }
  else if (msg.action === 'readingResumed') { safeLog('msg readingResumed'); setReadingStatus('Reading...'); toast('Reading started.', 'info'); }
  sendResponse({ ok: true });
  return true;
});


  // ---------- Popup keyboard shortcuts (active while popup open) ----------
  window.addEventListener('keydown', (e) => {
    try {
      // only while popup is open/focused — ignore if input elements are focused
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
    } catch (err) { /* silent */ }
  });

  // ---------- Init ----------
  safeLog('popup init: loadStats, initPerSiteUI, renderSavedList');
  loadStats();
  initPerSiteUI();
  wireSummaryDetailSelect();
  renderSavedList();
  setTimeout(() => { safeLog('delayed loadVoicesIntoSelect'); loadVoicesIntoSelect(); }, 300);
});
