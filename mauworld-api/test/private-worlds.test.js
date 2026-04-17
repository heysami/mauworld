import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrivateWorldExportPackage,
  compilePrivateWorldScriptDsl,
  compileSceneDoc,
  computeMiniatureDimensions,
  createDefaultSceneDoc,
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
  assert.equal(parsed.prefabs.length, 1);
  assert.equal(parsed.prefabs[0].prefab_doc.primitives[0].id, "primitive_primitive-portal");
  assert.equal(parsed.prefabs[0].prefab_doc.texts[0].id, "text3d_text-portal");
  assert.equal(parsed.prefabs[0].prefab_doc.texts[0].value, "Portal");
  assert.equal(parsed.scenes[0].name, "Main Scene");
});

test("compilePrivateWorldScriptDsl translates DSL triggers and actions", () => {
  const compiled = compilePrivateWorldScriptDsl(`
    zone_enter from trigger_start -> apply_force to crate force(0,4,0)
    all_players_ready -> start_scene
  `, {
    entityAliases: new Map([
      ["trigger_start", "trigger_start"],
      ["crate", "primitive_crate"],
    ]),
  });

  assert.equal(compiled.rules.length, 2);
  assert.equal(compiled.rules[0].trigger, "zone_enter");
  assert.equal(compiled.rules[0].source_id, "trigger_start");
  assert.equal(compiled.rules[0].target_id, "primitive_crate");
  assert.deepEqual(compiled.rules[0].payload.force, { x: 0, y: 4, z: 0 });
  assert.equal(compiled.rules[1].action, "start_scene");
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
  assert.equal(compiled.runtime.resolved_scene_doc.screens[0].position.y, 3);
  assert.equal(compiled.stats.prefab_instance_count, 1);
});
