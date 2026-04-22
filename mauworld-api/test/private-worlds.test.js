import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrivateWorldExportPackage,
  compilePrivateWorldScriptDsl,
  compileSceneDoc,
  collectPrivateWorldAssetIds,
  computeMiniatureDimensions,
  createDefaultSceneDoc,
  resolveEntityIdAlias,
  normalizeSceneDoc,
  resolvePrivateWorldSize,
  validatePrivateWorldExportPackage,
} from "../src/lib/private-worlds.js";

test("computeMiniatureDimensions preserves the documented normalization examples", () => {
  assert.deepEqual(
    computeMiniatureDimensions({ width: 40, length: 20, height: 10 }),
    { width: 12, length: 6, height: 3 },
  );
  assert.deepEqual(
    computeMiniatureDimensions({ width: 300, length: 300, height: 50 }),
    { width: 18, length: 18, height: 3 },
  );
});

test("default private world scenes start empty until the builder places entities", () => {
  const scene = createDefaultSceneDoc();
  assert.deepEqual(scene.voxels, []);
  assert.deepEqual(scene.primitives, []);
  assert.deepEqual(scene.panels, []);
  assert.deepEqual(scene.players, []);
});

test("resolvePrivateWorldSize uses voxel-friendly defaults for new worlds", () => {
  assert.deepEqual(
    resolvePrivateWorldSize({ worldType: "room", templateSize: "medium" }),
    {
      worldType: "room",
      templateSize: "medium",
      width: 60,
      length: 40,
      height: 30,
      cap: { width: 160, length: 120, height: 64 },
    },
  );
  assert.deepEqual(
    resolvePrivateWorldSize({ worldType: "board", templateSize: "small" }),
    {
      worldType: "board",
      templateSize: "small",
      width: 40,
      length: 40,
      height: 10,
      cap: { width: 160, length: 160, height: 32 },
    },
  );
});

test("normalizeSceneDoc gives player spawns a character-scale default", () => {
  const scene = normalizeSceneDoc({
    players: [{ id: "player_a", label: "Player A" }],
  });

  assert.equal(scene.players[0].scale, 5);
  assert.deepEqual(scene.players[0].position, { x: 0, y: 4.5, z: 0 });
  assert.equal(scene.players[0].movement_enabled, true);
  assert.equal(scene.players[0].jump_enabled, false);
});

test("normalizeSceneDoc keeps fixed orthogonal player framing fields", () => {
  const scene = normalizeSceneDoc({
    players: [{
      id: "player_a",
      label: "Player A",
      camera_mode: "fixed_orthogonal",
      fixed_top_down_direction: "north east",
      fixed_top_down_angle: 45,
      fixed_top_down_width: 82,
      fixed_top_down_height: 46,
      movement_enabled: false,
      jump_enabled: false,
    }],
  });

  assert.equal(scene.players[0].camera_mode, "fixed_orthogonal");
  assert.equal(scene.players[0].fixed_top_down_direction, "north_east");
  assert.equal(scene.players[0].fixed_top_down_angle, 45);
  assert.equal(scene.players[0].fixed_top_down_width, 82);
  assert.equal(scene.players[0].fixed_top_down_height, 46);
  assert.equal(scene.players[0].movement_enabled, false);
  assert.equal(scene.players[0].jump_enabled, false);
});

test("normalizeSceneDoc keeps orthogonal follow camera distance", () => {
  const scene = normalizeSceneDoc({
    players: [{
      id: "player_a",
      label: "Player A",
      camera_mode: "orthogonal",
      fixed_top_down_direction: "east",
      fixed_top_down_angle: 45,
      fixed_top_down_distance: 36,
    }],
  });

  assert.equal(scene.players[0].camera_mode, "orthogonal");
  assert.equal(scene.players[0].fixed_top_down_direction, "east");
  assert.equal(scene.players[0].fixed_top_down_angle, 45);
  assert.equal(scene.players[0].fixed_top_down_distance, 36);
});

test("normalizeSceneDoc keeps overworld camera variants", () => {
  const scene = normalizeSceneDoc({
    players: [
      {
        id: "player_a",
        label: "Player A",
        camera_mode: "overworld",
        fixed_top_down_direction: "west",
        fixed_top_down_angle: 45,
        fixed_top_down_distance: 32,
      },
      {
        id: "player_b",
        label: "Player B",
        camera_mode: "overworld fixed",
        fixed_top_down_direction: "south east",
        fixed_top_down_angle: 90,
        fixed_top_down_width: 84,
        fixed_top_down_height: 48,
      },
    ],
  });

  assert.equal(scene.players[0].camera_mode, "overworld");
  assert.equal(scene.players[0].fixed_top_down_direction, "west");
  assert.equal(scene.players[0].fixed_top_down_angle, 45);
  assert.equal(scene.players[0].fixed_top_down_distance, 32);
  assert.equal(scene.players[1].camera_mode, "overworld_fixed");
  assert.equal(scene.players[1].fixed_top_down_direction, "south_east");
  assert.equal(scene.players[1].fixed_top_down_angle, 90);
  assert.equal(scene.players[1].fixed_top_down_width, 84);
  assert.equal(scene.players[1].fixed_top_down_height, 48);
});

test("normalizeSceneDoc maps legacy top-down camera modes to orthogonal variants", () => {
  const scene = normalizeSceneDoc({
    players: [
      {
        id: "player_a",
        label: "Player A",
        camera_mode: "top_down",
        fixed_top_down_distance: 34,
      },
      {
        id: "player_b",
        label: "Player B",
        camera_mode: "fixed_top_down_first_person",
        fixed_top_down_direction: "south west",
        fixed_top_down_angle: 0,
        fixed_top_down_width: 54,
        fixed_top_down_height: 30,
      },
    ],
  });

  assert.equal(scene.players[0].camera_mode, "orthogonal");
  assert.equal(scene.players[0].fixed_top_down_distance, 34);
  assert.equal(scene.players[1].camera_mode, "fixed_orthogonal");
  assert.equal(scene.players[1].fixed_top_down_direction, "south_west");
  assert.equal(scene.players[1].fixed_top_down_angle, 0);
  assert.equal(scene.players[1].fixed_top_down_width, 54);
  assert.equal(scene.players[1].fixed_top_down_height, 30);
});

test("normalizeSceneDoc keeps safe defaults and strips executable screen content", () => {
  const scene = normalizeSceneDoc({
    screens: [
      {
        id: "screen-a",
        html: "<div onclick=\"alert(1)\"><script>alert(1)</script><h1>Hello</h1></div>",
      },
    ],
  });

  assert.equal(scene.settings.camera_mode, "third_person");
  assert.equal(scene.screens.length, 1);
  assert.match(scene.screens[0].html, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(scene.screens[0].html, /<script/i);
  assert.doesNotMatch(scene.screens[0].html, /onclick=/i);
});

test("normalizeSceneDoc preserves scene atmosphere settings with safe defaults", () => {
  const defaultScene = createDefaultSceneDoc();
  assert.equal(defaultScene.settings.skybox, "blank");
  assert.equal(defaultScene.settings.ambient_light, "even");

  const scene = normalizeSceneDoc({
    settings: {
      skybox: "sunset",
      ambient_light: "dim",
    },
  });

  assert.equal(scene.settings.skybox, "sunset");
  assert.equal(scene.settings.ambient_light, "dim");

  const fallbackScene = normalizeSceneDoc({
    settings: {
      skybox: "lava",
      ambient_light: "blackout",
    },
  });

  assert.equal(fallbackScene.settings.skybox, "blank");
  assert.equal(fallbackScene.settings.ambient_light, "even");
});

test("normalizeSceneDoc keeps emissive material settings and invisible play-state for voxels and objects", () => {
  const scene = normalizeSceneDoc({
    voxels: [
      {
        id: "glow block",
        invisible: true,
        material: {
          color: "#88cc44",
          emissive_intensity: 3.2,
        },
      },
    ],
    primitives: [
      {
        id: "hidden lamp",
        invisible: true,
        material: {
          color: "#ffcc88",
          emissive_intensity: 2.4,
        },
      },
    ],
  });

  assert.equal(scene.voxels[0].invisible, true);
  assert.equal(scene.voxels[0].material.emissive_intensity, 3.2);
  assert.equal(scene.primitives[0].invisible, true);
  assert.equal(scene.primitives[0].material.emissive_intensity, 2.4);
});

test("normalizeSceneDoc preserves texture asset ids on materials", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      {
        id: "crate",
        material: {
          color: "#abcdef",
          texture_asset_id: "asset_texture_123",
        },
      },
    ],
  });

  assert.equal(scene.primitives[0].material.texture_asset_id, "asset_texture_123");
  assert.equal(scene.primitives[0].material.texture_preset, "none");
});

test("normalizeSceneDoc preserves video texture ids and animation playback settings", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      {
        id: "holo_sign",
        asset_id: "asset_model_sign",
        animation_clip: "Idle",
        animation_autoplay: true,
        animation_loop: false,
        animation_speed: 1.75,
        material: {
          color: "#ffffff",
          video_asset_id: "asset_video_screen",
        },
      },
    ],
    players: [
      {
        id: "hero",
        asset_id: "asset_model_player",
        animation_clip: "Run",
        animation_autoplay: true,
        animation_speed: 0.8,
      },
    ],
  });

  assert.equal(scene.primitives[0].material.video_asset_id, "asset_video_screen");
  assert.equal(scene.primitives[0].animation_clip, "Idle");
  assert.equal(scene.primitives[0].animation_autoplay, true);
  assert.equal(scene.primitives[0].animation_loop, false);
  assert.equal(scene.primitives[0].animation_speed, 1.75);
  assert.equal(scene.players[0].animation_clip, "Run");
  assert.equal(scene.players[0].animation_autoplay, true);
  assert.equal(scene.players[0].animation_loop, true);
  assert.equal(scene.players[0].animation_speed, 0.8);
  assert.deepEqual(
    new Set(collectPrivateWorldAssetIds(scene)),
    new Set(["asset_model_sign", "asset_video_screen", "asset_model_player"]),
  );
});

test("normalizeSceneDoc keeps primitive model skin asset ids and collects their linked assets", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      {
        id: "crate",
        asset_id: "asset_model_crate",
        material: {
          color: "#abcdef",
          texture_asset_id: "asset_texture_crate",
          emissive_intensity: 0.8,
        },
      },
    ],
  });

  assert.equal(scene.primitives[0].asset_id, "asset_model_crate");
  assert.equal(scene.primitives[0].material.color, "#abcdef");
  assert.equal(scene.primitives[0].material.texture_asset_id, "asset_texture_crate");
  assert.equal(scene.primitives[0].material.emissive_intensity, 0.8);
  assert.deepEqual(
    new Set(collectPrivateWorldAssetIds(scene)),
    new Set(["asset_model_crate", "asset_texture_crate"]),
  );
});

test("normalizeSceneDoc keeps player appearance asset ids and collects their linked assets", () => {
  const scene = normalizeSceneDoc({
    players: [
      {
        id: "hero",
        label: "Hero",
        asset_id: "asset_model_player",
        body_mode: "ghost",
        material: {
          color: "#abcdef",
          texture_asset_id: "asset_texture_player",
          emissive_intensity: 1.6,
        },
      },
    ],
  });

  assert.equal(scene.players[0].asset_id, "asset_model_player");
  assert.equal(scene.players[0].material.color, "#abcdef");
  assert.equal(scene.players[0].material.texture_asset_id, "asset_texture_player");
  assert.equal(scene.players[0].material.emissive_intensity, 1.6);
  assert.deepEqual(
    new Set(collectPrivateWorldAssetIds(scene)),
    new Set(["asset_model_player", "asset_texture_player"]),
  );
});

test("normalizeSceneDoc keeps sounds and collects their linked assets", () => {
  const scene = normalizeSceneDoc({
    sounds: [
      {
        id: "alarm_sound",
        label: "Alarm",
        asset_id: "asset_sound_alarm",
        autoplay: true,
        loop: true,
        spatial: false,
        volume: 0.65,
        max_distance: 42,
      },
    ],
  });

  assert.equal(scene.sounds.length, 1);
  assert.equal(scene.sounds[0].asset_id, "asset_sound_alarm");
  assert.equal(scene.sounds[0].autoplay, true);
  assert.equal(scene.sounds[0].loop, true);
  assert.equal(scene.sounds[0].spatial, false);
  assert.equal(scene.sounds[0].volume, 0.65);
  assert.equal(scene.sounds[0].max_distance, 42);
  assert.deepEqual(
    new Set(collectPrivateWorldAssetIds(scene)),
    new Set(["asset_sound_alarm"]),
  );
});

test("normalizeSceneDoc keeps object panel shapes and facing modes", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      {
        id: "poster",
        shape: "panel",
        facing_mode: "billboard",
      },
    ],
  });

  assert.equal(scene.primitives[0].shape, "panel");
  assert.equal(scene.primitives[0].facing_mode, "billboard");
});

test("normalizeSceneDoc keeps object gravity ignore toggles", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      {
        id: "crate",
        rigid_mode: "rigid",
        physics: {
          carry_riders: true,
          gravity_scale: 1,
          ignore_gravity: true,
        },
      },
    ],
    models: [
      {
        id: "statue",
        asset_id: "asset_model_123",
        rigid_mode: "rigid",
        physics: {
          carry_riders: true,
          gravity_scale: 1,
          ignore_gravity: true,
        },
      },
    ],
  });

  assert.equal(scene.primitives[0].physics.carry_riders, true);
  assert.equal(scene.primitives[0].physics.ignore_gravity, true);
  assert.equal(scene.models[0].physics.carry_riders, true);
  assert.equal(scene.models[0].physics.ignore_gravity, true);
});

test("normalizeSceneDoc keeps panels and facing modes for flat authored surfaces", () => {
  const scene = normalizeSceneDoc({
    panels: [
      {
        id: "poster one",
        facing_mode: "billboard",
        material: {
          texture_asset_id: "asset_texture_panel",
        },
      },
    ],
    screens: [
      {
        id: "screen a",
        facingMode: "billboard_y",
        html: "<div>hello</div>",
      },
    ],
    texts: [
      {
        id: "text a",
        value: "Look here",
        facing_mode: "upright_billboard",
      },
    ],
  });

  assert.equal(scene.panels[0].id, "panel_poster-one");
  assert.equal(scene.panels[0].facing_mode, "billboard");
  assert.equal(scene.panels[0].material.texture_asset_id, "asset_texture_panel");
  assert.equal(scene.screens[0].facing_mode, "upright_billboard");
  assert.equal(scene.texts[0].facing_mode, "upright_billboard");
});

test("compileSceneDoc reports panel counts for scene summaries", () => {
  const compiled = compileSceneDoc({
    panels: [{ id: "panel-one", label: "Poster" }],
  });

  assert.equal(compiled.stats.panel_count, 1);
});

test("normalizeSceneDoc remaps raw entity references onto normalized ids", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      { id: "crate one", shape: "box" },
    ],
    texts: [
      { id: "score text", value: "0" },
    ],
    particles: [
      { id: "spark trail", target_id: "crate one", effect: "sparkles" },
    ],
    prefabs: [
      { id: "set a", name: "Set A", entity_ids: ["crate one", "score text"] },
    ],
    rules: [
      {
        id: "launch force",
        trigger: "key_press",
        action: "apply_force",
        key: "space",
        target_id: "crate one",
        payload: { text_id: "score text" },
      },
    ],
  });

  assert.equal(scene.primitives[0].id, "primitive_crate-one");
  assert.equal(scene.particles[0].target_id, "primitive_crate-one");
  assert.deepEqual(scene.prefabs[0].entity_ids, ["primitive_crate-one", "text3d_score-text"]);
  assert.equal(scene.rules[0].target_id, "primitive_crate-one");
  assert.equal(scene.rules[0].payload.text_id, "text3d_score-text");
});

test("normalizeSceneDoc can preserve already-normalized ids for internal scene reuse", () => {
  const scene = normalizeSceneDoc({
    primitives: [
      { id: "primitive_crate-one", shape: "box" },
    ],
    players: [
      { id: "player_player-1", label: "Player 1" },
    ],
  }, {
    preserveNormalizedIds: true,
  });

  assert.equal(scene.primitives[0].id, "primitive_crate-one");
  assert.equal(scene.players[0].id, "player_player-1");
});

test("normalizeSceneDoc keeps canonical player ids stable across repeated normalization", () => {
  const once = normalizeSceneDoc({
    players: [
      { id: "player_player-1", label: "Player 1" },
    ],
  });
  const twice = normalizeSceneDoc(once);

  assert.equal(once.players[0].id, "player_player-1");
  assert.equal(twice.players[0].id, "player_player-1");
});

test("resolveEntityIdAlias matches repeated player id renormalization artifacts", () => {
  assert.equal(
    resolveEntityIdAlias("player", "player_player-1", ["player_player-player-player-1"]),
    "player_player-player-player-1",
  );
  assert.equal(
    resolveEntityIdAlias("player", "player_player-player-player-1", ["player_player-1"]),
    "player_player-1",
  );
});

test("export validation preserves prefab docs and locked lineage credits", () => {
  const exported = buildPrivateWorldExportPackage({
    world: {
      world_id: "mw_origin123",
      world_type: "room",
      template_size: "medium",
      width: 40,
      length: 20,
      height: 10,
      name: "Lantern Hall",
      about: "A social room",
      max_viewers: 20,
      max_players: 8,
      allow_non_editor_export: true,
      allow_non_editor_fork: false,
      origin_world_id: "mw_origin123",
      origin_creator_username: "maker",
      origin_world_name: "Lantern Hall",
    },
    creator: {
      username: "maker",
    },
    exportedBy: {
      username: "forker",
    },
    defaultSceneName: "Main Scene",
    prefabs: [
      {
        name: "Portal Frame",
        prefab_doc: {
          primitives: [{ id: "primitive_portal", shape: "box" }],
          texts: [{ id: "text_portal", value: "Portal" }],
        },
      },
    ],
    scenes: [
      {
        name: "Main Scene",
        scene_doc: {
          players: [{ id: "player_one", label: "Player 1" }],
        },
      },
    ],
  });

  const parsed = validatePrivateWorldExportPackage(exported);
  assert.equal(parsed.credits.origin_world_id, "mw_origin123");
  assert.equal(parsed.credits.origin_creator_username, "maker");
  assert.equal(parsed.world.default_scene_name, "Main Scene");
  assert.equal(parsed.world.allow_non_editor_export, true);
  assert.equal(parsed.world.allow_non_editor_fork, false);
  assert.equal(parsed.prefabs.length, 1);
  assert.equal(parsed.prefabs[0].prefab_doc.primitives[0].id, "primitive_portal");
  assert.equal(parsed.prefabs[0].prefab_doc.texts[0].id, "text3d_text-portal");
  assert.equal(parsed.prefabs[0].prefab_doc.texts[0].value, "Portal");
  assert.equal(parsed.scenes[0].name, "Main Scene");
});

test("v2 export validation preserves asset manifests for archive/json package flows", () => {
  const exported = buildPrivateWorldExportPackage({
    format: "mauworld.private-world.v2",
    world: {
      world_id: "mw_origin123",
      world_type: "room",
      template_size: "medium",
      width: 40,
      length: 20,
      height: 10,
      name: "Lantern Hall",
      about: "A social room",
      max_viewers: 20,
      max_players: 8,
    },
    creator: {
      username: "maker",
    },
    prefabs: [],
    scenes: [
      {
        name: "Main Scene",
        scene_doc: {
          models: [
            {
              id: "banner",
              asset_id: "asset_model_123",
            },
          ],
        },
      },
    ],
    assets: [
      {
        source_asset_id: "asset_model_123",
        asset_type: "model",
        name: "Festival Banner",
        bounds: { x: 2, y: 3, z: 1 },
        files: [
          {
            role: "model_glb",
            filename: "model.glb",
            content_type: "model/gltf-binary",
            path: "assets/asset_model_123/model_glb.glb",
          },
        ],
      },
    ],
  });

  const parsed = validatePrivateWorldExportPackage(exported);
  assert.equal(parsed.format, "mauworld.private-world.v2");
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].asset_type, "model");
  assert.deepEqual(parsed.assets[0].bounds, { x: 2, y: 3, z: 1 });
  assert.equal(parsed.assets[0].files[0].path, "assets/asset_model_123/model_glb.glb");
});

test("compilePrivateWorldScriptDsl translates DSL triggers and actions", () => {
  const compiled = compilePrivateWorldScriptDsl(`
    zone_enter from trigger_start -> apply_force to crate force(0,4,0)
    all_players_ready -> start_scene
    scene_start -> move_platform to moving_platform delta(6,0,6) duration 3s loop pingpong
  `, {
    entityAliases: new Map([
      ["trigger_start", "trigger_start"],
      ["crate", "primitive_crate"],
      ["moving_platform", "primitive_moving_platform"],
    ]),
  });

  assert.equal(compiled.rules.length, 3);
  assert.equal(compiled.rules[0].trigger, "zone_enter");
  assert.equal(compiled.rules[0].source_id, "trigger_start");
  assert.equal(compiled.rules[0].target_id, "primitive_crate");
  assert.deepEqual(compiled.rules[0].payload.force, { x: 0, y: 4, z: 0 });
  assert.equal(compiled.rules[1].action, "start_scene");
  assert.equal(compiled.rules[2].action, "move_platform");
  assert.equal(compiled.rules[2].target_id, "primitive_moving_platform");
  assert.deepEqual(compiled.rules[2].payload.motion_delta, { x: 6, y: 0, z: 6 });
  assert.equal(compiled.rules[2].payload.duration_ms, 3000);
  assert.equal(compiled.rules[2].payload.loop_mode, "pingpong");
});

test("compilePrivateWorldScriptDsl compiles modular control directives and directional force metadata", () => {
  const compiled = compilePrivateWorldScriptDsl(`
# function[controls]: Controls
@module playmode.wasd_jump
@target player_one
@enabled true
@set jump_enabled true
@set jump_height 16
@bind jump_key mouse_right

# function[camera]: Drag
@module camera.overworld_drag_pan
@target player_one
@enabled true
@bind drag_button mouse_middle

# function[force]: Force
key_press key mouse_left from player_one -> apply_force to crate direction facing strength 12
  `, {
    sceneDoc: {
      settings: { gravity: { x: 0, y: -9.8, z: 0 } },
      players: [{
        id: "player_one",
        camera_mode: "overworld",
        movement_enabled: true,
        jump_enabled: false,
      }],
    },
    entityAliases: new Map([
      ["player_one", "player_one"],
      ["crate", "primitive_crate"],
    ]),
  });

  assert.equal(compiled.script_config.player_controls.player_one.params.jump_enabled, true);
  assert.equal(compiled.script_config.player_controls.player_one.params.jump_height, 16);
  assert.equal(compiled.script_config.player_controls.player_one.bindings.jump_key, "mouse_right");
  assert.equal(compiled.script_config.camera_behaviors.player_one.overworld_drag_pan.bindings.drag_button, "mouse_middle");
  assert.equal(compiled.rules[0].payload.force_direction, "player_facing");
  assert.equal(compiled.rules[0].payload.force_magnitude, 12);
  assert.deepEqual(compiled.script_config.action_metadata.directional_force_rule_ids, [compiled.rules[0].id]);
});

test("compileSceneDoc emits runtime script_config for modular DSL scenes", () => {
  const sceneDoc = {
    settings: { gravity: { x: 0, y: -9.8, z: 0 } },
    voxels: [],
    primitives: [],
    screens: [],
    players: [{
      id: "player_one",
      label: "Player One",
      position: { x: 0, y: 1, z: 0 },
      scale: 1,
      body_mode: "ghost",
      camera_mode: "overworld",
      jump_enabled: false,
    }],
    texts: [],
    trigger_zones: [],
    prefabs: [],
    particles: [],
    script_dsl: `
# function[controls]: Controls
@module playmode.wasd_jump
@target player_one
@set jump_enabled true
@bind jump_key mouse_right
    `,
  };
  const compiled = compileSceneDoc(sceneDoc, {
    world_type: "room",
    width: 40,
    length: 30,
    height: 12,
  });

  assert.equal(compiled.runtime.script_config.player_controls.player_one.params.jump_enabled, true);
  assert.equal(compiled.runtime.script_config.player_controls.player_one.bindings.jump_key, "mouse_right");
});

test("compileSceneDoc flattens linked prefab instances into runtime scene data", () => {
  const compiled = compileSceneDoc({
    prefab_instances: [
      {
        id: "arch-instance",
        prefab_id: "prefab_arch",
        position: { x: 5, y: 0, z: 1 },
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  }, {
    prefabs: [
      {
        id: "prefab_arch",
        prefab_doc: {
          primitives: [
            {
              id: "arch-block",
              shape: "box",
              position: { x: 1, y: 2, z: 0 },
              scale: { x: 2, y: 1, z: 1 },
            },
          ],
          screens: [
            {
              id: "arch-screen",
              position: { x: 0, y: 3, z: 0 },
              html: "<div>Arch</div>",
            },
          ],
        },
      },
    ],
  });

  assert.equal(compiled.runtime.resolved_scene_doc.prefab_instances.length, 1);
  assert.equal(compiled.runtime.resolved_scene_doc.primitives.length, 1);
  assert.equal(compiled.runtime.resolved_scene_doc.screens.length, 1);
  assert.equal(compiled.runtime.resolved_scene_doc.primitives[0].position.x, 6);
  assert.equal(compiled.runtime.resolved_scene_doc.primitives[0].instance_id, "prefabinst_arch-instance");
  assert.equal(compiled.runtime.resolved_scene_doc.screens[0].position.y, 3);
  assert.equal(compiled.stats.prefab_instance_count, 1);
});

test("compileSceneDoc allows prefab instance ids in rule targets while keeping them as parent runtime objects", () => {
  const sceneDoc = {
    prefab_instances: [
      {
        id: "platform_group",
        prefab_id: "prefab_platform",
        position: { x: 2, y: 0, z: 1 },
      },
    ],
    script_dsl: "scene_start -> move_platform to platform_group delta(4,0,0) duration 1s",
  };
  const compiled = compileSceneDoc(sceneDoc, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  }, {
    prefabs: [
      {
        id: "prefab_platform",
        prefab_doc: {
          primitives: [
            {
              id: "deck",
              shape: "box",
              position: { x: 0, y: 0.5, z: 0 },
              scale: { x: 4, y: 1, z: 4 },
              rigid_mode: "rigid",
              physics: {
                carry_riders: true,
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(compiled.runtime.rules[0].target_id, "prefabinst_platform-group");
  assert.equal(compiled.runtime.prefab_instances[0].id, "prefabinst_platform-group");
  assert.equal(compiled.runtime.dynamic_objects[0].instance_id, "prefabinst_platform-group");
});

test("compileSceneDoc exposes moving-platform primitives in the miniature payload", () => {
  const compiled = compileSceneDoc({
    primitives: [
      {
        id: "primitive_moving_platform",
        shape: "box",
        position: { x: 1, y: 0.5, z: 2 },
        scale: { x: 4, y: 1, z: 4 },
        physics: {
          carry_riders: true,
        },
      },
      {
        id: "primitive_crate",
        shape: "box",
        position: { x: 8, y: 1, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    rules: [
      {
        id: "rule_move_platform",
        trigger: "scene_start",
        action: "move_platform",
        target_id: "primitive_moving_platform",
        payload: {
          motion_delta: { x: 6, y: 0, z: 0 },
          duration_ms: 3000,
          loop_mode: "pingpong",
        },
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  });

  assert.equal(compiled.miniature.moving_platforms.length, 1);
  assert.equal(compiled.miniature.moving_platforms[0].id, compiled.runtime.rules[0].target_id);
  assert.equal(compiled.miniature.moving_platforms[0].shape, "box");
  assert.deepEqual(compiled.miniature.moving_platforms[0].position, { x: 1, y: 0.5, z: 2 });
  assert.deepEqual(compiled.miniature.moving_platforms[0].rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(compiled.miniature.moving_platforms[0].scale, { x: 4, y: 1, z: 4 });
  assert.equal(compiled.miniature.moving_platforms[0].material.texture_preset, "none");
});

test("compileSceneDoc keeps already-normalized player ids stable when scene docs are reused", () => {
  const compiled = compileSceneDoc({
    players: [
      {
        id: "player_player-1",
        label: "Player 1",
        position: { x: 0, y: 4.5, z: 0 },
        scale: 5,
        body_mode: "rigid",
        camera_mode: "third_person",
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  }, {
    sceneDocAlreadyNormalized: true,
  });

  assert.equal(compiled.runtime.players[0].id, "player_player-1");
  assert.equal(compiled.runtime.resolved_scene_doc.players[0].id, "player_player-1");
});

test("compileSceneDoc keeps model entities with bounds metadata and runtime colliders", () => {
  const compiled = compileSceneDoc({
    models: [
      {
        id: "dragon statue",
        asset_id: "asset_model_abc",
        position: { x: 4, y: 2, z: -1 },
        scale: { x: 2, y: 1.5, z: 2 },
        bounds: { x: 1.2, y: 3, z: 1.1 },
        rigid_mode: "ghost",
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  });

  assert.equal(compiled.stats.model_count, 1);
  assert.equal(compiled.runtime.resolved_scene_doc.models.length, 1);
  assert.equal(compiled.runtime.dynamic_objects.length, 1);
  assert.equal(compiled.runtime.dynamic_objects[0].entity_kind, "model");
  assert.equal(compiled.runtime.dynamic_objects[0].asset_id, "asset_model_abc");
  assert.deepEqual(compiled.runtime.dynamic_objects[0].bounds, { x: 1.2, y: 3, z: 1.1 });
  assert.deepEqual(compiled.runtime.dynamic_objects[0].collider_scale, { x: 2.4, y: 4.5, z: 2.2 });
});

test("compileSceneDoc keeps primitive model skins attached to runtime dynamic objects", () => {
  const compiled = compileSceneDoc({
    primitives: [
      {
        id: "crate_skin",
        asset_id: "asset_model_crate",
        shape: "box",
        position: { x: 1, y: 2, z: 3 },
        scale: { x: 3, y: 2, z: 4 },
        rigid_mode: "rigid",
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  });

  assert.equal(compiled.runtime.dynamic_objects.length, 1);
  assert.equal(compiled.runtime.dynamic_objects[0].entity_kind, "primitive");
  assert.equal(compiled.runtime.dynamic_objects[0].asset_id, "asset_model_crate");
  assert.deepEqual(compiled.runtime.dynamic_objects[0].collider_scale, { x: 3, y: 2, z: 4 });
});

test("compileSceneDoc keeps sound resources in runtime scene data and stats", () => {
  const compiled = compileSceneDoc({
    sounds: [
      {
        id: "alarm_sound",
        asset_id: "asset_sound_alarm",
        position: { x: 2, y: 3, z: 4 },
        volume: 0.6,
        loop: true,
        autoplay: true,
        spatial: false,
        max_distance: 64,
      },
    ],
  }, {
    world_type: "room",
    width: 40,
    length: 20,
    height: 10,
  });

  assert.equal(compiled.stats.sound_count, 1);
  assert.equal(compiled.runtime.resolved_scene_doc.sounds.length, 1);
  assert.equal(compiled.runtime.sounds.length, 1);
  assert.equal(compiled.runtime.sounds[0].id, compiled.runtime.resolved_scene_doc.sounds[0].id);
  assert.match(compiled.runtime.sounds[0].id, /^sound_/);
  assert.equal(compiled.runtime.sounds[0].asset_id, "asset_sound_alarm");
  assert.equal(compiled.runtime.sounds[0].playing, true);
  assert.equal(compiled.runtime.sounds[0].play_revision, 1);
  assert.equal(compiled.runtime.sounds[0].spatial, false);
});
