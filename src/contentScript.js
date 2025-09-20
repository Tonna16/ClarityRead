// src/contentScript.js - finalized (copy-paste ready)
// Loads OpenDyslexic only when user enables dyslexia mode, falls back cleanly when FontFace fails.
// Includes robust highlight mapping + overlay fallback and stats messaging.
// Also: supports detectLanguage, getSelection, speedRead, and saved-text playback.

(function () {
  // Prevent double-load if script is injected more than once (avoid `let` redeclaration errors)
  if (window.__readeasy_contentScriptLoaded) {
    console.log('ClarityRead contentScript: already loaded, skipping re-init');
    return;
  }
  window.__readeasy_contentScriptLoaded = true;

  console.log('ClarityRead contentScript loaded on', location.href);

  try { document.documentElement.setAttribute('data-readeasy', '1'); } catch (e) {}

  // State (single declaration)
  let readStartTime = null;
  let readTimer = null;
  let elapsedTime = 0;
  let synthUtterance = null;
  let highlightSpans = [];
  let highlightIndex = 0;
  let highlightText = '';
  let fallbackInterval = null;
  let fallbackStarted = false;
  let heardBoundary = false;
  let selectionRestore = null; // { wrapperSelector, originalHtml }
  let cumLengths = []; // cumulative lengths of highlightSpans
  let lastCharIndexSeen = -1;
  let overlayActive = false;
  let overlayTextSplice = null;

  // Stats throttling
  const STATS_SEND_INTERVAL_MS = 10000; // send time updates to background at most once every 10s
  let pendingSecondsForSend = 0;
  let lastStatsSendTs = 0;
  let errorFallbackAttempted = false;

  // Tweakable thresholds
  const MAX_OVERLAY_CHARS = 10000;
  const MAX_SPANS_BEFORE_OVERLAY = 3000;

  // Style id for injected font rules
  const DYS_STYLE_ID = 'readeasy-dysfont';

  // hostname (if available)
  const hostname = (() => {
    try { return window.location.hostname; } catch (e) { return ''; }
  })();

  // ------- Utilities -------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));

  // Clean/sanitize text for utterances (trim, collapse whitespace)
  function sanitizeForTTS(s) {
    if (!s) return '';
    // collapse long whitespace, trim, remove lonely control chars
    return String(s).replace(/\s+/g, ' ').replace(/[^\S\r\n]+/g, ' ').trim();
  }

  // -------------------- Font injection --------------------
  function ensureDysFontInjected() {
    if (document.getElementById(DYS_STYLE_ID)) return;
    try {
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
        html.readeasy-dyslexic, html.readeasy-dyslexic *, .readeasy-dyslexic, .readeasy-dyslexic * {
          font-family: 'OpenDyslexic', Arial, sans-serif !important;
        }
      `;
      document.head.appendChild(style);

      if ('FontFace' in window) {
        try {
          const ff = new FontFace('OpenDyslexic', `url(${urlWoff2}) format("woff2"), url(${urlWoff}) format("woff")`, { display: 'swap' });
          ff.load().then(loaded => {
            try { document.fonts.add(loaded); } catch (e) { /* ignore */ }
            console.log('OpenDyslexic FontFace loaded and added:', loaded.family);
          }).catch(err => {
            console.warn('FontFace load failed (fallback to @font-face):', err);
          });
        } catch (err) {
          console.warn('FontFace API usage failed (continuing with @font-face):', err);
        }
      }

      console.log('Injected dyslexic font-face stylesheet from', urlWoff2, 'and', urlWoff);
    } catch (err) {
      console.warn('Failed to inject dys font-face:', err);
    }
  }

  function removeDysFontInjected() {
    try {
      const el = document.getElementById(DYS_STYLE_ID);
      if (el) el.remove();
      console.log('Removed dyslexic font stylesheet');
    } catch (e) {
      // ignore
    }
  }

  // -------------------- Heuristics (improved) --------------------
  function isVisible(el) {
    if (!el) return false;
    try {
      const style = getComputedStyle(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0)) return false;
    } catch (e) {}
    return true;
  }

  function textDensity(el) {
    const t = (el && el.innerText) ? el.innerText.trim() : '';
    const htmlLen = (el && el.innerHTML) ? el.innerHTML.length : 1;
    return (t.length) / Math.max(1, htmlLen);
  }

  function getMainNode() {
    try {
      const prefer = ['article', 'main', '[role="main"]', '#content', '#primary', '.post', '.article', '#mw-content-text'];
      for (const s of prefer) {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.length > 200 && isVisible(el)) return el;
      }

      const candidates = Array.from(document.querySelectorAll('article, main, section, div, p'))
        .filter(el => el && el.innerText && el.innerText.trim().length > 200 && isVisible(el))
        .map(el => ({ el, len: (el.innerText || '').trim().length, density: textDensity(el) }))
        .filter(c => !/(nav|footer|header|sidebar|comment|advert|ads|cookie)/i.test((c.el.id || '') + ' ' + (c.el.className || '')));

      if (candidates.length) {
        candidates.sort((a, b) => {
          if (b.len !== a.len) return b.len - a.len;
          return b.density - a.density;
        });
        return candidates[0].el;
      }

      if (document.body && (document.body.innerText || '').length > 200) return document.body;
      return document.documentElement || document.body;
    } catch (e) {
      console.warn('getMainNode heuristic failed', e);
      return document.body;
    }
  }

  // -------------------- Apply settings --------------------
  function applySettings({ dys, reflow, contrast, invert, fontSize } = {}) {
    const root = document.documentElement;
    try {
      if (dys) {
        ensureDysFontInjected();
        root.classList.add('readeasy-dyslexic', 'readeasy-dyslexic--active');
      } else {
        root.classList.remove('readeasy-dyslexic', 'readeasy-dyslexic--active');
        removeDysFontInjected();
      }

      reflow ? root.classList.add('readeasy-reflow') : root.classList.remove('readeasy-reflow');
      contrast ? root.classList.add('readeasy-contrast') : root.classList.remove('readeasy-contrast');
      invert ? root.classList.add('readeasy-invert') : root.classList.remove('readeasy-invert');

      const main = getMainNode();
      if (reflow) {
        const fontPx = (typeof fontSize === 'number' && !isNaN(fontSize)) ? fontSize : 20;
        document.documentElement.style.setProperty('--readeasy-font-size', `${fontPx}px`);
        if (main) {
          main.style.fontSize = `${fontPx}px`;
          main.style.lineHeight = '1.8';
          main.style.maxWidth = '760px';
          main.style.margin = '18px auto';
          main.style.padding = '0 18px';
          main.style.wordBreak = 'break-word';
          main.style.overflowWrap = 'break-word';
        }
      } else if (main) {
        main.style.fontSize = '';
        main.style.lineHeight = '';
        main.style.maxWidth = '';
        main.style.margin = '';
        main.style.padding = '';
        main.style.wordBreak = '';
        main.style.overflowWrap = '';
        document.documentElement.style.removeProperty('--readeasy-font-size');
      }
    } catch (e) {
      console.warn('applySettings failed:', e);
    }
  }

  // -------------------- Init settings on load --------------------
  function initSettingsOnLoad() {
    try {
      if (!hostname) {
        chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize'], (syncRes) => {
          applySettings({
            dys: syncRes.dys ?? false,
            reflow: syncRes.reflow ?? false,
            contrast: syncRes.contrast ?? false,
            invert: syncRes.invert ?? false,
            fontSize: syncRes.fontSize ?? 20
          });
        });
        return;
      }

      chrome.storage.local.get([hostname], (localRes) => {
        if (chrome.runtime.lastError) {
          console.warn('storage.local.get error during init', chrome.runtime.lastError);
        }
        const siteSettings = localRes && localRes[hostname];
        if (siteSettings) {
          applySettings(siteSettings);
          console.log('Applied per-site settings for', hostname, siteSettings);
        } else {
          chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize'], (syncRes) => {
            applySettings({
              dys: syncRes.dys ?? false,
              reflow: syncRes.reflow ?? false,
              contrast: syncRes.contrast ?? false,
              invert: syncRes.invert ?? false,
              fontSize: syncRes.fontSize ?? 20
            });
            console.log('Applied sync defaults', syncRes);
          });
        }
      });
    } catch (e) {
      console.warn('initSettingsOnLoad failed', e);
    }
  }
  initSettingsOnLoad();

  // React to storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    try {
      if (area === 'local' && hostname && changes[hostname]) {
        const newVal = changes[hostname].newValue;
        if (newVal) {
          applySettings(newVal);
          console.log('Applied updated local settings for', hostname, newVal);
        }
      }
      if (area === 'sync') {
        chrome.storage.local.get([hostname], (localRes) => {
          const siteSettings = localRes && localRes[hostname];
          if (!siteSettings) {
            chrome.storage.sync.get(['dys','reflow','contrast','invert','fontSize'], (syncRes) => {
              applySettings({
                dys: syncRes.dys ?? false,
                reflow: syncRes.reflow ?? false,
                contrast: syncRes.contrast ?? false,
                invert: syncRes.invert ?? false,
                fontSize: syncRes.fontSize ?? 20
              });
              console.log('Applied updated sync defaults', syncRes);
            });
          }
        });
      }
    } catch (e) {
      console.warn('storage.onChanged handler error', e);
    }
  });

  // -------------------- Overlay helpers --------------------
  function createReaderOverlay(text) {
    removeReaderOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'readeasy-reader-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Reader overlay');

    const dysActive = document.documentElement.classList.contains('readeasy-dyslexic');
    const overlayFont = dysActive ? "'OpenDyslexic', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
                                  : "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '6% 6% 6% 6%',
      zIndex: 2147483647,
      background: '#fff',
      color: '#000',
      overflow: 'auto',
      padding: '22px',
      borderRadius: '8px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
      lineHeight: '1.8',
      fontSize: '18px',
      fontFamily: overlayFont,
      whiteSpace: 'pre-wrap'
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close reader';
    Object.assign(closeBtn.style, { position: 'absolute', right: '18px', top: '10px', zIndex: 3 });
    closeBtn.addEventListener('click', () => {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      removeReaderOverlay();
      clearHighlights();
    });
    overlay.appendChild(closeBtn);

    const inner = document.createElement('div');
    inner.id = 'readeasy-reader-inner';
    inner.style.whiteSpace = 'pre-wrap';

    const wordRe = /(\S+)(\s*)/g;
    let m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(text)) !== null) {
      const sp = document.createElement('span');
      sp.textContent = (m[1] || '') + (m[2] || '');
      sp.classList.add('readeasy-word');
      inner.appendChild(sp);
    }

    overlay.appendChild(inner);
    document.documentElement.appendChild(overlay);

    overlayActive = true;
    return overlay;
  }

  function removeReaderOverlay() {
    const old = document.getElementById('readeasy-reader-overlay');
    if (old) {
      try { old.remove(); } catch (e) {}
    }
    overlayActive = false;
    overlayTextSplice = null;
  }

  // -------------------- Clear highlights --------------------
  function clearHighlights() {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      fallbackStarted = false;
    }
    heardBoundary = false;
    lastCharIndexSeen = -1;
    cumLengths = [];

    if (overlayActive) removeReaderOverlay();

    if (selectionRestore && selectionRestore.wrapperSelector) {
      try {
        const wrapper = document.querySelector(selectionRestore.wrapperSelector);
        if (wrapper && typeof selectionRestore.originalHtml === 'string') {
          wrapper.outerHTML = selectionRestore.originalHtml;
        }
      } catch (e) {
        console.warn('Failed to restore original selection HTML', e);
      } finally {
        selectionRestore = null;
      }
    } else {
      if (highlightSpans && highlightSpans.length) {
        highlightSpans.forEach(span => {
          const parent = span.parentNode;
          if (!parent) return;
          parent.replaceChild(document.createTextNode(span.textContent), span);
        });
        try { document.body.normalize(); } catch (e) {}
      }
    }

    highlightSpans = [];
    highlightIndex = 0;
    highlightText = '';
  }

  // -------------------- Cum lengths mapping --------------------
  function buildCumLengths() {
    cumLengths = [];
    let total = 0;
    for (let i = 0; i < highlightSpans.length; i++) {
      const len = (highlightSpans[i].textContent || '').length;
      total += len;
      cumLengths.push(total);
    }
  }

  function mapCharIndexToSpanAndHighlight(charIndex) {
    if (!highlightSpans || !highlightSpans.length) return;
    if (!cumLengths || !cumLengths.length) buildCumLengths();

    const total = cumLengths[cumLengths.length - 1] || 0;
    if (charIndex >= total) {
      highlightIndex = highlightSpans.length - 1;
    } else {
      let lo = 0, hi = cumLengths.length - 1, idx = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumLengths[mid] > charIndex) {
          idx = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      highlightIndex = idx;
    }

    for (let i = 0; i < highlightSpans.length; i++) {
      const s = highlightSpans[i];
      if (!s) continue;
      if (i === highlightIndex) s.classList.add('readeasy-highlight');
      else s.classList.remove('readeasy-highlight');
    }

    const current = highlightSpans[highlightIndex];
    if (current) {
      try { current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
    }
  }

  // -------------------- Fallback ticker --------------------
  function advanceHighlightByOne() {
    if (!highlightSpans || !highlightSpans.length) return;
    highlightIndex = Math.min(highlightIndex + 1, highlightSpans.length - 1);
    for (let i = 0; i < highlightSpans.length; i++) {
      const s = highlightSpans[i];
      if (!s) continue;
      if (i === highlightIndex) s.classList.add('readeasy-highlight');
      else s.classList.remove('readeasy-highlight');
    }
    const current = highlightSpans[highlightIndex];
    if (current) {
      try { current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
    }
  }

  // -------------------- Prepare spans --------------------
  function prepareSpansForHighlighting(fullText) {
    highlightSpans = [];
    cumLengths = [];
    selectionRestore = null;

    // selection mode
    let sel;
    try { sel = window.getSelection(); } catch (e) { sel = null; }

    if (sel && sel.rangeCount && sel.toString().trim().length > 0) {
      try {
        const range = sel.getRangeAt(0);
        const cloned = range.cloneContents();
        const tmp = document.createElement('div');
        tmp.appendChild(cloned);
        const originalHtml = tmp.innerHTML;

        const wrapper = document.createElement('span');
        const uid = 'readeasy-selection-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        wrapper.setAttribute('data-readeasy-selection', uid);
        wrapper.style.whiteSpace = 'pre-wrap';

        const text = sel.toString();
        const wordRe = /(\S+)(\s*)/g;
        let m;
        wordRe.lastIndex = 0;
        while ((m = wordRe.exec(text)) !== null) {
          const sp = document.createElement('span');
          sp.textContent = (m[1] || '') + (m[2] || '');
          sp.classList.add('readeasy-word');
          wrapper.appendChild(sp);
          highlightSpans.push(sp);
        }

        range.deleteContents();
        range.insertNode(wrapper);

        selectionRestore = {
          wrapperSelector: `[data-readeasy-selection="${uid}"]`,
          originalHtml: originalHtml
        };

        highlightIndex = 0;
        buildCumLengths();
        return { mode: 'selection' };
      } catch (err) {
        console.warn('prepareSpansForHighlighting: selection-mode failed, falling back to full-page:', err);
        selectionRestore = null;
        highlightSpans = [];
      }
    }

    // Non-selection: estimate word count (cheap)
    const main = getMainNode();
    if (!main) return { mode: 'none' };

    const textForCount = (main.innerText || '').trim().slice(0, 200000);
    const approxWordCount = (textForCount.match(/\S+/g) || []).length;
    if (approxWordCount > MAX_SPANS_BEFORE_OVERLAY) {
      const snippet = fullText.length > MAX_OVERLAY_CHARS ? fullText.slice(0, MAX_OVERLAY_CHARS) : fullText;
      const ov = createReaderOverlay(snippet);
      const container = ov.querySelector('#readeasy-reader-inner');
      highlightSpans = Array.from(container.querySelectorAll('span'));
      overlayTextSplice = snippet;
      overlayActive = true;
      highlightIndex = 0;
      buildCumLengths();
      return { mode: 'overlay', overlayText: snippet };
    }

    // Walk text nodes and replace with spans
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parentTag = node.parentNode && node.parentNode.tagName && node.parentNode.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'textarea', 'code', 'pre', 'input'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    if (!textNodes.length) return { mode: 'none' };

    const wordRe = /(\S+)(\s*)/g;
    let totalSpans = 0;
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      const frag = document.createDocumentFragment();
      let m;
      wordRe.lastIndex = 0;
      let matched = false;
      while ((m = wordRe.exec(text)) !== null) {
        matched = true;
        const span = document.createElement('span');
        span.textContent = (m[1] || '') + (m[2] || '');
        span.classList.add('readeasy-word');
        frag.appendChild(span);
        highlightSpans.push(span);
        totalSpans++;
        if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) break;
      }
      if (matched && frag.childNodes.length) {
        try {
          textNode.parentNode.replaceChild(frag, textNode);
        } catch (err) {
          console.warn('replace text node failed', err);
        }
      }
      if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) break;
    }

    // If exceeded threshold mid-way, undo and fallback to overlay
    if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) {
      highlightSpans.forEach(span => {
        if (span && span.parentNode) {
          span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
        }
      });
      highlightSpans = [];
      const snippet = fullText.length > MAX_OVERLAY_CHARS ? fullText.slice(0, MAX_OVERLAY_CHARS) : fullText;
      const ov = createReaderOverlay(snippet);
      const container = ov.querySelector('#readeasy-reader-inner');
      highlightSpans = Array.from(container.querySelectorAll('span'));
      overlayTextSplice = snippet;
      overlayActive = true;
      highlightIndex = 0;
      buildCumLengths();
      return { mode: 'overlay', overlayText: snippet };
    }

    highlightIndex = 0;
    buildCumLengths();
    return { mode: 'inplace' };
  }

  // -------------------- Utterance handlers --------------------
  function attachUtterHandlers(utter) {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
      fallbackStarted = false;
    }
    heardBoundary = false;
    lastCharIndexSeen = -1;

    try {
      utter.onboundary = (e) => {
        heardBoundary = true;
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
          fallbackInterval = null;
          fallbackStarted = false;
          console.log('setupHighlighting: onboundary detected — cleared fallback.');
        }
        if (!e || typeof e.charIndex !== 'number') return;

        if (e.charIndex <= lastCharIndexSeen && lastCharIndexSeen !== -1) return;
        lastCharIndexSeen = e.charIndex;
        mapCharIndexToSpanAndHighlight(e.charIndex);
        try { console.log('utter.onboundary', { charIndex: e.charIndex, elapsedTime: e.elapsedTime }); } catch (err) {}
      };
    } catch (ex) {
      console.warn('attachUtterHandlers: could not set onboundary', ex);
    }

    utter.onpause = () => {
      try { chrome.runtime.sendMessage({ action: 'readingPaused' }, () => {}); } catch (e) {}
    };

    utter.onresume = () => {
      try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
    };

    utter.onerror = (err) => {
      console.warn('utterance error', err);
      try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(err) }, () => {}); } catch (e) {}

      // If we were highlighting and haven't yet attempted fallback, try a single retry.
      if (!errorFallbackAttempted && highlightSpans && highlightSpans.length) {
        errorFallbackAttempted = true;
        try { window.speechSynthesis.cancel(); } catch (e) {}
        removeReaderOverlay();
        clearHighlights();

        const retryText = highlightText || (utter && (utter.text || '')) || '';
        if (retryText && retryText.length) {
          try {
            const voiceName = utter && utter.voice && utter.voice.name;
            const r = utter && utter.rate;
            const p = utter && utter.pitch;
            speakText(retryText, { voiceName: voiceName, rate: r, pitch: p, highlight: false });
          } catch (ex) {
            console.warn('fallback speak failed', ex);
            try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(ex) }, () => {}); } catch (e) {}
          }
        }
        return;
      }

      removeReaderOverlay();
      clearHighlights();
    };

    utter.onend = () => {
      removeReaderOverlay();
      clearHighlights();
      try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch (e) {}
    };

    setTimeout(() => {
      if (!heardBoundary && highlightSpans && highlightSpans.length) {
        const msPerWord = Math.max(150, Math.round(400 / Math.max(0.1, utter.rate)));
        if (!fallbackStarted) {
          fallbackStarted = true;
          fallbackInterval = setInterval(() => advanceHighlightByOne(), msPerWord);
          console.warn('setupHighlighting: onboundary not detected — using fallback ticker', msPerWord, 'ms/word');
        }
      }
    }, 600);
  }

  // -------------------- Speak text --------------------
  function speakText(text, { voiceName, rate = 1, pitch = 1, highlight = false } = {}) {
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis not supported on this platform.');
      return;
    }
    // sanitize and clamp inputs
    text = sanitizeForTTS(String(text || ''));
    rate = clamp(rate, 0.5, 2);   // keep rate in common, stable range
    pitch = clamp(pitch, 0.5, 2); // clamp pitch

    try { window.speechSynthesis.cancel(); } catch (e) {}

    clearHighlights();

    highlightText = text;
    elapsedTime = 0;
    readStartTime = Date.now();
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();
    errorFallbackAttempted = false;
    startAutoStatsTimer();

    let utter = new SpeechSynthesisUtterance(text || '');
    const voices = window.speechSynthesis.getVoices() || [];

    // Prefer explicit voice name, otherwise pick by language fallback.
    let chosenVoice = null;
    try {
      if (voiceName) chosenVoice = voices.find(v => v.name === voiceName) || null;
      if (!chosenVoice) chosenVoice = voices.find(v => v.lang && v.lang.startsWith('en')) || null;
    } catch (e) {
      chosenVoice = null;
    }
    if (chosenVoice) utter.voice = chosenVoice;

    utter.rate = rate;
    utter.pitch = pitch;

    synthUtterance = utter;

    console.log('speakText start — highlight:', !!highlight, 'voice:', utter.voice && utter.voice.name, 'rate:', rate, 'pitch:', pitch);

    if (highlight) {
      const prep = prepareSpansForHighlighting(text);

      if (prep && prep.mode === 'overlay') {
        const overlayText = prep.overlayText || overlayTextSplice || text.slice(0, MAX_OVERLAY_CHARS);
        utter = new SpeechSynthesisUtterance(overlayText);
        if (synthUtterance.voice) utter.voice = synthUtterance.voice;
        utter.rate = synthUtterance.rate;
        utter.pitch = synthUtterance.pitch;
        synthUtterance = utter;
        attachUtterHandlers(utter);
        try { window.speechSynthesis.speak(utter); } catch (e) { console.warn('speak failed', e); try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(e) }, () => {}); } catch (ex) {} }
        return;
      }

      const concat = (highlightSpans.map(s => s.textContent || '').join(''));
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      if (!selectionRestore && norm(concat) !== norm(text)) {
        console.warn('Highlight text may not exactly match utterance text. Falling back to overlay for stability.');
        const snippet = text.length > MAX_OVERLAY_CHARS ? text.slice(0, MAX_OVERLAY_CHARS) : text;
        const ov = createReaderOverlay(snippet);
        const container = ov.querySelector('#readeasy-reader-inner');
        highlightSpans = Array.from(container.querySelectorAll('span'));
        overlayTextSplice = snippet;
        overlayActive = true;
        highlightIndex = 0;
        buildCumLengths();
        utter = new SpeechSynthesisUtterance(snippet);
        if (synthUtterance.voice) utter.voice = synthUtterance.voice;
        utter.rate = synthUtterance.rate;
        utter.pitch = synthUtterance.pitch;
        synthUtterance = utter;
        attachUtterHandlers(utter);
        try { window.speechSynthesis.speak(utter); } catch (e) { console.warn('speak failed', e); try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(e) }, () => {}); } catch (ex) {} }
        return;
      }
    }

    attachUtterHandlers(utter);
    try { window.speechSynthesis.speak(utter); } catch (e) { console.warn('speak failed', e); try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(e) }, () => {}); } catch (ex) {} }
  }

  // -------------------- Stats timer --------------------
  function startAutoStatsTimer() {
    if (readTimer) clearInterval(readTimer);
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();

    readTimer = setInterval(() => {
      if (!readStartTime) return;
      const now = Date.now();
      const delta = (now - readStartTime) / 1000;
      readStartTime = now;
      elapsedTime += delta;

      pendingSecondsForSend += delta;
      const sinceLastSend = now - lastStatsSendTs;
      if (pendingSecondsForSend >= (STATS_SEND_INTERVAL_MS / 1000) || sinceLastSend >= STATS_SEND_INTERVAL_MS) {
        const toSend = pendingSecondsForSend;
        pendingSecondsForSend = 0;
        lastStatsSendTs = now;
        try {
          chrome.runtime.sendMessage({ action: 'updateTimeOnly', duration: toSend }, () => {});
        } catch (e) {
          // ignore
        }
      }
    }, 1000);
  }

  // -------------------- Pause / Resume / Stop --------------------
  function pauseReading() {
    if (!synthUtterance) return;
    try { window.speechSynthesis.pause(); } catch (e) {}
    if (readStartTime) {
      elapsedTime += (Date.now() - readStartTime) / 1000;
      readStartTime = null;
    }
    if (readTimer) clearInterval(readTimer);
    try { chrome.runtime.sendMessage({ action: 'readingPaused' }, () => {}); } catch (e) {}
  }

  function resumeReading() {
    if (!synthUtterance) return;
    try { window.speechSynthesis.resume(); } catch (e) {}
    readStartTime = Date.now();
    startAutoStatsTimer();
    try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
  }

  function stopSpeaking() {
    if (readStartTime) {
      elapsedTime += (Date.now() - readStartTime) / 1000;
      readStartTime = null;
    }
    if (readTimer) {
      clearInterval(readTimer);
      readTimer = null;
    }

    const pending = pendingSecondsForSend || 0;
    if (pending > 0) {
      elapsedTime += pending;
      pendingSecondsForSend = 0;
    }

    if (elapsedTime > 0) {
      try { chrome.runtime.sendMessage({ action: 'updateStats', duration: elapsedTime }, () => {}); } catch (e) {}
      elapsedTime = 0;
    }

    try { window.speechSynthesis.cancel(); } catch (e) {}
    clearHighlights();
    synthUtterance = null;
    try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch (e) {}
  }

  function getTextToRead() {
    try {
      const selection = window.getSelection ? window.getSelection().toString().trim() : '';
      if (selection && selection.length > 20) {
        console.log('ClarityRead.getTextToRead: using selection (len)', selection.length);
        return selection;
      }
      const main = getMainNode();
      const txt = (main ? (main.innerText || '').trim() : (document.body.innerText || '').trim());
      console.log('ClarityRead.getTextToRead: using main (len)', (txt||'').length, 'node:', main && (main.tagName || main.id || main.className));
      if (txt && txt.length > 50) return txt.substring(0, 20000);
      return (document.body.innerText || '').trim().substring(0, 20000);
    } catch (e) {
      console.warn('getTextToRead failed', e);
      return '';
    }
  }

  // -------------------- Simple language detection --------------------
  function detectLanguage() {
    const docLang = (document.documentElement.lang || '').trim();
    if (docLang) return docLang;
    if (navigator && navigator.language) return navigator.language;
    return 'en';
  }

  // -------------------- Speed-read (chunked) --------------------
  let speedChunks = null;
  let speedIndex = 0;
  let speedActive = false;
  function splitIntoChunks(text, chunkSize = 3) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    return chunks;
  }

  function speakChunksSequentially(chunks, rate = 1) {
    if (!chunks || !chunks.length) {
      console.warn('speakChunksSequentially: no chunks to speak');
      return;
    }
    rate = clamp(rate, 0.5, 2);

    try { window.speechSynthesis.cancel(); } catch (e) {}
    clearHighlights();
    speedChunks = chunks;
    speedIndex = 0;
    speedActive = true;
    readStartTime = Date.now();
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();
    startAutoStatsTimer();

    const speakNext = () => {
      if (!speedActive || speedIndex >= speedChunks.length) {
        speedActive = false;
        try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch (e) {}
        return;
      }
      const chunkText = sanitizeForTTS((speedChunks[speedIndex++] || '').trim());
      if (!chunkText) {
        setTimeout(speakNext, 0);
        return;
      }
      const u = new SpeechSynthesisUtterance(chunkText);
      const voices = window.speechSynthesis.getVoices() || [];
      const chosen = voices.find(v => v.lang && v.lang.startsWith('en')) || null;
      if (chosen) u.voice = chosen;
      u.rate = clamp(rate, 0.5, 2);
      u.onend = () => {
        setTimeout(() => {
          speakNext();
        }, Math.max(60, Math.round(200 / Math.max(0.1, u.rate))));
      };
      u.onerror = (err) => {
        console.warn('speedRead chunk error', err);
        speedActive = false;
        try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(err) }, () => {}); } catch (e) {}
      };
      try {
        synthUtterance = u;
        window.speechSynthesis.speak(u);
        try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
      } catch (e) {
        console.warn('speedRead speak failed', e);
        speedActive = false;
      }
    };

    speakNext();
  }

  function stopSpeedRead() {
    speedActive = false;
    speedChunks = null;
    speedIndex = 0;
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  // -------------------- Message listener --------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('contentScript received message', msg);
    if (!msg || !msg.action) {
      sendResponse({ ok: false });
      return true;
    }

    switch (msg.action) {
      case 'applySettings':
        try { applySettings(msg); } catch (e) { console.warn('applySettings failed', e); }
        sendResponse({ ok: true });
        break;

      case 'readAloud': {
        try {
          chrome.storage.sync.get(['voice', 'rate', 'pitch', 'highlight'], (res) => {
            const txt = (typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead();
            if (txt && txt.length > 0) {
              const highlightFlag = (typeof msg.highlight !== 'undefined') ? !!msg.highlight : !!res.highlight;
              speakText(txt, {
                voiceName: res.voice,
                rate: res.rate || 0.85,
                pitch: res.pitch || 1,
                highlight: highlightFlag
              });
              try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
            } else {
              console.warn('readAloud: no text found to read');
            }
          });
        } catch (e) {
          console.warn('readAloud handler error', e);
        }
        sendResponse({ ok: true });
        break;
      }

      case 'stopReading':
        // stop both normal and speed reads
        stopSpeedRead();
        stopSpeaking();
        sendResponse({ ok: true });
        break;

      case 'pauseReading':
        try {
          pauseReading();
        } catch (e) { console.warn('pauseReading failed', e); }
        sendResponse({ ok: true });
        break;

      case 'resumeReading':
        try {
          resumeReading();
        } catch (e) { console.warn('resumeReading failed', e); }
        sendResponse({ ok: true });
        break;

      case 'toggleDyslexic':
        try {
          applySettings({
            dys: !!msg.enabled,
            reflow: document.documentElement.classList.contains('readeasy-reflow'),
            contrast: document.documentElement.classList.contains('readeasy-contrast'),
            invert: document.documentElement.classList.contains('readeasy-invert'),
            fontSize: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--readeasy-font-size')) || undefined
          });
        } catch (e) {
          // fallback
          document.documentElement.classList.toggle('readeasy-dyslexic', !!msg.enabled);
          if (!msg.enabled) removeDysFontInjected();
          else ensureDysFontInjected();
        }
        sendResponse({ ok: true });
        break;

      case 'toggleContrast':
        document.documentElement.classList.toggle('readeasy-contrast', !!msg.enabled);
        sendResponse({ ok: true });
        break;

      case 'toggleInvert':
        document.documentElement.classList.toggle('readeasy-invert', !!msg.enabled);
        sendResponse({ ok: true });
        break;

      case 'toggleReflow':
        document.documentElement.classList.toggle('readeasy-reflow', !!msg.enabled);
        sendResponse({ ok: true });
        break;

      case 'setFontSize':
        if (typeof msg.size === 'number') {
          document.documentElement.style.setProperty('--readeasy-font-size', `${msg.size}px`);
          if (document.documentElement.classList.contains('readeasy-reflow')) {
            const main = getMainNode();
            if (main) main.style.fontSize = `${msg.size}px`;
          }
        } else if (typeof msg.size === 'string') {
          document.documentElement.style.setProperty('--readeasy-font-size', msg.size);
          if (document.documentElement.classList.contains('readeasy-reflow')) {
            const main = getMainNode();
            if (main) main.style.fontSize = msg.size;
          }
        }
        sendResponse({ ok: true });
        break;

      case 'detectLanguage': {
        const lang = detectLanguage();
        sendResponse({ ok: true, lang });
        break;
      }

      case 'getSelection': {
        try {
          const selText = window.getSelection ? window.getSelection().toString().trim() : '';
          const resObj = {
            selection: {
              text: selText || '',
              title: document.title || '',
              url: location.href || ''
            }
          };
          sendResponse({ ok: true, response: resObj });
        } catch (e) {
          console.warn('getSelection failed', e);
          sendResponse({ ok: false });
        }
        break;
      }

      case 'speedRead': {
        try {
          const chunkSize = Number(msg.chunkSize) || Number(msg.chunk) || 3;
          const rate = Number(msg.rate) || 1;
          const text = (typeof msg.text === 'string' && msg.text.length) ? msg.text : ((typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead());
          if (!text || !text.trim()) {
            sendResponse({ ok: false, error: 'no-text' });
            break;
          }
          const chunks = splitIntoChunks(text, Math.max(1, Math.floor(chunkSize)));
          speakChunksSequentially(chunks, clamp(rate, 0.5, 2));
          sendResponse({ ok: true });
        } catch (e) {
          console.warn('speedRead failed', e);
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
    }

    // Indicate async response support for cases where storage calls used.
    return true;
  });
})();
