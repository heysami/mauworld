import test from "node:test";
import assert from "node:assert/strict";
import {
  brainstormPrivateWorldAiArtifact,
  generatePrivateWorldAiArtifact,
} from "../src/lib/private-world-ai.js";

function installFetchRecorder(t, responseText = "# ok") {
  const originalFetch = global.fetch;
  let lastRequestBody = null;
  global.fetch = async (_url, options = {}) => {
    lastRequestBody = JSON.parse(String(options.body ?? "{}"));
    return {
      ok: true,
      async json() {
        return { output_text: responseText };
      },
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  return () => lastRequestBody;
}

test("world-script brainstorm prompt includes authoritative DSL context", async (t) => {
  const readRequestBody = installFetchRecorder(t, "Assumptions\n\nQuestions\n\nNext direction");
  await brainstormPrivateWorldAiArtifact({
    artifactType: "world_script",
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKey: "sk-test",
    worldName: "Lantern Hall",
    worldAbout: "Prototype chase scene",
    objective: "Make the sphere chase the nearest player.",
    messages: [{ role: "user", text: "make the sphere constantly chase after player any player closer to it" }],
    scriptModuleContext: "physics.world [scope=scene]\nparams: gravity<vector3>",
    scriptTargetContext: "scene [scene]\nprimitive_primitive-primitive-2 [primitive]",
    scriptLibraryContext: "# function[player_controls]: Player Controls\n@module playmode.wasd_jump\n@target player_player-1",
  });
  const prompt = String(readRequestBody()?.input ?? "");
  assert.match(prompt, /authoritative module surface:/i);
  assert.match(prompt, /authoritative scene targets:/i);
  assert.match(prompt, /existing scene logic library:/i);
  assert.match(prompt, /if the requested behavior is unsupported, say so plainly/i);
});

test("world-script generation prompt includes repair draft and validator diagnostics", async (t) => {
  const readRequestBody = installFetchRecorder(t, "@module physics.world\n@target scene\n@set gravity (0,-9.8,0)");
  await generatePrivateWorldAiArtifact({
    artifactType: "world_script",
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKey: "sk-test",
    worldName: "Lantern Hall",
    worldAbout: "Prototype chase scene",
    objective: "Make the sphere chase the nearest player.",
    messages: [{ role: "user", text: "repair the generated draft" }],
    scriptModuleContext: "physics.world [scope=scene]\nparams: gravity<vector3>",
    scriptTargetContext: "scene [scene]\nprimitive_primitive-primitive-2 [primitive]",
    scriptLibraryContext: "# function[player_controls]: Player Controls\n@module playmode.wasd_jump\n@target player_player-1",
    candidateArtifact: "@module physics.world\n@target scene\n@set chase_speed 6",
    validationDiagnostics: [
      { line: 3, message: "Parameter `chase_speed` is not supported by module `physics.world`." },
    ],
    repairMode: true,
  });
  const prompt = String(readRequestBody()?.input ?? "");
  assert.match(prompt, /repair the candidate dsl draft below so it passes the validator/i);
  assert.match(prompt, /candidate dsl draft to repair:/i);
  assert.match(prompt, /validator diagnostics to fix:/i);
  assert.match(prompt, /set_screen_state/i);
  assert.match(prompt, /do not invent syntax or misuse physics\.world/i);
  assert.match(prompt, /@run <every_tick\|on_call\|on_timer\|on_overlap\|on_hit\|on_destroy>/i);
  assert.match(prompt, /call\(function_id_or_name, \.\.\.args\)/i);
  assert.match(prompt, /spawn\(source, position, rotation, options\)/i);
});
