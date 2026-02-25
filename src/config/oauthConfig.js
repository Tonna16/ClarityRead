// src/config/oauthConfig.js
// Single source of truth for OAuth configuration.

// Chrome Web Store OAuth client (also used by manifest.json oauth2.client_id).
export const CHROME_EXTENSION_OAUTH_CLIENT_ID = '506269343424-426l9lh5s460726j6dpdgl5uu3f23qkm.apps.googleusercontent.com';
// Map extension runtime IDs to OAuth clients.
// Add your Chrome Web Store extension ID here when available.


// Edge Add-ons OAuth client.
// TODO(release): replace with production Edge client once registered in Google Cloud.
export const EDGE_EXTENSION_OAUTH_CLIENT_ID = '506269343424-426l9lh5s460726j6dpdgl5uu3f23qkm.apps.googleusercontent.com';



// Extension runtime IDs.
export const CHROME_EXTENSION_RUNTIME_ID = 'oamkfkffdbbhfnllhhjoklfknihebdhi';
// TODO(edge-release): replace with the published Edge Add-ons runtime ID.
export const EDGE_EXTENSION_RUNTIME_ID = 'oamkfkffdbbhfnllhhjoklfknihebdhi';

// Local unpacked IDs are machine-specific unless manifest.json provides a stable `key`.
// Keep this value empty and let each developer set their own ID + OAuth client mapping.
export const LOCAL_UNPACKED_EXTENSION_RUNTIME_ID = '';
// Known extension runtime IDs mapped to their dedicated OAuth client.
// Keep this explicit so release IDs always resolve deterministically.

export const OAUTH_CLIENT_ID_BY_EXTENSION_ID = Object.freeze({
 // Chrome Web Store extension ID.
  [CHROME_EXTENSION_RUNTIME_ID]: CHROME_EXTENSION_OAUTH_CLIENT_ID,

  // Edge Add-ons extension ID.
  [EDGE_EXTENSION_RUNTIME_ID]: EDGE_EXTENSION_OAUTH_CLIENT_ID,

  // Local unpacked extension ID (optional per developer).
  ...(LOCAL_UNPACKED_EXTENSION_RUNTIME_ID
    ? { [LOCAL_UNPACKED_EXTENSION_RUNTIME_ID]: CHROME_EXTENSION_OAUTH_CLIENT_ID }
    : {})
});

// Browser-level fallback used for unpacked/dev IDs that are not in OAUTH_CLIENT_ID_BY_EXTENSION_ID.
const OAUTH_CLIENT_ID_BY_BROWSER = Object.freeze({
  chrome: CHROME_EXTENSION_OAUTH_CLIENT_ID
});


export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/documents.readonly',
  'openid',
  'profile',
  'email'
]);

function detectBrowserRuntime() {
  try {
    const ua = String(globalThis?.navigator?.userAgent || '').toLowerCase();
    if (ua.includes('edg/')) return 'edge';
  } catch (e) {
    // no-op
  }
  return 'chrome';
}

export function getOAuthClientIdForRuntime(runtimeId) {
  const normalizedRuntimeId = typeof runtimeId === 'string' ? runtimeId.trim() : '';
  if (normalizedRuntimeId && OAUTH_CLIENT_ID_BY_EXTENSION_ID[normalizedRuntimeId]) {
    return OAUTH_CLIENT_ID_BY_EXTENSION_ID[normalizedRuntimeId];
  }
  return OAUTH_CLIENT_ID_BY_BROWSER[detectBrowserRuntime()] || CHROME_EXTENSION_OAUTH_CLIENT_ID;}



export function getOAuthRuntimeSelection(runtimeId) {
  return {
    runtimeId: runtimeId || null,
    clientId: getOAuthClientIdForRuntime(runtimeId)
  };
}
