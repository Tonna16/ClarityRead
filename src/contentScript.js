function startClarityReadContentScript() {
   if (window.__clarityread_contentScriptLoaded) {
    // safeLog isn't defined yet at the very top of this function in some environments,
    // so use console.debug as a safe fallback to avoid throwing.
    try { console.debug('[ClarityRead contentScript] already loaded.'); } catch(e){}
    return;
  }


  // --- Early guard: detect hosted/canvas editors and bail early with a friendly toast
function isHostedOrCanvasEditor() {
  try {
    const host = (location.hostname || '').toLowerCase();
    // Block well-known hosted editors / document canvas renderers
    if (/docs\.google\.com|drive\.google\.com/.test(host)) return { unsupported: true, reason: 'google-docs', message: 'Google Docs content is protected and cannot be accessed by ClarityRead.' };
    if (/officeapps\.live\.com|office\.com|microsoftonline\.com|microsoftsharepoint\.com/.test(host)) return { unsupported: true, reason: 'office-online', message: 'Microsoft Office Online pages are not supported.' };
    if (/canva\.com|figma\.com|notion\.so|scribd\.com|acrobat\.adobe\.com/.test(host)) return { unsupported: true, reason: 'hosted-editor', message: 'This editor or viewer is not supported by ClarityRead.' };

    // Quick PDF / viewer detection (many PDF viewers render text into canvas or special containers)
    if (/\.pdf$/.test(location.pathname) || /pdfjs|viewer\.html|webviewer/.test((location.pathname + location.search + location.hash).toLowerCase())) {
      return { unsupported: true, reason: 'pdf-viewer', message: 'This PDF viewer or embedded PDF is not supported.' };
    }

    // Simple canvas-detection heuristic: many canvas-heavy pages have few selectable characters in body
    const canvasCount = (document.querySelectorAll && document.querySelectorAll('canvas').length) || 0;
    const bodyTextLen = (document.body && (document.body.innerText || '').trim().length) || 0;
    if (canvasCount > 0 && bodyTextLen < 200) {
      return { unsupported: true, reason: 'canvas-rendered', message: 'This page appears to render text via canvas rather than selectable text.' };
    }

    // Some heavy editors use kix/canvas DOM structures (Google Docs etc.) — guard by element presence
    if (document.querySelector('.kix-zoomdocumentplugin-outer, .kix-page, .kix-appview-outer, .docs-texteventtarget-iframe')) {
      return { unsupported: true, reason: 'kix-canvas', message: 'This editor is rendered using a canvas-like editor; ClarityRead cannot access the content.' };
    }

    return { unsupported: false };
  } catch (e) { return { unsupported: false }; }
}


try {
  const _hosted = isHostedOrCanvasEditor();
  if (_hosted && _hosted.unsupported) {
    // Show a single toast for the session (best-effort; won't throw if toast not injected)
    try {
      if (!window.__clarityread_restricted_toast_shown) {
        window.__clarityread_restricted_toast_shown = true;
        if (typeof ClarityReadToast !== 'undefined' && ClarityReadToast.showToast) {
          ClarityReadToast.showToast(_hosted.message || 'This editor is not supported by ClarityRead.', { type: 'info', timeout: 12000 });
        } else {
          // best-effort console fallback when toast not available
          console.info('[ClarityRead] unsupported editor detected:', _hosted.message || _hosted.reason);
        }
      }
    } catch (e) {}
    // Stop initialization early for these pages
    return;
  }
} catch (e) { /* if detection fails, continue gracefully */ }


  try {
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) {
      // don't override an existing chrome object if present
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {
        // minimal no-op onMessage API
        onMessage: { addListener: function () { /* no-op */ } },
        sendMessage: function () { /* no-op */ }
      };
      window.chrome.storage = window.chrome.storage || {
        local: {
          set: function () { /* no-op */ },
          get: function (_keys, cb) { if (typeof cb === 'function') try { cb({}); } catch(e){} }
        },
        sync: {
          get: function (_keys, cb) { if (typeof cb === 'function') try { cb({}); } catch(e){} }
        }
      };
      // optional debug
      try { console.debug('[ClarityRead] shimbed chrome.runtime/storage for safety'); } catch(_) {}
    }
  } catch (e) {
    // fail silently — never let shim throw
    try { console.debug('[ClarityRead] chrome shim failed', e); } catch(_) {}
  }




 (function() {
  if (window.__clarity_reflow_installed) return;
  window.__clarity_reflow_installed = false;

  const REFLOW_STYLE_ID = 'clarityreflow-style';
  let _prevBodyFontSize = null;
  let _prevMainNode = null;
  let _prevMainNodeFontSize = null;
  let _prevMainNodeLineHeight = null;

  function ensureReflowStyle() {
    try {
      if (document.getElementById(REFLOW_STYLE_ID)) return;
      const st = document.createElement('style');
      st.id = REFLOW_STYLE_ID;
      st.type = 'text/css';

      st.textContent = `
:root { --clarity-font-size: 20px; --clarity-line-height: 1.5; --readeasy-font-size: 20px; }

/* Apply reflow only to likely article containers and their descendants */
html.clarityreflow-active article,
html.clarityreflow-active main,
html.clarityreflow-active [role="main"],
html.clarityreflow-active .article,
html.clarityreflow-active .post,
html.clarityreflow-active .entry-content,
html.clarityreflow-active .mw-parser-output,
html.clarityreflow-active #content,
html.clarityreflow-active #primary,
html.clarityreflow-active .page-content,
html.clarityreflow-active .article-body,
html.clarityreflow-active .article-content,
html.readeasy-reflow article,
html.readeasy-reflow main,
html.readeasy-reflow [role="main"],
html.readeasy-reflow .article,
html.readeasy-reflow .post,
html.readeasy-reflow .entry-content,
html.readeasy-reflow .mw-parser-output,
html.readeasy-reflow #content,
html.readeasy-reflow #primary,
html.readeasy-reflow .page-content,
html.readeasy-reflow .article-body,
html.readeasy-reflow .article-content {
  max-width: 760px !important;
  margin: 20px auto !important;
  line-height: var(--clarity-line-height) !important;
  padding: 0 24px !important;
  word-break: break-word !important;
  overflow-wrap: break-word !important;
  box-sizing: border-box !important;
  font-size: var(--clarity-font-size, var(--readeasy-font-size)) !important;
  transition: all 0.25s cubic-bezier(0.4,0,0.2,1) !important;
}

/* Ensure paragraphs/lists inside those containers inherit sizing/spacing */
html.clarityreflow-active article p,
html.clarityreflow-active article ul,
html.clarityreflow-active article ol,
html.readeasy-reflow article p,
html.readeasy-reflow article ul,
html.readeasy-reflow article ol,
html.clarityreflow-active .entry-content p,
html.readeasy-reflow .entry-content p,
html.clarityreflow-active .article-body p,
html.readeasy-reflow .article-body p {
  font-size: inherit !important;
  line-height: inherit !important;
  margin-bottom: 1.2em !important;
}

/* headings scale modestly relative to the set size (prevents huge headings) */
html.clarityreflow-active h1,
html.readeasy-reflow h1,
html.clarityreflow-active h2,
html.readeasy-reflow h2,
html.clarityreflow-active h3,
html.readeasy-reflow h3 {
  font-size: calc(var(--clarity-font-size, var(--readeasy-font-size)) * 1.15) !important;
  line-height: 1.25 !important;
}

/* keep non-article UI mostly untouched (avoid global star selectors) */
/* overlay styles are handled separately by the content script's overlay code */
`;

      try { (document.head || document.documentElement).appendChild(st); } catch(e) { document.documentElement.appendChild(st); }
    } catch (e) { /* ignore */ }
  }

  // Expose helper so other code can call ensureReflowStyle or apply CSS variables
  window.__clarity_reflow = window.__clarity_reflow || {};
  window.__clarity_reflow.ensureReflowStyle = ensureReflowStyle;



    function applyClarityFontSize(px) {
      try {
        ensureReflowStyle();
        let v = Number(px) || 20;
        v = Math.max(10, Math.min(48, Math.round(v))); // clamp

        try {
          if (_prevBodyFontSize === null) {
            _prevBodyFontSize = (document.body && document.body.style && document.body.style.fontSize) ? document.body.style.fontSize : null;
          }
        } catch (e) { _prevBodyFontSize = null; }

        document.documentElement.style.setProperty('--clarity-font-size', v + 'px');
        document.documentElement.style.setProperty('--readeasy-font-size', v + 'px');

        // supportive line height
        const lh = (1.25 + Math.min(0.6, (v - 14) / 80)).toFixed(2);
        document.documentElement.style.setProperty('--clarity-line-height', lh);

        document.documentElement.classList.add('clarityreflow-active');
        document.documentElement.classList.add('clarityread-reflow');
        document.documentElement.classList.add('readeasy-reflow');

        // set body inline for sites that read inline font-size (best-effort)
        try { document.body.style.fontSize = v + 'px'; } catch(e) {}

        try {
          const main = (typeof getMainNode === 'function') ? getMainNode() : null;
          if (main && main instanceof Element) {
            if (!_prevMainNode) {
              _prevMainNode = main;
              _prevMainNodeFontSize = main.style && main.style.fontSize ? main.style.fontSize : null;
              _prevMainNodeLineHeight = main.style && main.style.lineHeight ? main.style.lineHeight : null;
            } else if (_prevMainNode !== main) {
              // if main node changed, try to restore previous then re-capture
              try {
                if (_prevMainNode && typeof _prevMainNode === 'object') {
                  if (_prevMainNodeFontSize) _prevMainNode.style.fontSize = _prevMainNodeFontSize;
                  else _prevMainNode.style.removeProperty('font-size');
                  if (_prevMainNodeLineHeight) _prevMainNode.style.lineHeight = _prevMainNodeLineHeight;
                  else _prevMainNode.style.removeProperty('line-height');
                }
              } catch(e) {}
              _prevMainNode = main;
              _prevMainNodeFontSize = main.style && main.style.fontSize ? main.style.fontSize : null;
              _prevMainNodeLineHeight = main.style && main.style.lineHeight ? main.style.lineHeight : null;
            }
            try {
              main.style.fontSize = v + 'px';
              main.style.lineHeight = lh;
            } catch(e){}
          }
        } catch(e){}

        // update overlay font if present
        try {
          const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay');
          if (overlay) overlay.style.fontSize = v + 'px';
        } catch(e){}

        return { ok: true, size: v };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    function removeClarityReflow() {
      try {
        // remove classes
        document.documentElement.classList.remove('clarityreflow-active');
        document.documentElement.classList.remove('clarityread-reflow');
        document.documentElement.classList.remove('readeasy-reflow');

        // remove variables
        document.documentElement.style.removeProperty('--clarity-font-size');
        document.documentElement.style.removeProperty('--readeasy-font-size');
        document.documentElement.style.removeProperty('--clarity-line-height');

        // restore previous inline body font-size if we changed it
        try {
          if (_prevBodyFontSize !== null) {
            if (typeof _prevBodyFontSize === 'string' && _prevBodyFontSize.length) document.body.style.fontSize = _prevBodyFontSize;
            else document.body.style.removeProperty('font-size');
          } else {
            try { document.body.style.removeProperty('font-size'); } catch(e){}
          }
        } catch(e){}

        // restore mainNode inline styles if we changed them
        try {
          if (_prevMainNode && (_prevMainNode instanceof Element)) {
            try {
              if (_prevMainNodeFontSize) _prevMainNode.style.fontSize = _prevMainNodeFontSize;
              else _prevMainNode.style.removeProperty('font-size');
              if (_prevMainNodeLineHeight) _prevMainNode.style.lineHeight = _prevMainNodeLineHeight;
              else _prevMainNode.style.removeProperty('line-height');
            } catch(e){}
          } else {
            // ensure we at least remove any remaining inline font-size from the main element that may have been created
            try {
              const main = (typeof getMainNode === 'function') ? getMainNode() : null;
              if (main && main instanceof Element) {
                main.style.removeProperty('font-size');
                main.style.removeProperty('line-height');
              }
            } catch(e){}
          }
        } catch(e){}

        // overlay revert
        try {
          const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay');
          if (overlay) { overlay.style.fontSize = ''; overlay.style.fontFamily = ''; }
        } catch(e){}

        // clear saved main overrides
        _prevMainNode = null;
        _prevMainNodeFontSize = null;
        _prevMainNodeLineHeight = null;

        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    // expose for debug/manual
    window.ClarityRead = window.ClarityRead || {};
    window.ClarityRead.applyClarityFontSize = applyClarityFontSize;
    window.ClarityRead.removeClarityReflow = removeClarityReflow;

    // message listener for reflow control
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.action) return;
        if (msg.action === 'clarity_apply_font_size') {
          const res = applyClarityFontSize(msg.size);
          sendResponse(res);
          return true;
        }
        if (msg.action === 'clarity_remove_reflow') {
          const r = removeClarityReflow();
          sendResponse(r);
          return true;
        }
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e) }); } catch(e2) {}
      }
      return false;
    });

    // ensure style exists early
    ensureReflowStyle();
  })();

  

 
  let currentUtterance = null;
  let readTimer = null;
  let readStartTs = null;
  let accumulatedElapsed = 0;
  let pendingSecondsForSend = 0;
  let lastStatsSendTs = 0;
  let highlightSpans = [];
  let highlightIndex = 0;
  let selectionRestore = null;
  let cumLengths = [];
  let fallbackTicker = null;
  let fallbackTickerRunning = false;
  let overlayActive = false;
  let overlayTextSplice = null;
let __clarityread_nav_prevent_handler = null;


  let errorFallbackAttempted = false;
  let stoppedAlready = false;
  let speedChunks = null;
  let speedIndex = 0;
  let speedActive = false;
  let sessionId = 0; // incremental session id to guard against races
  
  let lastSentState = 'Not Reading'; // 'Reading...', 'Paused', 'Not Reading'
let __lastReadFingerprint = null;
let __lastReadTs = 0;
function __simpleHash(s) {
  // small non-crypto hash for quick fingerprinting
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}


  const STATS_SEND_INTERVAL_MS = 10000;
  const MAX_OVERLAY_CHARS = 10000;
  const MAX_SPANS_BEFORE_OVERLAY = 3000;
  const DYS_STYLE_ID = 'readeasy-dysfont';
  const RATE_SCALE = 0.85; // slightly slower baseline so UI rate=1 feels natural

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
 // --- Debug / logger compatibility shim (supports both safeLog('msg') and safeLog()('msg'))
window.__clarityread_debug = !!window.__clarityread_debug; // default false if undefined

function _makeLogger(level = 'log') {
  return function(...args) {
    try {
      if (window.__clarityread_debug) {
        if (console && console[level]) console[level].call(console, '[ClarityRead contentScript]', ...args);
        else console.log('[ClarityRead contentScript]', ...args);
      }
    } catch (e) {}
  };
}

// A single function that is both callable and returns a logger (keeps existing code working)
const safeLog = (...args) => {
  if (args.length === 0) return _makeLogger('log');
  try { if (window.__clarityread_debug) console.log('[ClarityRead contentScript]', ...args); } catch(e) {}
};
const safeWarn = (...args) => {
  if (args.length === 0) return _makeLogger('warn');
  try { if (window.__clarityread_debug) console.warn('[ClarityRead contentScript]', ...args); } catch(e) {}
};
const safeInfo = (...args) => {
  if (args.length === 0) return _makeLogger('info');
  try { if (window.__clarityread_debug) console.info('[ClarityRead contentScript]', ...args); } catch(e) {}
};

// Keep debug flag in sync with chrome.storage.local so popup toggles persist and affect already-open pages.
// Also accept explicit set via message ('set_debug') below.
try {
  if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
    chrome.storage.local.get(['clarityread_debug'], (res) => {
      try { window.__clarityread_debug = !!(res && res.clarityread_debug); } catch(e) {}
      if (window.__clarityread_debug) safeLog('debug enabled from storage at init');
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes && typeof changes.clarityread_debug !== 'undefined') {
        try {
          window.__clarityread_debug = !!changes.clarityread_debug.newValue;
          safeLog('debug flag changed via storage.onChanged ->', window.__clarityread_debug);
        } catch(e){}
      }
    });
  }
} catch (e) {
  // ignore storage sync failures in e.g. test/shim environments
}


  

  safeLog('✅ contentScript loaded for', location.href);

  function sendState(state, extra) {
    if (!state) return;
    if (state === lastSentState) { safeLog('sendState skipped duplicate', state); return; }
    lastSentState = state;
    try {
      if (state === 'Reading...') chrome.runtime.sendMessage({ action: 'readingResumed', ...(extra||{}) }, () => {});
      else if (state === 'Paused') chrome.runtime.sendMessage({ action: 'readingPaused', ...(extra||{}) }, () => {});
      else if (state === 'Not Reading') chrome.runtime.sendMessage({ action: 'readingStopped', ...(extra||{}) }, () => {});
    } catch (e) { safeLog('sendState send failed', e); }
    safeLog('sendState sent', state);
  }

  function notifyOverlayState(active) {
    try {
      chrome.runtime.sendMessage({ action: 'clarity_overlay_state', overlayActive: !!active }, () => {});
    } catch (e) { safeLog('notifyOverlayState failed', e); }
  }

  let __clarityread_backup_main = null;
  function __clarityread_backupMain() {
    try {
      const main = (typeof getMainNode === 'function') ? getMainNode() : (document.body || document.documentElement);
      if (main && (main.innerHTML || '').length > 500) {
        __clarityread_backup_main = { html: main.innerHTML, ts: Date.now() };
        safeLog('backupMain: saved main html length', __clarityread_backup_main.html.length);
      }
    } catch (e) { try { safeLog('backupMain error', e); } catch(_) {} }
  }
  function __clarityread_restoreMainIfTruncated() {
    try {
      const bodyLen = (document.body && document.body.innerText) ? String(document.body.innerText).trim().length : 0;
      if (__clarityread_backup_main && bodyLen < 500) {
        const main = (typeof getMainNode === 'function') ? getMainNode() : (document.body || document.documentElement);
        if (main && __clarityread_backup_main.html) {
          try {
            // Restoration is allowed — this recovers from accidental truncation.
            main.innerHTML = __clarityread_backup_main.html;
            safeLog('restoreMainIfTruncated: restored main from backup (bodyLen was', bodyLen, ')');
          } catch (e) {
            safeLog('restoreMainIfTruncated restore failed', e);
          }
        }
        __clarityread_backup_main = null;
      }
    } catch (e) { try { safeLog('restoreMainIfTruncated error', e); } catch(_) {} }
  }

  (function() {
    try {
      let lastStored = null;
      function storeSelection(text) {
        try {
          if (!text || typeof text !== 'string') return;
          const trimmed = text.trim();
          if (!trimmed || trimmed.length < 20) return;
          lastStored = { text: trimmed, ts: Date.now(), url: location.href, title: document.title || '' };
          chrome.storage.local.set({ clarity_last_selection: lastStored }, () => {});
        } catch (e) {}
      }

      // on mouseup and selectionchange capture selection
      function capture() {
        try {
          const s = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
          if (s && s.trim().length >= 20) storeSelection(s);
        } catch (e) {}
      }

      document.addEventListener('mouseup', () => setTimeout(capture, 10));
      document.addEventListener('selectionchange', () => {
        // store only if selection is non-empty and reasonably long
        try {
          const s = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
          if (s && s.trim().length >= 20) storeSelection(s);
        } catch (e) {}
      });

      // also store selection on Ctrl/Cmd+C to be extra-reliable
      document.addEventListener('copy', () => setTimeout(capture, 10));
    } catch (e) {}
  })();


  function sanitizeForTTS(s) {
    if (!s) return '';
    return String(s).replace(/\s+/g, ' ').trim();
  }

 let _dysObserver = null;
  const CLARITY_DYS_STYLE_ID = 'clarity-dysfont-style';
  const CLARITY_DYS_LINK_ID = 'clarity-dysfont-link';

  function injectStyleIntoSameOriginIframes(styleText, linkHref, removeFlag = false) {
    try {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const f of iframes) {
        try {
          const doc = f.contentDocument;
          if (!doc) continue; // cross-origin or not available
          if (removeFlag) {
            const old = doc.getElementById(CLARITY_DYS_STYLE_ID);
            if (old) old.remove();
            const oldLink = doc.getElementById(CLARITY_DYS_LINK_ID);
            if (oldLink) oldLink.remove();
            continue;
          }
          if (!doc.getElementById(CLARITY_DYS_STYLE_ID) && styleText) {
            const st = doc.createElement('style');
            st.id = CLARITY_DYS_STYLE_ID;
            st.type = 'text/css';
            st.textContent = styleText;
            (doc.head || doc.documentElement).appendChild(st);
          }
          if (!doc.getElementById(CLARITY_DYS_LINK_ID) && linkHref) {
            const l = doc.createElement('link');
            l.id = CLARITY_DYS_LINK_ID;
            l.rel = 'stylesheet';
            l.href = linkHref;
            (doc.head || doc.documentElement).appendChild(l);
          }
        } catch (e) {
          // cross-origin iframe or injection failed — skip
          safeLog('iframe injection skipped (cross-origin) or failed', e);
        }
      }
    } catch (e) { safeLog('injectStyleIntoSameOriginIframes error', e); }
  }

  function ensureDysFontInjected() {
    try {
      if (document.getElementById(CLARITY_DYS_STYLE_ID)) {
        safeLog('Dys style already present');
        return;
      }

      const urlWoff2 = chrome.runtime.getURL('src/fonts/OpenDyslexic-Regular.woff2');
      const urlWoff  = chrome.runtime.getURL('src/fonts/OpenDyslexic-Regular.woff');

      // ensure inputs/contenteditable are covered and add some Google-Docs-friendly selectors.
      const style = document.createElement('style');
      style.id = CLARITY_DYS_STYLE_ID;
style.textContent = `
@font-face {
  font-family: 'OpenDyslexic';
  src: url("${urlWoff2}") format("woff2"),
       url("${urlWoff}") format("woff");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

html.readeasy-dyslexic, html.clarityread-dyslexic {
  --readeasy-dys-font: 'OpenDyslexic', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

html.readeasy-dyslexic body, html.clarityread-dyslexic body,
html.readeasy-dyslexic p, html.clarityread-dyslexic p,
html.readeasy-dyslexic li, html.clarityread-dyslexic li {
  font-family: var(--readeasy-dys-font) !important;
}

html.readeasy-dyslexic input, html.clarityread-dyslexic input,
html.readeasy-dyslexic textarea, html.clarityread-dyslexic textarea,
html.readeasy-dyslexic [contenteditable="true"], html.clarityread-dyslexic [contenteditable="true"] {
  font-family: var(--readeasy-dys-font) !important;
}

html.readeasy-dyslexic .kix-zoomdocumentplugin-outer,
html.readeasy-dyslexic .kix-canvas-tile-content,
html.readeasy-dyslexic .kix-page,
html.readeasy-dyslexic .kix-appview-outer,
html.readeasy-dyslexic .docs-texteventtarget-iframe {
  font-family: var(--readeasy-dys-font) !important;
}

/* placeholder fallback */
html.readeasy-dyslexic *::placeholder { font-family: var(--readeasy-dys-font) !important; }
`;

      try { (document.head || document.documentElement).appendChild(style); } catch (e) { document.documentElement.appendChild(style); }

      // Add FontFace load for better UX when fonts are packaged
      if ('fonts' in document) {
        try {
          const ff = new FontFace('OpenDyslexic', `url(${urlWoff2}) format("woff2"), url(${urlWoff}) format("woff")`, { display: 'swap' });
          ff.load().then(f => { document.fonts.add(f); safeLog('OpenDyslexic font loaded'); }).catch(()=>{ safeLog('OpenDyslexic font load failed'); });
        } catch (e) { safeLog('FontFace load threw', e); }
      }

      // Also attempt to inject into same-origin iframes (best-effort)
      const localLinkHref = null; // we rely on packaged @font-face in style above; if you host CSS externally set link href
      injectStyleIntoSameOriginIframes(style.textContent, localLinkHref, false);

      // Start a short-lived observer to re-inject if dynamic editors/iframes added
      startDysObserver();

      safeLog('ensureDysFontInjected applied');
    } catch (e) {
      safeLog('ensureDysFontInjected error', e);
    }
  }

  function removeDysFontInjected() {
    try {
      const el = document.getElementById(CLARITY_DYS_STYLE_ID);
      if (el) el.remove();
    } catch(e){ safeLog('removeDysFontInjected error removing style', e); }

    try {
      document.documentElement.classList.remove('readeasy-dyslexic');
      document.documentElement.classList.remove('clarityread-dyslexic'); // compatibility
    } catch(e){}

    try {
      const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay');
      if (overlay) { overlay.style.fontFamily = ''; }
    } catch(e){}

    try {
      // remove injected styles from same-origin iframes
      injectStyleIntoSameOriginIframes('', null, true);
    } catch(e){ safeLog('removeDysFontInjected iframe cleanup failed', e); }

    // disconnect short-lived observer if present
    try { if (_dysObserver) { _dysObserver.disconnect(); _dysObserver = null; } } catch(e){}

    safeLog('removeDysFontInjected completed');
  }

  function startDysObserver() {
    try {
      if (_dysObserver) return;
      _dysObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length) {
            // reapply style into new same-origin iframes or newly-added editors
            const el = document.getElementById(CLARITY_DYS_STYLE_ID);
            injectStyleIntoSameOriginIframes(el ? el.textContent : null, null, false);
          }
        }
      });
      _dysObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
      // stop after a reasonable time to avoid long-lived observers
      setTimeout(() => { try { if (_dysObserver) { _dysObserver.disconnect(); _dysObserver = null; } } catch(e){} }, 20000);
    } catch (e) { safeLog('startDysObserver failed', e); }
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      if (!s) return false;
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0) return false;
    } catch (e) { return false; }
    return true;
  }
  function textDensity(el) {
    try {
      const t = (el && el.innerText) ? el.innerText.trim() : '';
      const htmlLen = (el && el.innerHTML) ? el.innerHTML.length : 1;
      return (t.length) / Math.max(1, htmlLen);
    } catch (e) { return 0; }
  }
  function getMainNode() {
    try {
      const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text'];
      for (const s of prefer) {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.length > 200 && isVisible(el)) {
          safeLog('getMainNode selected preferred selector', s);
          return el;
        }
      }
      const candidates = Array.from(document.querySelectorAll('article, main, section, div, p'))
        .filter(el => el && el.innerText && el.innerText.trim().length > 200 && isVisible(el))
        .map(el => ({ el, len: (el.innerText || '').trim().length, density: textDensity(el) }))
        .filter(c => !/(nav|footer|header|sidebar|comment|advert|ads|cookie)/i.test((c.el.id || '') + ' ' + (c.el.className || '')));
      if (candidates.length) {
        candidates.sort((a,b) => (b.len - a.len) || (b.density - a.density));
        safeLog('getMainNode picked candidate with length', candidates[0].len);
        return candidates[0].el;
      }
      // As an improvement: prefer large contenteditable nodes when no article-like node found
      const editable = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
      if (editable.length) {
        // choose the largest one by innerText length
        editable.sort((a,b) => ((b.innerText||'').length - (a.innerText||'').length));
        if ((editable[0].innerText || '').length > 100) {
          safeLog('getMainNode falling back to contenteditable node');
          return editable[0];
        }
      }

      if (document.body && (document.body.innerText || '').length > 200) {
        safeLog('getMainNode falling back to document.body');
        return document.body;
      }
    } catch (e) { safeLog('getMainNode err', e); }
    safeLog('getMainNode fallback to documentElement');
    return document.documentElement || document.body;
  }

function extractCleanMainTextAndHtml(mainNode) {
  const lg = (...args) => {
    try {
      if (typeof safeLog === 'function') safeLog.apply(null, args);
      else safeLog().apply(console, args);
    } catch (e) {
      try { safeLog().apply(console, args); } catch (e2) {}
    }
  };

  try {
    lg('extractCleanMainTextAndHtml start', { hostname: (location && location.hostname) ? location.hostname : '' });

    try {
      const hasRead = (typeof Readability === 'function');
      lg('Readability available?', !!hasRead);
      if (hasRead) {
        try {
          lg('Attempting Readability.parse on SERIALIZED DOM (non-destructive)');
          const serialized = (document.documentElement && document.documentElement.outerHTML)
            ? document.documentElement.outerHTML
            : (document.body && document.body.outerHTML) ? document.body.outerHTML : '';
          
          if (serialized && serialized.length) {
            const parser = new DOMParser();
            const parsedDoc = parser.parseFromString('<!doctype html>\n' + serialized, 'text/html');
            const article = new Readability(parsedDoc).parse();
            lg('Readability.parse serialized result', { ok: !!article, title: article && article.title, textLen: article && article.textContent ? (article.textContent || '').length : 0 });
            
            if (article && article.textContent && String(article.textContent).trim().length > 200) {
              let text = String(article.textContent || '').replace(/\s{2,}/g, ' ').trim();
              text = _postCleanExtractedText(text);
              return { text, html: String(article.content || '').trim(), title: (article.title || document.title || '') };
            }
          } else {
            lg('Serialization produced empty string; skipping Readability');
          }
        } catch (serErr) {
          lg('Readability serialized parse threw (falling back to legacy extractor)', serErr && (serErr.stack || serErr.message || serErr));
        }
      }
    } catch (e) {
      lg('Readability check threw (will use legacy extractor)', e && (e.stack || e));
    }

    lg('Using legacy extractor (clone + prune)');

    const clone = (mainNode && typeof mainNode.cloneNode === 'function') ? mainNode.cloneNode(true) : null;
    if (!clone) {
      lg('Legacy extractor: no mainNode clone available — returning empty');
      try {
        const ed = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
        if (ed.length) {
          const agg = ed.map(e => (e.innerText || '')).join('\n\n');
          const cleaned = _postCleanExtractedText(String(agg || '').replace(/\s{2,}/g, ' ').trim());
          if (cleaned && cleaned.length) return { text: cleaned, html: '', title: document.title || '' };
        }
      } catch(e){}
      return { text: '', html: '', title: document.title || '' };
    }

    const toRemove = [
      'header','footer','nav','aside',
      '.navbox','.vertical-navbox','.toc','#toc',
      '.infobox','.sidebar','.mw-jump-link','.mw-references-wrap',
      '.reference','.references','.reflist','.mw-editsection','.hatnote',
      '.author','.byline','.by-line','.contributor','.credit','.editor',
      'form','input','button','svg','picture','video','figure','iframe','noscript',
      '.advert','.ads','.ad','.ad-wrapper','.adslot','.promo','.promo-block',
      '.related','.related-articles','.related-links','.related-content',
      '.share','.social','.cookie','.cookie-banner','.newsletter','.subscribe',
      '.comments','.comment','.comments-list','.comment-list',
      '.promo-banner','.promo-module','.meta','.meta-data','.article-meta',
      '.breadcrumb','.breadcrumbs','.tag-list','.tags','.topics'
    ];

    const hostname = (location.hostname || '').toLowerCase();
    const siteExtras = {
      'health.clevelandclinic.org': ['.related-articles', '.related-articles-module', '.rc-article-related', '.article__related', '.trending', '.more-articles', '.cc-byline', '.byline', '.author'],
      'clevelandclinic.org': ['.related-articles', '.trending', '.more-articles'],
      'www.nytimes.com': ['.meteredContent', '.css-1fanzo5', '.ad-section', '.story-footer', '.StoryBodyCompanionColumn'],
      'nytimes.com': ['.meteredContent', '.story-footer'],
      'www.washingtonpost.com': ['.paywall', '.latest', '.related-content', '.story-body__aside'],
      'washingtonpost.com': ['.paywall']
    };

    if (siteExtras[hostname] && Array.isArray(siteExtras[hostname])) {
      toRemove.push(...siteExtras[hostname]);
    } else {
      Object.keys(siteExtras).forEach(k => { if (hostname.endsWith(k)) toRemove.push(...siteExtras[k]); });
    }

    try {
      toRemove.forEach(sel => {
        try { clone.querySelectorAll(sel).forEach(n => { try { n.remove(); } catch (e){} }); } catch(e){}
      });
    } catch(e){
      lg('Error removing toRemove selectors', e && (e.stack || e));
    }

    try { clone.querySelectorAll('script, style, link, iframe').forEach(n => { try { n.remove(); } catch(e){} }); } catch(e){ lg('Error removing script/style/link/iframe', e && (e.stack || e)); }

    try {
      clone.querySelectorAll('*').forEach(el => {
        try {
          if (!el || !el.attributes) return;
          for (let i = el.attributes.length - 1; i >= 0; i--) {
            const at = el.attributes[i];
            if (!at) continue;
            const name = (at.name || '').toLowerCase();
            if (name.startsWith('on') || name === 'style' || name === 'onclick' || name === 'onmouseover') {
              try { el.removeAttribute(at.name); } catch (e) {}
            }
          }
        } catch(e){}
      });
    } catch(e){ lg('Error sanitizing attributes', e && (e.stack || e)); }

    try {
      const noisyRe = /(related|promo|advert|ad-|ad_|ads|subscribe|newsletter|share|social|comments?|footer|header|cookie|breadcrumb|promo|trending|author|byline|meta|signup|cta|paywall)/i;
      Array.from(clone.querySelectorAll('*')).forEach(el => {
        try {
          const idc = (el.id || '') + ' ' + (el.className || '');
          if (noisyRe.test(idc) && (el.innerText || '').length < 600) el.remove();
        } catch(e){}
      });
    } catch(e){ lg('Error running noisy-node heuristic', e && (e.stack || e)); }

    let text = '';
    try {
      text = clone.innerText || '';
      lg('Legacy extractor: raw clone innerText length', text.length);
      text = String(text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
      text = text.replace(/\b(References|External links|See also|Further reading|Related articles|Related Articles|Trending|Advertisement)\b[\s\S]*/ig, '');
      text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');
      text = text.replace(/\s{2,}/g, ' ').trim();
      text = _postCleanExtractedText(text);
      lg('Legacy extractor: cleaned text length', text.length);
    } catch(e) {
      lg('Legacy extractor: collecting text failed', e && (e.stack || e));
      text = '';
    }

    let html = '';
    try { html = clone.innerHTML || ''; } catch(e) { html = ''; }

    if ((!text || text.length < 120)) {
      try {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
        if (editables.length) {
          const agg = editables.map(e => (e.innerText || '')).join('\n\n');
          const cleaned = _postCleanExtractedText(String(agg || '').replace(/\s{2,}/g, ' ').trim());
          if (cleaned && cleaned.length > text.length) {
            lg('extract fallback used contenteditable aggregation', cleaned.length);
            text = cleaned;
            html = '';
          }
        }

        const kix = Array.from(document.querySelectorAll('.kix-page, .kix-zoomdocumentplugin-outer, .kix-canvas-tile-content')).filter(isVisible);
        if (kix.length) {
          const agg2 = kix.map(e => (e.innerText || '')).join('\n\n');
          const cleaned2 = _postCleanExtractedText(String(agg2 || '').replace(/\s{2,}/g, ' ').trim());
          if (cleaned2 && cleaned2.length > text.length) {
            lg('extract fallback used kix selectors', cleaned2.length);
            text = cleaned2;
            html = '';
          }
        }

        if ((!text || text.length < 120) && document.body && document.body.innerText && document.body.innerText.length > 200) {
          text = String(document.body.innerText || '').replace(/\s{2,}/g, ' ').trim();
          text = _postCleanExtractedText(text);
          lg('Fallback to document.body text used (second chance), length', text.length);
        }
      } catch (e) {
        lg('Extraction fallback attempts failed', e && (e.stack || e));
      }
    }

    if ((!text || text.length < 120) && document.body && document.body.innerText && document.body.innerText.length > 200) {
      try {
        text = String(document.body.innerText || '').replace(/\s{2,}/g, ' ').trim();
        text = _postCleanExtractedText(text);
        lg('Fallback to document.body text used, length', text.length);
      } catch(e) { lg('Fallback to document.body failed', e && (e.stack || e)); }
    }

    return { text: (text || '').trim(), html: html || '', title: document.title || '' };

  } catch (err) {
    try {
      if (typeof safeLog === 'function') safeLog('extractCleanMainTextAndHtml error', err && (err.stack || err));
      else safeLog()('extractCleanMainTextAndHtml error', err && (err.stack || err));
    } catch (e) {}
    return { text: '', html: '', title: document.title || '' };
  }
}

window.__clarity_read_extract = function() {
  try {
    const main = (typeof getMainNode === 'function') ? getMainNode() : (document.body || document.documentElement);
    const out = (typeof extractCleanMainTextAndHtml === 'function') ? extractCleanMainTextAndHtml(main) : { text: (document.body && document.body.innerText) ? document.body.innerText : '', html: '', title: document.title || '' };
    return { ok: true, text: out.text || '', html: out.html || '', title: out.title || '', url: location.href || '' };
  } catch (e) {
    try {
      const fallbackText = document.body && document.body.innerText ? document.body.innerText : '';
      return { ok: true, text: String(fallbackText || '').trim(), html: '', title: document.title || '', url: location.href || '' };
    } catch (ee) {
      return { ok: false, error: String(ee), url: location.href || '' };
    }
  }
};

function createReaderOverlay(text) {
  removeReaderOverlay();

  const overlay = document.createElement('div');
  try { safeLog()('[ClarityRead contentScript] createReaderOverlay call stack'); } catch(e){}
  try { safeLog()('[ClarityRead contentScript] createReaderOverlay called; overlay disable flag =', !!window.__clarityread_disable_overlay); } catch(e){}

  overlay.id = 'readeasy-reader-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-label','Reader overlay');

  const dys = document.documentElement.classList.contains('readeasy-dyslexic') || document.documentElement.classList.contains('clarityread-dyslexic');
  overlay.style.position = 'fixed';
  overlay.style.inset = '6%';
  overlay.style.zIndex = 2147483647;
  overlay.style.background = '#fff';
  overlay.style.color = '#000';
  overlay.style.padding = '18px';
  overlay.style.overflow = 'auto';
  overlay.style.borderRadius = '8px';
  overlay.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
  overlay.style.fontFamily = dys ? "'OpenDyslexic', system-ui, Arial, sans-serif" : "system-ui, Arial, sans-serif";
  overlay.style.lineHeight = '1.8';
  overlay.style.fontSize = '18px';
  overlay.style.whiteSpace = 'pre-wrap';
  overlay.style.touchAction = 'manipulation';
  overlay.style.willChange = 'transform, opacity';

  // close button
  try {
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close reader';
    close.setAttribute('aria-label', 'Close reader');
    close.style.position = 'absolute';
    close.style.right = '16px';
    close.style.top = '10px';
    close.addEventListener('click', () => {
      try {
        if (typeof stopReadingAll === 'function') stopReadingAll();
        else { try { window.speechSynthesis.cancel(); } catch(e){} removeReaderOverlay(); clearHighlights(); sendState('Not Reading'); }
      } catch (e) {
        safeLog('overlay close handler error', e);
        try { window.speechSynthesis.cancel(); } catch(e){}
        removeReaderOverlay(); clearHighlights(); sendState('Not Reading');
      }
    });
    overlay.appendChild(close);
  } catch(e){ safeLog('overlay close button create failed', e); }

  const inner = document.createElement('div');
  inner.id = 'readeasy-reader-inner';
  inner.style.whiteSpace = 'pre-wrap';

  const wordRe = /(\S+)(\s*)/g;
  wordRe.lastIndex = 0;
  let count = 0;

  // Put inner into a fragment first
  try {
    const frag = document.createDocumentFragment();
    frag.appendChild(inner);
    overlay.appendChild(frag);
  } catch(e) {
    try { overlay.appendChild(inner); } catch(_) {}
  }

  // Attach overlay on next paint to reduce reflow risk
  try {
    requestAnimationFrame(() => {
      try { document.documentElement.appendChild(overlay); }
      catch (e) { safeLog('append overlay failed (rAF)', e); }
    });
  } catch(e) {
    try { document.documentElement.appendChild(overlay); } catch (e2) { safeLog('append overlay failed', e2); }
  }

  // batching parameters
  const BATCH_SIZE = 250;
  let finished = false;
  overlayActive = true;
  overlayTextSplice = null;
  highlightSpans = []; // will be populated after batch completes

  const createBatch = () => {
    try {
      let i = 0, m = null;
      while (i < BATCH_SIZE && (m = wordRe.exec(text)) !== null && count < MAX_SPANS_BEFORE_OVERLAY) {
        const sp = document.createElement('span');
        sp.textContent = (m[1] || '') + (m[2] || '');
        sp.classList.add('readeasy-word');
        inner.appendChild(sp);
        count++; i++;
      }

      if (count >= MAX_SPANS_BEFORE_OVERLAY || (m === null)) {
        // done building spans (or hit limit)
        try {
          highlightSpans = Array.from(inner.querySelectorAll('.readeasy-word'));
          buildCumLengths();
          safeLog('createReaderOverlay finished building spans', highlightSpans.length);
        } catch(e){ safeLog('createReaderOverlay finalization failed', e); }
        finished = true;
        try { notifyOverlayState(true); } catch(e){ safeLog('notify overlay create failed', e); }
        return;
      }

      // schedule next batch without blocking
      setTimeout(createBatch, 0);
    } catch (e) {
      safeLog('createReaderOverlay batch error', e);
      try {
        highlightSpans = Array.from(inner.querySelectorAll('.readeasy-word'));
        buildCumLengths();
        notifyOverlayState(true);
      } catch(_) {}
      finished = true;
    }
  };

  // If the text is extremely long, create a truncated splice first and build from that
  try {
    if (text.length > MAX_OVERLAY_CHARS) {
      overlayTextSplice = text.slice(0, MAX_OVERLAY_CHARS);
      wordRe.lastIndex = 0;
      text = overlayTextSplice;
    }
  } catch (e) { safeLog('overlay splice check failed', e); }

  // start batch build
  try { setTimeout(createBatch, 0); } catch(e) { createBatch(); }

  // safety: remove overlay if page hides quickly (prevents leaving unexpected DOM when site navigates)
  const onVisibility = () => {
    try {
      if (document.visibilityState === 'hidden') {
        try { removeReaderOverlay(); clearHighlights(); } catch(e){}
        window.removeEventListener('visibilitychange', onVisibility);
      }
    } catch(e){}
  };
  window.addEventListener('visibilitychange', onVisibility);
  setTimeout(() => { try { window.removeEventListener('visibilitychange', onVisibility); } catch(e){} }, 10000);

  safeLog('createReaderOverlay created (async batch started) spansEstimate:', Math.min(MAX_SPANS_BEFORE_OVERLAY, Math.ceil((text.length || 0) / 6)));
  return overlay;
}

function removeReaderOverlay() {
  try {
    // Remove known IDs
    const ids = ['readeasy-reader-overlay', 'clarityread-overlay'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        try { el.remove(); } catch(e) { safeLog('removeReaderOverlay failed to remove', id, e); }
      }
    }

    try {
      if (__clarityread_nav_prevent_handler) {
        document.removeEventListener('click', __clarityread_nav_prevent_handler, true);
        __clarityread_nav_prevent_handler = null;
      }
    } catch(e) { safeLog('remove nav prevent handler failed', e); }

    // Also remove any node that looks like our overlay (defensive)
    try {
      const suspects = Array.from(document.querySelectorAll('div')).filter(d => {
        try {
          return d && d.id && (d.id.indexOf('readeasy-reader-overlay') >= 0 || d.id.indexOf('clarityread-overlay') >= 0);
        } catch(e) { return false; }
      });
      suspects.forEach(s => { try { s.remove(); } catch(e){} });
    } catch(e) {}

    overlayActive = false;
    overlayTextSplice = null;
    safeLog('removeReaderOverlay executed (defensive)');

    try { notifyOverlayState(false); } catch(e){ safeLog('notify overlay remove failed', e); }
  } catch(e) {
    safeLog('removeReaderOverlay outer error', e);
    overlayActive = false;
    overlayTextSplice = null;
    try { notifyOverlayState(false); } catch(_) {}
  }
}


 

 function clearHighlights() {
  // stop any fallback ticker first
  try { if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; } } catch(e){}

  // If overlay is active, remove overlay and don't touch page DOM
  if (overlayActive) {
    try { removeReaderOverlay(); } catch (e) { safeLog('clearHighlights remove overlay failed', e); }
    highlightSpans = [];
    highlightIndex = 0;
    cumLengths = [];
    overlayActive = false;
    overlayTextSplice = null;
    safeLog('clearHighlights cleared (overlay mode)');
    return;
  }

  // selectionRestore path: attempt to restore only when it's valid
  if (selectionRestore && selectionRestore.wrapperSelector) {
    try {
      const wrapper = document.querySelector(selectionRestore.wrapperSelector);
      if (wrapper && selectionRestore.originalHtml != null && wrapper.parentNode) {
        const container = document.createElement('div');
        container.innerHTML = selectionRestore.originalHtml;
        while (container.firstChild) wrapper.parentNode.insertBefore(container.firstChild, wrapper);
        wrapper.parentNode.removeChild(wrapper);
      }
    } catch (e) {
      safeLog('selection restore failed', e);
    }
    selectionRestore = null;
  }

  try {
    if (Array.isArray(highlightSpans) && highlightSpans.length) {
      for (let s of highlightSpans) {
        try {
          if (!s) continue;
          // only touch DOM if the node is currently in the document body
          if (s.parentNode && document.body.contains(s)) {
            const txt = s.textContent || '';
            try { s.parentNode.replaceChild(document.createTextNode(txt), s); } catch(e) { safeLog('clearHighlights replace failed for span', e); }
          }
        } catch (e) { safeLog('clearHighlights per-span error', e); }
      }
    }
  } catch(e){
    safeLog('clearHighlights replace error', e);
  }

  highlightSpans = [];
  highlightIndex = 0;
  cumLengths = [];
  overlayActive = false;
  overlayTextSplice = null;
  safeLog('clearHighlights cleared', 'spansRemoved', (highlightSpans && highlightSpans.length) || 0);
}


  function buildCumLengths() {
    cumLengths = [];
    let total = 0;
    for (let i = 0; i < highlightSpans.length; i++) {
      total += (highlightSpans[i].textContent || '').length;
      cumLengths.push(total);
    }
  }

  function mapCharIndexToSpanAndHighlight(charIndex) {
    if (!highlightSpans || !highlightSpans.length) return;
    if (!cumLengths || !cumLengths.length) buildCumLengths();
    const total = cumLengths[cumLengths.length - 1] || 0;
    if (charIndex >= total) highlightIndex = highlightSpans.length - 1;
    else {
      let lo = 0, hi = cumLengths.length - 1, idx = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumLengths[mid] > charIndex) { idx = mid; hi = mid - 1; } else { lo = mid + 1; }
      }
      highlightIndex = idx;
    }
    for (let i = 0; i < highlightSpans.length; i++) {
      const s = highlightSpans[i];
      if (!s) continue;
      if (i === highlightIndex) s.classList.add('readeasy-highlight');
      else s.classList.remove('readeasy-highlight');
    }
    const cur = highlightSpans[highlightIndex];
    if (cur) try { cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  function advanceHighlightByOne() {
    if (!highlightSpans || !highlightSpans.length) return;
    highlightIndex = Math.min(highlightIndex + 1, highlightSpans.length - 1);
    for (let i = 0; i < highlightSpans.length; i++) {
      const s = highlightSpans[i];
      if (!s) continue;
      if (i === highlightIndex) s.classList.add('readeasy-highlight'); else s.classList.remove('readeasy-highlight');
    }
    const cur = highlightSpans[highlightIndex];
    if (cur) try { cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  // --- prepareSpansForHighlighting (overlay-first, safe)
  function prepareSpansForHighlighting(fullText) {
    try {
      clearHighlights();
      overlayTextSplice = null;

      const text = String(fullText || '').slice(0, MAX_OVERLAY_CHARS);
          try {
      safeLog()('[ClarityRead contentScript] prepareSpansForHighlighting called; disable_overlay=', !!window.__clarityread_disable_overlay);
      safeLog()('[ClarityRead contentScript] prepareSpansForHighlighting stack');
    } catch(e){}

      // Create overlay for highlighting — safer across many sites
      const overlay = createReaderOverlay(text);
      if (!overlay) {
        safeLog('prepareSpansForHighlighting: overlay creation was skipped (disable flag?)');
        return { mode: 'none' };
      }
      if (highlightSpans && highlightSpans.length) {
        safeLog('prepareSpansForHighlighting -> overlay mode spans', highlightSpans.length);
        return { mode: 'overlay', overlayText: text, spans: highlightSpans.length };
      }
      safeLog('prepareSpansForHighlighting failed to create spans, returning none');
      return { mode: 'none' };
    } catch (e) {
      safeLog('prepareSpansForHighlighting error', e);
      return { mode: 'none' };
    }
  }

  function attachUtterHandlers(utter, mySessionId) {
    try {
      utter.onstart = () => {
        if (mySessionId !== sessionId) { safeLog('utter.onstart ignored due to session mismatch', mySessionId, sessionId); return; }
        if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; }
        errorFallbackAttempted = false;
        safeLog('utter.onstart for chunk length', (utter.text || '').length, 'sessionId', mySessionId);

        // fallback highlighting ticker
        if (!fallbackTickerRunning && highlightSpans.length) {
          let wordCount = (utter.text.match(/\S+/g) || []).length;
          if (wordCount > 0) {
            let estDuration = (utter.text.length / 10) / (utter.rate || 1);
            let interval = Math.max(120, estDuration * 1000 / wordCount);
            let i = 0;
            fallbackTicker = setInterval(() => {
              if (mySessionId !== sessionId) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; return; }
              if (i < highlightSpans.length) {
                advanceHighlightByOne();
                i++;
              } else {
                clearInterval(fallbackTicker);
                fallbackTickerRunning = false;
              }
            }, interval);
            fallbackTickerRunning = true;
            safeLog('fallbackTicker started interval ms', interval);
          }
        }

        sendState('Reading...');
      };

      utter.onboundary = (e) => {
        if (mySessionId !== sessionId) return;
        if (!e || typeof e.charIndex !== 'number') return;
        if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; }
        try {
          const absoluteIndex = (e.charIndex || 0) + (utter._chunkBase || 0);
          mapCharIndexToSpanAndHighlight(absoluteIndex);
        } catch (err) { safeLog('onboundary mapping failed', err); }
      };
    } catch (ex) { safeLog('onboundary attach failed', ex); }

    utter.onpause = () => {
      try { if (mySessionId !== sessionId) return; } catch(e){}
      sendState('Paused');
      safeLog('utter.onpause');
    };
    utter.onresume = () => {
      try { if (mySessionId !== sessionId) return; } catch(e){}
      sendState('Reading...');
      safeLog('utter.onresume');
    };

    utter.onerror = (errEvent) => {
      if (mySessionId !== sessionId) { safeLog('utter.onerror ignored due to session mismatch', mySessionId, sessionId); return; }
      safeLog('utter.onerror', errEvent);
      // attempt fallback once
      if (!errorFallbackAttempted) {
        errorFallbackAttempted = true;
        try { window.speechSynthesis.cancel(); } catch(e){}
        removeReaderOverlay();
        clearHighlights();
        const fallbackText = utter.text || '';
        if (fallbackText) {
          const newUtter = new SpeechSynthesisUtterance(fallbackText);
          const voices = window.speechSynthesis.getVoices() || [];
          newUtter.voice = (utter.voice && utter.voice.name) ? voices.find(v => v.name === utter.voice.name) || voices[0] : (voices[0] || null);
          newUtter.rate = Math.max(0.8, (utter.rate || 1) - 0.25);
          newUtter.pitch = utter.pitch || 1;
          attachUtterHandlers(newUtter, mySessionId);
          try { window.speechSynthesis.speak(newUtter); currentUtterance = newUtter; safeLog('utter.onerror fallback speak started'); } catch (e) { safeLog('fallback speak failed', e); sendState('Not Reading'); }
          return;
        }
      }
      removeReaderOverlay();
      clearHighlights();
      sendState('Not Reading');
    };
  }

  function startAutoStatsTimer() {
    if (readTimer) clearInterval(readTimer);
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();
    readTimer = setInterval(() => {
      if (!readStartTs) return;
      const now = Date.now();
      const delta = (now - readStartTs) / 1000;
      readStartTs = now;
      accumulatedElapsed += delta;
      pendingSecondsForSend += delta;
      const sinceLast = now - lastStatsSendTs;
      if (pendingSecondsForSend >= (STATS_SEND_INTERVAL_MS / 1000) || sinceLast >= STATS_SEND_INTERVAL_MS) {
        const toSend = pendingSecondsForSend;
        pendingSecondsForSend = 0;
        lastStatsSendTs = now;
        try { chrome.runtime.sendMessage({ action: 'updateTimeOnly', duration: toSend }, () => {}); safeLog('sent updateTimeOnly', toSend); } catch (e) { safeLog('updateTimeOnly send failed', e); }
      }
    }, 1000);
  }

  function finalizeStatsAndSend() {
    if (readTimer) { clearInterval(readTimer); readTimer = null; }
    if (readStartTs) {
      accumulatedElapsed += (Date.now() - readStartTs) / 1000;
      readStartTs = null;
    }
    const toSend = Math.floor(accumulatedElapsed || 0);
    if (toSend > 0) {
      try { chrome.runtime.sendMessage({ action: 'updateStats', duration: toSend }, () => {}); safeLog('finalizeStatsAndSend sent', toSend); } catch (e) { safeLog('finalizeStats send failed', e); }
      accumulatedElapsed = 0;
    }
  }

function resolveVoices(cb, opts) {
  opts = opts || {};
  const timeout = Number(opts.timeout || 2000); // increased from 600 to 2000ms

  try {
    if (!('speechSynthesis' in window)) { cb([]); return; }
    let voices = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
    if (voices && voices.length) { cb(voices); return; }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged); } catch(e){}
      const v = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
      cb(v);
    };

    const onVoicesChanged = () => { finish(); };

    try { window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged); } catch(e){}

    const pollInterval = 200;
    let polled = 0;
    const pollMax = Math.ceil(timeout / pollInterval);
    const poller = setInterval(() => {
      try {
        const vs = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
        if (vs && vs.length) {
          clearInterval(poller);
          finish();
        } else if (++polled >= pollMax) {
          clearInterval(poller);
          finish();
        }
      } catch(e) {
        clearInterval(poller);
        finish();
      }
    }, pollInterval);

    // safety net
    setTimeout(() => { finish(); }, timeout + 200);
  } catch (e) { try { cb([]); } catch(_){} }
}


function speakText(fullText, { voiceName, rate = 1, pitch = 1, highlight = false } = {}) {
  safeLog('speakText called len=', (fullText || '').length, { voiceName, rate, pitch, highlight });

  function _clear_disable_overlay_flag() {
    try { window.__clarityread_disable_overlay = false; } catch (e) { safeLog('clear disable flag failed', e); }
  }

  // Safety: temporarily disable overlay creation only for non-highlight runs
  try {
    window.__clarityread_disable_overlay = !highlight;
    safeLog('speakText: __clarityread_disable_overlay set to', !!window.__clarityread_disable_overlay);
  } catch (e) { safeLog('speakText: failed to set disable flag', e); }

  if (!('speechSynthesis' in window)) {
    safeLog('TTS not supported here.');
    sendState('Not Reading');
    _clear_disable_overlay_flag();
    return { ok: false, error: 'no-tts' };
  }

  fullText = sanitizeForTTS(fullText || '');
  if (!fullText) {
    safeLog('No text to read');
    _clear_disable_overlay_flag();
    return { ok: false, error: 'no-text', url: location.href || ''};
  }

    // If user is focused in an input/textarea and content is short, avoid reading accidentally.
  try {
    const ae = document.activeElement;
    if (ae && ae.tagName && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      const v = (typeof ae.value === 'string' ? ae.value : (ae.innerText || '')).trim();
      if (!highlight && (!v || v.length < 60)) {
        safeLog('speakText abort: focused input/textarea with short text (protecting typing).');
        _clear_disable_overlay_flag();
        return { ok: false, error: 'focused-input' };
      }
    }
  } catch (e) { safeLog('focused input guard failed', e); }


  // New session
  sessionId += 1;
  const mySessionId = sessionId;
  stoppedAlready = false;

  rate = clamp(rate, 0.5, 1.6);
  pitch = clamp(pitch, 0.5, 2);

  // Cancel any prior speak to avoid race where stop→start toggles incorrectly
  try { window.speechSynthesis.cancel(); } catch(e){}

  // Only clear highlights if overlay is active (we created one previously)
  try {
    if (overlayActive || highlight) {
      clearHighlights();
    } else {
      safeLog('speakText: skipping clearHighlights (no overlayActive && highlight=false)');
    }
  } catch(e) { safeLog('guarded clearHighlights failed', e); }

  errorFallbackAttempted = false;

  // prepare highlighting (overlay) — only when highlight === true AND overlay not already active
  let utterText = fullText;
  if (highlight) {
    try {
      if (!overlayActive && !document.getElementById('readeasy-reader-overlay') && !document.getElementById('clarityread-overlay')) {
        const prep = prepareSpansForHighlighting(fullText);
        safeLog('speakText prepareSpans result', prep);
        if (prep && prep.mode === 'overlay') {
          utterText = prep.overlayText || overlayTextSplice || fullText.slice(0, MAX_OVERLAY_CHARS);
        } else {
          utterText = fullText;
        }
      } else {
        safeLog('speakText: overlay already present, skipping prepareSpans');
        utterText = fullText;
      }
    } catch (e) { safeLog('prepareSpans call failed', e); utterText = fullText; }
  }

  const CHUNK_SIZE = 1800;
  const chunks = [];
  let pos = 0;
  while (pos < utterText.length) {
    chunks.push(utterText.slice(pos, pos + CHUNK_SIZE));
    pos += CHUNK_SIZE;
  }
  safeLog('speakText created chunks', chunks.length, 'sessionId', mySessionId);

  // Start timers / stats immediately
  readStartTs = Date.now();
  accumulatedElapsed = 0;
  pendingSecondsForSend = 0;
  lastStatsSendTs = Date.now();
  startAutoStatsTimer();

  // Wait for voices then start speaking the chunks
  resolveVoices(function(voices) {
    if (mySessionId !== sessionId) { safeLog('voice resolution aborted due session change', mySessionId, sessionId); _clear_disable_overlay_flag(); return; }

    // choose voice: prefer voiceName, then language-match, then first available
    let chosen = null;
    try {
      if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
      if (!chosen) {
        const docLang = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
        chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(docLang)) || voices[0] || null;
      }
    } catch (e) {
      chosen = (voices && voices[0]) || null;
    }

    safeLog('speakText chosen voice', chosen && chosen.name);

    let chunkIndex = 0;
    let charsSpokenBefore = 0;

    function speakNext() {
      if (mySessionId !== sessionId) { safeLog('speakNext aborted due session change', mySessionId, sessionId); _clear_disable_overlay_flag(); return; }
      if (stoppedAlready) { safeLog('speakNext aborted because stoppedAlready', mySessionId); _clear_disable_overlay_flag(); return; }

      if (chunkIndex >= chunks.length) {
        // finished all chunks — clear disable flag, remove overlay and finalize stats
        try { _clear_disable_overlay_flag(); } catch(e){ safeLog('clear flag on finish failed', e); }
        try { removeReaderOverlay(); } catch(e){ safeLog('remove overlay on finish failed', e); }
        try { clearHighlights(); } catch(e){ safeLog('clear highlights on finish failed', e); }
        sendState('Not Reading');
        finalizeStatsAndSend();
        safeLog('speakText finished all chunks', 'sessionId', mySessionId);
        return;
      }

      const text = chunks[chunkIndex++];
      const utter = new SpeechSynthesisUtterance(text);
      utter._chunkBase = charsSpokenBefore;
      charsSpokenBefore += text.length;

      if (chosen) {
        try { utter.voice = chosen; } catch(e){} // defensive
      }
      utter.rate = clamp((Number(rate) || 1) * RATE_SCALE, 0.5, 1.6);
      utter.pitch = pitch;
      currentUtterance = utter;

      // attach handlers (start/boundary/pause/resume/error)
      attachUtterHandlers(utter, mySessionId);

      // onend continues the chain only if still in same session
      utter.onend = () => {
        setTimeout(() => {
          if (mySessionId !== sessionId) { safeLog('onend not continuing due session mismatch', mySessionId, sessionId); return; }
          speakNext();
        }, 50);
      };

      // chunk-level onerror (kept mostly as before)
      utter.onerror = (err) => {
        if (mySessionId !== sessionId) { safeLog('chunk onerror ignored due to session mismatch', mySessionId, sessionId); return; }
        let m = '';
        try { m = (err && (err.error || err.message)) ? String(err.error || err.message) : String(err); } catch(e) { m = String(err); }
        if (m && /interrupt/i.test(m)) {
          safeLog('chunk utter interrupted (benign):', m);
          setTimeout(() => speakNext(), 60);
          return;
        }

        safeLog('chunk utterance error', err);
        // terminal failure for chunked flow
        try { _clear_disable_overlay_flag(); } catch(e){ safeLog('clear flag on chunk error failed', e); }
        sendState('Not Reading');
        finalizeStatsAndSend();
      };

      try { window.speechSynthesis.speak(utter); } catch (e) {
        safeLog('speak failed', e);
        try { _clear_disable_overlay_flag(); } catch(e){}
        sendState('Not Reading');
        finalizeStatsAndSend();
      }
    }

    // kick off
    sendState('Reading...');
    speakNext();
  }, { timeout: 1000 });

  return { ok: true };
}



function speakChunksSequentially(chunks, rate = 1, voiceName) {
  safeLog('speakChunksSequentially called', chunks.length, { rate, voiceName });
  if (!chunks || !chunks.length) { safeLog('no chunks'); return { ok: false, error: 'no-chunks' }; }
  rate = clamp(rate, 0.5, 1.6);
  speedChunks = chunks; speedIndex = 0; speedActive = true;
  sessionId += 1;
  const mySessionId = sessionId;
  try { window.speechSynthesis.cancel(); } catch(e){}
  clearHighlights();
  readStartTs = Date.now(); accumulatedElapsed = 0; pendingSecondsForSend = 0; lastStatsSendTs = Date.now(); startAutoStatsTimer();

  // Resolve voices first
  resolveVoices(function(voices) {
    if (mySessionId !== sessionId) { safeLog('speed speak aborted due session change during voice resolution', mySessionId, sessionId); return; }

    let chosen = null;
    try {
      if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
      if (!chosen) {
        const lang = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
        chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(lang)) || voices[0] || null;
      }
    } catch (e) {
      chosen = (voices && voices[0]) || null;
    }

    const speakNext = () => {
      if (mySessionId !== sessionId) { safeLog('speed speakNext aborted session mismatch', mySessionId, sessionId); return; }
      if (!speedActive || speedIndex >= speedChunks.length) { speedActive = false; sendState('Not Reading'); finalizeStatsAndSend(); safeLog('speed read finished'); return; }
      const chunkText = sanitizeForTTS(speedChunks[speedIndex++] || '');
      if (!chunkText) { setTimeout(speakNext, 0); return; }
      const u = new SpeechSynthesisUtterance(chunkText);
      if (chosen) try { u.voice = chosen; } catch(e){}
      u.rate = clamp(rate * RATE_SCALE, 0.5, 1.6);
      u.pitch = 1;

      u.onend = () => {
        sendState('Reading...');
        setTimeout(() => speakNext(), Math.max(60, Math.round(200 / Math.max(0.1, u.rate))));
      };

      u.onerror = (err) => {
        let m = '';
        try { m = (err && (err.error || err.message)) ? String(err.error || err.message) : String(err); } catch(e) { m = String(err); }
        if (m && /interrupt/i.test(m)) {
          safeLog('speedRead chunk interrupted (benign):', m);
          setTimeout(() => speakNext(), 60);
          return;
        }

        safeLog('speedRead chunk error', err);
        if (!u._retryAttempted) {
          u._retryAttempted = true;
          const reducedRate = Math.max(0.6, (u.rate || 1) - 0.2);
          safeLog('Retrying speed chunk with reduced rate', reducedRate);
          try {
            const retryU = new SpeechSynthesisUtterance(chunkText);
            if (chosen) try { retryU.voice = chosen; } catch(e){}
            retryU.rate = reducedRate;
            retryU.pitch = 1;
            retryU.onend = () => setTimeout(() => speakNext(), Math.max(60, Math.round(200 / Math.max(0.1, retryU.rate))));
            retryU.onerror = (e2) => {
              safeLog('speedRead retry failed', e2);
              speedActive = false;
              sendState('Not Reading');
              finalizeStatsAndSend();
            };
            window.speechSynthesis.speak(retryU);
            sendState('Reading...');
          } catch (e) {
            safeLog('retry speak failed', e);
            speedActive = false;
            sendState('Not Reading');
            finalizeStatsAndSend();
          }
          return;
        }

        speedActive = false;
        sendState('Not Reading');
        finalizeStatsAndSend();
      };

      try { window.speechSynthesis.speak(u); sendState('Reading...'); } catch (e) { safeLog('speak chunk failed', e); speedActive = false; sendState('Not Reading'); finalizeStatsAndSend(); }
    };
    // kick off
    speakNext();
  }, { timeout: 1000 });

  return { ok: true };
}


  // --- Speed-read
  function splitIntoChunks(text, chunkSize = 3) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
    return chunks;
  }

  function stopSpeedRead() { speedActive = false; speedChunks = null; speedIndex = 0; try { window.speechSynthesis.cancel(); } catch(e){} finalizeStatsAndSend(); sendState('Not Reading'); safeLog('stopSpeedRead called'); }

  function pauseReading() {
    try {
      if (window.speechSynthesis && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        if (readStartTs) { accumulatedElapsed += (Date.now() - readStartTs) / 1000; readStartTs = null; }
        if (readTimer) { clearInterval(readTimer); readTimer = null; }
        sendState('Paused');
        safeLog('pauseReading called and paused');
        return { ok: true };
      } else {
        safeLog('pauseReading: nothing to pause');
        return { ok: false, error: 'nothing-to-pause' };
      }
    } catch (e) { safeLog('pauseReading error', e); return { ok: false, error: String(e) }; }
  }
  function resumeReading() {
    try {
      if (window.speechSynthesis && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        readStartTs = Date.now();
        startAutoStatsTimer();
        sendState('Reading...');
        safeLog('resumeReading called and resumed');
        return { ok: true };
      } else {
        safeLog('resumeReading: nothing to resume');
        return { ok: false, error: 'nothing-to-resume' };
      }
    } catch (e) { safeLog('resumeReading error', e); return { ok: false, error: String(e) }; }
  }

  function stopReadingAll() {
    try {
      // mark session changed so any pending utterances stop continuing
      sessionId += 1;
      stoppedAlready = true;
          try { window.__clarityread_disable_overlay = false; } catch(e){}

      try { window.speechSynthesis.cancel(); } catch(e){}
      if (readStartTs) { accumulatedElapsed += (Date.now() - readStartTs) / 1000; readStartTs = null; }
      if (readTimer) { clearInterval(readTimer); readTimer = null; }
      const toSend = Math.floor(accumulatedElapsed || 0);
      if (toSend > 0) {
        try { chrome.runtime.sendMessage({ action: 'updateStats', duration: toSend }, () => {}); } catch (e) { safeLog('updateStats send failed', e); }
        accumulatedElapsed = 0;
      }
      stopSpeedRead();
      removeReaderOverlay();
      clearHighlights();
      sendState('Not Reading');
      safeLog('stopReadingAll called, sent stats seconds:', toSend);
      // try restore if truncated
      try { __clarityread_restoreMainIfTruncated(); } catch(e) { safeLog('restoreMainIfTruncated on stop failed', e); }
      // reset stoppedAlready after a short delay so future reads allowed
      setTimeout(() => { stoppedAlready = false; }, 250);
      return { ok: true };
    } catch (e) { safeLog('stopReadingAll error', e); stoppedAlready = false; return { ok: false, error: String(e) }; }
  }

  // --- Helpers to get page text or selection
function getTextToRead() {
  try {
    // Try live selection first
    const sel = window.getSelection ? window.getSelection() : null;
    const s = (sel && typeof sel.toString === 'function') ? sel.toString() : '';

    if (s && s.trim().length > 0) {
      safeLog('getTextToRead returning selection length', s.length);
      return s.trim();
    }

    safeLog('getTextToRead start heuristics', {
      selectionLen: s.length,
      activeElementTag: (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName : null,
      docBodyLen: (document.body && document.body.innerText) ? document.body.innerText.length : 0
    });

    // prefer large visible contenteditable editors (e.g., web-based editors)
    try {
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
      if (editables.length) {
        editables.sort((a,b) => ((b.innerText||'').length - (a.innerText||'').length));
        if ((editables[0].innerText || '').trim().length >= 40) {
          const tEd = editables[0].innerText.trim();
          safeLog('getTextToRead using contenteditable text length', tEd.length);
          return tEd;
        }
      }
    } catch(e){ safeLog('getTextToRead contenteditable check failed', e); }

    // fallback to main node found by getMainNode()
    const main = (typeof getMainNode === 'function') ? getMainNode() : (document.body || document.documentElement);
    let t = (main && main.innerText) ? main.innerText.trim() : (document.body && document.body.innerText ? document.body.innerText.trim() : '');

    if (t && t.length > 20000) {
      safeLog('getTextToRead truncated main text to 20000 chars');
      return t.slice(0, 20000);
    }
    safeLog('getTextToRead main text length', (t || '').length);
    return t ? t : '';
  } catch (e) {
    safeLog('getTextToRead err', e);
    return '';
  }
}


  function detectLanguage() {
    const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
    safeLog('detectLanguage', lang);
    return lang;
  }

// --- Focus-mode toggle (uses overlay)
function toggleFocusMode() {
    try {
    safeLog()('[ClarityRead contentScript] toggleFocusMode called; overlayActive=', overlayActive);
    safeLog()('[ClarityRead contentScript] toggleFocusMode stack');
  } catch(e){}

  if (overlayActive) {
    removeReaderOverlay();
    clearHighlights();
    sendState('Not Reading');
    safeLog('toggleFocusMode: closed overlay');
    return { ok: true, overlayActive: false, url: location.href || '' };
  }

  // Prefer the robust extractor if available (same helper popup uses)
  let t = '';
  try {
    if (typeof window.__clarity_read_extract === 'function') {
      try {
        const ex = window.__clarity_read_extract();
        if (ex && typeof ex.text === 'string' && ex.text.trim().length) {
          t = ex.text.trim();
          safeLog('toggleFocusMode: used __clarity_read_extract text length', t.length);
        }
      } catch (e) {
        safeLog('toggleFocusMode: __clarity_read_extract threw', e);
      }
    }
  } catch(e) { safeLog('toggleFocusMode extractor check failed', e); }

  // fallback to simpler heuristic if extractor not present or returned nothing
  if (!t) {
    t = getTextToRead();
    safeLog('toggleFocusMode: fallback getTextToRead length', (t && t.length) || 0);
  }

  if (!t || !t.trim()) {
    safeLog('toggleFocusMode: no text to show in focus mode');
    return { ok: false, error: 'no-text', url: location.href || '' };
  }

  // backup before opening focus mode
  __clarityread_backupMain();

  createReaderOverlay(t);
  sendState('Not Reading'); // overlay itself doesn't start reading
  safeLog('toggleFocusMode: opened overlay');
  return { ok: true, overlayActive: true, url: location.href || '' };
}

  /// --- Contrast / Invert runtime style injection (more resilient)
const CLARITY_CONTRAST_STYLE_ID = 'clarity-contrast-style';
const CLARITY_INVERT_STYLE_ID = 'clarity-invert-style';

// short-lived MutationObservers to resist immediate site JS that nukes our classes/attrs
let contrastObserver = null;
let invertObserver = null;
const GUARD_TIMEOUT_MS = 10_000; // how long the observer tries to reapply classes/attrs

function ensureContrastStyle() {
  if (document.getElementById(CLARITY_CONTRAST_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = CLARITY_CONTRAST_STYLE_ID;
  st.type = 'text/css';

  st.textContent = `
/* class and dataset attribute selectors as fallbacks */
html.readeasy-contrast, html.readeasy-contrast body,
html.clarityread-contrast, html.clarityread-contrast body,
html[data-clarity-contrast="1"], html[data-clarity-contrast="1"] body {
  background-color: #000 !important;
  color: #fff !important;
}
html.readeasy-contrast *:not(script):not(style):not(iframe),
html.clarityread-contrast *:not(script):not(style):not(iframe),
html[data-clarity-contrast="1"] *:not(script):not(style):not(iframe) {
  background: transparent !important;
  color: #fff !important;
  border-color: #666 !important;
}
html.readeasy-contrast a, html.clarityread-contrast a, html[data-clarity-contrast="1"] a {
  color: #00ffff !important;
  text-decoration: underline !important;
}
html.readeasy-contrast img, html.clarityread-contrast img, html[data-clarity-contrast="1"] img {
  filter: grayscale(50%) contrast(120%) brightness(1.05) !important;
  opacity: 0.95 !important;
  border: 1px solid #444 !important;
}
`;
  try { (document.head || document.documentElement).appendChild(st); } catch (e) { try { document.documentElement.appendChild(st); } catch(_){} }
}

function removeContrastStyle() {
  try { const el = document.getElementById(CLARITY_CONTRAST_STYLE_ID); if (el) el.remove(); } catch (e) {}
  stopContrastGuard();
}

function ensureInvertStyle() {
  if (document.getElementById(CLARITY_INVERT_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = CLARITY_INVERT_STYLE_ID;
  st.type = 'text/css';
  st.textContent = `
html.readeasy-invert, html.readeasy-invert body,
html.clarityread-invert, html.clarityread-invert body,
html[data-clarity-invert="1"], html[data-clarity-invert="1"] body {
  filter: invert(100%) hue-rotate(180deg) !important;
}
html.readeasy-invert img, html.readeasy-invert video,
html.clarityread-invert img, html.clarityread-invert video,
html[data-clarity-invert="1"] img, html[data-clarity-invert="1"] video {
  filter: invert(100%) hue-rotate(180deg) !important;
}
`;
  try { (document.head || document.documentElement).appendChild(st); } catch (e) { try { document.documentElement.appendChild(st); } catch(_){} }
}

function removeInvertStyle() {
  try { const el = document.getElementById(CLARITY_INVERT_STYLE_ID); if (el) el.remove(); } catch (e) {}
  stopInvertGuard();
}


function startContrastGuard() {
  try {
    const el = document.documentElement;
    // ensure both class + data attr
    el.classList.add('readeasy-contrast', 'clarityread-contrast');
    el.setAttribute('data-clarity-contrast', '1');

    // disconnect any prior observer
    if (contrastObserver) { contrastObserver.disconnect(); contrastObserver = null; }

    contrastObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'data-clarity-contrast')) {
          // reapply if missing
          if (!el.classList.contains('readeasy-contrast')) el.classList.add('readeasy-contrast');
          if (!el.classList.contains('clarityread-contrast')) el.classList.add('clarityread-contrast');
          if (el.getAttribute('data-clarity-contrast') !== '1') el.setAttribute('data-clarity-contrast', '1');
        }
      }
    });
    contrastObserver.observe(el, { attributes: true, attributeFilter: ['class', 'data-clarity-contrast'] });

    // auto-stop after a short period to avoid long-lived observers
    setTimeout(() => { try { if (contrastObserver) { contrastObserver.disconnect(); contrastObserver = null; } } catch (e) {} }, GUARD_TIMEOUT_MS);
  } catch (e) { safeLog('startContrastGuard failed', e); }
}

function stopContrastGuard() {
  try {
    if (contrastObserver) { contrastObserver.disconnect(); contrastObserver = null; }
  } catch (e) {}
}

function startInvertGuard() {
  try {
    const el = document.documentElement;
    el.classList.add('readeasy-invert', 'clarityread-invert');
    el.setAttribute('data-clarity-invert', '1');

    if (invertObserver) { invertObserver.disconnect(); invertObserver = null; }

    invertObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'data-clarity-invert')) {
          if (!el.classList.contains('readeasy-invert')) el.classList.add('readeasy-invert');
          if (!el.classList.contains('clarityread-invert')) el.classList.add('clarityread-invert');
          if (el.getAttribute('data-clarity-invert') !== '1') el.setAttribute('data-clarity-invert', '1');
        }
      }
    });
    invertObserver.observe(el, { attributes: true, attributeFilter: ['class', 'data-clarity-invert'] });

    setTimeout(() => { try { if (invertObserver) { invertObserver.disconnect(); invertObserver = null; } } catch (e) {} }, GUARD_TIMEOUT_MS);
  } catch (e) { safeLog('startInvertGuard failed', e); }
}

function stopInvertGuard() {
  try {
    if (invertObserver) { invertObserver.disconnect(); invertObserver = null; }
  } catch (e) {}
}



  // --- Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      safeLog('onMessage received', msg, 'from', sender && sender.tab ? { tabId: sender.tab.id, url: sender.tab.url } : sender);
      if (!msg || !msg.action) { sendResponse({ ok: false }); safeLog('onMessage missing action -> responded false'); return true; }
      // at the top of the onMessage handler (before other cases)
if (msg && msg.action === 'set_debug') {
  try {
    window.__clarityread_debug = !!msg.debug;
    safeLog('set_debug message applied ->', window.__clarityread_debug);
    sendResponse({ ok: true, debug: window.__clarityread_debug });
  } catch (e) {
    try { sendResponse({ ok: false, error: String(e) }); } catch(_) {}
  }
  return true; // keep channel open (not necessary but consistent)
}

      switch (msg.action) {
        case 'applySettings':
          try {
            if (typeof msg.dys !== 'undefined') {
              if (msg.dys) {
                try { ensureDysFontInjected(); } catch(e){ safeLog('ensureDysFontInjected threw', e); }
                try { document.documentElement.classList.add('readeasy-dyslexic'); } catch(e){}
                try { document.documentElement.classList.add('clarityread-dyslexic'); } catch(e){}
              } else {
                try { document.documentElement.classList.remove('readeasy-dyslexic'); } catch(e){}
                try { document.documentElement.classList.remove('clarityread-dyslexic'); } catch(e){}
                try { removeDysFontInjected(); } catch(e){}
              }
            }
// Contrast toggle
if (typeof msg.contrast !== 'undefined') {
  if (msg.contrast) {
    try {
      ensureContrastStyle();
      document.documentElement.classList.add('readeasy-contrast', 'clarityread-contrast');
      document.documentElement.setAttribute('data-clarity-contrast', '1');
      startContrastGuard();
    } catch(e){}
  } else {
    try {
      document.documentElement.classList.remove('readeasy-contrast', 'clarityread-contrast');
      document.documentElement.removeAttribute('data-clarity-contrast');
      removeContrastStyle();
      stopContrastGuard();
    } catch(e){}
  }
}

// Invert toggle
if (typeof msg.invert !== 'undefined') {
  if (msg.invert) {
    try {
      ensureInvertStyle();
      document.documentElement.classList.add('readeasy-invert', 'clarityread-invert');
      document.documentElement.setAttribute('data-clarity-invert', '1');
      startInvertGuard();
    } catch(e){}
  } else {
    try {
      document.documentElement.classList.remove('readeasy-invert', 'clarityread-invert');
      document.documentElement.removeAttribute('data-clarity-invert');
      removeInvertStyle();
      stopInvertGuard();
    } catch(e){}
  }
}


            // Apply/Remove reflow class (document-level marker kept for compatibility)
            if (typeof msg.reflow !== 'undefined') {
              if (msg.reflow) {
                try {
                  // Use our safer scoped approach
                  const sizeNum = (typeof msg.fontSize === 'number') ? msg.fontSize : Number(String(msg.fontSize || 20).replace('px','')) || 20;
                  const r = window.ClarityRead.applyClarityFontSize(sizeNum);
                  safeLog('applySettings applied scoped reflow', r);
                } catch(e) { safeLog('applySettings applyClarityFontSize failed', e); }
              } else {
                try {
                  const r = window.ClarityRead.removeClarityReflow();
                  safeLog('applySettings removed scoped reflow', r);
                } catch(e) { safeLog('applySettings removeClarityReflow failed', e); }
              }
            }

            if (msg.contrast) document.documentElement.classList.add('readeasy-contrast'); else document.documentElement.classList.remove('readeasy-contrast');
            if (msg.invert) document.documentElement.classList.add('readeasy-invert'); else document.documentElement.classList.remove('readeasy-invert');

            // centralize reflow/font-size handling using helper so both overlay + page are consistent
            if (typeof msg.fontSize !== 'undefined') {
              try {
                // If reflow requested, ClarityRead.applyClarityFontSize already handled font-size above.
                if (!msg.reflow) {
                  // no reflow requested: set CSS variable (avoid body.style writes)
                  const fs = (typeof msg.fontSize === 'number') ? `${msg.fontSize}px` : String(msg.fontSize);
                  try {
                    document.documentElement.style.setProperty('--readeasy-font-size', fs);
                    document.documentElement.style.setProperty('--clarity-font-size', fs);
                  } catch(e) { safeLog('setting font-size variable failed', e); }
                  // also update overlay if present
                  try {
                    const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay');
                    if (overlay) overlay.style.fontSize = (typeof msg.fontSize === 'number') ? `${msg.fontSize}px` : String(msg.fontSize);
                  } catch(e){ safeLog('overlay font set failed', e); }
                }
              } catch (e) { safeLog('fontSize apply branch failed', e); }
            }

            // Update overlay styling immediately so popup toggles reflect on-overlay changes:
            try {
              const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay');
              if (overlay) {
                if (typeof msg.dys !== 'undefined') {
                  if (msg.dys) overlay.style.fontFamily = "'OpenDyslexic', system-ui, Arial, sans-serif";
                  else overlay.style.fontFamily = '';
                }
                if (typeof msg.fontSize !== 'undefined' && msg.fontSize) {
                  overlay.style.fontSize = (typeof msg.fontSize === 'number') ? `${msg.fontSize}px` : String(msg.fontSize);
                }
              }
            } catch (e) { safeLog('applySettings overlay update failed', e); }

            safeLog('applySettings applied', { dys: !!msg.dys, reflow: !!msg.reflow, fontSize: msg.fontSize });
          } catch (e) {
            safeLog('applySettings failed', e);
          }
          sendResponse({ ok: true });
          safeLog('applySettings responded ok');
          break;

        case 'clarity_query_overlay': {
          try {
            const has = !!document.getElementById('readeasy-reader-overlay');
            sendResponse({ ok: true, overlayActive: has });
          } catch (e) { sendResponse({ ok: true, overlayActive: !!overlayActive }); }
          break;
        }

       // NEW: extraction for popup summarizer -> returns cleaned text/html/title
case 'clarity_extract_main': {
  try {
    // 1) Check for selection first
    const sel = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
    if (sel && sel.trim().length > 20) {
      // --- DOM-based selection cleaning for better noise removal ---
      let cleanedSel = sel.trim();
      
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          // Extract the DOM nodes that were selected
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          const parentEl = (container.nodeType === Node.TEXT_NODE) ? container.parentElement : container;
          
          if (parentEl) {
            // Clone the selected region to safely clean it without affecting the page
            const clone = parentEl.cloneNode(true);
            
            // Remove all noise selectors (same strategy as main extraction)
            const noiseSelectors = [
              'nav', 'aside', 'footer', 'header',
              '.related', '.related-articles', '.related-content', '.related-links', '.related-posts',
              '.trending', '.popular', '.most-read', '.latest', '.more-stories',
              '.ad', '.ads', '.advert', '.advertisement', '.promo', '.sponsored', '.promo-banner',
              '.author', '.byline', '.contributor', '.meta', '.article-meta', '.post-meta',
              '.share', '.social', '.social-share', '.share-buttons',
              '.comments', '.comment', '.comment-list', '.disqus',
              '.newsletter', '.subscribe', '.signup', '.cta', '.call-to-action',
              '.breadcrumb', '.breadcrumbs', '.tags', '.tag-list', '.topics',
              '[class*="related"]', '[class*="trending"]', '[class*="promo"]', 
              '[class*="sidebar"]', '[class*="aside"]',
              '[id*="related"]', '[id*="trending"]', '[id*="sidebar"]'
            ];
            
            noiseSelectors.forEach(sel => {
              try {
                clone.querySelectorAll(sel).forEach(n => { try { n.remove(); } catch(e){} });
              } catch(e){ safeLog('noise selector removal failed for', sel, e); }
            });
            
            // Remove script/style/iframe/svg elements
            try {
              clone.querySelectorAll('script, style, iframe, svg, noscript').forEach(n => { try { n.remove(); } catch(e){} });
            } catch(e){}
            
            // Remove elements with suspicious text patterns (short noise blocks)
            try {
              Array.from(clone.querySelectorAll('*')).forEach(el => {
                const txt = (el.textContent || '').trim();
                // Only remove if short and matches noise patterns
                if (txt.length < 200) {
                  if (/^(Related|Trending|Popular|You may also like|More from|More stories|Advertisement|Sponsored|Subscribe|Newsletter|Sign up|Share this|Follow us|Read more|Continue reading|Comments?|Leave a comment)/i.test(txt)) {
                    try { el.remove(); } catch(e){}
                  }
                }
              });
            } catch(e){ safeLog('suspicious text pattern removal failed', e); }
            
            // Get cleaned text from the pruned clone
            cleanedSel = (clone.innerText || clone.textContent || sel).trim();
            safeLog('DOM-based selection cleaning applied', { original: sel.length, cleaned: cleanedSel.length });
          }
        }
      } catch(e) {
        safeLog('DOM-based selection cleaning failed, using raw selection', e);
        cleanedSel = sel.trim();
      }
      
      // Apply additional text-level cleaning
      cleanedSel = _postCleanExtractedText(cleanedSel);
      
      sendResponse({ ok: true, text: cleanedSel, html: '', title: document.title || '', url: location.href || '' });
      safeLog('clarity_extract_main responded with cleaned selection', { textLen: cleanedSel.length, title: document.title, url: location.href });
      return true;
    }

    // 2) No selection -> use Readability for full page extraction
    const main = getMainNode();
    const out = extractCleanMainTextAndHtml(main);
    
    // 3) If tiny result, attempt contenteditable fallback (for editors like Google Docs)
    if ((!out.text || out.text.length < 120)) {
      try {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
        if (editables.length) {
          editables.sort((a,b) => ((b.innerText||'').length - (a.innerText||'').length));
          const agg = editables.map(e => (e.innerText || '')).join('\n\n');
          const cleaned = _postCleanExtractedText(String(agg || '').replace(/\s{2,}/g, ' ').trim());
          if (cleaned && cleaned.length > (out.text || '').length) {
            sendResponse({ ok: true, text: cleaned, html: '', title: document.title || '', url: location.href || '' });
            safeLog('clarity_extract_main used contenteditable fallback', { textLen: cleaned.length, title: document.title, url: location.href });
            return true;
          }
        }
      } catch(e){ safeLog('contenteditable fallback failed', e); }
    }

    // 4) Return the main extraction result
    sendResponse({ ok: true, text: out.text || '', html: out.html || '', title: out.title || '', url: location.href || '' });
    safeLog('clarity_extract_main responded', { textLen: (out.text || '').length, title: out.title, url: location.href });
  } catch (e) {
    safeLog('clarity_extract_main failed', e);
    try { sendResponse({ ok: false, error: String(e), url: location.href || '' }); } catch(e2) {}
  }
  break;
}


      // simplified pseudo-patch illustrating the approach
case 'readAloud': {
  const __DEBUG = !!(window && window.__clarityread_debug);
  const dbg = (...a) => { if (__DEBUG) try { safeLog()('[ClarityRead DBG]', ...a); } catch(e){} };
  const dbglog = (...a) => { if (__DEBUG) try { safeLog()('[ClarityRead DBG]', ...a); } catch(e){} };

  if (typeof window.__simpleHash !== 'function') {
    window.__simpleHash = function(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; };
  }
  if (typeof window.__lastReadFingerprint === 'undefined') { window.__lastReadFingerprint = null; window.__lastReadTs = 0; }

    function checkAndRecordDuplicate(text) {
    try {
      // Use a global fingerprint so duplicate suppression works across calls
      const fpSource = String(text || '').slice(0, 2000);
      const fingerprint = (typeof window.__simpleHash === 'function') ? window.__simpleHash(fpSource) : 0;
      const now = Date.now();
      const DUP_WINDOW_MS = 3000; // small window to avoid accidental double-trigger
      if (fingerprint === (window.__lastReadFingerprint || null) && (now - (window.__lastReadTs || 0)) < DUP_WINDOW_MS) {
        dbg('duplicate suppressed', { len: fpSource.length });
        return { duplicate: true };
      }
      window.__lastReadFingerprint = fingerprint;
      window.__lastReadTs = now;
      return { duplicate: false };
    } catch (e) { dbglog('duplicate check error', e); return { duplicate: false }; }
  }


  function getStoredSelection(cb) {
    try {
      chrome.storage.local.get(['clarity_last_selection'], (res) => {
        try {
          const s = res && res.clarity_last_selection && res.clarity_last_selection.text ? String(res.clarity_last_selection.text).trim() : '';
          cb(s || '');
        } catch (e) { cb(''); }
      });
    } catch (e) { cb(''); }
  }

  chrome.storage.sync.get(['voice','rate','pitch','highlight'], (store) => {
    const voice = (typeof msg.voice === 'string') ? msg.voice : (store && store.voice) ? store.voice : '';
    const rate = (typeof msg.rate !== 'undefined' && !isNaN(Number(msg.rate))) ? Number(msg.rate) : (store && typeof store.rate !== 'undefined' ? Number(store.rate) : 1);
    const pitch = (typeof msg.pitch !== 'undefined' && !isNaN(Number(msg.pitch))) ? Number(msg.pitch) : (store && typeof store.pitch !== 'undefined' ? Number(store.pitch) : 1);
    const highlight = (typeof msg.highlight !== 'undefined') ? !!msg.highlight : !!(store && store.highlight);

    // NEW priority: saved -> live selection -> stored selection -> extractor -> body
    (function attemptGetText(cb) {
      try {
        const saved = (typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : '';
        if (saved) return cb(saved);

        // 1) live selection (prefer this)
        try {
          const sel = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
          if (sel && sel.trim()) return cb(sel.trim());
        } catch (e) { dbglog('live selection read failed', e); }

        // 2) stored selection (helpful when popup stole focus)
        getStoredSelection((stored) => {
          try {
            if (stored && stored.trim()) return cb(stored.trim());

            // 3) extractor as a fallback
            if (typeof window.__clarity_read_extract === 'function') {
              try {
                const ex = window.__clarity_read_extract();
                if (ex && ex.text && String(ex.text || '').trim()) return cb(String(ex.text || '').trim());
              } catch (e) { dbglog('extractor threw', e); }
            }

            // 4) last resort: document.body
            const bodyText = (document.body && document.body.innerText) ? String(document.body.innerText || '').trim() : '';
            return cb(bodyText || '');
          } catch (e) { dbglog('stored-selection branch failed', e); cb(''); }
        });
      } catch (e) {
        dbglog('attemptGetText outer error', e);
        cb('');
      }
    })(function (text) {
      try {
        if (!text || !text.trim()) {
          // retry once after a short delay (dynamic pages)
          setTimeout(() => {
            (function retryGetText(cb) {
              try {
                const saved2 = (typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : '';
                if (saved2) return cb(saved2);

                const sel2 = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
                if (sel2 && sel2.trim()) return cb(sel2.trim());

                // storage fallback
                getStoredSelection((stored2) => {
                  if (stored2 && stored2.trim()) return cb(stored2.trim());
                  if (typeof window.__clarity_read_extract === 'function') {
                    try {
                      const ex2 = window.__clarity_read_extract();
                      if (ex2 && ex2.text && String(ex2.text || '').trim()) return cb(String(ex2.text || '').trim());
                    } catch (e) { dbglog('extractor threw on retry', e); }
                  }
                  const body2 = (document.body && document.body.innerText) ? String(document.body.innerText || '').trim() : '';
                  return cb(body2 || '');
                });
              } catch (e) { dbglog('retryGetText error', e); cb(''); }
            })(function (text2) {
              try {
                if (!text2 || !text2.trim()) {
                  const selection = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
                  try { sendResponse({ ok:false, error:'no-text', diag: { selectionLen: selection.length, bodyLen:(document.body && document.body.innerText||'').length } }); } catch(e){}
                  return;
                }
                const dup2 = checkAndRecordDuplicate(text2);
                if (dup2.duplicate) { try { sendResponse({ ok:false, error:'duplicate-read' }); } catch(e){}; return; }
                const r2 = speakText(text2, { voiceName: voice, rate, pitch, highlight });
                try { sendResponse(r2 || { ok:true }); } catch(e){}
              } catch (e) { dbglog('retry speak error', e); try { sendResponse({ ok:false, error: String(e) }); } catch(e2){} }
            });
          }, 400);
          return;
        }

        const dup = checkAndRecordDuplicate(text);
        if (dup.duplicate) { try { sendResponse({ ok:false, error:'duplicate-read' }); } catch(e){}; return; }

        const r = speakText(text, { voiceName: voice, rate, pitch, highlight });
        try { sendResponse(r || { ok:true }); } catch(e) {}
      } catch (e) { dbglog('speak error', e); try { sendResponse({ ok:false, error: String(e) }); } catch(e2){} }
    });
  });

  return true; // keep channel open for async sendResponse
}
        case 'speedRead': {
  chrome.storage.sync.get(['voice'], (res) => {
    const chunkSize = Number(msg.chunkSize || msg.chunk || 3);
    const r = Number(msg.rate || 1);
    const text = (typeof msg.text === 'string' && msg.text.length) ? msg.text : ((typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead());
    if (!text || !text.trim()) { 
      safeLog('speedRead: no-text'); 
      sendResponse({ ok: false, error: 'no-text' }); 
      return; 
    }
    const chunks = splitIntoChunks(text, Math.max(1, Math.floor(chunkSize)));
    safeLog('speedRead will speak chunks', chunks.length, { chunkSize, rate: r });
    const out = speakChunksSequentially(chunks, clamp(r, 0.5, 1.6), (msg.voice || res.voice));
    sendResponse(out || { ok: true });
  });
  return true; // Keep message channel open for async callback
}

        case 'toggleFocusMode': {
          const res = toggleFocusMode();
          sendResponse(res);
          safeLog('toggleFocusMode responded', res);
          break;
        }

        case 'stopReading': {
          const res = stopReadingAll();
          sendResponse(res);
          safeLog('stopReading responded', res);
          break;
        }

        case 'pauseReading': {
          const res = pauseReading();
          sendResponse(res);
          safeLog('pauseReading responded', res);
          break;
        }

        case 'resumeReading': {
          const res = resumeReading();
          sendResponse(res);
          safeLog('resumeReading responded', res);
          break;
        }

        case 'detectLanguage': {
          const lang = detectLanguage();
          sendResponse({ ok: true, lang });
          safeLog('detectLanguage responded', lang);
          break;
        }

        case 'getSelection': {
          try {
            const selText = window.getSelection ? window.getSelection().toString().trim() : '';
            const resp = { ok: true, selection: { text: selText || '', title: document.title || '', url: location.href || '' } };
sendResponse(resp);

            safeLog('getSelection responded', { textLen: (selText||'').length, title: document.title });
          } catch (e) {
            safeLog('getSelection failed', e);
            try { sendResponse({ ok: false, error: String(e) }); } catch(e2) { safeLog('sendResponse failed after exception', e2); }
          }
          break;
        }

        default:
          safeLog('unknown-action', msg.action);
          sendResponse({ ok: false, error: 'unknown-action' });
      }
    } catch (e) {
      safeLog('contentScript onMessage error', e);
      try { sendResponse({ ok: false, error: String(e) }); } catch(e2) { safeLog('sendResponse failed after exception', e2); }
    }
    // indicate async response support
    return true;
  });

 } // end of startClarityReadContentScript function

// DOM-ready wrapper: call startClarityReadContentScript once the page DOM is ready
(function initOnce() {
  const run = () => {
    try {
      startClarityReadContentScript();
      // mark loaded only after start finishes
      window.__clarityread_contentScriptLoaded = true;
      try { safeLog()('[ClarityRead contentScript] initialized at', location.href); } catch(e){}
    } catch (e) {
      try { safeLog()('[ClarityRead] failed to start', e); } catch(_) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
    // Also fall back to run after short timeout in case DOMContentLoaded was missed
    setTimeout(() => { if (!window.__clarityread_contentScriptLoaded) run(); }, 1200);
  } else {
    // already ready
    setTimeout(run, 0);
  }
})();


