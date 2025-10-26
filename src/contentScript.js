// contentScript.js
// Handles applySettings, readAloud, speedRead, pause/resume/stop, selection, detectLanguage.
// All speech synthesis happens in this file only.

(function () {
  if (window.__clarityread_contentScriptLoaded) {
    try { console.debug('[ClarityRead contentScript] already loaded.'); } catch(e){}
    return;
  }
  window.__clarityread_contentScriptLoaded = true;

  // ---------- Reflow / dys / overlay helpers ----------
  (function() {
    if (window.__clarity_reflow_installed) return;
    window.__clarity_reflow_installed = true;

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

        /* IMPORTANT: limit scope to article-like containers only.
           Avoid applying to the entire page to prevent breaking complex layouts. */
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

    // Apply font-size to article containers. If no known container matches,
    // apply to the "main node" found by getMainNode() inline (safe fallback).
    function applyClarityFontSize(px) {
      try {
        ensureReflowStyle();
        let v = Number(px) || 20;
        v = Math.max(10, Math.min(48, Math.round(v))); // clamp

        // store previous inline body font-size (so we can restore it on remove)
        try {
          if (_prevBodyFontSize === null) {
            _prevBodyFontSize = (document.body && document.body.style && document.body.style.fontSize) ? document.body.style.fontSize : null;
          }
        } catch (e) { _prevBodyFontSize = null; }

        // set CSS variables (include unit) — preferred approach
        document.documentElement.style.setProperty('--clarity-font-size', v + 'px');
        document.documentElement.style.setProperty('--readeasy-font-size', v + 'px');

        // supportive line height
        const lh = (1.25 + Math.min(0.6, (v - 14) / 80)).toFixed(2);
        document.documentElement.style.setProperty('--clarity-line-height', lh);

        // Add compatibility classes (both historical names)
        document.documentElement.classList.add('clarityreflow-active');
        document.documentElement.classList.add('clarityread-reflow');
        document.documentElement.classList.add('readeasy-reflow');

        // set body inline for sites that read inline font-size (best-effort)
        try { document.body.style.fontSize = v + 'px'; } catch(e) {}

        // If the page's article container doesn't pick up our rules due to very specific site CSS,
        // also apply a safe inline font-size to the 'mainNode' (restorable on remove).
        try {
          const main = (typeof getMainNode === 'function') ? getMainNode() : null;
          if (main && main instanceof Element) {
            // Save previous inline styles for this node (one-time)
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

 
// --- State
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
  let errorFallbackAttempted = false;
  let stoppedAlready = false;
  let speedChunks = null;
  let speedIndex = 0;
  let speedActive = false;
  let sessionId = 0; // incremental session id to guard against races

  // New: coalesced state sending
  let lastSentState = 'Not Reading'; // 'Reading...', 'Paused', 'Not Reading'

  const STATS_SEND_INTERVAL_MS = 10000;
  const MAX_OVERLAY_CHARS = 10000;
  const MAX_SPANS_BEFORE_OVERLAY = 3000;
  const DYS_STYLE_ID = 'readeasy-dysfont';
  const RATE_SCALE = 0.85; // slightly slower baseline so UI rate=1 feels natural

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
  const safeLog = (...a) => { try { console.log('[ClarityRead contentScript]', ...a); } catch (e) {} };

  safeLog('✅ contentScript loaded for', location.href);

  // Helper: send coalesced runtime messages (avoid spamming popup)
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

  // --- Overlay state notifier for popup/background
  function notifyOverlayState(active) {
    try {
      chrome.runtime.sendMessage({ action: 'clarity_overlay_state', overlayActive: !!active }, () => {});
    } catch (e) { safeLog('notifyOverlayState failed', e); }
  }

  /* lightweight selection tracker to persist last selection so popup can read it
     Only stores text > 20 chars to avoid tiny accidental selections.
  */
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


  // --- sanitize text for TTS
  function sanitizeForTTS(s) {
    if (!s) return '';
    return String(s).replace(/\s+/g, ' ').trim();
  }

  // --- Font injection for OpenDyslexic
  function ensureDysFontInjected() {
    if (document.getElementById(DYS_STYLE_ID)) return;

    const urlWoff2 = chrome.runtime.getURL('src/fonts/OpenDyslexic-Regular.woff2');
    const urlWoff  = chrome.runtime.getURL('src/fonts/OpenDyslexic-Regular.woff');

    const style = document.createElement('style');
    style.id = DYS_STYLE_ID;
    style.textContent = `
      @font-face {
        font-family: 'OpenDyslexic';
        src: url("${urlWoff2}") format("woff2"),
             url("${urlWoff}") format("woff");
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }

      /* only set font-family when the dyslexic class is present on the html element.
         The contentScript toggles html.readeasy-dyslexic so this rule will apply then. */
      html.readeasy-dyslexic, html.clarityread-dyslexic,
      .readeasy-dyslexic, .clarityread-dyslexic {
        font-family: 'OpenDyslexic', system-ui, Arial, sans-serif !important;
      }
    `;
    try { document.head.appendChild(style); } catch(e){ safeLog('append dys style failed', e); }

    if ('fonts' in document) {
      try {
        const ff = new FontFace('OpenDyslexic',
          `url(${urlWoff2}) format("woff2"), url(${urlWoff}) format("woff")`,
          { display: 'swap' });
        ff.load().then(f => { document.fonts.add(f); safeLog('OpenDyslexic font loaded'); }).catch(()=>{ safeLog('OpenDyslexic font load failed'); });
      } catch(e){ safeLog('FontFace load threw', e); }
    }
  }

  function removeDysFontInjected() { 
    try { 
      const el = document.getElementById(DYS_STYLE_ID); 
      if (el) el.remove(); 
    } catch(e){ safeLog('removeDysFontInjected error', e); } 

    try { 
      document.documentElement.classList.remove('readeasy-dyslexic'); 
      document.documentElement.classList.remove('clarityread-dyslexic'); // compatibility 
    } catch(e){} 

    try { 
      const overlay = document.getElementById('readeasy-reader-overlay') || document.getElementById('clarityread-overlay'); 
      if (overlay) { overlay.style.fontFamily = ''; }
    } catch(e){}
  } 

  // --- Heuristics: choose main content node
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
      if (document.body && (document.body.innerText || '').length > 200) {
        safeLog('getMainNode falling back to document.body');
        return document.body;
      }
    } catch (e) { safeLog('getMainNode err', e); }
    safeLog('getMainNode fallback to documentElement');
    return document.documentElement || document.body;
  }

  // --- Extraction helper: robust cleaning (site-specific heuristics + general noise filtering)
  function extractCleanMainTextAndHtml(mainNode) {
    try {
      const clone = (mainNode && mainNode.cloneNode) ? mainNode.cloneNode(true) : null;
      if (!clone) return { text: '', html: '', title: document.title || '' };

      // default selectors to remove
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

      // site-specific extra selectors (extend as needed)
      const hostname = (location.hostname || '').toLowerCase();
      const siteExtras = {
        'health.clevelandclinic.org': [
          '.related-articles', '.related-articles-module', '.rc-article-related', '.article__related',
          '.trending', '.more-articles', '.cc-byline', '.byline', '.author'
        ],
        'clevelandclinic.org': [
          '.related-articles', '.trending', '.more-articles'
        ],
        'www.nytimes.com': [
          '.meteredContent', '.css-1fanzo5', '.ad-section', '.story-footer', '.StoryBodyCompanionColumn'
        ],
        'nytimes.com': [
          '.meteredContent', '.story-footer'
        ],
        'www.washingtonpost.com': [
          '.paywall', '.latest', '.related-content', '.story-body__aside'
        ],
        'washingtonpost.com': [
          '.paywall'
        ],
        // Add more hosts if needed
      };

      if (siteExtras[hostname] && Array.isArray(siteExtras[hostname])) {
        toRemove.push(...siteExtras[hostname]);
      } else {
        // quick host patterns (subdomain variants)
        Object.keys(siteExtras).forEach(k => {
          if (hostname.endsWith(k)) toRemove.push(...siteExtras[k]);
        });
      }

      // Remove selectors
      try {
        toRemove.forEach(sel => {
          try {
            clone.querySelectorAll(sel).forEach(n => {
              try { n.remove(); } catch (e) {}
            });
          } catch (e) {}
        });
      } catch (e) {}

      // Additional generic heuristic: remove nodes with noisy class/id patterns
      try {
        const noisyRe = /(related|promo|advert|ad-|ad_|ads|subscribe|newsletter|share|social|comments?|footer|header|cookie|breadcrumb|promo|trending|author|byline|meta|signup|signup|cta|paywall)/i;
        Array.from(clone.querySelectorAll('*')).forEach(el => {
          try {
            const idc = (el.id || '') + ' ' + (el.className || '');
            if (noisyRe.test(idc) && (el.innerText || '').length < 600) {
              // small noisy blocks removed, keep big blocks even if class matches
              el.remove();
            }
          } catch (e) {}
        });
      } catch (e) {}

      // remove script/style and sanitize attributes
      try {
        clone.querySelectorAll('script, style, link, iframe').forEach(n => { try { n.remove(); } catch(e){} });
      } catch (e) {}

      // remove inline event handlers / inline styles for safe html fallback
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
          } catch (e) {}
        });
      } catch (e) {}

      // Collect text and fallback HTML
      let text = '';
      try {
        text = clone.innerText || '';
        // collapse whitespace
        text = String(text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
        // remove trailing nav/ref sections common in publisher dumps
        text = text.replace(/\b(References|External links|See also|Further reading|Related articles|Related Articles|Trending|Advertisement)\b[\s\S]*/ig, '');
        // remove emails/contact lines
        text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');
        text = text.replace(/\s{2,}/g, ' ').trim();
      } catch (e) { text = ''; }

      let html = '';
      try {
        html = clone.innerHTML || '';
      } catch (e) { html = ''; }

      // Final safety fallback: if text is tiny, try extracting body text (less filtered)
      if ((!text || text.length < 120) && document.body && document.body.innerText && document.body.innerText.length > 200) {
        try {
          text = String(document.body.innerText || '').replace(/\s{2,}/g, ' ').trim();
        } catch (e) {}
      }

      return { text: (text || '').trim(), html: html || '', title: document.title || '' };
    } catch (err) {
      safeLog('extractCleanMainTextAndHtml error', err);
      return { text: '', html: '', title: document.title || '' };
    }
  }

  // --- Overlay helper (preferred because it avoids DOM mutation issues)
  function createReaderOverlay(text) {
    removeReaderOverlay();
    const overlay = document.createElement('div');
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
    // only apply the dyslexic font if the html element has the dys class; this prevents "sticking"
    overlay.style.fontFamily = dys ? "'OpenDyslexic', system-ui, Arial, sans-serif" : "system-ui, Arial, sans-serif";
    overlay.style.lineHeight = '1.8';
    overlay.style.fontSize = '18px';
    overlay.style.whiteSpace = 'pre-wrap';

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
          // Use unified stop routine so paused/edge cases cleanly stop and finalize stats
          if (typeof stopReadingAll === 'function') {
            stopReadingAll();
          } else {
            try { window.speechSynthesis.cancel(); } catch(e){}
            removeReaderOverlay();
            clearHighlights();
            sendState('Not Reading');
          }
        } catch (e) {
          safeLog('overlay close handler error', e);
          try { window.speechSynthesis.cancel(); } catch(e){}
          removeReaderOverlay();
          clearHighlights();
          sendState('Not Reading');
        }
      });
      overlay.appendChild(close);
    } catch(e){ safeLog('overlay close button create failed', e); }

    const inner = document.createElement('div');
    inner.id = 'readeasy-reader-inner';
    inner.style.whiteSpace = 'pre-wrap';

    const wordRe = /(\S+)(\s*)/g;
    let m;
    wordRe.lastIndex = 0;
    let count = 0;
    while ((m = wordRe.exec(text)) !== null) {
      const sp = document.createElement('span');
      sp.textContent = (m[1] || '') + (m[2] || '');
      sp.classList.add('readeasy-word');
      inner.appendChild(sp);
      count++;
      if (count >= MAX_SPANS_BEFORE_OVERLAY) break;
    }

    // fallback if text is extremely long
    if (text.length > MAX_OVERLAY_CHARS && inner.childNodes.length && inner.childNodes.length * 10 > MAX_OVERLAY_CHARS) {
      // trim inner to a slice
      overlayTextSplice = text.slice(0, MAX_OVERLAY_CHARS);
      inner.innerHTML = '';
      wordRe.lastIndex = 0;
      count = 0;
      while ((m = wordRe.exec(overlayTextSplice)) !== null) {
        const sp = document.createElement('span');
        sp.textContent = (m[1] || '') + (m[2] || '');
        sp.classList.add('readeasy-word');
        inner.appendChild(sp);
        count++;
        if (count >= MAX_SPANS_BEFORE_OVERLAY) break;
      }
    }

    overlay.appendChild(inner);
    try { document.documentElement.appendChild(overlay); } catch(e){ safeLog('append overlay failed', e); }
    overlayActive = true;
    highlightSpans = Array.from(inner.querySelectorAll('.readeasy-word'));
    safeLog('createReaderOverlay created with', highlightSpans.length, 'spans (overlayActive)');
    buildCumLengths();

    // notify popup/background that overlay is active
    try { notifyOverlayState(true); } catch(e){ safeLog('notify overlay create failed', e); }

    return overlay;
  }
  function removeReaderOverlay() {
    const old = document.getElementById('readeasy-reader-overlay');
    if (old) try { old.remove(); } catch(e){}
    overlayActive = false;
    overlayTextSplice = null;
    safeLog('removeReaderOverlay executed');

    // notify popup/background that overlay is closed
    try { notifyOverlayState(false); } catch(e){ safeLog('notify overlay remove failed', e); }
  }

  // --- Highlight management
  function clearHighlights() {
    if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; }

    // If overlay is active, simply remove overlay (do not attempt to replace spans)
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

    // Otherwise attempt to restore any in-place replacements (legacy support)
    if (selectionRestore && selectionRestore.wrapperSelector) {
      try {
        const wrapper = document.querySelector(selectionRestore.wrapperSelector);
        if (wrapper && selectionRestore.originalHtml != null) {
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
      highlightSpans.forEach(s => {
        if (s && s.parentNode) {
          // replace highlight span with plain text node to be safe
          try { s.parentNode.replaceChild(document.createTextNode(s.textContent || ''), s); } catch(e){}
        }
      });
    } catch(e){
      safeLog('clearHighlights replace error', e);
    }

    safeLog('clearHighlights cleared', highlightSpans.length, 'spans');
    highlightSpans = [];
    highlightIndex = 0;
    cumLengths = [];
    overlayActive = false;
    overlayTextSplice = null;
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
      // Create overlay for highlighting — safer across many sites
      createReaderOverlay(text);
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

  // --- Utterance attach handlers (use sessionId to guard races)
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
      // only act if still current session
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

  // --- Stats timer helpers
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

  // --- Speech: robust speakText() with auto-chunking and session guard
  function speakText(fullText, { voiceName, rate = 1, pitch = 1, highlight = false } = {}) {
    safeLog('speakText called len=', (fullText || '').length, { voiceName, rate, pitch, highlight });

    if (!('speechSynthesis' in window)) {
      safeLog('TTS not supported here.');
      sendState('Not Reading');
      return { ok: false, error: 'no-tts' };
    }

    fullText = sanitizeForTTS(fullText || '');
    if (!fullText) { safeLog('No text to read'); return { ok: false, error: 'no-text' }; }

    // New session
    sessionId += 1;
    const mySessionId = sessionId;
    stoppedAlready = false;

    rate = clamp(rate, 0.5, 1.6);
    pitch = clamp(pitch, 0.5, 2);

    // Cancel any prior speak to avoid race where stop→start toggles incorrectly
    try { window.speechSynthesis.cancel(); } catch(e){}
    clearHighlights();
    errorFallbackAttempted = false;

    // prepare highlighting (overlay)
    let utterText = fullText;
    if (highlight) {
      try {
        const prep = prepareSpansForHighlighting(fullText);
        safeLog('speakText prepareSpans result', prep);
        if (prep && prep.mode === 'overlay') {
          utterText = prep.overlayText || overlayTextSplice || fullText.slice(0, MAX_OVERLAY_CHARS);
        } else {
          // fallback to reading full text
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

    const voices = window.speechSynthesis.getVoices() || [];
    let chosen = null;
    if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
    if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith((document.documentElement.lang || navigator.language || 'en').split('-')[0])) || voices[0] || null;

    safeLog('speakText chosen voice', chosen && chosen.name);

    // timers / stats
    readStartTs = Date.now();
    accumulatedElapsed = 0;
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();
    startAutoStatsTimer();

    let chunkIndex = 0;
    let charsSpokenBefore = 0;

    function speakNext() {
      if (mySessionId !== sessionId) { safeLog('speakNext aborted due session change', mySessionId, sessionId); return; }
      if (stoppedAlready) { safeLog('speakNext aborted because stoppedAlready', mySessionId); return; }
      if (chunkIndex >= chunks.length) {
        removeReaderOverlay();
        clearHighlights();
        sendState('Not Reading');
        finalizeStatsAndSend();
        safeLog('speakText finished all chunks', 'sessionId', mySessionId);
        return;
      }
      const text = chunks[chunkIndex++];
      const utter = new SpeechSynthesisUtterance(text);
      utter._chunkBase = charsSpokenBefore;
      charsSpokenBefore += text.length;

      if (chosen) utter.voice = chosen;
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

      // onerror fallback at chunk-level
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
        sendState('Not Reading');
        finalizeStatsAndSend();
      };

      try { window.speechSynthesis.speak(utter); } catch (e) {
        safeLog('speak failed', e);
        sendState('Not Reading');
        finalizeStatsAndSend();
      }
    }

    // start
    sendState('Reading...');
    speakNext();
    return { ok: true };
  }

  // --- Speed-read
  function splitIntoChunks(text, chunkSize = 3) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
    return chunks;
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

    const speakNext = () => {
      if (mySessionId !== sessionId) { safeLog('speed speakNext aborted session mismatch', mySessionId, sessionId); return; }
      if (!speedActive || speedIndex >= speedChunks.length) { speedActive = false; sendState('Not Reading'); finalizeStatsAndSend(); safeLog('speed read finished'); return; }
      const chunkText = sanitizeForTTS(speedChunks[speedIndex++] || '');
      if (!chunkText) { setTimeout(speakNext, 0); return; }
      const u = new SpeechSynthesisUtterance(chunkText);
      const voices = window.speechSynthesis.getVoices() || [];
      let chosen = null;
      if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
      if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith((document.documentElement.lang || navigator.language || 'en').split('-')[0])) || voices[0] || null;
      if (chosen) u.voice = chosen;
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
            if (chosen) retryU.voice = chosen;
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
    speakNext();
    return { ok: true };
  }
  function stopSpeedRead() { speedActive = false; speedChunks = null; speedIndex = 0; try { window.speechSynthesis.cancel(); } catch(e){} finalizeStatsAndSend(); sendState('Not Reading'); safeLog('stopSpeedRead called'); }

  // --- Pause / resume / stop (use speechSynthesis state and sendState)
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
      // reset stoppedAlready after a short delay so future reads allowed
      setTimeout(() => { stoppedAlready = false; }, 250);
      return { ok: true };
    } catch (e) { safeLog('stopReadingAll error', e); stoppedAlready = false; return { ok: false, error: String(e) }; }
  }

  // --- Helpers to get page text or selection
  function getTextToRead() {
    try {
      // Accept any explicit non-empty selection
      const s = (window.getSelection && window.getSelection().toString()) || '';
      if (s && s.trim().length > 0) {
        safeLog('getTextToRead returning selection length', s.length);
        return s.trim();
      }
      const main = getMainNode();
      let t = (main && main.innerText) ? main.innerText.trim() : (document.body && document.body.innerText ? document.body.innerText.trim() : '');
      if (t && t.length > 20000) {
        safeLog('getTextToRead truncated main text to 20000 chars');
        return t.slice(0, 20000);
      }
      safeLog('getTextToRead main text length', (t || '').length);
      return t ? t : '';
    } catch (e) { safeLog('getTextToRead err', e); return ''; }
  }
  function detectLanguage() {
    const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
    safeLog('detectLanguage', lang);
    return lang;
  }

  // --- Focus-mode toggle (uses overlay)
  function toggleFocusMode() {
    if (overlayActive) {
      removeReaderOverlay();
      clearHighlights();
      sendState('Not Reading');
      safeLog('toggleFocusMode: closed overlay');
      return { ok: true, overlayActive: false };
    }
    const t = getTextToRead();
    if (!t || !t.trim()) {
      safeLog('toggleFocusMode: no text to show in focus mode');
      return { ok: false, error: 'no-text' };
    }
    createReaderOverlay(t);
    sendState('Not Reading'); // overlay itself doesn't start reading
    safeLog('toggleFocusMode: opened overlay');
    return { ok: true, overlayActive: true };
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

/* ---------- Guard utilities ---------- 
   These try to reapply our classes/attributes if site JS removes them immediately
   (observes class + data-attribute changes for a short window).
*/
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
            const main = getMainNode();
            const out = extractCleanMainTextAndHtml(main);
            // return flat shape so background/popup can use out.text/out.html
            sendResponse({ ok: true, text: out.text || '', html: out.html || '', title: out.title || '' });
            safeLog('clarity_extract_main responded', { textLen: (out.text || '').length, title: out.title });
          } catch (e) {
            safeLog('clarity_extract_main failed', e);
            try { sendResponse({ ok: false, error: String(e) }); } catch(e2) {}
          }
          break;
        }

        case 'readAloud': {
          chrome.storage.sync.get(['voice','rate','pitch','highlight'], (res) => {
            const voice = (typeof msg.voice === 'string' && msg.voice.length) ? msg.voice : (res.voice || '');
            const rate = (typeof msg.rate !== 'undefined' ? msg.rate : (res.rate || 1));
            const pitch = (typeof msg.pitch !== 'undefined' ? msg.pitch : (res.pitch || 1));
            const highlight = (typeof msg.highlight !== 'undefined' ? !!msg.highlight : !!res.highlight);
            const text = (typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead();
            if (!text || !text.trim()) {
              safeLog('readAloud: no text found to read');
              sendResponse({ ok: false, error: 'no-text' });
              return;
            }
            safeLog('readAloud starting', { voice, rate, pitch, highlight, textLen: text.length });
            const r = speakText(text, { voiceName: voice, rate, pitch, highlight });
            sendResponse(r || { ok: true });
          });
          break;
        }

        case 'speedRead': {
          chrome.storage.sync.get(['voice'], (res) => {
            const chunkSize = Number(msg.chunkSize || msg.chunk || 3);
            const r = Number(msg.rate || 1);
            const text = (typeof msg.text === 'string' && msg.text.length) ? msg.text : ((typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead());
            if (!text || !text.trim()) { safeLog('speedRead: no-text'); sendResponse({ ok: false, error: 'no-text' }); return; }
            const chunks = splitIntoChunks(text, Math.max(1, Math.floor(chunkSize)));
            safeLog('speedRead will speak chunks', chunks.length, { chunkSize, rate: r });
            const out = speakChunksSequentially(chunks, clamp(r, 0.5, 1.6), (msg.voice || res.voice));
            sendResponse(out || { ok: true });
          });
          break;
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
            // Return flat shape { ok, selection } so background/popup can rely on response.selection
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

  // cleanup when the page unloads
  window.addEventListener('pagehide', () => {
    try {
      // Ensure full cleanup and stats finalization on page hide/navigation
      if (typeof stopReadingAll === 'function') {
        stopReadingAll();
      } else {
        try { window.speechSynthesis.cancel(); } catch(e){}
        sendState('Not Reading');
      }
    } catch(e){ safeLog('pagehide cleanup error', e); }
    safeLog('pagehide: attempted to cancel/stop speech synthesis and finalize stats');
  });

})();
