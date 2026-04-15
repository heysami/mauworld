import test from "node:test";
import assert from "node:assert/strict";
import {
  buildViewerPresencePayload,
  checkChatRateLimit,
  normalizeInteractionSettings,
  sanitizeChatText,
  selectNearestRecipients,
} from "../src/lib/realtime-state.js";

test("interaction settings apply new realtime defaults", () => {
  assert.deepEqual(
    normalizeInteractionSettings({}),
    {
      worldCellSize: 64,
      chatMaxChars: 160,
      chatTtlSeconds: 8,
      chatDetailRadius: 180,
      browserRadius: 96,
      interactionMaxRecipients: 20,
    },
  );
});

test("chat sanitization trims control characters and caps length", () => {
  assert.equal(sanitizeChatText("   hello\nworld  ", 160), "hello world");
  assert.equal(sanitizeChatText("a".repeat(10), 4), "aaaa");
  assert.equal(sanitizeChatText("\u0000\u0007  "), "");
});

test("nearest recipients are deterministic by distance then session id", () => {
  const recipients = selectNearestRecipients({
    senderSessionId: "viewer_self",
    senderPosition: { x: 0, y: 0, z: 0 },
    radius: 180,
    maxRecipients: 3,
    candidates: [
      { viewerSessionId: "viewer_c", position: { x: 10, y: 0, z: 0 } },
      { viewerSessionId: "viewer_b", position: { x: 10, y: 0, z: 0 } },
      { viewerSessionId: "viewer_far", position: { x: 400, y: 0, z: 0 } },
      { viewerSessionId: "viewer_a", position: { x: 4, y: 0, z: 0 } },
    ],
  });

  assert.deepEqual(recipients, ["viewer_a", "viewer_b", "viewer_c"]);
});

test("chat rate limit enforces fast, burst, and minute windows", () => {
  const state = {};
  const startedAt = 1000;

  assert.equal(checkChatRateLimit(state, startedAt).allowed, true);
  assert.equal(checkChatRateLimit(state, startedAt + 100).allowed, false);

  state.fastWindow = [];
  state.burstWindow = [startedAt - 1000, startedAt - 900, startedAt - 800];
  state.minuteWindow = [startedAt - 1000, startedAt - 900, startedAt - 800];
  assert.equal(checkChatRateLimit(state, startedAt + 1200).allowed, false);

  state.fastWindow = [];
  state.burstWindow = [];
  state.minuteWindow = Array.from({ length: 20 }, (_, index) => startedAt + index);
  assert.equal(checkChatRateLimit(state, startedAt + 2000).allowed, false);
});

test("presence payload exposes viewer identity and position", () => {
  const payload = buildViewerPresencePayload({
    viewerSessionId: "viewer_1234",
    position: { x: 1, y: 2, z: 3 },
    headingY: 1.25,
    movementState: { moving: true },
    lastPresenceAt: Date.parse("2026-04-15T00:00:00Z"),
  });

  assert.equal(payload.viewer_session_id, "viewer_1234");
  assert.equal(payload.actor.display_name, "visitor 1234");
  assert.equal(payload.position_x, 1);
  assert.equal(payload.heading_y, 1.25);
  assert.deepEqual(payload.movement_state, { moving: true });
});
