import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMoltbookImportBody,
  deriveMoltbookEmotions,
  deriveMoltbookTags,
  scoreMoltbookCandidate,
} from "../src/lib/moltbook-import.js";

test("scoreMoltbookCandidate prefers high-signal skill posts over marketing fluff", () => {
  const useful = scoreMoltbookCandidate({
    title: "The skill.md pattern: structured prompts that actually scale",
    content: `
      1. Purpose
      2. When to use
      3. Boundaries

      \`\`\`
      # SKILL.md
      \`\`\`
    `,
    relevance: 1.4,
    upvotes: 15,
    comment_count: 9,
  });

  const fluffy = scoreMoltbookCandidate({
    title: "Prompt Engineering Provider: Revolutionizing the AI Marketplace",
    content: "Get started in 5 minutes with our edge bundle and marketplace solution.",
    relevance: 2,
    upvotes: 2,
    comment_count: 0,
  });

  assert.ok(useful.score > fluffy.score);
  assert.ok(useful.themeScore >= 10);
});

test("deriveMoltbookTags maps intent and skill posts to useful tag clusters", () => {
  const tags = deriveMoltbookTags({
    title: "Your spec is already wrong. The question is whether your agent knows that.",
    content: "User intent drifts when the brief is vague, the specification is stale, and the skill.md never states boundaries.",
  });

  assert.ok(tags.includes("Moltbook"));
  assert.ok(tags.includes("Skill.md"));
  assert.ok(tags.includes("User Intent"));
  assert.ok(tags.includes("Specification"));
  assert.ok(tags.includes("Boundaries"));
});

test("deriveMoltbookEmotions adds caution for security-oriented posts", () => {
  const emotions = deriveMoltbookEmotions({
    title: "The supply chain attack nobody is talking about: skill.md is an unsigned binary",
    content: "The attack surface is enormous. Audit every skill, verify signatures, and stop trusting random installs.",
  });
  const slugs = emotions.map((emotion) => emotion.emotion_slug);

  assert.ok(slugs.includes("useful"));
  assert.ok(slugs.includes("suspicious"));
  assert.ok(slugs.includes("fear"));
  assert.ok(slugs.includes("clarifying"));
});

test("buildMoltbookImportBody includes source metadata and a focus summary", () => {
  const body = buildMoltbookImportBody({
    id: "abc-123",
    title: "The skill.md pattern: structured prompts that actually scale",
    content: "Been thinking about agent tooling patterns that work across different frameworks.",
    author: { name: "lobster_bot" },
    submolt: { name: "general" },
  }, ["Moltbook", "Agent Skills", "Skill.md", "Prompt Design"]);

  assert.match(body, /Source: \[The skill\.md pattern: structured prompts that actually scale\]/);
  assert.match(body, /Author: u\/lobster_bot/);
  assert.match(body, /Community: m\/general/);
  assert.match(body, /Focus: Agent Skills, Skill\.md, Prompt Design/);
});
