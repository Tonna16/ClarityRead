// src/background.js - improved tab selection + injection/fallback handling (hardened)
// + merged message handlers, better logging, surface CSS insert info, sessions heuristic
(() => {
  'use strict';

  const HANDSHAKE_KEY = '_handshakeSelection';
  const HANDSHAKE_TTL_MS = 30 * 1000; // 30s - popup should consume handshake quickly

  const DEBUG = true; // set true locally when debugging, false for release
  const safeLog = (...args) => { try { if (DEBUG) console.log('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeWarn = (...args) => { try { if (DEBUG) console.warn('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeInfo = (...args) => { try { if (DEBUG) console.info('[ClarityRead bg]', ...args); } catch (e) {} };


  // Utility: safe runtime.sendMessage (silently ignores "no receiver" errors)
  function safeRuntimeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        // swallow runtime.lastError intentionally
      });
    } catch (err) {
      // service worker might be shutting down; ignore
      safeWarn('safeRuntimeSendMessage threw', err);
    }
  }

  function isWebUrl(u = '') {
    if (!u) return false;
    const s = String(u).toLowerCase();
    // exclude internal or special pages
    return !/^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/|file:\/\/|view-source:|moz-extension:\/\/)/.test(s);
  }

  function buildOriginPermissionPattern(url) {
    try {
      const u = new URL(url);
      // pattern like "https://example.com/*" or "http://host:port/*"
      return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/*`;
    } catch (e) {
      return '<all_urls>';
    }
  }

  // Try to request permission for the specific origin (popup may call this)
  function requestHostPermissionForUrl(url) {
    return new Promise((resolve) => {
      const originPattern = buildOriginPermissionPattern(url);
      try {
        chrome.permissions.request({ origins: [originPattern] }, (granted) => {
          if (chrome.runtime.lastError) {
            safeWarn('permissions.request error', chrome.runtime.lastError);
            return resolve({ ok: false, error: 'permission-request-failed', detail: chrome.runtime.lastError.message });
          }
          resolve({ ok: !!granted, pattern: originPattern });
        });
      } catch (e) {
        safeWarn('permissions.request threw', e);
        resolve({ ok: false, error: 'permission-request-exception', detail: String(e) });
      }
    });
  }

  // Small helper to unwrap nested background/content responses
  function unwrapResponseMaybe(obj) {
    try {
      let r = obj;
      let depth = 0;
      while (r && typeof r === 'object' && ('response' in r) && depth < 6) {
        r = r.response;
        depth++;
      }
      return r;
    } catch (e) {
      return obj;
    }
  }

  // Try sending a message to a tab; if there's no receiver, try to inject the content script then retry.
  // Resolves with structured result { ok: boolean, response?, error?, detail?, permissionPattern?, cssError? }
  async function sendMessageToTabWithInjection(tabId, message) {
    safeLog('sendMessageToTabWithInjection called', { tabId, action: message && message.action, hintedTarget: message && message._targetTabId });
    return new Promise((resolve) => {
      if (typeof tabId === 'undefined' || tabId === null) {
        return resolve({ ok: false, error: 'invalid-tab-id' });
      }

      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

      try {
        // initial quick send
        safeLog('attempting direct sendMessage', { tabId, action: message && message.action });
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (!chrome.runtime.lastError) {
            safeLog('sendMessage direct succeeded', { tabId, action: message && message.action, response });
            // unwrap nested response if present; return consistent shape
            const unwrapped = unwrapResponseMaybe(response);
            return finish({ ok: true, response: unwrapped, cssError: null });
          }

          // runtime.lastError -> attempt injection path
          const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ? String(chrome.runtime.lastError.message) : 'unknown';
          safeWarn('initial sendMessage error', errMsg);

          // get tab info before trying to inject (log url for debugging)
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              safeWarn('chrome.tabs.get failed for', tabId, chrome.runtime.lastError);
              return finish({ ok: false, error: 'invalid-tab', detail: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no-tab' });
            }

            safeLog('target tab info', { id: tab.id, url: tab.url, discarded: !!tab.discarded, active: !!tab.active, status: tab.status });

            if (!tab.url || !isWebUrl(tab.url)) {
              safeInfo('tab url unsupported for injection', tab.url);
              return finish({ ok: false, error: 'unsupported-page', detail: tab.url || '' });
            }

            if (tab.discarded) {
              safeInfo('tab is discarded', tabId, tab.url);
              return finish({ ok: false, error: 'tab-discarded', detail: tab.url });
            }

            const jsFile = 'src/contentScript.js';
            const cssFile = 'src/inject.css';
            let cssErrorMsg = null;

            // Pre-check host permission: if we don't have it, return no-host-permission early
            const permissionPattern = buildOriginPermissionPattern(tab.url);
            try {
              chrome.permissions.contains({ origins: [permissionPattern] }, (has) => {
                try {
                  if (chrome.runtime.lastError) {
                    // If contains threw, log and proceed with injection attempt (older browsers / edge cases)
                    safeWarn('chrome.permissions.contains error', chrome.runtime.lastError);
                  } else if (!has) {
                    // IMPORTANT: return early with permissionPattern so caller (popup) can request exact host permission
                    safeInfo('missing host permission for origin', permissionPattern);
                    return finish({ ok: false, error: 'no-host-permission', detail: 'host-permission-missing', permissionPattern });
                  }

                  // Attempt to inject the content script (manifest declared)
                  try {
                    safeLog('attempting scripting.executeScript', { tabId, jsFile });
                    chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
                      if (chrome.runtime.lastError) {
                        const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                        safeWarn('scripting.executeScript failed', chrome.runtime.lastError.message);

                        // host permission required (double-check)
                        if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                          // surface permission pattern so UI can request permission
                          return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                        }

                        return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
                      }

                      safeLog('executeScript injectionResults', Array.isArray(injectionResults) ? injectionResults.length : typeof injectionResults);

                      // best-effort CSS insertion (non-fatal) — capture error message to surface alongside success
                      chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, (cssRes) => {
                        if (chrome.runtime.lastError) {
                          cssErrorMsg = String(chrome.runtime.lastError.message || chrome.runtime.lastError);
                          safeWarn('insertCSS failed', cssErrorMsg);
                        } else {
                          safeLog('insertCSS succeeded');
                        }

                        // Now attempt to message again (content script should be present now)
                        safeLog('attempting sendMessage after injection', { tabId, action: message && message.action });
                        chrome.tabs.sendMessage(tabId, message, (resp2) => {
                          if (chrome.runtime.lastError) {
                            const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                            safeWarn('sendMessage after inject failed', chrome.runtime.lastError.message);
                            if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                              return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                            }
                            return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message });
                          }
                          safeLog('sendMessage after inject succeeded', { tabId, action: message && message.action, resp2, cssError: !!cssErrorMsg });
                          // unwrap nested response if present and include cssError metadata
                          const unwrapped2 = unwrapResponseMaybe(resp2);
                          return finish({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null });
                        });
                      });
                    });
                  } catch (ex) {
                    safeWarn('scripting.executeScript threw', ex);
                    return finish({ ok: false, error: 'executeScript-exception', detail: String(ex) });
                  }
                } catch (outerExecCheckErr) {
                  safeWarn('permission.contains callback outer error', outerExecCheckErr);
                  return finish({ ok: false, error: 'permission-check-error', detail: String(outerExecCheckErr) });
                }
              });
            } catch (pcEx) {
              safeWarn('permission.contains threw', pcEx);
              // proceed to attempt injection (best-effort) if contains itself threw
              try {
                safeLog('attempting scripting.executeScript (permission.contains threw)', { tabId, jsFile });
                chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
                  if (chrome.runtime.lastError) {
                    safeWarn('scripting.executeScript failed (after permission.contains threw)', chrome.runtime.lastError.message);
                    const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                    if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                      return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                    }
                    return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
                  }
                  // try insert css and message back as above
                  chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, (cssRes) => {
                    if (chrome.runtime.lastError) {
                      cssErrorMsg = String(chrome.runtime.lastError.message || chrome.runtime.lastError);
                      safeWarn('insertCSS failed', cssErrorMsg);
                    } else {
                      safeLog('insertCSS succeeded');
                    }
                    chrome.tabs.sendMessage(tabId, message, (resp2) => {
                      if (chrome.runtime.lastError) {
                        const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                        safeWarn('sendMessage after inject failed', chrome.runtime.lastError.message);
                        if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                          return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                        }
                        return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message });
                      }
                      const unwrapped2 = unwrapResponseMaybe(resp2);
                      return finish({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null });
                    });
                  });
                });
              } catch (finalEx) {
                safeWarn('executeScript second attempt threw', finalEx);
                return finish({ ok: false, error: 'executeScript-exception', detail: String(finalEx) });
              }
            }
          });
        });
      } catch (err) {
        safeWarn('sendMessageToTabWithInjection outer catch', err);
        finish({ ok: false, error: 'send-exception', detail: String(err) });
      }

      // safety timeout in case sendMessage never invokes callback (should not happen)
      // longer timeout to be slightly more resilient
      const SAFETY_MS = 10000;
      const to = setTimeout(() => {
        try { finish({ ok: false, error: 'send-timeout' }); } catch(e) {}
      }, SAFETY_MS);
      // ensure we don't leave stray timeout after resolve
      const origFinish = finish;
      finish = (r) => { try { clearTimeout(to); } catch(e) {} ; origFinish(r); };
    });
  }

  // Helper: store handshake selection and try to open/focus popup window
  function storeHandshakeAndOpenPopup(selectionObj = {}) {
    const payload = {
      text: selectionObj.text || '',
      title: selectionObj.title || '',
      url: selectionObj.url || '',
      ts: Date.now()
    };

    try {
      chrome.storage.local.set({ [HANDSHAKE_KEY]: payload }, () => {
        safeLog('handshake stored', payload);

        // Try to find an already-open popup tab and focus its window/tab, otherwise open a new popup window
        const popupUrl = chrome.runtime.getURL('src/popup.html');

        // Query tabs for already-open popup (best-effort)
        chrome.tabs.query({ url: popupUrl }, (tabs) => {
          if (chrome.runtime.lastError) {
            // If query fails, just open a new window
            safeWarn('tabs.query for popup failed', chrome.runtime.lastError);
            chrome.windows.create({ url: popupUrl, type: 'popup', width: 800, height: 600 }, () => {});
            return;
          }

          if (tabs && tabs.length > 0) {
            // Focus the first found popup tab
            const t = tabs[0];
            try {
              chrome.windows.update(t.windowId, { focused: true }, () => {
                // bring tab to front
                chrome.tabs.update(t.id, { active: true }, () => {
                  safeLog('focused existing popup tab', t.id);
                });
              });
            } catch (e) {
              safeWarn('failed to focus existing popup', e);
              chrome.windows.create({ url: popupUrl, type: 'popup', width: 800, height: 600 }, () => {});
            }
          } else {
            // no existing popup -> create
            chrome.windows.create({ url: popupUrl, type: 'popup', width: 800, height: 600 }, () => {
              safeLog('opened new popup window for handshake');
            });
          }
        });
      });
    } catch (e) {
      safeWarn('storeHandshakeAndOpenPopup failed', e);
    }
  }

  // Context menu: "Read with ClarityRead" for text selections
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.create({
        id: 'clarityReadSelection',
        title: 'Read with ClarityRead',
        contexts: ['selection']
      }, () => {
        if (chrome.runtime.lastError) safeWarn('contextMenus.create error', chrome.runtime.lastError);
        else safeLog('context menu created');
      });
    } catch (e) {
      safeWarn('contextMenus.create threw', e);
    }
  });

  // NEW: context click now stores handshake and opens/focuses popup instead of messaging the page directly
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    try {
      if (info.menuItemId === 'clarityReadSelection') {
        // Build a safe handshake payload
        const txt = (info.selectionText || '').toString();
        const title = (tab && tab.title) ? tab.title : '';
        const pageUrl = info.pageUrl || (tab && tab.url) || '';
        safeLog('context menu clicked - storing handshake (no direct messaging)', { textLen: txt.length, pageUrl, title });

        storeHandshakeAndOpenPopup({ text: txt, title, url: pageUrl });

        // don't attempt to sendMessage here — popup will consume the handshake and do the work
        return;
      }
    } catch (e) {
      safeWarn('contextMenus.onClicked handler error', e);
    }
  });

  // open full popup window behavior (action click)
  chrome.action.onClicked.addListener(async () => {
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL("src/popup.html"),
        type: "popup",
        width: 800,
        height: 600
      });
      safeLog('popup window opened');
    } catch (err) {
      safeWarn('Failed to open popup window:', err);
    }
  });

  // improved commands handler: prefer web tab, but if popup/extension page is active,
// route command to popup via runtime message so popup keyboard UI works when open.
chrome.commands.onCommand.addListener(async (command) => {
  try {
    // try active tab first
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
    let tab = tabs && tabs[0];

    // If active tab is a web page, target it
    if (tab && isWebUrl(tab.url || '')) {
      // send to web tab as before
      if (command === "read-aloud") {
        const result = await sendMessageToTabWithInjection(tab.id, { action: "readAloud" });
        if (!result.ok) safeWarn('Could not send readAloud:', result);
      } else if (command === "stop-reading") {
        const result = await sendMessageToTabWithInjection(tab.id, { action: "stopReading" });
        if (!result.ok) safeWarn('Could not send stopReading:', result);
      } else {
        safeLog('unknown command', command);
      }
      return;
    }

    // If not a web tab, try to find a web tab using existing fallback logic
    const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
    let foundWebTab = null;
    if (Array.isArray(allWins)) {
      const focusedNormalWin = allWins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
      if (focusedNormalWin) {
        foundWebTab = (focusedNormalWin.tabs || []).find(t => t && t.active && isWebUrl(t.url));
      }
      if (!foundWebTab) {
        for (const w of allWins) {
          if (w && w.type === 'normal' && Array.isArray(w.tabs)) {
            const t = (w.tabs || []).find(tt => tt && tt.active && isWebUrl(tt.url));
            if (t) { foundWebTab = t; break; }
          }
        }
      }
      if (!foundWebTab) {
        for (const w of allWins) {
          if (!Array.isArray(w.tabs)) continue;
          for (const t of w.tabs) {
            if (t && isWebUrl(t.url)) { foundWebTab = t; break; }
          }
          if (foundWebTab) break;
        }
      }
    }

    if (foundWebTab) {
      // send to discovered web tab
      if (command === "read-aloud") {
        const result = await sendMessageToTabWithInjection(foundWebTab.id, { action: "readAloud" });
        if (!result.ok) safeWarn('Could not send readAloud (foundWebTab):', result);
      } else if (command === "stop-reading") {
        const result = await sendMessageToTabWithInjection(foundWebTab.id, { action: "stopReading" });
        if (!result.ok) safeWarn('Could not send stopReading (foundWebTab):', result);
      } else {
        safeLog('unknown command', command);
      }
      return;
    }

    // No web tab found — if the popup or extension is open, send a runtime message so extension pages (popup) can act
    safeLog('no web tab found; routing command to extension runtime', command);

    try {
      chrome.runtime.sendMessage({ action: 'command', command }, () => {
        // intentionally swallow lastError
        if (chrome.runtime.lastError) {
          // no receiver (popup not open) — show a hint badge on the active tab if present
          if (tab && tab.id) {
            chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
            chrome.action.setTitle({ tabId: tab.id, title: "ClarityRead shortcuts not available here." });
          }
          safeLog('runtime.sendMessage had no receiver for command', command);
        } else {
          safeLog('runtime.sendMessage delivered command to extension runtime', command);
        }
      });
    } catch (e) {
      safeWarn('runtime.sendMessage threw', e);
    }
  } catch (err) {
    safeWarn('onCommand error:', err);
  }
});


  // centralized stats helpers
  function persistStatsUpdate(addPages = 0, addSeconds = 0) {
    chrome.storage.local.get(['stats'], (res) => {
      const stats = res && res.stats ? res.stats : { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
      stats.totalPagesRead = (stats.totalPagesRead || 0) + (addPages || 0);
      stats.totalTimeReadSec = (stats.totalTimeReadSec || 0) + (addSeconds || 0);

      // sessions: increment for page reads OR long time-based reads (>=60s)
      if (addPages > 0 || (addSeconds && addSeconds >= 60)) stats.sessions = (stats.sessions || 0) + 1;

      stats.daily = Array.isArray(stats.daily) ? stats.daily : [];

      const today = new Date().toISOString().slice(0, 10);
      let todayEntry = stats.daily.find(d => d.date === today);
      if (!todayEntry) {
        todayEntry = { date: today, pages: 0 };
        stats.daily.push(todayEntry);
      }
      todayEntry.pages = (todayEntry.pages || 0) + addPages;

      chrome.storage.local.set({ stats }, () => {
        chrome.storage.sync.set({ stats }, () => {
          safeLog('stats updated', stats);
          safeRuntimeSendMessage({ action: 'statsUpdated' });
        });
      });
    });
  }

  function resetStats() {
    const zeroed = { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
    chrome.storage.local.set({ stats: zeroed }, () => {
      chrome.storage.sync.set({ stats: zeroed }, () => {
        safeLog('stats reset');
        safeRuntimeSendMessage({ action: 'statsUpdated' });
      });
    });
  }

  // small helper to persist overlay state (so popup can query if it opens after overlay was created)
  function persistOverlayStateForTab(tabId, url, overlayActive) {
    try {
      const key = `_overlay_state_${tabId}`;
      const val = { overlayActive: !!overlayActive, ts: Date.now(), url: url || '' };
      const obj = {}; obj[key] = val;
      chrome.storage.local.set(obj, () => {
        safeLog('persisted overlay state for tab', tabId, val);
      });
    } catch (e) { safeWarn('persistOverlayStateForTab failed', e); }
  }

  function readOverlayStateForTab(tabId) {
    return new Promise((resolve) => {
      try {
        const key = `_overlay_state_${tabId}`;
        chrome.storage.local.get([key], (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res && res[key] ? res[key] : null);
        });
      } catch (e) { resolve(null); }
    });
  }

  // single message handler: forwards UI actions to a sensible web tab and handles internal requests
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Always return true so we can send async responses.
    let responded = false;
    const respondOnce = (r) => {
      if (responded) return;
      responded = true;
      try { sendResponse(r); } catch (e) { safeWarn('sendResponse failed', e); }
    };

    try {
      // internal-only request for host permission helper
      if (msg && msg.__internal === 'requestHostPermission' && msg.url) {
        requestHostPermissionForUrl(msg.url).then((r) => respondOnce(r)).catch((e) => respondOnce({ ok: false, error: String(e) }));
        return true;
      }

      // receive overlay state notifications from content scripts and persist + broadcast
      if (msg && msg.action === 'clarity_overlay_state') {
        try {
          const overlayActive = !!msg.overlayActive;
          safeLog('received clarity_overlay_state', { overlayActive, fromTab: sender && sender.tab && sender.tab.id });
          // broadcast to runtime pages (popup) so any open popup receives the update
          safeRuntimeSendMessage({ action: 'clarity_overlay_state', overlayActive, tabId: (sender && sender.tab && sender.tab.id) || null });
          // persist per-tab so popup can query if it opens after this event
          if (sender && sender.tab && sender.tab.id) {
            persistOverlayStateForTab(sender.tab.id, sender.tab.url, overlayActive);
          }
          respondOnce({ ok: true });
        } catch (e) {
          safeWarn('clarity_overlay_state handling failed', e);
          respondOnce({ ok: false, error: String(e) });
        }
        return true;
      }

      if (!msg || !msg.action) {
        respondOnce({ ok: false, error: 'missing-action' });
        return true;
      }

      switch (msg.action) {
        case 'updateStats':
          persistStatsUpdate(1, Number(msg.duration) || 0);
          respondOnce({ ok: true });
          return true;

        case 'updateTimeOnly':
          persistStatsUpdate(0, Number(msg.duration) || 0);
          respondOnce({ ok: true });
          return true;

        case 'resetStats':
          resetStats();
          respondOnce({ success: true });
          return true;

        case 'readingStopped':
          safeRuntimeSendMessage({ action: 'readingStopped' });
          respondOnce({ ok: true });
          return true;

        case 'readingPaused':
          safeRuntimeSendMessage({ action: 'readingPaused' });
          respondOnce({ ok: true });
          return true;

        case 'readingResumed':
          safeRuntimeSendMessage({ action: 'readingResumed' });
          respondOnce({ ok: true });
          return true;

        // allow popup to ask background for persisted overlay state for a given tab
        case 'getOverlayState': {
          (async () => {
            try {
              const tid = msg.tabId || (sender && sender.tab && sender.tab.id);
              if (!tid) { respondOnce({ ok: false, error: 'no-tab-id' }); return; }
              const state = await readOverlayStateForTab(tid);
              respondOnce({ ok: true, overlayState: state });
            } catch (e) { respondOnce({ ok: false, error: String(e) }); }
          })();
          return true;
        }

        // Forwarded UI actions handled by picking a tab to target and using sendMessageToTabWithInjection
        case 'readAloud':
        case 'toggleFocusMode':
        case 'stopReading':
        case 'pauseReading':
        case 'resumeReading':
        case 'applySettings':
        case 'speedRead':
        case 'detectLanguage':
        case 'getSelection':
        case 'clarity_extract_main':
        // (fallthrough to the general forward handler below)

        // allow popup to query overlay state directly on tab (forwarded to content script)
        case 'clarity_query_overlay': {
          (async () => {
            try {
              safeLog('forwarding action', msg.action, { hintedTarget: msg._targetTabId, senderTab: sender && sender.tab && sender.tab.id });

              // If popup gave a _targetTabId/_targetTabUrl, only honor it if it points to a web URL.
              if (msg && msg._targetTabId) {
                try {
                  const targetId = Number(msg._targetTabId);
                  if (Number.isFinite(targetId)) {
                    const tabObj = await new Promise((resolve) => chrome.tabs.get(targetId, resolve));
                    safeLog('validated hinted target', { targetId, tabObj: tabObj && { id: tabObj.id, url: tabObj.url } });
                    if (!chrome.runtime.lastError && tabObj && isWebUrl(tabObj.url || '')) {
                      const res = await sendMessageToTabWithInjection(targetId, msg);
                      respondOnce(res);
                      return;
                    } else {
                      safeWarn('provided _targetTabId invalid or unsupported (ignoring)', msg._targetTabId, tabObj && tabObj.url);
                    }
                  }
                } catch (e) {
                  safeWarn('error validating _targetTabId, falling back to discovery', e);
                }
              }

              // If message originated from a content script in a web tab, use that tab
              if (sender && sender.tab && sender.tab.id && isWebUrl(sender.tab.url || '')) {
                safeLog('using sender.tab as target', { id: sender.tab.id, url: sender.tab.url });
                const res = await sendMessageToTabWithInjection(sender.tab.id, msg);
                respondOnce(res);
                return;
              }

              // Prefer a focused normal window's active web tab, then other discovery strategies
              const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
              if (Array.isArray(allWins)) {
                // 1) Focused normal window -> active web tab
                const focusedNormalWin = allWins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
                if (focusedNormalWin) {
                  const tab = (focusedNormalWin.tabs || []).find(t => t && t.active && isWebUrl(t.url));
                  if (tab && tab.id) {
                    safeLog('using focused normal window active tab', { id: tab.id, url: tab.url });
                    const res = await sendMessageToTabWithInjection(tab.id, msg);
                    respondOnce(res);
                    return;
                  }
                }

                // 2) Any normal window's active web tab
                for (const w of allWins) {
                  if (w && w.type === 'normal' && Array.isArray(w.tabs)) {
                    const t = (w.tabs || []).find(tt => tt && tt.active && isWebUrl(tt.url));
                    if (t && t.id) {
                      safeLog('using any normal window active tab', { id: t.id, url: t.url });
                      const res = await sendMessageToTabWithInjection(t.id, msg);
                      respondOnce(res);
                      return;
                    }
                  }
                }

                // 3) Fallback: first web tab anywhere
                for (const w of allWins) {
                  for (const t of (w.tabs || [])) {
                    if (t && isWebUrl(t.url)) {
                      safeLog('using first available web tab fallback', { id: t.id, url: t.url });
                      const res = await sendMessageToTabWithInjection(t.id, msg);
                      respondOnce(res);
                      return;
                    }
                  }
                }
              }

              // 4) Last-resort: active tab in lastFocusedWindow (legacy fallback)
              const activeTabs = await new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
              if (activeTabs && activeTabs[0] && isWebUrl(activeTabs[0].url || '')) {
                safeLog('using active tab in lastFocusedWindow fallback', { id: activeTabs[0].id, url: activeTabs[0].url });
                const res = await sendMessageToTabWithInjection(activeTabs[0].id, msg);
                respondOnce(res);
                return;
              }

              respondOnce({ ok: false, error: 'no-tab' });
            } catch (err) {
              safeWarn('background forward error:', err);
              respondOnce({ ok: false, error: String(err) });
            }
          })();

          return true;
        }

        default:
          respondOnce({ ok: false, error: 'unknown-action' });
          return true;
      }
    } catch (outerErr) {
      safeWarn('onMessage outer catch', outerErr);
      respondOnce({ ok: false, error: String(outerErr) });
      return true;
    }
  });

  // Periodic cleanup: remove stale handshake keys older than TTL (best-effort)
  setInterval(() => {
    try {
      chrome.storage.local.get([HANDSHAKE_KEY], (res) => {
        if (res && res[HANDSHAKE_KEY] && res[HANDSHAKE_KEY].ts) {
          if (Date.now() - res[HANDSHAKE_KEY].ts > HANDSHAKE_TTL_MS) {
            chrome.storage.local.remove(HANDSHAKE_KEY, () => { safeLog('cleaned stale handshake'); });
          }
        }
      });
    } catch (e) { /* ignore */ }
  }, 15 * 1000);

  safeLog('background service ready');
})();
