// src/background.js - improved tab selection + injection/fallback handling (hardened)

// Utility: safe runtime.sendMessage (silently ignores "no receiver" errors)
function safeRuntimeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // swallow any runtime.lastError
    });
  } catch (err) {
    // service worker might be shutting down; ignore
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
          console.warn('permissions.request error', chrome.runtime.lastError);
          return resolve({ ok: false, error: 'permission-request-failed', detail: chrome.runtime.lastError.message });
        }
        resolve({ ok: !!granted, pattern: originPattern });
      });
    } catch (e) {
      console.warn('permissions.request threw', e);
      resolve({ ok: false, error: 'permission-request-exception', detail: String(e) });
    }
  });
}
console.info('background.sendMessageToTabWithInjection called', { tabId, action: message && message.action, _targetTabId: message && message._targetTabId, _targetTabUrl: message && message._targetTabUrl });
// Try sending a message to a tab; if there's no receiver, try to inject the content script then retry.
// Resolves with structured result { ok: boolean, response?, error?, detail?, permissionPattern? }
async function sendMessageToTabWithInjection(tabId, message) {
  return new Promise((resolve) => {
    console.info('background.sendMessageToTabWithInjection called', { tabId, action: message && message.action, _targetTabId: message && message._targetTabId, _targetTabUrl: message && message._targetTabUrl });
    if (typeof tabId === 'undefined' || tabId === null) {
      return resolve({ ok: false, error: 'invalid-tab-id' });
    }

    // initial quick send
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!chrome.runtime.lastError) {
        return resolve({ ok: true, response });
      }

      // there is some runtime.lastError -> attempt injection path
      const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ? String(chrome.runtime.lastError.message) : 'unknown';
      console.warn('background: initial sendMessage error:', errMsg);

      // get tab info before trying to inject
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return resolve({ ok: false, error: 'invalid-tab', detail: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no-tab' });
        }

        if (!tab.url || !isWebUrl(tab.url)) {
          return resolve({ ok: false, error: 'unsupported-page', detail: tab.url || '' });
        }

        // If tab is discarded or in a state that won't accept scripts, bail
        if (tab.discarded) {
          return resolve({ ok: false, error: 'tab-discarded', detail: tab.url });
        }

        const jsFile = 'src/contentScript.js';
        const cssFile = 'src/inject.css';

        // Attempt to inject the content script (manifest declared). Wrap in try/catch and guard callbacks.
        try {
          chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
            if (chrome.runtime.lastError) {
              const lower = (chrome.runtime.lastError.message || '').toLowerCase();
              console.warn('background: injection failed:', chrome.runtime.lastError.message);

              // common reasons: host permission required
              if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                const permissionPattern = buildOriginPermissionPattern(tab.url);
                return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
              }

              return resolve({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
            }

            // injection worked -> best-effort insert CSS
            chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, (cssRes) => {
              if (chrome.runtime.lastError) {
                // CSS insertion failing is not fatal; log and continue to try messaging
                console.warn('background: insertCSS failed:', chrome.runtime.lastError.message);
              }

              // Now attempt to message again
              chrome.tabs.sendMessage(tabId, message, (resp2) => {
                if (chrome.runtime.lastError) {
                  const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                  console.warn('background: sendMessage after inject failed:', chrome.runtime.lastError.message);
                  if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                    const permissionPattern = buildOriginPermissionPattern(tab.url);
                    return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern });
                  }
                  return resolve({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message });
                }
                return resolve({ ok: true, response: resp2 });
              });
            });
          });
        } catch (ex) {
          console.warn('background: scripting.executeScript threw', ex);
          return resolve({ ok: false, error: 'executeScript-exception', detail: String(ex) });
        }
      });
    });

    // safety timeout in case sendMessage never invokes callback (should not happen)
    setTimeout(() => {
      resolve({ ok: false, error: 'send-timeout' });
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
      if (chrome.runtime.lastError) console.warn('contextMenus.create error', chrome.runtime.lastError);
    });
  } catch (e) {
    console.warn('contextMenus.create threw', e);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'clarityReadSelection') {
    if (!tab || !tab.id) return;
    const txt = info.selectionText || '';
    // forward to content script (with injection fallback)
    sendMessageToTabWithInjection(tab.id, { action: 'readAloud', _savedText: txt })
      .then(res => { if (!res.ok) console.warn('context read failed', res); })
      .catch(err => console.warn('context read error', err));
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
  } catch (err) {
    console.error('Failed to open popup window:', err);
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
      return;
    }

    if (command === "read-aloud") {
      const result = await sendMessageToTabWithInjection(tab.id, { action: "readAloud" });
      if (!result.ok) console.warn('Could not send readAloud:', result);
    } else if (command === "stop-reading") {
      const result = await sendMessageToTabWithInjection(tab.id, { action: "stopReading" });
      if (!result.ok) console.warn('Could not send stopReading:', result);
    }
  } catch (err) {
    console.error('onCommand error:', err);
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
        safeRuntimeSendMessage({ action: 'statsUpdated' });
      });
    });
  });
}

function resetStats() {
  const zeroed = { totalPagesRead: 0, totalTimeReadSec: 0, sessions: 0, daily: [] };
  chrome.storage.local.set({ stats: zeroed }, () => {
    chrome.storage.sync.set({ stats: zeroed }, () => {
      safeRuntimeSendMessage({ action: 'statsUpdated' });
    });
  });
}

// message handler - forwards UI actions to a sensible web tab
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Always return true so we can send async responses.
  // We'll also guard to ensure we only call sendResponse once.
  let responded = false;
  const respondOnce = (r) => {
    if (responded) return;
    responded = true;
    try { sendResponse(r); } catch (e) { console.warn('sendResponse failed', e); }
  };

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

    // Forwarded UI actions
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
          // 0) If popup provided an explicit target tab id, prefer that (from send helper)
          if (msg && msg._targetTabId) {
            try {
              const targetId = Number(msg._targetTabId);
              if (!Number.isFinite(targetId)) throw new Error('bad-target-id');
              const tabObj = await new Promise((resolve) => chrome.tabs.get(targetId, resolve));
              if (chrome.runtime.lastError) {
                console.warn('background: chrome.tabs.get error for _targetTabId', chrome.runtime.lastError);
                // fall through to discovery
              } else if (tabObj && isWebUrl(tabObj.url || '')) {
                const res = await sendMessageToTabWithInjection(targetId, msg);
                respondOnce(res);
                return;
              } else {
                console.warn('background: _targetTabId provided but tab invalid or unsupported:', msg._targetTabId);
              }
            } catch (e) {
              console.warn('background: failed to use _targetTabId, falling back to discovery:', e);
            }
          }

          // 1) If message came from a tab (content script), use that (fast path)
          if (sender && sender.tab && sender.tab.id && isWebUrl(sender.tab.url || '')) {
            const res = await sendMessageToTabWithInjection(sender.tab.id, msg);
            respondOnce(res);
            return;
          }

          // 2) Try last-focused normal window (preferred)
          const lastWin = await new Promise((resolve) => chrome.windows.getLastFocused({ populate: true }, resolve));
          if (lastWin && Array.isArray(lastWin.tabs)) {
            const candidate = lastWin.tabs.find(t => t && t.active && isWebUrl(t.url));
            if (candidate && candidate.id) {
              const res = await sendMessageToTabWithInjection(candidate.id, msg);
              respondOnce(res);
              return;
            }
          }

          // 3) Current active tab in lastFocusedWindow
          const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (activeTabs && activeTabs[0] && isWebUrl(activeTabs[0].url || '')) {
            const res = await sendMessageToTabWithInjection(activeTabs[0].id, msg);
            respondOnce(res);
            return;
          }

          // 4) Scan all windows for a focused normal window first, then any web tab
          const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
          if (Array.isArray(allWins)) {
            const focusedWin = allWins.find(w => w.focused && Array.isArray(w.tabs));
            if (focusedWin) {
              const tab = (focusedWin.tabs || []).find(t => t && isWebUrl(t.url) && t.active);
              if (tab && tab.id) {
                const res = await sendMessageToTabWithInjection(tab.id, msg);
                respondOnce(res);
                return;
              }
            }
            // fallback: first web tab anywhere
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

          respondOnce({ ok: false, error: 'no-tab' });
        } catch (err) {
          console.error('background forward error:', err);
          respondOnce({ ok: false, error: String(err) });
        }
      })();

      return true;
    }

    default:
      respondOnce({ ok: false, error: 'unknown-action' });
      return true;
  }
});
