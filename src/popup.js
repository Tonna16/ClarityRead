document.addEventListener('DOMContentLoaded', () => {


  const DEBUG = false;
  const $ = id => document.getElementById(id) || null;
  const safeLog = (...a) => { try { if (DEBUG) console.log('[ClarityRead popup]', ...a); } catch (e) {} };
  const safeWarn = (...a) => { try { if (DEBUG) console.warn('[ClarityRead popup]', ...a); } catch (e) {} };
  const safeInfo = (...a) => { try { if (DEBUG) console.info('[ClarityRead popup]', ...a); } catch (e) {} };

  let opLock = false;
   const FONT_FAMILY_OPTIONS = new Map([
    ['system', 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'],
    ['opendyslexic', '"OpenDyslexic", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'],
    ['lexend', '"Lexend", "Trebuchet MS", "Segoe UI", sans-serif'],
    ['atkinson', '"Atkinson Hyperlegible", "Segoe UI", sans-serif'],
    ['comic-sans', '"Comic Sans MS", "Comic Sans", cursive'],
    ['verdana', 'Verdana, Geneva, sans-serif'],
    ['arial', 'Arial, Helvetica, sans-serif'],
    ['georgia', 'Georgia, "Times New Roman", serif']
  ]);

  async function init() {
   return;
  }

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

function wireAiActionPreferences() {
  const gradeSel = document.getElementById('rewriteGradeSelect');
  const aiModeSel = document.getElementById('aiModeSelect');
  const allowedGrades = new Set(['3', '6', '9']);
  const allowedModes = new Set(['local', 'remote']);

  chrome.storage.local.get(['rewriteGradeLevel', 'aiModePreference'], (res) => {
    const grade = String((res && res.rewriteGradeLevel) || '6');
    const mode = String((res && res.aiModePreference) || 'local');
    if (gradeSel) gradeSel.value = allowedGrades.has(grade) ? grade : '6';
    if (aiModeSel) aiModeSel.value = allowedModes.has(mode) ? mode : 'local';
  });

  if (gradeSel) {
    gradeSel.addEventListener('change', () => {
      const grade = allowedGrades.has(String(gradeSel.value)) ? String(gradeSel.value) : '6';
      chrome.storage.local.set({ rewriteGradeLevel: grade }, () => {
        toast(`Rewrite level: grade ${grade}`, 'info', 1500);
      });
    });
  }

  if (aiModeSel) {
    aiModeSel.addEventListener('change', () => {
      const mode = allowedModes.has(String(aiModeSel.value)) ? String(aiModeSel.value) : 'local';
      chrome.storage.local.set({ aiModePreference: mode }, () => {
        const detail = mode === 'remote'
          ? 'Remote mode may send selected text to your configured AI endpoint.'
          : 'Local-only mode keeps text in your browser extension.';
        toast(detail, 'info', 3500);
      });
    });
  }
}

function getRemoteAiErrorMessage(remoteError) {
  const code = String(remoteError && remoteError.code || '');
  if (code === 'remote-endpoint-missing') {
    return 'Remote AI endpoint is missing. Add it in Remote AI settings, or switch AI mode to Local only.';
  }
  if (code === 'remote-auth-missing-key') {
    return 'Remote AI auth is configured without an API key/token. Add one or switch auth type to None.';
  }
  if (code === 'remote-auth-failed') {
    return 'Remote AI authentication failed (401/403). Verify your auth type and credentials.';
  }
  if (/^remote-status-\d+$/.test(code)) {
    return `Remote AI returned a non-success status (${(remoteError && remoteError.status) || code.replace('remote-status-', '')}). Check server logs and response schema.`;
  }
  return (remoteError && remoteError.message) || 'Remote AI request failed. Using local fallback.';
}

function showRemoteAiErrorToast(remoteError) {
  if (!remoteError) return;
  toast(getRemoteAiErrorMessage(remoteError), 'error', 7000);
}

function wireRemoteAiSettings() {
  const endpointInput = document.getElementById('remoteAiEndpointInput');
  const authTypeSelect = document.getElementById('remoteAiAuthTypeSelect');
  const apiKeyInput = document.getElementById('remoteAiApiKeyInput');
  const enabledToggle = document.getElementById('remoteAiEnabledToggle');
  const testBtn = document.getElementById('testRemoteAiConnectionBtn');
  const allowedAuthTypes = new Set(['none', 'bearer', 'x-api-key']);

  chrome.storage.local.get(['remoteAiEndpoint', 'remoteAiAuthType', 'remoteAiApiKey', 'featureFlags'], (res) => {
    if (endpointInput) endpointInput.value = String((res && res.remoteAiEndpoint) || '');
    if (authTypeSelect) {
      const authType = String((res && res.remoteAiAuthType) || 'none').toLowerCase();
      authTypeSelect.value = allowedAuthTypes.has(authType) ? authType : 'none';
    }
    if (apiKeyInput) apiKeyInput.value = String((res && res.remoteAiApiKey) || '');
    if (enabledToggle) enabledToggle.checked = !!(res && res.featureFlags && res.featureFlags.remoteAiEnabled);
  });

  if (endpointInput) {
    endpointInput.addEventListener('change', () => {
      const endpoint = String(endpointInput.value || '').trim();
      chrome.storage.local.set({ remoteAiEndpoint: endpoint }, () => {
        toast(endpoint ? 'Remote endpoint saved.' : 'Remote endpoint cleared.', 'info', 1800);
      });
    });
  }

  if (authTypeSelect) {
    authTypeSelect.addEventListener('change', () => {
      const authTypeRaw = String(authTypeSelect.value || 'none').toLowerCase();
      const authType = allowedAuthTypes.has(authTypeRaw) ? authTypeRaw : 'none';
      chrome.storage.local.set({ remoteAiAuthType: authType }, () => {
        toast(`Remote auth type: ${authType}`, 'info', 1800);
      });
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', () => {
      chrome.storage.local.set({ remoteAiApiKey: String(apiKeyInput.value || '').trim() }, () => {
        toast('Remote API key/token saved locally.', 'info', 1800);
      });
    });
  }

  if (enabledToggle) {
    enabledToggle.addEventListener('change', async () => {
      const settings = await getFromStorage(['featureFlags']);
      const featureFlags = Object.assign({}, settings && settings.featureFlags ? settings.featureFlags : {});
      featureFlags.remoteAiEnabled = !!enabledToggle.checked;
      await setToStorage({ featureFlags });
      toast(enabledToggle.checked ? 'Remote AI feature flag enabled.' : 'Remote AI feature flag disabled.', 'info', 2200);
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      const pid = createProgressToast('Testing remote AI endpoint…', 20000);
      try {
        const res = await new Promise((resolve) => chrome.runtime.sendMessage({ action: 'testRemoteAiConnection' }, (r) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
          resolve(r || { ok: false, error: 'no-response' });
        }));
        if (res && res.ok) {
          toast('Remote AI endpoint test succeeded.', 'success', 3000);
        } else {
          showRemoteAiErrorToast({ code: (res && res.error) || 'remote-test-failed', status: res && res.status, message: res && res.userMessage });
        }
      } finally {
        clearProgressToast();
        if (pid) Toasts.clear(pid);
        testBtn.disabled = false;
      }
    });
  }
}


async function queryOverlayStateOnActiveTab() {
  try {
    const res = await sendMessageToActiveTabWithInject({ action: 'clarity_query_overlay' });
    const r = normalizeBgResponse(res);
    const btn = document.getElementById('focusModeBtn');
        const textEl = getFocusModeTextEl();
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



  function show(msg, type = 'info', ttl = 3500) {
    try {
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
      if (DEBUG) safeLog()('Toasts.show error', e);
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
    } catch (e) { if (DEBUG) safeLog()('Toasts.clear error', e); }
  }

  function clearAll() {
    try {
      for (const [id, el] of Array.from(instances)) {
        try { el.remove(); } catch(e) {}
        instances.delete(id);
      }
      const c = document.getElementById(containerId);
      if (c) c.remove();
    } catch (e) { if (DEBUG) safeLog()('Toasts.clearAll error', e); }
  }

  function showProgress(msg = 'Working...', timeoutMs = 60000) {
    return show(msg, 'info', timeoutMs);
  }

  return { show, clear, clearAll, showProgress };
})();

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
    s.onerror = (e) => { safeLog()('Failed to load Chart.js from', src, e); if (typeof callback === 'function') callback(); };
    document.head.appendChild(s);
    safeLog('ensureChartReady injected script', src);
  }

const requiredIds = ['reflowToggle','contrastToggle','invertToggle','readBtn','pauseBtn','stopBtn','pagesRead','timeRead','avgSession','statsChart','voiceSelect'];  const elPresence = requiredIds.reduce((acc, id) => (acc[id]=!!document.getElementById(id), acc), {});
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
   const fontFamilySelect = $('fontFamilySelect');
  const speedToggle = $('speedToggle');
  const chunkSizeInput = $('chunkSize');
  const speedRateInput = $('speedRate');

  const saveSelectionBtn = $('saveSelectionBtn');
  const openSavedManagerBtn = $('openSavedManagerBtn');
  const savedListEl = $('savedList');
  const shareStatsBtn = $('shareStatsBtn');

  
function getFocusModeTextEl() {
  const btn = document.getElementById('focusModeBtn');
  if (!btn) return null;
  return btn.querySelector('.btn-text') || btn.querySelector('.action-text') || null;
}


chrome.runtime.onMessage.addListener((msg) => {
  try {
    const btn = document.getElementById('focusModeBtn');
    const textEl = getFocusModeTextEl();    if (!btn) return;
    if (msg && (msg.action === 'clarity_overlay_state')) {
      if (msg.overlayActive) { btn.classList.add('active'); if (textEl) textEl.textContent = `Close ${_focusModeOriginalText}`; }
      else { btn.classList.remove('active'); if (textEl) textEl.textContent = _focusModeOriginalText; }
      return;
    }

    // fallback: any Not Reading state should un-toggle the button
    if (msg && msg.action === 'readingStopped') {
      btn.classList.remove('active');
      if (textEl) textEl.textContent = _focusModeOriginalText;
      return;
    }
  } catch(e) { safeLog('onMessage popup error', e); }
});


async function applyFontSizeToActiveTab(sizePx) {
  try {
    const sizeNum = Number(sizePx) || DEFAULTS.fontSize || 16;

    // Disable the slider while we work to avoid races
    if (fontSizeSlider) { fontSizeSlider.disabled = true; }
    if (fontSizeValue) {
      try { fontSizeValue.textContent = `${sizeNum}px`; } catch(e){}
    }

    // Attempt, with a small retry for transient 'in-flight' responses
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

      // If background requests host permission -> run permission request flow here
      if (normalized && normalized.error === 'no-host-permission' && normalized.permissionPattern) {
        toast('Requesting permission to modify this site — approve the prompt in the browser.', 'info', 6000);

        // Ask background to request permission (use the tab's URL)
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

        attempt = 0; // reset retry counter after permission
        continue;
      }

      // If the error is transient 'in-flight', wait small delay and retry
      if (normalized && normalized.error === 'in-flight' && attempt <= MAX_RETRIES) {
        safeLog('applyFontSizeToActiveTab got in-flight; retrying', attempt);
        await new Promise(r => setTimeout(r, 180 + attempt * 120));
        continue;
      }

      // Generic failure - bubble message to the user and stop retrying
            if (toastForBgError('clarity_apply_font_size', normalized)) break;
      toast('Unable to apply font on this page. Allow ClarityRead to access the site.', 'error', 6000);
      break;
    }

    // final state handling
    if (lastNormalized && lastNormalized.ok) {
      // success already toasted above
    } else if (lastNormalized && lastNormalized.error && lastNormalized.error !== 'in-flight') {
      safeLog('applyFontSizeToActiveTab final failure', lastNormalized);
      // error already notified via toast above
    }

    return lastNormalized || { ok: false };
  } catch (e) {
    safeLog('applyFontSizeToActiveTab error', e);
    toast('Failed to apply font (see console).', 'error', 6000);
    return { ok: false, error: String(e) };
  } finally {
    // always re-enable slider
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

// When wiring the slider, debounce the apply call (200ms is a good start)
const fontSlider = document.getElementById('fontSizeSlider');
if (fontSlider) {
  const debouncedApply = debounce((v) => applyFontSizeToActiveTab(v), 200);
  fontSlider.addEventListener('input', (ev) => {
    const v = ev.target.value;
    debouncedApply(v);
  });
  // keep immediate apply for change if you prefer final commit
  fontSlider.addEventListener('change', (ev) => {
    const v = ev.target.value;
    applyFontSizeToActiveTab(v);
  });
}





 
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
      // try insert before known buttons, otherwise append
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

  // preserve the original focus button text (only the action-text, not icon)
 const _focusModeOriginalText = (focusModeBtn && (focusModeBtn.querySelector('.btn-text') || focusModeBtn.querySelector('.action-text')))
    ? (focusModeBtn.querySelector('.btn-text') || focusModeBtn.querySelector('.action-text')).textContent
    : 'Focus Mode';
  const DEFAULTS = { dys: false, reflow: false, contrast: false, invert: false, fontSize: 20, fontFamily: 'system' };  const safeOn = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  let isReading = false;
  let isPaused = false;
  let currentHostname = '';
  let settingsDebounce = null;
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

    function getGoogleDocsUnsupportedMessage(action = '') {
    if (action === 'toggleFocusMode' || action === 'clarity_apply_font_size' || action === 'applySettings') {
      return 'This display setting is not available directly on Google Docs yet. Use the extension reader view for style controls.';
    }
    if (action === 'stopReading' || action === 'pauseReading' || action === 'resumeReading') {
      return 'Playback controls are not available on Google Docs unless reading was started in the extension reader view.';
    }
    return 'This action is not available directly on Google Docs yet. Use Read Aloud, Speed Read, or Summarize from the extension view.';
  }

  function toastForBgError(action, response) {
    const r = normalizeBgResponse(response) || {};
    if (r.error === 'unsupported-on-google-docs') {
      toast(r.userFriendlyMessage || getGoogleDocsUnsupportedMessage(action), 'info', 7000);
      return true;
    }
    return false;
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



async function sendMessageToActiveTabWithInject(message, _retry = 0) {
  // If opLock is active, wait briefly for it to clear (helps slider & concurrent quick UI events)
  const WAIT_MS = 1600; // total wait before giving up
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
          // If popup is active extension page, attempt to pick a web tab for the action
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

            // If background requests host permission, popup logic (or caller) will handle retry/prompt
            if (res && res.ok === false && res.error === 'no-host-permission' && _retry < 1) {
              // bubble up the permission result to caller for a nicer UX
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

  function initPerSiteUI() {
    safeLog('initPerSiteUI start');
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      safeLog('initPerSiteUI tab', tab && { id: tab.id, url: tab.url });
      if (!tab || !tab.url) {
chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','fontFamily','voice','rate','pitch','highlight'], (syncRes) => {
          safeLog('initPerSiteUI no tab -> using sync defaults', syncRes);
          setUI({
            dys: syncRes.dys ?? DEFAULTS.dys,
            reflow: syncRes.reflow ?? DEFAULTS.reflow,
            contrast: syncRes.contrast ?? DEFAULTS.contrast,
            invert: syncRes.invert ?? DEFAULTS.invert,
                        fontFamily: syncRes.fontFamily ?? DEFAULTS.fontFamily,
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
   chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','fontFamily','voice','rate','pitch','highlight'], (syncRes) => {
          setUI({            dys: syncRes.dys ?? DEFAULTS.dys,
            reflow: syncRes.reflow ?? DEFAULTS.reflow,
            contrast: syncRes.contrast ?? DEFAULTS.contrast,
            invert: syncRes.invert ?? DEFAULTS.invert,
            fontSize: syncRes.fontSize ?? DEFAULTS.fontSize,
                        fontFamily: syncRes.fontFamily ?? DEFAULTS.fontFamily,
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
 chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize','fontFamily','voice','rate','pitch','highlight'], (syncRes) => {            safeLog('initPerSiteUI no siteSettings, using sync', syncRes);
            setUI({
              dys: syncRes.dys ?? DEFAULTS.dys,
              reflow: syncRes.reflow ?? DEFAULTS.reflow,
              contrast: syncRes.contrast ?? DEFAULTS.contrast,
              invert: syncRes.invert ?? DEFAULTS.invert,
              fontSize: syncRes.fontSize ?? DEFAULTS.fontSize,
                            fontFamily: syncRes.fontFamily ?? DEFAULTS.fontFamily,
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
     if (fontFamilySelect) {
      const selection = settings.fontFamily ?? DEFAULTS.fontFamily;
      fontFamilySelect.value = FONT_FAMILY_OPTIONS.has(selection) ? selection : DEFAULTS.fontFamily;
    }
  }

  function clamp(n, lo, hi) {
    n = Number(n) || 0;
    if (isNaN(n)) n = lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function gatherSettingsObject() {
     const fontFamilyValue = fontFamilySelect?.value ?? DEFAULTS.fontFamily;
    const fontFamily = FONT_FAMILY_OPTIONS.has(fontFamilyValue) ? fontFamilyValue : DEFAULTS.fontFamily;
    const dysFromFont = fontFamily === 'opendyslexic';
    const obj = {
      dys: dysToggle?.checked ?? dysFromFont,      reflow: reflowToggle?.checked ?? false,
      contrast: contrastToggle?.checked ?? false,
      invert: invertToggle?.checked ?? false,
      fontSize: fontSizeSlider ? Number(fontSizeSlider.value) : DEFAULTS.fontSize,
            fontFamily,
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
        // after successful applySettings response, also ensure overlay font updates immediately in case overlay is open
try {
  if (res && res.ok) {
sendMessageToActiveTabWithInject({ action: 'applySettings', dys: settings.dys, fontSize: settings.fontSize, fontFamily: settings.fontFamily }).catch(() => {});  }
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
    safeOn(fontFamilySelect, 'change', () => gatherAndSendSettings({ showToast: true }));
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
                    if (toastForBgError('speedRead', r)) return;
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
                if (toastForBgError('readAloud', r)) return;
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
     if (!r || !r.ok) {
      if (!toastForBgError('stopReading', r) && r && r.error === 'unsupported-page') toast('Stop failed: cannot control this page.', 'error', 4500);
    } else toast('Stopped reading.', 'success', 1200);
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
        else if (!toastForBgError('pauseReading', r)) toast('Pause failed.', 'error');
    } else {
      pauseBtn.disabled = true;
      const r2 = await sendMessageToActiveTabWithInject({ action: 'resumeReading' });
      pauseBtn.disabled = false;
      safeLog('resumeReading response', r2);
      if (normalizeBgResponse(r2)?.ok) setReadingStatus('Reading...');
else if (!toastForBgError('resumeReading', r2)) toast('Resume failed.', 'error');    }
  });

  // Focus mode toggle — preserve original label (emoji) by only mutating .action-text
// Update the focusModeBtn click handler:
safeOn(focusModeBtn, 'click', async () => {
  safeLog('focusModeBtn clicked');
  focusModeBtn.disabled = true;
  
  // Show helpful loading message
   const originalText = getFocusModeTextEl()?.textContent || 'Focus Mode';
  const textEl = getFocusModeTextEl();
  if (textEl) textEl.textContent = 'Opening...';
  
  const res = await sendMessageToActiveTabWithInject({ action: 'toggleFocusMode' });
  focusModeBtn.disabled = false;
  
  safeLog('toggleFocusMode response', res);
  const r = normalizeBgResponse(res);
  
 if (!r || !r.ok) {
      if (textEl) textEl.textContent = originalText;

       if (toastForBgError('toggleFocusMode', r)) {
        // already explained via toast
      } else if (r && r.error === 'no-host-permission') {
        toast('Permission required. Click the extension icon on the page to grant access.', 'error', 7000);
      } else if (r && r.error === 'no-text') {
        toast('No readable text found. Try selecting text or opening an article page.', 'error', 6000);
      } else if (r && r.error === 'tab-discarded') {
        toast('Page is inactive. Reload and try again.', 'error', 5000);
      } else {
        toast('Could not open Focus Mode. Try refreshing the page.', 'error', 5000);
    }
  } else {
    if (textEl) {
      textEl.textContent = r.overlayActive ? 'Close Focus Mode' : 'Open Focus Mode';
    }
    
    const msg = r.overlayActive 
      ? '🎯 Focus Mode active! Enjoy distraction-free reading.' 
      : 'Focus Mode closed.';
    toast(msg, 'success', 2500);
  }
});



let IDF_MAP = Object.create(null);

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
// Updated to accept an optional opts param: { idfBoost, titleBoost }
// Old callers (4 args) still work.
function sentenceScoreLocal(sentence, tfGlobal, positionWeight = 1, titleTokens = new Set(), opts = {}) {
  const tokens = tokenizeForScoring(sentence);
  if (!tokens.length) return 0;
  let score = 0;

  const idfBoost = (typeof opts.idfBoost === 'number') ? opts.idfBoost : 0.7; // default multiplier already used historically
  const titleBoost = (typeof opts.titleBoost === 'number') ? opts.titleBoost : 1.2;

  for (const t of tokens) {
    const tf = tfGlobal[t] || 0;
    const idf = (IDF_MAP && typeof IDF_MAP[t] !== 'undefined') ? IDF_MAP[t] : 1;
    // Use idfBoost from opts to alter how important rare terms are
    score += tf * (1 + idfBoost * idf);
  }

  // normalize by length
  score = score / Math.sqrt(Math.max(1, tokens.length));

  // title overlap (bump)
  let titleOverlap = 0;
  for (const t of tokens) if (titleTokens.has(t)) titleOverlap++;
  score += titleOverlap * titleBoost;

  // heuristics (unchanged)
  if (/\b(18|19|20)\d{2}\b/.test(sentence)) score *= 1.08;
  if (/[€$\£¥¢%]/.test(sentence)) score *= 1.06;
  if (/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(sentence)) score *= 1.05;

  const nonAlphaRatio = (sentence.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, sentence.length);
  if (nonAlphaRatio > 0.25) score *= 0.7;
  if (/^[A-Z0-9\W]{5,40}$/.test(sentence) && sentence === sentence.toUpperCase()) score *= 0.6;
  if (sentence.length < 18) score *= 0.7;

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
  let cleaned = scrubInputForSummarizer(rawText);
  if (!cleaned) return '';

  // Normalize glued fragments BEFORE scoring
  try {
    cleaned = cleaned.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
    cleaned = cleaned.replace(/([^\s])By([A-Z])/g, '$1 By $2');
    cleaned = cleaned.replace(/(Updated on|updated on)([A-Z0-9])/g, '$1 $2');
  } catch (e) {}

  const cfg = summarizerConfigForPref(userPref || 'normal');

  // Compute final sentence count (deterministic scaling)
  const plannedK = (typeof maxSentencesArg === 'number' && maxSentencesArg > 0)
    ? Math.min(25, Math.max(1, Math.floor(maxSentencesArg)))
    : computeFinalKForPref(cleaned, userPref);

  safeLog && safeLog('summarizeTextLocal', { userPref, plannedK, rawLen: cleaned.length });

  // Fast path for very short text
  if (cleaned.length < 220) {
    const sents = splitIntoSentencesLocal(cleaned);
    if (sents.length <= plannedK) return sents.join(' ');
    const tf = buildTermFrequenciesLocal(cleaned);
    const scored = sents.map((sen, idx) => ({
      sentence: sen,
      score: sentenceScoreLocal(sen, tf, ((idx === 0 || idx === sents.length-1) ? 1.12 : 1), new Set(), { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost })
    }));
    scored.sort((a,b) => b.score - a.score);
    const chosen = scored.slice(0, plannedK).map(x => x.sentence);
    const ordered = sents.filter(s => chosen.includes(s));
    return (ordered.length ? ordered.join(' ') : chosen.join(' ')).trim();
  }

  // Main extraction logic
  const paragraphs = splitIntoParagraphsLocal(cleaned);
  const globalTF = buildTermFrequenciesLocal(cleaned);
  const firstLine = (cleaned.split('\n')[0] || '').trim();
  const titleTokens = new Set(tokenizeForScoring(firstLine).slice(0, 12));

  const paraSummaries = [];
  for (const p of paragraphs) {
    if (!p) continue;
    const sents = splitIntoSentencesLocal(p);
    if (!sents.length) continue;
    const scored = sents.map((sen, idx) => ({ 
      sentence: sen, 
      score: sentenceScoreLocal(sen, globalTF, (idx === 0 ? 1.08 : (idx === sents.length - 1 ? 1.03 : 1)), titleTokens, { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost }) 
    }));
    scored.sort((a,b) => b.score - a.score);

    const longPara = p.length > 800;
    const topCount = longPara ? Math.min(3, Math.max(1, Math.ceil(scored.length * 0.33))) : Math.min(2, Math.max(1, Math.ceil(scored.length * 0.20)));
    for (let i = 0; i < Math.min(topCount, scored.length); i++) {
      const candidate = scored[i].sentence.trim();
      if (candidate && candidate.length > 18) paraSummaries.push(candidate);
    }
    if (paraSummaries.join(' ').length > Math.max(CHUNK_SIZE_CHARS || 10000, 3 * (CHUNK_SIZE_CHARS || 10000))) break;
  }

  let allCandidates = [];
  if (!paraSummaries.length) allCandidates = splitIntoSentencesLocal(cleaned);
  else {
    const combined = paraSummaries.join(' ');
    allCandidates = splitIntoSentencesLocal(combined);
    if (!allCandidates.length) allCandidates = paraSummaries.slice();
  }

  const scoredCandidates = allCandidates.map((sen, idx) => ({ 
    sentence: sen, 
    score: sentenceScoreLocal(sen, globalTF, (idx === 0 || idx === allCandidates.length - 1) ? 1.05 : 1, titleTokens, { idfBoost: cfg.idfBoost, titleBoost: cfg.titleBoost }) 
  }));
  scoredCandidates.sort((a,b) => b.score - a.score);

  const candidatesList = scoredCandidates.map(x => x.sentence);
  const scoresList = scoredCandidates.map(x => ({ sentence: x.sentence, score: x.score }));

  const lambda = (typeof cfg.lambda === 'number') ? cfg.lambda : 0.62;
  const k = Math.max(1, Math.min(plannedK, Math.max(1, candidatesList.length)));

  let selected = mmrSelectLocal(candidatesList, scoresList, k, lambda);
  if (selected.length > k) selected = selected.slice(0, k);

  // Fallback if selection is tiny
  const joinedSel = selected.join(' ');
  if (!joinedSel || (joinedSel.length / Math.max(1, cleaned.length) > 0.95) || selected.length === 0) {
    const firstSents = splitIntoSentencesLocal(cleaned).slice(0, k);
    if (firstSents && firstSents.length) return firstSents.join(' ').trim();
  }

  const docSents = splitIntoSentencesLocal(cleaned);
  const orderedSelected = docSents.filter(s => selected.includes(s));
  let final = (orderedSelected.length ? orderedSelected.join(' ') : selected.join(' ')).trim();

  // --- Replace incorrect post-filter that references `final` with this block ---
try {
  // Use the summary we produced above as source text for post-filter
  let final = (summary || '').toString();

  const parts = final.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
  const filtered = parts.filter(s => {
    if (s.length < 12) return false;  // only drop very tiny fragments
    if (/^(Outline|History|See also|References|External links|Category|vte|Navigation|Contents|Jump to)\b/i.test(s)) return false;
    const nonAlphaRatio = (s.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, s.length);
    if (s.length >= 30 && nonAlphaRatio > 0.35) return false;
    if (/^[\u2000-\u206F\u2E00-\u2E7F\W]+$/.test(s)) return false;
    return true;
  });

  if (filtered.length >= Math.max(1, Math.floor(plannedK * 0.6))) {
    final = filtered.join(' ');
  }

  // replace summary with final for display
  summary = final;
} catch (e) { safeLog('post-filter threw', e); }


  try {
    const finalSents = splitIntoSentencesLocal(final);
    return finalSents.slice(0, Math.max(1, Math.min(k, finalSents.length))).join(' ').trim();
  } catch (e) {
    return final.slice(0, 800);
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
    // remove big wiki css blobs and repeated brace junk
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

function summarizerConfigForPref(pref = 'normal') {
  const cfg = {
    concise: { 
      baseSentences: 2,  
      lambda: 0.72,      
      titleBoost: 1.5, 
      minSentenceLen: 20,  // relaxed from 22
      idfBoost: 1.0
    },
    normal: { 
      baseSentences: 4, 
      lambda: 0.62, 
      titleBoost: 1.3, 
      minSentenceLen: 18,  // relaxed from 28
      idfBoost: 1.2
    },
    detailed: { 
      baseSentences: 7, 
      lambda: 0.52,      // more diversity for detailed
      titleBoost: 1.1, 
      minSentenceLen: 12,  // relaxed from 14
      idfBoost: 1.5
    }
  };
  return cfg[pref] || cfg.normal;
}



function computeFinalKForPref(text = '', pref = 'normal') {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 0;
  const cfg = summarizerConfigForPref(pref);
  
  // More aggressive scaling: roughly 1 sentence per X words
  let wordsPerSentence = 150; // normal
  if (pref === 'concise') wordsPerSentence = 250;  // fewer sentences
  else if (pref === 'detailed') wordsPerSentence = 100; // more sentences
  
  // Calculate: minimum is baseSentences, but scale up with doc length
  const calculated = Math.round(words / wordsPerSentence);
  const k = Math.max(cfg.baseSentences, calculated);
  
  // Clamp to reasonable bounds (1-25)
  return Math.min(25, Math.max(1, k));
}


function computeAdaptiveMax(text = '', pref = 'normal') {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 0;
  const cfg = summarizerConfigForPref(pref);
  // base scaled by words; small docs still get at least baseSentences
  let base = cfg.baseSentences;
  const per = (pref === 'detailed') ? 350 : (pref === 'concise' ? 700 : 500);
  base += Math.floor(words / per);
  // clamp to 1..25 but allow larger docs more room
  const cap = Math.min(25, Math.max(1, Math.round(base)));
  return Math.max(1, cap);
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
  return new Promise(async (resolve) => {
    try {
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId }, // no allFrames
          func: () => {
            try {
              if (window.__clarity_read_extract && typeof window.__clarity_read_extract === 'function') {
                const r = window.__clarity_read_extract();
                return { ok: !!r && !!r.text, text: (r && r.text) ? String(r.text) : '', title: (r && r.title) ? r.title : document.title || '', url: location.href || '' };
              }
              const prefer = ['article','main','[role="main"]','#content','#primary','.post','.article','#mw-content-text'];
              for (const s of prefer) {
                const el = document.querySelector(s);
                if (el && el.innerText && el.innerText.length > 120) {
                  const clone = el.cloneNode(true);
                  ['script','style','iframe','picture','svg','video','form','input','button','aside','nav','footer','header','table'].forEach(sel => {
                    try { clone.querySelectorAll(sel).forEach(n => n.remove()); } catch(e){}
                  });
                  const txt = (clone.innerText || '').replace(/\[\d+\]/g,' ').replace(/\s{2,}/g,' ').trim();
                  return { ok: !!txt, text: txt, title: document.title || '', url: location.href || '' };
                }
              }
              const bodyText = (document.body && document.body.innerText) ? String(document.body.innerText).replace(/\s{2,}/g,' ').trim() : '';
              return { ok: !!bodyText, text: bodyText || '', title: document.title || '', url: location.href || '' };
            } catch (ex) { return { ok: false, error: String(ex), url: location.href || '' }; }
          }
        }, (res) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, reason: 'exec-failed', detail: chrome.runtime.lastError.message });
          try {
            const r0 = Array.isArray(res) && res[0] && res[0].result ? res[0].result : (res && res.result ? res.result : null);
            if (r0 && r0.text && r0.text.trim()) return resolve({ ok: true, text: String(r0.text).trim(), title: r0.title || '', url: r0.url || '' });
            // top frame didn't return good content -> fall through to all-frames
          } catch (e) {
            safeLog && safeLog('top-frame exec parse error, falling back to frames', e);
          }

          try {
            chrome.scripting.executeScript({
              target: { tabId: tabId, allFrames: true },
              func: () => {
                function getMainNodeLocal() {
                  try {
                    const prefer = ['article','main','[role="main"]','#content','#primary','.post','.article','#mw-content-text','.mw-parser-output'];
                    for (const s of prefer) {
                      const el = document.querySelector(s);
                      if (el && el.innerText && el.innerText.length > 200) return el;
                    }
                    const candidates = Array.from(document.querySelectorAll('article, main, section, div, p'))
                      .filter(el => el && el.innerText && el.innerText.trim().length > 200)
                      .map(el => ({ el, len: (el.innerText || '').trim().length }));
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
                  if (!main) return { ok: false, text: '' , title: document.title || '', url: location.href || '' };
                  const clone = main.cloneNode(true);
                  ['script','style','iframe','picture','svg','video','form','input','button','aside','nav','footer','header','table'].forEach(sel => {
                    try { clone.querySelectorAll(sel).forEach(n => n.remove()); } catch(e){}
                  });
                  const txt = (clone.innerText||'').replace(/\[\d+\]/g,' ').replace(/\s{2,}/g,' ').trim();
                  return { ok: !!txt, text: txt || '', title: document.title || '', url: location.href || '' };
                } catch (ex) { return { ok: false, text: '', title: document.title || '', url: location.href || '' }; }
              }
            }, (res2) => {
              if (chrome.runtime.lastError) return resolve({ ok: false, reason: 'exec-frames-failed', detail: chrome.runtime.lastError.message });
              try {
                if (!Array.isArray(res2) || !res2.length) return resolve({ ok: false, reason: 'exec-frames-no-result', detail: res2 });

                try {
                  // normalize results (each entry may be like {frameId, result:{text,title,url}})
                  const frameEntries = res2.map(e => {
                    try {
                      const frameId = (e && typeof e.frameId !== 'undefined') ? e.frameId : null;
                      const r = (e && e.result) ? e.result : null;
                      return { frameId, result: r };
                    } catch (ex) { return null; }
                  }).filter(Boolean);

                  try {
                    const dbg = frameEntries.map(fe => ({
                      frameId: fe.frameId,
                      url: (fe.result && fe.result.url) ? fe.result.url : '(no-url)',
                      title: (fe.result && fe.result.title) ? fe.result.title : '(no-title)',
                      textLen: (fe.result && fe.result.text) ? String(fe.result.text).length : 0
                    }));
                    safeLog && safeLog('exec-frames-debug', dbg);
                  } catch(e){}

                  const txtLenOf = (r) => (r && r.text) ? String(r.text).length : 0;
                  const txtStr = (r) => (r && r.text) ? String(r.text).trim() : '';

                  let normTabUrl = null;
                  try { normTabUrl = (new URL(tabUrl || '')).origin + (new URL(tabUrl || '')).pathname; } catch (e) { normTabUrl = null; }

                  if (normTabUrl) {
                    for (const fe of frameEntries) {
                      try {
                        if (!fe.result || !fe.result.url) continue;
                        const u = new URL(fe.result.url);
                        const candidateUrl = u.origin + u.pathname;
                        if (candidateUrl === normTabUrl && txtStr(fe.result)) {
                          return resolve({ ok: true, text: txtStr(fe.result), title: fe.result.title || '', url: fe.result.url || '' });
                        }
                      } catch (e) { /* ignore */ }
                    }
                  }

                  let topOrigin = null;
                  try { topOrigin = (new URL(tabUrl || '')).origin; } catch (e) { topOrigin = null; }
                  if (topOrigin) {
                    let sameOriginBest = null;
                    for (const fe of frameEntries) {
                      const r = fe.result;
                      if (!r || !r.url) continue;
                      try {
                        const origin = (new URL(r.url)).origin;
                        if (origin === topOrigin) {
                          if (!sameOriginBest || txtLenOf(r) > txtLenOf(sameOriginBest)) sameOriginBest = r;
                        }
                      } catch (e) { /* ignore */ }
                    }
                    if (sameOriginBest && txtStr(sameOriginBest)) {
                      return resolve({ ok: true, text: txtStr(sameOriginBest), title: sameOriginBest.title || '', url: sameOriginBest.url || '' });
                    }
                  }

                  try {
                    for (const fe of frameEntries) {
                      if (fe.frameId === 0 && fe.result && txtStr(fe.result)) {
                        return resolve({ ok: true, text: txtStr(fe.result), title: fe.result.title || '', url: fe.result.url || '' });
                      }
                    }
                  } catch (e) { /* ignore */ }

                  let best = null;
                  for (const fe of frameEntries) {
                    const r = fe.result;
                    if (!r) continue;
                    if (!best || txtLenOf(r) > txtLenOf(best)) best = r;
                  }
                  if (best && txtStr(best)) return resolve({ ok: true, text: txtStr(best), title: best.title || '', url: best.url || '' });

                  return resolve({ ok: false, reason: 'exec-frames-empty', detail: frameEntries.map(f => ({ frameId: f.frameId, url: f.result && f.result.url, len: txtLenOf(f.result) })) });
                } catch (e) {
                  safeLog && safeLog('frame selection logic failed', e);
                  return resolve({ ok: false, reason: 'exec-frames-selection-exception', detail: String(e) });
                }
              } catch (e) { return resolve({ ok: false, reason: 'exec-frames-exception', detail: String(e) }); }
            });
          } catch (e) {
            return resolve({ ok: false, reason: 'exec-frames-throw', detail: String(e) });
          }
        });
      } catch (e) {
        return resolve({ ok: false, reason: 'exec-top-throw', detail: String(e) });
      }
    } catch (e) {
      safeLog && safeLog('tryExecuteScriptExtract threw (outer)', e);
      resolve({ ok: false, reason: 'exec-throw', detail: String(e) });
    }
  });
}



  const bgRes = await tryBackgroundExtract();
  if (bgRes.ok) return bgRes;

  // Background either doesn't support it or failed — fall back to executeScript
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





function extractSingleWord(text = '') {
  const words = String(text || '').match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return words.length ? words[0] : '';
}

function localWordDefinition(word = '') {
  const dict = {
    context: 'The information around something that helps explain it.',
    infer: 'To make a smart guess using clues and evidence.',
    summarize: 'To tell the most important points in a shorter way.',
    evidence: 'Facts or details that support an idea.',
    analyze: 'To study something closely to understand it better.'
  };
  const key = String(word || '').toLowerCase();
  return dict[key] || `${word}: A likely meaning based on context is the role this word plays in the sentence around it.`;
}

function rewriteTextGradeLocal(text = '', grade = 6) {
  const target = Number(grade) || 6;
  let out = String(text || '').trim();
  if (!out) return '';
  if (target <= 3) {
    out = out.replace(/\bapproximately\b/gi, 'about')
      .replace(/\butilize\b/gi, 'use')
      .replace(/\btherefore\b/gi, 'so')
      .replace(/\bhowever\b/gi, 'but');
    return out.split(/(?<=[.?!])\s+/).slice(0, 4).join(' ');
  }
  if (target <= 6) {
    return out.replace(/\butilize\b/gi, 'use').replace(/\bfacilitate\b/gi, 'help');
  }
  return out;
}

async function captureActionInputFromPage(options = {}) {
  const requireWord = !!options.requireWord;
  const tab = await findBestWebTab();
  if (!tab || !tab.id || !isWebUrl(tab.url || '')) {
    return { ok: false, error: 'invalid-tab' };
  }

  let text = '';
  let usedSelection = false;
  try {
    const live = await new Promise((resolve) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try { return (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || ''; }
          catch (e) { return ''; }
        }
      }, (res) => {
        if (chrome.runtime.lastError) return resolve('');
        if (Array.isArray(res) && res[0] && typeof res[0].result === 'string') return resolve(res[0].result);
        resolve('');
      });
    });
    if (live && live.trim()) {
      text = live.trim();
      usedSelection = true;
    }
  } catch (e) { safeLog('capture live selection failed', e); }

  if (!text) {
    const full = await fetchCleanPageText(tab.id, tab.url);
    if (full && full.ok && full.text) {
      text = String(full.text || '').trim();
    }
  }

  if (!text) return { ok: false, error: 'no-text', tab };

  if (requireWord) {
    const word = extractSingleWord(text);
    if (!word) return { ok: false, error: 'no-word', tab };
    return { ok: true, tab, word, text, usedSelection };
  }

  return { ok: true, tab, text, usedSelection };
}

async function runQuickAiAction(kind) {
  const explainSelectionBtn = $('explainSelectionBtn');
  const rewriteByGradeBtn = $('rewriteByGradeBtn');
  const defineWordBtn = $('defineWordBtn');
  const rewriteGradeSelect = $('rewriteGradeSelect');

  const btn = kind === 'explainText' ? explainSelectionBtn : (kind === 'rewriteByGrade' ? rewriteByGradeBtn : defineWordBtn);
  if (btn) btn.disabled = true;

  try {
    const input = await captureActionInputFromPage({ requireWord: kind === 'defineWord' });
    if (!input.ok) {
      toast(kind === 'defineWord' ? 'Select a word first, then try Define.' : 'No readable text found on this page.', 'info', 4500);
      return;
    }

    const gradeLevel = Number((rewriteGradeSelect && rewriteGradeSelect.value) || 6) || 6;
    if (kind === 'rewriteByGrade') {
      chrome.storage.local.set({ rewriteGradeLevel: String(gradeLevel) }, () => {});
    }

    const req = {
      action: kind,
      text: input.text,
      word: input.word,
      gradeLevel,
      context: { url: input.tab && input.tab.url ? input.tab.url : '', usedSelection: !!input.usedSelection }
    };

    const pid = createProgressToast('Working on your request…', 60000);
    let res = null;
    try {
      res = await new Promise((resolve) => chrome.runtime.sendMessage(req, (r) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
        resolve(r || { ok: false, error: 'no-response' });
      }));
    } finally {
      clearProgressToast();
      if (pid) Toasts.clear(pid);
    }

    const titleMap = {
      explainText: 'Explanation',
      rewriteByGrade: `Rewritten for grade ${gradeLevel}`,
      defineWord: `Definition: ${input.word}`
    };

    if (res && res.ok && res.output) {
      createSummaryModal(titleMap[kind] || 'Result', res.output);
      if (res.disclosure) toast(res.disclosure, 'info', 5000);
      if (res.remoteError) showRemoteAiErrorToast(res.remoteError);
      return;
    }

    if (res && res.remoteError) showRemoteAiErrorToast(res.remoteError);

    let fallback = '';
    if (kind === 'explainText') {
      fallback = summarizeTextLocal(input.text, 3, 'normal') || input.text.slice(0, 500);
    } else if (kind === 'rewriteByGrade') {
      fallback = rewriteTextGradeLocal(input.text, gradeLevel);
    } else {
      fallback = localWordDefinition(input.word);
    }
    createSummaryModal(`${titleMap[kind] || 'Result'} (Local fallback)`, fallback || 'Feature unavailable right now.');
    toast('Using local fallback for this action.', 'info', 2500);
  } catch (e) {
    safeLog('runQuickAiAction failed', e);
    toast('Action failed. Please try again.', 'error', 3500);
  } finally {
    if (btn) btn.disabled = false;
  }
}

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

try {
  const stored = await new Promise(resolve => chrome.storage.local.get(['clarity_last_selection'], r => resolve(r && r.clarity_last_selection)));
  if (stored && stored.text && stored.ts && ((Date.now() - stored.ts) < 120000) // allow 2 minutes freshness
      && stored.url && stored.url.split('#')[0] === (tab.url || '').split('#')[0]) {
    let liveSel = '';
    try {
      const execRes = await new Promise(res => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try { return (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || ''; }
            catch (e) { return ''; }
          }
        }, (r) => res(r));
      });
      if (Array.isArray(execRes) && execRes[0] && typeof execRes[0].result === 'string') liveSel = execRes[0].result;
      else if (typeof execRes === 'string') liveSel = execRes;
      else if (execRes && execRes.result && typeof execRes.result === 'string') liveSel = execRes.result;
    } catch (e) { safeLog('verify live selection failed', e); }

    if (liveSel && liveSel.trim()) {
      text = stored.text || liveSel.trim();
      usedSelection = true;
      try { chrome.storage.local.remove('clarity_last_selection'); } catch (e) { /* ignore */ }
    } else {
      try { chrome.storage.local.remove('clarity_last_selection'); } catch (e) {}
    }
  }

  if (!text) {
    try {
      const pageSelResult = await new Promise(resolve => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try { return (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || ''; }
            catch (e) { return ''; }
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
        text = selText.trim();
        usedSelection = true;
        try { chrome.storage.local.remove('clarity_last_selection'); } catch (e) {}
      }
    } catch (e) { safeLog('page selection execScript failed', e); }
  }
} catch (e) {
  safeLog('selection handling failed', e);
}

if (!text || !text.trim()) {
  try {
    toast('Please select the text you want summarized, then click Summarize — selecting a paragraph or more works best.', 'info', 7000);
  } catch (e) { safeLog('notify no-selection failed', e); }
  summarizePageBtn.disabled = false;
  return;
}


    if (!text || !text.trim()) {
      toast('No text to summarize — select text on the page or ensure the page has readable content.', 'info');
      summarizePageBtn.disabled = false;
      return;
    }

const pref = await readSummaryPref();

const adaptiveMax = computeAdaptiveMax(text, pref);
const plannedK = (typeof computeFinalKForPref === 'function')
  ? computeFinalKForPref(text, pref)
  : (Math.max(1, Math.round(adaptiveMax))); // fallback if computeFinalKForPref not available

safeLog && safeLog('summary counts', { pref, adaptiveMax, plannedK });

const adaptiveMaxForCall = Math.max(1, Math.min(25, Math.floor(plannedK)));


    const pid = createProgressToast('Generating summary — please wait...', 60000);
    let summary = '(no summary produced)';
    let summarySource = 'local-fallback';
    let disclosure = '';
    try {
      const aiRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'summarizeText',
          text,
          detailPref: pref,
          context: { url: tab && tab.url ? tab.url : '', usedSelection: !!usedSelection }
        }, (r) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
          resolve(r || { ok: false, error: 'no-response' });
        });
      });

      if (aiRes && aiRes.ok && aiRes.output && aiRes.source !== 'local-fallback') {
        summary = aiRes.output;
        summarySource = aiRes.source || 'local';
        disclosure = aiRes.disclosure || '';
      } else {
        if (aiRes && aiRes.disclosure) disclosure = aiRes.disclosure;
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

          // drop very short nav lines
          text = text.split(/\n/).filter(line => {
            const t = line.trim();
            if (!t) return false;
            if (t.length < 20 && /^(Read|More|Share|Related|Jump|Contents|Table of contents|Menu|Skip to|Explore|Diet & Nutrition)/i.test(t)) return false;
            if (/^(\/|#|\-|\*|:){2,}/.test(t)) return false;
            return true;
          }).join('\n');
        } catch (e) { safeLog('prescrub threw', e); }

        if (typeof summarizeTextLocal === 'function') {
          summary = summarizeTextLocal(text, adaptiveMaxForCall, pref) || summary;
          summarySource = 'local-fallback';
          safeLog && safeLog('summarizer invoked', { usedK: adaptiveMaxForCall, pref });
        } else {
          summary = '(summarizer not available)';
          summarySource = 'local-fallback';
        }
      }
    } catch (e) {
      safeLog('summarizer error', e);
    } finally {
      clearProgressToast();
      if (pid) Toasts.clear(pid);
    }

try {
  const parts = final.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
  const filtered = parts.filter(s => {
    if (s.length < 12) return false;  // only drop very tiny fragments
    
   if (/^(Outline|History|See also|References|External links|Category|vte|Navigation|Contents|Jump to)\b/i.test(s)) return false;
    
    const nonAlphaRatio = (s.replace(/[A-Za-z0-9]/g,'').length) / Math.max(1, s.length);
    if (s.length >= 30 && nonAlphaRatio > 0.35) return false;
    
    if (/^[\u2000-\u206F\u2E00-\u2E7F\W]+$/.test(s)) return false;
    
    return true;
  });
  
  if (filtered.length >= Math.max(1, Math.floor(plannedK * 0.6))) {
    final = filtered.join(' ');
  }
} catch (e) { safeLog('post-filter threw', e); }
   
    const modeSubtitle = usedSelection ? 'Selection' : 'Full page';
    const actualSentences = (summary || '').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean).length || 0;
    const sourceLabel = summarySource === 'remote' ? 'Remote' : (summarySource === 'local' ? 'Local' : 'Local fallback');
    const headerTitle = `Page Summary — ${actualSentences} sentence${actualSentences === 1 ? '' : 's'} (${modeSubtitle}, ${sourceLabel})`;
    createSummaryModal(headerTitle, summary);

    toast('Summary ready', 'success', 3000);
    if (disclosure) toast(disclosure, 'info', 5000);
    if (aiRes && aiRes.remoteError) showRemoteAiErrorToast(aiRes.remoteError);

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

try {
  let btn = $('summarizePageBtn');
  if (btn) {
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = $('summarizePageBtn');
    if (newBtn) safeOn(newBtn, 'click', summarizeCurrentPageOrSelection_AiAware);
  }
} catch (e) { safeLog('hook summarize button failed', e); }

try {
  const explainBtn = $('explainSelectionBtn');
  const rewriteBtn = $('rewriteByGradeBtn');
  const defineBtn = $('defineWordBtn');
  if (explainBtn) safeOn(explainBtn, 'click', () => runQuickAiAction('explainText'));
  if (rewriteBtn) safeOn(rewriteBtn, 'click', () => runQuickAiAction('rewriteByGrade'));
  if (defineBtn) safeOn(defineBtn, 'click', () => runQuickAiAction('defineWord'));
} catch (e) { safeLog('hook quick action buttons failed', e); }


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

// create only if not present
if (!exportSettingsBtn) {
  exportSettingsBtn = document.createElement('button');
  exportSettingsBtn.id = 'exportSettingsBtn';
  exportSettingsBtn.className = 'ghost';
  exportSettingsBtn.textContent = 'Export Settings';
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
      const keys = ['dys','reflow','contrast','invert','fontSize','fontFamily','voice','rate','pitch','highlight'];      const valid = keys.some(k => k in imported);
      if (!valid) { toast('Invalid settings file.', 'error'); importSettingsInput.value = ''; return; }

      const toApply = {};
      keys.forEach(k => { if (k in imported) toApply[k] = imported[k]; });

      const merged = Object.assign({}, gatherSettingsObject(), toApply);
      setUI(merged);

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

function normalizeForCompare(txt) {
  // Unicode-aware normalization: remove diacritics, punctuation, collapse whitespace, lowercase
  try {
    return String(txt || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')                 // remove diacritics
      .toLowerCase()
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'")      // normalize quotes
      .replace(/[^\p{L}\p{N}\s]/gu, '')                // remove punctuation (unicode aware)
      .replace(/\s+/g, ' ')
      .trim();
  } catch (e) {
    // fallback simpler normalizer if Unicode property escapes not supported
    return String(txt || '').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
  }
}

function dedupeSavedArray(arr) {
  // Keep the most recent item (by ts) for each normalized text key.
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const map = new Map();
  for (const it of arr) {
    if (!it || !it.text) continue;
    const key = normalizeForCompare(it.text);
    if (!key) continue;
    const existing = map.get(key);
    // prefer the item with the larger timestamp (newest)
    if (!existing || (Number(it.ts || 0) > Number(existing.ts || 0))) {
      map.set(key, it);
    }
  }
  // produce an array ordered oldest -> newest (keeps consistent storage ordering)
  return Array.from(map.values()).sort((a, b) => (Number(a.ts || 0) - Number(b.ts || 0)));
}

// Copy-paste ready: replace your current renderSavedList() with this
function renderSavedList() {
  try {
    const container = document.getElementById('savedList');
    if (!container) return;
    container.innerHTML = ''; // clear

    chrome.storage.local.get(['savedReads'], (res) => {
      try {
        let arr = Array.isArray(res.savedReads) ? res.savedReads.slice() : [];

        // final dedupe at render time (defensive) - keep newest per normalized key
        const cleaned = dedupeSavedArray(arr);
        // If cleaned differs from stored, persist cleaned to avoid duplicates after reload
        if (JSON.stringify(cleaned) !== JSON.stringify(arr)) {
          chrome.storage.local.set({ savedReads: cleaned }, () => {
            safeLog('renderSavedList: cleaned savedReads persisted', { before: arr.length, after: cleaned.length });
            arr = cleaned.slice();
            _renderListFromArray(arr);
          });
        } else {
          _renderListFromArray(arr);
        }
      } catch (e) {
        safeLog('renderSavedList inner render error', e);
        container.innerHTML = '<div class="saved-empty">No saved selections</div>';
      }
    });
  } catch (e) {
    safeLog('renderSavedList error', e);
  }

  // local helper to actually build DOM from an array (oldest -> newest expected in storage)
  function _renderListFromArray(storageArr) {
    try {
      const list = (Array.isArray(storageArr) ? storageArr.slice().reverse() : []); // show newest first
      const container = document.getElementById('savedList');
      if (!container) return;
      container.innerHTML = '';

      if (!list.length) {
        container.innerHTML = '<div class="saved-empty">No saved selections</div>';
        return;
      }

      for (const it of list) {
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

        // Summarize button - unchanged
        const sumBtn = document.createElement('button');
        sumBtn.textContent = 'Summarize';
        sumBtn.className = 'btn btn-secondary';
        sumBtn.addEventListener('click', async () => {
          sumBtn.disabled = true;
          try {
            const pref = await readSummaryPref();
            const adaptiveMax = computeAdaptiveMax(it.text || '', pref);
            createProgressToast('Generating summary — please wait...', 60000);
            let out = '(no summary)';
            try { out = summarizeTextLocal(it.text || '', adaptiveMax, pref) || out; } finally { clearProgressToast(); }
            createSummaryModal(`Saved Summary — ${((out||'').split(/(?<=[.?!])\s+/).filter(Boolean)||[]).length} sentences`, out);
          } catch (e) { safeLog('saved item summarize failed', e); toast('Failed to summarize', 'error'); }
          sumBtn.disabled = false;
        });

      // Read button: include live TTS prefs so saved reads use same settings as article reads
const playBtn = document.createElement('button');
playBtn.textContent = 'Read';
playBtn.className = 'btn btn-secondary';
playBtn.addEventListener('click', async () => {
  playBtn.disabled = true;
  try {
    // Gather UI values if present (the popup may expose these controls)
    const uiVoice = (typeof voiceSelect !== 'undefined' && voiceSelect && voiceSelect.value) ? voiceSelect.value : null;
    const uiRate  = (typeof rateInput  !== 'undefined' && rateInput  && rateInput.value)  ? Number(rateInput.value)  : null;
    const uiPitch = (typeof pitchInput !== 'undefined' && pitchInput && pitchInput.value) ? Number(pitchInput.value) : null;
    const uiHighlight = (typeof highlightCheckbox !== 'undefined' && highlightCheckbox && typeof highlightCheckbox.checked !== 'undefined')
      ? !!highlightCheckbox.checked
      : null;

    // If any UI value missing, load stored defaults from sync
    let store = {};
    if (uiVoice === null || uiRate === null || uiPitch === null || uiHighlight === null) {
      store = await new Promise(resolve => chrome.storage.sync.get(['voice','rate','pitch','highlight'], resolve)) || {};
    }

    const voice = uiVoice !== null ? uiVoice : (store.voice || '');
    const rate  = (uiRate !== null && !isNaN(uiRate)) ? uiRate : (typeof store.rate !== 'undefined' ? Number(store.rate) : 1);
    const pitch = (uiPitch !== null && !isNaN(uiPitch)) ? uiPitch : (typeof store.pitch !== 'undefined' ? Number(store.pitch) : 1);
    const highlight = uiHighlight !== null ? !!uiHighlight : (!!store.highlight);

    // If the popup has a "speed read" toggle and it's enabled, send speedRead
    if (typeof speedToggle !== 'undefined' && speedToggle && speedToggle.checked) {
      // chunk size and speed rate fallbacks
      const chunkSize = Number((typeof chunkSizeInput !== 'undefined' && chunkSizeInput && chunkSizeInput.value) ? chunkSizeInput.value : 3);
      const speedRate = Number((typeof speedRateInput !== 'undefined' && speedRateInput && speedRateInput.value) ? speedRateInput.value : rate);

      // send speedRead via runtime (background will forward to a tab)
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'speedRead',
          text: it.text || '',
          chunkSize,
          rate: speedRate,
          voice,
          _source: 'savedRead'
        }, (resp) => {
          if (chrome.runtime.lastError) safeLog('speedRead sendMessage lastError', chrome.runtime.lastError);
          resolve(resp);
        });
      });

      toast('Started speed-read of saved item.', 'success');
      playBtn.disabled = false;
      return;
    }

    // Normal read path: send full tts prefs so content script uses the same settings
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'readAloud',
        _savedText: it.text || '',
        voice,
        rate,
        pitch,
        highlight,
        _source: 'savedRead'
      }, (resp) => {
        if (chrome.runtime.lastError) safeLog('readAloud (saved) sendMessage lastError', chrome.runtime.lastError);
        resolve(resp);
      });
    });

    toast('Started reading saved item.', 'success');
  } catch (e) {
    safeLog('play saved read failed', e);
    toast('Failed to start saved read.', 'error');
  } finally {
    playBtn.disabled = false;
  }
});


        // Delete button
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'btn btn-link';
        delBtn.addEventListener('click', () => {
          chrome.storage.local.get(['savedReads'], (r) => {
            try {
              let arr2 = Array.isArray(r.savedReads) ? r.savedReads.slice() : [];
              arr2 = arr2.filter(x => x.id !== it.id);
              chrome.storage.local.set({ savedReads: arr2 }, () => { toast('Saved item deleted', 'info'); renderSavedList(); });
            } catch (err) {
              safeLog('delete saved item failed', err);
            }
          });
        });

        actions.appendChild(sumBtn);
        actions.appendChild(playBtn);
        actions.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(actions);
        container.appendChild(row);
      }
    } catch (e) {
      safeLog('renderSavedList DOM build error', e);
      container.innerHTML = '<div class="saved-empty">No saved selections</div>';
    }
  }
}




try {
  renderSavedList();
} catch (e) {
    safeLog('initial renderSavedList failed', e);
}


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

// --- Copy diagnostics UI (optional) ---
// Add this near the end of your popup initialization (only if you want the button)
// attach handlers to existing static button (no DOM creation)
(function addCopyDiagnosticsButton() {
  try {
    const btn = document.getElementById('copyDiagnosticsBtn');
    if (!btn) { safeWarn('copyDiagnosticsBtn not found - skipping attach'); return; }

    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        const manifest = (chrome && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : {};
        const version = manifest.version || manifest.version_name || 'unknown';
        const ua = navigator.userAgent || '';

        const stats = await new Promise((res) => {
          try { chrome.storage.local.get(['stats'], r => res(r && r.stats ? r.stats : {})); }
          catch (e) { res({}); }
        });

        const diag = {
          version,
          userAgent: ua,
          statsSummary: {
            totalPagesRead: stats.totalPagesRead || 0,
            totalTimeReadSec: stats.totalTimeReadSec || 0,
            sessions: stats.sessions || 0
          },
          popupUrl: window.location.href,
          timestamp: new Date().toISOString()
        };

        const text = JSON.stringify(diag, null, 2);

        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          if (typeof toast === 'function') toast('Diagnostics copied to clipboard. Paste into your issue/email.', 'success', 4000);
          else alert('Diagnostics copied to clipboard. Paste into your issue/email.');
        } else {
          window.prompt('Diagnostics (copy manually):', text);
        }
      } catch (e) {
        safeWarn('copyDiagnosticsBtn failed', e);
        if (typeof toast === 'function') toast('Failed to collect diagnostics.', 'error', 3000);
        else alert('Failed to collect diagnostics: ' + (e && e.message ? e.message : String(e)));
      } finally {
        btn.disabled = false;
      }
    });

    safeLog('attached diagnostics handler.');
  } catch (e) { safeWarn('addCopyDiagnosticsButton error', e); }
})();






try { renderSavedList(); } catch (e) { safeLog('initial renderSavedList failed', e); }


safeOn(saveSelectionBtn, 'click', async () => {
  safeLog('saveSelectionBtn clicked');
  if (!saveSelectionBtn) return;
  saveSelectionBtn.disabled = true;
  
  // Helper: normalize text for duplicate detection
  const normalize = (txt) => {
    return (txt || '').trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  };
  
  // Helper: save with deduplication (unified)
  const saveWithDedup = (selectionObj) => {
    if (!selectionObj || !selectionObj.text || !selectionObj.text.trim()) {
      toast('No selection to save.', 'info');
      saveSelectionBtn.disabled = false;
      return;
    }
    
    chrome.storage.local.get(['savedReads'], (r) => {
      const arr = r.savedReads || [];
      
      const textNorm = normalize(selectionObj.text);
      const isDuplicate = arr.some(existing => {
        const existingNorm = normalize(existing.text);
        if (existingNorm === textNorm) return true;
        if (existingNorm.length > 100 && textNorm.length > 100) {
          if (existingNorm.slice(0, 200) === textNorm.slice(0, 200)) return true;
        }
        const lengthRatio = Math.min(existingNorm.length, textNorm.length) / Math.max(existingNorm.length, textNorm.length);
        if (lengthRatio > 0.92 && existingNorm.slice(0, 150) === textNorm.slice(0, 150)) return true;
        return false;
      });
      
      if (isDuplicate) {
        toast('This selection is already saved.', 'info', 2500);
        saveSelectionBtn.disabled = false;
        return;
      }
      
      const item = { 
        id: `${Date.now()}-${Math.floor(Math.random()*99999)}`,
        text: selectionObj.text.trim(),
        title: (selectionObj.title || selectionObj.text.slice(0,80)).trim(), 
        url: selectionObj.url, 
        ts: Date.now() 
      };
      
      arr.push(item);
      
      // Final dedup pass
      const dedupedArr = [];
      const seen = new Set();
      for (const it of arr.reverse()) {
        const norm = normalize(it.text);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          dedupedArr.unshift(it);
        }
      }
      
      chrome.storage.local.remove('clarity_last_selection', () => {
        chrome.storage.local.set({ savedReads: dedupedArr }, () => {
          toast('Selection saved.', 'success');
          safeLog('selection saved (after dedup)', item.id, { totalSaved: dedupedArr.length });
          renderSavedList();
          saveSelectionBtn.disabled = false;
        });
      });
    });
  };
  
  try {
    const resRaw = await sendMessageToActiveTabWithInject({ action: 'getSelection' });
    safeLog('getSelection via helper', resRaw);

    const res = normalizeBgResponse(resRaw);
    if (res && res.ok === false && res.error === 'no-host-permission') {
      toast('ClarityRead lacks permission to access this site. Open the page and allow access.', 'error', 7000);
      saveSelectionBtn.disabled = false;
      return; //Exit completely
    }

    const selection = extractSelection(resRaw);
    safeLog('selection from helper', selection && { textLen: selection.text && selection.text.length, title: selection.title });

    if (selection && selection.text && selection.text.trim()) {
      saveWithDedup(selection);
      return; 
    }

    const tab = await findBestWebTab();
    safeLog('saveSelection fallback tab', tab && { id: tab.id, url: tab.url });
    if (!tab || !tab.id) {
      toast('No active page found.', 'error');
      saveSelectionBtn.disabled = false;
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const s = window.getSelection();
        const text = s ? s.toString() : '';
        return { text: text, title: document.title || '', url: location.href || '' };
      }
    }, (results) => {
      if (chrome.runtime.lastError) {
        safeLog('scripting.executeScript failed', chrome.runtime.lastError);
        const msg = (chrome.runtime.lastError.message || '').toLowerCase();
        if (msg.includes('must request permission') || msg.includes('cannot access contents of the page')) {
          toast('Extension lacks permission to access this site.', 'error', 7000);
        } else {
          toast('Failed to fetch selection (see console).', 'error');
        }
        saveSelectionBtn.disabled = false;
        return;
      }
      
      const result = results && results[0] && results[0].result;
      if (!result || !result.text || !result.text.trim()) {
        toast('No selection found on the page.', 'info');
        safeLog('scripting returned no selection');
        saveSelectionBtn.disabled = false;
        return;
      }
      
      // Use the same unified deduplication
      saveWithDedup({
        text: result.text,
        title: result.title || result.text.slice(0,80),
        url: result.url
      });
    });
    
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

// ✅ FIRST-TIME USER ONBOARDING (in popup UI, not webpage)
(function initOnboarding() {
  chrome.storage.local.get(['clarity_onboarded'], (res) => {
    if (res.clarity_onboarded) return;
    
    // Create overlay in popup window
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      backdrop-filter: blur(4px);
    `;
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      box-shadow: 0 25px 80px rgba(0,0,0,0.4);
      animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    
    modal.innerHTML = `
      <style>
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      </style>
      <div style="text-align: center;">
        <div style="width: 80px; height: 80px; margin: 0 auto 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);">
          <span style="font-size: 40px;">✨</span>
        </div>
        <h2 style="margin: 0 0 16px; font-size: 24px; color: #111; font-weight: 700;">Welcome to ClarityRead! 🎉</h2>
        <div style="color: #555; font-size: 15px; line-height: 1.7; margin-bottom: 24px; text-align: left;">
          <p style="margin: 12px 0;"><strong>📖 Quick Start:</strong></p>
          <ol style="margin: 8px 0; padding-left: 24px; line-height: 1.8;">
            <li>Open any article or webpage</li>
            <li>Select text (or let ClarityRead auto-detect)</li>
            <li>Click <strong>"Read"</strong> to start text-to-speech</li>
            <li>Use <strong>"Focus Mode"</strong> for distraction-free reading</li>
          </ol>
        </div>
        <button id="onboarding-cta" style="
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #0b0c13ff 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 10px;
          font-weight: 700;
          cursor: pointer;
          font-size: 16px;
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
          transition: transform 0.2s, box-shadow 0.2s;
        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 25px rgba(102, 126, 234, 0.5)';" onmouseout="this.style.transform=''; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.4)';">
          Got it, let's go! →
        </button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    document.getElementById('onboarding-cta').addEventListener('click', () => {
      chrome.storage.local.set({ clarity_onboarded: true });
      overlay.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => overlay.remove(), 300);
    });
  });
})();


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

  safeLog('popup init: loadStats, initPerSiteUI, renderSavedList');
  loadStats();
  initPerSiteUI();
  wireSummaryDetailSelect();
  wireAiActionPreferences();
  wireRemoteAiSettings();
  renderSavedList();
  setTimeout(() => { safeLog('delayed loadVoicesIntoSelect'); loadVoicesIntoSelect(); }, 300);
  // after the init() function body ends, add:
init().catch(e => safeWarn('popup init failed', e));

});


