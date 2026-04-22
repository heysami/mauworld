import { HttpError } from "./http.js";
import { assertSafePublicText, stripMarkdown } from "./text.js";
import {
  generateTextReasoning,
} from "./text-reasoning-providers.js";
const DEFAULT_GAME_ASPECT_RATIO = 16 / 9;
const MAX_GAME_PROMPT_CHARS = 4000;
const MAX_SOURCE_HTML_CHARS = 200_000;
const MAX_GAME_DISCUSSION_MESSAGES = 24;
const MAX_GAME_DISCUSSION_CHARS = 4000;
const MAX_GAME_ASSET_COUNT = 48;
const MAX_GAME_ASSET_ID_CHARS = 64;
const MAX_GAME_ASSET_FILE_NAME_CHARS = 120;
const MAX_GAME_ASSET_DATA_URL_CHARS = 2_500_000;
const MAX_GAME_PACKAGE_BYTES = 7_500_000;
const WORLD_GAME_EXPORT_FORMAT = "mauworld.world-game.v1";
const WORLD_GAME_PACKAGE_FORMAT = "mauworld.world-game.package.v1";
const ALLOWED_MULTIPLAYER_MODES = new Set(["single", "turn-based", "realtime"]);
const BLOCKED_HTML_PATTERNS = [
  { pattern: /<script[^>]+\bsrc\s*=/i, reason: "External scripts are not allowed." },
  { pattern: /<(iframe|frame|object|embed|portal)\b/i, reason: "Nested embedded content is not allowed." },
  { pattern: /<link\b[^>]*\bhref\s*=/i, reason: "External stylesheets are not allowed." },
  { pattern: /<base\b/i, reason: "Base tags are not allowed." },
  { pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|importScripts)\b/i, reason: "Direct network APIs are not allowed." },
  { pattern: /\bwindow\.open\s*\(/i, reason: "Popups are not allowed." },
  { pattern: /\b(?:document|window|location)\.location\s*=/i, reason: "Direct navigation is not allowed." },
  { pattern: /\bparent\.postMessage\s*\(/i, reason: "Use the Mauworld SDK instead of direct postMessage calls." },
];

function nowIso() {
  return new Date().toISOString();
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function clipText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function slugToken(value, fallback = "asset", maxLength = MAX_GAME_ASSET_ID_CHARS) {
  const normalized = clipText(value, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function inferAssetMimeType(fileName = "", fallback = "application/octet-stream") {
  const normalized = String(fileName ?? "").trim().toLowerCase();
  if (normalized.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalized.endsWith(".glb")) {
    return "model/gltf-binary";
  }
  if (normalized.endsWith(".gltf")) {
    return "model/gltf+json";
  }
  if (normalized.endsWith(".obj")) {
    return "model/obj";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  if (normalized.endsWith(".txt")) {
    return "text/plain;charset=utf-8";
  }
  return fallback;
}

function inferAssetKind(mimeType = "", fileName = "") {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  const normalizedFileName = String(fileName ?? "").trim().toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("model/") || /\.(?:glb|gltf|obj)$/i.test(normalizedFileName)) {
    return "model";
  }
  return "data";
}

function buildTextAssetDataUrl(text = "", mimeType = "text/plain;charset=utf-8") {
  return `data:${mimeType};base64,${Buffer.from(String(text ?? ""), "utf8").toString("base64")}`;
}

function estimateDataUrlBytes(dataUrl = "") {
  const normalized = String(dataUrl ?? "").trim();
  if (!normalized.startsWith("data:")) {
    return Buffer.byteLength(normalized, "utf8");
  }
  const commaIndex = normalized.indexOf(",");
  if (commaIndex < 0) {
    return Buffer.byteLength(normalized, "utf8");
  }
  const meta = normalized.slice(0, commaIndex);
  const payload = normalized.slice(commaIndex + 1);
  if (/;base64/i.test(meta)) {
    return Math.max(0, Math.round((payload.length * 3) / 4));
  }
  try {
    return Buffer.byteLength(decodeURIComponent(payload), "utf8");
  } catch (_error) {
    return Buffer.byteLength(payload, "utf8");
  }
}

function buildEmptyWorldGamePackage() {
  return {
    format: WORLD_GAME_PACKAGE_FORMAT,
    version: 1,
    assets: {},
  };
}

function sanitizeWorldGameAssetEntry(input = {}, assetKey = "", index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const id = slugToken(input.id ?? assetKey ?? `asset-${index + 1}`, `asset-${index + 1}`);
  const fileName = clipText(
    input.file_name ?? input.fileName ?? input.filename ?? `${id}`,
    MAX_GAME_ASSET_FILE_NAME_CHARS,
  ) || id;
  const mimeType = clipText(
    input.mime_type ?? input.mimeType ?? inferAssetMimeType(fileName),
    160,
  ) || inferAssetMimeType(fileName);
  let dataUrl = clipText(
    input.data_url ?? input.dataUrl ?? input.source ?? input.url ?? "",
    MAX_GAME_ASSET_DATA_URL_CHARS,
  );
  const rawText = String(input.text ?? input.svg ?? "").trim();
  const rawBase64 = String(input.base64 ?? "").trim();
  if (!dataUrl && rawText) {
    dataUrl = buildTextAssetDataUrl(rawText, mimeType || inferAssetMimeType(fileName, "text/plain;charset=utf-8"));
  } else if (!dataUrl && rawBase64) {
    dataUrl = `data:${mimeType || inferAssetMimeType(fileName)};base64,${rawBase64}`;
  }
  if (!dataUrl) {
    throw new HttpError(400, `Game asset "${id}" is missing data.`);
  }
  if (/^(?:https?:)?\/\//i.test(dataUrl)) {
    throw new HttpError(400, `Game asset "${id}" cannot use a remote URL.`);
  }
  if (!/^data:/i.test(dataUrl)) {
    throw new HttpError(400, `Game asset "${id}" must be provided as a data URL.`);
  }
  if (dataUrl.length > MAX_GAME_ASSET_DATA_URL_CHARS) {
    throw new HttpError(400, `Game asset "${id}" is too large.`);
  }
  return {
    id,
    kind: clipText(input.kind ?? inferAssetKind(mimeType, fileName), 40) || inferAssetKind(mimeType, fileName),
    mime_type: mimeType,
    file_name: fileName,
    data_url: dataUrl,
    size_bytes: estimateDataUrlBytes(dataUrl),
  };
}

export function normalizeWorldGamePackage(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const assetsInput = source.assets && typeof source.assets === "object" && !Array.isArray(source.assets)
    ? source.assets
    : {};
  const assets = {};
  let totalBytes = 0;
  let index = 0;
  for (const [assetKey, assetValue] of Object.entries(assetsInput).slice(0, MAX_GAME_ASSET_COUNT)) {
    const normalizedAsset = sanitizeWorldGameAssetEntry(assetValue, assetKey, index);
    if (!normalizedAsset) {
      continue;
    }
    totalBytes += Math.max(0, Number(normalizedAsset.size_bytes ?? 0) || 0);
    if (totalBytes > MAX_GAME_PACKAGE_BYTES) {
      throw new HttpError(400, "Game package assets are too large.");
    }
    assets[normalizedAsset.id] = normalizedAsset;
    index += 1;
  }
  return {
    format: WORLD_GAME_PACKAGE_FORMAT,
    version: 1,
    assets,
  };
}

function safeNormalizeWorldGamePackage(input = {}) {
  try {
    return normalizeWorldGamePackage(input);
  } catch (_error) {
    return buildEmptyWorldGamePackage();
  }
}

function extractWorldGamePackageInput(input = {}) {
  if (input?.package && typeof input.package === "object" && !Array.isArray(input.package)) {
    return input.package;
  }
  if (input?.assets && typeof input.assets === "object" && !Array.isArray(input.assets)) {
    return { assets: input.assets };
  }
  if (input?.manifest?.package && typeof input.manifest.package === "object" && !Array.isArray(input.manifest.package)) {
    return input.manifest.package;
  }
  return {};
}

function sanitizeWorldGameDiscussionMessages(input = []) {
  return (Array.isArray(input) ? input : [])
    .slice(0, MAX_GAME_DISCUSSION_MESSAGES)
    .map((entry) => {
      const role = String(entry?.role ?? "").trim().toLowerCase();
      const text = clipText(entry?.text ?? entry?.content ?? "", MAX_GAME_DISCUSSION_CHARS);
      if (!text || (role !== "user" && role !== "assistant")) {
        return null;
      }
      assertSafePublicText(text, `${role} message`);
      return { role, text };
    })
    .filter(Boolean);
}

function buildWorldGameMessageTranscript(messages = []) {
  return sanitizeWorldGameDiscussionMessages(messages)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.text}`)
    .join("\n\n");
}

function deriveWorldGamePrompt(input = {}, fieldName = "prompt") {
  const direct = clipText(input.prompt ?? input.objective ?? "", MAX_GAME_PROMPT_CHARS);
  if (direct) {
    assertSafePublicText(direct, fieldName);
    return direct;
  }
  const fromMessages = clipText(
    sanitizeWorldGameDiscussionMessages(input.messages)
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.text)
      .join("\n\n"),
    MAX_GAME_PROMPT_CHARS,
  );
  if (!fromMessages) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  assertSafePublicText(fromMessages, fieldName);
  return fromMessages;
}

function parseJsonCandidate(source = "") {
  const trimmed = String(source ?? "").trim();
  if (!trimmed) {
    throw new HttpError(502, "AI provider returned no game package");
  }
  const candidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim(),
  ];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // try next candidate
    }
  }
  throw new HttpError(502, "AI provider returned invalid JSON for the game package");
}

function normalizeMultiplayerMode(value, fallback = "turn-based") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ALLOWED_MULTIPLAYER_MODES.has(normalized) ? normalized : fallback;
}

function buildSeatLabels(input = [], maxPlayers = 2) {
  const labels = Array.isArray(input)
    ? input
      .map((value) => clipText(value, 40))
      .filter(Boolean)
    : [];
  const targetCount = Math.max(1, maxPlayers);
  while (labels.length < targetCount) {
    labels.push(`Player ${labels.length + 1}`);
  }
  return labels.slice(0, targetCount);
}

export function sanitizeWorldGamePrompt(value, fieldName = "prompt") {
  const text = clipText(value, MAX_GAME_PROMPT_CHARS);
  if (!text) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  assertSafePublicText(text, fieldName);
  return text;
}

export function normalizeWorldGameManifest(input = {}) {
  const rawTitle = clipText(input.title ?? input.name ?? "Untitled Game", 96) || "Untitled Game";
  const description = clipText(input.description ?? input.summary ?? "", 280);
  const multiplayerMode = normalizeMultiplayerMode(
    input.multiplayer_mode ?? input.multiplayerMode ?? input.mode,
    "turn-based",
  );
  const minPlayers = clampInteger(input.min_players ?? input.minPlayers, multiplayerMode === "single" ? 1 : 2, 1, 12);
  const maxPlayers = clampInteger(input.max_players ?? input.maxPlayers, Math.max(minPlayers, multiplayerMode === "single" ? 1 : 2), minPlayers, 12);
  const allowViewers = input.allow_viewers == null ? true : input.allow_viewers === true || input.allowViewers === true;
  const aspectRatio = Number(
    clampNumber(input.aspect_ratio ?? input.aspectRatio, DEFAULT_GAME_ASPECT_RATIO, 0.5, 3).toFixed(4),
  );
  const preview = {
    mode: "sdk",
    fps: clampInteger(input.preview?.fps, 4, 1, 12),
    width: clampInteger(input.preview?.width, 480, 160, 1280),
    height: clampInteger(input.preview?.height, 270, 90, 720),
  };
  const seatLabels = input.seats
    ?? input.seat_labels
    ?? input.seatLabels
    ?? input.player_roles
    ?? input.playerRoles
    ?? input.roles;
  return {
    title: rawTitle,
    description,
    multiplayer_mode: multiplayerMode,
    min_players: minPlayers,
    max_players: maxPlayers,
    allow_viewers: allowViewers,
    aspect_ratio: aspectRatio,
    preview,
    seats: buildSeatLabels(seatLabels, maxPlayers),
  };
}

function wrapHtmlDocument(source = "") {
  const html = String(source ?? "").trim();
  if (!html) {
    return "";
  }
  if (/<html[\s>]/i.test(html)) {
    return html;
  }
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "</head>",
    `<body>${html}</body>`,
    "</html>",
  ].join("");
}

export function sanitizeWorldGameHtml(value) {
  const source = String(value ?? "").trim();
  if (!source) {
    throw new HttpError(400, "Game HTML is required");
  }
  if (source.length > MAX_SOURCE_HTML_CHARS) {
    throw new HttpError(400, "Game HTML is too large");
  }
  const wrapped = wrapHtmlDocument(source);
  const lowered = wrapped.toLowerCase();
  for (const entry of BLOCKED_HTML_PATTERNS) {
    if (entry.pattern.test(wrapped)) {
      throw new HttpError(400, entry.reason);
    }
  }
  if (/<(?:img|audio|video|source|track)\b[^>]+\bsrc\s*=\s*['"]?\s*(?:https?:)?\/\//i.test(wrapped)) {
    throw new HttpError(400, "Remote media assets are not allowed.");
  }
  if (!/mauworldgame\s*\.\s*register\s*\(/i.test(lowered)) {
    throw new HttpError(400, "Generated games must register through window.MauworldGame.register(...).");
  }
  assertSafePublicText(stripMarkdown(wrapped).slice(0, 4000) || "game", "game html");
  return wrapped;
}

export function buildWorldGameSearchText(values = []) {
  return values
    .map((value) => clipText(stripMarkdown(value), 280).toLowerCase())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateWorldGameRecord(input = {}, options = {}) {
  const manifest = normalizeWorldGameManifest(input.manifest ?? {});
  const title = clipText(input.title ?? manifest.title, 96) || manifest.title;
  const prompt = options.promptRequired === false && !String(input.prompt ?? "").trim()
    ? ""
    : sanitizeWorldGamePrompt(input.prompt ?? deriveWorldGamePrompt(input) ?? "Generated Mauworld game");
  const sourceHtml = sanitizeWorldGameHtml(input.source_html ?? input.sourceHtml ?? input.html ?? "");
  const gamePackage = normalizeWorldGamePackage(extractWorldGamePackageInput(input));
  const nextManifest = {
    ...manifest,
    title,
  };
  if (Object.keys(gamePackage.assets).length > 0) {
    nextManifest.package = gamePackage;
  } else {
    delete nextManifest.package;
  }
  return {
    title,
    prompt,
    source_html: sourceHtml,
    manifest: nextManifest,
    package: gamePackage,
    ai_provider: clipText(input.ai_provider ?? input.aiProvider ?? "", 40) || null,
    ai_model: clipText(input.ai_model ?? input.aiModel ?? "", 80) || null,
    source_game_id: String(input.source_game_id ?? input.sourceGameId ?? "").trim() || null,
  };
}

export function serializeWorldGame(row = {}) {
  const manifest = cloneJson(row.manifest ?? {});
  const gamePackage = safeNormalizeWorldGamePackage(
    manifest?.package && typeof manifest.package === "object" && !Array.isArray(manifest.package)
      ? manifest.package
      : row.package,
  );
  return {
    id: row.id,
    owner_profile_id: row.owner_profile_id,
    source_game_id: row.source_game_id ?? null,
    title: row.title,
    prompt: row.prompt,
    manifest,
    source_html: row.source_html,
    package: gamePackage,
    ai_provider: row.ai_provider ?? null,
    ai_model: row.ai_model ?? null,
    created_at: row.created_at ?? nowIso(),
    updated_at: row.updated_at ?? row.created_at ?? nowIso(),
  };
}

function buildGameBrainstormPrompt(input = {}) {
  const objective = deriveWorldGamePrompt(input);
  const transcript = buildWorldGameMessageTranscript(input.messages);
  return [
    "You are brainstorming a nearby-share Mauworld game package.",
    "Discuss the concept before generating code.",
    "Focus on gameplay loop, seat roles, UI flow, package assets, and what should be separated from code.",
    "Do not output final HTML or JSON yet.",
    "Keep the advice practical and tailored to Mauworld's nearby game shell.",
    `User objective:\n${objective}`,
    transcript ? `Brainstorm thread:\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildGameGenerationPrompt(input = {}) {
  const userPrompt = deriveWorldGamePrompt(input);
  const transcript = buildWorldGameMessageTranscript(input.messages);
  return [
    "Generate a single-file HTML game for Mauworld.",
    "Use the brainstorm thread and context below as the source of truth.",
    "Return JSON only with these top-level keys: title, manifest, html, assets.",
    "The html value must be one complete HTML document with inline CSS and inline JavaScript only.",
    "The assets value must be an object map. Each asset may include kind, mime_type, file_name, and either data_url, text, svg, or base64.",
    "Prefer SVG or text-based assets when possible so they stay editable. Use PNG/JPEG/WebP data URLs only when needed.",
    "If the HTML or inline JavaScript references a packaged resource, use template placeholders like {{assets.fire_icon}} or api.getAssetUrl('fire_icon').",
    "The generated game owns its own visual style. It can look completely different from Mauworld UI.",
    "Do not rely on parent page CSS. Include all visual styling the game needs inside the generated HTML.",
    "Only the outer Mauworld shell is host-styled; the game itself must be visually self-contained.",
    "Do not use external scripts, external stylesheets, remote images, remote fonts, iframes, popups, fetch, XMLHttpRequest, WebSocket, or EventSource.",
    "The game must register with window.MauworldGame.register(...).",
    "Use this SDK contract:",
    "- window.MauworldGame.register({ manifest, mount(api) { ... return { onSession(session), onState(state), onAction(action, meta), destroy() } } })",
    "- api.root: empty DOM container to render into",
    "- api.session: current session summary",
    "- api.session.role is one of 'host', 'player', or 'viewer'",
    "- api.session.claimed_seat_id is the current viewer's claimed seat id when seated",
    "- api.session.seats is an array of seat objects, not a keyed map",
    "- each seat entry includes seat_id, label, viewer_session_id, display_name, and ready",
    "- when a game has unique player identities, read them from api.session.seats and api.session.claimed_seat_id instead of inventing a separate seat system",
    "- api.getState(): read the current authoritative state",
    "- api.setState(nextState): host only, publishes authoritative state to everyone",
    "- api.sendAction(action): non-host players send semantic actions to the host",
    "- api.claimSeat(seatId), api.releaseSeat(optionalSeatId), api.setReady(boolean), api.startMatch()",
    "- api.getAsset(assetId), api.getAssetUrl(assetId), api.listAssets()",
    "- api.publishPreview(elementOrCanvas): publish a live preview frame after rendering",
    "Manifest requirements:",
    '- manifest must include title, description, multiplayer_mode ("single", "turn-based", or "realtime"), min_players, max_players, allow_viewers, aspect_ratio, and preview.',
    "- for multiplayer games with named roles, manifest.seats must list those semantic seat labels in order, for example ['X', 'O'] or ['White', 'Black']",
    "- if the UI says 'Claim X' or 'Claim White', that same label must appear in manifest.seats so the Mauworld shell can show the role identity correctly",
    "- Keep the game simple, readable, and self-contained.",
    transcript ? `Brainstorm thread:\n${transcript}` : "",
    `User request:\n${userPrompt}`,
  ].join("\n\n");
}

export async function brainstormWorldGameWithAi(options = {}) {
  const generated = await generateTextReasoning({
    provider: options.provider ?? "openai",
    apiKey: options.apiKey,
    model: options.model,
    prompt: buildGameBrainstormPrompt(options),
  });
  return {
    message: {
      role: "assistant",
      text: generated.text,
    },
    provider: generated.provider,
    model: generated.model,
    raw: generated.raw,
  };
}

export async function generateWorldGameFromAi(options = {}) {
  const generated = await generateTextReasoning({
    provider: options.provider ?? "openai",
    apiKey: options.apiKey,
    model: options.model,
    prompt: buildGameGenerationPrompt(options),
  });
  const parsed = parseJsonCandidate(generated.text);
  const record = validateWorldGameRecord({
    title: parsed.title,
    prompt: deriveWorldGamePrompt(options),
    source_html: parsed.html,
    manifest: parsed.manifest,
    package: parsed.assets ? { assets: parsed.assets } : {},
    ai_provider: generated.provider,
    ai_model: generated.model,
  });
  return {
    ...record,
    raw_text: generated.text,
    provider: generated.provider,
    model: generated.model,
    raw: generated.raw,
  };
}

export function buildWorldGameExportPackage(game = {}) {
  const record = validateWorldGameRecord(game, {
    promptRequired: false,
  });
  return {
    format: WORLD_GAME_EXPORT_FORMAT,
    title: record.title,
    prompt: record.prompt,
    source_game_id: record.source_game_id,
    source_html: record.source_html,
    manifest: cloneJson(record.manifest),
    package: cloneJson(record.package),
    ai_provider: record.ai_provider,
    ai_model: record.ai_model,
  };
}
