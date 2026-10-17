# Sahay (सहाय)

**Bank KYC that people with disabilities, and elderly customers, can actually complete, in Hindi,
Marathi and English.**

**Live prototype:** https://sahay-5d515.web.app · **Demo video:** [YouTube link] ·
Google Cloud AI Builder Cup 2026, Accessibility · Team: Smita Prajapati, Garima Singh

Pragya Prasun, an acid attack survivor, could not open a bank account because digital KYC
required her to blink. In April 2025 the Supreme Court ruled that digital access is part of the
right to life (*Pragya Prasun v. Union of India*, 2025 INSC 599), and RBI's KYC Directions now say facial
gestures are "not mandatory for liveness check" and that liveness checks "shall not result in
exclusion of person with special needs".

Rules on paper don't open accounts. Sahay is the customer's companion through KYC:

1. **Works through whichever sense the customer has.** *Voice mode* (the big button on the first
   screen): Sahay asks, the customer answers by speaking, in Marathi, Hindi or English. "मला दिसत
   नाही आणि माझे ठसे येत नाहीत" becomes the right needs via Gemini, is read back for a spoken "yes",
   and the whole journey (consent, needs, documents, choosing a route, the photo, joining the
   call) needs no sight. Deaf customers get the officer's words as large captions (typed, or
   spoken and transcribed live), with a flash and vibration on each new one, and can reply by
   typing; the officer sees their words verbatim.
2. **Finds a lawful route that works for them.** A blind customer whose fingerprints have worn
   away with age, a deaf customer, someone who can't travel, someone without their own phone:
   Sahay lists every KYC route the RBI Directions allow, says which suit them and why, and cites
   the paragraph.
3. **Guides document photos by voice.** "The right side is cut off. Move the phone a little to
   your right." One instruction at a time, only once it is stable, in their language. Works with
   a phone's rear camera or a laptop webcam ("move the card"), and finds the card with OpenCV so
   a face or a bright wall is never mistaken for one.
4. **Stays silent where the law requires it.** RBI says any prompting at the customer end during
   video KYC means rejection (¶27(2)(iv)). During the call Sahay only relays the official's
   questions and the customer's own typed replies, and refuses to suggest answers.
5. **Never lets a customer hit a dead end.** If something doesn't work, the case goes to a bank
   officer with everything needed to help, and the officer can't reject without a written reason
   (¶18).
6. **Catches KYC scams.** "Your KYC has expired, your account will be blocked, share the OTP":
   elderly customers are exactly who these frauds target. Paste the message or say what the
   caller said, and Sahay points out the warning signs RBI lists (OTP requests, links, remote-access
   apps, requests for Aadhaar photos, threats) and gives RBI's advice, including the 1930 helpline.
   No session needed, and the message is never stored.
7. **Shows the bank where disabled customers drop out**, for the accessibility audits the Supreme
   Court ordered, and how many scam messages customers are checking.

Every rule Sahay relies on is in [docs/RULES_REGISTER.md](docs/RULES_REGISTER.md), checked against
the primary text of the *RBI (Commercial Banks – KYC) Directions, 2025* (updated as on 1 October
2026), the Supreme Court judgment, and RBI's 2 February 2024 caution against KYC-updation frauds. The test suite fails if the code cites a rule that is
missing from the register or not verified.

## Two editions

- **Firebase edition** (`firebase/`): runs entirely on Firebase's free plan (Hosting, Firestore,
  Authentication, Firebase AI Logic for Gemini), **no billing account needed**. Deploy with
  [docs/DEPLOY_FIREBASE.md](docs/DEPLOY_FIREBASE.md). This is the hackathon deployment.
- **Cloud Run edition** (this Python app): the same app with a FastAPI server, for a bank running
  it in its own Google Cloud project ([docs/DEPLOY.md](docs/DEPLOY.md)).

Both share the screens, the rules register, the messages and the prompts; the browser ports are
tested against the Python decisions (`firebase/test`).

## Run it on your laptop

You need **Python 3.12 or newer** (`python --version`) and Chrome or Edge (for voice). A Gemini key
is optional: without one, everything except document-type reading, Q&A and translation works.

**macOS / Linux**

```bash
unzip sahay.zip && cd sahay
make install            # creates .venv and installs everything
make run                # http://localhost:8000
```

**Windows (PowerShell)**: no `make` needed

```powershell
Expand-Archive sahay.zip; cd sahay\sahay
py -3.12 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\uvicorn sahay.main:app --reload
```

If PowerShell refuses to run scripts, use the full paths above rather than `activate`.

- **Customer app:** `http://localhost:8000/` (choose a language; try "Demo: try a sample card" if
  you have no camera).
- **Scam check:** `http://localhost:8000/#/check` (or the 🛡️ button on the first screen).
- **Officer console:** `http://localhost:8000/#/officer`
- **Accessibility insights:** `http://localhost:8000/#/insights`

### With Gemini

Either an **AI Studio key** (quickest) or **Vertex AI** on your Google Cloud project (what the
Cloud Run deployment uses; no key).

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

Then edit `.env`:

```ini
# Option A: AI Studio key (aistudio.google.com → Get API key)
SAHAY_AI_MODE=gemini
SAHAY_GEMINI_BACKEND=api_key
SAHAY_GEMINI_API_KEY=your-key

# Option B: Vertex AI (needs the gcloud CLI and `gcloud auth application-default login` once)
# SAHAY_AI_MODE=gemini
# SAHAY_GEMINI_BACKEND=vertex
# SAHAY_GCP_PROJECT=your-project-id
# SAHAY_GCP_LOCATION=global
```

Check it before you run the app:

```bash
make gemini-check       # Windows: .venv\Scripts\python scripts\check_gemini.py
```

It sends the specimen cards, one translation and one scam check, and prints what Gemini returned.
"Model not found" means the model name or location is wrong for your key or project: set
`SAHAY_GEMINI_MODEL` to an ID listed in AI Studio or Model Garden.

**On a phone:** browsers only allow the camera on HTTPS (or `localhost`). Deploy to Cloud Run
with Gemini on Vertex AI (`deploy/deploy.sh`, step by step in [docs/DEPLOY.md](docs/DEPLOY.md)),
which gives an HTTPS URL.

### Stage demo without Wi-Fi

`make demo-record`, click through the demo once, then `make demo-replay`: the same Gemini
answers are replayed with no network.

## How it works

```
 Customer phone (PWA, voice + screen reader)          Bank side
 ───────────────────────────────────────────          ─────────────────────────────
 language → consent (hash-chained, D1)                 Officer console
   → needs & documents                                   · case file: accommodations with
   → ROUTE PLANNER (deterministic, cited) ──────┐           rule citations, masked documents,
   → document capture                           │           consent chain check
       · local checks: light/glare/blur/frame   │         · decide: proceed / ask / reject
       · Gemini: type, legibility, read-back    │           (reason ≥ 15 chars, ¶18)
       · Aadhaar masked before storage (C3)     │         · live relay: question → translated,
   → video KYC: relay only, no prompting (A3) ◄─┼─────────── read aloud to customer
   → or referral to officer (B4) ───────────────┘       Insights: drop-off by need (B8)
```

| Concern | Where |
|---|---|
| Rules as data, citations | `src/sahay/rules.py`, `docs/RULES_REGISTER.md` |
| Route planner | `src/sahay/planner.py` |
| Image checks, guidance, masking | `src/sahay/capture/` |
| Gemini client (retries, structured output, record/replay) | `src/sahay/ai/` |
| Customer journey, consent chain, retention | `src/sahay/services/journey.py`, `consent.py` |
| Officer, relay, insights | `src/sahay/services/officer.py` |
| Scam check | `src/sahay/scam.py`, `src/sahay/services/scam.py` |
| Voice mode (speech → needs) | `src/sahay/voice.py`, `voice*` in `web/static/app.js` |
| Card detection (OpenCV) | `src/sahay/capture/quality.py`, scenes in `tests/scenes/` |
| Hindi / Marathi / English text | `src/sahay/i18n.py` (232 messages, all three languages) |
| Web app | `src/sahay/web/static/` |

### Privacy by design

- Camera frames are analysed in memory and discarded; there is no column for images or audio.
- Aadhaar and Virtual ID numbers are masked before anything is stored or shown.
- Support needs reach the bank only with the customer's consent (record needs, or referral).
- Customer sessions are deleted after `SAHAY_RETENTION_HOURS` (default 72).
- Consent records form a SHA-256 hash chain; the officer console shows whether it verifies.
- The audit log holds actions, never names, numbers or customer free text.

**Speech in the browser:** voice mode and the officer's live captions use the browser's built-in
speech recognition (Chrome or Edge), which sends audio to the browser vendor's speech service. A
bank deployment would swap in Google Cloud Speech-to-Text in its own project for the same data
controls as Gemini.

## What Sahay deliberately does not do

- It does not verify identity, check liveness or match faces: trained bank officials do (¶27(2)(i)).
- It does not call UIDAI, PAN, CKYCR or DigiLocker: only licensed entities may. The demo uses
  clearly labelled SPECIMEN cards (`scripts/make_specimens.py`): no government designs, fictional
  people, impossible Aadhaar numbers.
- It is not a replacement for the bank's video KYC platform; it sits beside it.
