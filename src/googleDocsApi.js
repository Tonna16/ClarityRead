// src/googleDocsApi.js
import { getGoogleAuthTokenInteractive } from './googleAuth.js';

/**
 * Extracts plain text from Google Docs document structure.
 * The docs API returns a body.content array with nested text runs.
 */
function extractTextFromDocument(doc) {
  if (!doc || !doc.body || !Array.isArray(doc.body.content)) return '';
  const parts = [];
  for (const block of doc.body.content) {
    if (!block) continue;
    // paragraphs and tables etc.
    if (block.paragraph && Array.isArray(block.paragraph.elements)) {
      for (const el of block.paragraph.elements) {
        if (el.textRun && el.textRun.content) parts.push(el.textRun.content);
      }
    } else if (block.table && Array.isArray(block.table.tableRows)) {
      // iterate table cells (best-effort)
      for (const row of block.table.tableRows) {
        for (const cell of row.tableCells || []) {
          if (cell.content) {
            for (const cblock of cell.content) {
              if (cblock.paragraph && Array.isArray(cblock.paragraph.elements)) {
                for (const el of cblock.paragraph.elements) {
                  if (el.textRun && el.textRun.content) parts.push(el.textRun.content);
                }
              }
            }
          }
        }
      }
    }
    // other block types ignored
  }
  return parts.join('').trim();
}

/**
 * Fetch a Google Doc by document ID and return plain text.
 * Throws on error.
 */
export async function fetchGoogleDocText(docId, { interactiveIfNecessary = false } = {}) {
  if (!docId) throw new Error('missing-docId');

  // Try silent first
  try {
    let token;
    try {
      token = await getGoogleAuthTokenInteractive(false);
    } catch (silentErr) {
      if (!interactiveIfNecessary) throw silentErr;
      // fallthrough to interactive
    }

    if (!token && interactiveIfNecessary) {
      token = await getGoogleAuthTokenInteractive(true);
    }
    if (!token) throw new Error('no-token-obtained');

    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      // if 401, try interactive token once
      if (res.status === 401 && interactiveIfNecessary) {
        // try interactive
        const token2 = await getGoogleAuthTokenInteractive(true);
        const r2 = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
          headers: { Authorization: `Bearer ${token2}` }
        });
        if (!r2.ok) throw new Error(`google-docs-fetch-failed:${r2.status}`);
        const doc2 = await r2.json();
        return extractTextFromDocument(doc2);
      }
      throw new Error(`google-docs-fetch-failed:${res.status}`);
    }
    const doc = await res.json();
    const text = extractTextFromDocument(doc);
    return text;
  } catch (err) {
    throw err;
  }
}
