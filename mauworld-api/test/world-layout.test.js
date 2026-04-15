import test from "node:test";
import assert from "node:assert/strict";
import { computeWorldDisplayTier, computeWorldLayout } from "../src/lib/world-layout.js";

test("computeWorldLayout materializes one instance per searchable post-tag clone with one canonical home", () => {
  const layout = computeWorldLayout({
    worldSnapshotId: "world_1",
    settings: {
      world_visible_posts_per_tag: 10,
      world_levels_per_pillar: 4,
      world_cell_size: 64,
    },
    pillars: [
      {
        id: "pillar_1",
        slug: "agent-learning",
        tag_count: 2,
        edge_count: 1,
        core_size: 1,
        active: true,
      },
    ],
    pillarTags: [
      { pillar_id: "pillar_1", tag_id: "tag_1", rank: 1 },
      { pillar_id: "pillar_1", tag_id: "tag_2", rank: 2 },
    ],
    posts: [
      {
        id: "post_1",
        created_at: "2026-04-14T00:00:00.000Z",
        state: "active",
        score: 8,
        comment_count: 2,
        primary_tag_id: "tag_1",
      },
      {
        id: "post_2",
        created_at: "2026-04-14T01:00:00.000Z",
        state: "active",
        score: 2,
        comment_count: 0,
        primary_tag_id: "tag_2",
      },
    ],
    postTags: [
      { post_id: "post_1", tag_id: "tag_1", ordinal: 1 },
      { post_id: "post_1", tag_id: "tag_2", ordinal: 2 },
      { post_id: "post_2", tag_id: "tag_2", ordinal: 1 },
    ],
    referenceTime: new Date("2026-04-14T02:00:00.000Z"),
  });

  assert.equal(layout.pillarLayouts.length, 1);
  assert.equal(layout.tagLayouts.length, 2);
  assert.equal(layout.postInstances.length, 3);
  assert.equal(layout.postInstances.filter((row) => row.is_canonical).length, 2);
  assert.ok(layout.postInstances.every((row) => Number.isFinite(row.position_x)));
  assert.ok(layout.postInstances.every((row) => Number.isFinite(row.position_y)));
  assert.ok(layout.postInstances.every((row) => Number.isFinite(row.position_z)));
});

test("computeWorldDisplayTier hides ranks beyond the configured visible limit", () => {
  assert.equal(computeWorldDisplayTier(1, 10), "hero");
  assert.equal(computeWorldDisplayTier(6, 10), "standard");
  assert.equal(computeWorldDisplayTier(12, 30), "hint");
  assert.equal(computeWorldDisplayTier(11, 10), "hidden");
});

test("computeWorldLayout ignores duplicate pillar and post tag rows", () => {
  const layout = computeWorldLayout({
    worldSnapshotId: "world_dedupe",
    settings: {
      world_visible_posts_per_tag: 10,
      world_levels_per_pillar: 4,
      world_cell_size: 64,
    },
    pillars: [
      {
        id: "pillar_1",
        slug: "agent-learning",
        tag_count: 1,
        edge_count: 0,
        core_size: 1,
        active: true,
      },
    ],
    pillarTags: [
      { pillar_id: "pillar_1", tag_id: "tag_1", rank: 1, created_at: "2026-04-14T00:00:00.000Z" },
      { pillar_id: "pillar_1", tag_id: "tag_1", rank: 2, created_at: "2026-04-14T01:00:00.000Z" },
    ],
    posts: [
      {
        id: "post_1",
        created_at: "2026-04-14T00:00:00.000Z",
        state: "active",
        score: 4,
        comment_count: 1,
        primary_tag_id: "tag_1",
      },
    ],
    postTags: [
      { post_id: "post_1", tag_id: "tag_1", ordinal: 1, created_at: "2026-04-14T00:00:00.000Z" },
      { post_id: "post_1", tag_id: "tag_1", ordinal: 2, created_at: "2026-04-14T01:00:00.000Z" },
    ],
    referenceTime: new Date("2026-04-14T02:00:00.000Z"),
  });

  assert.equal(layout.tagLayouts.length, 1);
  assert.equal(layout.postInstances.length, 1);
  assert.equal(layout.postInstances[0].tag_id, "tag_1");
  assert.equal(layout.postInstances[0].post_id, "post_1");
});
