import test from "node:test";
import assert from "node:assert/strict";
import {
  createPrivateWorldSimulationState,
  stepPrivateWorldSimulation,
  buildPrivateWorldRuntimeSnapshot,
  PrivateWorldRuntime,
  shouldRebuildPrivateWorldRuntime,
} from "../src/lib/private-world-runtime.js";
import { compilePrivateWorldScriptDsl } from "../src/lib/private-worlds.js";

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

function createFakeServiceClient(tables = {}) {
  return {
    from(table) {
      return createQuery(tables[table] ?? []);
    },
  };
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

test("runtime buffers an initial jump press until a grounded occupied player settles", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "rigid",
        camera_mode: "third_person",
        jump_enabled: true,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const player = simulation.runtime.players[0];

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 16,
    pendingInputs: [{ playerId: player.id, key: "space", state: "down" }],
  });
  assert.equal(player.onGround, true);
  assert.ok(player.velocity.y <= 0.01);

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 16,
    pendingInputs: [],
  });

  assert.equal(player.onGround, false);
  assert.ok(player.velocity.y > 30);
  assert.ok(player.position.y > 4.5);
});

test("runtime lets occupied ghost players jump with space", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "ghost",
        camera_mode: "third_person",
        jump_enabled: true,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const player = simulation.runtime.players[0];

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 16,
    pendingInputs: [{ playerId: player.id, key: "space", state: "down" }],
  });

  assert.equal(player.onGround, false);
  assert.ok(player.velocity.y > 30);
  assert.ok(player.position.y > 4.5);
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

test("dynamic objects can ignore gravity while staying rigid", () => {
  const simulation = buildSimulation({
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
          physics: { gravity_scale: 1, ignore_gravity: true, restitution: 0, friction: 0.4, mass: 1 },
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
  const beforeObjectY = simulation.runtime.dynamicObjects[0].position.y;

  for (let index = 0; index < 8; index += 1) {
    stepPrivateWorldSimulation(simulation.runtime, {
      deltaMs: 50,
      pendingInputs: [],
    });
  }

  assert.ok(Math.abs(simulation.runtime.dynamicObjects[0].position.y - beforeObjectY) < 0.0001);
});

test("moving platforms can carry players and objects resting on top", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "platform_one",
          shape: "box",
          position: { x: 0, y: 0.5, z: 0 },
          scale: { x: 4, y: 1, z: 4 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#8899aa", texture_preset: "none" },
          rigid_mode: "ghost",
          physics: {
            gravity_scale: 0,
            ignore_gravity: true,
            carry_riders: true,
            restitution: 0,
            friction: 0.4,
            mass: 1,
          },
        },
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0.8, y: 1.5, z: 0.3 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#d0aa88", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: {
            gravity_scale: 0,
            ignore_gravity: true,
            restitution: 0,
            friction: 0.4,
            mass: 1,
          },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0.2, y: 1.9, z: -0.25 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const runtime = simulation.runtime;
  const platform = runtime.dynamicObjects.find((entry) => entry.id.endsWith("platform-one"));
  const crate = runtime.dynamicObjects.find((entry) => entry.id.endsWith("crate-one"));
  const player = runtime.players[0];
  const platformBody = runtime.physics.objectBodies.get(platform.id);
  const targetPosition = { x: 2.3, y: 1.1, z: -1.4 };

  platformBody.setNextKinematicTranslation?.(targetPosition);
  platformBody.setTranslation(targetPosition, true);

  stepPrivateWorldSimulation(runtime, {
    deltaMs: 50,
    pendingInputs: [],
  });

  assert.ok(Math.abs(platform.position.x - targetPosition.x) < 0.001);
  assert.ok(Math.abs(platform.position.y - targetPosition.y) < 0.001);
  assert.ok(Math.abs(platform.position.z - targetPosition.z) < 0.001);
  assert.ok(Math.abs((player.position.x - 0.2) - 2.3) < 0.15);
  assert.ok(Math.abs((player.position.y - 1.9) - 0.6) < 0.05);
  assert.ok(Math.abs((player.position.z + 0.25) + 1.4) < 0.05);
  assert.ok(Math.abs((crate.position.x - 0.8) - 2.3) < 0.05);
  assert.ok(Math.abs((crate.position.y - 1.5) - 0.6) < 0.05);
  assert.ok(Math.abs((crate.position.z - 0.3) + 1.4) < 0.05);
});

test("moving platforms correct shove-like lateral drift and keep riders aligned", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "platform_one",
          shape: "box",
          position: { x: 0, y: 0.5, z: 0 },
          scale: { x: 4, y: 1, z: 4 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#8899aa", texture_preset: "none" },
          rigid_mode: "ghost",
          physics: {
            gravity_scale: 0,
            ignore_gravity: true,
            carry_riders: true,
            restitution: 0,
            friction: 0.4,
            mass: 1,
          },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0.2, y: 1.9, z: -0.25 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const runtime = simulation.runtime;
  const platform = runtime.dynamicObjects.find((entry) => entry.id.endsWith("platform-one"));
  const player = runtime.players[0];
  const platformBody = runtime.physics.objectBodies.get(platform.id);
  const playerBody = runtime.physics.playerBodies.get(player.id);
  const targetPosition = { x: 2.3, y: 1.1, z: -1.4 };

  platformBody.setNextKinematicTranslation?.(targetPosition);
  platformBody.setTranslation(targetPosition, true);
  playerBody.setTranslation({ x: 2.1, y: 2.5, z: 0.95 }, true);
  playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

  stepPrivateWorldSimulation(runtime, {
    deltaMs: 50,
    pendingInputs: [],
  });

  assert.ok(Math.abs((player.position.x - 0.2) - 2.3) < 0.15);
  assert.ok(Math.abs((player.position.y - 1.9) - 0.6) < 0.05);
  assert.ok(Math.abs((player.position.z + 0.25) + 1.4) < 0.15);
});

test("scene_start move_platform scripts move rigid platforms diagonally and carry riders", () => {
  const sceneDoc = {
    settings: { gravity: { x: 0, y: -9.8, z: 0 } },
    voxels: [],
    primitives: [
      {
        id: "moving_platform",
        shape: "box",
        position: { x: 0, y: 0.5, z: 0 },
        scale: { x: 4, y: 1, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#8fd4ff", texture_preset: "metal" },
        rigid_mode: "rigid",
        physics: {
          gravity_scale: 0,
          ignore_gravity: true,
          carry_riders: true,
          restitution: 0,
          friction: 0.9,
          mass: 200,
        },
      },
    ],
    screens: [],
    players: [{ id: "player_one", label: "Player One", position: { x: 0.2, y: 1.9, z: -0.25 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
    texts: [],
    trigger_zones: [],
    prefabs: [],
    particles: [],
    rules: [],
    script_dsl: "scene_start -> move_platform to moving_platform delta(6,0,6) duration 3s loop pingpong",
  };
  const compiledScript = compilePrivateWorldScriptDsl(sceneDoc.script_dsl, {
    entityAliases: new Map([
      ["moving_platform", "primitive_moving-platform"],
    ]),
  });
  const simulation = buildSimulation({
    sceneRow: {
      id: "scene_runtime",
      name: "Runtime Scene",
      scene_doc: sceneDoc,
      compiled_doc: {
        runtime: {
          dsl_rules: compiledScript.rules,
        },
      },
    },
    sceneDoc,
  });
  const runtime = simulation.runtime;
  const platform = runtime.dynamicObjects.find((entry) => entry.id.endsWith("moving-platform"));
  const player = runtime.players[0];
  const beforePlayer = { ...player.position };

  for (let index = 0; index < 12; index += 1) {
    stepPrivateWorldSimulation(runtime, {
      deltaMs: 80,
      pendingInputs: [],
    });
  }

  assert.ok(Math.abs(platform.position.x - 1.92) < 0.15);
  assert.ok(Math.abs(platform.position.z - 1.92) < 0.15);
  assert.ok(Math.abs((player.position.x - beforePlayer.x) - 1.92) < 0.25);
  assert.ok(Math.abs((player.position.z - beforePlayer.z) - 1.92) < 0.25);
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
          position: { x: 4, y: 1, z: 0 },
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

test("runtime can disable jumping while keeping space key rules active", () => {
  const simulation = buildSimulation({
    participants: [{
      profile_id: "profile_one",
      profile: { username: "maker", display_name: "Maker" },
      join_role: "player",
      player_entity_id: "player_one",
      ready_state: { ready: true },
    }],
    sceneDoc: {
      settings: { gravity: { x: 0, y: 0, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 4, y: 1, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#ffffff", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 0, restitution: 0, friction: 0, mass: 1 },
        },
      ],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 1, z: 0 },
        scale: 1,
        body_mode: "rigid",
        camera_mode: "third_person",
        jump_enabled: false,
      }],
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
  const runtime = simulation.runtime;
  const playerId = runtime.players[0].id;
  const beforePlayerY = runtime.players[0].position.y;

  stepPrivateWorldSimulation(runtime, {
    deltaMs: 50,
    pendingInputs: [{ playerId, key: "space", state: "down" }],
  });

  assert.ok(runtime.dynamicObjects[0].velocity.y > 0);
  assert.ok(Math.abs(runtime.players[0].position.y - beforePlayerY) < 0.05);
  assert.ok(runtime.players[0].velocity.y <= 0.05);
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
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "rigid",
        camera_mode: "fixed_top_down_first_person",
        fixed_top_down_direction: "south west",
        fixed_top_down_angle: 45,
        fixed_top_down_width: 80,
        fixed_top_down_height: 48,
        movement_enabled: false,
        jump_enabled: false,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.players[0].scale, 5);
  assert.equal(snapshot.players[0].camera_mode, "fixed_orthogonal");
  assert.equal(snapshot.players[0].fixed_top_down_direction, "south_west");
  assert.equal(snapshot.players[0].fixed_top_down_angle, 45);
  assert.equal(snapshot.players[0].fixed_top_down_width, 80);
  assert.equal(snapshot.players[0].fixed_top_down_height, 48);
  assert.equal(snapshot.players[0].movement_enabled, false);
  assert.equal(snapshot.players[0].jump_enabled, false);
  assert.deepEqual(snapshot.dynamic_objects[0].scale, { x: 6, y: 4, z: 3 });
});

test("runtime snapshots preserve orthogonal follow camera distance", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "rigid",
        camera_mode: "orthogonal",
        fixed_top_down_direction: "east",
        fixed_top_down_angle: 45,
        fixed_top_down_distance: 36,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(snapshot.players[0].camera_mode, "orthogonal");
  assert.equal(snapshot.players[0].fixed_top_down_direction, "east");
  assert.equal(snapshot.players[0].fixed_top_down_angle, 45);
  assert.equal(snapshot.players[0].fixed_top_down_distance, 36);
});

test("runtime snapshots include dynamic motion metadata for continuous client smoothing", () => {
  const simulation = buildSimulation({
    participants: [],
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 6, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
          rotation: { x: 0, y: 0.1, z: 0 },
          material: { color: "#88aadd", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 1, restitution: 0.1, friction: 0.4, mass: 1 },
        },
      ],
      screens: [],
      players: [],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 50,
    pendingInputs: [],
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  assert.equal(typeof snapshot.dynamic_objects[0].sleeping, "boolean");
  assert.equal(Number.isFinite(snapshot.dynamic_objects[0].angular_velocity.x), true);
  assert.equal(Number.isFinite(snapshot.dynamic_objects[0].angular_velocity.y), true);
  assert.equal(Number.isFinite(snapshot.dynamic_objects[0].angular_velocity.z), true);
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

test("runtime queued jump primes the occupied player before the next tick", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "rigid",
        camera_mode: "third_person",
        jump_enabled: true,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const player = simulation.runtime.players[0];
  for (let index = 0; index < 60; index += 1) {
    stepPrivateWorldSimulation(simulation.runtime, {
      deltaMs: 16,
      pendingInputs: [],
    });
  }
  const beforeY = player.position.y;

  const result = await manager.queueInputByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: player.occupied_by_profile_id },
    key: "space",
    state: "down",
  });

  assert.equal(result.accepted, true);
  assert.ok(player.velocity.y > 0);
  assert.equal(player.onGround, false);
  assert.equal(player.sleeping, false);
  assert.equal(simulation.pendingInputs.length, 1);

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 16,
    pendingInputs: simulation.pendingInputs.splice(0),
  });
  assert.ok(player.position.y > beforeY);
});

test("runtime look-only input updates heading without queuing a stale movement trail", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const result = await manager.queueInputByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    headingY: 0.9,
  });

  assert.equal(result.accepted, true);
  assert.equal(simulation.pendingInputs.length, 0);
  assert.ok(Math.abs(simulation.runtime.players[0].rotation.y - 0.9) < 0.0001);
});

test("runtime ignores movement input when a first-person player has movement disabled", () => {
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 0, y: 1, z: 0 },
        scale: 1,
        body_mode: "rigid",
        camera_mode: "first_person",
        movement_enabled: false,
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const player = simulation.runtime.players[0];
  const body = simulation.runtime.physics.playerBodies.get(player.id);
  body.setTranslation(player.position, true);

  stepPrivateWorldSimulation(simulation.runtime, {
    deltaMs: 16,
    pendingInputs: [{
      playerId: player.id,
      key: "w",
      state: "down",
      headingY: 0.6,
    }],
  });

  assert.ok(Math.abs(player.position.x) < 0.0001);
  assert.ok(Math.abs(player.position.z) < 0.0001);
  assert.ok(Math.abs(player.velocity.x) < 0.0001);
  assert.ok(Math.abs(player.velocity.z) < 0.0001);
  assert.ok(Math.abs(player.rotation.y - 0.6) < 0.0001);
});

test("runtime rebuild preserves occupied player pose for same-scene camera edits", async () => {
  const manager = new PrivateWorldRuntime({
    store: {
      serviceClient: createFakeServiceClient({
        private_worlds: [{
          id: "world_row",
          world_id: "mw_runtime",
          creator_profile_id: "profile_one",
          default_scene_id: "scene_runtime",
        }],
        user_profiles: [{
          id: "profile_one",
          username: "maker",
          display_name: "Maker",
        }],
        private_world_active_instances: [{
          id: "instance_runtime",
          world_id: "world_row",
          active_scene_id: "scene_runtime",
          status: "started",
          runtime_state: {
            tick: 12,
            scene_elapsed_ms: 240,
            scene_started: true,
          },
        }],
        private_world_scenes: [{
          id: "scene_runtime",
          world_id: "world_row",
          name: "Runtime Scene",
          version: 2,
          created_at: "2026-04-20T00:00:00.000Z",
          updated_at: "2026-04-20T00:05:00.000Z",
          scene_doc: {
            settings: {
              gravity: { x: 0, y: -9.8, z: 0 },
              camera_mode: "third_person",
            },
            voxels: [],
            primitives: [],
            screens: [],
            players: [{
              id: "player_one",
              label: "Player One",
              position: { x: 0, y: 1, z: 0 },
              scale: 1,
              body_mode: "rigid",
              camera_mode: "fixed_top_down_first_person",
              fixed_top_down_direction: "north east",
              fixed_top_down_angle: 0,
            }],
            texts: [],
            trigger_zones: [],
            prefabs: [],
            particles: [],
            rules: [],
          },
        }],
        private_world_participants: [{
          id: "participant_one",
          instance_id: "instance_runtime",
          profile_id: "profile_one",
          join_role: "player",
          player_entity_id: "player_player-one",
        }],
        private_world_ready_states: [{
          instance_id: "instance_runtime",
          participant_id: "participant_one",
          ready: true,
        }],
      }),
    },
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const player = simulation.runtime.players[0];
  player.position = { x: 7.25, y: 1, z: -4.5 };
  player.rotation = { x: 0, y: 0.62, z: 0 };
  player.velocity = { x: 1.5, y: 0, z: -2.25 };
  player.last_client_motion_seq = 14;
  player.usesLookHeading = true;
  const body = simulation.runtime.physics.playerBodies.get(player.id);
  body.setTranslation(player.position, true);
  body.setLinvel(player.velocity, true);

  const snapshot = await manager.syncWorldByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
  });

  const rebuiltPlayer = simulation.runtime.players[0];
  const rebuiltBody = simulation.runtime.physics.playerBodies.get(rebuiltPlayer.id);
  const translation = rebuiltBody.translation();
  assert.equal(snapshot.players[0].camera_mode, "fixed_orthogonal");
  assert.equal(snapshot.players[0].fixed_top_down_direction, "north_east");
  assert.equal(snapshot.players[0].fixed_top_down_angle, 0);
  assert.ok(Math.abs(rebuiltPlayer.position.x - 7.25) < 0.0001);
  assert.ok(Math.abs(rebuiltPlayer.position.z + 4.5) < 0.0001);
  assert.ok(Math.abs(rebuiltPlayer.rotation.y - 0.62) < 0.0001);
  assert.ok(Math.abs(rebuiltPlayer.velocity.x - 1.5) < 0.0001);
  assert.ok(Math.abs(rebuiltPlayer.velocity.z + 2.25) < 0.0001);
  assert.equal(rebuiltPlayer.last_client_motion_seq, 14);
  assert.equal(rebuiltPlayer.occupied_by_profile_id, "profile_one");
  assert.ok(Math.abs(translation.x - 7.25) < 0.0001);
  assert.ok(Math.abs(translation.z + 4.5) < 0.0001);
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
  const beforePositionY = simulation.runtime.players[0].position.y;
  const beforeVelocityY = simulation.runtime.players[0].velocity.y;
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
  assert.ok(Math.abs(player.position.y - beforePositionY) < 0.0001);
  assert.ok(Math.abs(player.position.z + 6.25) < 0.0001);
  assert.ok(Math.abs(player.velocity.x - 7) < 0.0001);
  assert.ok(Math.abs(player.velocity.y - beforeVelocityY) < 0.0001);
  assert.ok(Math.abs(player.velocity.z + 3) < 0.0001);
  assert.ok(Math.abs(player.rotation.y - 0.9) < 0.0001);
  assert.ok(Math.abs(translation.x - 9.5) < 0.0001);
  assert.ok(Math.abs(translation.y - beforePositionY) < 0.0001);
  assert.ok(Math.abs(translation.z + 6.25) < 0.0001);
  assert.ok(Math.abs(velocity.x - 7) < 0.0001);
  assert.ok(Math.abs(velocity.y - beforeVelocityY) < 0.0001);
  assert.ok(Math.abs(velocity.z + 3) < 0.0001);
});

test("runtime ignores client planar pose updates while a player is standing on a carry platform", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [{
        id: "platform_one",
        shape: "box",
        position: { x: 2.3, y: 1.1, z: -1.4 },
        scale: { x: 4, y: 1, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#88aadd", texture_preset: "none" },
        rigid_mode: "ghost",
        physics: {
          gravity_scale: 0,
          restitution: 0,
          friction: 0.4,
          mass: 1,
          carry_riders: true,
        },
      }],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 2.5, y: 2.5, z: -1.65 },
        scale: 1,
        body_mode: "rigid",
        camera_mode: "third_person",
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const player = simulation.runtime.players[0];
  const profileId = player.occupied_by_profile_id;
  const body = simulation.runtime.physics.playerBodies.get(player.id);
  const beforePosition = { ...player.position };
  const beforeVelocity = { ...player.velocity };

  const result = await manager.syncOccupiedPlayerPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    position_x: beforePosition.x - 1.2,
    position_y: beforePosition.y - 0.4,
    position_z: beforePosition.z + 1.35,
    velocity_x: -7,
    velocity_y: 0.5,
    velocity_z: 6,
    heading_y: 1.1,
  });

  const translation = body.translation();
  const velocity = body.linvel();
  assert.equal(result.synced, true);
  assert.ok(Math.abs(player.position.x - beforePosition.x) < 0.0001);
  assert.ok(Math.abs(player.position.y - beforePosition.y) < 0.0001);
  assert.ok(Math.abs(player.position.z - beforePosition.z) < 0.0001);
  assert.ok(Math.abs(player.velocity.x - beforeVelocity.x) < 0.0001);
  assert.ok(Math.abs(player.velocity.y - beforeVelocity.y) < 0.0001);
  assert.ok(Math.abs(player.velocity.z - beforeVelocity.z) < 0.0001);
  assert.ok(Math.abs(player.rotation.y - 1.1) < 0.0001);
  assert.ok(Math.abs(translation.x - beforePosition.x) < 0.0001);
  assert.ok(Math.abs(translation.y - beforePosition.y) < 0.0001);
  assert.ok(Math.abs(translation.z - beforePosition.z) < 0.0001);
  assert.ok(Math.abs(velocity.x - beforeVelocity.x) < 0.0001);
  assert.ok(Math.abs(velocity.y - beforeVelocity.y) < 0.0001);
  assert.ok(Math.abs(velocity.z - beforeVelocity.z) < 0.0001);
});

test("runtime applies forced client pose to occupied rigid players in client-authoritative mode", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      voxels: [],
      primitives: [{
        id: "platform_one",
        shape: "box",
        position: { x: 2.3, y: 1.1, z: -1.4 },
        scale: { x: 4, y: 1, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#88aadd", texture_preset: "none" },
        rigid_mode: "ghost",
        physics: {
          gravity_scale: 0,
          restitution: 0,
          friction: 0.4,
          mass: 1,
          carry_riders: true,
        },
      }],
      screens: [],
      players: [{
        id: "player_one",
        label: "Player One",
        position: { x: 2.5, y: 2.5, z: -1.65 },
        scale: 1,
        body_mode: "rigid",
        camera_mode: "third_person",
      }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const player = simulation.runtime.players[0];
  const profileId = player.occupied_by_profile_id;
  const body = simulation.runtime.physics.playerBodies.get(player.id);

  const result = await manager.syncOccupiedPlayerPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    position_x: 1.3,
    position_y: 2.1,
    position_z: -0.3,
    velocity_x: -7,
    velocity_y: 0.5,
    velocity_z: 6,
    heading_y: 1.1,
    force_client_pose: true,
  });

  const snapshot = buildPrivateWorldRuntimeSnapshot(simulation);
  const mirroredPlayer = snapshot.players.find((entry) => entry.id === player.id);
  const translation = body.translation();
  const velocity = body.linvel();
  assert.equal(result.synced, true);
  assert.ok(Math.abs(player.position.x - 1.3) < 0.0001);
  assert.ok(Math.abs(player.position.y - 2.1) < 0.0001);
  assert.ok(Math.abs(player.position.z + 0.3) < 0.0001);
  assert.ok(Math.abs(player.velocity.x + 7) < 0.0001);
  assert.ok(Math.abs(player.velocity.y - 0.5) < 0.0001);
  assert.ok(Math.abs(player.velocity.z - 6) < 0.0001);
  assert.ok(Math.abs(translation.x - 1.3) < 0.0001);
  assert.ok(Math.abs(translation.y - 2.1) < 0.0001);
  assert.ok(Math.abs(translation.z + 0.3) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.position.x - 1.3) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.position.y - 2.1) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.position.z + 0.3) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.velocity.x + 7) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.velocity.y - 0.5) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.velocity.z - 6) < 0.0001);
  assert.ok(Math.abs(mirroredPlayer.rotation.y - 1.1) < 0.0001);
});

test("runtime leases nearby dynamic objects to the interacting player and applies their state", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 1, z: -4 },
          scale: { x: 2, y: 2, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#88aadd", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 1, restitution: 0, friction: 0.4, mass: 1 },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const result = await manager.syncDynamicInteractionsByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId, username: "maker" },
    interactionStates: [
      {
        object_id: "crate_one",
        interaction_seq: 7,
        position_x: 0.5,
        position_y: 1.1,
        position_z: -5.5,
        velocity_x: 0,
        velocity_y: 0,
        velocity_z: -8,
      },
    ],
  });

  const entry = simulation.runtime.dynamicObjects[0];
  assert.equal(result.synced, true);
  assert.deepEqual(result.accepted_object_ids, ["primitive_crate-one"]);
  assert.equal(entry.authority_owner_profile_id, profileId);
  assert.equal(entry.authority_owner_username, "maker");
  assert.ok(entry.authority_lease_until_ms > Date.now());
  assert.ok(Math.abs(entry.position.z + 5.5) < 0.0001);
  assert.ok(Math.abs(entry.velocity.z + 8) < 0.0001);
});

test("runtime rejects dynamic interaction claims from another player while a lease is active", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [
        {
          id: "crate_one",
          shape: "box",
          position: { x: 0, y: 1, z: -4 },
          scale: { x: 2, y: 2, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#88aadd", texture_preset: "none" },
          rigid_mode: "rigid",
          physics: { gravity_scale: 1, restitution: 0, friction: 0.4, mass: 1 },
        },
      ],
      screens: [],
      players: [
        { id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" },
        { id: "player_two", label: "Player Two", position: { x: 1, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" },
      ],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
    participants: [
      {
        profile_id: "profile_one",
        profile: { username: "maker", display_name: "Maker" },
        join_role: "player",
        player_entity_id: "player_player-one",
        ready_state: { ready: true },
      },
      {
        profile_id: "profile_two",
        profile: { username: "guest2", display_name: "Guest 2" },
        join_role: "player",
        player_entity_id: "player_player-two",
        ready_state: { ready: true },
      },
    ],
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  await manager.syncDynamicInteractionsByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: "profile_one", username: "maker" },
    interactionStates: [{ object_id: "crate_one", interaction_seq: 2, position_z: -5 }],
  });

  const result = await manager.syncDynamicInteractionsByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: "profile_two", username: "guest2" },
    interactionStates: [{ object_id: "crate_one", interaction_seq: 3, position_z: -6 }],
  });

  assert.deepEqual(result.accepted_object_ids, []);
  assert.deepEqual(result.rejected_object_ids, ["primitive_crate-one"]);
  assert.equal(simulation.runtime.dynamicObjects[0].authority_owner_profile_id, "profile_one");
});

test("runtime rejects dynamic interaction claims for carry-rider platforms", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [
        {
          id: "platform_one",
          shape: "box",
          position: { x: 0, y: 0.5, z: -4 },
          scale: { x: 4, y: 1, z: 4 },
          rotation: { x: 0, y: 0, z: 0 },
          material: { color: "#8fd4ff", texture_preset: "metal" },
          rigid_mode: "rigid",
          physics: {
            gravity_scale: 0,
            ignore_gravity: true,
            carry_riders: true,
            restitution: 0,
            friction: 0.9,
            mass: 200,
          },
        },
      ],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "rigid", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  const result = await manager.syncDynamicInteractionsByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId, username: "maker" },
    interactionStates: [
      {
        object_id: "platform_one",
        interaction_seq: 7,
        position_x: 0.5,
        position_y: 0.5,
        position_z: -5.5,
        velocity_x: 0,
        velocity_y: 0,
        velocity_z: -8,
      },
    ],
  });

  const entry = simulation.runtime.dynamicObjects[0];
  assert.equal(result.synced, true);
  assert.deepEqual(result.accepted_object_ids, []);
  assert.deepEqual(result.rejected_object_ids, ["primitive_platform-one"]);
  assert.equal(entry.authority_owner_profile_id, null);
  assert.ok(Math.abs(entry.position.x - 0) < 0.0001);
  assert.ok(Math.abs(entry.position.z + 4) < 0.0001);
});

test("runtime ignores out-of-order motion sequences and keeps the newest client pose", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation();
  const worldKey = manager.getWorldRefKey(simulation.worldId, simulation.creatorUsername);
  manager.instancesById.set(simulation.instanceId, simulation);
  manager.keysByWorldRef.set(worldKey, simulation.instanceId);

  const profileId = simulation.runtime.players[0].occupied_by_profile_id;
  await manager.syncOccupiedPlayerPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    position_x: 8,
    position_z: -4,
    velocity_x: 5,
    velocity_z: -2,
    motion_seq: 12,
  });
  await manager.syncOccupiedPlayerPoseByReference({
    worldId: simulation.worldId,
    creatorUsername: simulation.creatorUsername,
    profile: { id: profileId },
    position_x: 2,
    position_z: -1,
    velocity_x: 1,
    velocity_z: -0.5,
    motion_seq: 11,
  });

  const player = simulation.runtime.players[0];
  assert.ok(Math.abs(player.position.x - 8) < 0.0001);
  assert.ok(Math.abs(player.position.z + 4) < 0.0001);
  assert.ok(Math.abs(player.velocity.x - 5) < 0.0001);
  assert.ok(Math.abs(player.velocity.z + 2) < 0.0001);
});

test("runtime syncs full vertical pose for ghost occupied players", async () => {
  const manager = new PrivateWorldRuntime({
    store: {},
  });
  const simulation = buildSimulation({
    sceneDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
      },
      voxels: [],
      primitives: [],
      screens: [],
      players: [{ id: "player_one", label: "Player One", position: { x: 0, y: 1, z: 0 }, scale: 1, body_mode: "ghost", camera_mode: "third_person" }],
      texts: [],
      trigger_zones: [],
      prefabs: [],
      particles: [],
      rules: [],
    },
  });
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
