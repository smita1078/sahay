import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./helpers.mjs";
import { assess, redact } from "../public/js/scam.js";
import { setWords, understandLocally, readback } from "../public/js/voice.js";
import { maskText } from "../public/js/masking.js";

setWords(read("../public/data/voice-words.json"));

test("JS scam check matches Python on every fixture", () => {
  for (const c of read("./fixtures/scam.json")) {
    const r = assess(c.text, c.lang);
    assert.deepEqual({ ...r, ai_used: c.result.ai_used }, c.result, c.text);
  }
  assert.equal(redact("OTP 482913 now"), "OTP •••• now");
});

test("JS voice keywords and read-back match Python", () => {
  for (const c of read("./fixtures/voice.json")) {
    const u = understandLocally(c.text, c.ask);
    assert.deepEqual([...u.needs].sort(), c.needs, c.text);
    assert.equal(u.has_aadhaar, c.has_aadhaar, c.text);
    assert.equal(u.pan, c.pan, c.text);
    assert.deepEqual([...u.other_ovds].sort(), c.other_ovds, c.text);
    assert.equal(u.seeks_government_benefit, c.seeks_government_benefit, c.text);
    for (const lang of ["en", "hi", "mr"]) assert.equal(readback(u, c.ask, lang), c.readback[lang], `${c.text} ${lang}`);
  }
});

test("Aadhaar and VID numbers are masked", () => {
  assert.equal(maskText("VID 9123 4567 8912 3456"), "VID XXXX XXXX XXXX XXXX");
  assert.equal(maskText("Aadhaar: 2345-6789-0123."), "Aadhaar: XXXX XXXX XXXX.");
  assert.equal(maskText("Call 9876543210"), "Call 9876543210");
});
