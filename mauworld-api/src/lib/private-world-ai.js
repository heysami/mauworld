import { HttpError } from "./http.js";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

function requireApiKey(value) {
  const apiKey = String(value ?? "").trim();
  if (!apiKey) {
    throw new HttpError(400, "Missing AI provider API key");
  }
  return apiKey;
}

function buildScreenHtmlPrompt(input = {}) {
  return [
    "Generate a single static HTML page for a 3D world screen.",
    "Use HTML and CSS only. Do not use JavaScript.",
    "Keep the layout self-contained and readable on a billboard-like screen.",
    "Avoid external dependencies, images, scripts, iframes, and remote fonts.",
    `World name: ${input.worldName || "Untitled world"}`,
    `World goal: ${input.worldAbout || "No goal provided"}`,
    `User objective: ${input.objective || "Create a useful visual screen"}`,
    "",
    "Return only raw HTML.",
  ].join("\n");
}

function buildScriptPrompt(input = {}) {
  return [
    "Generate a concise Mauworld private-world rule script.",
    "Target a structured trigger/action DSL using the available triggers:",
    "zone_enter, zone_exit, key_press, timer, scene_start, all_players_ready.",
    "Target the available actions:",
    "apply_force, teleport, switch_scene, set_material, set_visibility, toggle_particles, set_text, start_scene.",
    "Prefer short readable rules that can be translated by a backend compiler.",
    `World name: ${input.worldName || "Untitled world"}`,
    `World goal: ${input.worldAbout || "No goal provided"}`,
    `User objective: ${input.objective || "Create basic interactive world logic"}`,
    input.sceneSummary ? `Scene summary: ${input.sceneSummary}` : "",
    "",
    "Return only the DSL script.",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractTextFromResponse(payload = {}) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAiResponses(options = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey(options.apiKey)}`,
    },
    body: JSON.stringify({
      model: String(options.model ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
      input: options.prompt,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, payload.error?.message || "AI provider request failed");
  }
  const text = extractTextFromResponse(payload);
  if (!text) {
    throw new HttpError(502, "AI provider returned no text");
  }
  return {
    provider: "openai",
    model: String(options.model ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    text,
  };
}

export async function generatePrivateWorldAiArtifact(options = {}) {
  const provider = String(options.provider ?? "openai").trim().toLowerCase();
  if (provider !== "openai") {
    throw new HttpError(400, `Unsupported AI provider: ${provider}`);
  }
  const artifactType = String(options.artifactType ?? "").trim().toLowerCase();
  const prompt =
    artifactType === "screen_html"
      ? buildScreenHtmlPrompt(options)
      : artifactType === "world_script"
        ? buildScriptPrompt(options)
        : null;
  if (!prompt) {
    throw new HttpError(400, "Unsupported AI artifact type");
  }
  return await callOpenAiResponses({
    apiKey: options.apiKey,
    model: options.model,
    prompt,
  });
}
