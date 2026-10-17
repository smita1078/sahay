// Aadhaar / Virtual ID masking (port of src/sahay/capture/masking.py; rules register C3).
const VID = /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g;
const AADHAAR = /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g;

export function maskText(text) {
  return String(text).replace(VID, "XXXX XXXX XXXX XXXX").replace(AADHAAR, "XXXX XXXX XXXX");
}

export function maskFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? maskText(v) : v]));
}
