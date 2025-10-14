// Handles applySettings, readAloud, speedRead, pause/resume/stop, selection, detectLanguage.
// All speech synthesis happens in this file only.

(function () {
  if (window.__clarityread_contentScriptLoaded) {
    try { console.debug('[ClarityRead contentScript] already loaded.'); } catch(e){}
    return;
  }
  window.__clarityread_contentScriptLoaded = true;

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

      html.readeasy-dyslexic, 
      html.readeasy-dyslexic body, 
      html.readeasy-dyslexic * {
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
    try { document.documentElement.classList.remove('readeasy-dyslexic'); } catch(e){}
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

  // --- Overlay helper (preferred because it avoids DOM mutation issues)
  function createReaderOverlay(text) {
    removeReaderOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'readeasy-reader-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-label','Reader overlay');
    const dys = document.documentElement.classList.contains('readeasy-dyslexic');
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

    try {
      const close = document.createElement('button');
      close.textContent = 'Close reader';
      close.style.position = 'absolute';
      close.style.right = '16px';
      close.style.top = '10px';
      close.addEventListener('click', () => {
        try { window.speechSynthesis.cancel(); } catch(e){}
        removeReaderOverlay();
        clearHighlights();
        sendState('Not Reading');
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
    return overlay;
  }
  function removeReaderOverlay() {
    const old = document.getElementById('readeasy-reader-overlay');
    if (old) try { old.remove(); } catch(e){}
    overlayActive = false;
    overlayTextSplice = null;
    safeLog('removeReaderOverlay executed');
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

  // --- Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      safeLog('onMessage received', msg, 'from', sender && sender.tab ? { tabId: sender.tab.id, url: sender.tab.url } : sender);
      if (!msg || !msg.action) { sendResponse({ ok: false }); safeLog('onMessage missing action -> responded false'); return true; }

      switch (msg.action) {
        case 'applySettings':
          try {
            if (msg.dys) {
              ensureDysFontInjected();
              try { document.documentElement.classList.add('readeasy-dyslexic'); } catch(e){}
            } else {
              try { document.documentElement.classList.remove('readeasy-dyslexic'); } catch(e){}
              removeDysFontInjected();
            }

            if (msg.reflow) document.documentElement.classList.add('readeasy-reflow'); else document.documentElement.classList.remove('readeasy-reflow');
            if (msg.contrast) document.documentElement.classList.add('readeasy-contrast'); else document.documentElement.classList.remove('readeasy-contrast');
            if (msg.invert) document.documentElement.classList.add('readeasy-invert'); else document.documentElement.classList.remove('readeasy-invert');

            if (typeof msg.fontSize !== 'undefined') {
              const fs = (typeof msg.fontSize === 'number') ? `${msg.fontSize}px` : String(msg.fontSize);
              document.documentElement.style.setProperty('--readeasy-font-size', fs);
              if (document.documentElement.classList.contains('readeasy-reflow')) {
                const m = getMainNode();
                if (m) try { m.style.fontSize = fs; } catch(e) {}
              }
            }
            safeLog('applySettings applied', { dys: !!msg.dys, reflow: !!msg.reflow, fontSize: msg.fontSize });
          } catch (e) {
            safeLog('applySettings failed', e);
          }
          sendResponse({ ok: true });
          safeLog('applySettings responded ok');
          break;

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
    try { window.speechSynthesis.cancel(); } catch(e){}
    sendState('Not Reading');
    safeLog('pagehide: canceled speech synthesis');
  });
})();
