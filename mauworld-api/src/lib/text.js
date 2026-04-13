import { HttpError } from "./http.js";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\b(?:bearer|token)\s+[A-Za-z0-9_\-]{16,}\b/i,
  /\b[A-Za-z0-9+\/_-]{40,}={0,2}\b/,
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+\d[\d\s().-]{7,}\d)/;
const TAG_SPLIT_RE = /[,\n]+/;

export function stripMarkdown(input) {
  return String(input ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTagLabel(input) {
  const label = String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^#/, "");
  if (!label) {
    throw new HttpError(400, "Tag labels must not be empty");
  }
  if (label.length > 48) {
    throw new HttpError(400, "Tag labels must be 48 characters or fewer");
  }
  return label;
}

export function slugifyTag(input) {
  const label = normalizeTagLabel(input);
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new HttpError(400, "Could not derive tag slug");
  }
  return slug;
}

export function normalizeTagInputs(inputs) {
  return Array.from(
    new Set(
      inputs
        .flatMap((value) =>
          typeof value === "string" ? value.split(TAG_SPLIT_RE) : []
        )
        .map((value) => normalizeTagLabel(value)),
    ),
  );
}

export function containsSensitiveContent(text) {
  const normalized = String(text ?? "");
  if (!normalized.trim()) {
    return false;
  }
  if (EMAIL_RE.test(normalized) || PHONE_RE.test(normalized)) {
    return true;
  }
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function assertSafePublicText(text, fieldName = "text") {
  if (containsSensitiveContent(text)) {
    throw new HttpError(400, `${fieldName} appears to contain sensitive or private content`);
  }
}

export function derivePostKind(mediaCount) {
  if (!mediaCount) {
    return "text";
  }
  return mediaCount > 0 ? "mixed" : "text";
}

export function tokenizeLabel(label) {
  return Array.from(
    new Set(
      String(label ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

export function derivePostTitle(input) {
  const plain = stripMarkdown(input);
  if (!plain) {
    return "Untitled post";
  }
  const sentenceMatch = plain.match(/^(.{1,120}?[.!?])(?:\s|$)/);
  if (sentenceMatch?.[1]) {
    return sentenceMatch[1].trim();
  }
  return plain.slice(0, 80).trim() || "Untitled post";
}

export function buildSearchText(params) {
  const body = stripMarkdown(params.bodyMd || params.bodyPlain || "");
  const tagText = Array.isArray(params.tags) ? params.tags.join(" ") : "";
  const emotionText = Array.isArray(params.emotions) ? params.emotions.join(" ") : "";
  return `${body} ${tagText} ${emotionText}`.trim();
}

export function summarizeMatch(tag, query) {
  const slug = slugifyTag(tag.label);
  const querySlug = slugifyTag(query);
  if (slug === querySlug) {
    return { matchedBy: "exact", score: 1 };
  }
  if (slug.includes(querySlug) || querySlug.includes(slug)) {
    return { matchedBy: "fuzzy", score: 0.82 };
  }
  const tagTokens = new Set(tokenizeLabel(tag.label));
  const queryTokens = new Set(tokenizeLabel(query));
  if (tagTokens.size === 0 || queryTokens.size === 0) {
    return { matchedBy: "none", score: 0 };
  }
  const intersection = [...tagTokens].filter((token) => queryTokens.has(token)).length;
  const union = new Set([...tagTokens, ...queryTokens]).size;
  const score = union === 0 ? 0 : intersection / union;
  return { matchedBy: score >= 0.45 ? "fuzzy" : "none", score };
}
