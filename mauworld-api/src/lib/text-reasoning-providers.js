import { HttpError } from "./http.js";

export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-5.4-mini";
export const DEFAULT_ANTHROPIC_TEXT_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_GOOGLE_TEXT_MODEL = "gemini-2.5-flash";
const ANTHROPIC_API_VERSION = "2023-06-01";

function requireApiKey(value, label = "AI provider") {
  const apiKey = String(value ?? "").trim();
  if (!apiKey) {
    throw new HttpError(400, `Missing ${label} API key`);
  }
  return apiKey;
}

export function normalizeTextReasoningProvider(value = "", fallback = "openai") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "openai") {
    return "openai";
  }
  if (normalized === "anthropic" || normalized === "claude") {
    return "anthropic";
  }
  if (normalized === "google" || normalized === "gemini") {
    return "google";
  }
  return normalized;
}

export function getDefaultTextReasoningModel(provider = "") {
  const normalizedProvider = normalizeTextReasoningProvider(provider);
  if (normalizedProvider === "anthropic") {
    return DEFAULT_ANTHROPIC_TEXT_MODEL;
  }
  if (normalizedProvider === "google") {
    return DEFAULT_GOOGLE_TEXT_MODEL;
  }
  return DEFAULT_OPENAI_TEXT_MODEL;
}

function extractOpenAiText(payload = {}) {
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

function extractAnthropicText(payload = {}) {
  const chunks = [];
  for (const content of payload.content ?? []) {
    if (content?.type === "text" && typeof content.text === "string") {
      chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractGeminiText(payload = {}) {
  const chunks = [];
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractProviderErrorMessage(payload = {}, fallback = "AI provider request failed") {
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  return fallback;
}

async function callOpenAiResponses(options = {}) {
  const model = String(options.model ?? getDefaultTextReasoningModel("openai")).trim() || getDefaultTextReasoningModel("openai");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey(options.apiKey, "text reasoning")}`,
    },
    body: JSON.stringify({
      model,
      input: options.prompt,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, extractProviderErrorMessage(payload, "AI provider request failed"));
  }
  const text = extractOpenAiText(payload);
  if (!text) {
    throw new HttpError(502, "AI provider returned no text");
  }
  return {
    provider: "openai",
    model,
    text,
    raw: payload,
  };
}

async function callAnthropicMessages(options = {}) {
  const model = String(options.model ?? getDefaultTextReasoningModel("anthropic")).trim() || getDefaultTextReasoningModel("anthropic");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": requireApiKey(options.apiKey, "text reasoning"),
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(256, Number(options.maxTokens) || 4096),
      messages: [{
        role: "user",
        content: String(options.prompt ?? ""),
      }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, extractProviderErrorMessage(payload, "AI provider request failed"));
  }
  const text = extractAnthropicText(payload);
  if (!text) {
    throw new HttpError(502, "AI provider returned no text");
  }
  return {
    provider: "anthropic",
    model,
    text,
    raw: payload,
  };
}

async function callGoogleGenerateContent(options = {}) {
  const resolvedModel = String(options.model ?? getDefaultTextReasoningModel("google")).trim() || getDefaultTextReasoningModel("google");
  const modelPath = resolvedModel.startsWith("models/") ? resolvedModel : `models/${resolvedModel}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": requireApiKey(options.apiKey, "text reasoning"),
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: String(options.prompt ?? ""),
        }],
      }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, extractProviderErrorMessage(payload, "AI provider request failed"));
  }
  const text = extractGeminiText(payload);
  if (!text) {
    throw new HttpError(502, "AI provider returned no text");
  }
  return {
    provider: "google",
    model: resolvedModel,
    text,
    raw: payload,
  };
}

export async function generateTextReasoning(options = {}) {
  const provider = normalizeTextReasoningProvider(options.provider);
  if (provider === "anthropic") {
    return await callAnthropicMessages(options);
  }
  if (provider === "google") {
    return await callGoogleGenerateContent(options);
  }
  if (provider === "openai") {
    return await callOpenAiResponses(options);
  }
  throw new HttpError(400, `Unsupported text reasoning provider: ${provider}`);
}
