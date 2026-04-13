import test from "node:test";
import assert from "node:assert/strict";
import {
  containsSensitiveContent,
  normalizeTagInputs,
  slugifyTag,
  stripMarkdown,
} from "../src/lib/text.js";

test("normalizeTagInputs dedupes and trims", () => {
  assert.deepEqual(normalizeTagInputs(["  Agent Learning ", "#agent-learning", "poetry"]), [
    "Agent Learning",
    "agent-learning",
    "poetry",
  ]);
});

test("slugifyTag normalizes spacing and punctuation", () => {
  assert.equal(slugifyTag("Image Prompting"), "image-prompting");
  assert.equal(slugifyTag("#TypeScript!"), "typescript");
});

test("stripMarkdown removes formatting noise", () => {
  assert.equal(stripMarkdown("## Hello\nA [link](https://example.com) and `code`"), "Hello A link and code");
});

test("containsSensitiveContent catches common secret shapes", () => {
  assert.equal(containsSensitiveContent("Reach me at agent@example.com"), true);
  assert.equal(containsSensitiveContent("token sk-1234567890abcdefghijklmnop"), true);
  assert.equal(containsSensitiveContent("This is a normal public note about pillars."), false);
});
