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
