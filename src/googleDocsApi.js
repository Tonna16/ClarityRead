
export async function fetchGoogleDocText(docId, opts = {}) {
  const { interactiveIfNecessary = false } = opts || {};

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            return resolve(null); // caller interprets null
          }
          resolve(token || null);
        });
      } catch (e) {
        return reject(e);
      }
    });
  }

  async function removeCachedToken(token) {
    return new Promise((resolve) => {
      try {
        if (!token) return resolve();
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      } catch (e) { resolve(); }
    });
  }

  // get token silently first
  let token = await getToken(false);
  if (!token && interactiveIfNecessary) {
    token = await getToken(true);
  }

  if (!token) {
    if (!interactiveIfNecessary) {
      const err = new Error('no-token');
      err.code = 'NO_TOKEN';
      err.userAction = 'CONNECT_GOOGLE';
      err.message = 'Google account not connected.';
      throw err;
    }
  
    // last chance interactive auth
    token = await getToken(true);
    if (!token) {
      const err = new Error('auth-cancelled');
      err.code = 'AUTH_CANCELLED';
      err.message = 'Google authorization was cancelled.';
      throw err;
    }
  }
  

  // call the Docs API
  try {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (res.status === 401 || res.status === 403) {
      await removeCachedToken(token);
      const err = new Error('not-authorized');
      err.code = 'INSUFFICIENT_SCOPE';
      err.message = 'Google permission missing or expired.';
      err.userAction = 'RECONNECT_GOOGLE';
      throw err;
    }
    

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error('fetch-failed');
      err.message = `Docs API error ${res.status}: ${txt}`;
      throw err;
    }

    const doc = await res.json();

    // now extract textual content by walking document.body.content
    function extractTextFromStructuralElements(elements) {
      if (!Array.isArray(elements)) return '';
      let out = '';
      for (const el of elements) {
        if (el.paragraph && Array.isArray(el.paragraph.elements)) {
          for (const pEl of el.paragraph.elements) {
            if (pEl.textRun && typeof pEl.textRun.content === 'string') {
              out += pEl.textRun.content;
            } else if (pEl.inlineObjectElement) {
              // skip images/objects
            } else if (pEl.autoText) {
              out += (pEl.autoText && pEl.autoText.content) ? pEl.autoText.content : '';
            }
          }
          out += '\n';
        } else if (el.table && Array.isArray(el.table.tableRows)) {
          for (const row of el.table.tableRows) {
            for (const cell of row.tableCells) {
              out += extractTextFromStructuralElements(cell.content) + '\t';
            }
            out += '\n';
          }
        } else if (el.sectionBreak) {
          out += '\n';
        } else if (el.inlineObjectElement) {
          // ignore
        } else if (el.textRun && typeof el.textRun.content === 'string') {
          out += el.textRun.content;
        }
      }
      return out;
    }

    const body = (doc && doc.body && doc.body.content) ? doc.body.content : [];
    const text = extractTextFromStructuralElements(body || []);
    // Trim and normalize multiple newlines
    const normalized = (text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return normalized;
  } catch (e) {
    // bubble up the error
    throw e;
  }
}
