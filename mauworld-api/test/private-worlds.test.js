import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrivateWorldExportPackage,
  computeMiniatureDimensions,
  normalizeSceneDoc,
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
  assert.deepEqual(parsed.prefabs[0].prefab_doc, {
    primitives: [{ id: "primitive_portal", shape: "box" }],
    texts: [{ id: "text_portal", value: "Portal" }],
  });
  assert.equal(parsed.scenes[0].name, "Main Scene");
});
