# 3DModelPrint – MakerWorld Bridge Extension

MVP browser extension that extracts MakerWorld model metadata for the 3DModelPrint web app.

## Loading in Chrome (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension/` folder
4. Note the generated **Extension ID** shown on the card

## Configuring the web app

Copy the Extension ID into the frontend env file:

```
# modelprint-frontend/.env.local
VITE_EXTENSION_ID=<paste extension ID here>
```

Restart the frontend dev server after changing this.

## Message protocol

**Web app → extension** (via `chrome.runtime.sendMessage`):
```json
{ "type": "EXTRACT_MAKERWORLD_METADATA", "url": "https://makerworld.com/en/models/..." }
```

**Extension → web app** (success):
```json
{
  "title": "...",
  "summary": "...",
  "cover": "https://cdn...",
  "coverImages": ["https://cdn..."],
  "designFiles": [{ "filePath": "https://...", "type": "stl" }]
}
```

**Extension → web app** (error):
```json
{ "error": "NEXT_DATA_MISSING" | "PARSE_FAILED" | "DESIGN_INFO_MISSING" | "BACKGROUND_ERROR" | "INVALID_MESSAGE" }
```

## Behaviour

- If the MakerWorld URL is already open in a tab, that tab is reused.
- If not, a new tab is opened **inactive** (no focus steal) and the extension waits for it to finish loading before extracting.
- Extraction reads `__NEXT_DATA__` embedded by Next.js — no network requests from the content script.

## Next steps (Phase 2)

- Acquire model files using the authenticated browser session
- Pass file blobs / URLs back to the web app for the existing import session pipeline
