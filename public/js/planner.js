// KYC route planner: a line-by-line port of src/sahay/planner.py (tested against its output).
// Deterministic on purpose: which routes are lawful is a compliance question, not the model's.
import { t } from "./i18n.js";
import { cite } from "./rules.js";

export const NEEDS = ["BLIND_LOW_VISION", "DEAF_HARD_OF_HEARING", "NO_FACIAL_GESTURES", "FINGERPRINTS_UNREADABLE",
  "CANNOT_SIGN", "CANNOT_TRAVEL", "NO_OWN_MOBILE", "NEEDS_SIMPLE_LANGUAGE"];
export const OVDS = ["PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "NREGA_JOB_CARD", "NPR_LETTER"];
export const PAN_FORMS = ["CARD", "E_PAN", "NONE"];
export const ROUTES = ["CKYCR", "VIDEO_KYC", "AADHAAR_FACE_AUTH", "DIGITAL_KYC", "FINGERPRINT_EKYC", "AADHAAR_OTP_EKYC",
  "SMALL_ACCOUNT", "SUBSIDY_EXCEPTION"];

export function normaliseProfile(p = {}) {
  const pick = (v, d) => (v === undefined || v === null ? d : v);
  const needs = [...new Set((p.needs || []).filter((n) => NEEDS.includes(n)))];
  const ovds = [...new Set((p.other_ovds || []).filter((o) => OVDS.includes(o)))];
  return {
    needs: needs.sort((a, b) => NEEDS.indexOf(a) - NEEDS.indexOf(b)),
    has_aadhaar: !!pick(p.has_aadhaar, true),
    share_aadhaar: !!pick(p.share_aadhaar, true),
    aadhaar_mobile_linked: !!pick(p.aadhaar_mobile_linked, false),
    pan: PAN_FORMS.includes(p.pan) ? p.pan : "CARD",
    other_ovds: ovds.sort((a, b) => OVDS.indexOf(a) - OVDS.indexOf(b)),
    has_ckyc_identifier: !!pick(p.has_ckyc_identifier, false),
    seeks_government_benefit: !!pick(p.seeks_government_benefit, false),
  };
}

const P = (key, ...rules) => ({ key, rules });
function option(route, rules, fullKyc) {
  return { route, status: "POSSIBLE", rules, full_kyc: fullKyc, why: [], blockers: [], accommodations: [], cautions: [], limits: [], documents: [] };
}

export function plan(raw) {
  const profile = normaliseProfile(raw);
  const needs = new Set(profile.needs);
  const any = (...ns) => ns.some((n) => needs.has(n));
  const aadhaar = profile.has_aadhaar && profile.share_aadhaar;
  const noAadhaar = P(profile.seeks_government_benefit ? "not.needs_aadhaar_benefit" : "not.needs_aadhaar", "C2");
  const hasPan = profile.pan !== "NONE";
  const hasOvd = profile.has_aadhaar || profile.other_ovds.length > 0;
  const options = [];
  let o;

  o = option("CKYCR", ["F2"], true);
  if (profile.has_ckyc_identifier) o.why.push(P("why.fastest_ckyc", "F2"));
  else { o.status = "NOT_AVAILABLE"; o.blockers.push(P("not.needs_ckyc", "F2")); }
  options.push(o);

  o = option("VIDEO_KYC", ["E4", "A1"], true);
  if (!(aadhaar || profile.has_ckyc_identifier)) o.blockers.push(P("not.needs_identity_source", "E4"));
  if (!hasPan) o.blockers.push(P("not.needs_pan", "C5", "F4"));
  o.why.push(P("why.from_home"), P("why.full_kyc"), P("why.no_fingerprint", "E4"));
  if (needs.has("NO_FACIAL_GESTURES")) o.why.push(P("why.no_gestures", "B1", "B2"));
  if (needs.has("BLIND_LOW_VISION")) o.accommodations.push(P("accom.blind"));
  if (needs.has("DEAF_HARD_OF_HEARING")) o.accommodations.push(P("accom.deaf", "B9"));
  if (any("BLIND_LOW_VISION", "NEEDS_SIMPLE_LANGUAGE")) o.accommodations.push(P("accom.bc_assist", "A5"));
  o.cautions.push(P("caution.no_prompting", "A3"));
  if (aadhaar) o.cautions.push(P("caution.aadhaar_fresh", "C4"));
  if (profile.pan === "E_PAN") o.cautions.push(P("caution.epan_printout", "C5"));
  o.documents = [...(aadhaar ? ["doc.AADHAAR"] : []), "doc.PAN"];
  options.push(o);

  o = option("AADHAAR_FACE_AUTH", ["E1"], true);
  if (!aadhaar) o.blockers.push(noAadhaar);
  o.why.push(P("why.face_instead", "E1"), P("why.full_kyc"));
  if (needs.has("CANNOT_TRAVEL")) o.accommodations.push(P("accom.bc_assist", "E1"));
  if (needs.has("NO_FACIAL_GESTURES")) o.cautions.push(P("caution.face_auth_alternatives"));
  o.documents = ["doc.AADHAAR"];
  options.push(o);

  o = option("DIGITAL_KYC", ["F1", "C6"], true);
  if (!hasOvd) o.blockers.push(P("not.needs_ovd", "F3"));
  o.why.push(P("why.full_kyc"), P("why.no_fingerprint"));
  if (needs.has("CANNOT_TRAVEL")) o.why.push(P("why.official_can_visit", "F1"));
  if (any("CANNOT_SIGN", "FINGERPRINTS_UNREADABLE", "NO_OWN_MOBILE")) o.why.push(P("why.otp_signature", "E5"));
  if (any("CANNOT_SIGN", "FINGERPRINTS_UNREADABLE")) o.why.push(P("why.thumb_ink", "B6", "E6"));
  if (profile.has_aadhaar) o.cautions.push(P("caution.redact_aadhaar", "C3"));
  o.documents = hasPan ? ["doc.ANY_OVD", "doc.PAN"] : ["doc.ANY_OVD"];
  options.push(o);

  o = option("FINGERPRINT_EKYC", ["E1"], true);
  if (!aadhaar) o.blockers.push(noAadhaar);
  if (needs.has("FINGERPRINTS_UNREADABLE")) o.blockers.push(P("not.fingerprints"));
  o.documents = ["doc.AADHAAR"];
  options.push(o);

  o = option("AADHAAR_OTP_EKYC", ["E2", "D2"], false);
  if (!aadhaar) o.blockers.push(noAadhaar);
  if (!profile.aadhaar_mobile_linked) o.blockers.push(P("not.needs_linked_mobile", "E2"));
  o.why.push(P("why.from_home"), P("why.no_fingerprint"));
  o.limits.push(P("limits.otp", "E2"));
  o.documents = ["doc.AADHAAR"];
  options.push(o);

  o = option("SMALL_ACCOUNT", ["C8"], false);
  o.why.push(P("why.thumb_ink", "E6"));
  o.limits.push(P("limits.small", "C8"));
  options.push(o);

  // The bank still obtains the Aadhaar number ("apart from obtaining the Aadhaar number").
  o = option("SUBSIDY_EXCEPTION", ["E8"], true);
  if (!profile.seeks_government_benefit) o.blockers.push(P("not.only_subsidy", "E8"));
  if (!aadhaar) o.blockers.push(noAadhaar);
  o.documents = ["doc.AADHAAR", "doc.ANY_OVD"];
  options.push(o);

  for (const opt of options) if (opt.blockers.length) opt.status = "NOT_AVAILABLE";

  const ranked = rank(options, needs);
  const always = [P("accom.officer_review", "B4")];
  if (profile.seeks_government_benefit) always.push(P("caution.aadhaar_for_benefit", "C2"));
  else if (profile.has_aadhaar && !profile.share_aadhaar) always.push(noAadhaar);
  return { options: ranked, always };
}

function rank(options, needs) {
  const order = [...ROUTES];
  const move = (route, before) => { order.splice(order.indexOf(route), 1); order.splice(order.indexOf(before), 0, route); };
  if (needs.has("CANNOT_TRAVEL")) move("DIGITAL_KYC", "AADHAAR_FACE_AUTH");
  if (needs.has("FINGERPRINTS_UNREADABLE")) move("SUBSIDY_EXCEPTION", "AADHAAR_OTP_EKYC");
  const key = (o) => [o.status === "NOT_AVAILABLE" ? 1 : 0, o.full_kyc ? 0 : 1, order.indexOf(o.route)];
  const ranked = [...options].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
  const first = ranked.find((o) => o.status === "POSSIBLE");
  if (first) first.status = "RECOMMENDED";
  return ranked;
}

export function renderPoint(p, lang) { return { key: p.key, text: t(p.key, lang), rules: cite(...p.rules) }; }

export function renderPlan(result, lang) {
  const opt = (o) => ({
    route: o.route,
    name: t(`route.${o.route}.name`, lang),
    summary: t(`route.${o.route}.summary`, lang),
    status: o.status,
    status_text: t(`status.${o.status}`, lang),
    full_kyc: o.full_kyc,
    rules: cite(...o.rules),
    why: o.why.map((p) => renderPoint(p, lang)),
    blockers: o.blockers.map((p) => renderPoint(p, lang)),
    accommodations: o.accommodations.map((p) => renderPoint(p, lang)),
    cautions: o.cautions.map((p) => renderPoint(p, lang)),
    limits: o.limits.map((p) => renderPoint(p, lang)),
    documents: o.documents.map((d) => ({ key: d, text: t(d, lang) })),
  });
  return { options: result.options.map(opt), always: result.always.map((p) => renderPoint(p, lang)) };
}
