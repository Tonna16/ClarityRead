(function(global){
  if (global.__clarityread_safeMessage) return;
  global.__clarityread_safeMessage = true;

  function sendToBackground(msg, cb = ()=>{}) {
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      // if there is a lastError because no receiver is present, swallow it and return null+null
      if (chrome.runtime.lastError) {
        const m = String(chrome.runtime.lastError.message || '').toLowerCase();
        if (m.includes('receiving end does not exist') || m.includes('could not establish connection') || m.includes('no receiver')) {
          // benign: no runtime receiver (e.g. popup/service worker not open) -> return null, no error
          return cb(null, null);
        }
        return cb(null, chrome.runtime.lastError);
      }
      cb(resp, null);
    });
  } catch (e) {
    cb(null, e);
  }
}


  function sendToTab(tabId, msg, cb = ()=>{}) {
  try {
    if (!tabId) return cb(null, new Error('no-tab-id'));

    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (!chrome.runtime.lastError) {
        return cb(resp, null);
      }

      // if there's a lastError, inspect message. If it's "receiving end does not exist" try a one-time inject+retry.
      const errMsg = String(chrome.runtime.lastError && chrome.runtime.lastError.message || '').toLowerCase();
      // swallow and attempt recover only for "no receiver" style errors
      const noReceiver = errMsg.includes('receiving end does not exist') || errMsg.includes('no receiver') || errMsg.includes('could not establish connection');

      if (!noReceiver) {
        // other errors (permission, tab closed, etc.) -> return the error
        return cb(null, chrome.runtime.lastError);
      }

      // Try injecting the content script and re-send (best-effort). Use same file path you inject elsewhere.
      const jsFile = 'src/contentScript.js';
      try {
        chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [jsFile] }, (injectionResults) => {
          if (chrome.runtime.lastError) {
            // injection failed (could be viewer / permission issue) -> return original lastError for caller to handle
            safeLog('scripting.executeScript injection failed in sendToTab', chrome.runtime.lastError);
            return cb(null, chrome.runtime.lastError);
          }

          // after injected, attempt sendMessage again once
          try {
            chrome.tabs.sendMessage(tabId, msg, (resp2) => {
              if (chrome.runtime.lastError) {
                safeLog('sendMessage after injection still failed', chrome.runtime.lastError);
                return cb(null, chrome.runtime.lastError);
              }
              cb(resp2, null);
            });
          } catch (e2) {
            safeLog('sendMessage after injection threw', e2);
            cb(null, e2);
          }
        });
      } catch (ex) {
        safeLog('scripting.executeScript threw in sendToTab', ex);
        cb(null, ex);
      }
    });
  } catch (e) { cb(null, e); }
}

  global.ClaritySafeMessage = { sendToBackground, sendToTab };
})(window);
