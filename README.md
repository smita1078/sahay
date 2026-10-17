# Sahay: Firebase edition

Browser-only build of Sahay for **Firebase Hosting + Firestore + Firebase Authentication +
Firebase AI Logic (Gemini)**, all on the free Spark plan. Setup and deployment:
[../docs/DEPLOY_FIREBASE.md](../docs/DEPLOY_FIREBASE.md).

| Path | What |
|---|---|
| `public/app.js`, `index.html`, `styles.css` | The app, shared with the Cloud Run edition (copied by `scripts/export_web_data.py`) |
| `public/data/` | Message catalog (hi/mr/en), rules register, voice keywords, exported from the Python sources |
| `public/prompts/` | The Gemini prompts, the same files as the Python edition |
| `public/js/backend.js` | The `/api/...` endpoints, implemented in the browser |
| `public/js/planner.js`, `scam.js`, `voice.js`, `guidance.js`, `quality.js`, `masking.js` | Ports of the Python logic |
| `public/js/cv-worker.js` | Card detection with OpenCV.js in a Web Worker (its own CSP allows `eval`; the page's does not) |
| `public/js/gemini.js` | Firebase AI Logic client: schema-constrained JSON, retries |
| `public/js/store.js` | Firestore, or `localStorage` for the no-account demo mode |
| `public/config.js` | Your Firebase project settings (`null` = local demo mode) |
| `firestore.rules` | Who can read and write what |
| `test/` | Parity tests: the JS ports must match the Python decisions exactly |

```bash
npm install            # dev tools: esbuild, firebase SDK, OpenCV.js (only to rebuild or test)
npm run export         # re-export catalog, rules, prompts and fixtures from the Python code
npm run bundle         # rebuild public/vendor/firebase-sdk.js
npm test               # planner, scam check, voice keywords, masking and card detection vs Python
npm run serve          # http://localhost:5000
```
