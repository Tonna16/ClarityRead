// src/popup.js - upgraded with multilingual, share, saved reads, speed-read + focus-mode + local summarizer
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id) || null;
  const safeLog = (...a) => { try { console.log('[ClarityRead popup]', ...a); } catch(e){} };
  console.info('ClarityRead popup initializing...');
  safeLog('DOMContentLoaded');

  // --- Simple toast system (non-blocking notifications)
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
  function toast(msg, type = 'info', ttl = 3500) {
    try {
      createToastContainer();
      const cont = document.getElementById('clarityread-toast-container');
      if (!cont) return;
      const el = document.createElement('div');
      el.className = 'clarityread-toast';
      el.textContent = msg;
      el.style.padding = '8px 12px';
      el.style.borderRadius = '8px';
      el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
      el.style.background = (type === 'error' ? '#ffeced' : (type === 'success' ? '#e8f5e9' : '#fff7e6'));
      el.style.color = '#111';
      el.style.fontSize = '13px';
      el.style.maxWidth = '320px';
      el.style.wordBreak = 'break-word';
      cont.appendChild(el);
      setTimeout(() => {
        try { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; } catch(e){}
      }, ttl - 500);
      setTimeout(() => { try { el.remove(); } catch(e){} }, ttl);
    } catch (e) { safeLog('toast failed', e); }
  }

  // --- Ensure Chart.js loaded if popup opened as standalone window
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
    s.onload = () => { console.info('Chart.js injected and loaded.'); safeLog('Chart.js onload'); if (typeof callback === 'function') callback(); };
    s.onerror = (e) => { console.error('Failed to load Chart.js from', src, e); safeLog('Chart.js onerror', e); if (typeof callback === 'function') callback(); };
    document.head.appendChild(s);
    safeLog('ensureChartReady injected script', src);
  }

  // quick element presence check
  const requiredIds = ['dyslexicToggle','reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];
  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
  console.info('Popup element presence:', elPresence);
  safeLog('element presence', elPresence);

  ensureChartReady(() => { try { if (typeof loadStats === 'function') loadStats(); } catch (e) { safeLog('ensureChartReady callback loadStats threw', e); } });

  // --- Elements
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
  const sizeOptions = $('sizeOptions');
  const fontSizeSlider = $('fontSizeSlider');
  const fontSizeValue = $('fontSizeValue');
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
  const chartWrapper = document.querySelector('.chartWrapper');

  const speedToggle = $('speedToggle');
  const chunkSizeInput = $('chunkSize');
  const speedRateInput = $('speedRate');

  const saveSelectionBtn = $('saveSelectionBtn');
  const openSavedManagerBtn = $('openSavedManagerBtn');
  const savedListEl = $('savedList');
  const shareStatsBtn = $('shareStatsBtn');

  // dynamically add Focus Mode button (if HTML doesn't include it)
  let focusModeBtn = $('focusModeBtn');
  if (!focusModeBtn && document.querySelector('.themeRow')) {
    focusModeBtn = document.createElement('button');
    focusModeBtn.id = 'focusModeBtn';
    focusModeBtn.textContent = 'Focus Mode';
    focusModeBtn.style.marginRight = '8px';
    document.querySelector('.themeRow').insertBefore(focusModeBtn, themeToggleBtn || null);
    safeLog('added dynamic focusModeBtn');
  }

  // also add Summarize Page button if missing
  let summarizePageBtn = $('summarizePageBtn');
  if (!summarizePageBtn && document.querySelector('.themeRow')) {
    summarizePageBtn = document.createElement('button');
    summarizePageBtn.id = 'summarizePageBtn';
    summarizePageBtn.textContent = 'Summarize Page';
    summarizePageBtn.style.marginRight = '8px';
    document.querySelector('.themeRow').insertBefore(summarizePageBtn, focusModeBtn || themeToggleBtn || null);
    safeLog('added dynamic summarizePageBtn');
  }

  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20 };
  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let chart = null;
  let chartResizeObserver = null;
  let settingsDebounce = null;
  let opLock = false;            // prevent concurrent sends
  let lastStatus = null;        // dedupe repeated identical status updates

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

  // helper: build host permission pattern from a tab URL
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

  // find best candidate web tab (prefer focused normal window active tab)
  function findBestWebTab() {
    return new Promise((resolve) => {
      chrome.windows.getAll({ populate: true }, (wins) => {
        if (chrome.runtime.lastError || !wins) return resolve(null);
        // 1) focused normal window's active web tab
        const focusedWin = wins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
        if (focusedWin) {
          const tab = focusedWin.tabs.find(t => t.active && isWebUrl(t.url));
          if (tab) return resolve(tab);
        }
        // 2) any normal window's active web tab
        for (const w of wins) {
          if (w.type === 'normal' && Array.isArray(w.tabs)) {
            const tab = w.tabs.find(t => t.active && isWebUrl(t.url));
            if (tab) return resolve(tab);
          }
        }
        // 3) fallback: first web tab anywhere
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

  // Normalize possibly-wrapped background responses (unwrap `response` nesting)
  function normalizeBgResponse(res) {
    try {
      let r = res;
      // If background wrapped: { ok: true, response: { ok:true, response: {...} } } etc.
      let depth = 0;
      while (r && typeof r === 'object' && ('response' in r) && (depth < 6)) {
        r = r.response;
        depth++;
      }
      return r;
    } catch (e) {
      safeLog('normalizeBgResponse threw', e);
      return res;
    }
  }

  // Robust send helper - popup -> background forward wrapper
  // Attaches _targetTabId/_targetTabUrl (only if we can reliably determine a web tab).
  // If active tab is an extension/internal page, we try to find a real web tab via findBestWebTab().
  async function sendMessageToActiveTabWithInject(message, _retry = 0) {
    // prevent concurrent operations to avoid racey state updates
    if (opLock) {
      safeLog('sendMessageToActiveTabWithInject blocked: opLock active');
      return { ok: false, error: 'in-flight' };
    }
    opLock = true;
    try {
      return await new Promise((resolve) => {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
          const tab = tabs && tabs[0];
          // If active tab is an extension or otherwise non-web, try to find a "best" web tab.
          if (tab && tab.url && tab.url.startsWith('chrome-extension://')) {
            safeLog('Popup helper: active tab is extension page — looking for best web tab');
            try {
              const webTab = await findBestWebTab();
              if (webTab) {
                message._targetTabId = webTab.id;
                message._targetTabUrl = webTab.url;
                safeLog('Popup helper: selected best web tab', webTab.id, webTab.url);
              } else {
                safeLog('Popup helper: no web tab found; leaving target to background discovery');
                delete message._targetTabId;
                delete message._targetTabUrl;
              }
            } catch (e) {
              safeLog('Popup helper: findBestWebTab error', e);
              delete message._targetTabId;
              delete message._targetTabUrl;
            }
          } else if (tab && tab.id && tab.url && isWebUrl(tab.url)) {
            // Normal case: active tab is web page
            message._targetTabId = tab.id;
            message._targetTabUrl = tab.url;
          } else if (tab && tab.id && tab.url && !isWebUrl(tab.url)) {
            // active tab is some internal page (chrome:// or about:) — try find best web tab
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
            } catch (e) {
              delete message._targetTabId;
              delete message._targetTabUrl;
            }
          } else {
            // no active tab found — let background discovery handle it
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
                } catch (e) {
                  safeLog('permission flow threw', e);
                  opLock = false;
                  return resolve({ ok: false, error: 'permission-flow-exception', detail: String(e) });
                }
                return;
              }

              opLock = false;
              return resolve(res);
            });
          } catch (ex) {
            safeLog('popup send wrapper threw', ex);
            opLock = false;
            return resolve({ ok: false, error: String(ex) });
          }
        });
      });
    } finally {
      opLock = false;
    }
  }

  // --- Stats / badges / chart
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
          console.warn('Chart.js not loaded — graph will be blank.');
          safeLog('Chart.js undefined, cannot render chart');
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

  // --- Voice helpers
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
      } catch (err) { console.warn('detectPageLanguage failed', err); safeLog('detectPageLanguage caught', err); }
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

  safeOn(themeToggleBtn, 'click', () => { document.body.classList.toggle('dark-theme'); safeLog('theme toggled', document.body.classList.contains('dark-theme')); });

  // --- Per-site UI init
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
          if (siteSettings.voice) setTimeout(() => { voiceSelect.value = siteSettings.voice; safeLog('applied site voice override', siteSettings.voice); }, 200);
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

  // send settings (single applySettings message)
  function sendSettingsAndToggles(settings) {
    safeLog('sendSettingsAndToggles', settings);
    return sendMessageToActiveTabWithInject({ action: 'applySettings', ...settings })
      .then((resRaw) => {
        const res = normalizeBgResponse(resRaw);
        safeLog('applySettings response', res);
        if (!res || !res.ok) {
          console.warn('applySettings failed:', JSON.stringify(res));
          toast('Failed to apply settings to page.', 'error');
        } else {
          toast('Settings applied.', 'success', 1800);
        }
        return res;
      })
      .catch(err => { console.warn('applySettings err', err); safeLog('applySettings err', err); toast('Failed to apply settings (see console).', 'error'); return { ok:false, error: String(err) }; });
  }

  function gatherAndSendSettings() {
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
      settingsDebounce = setTimeout(() => { sendSettingsAndToggles(settings); settingsDebounce = null; }, 120);
    });
  }

  function setReadingStatus(status) {
    // dedupe identical consecutive statuses to avoid flipping UI
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

  // --- Events hookup
  safeOn(dysToggle, 'change', gatherAndSendSettings);
  safeOn(reflowToggle, 'change', () => { if (sizeOptions) sizeOptions.hidden = !reflowToggle.checked; gatherAndSendSettings(); });
  safeOn(contrastToggle, 'change', () => { if (contrastToggle?.checked && invertToggle) invertToggle.checked = false; gatherAndSendSettings(); });
  safeOn(invertToggle, 'change', () => { if (invertToggle?.checked && contrastToggle) contrastToggle.checked = false; gatherAndSendSettings(); });
  safeOn(fontSizeSlider, 'input', () => { if (fontSizeValue) fontSizeValue.textContent = `${fontSizeSlider.value}px`; gatherAndSendSettings(); });
  safeOn(rateInput, 'input', gatherAndSendSettings);
  safeOn(pitchInput, 'input', gatherAndSendSettings);
  safeOn(highlightCheckbox, 'change', gatherAndSendSettings);

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

  // helper to robustly extract selection object from helper response
  function extractSelection(resRaw) {
    const res = normalizeBgResponse(resRaw);
    if (!res) return null;
    // possible shapes handled: { ok:true, selection: {...}}, { ok:true, response:{ selection:{}}}
    if (res.selection) return res.selection;
    if (res.response && res.response.selection) return res.response.selection;
    if (res.ok && res.selection) return res.selection;
    return null;
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
        safeLog('speedRead send result', res);
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

  // Focus mode button
  safeOn(focusModeBtn, 'click', async () => {
    safeLog('focusModeBtn clicked');
    focusModeBtn.disabled = true;
    const res = await sendMessageToActiveTabWithInject({ action: 'toggleFocusMode' });
    focusModeBtn.disabled = false;
    safeLog('toggleFocusMode response', res);
    const r = normalizeBgResponse(res);
    if (!r || !r.ok) {
      if (r && r.error === 'no-host-permission') toast('Permission required to show focus mode for this site.', 'error', 6000);
      else if (r && r.error === 'tab-discarded') toast('The target tab is suspended. Reload the page and try again.', 'error', 5000);
      else toast('Failed to toggle focus mode.', 'error', 4500);
    } else {
      focusModeBtn.textContent = (r.overlayActive ? 'Close Focus' : 'Focus Mode');
      toast(r.overlayActive ? 'Focus mode opened.' : 'Focus mode closed.', 'success', 1400);
      safeLog('focusModeBtn UI updated', focusModeBtn.textContent);
    }
  });

  // --- Local summarizer (Option A: extractive sentence scoring)
  const STOPWORDS = new Set([
    'the','is','in','and','a','an','to','of','that','it','on','for','with','as','was','were','this','by','are','or','be','from','at','which','but','not','have','has','had','they','you','i'
  ]);

  function splitIntoSentences(text) {
    if (!text) return [];
    const sentences = text
      .replace(/\n+/g, ' ')
      .split(/(?<=[.?!])\s+(?=[A-Z0-9])/g)
      .map(s => s.trim())
      .filter(Boolean);
    if (sentences.length <= 1) {
      return text.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
    }
    return sentences;
  }

  function scoreSentences(text) {
    const sentences = splitIntoSentences(text);
    if (!sentences.length) return [];

    const wordFreq = {};
    const words = text.toLowerCase().match(/\b[^\d\W]+\b/g) || [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
    const maxFreq = Math.max(1, ...Object.values(wordFreq));

    const scores = sentences.map(s => {
      const ws = (s.toLowerCase().match(/\b[^\d\W]+\b/g) || []).filter(w => !STOPWORDS.has(w));
      let sc = 0;
      for (const w of ws) sc += (wordFreq[w] || 0) / maxFreq;
      sc *= Math.min(1, Math.max(0.2, ws.length / 10));
      return { sentence: s, score: sc };
    });
    return scores;
  }

  function summarizeText(text, maxSentences = 3) {
    if (!text || typeof text !== 'string') return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 200) return cleaned;
    const sentences = splitIntoSentences(cleaned);
    if (sentences.length <= 1) return cleaned;

    const scores = scoreSentences(cleaned).filter(s => s.score >= 0);
    scores.sort((a,b) => b.score - a.score);
    const limit = Math.max(1, Math.min(maxSentences, Math.ceil(sentences.length * 0.2)));
    const chosen = scores.slice(0, limit).map(s => s.sentence);
    const ordered = sentences.filter(s => chosen.includes(s));
    const result = ordered.length ? ordered.join(' ') : chosen.join(' ');
    safeLog('summarizeText produced', { chosenCount: chosen.length, limit });
    return result;
  }

  // Modal UI for summaries (in-popup)
  function createSummaryModal(title = 'Summary', content = '') {
    const old = document.getElementById('clarityread-summary-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'clarityread-summary-modal';
    modal.style.position = 'fixed';
    modal.style.zIndex = 2147483647;
    modal.style.left = '8px';
    modal.style.right = '8px';
    modal.style.top = '8px';
    modal.style.bottom = '8px';
    modal.style.background = 'var(--card-bg, #fff)';
    modal.style.border = '1px solid var(--card-border, #e6e6e6)';
    modal.style.borderRadius = '8px';
    modal.style.padding = '12px';
    modal.style.overflow = 'auto';
    modal.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
    modal.style.fontSize = '13px';
    modal.style.color = 'inherit';

    const hdr = document.createElement('div');
    hdr.style.display = 'flex';
    hdr.style.justifyContent = 'space-between';
    hdr.style.alignItems = 'center';
    hdr.style.marginBottom = '8px';
    const h = document.createElement('strong'); h.textContent = title;
    hdr.appendChild(h);
    const actions = document.createElement('div');

    const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(content);
        copyBtn.textContent = 'Copied';
        setTimeout(() => copyBtn.textContent = 'Copy', 1200);
        toast('Summary copied to clipboard.', 'success');
      } catch (e) { console.warn('copy failed', e); safeLog('summary copy failed', e); toast('Copy failed.', 'error'); }
    });
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => modal.remove());

    const downloadBtn = document.createElement('button'); downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'summary.txt'; a.click();
      URL.revokeObjectURL(url);
      toast('Summary downloaded.', 'success', 1400);
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    hdr.appendChild(actions);
    modal.appendChild(hdr);

    const pre = document.createElement('div');
    pre.id = 'clarityread-summary-content';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.lineHeight = '1.5';
    pre.textContent = content || '(no summary)';
    modal.appendChild(pre);

    document.body.appendChild(modal);
    safeLog('created summary modal', { title, length: (content||'').length });
    return modal;
  }

  // Summarize current page/selection using send helper (falls back to executeScript)
  async function summarizeCurrentPageOrSelection() {
    safeLog('summarizeCurrentPageOrSelection start');
    try {
      const res = await sendMessageToActiveTabWithInject({ action: 'getSelection' });
      safeLog('getSelection response', res);
      let text = '';

      const selectionObj = extractSelection(res);
      if (selectionObj && selectionObj.text && selectionObj.text.trim()) {
        // Ask the user whether to summarize selection or whole page
        const wantSelection = confirm('Summarize selected text? Click "OK" to summarize the selection, or "Cancel" to summarize the full page.');
        if (wantSelection) {
          text = selectionObj.text;
          safeLog('summarize using selection text len', text.length);
        } else {
          safeLog('user opted to summarize full page instead of selection');
          text = ''; // fallthrough to page extraction below
        }
      }

      if (!text) {
        // fallback: try to pick a good web tab explicitly
        const tab = await findBestWebTab();
        safeLog('summarize fallback tab', tab && { id: tab.id, url: tab.url });
        if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          toast('Cannot summarize internal or extension pages.', 'error');
          safeLog('summarize aborted: no suitable web tab');
          return;
        }
        try {
          const exec = await new Promise((resolve) => {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                function getMainNodeText() {
                  try {
                    const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text'];
                    for (const s of prefer) {
                      const el = document.querySelector(s);
                      if (el && el.innerText && el.innerText.length > 200) return el.innerText;
                    }
                    if (document.body && document.body.innerText && document.body.innerText.length > 200) return document.body.innerText;
                  } catch (e) {}
                  return document.documentElement && document.documentElement.innerText ? document.documentElement.innerText : '';
                }
                return { text: getMainNodeText(), title: document.title || '' };
              }
            }, (results) => resolve(results && results[0] && results[0].result));
          });
          safeLog('summarize exec result', !!exec, exec && (exec.text || '').length);
          if (exec && exec.text) text = exec.text;
        } catch (e) { console.warn('summarize fallback exec failed', e); safeLog('summarize fallback exec failed', e); }
      }

      if (!text || !text.trim()) { toast('No text to summarize — select text on the page or ensure the page has readable content.', 'info'); safeLog('summarize no text'); return; }
      const summary = summarizeText(text, 3);
      createSummaryModal('Page Summary', summary);
      safeLog('summarize created summary len', summary.length);
    } catch (e) {
      console.warn('summarizeCurrentPageOrSelection failed', e);
      safeLog('summarize exception', e);
      toast('Failed to summarize (see console).', 'error');
    }
  }

  safeOn(summarizePageBtn, 'click', summarizeCurrentPageOrSelection);

  // --- Profiles, saved reads, selection, stats
  function updateProfileDropdown(profiles = {}, selectedName = '') { if (!profileSelect) return; profileSelect.innerHTML = '<option value="">Select profile</option>'; for (const name in profiles) { const opt=document.createElement('option'); opt.value=name; opt.textContent=name; profileSelect.appendChild(opt);} if (selectedName) profileSelect.value = selectedName; }
  function saveProfile(name, profile) { chrome.storage.local.get(['profiles'], (res) => { const profiles = res.profiles || {}; profiles[name] = profile; chrome.storage.local.set({ profiles }, () => { chrome.storage.sync.set({ profiles }, () => { toast('Profile saved.', 'success'); updateProfileDropdown(profiles, name); safeLog('profile saved', name, profile); }); }); }); }
  chrome.storage.local.get(['profiles'], (res) => { safeLog('loaded profiles', Object.keys(res.profiles||{})); updateProfileDropdown(res.profiles || {}); });

  safeOn(profileSelect, 'change', (e) => { const name = e.target.value; if (!name) return; chrome.storage.local.get(['profiles'], (res) => { const settings = res.profiles?.[name]; safeLog('profile selected', name, settings); if (settings) setUI(settings); gatherAndSendSettings(); }); });

  safeOn(saveProfileBtn, 'click', () => { const name = prompt('Enter profile name:'); if (!name) return; const profile = gatherSettingsObject(); saveProfile(name, profile); });

  safeOn(exportProfilesBtn, 'click', () => { chrome.storage.local.get(['profiles'], (res) => { const dataStr = JSON.stringify(res.profiles || {}); const blob = new Blob([dataStr], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadProfiles.json'; a.click(); URL.revokeObjectURL(url); toast('Profiles exported.', 'success'); safeLog('exported profiles'); }); });

  safeOn(importProfilesBtn, 'click', () => importProfilesInput?.click());
  if (importProfilesInput) {
    importProfilesInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importedProfiles = JSON.parse(event.target.result);
          chrome.storage.local.get(['profiles'], (res) => {
            const profiles = { ...(res.profiles || {}), ...importedProfiles };
            chrome.storage.local.set({ profiles }, () => {
              chrome.storage.sync.set({ profiles }, () => { toast('Profiles imported.', 'success'); updateProfileDropdown(profiles); safeLog('imported profiles', Object.keys(importedProfiles||{})); });
            });
          });
        } catch (err) { safeLog('importProfiles parse failed', err); toast('Failed to import profiles: invalid JSON.', 'error'); }
      };
      reader.readAsText(file);
    });
  }

  safeOn(resetStatsBtn, 'click', () => { if (!confirm('Reset all reading stats?')) return; chrome.runtime.sendMessage({ action: 'resetStats' }, () => { safeLog('resetStats requested'); loadStats(); setReadingStatus('Not Reading'); toast('Stats reset.', 'success'); }); });

  // Render saved reads, with Summarize and Summarize All
  function renderSavedList() {
    safeLog('renderSavedList start');
    chrome.storage.local.get(['savedReads'], (res) => {
      const list = (res.savedReads || []).slice().reverse();
      safeLog('savedReads count', list.length);
      if (!savedListEl) { safeLog('savedListEl missing'); return; }
      savedListEl.innerHTML = '';

      if (list.length) {
        const topWrap = document.createElement('div');
        topWrap.style.display = 'flex';
        topWrap.style.justifyContent = 'flex-end';
        topWrap.style.marginBottom = '8px';
        const summarizeAllBtn = document.createElement('button');
        summarizeAllBtn.textContent = 'Summarize All Saved';
        summarizeAllBtn.addEventListener('click', () => {
          const combined = list.map(it => it.title + '\n' + it.text).join('\n\n');
          const summary = summarizeText(combined, 6);
          createSummaryModal('Summary — All Saved Items', summary);
        });
        topWrap.appendChild(summarizeAllBtn);
        savedListEl.appendChild(topWrap);
      }

      if (!list.length) { savedListEl.textContent = 'No saved items yet.'; return; }

      list.forEach(item => {
        const row = document.createElement('div');
        row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.marginBottom='6px';
        const left = document.createElement('div'); left.style.flex='1'; left.style.marginRight='8px';
        const title = document.createElement('div'); title.textContent = item.title || (item.text||'').slice(0,60) || 'Saved item'; title.style.fontSize='13px'; title.style.fontWeight='600'; left.appendChild(title);
        const sub = document.createElement('div'); try { sub.textContent = item.url ? (new URL(item.url)).hostname : ''; } catch(e){ sub.textContent = ''; } sub.style.fontSize='11px'; sub.style.opacity='0.7'; left.appendChild(sub);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        actions.style.alignItems = 'center';

        const openBtn = document.createElement('button'); openBtn.textContent='Read';
        openBtn.addEventListener('click', () => {
          chrome.storage.sync.set({ voice: voiceSelect?.value||'', rate: Number(rateInput?.value||1), pitch: Number(pitchInput?.value||1) }, async () => {
            safeLog('saved read open clicked', item.id);
            const res = await sendMessageToActiveTabWithInject({ action:'readAloud', highlight:false, _savedText: item.text });
            if (normalizeBgResponse(res)?.ok) { setReadingStatus('Reading...'); toast('Started reading saved item.', 'success'); }
            else { safeLog('readAloud _savedText failed', res); toast('Failed to play saved item.', 'error'); }
          });
        });

        const openSpeed = document.createElement('button'); openSpeed.textContent='Speed';
        openSpeed.addEventListener('click', async () => {
          const chunk = Number(chunkSizeInput?.value || 3);
          const r = Number(speedRateInput?.value || 1);
          safeLog('saved read openSpeed clicked', item.id, { chunk, r });
          const res = await sendMessageToActiveTabWithInject({ action:'speedRead', text:item.text, chunkSize:chunk, rate:r });
          if (normalizeBgResponse(res)?.ok) { setReadingStatus('Reading...'); toast('Started speed-read of saved item.', 'success'); }
          else { safeLog('speedRead _savedText failed', res); toast('Failed to start speed-read.', 'error'); }
        });

        const summarizeBtn = document.createElement('button'); summarizeBtn.textContent = 'Summarize';
        summarizeBtn.addEventListener('click', () => {
          const summary = summarizeText(item.text || '', 3);
          createSummaryModal(item.title || 'Saved Item Summary', summary);
        });

        const delBtn = document.createElement('button'); delBtn.textContent='Delete';
        delBtn.addEventListener('click', () => { if (!confirm('Delete saved item?')) return; chrome.storage.local.get(['savedReads'], (r2)=>{ const arr = r2.savedReads || []; const filtered = arr.filter(x=>x.id!==item.id); chrome.storage.local.set({ savedReads: filtered }, () => { safeLog('deleted saved item', item.id); renderSavedList(); toast('Saved item deleted.', 'info'); }); }); });

        actions.appendChild(openBtn);
        actions.appendChild(openSpeed);
        actions.appendChild(summarizeBtn);
        actions.appendChild(delBtn);

        row.appendChild(left); row.appendChild(actions); savedListEl.appendChild(row);
      });
    });
  }

  // Save selection -> use background/content messaging helper which handles injecting + permission flow
  safeOn(saveSelectionBtn, 'click', async () => {
    safeLog('saveSelectionBtn clicked');
    try {
      saveSelectionBtn.disabled = true;
      const resRaw = await sendMessageToActiveTabWithInject({ action: 'getSelection' });
      safeLog('getSelection via helper', resRaw);
      const res = normalizeBgResponse(resRaw);
      if (!res || !res.ok) {
        if (res && res.error === 'no-host-permission') {
          toast('Extension lacks permission to access this site. Open the page and allow access.', 'error', 7000);
          saveSelectionBtn.disabled = false;
          return;
        }
        // fallback: try to find a good web tab and run scripting there
        const tab = await findBestWebTab();
        if (!tab || !tab.id) { toast('No active page found.', 'error'); safeLog('saveSelection fallback: no web tab'); saveSelectionBtn.disabled = false; return; }
        try {
          chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const s = window.getSelection(); const text = s ? s.toString() : ''; return { text: text, title: document.title || '', url: location.href || '' }; } }, (results) => {
            saveSelectionBtn.disabled = false;
            if (chrome.runtime.lastError) {
              console.warn('getSelection exec failed', chrome.runtime.lastError);
              safeLog('scripting.executeScript failed', chrome.runtime.lastError);
              const msg = (chrome.runtime.lastError.message || '').toLowerCase();
              if (msg.includes('must request permission') || msg.includes('cannot access contents of the page')) {
                toast('Extension lacks permission to access this site. Open the page and allow access.', 'error', 7000);
              } else toast('Failed to fetch selection (see console).', 'error');
              return;
            }
            const result = results && results[0] && results[0].result;
            if (!result || !result.text || !result.text.trim()) { toast('No selection found on the page.', 'info'); safeLog('scripting returned no selection'); return; }
            const item = { id: Date.now() + '-' + Math.floor(Math.random()*1000), text: result.text, title: result.title || result.text.slice(0,80), url: result.url, ts: Date.now() };
            chrome.storage.local.get(['savedReads'], (r) => { const arr = r.savedReads || []; arr.push(item); chrome.storage.local.set({ savedReads: arr }, () => { toast('Selection saved.', 'success'); safeLog('selection saved via scripting', item.id); renderSavedList(); }); });
          });
        } catch (err) { console.warn('save selection scripting failed', err); safeLog('save selection scripting failed', err); toast('Failed to fetch selection (see console).', 'error'); saveSelectionBtn.disabled = false; }
        return;
      }

      // robustly extract selection from possibly-wrapped responses
      const selection = extractSelection(resRaw);
      safeLog('selection from helper', selection && { textLen: selection.text && selection.text.length, title: selection.title });
      if (!selection || !selection.text || !selection.text.trim()) { toast('No selection found on the page.', 'info'); saveSelectionBtn.disabled = false; return; }
      const item = { id: Date.now() + '-' + Math.floor(Math.random()*1000), text: selection.text, title: selection.title || selection.text.slice(0,80), url: selection.url, ts: Date.now() };
      chrome.storage.local.get(['savedReads'], (r) => { const arr = r.savedReads || []; arr.push(item); chrome.storage.local.set({ savedReads: arr }, () => { toast('Selection saved.', 'success'); safeLog('selection saved', item.id); renderSavedList(); saveSelectionBtn.disabled = false; }); });
    } catch (e) {
      console.warn('saveSelection flow failed', e);
      safeLog('saveSelection exception', e);
      toast('Failed to save selection (see console).', 'error');
      saveSelectionBtn.disabled = false;
    }
  });

  safeOn(openSavedManagerBtn, 'click', () => { safeLog('openSavedManagerBtn clicked'); renderSavedList(); });

  // Generate image for sharing stats
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
          catch (e) { console.warn('clipboard write failed', e); safeLog('clipboard write failed', e); toast('Image downloaded. Clipboard copy not available.', 'info'); }
        } else { toast('Image downloaded. To copy to clipboard, allow clipboard access or use the downloaded file.', 'info'); }
      });
    } catch (e) { console.warn('generateStatsImage failed', e); safeLog('generateStatsImage failed', e); toast('Failed to generate stats image (see console).', 'error'); }
  }

  safeOn(shareStatsBtn, 'click', generateStatsImageAndDownload);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    safeLog('chrome.runtime.onMessage received', msg, sender && sender.tab && { tabId: sender.tab.id, url: sender.tab.url });
    if (!msg?.action) { sendResponse({ ok: false }); return true; }
    if (msg.action === 'statsUpdated') { safeLog('msg statsUpdated -> loadStats'); loadStats(); }
    else if (msg.action === 'readingStopped') { safeLog('msg readingStopped'); setReadingStatus('Not Reading'); toast('Reading stopped.', 'info'); }
    else if (msg.action === 'readingPaused') { safeLog('msg readingPaused'); setReadingStatus('Paused'); toast('Reading paused.', 'info'); }
    else if (msg.action === 'readingResumed') { safeLog('msg readingResumed'); setReadingStatus('Reading...'); toast('Reading started.', 'info'); }
    sendResponse({ ok: true });
    return true;
  });

  // Init
  safeLog('popup init: loadStats, initPerSiteUI, renderSavedList');
  loadStats();
  initPerSiteUI();
  renderSavedList();
  setTimeout(() => { safeLog('delayed loadVoicesIntoSelect'); loadVoicesIntoSelect(); }, 300);
});
