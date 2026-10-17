/* Sahay web client: customer journey (#/), scam check (#/check), officer console (#/officer),
 * insights (#/insights).
 *
 * Accessibility rules followed throughout:
 * - Every instruction is both shown and (optionally) spoken; the voice can be switched off for
 *   screen-reader users so they do not hear everything twice.
 * - Each screen moves focus to its heading so screen readers announce where the user is.
 * - All untrusted text is inserted with textContent (never innerHTML); strict CSP, no inline code.
 */
"use strict";

const S = {
  lang: "hi", t: {}, config: null, voice: true, session: null, token: null,
  plan: null, docQueue: [], docIndex: 0, relayAfter: 0, timers: [], camera: null,
  voiceMode: false, voiceRun: null, voiceWake: null, recog: null, listening: false,
};
const SPEECH_LOCALE = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

// ---------------------------------------------------------------------------------------------
// helpers

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function tr(key, params) {
  let s = S.t[key] || key;
  for (const [k, v] of Object.entries(params || {})) s = s.replaceAll(`{${k}}`, v);
  return s;
}
function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key) || "null");
    if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* storage can be unavailable; the journey still works for this page view */ }
  return null;
}
function stopTimers() {
  S.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  S.timers = [];
  stopCamera();
  stopListening();
  S.voiceRun = null; // ends any voice conversation that belonged to the previous screen
  S.voiceWake = null;
}

function toast(message, isError) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.className = "show" + (isError ? " error" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { node.className = ""; }, isError ? 6000 : 3000);
}

function announce(text) {
  const a = document.getElementById("announcer");
  a.textContent = "";
  setTimeout(() => { a.textContent = text; }, 30);
}

// ---------------------------------------------------------------------------------------------
// icons (inline SVG, drawn on a 24px grid; decorative, so hidden from screen readers)

const ICONS = {
  back: ["M15 18l-6-6 6-6"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M9 12l2 2 4-4"],
  speaker: ["M11 5L6 9H2v6h4l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  mute: ["M11 5L6 9H2v6h4l5 4V5z", "M23 9l-6 6", "M17 9l6 6"],
  text: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
  person: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "c:12,7,4"],
  exit: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  check: ["M20 6L9 17l-5-5"],
  star: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"],
  camera: ["M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z", "c:12,13,4"],
  stop: ["r:6,6,12,12,2"],
  video: ["M23 7l-7 5 7 5V7z", "r:1,5,15,14,2"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  repeat: ["M17 1l4 4-4 4", "M3 11V9a4 4 0 0 1 4-4h14", "M7 23l-4-4 4-4", "M21 13v2a4 4 0 0 1-4 4H3"],
  eyeoff: ["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94", "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19", "M1 1l22 22"],
  ear: ["M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0", "M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4"],
  smile: ["c:12,12,10", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01"],
  fingerprint: ["M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4", "M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2", "M17.29 21.02c.12-.6.43-2.3.5-3.02", "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", "M8.65 22c.21-.66.45-1.32.57-2", "M14 13.12c0 2.38 0 6.38-1 8.88", "M21.8 16c.2-2 .13-5.35 0-6", "M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"],
  pen: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"],
  home: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
  phoneoff: ["r:6,2,12,20,2", "M2 2l20 20"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  chev: ["M9 18l6-6-6-6"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  chart: ["M18 20V10", "M12 20V4", "M6 20v-6"],
  help: ["c:12,12,10", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
};
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICONS[name] || []) {
    let node;
    if (d.startsWith("c:")) {
      const [cx, cy, r] = d.slice(2).split(",");
      node = document.createElementNS(SVG_NS, "circle"); node.setAttribute("cx", cx); node.setAttribute("cy", cy); node.setAttribute("r", r);
    } else if (d.startsWith("r:")) {
      const [x, y, w, h, rx] = d.slice(2).split(",");
      node = document.createElementNS(SVG_NS, "rect"); node.setAttribute("x", x); node.setAttribute("y", y); node.setAttribute("width", w); node.setAttribute("height", h); node.setAttribute("rx", rx);
    } else {
      node = document.createElementNS(SVG_NS, "path"); node.setAttribute("d", d);
    }
    svg.appendChild(node);
  }
  return svg;
}

// Sticky bottom actions, like a native app's primary buttons.
function actions(...children) { return el("div", { class: "actions" }, ...children); }

// ---------------------------------------------------------------------------------------------
// app bar: back, language, menu

function syncBack() {
  const b = document.getElementById("back-btn");
  if (b) b.hidden = !S.back;
}

async function goBack() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (S.back) await S.back();
}

// Exit: forget this session on this device and start again. Session data on the server is
// deleted automatically after the retention period (rules register D3).
async function exitSession(confirmFirst) {
  if (confirmFirst && !window.confirm(tr("ui.exit_confirm"))) return;
  try {
    if (S.session && S.session.status === "IN_VIDEO_KYC") await api(`/api/sessions/${S.session.id}/video-kyc/leave`, { method: "POST" });
  } catch (_) { /* leaving anyway */ }
  store("sahay.session", null);
  S.session = null; S.token = null; S.plan = null; S.skipped = null; S.relayAfter = 0;
  S.voiceMode = false; store("sahay.voiceMode", null);
  if (location.hash && location.hash !== "#/") location.hash = "#/"; else route();
}

function menuItem(iconName, label, hint, onclick, cls) {
  return el("button", { class: `menu-item ${cls || ""}`, type: "button", onclick: () => { document.getElementById("menu").close(); onclick(); } },
    icon(iconName), el("span", {}, label, hint ? el("span", { class: "hint", text: hint }) : null));
}

function openMenu() {
  const items = document.getElementById("menu-items");
  clear(items);
  const officerSide = /^#\/(officer|insights)/.test(location.hash);
  items.append(el("h2", { text: tr("ui.menu") }));
  if (officerSide) {
    items.append(
      menuItem("list", "Live calls and cases", null, () => { location.hash = "#/officer"; }),
      menuItem("chart", "Accessibility insights", null, () => { location.hash = "#/insights"; }),
      menuItem("home", "Customer app", null, () => { location.hash = "#/"; }),
      el("div", { class: "menu-sep" }),
      menuItem("exit", "Sign out", null, officerSignOut, "danger"));
  } else {
    items.append(
      menuItem(S.voice ? "speaker" : "mute", S.voice ? tr("ui.voice_on") : tr("ui.voice_off"), tr("ui.voice_hint"), () => {
        S.voice = !S.voice; store("sahay.voice", S.voice);
        if (!S.voice && window.speechSynthesis) speechSynthesis.cancel();
        toast(S.voice ? tr("ui.voice_on") : tr("ui.voice_off"));
      }),
      menuItem("text", tr("ui.text_size"), tr("ui.text_size_hint"), () => { S.textSize = applyTextSize((S.textSize || 0) + 1); }),
      menuItem("shield", tr("ui.scam_title"), null, () => { location.hash = "#/check"; }));
    if (S.session && S.session.consents && S.session.consents.ASSIST && S.session.status !== "REFERRED") {
      items.append(menuItem("person", tr("ui.help_officer"), null, askForOfficer));
    }
    if (S.session) {
      items.append(el("div", { class: "menu-sep" }), menuItem("exit", tr("ui.exit"), tr("ui.exit_hint"), () => exitSession(true), "danger"));
    }
  }
  document.getElementById("menu").showModal();
}

// ---------------------------------------------------------------------------------------------
// speech

let voicesWarned = false;
function pickVoice(lang) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const want = SPEECH_LOCALE[lang];
  let v = voices.find((x) => x.lang === want) || voices.find((x) => x.lang && x.lang.startsWith(lang));
  if (!v && lang === "mr") {
    v = voices.find((x) => x.lang === "hi-IN");
    if (v && !voicesWarned) { voicesWarned = true; toast(tr("ui.mr_voice_missing")); }
  }
  return v || null;
}

// Speaks and resolves when finished, so voice mode can listen only after Sahay stops talking
// (otherwise the microphone hears Sahay's own voice).
function speak(text, force, lang) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    announce(text);
    if (!(S.voice || force || S.voiceMode) || !window.speechSynthesis) return resolve();
    speechSynthesis.cancel();
    const l = lang || S.lang;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LOCALE[l];
    const v = pickVoice(l);
    if (v) u.voice = v;
    u.rate = 0.92;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onend = finish; u.onerror = finish;
    setTimeout(finish, 2500 + text.length * 110); // some browsers never fire onend
    speechSynthesis.speak(u);
  });
}

// ---------------------------------------------------------------------------------------------
// listening (voice mode)

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function stopListening() {
  if (S.recog) { try { S.recog.abort(); } catch (_) { /* already stopped */ } }
  S.recog = null; S.listening = false;
  document.body.classList.remove("is-listening");
}

function listen(lang) {
  return new Promise((resolve) => {
    if (!Recognition) { toast(tr("ui.no_mic"), true); return resolve(null); }
    stopListening();
    const r = new Recognition();
    r.lang = SPEECH_LOCALE[lang || S.lang];
    r.interimResults = false;
    r.maxAlternatives = 3;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true; S.listening = false; document.body.classList.remove("is-listening");
      resolve(value);
    };
    r.onresult = (e) => finish([...e.results[0]].map((a) => a.transcript).join(" | "));
    r.onerror = () => finish(null);
    r.onend = () => finish(null);
    S.recog = r; S.listening = true;
    document.body.classList.add("is-listening");
    try { r.start(); } catch (_) { finish(null); }
  });
}

const WORDS = {
  yes: ["yes", "yeah", "yep", "haan", "han", "haa", "ha", "ho", "hoy", "ok", "okay", "correct", "right", "sahi", "theek", "thik", "barobar",
    "हाँ", "हां", "हा", "हो", "होय", "जी", "ठीक", "सही", "बरोबर", "चालेल"],
  no: ["no", "nope", "nahi", "nahin", "nai", "nako", "नहीं", "नही", "नाही", "नको", "गलत", "चूक"],
  next: ["next", "aage", "agla", "agle", "pudhe", "pudhcha", "dusra", "doosra", "आगे", "अगला", "अगले", "पुढे", "पुढचा", "पुढील", "दूसरा", "दुसरा", "नंतर"],
  repeat: ["repeat", "again", "phir", "dobara", "punha", "फिर", "दोबारा", "पुन्हा", "परत"],
  join: ["join", "start", "call", "jud", "judo", "shuru", "suru", "जुड़", "जुड़ें", "जुड़िए", "शुरू", "सुरू", "कॉल"],
  hi: ["hindi", "हिंदी", "हिन्दी"],
  mr: ["marathi", "मराठी"],
  en: ["english", "इंग्लिश", "इंग्रजी", "अंग्रेजी", "अंग्रेज़ी"],
};

function intent(text, kinds) {
  if (!text) return null;
  const tokens = text.toLowerCase().split(/[\s,.!?।|]+/).filter(Boolean);
  for (const kind of kinds) if (tokens.some((tok) => WORDS[kind].includes(tok))) return kind;
  return null;
}

function speechBox(text, kind) {
  const ic = { good: "check", warn: "help", danger: "shield" }[kind] || "speaker";
  return el("div", { class: `speech ${kind || ""}`, role: "status" }, el("span", { class: "icon", "aria-hidden": "true" }, icon(ic)), el("span", { text }));
}

// ---------------------------------------------------------------------------------------------
// API

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (S.token) headers["X-Session-Token"] = S.token;
  const officer = store("sahay.officer") || {};
  if (path.startsWith("/api/officer") || path.startsWith("/api/insights")) {
    if (officer.name) headers["X-User"] = officer.name;
    if (officer.key) headers["X-Officer-Key"] = officer.key;
  }
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  // Firebase edition: the same API is served by an in-browser backend (firebase/public/js).
  if (window.SAHAY_LOCAL_API) return window.SAHAY_LOCAL_API(path, Object.assign({}, opts, { headers }));
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

// Citations come from the rules register in English ("RBI KYC Directions 2025 ¶23 Explanation 2").
// Customers see the source names and the few words around the paragraph numbers in their language.
const CITE_TERMS = [
  ["RBI KYC Directions 2025", "cite.rbi_kyc"], ["Supreme Court, Pragya Prasun (2025)", "cite.supreme_court"],
  ["RBI caution on KYC frauds (2 Feb 2024)", "cite.rbi_fraud"], ["Explanation", "cite.explanation"],
  ["third proviso", "cite.third_proviso"], ["modus operandi", "cite.modus_operandi"], ["Don'ts", "cite.donts"],
  ["Do's", "cite.dos"], ["reporting", "cite.reporting"],
];
function cite(rules) {
  let text = [...new Set(rules.map((r) => r.citation))].join(" · ");
  if (S.lang !== "en") for (const [en, key] of CITE_TERMS) text = text.split(en).join(tr(key));
  return text;
}

function preferredLanguage() {
  const saved = store("sahay.lang");
  if (saved) return saved;
  for (const l of navigator.languages || [navigator.language || ""]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code === "hi" || code === "mr" || code === "en") return code;
  }
  return "en";
}

async function loadCatalog(lang) {
  S.lang = lang;
  S.t = await api(`/api/i18n/${lang}`);
  document.documentElement.lang = lang;
  document.getElementById("lang-select").value = lang;
  document.querySelector(".brand span").textContent = tr("ui.brand");
  document.querySelector(".brand").setAttribute("aria-label", tr("ui.brand"));
  document.querySelector(".skip").textContent = tr("ui.skip_to_content");
  document.title = tr("ui.brand");
  updateVoiceToggle();
  store("sahay.lang", lang);
}

function updateVoiceToggle() { /* voice on/off now lives in the menu */ }

// ---------------------------------------------------------------------------------------------
// routing

function route() {
  stopTimers();
  if (window.speechSynthesis) speechSynthesis.cancel();
  const main = document.getElementById("main");
  main.className = "";
  S.back = null;
  syncBack();
  const hash = location.hash;
  if (hash.startsWith("#/officer")) return officerView(main);
  if (hash.startsWith("#/insights")) return insightsView(main);
  if (hash.startsWith("#/check")) return scamView(main);
  if (hash.startsWith("#/voice")) return voiceWelcome(main);
  return customerResume(main);
}

function screen(main, title, ...children) {
  clear(main);
  syncBack();
  const h = el("h1", { text: title, tabindex: "-1" });
  main.append(h, ...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  h.focus();
  window.scrollTo(0, 0);
  return h;
}

const STEPS = ["consent", "needs", "plan", "docs", "call"];
function stepper(current) {
  const n = STEPS.indexOf(current) + 1;
  return el("div", { class: "progress" },
    el("span", {}, el("span", { text: tr("ui.step", { n, total: STEPS.length }) }), " · ", el("strong", { text: tr(`step.${current}`) })),
    el("ol", { "aria-hidden": "true" }, STEPS.map((k, i) =>
      el("li", { class: i + 1 < n ? "done" : i + 1 === n ? "now" : "" }))));
}

const TEXT_SIZES = [18, 21, 24];
function applyTextSize(i) {
  const idx = ((i % TEXT_SIZES.length) + TEXT_SIZES.length) % TEXT_SIZES.length;
  document.documentElement.style.fontSize = `${TEXT_SIZES[idx]}px`;
  try { localStorage.setItem("sahay.textSize", String(idx)); } catch (_) { /* optional */ }
  return idx;
}

// ---------------------------------------------------------------------------------------------
// customer journey

async function customerResume(main) {
  const saved = store("sahay.session");
  if (saved && saved.id && saved.token) {
    S.token = saved.token;
    try {
      S.session = await api(`/api/sessions/${saved.id}`);
      if (S.session.language !== S.lang) await loadCatalog(S.session.language);
      return nextStep(main);
    } catch (_) { store("sahay.session", null); S.token = null; }
  }
  return welcome(main);
}

function nextStep(main) {
  const s = S.session;
  if (s.status === "IN_VIDEO_KYC") return callScreen(main);
  if (s.status === "REFERRED") return referredScreen(main);
  if (S.voiceMode) {
    if (!s.consents.ASSIST) return voiceConsent(main);
    if (!s.profile || !s.profile.needs) return voiceNeeds(main);
    if (!s.chosen_route) return voicePlan(main);
  }
  if (!s.consents.ASSIST) return consentScreen(main);
  if (!s.profile || !s.profile.needs) return needsScreen(main);
  if (!s.chosen_route) return planScreen(main);
  return documentsScreen(main);
}

function welcome(main) {
  clear(main);
  S.back = null; syncBack();
  S.voiceMode = false; store("sahay.voiceMode", null);
  const langs = [["hi", "हिन्दी", "हिन्दी में आगे बढ़ें"], ["mr", "मराठी", "मराठीत पुढे चला"], ["en", "English", "Continue in English"]];
  const h = el("h1", { text: tr("ui.brand"), tabindex: "-1" });
  // The voice button is the biggest thing on the screen: someone who cannot see it finds it by
  // tapping almost anywhere in the middle of the phone.
  const voiceBtn = el("button", { class: "voice-cta", type: "button", "aria-label": "Talk to Sahay. बोलकर चलाएँ. बोलून वापरा.",
    onclick: () => { location.hash = "#/voice"; } },
  el("span", { class: "voice-cta-inner" }, el("span", { class: "mic" }, icon("mic")),
    el("span", { class: "voice-cta-label", text: tr("ui.voice_mode") })));
  main.append(el("section", { class: "welcome" }, h,
    el("p", { class: "lead", text: tr("ui.tagline") }),
    voiceBtn,
    el("p", { class: "voice-cta-hint", text: tr("ui.voice_mode_hint") }),
    el("p", { class: "small muted", text: tr("ui.or_choose_language") }),
    el("div", { class: "lang-grid" }, langs.map(([code, label, sub]) =>
      el("button", { class: "btn", type: "button", lang: code, onclick: () => start(code) }, el("span", { text: label }), el("span", { class: "sub", text: sub })))),
    el("a", { class: "scam-card scam-link", href: "#/check" }, icon("shield"),
      el("span", {}, el("strong", { text: tr("ui.scam_open") }), el("span", { class: "small muted", text: tr("ui.scam_private") })))));
  h.focus();
}

async function start(lang, voice) {
  try {
    await loadCatalog(lang);
    const res = await api("/api/sessions", { method: "POST", json: { language: lang } });
    S.token = res.token;
    S.session = res;
    store("sahay.session", { id: res.id, token: res.token });
    const main = document.getElementById("main");
    if (voice) { if (location.hash !== "#/") history.replaceState(null, "", "#/"); return voiceConsent(main); }
    consentScreen(main);
  } catch (err) { toast(err.message, true); }
}

function consentScreen(main) {
  S.back = () => exitSession(false);
  const text = tr("consent.assist");
  screen(main, tr("ui.consent_title"), stepper("consent"),
    speechBox(text),
    el("div", { class: "row" }, readAloudButton(text)),
    actions(
      el("button", { class: "btn primary block", type: "button", text: tr("ui.agree"), onclick: () => giveConsent("ASSIST", true) }),
      el("button", { class: "btn quiet block", type: "button", text: tr("ui.disagree"), onclick: () => giveConsent("ASSIST", false) })));
  speak(text);
}

function readAloudButton(text) {
  return el("button", { class: "btn quiet small", type: "button", onclick: () => speak(text, true) }, icon("speaker"), tr("ui.read_aloud"));
}

async function giveConsent(purpose, granted) {
  try {
    S.session = await api(`/api/sessions/${S.session.id}/consents`, { method: "POST", json: { purpose, granted } });
    const main = document.getElementById("main");
    if (purpose === "ASSIST" && !granted) {
      screen(main, tr("ui.consent_title"), speechBox(tr("ui.no_consent"), "warn"));
      speak(tr("ui.no_consent"));
      return;
    }
    if (purpose === "ASSIST") (S.voiceMode ? voiceNeeds : needsScreen)(main);
  } catch (err) { toast(err.message, true); }
}

const NEEDS = ["BLIND_LOW_VISION", "DEAF_HARD_OF_HEARING", "NO_FACIAL_GESTURES", "FINGERPRINTS_UNREADABLE",
  "CANNOT_SIGN", "CANNOT_TRAVEL", "NO_OWN_MOBILE", "NEEDS_SIMPLE_LANGUAGE"];
const OVDS = ["PASSPORT", "VOTER_ID", "DRIVING_LICENCE", "NREGA_JOB_CARD", "NPR_LETTER"];

function checkbox(name, value, label, checked) {
  return el("label", { class: "option" }, el("input", { type: "checkbox", name, value, checked: !!checked }), el("span", { text: label }));
}

const NEED_ICONS = {
  BLIND_LOW_VISION: "eyeoff", DEAF_HARD_OF_HEARING: "ear", NO_FACIAL_GESTURES: "smile", FINGERPRINTS_UNREADABLE: "fingerprint",
  CANNOT_SIGN: "pen", CANNOT_TRAVEL: "home", NO_OWN_MOBILE: "phoneoff", NEEDS_SIMPLE_LANGUAGE: "book",
};
function tile(name, value, label, checked) {
  return el("label", { class: "tile" }, el("input", { type: "checkbox", name, value, checked: !!checked }),
    icon(NEED_ICONS[value] || "help"), el("span", { text: label }), el("span", { class: "tick", "aria-hidden": "true" }, icon("check")));
}

function radio(name, value, label, checked) {
  return el("label", { class: "option" }, el("input", { type: "radio", name, value, checked: !!checked }), el("span", { text: label }));
}

function needsScreen(main) {
  S.back = () => exitSession(true);
  const p = S.session.profile || {};
  const needs = new Set(p.needs || []);
  const ovds = new Set(p.other_ovds || []);
  const form = el("form", { onsubmit: submitNeeds },
    Recognition ? el("button", { class: "voice-alt", type: "button",
      onclick: () => { S.voiceMode = true; store("sahay.voiceMode", true); voiceNeeds(document.getElementById("main")); } },
    icon("mic"), el("span", { text: tr("ui.tell_instead") })) : null,
    el("fieldset", {}, el("legend", { text: tr("ui.needs_hint") }),
      el("div", { class: "tiles" }, NEEDS.map((n) => tile("need", n, tr(`need.${n}`), needs.has(n))))),
    el("fieldset", {}, el("legend", { text: tr("ui.docs_title") }),
      checkbox("has_aadhaar", "1", tr("doc.AADHAAR"), p.has_aadhaar !== false),
      checkbox("share_aadhaar", "1", tr("ui.share_aadhaar"), p.share_aadhaar !== false),
      checkbox("aadhaar_mobile_linked", "1", tr("ui.aadhaar_mobile"), p.aadhaar_mobile_linked),
      OVDS.map((o) => checkbox("ovd", o, tr(`doc.${o}`), ovds.has(o))),
      checkbox("has_ckyc_identifier", "1", tr("ui.ckyc"), p.has_ckyc_identifier)),
    el("fieldset", {}, el("legend", { text: tr("ui.pan_question") }),
      radio("pan", "CARD", tr("doc.PAN"), (p.pan || "CARD") === "CARD"),
      radio("pan", "E_PAN", tr("ui.epan"), p.pan === "E_PAN"),
      radio("pan", "NONE", tr("ui.no_pan"), p.pan === "NONE")),
    el("fieldset", {},
      checkbox("seeks_government_benefit", "1", tr("ui.govt_benefit"), p.seeks_government_benefit),
      checkbox("record_needs", "1", tr("ui.record_needs"), S.session.consents.RECORD_NEEDS),
      el("p", { class: "small muted", text: tr("consent.record_needs") })),
    actions(el("button", { class: "btn primary block", type: "submit", text: tr("ui.continue") })));
  screen(main, tr("ui.needs_title"), stepper("needs"), form);
  speak(`${tr("ui.needs_title")} ${tr("ui.needs_hint")}`);
}

async function submitNeeds(event) {
  event.preventDefault();
  const f = event.target;
  const checked = (name) => [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const profile = {
    needs: checked("need"),
    has_aadhaar: checked("has_aadhaar").length > 0,
    share_aadhaar: checked("share_aadhaar").length > 0,
    aadhaar_mobile_linked: checked("aadhaar_mobile_linked").length > 0,
    pan: (f.querySelector('input[name="pan"]:checked') || { value: "CARD" }).value,
    other_ovds: checked("ovd"),
    has_ckyc_identifier: checked("has_ckyc_identifier").length > 0,
    seeks_government_benefit: checked("seeks_government_benefit").length > 0,
  };
  try {
    const wantRecord = checked("record_needs").length > 0;
    if (wantRecord !== !!S.session.consents.RECORD_NEEDS) {
      S.session = await api(`/api/sessions/${S.session.id}/consents`, { method: "POST", json: { purpose: "RECORD_NEEDS", granted: wantRecord } });
    }
    S.session = await api(`/api/sessions/${S.session.id}/profile`, { method: "PUT", json: profile });
    planScreen(document.getElementById("main"));
  } catch (err) { toast(err.message, true); }
}

function points(list, title) {
  if (!list || !list.length) return null;
  return el("div", {}, title ? el("h3", { text: title }) : null,
    el("ul", { class: "points" }, list.map((p) => el("li", {}, el("span", { text: p.text }),
      p.rules.length ? el("span", { class: "cite", text: cite(p.rules) }) : null))));
}

function routeHero(o) {
  return el("section", { class: "route-hero route RECOMMENDED", "aria-label": o.name },
    el("span", { class: "badge" }, icon("star"), o.status_text),
    el("h2", { text: o.name }),
    el("p", { text: o.summary }),
    o.why.length ? el("ul", { class: "why" }, o.why.map((pt) => el("li", {}, icon("check"), el("span", { text: pt.text })))) : null,
    o.documents.length ? el("div", {}, el("h3", { text: tr("ui.what_you_need") }),
      el("div", { class: "need" }, o.documents.map((d) => el("span", { text: d.text })))) : null,
    el("button", { class: "btn primary block", type: "button", text: tr("ui.choose_route"), onclick: () => chooseRoute(o.route) }),
    el("details", {}, el("summary", { text: tr("ui.why_allowed") }),
      points(o.why), points([...o.accommodations, ...o.cautions, ...o.limits], tr("ui.good_to_know")),
      el("span", { class: "cite", text: cite(o.rules) })));
}

function routeCard(o, primary) {
  if (primary && o.status === "RECOMMENDED") return routeHero(o);
  const available = o.status !== "NOT_AVAILABLE";
  return el("section", { class: `card route ${o.status}`, "aria-label": o.name },
    el("div", { class: "row-top" }, el("h2", { text: o.name }), el("span", { class: `status ${o.status}`, text: o.status_text })),
    el("p", { class: "muted", text: o.summary }),
    o.blockers.length ? points(o.blockers) : null,
    el("details", {}, el("summary", { text: tr("ui.more_details") }),
      points(o.why),
      o.documents.length ? points(o.documents.map((d) => ({ text: d.text, rules: [] })), tr("ui.what_you_need")) : null,
      points([...o.accommodations, ...o.cautions, ...o.limits], tr("ui.good_to_know")),
      el("span", { class: "cite", text: cite(o.rules) })),
    available ? el("button", { class: "btn block", type: "button", text: tr("ui.choose_route"), onclick: () => chooseRoute(o.route) }) : null);
}

async function planScreen(main) {
  S.back = () => needsScreen(document.getElementById("main"));
  try {
    S.plan = await api(`/api/sessions/${S.session.id}/plan`);
  } catch (err) { toast(err.message, true); return; }
  const [first, ...rest] = S.plan.options;
  const available = rest.filter((o) => o.status !== "NOT_AVAILABLE");
  const unavailable = rest.filter((o) => o.status === "NOT_AVAILABLE");
  screen(main, tr("ui.plan_title"), stepper("plan"),
    routeCard(first, true),
    points(S.plan.always),
    available.length ? el("h2", { class: "section-title", text: tr("ui.other_options") }) : null,
    available.map((o) => routeCard(o, false)),
    unavailable.length ? el("details", { class: "card" }, el("summary", { text: tr("ui.not_available") }),
      el("div", { class: "stack" }, unavailable.map((o) => routeCard(o, false)))) : null);
  const why = first.why.map((p) => p.text).join(" ");
  speak(`${first.status_text}: ${first.name}. ${first.summary} ${why}`);
}

async function chooseRoute(routeName) {
  try {
    S.session = await api(`/api/sessions/${S.session.id}/route`, { method: "POST", json: { route: routeName } });
    documentsScreen(document.getElementById("main"));
  } catch (err) { toast(err.message, true); }
}

function docsForRoute() {
  const option = (S.plan && S.plan.options.find((o) => o.route === S.session.chosen_route)) || null;
  const keys = option ? option.documents.map((d) => d.key) : ["doc.ANY_OVD"];
  return keys.map((k) => k.replace("doc.", "")).filter((k) => ["AADHAAR", "PAN", "ANY_OVD"].includes(k));
}

async function documentsScreen(main) {
  if (!S.plan) {
    try { S.plan = await api(`/api/sessions/${S.session.id}/plan`); } catch (err) { toast(err.message, true); return; }
  }
  const needed = docsForRoute();
  const have = new Set(S.session.documents.map((d) => d.expected));
  const next = needed.find((d) => !have.has(d) && !(S.skipped || new Set()).has(d));
  if (next) return captureScreen(main, next);
  return readyScreen(main);
}

const SAMPLES = [
  ["good", "aadhaar-good"], ["cut", "aadhaar-cut-right"], ["dark", "aadhaar-dark"], ["glare", "aadhaar-glare"],
  ["blurry", "aadhaar-blurry"], ["close", "aadhaar-too-close"], ["none", "no-document"],
];

function captureScreen(main, expected) {
  const docName = tr(`doc.${expected}`);
  const status = el("p", { class: "cam-status", role: "status", text: tr("cap.no_document") });
  const checking = el("span", { class: "cam-checking", hidden: true, text: tr("ui.checking") });
  const view = el("div", { class: "camera" },
    el("div", { class: "placeholder", text: docName }),
    el("div", { class: "guide", "aria-hidden": "true" }), status, checking);
  // One frame in flight at a time; a new frame is taken only after the previous answer arrives.
  // The sample buttons and "take photo" never wait on the camera loop: they stop it first.
  let running = false, inFlight = false, frameNo = 0, goodRun = 0;
  let front = false, lastShownKey = "", candidateKey = "", candidateCount = 0, spokenKey = "", spokenAt = 0;
  let video = null;
  const canvas = document.createElement("canvas");

  async function send(blob, opts) {
    const form = new FormData();
    form.append("image", blob, "frame.jpg");
    const q = new URLSearchParams({ expected, commit: String(!!opts.commit), deep: String(!!opts.deep), camera: front ? "front" : "rear" });
    const slow = setTimeout(() => { checking.hidden = false; }, 1200);
    try { return await api(`/api/sessions/${S.session.id}/capture?${q}`, { method: "POST", body: form }); }
    finally { clearTimeout(slow); checking.hidden = true; }
  }

  function show(result) {
    const key = result.messages[0] ? result.messages[0].key : "";
    status.textContent = result.speak;
    view.className = `camera ${result.status === "GOOD" ? "good" : ""}`;
    lastShownKey = key;
    // Speak an instruction only once it has been the same for two frames (so a shaky hand does not
    // make Sahay jump between instructions), and repeat the same one at most every 7 seconds.
    candidateCount = key === candidateKey ? candidateCount + 1 : 1;
    candidateKey = key;
    const now = Date.now();
    const busySpeaking = window.speechSynthesis && speechSynthesis.speaking;
    const due = key !== spokenKey ? candidateCount >= 2 || result.status === "GOOD" : now - spokenAt > 7000;
    if (due && !(busySpeaking && key === spokenKey)) {
      spokenKey = key; spokenAt = now;
      speak(result.speak);
    }
  }

  async function finish(done) {
    stop();
    if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    clear(status); status.textContent = done.speak;
    view.className = "camera good";
    const notes = (done.notes || []).map((n) => n.text).join(" ");
    await speak(`${done.speak} ${notes}`);
    S.session = await api(`/api/sessions/${S.session.id}`);
    documentsScreen(document.getElementById("main"));
  }

  function grab() {
    if (!video || !video.videoWidth) return null;
    canvas.width = Math.min(1280, video.videoWidth);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  }

  async function tick() {
    if (!running) return;
    const blob = await grab();
    if (blob && !inFlight) {
      inFlight = true;
      frameNo += 1;
      try {
        // Every fourth frame, if the local checks still see no card, ask Gemini to look too.
        const deep = frameNo % 4 === 0 && ["cap.no_document", "cap.move_closer"].includes(lastShownKey);
        const result = await send(blob, { deep });
        if (!running) return;
        show(result);
        goodRun = result.status === "GOOD" ? goodRun + 1 : 0;
        if (goodRun >= 2) {
          const done = await send(blob, { commit: true });
          if (done.captured) return finish(done);
        }
      } catch (err) { toast(err.message, true); }
      finally { inFlight = false; }
    }
    if (running) S.timers.push(setTimeout(tick, 900));
  }

  function stop() {
    running = false;
    stopCamera();
    setCamBtn(false);
  }

  async function startCamera() {
    if (running) return stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      const settings = stream.getVideoTracks()[0].getSettings();
      front = settings.facingMode !== "environment"; // laptops report "user" or nothing
      video = el("video", { autoplay: true, playsinline: true, muted: true, "aria-label": docName, class: front ? "mirror" : "" });
      video.srcObject = stream;
      const old = view.querySelector(".placeholder, video, img");
      if (old) old.replaceWith(video); else view.prepend(video);
      S.camera = stream;
      running = true;
      setCamBtn(true);
      S.timers.push(setTimeout(tick, 600));
    } catch (_) {
      status.textContent = tr("ui.camera_denied");
      speak(tr("ui.camera_denied"));
    }
  }

  async function takeNow() {
    const blob = running ? await grab() : null;
    if (!blob) return startCamera();
    try {
      const done = await send(blob, { commit: true, deep: true });
      if (done.captured) return finish(done);
      show(done);
      speak(done.speak);
    } catch (err) { toast(err.message, true); }
  }

  async function trySample(file) {
    stop();
    try {
      const blob = await (await fetch(`specimens/specimen-${file}.jpg`)).blob();
      const old = view.querySelector(".placeholder, video, img");
      const img = el("img", { src: URL.createObjectURL(blob), alt: docName });
      if (old) old.replaceWith(img); else view.prepend(img);
      front = false;
      const result = await send(blob, {});
      show(result); spokenKey = ""; speak(result.speak);
      if (result.status === "GOOD") {
        const done = await send(blob, { commit: true });
        if (done.captured) return finish(done);
      }
    } catch (err) { toast(err.message, true); }
  }

  const camBtn = el("button", { class: "btn primary", type: "button", onclick: startCamera });
  function setCamBtn(on) {
    clear(camBtn);
    camBtn.append(icon(on ? "stop" : "camera"), on ? tr("ui.stop_camera") : tr("ui.start_camera"));
  }
  setCamBtn(false);
  S.back = () => { stop(); planScreen(document.getElementById("main")); };
  const sampleSet = expected === "PAN" ? [["good", "pan-good"], ...SAMPLES.slice(1)] : SAMPLES;
  screen(main, tr("ui.capture_title", { doc: docName }), stepper("docs"),
    view,
    el("div", { class: "cam-actions" }, camBtn,
      el("button", { class: "shutter", type: "button", "aria-label": tr("ui.take_photo"), title: tr("ui.take_photo"), onclick: takeNow }, icon("camera")),
      el("button", { class: "btn quiet", type: "button", text: tr("ui.skip_document"), onclick: () => {
        stop(); S.skipped = S.skipped || new Set(); S.skipped.add(expected); documentsScreen(document.getElementById("main"));
      } })),
    el("details", { class: "card" }, el("summary", { text: tr("ui.sample_cards") }),
      el("p", { class: "small muted", text: tr("ui.specimen_note") }),
      el("div", { class: "samples" }, sampleSet.map(([label, file]) =>
        el("button", { class: "btn quiet small", type: "button", text: tr(`ui.sample.${label}`), onclick: () => trySample(file) })))),
    helpDock());
  if (S.voiceMode) {
    speak(tr("voice.capture_intro", { doc: docName }), true).then(() => { if (!running && S.camera === null) startCamera(); });
  } else {
    speak(`${tr("ui.capture_title", { doc: docName })}. ${tr("cap.no_document")}`);
  }
}

function stopCamera() {
  if (S.camera) { S.camera.getTracks().forEach((t) => t.stop()); S.camera = null; }
}

function readyScreen(main) {
  S.back = () => planScreen(document.getElementById("main"));
  const isVideo = S.session.chosen_route === "VIDEO_KYC";
  const option = S.plan.options.find((o) => o.route === S.session.chosen_route);
  const docs = el("ul", { class: "doc-list" }, S.session.documents.map((d) =>
    el("li", {}, el("span", { class: "tick", "aria-hidden": "true" }, icon("check")),
      el("span", { text: `${tr(`doc.${d.doc_type || d.expected}`)}${d.fields && d.fields.name ? ` · ${d.fields.name}` : ""}` }))));
  const message = isVideo ? tr("caution.no_prompting") : tr("ui.next_steps_inperson");
  screen(main, tr("ui.ready_title"), stepper("call"),
    el("div", { class: "card stack" }, el("h2", { text: option ? option.name : "" }), docs),
    speechBox(message, isVideo ? "warn" : ""),
    el("details", { class: "card" }, el("summary", { text: tr("ui.ask_title") }), askPanel()),
    isVideo ? actions(el("button", { class: "btn primary block", type: "button", onclick: joinCall }, icon("video"), tr("ui.join_video"))) : null);
  if (S.voiceMode && isVideo) return voiceReady();
  speak(`${tr("ui.ready_title")}. ${message}`);
}

async function joinCall() {
  try {
    const res = await api(`/api/sessions/${S.session.id}/video-kyc/join`, { method: "POST" });
    S.session = await api(`/api/sessions/${S.session.id}`);
    callScreen(document.getElementById("main"), res.message);
  } catch (err) { toast(err.message, true); }
}

function callScreen(main, intro) {
  // Captions are the main channel: large text for deaf and hard-of-hearing customers, read aloud
  // for blind ones. New messages flash the caption and vibrate the phone so they are not missed.
  S.back = () => leaveCall(true);
  const caption = el("div", { class: "caption", "aria-live": "polite", text: tr("ui.waiting_official") });
  const log = el("ol", { class: "chat", "aria-label": tr("ui.in_call_title") });
  let last = "";
  const replyInput = el("textarea", { rows: 2, maxLength: 600, placeholder: tr("ui.reply_placeholder"), "aria-label": tr("ui.reply_title") });
  const replyForm = el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    if (!replyInput.value.trim()) return;
    try {
      await api(`/api/sessions/${S.session.id}/video-kyc/reply`, { method: "POST", json: { text: replyInput.value } });
      replyInput.value = "";
      poll();
    } catch (err) { toast(err.message, true); }
  } },
  el("h2", { text: tr("ui.reply_title") }),
  el("p", { class: "small muted", text: tr("ui.reply_hint") }),
  el("div", { class: "composer" }, replyInput,
    el("button", { class: "btn primary", type: "submit", "aria-label": tr("ui.send") }, icon("send"), tr("ui.send"))));

  screen(main, tr("ui.in_call_title"), stepper("call"),
    caption,
    el("div", { class: "row" },
      el("button", { class: "btn quiet", type: "button", onclick: () => speak(last || caption.textContent, true) }, icon("repeat"), tr("ui.repeat")),
      el("button", { class: "btn danger", type: "button", text: tr("ui.leave_video"), onclick: () => leaveCall(false) })),
    speechBox(tr("caution.no_prompting"), "warn"),
    log,
    replyForm,
    el("details", { class: "card" }, el("summary", { text: tr("ui.ask_sahay_before") }), askPanel()));
  speak(tr("relay.joined"), S.voiceMode); // same text the server sent as `intro`, but always in the current language

  async function poll() {
    try {
      const msgs = await api(`/api/sessions/${S.session.id}/relay?after=${S.relayAfter}`);
      for (const m of msgs) {
        S.relayAfter = m.seq;
        log.appendChild(el("li", { class: m.mine ? "mine" : "theirs" },
          el("span", { class: "who", text: m.mine ? tr("ui.you") : tr("ui.officer") }), el("span", { text: m.text })));
        if (m.mine) continue;
        last = m.text;
        caption.textContent = m.text;
        caption.classList.remove("flash"); void caption.offsetWidth; caption.classList.add("flash");
        if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
        speak(m.text, S.voiceMode);
      }
    } catch (_) { /* transient; keep polling */ }
  }
  S.timers.push(setInterval(poll, 1500));
  poll();
}

async function leaveCall(confirmFirst) {
  if (confirmFirst && !window.confirm(tr("ui.leave_confirm"))) return;
  try {
    await api(`/api/sessions/${S.session.id}/video-kyc/leave`, { method: "POST" });
    S.session = await api(`/api/sessions/${S.session.id}`);
    route();
  } catch (err) { toast(err.message, true); }
}

function askPanel() {
  const input = el("input", { type: "text", maxLength: 500, placeholder: tr("ui.ask_placeholder"), "aria-label": tr("ui.ask_title") });
  const answer = el("div", { class: "answer", "aria-live": "polite" });
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = Recognition ? el("button", { class: "btn quiet", type: "button", text: tr("ui.speak_question"), onclick: () => {
    const r = new Recognition();
    r.lang = SPEECH_LOCALE[S.lang];
    r.onresult = (e) => { input.value = e.results[0][0].transcript; form.requestSubmit(); };
    r.onerror = () => toast(tr("ui.ask_placeholder"));
    r.start();
  } }) : null;
  const form = el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    try {
      const res = await api(`/api/sessions/${S.session.id}/ask`, { method: "POST", json: { question: input.value } });
      clear(answer);
      answer.append(el("p", { text: res.answer }), res.rules.length ? el("span", { class: "cite", text: cite(res.rules) }) : null);
      speak(res.answer);
    } catch (err) { toast(err.message, true); }
  } }, el("h2", { text: tr("ui.ask_title") }), el("div", { class: "ask-row" }, input,
    el("button", { class: "btn primary", type: "submit", text: tr("ui.ask_send") })), mic, answer);
  return form;
}

function helpDock() {
  // Help and the scam check live in the menu; this keeps one quiet link on busy screens.
  return el("p", { class: "center" }, el("button", { class: "link-btn", type: "button", onclick: askForOfficer, text: tr("ui.help_officer") }));
}

async function askForOfficer() {
  const text = tr("consent.referral");
  if (!window.confirm(text)) return;
  try {
    if (!S.session.consents.REFERRAL) {
      S.session = await api(`/api/sessions/${S.session.id}/consents`, { method: "POST", json: { purpose: "REFERRAL", granted: true } });
    }
    const step = S.session.chosen_route ? `CAPTURE_${S.session.chosen_route}` : "ROUTE_SELECTION";
    await api(`/api/sessions/${S.session.id}/referral`, { method: "POST", json: { blocked_step: step } });
    S.session = await api(`/api/sessions/${S.session.id}`);
    referredScreen(document.getElementById("main"));
  } catch (err) { toast(err.message, true); }
}

function referredScreen(main) {
  S.back = () => exitSession(true);
  const decided = (S.session.cases || []).find((c) => c.status !== "OPEN");
  screen(main, tr("ui.help_officer"), speechBox(tr("ui.referral_sent"), "good"),
    decided && decided.decision_note ? el("div", { class: "card" }, el("p", { text: decided.decision_note })) : null,
    askPanel());
  speak(tr("ui.referral_sent"));
}

// ---------------------------------------------------------------------------------------------
// voice mode: the whole journey by speaking, for people who cannot see the screen
//
// Each step: Sahay speaks a question, waits until it has finished speaking, then listens. If it
// hears nothing it says so and waits for a tap on the (very large) microphone button. Everything
// it understood is read back for a yes/no before it is used.

const VOICE_WELCOME = [
  ["hi", "नमस्ते, मैं सहाय हूँ। हिंदी, मराठी या English, अपनी भाषा बोलिए।"],
  ["mr", "किंवा मराठीत बोला."],
  ["en", "Or say English."],
];

function voiceView(main, title, step) {
  const said = el("div", { class: "speech voice-said", role: "status" });
  const heard = el("p", { class: "voice-heard", "aria-live": "polite" });
  const mic = el("button", { class: "mic-btn", type: "button", "aria-label": tr("ui.tap_to_speak") || "Tap and speak",
    onclick: () => { if (S.voiceWake) { const wake = S.voiceWake; S.voiceWake = null; wake(); } } },
  el("span", { class: "mic", "aria-hidden": "true" }, icon("mic")),
  el("span", { class: "mic-label", text: tr("ui.tap_to_speak") || "Tap and speak" }));
  const extra = el("div", { class: "stack" });
  S.back = () => exitSession(!!S.session);
  screen(main, title, step ? stepper(step) : null, said, mic, heard, extra,
    el("button", { class: "btn quiet block", type: "button", text: tr("ui.screen_mode") || "Use the screen instead",
      onclick: () => { S.voiceMode = false; store("sahay.voiceMode", null); route(); } }));
  const run = Symbol("voice");
  S.voiceRun = run;
  const alive = () => S.voiceRun === run;
  return {
    alive, extra,
    async say(text, lang) {
      clear(said);
      said.append(el("span", { class: "icon", "aria-hidden": "true" }, icon("speaker")), el("span", { text }));
      await speak(text, true, lang);
    },
    // Listen once; if nothing usable is heard, ask for a tap and try again.
    async hear(kinds, lang) {
      for (let attempt = 0; alive(); attempt += 1) {
        mic.classList.add("on");
        heard.textContent = tr("ui.listening") || "…";
        const text = await listen(lang);
        mic.classList.remove("on");
        if (!alive()) return null;
        if (text) heard.textContent = `${tr("ui.you_said") || "You said"}: “${text.split(" | ")[0]}”`;
        const k = kinds ? intent(text, kinds) : text;
        if (k) return k;
        heard.textContent = "";
        await this.say(tr("voice.not_heard") || "Sorry, tap the big button and speak again.", lang);
        await new Promise((res) => { S.voiceWake = res; });
      }
      return null;
    },
  };
}

async function voiceWelcome(main) {
  S.voiceMode = true; store("sahay.voiceMode", true);
  // No language yet: greet in all three, using each language's own voice.
  const v = voiceView(main, tr("ui.brand"), null);
  v.extra.append(el("div", { class: "lang-grid" }, [["hi", "हिन्दी"], ["mr", "मराठी"], ["en", "English"]].map(([code, label]) =>
    el("button", { class: "btn block", type: "button", lang: code, text: label, onclick: () => start(code, true) }))));
  // Browsers only allow speech after a tap; arriving here from the big button counts as one.
  for (const [lang, text] of VOICE_WELCOME) { if (!v.alive()) return; await v.say(text, lang); }
  const lang = await v.hear(["hi", "mr", "en"], "hi");
  if (lang && v.alive()) start(lang, true);
}

async function voiceConsent(main) {
  const v = voiceView(main, tr("ui.consent_title"), "consent");
  await v.say(`${tr("consent.assist")} ${tr("voice.consent")}`);
  const answer = await v.hear(["no", "yes"]);
  if (!answer) return;
  await giveConsent("ASSIST", answer === "yes");
}

async function voiceAsk(v, question, ask) {
  for (;;) {
    await v.say(question);
    const text = await v.hear(null);
    if (!text) return null;
    let understood;
    try {
      understood = await api(`/api/sessions/${S.session.id}/understand`, { method: "POST", json: { text, ask } });
    } catch (err) { toast(err.message, true); return null; }
    await v.say(understood.readback);
    const ok = await v.hear(["no", "yes"]);
    if (!ok) return null;
    if (ok === "yes") return understood;
    await v.say(tr("voice.again"));
  }
}

async function voiceNeeds(main) {
  const v = voiceView(main, tr("ui.needs_title"), "needs");
  const needs = await voiceAsk(v, tr("voice.ask_needs"), "needs");
  if (!needs || !v.alive()) return;
  if (needs.needs.length) {
    // Same choice as the "share my needs" box on screen: the bank sees them only if the customer agrees.
    await v.say(`${tr("consent.record_needs")} ${tr("voice.consent")}`);
    const share = await v.hear(["no", "yes"]);
    if (!v.alive()) return;
    try {
      S.session = await api(`/api/sessions/${S.session.id}/consents`, { method: "POST", json: { purpose: "RECORD_NEEDS", granted: share === "yes" } });
    } catch (err) { toast(err.message, true); }
  }
  const docs = await voiceAsk(v, tr("voice.ask_docs"), "documents");
  if (!docs || !v.alive()) return;
  let linked = false;
  if (docs.has_aadhaar) {
    await v.say(tr("voice.ask_linked"));
    linked = (await v.hear(["no", "yes"])) === "yes";
    if (!v.alive()) return;
  }
  const profile = {
    needs: needs.needs,
    has_aadhaar: !!docs.has_aadhaar,
    share_aadhaar: true,
    aadhaar_mobile_linked: linked,
    pan: docs.pan || "NONE",
    other_ovds: docs.other_ovds,
    has_ckyc_identifier: false,
    seeks_government_benefit: !!needs.seeks_government_benefit,
  };
  try {
    S.session = await api(`/api/sessions/${S.session.id}/profile`, { method: "PUT", json: profile });
    voicePlan(document.getElementById("main"));
  } catch (err) { toast(err.message, true); }
}

async function voicePlan(main) {
  try { S.plan = await api(`/api/sessions/${S.session.id}/plan`); } catch (err) { toast(err.message, true); return; }
  const options = S.plan.options.filter((o) => o.status !== "NOT_AVAILABLE");
  const v = voiceView(main, tr("ui.plan_title"), "plan");
  const card = el("div", { class: "stack" });
  v.extra.append(card);
  for (let i = 0; v.alive();) {
    const o = options[i];
    clear(card); card.append(routeCard(o, i === 0));
    const why = o.why.map((pt) => pt.text).join(" ");
    await v.say(`${tr("voice.option", { n: i + 1, total: options.length, name: o.name, summary: o.summary, why })} ${tr("voice.option_prompt")}`);
    const k = await v.hear(["yes", "next", "repeat", "no"]);
    if (!k) return;
    if (k === "yes") return chooseRoute(o.route);
    if (k === "next" || k === "no") {
      i += 1;
      if (i >= options.length) { i = 0; await v.say(tr("voice.options_again")); }
    }
  }
}

async function voiceReady() {
  const run = Symbol("voice"); S.voiceRun = run;
  await speak(`${tr("ui.ready_title")}. ${tr("caution.no_prompting")} ${tr("voice.ready_join")}`, true);
  while (S.voiceRun === run) {
    const text = await listen();
    if (S.voiceRun !== run) return;
    if (intent(text, ["join", "yes"])) return joinCall();
    await new Promise((res) => { S.voiceWake = res; setTimeout(res, 4000); });
  }
}

// ---------------------------------------------------------------------------------------------
// scam check (rules register G1–G7): works without a session; nothing typed here is stored

function scamView(main) {
  S.back = () => { location.hash = "#/"; };
  if (S.session && S.session.status === "IN_VIDEO_KYC") {
    screen(main, tr("ui.scam_title"), speechBox(tr("scam.in_call"), "warn"),
      el("a", { class: "btn block", href: "#/", text: tr("ui.back") }));
    speak(tr("scam.in_call"));
    return;
  }
  const input = el("textarea", { maxLength: 2000, rows: 5, placeholder: tr("ui.scam_placeholder"), "aria-label": tr("ui.scam_placeholder") });
  const result = el("div", { class: "stack", "aria-live": "polite" });
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const form = el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    try {
      const r = await api("/api/scam-check", { method: "POST", json: { text: input.value, language: S.lang } });
      clear(result);
      const kind = { LIKELY_SCAM: "danger", SUSPICIOUS: "warn", NO_SIGNS: "" }[r.verdict];
      result.append(
        el("div", { class: `speech verdict ${kind}`, role: "status" },
          el("span", { class: "icon", "aria-hidden": "true" }, icon(r.verdict === "NO_SIGNS" ? "help" : "shield")),
          el("strong", { text: r.headline })),
        r.signals.length ? el("section", { class: "card" }, el("h2", { text: tr("ui.scam_signs") }), points(r.signals)) : null,
        el("section", { class: "card" }, el("h2", { text: tr("ui.scam_what_to_do") }), points(r.advice)),
        readAloudButton(r.speak));
      speak(r.speak);
    } catch (err) { toast(err.message, true); }
  } },
    el("p", { text: tr("ui.scam_intro") }),
    input,
    el("div", { class: "row" },
      el("button", { class: "btn primary", type: "submit" }, icon("shield"), tr("ui.scam_check")),
      Recognition ? el("button", { class: "btn quiet", type: "button", onclick: () => {
        const r = new Recognition();
        r.lang = SPEECH_LOCALE[S.lang];
        r.onresult = (e) => { input.value = e.results[0][0].transcript; form.requestSubmit(); };
        r.start();
      } }, icon("mic"), tr("ui.speak_question")) : null,
      el("button", { class: "btn quiet small", type: "button", text: tr("ui.scam_try_example"), onclick: () => { input.value = tr("ui.scam_example"); } })),
    el("p", { class: "small muted", text: tr("ui.scam_private") }));
  screen(main, tr("ui.scam_title"), form, result);
  speak(`${tr("ui.scam_title")} ${tr("ui.scam_intro")}`);
}

// ---------------------------------------------------------------------------------------------
// officer console

// The bank side: a sidebar with who is signed in, the two pages, the customer app and Sign out.
function officerSignedIn() {
  if (S.config && S.config.auth === "google") return !!(window.SAHAY_OFFICER_NAME && window.SAHAY_OFFICER_NAME());
  return true; // Cloud Run edition: identified by name (and the shared key when the bank sets one)
}

async function officerSignOut() {
  if (S.config && S.config.auth === "google" && window.SAHAY_OFFICER_SIGN_OUT) await window.SAHAY_OFFICER_SIGN_OUT();
  store("sahay.officer", null);
  toast("Signed out");
  route();
}

function officerShell(main, active, title, ...content) {
  main.className = "wide";
  S.back = null;
  if (!officerSignedIn()) {
    clear(main); syncBack();
    const h = el("h1", { text: "Bank officer sign-in", tabindex: "-1" });
    main.append(el("div", { class: "signin" }, el("div", { class: "card stack" }, h,
      el("p", { class: "muted", text: "Sign in with the Google account your bank has listed as an officer." }),
      el("button", { class: "btn primary block", type: "button", onclick: async () => {
        try { await window.SAHAY_OFFICER_SIGN_IN(); route(); } catch (err) { toast(err.message, true); }
      } }, icon("person"), "Sign in with Google"),
      el("a", { class: "btn quiet block", href: "#/" }, icon("home"), "Back to the customer app"))));
    h.focus();
    return false;
  }
  const nav = (href, key, iconName, label) => el("a", { href, "aria-current": active === key ? "page" : null }, icon(iconName), label);
  screen(main, title,
    el("div", { class: "console" },
      el("nav", { class: "side", "aria-label": "Officer" },
        el("div", { class: "who" }, ...officerIdentity()),
        nav("#/officer", "officer", "list", "Live calls and cases"),
        nav("#/insights", "insights", "chart", "Accessibility insights"),
        nav("#/", "app", "home", "Customer app"),
        el("button", { class: "nav signout", type: "button", onclick: officerSignOut }, icon("exit"), "Sign out")),
      el("div", { class: "stack" }, ...content)));
  return true;
}

// Cloud Run edition: name + shared key. Firebase edition: Google sign-in, allowed officers listed
// in Firestore (see firebase/firestore.rules).
function officerIdentity() {
  if (S.config && S.config.auth === "google") {
    const who = window.SAHAY_OFFICER_NAME && window.SAHAY_OFFICER_NAME();
    return [el("span", { class: "small muted", text: "Signed in as" }), el("strong", { text: who || "" })];
  }
  const officer = store("sahay.officer") || {};
  const nameInput = el("input", { type: "text", value: officer.name || "", placeholder: "Officer name", "aria-label": "Officer name" });
  const keyInput = el("input", { type: "password", value: officer.key || "", placeholder: "Officer key (if required)", "aria-label": "Officer key" });
  const save = () => store("sahay.officer", { name: nameInput.value.trim(), key: keyInput.value });
  nameInput.addEventListener("change", save); keyInput.addEventListener("change", save);
  return [el("span", { class: "small muted", text: "Officer" }), el("div", { class: "stack" }, nameInput, keyInput)];
}

async function officerView(main) {
  const caseList = el("ul", { class: "list" });
  const videoList = el("ul", { class: "list" });
  const detail = el("div", { class: "stack" }, el("div", { class: "card muted", text: "Select a live call or a referred case." }));
  const shown = officerShell(main, "officer", "Officer console",
    el("p", { class: "muted", text: "Live video KYC sessions using Sahay, and cases customers referred to a bank officer." }),
    el("div", { class: "grid" },
      el("div", { class: "stack" },
        el("section", { class: "card" }, el("h2", { text: "Live video KYC" }), videoList),
        el("section", { class: "card" }, el("h2", { text: "Referred cases" }), caseList)),
      detail));
  if (!shown) return;

  let selected = null;
  async function refresh() {
    try {
      const [cases, videos] = await Promise.all([api("/api/officer/cases"), api("/api/officer/video-sessions")]);
      clear(caseList); clear(videoList);
      if (!videos.length) videoList.appendChild(el("li", { class: "muted", text: "No customer is in a video call right now." }));
      for (const v of videos) {
        videoList.appendChild(el("li", {}, el("button", { type: "button", "aria-current": String(selected === v.id),
          onclick: () => { selected = v.id; relayPanel(detail, v); } },
          el("strong", { text: `Session ${v.id.slice(0, 8)} · ${v.language.toUpperCase()}` }),
          el("div", { class: "small muted", text: v.needs.length ? v.needs.join(", ") : "No needs shared" }))));
      }
      if (!cases.length) caseList.appendChild(el("li", { class: "muted", text: "No referred cases." }));
      for (const c of cases) {
        caseList.appendChild(el("li", {}, el("button", { type: "button", "aria-current": String(selected === c.id),
          onclick: () => { selected = c.id; caseDetail(detail, c.id, refresh); } },
          el("span", { class: `pill ${c.status}`, text: c.status }), " ",
          el("strong", { text: `Case ${c.id.slice(0, 8)}` }),
          el("div", { class: "small muted", text: `${c.blocked_step} · ${c.language.toUpperCase()} · ${new Date(c.created_at).toLocaleString()}` }))));
      }
    } catch (err) { toast(err.message, true); }
  }
  await refresh();
  S.timers.push(setInterval(refresh, 4000));
}

function citeList(rules) {
  return rules && rules.length ? el("span", { class: "cite", text: rules.map((r) => r.citation).join(" · ") }) : null;
}

async function caseDetail(container, caseId, refresh) {
  let f;
  try { f = await api(`/api/officer/cases/${caseId}`); } catch (err) { toast(err.message, true); return; }
  const note = el("textarea", { "aria-label": "Decision note", placeholder: "Decision note. Required for rejection: record the reason (RBI KYC Directions 2025 ¶18)." });
  const decide = async (decision) => {
    try {
      await api(`/api/officer/cases/${caseId}/decision`, { method: "POST", json: { decision, note: note.value } });
      toast(`Case marked ${decision}`);
      await caseDetail(container, caseId, refresh);
      refresh();
    } catch (err) { toast(err.message, true); }
  };
  const decided = ["PROCEEDING", "REJECTED"].includes(f.case.status);
  clear(container);
  container.append(
    el("section", { class: "card stack" },
      el("div", { class: "row" }, el("h2", { text: `Case ${f.case.id.slice(0, 8)}` }), el("span", { class: `pill ${f.case.status}`, text: f.case.status })),
      el("dl", { class: "kv" },
        el("dt", { text: "Blocked at" }), el("dd", { text: f.case.blocked_step }),
        el("dt", { text: "Language" }), el("dd", { text: f.session.language }),
        el("dt", { text: "Chosen route" }), el("dd", { text: f.session.chosen_route || "–" }),
        el("dt", { text: "Customer note" }), el("dd", { text: f.case.customer_note || "–" }),
        el("dt", { text: "BC assisting" }), el("dd", { text: f.session.bc_agent || "–" }))),
    el("section", { class: "card stack" }, el("h2", { text: "Accommodations to apply" }),
      f.accommodations.length ? el("ul", { class: "points" }, f.accommodations.map((a) => el("li", {}, el("span", { text: a.text }), citeList(a.rules))))
        : el("p", { class: "muted", text: "No support needs shared." })),
    el("section", { class: "card stack" }, el("h2", { text: "Documents (Aadhaar numbers masked)" }),
      f.documents.length ? el("ul", { class: "points" }, f.documents.map((d) => el("li", {},
        el("strong", { text: d.doc_type || d.expected }), el("span", { text: ` · ${Object.entries(d.fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ") || "no fields read"}` }),
        d.notes.length ? el("div", { class: "small muted", text: d.notes.join(" ") }) : null)))
        : el("p", { class: "muted", text: "No documents captured yet." })),
    el("section", { class: "card stack" }, el("h2", { text: "Routes available to this customer" }),
      el("ul", { class: "points" }, f.routes.map((r) => el("li", {}, el("strong", { text: `${r.name}: ` }), el("span", { text: r.status_text }),
        r.blockers.length ? el("div", { class: "small muted", text: r.blockers.map((b) => b.text).join(" ") }) : null)))),
    el("section", { class: "card stack" }, el("h2", { text: "Consent log" }),
      el("p", { text: f.consent.chain_valid ? `✓ Hash chain verified (${f.consent.records} records)` : `✗ Chain broken at record ${f.consent.broken_at}` }),
      el("ul", { class: "points small" }, f.consent.items.map((c) => el("li", { text: `#${c.seq} ${c.purpose}: ${c.granted ? "granted" : "declined"} (${c.language}) · ${new Date(c.at).toLocaleString()} · ${c.hash}` }))),
      citeList(f.consent.rules)),
    el("section", { class: "card stack" }, el("h2", { text: "Decision" }),
      el("p", { class: "small muted", text: "No automatic rejection. A rejection must record the reason (RBI KYC Directions 2025 ¶18)." }),
      decided ? el("p", {}, el("strong", { text: `${f.case.status} by ${f.case.officer}: ` }), el("span", { text: f.case.decision_note || "" })) : note,
      decided ? null : el("div", { class: "row" },
        el("button", { class: "btn primary small", type: "button", text: "Proceed", onclick: () => decide("PROCEED") }),
        el("button", { class: "btn small", type: "button", text: "Request information", onclick: () => decide("REQUEST_INFO") }),
        el("button", { class: "btn danger small", type: "button", text: "Reject with reason", onclick: () => decide("REJECT") }))));
}

function relayPanel(container, v) {
  const input = el("input", { type: "text", maxLength: 600, placeholder: "Type a question, or press Speak", "aria-label": "Question" });
  const log = el("ol", { class: "chat officer-chat" });
  const interim = el("p", { class: "small muted", "aria-live": "polite" });
  let after = 0, rec = null;

  async function send(text) {
    if (!text.trim()) return;
    try { await api(`/api/officer/video-sessions/${v.id}/relay`, { method: "POST", json: { text } }); refresh(); }
    catch (err) { toast(err.message, true); }
  }
  async function refresh() {
    try {
      const msgs = await api(`/api/officer/video-sessions/${v.id}/messages?after=${after}`);
      for (const m of msgs) {
        after = m.seq;
        const fromCustomer = m.from === "customer";
        log.appendChild(el("li", { class: fromCustomer ? "theirs" : "mine" },
          el("span", { class: "who", text: fromCustomer ? "Customer (typed)" : "You" }),
          el("span", { text: fromCustomer ? m.translated : m.original }),
          m.original !== m.translated ? el("span", { class: "small muted", text: fromCustomer ? `Original: ${m.original}` : `Shown as: ${m.translated}` }) : null,
          m.translated_ok ? null : el("span", { class: "small muted", text: "(not translated)" })));
      }
    } catch (_) { /* keep polling */ }
  }
  // Live captions: the officer talks normally; the browser turns speech into text and each
  // finished sentence is sent like a typed question (translated, shown and read to the customer).
  const setSpeak = (on) => { clear(speakBtn); speakBtn.append(icon(on ? "stop" : "mic"), on ? "Stop speaking" : "Speak (live captions)"); speakBtn.classList.toggle("live", on); };
  const speakBtn = el("button", { class: "btn", type: "button", onclick: () => {
    if (rec) { rec.stop(); rec = null; setSpeak(false); interim.textContent = ""; return; }
    if (!Recognition) { toast("Speech recognition needs Chrome or Edge.", true); return; }
    rec = new Recognition();
    rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) send(r[0].transcript.trim()); else partial += r[0].transcript;
      }
      interim.textContent = partial ? `… ${partial}` : "";
    };
    rec.onend = () => { if (rec) { try { rec.start(); } catch (_) { /* restarting */ } } };
    rec.start();
    setSpeak(true);
  } });
  setSpeak(false);

  clear(container);
  container.append(el("section", { class: "card stack" },
    el("h2", { text: `Live video KYC · session ${v.id.slice(0, 8)}` }),
    el("p", { class: "small muted", text: "Your questions appear on the customer's screen as large captions and are read aloud in their language. Typed replies from the customer appear here, translated, with the original. Sahay will not suggest answers (RBI KYC Directions 2025 ¶27(2)(iv))." }),
    v.accommodations.length ? el("div", { class: "notice info" }, el("strong", { text: "Accommodations: " }), el("span", { text: v.accommodations.join(" ") })) : null,
    el("form", { class: "ask-row", onsubmit: (e) => { e.preventDefault(); send(input.value); input.value = ""; } },
      input, el("button", { class: "btn primary", type: "submit" }, icon("send"), "Send")),
    el("div", { class: "row" }, speakBtn), interim,
    log));
  S.timers.push(setInterval(refresh, 1500));
  refresh();
}

// ---------------------------------------------------------------------------------------------
// insights

async function insightsView(main) {
  if (!officerSignedIn()) { officerShell(main, "insights", "Accessibility insights"); return; }
  let data;
  try { data = await api("/api/insights/funnel"); } catch (err) {
    officerShell(main, "insights", "Accessibility insights", el("p", { text: err.message }));
    return;
  }
  const needs = Object.keys(data.by_need);
  const started = (rows) => (rows[0] && rows[0].sessions) || 0;
  const pct = (n, base) => (base ? `${Math.round((n / base) * 100)}%` : "–");
  const table = el("table", {},
    el("thead", {}, el("tr", {}, el("th", { text: "Step" }), el("th", { class: "num", text: "All customers" }),
      needs.map((n) => el("th", { class: "num", text: n.replaceAll("_", " ").toLowerCase() })))),
    el("tbody", {}, data.steps.map((step, i) => el("tr", {},
      el("th", { scope: "row", text: step.replaceAll("_", " ").toLowerCase() }),
      el("td", { class: "num", text: `${data.overall[i].sessions} (${pct(data.overall[i].sessions, started(data.overall))})` }),
      needs.map((n) => el("td", { class: "num", text: `${data.by_need[n][i].sessions} (${pct(data.by_need[n][i].sessions, started(data.by_need[n]))})` }))))));
  officerShell(main, "insights", "Accessibility insights",
    el("p", { class: "muted", text: "Where customers drop out of the KYC journey, overall and by support need. Need categories are counted only for customers who agreed to share them." }),
    el("div", { class: "card", style: undefined }, table),
    el("p", { class: "small muted", text: `${data.sessions} sessions. Supports the periodic accessibility audits directed by the Supreme Court (Pragya Prasun, 2025, ¶18(ii)).` }),
    scamStats(data.scam_checks));
}

function scamStats(sc) {
  if (!sc) return null;
  const label = (k) => k.replaceAll("_", " ").toLowerCase();
  const rows = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    el("tr", {}, el("th", { scope: "row", text: label(k) }), el("td", { class: "num", text: String(v) })));
  return el("section", { class: "card stack" },
    el("h2", { text: `KYC scam checks: ${sc.checks}` }),
    el("p", { class: "small muted", text: "Customers who checked a suspicious call or message. Only the verdict and the kinds of warning signs are counted; message text is never stored." }),
    sc.checks ? el("div", { class: "grid" },
      el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Verdict" }), el("th", { class: "num", text: "Checks" }))), el("tbody", {}, rows(sc.by_verdict))),
      el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Warning sign" }), el("th", { class: "num", text: "Checks" }))), el("tbody", {}, rows(sc.by_signal)))) : null);
}

// ---------------------------------------------------------------------------------------------
// boot

// Changing language redraws the screen the customer is on (which may be an earlier one they went
// back to), not the next unfinished step, and keeps what they had already ticked or typed.
const VIEWS = ["welcome", "consentScreen", "needsScreen", "planScreen", "captureScreen", "readyScreen", "callScreen",
  "referredScreen", "voiceWelcome", "voiceConsent", "voiceNeeds", "voicePlan", "scamView"];
for (const name of VIEWS) {
  const fn = window[name];
  if (typeof fn !== "function") continue;
  window[name] = function (...args) { S.view = () => fn.apply(this, args); return fn.apply(this, args); };
}

async function rerender() {
  if (!S.view || location.hash.startsWith("#/officer") || location.hash.startsWith("#/insights")) return route();
  stopTimers();
  if (window.speechSynthesis) speechSynthesis.cancel();
  const back = S.back;
  await S.view();
  if (!S.back) S.back = back;
  syncBack();
}

function snapshotForm() {
  const main = document.getElementById("main");
  const ticks = {}; const texts = [];
  main.querySelectorAll("input[type=checkbox], input[type=radio]").forEach((i) => { ticks[`${i.name}=${i.value}`] = i.checked; });
  main.querySelectorAll("textarea, input[type=text], input:not([type])").forEach((i) => texts.push(i.value));
  return { ticks, texts };
}

function restoreForm(draft) {
  const main = document.getElementById("main");
  main.querySelectorAll("input[type=checkbox], input[type=radio]").forEach((i) => {
    const k = `${i.name}=${i.value}`;
    if (k in draft.ticks && i.checked !== draft.ticks[k]) { i.checked = draft.ticks[k]; i.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  main.querySelectorAll("textarea, input[type=text], input:not([type])").forEach((i, n) => {
    if (!i.value && draft.texts[n]) i.value = draft.texts[n];
  });
}

async function boot() {
  S.voice = store("sahay.voice") !== false;
  S.voiceMode = store("sahay.voiceMode") === true;
  let size = 0;
  try { size = Number(localStorage.getItem("sahay.textSize") || 0); } catch (_) { /* optional */ }
  S.textSize = applyTextSize(size);
  const lang = preferredLanguage();
  try { S.config = await api("/api/config"); await loadCatalog(lang); } catch (err) { toast(err.message, true); }
  const back = document.getElementById("back-btn");
  back.append(icon("back"));
  back.addEventListener("click", goBack);
  const menuBtn = document.getElementById("menu-btn");
  menuBtn.append(icon("menu"));
  menuBtn.addEventListener("click", openMenu);
  document.getElementById("menu").addEventListener("click", (e) => { if (e.target.id === "menu") e.target.close(); });
  document.getElementById("lang-select").addEventListener("change", async (e) => {
    const draft = snapshotForm();
    await loadCatalog(e.target.value);
    if (S.session) {
      try { S.session = await api(`/api/sessions/${S.session.id}/language`, { method: "POST", json: { language: e.target.value } }); } catch (_) { /* keep UI language */ }
    }
    await rerender();
    restoreForm(draft);
  });
  // The phone's own Back button: one guard entry in history; when it is used, go back one step
  // in Sahay (if there is one) and put the guard back.
  history.replaceState({ sahayBase: true }, "");
  history.pushState({ sahayGuard: true }, "");
  window.addEventListener("popstate", async (e) => {
    if (e.state && e.state.sahayBase && S.back) {
      history.pushState({ sahayGuard: true }, "");
      await goBack();
    }
  });
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};
  window.addEventListener("hashchange", route);
  route();
}

document.addEventListener("DOMContentLoaded", boot);
