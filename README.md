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

## Permissions rationale
ClarityRead keeps extension permissions as narrow as possible:

- `activeTab` + `scripting`: generic page features (reflow, font toggle, contrast, summarize, read-aloud controls) are injected **only after user action** from the popup/command/context menu. The extension no longer declares persistent global content script matches for every site.
- `storage`: saves user preferences, stats, saved reads, and OAuth token metadata locally.
- `tabs`: needed to locate and target the active browser tab when user actions are triggered.
- `contextMenus`: provides right-click actions for ClarityRead controls.
- `identity`: enables Google OAuth for optional Google Docs integration.
- Host permissions are restricted to Google OAuth/Docs API endpoints required for the built-in Google Docs integration:
  - `https://accounts.google.com/*`
  - `https://oauth2.googleapis.com/*`
  - `https://docs.googleapis.com/*`

### Content script footprint
- `content_scripts` global auto-injection has been removed.
- `all_frames` and `match_about_blank` are not declared because injection is performed on demand via `chrome.scripting.executeScript` in the active tab flow instead of persistent blanket matching.


## Usage
- Click the ClarityRead toolbar icon to open the popup.
- Toggle dyslexia font / reflow / high contrast/ invert colors.
- Select text on any webpage and press **Summarize Page** to summarize either the selection or the full page.
- Use the export/import buttons to back up or restore saved content and preferences.
- Additional features are shown in the demo.
- I created a webpage for this app, which includes the privacy policy, terms of service, demo video, and more. The link to view it is here:https://tonna16.github.io/clarityread-site/ 

## Support
If you have problems, use the repository issues page or email `ttonnaagburu@gmail.com`.

