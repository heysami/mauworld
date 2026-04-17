import test from "node:test";
import assert from "node:assert/strict";
import { MauworldStore } from "../src/lib/supabase-store.js";

function cloneRow(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyFilters(rows, filters, orFilters = []) {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.type === "eq") {
        return row[filter.column] === filter.value;
      }
      if (filter.type === "in") {
        return filter.values.includes(row[filter.column]);
      }
      if (filter.type === "gt") {
        return row[filter.column] > filter.value;
      }
      if (filter.type === "gte") {
        return row[filter.column] >= filter.value;
      }
      if (filter.type === "lte") {
        return row[filter.column] <= filter.value;
      }
      if (filter.type === "lt") {
        return row[filter.column] < filter.value;
      }
      return true;
    })
    && (orFilters.length === 0 || orFilters.some((filter) => row[filter.column] === filter.value)));
}

class FakeQuery {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.action = "select";
    this.filters = [];
    this.payload = null;
    this.returning = false;
    this.singleRow = false;
    this.orderBy = null;
    this.orFilters = [];
  }

  select() {
    if (this.action === "update" || this.action === "insert") {
      this.returning = true;
      return this;
    }
    this.action = "select";
    return this;
  }

  update(payload) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  insert(payload) {
    this.action = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: "in", column, values });
    return this;
  }

  gt(column, value) {
    this.filters.push({ type: "gt", column, value });
    return this;
  }

  gte(column, value) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  lt(column, value) {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  or(expression) {
    this.orFilters = String(expression ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^([^.=]+)\.eq\.(.+)$/);
        return match
          ? { column: match[1], value: match[2] }
          : null;
      })
      .filter(Boolean);
    return this;
  }

  order(column, options = {}) {
    this.orderBy = {
      column,
      ascending: options.ascending !== false,
    };
    return this;
  }

  single() {
    this.singleRow = true;
    return this;
  }

  maybeSingle() {
    this.singleRow = true;
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const inFilter = this.filters.find((filter) => filter.type === "in");
    this.state.queryLog.push({
      table: this.table,
      action: this.action,
      filters: this.filters.map((filter) => ({ ...filter })),
      payloadSize: Array.isArray(this.payload) ? this.payload.length : null,
    });

    const limit = this.state.failOnInCount?.[this.table];
    if (limit && inFilter && inFilter.values.length > limit) {
      return {
        data: null,
        error: {
          message: "Bad Request",
        },
      };
    }

    const insertLimit = this.state.failOnInsertCount?.[this.table];
    if (this.action === "insert" && insertLimit && Array.isArray(this.payload) && this.payload.length > insertLimit) {
      return {
        data: null,
        error: {
          message: "Bad Request",
        },
      };
    }

    const tableRows = this.state.tables[this.table] ?? [];

    if (this.action === "select") {
      let rows = applyFilters(tableRows, this.filters, this.orFilters).map(cloneRow);
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows.sort((left, right) => {
          const leftValue = left[column];
          const rightValue = right[column];
          if (leftValue === rightValue) {
            return 0;
          }
          if (leftValue == null) {
            return ascending ? -1 : 1;
          }
          if (rightValue == null) {
            return ascending ? 1 : -1;
          }
          return ascending
            ? (leftValue < rightValue ? -1 : 1)
            : (leftValue > rightValue ? -1 : 1);
        });
      }
      return {
        data: this.singleRow ? rows[0] ?? null : rows,
        error: null,
      };
    }

    if (this.action === "update") {
      const matchingRows = applyFilters(tableRows, this.filters, this.orFilters);
      for (const row of matchingRows) {
        Object.assign(row, cloneRow(this.payload));
      }
      const data = this.returning ? matchingRows.map(cloneRow) : matchingRows.map(cloneRow);
      return {
        data: this.singleRow ? data[0] ?? null : data,
        error: null,
      };
    }

    if (this.action === "insert") {
      const insertedRows = this.payload.map((row) => cloneRow(row));
      tableRows.push(...insertedRows);
      this.state.tables[this.table] = tableRows;
      return {
        data: this.singleRow ? insertedRows[0] ?? null : insertedRows,
        error: null,
      };
    }

    if (this.action === "delete") {
      const retainedRows = [];
      const deletedRows = [];
      for (const row of tableRows) {
        if (applyFilters([row], this.filters, this.orFilters).length > 0) {
          deletedRows.push(cloneRow(row));
        } else {
          retainedRows.push(row);
        }
      }
      this.state.tables[this.table] = retainedRows;
      return {
        data: this.singleRow ? deletedRows[0] ?? null : deletedRows,
        error: null,
      };
    }

    return {
      data: null,
      error: {
        message: `Unsupported action: ${this.action}`,
      },
    };
  }
}

function createFakeServiceClient(state) {
  return {
    from(table) {
      return new FakeQuery(state, table);
    },
  };
}

test("ensureCurrentWorldContext serves the last built world while repairing failed current snapshots", async () => {
  let rebuildCallCount = 0;
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_failed",
          organization_version_id: "org_current",
          status: "failed",
          built_at: "2026-04-14T05:00:15.282Z",
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion({ version, settings }) {
      rebuildCallCount += 1;
      assert.equal(version.id, "org_current");
      assert.equal(settings.world_queue_batch_size, 100);
      return {
        worldSnapshot: {
          id: "world_rebuilt",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T06:00:00.000Z",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

  assert.equal(rebuildCallCount, 1);
  assert.equal(result.worldSnapshot.id, "world_failed");
  assert.equal(result.worldSummary.current.id, "world_failed");
});

test("ensureCurrentWorldContext keeps serving a fresh ready current world without rebuilding", async () => {
  let rebuildCallCount = 0;
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_ready",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T05:38:00.000Z",
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion() {
      rebuildCallCount += 1;
      return {
        worldSnapshot: {
          id: "world_rebuilt",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T06:00:00.000Z",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

  assert.equal(rebuildCallCount, 0);
  assert.equal(result.worldSnapshot.id, "world_ready");
});

test("ensureCurrentWorldContext rebuilds when there is no built world to serve", async () => {
  let rebuildCallCount = 0;
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_failed",
          organization_version_id: "org_current",
          status: "failed",
          built_at: null,
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion() {
      rebuildCallCount += 1;
      return {
        worldSnapshot: {
          id: "world_rebuilt",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T06:00:00.000Z",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

  assert.equal(rebuildCallCount, 1);
  assert.equal(result.worldSnapshot.id, "world_rebuilt");
  assert.equal(result.worldSummary.current.id, "world_rebuilt");
});

test("ensureCurrentWorldContext serves the last built world when background repair fails", async () => {
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_failed",
          organization_version_id: "org_current",
          status: "failed",
          built_at: "2026-04-14T05:00:15.282Z",
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion() {
      throw new Error("repair failed");
    },
  };

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => {
    logged.push(args);
  };

  try {
    const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

    assert.equal(result.worldSnapshot.id, "world_failed");
    assert.equal(result.worldSummary.current.id, "world_failed");
    await Promise.resolve();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logged.length, 1);
});

test("rebuildWorldSnapshotForVersion batches large post tag lookups", async () => {
  const postCount = 101;
  const state = {
    tables: {
      world_snapshots: [
        {
          id: "world_current",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-14T00:00:00.000Z",
          metrics: {},
        },
      ],
      pillars: [
        {
          id: "pillar_1",
          slug: "agent-learning",
          organization_version_id: "org_current",
          active: true,
          tag_count: 1,
          edge_count: 0,
          core_size: 1,
        },
      ],
      pillar_tags: [
        {
          pillar_id: "pillar_1",
          tag_id: "tag_1",
          rank: 1,
        },
      ],
      posts: Array.from({ length: postCount }, (_, index) => ({
        id: `post_${index + 1}`,
        title: `Post ${index + 1}`,
        body_plain: `Body ${index + 1}`,
        created_at: `2026-04-14T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
        state: "active",
        score: index % 7,
        comment_count: index % 3,
        primary_tag_id: "tag_1",
      })),
      post_tags: Array.from({ length: postCount }, (_, index) => ({
        post_id: `post_${index + 1}`,
        tag_id: "tag_1",
        ordinal: 1,
        created_at: `2026-04-14T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      })),
      world_post_instances: [],
      live_presence_sessions: [],
      world_tag_layouts: [],
      world_pillar_layouts: [],
    },
    failOnInCount: {
      post_tags: 100,
    },
    failOnInsertCount: {
      world_post_instances: 5,
    },
    queryLog: [],
  };

  let failedSnapshotMarks = 0;
  const fakeStore = {
    serviceClient: createFakeServiceClient(state),
    async ensureWorldSnapshotsForVersions() {
      return new Map([["org_current", state.tables.world_snapshots[0]]]);
    },
    async markWorldSnapshotFailed() {
      failedSnapshotMarks += 1;
    },
  };

  const result = await MauworldStore.prototype.rebuildWorldSnapshotForVersion.call(fakeStore, {
    version: { id: "org_current" },
    settings: {
      world_visible_posts_per_tag: 10,
      world_levels_per_pillar: 4,
      world_cell_size: 64,
    },
  });

  const postTagBatchSizes = state.queryLog
    .filter((entry) => entry.table === "post_tags" && entry.action === "select")
    .map((entry) => entry.filters.find((filter) => filter.type === "in" && filter.column === "post_id")?.values.length ?? 0);
  const worldPostInsertBatchSizes = state.queryLog
    .filter((entry) => entry.table === "world_post_instances" && entry.action === "insert")
    .map((entry) => entry.payloadSize ?? 0);

  assert.deepEqual(postTagBatchSizes, [100, 1]);
  assert.deepEqual(worldPostInsertBatchSizes, [...Array(20).fill(5), 1]);
  assert.equal(failedSnapshotMarks, 0);
  assert.equal(result.worldSnapshot.status, "ready");
  assert.equal(state.tables.world_post_instances.length, postCount);
});

test("listPrivateWorldMiniaturesForSnapshot batches participant queries across active domes", async () => {
  const state = {
    tables: {
      live_presence_sessions: [
        {
          id: "presence_1",
          world_snapshot_id: "world_public",
          viewer_session_id: "viewer_test",
          position_x: 0,
          position_y: 0,
          position_z: 0,
          expires_at: "9999-01-01T00:00:00.000Z",
        },
      ],
      private_world_active_instances: [
        {
          id: "instance_a",
          world_id: "world_row_a",
          active_scene_id: "scene_a",
          anchor_world_snapshot_id: "world_public",
          anchor_position_x: 0,
          anchor_position_y: 0,
          anchor_position_z: 0,
          anchor_cell_x: 0,
          anchor_cell_z: 0,
          miniature_width: 12,
          miniature_length: 6,
          miniature_height: 3,
        },
        {
          id: "instance_b",
          world_id: "world_row_b",
          active_scene_id: "scene_b",
          anchor_world_snapshot_id: "world_public",
          anchor_position_x: 64,
          anchor_position_y: 0,
          anchor_position_z: 0,
          anchor_cell_x: 1,
          anchor_cell_z: 0,
          miniature_width: 12,
          miniature_length: 6,
          miniature_height: 3,
        },
      ],
      private_worlds: [
        {
          id: "world_row_a",
          world_id: "mw_a",
          creator_profile_id: "profile_a",
          name: "World A",
          about: "About A",
          world_type: "room",
          template_size: "medium",
        },
        {
          id: "world_row_b",
          world_id: "mw_b",
          creator_profile_id: "profile_b",
          name: "World B",
          about: "About B",
          world_type: "room",
          template_size: "medium",
        },
      ],
      private_world_scenes: [
        {
          id: "scene_a",
          compiled_doc: {
            miniature: {
              static_voxels: [{ id: "vox_a" }],
              screens: [],
              players: [{ id: "player_a", position: { x: 1, y: 2, z: 3 } }],
            },
            stats: {},
          },
        },
        {
          id: "scene_b",
          compiled_doc: {
            miniature: {
              static_voxels: [{ id: "vox_b" }],
              screens: [],
              players: [{ id: "player_b", position: { x: 4, y: 5, z: 6 } }],
            },
            stats: {},
          },
        },
      ],
      user_profiles: [
        { id: "profile_a", username: "maker-a", display_name: "Maker A" },
        { id: "profile_b", username: "maker-b", display_name: "Maker B" },
        { id: "profile_viewer", username: "viewer", display_name: "Viewer" },
      ],
      private_world_participants: [
        {
          id: "participant_a",
          instance_id: "instance_a",
          profile_id: "profile_viewer",
          player_entity_id: "player_a",
          visible_to_others: true,
        },
        {
          id: "participant_b",
          instance_id: "instance_b",
          profile_id: "profile_viewer",
          player_entity_id: "player_b",
          visible_to_others: true,
        },
      ],
      private_world_ready_states: [],
    },
    queryLog: [],
  };

  const fakeStore = {
    serviceClient: createFakeServiceClient(state),
    privateWorldRuntime: {
      getSnapshotByWorldRef() {
        return null;
      },
    },
  };

  const result = await MauworldStore.prototype.listPrivateWorldMiniaturesForSnapshot.call(fakeStore, {
    worldSnapshotId: "world_public",
    viewerSessionId: "viewer_test",
    cellXMin: -1,
    cellXMax: 2,
    cellZMin: -1,
    cellZMax: 1,
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    state.queryLog
      .filter((entry) => entry.table === "private_world_participants" && entry.action === "select")
      .map((entry) => entry.filters.find((filter) => filter.column === "instance_id")?.type),
    ["in"],
  );
});

test("applyCurrentOrganizationAssignments batches post counter recomputes", async () => {
  const postCount = 51;
  const state = {
    tables: {
      tags: [
        {
          id: "tag_1",
          pillar_id: null,
          pillar_rank: null,
          is_pillar_core: false,
        },
      ],
      posts: Array.from({ length: postCount }, (_, index) => ({
        id: `post_${index + 1}`,
      })),
    },
    queryLog: [],
  };

  let activeCalls = 0;
  let maxActiveCalls = 0;
  const recomputedPostIds = [];
  const fakeStore = {
    serviceClient: createFakeServiceClient(state),
    async recomputeDerivedCounts(postId) {
      recomputedPostIds.push(postId);
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeCalls -= 1;
    },
  };

  await MauworldStore.prototype.applyCurrentOrganizationAssignments.call(
    fakeStore,
    {
      tagAssignments: [
        {
          tag_id: "tag_1",
          pillar_id: "pillar_placeholder",
          pillar_rank: 1,
          is_pillar_core: true,
        },
      ],
    },
    new Map([["pillar_placeholder", "pillar_1"]]),
  );

  assert.equal(recomputedPostIds.length, postCount);
  assert.equal(new Set(recomputedPostIds).size, postCount);
  assert.equal(state.tables.tags[0].pillar_id, "pillar_1");
  assert.ok(maxActiveCalls <= 25);
});

test("getPillarDetail loads posts from current pillar tags instead of pillar_id_cache", async () => {
  const state = {
    tables: {
      pillars: [
        {
          id: "pillar_1",
          organization_version_id: "org_current",
          title: "Summarization",
          slug: "summarization-abc12345",
          active: true,
          tag_count: 1,
          edge_count: 0,
        },
      ],
      pillar_tags: [
        {
          pillar_id: "pillar_1",
          tag_id: "tag_1",
          rank: 1,
          centrality: 15,
          is_core: true,
        },
      ],
      pillar_related: [],
      tags: [
        {
          id: "tag_1",
          slug: "summarization",
          label: "Summarization",
          usage_count: 15,
          post_count: 15,
        },
      ],
      post_tags: [
        {
          post_id: "post_1",
          tag_id: "tag_1",
          ordinal: 1,
        },
      ],
      posts: [
        {
          id: "post_1",
          author_installation_id: "inst_1",
          title: "Post for current pillar tags",
          state: "active",
          pillar_id_cache: null,
          created_at: "2026-04-15T07:00:00.000Z",
        },
      ],
      agent_installations: [
        {
          id: "inst_1",
          display_name: "Curated Research",
          device_id: "curated-corpus-importer",
          platform: "render-import",
          host_name: "mauworld-api",
        },
      ],
      post_media: [],
      post_emotions: [],
      post_thought_passes: [],
    },
    queryLog: [],
  };

  const fakeStore = {
    serviceClient: createFakeServiceClient(state),
    config: { publicBaseUrl: "https://mauworld.onrender.com" },
    hydratePosts: MauworldStore.prototype.hydratePosts,
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.getPillarDetail.call(fakeStore, "pillar_1");

  assert.equal(result.pillar.id, "pillar_1");
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].id, "post_1");
  assert.equal(result.posts[0].title, "Post for current pillar tags");
});
