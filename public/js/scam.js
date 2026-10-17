// Scam check: port of src/sahay/scam.py (rules register G1–G7), tested against its output.
// Gemini can only add warning signs; Sahay never calls a message "safe".
import { t } from "./i18n.js";
import { cite } from "./rules.js";

export const SIGNALS = ["ASKS_SECRET", "ASKS_DOCUMENTS", "REMOTE_ACCESS_APP", "LINK", "INSTALL_APP", "URGENCY_THREAT", "KYC_PRETEXT"];
const STRONG = new Set(["ASKS_SECRET", "ASKS_DOCUMENTS", "REMOTE_ACCESS_APP"]);
const SIGNAL_RULES = {
  ASKS_SECRET: ["G2"], ASKS_DOCUMENTS: ["G5"], REMOTE_ACCESS_APP: ["G1", "G4"], LINK: ["G3"],
  INSTALL_APP: ["G1", "G4"], URGENCY_THREAT: ["G1"], KYC_PRETEXT: ["G1", "G6"],
};
const ADVICE = [["scam.advice.verify", ["G6"]], ["scam.advice.never_share", ["G2"]], ["scam.advice.report", ["G7"]]];

const re = (s) => new RegExp(s, "i");
const SECRET = re("\\botp\\b|\\bm?pin\\b|upi pin|password|passcode|\\bcvv\\b|verification code|one[- ]time password|" +
  "ओटीपी|ओ\\.टी\\.पी|पिन|पासवर्ड|सीवीवी|कोड");
const PINCODE = /pin ?code|पिन ?कोड/gi;
const REQUEST = re("\\b(share|send|tell|give|provide|enter|confirm|forward|reply|type|submit|bata\\w*|bhej\\w*|de ?do|dijiye|" +
  "dedo|batao)\\b|बता|भेज|दीजिए|दे दो|दें|शेयर|साझा|लिखें|डालें|सांगा|पाठवा|द्या|शेअर|टाका|कळवा");
const DOCS = re("aadha+r|\\bpan\\b|pan card|passport|voter|driving licen[cs]e|photo|selfie|" +
  "आधार|पैन|पॅन|पासपोर्ट|फोटो|फ़ोटो|सेल्फी");
const SEND_DOCS = re("\\b(send|share|upload|forward|whats ?app|bhej\\w*)\\b|भेज|पाठवा|अपलोड|व्हाट्सएप|व्हॉट्सॲप|व्हॉट्सअ‍ॅप|शेयर|शेअर");
const REMOTE = re("any ?desk|team ?viewer|quick ?support|rust ?desk|airdroid|\\.apk\\b|\\bapk\\b|screen ?shar\\w*|" +
  "एनीडेस्क|स्क्रीन शेयर|स्क्रीन शेअर");
const LINK = re("https?://\\S+|www\\.\\S+|bit\\.ly|tinyurl|t\\.me/|wa\\.me/|" +
  "\\b[\\w-]+\\.(?:com|in|net|org|xyz|top|link|ly|co|info|online|site|app|click|live|cc)\\b");
const INSTALL = re("\\binstall\\w*|\\bdownload\\w*|इंस्टॉल|इन्स्टॉल|डाउनलोड|ऐप|ॲप|अ‍ॅप");
const URGENCY = re("\\bblock\\w*|\\bsuspend\\w*|\\bfreez\\w*|\\bfrozen\\b|\\bclos(?:e|ed|ure|ing)\\b|deactivat\\w*|\\bexpir\\w*|" +
  "\\btoday\\b|\\bimmediately\\b|\\burgent\\w*|last (?:chance|date|day)|within \\d+ ?(?:hours?|hrs?|days?|minutes?)|" +
  "\\b24 ?(?:hours?|hrs?)\\b|\\baaj hi\\b|\\bturant\\b|band ho|" +
  "बंद|ब्लॉक|निलंबित|तुरंत|आज ही|अभी|घंटे|त्वरित|लगेच|आजच|ताबडतोब|तास|मुदत संपली|समाप्त");
const KYC = re("\\bk\\.?y\\.?c\\b|\\bre-?kyc\\b|\\be-?kyc\\b|केवाईसी|के\\.वाई\\.सी|केवायसी|के वाई सी");
const WARNING = new RegExp("\\b(?:do not|don't|dont|never|not to|no need to)\\s+(?:share|disclose|tell|give|send|reveal)\\w*|" +
  "(?:साझा|शेयर|बताएं|बताएँ|दें)\\s*(?:न|ना|मत)\\s*कर\\S*|(?:न|ना|मत)\\s*(?:बताएं|बताएँ|बताइए|बताओ|दें|भेजें|शेयर|साझा)\\S*|" +
  "(?:सांगू|करू|देऊ|पाठवू)\\s*नका", "gi");
const CONDITIONAL = re("\\b(?:if|unless|otherwise|agar|warna|nahi to)\\b|अगर|वरना|नहीं तो|जर |नाहीतर");
const CLAUSES = /[.!?।\n;]+/;
const SHORT_CODE = /(?<!\d)\d{4,8}(?!\d)/g;

export function redact(text) { return String(text).replace(SHORT_CODE, "••••"); }

export function detect(text) {
  const signals = new Set();
  for (let clause of text.split(CLAUSES)) {
    if (!clause.trim()) continue;
    if (!CONDITIONAL.test(clause)) clause = clause.replace(WARNING, " ");
    const plain = clause.replace(PINCODE, " ");
    if (SECRET.test(plain) && REQUEST.test(plain)) signals.add("ASKS_SECRET");
    if (DOCS.test(clause) && SEND_DOCS.test(clause)) signals.add("ASKS_DOCUMENTS");
  }
  if (REMOTE.test(text)) signals.add("REMOTE_ACCESS_APP");
  if (LINK.test(text)) signals.add("LINK");
  if (INSTALL.test(text)) signals.add("INSTALL_APP");
  if (URGENCY.test(text)) signals.add("URGENCY_THREAT");
  if (KYC.test(text)) signals.add("KYC_PRETEXT");
  return signals;
}

export function verdict(signals) {
  if ([...signals].some((s) => STRONG.has(s))) return "LIKELY_SCAM";
  if (signals.has("KYC_PRETEXT") && ["LINK", "URGENCY_THREAT", "INSTALL_APP"].some((s) => signals.has(s))) return "LIKELY_SCAM";
  if (signals.has("LINK") && signals.has("URGENCY_THREAT")) return "LIKELY_SCAM";
  return signals.size ? "SUSPICIOUS" : "NO_SIGNS";
}

export function assess(text, lang, aiSignals = null) {
  const signals = detect(text);
  for (const s of aiSignals || []) if (SIGNALS.includes(s)) signals.add(s);
  const ordered = SIGNALS.filter((s) => signals.has(s));
  const v = verdict(signals);
  const headline = t(`scam.verdict.${v}`, lang);
  const signTexts = ordered.map((s) => t(`scam.sig.${s}`, lang));
  const adviceTexts = ADVICE.map(([k]) => t(k, lang));
  return {
    verdict: v,
    headline,
    signals: ordered.map((s, i) => ({ key: `scam.sig.${s}`, text: signTexts[i], rules: cite(...SIGNAL_RULES[s]) })),
    advice: ADVICE.map(([k, r], i) => ({ key: k, text: adviceTexts[i], rules: cite(...r) })),
    speak: [headline, ...signTexts, ...adviceTexts.slice(0, 2)].join(" "),
    ai_used: aiSignals !== null,
  };
}
