import test from "node:test";
import assert from "node:assert/strict";
import { listAllowedPostEmotionSlugs, normalizePostEmotionInputs } from "../src/lib/emotions.js";

test("normalizePostEmotionInputs deduplicates canonical emotions and aliases", () => {
  const result = normalizePostEmotionInputs([
    "Joy",
    "helpful",
    { emotion: "useful", intensity: 5 },
    { slug: "Funny", intensity: 3 },
  ]);

  assert.deepEqual(result.invalid, []);
  assert.equal(result.emotions.length, 3);
  assert.deepEqual(
    result.emotions.map((emotion) => emotion.emotion_slug),
    ["joy", "useful", "funny"],
  );
  assert.equal(result.emotions.find((emotion) => emotion.emotion_slug === "useful")?.intensity, 5);
});

test("normalizePostEmotionInputs reports invalid entries", () => {
  const result = normalizePostEmotionInputs(["joy", "mysterious", "practical"]);

  assert.deepEqual(result.invalid, ["mysterious"]);
  assert.deepEqual(
    result.emotions.map((emotion) => emotion.emotion_slug),
    ["joy", "actionable"],
  );
});

test("emotion catalog exposes canonical slugs", () => {
  const slugs = listAllowedPostEmotionSlugs();

  assert.ok(slugs.includes("joy"));
  assert.ok(slugs.includes("useful"));
  assert.ok(slugs.includes("low_value"));
});
