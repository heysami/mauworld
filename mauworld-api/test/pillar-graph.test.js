import test from "node:test";
import assert from "node:assert/strict";
import { computePillarGraph } from "../src/lib/pillar-graph.js";

test("computePillarGraph groups connected tags and marks top core tags", () => {
  const result = computePillarGraph({
    coreSize: 2,
    similarityThreshold: 0.2,
    tags: [
      { id: "t1", slug: "javascript", label: "JavaScript" },
      { id: "t2", slug: "typescript", label: "TypeScript" },
      { id: "t3", slug: "react", label: "React" },
      { id: "t4", slug: "poetry", label: "Poetry" },
    ],
    edges: [
      { tag_low_id: "t1", tag_high_id: "t2", weight: 5, active: true },
      { tag_low_id: "t2", tag_high_id: "t3", weight: 3, active: true },
    ],
    existingPillars: [],
  });

  assert.equal(result.pillars.length, 2);
  const largest = result.pillars.find((pillar) => pillar.tag_count === 3);
  assert.ok(largest);
  const largestTags = result.pillarTags.filter((row) => row.pillar_id === largest.id);
  assert.equal(largestTags.length, 3);
  assert.equal(largestTags.filter((row) => row.is_core).length, 2);
  assert.equal(largest.title, "TypeScript");
});

test("computePillarGraph keeps related pillars separate from membership", () => {
  const result = computePillarGraph({
    coreSize: 1,
    similarityThreshold: 0.1,
    tags: [
      { id: "t1", slug: "image-generation", label: "Image Generation" },
      { id: "t2", slug: "image-prompting", label: "Image Prompting" },
      { id: "t3", slug: "poetry", label: "Poetry" },
      { id: "t4", slug: "poem-writing", label: "Poem Writing" },
    ],
    edges: [
      { tag_low_id: "t1", tag_high_id: "t2", weight: 2, active: true },
      { tag_low_id: "t3", tag_high_id: "t4", weight: 2, active: true },
    ],
    existingPillars: [],
  });

  assert.equal(result.pillars.length, 2);
  assert.ok(result.pillarRelated.length >= 0);
  const tagAssignments = new Set(result.tagAssignments.map((entry) => entry.tag_id));
  assert.equal(tagAssignments.size, 4);
});

test("computePillarGraph regenerates legacy branded slugs for rebuilt pillars", () => {
  const input = {
    coreSize: 2,
    similarityThreshold: 0.2,
    tags: [
      { id: "t1", slug: "agent-skills", label: "Agent Skills" },
      { id: "t2", slug: "skill-md", label: "Skill.md" },
      { id: "t3", slug: "prompt-design", label: "Prompt Design" },
    ],
    edges: [
      { tag_low_id: "t1", tag_high_id: "t2", weight: 4, active: true },
      { tag_low_id: "t2", tag_high_id: "t3", weight: 2, active: true },
    ],
    existingPillars: [],
  };
  const fresh = computePillarGraph(input);
  const componentKey = fresh.pillars[0].component_key;

  const rebuilt = computePillarGraph({
    ...input,
    existingPillars: [{
      id: "pillar-1",
      component_key: componentKey,
      slug: "moltbook-e10b6fab",
    }],
  });

  assert.equal(rebuilt.pillars[0].id, "pillar-1");
  assert.equal(rebuilt.pillars[0].slug, fresh.pillars[0].slug);
  assert.doesNotMatch(rebuilt.pillars[0].slug, /moltbook/i);
});
