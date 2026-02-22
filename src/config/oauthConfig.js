// src/config/oauthConfig.js
// Single source of truth for OAuth configuration.

export const DEFAULT_OAUTH_CLIENT_ID = '506269343424-jblcatpku4ui7tlaqe4pvn9d63rhjpmt.apps.googleusercontent.com';

// Map extension runtime IDs to OAuth clients.
// Add your Chrome Web Store extension ID here when available.
export const OAUTH_CLIENT_ID_BY_EXTENSION_ID = Object.freeze({
  // 'your_store_extension_id_here': 'your_store_oauth_client_id_here.apps.googleusercontent.com'
});

export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/documents.readonly',
  'openid',
  'profile',
  'email'
]);

export function getOAuthClientIdForRuntime(runtimeId) {
  const normalizedRuntimeId = typeof runtimeId === 'string' ? runtimeId.trim() : '';
  if (normalizedRuntimeId && OAUTH_CLIENT_ID_BY_EXTENSION_ID[normalizedRuntimeId]) {
    return OAUTH_CLIENT_ID_BY_EXTENSION_ID[normalizedRuntimeId];
  }
  return DEFAULT_OAUTH_CLIENT_ID;
}

export function getOAuthRuntimeSelection(runtimeId) {
  return {
    runtimeId: runtimeId || null,
    clientId: getOAuthClientIdForRuntime(runtimeId)
  };
}
