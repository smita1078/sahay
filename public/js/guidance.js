// One clear spoken instruction per frame: port of src/sahay/capture/guidance.py.
import { t } from "./i18n.js";
import { cite } from "./rules.js";
import { maskFields } from "./masking.js";
import { checksDict } from "./quality.js";

const OVD_TYPES = new Set(["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "NREGA_JOB_CARD", "NPR_LETTER"]);
const EDGE = { left: "cap.move_left", right: "cap.move_right", top: "cap.move_up", bottom: "cap.move_down" };
const FRONT_EDGE = { left: "cap.card_left", right: "cap.card_right", top: "cap.card_down", bottom: "cap.card_up" };
const FRONT = { "cap.too_close": "cap.card_too_close", ...Object.fromEntries(Object.keys(EDGE).map((k) => [EDGE[k], FRONT_EDGE[k]])) };

export function expectedLabel(expected) {
  return {
    AADHAAR: "Aadhaar",
    PAN: "PAN card",
    ANY_OVD: "any officially valid document (Aadhaar, passport, voter ID, driving licence, NREGA job card or NPR letter)",
  }[expected];
}

function problem(q, r, expected) {
  if (q.too_dark) return { key: "cap.too_dark", params: {}, rules: ["C6"] };
  const noDocLocal = !q.document_found;
  if ((r === null && noDocLocal) || (r !== null && !r.document_present)) return { key: "cap.no_document", params: {}, rules: [] };
  if (q.too_close) return { key: "cap.too_close", params: {}, rules: [] };
  if (q.too_far) return { key: "cap.move_closer", params: {}, rules: [] };
  const edges = q.box ? q.edges_cut : (r ? r.edges_cut_off : []);
  if (edges.length >= 2) return { key: "cap.too_close", params: {}, rules: [] };
  if (edges.length) return { key: EDGE[edges[0]], params: {}, rules: [] };
  if (q.glare || (r && r.glare)) return { key: "cap.glare", params: {}, rules: ["C6"] };
  if (q.blurry || (r && !r.readable)) return { key: "cap.blurry", params: {}, rules: ["C6"] };
  if (r) {
    const found = r.document_type;
    if (expected === "PAN" && (found === "EPAN_PRINTOUT" || (found === "PAN" && r.is_printout_of_e_document))) {
      return { key: "cap.printout_epan", params: {}, rules: ["C5"] };
    }
    const wrong = (expected === "AADHAAR" && !["AADHAAR", "OTHER"].includes(found))
      || (expected === "PAN" && !["PAN", "OTHER"].includes(found))
      || (expected === "ANY_OVD" && !(OVD_TYPES.has(found) || found === "OTHER"));
    if (wrong) return { key: "cap.wrong_document", params: { found, expected }, rules: [] };
  }
  return null;
}

export function firstProblem(q, r, expected, front = false) {
  const p = problem(q, r, expected);
  if (p && front && FRONT[p.key]) p.key = FRONT[p.key];
  return p;
}

export function workingDaysBetween(start, end) {
  let days = 0;
  const d = new Date(start);
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days += 1; }
  return days;
}

function parseDate(text) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec((text || "").trim());
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec((text || "").trim());
  return iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : null;
}

// q: analyse() result; reading: Gemini FrameReading or null.
export function result(q, reading, expected, lang, { front = false, today = new Date(), modelError = null } = {}) {
  const msg = (key, rules = [], params) => ({ key, text: t(key, lang, params), rules: cite(...rules) });
  const p = firstProblem(q, reading, expected, front);
  const docType = reading && reading.document_present ? reading.document_type : null;
  const fields = reading ? maskFields({ name: reading.name ?? null, date_of_birth: reading.date_of_birth ?? null, download_date: reading.download_date ?? null }) : {};
  const base = { doc_type: docType, fields, checks: checksDict(q), model_used: !!reading, model_error: modelError, notes: [] };
  if (p) {
    let params = p.params;
    if (p.key === "cap.wrong_document") params = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, t(`doc.${v}`, lang)]));
    const messages = [msg(p.key, p.rules, params)];
    return { status: "ADJUST", messages, speak: messages[0].text, ...base };
  }
  const messages = [msg("cap.hold_still")];
  if (reading && reading.name) messages.push(msg("cap.readback_name", [], { name: fields.name }));
  const notes = [];
  const downloaded = reading ? parseDate(reading.download_date) : null;
  if (downloaded && docType === "AADHAAR" && workingDaysBetween(downloaded, today) > 3) {
    const dd = `${String(downloaded.getDate()).padStart(2, "0")}/${String(downloaded.getMonth() + 1).padStart(2, "0")}/${downloaded.getFullYear()}`;
    notes.push(msg("cap.aadhaar_download_date", ["C4"], { date: dd }));
  }
  if (docType === "AADHAAR") notes.push(msg("caution.redact_aadhaar", ["C3"]));
  return { status: "GOOD", messages, speak: messages.slice(0, 2).map((m) => m.text).join(" "), ...base, notes };
}
