import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImplicitPrivateWorldScriptConfig,
  compilePrivateWorldScriptDsl,
  parsePrivateWorldScriptFunctions,
  serializePrivateWorldModuleFunctionBody,
} from "./private-script-dsl.mjs";

test("parses modular function directives and emits script config", () => {
  const sceneDoc = {
    settings: {
      gravity: { x: 0, y: -9.8, z: 0 },
    },
    players: [{
      id: "player_one",
      camera_mode: "overworld",
      movement_enabled: true,
      jump_enabled: false,
    }],
  };
  const source = `
# function[controls]: Controls
@module playmode.wasd_jump
@target player_one
@enabled true
@bind move_forward_key i
@bind move_back_key k
@bind move_left_key j
@bind move_right_key l
@set jump_enabled true
@set jump_height 18
@set gravity_scale 1.4
@set deceleration 18
@bind jump_key mouse_right
@bind fire_key mouse_left

# function[camera]: Camera
@module camera.overworld_drag_pan
@target player_one
@set drag_sensitivity 1.5
@bind drag_button mouse_middle

# function[face]: Face
@module behavior.face_mouse_orthogonal
@target player_one
@set enabled true
@set snap_mode 8_way

# function[gravity]: Gravity
@module physics.world
@target scene
@set gravity (0,-12,0)
@set default_friction 0.55

# function[force]: Force
key_press key fire_key from player_one -> apply_force to crate direction facing strength 8
  `;

  const parsedFunctions = parsePrivateWorldScriptFunctions(source, {
    entityAliases: new Map([
      ["player_one", "player_one"],
      ["crate", "crate"],
    ]),
  });
  const compiled = compilePrivateWorldScriptDsl(source, {
    sceneDoc,
    entityAliases: new Map([
      ["player_one", "player_one"],
      ["crate", "crate"],
    ]),
  });

  assert.equal(parsedFunctions[0].module_kind, "playmode.wasd_jump");
  assert.equal(parsedFunctions[3].target_id, "scene");
  assert.equal(compiled.script_config.player_controls.player_one.bindings.move_forward_key, "i");
  assert.equal(compiled.script_config.player_controls.player_one.bindings.fire_key, "mouse_left");
  assert.equal(compiled.script_config.player_controls.player_one.bindings.jump_key, "mouse_right");
  assert.equal(compiled.script_config.player_controls.player_one.params.deceleration, 18);
  assert.equal(compiled.script_config.player_controls.player_one.params.gravity_scale, 1.4);
  assert.equal(compiled.script_config.player_controls.player_one.params.jump_enabled, true);
  assert.equal(compiled.script_config.player_controls.player_one.params.jump_height, 18);
  assert.equal(compiled.script_config.camera_behaviors.player_one.overworld_drag_pan.params.drag_sensitivity, 1.5);
  assert.equal(compiled.script_config.camera_behaviors.player_one.overworld_drag_pan.bindings.drag_button, "mouse_middle");
  assert.equal(compiled.script_config.camera_behaviors.player_one.face_mouse_orthogonal.params.snap_mode, "8_way");
  assert.deepEqual(compiled.script_config.world_physics.params.gravity, { x: 0, y: -12, z: 0 });
  assert.equal(compiled.script_config.world_physics.params.default_friction, 0.55);
  assert.equal(compiled.rules[0].key_binding_ref, "fire_key");
  assert.equal(compiled.rules[0].payload.force_direction, "player_facing");
  assert.equal(compiled.rules[0].payload.force_magnitude, 8);
  assert.ok(compiled.script_config.action_metadata.input_tokens.includes("mouse_left"));
  assert.ok(compiled.script_config.action_metadata.input_tokens.includes("mouse_right"));
  assert.ok(compiled.script_config.action_metadata.input_tokens.includes("i"));
  assert.ok(compiled.script_config.action_metadata.input_tokens.includes("mouse_middle"));
});

test("commented placeholder functions stay non-running", () => {
  const compiled = compilePrivateWorldScriptDsl(`
# function[placeholder]: Launch Bullet Placeholder
# Placeholder only: projectile spawning is not implemented yet.
# key_press key mouse_left from player_one -> launch_bullet to projectile_spawn
  `);

  assert.equal(compiled.rules.length, 0);
  assert.deepEqual(compiled.errors, []);
});

test("implicit defaults preserve legacy player and scene settings", () => {
  const config = buildImplicitPrivateWorldScriptConfig({
    settings: {
      gravity: { x: 0, y: -7, z: 0 },
    },
    players: [{
      id: "player_one",
      movement_enabled: false,
      jump_enabled: true,
      camera_mode: "overworld",
    }],
  });

  assert.equal(config.player_controls.player_one.enabled, false);
  assert.equal(config.player_controls.player_one.bindings.move_forward_key, "w");
  assert.equal(config.player_controls.player_one.bindings.fire_key, "mouse_left");
  assert.equal(config.player_controls.player_one.params.deceleration > 0, true);
  assert.equal(config.player_controls.player_one.params.jump_enabled, true);
  assert.equal(config.camera_behaviors.player_one.overworld_drag_pan.enabled, true);
  assert.deepEqual(config.world_physics.params.gravity, { x: 0, y: -7, z: 0 });
});

test("serializes materialized module functions with the broader editable surface", () => {
  const body = serializePrivateWorldModuleFunctionBody({
    module_kind: "playmode.wasd_jump",
    target_id: "player_one",
    enabled: true,
    params: {
      move_speed: 22,
      deceleration: 18,
      gravity_scale: 1.2,
      jump_enabled: true,
      jump_height: 20,
    },
    bindings: {
      move_forward_key: "i",
      jump_key: "mouse_right",
      fire_key: "mouse_left",
    },
  });

  assert.match(body, /@module playmode\.wasd_jump/);
  assert.match(body, /@bind move_forward_key i/);
  assert.match(body, /@bind fire_key mouse_left/);
  assert.match(body, /@set deceleration 18/);
  assert.match(body, /@set gravity_scale 1\.2/);
});

test("reports invalid module params, bindings, and stale targets as errors", () => {
  const compiled = compilePrivateWorldScriptDsl(`
# function[stale]: Stale Controls
@module playmode.wasd_jump
@target player_missing
@set rocket_speed 22
@bind fly_key q
@set move_speed 99999

# function[rules]: Rules
scene_start -> apply_force to crate_missing direction facing strength 12
  `, {
    sceneDoc: {
      players: [{ id: "player_one" }],
      primitives: [{ id: "crate_one" }],
    },
    entityAliases: new Map([
      ["player_one", "player_one"],
      ["crate_one", "crate_one"],
    ]),
  });

  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("Target `player_missing` no longer exists")));
  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("Parameter `rocket_speed` is not supported")));
  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("Binding `fly_key` is not supported")));
  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("Parameter `move_speed` must stay between")));
  assert.equal(compiled.rules[0].source_line_number, 1);
});

test("prefab instances are valid rule targets but invalid player module targets", () => {
  const sceneDoc = {
    players: [{ id: "player_one" }],
    prefab_instances: [{ id: "prefabinst_group" }],
  };
  const entityAliases = new Map([
    ["player_one", "player_one"],
    ["prefabinst_group", "prefabinst_group"],
  ]);
  const compiled = compilePrivateWorldScriptDsl(`
# function[group]: Group Motion
scene_start -> move_platform to prefabinst_group delta(4,0,0) duration 1s

# function[controls]: Controls
@module playmode.wasd_jump
@target prefabinst_group
  `, {
    sceneDoc,
    entityAliases,
  });

  assert.equal(compiled.rules[0].target_id, "prefabinst_group");
  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("can only target players")));
});

test("physics world modules still only target scene", () => {
  const compiled = compilePrivateWorldScriptDsl(`
# function[gravity]: Gravity
@module physics.world
@target player_one
  `, {
    sceneDoc: {
      players: [{ id: "player_one" }],
    },
    entityAliases: new Map([
      ["player_one", "player_one"],
    ]),
  });

  assert.ok(compiled.errors.some((entry) => String(entry.message).includes("must target `scene`")));
});

test("set_screen_state rules parse screen paths and values", () => {
  const sceneDoc = {
    screens: [{ id: "score_screen" }],
  };
  const entityAliases = new Map([
    ["score_screen", "score_screen"],
  ]);
  const compiled = compilePrivateWorldScriptDsl(`
scene_start -> set_screen_state to score_screen path score value 12
scene_start -> set_screen_state to score_screen path card.type value fire
  `, {
    sceneDoc,
    entityAliases,
  });

  assert.equal(compiled.errors.length, 0);
  assert.equal(compiled.rules[0].action, "set_screen_state");
  assert.equal(compiled.rules[0].target_id, "score_screen");
  assert.equal(compiled.rules[0].payload.path, "score");
  assert.equal(compiled.rules[0].payload.value, 12);
  assert.equal(compiled.rules[1].payload.path, "card.type");
  assert.equal(compiled.rules[1].payload.value, "fire");
});
