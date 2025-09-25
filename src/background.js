// src/background.js - improved tab selection + injection/fallback handling (hardened)
(() => {
  'use strict';

  const safeLog = (...args) => { try { console.log('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeWarn = (...args) => { try { console.warn('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeInfo = (...args) => { try { console.info('[ClarityRead bg]', ...args); } catch (e) {} };

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

  // Try sending a message to a tab; if there's no receiver, try to inject the content script then retry.
  // Resolves with structured result { ok: boolean, response?, error?, detail?, permissionPattern? }
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
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (!chrome.runtime.lastError) {
            safeLog('sendMessage direct succeeded', { tabId, action: message && message.action });
            return finish({ ok: true, response });
          }

          // runtime.lastError -> attempt injection path
          const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ? String(chrome.runtime.lastError.message) : 'unknown';
          safeWarn('initial sendMessage error', errMsg);

          // get tab info before trying to inject
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              safeWarn('chrome.tabs.get failed for', tabId, chrome.runtime.lastError);
              return finish({ ok: false, error: 'invalid-tab', detail: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no-tab' });
            }

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

            // Attempt to inject the content script (manifest declared)
            try {
              chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
                if (chrome.runtime.lastError) {
                  const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                  safeWarn('scripting.executeScript failed', chrome.runtime.lastError.message);

                  // host permission required
                  if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                    const permissionPattern = buildOriginPermissionPattern(tab.url);
                    return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                  }

                  return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
                }

                safeLog('executeScript injectionResults', Array.isArray(injectionResults) ? injectionResults.length : typeof injectionResults);

                // best-effort CSS insertion (non-fatal)
                chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, (cssRes) => {
                  if (chrome.runtime.lastError) {
                    safeWarn('insertCSS failed', chrome.runtime.lastError.message);
                  } else {
                    safeLog('insertCSS succeeded');
                  }

                  // Now attempt to message again
                  chrome.tabs.sendMessage(tabId, message, (resp2) => {
                    if (chrome.runtime.lastError) {
                      const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                      safeWarn('sendMessage after inject failed', chrome.runtime.lastError.message);
                      if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                        const permissionPattern = buildOriginPermissionPattern(tab.url);
                        return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                      }
                      return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message });
                    }
                    safeLog('sendMessage after inject succeeded');
                    return finish({ ok: true, response: resp2 });
                  });
                });
              });
            } catch (ex) {
              safeWarn('scripting.executeScript threw', ex);
              return finish({ ok: false, error: 'executeScript-exception', detail: String(ex) });
            }
          });
        });
      } catch (err) {
        safeWarn('sendMessageToTabWithInjection outer catch', err);
        finish({ ok: false, error: 'send-exception', detail: String(err) });
      }

      // safety timeout in case sendMessage never invokes callback (should not happen)
      setTimeout(() => {
        finish({ ok: false, error: 'send-timeout' });
      }, 8000);
    });
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

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    try {
      if (info.menuItemId === 'clarityReadSelection') {
        if (!tab || !tab.id) return;
        const txt = info.selectionText || '';
        sendMessageToTabWithInjection(tab.id, { action: 'readAloud', _savedText: txt })
          .then(res => { if (!res.ok) safeWarn('context read failed', res); else safeLog('context read ok'); })
          .catch(err => safeWarn('context read error', err));
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

  // keyboard commands
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs && tabs[0];
      if (!tab) return;

      if (!isWebUrl(tab.url)) {
        chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        chrome.action.setTitle({ tabId: tab.id, title: "ClarityRead shortcuts not available here." });
        safeLog('command invoked on non-web-url', tab.url);
        return;
      }

      if (command === "read-aloud") {
        const result = await sendMessageToTabWithInjection(tab.id, { action: "readAloud" });
        if (!result.ok) safeWarn('Could not send readAloud:', result);
      } else if (command === "stop-reading") {
        const result = await sendMessageToTabWithInjection(tab.id, { action: "stopReading" });
        if (!result.ok) safeWarn('Could not send stopReading:', result);
      } else {
        safeLog('unknown command', command);
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
      if (addPages > 0) stats.sessions = (stats.sessions || 0) + 1;

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

  // message handler - forwards UI actions to a sensible web tab
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Always return true so we can send async responses.
    let responded = false;
    const respondOnce = (r) => {
      if (responded) return;
      responded = true;
      try { sendResponse(r); } catch (e) { safeWarn('sendResponse failed', e); }
    };

    try {
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

        // Forwarded UI actions handled by picking a tab to target and using sendMessageToTabWithInjection
        case 'readAloud':
        case 'toggleFocusMode':
        case 'stopReading':
        case 'pauseReading':
        case 'resumeReading':
        case 'applySettings':
        case 'speedRead':
        case 'detectLanguage':
        case 'getSelection': {
          (async () => {
            try {
              // If popup gave a _targetTabId/_targetTabUrl, only honor it if it points to a web URL.
              if (msg && msg._targetTabId) {
                try {
                  const targetId = Number(msg._targetTabId);
                  if (Number.isFinite(targetId)) {
                    const tabObj = await new Promise((resolve) => chrome.tabs.get(targetId, resolve));
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
                const res = await sendMessageToTabWithInjection(sender.tab.id, msg);
                respondOnce(res);
                return;
              }

              // Prefer a focused normal window's active web tab
              const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
              if (Array.isArray(allWins)) {
                // 1) Focused normal window -> active web tab
                const focusedNormalWin = allWins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
                if (focusedNormalWin) {
                  const tab = (focusedNormalWin.tabs || []).find(t => t && t.active && isWebUrl(t.url));
                  if (tab && tab.id) {
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

  // expose requestHostPermissionForUrl to popup via runtime (optional)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.__internal === 'requestHostPermission' && msg.url) {
      requestHostPermissionForUrl(msg.url).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });

  safeLog('background service ready');
})();
