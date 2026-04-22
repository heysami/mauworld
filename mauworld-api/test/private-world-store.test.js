import test from "node:test";
import assert from "node:assert/strict";
import { installPrivateWorldStore } from "../src/lib/private-world-store.js";

class FakeStore {}

installPrivateWorldStore(FakeStore);

function createStore(runtimeOverrides = {}) {
  const store = new FakeStore();
  store.serviceClient = {
    from() {
      throw new Error("runtime control hot path should not query the database");
    },
  };
  store.privateWorldRuntime = {
    async queueInputByReference() {
      return { accepted: true };
    },
    async syncOccupiedPlayerPoseByReference() {
      return { synced: true };
    },
    async syncDynamicInteractionsByReference() {
      return { synced: true, accepted_object_ids: [], rejected_object_ids: [] };
    },
    ...runtimeOverrides,
  };
  return store;
}

function createQuery(rows = []) {
  let result = Array.isArray(rows) ? [...rows] : [];
  return {
    select() {
      return this;
    },
    eq(column, value) {
      result = result.filter((entry) => entry?.[column] === value);
      return this;
    },
    in(column, values = []) {
      const allowed = new Set(values);
      result = result.filter((entry) => allowed.has(entry?.[column]));
      return this;
    },
    gte(column, value) {
      result = result.filter((entry) => entry?.[column] >= value);
      return this;
    },
    gt(column, value) {
      result = result.filter((entry) => entry?.[column] > value);
      return this;
    },
    lte(column, value) {
      result = result.filter((entry) => entry?.[column] <= value);
      return this;
    },
    limit(count) {
      const normalized = Math.max(0, Math.floor(Number(count) || 0));
      result = normalized > 0 ? result.slice(0, normalized) : [];
      return this;
    },
    order(column, { ascending = true } = {}) {
      result = [...result].sort((left, right) => {
        if (left?.[column] === right?.[column]) {
          return 0;
        }
        return left?.[column] > right?.[column] ? 1 : -1;
      });
      if (!ascending) {
        result.reverse();
      }
      return this;
    },
    maybeSingle() {
      if (!result.length) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST116" },
        });
      }
      return Promise.resolve({
        data: result[0],
        error: null,
      });
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: result,
        error: null,
      }).then(resolve, reject);
    },
  };
}

function createDetailStore(runtimeOverrides = {}) {
  const store = new FakeStore();
  store.serviceClient = {
    from(table) {
      const tables = {
        private_worlds: [{
          id: "world_row",
          world_id: "mw_world",
          creator_profile_id: "profile_creator",
          default_scene_id: "scene_main",
          world_type: "private",
          template_size: "medium",
          width: 40,
          length: 40,
          height: 20,
          name: "Runtime Test World",
          about: "",
          max_viewers: 16,
          max_players: 4,
          created_at: "2026-04-20T00:00:00.000Z",
          updated_at: "2026-04-20T00:00:00.000Z",
        }],
        user_profiles: [{
          id: "profile_creator",
          username: "maker",
          display_name: "Maker",
        }],
        private_world_collaborators: [],
        private_world_scenes: [{
          id: "scene_main",
          world_id: "world_row",
          name: "Main Scene",
          version: 1,
          is_default: true,
          scene_doc: { players: [] },
          compiled_doc: { runtime: { resolved_scene_doc: { players: [] } } },
          created_at: "2026-04-20T00:00:00.000Z",
          updated_at: "2026-04-20T00:00:00.000Z",
        }],
        private_world_prefabs: [],
        private_world_active_instances: [{
          id: "instance_one",
          world_id: "world_row",
          status: "started",
          active_scene_id: "scene_main",
          anchor_world_snapshot_id: null,
          anchor_position_x: 0,
          anchor_position_y: 0,
          anchor_position_z: 0,
          miniature_width: 0,
          miniature_length: 0,
          miniature_height: 0,
        }],
        private_world_participants: [],
        private_world_ready_states: [],
        private_world_entity_locks: [],
      };
      return createQuery(tables[table] ?? []);
    },
  };
  store.privateWorldRuntime = {
    getSnapshotByWorldRef() {
      return {
        players: [{ id: "stale_player" }],
      };
    },
    async syncWorldByReference() {
      return {
        players: [{ id: "fresh_player" }],
      };
    },
    ...runtimeOverrides,
  };
  return store;
}

test("private world input forwards directly to the runtime without world lookups", async () => {
  let captured = null;
  const store = createStore({
    async queueInputByReference(payload) {
      captured = payload;
      return { accepted: true, player_entity_id: "player_one" };
    },
  });

  const result = await store.queuePrivateWorldInput({ id: "profile_runner" }, {
    worldId: "mw_world",
    creatorUsername: "maker",
    key: "w",
    state: "down",
    heading_y: 1.25,
    position_x: 12,
    position_y: 4,
    position_z: -8,
    velocity_x: 6.5,
    velocity_y: 0,
    velocity_z: -2.5,
    motion_seq: 42,
  });

  assert.equal(result.accepted, true);
  assert.equal(captured.worldId, "mw_world");
  assert.equal(captured.creatorUsername, "maker");
  assert.equal(captured.profile.id, "profile_runner");
  assert.equal(captured.position_x, 12);
  assert.equal(captured.velocity_x, 6.5);
  assert.equal(captured.motion_seq, 42);
});

test("private world pose sync forwards directly to the runtime without world lookups", async () => {
  let captured = null;
  const store = createStore({
    async syncOccupiedPlayerPoseByReference(payload) {
      captured = payload;
      return { synced: true, motion_seq: payload.motion_seq };
    },
  });

  const result = await store.syncPrivateWorldPlayerPose({ id: "profile_runner" }, {
    worldId: "mw_world",
    creatorUsername: "maker",
    position_x: 3,
    position_y: 1,
    position_z: -2,
    velocity_x: 4,
    velocity_y: 0,
    velocity_z: -1,
    heading_y: 0.8,
    motion_seq: 18,
  });

  assert.equal(result.synced, true);
  assert.equal(captured.worldId, "mw_world");
  assert.equal(captured.creatorUsername, "maker");
  assert.equal(captured.profile.id, "profile_runner");
  assert.equal(captured.position_x, 3);
  assert.equal(captured.headingY, 0.8);
  assert.equal(captured.motion_seq, 18);
});

test("private world interaction sync forwards directly to the runtime without world lookups", async () => {
  let captured = null;
  const store = createStore({
    async syncDynamicInteractionsByReference(payload) {
      captured = payload;
      return { synced: true, accepted_object_ids: ["crate_one"], rejected_object_ids: [] };
    },
  });

  const result = await store.syncPrivateWorldDynamicInteractions({ id: "profile_runner" }, {
    worldId: "mw_world",
    creatorUsername: "maker",
    interactions: [
      {
        object_id: "crate_one",
        interaction_seq: 9,
        position_x: 1,
      },
    ],
  });

  assert.equal(result.synced, true);
  assert.deepEqual(result.accepted_object_ids, ["crate_one"]);
  assert.equal(captured.worldId, "mw_world");
  assert.equal(captured.creatorUsername, "maker");
  assert.equal(captured.profile.id, "profile_runner");
  assert.equal(captured.interactionStates[0].object_id, "crate_one");
});

test("private world detail prefers a synced runtime snapshot over a stale cached one", async () => {
  let syncCalls = 0;
  const store = createDetailStore({
    async syncWorldByReference(payload) {
      syncCalls += 1;
      assert.equal(payload.worldId, "mw_world");
      assert.equal(payload.creatorUsername, "maker");
      return {
        players: [{ id: "fresh_player" }],
      };
    },
  });

  const detail = await store.getPrivateWorldDetail({
    worldId: "mw_world",
    creatorUsername: "maker",
    includeContent: true,
    allowGuest: true,
  });

  assert.equal(syncCalls, 1);
  assert.equal(detail.world.active_instance.runtime.players[0].id, "fresh_player");
});

test("public-world miniature payload hides mid-range player dots and keeps moving platforms", async () => {
  const freshIso = new Date().toISOString();
  const futureIso = new Date(Date.now() + 60_000).toISOString();
  const store = new FakeStore();
  store.serviceClient = {
    from(table) {
      const tables = {
        live_presence_sessions: [{
          viewer_session_id: "viewer_public",
          world_snapshot_id: "snapshot_public",
          position_x: 100,
          position_y: 0,
          position_z: 0,
          expires_at: futureIso,
        }],
        private_world_active_instances: [{
          id: "instance_live",
          world_id: "world_row",
          active_scene_id: "scene_live",
          status: "started",
          anchor_world_snapshot_id: "snapshot_public",
          anchor_position_x: 0,
          anchor_position_y: 0,
          anchor_position_z: 0,
          anchor_cell_x: 0,
          anchor_cell_z: 0,
          miniature_width: 12,
          miniature_length: 6,
          miniature_height: 3,
        }],
        private_worlds: [{
          id: "world_row",
          world_id: "mw_live",
          creator_profile_id: "profile_creator",
          world_type: "private",
          template_size: "medium",
          name: "Live World",
          about: "Testing",
        }],
        private_world_scenes: [{
          id: "scene_live",
          world_id: "world_row",
          compiled_doc: {
            miniature: {
              static_voxels: [
                {
                  id: "voxel_1",
                  position: { x: 0, y: 0.5, z: 0 },
                  scale: { x: 2, y: 1, z: 2 },
                  material: { color: "#ffffff" },
                },
              ],
              screens: [],
              players: [
                {
                  id: "player_one",
                  position: { x: 1, y: 1, z: 0 },
                },
              ],
            },
            runtime: {
              rules: [
                {
                  id: "rule_move_platform",
                  action: "move_platform",
                  target_id: "primitive_platform",
                },
              ],
              resolved_scene_doc: {
                primitives: [
                  {
                    id: "primitive_platform",
                    shape: "box",
                    position: { x: 0, y: 0.5, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 4, y: 1, z: 4 },
                    physics: { carry_riders: true },
                    material: { color: "#00aaff" },
                  },
                ],
              },
            },
            stats: {},
          },
        }],
        private_world_participants: [{
          id: "participant_one",
          instance_id: "instance_live",
          profile_id: "profile_creator",
          guest_session_id: null,
          join_role: "player",
          player_entity_id: "player_one",
          visible_to_others: true,
          last_seen_at: freshIso,
          updated_at: freshIso,
        }],
        private_world_ready_states: [],
        user_profiles: [{
          id: "profile_creator",
          username: "maker",
          display_name: "Maker",
        }],
      };
      return createQuery(tables[table] ?? []);
    },
  };
  store.privateWorldRuntime = {
    getSnapshotByWorldRef() {
      return {
        players: [
          {
            id: "player_one",
            position: { x: 3, y: 1.5, z: -2 },
          },
        ],
        dynamic_objects: [
          {
            id: "primitive_platform",
            shape: "box",
            position: { x: 5, y: 1, z: -1 },
            rotation: { x: 0, y: 0.4, z: 0 },
            scale: { x: 4, y: 1, z: 4 },
            carry_riders: true,
            material: { color: "#55ddff" },
            visible: true,
          },
        ],
      };
    },
  };

  const miniatures = await store.listPrivateWorldMiniaturesForSnapshot({
    worldSnapshotId: "snapshot_public",
    viewerSessionId: "viewer_public",
    cellXMin: -1,
    cellXMax: 1,
    cellZMin: -1,
    cellZMax: 1,
  });

  assert.equal(miniatures.length, 1);
  assert.equal(miniatures[0].lod_band, "mid");
  assert.deepEqual(miniatures[0].visible_players, []);
  assert.equal(miniatures[0].compiled.miniature.moving_platforms.length, 1);
  assert.equal(miniatures[0].compiled.miniature.moving_platforms[0].id, "primitive_platform");
  assert.equal(miniatures[0].compiled.miniature.moving_platforms[0].shape, "box");
  assert.deepEqual(miniatures[0].compiled.miniature.moving_platforms[0].position, { x: 0, y: 0.5, z: 0 });
  assert.deepEqual(miniatures[0].compiled.miniature.moving_platforms[0].rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(miniatures[0].compiled.miniature.moving_platforms[0].scale, { x: 4, y: 1, z: 4 });
  assert.equal(miniatures[0].compiled.miniature.moving_platforms[0].material.color, "#8c94a1");
  assert.equal(miniatures[0].scene_updated_at, null);
});

test("listPrivateWorlds returns lightweight summaries without loading scene content", async () => {
  const freshIso = new Date().toISOString();
  const queriedTables = [];
  const store = new FakeStore();
  store.serviceClient = {
    from(table) {
      queriedTables.push(table);
      const tables = {
        private_world_collaborators: [{
          world_id: "world_row",
          profile_id: "profile_creator",
          role: "creator",
        }],
        private_worlds: [{
          id: "world_row",
          world_id: "mw_world",
          creator_profile_id: "profile_creator",
          world_type: "room",
          template_size: "medium",
          width: 40,
          length: 30,
          height: 20,
          name: "Fast Summary World",
          about: "Only the launcher needs this.",
          search_text: "fast summary world",
          max_viewers: 12,
          max_players: 4,
          created_at: freshIso,
          updated_at: freshIso,
          imported_by_profile_id: null,
        }],
        user_profiles: [{
          id: "profile_creator",
          auth_user_id: "auth_creator",
          username: "maker",
          display_name: "Maker",
        }],
        private_world_active_instances: [{
          id: "instance_live",
          world_id: "world_row",
          status: "started",
          active_scene_id: "scene_main",
          anchor_world_snapshot_id: "snapshot_public",
          anchor_position_x: 10,
          anchor_position_y: 0,
          anchor_position_z: -4,
          miniature_width: 16,
          miniature_length: 12,
          miniature_height: 8,
        }],
        private_world_participants: [{
          instance_id: "instance_live",
          last_seen_at: freshIso,
          visible_to_others: true,
        }],
      };
      return createQuery(tables[table] ?? []);
    },
  };

  const result = await store.listPrivateWorlds({
    id: "profile_creator",
    username: "maker",
  });

  assert.equal(result.worlds.length, 1);
  assert.equal(result.worlds[0].name, "Fast Summary World");
  assert.equal(result.worlds[0].creator.username, "maker");
  assert.equal(result.worlds[0].permissions.can_edit, true);
  assert.equal(result.worlds[0].active_instance.viewer_count, 1);
  assert.equal("scenes" in result.worlds[0], false);
  assert.equal("prefabs" in result.worlds[0], false);
  assert.equal(queriedTables.includes("private_world_scenes"), false);
  assert.equal(queriedTables.includes("private_world_prefabs"), false);
});

test("verifyUserAccessToken dedupes concurrent work and reuses a short-lived cache", async () => {
  let getUserCalls = 0;
  let profileLookupCalls = 0;
  const store = new FakeStore();
  store.serviceClient = {
    auth: {
      async getUser(token) {
        getUserCalls += 1;
        assert.equal(token, "header.eyJleHAiOjk5OTk5OTk5OTl9.signature");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          data: {
            user: {
              id: "auth_creator",
              email: "maker@example.com",
            },
          },
          error: null,
        };
      },
    },
    from(table) {
      assert.equal(table, "user_profiles");
      return {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, "auth_user_id");
          assert.equal(value, "auth_creator");
          return this;
        },
        maybeSingle() {
          profileLookupCalls += 1;
          return Promise.resolve({
            data: {
              id: "profile_creator",
              auth_user_id: "auth_creator",
              username: "maker",
              display_name: "Maker",
            },
            error: null,
          });
        },
      };
    },
  };

  const token = "header.eyJleHAiOjk5OTk5OTk5OTl9.signature";
  const [first, second] = await Promise.all([
    store.verifyUserAccessToken(token),
    store.verifyUserAccessToken(token),
  ]);
  const third = await store.verifyUserAccessToken(token);

  assert.equal(first.user.id, "auth_creator");
  assert.equal(second.profile.username, "maker");
  assert.equal(third.profile.display_name, "Maker");
  assert.equal(getUserCalls, 1);
  assert.equal(profileLookupCalls, 1);
});
