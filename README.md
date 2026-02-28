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
If you switch **AI mode** to **Remote (optional)** and enable the `remoteAiEnabled` feature flag, ClarityRead can send only the text needed for each AI action to your configured endpoint.

#### Setup
1. Open the extension popup → **Remote AI settings**.
2. Set **Endpoint** (`remoteAiEndpoint`), for example `https://api.example.com/clarityread`.
3. Choose **Auth type** (`remoteAiAuthType`): `none`, `bearer`, or `x-api-key`.
4. (Optional) Set **API key/token** (`remoteAiApiKey`). For stronger security, prefer server-side secrets whenever possible.
5. Toggle **Enable remote AI feature flag** and set **AI mode** to **Remote (optional)**.
6. Click **Test connection**.

#### Expected payload contract
Request JSON (POST body):
```json
{ "action": "summarizeText", "text": "...", "word": "...", "gradeLevel": 6, "detailPref": "normal", "context": { "url": "https://example.com" } }
```
`action` is always present. Other fields are optional depending on the action.

Response JSON:
```json
{ "output": "Your generated answer here" }
```
`{ "result": "..." }` is also accepted.

If remote mode fails (missing endpoint, auth failure, or non-2xx), ClarityRead shows an actionable error toast and falls back to local processing.

## Usage
- Click the ClarityRead toolbar icon to open the popup.
- Toggle dyslexia font / reflow / high contrast/ invert colors.
- Select text on any webpage and press **Summarize Page** to summarize either the selection or the full page.
- Use the export/import buttons to back up or restore saved content and preferences.
- Additional features are shown in the demo.
- I created a webpage for this app, which includes the privacy policy, terms of service, demo video, and more. The link to view it is here:https://tonna16.github.io/clarityread-site/ 

## Support
If you have problems, use the repository issues page or email `ttonnaagburu@gmail.com`.


