import test from "node:test";
import assert from "node:assert/strict";
import {
  buildViewerPresencePayload,
  checkChatRateLimit,
  isEmojiOnlyChatText,
  normalizeInteractionSettings,
  sanitizeChatText,
  sanitizeViewerDisplayName,
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

test("emoji-only chat detection distinguishes reactions from text", () => {
  assert.equal(isEmojiOnlyChatText("❤️"), true);
  assert.equal(isEmojiOnlyChatText("👍 👍"), true);
  assert.equal(isEmojiOnlyChatText("hello"), false);
  assert.equal(isEmojiOnlyChatText("🔥 ok"), false);
});

test("viewer display names trim whitespace and control characters", () => {
  assert.equal(sanitizeViewerDisplayName("  samia\t\n"), "samia");
  assert.equal(sanitizeViewerDisplayName("\u0000\u0007", "visitor 1234"), "visitor 1234");
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

test("chat rate limit allows faster emoji reactions than text", () => {
  const startedAt = 1000;
  const emojiState = {};
  const textState = {};
  const minuteState = {};

  assert.equal(checkChatRateLimit(emojiState, { now: startedAt, text: "❤️" }).allowed, true);
  assert.equal(checkChatRateLimit(emojiState, { now: startedAt + 300, text: "🔥" }).allowed, false);
  assert.equal(checkChatRateLimit(emojiState, { now: startedAt + 600, text: "🔥" }).allowed, true);

  assert.equal(checkChatRateLimit(textState, { now: startedAt, text: "hello" }).allowed, true);
  assert.equal(checkChatRateLimit(textState, { now: startedAt + 600, text: "again" }).allowed, false);
  assert.equal(checkChatRateLimit(textState, { now: startedAt + 1100, text: "again" }).allowed, true);

  minuteState.minuteWindow = Array.from({ length: 40 }, (_, index) => startedAt + index);
  assert.equal(checkChatRateLimit(minuteState, { now: startedAt + 2000, text: "❤️" }).allowed, false);
});

test("presence payload exposes viewer identity and position", () => {
  const payload = buildViewerPresencePayload({
    viewerSessionId: "viewer_1234",
    position: { x: 1, y: 2, z: 3 },
    headingY: 1.25,
    movementState: { moving: true, displayName: "  Samia  " },
    lastPresenceAt: Date.parse("2026-04-15T00:00:00Z"),
  });

  assert.equal(payload.viewer_session_id, "viewer_1234");
  assert.equal(payload.actor.display_name, "Samia");
  assert.equal(payload.position_x, 1);
  assert.equal(payload.heading_y, 1.25);
  assert.deepEqual(payload.movement_state, { moving: true, displayName: "  Samia  " });
});
