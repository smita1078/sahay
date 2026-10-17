import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./helpers.mjs";
import { plan, renderPlan } from "../public/js/planner.js";

test("JS planner matches the Python planner on every fixture", () => {
  const cases = read("./fixtures/planner.json");
  assert.ok(cases.length > 500);
  for (const c of cases) {
    assert.deepEqual(renderPlan(plan(c.profile), c.lang), c.plan, JSON.stringify(c.profile));
  }
});
