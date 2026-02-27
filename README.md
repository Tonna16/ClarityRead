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
ClarityRead is privacy-first. By default, all processing (summaries, explain/rewrite/define actions, TTS via browser, and stats) happens locally in your browser. Saved reads and preferences are stored locally in `chrome.storage.local` and can be exported/imported by the user.

### Optional remote AI mode (off by default)
If you switch **AI mode** to **Remote (optional)** and the `remoteAiEnabled` feature flag is enabled, ClarityRead may send only the text needed for that action to your configured remote AI endpoint:
- **Explain selection**: selected text (or extracted page text if nothing is selected).
- **Rewrite for grade level**: selected text/page text plus selected grade (3/6/9).
- **Define selected word**: selected word (or first detected word from the selected text).

When remote mode is disabled (default), these actions use local fallback logic and no page text is sent externally.

## Usage
- Click the ClarityRead toolbar icon to open the popup.
- Toggle dyslexia font / reflow / high contrast/ invert colors.
- Select text on any webpage and press **Summarize Page** to summarize either the selection or the full page.
- Use the export/import buttons to back up or restore saved content and preferences.
- Additional features are shown in the demo.
- I created a webpage for this app, which includes the privacy policy, terms of service, demo video, and more. The link to view it is here:https://tonna16.github.io/clarityread-site/ 

## Support
If you have problems, use the repository issues page or email `ttonnaagburu@gmail.com`.


