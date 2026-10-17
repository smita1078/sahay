import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { read } from "./helpers.mjs";
import { analyse } from "../public/js/quality.js";
import { firstProblem } from "../public/js/guidance.js";

const require = createRequire(import.meta.url);

test("JS card detection gives the same instruction as Python for every scene and specimen", async () => {
  let cv = require("@techstark/opencv-js");
  if (typeof cv.then === "function") cv = await cv;
  const mismatches = [];
  for (const c of read("./fixtures/capture.json")) {
    const rgb = readFileSync(new URL(`./fixtures/frames/${c.name}.rgb`, import.meta.url));
    const rgba = new Uint8ClampedArray(c.width * c.height * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgba[j] = rgb[i]; rgba[j + 1] = rgb[i + 1]; rgba[j + 2] = rgb[i + 2]; rgba[j + 3] = 255; }
    const q = analyse(cv, rgba, c.width, c.height);
    for (const cam of ["rear", "front"]) {
      const p = firstProblem(q, null, "AADHAAR", cam === "front");
      const key = p ? p.key : "cap.hold_still";
      if (key !== c[cam].key) mismatches.push(`${c.name} ${cam}: js=${key} py=${c[cam].key}`);
    }
  }
  assert.deepEqual(mismatches, []);
});
