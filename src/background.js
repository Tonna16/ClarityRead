// MV3 service worker background - robust message delivery + keyboard shortcuts + centralized stats

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

async function sendMessageToTabWithInjection(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!chrome.runtime.lastError) {
        return resolve({ ok: true, response });
      }

      const err = chrome.runtime.lastError?.message;
      console.warn("background: initial sendMessage error:", err);

      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.url) {
          return resolve({ ok: false, error: "invalid-tab" });
        }
        if (/^(chrome:\/\/|about:|chrome-extension:\/\/)/.test(tab.url)) {
          return resolve({ ok: false, error: "unsupported-page" });
        }

        const jsFile = "src/contentScript.js";
        const cssFile = "src/inject.css";

        chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] }, () => {
          if (chrome.runtime.lastError) {
            console.warn("background: script injection failed:", chrome.runtime.lastError.message);
            return resolve({ ok: false, error: "injection-failed", detail: chrome.runtime.lastError.message });
          }

          chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] }, () => {
            chrome.tabs.sendMessage(tabId, message, (resp2) => {
              if (chrome.runtime.lastError) {
                console.warn("background: sendMessage after inject failed:", chrome.runtime.lastError.message);
                return resolve({ ok: false, error: "no-receiver-after-inject", detail: chrome.runtime.lastError.message });
              }
              return resolve({ ok: true, response: resp2 });
            });
          });
        });
      });
    });
  });
}

chrome.action.onClicked.addListener(async () => {
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL("src/popup.html"),
      type: "popup",
      width: 800,
      height: 600
    });
  } catch (err) {
    console.error("Failed to open popup window:", err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;

    if (!tab.url || /^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/)/.test(tab.url)) {
      chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      chrome.action.setTitle({ tabId: tab.id, title: "ClarityRead shortcuts not available here." });
      return;
    }

    if (command === "read-aloud") {
      const result = await sendMessageToTabWithInjection(tab.id, { action: "readAloud" });
      if (!result.ok) console.warn("Could not send readAloud:", result);
    } else if (command === "stop-reading") {
      const result = await sendMessageToTabWithInjection(tab.id, { action: "stopReading" });
      if (!result.ok) console.warn("Could not send stopReading:", result);
    }
  } catch (err) {
    console.error("onCommand error:", err);
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) {
    sendResponse({ ok: false });
    return true;
  }

  switch (msg.action) {
    case 'updateStats':
      persistStatsUpdate(1, Number(msg.duration) || 0);
      sendResponse({ ok: true });
      break;
    case 'updateTimeOnly':
      persistStatsUpdate(0, Number(msg.duration) || 0);
      sendResponse({ ok: true });
      break;
    case 'resetStats':
      resetStats();
      sendResponse({ success: true });
      break;
    case 'readingStopped':
      safeRuntimeSendMessage({ action: 'readingStopped' });
      sendResponse({ ok: true });
      break;
    case 'readingPaused':
      safeRuntimeSendMessage({ action: 'readingPaused' });
      sendResponse({ ok: true });
      break;
    case 'readingResumed':
      safeRuntimeSendMessage({ action: 'readingResumed' });
      sendResponse({ ok: true });
      break;
    default:
      sendResponse({ ok: false });
  }

  return true;
});
