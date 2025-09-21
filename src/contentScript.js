// src/contentScript.js - ClarityRead content script (copy-paste ready)
// Handles applySettings, readAloud, speedRead, pause/resume/stop, selection, detectLanguage.
// All speech synthesis happens in this file only.

(function () {
  if (window.__clarityread_contentScriptLoaded) {
    console.debug('ClarityRead contentScript: already loaded.');
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

  const STATS_SEND_INTERVAL_MS = 10000;
  const MAX_OVERLAY_CHARS = 10000;
  const MAX_SPANS_BEFORE_OVERLAY = 3000;
  const DYS_STYLE_ID = 'clarityread-dysfont';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
  const safeLog = (...a) => { try { console.log(...a); } catch (e) {} };

  // --- sanitize text for TTS
  function sanitizeForTTS(s) {
    if (!s) return '';
    return String(s).replace(/\s+/g, ' ').trim();
  }

  // --- Font injection for OpenDyslexic
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
          src: url("${urlWoff2}") format("woff2"), url("${urlWoff}") format("woff");
          font-weight: normal; font-style: normal; font-display: swap;
        }
        html.readeasy-dyslexic, html.readeasy-dyslexic * { font-family: 'OpenDyslexic', system-ui, Arial, sans-serif !important; }
      `;
      document.head.appendChild(style);
      if ('FontFace' in window) {
        try {
          const ff = new FontFace('OpenDyslexic', `url(${urlWoff2}) format("woff2"), url(${urlWoff}) format("woff")`, { display: 'swap' });
          ff.load().then(loaded => { try { document.fonts.add(loaded); safeLog('OpenDyslexic loaded'); } catch(e){} }).catch(()=>{/*ignore*/});
        } catch(e){}
      }
    } catch (e) {
      console.warn('ensureDysFontInjected error', e);
    }
  }
  function removeDysFontInjected() {
    try { const el = document.getElementById(DYS_STYLE_ID); if (el) el.remove(); } catch (e) {}
  }

  // --- Heuristics: choose main content node
  function isVisible(el) {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      if (!s) return false;
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0) return false;
    } catch (e) {}
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
        if (el && el.innerText && el.innerText.length > 200 && isVisible(el)) return el;
      }
      const candidates = Array.from(document.querySelectorAll('article, main, section, div, p'))
        .filter(el => el && el.innerText && el.innerText.trim().length > 200 && isVisible(el))
        .map(el => ({ el, len: (el.innerText || '').trim().length, density: textDensity(el) }))
        .filter(c => !/(nav|footer|header|sidebar|comment|advert|ads|cookie)/i.test((c.el.id || '') + ' ' + (c.el.className || '')));
      if (candidates.length) {
        candidates.sort((a,b) => (b.len - a.len) || (b.density - a.density));
        return candidates[0].el;
      }
      if (document.body && (document.body.innerText || '').length > 200) return document.body;
    } catch (e) { console.warn('getMainNode err', e); }
    return document.documentElement || document.body;
  }

  // --- Overlay helper (for very large pages or when walking text nodes is risky)
  function createReaderOverlay(text) {
    removeReaderOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'clarityread-overlay';
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

    const close = document.createElement('button');
    close.textContent = 'Close reader';
    close.style.position = 'absolute';
    close.style.right = '16px';
    close.style.top = '10px';
    close.addEventListener('click', () => {
      try { window.speechSynthesis.cancel(); } catch(e){}
      removeReaderOverlay();
      clearHighlights();
    });
    overlay.appendChild(close);

    const inner = document.createElement('div');
    inner.id = 'clarityread-overlay-inner';
    inner.style.whiteSpace = 'pre-wrap';

    const wordRe = /(\S+)(\s*)/g;
    let m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(text)) !== null) {
      const sp = document.createElement('span');
      sp.textContent = (m[1] || '') + (m[2] || '');
      sp.classList.add('clarityread-word');
      inner.appendChild(sp);
    }
    overlay.appendChild(inner);
    document.documentElement.appendChild(overlay);
    overlayActive = true;
    return overlay;
  }
  function removeReaderOverlay() {
    const old = document.getElementById('clarityread-overlay');
    if (old) try { old.remove(); } catch(e){}
    overlayActive = false;
    overlayTextSplice = null;
  }

  // --- Highlight management
  function clearHighlights() {
    if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; }
    try { highlightSpans.forEach(s => { if (s && s.parentNode) s.parentNode.replaceChild(document.createTextNode(s.textContent), s); }); } catch(e){}
    highlightSpans = [];
    highlightIndex = 0;
    selectionRestore = null;
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
      if (i === highlightIndex) s.classList.add('clarityread-highlight');
      else s.classList.remove('clarityread-highlight');
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
      if (i === highlightIndex) s.classList.add('clarityread-highlight'); else s.classList.remove('clarityread-highlight');
    }
    const cur = highlightSpans[highlightIndex];
    if (cur) try { cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  // Prepare spans: selection-first, then treewalk; fallback to overlay if too many spans
  function prepareSpansForHighlighting(fullText) {
    clearHighlights();

    // selection mode
    let sel = null;
    try { sel = window.getSelection(); } catch(e){ sel = null; }
    if (sel && sel.rangeCount && sel.toString().trim().length > 0) {
      try {
        const range = sel.getRangeAt(0);
        const cloned = range.cloneContents();
        const tmp = document.createElement('div'); tmp.appendChild(cloned);
        const originalHtml = tmp.innerHTML;
        const wrapper = document.createElement('span');
        const uid = 'clarityread-selection-' + Date.now() + '-' + Math.floor(Math.random()*1000);
        wrapper.setAttribute('data-clarity-selection', uid);
        wrapper.style.whiteSpace = 'pre-wrap';
        const text = sel.toString();
        const wordRe = /(\S+)(\s*)/g; let m;
        wordRe.lastIndex = 0;
        while ((m = wordRe.exec(text)) !== null) {
          const sp = document.createElement('span');
          sp.textContent = (m[1] || '') + (m[2] || '');
          sp.classList.add('clarityread-word');
          wrapper.appendChild(sp);
          highlightSpans.push(sp);
        }
        range.deleteContents();
        range.insertNode(wrapper);
        selectionRestore = { wrapperSelector: `[data-clarity-selection="${uid}"]`, originalHtml: originalHtml };
        highlightIndex = 0;
        buildCumLengths();
        return { mode: 'selection' };
      } catch (err) {
        console.warn('prepareSpans: selection-mode failed, continuing to page-mode', err);
        selectionRestore = null;
        highlightSpans = [];
      }
    }

    const main = getMainNode();
    if (!main) return { mode: 'none' };

    const textForCount = (main.innerText || '').trim().slice(0, 200000);
    const approxWordCount = (textForCount.match(/\S+/g) || []).length;
    if (approxWordCount > MAX_SPANS_BEFORE_OVERLAY) {
      const snippet = fullText.length > MAX_OVERLAY_CHARS ? fullText.slice(0, MAX_OVERLAY_CHARS) : fullText;
      const ov = createReaderOverlay(snippet);
      const container = ov.querySelector('#clarityread-overlay-inner');
      highlightSpans = Array.from(container.querySelectorAll('span'));
      overlayTextSplice = snippet;
      overlayActive = true;
      highlightIndex = 0;
      buildCumLengths();
      return { mode: 'overlay', overlayText: snippet };
    }

    // Walk text nodes
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parentTag = node.parentNode && node.parentNode.tagName && node.parentNode.tagName.toLowerCase();
        if (['script','style','noscript','textarea','code','pre','input'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    if (!textNodes.length) return { mode: 'none' };

    const wordRe = /(\S+)(\s*)/g;
    let totalSpans = 0;
    for (const tnode of textNodes) {
      const txt = tnode.nodeValue;
      const frag = document.createDocumentFragment();
      let m; wordRe.lastIndex = 0; let matched = false;
      while ((m = wordRe.exec(txt)) !== null) {
        matched = true;
        const span = document.createElement('span');
        span.textContent = (m[1] || '') + (m[2] || '');
        span.classList.add('clarityread-word');
        frag.appendChild(span);
        highlightSpans.push(span);
        totalSpans++;
        if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) break;
      }
      if (matched && frag.childNodes.length) {
        try { tnode.parentNode.replaceChild(frag, tnode); } catch (e) { console.warn('replace failed', e); }
      }
      if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) break;
    }

    if (totalSpans > MAX_SPANS_BEFORE_OVERLAY) {
      // undo and fallback to overlay
      try { highlightSpans.forEach(s => { if (s && s.parentNode) s.parentNode.replaceChild(document.createTextNode(s.textContent), s); }); } catch(e){}
      highlightSpans = [];
      const snippet = fullText.length > MAX_OVERLAY_CHARS ? fullText.slice(0, MAX_OVERLAY_CHARS) : fullText;
      const ov = createReaderOverlay(snippet);
      const container = ov.querySelector('#clarityread-overlay-inner');
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

  // --- Utterance attach handlers
  function attachUtterHandlers(utter) {
    try {
      utter.onboundary = (e) => {
        if (!e || typeof e.charIndex !== 'number') return;
        // reset fallback ticker if running
        if (fallbackTicker) { clearInterval(fallbackTicker); fallbackTicker = null; fallbackTickerRunning = false; }
        // map char index to span highlight
        try {
          mapCharIndexToSpanAndHighlight(e.charIndex);
        } catch (err) {}
      };
    } catch (ex) { console.warn('onboundary attach failed', ex); }

    utter.onpause = () => {
      try { chrome.runtime.sendMessage({ action: 'readingPaused' }, () => {}); } catch(e) {}
    };
    utter.onresume = () => {
      try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch(e) {}
    };

    utter.onerror = (errEvent) => {
      console.warn('utterance error', errEvent);
      try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(errEvent) }, () => {}); } catch(e){}
      // attempt a single fallback: lower rate and retry without highlighting
      if (!errorFallbackAttempted) {
        errorFallbackAttempted = true;
        try { window.speechSynthesis.cancel(); } catch(e){}
        removeReaderOverlay();
        clearHighlights();
        const fallbackText = utter.text || '';
        if (fallbackText) {
          const newUtter = new SpeechSynthesisUtterance(fallbackText);
          // choose first available voice
          const voices = window.speechSynthesis.getVoices() || [];
          newUtter.voice = (utter.voice && utter.voice.name) ? voices.find(v => v.name === utter.voice.name) || voices[0] : (voices[0] || null);
          newUtter.rate = Math.max(0.8, (utter.rate || 1) - 0.25);
          newUtter.pitch = utter.pitch || 1;
          attachUtterHandlers(newUtter);
          try { window.speechSynthesis.speak(newUtter); currentUtterance = newUtter; } catch (e) { console.warn('fallback speak failed', e); try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(e) }, ()=>{}); } catch(e){} }
          return;
        }
      }
      removeReaderOverlay();
      clearHighlights();
    };

    utter.onend = () => {
      removeReaderOverlay();
      clearHighlights();
      try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch(e){}
      // send remaining stats
      finalizeStatsAndSend();
    };
  }

  // --- Stats timer
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
        try { chrome.runtime.sendMessage({ action: 'updateTimeOnly', duration: toSend }, () => {}); } catch (e) {}
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
      try { chrome.runtime.sendMessage({ action: 'updateStats', duration: toSend }, () => {}); } catch (e) {}
      accumulatedElapsed = 0;
    }
  }

  // --- Speech: primary speakText()
  function speakText(text, { voiceName, rate = 1, pitch = 1, highlight = false } = {}) {
    if (!('speechSynthesis' in window)) {
      console.warn('TTS not supported here.');
      try { chrome.runtime.sendMessage({ action: 'readingStopped', error: 'no-tts' }, () => {}); } catch(e){}
      return;
    }

    text = sanitizeForTTS(text || '');
    if (!text) { console.warn('No text to read'); return; }

    // normalize inputs
    rate = clamp(rate, 0.5, 1.6); // keep stable range
    pitch = clamp(pitch, 0.5, 2);

    // cancel any previous
    try { window.speechSynthesis.cancel(); } catch(e){}
    clearHighlights();
    errorFallbackAttempted = false;

    // prepare highlighting if requested
    let utterText = text;
    if (highlight) {
      const prep = prepareSpansForHighlighting(text);
      if (prep && prep.mode === 'overlay') {
        utterText = prep.overlayText || overlayTextSplice || text.slice(0, MAX_OVERLAY_CHARS);
      } else if (prep && prep.mode === 'inplace') {
        // build a concatenated string based on spans to ensure .onboundary char indices map
        utterText = highlightSpans.map(s => s.textContent || '').join('');
        const norm = s => (s || '').replace(/\s+/g, ' ').trim();
        if (!selectionRestore && norm(utterText) !== norm(text)) {
          // if mismatch, fallback to overlay
          const snippet = text.length > MAX_OVERLAY_CHARS ? text.slice(0, MAX_OVERLAY_CHARS) : text;
          const ov = createReaderOverlay(snippet);
          const container = ov.querySelector('#clarityread-overlay-inner');
          highlightSpans = Array.from(container.querySelectorAll('span'));
          overlayTextSplice = snippet;
          overlayActive = true;
          utterText = snippet;
        }
      } else {
        // no spans - leave utterText as text but highlight disabled
        highlight = false;
      }
    }

    const utter = new SpeechSynthesisUtterance(utterText);
    const voices = window.speechSynthesis.getVoices() || [];
    let chosen = null;
    if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
    if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith((document.documentElement.lang || navigator.language || 'en').split('-')[0])) || voices[0] || null;
    if (chosen) utter.voice = chosen;
    utter.rate = rate;
    utter.pitch = pitch;

    currentUtterance = utter;
    // attach handlers
    attachUtterHandlers(utter);

    // start timers / stats
    readStartTs = Date.now();
    accumulatedElapsed = 0;
    pendingSecondsForSend = 0;
    lastStatsSendTs = Date.now();
    startAutoStatsTimer();

    try {
      window.speechSynthesis.speak(utter);
      try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
      // if onboundary never fires we start a safe fallback ticker after short delay
      setTimeout(() => {
        if (!fallbackTickerRunning && highlight && highlightSpans && highlightSpans.length && !utter.onboundary) {
          // attempt to use time-per-word fallback
          const msPerWord = Math.max(150, Math.round(400 / Math.max(0.1, utter.rate)));
          fallbackTickerRunning = true;
          fallbackTicker = setInterval(() => {
            advanceHighlightByOne();
          }, msPerWord);
          safeLog('fallback ticker started', msPerWord);
        }
      }, 600);
    } catch (e) {
      console.warn('speak failed', e);
      try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(e) }, () => {}); } catch (ex) {}
      finalizeStatsAndSend();
    }
  }

  // --- Speed-read: chunked sequential speaking
  let speedChunks = null;
  let speedIndex = 0;
  let speedActive = false;
  function splitIntoChunks(text, chunkSize = 3) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
    return chunks;
  }
  function speakChunksSequentially(chunks, rate = 1, voiceName) {
    if (!chunks || !chunks.length) { safeLog('no chunks'); return; }
    rate = clamp(rate, 0.5, 1.6);
    speedChunks = chunks; speedIndex = 0; speedActive = true;
    try { window.speechSynthesis.cancel(); } catch(e){}
    clearHighlights();
    readStartTs = Date.now(); accumulatedElapsed = 0; pendingSecondsForSend = 0; lastStatsSendTs = Date.now(); startAutoStatsTimer();

    const speakNext = () => {
      if (!speedActive || speedIndex >= speedChunks.length) { speedActive = false; try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch(e){}; finalizeStatsAndSend(); return; }
      const chunkText = sanitizeForTTS(speedChunks[speedIndex++] || '');
      if (!chunkText) { setTimeout(speakNext, 0); return; }
      const u = new SpeechSynthesisUtterance(chunkText);
      const voices = window.speechSynthesis.getVoices() || [];
      let chosen = null;
      if (voiceName) chosen = voices.find(v => v.name === voiceName) || null;
      if (!chosen) chosen = voices.find(v => v.lang && v.lang.startsWith((document.documentElement.lang || navigator.language || 'en').split('-')[0])) || voices[0] || null;
      if (chosen) u.voice = chosen;
      u.rate = clamp(rate, 0.5, 1.6);
      u.pitch = 1;
      u.onend = () => {
        setTimeout(() => speakNext(), Math.max(60, Math.round(200 / Math.max(0.1, u.rate))));
      };
      u.onerror = (err) => {
        console.warn('speedRead chunk error', err);
        speedActive = false;
        try { chrome.runtime.sendMessage({ action: 'readingStopped', error: String(err) }, () => {}); } catch(e){}
        finalizeStatsAndSend();
      };
      try { window.speechSynthesis.speak(u); try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch(e){} } catch (e) { console.warn('speak chunk failed', e); speedActive = false; finalizeStatsAndSend(); }
    };
    speakNext();
  }
  function stopSpeedRead() { speedActive = false; speedChunks = null; speedIndex = 0; try { window.speechSynthesis.cancel(); } catch(e){} finalizeStatsAndSend(); }

  // --- Pause / resume / stop
  function pauseReading() {
    try { window.speechSynthesis.pause(); } catch(e){}
    if (readStartTs) { accumulatedElapsed += (Date.now() - readStartTs) / 1000; readStartTs = null; }
    if (readTimer) { clearInterval(readTimer); readTimer = null; }
    try { chrome.runtime.sendMessage({ action: 'readingPaused' }, () => {}); } catch (e) {}
  }
  function resumeReading() {
    try { window.speechSynthesis.resume(); } catch(e){}
    readStartTs = Date.now();
    startAutoStatsTimer();
    try { chrome.runtime.sendMessage({ action: 'readingResumed' }, () => {}); } catch (e) {}
  }
  function stopReadingAll() {
    try { window.speechSynthesis.cancel(); } catch(e){}
    if (readStartTs) { accumulatedElapsed += (Date.now() - readStartTs) / 1000; readStartTs = null; }
    if (readTimer) { clearInterval(readTimer); readTimer = null; }
    const toSend = Math.floor(accumulatedElapsed || 0);
    if (toSend > 0) {
      try { chrome.runtime.sendMessage({ action: 'updateStats', duration: toSend }, () => {}); } catch (e) {}
      accumulatedElapsed = 0;
    }
    clearHighlights();
    try { chrome.runtime.sendMessage({ action: 'readingStopped' }, () => {}); } catch (e) {}
  }

  // --- Helpers to get page text or selection
  function getTextToRead() {
    try {
      const s = (window.getSelection && window.getSelection().toString()) || '';
      if (s && s.trim().length > 20) return s.trim();
      const main = getMainNode();
      let t = (main && main.innerText) ? main.innerText.trim() : (document.body && document.body.innerText ? document.body.innerText.trim() : '');
      if (t && t.length > 20000) return t.slice(0, 20000);
      return t ? t : '';
    } catch (e) { console.warn('getTextToRead err', e); return ''; }
  }
  function detectLanguage() {
    return (document.documentElement.lang || navigator.language || 'en').toLowerCase();
  }

  // --- Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.action) { sendResponse({ ok: false }); return true; }

      switch (msg.action) {
        case 'applySettings':
          try {
            if (msg.dys) ensureDysFontInjected(); else removeDysFontInjected();
            if (msg.reflow) document.documentElement.classList.add('readeasy-reflow'); else document.documentElement.classList.remove('readeasy-reflow');
            if (msg.contrast) document.documentElement.classList.add('readeasy-contrast'); else document.documentElement.classList.remove('readeasy-contrast');
            if (msg.invert) document.documentElement.classList.add('readeasy-invert'); else document.documentElement.classList.remove('readeasy-invert');
            if (typeof msg.fontSize !== 'undefined') {
              const fs = (typeof msg.fontSize === 'number') ? `${msg.fontSize}px` : String(msg.fontSize);
              document.documentElement.style.setProperty('--readeasy-font-size', fs);
              if (document.documentElement.classList.contains('readeasy-reflow')) {
                const m = getMainNode(); if (m) m.style.fontSize = fs;
              }
            }
          } catch (e) { console.warn('applySettings failed', e); }
          sendResponse({ ok: true });
          break;

        case 'readAloud': {
          // prefer voice/rate/pitch passed in message, fallback to storage.sync
          chrome.storage.sync.get(['voice','rate','pitch','highlight'], (res) => {
            const voice = (typeof msg.voice === 'string' && msg.voice.length) ? msg.voice : (res.voice || '');
            const rate = (typeof msg.rate !== 'undefined' ? msg.rate : (res.rate || 1));
            const pitch = (typeof msg.pitch !== 'undefined' ? msg.pitch : (res.pitch || 1));
            const highlight = (typeof msg.highlight !== 'undefined' ? !!msg.highlight : !!res.highlight);
            const text = (typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead();
            if (!text || !text.trim()) {
              console.warn('readAloud: no text found to read');
              sendResponse({ ok: false, error: 'no-text' });
              return;
            }
            speakText(text, { voiceName: voice, rate, pitch, highlight });
            sendResponse({ ok: true });
          });
          break;
        }

        case 'speedRead': {
          chrome.storage.sync.get(['voice'], (res) => {
            const chunkSize = Number(msg.chunkSize || msg.chunk || 3);
            const r = Number(msg.rate || 1);
            const text = (typeof msg.text === 'string' && msg.text.length) ? msg.text : ((typeof msg._savedText === 'string' && msg._savedText.length) ? msg._savedText : getTextToRead());
            if (!text || !text.trim()) { sendResponse({ ok: false, error: 'no-text' }); return; }
            const chunks = splitIntoChunks(text, Math.max(1, Math.floor(chunkSize)));
            speakChunksSequentially(chunks, clamp(r, 0.5, 1.6), (msg.voice || res.voice));
            sendResponse({ ok: true });
          });
          break;
        }

        case 'stopReading':
          stopSpeedRead();
          stopReadingAll();
          sendResponse({ ok: true });
          break;

        case 'pauseReading':
          pauseReading();
          sendResponse({ ok: true });
          break;

        case 'resumeReading':
          resumeReading();
          sendResponse({ ok: true });
          break;

        case 'detectLanguage':
          sendResponse({ ok: true, lang: detectLanguage() });
          break;

        case 'getSelection':
          try {
            const selText = window.getSelection ? window.getSelection().toString().trim() : '';
            sendResponse({ ok: true, response: { selection: { text: selText || '', title: document.title || '', url: location.href || '' } } });
          } catch (e) {
            sendResponse({ ok: false });
          }
          break;

        default:
          sendResponse({ ok: false, error: 'unknown-action' });
      }
    } catch (e) {
      console.warn('contentScript onMessage error', e);
      sendResponse({ ok: false, error: String(e) });
    }
    // indicate async response support
    return true;
  });

  // cleanup when the page unloads
  window.addEventListener('pagehide', () => {
    try { window.speechSynthesis.cancel(); } catch(e){}
  });
})();
