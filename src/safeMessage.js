(function(global){
  if (global.__clarityread_safeMessage) return;
  global.__clarityread_safeMessage = true;

  function sendToBackground(msg, cb = ()=>{}) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          return cb(null, chrome.runtime.lastError);
        }
        cb(resp, null);
      });
    } catch (e) {
      // fallback
      cb(null, e);
    }
  }

  function sendToTab(tabId, msg, cb = ()=>{}) {
    try {
      if (!tabId) return cb(null, new Error('no-tab-id'));
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) {
          return cb(null, chrome.runtime.lastError);
        }
        cb(resp, null);
      });
    } catch (e) { cb(null, e); }
  }

  global.ClaritySafeMessage = { sendToBackground, sendToTab };
})(window);
