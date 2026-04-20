import test from "node:test";
import assert from "node:assert/strict";

import { normalizePrivateInputKey } from "./private-input.mjs";

test("normalizes a literal space key into the runtime space token", () => {
  assert.equal(normalizePrivateInputKey({ key: " " }), "space");
});

test("accepts browser space aliases and code fallback", () => {
  assert.equal(normalizePrivateInputKey({ key: "Space" }), "space");
  assert.equal(normalizePrivateInputKey({ key: "Spacebar" }), "space");
  assert.equal(normalizePrivateInputKey({ key: "", code: "Space" }), "space");
});

test("keeps non-space keys normalized the same way as before", () => {
  assert.equal(normalizePrivateInputKey({ key: "W" }), "w");
  assert.equal(normalizePrivateInputKey({ key: "ArrowLeft" }), "arrowleft");
  assert.equal(normalizePrivateInputKey({ key: "Shift" }), "shift");
});
