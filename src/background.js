// src/background.js
(() => {
  'use strict';

  const HANDSHAKE_KEY = '_handshakeSelection';
  const HANDSHAKE_TTL_MS = 30 * 1000; // 30s 

  const DEBUG = true; // toggle for troubleshooting
  const safeLog = (...args) => { try { if (DEBUG) console.log('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeWarn = (...args) => { try { if (DEBUG) console.warn('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeInfo = (...args) => { try { if (DEBUG) console.info('[ClarityRead bg]', ...args); } catch (e) {} };

  const HOSTED_VIEWER_RE = /(?:^|\.)((docs\.google\.com)|(drive\.google\.com)|(googleusercontent\.com)|(office\.com)|(microsoftonline\.com)|(sharepoint\.com)|(slideshare\.net))/i;

  function safeRuntimeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {});
    } catch (err) {
      safeWarn('safeRuntimeSendMessage threw', err);
    }
  }

  function isWebUrl(u = '') {
    if (!u) return false;
    const s = String(u).toLowerCase();
    return !/^(chrome:\/\/|about:|chrome-extension:\/\/|edge:\/\/|file:\/\/|view-source:|moz-extension:\/\/)/.test(s);
  }

  function buildOriginPermissionPattern(url) {
    try {
      const u = new URL(url);
      if (!u.protocol || !/^https?:$/.test(u.protocol)) return null;
      return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/*`;
    } catch (e) { return null; }
  }

  function requestHostPermissionForUrl(url) {
    return new Promise((resolve) => {
      const originPattern = buildOriginPermissionPattern(url);
      if (!originPattern) {
        safeWarn('requestHostPermissionForUrl called for unsupported URL', url);
        return resolve({ ok: false, error: 'invalid-origin', detail: 'URL is not a web origin (cannot request host permission)' });
      }
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

  function unwrapResponseMaybe(obj) {
    try {
      let r = obj;
      let depth = 0;
      while (r && typeof r === 'object' && ('response' in r) && depth < 6) {
        r = r.response;
        depth++;
      }
      return r;
    } catch (e) { return obj; }
  }

  function isHostedDocumentViewer(url = '') {
    try {
      if (!url) return false;
      return HOSTED_VIEWER_RE.test(String(url));
    } catch (e) { return false; }
  }

  // --- Google Docs API helper (expects src/googleDocsApi.js to export fetchGoogleDocText)
  async function tryHandleGoogleDocsViaApi(tab, message) {
    try {
      if (!tab || !tab.url) return { ok: false, error: 'no-tab' };

      const m = tab.url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
      if (!m || !m[1]) {
        return { ok: false, error: 'no-docid', userFriendlyMessage: 'Could not find a Google Docs document id in the URL.' };
      }
      const docId = m[1];

      try {
        const modUrl = chrome.runtime.getURL('src/googleDocsApi.js');
        const { fetchGoogleDocText } = await import(modUrl);
        const text = await fetchGoogleDocText(docId, { interactiveIfNecessary: false });
        if (!text || text.trim().length === 0) {
          return { ok: false, error: 'empty-doc', userFriendlyMessage: 'Document appears to be empty or inaccessible.' };
        }
        // store handshake and open popup for user controls (read aloud in popup)
        storeHandshakeAndOpenPopup({ text: text.slice(0, 20000), title: tab.title || '', url: tab.url });
        return { ok: true, deliveredToPopup: true };
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (/no-token|401|not-authorized|invalid_grant/i.test(msg)) {
          return { ok: false, error: 'auth-required', userFriendlyMessage: 'Connect your Google account so ClarityRead can read this document.' };
        }
        return { ok: false, error: 'fetch-failed', detail: msg, userFriendlyMessage: 'Failed to fetch document content.' };
      }
    } catch (e) {
      return { ok: false, error: 'unexpected', detail: String(e) };
    }
  }

  function notifyUser(message, tabId) {
    try {
      if (chrome.notifications && typeof chrome.notifications.create === 'function') {
        try {
          chrome.notifications.create('', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon48.png'),
            title: 'ClarityRead',
            message: message
          }, () => {});
          return;
        } catch (e) { safeWarn('notifications.create failed', e); }
      }

      if (typeof tabId !== 'undefined' && tabId !== null && chrome.action && chrome.action.setBadgeText) {
        try {
          chrome.action.setBadgeText({ tabId, text: '!' });
          chrome.action.setTitle({ tabId, title: message });
          setTimeout(() => {
            try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) {}
          }, 5000);
          return;
        } catch (e) { safeWarn('badge fallback failed', e); }
      }

      safeRuntimeSendMessage({ action: 'userNotice', message });
    } catch (e) { safeWarn('notifyUser outer error', e); }
  }

  // helper: promisified chrome.tabs.get
  function getTabInfo(tabId) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError });
          resolve({ tab });
        });
      } catch (e) {
        resolve({ error: e });
      }
    });
  }

  // sendMessageToTabWithInjection (defensive, unchanged in behavior)
  async function sendMessageToTabWithInjection(tabId, message) {
    safeLog('sendMessageToTabWithInjection called', { tabId, action: message && message.action, hintedTarget: message && message._targetTabId });

    if (typeof tabId === 'undefined' || tabId === null) {
      return { ok: false, error: 'invalid-tab-id', userFriendlyMessage: 'No valid tab to target.' };
    }

    let settled = false;
    const finishOnce = (r, finishPromiseResolve) => {
      if (!settled) {
        settled = true;
        finishPromiseResolve(r);
      }
    };

    return await new Promise(async (resolve) => {
      const SAFETY_MS = 10000;
      const to = setTimeout(() => {
        try { finishOnce({ ok: false, error: 'send-timeout', userFriendlyMessage: 'Timed out trying to reach the page.' }, resolve); } catch(e) {}
      }, SAFETY_MS);

      try {
        const gi = await getTabInfo(tabId);
        if (gi.error || !gi.tab) {
          safeWarn('chrome.tabs.get failed for', tabId, gi.error || 'no-tab');
          clearTimeout(to);
          return finishOnce({ ok: false, error: 'invalid-tab', detail: gi.error ? (gi.error.message || String(gi.error)) : 'no-tab', userFriendlyMessage: 'Target tab not found.' }, resolve);
        }
        const tab = gi.tab;

        if (isHostedDocumentViewer(tab.url)) {
          safeInfo('detected hosted document viewer — attempting provider-specific handling', tab.url);

          if (/docs\.google\.com/i.test(tab.url)) {
            try {
              const apiRes = await tryHandleGoogleDocsViaApi(tab, message);
              if (apiRes && apiRes.ok) {
                clearTimeout(to);
                return finishOnce({ ok: true, response: { via: 'google-docs-api', note: 'opened-popup-with-doc' } }, resolve);
              }
              if (apiRes && apiRes.error === 'auth-required') {
                notifyUser(apiRes.userFriendlyMessage || 'Please connect Google to access this document.', tab.id);
                clearTimeout(to);
                return finishOnce({ ok: false, error: 'auth-required', userFriendlyMessage: apiRes.userFriendlyMessage || 'Connect Google' }, resolve);
              }
              notifyUser(apiRes.userFriendlyMessage || 'This appears to be a hosted document viewer that ClarityRead cannot modify.', tab.id);
              clearTimeout(to);
              return finishOnce({ ok: false, error: 'viewer-or-iframe', detail: tab.url, userFriendlyMessage: apiRes.userFriendlyMessage || 'Hosted viewer' }, resolve);
            } catch (e) {
              safeWarn('tryHandleGoogleDocsViaApi failed', e);
              clearTimeout(to);
              return finishOnce({ ok: false, error: 'api-handler-failed', detail: String(e) }, resolve);
            }
          }

          const msg = 'This looks like a hosted document viewer (Office Online / SharePoint). ClarityRead cannot access or modify this page.';
          notifyUser(msg, tab.id);
          clearTimeout(to);
          return finishOnce({ ok: false, error: 'viewer-or-iframe', detail: tab.url, userFriendlyMessage: msg }, resolve);
        }

        safeLog('target tab info', { id: tab.id, url: tab.url, discarded: !!tab.discarded, active: !!tab.active, status: tab.status });

        if (!tab.url || !isWebUrl(tab.url)) {
          safeInfo('tab url unsupported for injection', tab.url);
          clearTimeout(to);
          return finishOnce({ ok: false, error: 'unsupported-page', detail: tab.url || '', userFriendlyMessage: 'This page cannot be modified by the extension.' }, resolve);
        }

        if (tab.discarded) {
          safeInfo('tab is discarded', tabId, tab.url);
          clearTimeout(to);
          return finishOnce({ ok: false, error: 'tab-discarded', detail: tab.url, userFriendlyMessage: 'Tab is discarded/suspended by the browser.' }, resolve);
        }

        try {
          safeLog('attempting direct sendMessage', { tabId, action: message && message.action });
          chrome.tabs.sendMessage(tabId, message, async (response) => {
            if (!chrome.runtime.lastError) {
              safeLog('sendMessage direct succeeded', { tabId, action: message && message.action, response });
              clearTimeout(to);
              const unwrapped = unwrapResponseMaybe(response);
              return finishOnce({ ok: true, response: unwrapped, cssError: null }, resolve);
            }

            const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ? String(chrome.runtime.lastError.message) : 'unknown';
            if (/receiving end does not exist/i.test(errMsg) || /could not establish connection/i.test(errMsg)) {
              safeLog('initial sendMessage: no receiver (will attempt injection).', errMsg);
            } else {
              safeWarn('initial sendMessage error', errMsg);
            }

            const jsFiles = ['src/toast.js', 'src/contentScript.js'];
            const cssFiles = ['src/inject.css', 'src/toast.css'];

            let cssErrorMsg = null;
            const permissionPattern = buildOriginPermissionPattern(tab.url);

            if (!permissionPattern) {
              safeLog('no origin permission pattern (best-effort injection)', tab.url);
              try {
                chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: jsFiles }, (injectionResults) => {
                  if (chrome.runtime.lastError) {
                    safeWarn('scripting.executeScript failed (no-origin-pattern)', chrome.runtime.lastError.message);
                    if (tab.url && /sharepoint\.com|office\.com|microsoftonline\.com|docs\.google\.com/.test(tab.url)) {
                      clearTimeout(to);
                      return finishOnce({ ok: false, error: 'viewer-or-iframe', detail: 'Page may be a hosted document viewer or cross-origin iframe', userFriendlyMessage: 'This looks like a hosted document viewer (e.g. SharePoint/Office/Docs) — ClarityRead cannot access it.' }, resolve);
                    }
                    clearTimeout(to);
                    return finishOnce({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject the content script.' }, resolve);
                  }
                  chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: cssFiles }, (cssRes) => {
                    cssErrorMsg = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || chrome.runtime.lastError) : null;
                    chrome.tabs.sendMessage(tabId, message, (resp2) => {
                      if (chrome.runtime.lastError) {
                        const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                        safeWarn('sendMessage after inject failed (no-origin-pattern)', chrome.runtime.lastError.message);
                        if (msg2.includes('receiving end does not exist') || msg2.includes('no receiver')) {
                          clearTimeout(to);
                          return finishOnce({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, cssError: cssErrorMsg, userFriendlyMessage: 'Content script did not respond after injection.' }, resolve);
                        }
                        clearTimeout(to);
                        return finishOnce({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' }, resolve);
                      }
                      const unwrapped2 = unwrapResponseMaybe(resp2);
                      clearTimeout(to);
                      return finishOnce({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null }, resolve);
                    });
                  });
                });
              } catch (ex) {
                safeWarn('best-effort executeScript threw', ex);
                clearTimeout(to);
                return finishOnce({ ok: false, error: 'executeScript-exception', detail: String(ex), userFriendlyMessage: 'Unexpected error attempting to inject content script.' }, resolve);
              }
              return;
            }

            try {
              chrome.permissions.contains({ origins: [permissionPattern] }, (has) => {
                try {
                  if (chrome.runtime.lastError) {
                    safeWarn('chrome.permissions.contains error', chrome.runtime.lastError);
                  } else if (!has) {
                    safeInfo('missing host permission for origin', permissionPattern);
                    try { notifyUser('ClarityRead needs permission to access this site. Click Allow to grant host permission.', tabId); } catch(e){}
                    clearTimeout(to);
                    return finishOnce({
                      ok: false,
                      error: 'no-host-permission',
                      detail: 'host-permission-missing',
                      permissionPattern,
                      userFriendlyMessage: 'This site needs permission to let ClarityRead access the page. Click Allow to grant access.'
                    }, resolve);
                  }

                  try {
                    safeLog('attempting scripting.executeScript', { tabId, jsFiles });
                    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: jsFiles }, (injectionResults) => {
                      if (chrome.runtime.lastError) {
                        const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                        if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                          clearTimeout(to);
                          return finishOnce({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' }, resolve);
                        }
                        if (tab.url && /sharepoint\.com|office\.com|microsoftonline\.com|docs\.google\.com/.test(tab.url)) {
                          clearTimeout(to);
                          return finishOnce({ ok: false, error: 'viewer-or-iframe', detail: 'Page may be a hosted document viewer or cross-origin iframe', permissionPattern, userFriendlyMessage: 'This looks like a hosted document viewer (unsupported).' }, resolve);
                        }
                        clearTimeout(to);
                        return finishOnce({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject content script.' }, resolve);
                      }

                      chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: cssFiles }, (cssRes) => {
                        const cssErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || chrome.runtime.lastError) : null;
                        chrome.tabs.sendMessage(tabId, message, (resp2) => {
                          if (chrome.runtime.lastError) {
                            const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                            if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                              clearTimeout(to);
                              return finishOnce({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' }, resolve);
                            }
                            if (msg2.includes('receiving end does not exist') || msg2.includes('no receiver')) {
                              clearTimeout(to);
                              return finishOnce({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, cssError: cssErr, userFriendlyMessage: 'Content script did not respond after injection.' }, resolve);
                            }
                            clearTimeout(to);
                            return finishOnce({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' }, resolve);
                          }
                          const unwrapped2 = unwrapResponseMaybe(resp2);
                          clearTimeout(to);
                          return finishOnce({ ok: true, response: unwrapped2, cssError: cssErr || null }, resolve);
                        });
                      });
                    });
                  } catch (ex) {
                    safeWarn('scripting.executeScript threw', ex);
                    clearTimeout(to);
                    return finishOnce({ ok: false, error: 'executeScript-exception', detail: String(ex), userFriendlyMessage: 'Unexpected error trying to inject script.' }, resolve);
                  }
                } catch (outerExecCheckErr) {
                  safeWarn('permission.contains callback outer error', outerExecCheckErr);
                  clearTimeout(to);
                  return finishOnce({ ok: false, error: 'permission-check-error', detail: String(outerExecCheckErr), userFriendlyMessage: 'Error while checking permissions.' }, resolve);
                }
              });
            } catch (pcEx) {
              safeWarn('permission.contains threw', pcEx);
              try {
                safeLog('attempting scripting.executeScript (permission.contains threw)', { tabId, jsFiles });
                chrome.scripting.executeScript({ target: { tabId }, files: jsFiles }, (injectionResults) => {
                  if (chrome.runtime.lastError) {
                    safeWarn('scripting.executeScript failed (after permission.contains threw)', chrome.runtime.lastError.message);
                    const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                    if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                      clearTimeout(to);
                      return finishOnce({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' }, resolve);
                    }
                    clearTimeout(to);
                    return finishOnce({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject content script.' }, resolve);
                  }
                  chrome.scripting.insertCSS({ target: { tabId }, files: cssFiles }, (cssRes) => {
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
                          clearTimeout(to);
                          return finishOnce({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' }, resolve);
                        }
                        clearTimeout(to);
                        return finishOnce({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' }, resolve);
                      }
                      const unwrapped2 = unwrapResponseMaybe(resp2);
                      clearTimeout(to);
                      return finishOnce({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null }, resolve);
                    });
                  });
                });
              } catch (finalEx) {
                safeWarn('executeScript second attempt threw', finalEx);
                clearTimeout(to);
                return finishOnce({ ok: false, error: 'executeScript-exception', detail: String(finalEx), userFriendlyMessage: 'Unexpected injection error.' }, resolve);
              }
            }
          });
        } catch (err) {
          safeWarn('sendMessage direct path outer catch', err);
          clearTimeout(to);
          return finishOnce({ ok: false, error: 'send-exception', detail: String(err), userFriendlyMessage: 'Unexpected error attempting to send message to tab.' }, resolve);
        }
      } catch (err) {
        safeWarn('sendMessageToTabWithInjection outer catch', err);
        clearTimeout(to);
        return finishOnce({ ok: false, error: 'send-exception', detail: String(err), userFriendlyMessage: 'Unexpected error attempting to send message to tab.' }, resolve);
      }
    });
  }

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

        // Try a couple of common popup paths to avoid mismatch:
        const popupCandidates = [
          chrome.runtime.getURL('src/popup.html'),
          chrome.runtime.getURL('popup.html')
        ];

        (async () => {
          try {
            for (const candidate of popupCandidates) {
              try {
                const found = await new Promise(resolve => {
                  chrome.tabs.query({ url: candidate }, (tabs) => {
                    if (chrome.runtime.lastError) return resolve(null);
                    resolve(tabs && tabs.length > 0 ? tabs[0] : null);
                  });
                });

                if (found) {
                  try {
                    chrome.windows.update(found.windowId, { focused: true }, () => {
                      chrome.tabs.update(found.id, { active: true }, () => {
                        safeLog('focused existing popup tab', found.id, candidate);
                      });
                    });
                    return;
                  } catch (e) {
                    safeWarn('failed to focus existing popup (candidate)', candidate, e);
                    // if that failed, try to open new window below
                  }
                }
              } catch (e) {
                safeWarn('popup candidate query failed', candidate, e);
              }
            }

            // none found — open the first candidate that exists in extension (use src/popup.html by default)
            // Choose candidate order but open with whichever file your project has. If your popup is at src/popup.html keep that file there.
            const openUrl = popupCandidates[0];
            chrome.windows.create({ url: openUrl, type: 'popup', width: 800, height: 600 }, () => {
              safeLog('opened new popup window for handshake', openUrl);
            });
          } catch (e) {
            safeWarn('error in popup open flow', e);
            // fallback to a simple attempt at root popup
            try {
              chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 800, height: 600 }, () => {
                safeLog('fallback popup open attempted');
              });
            } catch (e2) {
              safeWarn('fallback popup open failed', e2);
            }
          }
        })();
      });
    } catch (e) {
      safeWarn('storeHandshakeAndOpenPopup failed', e);
    }
  }

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

  chrome.commands.onCommand.addListener(async (command) => {
    try {
      // try active tab first
      const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
      let tab = tabs && tabs[0];

      // If active tab is a web page, target it
      if (tab && isWebUrl(tab.url || '')) {
        // If tab is a hosted viewer, show user-friendly notification and don't try to inject
        if (isHostedDocumentViewer(tab.url)) {
          notifyUser('This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.', tab.id);
          safeLog('command blocked on hosted viewer', { command, url: tab.url });
          return;
        }

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
        // If found tab is hosted viewer -> notify and skip
        if (isHostedDocumentViewer(foundWebTab.url)) {
          notifyUser('This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.', foundWebTab.id);
          safeLog('command blocked on hosted viewer (foundWebTab)', { command, url: foundWebTab.url });
          return;
        }

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
            // in src/background.js - inside your onMessage switch

// add inside your onMessage switch
case 'requestGoogleAuth': {
  safeLog('background: requestGoogleAuth received');
  try {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        safeWarn('background: getAuthToken error', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: 'getAuthToken_error', detail: chrome.runtime.lastError.message });
        return;
      }
      if (!token) {
        safeWarn('background: getAuthToken returned no token');
        sendResponse({ ok: false, error: 'no-token' });
        return;
      }
      safeLog('background: got token (len)', token.length);
      sendResponse({ ok: true, token });
    });
  } catch (e) {
    safeWarn('background: requestGoogleAuth threw', e);
    sendResponse({ ok: false, error: String(e) });
  }
  return true; // IMPORTANT: keep message channel open
}


case 'getCachedToken': {
  // silent (non-interactive) token check
  try {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message || 'no-token' });
        return;
      }
      sendResponse({ ok: true, token: token || null });
    });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
  return true;
}

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

        case 'readAloud':
        case 'toggleFocusMode':
        case 'stopReading':
        case 'pauseReading':
        case 'resumeReading':
        case 'applySettings':
        case 'speedRead':
        case 'detectLanguage':
        case 'getSelection':
        case 'requestGoogleAuth':
        case 'getCachedToken':
        case 'clarity_apply_font_size':
        case 'clarity_extract_main':
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
                      // hosted viewer early-check: return friendly error + notify user
                      if (isHostedDocumentViewer(tabObj.url)) {
                        const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                        notifyUser(msgTxt, targetId);
                        respondOnce({ ok: false, error: 'viewer-or-iframe', detail: tabObj.url, userFriendlyMessage: msgTxt });
                        return;
                      }
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
                // hosted viewer check for direct content-script sender (defensive)
                if (isHostedDocumentViewer(sender.tab.url)) {
                  const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                  notifyUser(msgTxt, sender.tab.id);
                  respondOnce({ ok: false, error: 'viewer-or-iframe', detail: sender.tab.url, userFriendlyMessage: msgTxt });
                  return;
                }

                safeLog('using sender.tab as target', { id: sender.tab.id, url: sender.tab.url });
                const res = await sendMessageToTabWithInjection(sender.tab.id, msg);
                respondOnce(res);
                return;
              }

              // Prefer a focused normal window's active web tab, then other discovery strategies
              const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
              if (Array.isArray(allWins)) {
                const focusedNormalWin = allWins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
                if (focusedNormalWin) {
                  const tab = (focusedNormalWin.tabs || []).find(t => t && t.active && isWebUrl(t.url));
                  if (tab && tab.id) {
                    // hosted viewer check
                    if (isHostedDocumentViewer(tab.url)) {
                      const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                      notifyUser(msgTxt, tab.id);
                      respondOnce({ ok: false, error: 'viewer-or-iframe', detail: tab.url, userFriendlyMessage: msgTxt });
                      return;
                    }
                    safeLog('using focused normal window active tab', { id: tab.id, url: tab.url });
                    const res = await sendMessageToTabWithInjection(tab.id, msg);
                    respondOnce(res);
                    return;
                  }
                }

                for (const w of allWins) {
                  if (w && w.type === 'normal' && Array.isArray(w.tabs)) {
                    const t = (w.tabs || []).find(tt => tt && tt.active && isWebUrl(tt.url));
                    if (t && t.id) {
                      if (isHostedDocumentViewer(t.url)) {
                        const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                        notifyUser(msgTxt, t.id);
                        respondOnce({ ok: false, error: 'viewer-or-iframe', detail: t.url, userFriendlyMessage: msgTxt });
                        return;
                      }
                      safeLog('using any normal window active tab', { id: t.id, url: t.url });
                      const res = await sendMessageToTabWithInjection(t.id, msg);
                      respondOnce(res);
                      return;
                    }
                  }
                }

                for (const w of allWins) {
                  for (const t of (w.tabs || [])) {
                    if (t && isWebUrl(t.url)) {
                      if (isHostedDocumentViewer(t.url)) {
                        const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                        notifyUser(msgTxt, t.id);
                        respondOnce({ ok: false, error: 'viewer-or-iframe', detail: t.url, userFriendlyMessage: msgTxt });
                        return;
                      }
                      safeLog('using first available web tab fallback', { id: t.id, url: t.url });
                      const res = await sendMessageToTabWithInjection(t.id, msg);
                      respondOnce(res);
                      return;
                    }
                  }
                }
              }

              const activeTabs = await new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
              if (activeTabs && activeTabs[0] && isWebUrl(activeTabs[0].url || '')) {
                if (isHostedDocumentViewer(activeTabs[0].url)) {
                  const msgTxt = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.';
                  notifyUser(msgTxt, activeTabs[0].id);
                  respondOnce({ ok: false, error: 'viewer-or-iframe', detail: activeTabs[0].url, userFriendlyMessage: msgTxt });
                  return;
                }
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
