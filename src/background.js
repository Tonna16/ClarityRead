// src/background.js - improved tab selection + injection/fallback handling

// Utility: safe runtime.sendMessage (silently ignores "no receiver" errors)
function safeRuntimeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // ignore
      }
    });
  } catch (err) {
    // service worker might be shutting down; ignore
  }
}

function isWebUrl(u = '') {
  if (!u) return false;
  const s = u.toLowerCase();
  return !/^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/|file:\/\/|view-source:|moz-extension:\/\/)/.test(s);
}

// Try sending a message to a tab; if there's no receiver, try to inject the content script then retry.
async function sendMessageToTabWithInjection(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!chrome.runtime.lastError) {
        return resolve({ ok: true, response });
      }

      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      console.warn('background: initial sendMessage error:', err);

      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.url) {
          return resolve({ ok: false, error: 'invalid-tab' });
        }
        if (!isWebUrl(tab.url)) {
          return resolve({ ok: false, error: 'unsupported-page', detail: tab.url });
        }

        // Try to inject the content script (manifest-declared file).
        const jsFile = 'src/contentScript.js';
        const cssFile = 'src/inject.css';

        chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
          if (chrome.runtime.lastError) {
            console.warn('background: injection failed:', chrome.runtime.lastError.message);
            const msgLow = (chrome.runtime.lastError.message || '').toLowerCase();
            if (msgLow.includes('cannot access contents of the page') || msgLow.includes('must request permission')) {
              return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message });
            }
            return resolve({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
          }

          // best-effort insert CSS then retry messaging
          chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, () => {
            chrome.tabs.sendMessage(tabId, message, (resp2) => {
              if (chrome.runtime.lastError) {
                console.warn('background: sendMessage after inject failed:', chrome.runtime.lastError.message);
                const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                if (msg2.includes('cannot access contents of the page') || msg2.includes('must request permission')) {
                  return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message });
                }
                return resolve({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message });
              }
              return resolve({ ok: true, response: resp2 });
            });
          });
        });
      });
    });
  });
}

// open full popup window behavior
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

// centralized stats
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
  if (!msg || !msg.action) {
    sendResponse({ ok: false });
    return true;
  }

  switch (msg.action) {
    case 'updateStats':
      persistStatsUpdate(1, Number(msg.duration) || 0);
      sendResponse({ ok: true });
      return true;

    case 'updateTimeOnly':
      persistStatsUpdate(0, Number(msg.duration) || 0);
      sendResponse({ ok: true });
      return true;

    case 'resetStats':
      resetStats();
      sendResponse({ success: true });
      return true;

    case 'readingStopped':
      safeRuntimeSendMessage({ action: 'readingStopped' });
      sendResponse({ ok: true });
      return true;

    case 'readingPaused':
      safeRuntimeSendMessage({ action: 'readingPaused' });
      sendResponse({ ok: true });
      return true;

    case 'readingResumed':
      safeRuntimeSendMessage({ action: 'readingResumed' });
      sendResponse({ ok: true });
      return true;

    // Forwarded UI actions
    case 'readAloud':
    case 'stopReading':
    case 'pauseReading':
    case 'resumeReading':
    case 'applySettings':
    case 'speedRead':
    case 'detectLanguage':
    case 'getSelection': {
      (async () => {
        try {
          // --- 0) If popup provided an explicit target tab id, prefer that (from send helper)
          if (msg && msg._targetTabId) {
            try {
              const targetId = Number(msg._targetTabId);
              const tabObj = await new Promise((resolve) => chrome.tabs.get(targetId, resolve));
              if (tabObj && isWebUrl(tabObj.url || '')) {
                const res = await sendMessageToTabWithInjection(targetId, msg);
                sendResponse(res);
                return;
              } else {
                console.warn('background: _targetTabId provided but tab invalid or unsupported:', msg._targetTabId);
              }
            } catch (e) {
              console.warn('background: failed to use _targetTabId, falling back to discovery:', e);
            }
          }

          // 1) If message came from a tab (content script), use that
          if (sender && sender.tab && sender.tab.id && isWebUrl(sender.tab.url || '')) {
            const res = await sendMessageToTabWithInjection(sender.tab.id, msg);
            sendResponse(res);
            return;
          }

          // 2) Try last-focused normal window (preferred)
          const lastWin = await new Promise((resolve) => chrome.windows.getLastFocused({ populate: true }, resolve));
          if (lastWin && Array.isArray(lastWin.tabs)) {
            const candidate = lastWin.tabs.find(t => t && t.active && isWebUrl(t.url));
            if (candidate && candidate.id) {
              const res = await sendMessageToTabWithInjection(candidate.id, msg);
              sendResponse(res);
              return;
            }
          }

          // 3) Current active tab in lastFocusedWindow
          const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (activeTabs && activeTabs[0] && isWebUrl(activeTabs[0].url || '')) {
            const res = await sendMessageToTabWithInjection(activeTabs[0].id, msg);
            sendResponse(res);
            return;
          }

          // 4) Scan all windows for a focused normal window first, then any web tab
          const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
          if (Array.isArray(allWins)) {
            // prefer a focused normal window's active tab
            const focusedWin = allWins.find(w => w.focused && Array.isArray(w.tabs));
            if (focusedWin) {
              const tab = (focusedWin.tabs || []).find(t => t && isWebUrl(t.url) && t.active);
              if (tab && tab.id) {
                const res = await sendMessageToTabWithInjection(tab.id, msg);
                sendResponse(res);
                return;
              }
            }
            // fallback: first web tab anywhere
            for (const w of allWins) {
              for (const t of (w.tabs || [])) {
                if (t && isWebUrl(t.url)) {
                  const res = await sendMessageToTabWithInjection(t.id, msg);
                  sendResponse(res);
                  return;
                }
              }
            }
          }

          sendResponse({ ok: false, error: 'no-tab' });
        } catch (err) {
          console.error('background forward error:', err);
          sendResponse({ ok: false, error: String(err) });
        }
      })();

      return true;
    }

    default:
      sendResponse({ ok: false, error: 'unknown-action' });
      return true;
  }
});
