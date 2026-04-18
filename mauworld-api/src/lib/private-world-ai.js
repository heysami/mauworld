import { HttpError } from "./http.js";

const DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_MESHY_MODEL = "meshy-4";
const MAX_PROMPT_TEXT = 2400;

function requireApiKey(value, label = "AI provider") {
  const apiKey = String(value ?? "").trim();
  if (!apiKey) {
    throw new HttpError(400, `Missing ${label} API key`);
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
      text: clipPromptText(entry?.text ?? "", MAX_PROMPT_TEXT),
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

function normalizeArtifactType(value) {
  const artifactType = String(value ?? "").trim().toLowerCase();
  if (artifactType === "texture_asset") {
    return "texture";
  }
  if (artifactType === "model_asset") {
    return "3d_model";
  }
  return artifactType;
}

function buildSharedContext(input = {}) {
  const lines = [
    `World name: ${input.worldName || "Untitled world"}`,
    `World goal: ${input.worldAbout || "No goal provided"}`,
    input.targetLabel ? `Target: ${input.targetLabel}` : "",
    input.viewportSummary ? `Viewport hint: ${input.viewportSummary}` : "",
    input.sceneSummary ? `Scene summary: ${clipPromptText(input.sceneSummary, 1200)}` : "",
    input.currentArtifact ? `Current artifact: ${clipPromptText(input.currentArtifact, 1800)}` : "",
    input.entityContext ? `Selected entity context: ${clipPromptText(input.entityContext, 1200)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function buildBrainstormPrompt(input = {}) {
  const artifactType = normalizeArtifactType(input.artifactType);
  const transcript = buildMessageTranscript(input.messages);
  const introByType = {
    screen_html: "You are helping a Mauworld builder brainstorm a world screen before any final HTML is generated.",
    world_script: "You are helping a Mauworld builder brainstorm scene logic before any final DSL script is generated.",
    texture: "You are helping a Mauworld builder brainstorm a reusable texture asset before any final generation request is sent.",
    "3d_model": "You are helping a Mauworld builder brainstorm a reusable 3D model asset before any final generation request is sent.",
  };
  const holdBackByType = {
    screen_html: "Do not write the final HTML yet.",
    world_script: "Do not write the final DSL script yet.",
    texture: "Do not write the final provider prompt or JSON spec yet.",
    "3d_model": "Do not write the final provider prompt or JSON spec yet.",
  };
  if (!introByType[artifactType]) {
    throw new HttpError(400, "Unsupported AI artifact type");
  }
  return [
    introByType[artifactType],
    holdBackByType[artifactType],
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

function buildAssetSpecPrompt(input = {}) {
  const artifactType = normalizeArtifactType(input.artifactType);
  const transcript = buildMessageTranscript(input.messages);
  const assetLabel = artifactType === "texture" ? "texture asset" : "3D model asset";
  const providerLabel = artifactType === "texture" ? "image texture" : "3d model";
  return [
    `You are preparing a validated JSON generation spec for a Mauworld ${assetLabel}.`,
    "Think through the builder's brainstorm thread and the selected world context before writing the JSON.",
    `The JSON must be tailored for a downstream ${providerLabel} generation provider.`,
    "Return valid JSON only with no markdown fences.",
    "Required top-level keys:",
    'name, intended_use, style_material_cues, scale_hints, world_context_summary, provider_prompt.',
    "provider_prompt must be an object with these keys:",
    'prompt, negative_prompt, camera_or_surface_focus, output_notes.',
    artifactType === "3d_model"
      ? "Also include bounds_hint as an object with x, y, z numbers describing approximate model size in local runtime units."
      : "For textures, focus on a clean tileable or surface-friendly base color texture prompt unless the context clearly needs a decal-like texture.",
    "Keep every string concise and implementation-ready.",
    buildSharedContext(input),
    input.objective ? `Builder objective: ${clipPromptText(input.objective, 1600)}` : "",
    transcript ? `Brainstorm thread:\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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

function parseJsonFromText(input = "") {
  const source = String(input ?? "").trim();
  if (!source) {
    throw new HttpError(502, "AI provider returned no structured spec");
  }
  const candidates = [
    source,
    source.replace(/^```json\s*|\s*```$/gi, "").trim(),
  ];
  const objectStart = source.indexOf("{");
  const objectEnd = source.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(source.slice(objectStart, objectEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // try next candidate
    }
  }
  throw new HttpError(502, "AI provider returned invalid JSON");
}

function normalizeBoundsHint(input = {}) {
  return {
    x: Math.max(0.1, Number(input?.x) || 1),
    y: Math.max(0.1, Number(input?.y) || 1),
    z: Math.max(0.1, Number(input?.z) || 1),
  };
}

function validateAssetSpec(rawSpec = {}, artifactType) {
  const prompt = typeof rawSpec.provider_prompt === "object" && rawSpec.provider_prompt
    ? rawSpec.provider_prompt
    : {};
  const spec = {
    name: String(rawSpec.name ?? `${artifactType === "texture" ? "Texture" : "Model"} Asset`).trim().slice(0, 120)
      || `${artifactType === "texture" ? "Texture" : "Model"} Asset`,
    intended_use: String(rawSpec.intended_use ?? rawSpec.intendedUse ?? "").trim(),
    style_material_cues: String(rawSpec.style_material_cues ?? rawSpec.styleMaterialCues ?? "").trim(),
    scale_hints: String(rawSpec.scale_hints ?? rawSpec.scaleHints ?? "").trim(),
    world_context_summary: String(rawSpec.world_context_summary ?? rawSpec.worldContextSummary ?? "").trim(),
    provider_prompt: {
      prompt: String(prompt.prompt ?? "").trim(),
      negative_prompt: String(prompt.negative_prompt ?? prompt.negativePrompt ?? "").trim(),
      camera_or_surface_focus: String(prompt.camera_or_surface_focus ?? prompt.cameraOrSurfaceFocus ?? "").trim(),
      output_notes: String(prompt.output_notes ?? prompt.outputNotes ?? "").trim(),
    },
  };
  if (!spec.intended_use || !spec.style_material_cues || !spec.scale_hints || !spec.world_context_summary || !spec.provider_prompt.prompt) {
    throw new HttpError(502, "AI provider returned an incomplete structured spec");
  }
  if (artifactType === "3d_model") {
    spec.bounds_hint = normalizeBoundsHint(rawSpec.bounds_hint ?? rawSpec.boundsHint ?? {});
  }
  return spec;
}

async function callOpenAiResponses(options = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey(options.apiKey, "text reasoning")}`,
    },
    body: JSON.stringify({
      model: String(options.model ?? DEFAULT_OPENAI_TEXT_MODEL).trim() || DEFAULT_OPENAI_TEXT_MODEL,
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
    model: String(options.model ?? DEFAULT_OPENAI_TEXT_MODEL).trim() || DEFAULT_OPENAI_TEXT_MODEL,
    text,
    raw: payload,
  };
}

async function fetchBinaryFromUrl(url, headers = {}) {
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new HttpError(502, `Could not fetch generated asset file: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function callOpenAiImageGeneration(options = {}) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey(options.apiKey, "image texture")}`,
    },
    body: JSON.stringify({
      model: String(options.model ?? DEFAULT_OPENAI_IMAGE_MODEL).trim() || DEFAULT_OPENAI_IMAGE_MODEL,
      prompt: options.prompt,
      size: String(options.size ?? "1024x1024"),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, payload.error?.message || "Image provider request failed");
  }
  const data = Array.isArray(payload.data) ? payload.data[0] : null;
  if (!data) {
    throw new HttpError(502, "Image provider returned no image");
  }
  if (typeof data.b64_json === "string" && data.b64_json.trim()) {
    return {
      provider: "openai",
      model: String(options.model ?? DEFAULT_OPENAI_IMAGE_MODEL).trim() || DEFAULT_OPENAI_IMAGE_MODEL,
      files: [{
        role: "base_color",
        filename: "base-color.png",
        content_type: "image/png",
        buffer: Buffer.from(data.b64_json, "base64"),
      }],
      raw: payload,
    };
  }
  if (typeof data.url === "string" && data.url.trim()) {
    const fetched = await fetchBinaryFromUrl(data.url);
    return {
      provider: "openai",
      model: String(options.model ?? DEFAULT_OPENAI_IMAGE_MODEL).trim() || DEFAULT_OPENAI_IMAGE_MODEL,
      files: [{
        role: "base_color",
        filename: "base-color.png",
        content_type: fetched.contentType,
        buffer: fetched.buffer,
      }],
      raw: payload,
    };
  }
  throw new HttpError(502, "Image provider returned no usable image payload");
}

async function callMeshyApi(path, { apiKey, method = "GET", body = null } = {}) {
  const response = await fetch(`https://api.meshy.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireApiKey(apiKey, "3D model")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, payload.message || payload.error?.message || "3D model provider request failed");
  }
  return payload;
}

function meshyTaskIdFromPayload(payload = {}) {
  return String(payload.result?.id ?? payload.id ?? payload.task_id ?? payload.taskId ?? "").trim() || null;
}

function meshyStatusFromPayload(payload = {}) {
  return String(payload.result?.status ?? payload.status ?? "").trim().toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFirstDefined(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function collectMeshyFileUrls(payload = {}) {
  const result = payload.result ?? payload;
  const textureUrls = result.texture_urls ?? result.textures ?? result.pbr_maps ?? {};
  return {
    model_glb: readFirstDefined(
      result.model_urls?.glb,
      result.models?.glb,
      result.outputs?.glb,
      result.glb_url,
      payload.model_urls?.glb,
    ),
    thumbnail: readFirstDefined(
      result.thumbnail_url,
      result.preview_url,
      result.outputs?.thumbnail,
      payload.thumbnail_url,
    ),
    base_color: readFirstDefined(
      textureUrls.base_color,
      textureUrls.basecolor,
      textureUrls.albedo,
    ),
    normal: readFirstDefined(
      textureUrls.normal,
      textureUrls.normal_map,
    ),
    roughness: readFirstDefined(
      textureUrls.roughness,
      textureUrls.roughness_map,
    ),
    metallic: readFirstDefined(
      textureUrls.metallic,
      textureUrls.metallic_map,
      textureUrls.metalness,
    ),
    ambient_occlusion: readFirstDefined(
      textureUrls.ambient_occlusion,
      textureUrls.ao,
    ),
    emissive: readFirstDefined(
      textureUrls.emissive,
      textureUrls.emission,
    ),
  };
}

function inferMeshyBounds(payload = {}) {
  const result = payload.result ?? payload;
  const bbox = result.bounding_box ?? result.bounds ?? result.model_bounds ?? result.model_size ?? {};
  return normalizeBoundsHint({
    x: bbox.x ?? bbox.width ?? bbox.size_x,
    y: bbox.y ?? bbox.height ?? bbox.size_y,
    z: bbox.z ?? bbox.depth ?? bbox.size_z,
  });
}

async function callMeshyTextTo3d(options = {}) {
  const created = await callMeshyApi("/openapi/v2/text-to-3d", {
    apiKey: options.apiKey,
    method: "POST",
    body: {
      mode: "preview",
      prompt: options.prompt,
      negative_prompt: options.negativePrompt || undefined,
      art_style: "realistic",
      should_texture: true,
      should_remesh: true,
      enable_pbr: true,
      topology: "triangle",
      target_formats: ["glb"],
      ai_model: String(options.model ?? DEFAULT_MESHY_MODEL).trim() || DEFAULT_MESHY_MODEL,
    },
  });
  const taskId = meshyTaskIdFromPayload(created);
  if (!taskId) {
    throw new HttpError(502, "3D model provider returned no task id");
  }

  const timeoutMs = Math.max(60_000, Number(options.timeoutMs) || 270_000);
  const pollIntervalMs = Math.max(2_000, Number(options.pollIntervalMs) || 5_000);
  const startedAt = Date.now();
  let latest = created;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await callMeshyApi(`/openapi/v2/text-to-3d/${taskId}`, {
      apiKey: options.apiKey,
    });
    const status = meshyStatusFromPayload(latest);
    if (status === "SUCCEEDED" || status === "SUCCESS" || status === "COMPLETED") {
      break;
    }
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
      throw new HttpError(502, latest.result?.message || latest.message || "3D model provider failed");
    }
    await sleep(pollIntervalMs);
  }

  const urls = collectMeshyFileUrls(latest);
  if (!urls.model_glb) {
    throw new HttpError(502, "3D model provider returned no GLB output");
  }

  const files = [];
  for (const [role, url] of Object.entries(urls)) {
    if (!url) {
      continue;
    }
    const fetched = await fetchBinaryFromUrl(url);
    const extension = role === "model_glb" ? "glb" : fetched.contentType.includes("png") ? "png" : "bin";
    files.push({
      role,
      filename: `${role}.${extension}`,
      content_type: fetched.contentType,
      buffer: fetched.buffer,
    });
  }

  return {
    provider: "meshy",
    model: String(options.model ?? DEFAULT_MESHY_MODEL).trim() || DEFAULT_MESHY_MODEL,
    files,
    bounds: inferMeshyBounds(latest),
    raw: latest,
  };
}

const TEXT_PROVIDER_REGISTRY = {
  openai: {
    name: "openai",
    async generate(options = {}) {
      return await callOpenAiResponses(options);
    },
  },
};

const IMAGE_PROVIDER_REGISTRY = {
  openai: {
    name: "openai",
    async generate(options = {}) {
      return await callOpenAiImageGeneration(options);
    },
  },
};

const MODEL_PROVIDER_REGISTRY = {
  meshy: {
    name: "meshy",
    async generate(options = {}) {
      return await callMeshyTextTo3d(options);
    },
  },
  tripo: {
    name: "tripo",
    async generate() {
      throw new HttpError(501, "Tripo support is not wired yet");
    },
  },
};

function resolveProviderAdapter(registry, value, label) {
  const provider = String(value ?? "").trim().toLowerCase();
  const resolvedProvider = provider || Object.keys(registry)[0];
  const adapter = registry[resolvedProvider] ?? null;
  if (!adapter) {
    throw new HttpError(400, `Unsupported ${label} provider: ${resolvedProvider}`);
  }
  return adapter;
}

async function generateStructuredAssetSpec(options = {}) {
  const artifactType = normalizeArtifactType(options.artifactType);
  if (artifactType !== "texture" && artifactType !== "3d_model") {
    throw new HttpError(400, "Unsupported asset spec type");
  }
  const providerAdapter = resolveProviderAdapter(TEXT_PROVIDER_REGISTRY, options.reasoningProvider ?? options.provider, "text reasoning");
  const generated = await providerAdapter.generate({
    apiKey: options.reasoningApiKey ?? options.apiKey,
    model: options.reasoningModel ?? options.model,
    prompt: buildAssetSpecPrompt({
      ...options,
      artifactType,
    }),
  });
  return {
    provider: generated.provider,
    model: generated.model,
    spec: validateAssetSpec(parseJsonFromText(generated.text), artifactType),
    rawText: generated.text,
  };
}

export async function brainstormPrivateWorldAiArtifact(options = {}) {
  const providerAdapter = resolveProviderAdapter(TEXT_PROVIDER_REGISTRY, options.provider, "text reasoning");
  const artifactType = normalizeArtifactType(options.artifactType);
  if (!["screen_html", "world_script", "texture", "3d_model"].includes(artifactType)) {
    throw new HttpError(400, "Unsupported AI artifact type");
  }
  return await providerAdapter.generate({
    apiKey: options.apiKey,
    model: options.model,
    prompt: buildBrainstormPrompt({
      ...options,
      artifactType,
    }),
  });
}

export async function generatePrivateWorldAiArtifact(options = {}) {
  const providerAdapter = resolveProviderAdapter(TEXT_PROVIDER_REGISTRY, options.provider, "text reasoning");
  const artifactType = normalizeArtifactType(options.artifactType);
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

export async function generatePrivateWorldTextureAsset(options = {}) {
  const specResult = await generateStructuredAssetSpec({
    ...options,
    artifactType: "texture",
  });
  const imageProvider = resolveProviderAdapter(
    IMAGE_PROVIDER_REGISTRY,
    options.imageProvider ?? options.provider,
    "image texture",
  );
  const providerPrompt = [
    specResult.spec.provider_prompt.prompt,
    `Intended use: ${specResult.spec.intended_use}`,
    `Style and material cues: ${specResult.spec.style_material_cues}`,
    `Scale hints: ${specResult.spec.scale_hints}`,
    `World context: ${specResult.spec.world_context_summary}`,
    specResult.spec.provider_prompt.camera_or_surface_focus
      ? `Surface focus: ${specResult.spec.provider_prompt.camera_or_surface_focus}`
      : "",
    specResult.spec.provider_prompt.output_notes
      ? `Output notes: ${specResult.spec.provider_prompt.output_notes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const generated = await imageProvider.generate({
    apiKey: options.imageApiKey,
    model: options.imageModel,
    prompt: providerPrompt,
  });
  return {
    assetType: "texture",
    name: specResult.spec.name,
    intended_use: specResult.spec.intended_use,
    world_context_summary: specResult.spec.world_context_summary,
    reasoning_provider: specResult.provider,
    reasoning_model: specResult.model,
    provider: generated.provider,
    provider_model: generated.model,
    spec: specResult.spec,
    context: {
      target_label: options.targetLabel ?? null,
      world_name: options.worldName ?? null,
      world_about: options.worldAbout ?? null,
      scene_summary: options.sceneSummary ?? null,
    },
    provider_metadata: generated.raw,
    bounds: { x: 1, y: 1, z: 1 },
    files: generated.files,
  };
}

export async function generatePrivateWorldModelAsset(options = {}) {
  const specResult = await generateStructuredAssetSpec({
    ...options,
    artifactType: "3d_model",
  });
  const modelProvider = resolveProviderAdapter(
    MODEL_PROVIDER_REGISTRY,
    options.modelProvider ?? options.provider,
    "3D model",
  );
  const providerPrompt = [
    specResult.spec.provider_prompt.prompt,
    `Intended use: ${specResult.spec.intended_use}`,
    `Style and material cues: ${specResult.spec.style_material_cues}`,
    `Scale hints: ${specResult.spec.scale_hints}`,
    `World context: ${specResult.spec.world_context_summary}`,
    specResult.spec.provider_prompt.camera_or_surface_focus
      ? `Camera and silhouette focus: ${specResult.spec.provider_prompt.camera_or_surface_focus}`
      : "",
    specResult.spec.provider_prompt.output_notes
      ? `Output notes: ${specResult.spec.provider_prompt.output_notes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const generated = await modelProvider.generate({
    apiKey: options.modelApiKey,
    model: options.modelModel,
    prompt: providerPrompt,
    negativePrompt: specResult.spec.provider_prompt.negative_prompt,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  return {
    assetType: "model",
    name: specResult.spec.name,
    intended_use: specResult.spec.intended_use,
    world_context_summary: specResult.spec.world_context_summary,
    reasoning_provider: specResult.provider,
    reasoning_model: specResult.model,
    provider: generated.provider,
    provider_model: generated.model,
    spec: specResult.spec,
    context: {
      target_label: options.targetLabel ?? null,
      world_name: options.worldName ?? null,
      world_about: options.worldAbout ?? null,
      scene_summary: options.sceneSummary ?? null,
    },
    provider_metadata: generated.raw,
    bounds: generated.bounds ?? specResult.spec.bounds_hint ?? { x: 1, y: 1, z: 1 },
    files: generated.files,
  };
}
