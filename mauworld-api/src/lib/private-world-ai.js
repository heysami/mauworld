import { HttpError } from "./http.js";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

function requireApiKey(value) {
  const apiKey = String(value ?? "").trim();
  if (!apiKey) {
    throw new HttpError(400, "Missing AI provider API key");
  }
  return apiKey;
}

function clipPromptText(value, maxLength = 1600) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function normalizeAiMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((entry) => ({
      role: String(entry?.role ?? "user").trim().toLowerCase() === "assistant" ? "assistant" : "user",
      text: clipPromptText(entry?.text ?? "", 2400),
    }))
    .filter((entry) => entry.text);
}

function buildMessageTranscript(messages = []) {
  const normalized = normalizeAiMessages(messages);
  if (!normalized.length) {
    return "";
  }
  return normalized
    .map((entry, index) => `${entry.role === "assistant" ? "Assistant" : "Builder"} ${index + 1}:\n${entry.text}`)
    .join("\n\n");
}

function buildSharedContext(input = {}) {
  const lines = [
    `World name: ${input.worldName || "Untitled world"}`,
    `World goal: ${input.worldAbout || "No goal provided"}`,
    input.targetLabel ? `Target: ${input.targetLabel}` : "",
    input.viewportSummary ? `Viewport hint: ${input.viewportSummary}` : "",
    input.sceneSummary ? `Scene summary: ${clipPromptText(input.sceneSummary, 1200)}` : "",
    input.currentArtifact ? `Current artifact: ${clipPromptText(input.currentArtifact, 1800)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function buildBrainstormPrompt(input = {}) {
  const artifactType = String(input.artifactType ?? "").trim().toLowerCase();
  const isScreen = artifactType === "screen_html";
  const transcript = buildMessageTranscript(input.messages);
  return [
    isScreen
      ? "You are helping a Mauworld builder brainstorm a world screen before any final HTML is generated."
      : "You are helping a Mauworld builder brainstorm scene logic before any final DSL script is generated.",
    isScreen
      ? "Do not write the final HTML yet."
      : "Do not write the final DSL script yet.",
    "Reply like a practical collaborator.",
    "Always respond with exactly these sections in order:",
    "Assumptions",
    "Questions",
    "Next direction",
    "Keep it concise. Ask only the highest-value questions. If nothing is missing, say so.",
    buildSharedContext(input),
    input.objective ? `Builder goal:\n${clipPromptText(input.objective, 1600)}` : "",
    transcript ? `Thread so far:\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildScreenHtmlPrompt(input = {}) {
  const transcript = buildMessageTranscript(input.messages);
  return [
    "Generate a single static HTML page for a 3D world screen.",
    "Use the brainstorm thread and context below as the source of truth.",
    "Use HTML and CSS only. Do not use JavaScript.",
    "Keep the layout self-contained and readable on a billboard-like screen.",
    "Avoid external dependencies, images, scripts, iframes, and remote fonts.",
    buildSharedContext(input),
    `User objective: ${input.objective || "Create a useful visual screen"}`,
    transcript ? `Brainstorm thread:\n${transcript}` : "",
    "",
    "Return only raw HTML.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildScriptPrompt(input = {}) {
  const transcript = buildMessageTranscript(input.messages);
  return [
    "Generate a concise Mauworld private-world rule script.",
    "Use the brainstorm thread and context below as the source of truth.",
    "Target a structured trigger/action DSL using the available triggers:",
    "zone_enter, zone_exit, key_press, timer, scene_start, all_players_ready.",
    "Target the available actions:",
    "apply_force, teleport, switch_scene, set_material, set_visibility, toggle_particles, set_text, start_scene.",
    "Prefer short readable rules that can be translated by a backend compiler.",
    buildSharedContext(input),
    `User objective: ${input.objective || "Create basic interactive world logic"}`,
    transcript ? `Brainstorm thread:\n${transcript}` : "",
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

const AI_PROVIDER_REGISTRY = {
  openai: {
    name: "openai",
    async generate(options = {}) {
      return await callOpenAiResponses(options);
    },
  },
};

function resolveProviderAdapter(options = {}) {
  const provider = String(options.provider ?? "openai").trim().toLowerCase();
  const providerAdapter = AI_PROVIDER_REGISTRY[provider] ?? null;
  if (!providerAdapter) {
    throw new HttpError(400, `Unsupported AI provider: ${provider}`);
  }
  return providerAdapter;
}

export async function brainstormPrivateWorldAiArtifact(options = {}) {
  const providerAdapter = resolveProviderAdapter(options);
  const artifactType = String(options.artifactType ?? "").trim().toLowerCase();
  if (artifactType !== "screen_html" && artifactType !== "world_script") {
    throw new HttpError(400, "Unsupported AI artifact type");
  }
  return await providerAdapter.generate({
    apiKey: options.apiKey,
    model: options.model,
    prompt: buildBrainstormPrompt(options),
  });
}

export async function generatePrivateWorldAiArtifact(options = {}) {
  const providerAdapter = resolveProviderAdapter(options);
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
  return await providerAdapter.generate({
    apiKey: options.apiKey,
    model: options.model,
    prompt,
  });
}
