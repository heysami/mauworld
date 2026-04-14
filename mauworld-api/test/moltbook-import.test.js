import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMoltbookImportBody,
  deriveMoltbookEmotions,
  deriveMoltbookTags,
  matchesRemovedImportBranding,
  sanitizeImportedTagLabels,
  scoreMoltbookCandidate,
  shouldRecomputeCuratedCorpusLayout,
  scrubImportedText,
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

test("buildMoltbookImportBody keeps the useful content and a neutral focus summary", () => {
  const body = buildMoltbookImportBody({
    id: "abc-123",
    title: "The skill.md pattern: structured prompts that actually scale",
    content: "Been thinking about agent tooling patterns that work across different frameworks.",
    author: { name: "lobster_bot" },
    submolt: { name: "general" },
  }, ["Moltbook", "Curated Import", "Agent Skills", "Skill.md", "Prompt Design"]);

  assert.doesNotMatch(body, /Source:/);
  assert.doesNotMatch(body, /Moltbook/i);
  assert.doesNotMatch(body, /Curated Import/i);
  assert.match(body, /Focus: Skill\.md, Prompt Design/);
});

test("scrubImportedText removes source platform branding while preserving the note", () => {
  const cleaned = scrubImportedText(`
Source: [OpenClaw Memory Guide](https://www.moltbook.com/post/abc)
Imported: 2026-04-13

Moltbook and #curated import made this OpenClaw note noisy.
`);

  assert.doesNotMatch(cleaned, /Moltbook/i);
  assert.doesNotMatch(cleaned, /OpenClaw/i);
  assert.doesNotMatch(cleaned, /curated import/i);
  assert.match(cleaned, /note noisy/i);
});

test("sanitizeImportedTagLabels strips banned import labels but keeps useful tags", () => {
  const tags = sanitizeImportedTagLabels(["Moltbook", "Curated Import", "Prompt Design", "Skill.md"]);
  assert.deepEqual(tags, ["Agent Skills", "Prompt Design", "Skill.md"]);
});

test("matchesRemovedImportBranding catches stale pillar labels and slugs", () => {
  assert.equal(matchesRemovedImportBranding("Moltbook / Agent Skills / Curated Import"), true);
  assert.equal(matchesRemovedImportBranding("moltbook-e10b6fab"), true);
  assert.equal(matchesRemovedImportBranding("Agent Skills / Prompt Design"), false);
});

test("shouldRecomputeCuratedCorpusLayout forces a rebuild for stale public pillars", () => {
  assert.equal(
    shouldRecomputeCuratedCorpusLayout(
      {
        scrubbedPostCount: 0,
        scrubbedInstallationCount: 0,
        prunedTagCount: 0,
        stalePillarCount: 1,
      },
      {
        skipped: true,
        importedCount: 0,
      },
    ),
    true,
  );
});
