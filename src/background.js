(() => {
  'use strict';

  const HANDSHAKE_KEY = '_handshakeSelection';
  const HANDSHAKE_TTL_MS = 30 * 1000; // 30s 

  const DEBUG = false; // set true for debugging, false for release
  const safeLog = (...args) => { try { if (DEBUG) console.log('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeWarn = (...args) => { try { if (DEBUG) console.warn('[ClarityRead bg]', ...args); } catch (e) {} };
  const safeInfo = (...args) => { try { if (DEBUG) console.info('[ClarityRead bg]', ...args); } catch (e) {} };

  const HOSTED_VIEWER_RE = /(?:^|\.)((docs\.google\.com)|(drive\.google\.com)|(googleusercontent\.com)|(office\.com)|(microsoftonline\.com)|(sharepoint\.com)|(slideshare\.net))/i;

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
      // ignore unsupported protocols
      if (!u.protocol || !/^https?:$/.test(u.protocol)) return null;
      // pattern like "https://example.com/*" or "http://host:port/*"
      return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/*`;
    } catch (e) {
      // invalid URL (data:, about:, extension-internal, etc.) -> no valid origin pattern
      return null;
    }
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

  function isHostedDocumentViewer(url = '') {
    try {
      if (!url) return false;
      return HOSTED_VIEWER_RE.test(String(url));
    } catch (e) { return false; }
  }

  // Insert near top of background.js (after isHostedDocumentViewer)
// dynamic import style if using modules, otherwise use inline code or adjust bundling.

async function tryHandleGoogleDocsViaApi(tab, message) {
  try {
    if (!tab || !tab.url) return { ok: false, error: 'no-tab' };

    // extract docId from docs.google.com URLs like /document/d/<id>/...
    const m = tab.url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (!m || !m[1]) {
      return { ok: false, error: 'no-docid', userFriendlyMessage: 'Could not find a Google Docs document id in the URL.' };
    }
    const docId = m[1];

    // dynamic import to avoid loading auth code unless needed
    const { fetchGoogleDocText } = await import(chrome.runtime.getURL('src/googleDocsApi.js'));
    // try to fetch text; ask for interactive auth if needed (makes the popup/open flow smoother)
    try {
      const text = await fetchGoogleDocText(docId, { interactiveIfNecessary: false });
      if (!text || text.trim().length === 0) {
        return { ok: false, error: 'empty-doc', userFriendlyMessage: 'Document appears to be empty or inaccessible.' };
      }
      // store handshake and open popup for user controls (read aloud in popup)
      storeHandshakeAndOpenPopup({ text: text.slice(0, 20000), title: tab.title || '', url: tab.url });
      return { ok: true, deliveredToPopup: true };
    } catch (err) {
      // If auth required, surface an actionable message
      const msg = (err && err.message) ? err.message : String(err);
      if (/no-token|401|not-authorized|invalid_grant/i.test(msg)) {
        // Ask the user to connect Google (interactive)
        return { ok: false, error: 'auth-required', userFriendlyMessage: 'Connect your Google account so ClarityRead can read this document.' };
      }
      return { ok: false, error: 'fetch-failed', detail: msg, userFriendlyMessage: 'Failed to fetch document content.' };
    }
  } catch (e) {
    return { ok: false, error: 'unexpected', detail: String(e) };
  }
}


  // Try to show a short notification or fall back to badge/title
  function notifyUser(message, tabId) {
    try {
      // Try system notification (requires "notifications" permission in manifest)
      if (chrome.notifications && typeof chrome.notifications.create === 'function') {
        try {
          chrome.notifications.create('', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon48.png'),
            title: 'ClarityRead',
            message: message
          }, () => {});
          return;
        } catch (e) {
          // fall through to badge fallback
          safeWarn('notifications.create failed', e);
        }
      }

      // Fallback: set a small badge + tooltip on the tab (if available)
      if (typeof tabId !== 'undefined' && tabId !== null && chrome.action && chrome.action.setBadgeText) {
        try {
          chrome.action.setBadgeText({ tabId, text: '!' });
          chrome.action.setTitle({ tabId, title: message });
          // clear badge after a short time
          setTimeout(() => {
            try { chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) {}
          }, 5000);
          return;
        } catch (e) { safeWarn('badge fallback failed', e); }
      }

      // As a last resort, send runtime message so a popup or options page (if open) can show it
      safeRuntimeSendMessage({ action: 'userNotice', message });
    } catch (e) {
      safeWarn('notifyUser outer error', e);
    }
  }

  // Resolves with structured result { ok: boolean, response?, error?, detail?, permissionPattern?, cssError?, userFriendlyMessage? }
  async function sendMessageToTabWithInjection(tabId, message) {
    safeLog('sendMessageToTabWithInjection called', { tabId, action: message && message.action, hintedTarget: message && message._targetTabId });
    return new Promise((resolve) => {
      if (typeof tabId === 'undefined' || tabId === null) {
        return resolve({ ok: false, error: 'invalid-tab-id', userFriendlyMessage: 'No valid tab to target.' });
      }

      let settled = false;
      let finish = (r) => { if (!settled) { settled = true; resolve(r); } };

      try {
        // FIRST: fetch tab info and pre-check hosted viewers / unsupported pages.
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            safeWarn('chrome.tabs.get failed for', tabId, chrome.runtime.lastError);
            return finish({ ok: false, error: 'invalid-tab', detail: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no-tab', userFriendlyMessage: 'Target tab not found.' });
          }

          // If this is a hosted document viewer (Google Docs / Office Online / sharepoint), abort early
          if (isHostedDocumentViewer(tab.url)) {
            const msg = 'This looks like a hosted document viewer (Google Docs / Office Online). ClarityRead cannot access or modify this page.';
            safeInfo('detected hosted document viewer — aborting injection', tab.url);
            // show immediate feedback to the user (notification/badge)
            try { notifyUser(msg, tabId); } catch (e) {}
            return finish({
              ok: false,
              error: 'viewer-or-iframe',
              detail: tab.url,
              userFriendlyMessage: msg
            });
          }

          // Check general page viability
          safeLog('target tab info', { id: tab.id, url: tab.url, discarded: !!tab.discarded, active: !!tab.active, status: tab.status });

          if (!tab.url || !isWebUrl(tab.url)) {
            safeInfo('tab url unsupported for injection', tab.url);
            return finish({
              ok: false,
              error: 'unsupported-page',
              detail: tab.url || '',
              userFriendlyMessage: 'This page cannot be modified by the extension.'
            });
          }

          if (tab.discarded) {
            safeInfo('tab is discarded', tabId, tab.url);
            return finish({ ok: false, error: 'tab-discarded', detail: tab.url, userFriendlyMessage: 'Tab is discarded/suspended by the browser.' });
          }

          // Now attempt direct sendMessage first (fast path) — if no receiver we'll fall back to injection flows.
          try {
            safeLog('attempting direct sendMessage', { tabId, action: message && message.action });
            chrome.tabs.sendMessage(tabId, message, (response) => {
              if (!chrome.runtime.lastError) {
                safeLog('sendMessage direct succeeded', { tabId, action: message && message.action, response });
                const unwrapped = unwrapResponseMaybe(response);
                return finish({ ok: true, response: unwrapped, cssError: null });
              }

              // There was an error in direct sendMessage -> plan injection / permission checks
              const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ? String(chrome.runtime.lastError.message) : 'unknown';
              if (/receiving end does not exist/i.test(errMsg) || /could not establish connection/i.test(errMsg)) {
                safeLog('initial sendMessage: no receiver (will attempt injection).', errMsg);
              } else {
                safeWarn('initial sendMessage error', errMsg);
              }

              // Inject toast helper + contentScript now (best-effort)
              // Inject toast helper first so pages have a small UX helper available for friendly messages
              const jsFiles = ['src/toast.js', 'src/contentScript.js'];
              const cssFiles = ['src/inject.css', 'src/toast.css'];

              let cssErrorMsg = null;
              const permissionPattern = buildOriginPermissionPattern(tab.url);

              // If no permission pattern, attempt best-effort injection (no host permission)
              if (!permissionPattern) {
                safeLog('no origin permission pattern (best-effort injection)', tab.url);
                try {
                  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: jsFiles }, (injectionResults) => {
                    if (chrome.runtime.lastError) {
                      safeWarn('scripting.executeScript failed (no-origin-pattern)', chrome.runtime.lastError.message);
                      if (tab.url && /sharepoint\.com|office\.com|microsoftonline\.com|docs\.google\.com/.test(tab.url)) {
                        return finish({ ok: false, error: 'viewer-or-iframe', detail: 'Page may be a hosted document viewer or cross-origin iframe', userFriendlyMessage: 'This looks like a hosted document viewer (e.g. SharePoint/Office/Docs) — ClarityRead cannot access it.' });
                      }
                      return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject the content script.' });
                    }
                    chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: cssFiles }, (cssRes) => {
                      cssErrorMsg = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || chrome.runtime.lastError) : null;
                      chrome.tabs.sendMessage(tabId, message, (resp2) => {
                        if (chrome.runtime.lastError) {
                          const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                          safeWarn('sendMessage after inject failed (no-origin-pattern)', chrome.runtime.lastError.message);
                          if (msg2.includes('receiving end does not exist') || msg2.includes('no receiver')) {
                            return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, cssError: cssErrorMsg, userFriendlyMessage: 'Content script did not respond after injection.' });
                          }
                          return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' });
                        }
                        const unwrapped2 = unwrapResponseMaybe(resp2);
                        return finish({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null });
                      });
                    });
                  });
                } catch (ex) {
                  safeWarn('best-effort executeScript threw', ex);
                  return finish({ ok: false, error: 'executeScript-exception', detail: String(ex), userFriendlyMessage: 'Unexpected error attempting to inject content script.' });
                }
                return;
              }

              // If we have permissionPattern -> check permissions
              try {
                chrome.permissions.contains({ origins: [permissionPattern] }, (has) => {
                  try {
                    if (chrome.runtime.lastError) {
                      safeWarn('chrome.permissions.contains error', chrome.runtime.lastError);
                      // fall through to best-effort injection below
                    } else if (!has) {
                      safeInfo('missing host permission for origin', permissionPattern);
                      // notify user how to fix
                      try { notifyUser('ClarityRead needs permission to access this site. Click Allow to grant host permission.', tabId); } catch(e){}
                      return finish({
                        ok: false,
                        error: 'no-host-permission',
                        detail: 'host-permission-missing',
                        permissionPattern,
                        userFriendlyMessage: 'This site needs permission to let ClarityRead access the page. Click Allow to grant access.'
                      });
                    }

                    // attempt scripted injection
                    try {
                      safeLog('attempting scripting.executeScript', { tabId, jsFiles });
                      chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: jsFiles }, (injectionResults) => {
                        if (chrome.runtime.lastError) {
                          const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                          if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                            return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' });
                          }
                          if (tab.url && /sharepoint\.com|office\.com|microsoftonline\.com|docs\.google\.com/.test(tab.url)) {
                            return finish({ ok: false, error: 'viewer-or-iframe', detail: 'Page may be a hosted document viewer or cross-origin iframe', permissionPattern, userFriendlyMessage: 'This looks like a hosted document viewer (unsupported).' });
                          }
                          return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject content script.' });
                        }

                        chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: cssFiles }, (cssRes) => {
                          const cssErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || chrome.runtime.lastError) : null;
                          // Now attempt the message to the top-level content script; it should route as needed
                          chrome.tabs.sendMessage(tabId, message, (resp2) => {
                            if (chrome.runtime.lastError) {
                              const msg2 = (chrome.runtime.lastError.message || '').toLowerCase();
                              if (msg2.includes('must request permission') || msg2.includes('cannot access contents of the page') || msg2.includes('has no access to')) {
                                return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' });
                              }
                              if (msg2.includes('receiving end does not exist') || msg2.includes('no receiver')) {
                                return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, cssError: cssErr, userFriendlyMessage: 'Content script did not respond after injection.' });
                              }
                              return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' });
                            }
                            const unwrapped2 = unwrapResponseMaybe(resp2);
                            return finish({ ok: true, response: unwrapped2, cssError: cssErr || null });
                          });
                        });
                      });
                    } catch (ex) {
                      safeWarn('scripting.executeScript threw', ex);
                      return finish({ ok: false, error: 'executeScript-exception', detail: String(ex), userFriendlyMessage: 'Unexpected error trying to inject script.' });
                    }
                  } catch (outerExecCheckErr) {
                    safeWarn('permission.contains callback outer error', outerExecCheckErr);
                    return finish({ ok: false, error: 'permission-check-error', detail: String(outerExecCheckErr), userFriendlyMessage: 'Error while checking permissions.' });
                  }
                });
              } catch (pcEx) {
                safeWarn('permission.contains threw', pcEx);
                // fallback to best-effort injection path (similar code above)
                try {
                  safeLog('attempting scripting.executeScript (permission.contains threw)', { tabId, jsFiles });
                  chrome.scripting.executeScript({ target: { tabId }, files: jsFiles }, (injectionResults) => {
                    if (chrome.runtime.lastError) {
                      safeWarn('scripting.executeScript failed (after permission.contains threw)', chrome.runtime.lastError.message);
                      const lower = (chrome.runtime.lastError.message || '').toLowerCase();
                      if (lower.includes('must request permission') || lower.includes('cannot access contents of the page') || lower.includes('has no access to')) {
                        return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' });
                      }
                      return finish({ ok: false, error: 'injection-failed', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Failed to inject content script.' });
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
                            return finish({ ok: false, error: 'no-host-permission', detail: chrome.runtime.lastError.message, permissionPattern, userFriendlyMessage: 'Host permission required.' });
                          }
                          return finish({ ok: false, error: 'no-receiver-after-inject', detail: chrome.runtime.lastError.message, userFriendlyMessage: 'Message delivery failed after injection.' });
                        }
                        const unwrapped2 = unwrapResponseMaybe(resp2);
                        return finish({ ok: true, response: unwrapped2, cssError: cssErrorMsg || null });
                      });
                    });
                  });
                } catch (finalEx) {
                  safeWarn('executeScript second attempt threw', finalEx);
                  return finish({ ok: false, error: 'executeScript-exception', detail: String(finalEx), userFriendlyMessage: 'Unexpected injection error.' });
                }
              }
            });
          } catch (err) {
            safeWarn('sendMessage direct path outer catch', err);
            return finish({ ok: false, error: 'send-exception', detail: String(err), userFriendlyMessage: 'Unexpected error attempting to send message to tab.' });
          }
        });
      } catch (err) {
        safeWarn('sendMessageToTabWithInjection outer catch', err);
        finish({ ok: false, error: 'send-exception', detail: String(err), userFriendlyMessage: 'Unexpected error attempting to send message to tab.' });
      }

      // Safety timeout to avoid unresolved promises
      const SAFETY_MS = 10000;
      const to = setTimeout(() => {
        try { finish({ ok: false, error: 'send-timeout', userFriendlyMessage: 'Timed out trying to reach the page.' }); } catch(e) {}
      }, SAFETY_MS);
      const origFinish = finish;
      finish = (r) => {
        try { clearTimeout(to); } catch(e) { /* ignore */ }
        origFinish(r);
      };
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

        const popupUrl = chrome.runtime.getURL('src/popup.html');

        chrome.tabs.query({ url: popupUrl }, (tabs) => {
          if (chrome.runtime.lastError) {
            safeWarn('tabs.query for popup failed', chrome.runtime.lastError);
            chrome.windows.create({ url: popupUrl, type: 'popup', width: 800, height: 600 }, () => {});
            return;
          }

          if (tabs && tabs.length > 0) {
            const t = tabs[0];
            try {
              chrome.windows.update(t.windowId, { focused: true }, () => {
                chrome.tabs.update(t.id, { active: true }, () => {
                  safeLog('focused existing popup tab', t.id);
                });
              });
            } catch (e) {
              safeWarn('failed to focus existing popup', e);
              chrome.windows.create({ url: popupUrl, type: 'popup', width: 800, height: 600 }, () => {});
            }
          } else {
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
