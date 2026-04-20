import test from "node:test";
import assert from "node:assert/strict";
import {
  createPrivateWorldSimulationState,
  stepPrivateWorldSimulation,
  buildPrivateWorldRuntimeSnapshot,
  PrivateWorldRuntime,
  shouldRebuildPrivateWorldRuntime,
} from "../src/lib/private-world-runtime.js";

function buildSimulation(input = {}) {
  return createPrivateWorldSimulationState({
    worldId: "mw_runtime",
    creatorUsername: "maker",
    instanceId: "instance_runtime",
    activeSceneId: input.sceneRow?.id ?? "scene_runtime",
    sceneRow: input.sceneRow ?? {
      id: "scene_runtime",
      name: "Runtime Scene",
      scene_doc: input.sceneDoc ?? {
        settings: {
          gravity: { x: 0, y: -9.8, z: 0 },
          camera_mode: "third_person",
        },
        voxels: [],
        primitives: [],
        screens: [],
        players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
        texts: [],
        trigger_zones: [],
        prefabs: [],
        particles: [],
        rules: [],
      },
    },
    scenes: input.scenes ?? [input.sceneRow ?? {
      id: "scene_runtime",
      name: "Runtime Scene",
      scene_doc: input.sceneDoc ?? {},
    }],
    participants: input.participants ?? [{
      profile_id: "profile_one",
      profile: { username: "maker", display_name: "Maker" },
      join_role: "player",
      player_entity_id: "player_player-one",
      ready_state: { ready: true },
    }],
    sceneStarted: input.sceneStarted ?? true,
    status: input.status ?? "started",
  });
}

test("runtime step applies player input and moves occupied players", () => {
  const simulation = buildSimulation();
  const runtime = simulation.runtime;
  const playerId = runtime.players[0].id;
  const before = runtime.players[0].position.z;

  for (let index = 0; index < 8; index += 1) {
    stepPrivateWorldSimulation(runtime, {
      deltaMs: 50,
      pendingInputs: index === 0 ? [{ playerId, key: "w", state: "down" }] : [],
    });
  }

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.scene_started, true);
  assert.equal(snapshot.players[0].occupied_by_username, "maker");
  assert.ok(snapshot.players[0].position.z < before);
});

test("active worlds keep player movement and dynamic physics live before scene start", () => {
  const simulation = buildSimulation({
    sceneStarted: false,
    status: "active",
    participants: [{
      profile_id: "profile_one",
      profile: { username: "maker", display_name: "Maker" },
      join_role: "player",
      player_entity_id: "player_player-one",
      ready_state: { ready: false },
    }],
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 12, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#88aadd", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 1, restitution: 0, friction: 0.4, mass: 1 },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 4.5, z: 0 }, scale: 5, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const playerId = simulation.runtime.players[0].id;
  const beforePlayerZ = simulation.runtime.players[0].position.z;
  const beforeObjectY = simulation.runtime.dynamicObjects[0].position.y;

  for (let index = 0; index < 8; index += 1) {
    stepPrivateWorldSimulation(simulation.runtime, {
      deltaMs: 50,
      pendingInputs: index === 0 ? [{ playerId, key: "w", state: "down" }] : [],
    });
  }

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.scene_started, false);
  assert.ok(snapshot.players[0].position.z < beforePlayerZ);
  assert.ok(snapshot.dynamic_objects[0].position.y < beforeObjectY);
});

test("timer rules enqueue a scene switch once after their delay", () => {
  const nextScene = {
    id: "scene_next",
    name: "Next Scene",
    scene_doc: {
      players: [{ id: "player_one", label: "Player One", position: { x: 4, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
    },
  };
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [
        { id: "rule_timer", trigger: "timer", action: "switch_scene", delay_ms: 100, payload: { scene_id: "scene_next" } },
      ],
    },
    scenes: [
      {
        id: "scene_runtime",
        name: "Runtime Scene",
        scene_doc: {
          players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
          rules: [{ id: "rule_timer", trigger: "timer", action: "switch_scene", delay_ms: 100, payload: { scene_id: "scene_next" } }],
        },
      },
      nextScene,
    ],
  });

  stepPrivateWorldSimulation(simulation.runtime, { deltaMs: 60, pendingInputs: [] });
  assert.equal(simulation.runtime.commandQueue.length, 0);

  stepPrivateWorldSimulation(simulation.runtime, { deltaMs: 60, pendingInputs: [] });
  const ruleId = simulation.runtime.sceneDoc.rules[0].id;
  assert.deepEqual(simulation.runtime.commandQueue[0], {
    type: "switch_scene",
    sceneId: "scene_next",
    sourceRuleId: ruleId,
  });

  const commandsAfterFirstFire = simulation.runtime.commandQueue.length;
  stepPrivateWorldSimulation(simulation.runtime, { deltaMs: 60, pendingInputs: [] });
  assert.equal(simulation.runtime.commandQueue.length, commandsAfterFirstFire);
});

test("key press rules remain repeatable and can reapply force", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: 0, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 1, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#ffffff", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 0, restitution: 0, friction: 0, mass: 1 },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [
        {
          id: "rule_key_force",
          trigger: "key_press",
          action: "apply_force",
          key: "space",
          target_id: "crate_one",
          payload: { force: { x: 0, y: 4, z: 0 } },
        },
      ],
    },
  });
  const playerId = simulation.runtime.players[0].id;

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 50,
    pendingInputs: [{ playerId, key: "space", state: "down" }],
  });
  const firstVelocity = simulation.runtime.dynamicObjects[0].velocity.y;

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 50,
    pendingInputs: [{ playerId, key: "space", state: "up" }],
  });
  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 50,
    pendingInputs: [{ playerId, key: "space", state: "down" }],
  });

  assert.ok(firstVelocity > 0);
  assert.ok(simulation.runtime.dynamicObjects[0].velocity.y > firstVelocity);
});

test("runtime snapshots preserve authored player and object scale", () => {
  const simulation = buildSimulation({
    participants: [],
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 8, z: 0 },
          scale: { x: 6, y: 4, z: 3 },
          rotation: { x: 0.2, y: 0.4, z: 0.1 },
          material: { color: "#88aadd", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 1, restitution: 0, friction: 0.4, mass: 1 },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 4.5, z: 0 }, scale: 5, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.players[0].scale, 5);
  assert.deepEqual(snapshot.dynamic_objects[0].scale, { x: 6, y: 4, z: 3 });
});

test("runtime keeps resolved-scene player ids stable for participant occupancy lookups", () => {
  const simulation = buildSimulation({
    sceneRow: {
      id: "scene_runtime",
      name: "Runtime Scene",
      compiled_doc: {
        runtime: {
          resolved_scene_doc: {
            settings: {
              gravity: { x: 0, y: -9.8, z: 0 },
              camera_mode: "third_person",
            },
            voxels: [],
            primitives: [],
            screens: [],
            players: [
              {
                id: "player_player-1",
                label: "Player One",
                position: { x: 0, y: 4.5, z: 0 },
                scale: 5,
                body_mode: "rigid",
                camera_mode: "third_person",
              },
            ],
            texts: [],
            trigger_zones: [],
            prefabs: [],
            particles: [],
            rules: [],
          },
        },
      },
    },
    participants: [{
      profile_id: "profile_one",
      profile: { username: "maker", display_name: "Maker" },
      join_role: "player",
      player_entity_id: "player_player-1",
      ready_state: { ready: true },
    }],
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.players[0].id, "player_player-1");
  assert.equal(snapshot.players[0].occupied_by_username, "maker");
});

test("runtime repairs compiled player id drift back onto authored player slots", () => {
  const simulation = buildSimulation({
    sceneRow: {
      id: "scene_runtime",
      name: "Runtime Scene",
      scene_doc: {
        settings: {
          gravity: { x: 0, y: -9.8, z: 0 },
          camera_mode: "third_person",
        },
        voxels: [],
        primitives: [],
        screens: [],
        players: [
          {
            id: "player_player-1",
            label: "Player One",
            position: { x: 0, y: 4.5, z: 0 },
            scale: 5,
            body_mode: "rigid",
            camera_mode: "third_person",
          },
        ],
        texts: [],
        trigger_zones: [],
        prefabs: [],
        particles: [],
        rules: [],
      },
      compiled_doc: {
        runtime: {
          resolved_scene_doc: {
            settings: {
              gravity: { x: 0, y: -9.8, z: 0 },
              camera_mode: "third_person",
            },
            voxels: [],
            primitives: [],
            screens: [],
            players: [
              {
                id: "player_player-player-player-1",
                label: "Player One",
                position: { x: 0, y: 4.5, z: 0 },
                scale: 5,
                body_mode: "rigid",
                camera_mode: "third_person",
              },
            ],
            texts: [],
            trigger_zones: [],
            prefabs: [],
            particles: [],
            rules: [],
          },
        },
      },
    },
    participants: [{
      profile_id: "profile_one",
      profile: { username: "maker", display_name: "Maker" },
      join_role: "player",
      player_entity_id: "player_player-player-player-1",
      ready_state: { ready: true },
    }],
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.players[0].id, "player_player-1");
  assert.equal(snapshot.players[0].occupied_by_username, "maker");
});

test("runtime sync does not rebuild unchanged active scenes until a real reset happens", () => {
  assert.equal(
    shouldRebuildPrivateWorldRuntime(
      {
        sceneRowId: "scene_runtime",
        sceneUpdatedAt: "2026-04-20T00:00:00.000Z",
        status: "active",
        sceneStarted: false,
      },
      {
        id: "scene_runtime",
        updated_at: "2026-04-20T00:00:00.000Z",
      },
      {
        nextStatus: "active",
        nextSceneStarted: false,
      },
    ),
    false,
  );
  assert.equal(
    shouldRebuildPrivateWorldRuntime(
      {
        sceneRowId: "scene_runtime",
        sceneUpdatedAt: "2026-04-20T00:00:00.000Z",
        status: "active",
        sceneStarted: false,
      },
      {
        id: "scene_runtime",
        updated_at: "2026-04-20T00:00:00.000Z",
      },
      {
        nextStatus: "started",
        nextSceneStarted: true,
      },
    ),
    false,
  );
  assert.equal(
    shouldRebuildPrivateWorldRuntime(
      {
        sceneRowId: "scene_runtime",
        sceneUpdatedAt: "2026-04-20T00:00:00.000Z",
        status: "started",
        sceneStarted: true,
      },
      {
        id: "scene_runtime",
        updated_at: "2026-04-20T00:00:00.000Z",
      },
      {
        nextStatus: "active",
        nextSceneStarted: false,
      },
    ),
    true,
  );
});

test("runtime input queues directly against a live simulation without forcing a world resync", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  let syncCalls = 0;
  manager.syncWorldByReference = async () => {
    syncCalls += 1;
    return buildPrivateWorldRuntimeSnapshot(simulation);
  };

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const result = await manager.queueInputByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    key: "w",
    state: "down",
    headingY: 1.25,
  });

  assert.equal(syncCalls, 0);
  assert.equal(result.accepted, true);
  assert.equal(simulation.pendingInputs.length, 1);
  assert.equal(simulation.pendingInputs[0].key, "w");
  assert.equal(simulation.pendingInputs[0].state, "down");
  assert.equal(simulation.pendingInputs[0].headingY, 1.25);
});

test("runtime resets an occupied player back to the authored spawn before release", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const player = simulation.runtime.players[0];
  player.position = { x: 7.25, y: 3.5, z: -4.75 };
  player.rotation = { x: 0, y: 0.6, z: 0 };
  const body = simulation.runtime.physics.playerBodies.get(player.id);
  body.setTranslation(player.position, true);
  body.setRotation({ x: 0, y: Math.sin(0.6 / 2), z: 0, w: Math.cos(0.6 / 2) }, true);

  const result = await manager.resetOccupiedPlayerToInitialPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    playerEntityId: "player_player-one",
  });

  const translation = body.translation();
  assert.equal(result.player_entity_id, player.id);
  assert.deepEqual(player.velocity, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(player.position.x - 0) < 0.0001);
  assert.ok(Math.abs(player.position.y - 1) < 0.0001);
  assert.ok(Math.abs(player.position.z - 0) < 0.0001);
  assert.ok(Math.abs(player.rotation.y - 0) < 0.0001);
  assert.ok(Math.abs(translation.x - 0) < 0.0001);
  assert.ok(Math.abs(translation.y - 1) < 0.0001);
  assert.ok(Math.abs(translation.z - 0) < 0.0001);
});

test("runtime syncs the occupied server body to a client-authored pose", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const result = await manager.syncOccupiedPlayerPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    position_x: 9.5,
    position_y: 2.75,
    position_z: -6.25,
    velocity_x: 7,
    velocity_y: 0.5,
    velocity_z: -3,
    heading_y: 0.9,
  });

  const player = simulation.runtime.players[0];
  const translation = simulation.runtime.physics.playerBodies.get(player.id).translation();
  const velocity = simulation.runtime.physics.playerBodies.get(player.id).linvel();
  assert.equal(result.synced, true);
  assert.equal(result.player_entity_id, player.id);
  assert.ok(Math.abs(player.position.x - 9.5) < 0.0001);
  assert.ok(Math.abs(player.position.y - 2.75) < 0.0001);
  assert.ok(Math.abs(player.position.z + 6.25) < 0.0001);
  assert.ok(Math.abs(player.velocity.x - 7) < 0.0001);
  assert.ok(Math.abs(player.velocity.y - 0.5) < 0.0001);
  assert.ok(Math.abs(player.velocity.z + 3) < 0.0001);
  assert.ok(Math.abs(player.rotation.y - 0.9) < 0.0001);
  assert.ok(Math.abs(translation.x - 9.5) < 0.0001);
  assert.ok(Math.abs(translation.y - 2.75) < 0.0001);
  assert.ok(Math.abs(translation.z + 6.25) < 0.0001);
  assert.ok(Math.abs(velocity.x - 7) < 0.0001);
  assert.ok(Math.abs(velocity.y - 0.5) < 0.0001);
  assert.ok(Math.abs(velocity.z + 3) < 0.0001);
});

test("runtime heading makes D strafe relative to facing without rotating the player", () => {
  const simulation = buildSimulation();
  const runtime = simulation.runtime;
  const playerId = runtime.players[0].id;
  const before = {
    x: runtime.players[0].position.x,
    z: runtime.players[0].position.z,
  };

  for (let index = 0; index < 8; index += 1) {
    stepPrivateWorldSimulation(runtime, {
      deltaMs: 50,
      pendingInputs: index === 0
        ? [{ playerId, headingY: Math.PI / 2, key: "d", state: "down" }]
        : [],
    });
  }

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.ok(Math.abs(snapshot.players[0].rotation.y - (Math.PI / 2)) < 0.01);
  assert.ok(snapshot.players[0].position.z < before.z);
  assert.ok(Math.abs(snapshot.players[0].position.x - before.x) < 0.5);
});
