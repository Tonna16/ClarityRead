// src/background.js
// MV3 service worker background - robust message delivery + keyboard shortcuts + centralized stats

// --- Utility: safe runtime.sendMessage (silently ignores "no receiver" errors)
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

// Helper: try sending a message to the tab; if no receiver, inject content script and retry once
async function sendMessageToTabWithInjection(tabId, message, options = {}) {
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
        const url = tab.url;
        if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('chrome-extension://')) {
          return resolve({ ok: false, error: 'unsupported-page' });
        }

        const jsFile = 'src/contentScript.js';
        const cssFile = 'src/inject.css';

        chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, (injectionResults) => {
          if (chrome.runtime.lastError) {
            console.warn('background: Injection failed:', chrome.runtime.lastError.message);
            // If injection fails because of host permission / inaccessible page, report that
            const msgLow = (chrome.runtime.lastError.message || '').toLowerCase();
            if (msgLow.includes('cannot access contents of the page') || msgLow.includes('must request permission')) {
              return resolve({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message });
            }
            return resolve({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message });
          }

          // Optionally insert CSS (best-effort)
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

// --- Open full popup window (instead of default small popup)
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

// --- Keyboard commands (registered in manifest)
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) return;

    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://")) {
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

// --- Centralized stat updater
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

// --- Message handler (content and popup post here)
// This now forwards UI actions (read/pause/stop/applySettings/etc.) to the active tab's content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) {
    sendResponse({ ok: false });
    return true;
  }

  // Stats-related / background-only actions handled directly
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

    // Actions that should be forwarded to the active tab
    case 'readAloud':
    case 'stopReading':
    case 'pauseReading':
    case 'resumeReading':
    case 'applySettings':
    case 'speedRead':
    case 'detectLanguage':
    case 'getSelection': {
      // Keep the message channel open for async response
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const tab = tabs && tabs[0];
          if (!tab || !tab.id) {
            sendResponse({ ok: false, error: 'no-tab' });
            return;
          }

          // Guard internal pages
          const url = tab.url || '';
          if (/^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/)/.test(url)) {
            sendResponse({ ok: false, error: 'unsupported-page' });
            return;
          }

          const result = await sendMessageToTabWithInjection(tab.id, msg);
          sendResponse(result);
        } catch (err) {
          console.error('background forward error:', err);
          sendResponse({ ok: false, error: String(err) });
        }
      })();

      return true; // async
    }

    default:
      sendResponse({ ok: false, error: 'unknown-action' });
      return true;
  }
});
