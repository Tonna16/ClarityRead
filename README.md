# ClarityRead — Reading Mode & Dyslexia Support

ClarityRead is a lightweight browser extension that makes reading on the web easier and more comfortable. It’s built for accessibility: dyslexia-friendly fonts, reflowed reading mode, focus mode, high-contrast themes, and built-in text-to-speech. It also includes a fast, privacy-first summarizer that runs entirely in your browser.

## Key features
- **OpenDyslexic font toggle** for easier letter recognition.
- **Reading / reflow mode** to remove clutter and present readable text.
- **High contrast & invert colors** for low-vision accessibility.
- **Text-to-speech** using the browser’s speechSynthesis API (voices available locally).
- **Local summarizer** — summarization runs in the extension and does not send page content to remote servers by default.
- **Selection-aware summarization** — highlight text on a page to summarize the selection only.
- **Profiles & saved reads** stored locally in the browser.
- **Export / Import** saved reads and profiles (user can export JSON from popup and re-import later).
- **Reading stats** (local-only) visualized in a chart.

## Privacy & Data
ClarityRead is privacy-first. By default, all processing (summaries, TTS via browser, stats) happens locally in your browser. No page text or selections are transmitted to any external server. Saved reads and preferences are stored locally in `chrome.storage.local` and can be exported/imported by the user.

## OAuth runtime IDs and Google Cloud redirect URIs
ClarityRead chooses an OAuth client based on `chrome.runtime.id` in `src/config/oauthConfig.js`.

For each runtime ID you use, create (or reuse) a matching Google OAuth client and register the exact redirect URI format:

- `https://<runtime-id>.chromiumapp.org`
- `https://<runtime-id>.chromiumapp.org/oauth2`

Current runtime ID mappings live in `OAUTH_CLIENT_ID_BY_EXTENSION_ID`.

### Local unpacked development
Unpacked install IDs are not stable unless you define a `key` in `manifest.json`. This repo currently does **not** set a dev `key`, so each developer should:

1. Load unpacked and copy your generated runtime ID.
2. Create/register a Google OAuth client for that runtime ID.
3. Add your local mapping in `src/config/oauthConfig.js` (set `LOCAL_UNPACKED_EXTENSION_RUNTIME_ID` and map it to your OAuth client).


## Usage
- Click the ClarityRead toolbar icon to open the popup.
- Toggle dyslexia font / reflow / high contrast/ invert colors.
- Select text on any webpage and press **Summarize Page** to summarize either the selection or the full page.
- Use the export/import buttons to back up or restore saved content and preferences.
- Additional features are shown in the demo.
- I created a webpage for this app, which includes the privacy policy, terms of service, demo video, and more. The link to view it is here:https://tonna16.github.io/clarityread-site/ 

## Support
If you have problems, use the repository issues page or email `ttonnaagburu@gmail.com`.

