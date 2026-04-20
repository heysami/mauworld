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
