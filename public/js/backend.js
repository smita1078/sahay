// The Sahay API, implemented in the browser for the Firebase edition.
//
// app.js (shared with the Cloud Run edition) calls the same /api/... paths; here each call is
// handled by this module instead of a server. Behaviour mirrors src/sahay/services/*.py: consent
// before anything, a hash-chained consent log, Aadhaar masking, no model calls during the video
// call, a written reason for every rejection. Where a server would enforce access, Firestore
// security rules do (firestore.rules).
import { t, catalog } from "./i18n.js";
import { allRules, cite } from "./rules.js";
import { plan, renderPlan, normaliseProfile, NEEDS } from "./planner.js";
import { maskText } from "./masking.js";
import { assess as assessScam, redact } from "./scam.js";
import { understandLocally, readback } from "./voice.js";
import { ANALYSIS_WIDTH, pyRound } from "./quality.js";
import { result as captureResult, expectedLabel, firstProblem } from "./guidance.js";
import { renderPrompt } from "./gemini.js";

export const VERSION = "0.2.0-firebase";
const RETENTION_HOURS = 72;
const MIN_REJECTION_REASON = 15;
const CONSENT_TEXT_KEY = { ASSIST: "consent.assist", RECORD_NEEDS: "consent.record_needs", REFERRAL: "consent.referral" };
const STEPS = ["STARTED", "CONSENTED", "NEEDS_SHARED", "ROUTE_CHOSEN", "DOCUMENT_CAPTURED", "VIDEO_KYC_JOINED", "REFERRED"];
const LANG_NAME = { en: "English", hi: "Hindi", mr: "Marathi" };

export const ACCOMMODATIONS = {
  NO_FACIAL_GESTURES: ["Do not ask for blinking, smiling or other facial gestures during liveness.", ["B1", "B2"]],
  BLIND_LOW_VISION: ["Customer is blind or has low vision. Sahay reads your questions aloud; describe any on-screen step verbally.", []],
  DEAF_HARD_OF_HEARING: ["Customer is deaf or hard of hearing. Type your questions so they appear as captions; arrange a sign-language interpreter if requested.", ["B9"]],
  FINGERPRINTS_UNREADABLE: ["Fingerprints may not scan. Use Aadhaar Face Authentication, OTP, offline verification or an ink thumb impression instead.", ["E1", "E5", "E6"]],
  CANNOT_SIGN: ["Customer finds signing hard. OTP can sign the electronic CAF; take a thumb impression on the printed CAF.", ["E5", "B6"]],
  NO_OWN_MOBILE: ["No own mobile. A family member's mobile may receive the OTP; record this in the CAF. Never use the officer's own number.", ["E5"]],
  CANNOT_TRAVEL: ["Customer cannot travel. Digital KYC can be done at the customer's location.", ["F1"]],
  NEEDS_SIMPLE_LANGUAGE: ["Use short, simple sentences and check understanding.", []],
};

export class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}
const notFound = (m) => new ApiError(404, m);
const conflict = (m) => new ApiError(409, m);
const invalid = (m) => new ApiError(422, m);

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID().replace(/-/g, "");
const pad = (n) => String(n).padStart(6, "0");

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Backend {
  /**
   * @param {object} deps
   * @param {LocalStore|FirestoreStore} deps.store
   * @param {{generate(task, prompt, images): Promise<object>, model: string}|null} deps.gemini
   * @param {{customerUid(): Promise<string>, officer(): {name: string}|null}} deps.auth
   * @param {(rgba, w, h) => Promise<object>} deps.analyseFrame card detection (OpenCV.js in a worker)
   * @param {string} deps.mode "firebase" or "local"
   */
  constructor({ store, gemini, auth, analyseFrame, mode }) {
    Object.assign(this, { store, gemini, auth, analyseFrame, mode });
    this.readings = new Map(); // frame hash -> Gemini reading, so a commit does not call the model twice
  }

  // --- dispatch -------------------------------------------------------------------------------
  async handle(path, opts = {}) {
    const url = new URL(path, "https://sahay.local");
    const method = (opts.method || "GET").toUpperCase();
    const body = typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
    const q = url.searchParams;
    const p = url.pathname.replace(/^\/api\//, "").split("/");
    const h = opts.headers || {};

    if (p[0] === "config") return this.config();
    if (p[0] === "i18n") return catalog(p[1]);
    if (p[0] === "rules") return allRules();
    if (p[0] === "scam-check" && method === "POST") return this.scamCheck(body.text, body.language || "hi");

    if (p[0] === "sessions") {
      if (p.length === 1 && method === "POST") return this.start(body.language || "hi", body.bc_agent);
      const sid = p[1];
      const action = p.slice(2).join("/");
      switch (`${method} ${action}`) {
        case "GET ": return this.view(await this.load(sid));
        case "POST language": return this.setLanguage(sid, body.language);
        case "POST consents": return this.recordConsent(sid, body.purpose, !!body.granted);
        case "PUT profile": return this.setProfile(sid, body);
        case "GET plan": return this.plan(sid);
        case "POST route": return this.chooseRoute(sid, body.route);
        case "POST capture": return this.capture(sid, body.get("image"), q.get("expected") || "AADHAAR", q.get("commit") === "true", q.get("deep") === "true", q.get("camera") === "front");
        case "POST ask": return this.ask(sid, body.question);
        case "POST understand": return this.understand(sid, body.text, body.ask);
        case "POST video-kyc/join": return this.join(sid);
        case "POST video-kyc/leave": return this.leave(sid);
        case "POST video-kyc/reply": return this.reply(sid, body.text);
        case "GET relay": return this.relayFeed(sid, Number(q.get("after") || 0));
        case "POST referral": return this.refer(sid, body.blocked_step, body.note);
        default: throw notFound(`no route ${method} ${url.pathname}`);
      }
    }

    // bank side
    const officer = this.officerName(h);
    if (p[0] === "officer" && p[1] === "cases") {
      if (p.length === 2) return this.listCases();
      if (p.length === 3) return this.caseFile(p[2]);
      if (p[3] === "decision") return this.decide(p[2], body.decision, body.note, officer);
    }
    if (p[0] === "officer" && p[1] === "video-sessions") {
      this.requireOfficer();
      if (p.length === 2) return this.activeVideoSessions();
      if (p[3] === "relay") return this.officerRelay(p[2], body.text, officer);
      if (p[3] === "messages") return this.conversation(p[2], Number(q.get("after") || 0));
    }
    if (p[0] === "insights" && p[1] === "funnel") return this.funnel();
    throw notFound(`no route ${method} ${url.pathname}`);
  }

  config() {
    return {
      version: VERSION,
      ai_mode: this.gemini ? "gemini" : "offline",
      model: this.gemini ? this.gemini.model : null,
      languages: ["en", "hi", "mr"],
      officer_auth_required: this.mode === "firebase",
      auth: this.mode === "firebase" ? "google" : "none",
      edition: this.mode,
    };
  }

  officerName(headers) {
    if (this.mode === "firebase") {
      const o = this.auth.officer();
      return o ? o.name : "";
    }
    return String(headers["X-User"] || "").replace(/[^\w@.\- ]/g, "").trim().slice(0, 200) || "anonymous";
  }

  requireOfficer() {
    if (this.mode === "firebase" && !this.auth.officer()) throw new ApiError(401, "Sign in as a bank officer first.");
  }

  async audit(sessionId, actor, action, detail = {}) {
    // Holds no personal data: no names, numbers or customer free text.
    try { await this.store.add("audit", { session_id: sessionId, actor, action, detail, at: now() }); } catch (_) { /* best effort */ }
  }

  // --- sessions ---------------------------------------------------------------------------------
  async start(language, bcAgent) {
    const uid = await this.auth.customerUid();
    const id = newId();
    const s = {
      ownerUid: uid, language, status: "ACTIVE", profile: {}, chosen_route: null,
      bc_agent: bcAgent ? String(bcAgent).trim().slice(0, 100) : null, created_at: now(), updated_at: now(),
    };
    await this.store.create(`sessions/${id}`, s);
    await this.funnelEvent({ id, ...s }, [], "STARTED");
    await this.audit(id, "customer", "SESSION_STARTED", { language, bc_assisted: !!bcAgent });
    return { ...(await this.view(await this.load(id))), token: "firebase" };
  }

  async load(sid) {
    const s = await this.store.get(`sessions/${sid}`);
    if (!s) throw notFound("session not found");
    const [consents, documents, relay, cases] = await Promise.all([
      this.store.list(`sessions/${sid}/consents`, { order: ["seq", "asc"] }),
      this.store.list(`sessions/${sid}/documents`, { order: ["at", "asc"] }),
      this.store.list(`sessions/${sid}/relay`, { order: ["seq", "asc"] }),
      this.store.list("cases", { where: [["session_id", "==", sid], ...(this.mode === "firebase" && !this.auth.officer() ? [["ownerUid", "==", s.ownerUid]] : [])] }),
    ]);
    return { id: sid, ...s, consents, documents, relay, cases };
  }

  current(s, purpose) {
    const decisions = s.consents.filter((c) => c.purpose === purpose);
    return decisions.length ? decisions[decisions.length - 1].granted : false;
  }

  require(s, purpose) {
    if (!this.current(s, purpose)) throw conflict(`consent for ${purpose} has not been given`);
  }

  view(s) {
    return {
      id: s.id, language: s.language, status: s.status, chosen_route: s.chosen_route, profile: s.profile, bc_agent: s.bc_agent,
      consents: Object.fromEntries(Object.keys(CONSENT_TEXT_KEY).map((p) => [p, this.current(s, p)])),
      documents: s.documents.map((d) => ({ expected: d.expected, doc_type: d.doc_type, fields: d.fields, at: d.at })),
      cases: s.cases.map((c) => ({ id: c.id, status: c.status, decision_note: c.decision_note || null })),
    };
  }

  async touch(sid, patch) { await this.store.update(`sessions/${sid}`, { ...patch, updated_at: now() }); }

  async setLanguage(sid, language) {
    await this.touch(sid, { language });
    return this.view(await this.load(sid));
  }

  // --- consent (rules register D1: auditable and alteration-proof) ---------------------------------
  static digest(sid, seq, purpose, granted, language, text, at, prev) {
    return sha256(JSON.stringify([sid, seq, purpose, granted, language, text, at, prev]));
  }

  async recordConsent(sid, purpose, granted) {
    if (!CONSENT_TEXT_KEY[purpose]) throw invalid("unknown consent purpose");
    const s = await this.load(sid);
    const prev = s.consents[s.consents.length - 1];
    const seq = prev ? prev.seq + 1 : 1;
    const at = now();
    const prevHash = prev ? prev.hash : "0".repeat(64);
    const text = t(CONSENT_TEXT_KEY[purpose], s.language);
    const hash = await Backend.digest(sid, seq, purpose, granted, s.language, text, at, prevHash);
    await this.store.create(`sessions/${sid}/consents/${pad(seq)}`, {
      seq, purpose, granted, language: s.language, text_shown: text, at, prev_hash: prevHash, hash,
    });
    const after = await this.load(sid);
    if (purpose === "ASSIST" && granted) await this.funnelEvent(after, after.consents, "CONSENTED");
    await this.audit(sid, "customer", "CONSENT_RECORDED", { purpose, granted });
    return this.view(after);
  }

  static async verifyChain(sid, records) {
    let prev = "0".repeat(64);
    let expected = 1;
    for (const r of [...records].sort((a, b) => a.seq - b.seq)) {
      const recomputed = await Backend.digest(sid, r.seq, r.purpose, r.granted, r.language, r.text_shown, r.at, prev);
      if (r.seq !== expected || r.prev_hash !== prev || r.hash !== recomputed) return { valid: false, records: records.length, broken_at: r.seq };
      prev = r.hash; expected += 1;
    }
    return { valid: true, records: records.length, broken_at: null };
  }

  // --- needs, plan, route ---------------------------------------------------------------------
  async setProfile(sid, raw) {
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    const profile = normaliseProfile(raw);
    await this.touch(sid, { profile });
    const after = await this.load(sid);
    await this.funnelEvent(after, after.consents, "NEEDS_SHARED");
    return this.view(after);
  }

  async plan(sid) {
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    return renderPlan(plan(s.profile), s.language);
  }

  async chooseRoute(sid, route) {
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    const option = plan(s.profile).options.find((o) => o.route === route);
    if (!option) throw invalid("unknown route");
    if (option.blockers.length) throw conflict("that route is not available for this customer");
    await this.touch(sid, { chosen_route: route });
    await this.funnelEvent(s, s.consents, "ROUTE_CHOSEN");
    await this.audit(sid, "customer", "ROUTE_CHOSEN", { route });
    return this.view(await this.load(sid));
  }

  // --- documents --------------------------------------------------------------------------------
  async capture(sid, blob, expected, commit, deep, front) {
    if (!["AADHAAR", "PAN", "ANY_OVD"].includes(expected)) throw invalid("expected must be AADHAAR, PAN or ANY_OVD");
    if (!blob || blob.size > 1500 * 1024) throw invalid("image missing or larger than 1500 KB");
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    const lang = s.language;
    const bitmap = await createImageBitmap(blob);
    const scale = bitmap.width > ANALYSIS_WIDTH ? ANALYSIS_WIDTH / bitmap.width : 1;
    const w = scale === 1 ? bitmap.width : ANALYSIS_WIDTH;
    const h = Math.max(1, pyRound(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const q = await this.analyseFrame(ctx.getImageData(0, 0, w, h).data, w, h);

    let reading = null, modelError = null;
    const locallyFine = firstProblem(q, null, expected) === null;
    if (this.gemini && !q.too_dark && (locallyFine || deep || commit)) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const key = `${expected}:${await sha256Bytes(bytes)}`;
      reading = this.readings.get(key) || null;
      if (!reading) {
        try {
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          reading = await this.gemini.generate("read_frame", renderPrompt("read_frame", { expected: expectedLabel(expected) }),
            [{ data: btoa(bin), mimeType: blob.type || "image/jpeg" }]);
          this.readings.set(key, reading);
          if (this.readings.size > 32) this.readings.delete(this.readings.keys().next().value);
        } catch (err) { modelError = String(err.message || err); }
      }
    }
    const out = captureResult(q, reading, expected, lang, { front, modelError });
    out.captured = false;
    if (commit && out.status === "GOOD") {
      await this.store.add(`sessions/${sid}/documents`, {
        expected, doc_type: out.doc_type, fields: out.fields, checks: out.checks, notes: out.notes.map((n) => n.key), at: now(),
      });
      await this.funnelEvent(s, s.consents, "DOCUMENT_CAPTURED");
      await this.audit(sid, "customer", "DOCUMENT_CAPTURED", { expected, doc_type: out.doc_type });
      const docName = t(`doc.${out.doc_type || expected}`, lang);
      out.captured = true;
      out.messages = [{ key: "cap.captured", text: t("cap.captured", lang, { doc: docName }), rules: [] }, ...out.messages.slice(1)];
      out.speak = out.messages.slice(0, 2).map((m) => m.text).join(" ");
    }
    return out;
  }

  // --- questions ----------------------------------------------------------------------------
  async ask(sid, question) {
    const s = await this.load(sid);
    const lang = s.language;
    if (s.status === "IN_VIDEO_KYC") {
      // Rules register A3: prompting at the customer end invalidates video KYC. During the call
      // Sahay refuses every question with a fixed message and never calls the model.
      await this.audit(sid, "customer", "QUESTION_REFUSED_DURING_VIDEO_KYC");
      return { answer: t("relay.refuse", lang), rules: cite("A3"), refused: true };
    }
    this.require(s, "ASSIST");
    if (!this.gemini) return { answer: t("ask.unavailable", lang), rules: cite("B4"), refused: false };
    const rulesText = allRules().filter((r) => r.status === "VERIFIED")
      .map((r) => `${r.id}: ${r.summary}. Source: ${r.citation}. Quote: "${r.quote}"`).join("\n");
    const planText = s.profile && s.profile.needs ? renderPlan(plan(s.profile), "en").options
      .map((o) => `- ${o.name} [${o.status}]: ${[...o.why, ...o.blockers].map((x) => x.text).join("; ")}`).join("\n")
      : "(customer has not shared their needs yet)";
    try {
      const a = await this.gemini.generate("ask", renderPrompt("ask", {
        language: LANG_NAME[lang], rules: rulesText, plan: planText, question: maskText(String(question).trim()).slice(0, 500),
      }));
      const ids = new Set(allRules().filter((r) => r.status === "VERIFIED").map((r) => r.id));
      return { answer: maskText(a.answer), rules: cite(...a.rule_ids.filter((id) => ids.has(id))), refused: false };
    } catch (_) {
      return { answer: t("ask.unavailable", lang), rules: cite("B4"), refused: false };
    }
  }

  // --- voice mode ---------------------------------------------------------------------------
  async understand(sid, text, ask) {
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    const lang = s.language;
    const clean = maskText(String(text).trim()).slice(0, 1000);
    let u = null;
    if (this.gemini) {
      try {
        const got = await this.gemini.generate("understand", renderPrompt("understand", {
          question: t(ask === "needs" ? "voice.ask_needs" : "voice.ask_docs", "en"), answer: clean,
        }));
        u = {
          needs: got.needs.filter((n) => NEEDS.includes(n)), has_aadhaar: got.has_aadhaar ?? null, pan: got.pan ?? null,
          other_ovds: got.other_ovds || [], seeks_government_benefit: got.seeks_government_benefit ?? null,
        };
        if (ask === "documents") { u.has_aadhaar = !!u.has_aadhaar; u.pan = u.pan || "NONE"; }
      } catch (_) { u = null; }
    }
    const aiUsed = !!u;
    if (!u) u = understandLocally(clean, ask);
    await this.audit(sid, "customer", "SPEECH_UNDERSTOOD", { ask, ai: aiUsed });
    return {
      needs: [...u.needs].sort(), has_aadhaar: u.has_aadhaar, pan: u.pan, other_ovds: [...u.other_ovds].sort(),
      seeks_government_benefit: u.seeks_government_benefit, readback: readback(u, ask, lang), ai_used: aiUsed,
    };
  }

  // --- video KYC relay ----------------------------------------------------------------------
  async join(sid) {
    const s = await this.load(sid);
    this.require(s, "ASSIST");
    await this.touch(sid, { status: "IN_VIDEO_KYC" });
    await this.funnelEvent(s, s.consents, "VIDEO_KYC_JOINED");
    await this.audit(sid, "customer", "VIDEO_KYC_JOINED");
    return { message: t("relay.joined", s.language), rules: cite("A3", "A1") };
  }

  async leave(sid) {
    const s = await this.load(sid);
    if (s.status === "IN_VIDEO_KYC") { await this.touch(sid, { status: "ACTIVE" }); await this.audit(sid, "customer", "VIDEO_KYC_LEFT"); }
    return null;
  }

  async translate(text, lang, toEnglish = false) {
    if (lang === "en") return [text, true];
    if (!this.gemini) return [text, false];
    try {
      const r = await this.gemini.generate("translate", renderPrompt("translate", { language: toEnglish ? "English" : LANG_NAME[lang], text }));
      return [maskText(r.text), true];
    } catch (_) { return [text, false]; }
  }

  async addRelay(sid, s, msg) {
    const seq = s.relay.length ? s.relay[s.relay.length - 1].seq + 1 : 1;
    await this.store.create(`sessions/${sid}/relay/${pad(seq)}`, { seq, ...msg, at: now() });
    return seq;
  }

  async reply(sid, text) {
    // A typed answer from the customer, shown to the officer verbatim (not prompting: rules register A3).
    const clean = maskText(String(text || "").trim()).slice(0, 600);
    if (!clean) throw invalid("reply must not be empty");
    const s = await this.load(sid);
    if (s.status !== "IN_VIDEO_KYC") throw conflict("replies are only sent during the video KYC call");
    const [translated, ok] = await this.translate(clean, s.language, true);
    const seq = await this.addRelay(sid, s, { sender: "customer", original: clean, translated, language: "en", translated_ok: ok });
    await this.audit(sid, "customer", "CUSTOMER_REPLY_SENT", { seq, translated: ok });
    return { seq };
  }

  async relayFeed(sid, after) {
    const s = await this.load(sid);
    return s.relay.filter((m) => m.seq > after).map((m) => {
      if (m.sender === "customer") return { seq: m.seq, text: m.original, original: m.original, at: m.at, mine: true };
      let text = t("relay.official_says", s.language, { text: m.translated });
      if (!m.translated_ok) text += ` ${t("relay.untranslated", s.language)}`;
      return { seq: m.seq, text, original: m.original, at: m.at, mine: false };
    });
  }

  async officerRelay(sid, text, officer) {
    const clean = maskText(String(text || "").trim());
    if (!clean || clean.length > 600) throw invalid("message must be 1-600 characters");
    const s = await this.load(sid);
    if (s.status !== "IN_VIDEO_KYC") throw conflict("the customer is not in a video KYC session");
    const [translated, ok] = await this.translate(clean, s.language);
    const seq = await this.addRelay(sid, s, { sender: officer || "officer", original: clean, translated, language: s.language, translated_ok: ok });
    await this.audit(sid, officer, "RELAY_MESSAGE_SENT", { seq, translated: ok });
    return { seq, translated, translated_ok: ok };
  }

  async conversation(sid, after) {
    const s = await this.load(sid);
    return s.relay.filter((m) => m.seq > after).map((m) => ({
      seq: m.seq, from: m.sender === "customer" ? "customer" : "officer", original: m.original,
      translated: m.translated, translated_ok: m.translated_ok, at: m.at,
    }));
  }

  // --- referral -----------------------------------------------------------------------------
  async refer(sid, blockedStep, note) {
    const s = await this.load(sid);
    this.require(s, "REFERRAL");
    const open = s.cases.find((c) => c.status === "OPEN" || c.status === "INFO_REQUESTED");
    if (open) return { id: open.id, status: open.status };
    const id = newId();
    await this.store.create(`cases/${id}`, {
      session_id: sid, ownerUid: s.ownerUid, status: "OPEN", blocked_step: String(blockedStep).slice(0, 50),
      customer_note: note ? maskText(note).slice(0, 1000) : null, officer: null, decision_note: null,
      created_at: now(), decided_at: null, language: s.language,
    });
    await this.touch(sid, { status: "REFERRED" });
    await this.funnelEvent(s, s.consents, "REFERRED");
    await this.audit(sid, "customer", "REFERRED_TO_OFFICER", { blocked_step: String(blockedStep).slice(0, 50) });
    return { id, status: "OPEN" };
  }

  // --- scam check ---------------------------------------------------------------------------
  async scamCheck(text, lang) {
    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) throw invalid("text must not be empty");
    let ai = null;
    if (this.gemini) {
      try { ai = (await this.gemini.generate("scam", renderPrompt("scam", { message: redact(maskText(clean)) }))).signals; } catch (_) { ai = null; }
    }
    const r = assessScam(clean, lang, ai);
    try {
      await this.auth.customerUid();
      // Only the verdict and sign types: no message text, nothing about the person.
      await this.store.add("scamstats", { verdict: r.verdict, signals: r.signals.map((x) => x.key.split(".").pop()), at: now() });
    } catch (_) { /* statistics are best effort */ }
    return r;
  }

  // --- analytics and retention --------------------------------------------------------------
  async funnelEvent(s, consents, step) {
    const share = consents.length && this.current({ consents }, "RECORD_NEEDS");
    const needs = share && s.profile && s.profile.needs ? [...s.profile.needs].sort() : [];
    try { await this.store.add("funnel", { session_id: s.id, step, needs, at: now() }); } catch (_) { /* best effort */ }
  }

  sharedNeeds(s) {
    const shared = this.current(s, "RECORD_NEEDS") || this.current(s, "REFERRAL");
    return shared && s.profile && s.profile.needs ? [...s.profile.needs].sort() : [];
  }

  async purgeExpired() {
    // Rules register D3: customer data must not linger. Without a server, the officer console runs
    // the purge; in production a scheduled job (or a Firestore TTL policy) would.
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600e3).toISOString();
    const old = await this.store.list("sessions", { where: [["created_at", "<", cutoff]] });
    for (const s of old) {
      for (const sub of ["consents", "documents", "relay"]) {
        for (const d of await this.store.list(`sessions/${s.id}/${sub}`)) await this.store.remove(`sessions/${s.id}/${sub}/${d.id}`);
      }
      for (const c of await this.store.list("cases", { where: [["session_id", "==", s.id]] })) await this.store.remove(`cases/${c.id}`);
      await this.store.remove(`sessions/${s.id}`);
    }
    if (old.length) await this.audit(null, "system", "RETENTION_PURGE", { sessions: old.length });
    return old.length;
  }

  // --- officer ------------------------------------------------------------------------------
  async listCases() {
    this.requireOfficer();
    try { await this.purgeExpired(); } catch (_) { /* best effort */ }
    const cases = await this.store.list("cases", { order: ["created_at", "desc"] });
    const out = [];
    for (const c of cases) {
      let s;
      try { s = await this.load(c.session_id); } catch (_) { continue; }
      out.push({ id: c.id, status: c.status, blocked_step: c.blocked_step, created_at: c.created_at, language: s.language,
        needs: this.sharedNeeds(s), officer: c.officer });
    }
    return out;
  }

  async caseFile(caseId) {
    this.requireOfficer();
    const c = await this.store.get(`cases/${caseId}`);
    if (!c) throw notFound("case not found");
    const s = await this.load(c.session_id);
    const needs = this.sharedNeeds(s);
    const chain = await Backend.verifyChain(s.id, s.consents);
    return {
      case: { id: caseId, status: c.status, blocked_step: c.blocked_step, customer_note: c.customer_note, officer: c.officer,
        decision_note: c.decision_note, created_at: c.created_at, decided_at: c.decided_at },
      session: { id: s.id, language: s.language, status: s.status, chosen_route: s.chosen_route, bc_agent: s.bc_agent, created_at: s.created_at },
      needs,
      accommodations: needs.map((n) => ({ need: n, text: ACCOMMODATIONS[n][0], rules: cite(...ACCOMMODATIONS[n][1]) })),
      routes: s.profile && s.profile.needs ? renderPlan(plan(s.profile), "en").options : [],
      documents: s.documents.map((d) => ({ expected: d.expected, doc_type: d.doc_type, fields: d.fields, notes: d.notes.map((k) => t(k, "en")), at: d.at })),
      consent: {
        chain_valid: chain.valid, records: chain.records, broken_at: chain.broken_at,
        items: s.consents.map((x) => ({ seq: x.seq, purpose: x.purpose, granted: x.granted, language: x.language, at: x.at, hash: x.hash.slice(0, 12) })),
        rules: cite("D1"),
      },
      rules: cite("B4"),
    };
  }

  async decide(caseId, decision, note, officer) {
    this.requireOfficer();
    const mapping = { PROCEED: "PROCEEDING", REQUEST_INFO: "INFO_REQUESTED", REJECT: "REJECTED" };
    if (!mapping[decision]) throw invalid("decision must be PROCEED, REQUEST_INFO or REJECT");
    // Rules register B4: no rejection without application of mind; the reason must be recorded.
    if (decision === "REJECT" && String(note || "").trim().length < MIN_REJECTION_REASON) {
      throw invalid(`a rejection needs a written reason of at least ${MIN_REJECTION_REASON} characters (RBI KYC Directions 2025 ¶18)`);
    }
    if (!officer || officer === "anonymous") throw invalid("decisions must be attributable to a named officer");
    const c = await this.store.get(`cases/${caseId}`);
    if (!c) throw notFound("case not found");
    if (c.status === "PROCEEDING" || c.status === "REJECTED") throw conflict("this case has already been decided");
    const patch = { status: mapping[decision], officer, decision_note: String(note || "").trim() || null, decided_at: now() };
    await this.store.update(`cases/${caseId}`, patch);
    await this.audit(c.session_id, officer, `CASE_${patch.status}`, { case_id: caseId });
    return { id: caseId, status: patch.status, officer, decision_note: patch.decision_note };
  }

  async activeVideoSessions() {
    const rows = await this.store.list("sessions", { where: [["status", "==", "IN_VIDEO_KYC"]] });
    const out = [];
    for (const r of rows) {
      const s = await this.load(r.id);
      const needs = this.sharedNeeds(s);
      out.push({ id: s.id, language: s.language, needs, accommodations: needs.map((n) => ACCOMMODATIONS[n][0]), updated_at: s.updated_at });
    }
    return out;
  }

  async funnel() {
    this.requireOfficer();
    const events = await this.store.list("funnel");
    const reached = {}, needsOf = {};
    for (const e of events) {
      (reached[e.step] ||= new Set()).add(e.session_id);
      for (const n of e.needs || []) (needsOf[e.session_id] ||= new Set()).add(n);
    }
    const size = (st) => (reached[st] ? reached[st].size : 0);
    const overall = STEPS.map((step) => ({ step, sessions: size(step) }));
    const allNeeds = [...new Set(Object.values(needsOf).flatMap((s) => [...s]))].sort();
    const byNeed = {};
    for (const need of allNeeds) {
      const ids = new Set(Object.entries(needsOf).filter(([, ns]) => ns.has(need)).map(([sid]) => sid));
      byNeed[need] = STEPS.map((step) => ({ step, sessions: [...(reached[step] || [])].filter((sid) => ids.has(sid)).length }));
    }
    const needCounts = {};
    for (const ns of Object.values(needsOf)) for (const n of ns) needCounts[n] = (needCounts[n] || 0) + 1;
    const stats = await this.store.list("scamstats");
    const count = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
    return {
      steps: STEPS, overall, by_need: byNeed, sessions: size("STARTED"), need_counts: needCounts, rules: cite("B5"),
      scam_checks: { checks: stats.length, by_verdict: count(stats.map((x) => x.verdict)), by_signal: count(stats.flatMap((x) => x.signals || [])), rules: cite("G1") },
    };
  }
}
