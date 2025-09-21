// src/popup.js - upgraded with multilingual, share, saved reads, speed-read
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id) || null;
  console.info('ClarityRead popup initializing...');

  // quick element presence check
  const requiredIds = ['dyslexicToggle','reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];
  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
  console.info('Popup element presence:', elPresence);

  function ensureChartReady(callback) {
    if (typeof Chart !== 'undefined') return callback && callback();
    const src = chrome.runtime.getURL('lib/chart.umd.min.js');
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { console.info('Chart.js injected and loaded.'); if (typeof callback === 'function') callback(); };
    s.onerror = (e) => { console.error('Failed to load Chart.js from', src, e); if (typeof callback === 'function') callback(); };
    document.head.appendChild(s);
  }
  ensureChartReady(() => { try { if (typeof loadStats === 'function') loadStats(); } catch (e) {} });

  if (document.getElementById('readBtn')) {
    document.getElementById('readBtn').addEventListener('click', () => {
      console.debug('Read button clicked (popup handler).');
    }, { once: false });
  }

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

  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20 };
  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let chart = null;
  let chartResizeObserver = null;
  let settingsDebounce = null;

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

  // ---------------- Robust send helper (uses lastFocusedWindow to avoid picking popup tab) ----------------
   // ---------------- Robust send helper (replaces earlier version) ----------------
  async function sendMessageToActiveTabWithInject(message) {
    // return a promise that resolves to { ok, error, detail, response }
    return new Promise((resolve) => {
      const isUnsupportedUrl = (url) => {
        if (!url) return true;
        const u = url.toLowerCase();
        return u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('about:') ||
               u.startsWith('chrome-extension://') || u.startsWith('file://') || u.startsWith('view-source:');
      };

      const runInlineFallbackOnTab = (tabId, payload) => {
        // This runner executes in page context and performs TTS actions if possible.
        const runner = (payload) => {
          try {
            const safeGetMainText = () => {
              try {
                const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text'];
                for (const s of prefer) {
                  const el = document.querySelector(s);
                  if (el && el.innerText && el.innerText.length > 200) return el.innerText.trim().slice(0, 20000);
                }
                return (document.body && document.body.innerText ? document.body.innerText : '').trim().slice(0, 20000);
              } catch (e) { return ''; }
            };

            const clampRate = (r) => {
              r = Number(r) || 1; return Math.max(0.5, Math.min(1.6, r));
            };

            const speak = (text, opts = {}) => {
              if (!text || !('speechSynthesis' in window)) return { ok: false, error: 'no-tts' };
              try { window.speechSynthesis.cancel(); } catch (e) {}
              const u = new SpeechSynthesisUtterance(text);
              const voices = window.speechSynthesis.getVoices() || [];
              if (opts.voiceName) {
                const v = voices.find(x => x.name === opts.voiceName);
                if (v) u.voice = v;
              } else {
                u.voice = voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0];
              }
              if (typeof opts.rate !== 'undefined') u.rate = clampRate(opts.rate);
              if (typeof opts.pitch !== 'undefined') u.pitch = Number(opts.pitch) || 1;
              try { window.speechSynthesis.speak(u); } catch (e) { return { ok: false, error: String(e) }; }
              return { ok: true };
            };

            if (!payload || !payload.action) return { ok: false, error: 'no-action' };

            if (payload.action === 'readAloud') {
              const text = (payload._savedText && payload._savedText.length) ? payload._savedText : safeGetMainText();
              if (!text) return { ok: false, error: 'no-text' };
              return speak(text, { voiceName: payload.voice, rate: payload.rate, pitch: payload.pitch });
            }
            if (payload.action === 'speedRead') {
              const chunkSize = Number(payload.chunkSize) || 3;
              const rate = Number(payload.rate) || 1;
              const text = (payload.text || payload._savedText) ? (payload.text || payload._savedText) : safeGetMainText();
              if (!text) return { ok: false, error: 'no-text' };
              // simple chunk speaker (non-highlighting)
              const words = text.trim().split(/\s+/).filter(Boolean);
              let i = 0;
              const speakChunk = () => {
                if (i >= words.length) return;
                const chunk = words.slice(i, i + chunkSize).join(' ');
                i += chunkSize;
                const u = new SpeechSynthesisUtterance(chunk);
                const voices = window.speechSynthesis.getVoices() || [];
                u.voice = (voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0]);
                u.rate = clampRate(rate);
                u.onend = () => setTimeout(speakChunk, Math.max(60, Math.round(200 / Math.max(0.1, rate))));
                try { window.speechSynthesis.speak(u); } catch (e) { /* stop */ }
              };
              speakChunk();
              return { ok: true };
            }
            if (payload.action === 'stopReading') { try { window.speechSynthesis.cancel(); } catch (e) {} return { ok: true }; }
            if (payload.action === 'pauseReading') { try { window.speechSynthesis.pause(); } catch (e) {} return { ok: true }; }
            if (payload.action === 'resumeReading') { try { window.speechSynthesis.resume(); } catch (e) {} return { ok: true }; }
            if (payload.action === 'applySettings') {
              // minimal apply: add/remove reflow/dys classes and font-size variable
              try {
                if (payload.dys) {
                  document.documentElement.classList.add('readeasy-dyslexic');
                } else {
                  document.documentElement.classList.remove('readeasy-dyslexic');
                }
                if (typeof payload.fontSize !== 'undefined') {
                  const fs = (typeof payload.fontSize === 'number') ? `${payload.fontSize}px` : String(payload.fontSize);
                  document.documentElement.style.setProperty('--readeasy-font-size', fs);
                }
                if (payload.reflow) document.documentElement.classList.add('readeasy-reflow'); else document.documentElement.classList.remove('readeasy-reflow');
                if (payload.contrast) document.documentElement.classList.add('readeasy-contrast'); else document.documentElement.classList.remove('readeasy-contrast');
                if (payload.invert) document.documentElement.classList.add('readeasy-invert'); else document.documentElement.classList.remove('readeasy-invert');
                return { ok: true };
              } catch (e) { return { ok: false, error: String(e) }; }
            }

            return { ok: false, error: 'unsupported-action' };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        };

        try {
          chrome.scripting.executeScript({
            target: { tabId },
            func: runner,
            args: [payload]
          }, (res) => {
            if (chrome.runtime.lastError) {
              return resolve({ ok: false, error: 'runner-failed', detail: chrome.runtime.lastError.message });
            }
            const out = (res && res[0] && res[0].result) || { ok: false, error: 'no-result' };
            return resolve(out);
          });
        } catch (ex) {
          return resolve({ ok: false, error: 'runner-exception', detail: String(ex) });
        }
      };

      // ask for last-focused active tab in the *lastFocusedWindow*
      try {
        chrome.windows.getLastFocused({ populate: true }, (lastWin) => {
          let candidateTab = null;
          if (lastWin && Array.isArray(lastWin.tabs)) {
            candidateTab = lastWin.tabs.find(t => t.active && t.id && t.url && !isUnsupportedUrl(t.url));
          }

          const trySendTo = (tab) => {
            if (!tab || !tab.id) return resolve({ ok: false, error: 'no-tab' });
            // quick send
            chrome.tabs.sendMessage(tab.id, message, (response) => {
              if (!chrome.runtime.lastError) return resolve({ ok: true, response });
              const errMsg = chrome.runtime.lastError && chrome.runtime.lastError.message || '';
              // If there is no receiver, try injection (only if host is allowed) otherwise fallback runner
              if (errMsg.includes('Receiving end does not exist')) {
                // ensure tab url is safe for injection
                if (!tab.url || isUnsupportedUrl(tab.url)) {
                  return resolve({ ok: false, error: 'unsupported-page', detail: tab.url || '' });
                }
                // attempt to inject content script file (manifest-declared pages often already have it)
                chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/contentScript.js'] }, (execRes) => {
                  if (chrome.runtime.lastError) {
                    const msgLow = (chrome.runtime.lastError.message || '').toLowerCase();
                    // Can't access or no permission => fallback to inline runner (but if url is unsupported it will earlier have been rejected)
                    if (msgLow.includes('cannot access') || msgLow.includes('must request permission')) {
                      return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message });
                    }
                    // fallback attempt using inline runner
                    return runInlineFallbackOnTab(tab.id, message);
                  }
                  // try injecting CSS too (best-effort) then send normal message again
                  chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/inject.css'] }, () => {
                    chrome.tabs.sendMessage(tab.id, message, (resp2) => {
                      if (!chrome.runtime.lastError) return resolve({ ok: true, response: resp2 });
                      // still no receiver => run inline fallback runner
                      return runInlineFallbackOnTab(tab.id, message);
                    });
                  });
                });
                return;
              } else {
                if (errMsg && errMsg.includes('Cannot access contents of the page')) {
                  return resolve({ ok: false, error: 'no-host-permission', detail: errMsg });
                }
                return resolve({ ok: false, error: errMsg || 'unknown-send-error' });
              }
            });
          };

          if (candidateTab) {
            // send to that one
            trySendTo(candidateTab);
            return;
          }

          // else scan for any usable web tab in the current window first
          chrome.tabs.query({ currentWindow: true }, (tabs) => {
            const candidate = (tabs || []).find(t => t && t.url && !isUnsupportedUrl(t.url));
            if (candidate) return trySendTo(candidate);

            // last resort: scan all tabs
            chrome.tabs.query({}, (allTabs) => {
              const fallback = (allTabs || []).find(t => t && t.url && !isUnsupportedUrl(t.url));
              if (!fallback) return resolve({ ok: false, error: 'no-tab' });
              return trySendTo(fallback);
            });
          });
        });
      } catch (ex) {
        return resolve({ ok: false, error: 'exception', detail: String(ex) });
      }
    });
  }


  // --- Stats / badges / chart (unchanged)
  function build7DaySeries(daily = []) {
    const labels = lastNDates(7);
    const map = Object.fromEntries((daily || []).map(d => [d.date, d.pages || 0]));
    const data = labels.map(lbl => map[lbl] || 0);
    return { labels, data };
  }

  function loadStats() {
    chrome.storage.local.get(['stats'], (res) => {
      const stats = res.stats || { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
      if (pagesReadEl) pagesReadEl.textContent = stats.totalPagesRead;
      if (timeReadEl) timeReadEl.textContent = formatTime(stats.totalTimeReadSec);
      const avg = stats.sessions > 0 ? stats.totalTimeReadSec / stats.sessions : 0;
      if (avgSessionEl) avgSessionEl.textContent = formatTime(avg);

      if (statsChartEl) {
        const ctx = (statsChartEl.getContext) ? statsChartEl.getContext('2d') : null;
        const series = build7DaySeries(stats.daily);
        if (chart) { try { chart.destroy(); } catch (err) {} }
        if (typeof Chart === 'undefined') {
          console.warn('Chart.js not loaded — graph will be blank.');
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
          if (chartWrapper && chart) {
            try {
              if (chartResizeObserver) chartResizeObserver.disconnect();
              chartResizeObserver = new ResizeObserver(() => { try { chart.resize(); } catch (e) {} });
              chartResizeObserver.observe(chartWrapper);
            } catch (e) {}
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
    if (!voiceSelect) return;
    const voices = speechSynthesis.getVoices() || [];
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
  speechSynthesis.onvoiceschanged = loadVoicesIntoSelect;
  loadVoicesIntoSelect();

  function selectVoiceByLang(langPrefix = 'en') {
    const voices = speechSynthesis.getVoices() || [];
    if (!voiceSelect) return;
    const voice = voices.find(v => v.lang && v.lang.startsWith(langPrefix));
    if (voice) voiceSelect.value = voice.name;
  }

  function detectPageLanguageAndSelectVoice() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !tab.url) return;
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
      try {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ lang: (document.documentElement && document.documentElement.lang) || navigator.language || 'en' })
        }, (results) => {
          if (chrome.runtime.lastError) return;
          if (results && results[0] && results[0].result && results[0].result.lang) {
            const lang = (results[0].result.lang || 'en').split('-')[0];
            selectVoiceByLang(lang);
          }
        });
      } catch (err) { console.warn('detectPageLanguage failed', err); }
    });
  }

  function persistVoiceOverrideForCurrentSite(voiceName) {
    if (!currentHostname) return;
    chrome.storage.local.get([currentHostname], (res) => {
      const s = res[currentHostname] || {};
      s.voice = voiceName;
      const toSet = {}; toSet[currentHostname] = s;
      chrome.storage.local.set(toSet);
    });
  }

  safeOn(themeToggleBtn, 'click', () => document.body.classList.toggle('dark-theme'));

  // --- Per-site UI init
  function initPerSiteUI() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url) {
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

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
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

      try { currentHostname = new URL(tab.url).hostname; } catch (e) { currentHostname = ''; }
      if (!currentHostname) return;

      chrome.storage.local.get([currentHostname], (localRes) => {
        const siteSettings = localRes[currentHostname];
        if (siteSettings) {
          setUI(siteSettings);
          if (siteSettings.voice) setTimeout(() => { voiceSelect.value = siteSettings.voice; }, 200);
        } else {
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
            detectPageLanguageAndSelectVoice();
          });
        }
      });
    });
  }

  function setUI(settings) {
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
    return {
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
  }

  // send settings (single applySettings message)
  function sendSettingsAndToggles(settings) {
    sendMessageToActiveTabWithInject({ action: 'applySettings', ...settings })
      .then((res) => { if (!res.ok) console.warn('applySettings failed:', JSON.stringify(res)); })
      .catch(err => console.warn('applySettings err', err));
  }

  function gatherAndSendSettings() {
    const settings = gatherSettingsObject();
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      let hostname = '';
      try { hostname = tab && tab.url ? new URL(tab.url).hostname : ''; } catch (e) { hostname = ''; }
      if (hostname) {
        const toSet = {}; toSet[hostname] = settings;
        chrome.storage.local.set(toSet);
      }
      chrome.storage.sync.set(settings);
      setUI(settings);

      if (settingsDebounce) clearTimeout(settingsDebounce);
      settingsDebounce = setTimeout(() => { sendSettingsAndToggles(settings); settingsDebounce = null; }, 120);
    });
  }

  function setReadingStatus(status) {
    if (readingStatusEl) readingStatusEl.textContent = status;
    if (status === 'Reading...') { isReading = true; isPaused = false; if (pauseBtn) pauseBtn.textContent = 'Pause'; }
    else if (status === 'Paused') { isReading = true; isPaused = true; if (pauseBtn) pauseBtn.textContent = 'Resume'; }
    else { isReading = false; isPaused = false; if (pauseBtn) pauseBtn.textContent = 'Pause'; }
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
    persistVoiceOverrideForCurrentSite(v);
    chrome.storage.sync.set({ voice: v });
  });

  // ensure voices loaded (same helper used elsewhere)
  function ensureVoicesLoaded(timeoutMs = 500) {
    const voices = speechSynthesis.getVoices() || [];
    if (voices.length) return Promise.resolve(voices);
    return new Promise(resolve => {
      let called = false;
      const onChange = () => {
        if (called) return;
        called = true;
        speechSynthesis.removeEventListener('voiceschanged', onChange);
        resolve(speechSynthesis.getVoices() || []);
      };
      speechSynthesis.addEventListener('voiceschanged', onChange);
      setTimeout(() => {
        if (!called) {
          called = true;
          speechSynthesis.removeEventListener('voiceschanged', onChange);
          resolve(speechSynthesis.getVoices() || []);
        }
      }, timeoutMs);
    });
  }

  // Read button: persist settings, ensure voices, then message tab
  safeOn(readBtn, 'click', () => {
    const settings = gatherSettingsObject();
    chrome.storage.sync.set({ voice: settings.voice, rate: settings.rate, pitch: settings.pitch, highlight: settings.highlight }, async () => {
      const voices = await ensureVoicesLoaded(500);
      if (settings.voice && voices.length && !voices.find(v => v.name === settings.voice)) {
        const fallback = (voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0]);
        if (fallback) {
          settings.voice = fallback.name;
          chrome.storage.sync.set({ voice: settings.voice });
          persistVoiceOverrideForCurrentSite(settings.voice);
        }
      }

      if (speedToggle && speedToggle.checked) {
        const chunkSize = Number(chunkSizeInput?.value || 3);
        const rate = Number(speedRateInput?.value || settings.rate || 1);
        sendMessageToActiveTabWithInject({ action: 'speedRead', chunkSize, rate }).then(res => {
          if (!res.ok) {
            console.warn('speedRead failed:', JSON.stringify(res));
            alert('Speed-read failed (see console). Falling back to normal read.');
            sendMessageToActiveTabWithInject({ action: 'readAloud', highlight: settings.highlight });
            setReadingStatus('Reading...');
          } else setReadingStatus('Reading...');
        }).catch(err => { console.warn('speedRead err', err); alert('Speed-read failed (see console).'); });
        return;
      }

      sendMessageToActiveTabWithInject({ action: 'readAloud', highlight: settings.highlight, voice: settings.voice, rate: settings.rate, pitch: settings.pitch })
        .then(result => {
          if (!result.ok) {
            console.warn('readAloud send failed:', JSON.stringify(result));
            if (result.error === 'no-host-permission') alert('Cannot read the current page because the extension lacks permission for this site. Click the extension icon while on the page to grant access.');
            else if (result.error === 'unsupported-page') alert('This page cannot be controlled (internal/extension page). Open the target tab and try again.');
            else if (result.error === 'no-tab') alert('No active tab found.');
            else alert('Failed to start reading (see console).');
          } else setReadingStatus('Reading...');
        }).catch(err => { console.warn('readAloud send err', err); alert('Failed to start reading (see console).'); });
    });
  });

  safeOn(stopBtn, 'click', () => {
    sendMessageToActiveTabWithInject({ action: 'stopReading' }).then((res) => {
      if (!res.ok && res.error === 'unsupported-page') alert('Stop failed: popup cannot control this page.');
    }).catch(()=>{});
    setReadingStatus('Not Reading');
  });

  safeOn(pauseBtn, 'click', () => {
    if (!isReading) { sendMessageToActiveTabWithInject({ action: 'resumeReading' }).then(()=>{}).catch(()=>{}); setReadingStatus('Reading...'); return; }
    if (!isPaused) { sendMessageToActiveTabWithInject({ action: 'pauseReading' }).then(()=>{}).catch(()=>{}); setReadingStatus('Paused'); }
    else { sendMessageToActiveTabWithInject({ action: 'resumeReading' }).then(()=>{}).catch(()=>{}); setReadingStatus('Reading...'); }
  });

  // --- Profiles, saved reads, selection, stats code unchanged except it uses the updated send helper where needed
  function updateProfileDropdown(profiles = {}, selectedName = '') { if (!profileSelect) return; profileSelect.innerHTML = '<option value="">Select profile</option>'; for (const name in profiles) { const opt=document.createElement('option'); opt.value=name; opt.textContent=name; profileSelect.appendChild(opt);} if (selectedName) profileSelect.value = selectedName; }
  function saveProfile(name, profile) { chrome.storage.local.get(['profiles'], (res) => { const profiles = res.profiles || {}; profiles[name] = profile; chrome.storage.local.set({ profiles }, () => { chrome.storage.sync.set({ profiles }, () => { alert('Profile saved!'); updateProfileDropdown(profiles, name); }); }); }); }
  chrome.storage.local.get(['profiles'], (res) => updateProfileDropdown(res.profiles || {}));

  safeOn(profileSelect, 'change', (e) => { const name = e.target.value; if (!name) return; chrome.storage.local.get(['profiles'], (res) => { const settings = res.profiles?.[name]; if (settings) setUI(settings); gatherAndSendSettings(); }); });

  safeOn(saveProfileBtn, 'click', () => { const name = prompt('Enter profile name:'); if (!name) return; const profile = gatherSettingsObject(); saveProfile(name, profile); });

  safeOn(exportProfilesBtn, 'click', () => { chrome.storage.local.get(['profiles'], (res) => { const dataStr = JSON.stringify(res.profiles || {}); const blob = new Blob([dataStr], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadProfiles.json'; a.click(); URL.revokeObjectURL(url); }); });

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
              chrome.storage.sync.set({ profiles }, () => { alert('Profiles imported!'); updateProfileDropdown(profiles); });
            });
          });
        } catch (err) { alert('Failed to import profiles: invalid JSON.'); }
      };
      reader.readAsText(file);
    });
  }

  safeOn(resetStatsBtn, 'click', () => { if (!confirm('Reset all reading stats?')) return; chrome.runtime.sendMessage({ action: 'resetStats' }, () => { loadStats(); setReadingStatus('Not Reading'); }); });

  function renderSavedList() {
    chrome.storage.local.get(['savedReads'], (res) => {
      const list = (res.savedReads || []).slice().reverse();
      if (!savedListEl) return;
      savedListEl.innerHTML = '';
      if (!list.length) { savedListEl.textContent = 'No saved items yet.'; return; }
      list.forEach(item => {
        const row = document.createElement('div');
        row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.marginBottom='6px';
        const left = document.createElement('div'); left.style.flex='1'; left.style.marginRight='8px';
        const title = document.createElement('div'); title.textContent = item.title || (item.text||'').slice(0,60) || 'Saved item'; title.style.fontSize='13px'; title.style.fontWeight='600'; left.appendChild(title);
        const sub = document.createElement('div'); sub.textContent = item.url ? (new URL(item.url)).hostname : ''; sub.style.fontSize='11px'; sub.style.opacity='0.7'; left.appendChild(sub);
        const actions = document.createElement('div');
        const openBtn = document.createElement('button'); openBtn.textContent='Read'; openBtn.style.marginRight='6px';
        openBtn.addEventListener('click', () => {
          chrome.storage.sync.set({ voice: voiceSelect?.value||'', rate: Number(rateInput?.value||1), pitch: Number(pitchInput?.value||1) }, () => {
            sendMessageToActiveTabWithInject({ action:'readAloud', highlight:false, _savedText: item.text }).then(()=>setReadingStatus('Reading...')).catch(()=>{});
          });
        });
        const openSpeed = document.createElement('button'); openSpeed.textContent='Speed'; openSpeed.style.marginRight='6px';
        openSpeed.addEventListener('click', () => {
          const chunk = Number(chunkSizeInput?.value || 3);
          const r = Number(speedRateInput?.value || 1);
          sendMessageToActiveTabWithInject({ action:'speedRead', text:item.text, chunkSize:chunk, rate:r }).then(()=>setReadingStatus('Reading...')).catch(()=>{});
        });
        const delBtn = document.createElement('button'); delBtn.textContent='Delete';
        delBtn.addEventListener('click', () => { if (!confirm('Delete saved item?')) return; chrome.storage.local.get(['savedReads'], (r2)=>{ const arr = r2.savedReads||[]; const filtered = arr.filter(x=>x.id!==item.id); chrome.storage.local.set({ savedReads: filtered }, () => renderSavedList()); }); });
        actions.appendChild(openBtn); actions.appendChild(openSpeed); actions.appendChild(delBtn);
        row.appendChild(left); row.appendChild(actions); savedListEl.appendChild(row);
      });
    });
  }

  safeOn(saveSelectionBtn, 'click', () => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) { alert('No active page found.'); return; }
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) { alert('Cannot access selection on internal or extension pages.'); return; }
      try {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const s = window.getSelection(); const text = s ? s.toString() : ''; return { text: text, title: document.title || '', url: location.href || '' }; } }, (results) => {
          if (chrome.runtime.lastError) {
            console.warn('getSelection exec failed', chrome.runtime.lastError);
            const msg = (chrome.runtime.lastError.message || '').toLowerCase();
            if (msg.includes('must request permission') || msg.includes('cannot access contents of the page')) {
              alert('Extension lacks permission to access this site. Open the page, click the extension icon, and allow access for this site (or enable host permissions in chrome://extensions).');
            } else alert('Failed to fetch selection (see console).');
            return;
          }
          const result = results && results[0] && results[0].result;
          if (!result || !result.text || !result.text.trim()) { alert('No selection found on the page.'); return; }
          const item = { id: Date.now() + '-' + Math.floor(Math.random()*1000), text: result.text, title: result.title || result.text.slice(0,80), url: result.url, ts: Date.now() };
          chrome.storage.local.get(['savedReads'], (r) => { const arr = r.savedReads || []; arr.push(item); chrome.storage.local.set({ savedReads: arr }, () => { alert('Selection saved!'); renderSavedList(); }); });
        });
      } catch (err) { console.warn('save selection scripting failed', err); alert('Failed to fetch selection (see console).'); }
    });
  });

  safeOn(openSavedManagerBtn, 'click', () => { renderSavedList(); });

  async function generateStatsImageAndDownload() {
    try {
      const res = await new Promise(resolve => chrome.storage.local.get(['stats'], resolve));
      const stats = (res && res.stats) || { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
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
        if (!blob) { alert('Failed to generate image.'); return; }
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ClarityReadStats.png'; a.click(); URL.revokeObjectURL(url);
        if (navigator.clipboard && window.ClipboardItem) {
          try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); alert('Image saved and copied to clipboard!'); }
          catch (e) { console.warn('clipboard write failed', e); alert('Image downloaded. Clipboard copy was not available.'); }
        } else { alert('Image downloaded. To copy to clipboard, allow clipboard access or use the downloaded file.'); }
      });
    } catch (e) { console.warn('generateStatsImage failed', e); alert('Failed to generate stats image (see console).'); }
  }

  safeOn(shareStatsBtn, 'click', generateStatsImageAndDownload);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg?.action) { sendResponse({ ok: false }); return true; }
    if (msg.action === 'statsUpdated') loadStats();
    else if (msg.action === 'readingStopped') setReadingStatus('Not Reading');
    else if (msg.action === 'readingPaused') setReadingStatus('Paused');
    else if (msg.action === 'readingResumed') setReadingStatus('Reading...');
    sendResponse({ ok: true });
    return true;
  });

  loadStats();
  initPerSiteUI();
  renderSavedList();
  setTimeout(loadVoicesIntoSelect, 300);
});
