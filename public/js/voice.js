// Voice mode keyword fallback: port of src/sahay/voice.py (word lists exported from Python).
// Gemini is the main path; this keeps voice mode usable when Gemini is unavailable.
import { t } from "./i18n.js";
import { NEEDS, OVDS } from "./planner.js";

let W = null;
export function setWords(words) { W = words; }
export async function loadWords(base = ".") { W = await (await fetch(`${base}/data/voice-words.json`)).json(); }

const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);

function has(text, words) {
  if (words.some((w) => !isAscii(w) && text.includes(w))) return true;
  const tokens = ` ${(text.match(/\p{L}+/gu) || []).join(" ")} `;
  return words.filter(isAscii).some((w) => tokens.includes(` ${w} `) || (w.includes(" ") && text.includes(w)) || (w.length > 5 && text.includes(w)));
}

export function understandLocally(text, ask) {
  const lower = text.toLowerCase();
  if (ask === "needs") {
    return {
      needs: NEEDS.filter((n) => has(lower, W.needs[n])),
      has_aadhaar: null, pan: null, other_ovds: [],
      seeks_government_benefit: has(lower, W.benefit) ? true : null,
    };
  }
  return {
    needs: [],
    has_aadhaar: has(lower, W.aadhaar),
    pan: has(lower, W.epan) ? "E_PAN" : has(lower, W.pan) ? "CARD" : "NONE",
    other_ovds: OVDS.filter((o) => has(lower, W.ovds[o])),
    seeks_government_benefit: null,
  };
}

function join(items, lang) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + t("voice.and", lang) + items[items.length - 1];
}

export function readback(u, ask, lang) {
  if (ask === "needs") {
    if (!u.needs.length) return t("voice.heard_no_needs", lang);
    const items = NEEDS.filter((n) => u.needs.includes(n)).map((n) => t(`voice.need.${n}`, lang));
    return t("voice.heard_needs", lang, { items: join(items, lang) });
  }
  const docs = [];
  if (u.has_aadhaar) docs.push(t("doc.AADHAAR", lang));
  if (u.pan === "CARD") docs.push(t("doc.PAN", lang));
  else if (u.pan === "E_PAN") docs.push(t("voice.epan", lang));
  for (const o of OVDS) if (u.other_ovds.includes(o)) docs.push(t(`doc.${o}`, lang));
  if (!docs.length) return t("voice.heard_no_docs", lang);
  return t("voice.heard_docs", lang, { items: join(docs, lang) });
}
