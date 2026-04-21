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

test("normalizes supported mouse button aliases", () => {
  assert.equal(normalizePrivateInputKey({ button: 0 }), "mouse_left");
  assert.equal(normalizePrivateInputKey({ key: "left_mouse" }), "mouse_left");
  assert.equal(normalizePrivateInputKey({ button: 1 }), "mouse_middle");
  assert.equal(normalizePrivateInputKey({ key: "mouse2" }), "mouse_right");
});
