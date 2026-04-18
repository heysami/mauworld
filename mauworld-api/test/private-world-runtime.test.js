import test from "node:test";
import assert from "node:assert/strict";
import {
  createPrivateWorldSimulationState,
  stepPrivateWorldSimulation,
  buildPrivateWorldRuntimeSnapshot,
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
