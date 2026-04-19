import { HttpError } from "./http.js";
import { assertSafePublicText, stripMarkdown } from "./text.js";

const DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.4-mini";
const DEFAULT_GAME_ASPECT_RATIO = 16 / 9;
const MAX_GAME_PROMPT_CHARS = 4000;
const MAX_SOURCE_HTML_CHARS = 200_000;
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
  const apiKey = String(options.apiKey ?? "").trim();
  if (!apiKey) {
    throw new HttpError(400, "Missing text reasoning API key");
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: String(options.model ?? DEFAULT_OPENAI_TEXT_MODEL).trim() || DEFAULT_OPENAI_TEXT_MODEL,
      input: options.prompt,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, "AI provider request failed", payload?.error?.message || null);
  }
  const text = extractTextFromResponse(payload);
  if (!text) {
    throw new HttpError(502, "AI provider returned no game output");
  }
  return {
    provider: "openai",
    model: String(options.model ?? DEFAULT_OPENAI_TEXT_MODEL).trim() || DEFAULT_OPENAI_TEXT_MODEL,
    text,
    raw: payload,
  };
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
  return {
    title: rawTitle,
    description,
    multiplayer_mode: multiplayerMode,
    min_players: minPlayers,
    max_players: maxPlayers,
    allow_viewers: allowViewers,
    aspect_ratio: aspectRatio,
    preview,
    seats: buildSeatLabels(input.seats, maxPlayers),
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
    : sanitizeWorldGamePrompt(input.prompt ?? "Generated Mauworld game");
  const sourceHtml = sanitizeWorldGameHtml(input.source_html ?? input.sourceHtml ?? input.html ?? "");
  return {
    title,
    prompt,
    source_html: sourceHtml,
    manifest: {
      ...manifest,
      title,
    },
    ai_provider: clipText(input.ai_provider ?? input.aiProvider ?? "", 40) || null,
    ai_model: clipText(input.ai_model ?? input.aiModel ?? "", 80) || null,
    source_game_id: String(input.source_game_id ?? input.sourceGameId ?? "").trim() || null,
  };
}

export function serializeWorldGame(row = {}) {
  return {
    id: row.id,
    owner_profile_id: row.owner_profile_id,
    source_game_id: row.source_game_id ?? null,
    title: row.title,
    prompt: row.prompt,
    manifest: cloneJson(row.manifest ?? {}),
    source_html: row.source_html,
    ai_provider: row.ai_provider ?? null,
    ai_model: row.ai_model ?? null,
    created_at: row.created_at ?? nowIso(),
    updated_at: row.updated_at ?? row.created_at ?? nowIso(),
  };
}

function buildGameGenerationPrompt(input = {}) {
  const userPrompt = sanitizeWorldGamePrompt(input.prompt ?? input.objective ?? "", "prompt");
  return [
    "Generate a single-file HTML game for Mauworld.",
    "Return JSON only with these top-level keys: title, manifest, html.",
    "The html value must be one complete HTML document with inline CSS and inline JavaScript only.",
    "Do not use external scripts, external stylesheets, remote images, remote fonts, iframes, popups, fetch, XMLHttpRequest, WebSocket, or EventSource.",
    "The game must register with window.MauworldGame.register(...).",
    "Use this SDK contract:",
    "- window.MauworldGame.register({ manifest, mount(api) { ... return { onSession(session), onState(state), onAction(action, meta), destroy() } } })",
    "- api.root: empty DOM container to render into",
    "- api.session: current session summary",
    "- api.getState(): read the current authoritative state",
    "- api.setState(nextState): host only, publishes authoritative state to everyone",
    "- api.sendAction(action): non-host players send semantic actions to the host",
    "- api.claimSeat(seatId), api.releaseSeat(), api.setReady(boolean), api.startMatch()",
    "- api.publishPreview(elementOrCanvas): publish a live preview frame after rendering",
    "Manifest requirements:",
    '- manifest must include title, description, multiplayer_mode ("single", "turn-based", or "realtime"), min_players, max_players, allow_viewers, aspect_ratio, and preview.',
    "- Keep the game simple, readable, and self-contained.",
    `User request:\n${userPrompt}`,
  ].join("\n\n");
}

export async function generateWorldGameFromAi(options = {}) {
  const provider = String(options.provider ?? "openai").trim().toLowerCase() || "openai";
  if (provider !== "openai") {
    throw new HttpError(400, `Unsupported text reasoning provider: ${provider}`);
  }
  const generated = await callOpenAiResponses({
    apiKey: options.apiKey,
    model: options.model,
    prompt: buildGameGenerationPrompt(options),
  });
  const parsed = parseJsonCandidate(generated.text);
  const record = validateWorldGameRecord({
    title: parsed.title,
    prompt: options.prompt ?? options.objective ?? "",
    source_html: parsed.html,
    manifest: parsed.manifest,
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
