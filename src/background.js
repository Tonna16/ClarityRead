// src/background.js
(() => {
  'use strict';

  const HANDSHAKE_KEY = '_handshakeSelection';
  const HANDSHAKE_TTL_MS = 30 * 1000; // 30s

  // default debug off; can be toggled at runtime via message 'set_debug'
  let DEBUG = false;

  const safeLog = (...args) => { try { if (DEBUG) console.log('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeWarn = (...args) => { try { if (DEBUG) console.warn('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeInfo = (...args) => { try { if (DEBUG) console.info('[ClarityRead bg]', ...args); } catch (e) {} };

  const HOSTED_VIEWER_RE = /(?:^|\.)((docs\.google\.com)|(drive\.google\.com)|(googleusercontent\.com)|(office\.com)|(microsoftonline\.com)|(sharepoint\.com)|(slideshare\.net))/i;

  // init DEBUG from storage if set previously
  try {
    if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
      chrome.storage.local.get(['clarityread_debug'], (res) => {
        try { DEBUG = !!(res && res.clarityread_debug); if (DEBUG) safeLog('debug enabled from storage'); } catch(e) {}
      });
    }
  } catch (e) { /* ignore */ }

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

  // sendMessageToTabWithInjection (defensive)
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
                    // continue to try others / open new
                  }
                }
              } catch (e) {
                safeWarn('popup candidate query failed', candidate, e);
              }
            }

            const openUrl = popupCandidates[0];
            chrome.windows.create({ url: openUrl, type: 'popup', width: 800, height: 600 }, () => {
              safeLog('opened new popup window for handshake', openUrl);
            });
          } catch (e) {
            safeWarn('error in popup open flow', e);
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

  try {
    if (chrome && chrome.contextMenus && typeof chrome.contextMenus.create === 'function') {
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
    }
  } catch (e) { /* ignore */ }

  try {
    if (chrome && chrome.contextMenus && chrome.contextMenus.onClicked) {
      chrome.contextMenus.onClicked.addListener((info, tab) => {
        try {
          if (info.menuItemId === 'clarityReadSelection') {
            const txt = (info.selectionText || '').toString();
            const title = (tab && tab.title) ? tab.title : '';
            const pageUrl = info.pageUrl || (tab && tab.url) || '';
            safeLog('context menu clicked - storing handshake (no direct messaging)', { textLen: txt.length, pageUrl, title });

            storeHandshakeAndOpenPopup({ text: txt, title, url: pageUrl });

            return;
          }
        } catch (e) {
          safeWarn('contextMenus.onClicked handler error', e);
        }
      });
    }
  } catch (e) {}

  // open full popup window behavior (action click)
  if (chrome && chrome.action && chrome.action.onClicked) {
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
  }

  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
      let tab = tabs && tabs[0];

      if (tab && isWebUrl(tab.url || '')) {
        if (isHostedDocumentViewer(tab.url)) {
          notifyUser('This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.', tab.id);
          safeLog('command blocked on hosted viewer', { command, url: tab.url });
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
        return;
      }

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
        if (isHostedDocumentViewer(foundWebTab.url)) {
          notifyUser('This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access this page.', foundWebTab.id);
          safeLog('command blocked on hosted viewer (foundWebTab)', { command, url: foundWebTab.url });
          return;
        }

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
          if (chrome.runtime.lastError) {
            if (tab && tab.id && chrome.action && chrome.action.setBadgeText) {
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
    let responded = false;
    const respondOnce = (r) => {
      if (responded) return;
      responded = true;
      try { sendResponse(r); } catch (e) { safeWarn('sendResponse failed', e); }
    };

    try {
      if (msg && msg.__internal === 'requestHostPermission' && msg.url) {
        requestHostPermissionForUrl(msg.url).then((r) => respondOnce(r)).catch((e) => respondOnce({ ok: false, error: String(e) }));
        return true;
      }

      if (msg && msg.action === 'clarity_overlay_state') {
        try {
          const overlayActive = !!msg.overlayActive;
          safeLog('received clarity_overlay_state', { overlayActive, fromTab: sender && sender.tab && sender.tab.id });
          safeRuntimeSendMessage({ action: 'clarity_overlay_state', overlayActive, tabId: (sender && sender.tab && sender.tab.id) || null });
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

      // allow toggling debug via runtime message
      if (msg && msg.action === 'set_debug') {
        try {
          DEBUG = !!msg.debug;
          try { chrome.storage.local.set({ clarityread_debug: DEBUG }, () => {}); } catch (e) {}
          safeLog('debug set via message ->', DEBUG);
          respondOnce({ ok: true, debug: DEBUG });
        } catch (e) {
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

        // requestGoogleAuth: performs interactive launchWebAuthFlow and responds via respondOnce
        case 'requestGoogleAuth': {
          safeLog('background: requestGoogleAuth received');
          (async () => {
            try {
              const clientId = '506269343424-lg7pjmvv6pltek80uvk4cej1mr5vpd2m.apps.googleusercontent.com';
              const scopes = [
                'https://www.googleapis.com/auth/documents.readonly',
                'openid',
                'profile',
                'email'
              ].join(' ');

              function randomString(len = 64) {
                const arr = new Uint8Array(len);
                crypto.getRandomValues(arr);
                return Array.from(arr).map(b => ('0' + b.toString(16)).slice(-2)).join('').slice(0, len);
              }

              function base64urlEncode(bytes) {
                let s = '';
                for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
                return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
              }

              async function pkceChallengeFromVerifier(verifier) {
                const enc = new TextEncoder().encode(verifier);
                const digest = await crypto.subtle.digest('SHA-256', enc);
                const bytes = new Uint8Array(digest);
                return base64urlEncode(bytes);
              }

              const redirectUri = chrome.identity.getRedirectURL();
              const codeVerifier = randomString(64);
              const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);

              const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
                + '?response_type=code'
                + `&client_id=${encodeURIComponent(clientId)}`
                + `&scope=${encodeURIComponent(scopes)}`
                + `&redirect_uri=${encodeURIComponent(redirectUri)}`
                + `&code_challenge=${encodeURIComponent(codeChallenge)}`
                + `&code_challenge_method=S256`
                + '&access_type=offline'
                + '&prompt=consent';

              chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectResult) => {
                if (chrome.runtime.lastError) {
                  safeWarn('launchWebAuthFlow error', chrome.runtime.lastError.message);
                  return respondOnce({ ok: false, error: 'launchWebAuthFlow_failed', detail: chrome.runtime.lastError.message });
                }
                if (!redirectResult) {
                  return respondOnce({ ok: false, error: 'no-redirect-url' });
                }

                try {
                  const params = (new URL(redirectResult)).searchParams;
                  const code = params.get('code');
                  if (!code) {
                    const err = params.get('error') || 'no_code';
                    safeWarn('Auth redirect missing code', redirectResult);
                    return respondOnce({ ok: false, error: 'no_code', detail: err });
                  }

                  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                      code,
                      client_id: clientId,
                      code_verifier: codeVerifier,
                      redirect_uri: redirectUri,
                      grant_type: 'authorization_code'
                    })
                  });

                  const tokenJson = await tokenRes.json();
                  if (!tokenRes.ok) {
                    safeWarn('token exchange failed', tokenJson);
                    return respondOnce({ ok: false, error: 'token_exchange_failed', detail: tokenJson });
                  }

                  safeLog('token exchange success', {
                    hasAccessToken: !!tokenJson.access_token,
                    hasRefresh: !!tokenJson.refresh_token
                  });

                  return respondOnce({ ok: true, tokenResponse: tokenJson });
                } catch (ex) {
                  safeWarn('requestGoogleAuth exchange error', ex);
                  return respondOnce({ ok: false, error: String(ex) });
                }
              });
            } catch (e) {
              safeWarn('background: requestGoogleAuth threw', e);
              return respondOnce({ ok: false, error: String(e) });
            }
          })();
          return true;
        }

        case 'getCachedToken': {
          try {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
              if (chrome.runtime.lastError) {
                respondOnce({ ok: false, error: chrome.runtime.lastError.message || 'no-token' });
                return;
              }
              respondOnce({ ok: true, token: token || null });
            });
          } catch (e) {
            respondOnce({ ok: false, error: String(e) });
          }
          return true;
        }

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

        // Forward actions that should be routed to a web tab
        case 'readAloud':
        case 'toggleFocusMode':
        case 'stopReading':
        case 'pauseReading':
        case 'resumeReading':
        case 'applySettings':
        case 'speedRead':
        case 'detectLanguage':
        case 'getSelection':
        case 'clarity_apply_font_size':
        case 'clarity_extract_main':
        case 'clarity_query_overlay': {
          (async () => {
            try {
              safeLog('forwarding action', msg.action, { hintedTarget: msg._targetTabId, senderTab: sender && sender.tab && sender.tab.id });

              if (msg && msg._targetTabId) {
                try {
                  const targetId = Number(msg._targetTabId);
                  if (Number.isFinite(targetId)) {
                    const tabObj = await new Promise((resolve) => chrome.tabs.get(targetId, resolve));
                    safeLog('validated hinted target', { targetId, tabObj: tabObj && { id: tabObj.id, url: tabObj.url } });
                    if (!chrome.runtime.lastError && tabObj && isWebUrl(tabObj.url || '')) {
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

              if (sender && sender.tab && sender.tab.id && isWebUrl(sender.tab.url || '')) {
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

              const allWins = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
              if (Array.isArray(allWins)) {
                const focusedNormalWin = allWins.find(w => w.focused && w.type === 'normal' && Array.isArray(w.tabs));
                if (focusedNormalWin) {
                  const tab = (focusedNormalWin.tabs || []).find(t => t && t.active && isWebUrl(t.url));
                  if (tab && tab.id) {
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
// Replace the context menu setup with this safer version:

// Context menu setup - safely handle MV3 service worker
if (chrome?.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    try {
      if (chrome?.contextMenus?.create) {
        chrome.contextMenus.create({
          id: 'clarityReadSelection',
          title: 'Read with ClarityRead',
          contexts: ['selection']
        }, () => {
          if (chrome.runtime.lastError) {
            safeWarn('contextMenus.create error', chrome.runtime.lastError);
          } else {
            safeLog('context menu created');
          }
        });
      }
    } catch (e) {
      safeWarn('contextMenus.create threw', e);
    }
  });
}

// Context menu click handler
if (chrome?.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    try {
      if (info.menuItemId === 'clarityReadSelection') {
        const txt = (info.selectionText || '').toString();
        const title = (tab && tab.title) ? tab.title : '';
        const pageUrl = info.pageUrl || (tab && tab.url) || '';
        safeLog('context menu clicked - storing handshake', { textLen: txt.length, pageUrl, title });

        storeHandshakeAndOpenPopup({ text: txt, title, url: pageUrl });
      }
    } catch (e) {
      safeWarn('contextMenus.onClicked handler error', e);
    }
  });
}


  safeLog('background service ready');
})();
