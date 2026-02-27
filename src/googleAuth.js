
// Helper wrapper for chrome.identity-based Google OAuth in MV3
export async function getGoogleAuthTokenInteractive(interactive = false) {
  return new Promise((resolve, reject) => {
    try {
      // chrome.identity.getAuthToken will use the oauth2 block from manifest.json
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message || 'getAuthToken failed'));
        }
        if (!token) return reject(new Error('no-token'));
        resolve(token);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function removeCachedGoogleAuthToken(token) {
  return new Promise((resolve) => {
    try {
      if (!token) return resolve();
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

// Revoke token
export async function revokeGoogleAuthToken(token) {
  try {
    if (!token) return;
    // invalidate locally and at Google
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        await removeCachedGoogleAuthToken(token);
    return true;
  } catch (e) {
    return false;
  }
}
