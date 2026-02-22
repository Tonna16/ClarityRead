// src/googleDocsApi.js
// Fetch Google Docs content as plain text using chrome.identity tokens.
// Exports: fetchGoogleDocText(docId, { interactiveIfNecessary = false })

import { getGoogleAuthTokenInteractive, removeCachedGoogleAuthToken } from './googleAuth.js';

export async function fetchGoogleDocText(docId, opts = {}) {
  const { interactiveIfNecessary = false } = opts || {};

  // Try to get a token silently first
  let token = null;
  try {
    token = await getGoogleAuthTokenInteractive(false);
  } catch (e) {
    token = null;
  }

  // If we didn't get a token and interactive is allowed, try interactive auth
  if (!token && interactiveIfNecessary) {
    token = await getGoogleAuthTokenInteractive(true);
  }

  if (!token) {
    const err = new Error('no-token');
    err.message = 'No Google auth token available (user not connected).';
    throw err;
  }

  // Call the Docs API
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    }
  );

  if (res.status === 401 || res.status === 403) {
    // token likely invalid — remove cached token so future interactive flow can reauth
    await removeCachedGoogleAuthToken(token);
    const err = new Error('not-authorized');
    err.message = `Auth error (${res.status})`;
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
          } else if (pEl.autoText) {
            out += (pEl.autoText && pEl.autoText.content) ? pEl.autoText.content : '';
          }
          // inlineObjectElement (images/objects) intentionally skipped
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
      } else if (el.textRun && typeof el.textRun.content === 'string') {
        out += el.textRun.content;
      }
    }
    return out;
  }

  const body = (doc && doc.body && doc.body.content) ? doc.body.content : [];
  const text = extractTextFromStructuralElements(body || []);
  // Trim and normalize multiple newlines
  return (text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}