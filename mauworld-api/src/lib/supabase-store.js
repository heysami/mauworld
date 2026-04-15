import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";
import {
  buildLinkSignaturePayload,
  deriveDeviceIdFromPublicKey,
  randomLinkCode,
  randomSecret,
  sha256Hex,
  verifyDeviceSignature,
} from "./security.js";
import {
  assertSafePublicText,
  buildSearchText,
  derivePostTitle,
  derivePostKind,
  normalizeTagInputs,
  slugifyTag,
  stripMarkdown,
  summarizeMatch,
} from "./text.js";
import { computePillarGraph } from "./pillar-graph.js";
import { listAllowedPostEmotionSlugs, normalizePostEmotionInputs } from "./emotions.js";
import { runCuratedCorpusSync, shouldRepairPublicWorld } from "./moltbook-import.js";
import {
  computeHeadingToPillar,
  computeTagAnchorPosition,
  computeTagPostInstancesForLayout,
  computeWorldLayout,
  dedupePostTags,
} from "./world-layout.js";

const CURRENT_ORGANIZATION_SLOT = "current";
const NEXT_ORGANIZATION_SLOT = "next";
const EXTERNAL_CONTENT_PURGE_PHRASES = ["moltbook", "curated import", "openclaw", "open claw"];
const EXTERNAL_CONTENT_PURGE_WHOLE_WORDS = ["claw"];
const EXTERNAL_INSTALLATION_PURGE_PHRASES = ["moltbook", "openclaw", "open claw"];

function nowIso() {
  return new Date().toISOString();
}

function addMs(date, amountMs) {
  return new Date(date.getTime() + amountMs);
}

function clampLimit(value, fallback = 20, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(numeric));
}

function isExpired(timestamp) {
  return !timestamp || new Date(timestamp).getTime() <= Date.now();
}

function isPromotionDue(version, intervalHours) {
  const clampedHours = Math.max(1, Math.min(24 * 30, Math.floor(Number(intervalHours) || 24)));
  if (!version?.promoted_at) {
    return true;
  }
  return new Date(version.promoted_at).getTime() + clampedHours * 60 * 60 * 1000 <= Date.now();
}

export function resolveWorldQueueStatus({ hasInstance = false, pendingStatus = null } = {}) {
  if (hasInstance) {
    return "ready";
  }
  return pendingStatus || "queued";
}

function resolveSort(sort) {
  return ["latest", "useful", "controversial"].includes(sort) ? sort : "latest";
}

function comparePosts(sort) {
  if (sort === "useful") {
    return (left, right) =>
      (right.score ?? 0) - (left.score ?? 0) ||
      (right.upvote_count ?? 0) - (left.upvote_count ?? 0) ||
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  }
  if (sort === "controversial") {
    return (left, right) =>
      Math.min(right.upvote_count ?? 0, right.downvote_count ?? 0) -
        Math.min(left.upvote_count ?? 0, left.downvote_count ?? 0) ||
      (right.upvote_count ?? 0) + (right.downvote_count ?? 0) - ((left.upvote_count ?? 0) + (left.downvote_count ?? 0)) ||
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  }
  return (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function normalizeSearchDocument(value) {
  return stripMarkdown(String(value ?? ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCleanupDocument(value) {
  return normalizeSearchDocument(String(value ?? "").replace(/#/g, " "));
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesCleanupTerms(value, { phrases = [], wholeWords = [] } = {}) {
  const normalized = normalizeCleanupDocument(value);
  if (!normalized) {
    return false;
  }

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeCleanupDocument(phrase);
    if (normalizedPhrase && normalized.includes(normalizedPhrase)) {
      return true;
    }
  }

  for (const word of wholeWords) {
    const normalizedWord = normalizeCleanupDocument(word);
    if (!normalizedWord) {
      continue;
    }
    if (new RegExp(`(^|\\s)${escapeRegex(normalizedWord)}(?=\\s|$)`).test(normalized)) {
      return true;
    }
  }

  return false;
}

export function matchesExternalContentText(value) {
  return matchesCleanupTerms(value, {
    phrases: EXTERNAL_CONTENT_PURGE_PHRASES,
    wholeWords: EXTERNAL_CONTENT_PURGE_WHOLE_WORDS,
  });
}

export function shouldPurgeExternalTag(tag) {
  return matchesExternalContentText(`${tag?.label ?? ""} ${tag?.slug ?? ""}`);
}

export function shouldPurgeExternalInstallation(installation) {
  return [
    installation?.display_name,
    installation?.device_id,
    installation?.auth_email,
  ].some((value) =>
    matchesCleanupTerms(value, {
      phrases: EXTERNAL_INSTALLATION_PURGE_PHRASES,
    }));
}

export function shouldPurgeExternalPost({ post, author = null, tagTexts = [] }) {
  const documents = [
    post?.title,
    post?.body_plain,
    post?.search_text,
    post?.tag_search_text,
    ...tagTexts,
    author?.display_name,
    author?.device_id,
    author?.auth_email,
  ];
  return documents.some((value) => matchesExternalContentText(value));
}

function tokenizeSearchQuery(value) {
  const normalized = normalizeSearchDocument(value);
  if (!normalized) {
    return [];
  }
  return Array.from(new Set(normalized.split(/\s+/).filter((token) => token.length >= 2)));
}

function countWholeWordMatches(source, token) {
  if (!source || !token) {
    return 0;
  }
  const matches = source.match(new RegExp(`(^|\\s)${escapeRegex(token)}(?=\\s|$)`, "g"));
  return matches?.length ?? 0;
}

function computePostSearchRelevance(post, query) {
  const phrase = normalizeSearchDocument(query);
  if (!phrase) {
    return 0;
  }
  const tokens = tokenizeSearchQuery(phrase);
  const title = normalizeSearchDocument(post.title ?? "");
  const tagText = normalizeSearchDocument(post.tag_search_text ?? "");
  const searchText = normalizeSearchDocument(post.search_text ?? "");
  const body = normalizeSearchDocument(post.body_plain ?? "");
  let score = 0;

  if (title === phrase) {
    score += 1800;
  } else if (title.startsWith(phrase)) {
    score += 1180;
  } else if (title.includes(phrase)) {
    score += 760;
  }

  if (tagText === phrase) {
    score += 1320;
  } else if (tagText.startsWith(phrase)) {
    score += 820;
  } else if (tagText.includes(phrase)) {
    score += 520;
  }

  if (searchText.includes(phrase)) {
    score += 240;
  }
  if (body.includes(phrase)) {
    score += 180;
  }

  for (const token of tokens) {
    score += countWholeWordMatches(title, token) * 220;
    score += countWholeWordMatches(tagText, token) * 140;
    score += countWholeWordMatches(searchText, token) * 64;
    score += countWholeWordMatches(body, token) * 30;
  }

  if (tokens.length > 1 && tokens.every((token) => title.includes(token))) {
    score += 240;
  }
  if (tokens.length > 1 && tokens.every((token) => tagText.includes(token))) {
    score += 160;
  }

  const titleIndex = title.indexOf(phrase);
  if (titleIndex >= 0) {
    score += Math.max(0, 160 - titleIndex * 6);
  }
  const tagIndex = tagText.indexOf(phrase);
  if (tagIndex >= 0) {
    score += Math.max(0, 120 - tagIndex * 5);
  }

  return score;
}

function rerankSearchedPosts(posts, query, sort) {
  if (!query || posts.length <= 1) {
    return posts;
  }
  const compare = comparePosts(sort);
  return posts
    .map((post, index) => ({
      post,
      index,
      relevance: computePostSearchRelevance(post, query),
    }))
    .sort((left, right) =>
      right.relevance - left.relevance
      || compare(left.post, right.post)
      || left.index - right.index)
    .map((entry) => entry.post);
}

function normalizeThoughtPassStage(value, index) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized) {
    return normalized;
  }
  return index === 0 ? "draft" : "revision";
}

function buildThoughtPassLabel(stage, index) {
  if (stage === "draft") {
    return `Draft ${index + 1}`;
  }
  if (stage === "revision" || stage === "revise" || stage === "rethink") {
    return `Revision ${index + 1}`;
  }
  const words = stage.split("_").filter(Boolean);
  const title = words.length > 0
    ? words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(" ")
    : "Pass";
  return `${title} ${index + 1}`;
}

function normalizeThoughtPassInputs(inputs, finalBodyMd) {
  const normalized = [];
  const rawEntries = Array.isArray(inputs) ? inputs.slice(0, 3) : [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    const bodyMd =
      typeof entry === "string"
        ? entry.trim()
        : String(
            entry?.bodyMd
            ?? entry?.body_md
            ?? entry?.body
            ?? entry?.text
            ?? entry?.bodyPlain
            ?? entry?.body_plain
            ?? "",
          ).trim();
    if (!bodyMd) {
      continue;
    }
    const bodyPlain = stripMarkdown(bodyMd);
    if (!bodyPlain) {
      continue;
    }
    assertSafePublicText(bodyPlain, `Thought pass ${index + 1}`);
    const stage = normalizeThoughtPassStage(entry?.stage, index);
    const label = String(entry?.label ?? "").trim() || buildThoughtPassLabel(stage, index);
    normalized.push({
      pass_index: normalized.length + 1,
      stage,
      label,
      body_md: bodyMd,
      body_plain: bodyPlain,
    });
  }

  if (normalized.length === 0) {
    const fallbackPlain = stripMarkdown(finalBodyMd);
    if (fallbackPlain) {
      normalized.push({
        pass_index: 1,
        stage: "draft",
        label: buildThoughtPassLabel("draft", 0),
        body_md: finalBodyMd,
        body_plain: fallbackPlain,
      });
    }
  }

  return normalized;
}

function sanitizeFilename(filename) {
  return String(filename ?? "asset")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "asset";
}

async function must(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error) {
    throw new HttpError(500, message, error.message);
  }
  return data;
}

async function countRows(dataPromise, message) {
  const { data, error, count } = await dataPromise;
  if (error) {
    throw new HttpError(500, message, error.message);
  }
  if (typeof count === "number") {
    return count;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function maybeSingle(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error && error.code !== "PGRST116") {
    throw new HttpError(500, message, error.message);
  }
  return data ?? null;
}

function isMissingRelationError(error, relationName = "") {
  const code = String(error?.code ?? "").trim();
  const haystack = [
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const needle = String(relationName ?? "").trim().toLowerCase();

  if (code === "42P01" || code === "PGRST205") {
    return true;
  }
  if (!haystack) {
    return false;
  }
  if (needle && (haystack.includes(`'${needle}'`) || haystack.includes(`"${needle}"`) || haystack.includes(`.${needle}`))) {
    return haystack.includes("does not exist") || haystack.includes("schema cache");
  }
  return haystack.includes("does not exist") && haystack.includes("relation");
}

async function maybeMissingRelationRows(dataPromise, relationName, message) {
  const { data, error } = await dataPromise;
  if (error) {
    if (isMissingRelationError(error, relationName)) {
      return [];
    }
    throw new HttpError(500, message, error.message);
  }
  return Array.isArray(data) ? data : [];
}

async function ignoreMissingRelation(dataPromise, relationName, message) {
  const { error } = await dataPromise;
  if (error && !isMissingRelationError(error, relationName)) {
    throw new HttpError(500, message, error.message);
  }
}

function dedupeStringList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

const SUPABASE_IN_FILTER_BATCH_SIZE = 100;
const SUPABASE_MUTATION_BATCH_SIZE = 25;
const WORLD_POST_INSTANCE_INSERT_BATCH_SIZE = 5;
const DERIVED_POST_COUNTER_BATCH_SIZE = 25;

async function loadRowsByInBatches(serviceClient, {
  table,
  column,
  values,
  select = "*",
  batchSize = SUPABASE_IN_FILTER_BATCH_SIZE,
  apply = null,
  message,
}) {
  const scopedValues = dedupeStringList(values);
  if (scopedValues.length === 0) {
    return [];
  }

  const rows = [];
  for (let index = 0; index < scopedValues.length; index += batchSize) {
    const batchValues = scopedValues.slice(index, index + batchSize);
    let query = serviceClient.from(table).select(select).in(column, batchValues);
    if (typeof apply === "function") {
      query = apply(query) ?? query;
    }
    rows.push(...await must(query, message));
  }
  return rows;
}

async function runByBatches(items, worker, {
  batchSize = DERIVED_POST_COUNTER_BATCH_SIZE,
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await Promise.all(batch.map((item, batchIndex) => worker(item, index + batchIndex)));
  }
}

async function insertRowsByBatches(serviceClient, {
  table,
  rows,
  batchSize = SUPABASE_MUTATION_BATCH_SIZE,
  message,
}) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < scopedRows.length; index += batchSize) {
    const batchRows = scopedRows.slice(index, index + batchSize);
    await must(serviceClient.from(table).insert(batchRows), message);
  }
}

async function loadPostIdsByTagIds(serviceClient, {
  tagIds,
  message,
}) {
  const rows = await loadRowsByInBatches(serviceClient, {
    table: "post_tags",
    column: "tag_id",
    values: tagIds,
    select: "post_id",
    message,
  });
  return dedupeStringList(rows.map((row) => row.post_id));
}

async function loadPostsByIds(serviceClient, {
  postIds,
  allowedStates = [],
  message,
}) {
  return await loadRowsByInBatches(serviceClient, {
    table: "posts",
    column: "id",
    values: postIds,
    message,
    apply: (query) => (
      Array.isArray(allowedStates) && allowedStates.length > 0
        ? query.in("state", allowedStates)
        : query
    ),
  });
}

function queueBackgroundWorldRepair(store, { version, settings }) {
  const versionId = String(version?.id ?? "").trim();
  if (!versionId || typeof store?.rebuildWorldSnapshotForVersion !== "function") {
    return null;
  }
  const existing = store.__currentWorldRepair ?? null;
  if (existing?.versionId === versionId && existing.promise) {
    return existing.promise;
  }

  const promise = store.rebuildWorldSnapshotForVersion({ version, settings })
    .catch((error) => {
      console.error("[world-repair] background repair failed", error);
      return null;
    })
    .finally(() => {
      if (store.__currentWorldRepair?.promise === promise) {
        store.__currentWorldRepair = null;
      }
    });

  store.__currentWorldRepair = {
    versionId,
    promise,
  };
  return promise;
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function resolveWorldEventPriority(eventType) {
  if (eventType === "snapshot_promoted") {
    return 200;
  }
  if (eventType === "post_created") {
    return 120;
  }
  if (eventType === "post_metrics_changed") {
    return 90;
  }
  return 80;
}

function estimateWorldSceneDelayMs(pendingCount, batchSize) {
  const batches = Math.max(1, Math.ceil(Math.max(0, pendingCount) / Math.max(1, batchSize)));
  return batches * 5000;
}

export function computePillarStreamPaddingCells(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const proxyDistance = computePillarProxyDistance(settings);
  return Math.max(2, Math.min(48, Math.ceil(proxyDistance / cellSize) + 2));
}

export function computePillarProxyDistance(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const nearDistance = Math.max(16, Math.floor(Number(settings.world_lod_near_distance) || 180));
  const billboardDistance = Math.max(16, Math.floor(Number(settings.world_billboard_distance) || 420));
  const baseProxyDistance = Math.max(
    Math.round(nearDistance * 1.1),
    Math.round(cellSize * 2.3),
    Math.round(billboardDistance * 0.52),
  );
  return Math.max(48, Math.round(baseProxyDistance * 10));
}

export function computePillarProxyHysteresis(settings = {}) {
  return 0;
}

export function computeTagProxyDistance(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const nearDistance = Math.max(16, Math.floor(Number(settings.world_lod_near_distance) || 180));
  const billboardDistance = Math.max(16, Math.floor(Number(settings.world_billboard_distance) || 420));
  return Math.max(
    Math.round(nearDistance * 0.92),
    Math.round(cellSize * 1.8),
    Math.round(billboardDistance * 0.36),
  );
}

export function computeTagProxyHysteresis(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const proxyDistance = Math.max(1, computeTagProxyDistance(settings));
  return Number(Math.max(0.09, Math.min(0.2, (cellSize * 0.34) / proxyDistance)).toFixed(4));
}

export function computeTagStreamPaddingCells(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const proxyDistance = computeTagProxyDistance(settings);
  return Math.max(3, Math.min(18, Math.ceil(proxyDistance / cellSize) + 2));
}

export function computeActorProxyDistance(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const nearDistance = Math.max(16, Math.floor(Number(settings.world_lod_near_distance) || 180));
  const billboardDistance = Math.max(16, Math.floor(Number(settings.world_billboard_distance) || 420));
  const baseProxyDistance = Math.max(
    Math.round(nearDistance * 0.84),
    Math.round(cellSize * 1.45),
    Math.round(billboardDistance * 0.28),
  );
  return Math.max(28, Math.round(baseProxyDistance * 3));
}

export function computeActorProxyHysteresis(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const proxyDistance = Math.max(1, computeActorProxyDistance(settings));
  return Number(Math.max(0.08, Math.min(0.18, (cellSize * 0.32) / proxyDistance)).toFixed(4));
}

export function computeActorStreamPaddingCells(settings = {}) {
  const cellSize = Math.max(16, Math.floor(Number(settings.world_cell_size) || 64));
  const proxyDistance = computeActorProxyDistance(settings);
  return Math.max(2, Math.min(16, Math.ceil(proxyDistance / cellSize) + 1));
}

export function expandWorldCellRange(range, paddingCells) {
  const padding = Math.max(0, Math.floor(Number(paddingCells) || 0));
  return {
    cellXMin: clampInteger(range.cellXMin - padding, -padding, -10000, 10000),
    cellXMax: clampInteger(range.cellXMax + padding, padding, -10000, 10000),
    cellZMin: clampInteger(range.cellZMin - padding, -padding, -10000, 10000),
    cellZMax: clampInteger(range.cellZMax + padding, padding, -10000, 10000),
  };
}

function buildWorldRendererConfig(settings) {
  const pillarStreamPaddingCells = computePillarStreamPaddingCells(settings);
  const pillarProxyDistance = computePillarProxyDistance(settings);
  const pillarProxyHysteresis = computePillarProxyHysteresis(settings);
  const tagStreamPaddingCells = computeTagStreamPaddingCells(settings);
  const tagProxyDistance = computeTagProxyDistance(settings);
  const tagProxyHysteresis = computeTagProxyHysteresis(settings);
  const actorStreamPaddingCells = computeActorStreamPaddingCells(settings);
  const actorProxyDistance = computeActorProxyDistance(settings);
  const actorProxyHysteresis = computeActorProxyHysteresis(settings);
  return {
    snow: {
      enabled: true,
      density: 0.42,
      drift: 0.7,
      speed: 0.9,
    },
    fog: {
      enabled: true,
      lodNearDistance: settings.world_lod_near_distance,
      billboardDistance: settings.world_billboard_distance,
      farDistance: Math.round(Math.max(settings.world_billboard_distance * 1.6, pillarProxyDistance * 0.48)),
    },
    lod: {
      cellSize: settings.world_cell_size,
      visiblePostsPerTag: settings.world_visible_posts_per_tag,
      levelsPerPillar: settings.world_levels_per_pillar,
      pillarStreamPaddingCells,
      pillarProxyDistance,
      pillarProxyHysteresis,
      tagStreamPaddingCells,
      tagProxyDistance,
      tagProxyHysteresis,
      actorStreamPaddingCells,
      actorProxyDistance,
      actorProxyHysteresis,
    },
    interaction: {
      chat: {
        maxChars: Math.max(1, Math.floor(Number(settings.world_chat_max_chars) || 160)),
        ttlSeconds: Math.max(1, Math.floor(Number(settings.world_chat_ttl_seconds) || 8)),
        detailRadius: Math.max(16, Math.floor(Number(settings.world_chat_detail_radius) || 180)),
      },
      browser: {
        radius: Math.max(16, Math.floor(Number(settings.world_browser_radius) || 96)),
        maxRecipients: Math.max(1, Math.floor(Number(settings.world_interaction_max_recipients) || 20)),
        aspectRatio: 16 / 9,
        viewportWidth: 1280,
        viewportHeight: 720,
      },
    },
  };
}

export class MauworldStore {
  constructor(config) {
    this.config = config;
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.anonClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async health() {
    return {
      status: "ok",
      time: nowIso(),
    };
  }

  async getSettings() {
    const row = await maybeSingle(
      this.serviceClient.from("app_settings").select("*").eq("id", true).maybeSingle(),
      "Could not load app settings",
    );
    if (row) {
      return row;
    }
    const inserted = await must(
      this.serviceClient
        .from("app_settings")
        .insert({ id: true })
        .select("*")
        .single(),
      "Could not initialize app settings",
    );
    return inserted;
  }

  async updateSettings(input) {
    const current = await this.getSettings();
    const next = {
      pillar_core_size:
        typeof input.pillar_core_size === "number" ? Math.max(1, Math.min(100, Math.floor(input.pillar_core_size))) : current.pillar_core_size,
      pillar_promotion_interval_hours:
        typeof input.pillar_promotion_interval_hours === "number"
          ? Math.max(1, Math.min(24 * 30, Math.floor(input.pillar_promotion_interval_hours)))
          : current.pillar_promotion_interval_hours,
      related_similarity_threshold:
        typeof input.related_similarity_threshold === "number"
          ? Math.max(0.01, Math.min(0.95, input.related_similarity_threshold))
          : current.related_similarity_threshold,
      world_visible_posts_per_tag:
        typeof input.world_visible_posts_per_tag === "number"
          ? Math.max(1, Math.min(200, Math.floor(input.world_visible_posts_per_tag)))
          : current.world_visible_posts_per_tag,
      world_levels_per_pillar:
        typeof input.world_levels_per_pillar === "number"
          ? Math.max(1, Math.min(12, Math.floor(input.world_levels_per_pillar)))
          : current.world_levels_per_pillar,
      world_queue_batch_size:
        typeof input.world_queue_batch_size === "number"
          ? Math.max(1, Math.min(1000, Math.floor(input.world_queue_batch_size)))
          : current.world_queue_batch_size,
      world_presence_ttl_seconds:
        typeof input.world_presence_ttl_seconds === "number"
          ? Math.max(5, Math.min(3600, Math.floor(input.world_presence_ttl_seconds)))
          : current.world_presence_ttl_seconds,
      world_cell_size:
        typeof input.world_cell_size === "number"
          ? Math.max(16, Math.min(1024, Math.floor(input.world_cell_size)))
          : current.world_cell_size,
      world_lod_near_distance:
        typeof input.world_lod_near_distance === "number"
          ? Math.max(16, Math.min(4096, Math.floor(input.world_lod_near_distance)))
          : current.world_lod_near_distance,
      world_billboard_distance:
        typeof input.world_billboard_distance === "number"
          ? Math.max(16, Math.min(8192, Math.floor(input.world_billboard_distance)))
          : current.world_billboard_distance,
      world_chat_max_chars:
        typeof input.world_chat_max_chars === "number"
          ? Math.max(1, Math.min(500, Math.floor(input.world_chat_max_chars)))
          : current.world_chat_max_chars,
      world_chat_ttl_seconds:
        typeof input.world_chat_ttl_seconds === "number"
          ? Math.max(1, Math.min(60, Math.floor(input.world_chat_ttl_seconds)))
          : current.world_chat_ttl_seconds,
      world_chat_detail_radius:
        typeof input.world_chat_detail_radius === "number"
          ? Math.max(16, Math.min(4096, Math.floor(input.world_chat_detail_radius)))
          : current.world_chat_detail_radius,
      world_browser_radius:
        typeof input.world_browser_radius === "number"
          ? Math.max(16, Math.min(4096, Math.floor(input.world_browser_radius)))
          : current.world_browser_radius,
      world_interaction_max_recipients:
        typeof input.world_interaction_max_recipients === "number"
          ? Math.max(1, Math.min(200, Math.floor(input.world_interaction_max_recipients)))
          : current.world_interaction_max_recipients,
      updated_at: nowIso(),
    };
    const updated = await must(
      this.serviceClient.from("app_settings").upsert({ id: true, ...next }).select("*").single(),
      "Could not update app settings",
    );
    return updated;
  }

  async ensureOrganizationVersions() {
    const existing = await must(
      this.serviceClient.from("organization_versions").select("*"),
      "Could not load organization versions",
    );
    const bySlot = new Map(existing.map((row) => [row.slot, row]));

    const missingRows = [];
    if (!bySlot.has(CURRENT_ORGANIZATION_SLOT)) {
      missingRows.push({
        slot: CURRENT_ORGANIZATION_SLOT,
        snapshot_at: nowIso(),
        promoted_at: nowIso(),
      });
    }
    if (!bySlot.has(NEXT_ORGANIZATION_SLOT)) {
      missingRows.push({
        slot: NEXT_ORGANIZATION_SLOT,
        snapshot_at: nowIso(),
      });
    }

    if (missingRows.length > 0) {
      const inserted = await must(
        this.serviceClient.from("organization_versions").insert(missingRows).select("*"),
        "Could not initialize organization versions",
      );
      for (const row of inserted) {
        bySlot.set(row.slot, row);
      }
    }

    return {
      current: bySlot.get(CURRENT_ORGANIZATION_SLOT),
      next: bySlot.get(NEXT_ORGANIZATION_SLOT),
    };
  }

  async getOrganizationSummary() {
    const versions = await this.ensureOrganizationVersions();
    return {
      current: versions.current ?? null,
      next: versions.next ?? null,
    };
  }

  async ensureWorldSnapshotsForVersions(versions) {
    const versionIds = dedupeStringList([versions.current?.id, versions.next?.id]);
    if (versionIds.length === 0) {
      return new Map();
    }
    const existing = await must(
      this.serviceClient.from("world_snapshots").select("*").in("organization_version_id", versionIds),
      "Could not load world snapshots",
    );
    const byVersionId = new Map(existing.map((row) => [row.organization_version_id, row]));
    const missingRows = versionIds
      .filter((versionId) => !byVersionId.has(versionId))
      .map((organization_version_id) => ({
        organization_version_id,
        status: "building",
      }));
    if (missingRows.length > 0) {
      const inserted = await must(
        this.serviceClient.from("world_snapshots").insert(missingRows).select("*"),
        "Could not initialize world snapshots",
      );
      for (const row of inserted) {
        byVersionId.set(row.organization_version_id, row);
      }
    }
    return byVersionId;
  }

  async getWorldSnapshotForVersion(versionId) {
    if (!versionId) {
      return null;
    }
    return await maybeSingle(
      this.serviceClient
        .from("world_snapshots")
        .select("*")
        .eq("organization_version_id", versionId)
        .maybeSingle(),
      "Could not load world snapshot",
    );
  }

  async getWorldSummary() {
    const organization = await this.getOrganizationSummary();
    const snapshots = await this.ensureWorldSnapshotsForVersions(organization);
    return {
      current: organization.current ? snapshots.get(organization.current.id) ?? null : null,
      next: organization.next ? snapshots.get(organization.next.id) ?? null : null,
    };
  }

  async ensureCurrentWorldContext() {
    const [settings, organization, worldSummary] = await Promise.all([
      this.getSettings(),
      this.getOrganizationSummary(),
      this.getWorldSummary(),
    ]);
    if (!organization.current) {
      throw new HttpError(404, "Current organization version not found");
    }
    let effectiveWorldSummary = worldSummary;
    let worldSnapshot = worldSummary.current ?? null;
    if (shouldRepairPublicWorld(organization, worldSummary)) {
      if (worldSnapshot?.built_at) {
        queueBackgroundWorldRepair(this, {
          version: organization.current,
          settings,
        });
      } else {
        try {
          const repaired = await this.rebuildWorldSnapshotForVersion({
            version: organization.current,
            settings,
          });
          worldSnapshot = repaired.worldSnapshot;
          effectiveWorldSummary = {
            ...worldSummary,
            current: worldSnapshot,
          };
        } catch (error) {
          if (!worldSnapshot?.built_at) {
            throw error;
          }
        }
      }
    }
    if (!worldSnapshot) {
      throw new HttpError(404, "Current world snapshot not found");
    }
    return {
      settings,
      organization,
      worldSummary: effectiveWorldSummary,
      currentVersion: organization.current,
      worldSnapshot,
    };
  }

  async refreshPostSearchDocument(postId) {
    if (!postId) {
      return;
    }
    const { error } = await this.serviceClient.rpc("refresh_post_search_document", {
      target_post_id: postId,
    });
    if (error) {
      throw new HttpError(500, "Could not refresh post search document", error.message);
    }
  }

  async markWorldSnapshotFailed(worldSnapshotId, errorMessage) {
    if (!worldSnapshotId) {
      return;
    }
    await must(
      this.serviceClient
        .from("world_snapshots")
        .update({
          status: "failed",
          metrics: {
            error: errorMessage,
          },
        })
        .eq("id", worldSnapshotId),
      "Could not mark world snapshot as failed",
    );
  }

  async refreshWorldSnapshotMetadata(worldSnapshotId) {
    const [pillarLayouts, tagLayouts, postInstances] = await Promise.all([
      must(
        this.serviceClient
          .from("world_pillar_layouts")
          .select("pillar_id, position_x, position_y, position_z")
          .eq("world_snapshot_id", worldSnapshotId),
        "Could not load world pillar layouts for metadata refresh",
      ),
      must(
        this.serviceClient
          .from("world_tag_layouts")
          .select("pillar_id, orbit_angle, orbit_radius, y_offset")
          .eq("world_snapshot_id", worldSnapshotId),
        "Could not load world tag layouts for metadata refresh",
      ),
      must(
        this.serviceClient
          .from("world_post_instances")
          .select("position_x, position_z, display_tier")
          .eq("world_snapshot_id", worldSnapshotId),
        "Could not load world post instances for metadata refresh",
      ),
    ]);
    const pillarLayoutById = new Map(pillarLayouts.map((row) => [row.pillar_id, row]));
    const points = [];
    points.push(...pillarLayouts.map((row) => ({ x: row.position_x, z: row.position_z })));
    for (const tagLayout of tagLayouts) {
      const pillarLayout = pillarLayoutById.get(tagLayout.pillar_id);
      if (!pillarLayout) {
        continue;
      }
      const anchor = computeTagAnchorPosition(pillarLayout, tagLayout);
      points.push({ x: anchor.x, z: anchor.z });
    }
    points.push(...postInstances.map((row) => ({ x: row.position_x, z: row.position_z })));
    const bounds =
      points.length === 0
        ? {
            minX: 0,
            maxX: 0,
            minZ: 0,
            maxZ: 0,
          }
        : points.reduce(
            (accumulator, point) => ({
              minX: Math.min(accumulator.minX, point.x),
              maxX: Math.max(accumulator.maxX, point.x),
              minZ: Math.min(accumulator.minZ, point.z),
              maxZ: Math.max(accumulator.maxZ, point.z),
            }),
            {
              minX: points[0].x,
              maxX: points[0].x,
              minZ: points[0].z,
              maxZ: points[0].z,
            },
          );

    const metrics = {
      pillarCount: pillarLayouts.length,
      tagCount: tagLayouts.length,
      postInstanceCount: postInstances.length,
      visiblePostInstanceCount: postInstances.filter((row) => row.display_tier !== "hidden").length,
    };

    await must(
      this.serviceClient
        .from("world_snapshots")
        .update({
          bounds_x_min: Number(bounds.minX.toFixed(4)),
          bounds_x_max: Number(bounds.maxX.toFixed(4)),
          bounds_z_min: Number(bounds.minZ.toFixed(4)),
          bounds_z_max: Number(bounds.maxZ.toFixed(4)),
          metrics,
          built_at: nowIso(),
          status: "ready",
        })
        .eq("id", worldSnapshotId),
      "Could not update world snapshot metadata",
    );
  }

  async rebuildWorldSnapshotForVersion({ version, settings }) {
    const worldSnapshots = await this.ensureWorldSnapshotsForVersions({ current: version, next: null });
    const worldSnapshot = worldSnapshots.get(version.id);
    const searchableStates = ["active", "flagged"];

    await must(
      this.serviceClient
        .from("world_snapshots")
        .update({
          status: "building",
        })
        .eq("id", worldSnapshot.id),
      "Could not mark world snapshot as building",
    );

    try {
      const pillars = await must(
        this.serviceClient
          .from("pillars")
          .select("*")
          .eq("organization_version_id", version.id)
          .eq("active", true)
          .order("tag_count", { ascending: false }),
        "Could not load version pillars for world snapshot rebuild",
      );
      const pillarIds = pillars.map((row) => row.id);
      const [pillarTags, posts] = await Promise.all([
        pillarIds.length > 0
          ? loadRowsByInBatches(this.serviceClient, {
              table: "pillar_tags",
              column: "pillar_id",
              values: pillarIds,
              message: "Could not load pillar tags for world snapshot rebuild",
            })
          : [],
        must(
          this.serviceClient
            .from("posts")
            .select("id, title, body_plain, created_at, state, score, comment_count, primary_tag_id")
            .in("state", searchableStates),
          "Could not load posts for world snapshot rebuild",
        ),
      ]);
      const postIds = posts.map((row) => row.id);
      const postTags =
        postIds.length > 0
          ? await loadRowsByInBatches(this.serviceClient, {
              table: "post_tags",
              column: "post_id",
              values: postIds,
              message: "Could not load post tags for world snapshot rebuild",
            })
          : [];

      const layout = computeWorldLayout({
        worldSnapshotId: worldSnapshot.id,
        pillars,
        pillarTags,
        posts,
        postTags,
        settings,
        referenceTime: new Date(),
      });

      await Promise.all([
        must(
          this.serviceClient.from("world_post_instances").delete().eq("world_snapshot_id", worldSnapshot.id),
          "Could not clear world post instances",
        ),
        must(
          this.serviceClient.from("live_presence_sessions").delete().eq("world_snapshot_id", worldSnapshot.id).lt("expires_at", nowIso()),
          "Could not clear expired live presence sessions",
        ),
      ]);
      await Promise.all([
        must(
          this.serviceClient.from("world_tag_layouts").delete().eq("world_snapshot_id", worldSnapshot.id),
          "Could not clear world tag layouts",
        ),
        must(
          this.serviceClient.from("world_pillar_layouts").delete().eq("world_snapshot_id", worldSnapshot.id),
          "Could not clear world pillar layouts",
        ),
      ]);

      if (layout.pillarLayouts.length > 0) {
        await insertRowsByBatches(this.serviceClient, {
          table: "world_pillar_layouts",
          rows: layout.pillarLayouts,
          message: "Could not insert world pillar layouts",
        });
      }
      if (layout.tagLayouts.length > 0) {
        await insertRowsByBatches(this.serviceClient, {
          table: "world_tag_layouts",
          rows: layout.tagLayouts,
          message: "Could not insert world tag layouts",
        });
      }
      if (layout.postInstances.length > 0) {
        await insertRowsByBatches(this.serviceClient, {
          table: "world_post_instances",
          rows: layout.postInstances,
          batchSize: WORLD_POST_INSTANCE_INSERT_BATCH_SIZE,
          message: "Could not insert world post instances",
        });
      }

      const updated = await must(
        this.serviceClient
          .from("world_snapshots")
          .update({
            status: "ready",
            bounds_x_min: layout.bounds.minX,
            bounds_x_max: layout.bounds.maxX,
            bounds_z_min: layout.bounds.minZ,
            bounds_z_max: layout.bounds.maxZ,
            built_at: nowIso(),
            metrics: layout.metrics,
          })
          .eq("id", worldSnapshot.id)
          .select("*")
          .single(),
        "Could not persist world snapshot metadata",
      );

      return {
        worldSnapshot: updated,
        layout,
      };
    } catch (error) {
      await this.markWorldSnapshotFailed(worldSnapshot.id, error.message);
      throw error;
    }
  }

  async enqueueWorldIngestEvent({ eventType, postId = null, worldSnapshotId = null, payload = {} }) {
    if (!worldSnapshotId) {
      return {
        event: null,
        queue: {
          pendingCount: 0,
          processingCount: 0,
          estimatedDelayMs: 0,
        },
      };
    }

    const event = await must(
      this.serviceClient
        .from("world_ingest_events")
        .insert({
          event_type: eventType,
          post_id: postId,
          world_snapshot_id: worldSnapshotId,
          status: "queued",
          priority: resolveWorldEventPriority(eventType),
          available_at: nowIso(),
          payload,
        })
        .select("*")
        .single(),
      "Could not enqueue world ingest event",
    );
    const queue = await this.getWorldQueueLag(worldSnapshotId);
    return {
      event,
      queue,
    };
  }

  async getWorldQueueLag(worldSnapshotId = undefined, settings = undefined) {
    const effectiveSettings = settings ?? await this.getSettings();
    const baseQuery = this.serviceClient
      .from("world_ingest_events")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"]);
    const processingQuery = this.serviceClient
      .from("world_ingest_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing");

    const scopedBaseQuery = worldSnapshotId ? baseQuery.eq("world_snapshot_id", worldSnapshotId) : baseQuery;
    const scopedProcessingQuery = worldSnapshotId ? processingQuery.eq("world_snapshot_id", worldSnapshotId) : processingQuery;
    const [pendingCount, processingCount] = await Promise.all([
      countRows(scopedBaseQuery, "Could not count world ingest events"),
      countRows(scopedProcessingQuery, "Could not count processing world ingest events"),
    ]);

    return {
      pendingCount,
      processingCount,
      estimatedDelayMs: estimateWorldSceneDelayMs(pendingCount, effectiveSettings.world_queue_batch_size),
    };
  }

  async refreshWorldTagInstances(worldSnapshotId, tagIds, settings) {
    const scopedTagIds = dedupeStringList(tagIds);
    if (scopedTagIds.length === 0) {
      return {
        tagCount: 0,
        instanceCount: 0,
      };
    }

    const tagLayouts = await must(
      this.serviceClient
        .from("world_tag_layouts")
        .select("*")
        .eq("world_snapshot_id", worldSnapshotId)
        .in("tag_id", scopedTagIds),
      "Could not load world tag layouts for refresh",
    );
    if (tagLayouts.length === 0) {
      return {
        tagCount: 0,
        instanceCount: 0,
      };
    }

    const pillarIds = dedupeStringList(tagLayouts.map((row) => row.pillar_id));
    const [pillarLayouts, postTags] = await Promise.all([
      pillarIds.length > 0
        ? must(
            this.serviceClient
              .from("world_pillar_layouts")
              .select("*")
              .eq("world_snapshot_id", worldSnapshotId)
              .in("pillar_id", pillarIds),
            "Could not load world pillar layouts for refresh",
          )
        : [],
      must(
        this.serviceClient.from("post_tags").select("*").in("tag_id", scopedTagIds),
        "Could not load post tags for world tag refresh",
      ),
    ]);
    const postIds = dedupeStringList(postTags.map((row) => row.post_id));
    const posts =
      postIds.length > 0
        ? await must(
            this.serviceClient
              .from("posts")
              .select("id, title, body_plain, created_at, state, score, comment_count, primary_tag_id")
              .in("id", postIds),
            "Could not load posts for world tag refresh",
          )
        : [];

    const searchablePosts = posts.filter((post) => ["active", "flagged"].includes(post.state));
    const searchablePostIds = new Set(searchablePosts.map((post) => post.id));
    const filteredPostTags = dedupePostTags(postTags.filter((row) => searchablePostIds.has(row.post_id)));
    const postTagsByTagId = filteredPostTags.reduce((map, row) => {
      if (!map.has(row.tag_id)) {
        map.set(row.tag_id, []);
      }
      map.get(row.tag_id).push(row);
      return map;
    }, new Map());
    const postTagsByPostId = filteredPostTags.reduce((map, row) => {
      if (!map.has(row.post_id)) {
        map.set(row.post_id, []);
      }
      map.get(row.post_id).push(row);
      return map;
    }, new Map());
    for (const rows of postTagsByTagId.values()) {
      rows.sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0) || String(left.tag_id).localeCompare(String(right.tag_id)));
    }
    for (const rows of postTagsByPostId.values()) {
      rows.sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0) || String(left.tag_id).localeCompare(String(right.tag_id)));
    }

    const postById = new Map(searchablePosts.map((post) => [post.id, post]));
    const pillarLayoutById = new Map(pillarLayouts.map((row) => [row.pillar_id, row]));
    const canonicalTagByPostId = new Map(
      searchablePosts
        .map((post) => {
          const rows = postTagsByPostId.get(post.id) ?? [];
          const canonicalRow = rows.find((row) => row.tag_id === post.primary_tag_id) ?? rows[0] ?? null;
          return canonicalRow ? [post.id, canonicalRow.tag_id] : null;
        })
        .filter(Boolean),
    );

    const nextTagLayouts = [];
    const nextInstances = [];
    for (const tagLayout of tagLayouts) {
      const pillarLayout = pillarLayoutById.get(tagLayout.pillar_id);
      if (!pillarLayout) {
        continue;
      }
      const rows = postTagsByTagId.get(tagLayout.tag_id) ?? [];
      const tagPosts = rows.map((row) => postById.get(row.post_id)).filter(Boolean);
      const instances = computeTagPostInstancesForLayout({
        worldSnapshotId,
        tagLayout,
        pillarLayout,
        posts: tagPosts,
        settings,
        canonicalTagByPostId,
        referenceTime: new Date(),
      });
      nextTagLayouts.push({
        ...tagLayout,
        active_post_count: instances.length,
        visible_post_count: instances.filter((row) => row.display_tier !== "hidden").length,
      });
      nextInstances.push(...instances);
    }

    await must(
      this.serviceClient
        .from("world_post_instances")
        .delete()
        .eq("world_snapshot_id", worldSnapshotId)
        .in("tag_id", scopedTagIds),
      "Could not clear world post instances for tag refresh",
    );

    if (nextInstances.length > 0) {
      await insertRowsByBatches(this.serviceClient, {
        table: "world_post_instances",
        rows: nextInstances,
        batchSize: WORLD_POST_INSTANCE_INSERT_BATCH_SIZE,
        message: "Could not insert world post instances for tag refresh",
      });
    }
    if (nextTagLayouts.length > 0) {
      await must(
        this.serviceClient.from("world_tag_layouts").upsert(nextTagLayouts, {
          onConflict: "world_snapshot_id,pillar_id,tag_id",
        }),
        "Could not update world tag layouts for refresh",
      );
    }
    await this.refreshWorldSnapshotMetadata(worldSnapshotId);

    return {
      tagCount: nextTagLayouts.length,
      instanceCount: nextInstances.length,
    };
  }

  async processWorldIngestQueue(limit = undefined) {
    const { settings, worldSnapshot } = await this.ensureCurrentWorldContext();
    const batchSize = clampInteger(limit, settings.world_queue_batch_size, 1, 1000);
    const events = await must(
      this.serviceClient
        .from("world_ingest_events")
        .select("*")
        .eq("world_snapshot_id", worldSnapshot.id)
        .eq("status", "queued")
        .lte("available_at", nowIso())
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(batchSize),
      "Could not load queued world ingest events",
    );

    if (events.length === 0) {
      return {
        processedCount: 0,
        refreshedTagCount: 0,
        queue: await this.getWorldQueueLag(worldSnapshot.id, settings),
      };
    }

    const eventIds = events.map((row) => row.id);
    await must(
      this.serviceClient
        .from("world_ingest_events")
        .update({
          status: "processing",
          claimed_at: nowIso(),
          error: null,
        })
        .in("id", eventIds),
      "Could not claim world ingest events",
    );

    try {
      const postIds = dedupeStringList(events.map((row) => row.post_id));
      let refreshedTagCount = 0;
      if (postIds.length > 0) {
        const postTags = await must(
          this.serviceClient.from("post_tags").select("tag_id").in("post_id", postIds),
          "Could not load tags for queued world ingest events",
        );
        const tagIds = dedupeStringList(postTags.map((row) => row.tag_id));
        const refreshResult = await this.refreshWorldTagInstances(worldSnapshot.id, tagIds, settings);
        refreshedTagCount = refreshResult.tagCount;
      } else {
        await this.refreshWorldSnapshotMetadata(worldSnapshot.id);
      }

      await must(
        this.serviceClient
          .from("world_ingest_events")
          .update({
            status: "processed",
            processed_at: nowIso(),
            error: null,
          })
          .in("id", eventIds),
        "Could not mark world ingest events as processed",
      );

      return {
        processedCount: events.length,
        refreshedTagCount,
        queue: await this.getWorldQueueLag(worldSnapshot.id, settings),
      };
    } catch (error) {
      await must(
        this.serviceClient
          .from("world_ingest_events")
          .update({
            status: "failed",
            error: error.message,
          })
          .in("id", eventIds),
        "Could not mark world ingest events as failed",
      );
      throw error;
    }
  }

  async loadPillarsForVersion(versionId) {
    return await must(
      this.serviceClient.from("pillars").select("*").eq("organization_version_id", versionId),
      "Could not load version pillars",
    );
  }

  async persistGraphToVersion({ version, existingPillars, graph, snapshotAt, promotedAt = undefined }) {
    const existingPillarIds = existingPillars.map((pillar) => pillar.id);

    if (graph.pillars.length === 0) {
      if (existingPillarIds.length > 0) {
        await Promise.all([
          must(
            this.serviceClient.from("pillar_tags").delete().in("pillar_id", existingPillarIds),
            "Could not clear pillar tag rows",
          ),
          must(
            this.serviceClient.from("pillar_related").delete().in("pillar_id", existingPillarIds),
            "Could not clear pillar relation rows",
          ),
          must(
            this.serviceClient.from("pillars").update({ active: false, updated_at: nowIso() }).in("id", existingPillarIds),
            "Could not deactivate empty version pillars",
          ),
        ]);
      }

      const versionUpdate = {
        snapshot_at: snapshotAt,
        updated_at: nowIso(),
      };
      if (promotedAt !== undefined) {
        versionUpdate.promoted_at = promotedAt;
      }
      const updatedVersion = await must(
        this.serviceClient.from("organization_versions").update(versionUpdate).eq("id", version.id).select("*").single(),
        "Could not update organization version metadata",
      );

      return {
        version: updatedVersion,
        pillars: [],
        graph,
        placeholderToPersistedId: new Map(),
      };
    }

    const upsertedPillars = [];
    const placeholderToPersistedId = new Map();
    for (const pillar of graph.pillars) {
      const row = await must(
        this.serviceClient
          .from("pillars")
          .upsert(
            {
              id: typeof pillar.id === "string" && pillar.id.startsWith("generated-") ? undefined : pillar.id,
              organization_version_id: version.id,
              component_key: pillar.component_key,
              slug: pillar.slug,
              title: pillar.title,
              core_size: pillar.core_size,
              tag_count: pillar.tag_count,
              edge_count: pillar.edge_count,
              active: true,
              updated_at: nowIso(),
            },
            { onConflict: "organization_version_id,component_key" },
          )
          .select("*")
          .single(),
        "Could not upsert pillar",
      );
      upsertedPillars.push(row);
      placeholderToPersistedId.set(pillar.id, row.id);
    }

    const activeIds = upsertedPillars.map((pillar) => pillar.id);
    const staleIds = existingPillars
      .filter((pillar) => !activeIds.includes(pillar.id))
      .map((pillar) => pillar.id);
    if (staleIds.length > 0) {
      await must(
        this.serviceClient.from("pillars").update({ active: false, updated_at: nowIso() }).in("id", staleIds),
        "Could not deactivate stale pillars",
      );
    }

    const versionPillarIds = dedupeStringList([...existingPillarIds, ...activeIds]);
    if (versionPillarIds.length > 0) {
      await Promise.all([
        must(
          this.serviceClient.from("pillar_tags").delete().in("pillar_id", versionPillarIds),
          "Could not clear pillar tag rows",
        ),
        must(
          this.serviceClient.from("pillar_related").delete().in("pillar_id", versionPillarIds),
          "Could not clear pillar relation rows",
        ),
      ]);
    }

    const pillarTags = graph.pillarTags.map((row) => ({
      pillar_id: placeholderToPersistedId.get(row.pillar_id) ?? row.pillar_id,
      tag_id: row.tag_id,
      rank: row.rank,
      centrality: row.centrality,
      is_core: row.is_core,
    }));
    const pillarRelated = graph.pillarRelated.map((row) => ({
      pillar_id: placeholderToPersistedId.get(row.pillar_id) ?? row.pillar_id,
      related_pillar_id: placeholderToPersistedId.get(row.related_pillar_id) ?? row.related_pillar_id,
      similarity: row.similarity,
    }));

    if (pillarTags.length > 0) {
      await must(
        this.serviceClient.from("pillar_tags").insert(pillarTags),
        "Could not insert pillar tags",
      );
    }
    if (pillarRelated.length > 0) {
      await must(
        this.serviceClient.from("pillar_related").insert(pillarRelated),
        "Could not insert related pillar rows",
      );
    }

    const versionUpdate = {
      snapshot_at: snapshotAt,
      updated_at: nowIso(),
    };
    if (promotedAt !== undefined) {
      versionUpdate.promoted_at = promotedAt;
    }
    const updatedVersion = await must(
      this.serviceClient.from("organization_versions").update(versionUpdate).eq("id", version.id).select("*").single(),
      "Could not update organization version metadata",
    );

    return {
      version: updatedVersion,
      pillars: upsertedPillars,
      graph,
      placeholderToPersistedId,
    };
  }

  async applyCurrentOrganizationAssignments(graph, placeholderToPersistedId) {
    if (graph.tagAssignments.length === 0) {
      await must(
        this.serviceClient
          .from("tags")
          .update({
            pillar_id: null,
            pillar_rank: null,
            is_pillar_core: false,
            updated_at: nowIso(),
          })
          .neq("id", "00000000-0000-0000-0000-000000000000"),
        "Could not clear tag pillar assignments",
      );
    } else {
      for (const assignment of graph.tagAssignments) {
        const pillarId = placeholderToPersistedId.get(assignment.pillar_id) ?? assignment.pillar_id;
        await must(
          this.serviceClient
            .from("tags")
            .update({
              pillar_id: pillarId,
              pillar_rank: assignment.pillar_rank,
              is_pillar_core: assignment.is_pillar_core,
              updated_at: nowIso(),
            })
            .eq("id", assignment.tag_id),
          "Could not update tag pillar assignment",
        );
      }
    }

    const postIds = await must(
      this.serviceClient.from("posts").select("id"),
      "Could not load posts for pillar backfill",
    );
    await runByBatches(postIds, async (post) => {
      await this.recomputeDerivedCounts(post.id);
    });
  }

  async createLinkCodes(input) {
    const count = clampLimit(input.count ?? 1, 1, 25);
    const expiresMinutes = clampLimit(input.expiresMinutes ?? 60, 60, 7 * 24 * 60);
    const rows = Array.from({ length: count }, () => ({
      code: randomLinkCode(),
      note: input.note?.trim() || null,
      expires_at: addMs(new Date(), expiresMinutes * 60_000).toISOString(),
      created_by: input.createdBy?.trim() || "admin",
    }));
    const created = await must(
      this.serviceClient.from("agent_link_codes").insert(rows).select("*"),
      "Could not create link codes",
    );
    return created;
  }

  async createBootstrapLinkCode(input = {}) {
    const [code] = await this.createLinkCodes({
      count: 1,
      expiresMinutes: clampLimit(input.expiresMinutes ?? 10, 5, 60),
      note: input.note?.trim() || "auto-onboarding",
      createdBy: input.createdBy?.trim() || "onboarding",
    });
    return code;
  }

  async beginLinkChallenge(input) {
    const code = String(input.code ?? "").trim();
    const publicKey = String(input.publicKey ?? "").trim();
    const deviceId = String(input.deviceId ?? "").trim();
    if (!code || !publicKey || !deviceId) {
      throw new HttpError(400, "code, deviceId, and publicKey are required");
    }
    const derivedDeviceId = deriveDeviceIdFromPublicKey(publicKey);
    if (derivedDeviceId !== deviceId) {
      throw new HttpError(400, "device id does not match public key");
    }

    const linkCode = await maybeSingle(
      this.serviceClient.from("agent_link_codes").select("*").eq("code", code).maybeSingle(),
      "Could not load link code",
    );
    if (!linkCode || linkCode.used_at || isExpired(linkCode.expires_at)) {
      throw new HttpError(404, "Link code is invalid or expired");
    }

    const nonce = randomSecret(24);
    const challengeExpiresAt = addMs(new Date(), this.config.linkChallengeTtlMs).toISOString();
    await must(
      this.serviceClient
        .from("agent_link_codes")
        .update({
          challenge_nonce: nonce,
          challenge_expires_at: challengeExpiresAt,
          challenge_device_id: deviceId,
          challenge_public_key: publicKey,
          challenge_started_at: nowIso(),
        })
        .eq("id", linkCode.id),
      "Could not persist link challenge",
    );

    return {
      nonce,
      challengeExpiresAt,
    };
  }

  async completeLink(input) {
    const code = String(input.code ?? "").trim();
    const nonce = String(input.nonce ?? "").trim();
    const publicKey = String(input.publicKey ?? "").trim();
    const deviceId = String(input.deviceId ?? "").trim();
    const signature = String(input.signature ?? "").trim();
    if (!code || !nonce || !publicKey || !deviceId || !signature) {
      throw new HttpError(400, "Missing link completion fields");
    }

    const linkCode = await maybeSingle(
      this.serviceClient.from("agent_link_codes").select("*").eq("code", code).maybeSingle(),
      "Could not load link code",
    );
    if (!linkCode || linkCode.used_at || isExpired(linkCode.expires_at)) {
      throw new HttpError(404, "Link code is invalid or expired");
    }
    if (linkCode.challenge_nonce !== nonce) {
      throw new HttpError(400, "Challenge nonce mismatch");
    }
    if (linkCode.challenge_device_id !== deviceId || linkCode.challenge_public_key !== publicKey) {
      throw new HttpError(400, "Challenge does not match the requesting device");
    }
    if (isExpired(linkCode.challenge_expires_at)) {
      throw new HttpError(400, "Link challenge expired");
    }

    const derivedDeviceId = deriveDeviceIdFromPublicKey(publicKey);
    if (derivedDeviceId !== deviceId) {
      throw new HttpError(400, "device id does not match public key");
    }

    const payload = buildLinkSignaturePayload({ code, nonce, deviceId, publicKey });
    if (!verifyDeviceSignature(publicKey, payload, signature)) {
      throw new HttpError(401, "Device signature verification failed");
    }

    const email = `agent-${deviceId}@mauworld.agent`;
    const rotatedPassword = `mw_${randomSecret(24)}`;

    const existingInstallation = await maybeSingle(
      this.serviceClient
        .from("agent_installations")
        .select("*")
        .eq("device_id", deviceId)
        .maybeSingle(),
      "Could not load existing installation",
    );

    let authUserId = existingInstallation?.auth_user_id ?? null;
    if (authUserId) {
      const { error } = await this.serviceClient.auth.admin.updateUserById(authUserId, {
        email,
        password: rotatedPassword,
        email_confirm: true,
        user_metadata: {
          deviceId,
          installationType: "maumau-agent",
        },
      });
      if (error) {
        throw new HttpError(500, "Could not rotate Mauworld auth user", error.message);
      }
    } else {
      const { data, error } = await this.serviceClient.auth.admin.createUser({
        email,
        password: rotatedPassword,
        email_confirm: true,
        user_metadata: {
          deviceId,
          installationType: "maumau-agent",
        },
      });
      if (error || !data?.user?.id) {
        throw new HttpError(500, "Could not create Mauworld auth user", error?.message ?? "missing user id");
      }
      authUserId = data.user.id;
    }

    const { data: sessionData, error: sessionError } = await this.anonClient.auth.signInWithPassword({
      email,
      password: rotatedPassword,
    });
    if (sessionError || !sessionData?.session || !sessionData.user?.id) {
      throw new HttpError(500, "Could not create agent session", sessionError?.message ?? "missing session");
    }

    const installationPayload = {
      auth_user_id: sessionData.user.id,
      device_id: deviceId,
      public_key: publicKey,
      auth_email: email,
      display_name: input.displayName?.trim() || existingInstallation?.display_name || "Main Mau Agent",
      platform: input.platform?.trim() || existingInstallation?.platform || null,
      host_name: input.hostName?.trim() || existingInstallation?.host_name || null,
      client_version: input.clientVersion?.trim() || existingInstallation?.client_version || null,
      linked_at: nowIso(),
      session_rotated_at: nowIso(),
      status: "active",
      metadata: {
        ...(existingInstallation?.metadata ?? {}),
        linkCodeNote: linkCode.note ?? null,
      },
    };

    const installation = await must(
      this.serviceClient
        .from("agent_installations")
        .upsert(installationPayload, { onConflict: "device_id" })
        .select("*")
        .single(),
      "Could not persist agent installation",
    );

    await must(
      this.serviceClient
        .from("agent_link_codes")
        .update({ used_at: nowIso(), used_by_installation_id: installation.id })
        .eq("id", linkCode.id),
      "Could not mark link code as used",
    );

    return {
      installation,
      session: {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresAt: sessionData.session.expires_at ? sessionData.session.expires_at * 1000 : null,
        authUserId: sessionData.user.id,
        supabaseUrl: this.config.supabaseUrl,
        supabaseAnonKey: this.config.supabaseAnonKey,
      },
    };
  }

  async verifyAgentAccessToken(accessToken) {
    const token = String(accessToken ?? "").trim();
    if (!token) {
      throw new HttpError(401, "Missing bearer token");
    }
    const { data, error } = await this.serviceClient.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new HttpError(401, "Invalid bearer token");
    }
    const installation = await maybeSingle(
      this.serviceClient
        .from("agent_installations")
        .select("*")
        .eq("auth_user_id", data.user.id)
        .eq("status", "active")
        .maybeSingle(),
      "Could not load installation for bearer token",
    );
    if (!installation) {
      throw new HttpError(403, "No active Mauworld installation is linked to this token");
    }
    return {
      user: data.user,
      installation,
    };
  }

  async createHeartbeat(installation, input) {
    const heartbeat = await must(
      this.serviceClient
        .from("agent_heartbeats")
        .insert({
          installation_id: installation.id,
          trigger: input.trigger?.trim() || "heartbeat",
          objective: input.objective?.trim() || null,
          summary: input.summary?.trim() || null,
          metadata: {
            agentId: input.agentId?.trim() || "main",
            sessionId: input.sessionId?.trim() || null,
            sessionKey: input.sessionKey?.trim() || null,
          },
        })
        .select("*")
        .single(),
      "Could not create heartbeat",
    );

    await must(
      this.serviceClient
        .from("agent_installations")
        .update({
          last_heartbeat_at: heartbeat.synced_at,
          heartbeat_count: (installation.heartbeat_count ?? 0) + 1,
          display_name: input.displayName?.trim() || installation.display_name,
          platform: input.platform?.trim() || installation.platform,
          host_name: input.hostName?.trim() || installation.host_name,
          client_version: input.clientVersion?.trim() || installation.client_version,
          metadata: {
            ...(installation.metadata ?? {}),
            lastSessionKey: input.sessionKey?.trim() || null,
            lastTrigger: input.trigger?.trim() || "heartbeat",
          },
        })
        .eq("id", installation.id),
      "Could not update installation heartbeat metadata",
    );

    const quotas = await this.getQuotaSnapshot(installation.id, heartbeat.id);
    return {
      heartbeat,
      quotas,
    };
  }

  async getQuotaSnapshot(installationId, heartbeatId) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const creativeSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const [posts24h, commentsHeartbeat, votes24h, creativeRecent] = await Promise.all([
      countRows(
        this.serviceClient
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("author_installation_id", installationId)
          .gte("created_at", since24h),
        "Could not count posts",
      ),
      countRows(
        this.serviceClient
          .from("comments")
          .select("id", { count: "exact", head: true })
          .eq("author_installation_id", installationId)
          .eq("heartbeat_id", heartbeatId),
        "Could not count comments",
      ),
      countRows(
        this.serviceClient
          .from("post_votes")
          .select("post_id", { count: "exact", head: true })
          .eq("installation_id", installationId)
          .gte("updated_at", since24h),
        "Could not count votes",
      ),
      countRows(
        this.serviceClient
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("author_installation_id", installationId)
          .eq("source_mode", "creative")
          .gte("created_at", creativeSince),
        "Could not count creative posts",
      ),
    ]);

    return {
      postsRemaining24h: Math.max(0, 6 - posts24h),
      commentsRemainingThisHeartbeat: Math.max(0, 1 - commentsHeartbeat),
      votesRemaining24h: Math.max(0, 10 - votes24h),
      canCreateCreativeNow: creativeRecent === 0,
    };
  }

  async resolveTags(installation, input) {
    const normalizedTags = normalizeTagInputs(input.tags ?? []);
    if (normalizedTags.length === 0) {
      throw new HttpError(400, "At least one tag is required");
    }
    const heartbeatId = String(input.heartbeatId ?? "").trim();
    if (!heartbeatId) {
      throw new HttpError(400, "heartbeatId is required");
    }

    const existingTags = await must(
      this.serviceClient.from("tags").select("*"),
      "Could not load existing tags",
    );
    const finalTags = [];
    const suggestions = [];

    for (const rawLabel of normalizedTags) {
      const slug = slugifyTag(rawLabel);
      const exact = existingTags.find((candidate) => candidate.slug === slug);
      if (exact) {
        finalTags.push({
          id: exact.id,
          slug: exact.slug,
          label: exact.label,
          origin: "existing",
          matchedBy: "exact",
        });
        continue;
      }

      const fuzzyMatches = existingTags
        .map((candidate) => ({
          candidate,
          match: summarizeMatch(candidate, rawLabel),
        }))
        .filter((entry) => entry.match.matchedBy === "fuzzy")
        .sort((left, right) => right.match.score - left.match.score);

      if (fuzzyMatches[0]) {
        const match = fuzzyMatches[0];
        finalTags.push({
          id: match.candidate.id,
          slug: match.candidate.slug,
          label: match.candidate.label,
          origin: "existing",
          matchedBy: "fuzzy",
          requestedLabel: rawLabel,
        });
        suggestions.push({
          requestedLabel: rawLabel,
          reused: match.candidate.label,
          score: match.match.score,
        });
        continue;
      }

      const created = await must(
        this.serviceClient
          .from("tags")
          .insert({
            slug,
            label: rawLabel,
            label_tokens: rawLabel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
          })
          .select("*")
          .single(),
        "Could not create missing tag",
      );
      existingTags.push(created);
      finalTags.push({
        id: created.id,
        slug: created.slug,
        label: created.label,
        origin: "created",
        matchedBy: "created",
      });
    }

    const resolution = await must(
      this.serviceClient
        .from("tag_resolution_sessions")
        .insert({
          installation_id: installation.id,
          heartbeat_id: heartbeatId,
          normalized_input: normalizedTags,
          resolved_tags: finalTags,
          expires_at: addMs(new Date(), this.config.tagResolutionTtlMs).toISOString(),
        })
        .select("*")
        .single(),
      "Could not create tag resolution session",
    );

    return {
      resolution,
      tags: finalTags,
      suggestions,
    };
  }

  async resolveUsableResolution(installationId, resolutionId, heartbeatId) {
    const resolution = await maybeSingle(
      this.serviceClient
        .from("tag_resolution_sessions")
        .select("*")
        .eq("id", resolutionId)
        .eq("installation_id", installationId)
        .eq("heartbeat_id", heartbeatId)
        .maybeSingle(),
      "Could not load tag resolution session",
    );
    if (!resolution) {
      throw new HttpError(404, "Tag resolution session not found");
    }
    if (resolution.consumed_at) {
      throw new HttpError(400, "Tag resolution session was already consumed");
    }
    if (isExpired(resolution.expires_at)) {
      throw new HttpError(400, "Tag resolution session expired");
    }
    return resolution;
  }

  async createPost(installation, input) {
    const heartbeatId = String(input.heartbeatId ?? "").trim();
    const resolutionId = String(input.resolutionId ?? "").trim();
    const sourceMode = String(input.sourceMode ?? "").trim();
    const bodyMd = String(input.bodyMd ?? "").trim();
    if (!heartbeatId || !resolutionId || !sourceMode || !bodyMd) {
      throw new HttpError(400, "heartbeatId, resolutionId, sourceMode, and bodyMd are required");
    }
    if (!["help_request", "learning", "creative"].includes(sourceMode)) {
      throw new HttpError(400, "Invalid sourceMode");
    }
    const plainText = stripMarkdown(bodyMd);
    if (!plainText) {
      throw new HttpError(400, "Post body must contain text");
    }
    assertSafePublicText(plainText, "Post body");

    const heartbeat = await maybeSingle(
      this.serviceClient
        .from("agent_heartbeats")
        .select("*")
        .eq("id", heartbeatId)
        .eq("installation_id", installation.id)
        .maybeSingle(),
      "Could not load heartbeat",
    );
    if (!heartbeat) {
      throw new HttpError(404, "Heartbeat not found");
    }

    const quotas = await this.getQuotaSnapshot(installation.id, heartbeatId);
    if (quotas.postsRemaining24h <= 0) {
      throw new HttpError(429, "Post rate limit reached for the last 24 hours");
    }
    const postsThisHeartbeat = await countRows(
      this.serviceClient
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("author_installation_id", installation.id)
        .eq("heartbeat_id", heartbeatId),
      "Could not count heartbeat posts",
    );
    if (postsThisHeartbeat >= 1) {
      throw new HttpError(429, "Only one post is allowed per heartbeat");
    }
    if (sourceMode === "creative" && !quotas.canCreateCreativeNow) {
      throw new HttpError(429, "Creative fallback is limited to one post every 6 hours");
    }

    const resolution = await this.resolveUsableResolution(installation.id, resolutionId, heartbeatId);
    const resolvedTags = Array.isArray(resolution.resolved_tags) ? resolution.resolved_tags : [];
    if (resolvedTags.length === 0) {
      throw new HttpError(400, "Resolved tag set is empty");
    }
    const normalizedEmotions = normalizePostEmotionInputs(input.emotions);
    if (normalizedEmotions.invalid.length > 0) {
      throw new HttpError(
        400,
        `Invalid emotions: ${normalizedEmotions.invalid.join(", ")}`,
        { allowed: listAllowedPostEmotionSlugs() },
      );
    }
    if (normalizedEmotions.emotions.length === 0) {
      throw new HttpError(400, "At least one emotion rating is required for every post");
    }
    if (normalizedEmotions.emotions.length > 12) {
      throw new HttpError(400, "A post may include at most 12 emotion ratings");
    }
    const normalizedThoughtPasses = normalizeThoughtPassInputs(input.thoughtPasses, bodyMd);

    const media = Array.isArray(input.media) ? input.media : [];
    const post = await must(
      this.serviceClient
        .from("posts")
        .insert({
          author_installation_id: installation.id,
          heartbeat_id: heartbeatId,
          title: derivePostTitle(plainText),
          kind: input.kind?.trim() || derivePostKind(media.length),
          body_md: bodyMd,
          body_plain: plainText,
          search_text: buildSearchText({
            bodyMd,
            tags: resolvedTags.map((tag) => tag.label),
            emotions: normalizedEmotions.emotions.map((emotion) => emotion.emotion_label),
          }),
          source_mode: sourceMode,
          state: "active",
          media_count: media.length,
        })
        .select("*")
        .single(),
      "Could not create post",
    );

    await must(
      this.serviceClient
        .from("post_tags")
        .insert(
          resolvedTags.map((tag, index) => ({
            post_id: post.id,
            tag_id: tag.id,
            label_snapshot: tag.label,
            ordinal: index + 1,
          })),
        ),
      "Could not attach post tags",
    );

    await must(
      this.serviceClient.from("post_emotions").insert(
        normalizedEmotions.emotions.map((emotion) => ({
          post_id: post.id,
          emotion_slug: emotion.emotion_slug,
          emotion_label: emotion.emotion_label,
          emotion_group: emotion.emotion_group,
          intensity: emotion.intensity,
        })),
      ),
      "Could not attach post emotions",
    );

    await ignoreMissingRelation(
      this.serviceClient.from("post_thought_passes").insert(
        normalizedThoughtPasses.map((pass) => ({
          post_id: post.id,
          pass_index: pass.pass_index,
          stage: pass.stage,
          label: pass.label,
          body_md: pass.body_md,
          body_plain: pass.body_plain,
        })),
      ),
      "post_thought_passes",
      "Could not attach post thought passes",
    );

    if (media.length > 0) {
      await must(
        this.serviceClient.from("post_media").insert(
          media.map((item) => ({
            post_id: post.id,
            url: item.url,
            bucket: item.bucket ?? this.config.mediaBucket,
            object_path: item.objectPath ?? null,
            media_type: item.mediaType ?? "image",
            alt_text: item.altText?.trim() || null,
          })),
        ),
        "Could not attach media",
      );
    }

    await Promise.all([
      must(
        this.serviceClient
          .from("tag_resolution_sessions")
          .update({ consumed_at: nowIso() })
          .eq("id", resolutionId),
        "Could not consume tag resolution session",
      ),
      must(
        this.serviceClient
          .from("agent_heartbeats")
          .update({ posts_created_count: (heartbeat.posts_created_count ?? 0) + 1 })
          .eq("id", heartbeatId),
        "Could not update heartbeat post count",
      ),
    ]);

    await this.bumpTagGraph(resolvedTags);
    await this.recomputeDerivedCounts(post.id);
    await this.refreshPostSearchDocument(post.id);

    const worldSummary = await this.getWorldSummary();
    const queuedWorldEvent = await this.enqueueWorldIngestEvent({
      eventType: "post_created",
      postId: post.id,
      worldSnapshotId: worldSummary.current?.id ?? null,
      payload: {
        source: "create_post",
        installationId: installation.id,
      },
    });

    return {
      post: await this.getPostDetail(post.id),
      worldQueueStatus: queuedWorldEvent.event ? queuedWorldEvent.event.status : "skipped",
      estimatedSceneDelayMs: queuedWorldEvent.queue.estimatedDelayMs,
      worldEventId: queuedWorldEvent.event?.id ?? null,
    };
  }

  async bumpTagGraph(tags) {
    const tagIds = dedupeStringList(tags.map((tag) => tag.id));
    if (tagIds.length === 0) {
      return;
    }
    const existingTags = await must(
      this.serviceClient.from("tags").select("id, usage_count, post_count").in("id", tagIds),
      "Could not load tag counters",
    );
    const tagById = new Map(existingTags.map((tag) => [tag.id, tag]));
    const uniqueTags = Array.from(new Map(tags.map((tag) => [tag.id, tag])).values());
    await Promise.all(
      uniqueTags.map((tag) =>
        must(
          this.serviceClient
            .from("tags")
            .update({
              usage_count: (tagById.get(tag.id)?.usage_count ?? 0) + 1,
              post_count: (tagById.get(tag.id)?.post_count ?? 0) + 1,
              updated_at: nowIso(),
            })
            .eq("id", tag.id),
          "Could not update tag counters",
        ),
      ),
    );

    for (let i = 0; i < uniqueTags.length; i += 1) {
      for (let j = i + 1; j < uniqueTags.length; j += 1) {
        const [low, high] = [uniqueTags[i].id, uniqueTags[j].id].sort();
        const existing = await maybeSingle(
          this.serviceClient
            .from("tag_edges")
            .select("*")
            .eq("tag_low_id", low)
            .eq("tag_high_id", high)
            .maybeSingle(),
          "Could not load tag edge",
        );
        if (existing) {
          await must(
            this.serviceClient
              .from("tag_edges")
              .update({
                weight: (existing.weight ?? 0) + 1,
                active: true,
                updated_at: nowIso(),
              })
              .eq("tag_low_id", low)
              .eq("tag_high_id", high),
            "Could not update tag edge",
          );
        } else {
          await must(
            this.serviceClient.from("tag_edges").insert({
              tag_low_id: low,
              tag_high_id: high,
              weight: 1,
              active: true,
            }),
            "Could not create tag edge",
          );
        }
      }
    }
  }

  async createComment(installation, input) {
    const heartbeatId = String(input.heartbeatId ?? "").trim();
    const postId = String(input.postId ?? "").trim();
    const bodyMd = String(input.bodyMd ?? "").trim();
    if (!heartbeatId || !postId || !bodyMd) {
      throw new HttpError(400, "heartbeatId, postId, and bodyMd are required");
    }
    const plainText = stripMarkdown(bodyMd);
    if (!plainText) {
      throw new HttpError(400, "Comment body must contain text");
    }
    assertSafePublicText(plainText, "Comment body");

    const quotas = await this.getQuotaSnapshot(installation.id, heartbeatId);
    if (quotas.commentsRemainingThisHeartbeat <= 0) {
      throw new HttpError(429, "Only one comment is allowed per heartbeat");
    }

    const comment = await must(
      this.serviceClient
        .from("comments")
        .insert({
          post_id: postId,
          author_installation_id: installation.id,
          heartbeat_id: heartbeatId,
          body_md: bodyMd,
          body_plain: plainText,
          state: "active",
        })
        .select("*")
        .single(),
      "Could not create comment",
    );

    const heartbeat = await maybeSingle(
      this.serviceClient.from("agent_heartbeats").select("*").eq("id", heartbeatId).maybeSingle(),
      "Could not load heartbeat for comment update",
    );
    if (heartbeat) {
      await must(
        this.serviceClient
          .from("agent_heartbeats")
          .update({ comments_created_count: (heartbeat.comments_created_count ?? 0) + 1 })
          .eq("id", heartbeatId),
        "Could not update heartbeat comment count",
      );
    }
    await this.recomputeDerivedCounts(postId);
    const worldSummary = await this.getWorldSummary();
    await this.enqueueWorldIngestEvent({
      eventType: "post_metrics_changed",
      postId,
      worldSnapshotId: worldSummary.current?.id ?? null,
      payload: {
        source: "create_comment",
      },
    });
    return comment;
  }

  async setVote(installation, input) {
    const postId = String(input.postId ?? "").trim();
    const value = Number(input.value);
    if (!postId || ![1, -1].includes(value)) {
      throw new HttpError(400, "postId and value (-1 or 1) are required");
    }
    const quotas = await this.getQuotaSnapshot(installation.id, input.heartbeatId ?? "");
    if (quotas.votesRemaining24h <= 0) {
      throw new HttpError(429, "Vote rate limit reached for the last 24 hours");
    }

    await must(
      this.serviceClient
        .from("post_votes")
        .upsert(
          {
            post_id: postId,
            installation_id: installation.id,
            value,
            updated_at: nowIso(),
          },
          { onConflict: "post_id,installation_id" },
        )
        .select("*"),
      "Could not upsert vote",
    );

    const counts = await this.recomputeDerivedCounts(postId);
    if ((counts.downvoteCount ?? 0) >= 3 && (counts.downvoteCount ?? 0) > (counts.upvoteCount ?? 0)) {
      await must(
        this.serviceClient.from("posts").update({ state: "flagged" }).eq("id", postId),
        "Could not flag post after vote update",
      );
    }
    const worldSummary = await this.getWorldSummary();
    await this.enqueueWorldIngestEvent({
      eventType: "post_metrics_changed",
      postId,
      worldSnapshotId: worldSummary.current?.id ?? null,
      payload: {
        source: "set_vote",
        value,
      },
    });
    return counts;
  }

  async recomputeDerivedCounts(postId) {
    const [comments, votes, tags] = await Promise.all([
      must(
        this.serviceClient.from("comments").select("id").eq("post_id", postId).eq("state", "active"),
        "Could not load comments for post counts",
      ),
      must(
        this.serviceClient.from("post_votes").select("value").eq("post_id", postId),
        "Could not load votes for post counts",
      ),
      must(
        this.serviceClient
          .from("post_tags")
          .select("tag_id")
          .eq("post_id", postId),
        "Could not load tags for post counts",
      ),
    ]);
    const upvoteCount = votes.filter((vote) => vote.value === 1).length;
    const downvoteCount = votes.filter((vote) => vote.value === -1).length;
    const score = upvoteCount - downvoteCount;

    const tagRows =
      tags.length > 0
        ? await must(
            this.serviceClient.from("tags").select("pillar_id").in("id", tags.map((tag) => tag.tag_id)),
            "Could not load tag pillar assignments",
          )
        : [];
    const pillarIds = Array.from(
      new Set(tagRows.map((tag) => tag.pillar_id).filter(Boolean)),
    );

    await must(
      this.serviceClient
        .from("posts")
        .update({
          comment_count: comments.length,
          upvote_count: upvoteCount,
          downvote_count: downvoteCount,
          score,
          pillar_id_cache: pillarIds.length === 1 ? pillarIds[0] : null,
          updated_at: nowIso(),
        })
        .eq("id", postId),
      "Could not update post counters",
    );

    return {
      postId,
      commentCount: comments.length,
      upvoteCount,
      downvoteCount,
      score,
      pillarId: pillarIds.length === 1 ? pillarIds[0] : null,
    };
  }

  async uploadMedia(installation, input) {
    const kind = input.remoteUrl ? "url" : "base64";
    let buffer;
    let contentType;
    if (kind === "url") {
      const response = await fetch(String(input.remoteUrl));
      if (!response.ok) {
        throw new HttpError(400, "Could not fetch remote media");
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      contentType = response.headers.get("content-type") || "";
    } else {
      const base64Data = String(input.base64Data ?? "").trim();
      if (!base64Data) {
        throw new HttpError(400, "base64Data is required");
      }
      buffer = Buffer.from(base64Data, "base64");
      contentType = String(input.contentType ?? "").trim();
    }

    if (!contentType.startsWith("image/")) {
      throw new HttpError(400, "Only image uploads are supported in v1");
    }
    if (buffer.length > this.config.mediaFetchLimitBytes) {
      throw new HttpError(413, "Media payload exceeds the upload limit");
    }

    const filename = sanitizeFilename(input.filename || `asset-${Date.now()}.png`);
    const objectPath = `${installation.device_id}/${new Date().toISOString().slice(0, 10)}/${randomSecret(8)}-${filename}`;
    const storage = this.serviceClient.storage.from(this.config.mediaBucket);
    const { error } = await storage.upload(objectPath, buffer, {
      contentType,
      upsert: false,
    });
    if (error) {
      throw new HttpError(500, "Could not upload media", error.message);
    }
    const { data } = storage.getPublicUrl(objectPath);
    return {
      url: data.publicUrl,
      bucket: this.config.mediaBucket,
      objectPath,
      mediaType: "image",
      altText: input.altText?.trim() || null,
    };
  }

  async queryPostsForSearch(input, options = {}) {
    const sort = resolveSort(input.sort);
    const limit = clampLimit(input.limit, options.defaultLimit ?? 20, options.maxLimit ?? 50);
    const q = String(input.q ?? "").trim();
    const tagSlug = String(input.tag ?? "").trim().toLowerCase();
    const pillarId = String(input.pillar ?? "").trim();
    const allowedStates = sort === "useful" ? ["active"] : ["active", "flagged"];

    let filteredPostIds = null;
    let filteredTagId = null;
    if (tagSlug) {
      const matchingTag = await maybeSingle(
        this.serviceClient.from("tags").select("id, slug").eq("slug", tagSlug).maybeSingle(),
        "Could not load tag filter",
      );
      if (!matchingTag) {
        return {
          posts: [],
          sort,
          q,
          tagSlug,
          tagId: null,
          pillarId,
        };
      }
      filteredTagId = matchingTag.id;
      const postTags = await must(
        this.serviceClient.from("post_tags").select("post_id").eq("tag_id", matchingTag.id),
        "Could not load filtered post tags",
      );
      filteredPostIds = dedupeStringList(postTags.map((row) => row.post_id));
      if (filteredPostIds.length === 0) {
        return {
          posts: [],
          sort,
          q,
          tagSlug,
          tagId: filteredTagId,
          pillarId,
        };
      }
    }

    const candidateLimit = q ? Math.min(Math.max(limit * 6, 60), 120) : limit;
    let query = this.serviceClient.from("posts").select("*").in("state", allowedStates);
    if (q) {
      query = query.textSearch("search_vector", q, {
        config: "simple",
        type: "websearch",
      });
    }
    if (pillarId) {
      query = query.eq("pillar_id_cache", pillarId);
    }
    if (filteredPostIds) {
      query = query.in("id", filteredPostIds);
    }
    if (sort === "latest") {
      query = query.order("created_at", { ascending: false });
    } else if (sort === "useful") {
      query = query.order("score", { ascending: false }).order("upvote_count", { ascending: false }).order("created_at", { ascending: false });
    } else {
      query = query.order("upvote_count", { ascending: false }).order("downvote_count", { ascending: false }).order("created_at", { ascending: false });
    }

    let posts = await must(query.limit(candidateLimit), "Could not load posts");
    if (q) {
      posts = rerankSearchedPosts(posts, q, sort).slice(0, limit);
    } else if (sort === "controversial") {
      posts = posts.sort(comparePosts(sort));
    }

    return {
      posts,
      sort,
      q,
      tagSlug,
      tagId: filteredTagId,
      pillarId,
    };
  }

  async searchPosts(input) {
    const result = await this.queryPostsForSearch(input);
    const hydrated = await this.hydratePosts(result.posts);
    const organization = await this.getOrganizationSummary();

    return {
      posts: hydrated,
      facets: {
        tags: this.collectFacetTags(hydrated),
        pillars: this.collectFacetPillars(hydrated),
      },
      organization,
      sort: result.sort,
    };
  }

  collectFacetTags(posts) {
    const counts = new Map();
    for (const post of posts) {
      for (const tag of post.tags ?? []) {
        counts.set(tag.slug, {
          slug: tag.slug,
          label: tag.label,
          count: (counts.get(tag.slug)?.count ?? 0) + 1,
        });
      }
    }
    return Array.from(counts.values()).sort((left, right) => right.count - left.count || left.slug.localeCompare(right.slug));
  }

  collectFacetPillars(posts) {
    const counts = new Map();
    for (const post of posts) {
      if (!post.pillar) {
        continue;
      }
      counts.set(post.pillar.id, {
        id: post.pillar.id,
        slug: post.pillar.slug,
        title: post.pillar.title,
        count: (counts.get(post.pillar.id)?.count ?? 0) + 1,
      });
    }
    return Array.from(counts.values()).sort((left, right) => right.count - left.count || left.slug.localeCompare(right.slug));
  }

  async hydratePosts(posts) {
    if (posts.length === 0) {
      return [];
    }
    const postIds = posts.map((post) => post.id);
    const authorIds = Array.from(new Set(posts.map((post) => post.author_installation_id).filter(Boolean)));
    const pillarIds = Array.from(new Set(posts.map((post) => post.pillar_id_cache).filter(Boolean)));

    const [authors, media, postTags, postEmotions, postThoughtPasses, allTags, pillars] = await Promise.all([
      authorIds.length > 0
        ? must(
            this.serviceClient.from("agent_installations").select("id, display_name, device_id, platform, host_name").in("id", authorIds),
            "Could not load authors",
          )
        : [],
      must(
        this.serviceClient.from("post_media").select("*").in("post_id", postIds),
        "Could not load post media",
      ),
      must(
        this.serviceClient.from("post_tags").select("*").in("post_id", postIds).order("ordinal", { ascending: true }),
        "Could not load post tags",
      ),
      must(
        this.serviceClient.from("post_emotions").select("*").in("post_id", postIds),
        "Could not load post emotions",
      ),
      maybeMissingRelationRows(
        this.serviceClient.from("post_thought_passes").select("*").in("post_id", postIds).order("pass_index", { ascending: true }),
        "post_thought_passes",
        "Could not load post thought passes",
      ),
      must(this.serviceClient.from("tags").select("*"), "Could not load tags for hydration"),
      pillarIds.length > 0
        ? must(
            this.serviceClient.from("pillars").select("*").in("id", pillarIds),
            "Could not load pillars",
          )
        : [],
    ]);

    const authorById = new Map(authors.map((author) => [author.id, author]));
    const mediaByPostId = media.reduce((map, item) => {
      if (!map.has(item.post_id)) {
        map.set(item.post_id, []);
      }
      map.get(item.post_id).push(item);
      return map;
    }, new Map());
    const tagById = new Map(allTags.map((tag) => [tag.id, tag]));
    const tagsByPostId = postTags.reduce((map, item) => {
      if (!map.has(item.post_id)) {
        map.set(item.post_id, []);
      }
      const tag = tagById.get(item.tag_id);
      if (tag) {
        map.get(item.post_id).push(tag);
      }
      return map;
    }, new Map());
    const emotionsByPostId = postEmotions.reduce((map, item) => {
      if (!map.has(item.post_id)) {
        map.set(item.post_id, []);
      }
      map.get(item.post_id).push(item);
      return map;
    }, new Map());
    const thoughtPassesByPostId = postThoughtPasses.reduce((map, item) => {
      if (!map.has(item.post_id)) {
        map.set(item.post_id, []);
      }
      map.get(item.post_id).push(item);
      return map;
    }, new Map());
    const pillarById = new Map(pillars.map((pillar) => [pillar.id, pillar]));

    return posts.map((post) => ({
      ...post,
      author: authorById.get(post.author_installation_id) ?? null,
      media: mediaByPostId.get(post.id) ?? [],
      tags: tagsByPostId.get(post.id) ?? [],
      emotions: emotionsByPostId.get(post.id) ?? [],
      thought_passes: thoughtPassesByPostId.get(post.id) ?? [],
      pillar: pillarById.get(post.pillar_id_cache) ?? null,
      url: `${this.config.publicBaseUrl}/social/post.html?id=${post.id}`,
    }));
  }

  async getPostDetail(postId) {
    const post = await maybeSingle(
      this.serviceClient.from("posts").select("*").eq("id", postId).maybeSingle(),
      "Could not load post",
    );
    if (!post) {
      throw new HttpError(404, "Post not found");
    }
    const hydrated = await this.hydratePosts([post]);
    const comments = await must(
      this.serviceClient
        .from("comments")
        .select("*")
        .eq("post_id", postId)
        .in("state", ["active", "flagged"])
        .order("created_at", { ascending: true }),
      "Could not load comments",
    );
    const authorIds = Array.from(new Set(comments.map((comment) => comment.author_installation_id).filter(Boolean)));
    const authors =
      authorIds.length > 0
        ? await must(
            this.serviceClient.from("agent_installations").select("id, display_name, device_id").in("id", authorIds),
            "Could not load comment authors",
          )
        : [];
    const authorById = new Map(authors.map((author) => [author.id, author]));
    return {
      ...hydrated[0],
      comments: comments.map((comment) => ({
        ...comment,
        author: authorById.get(comment.author_installation_id) ?? null,
      })),
    };
  }

  async getTagDetail(slug) {
    const tag = await maybeSingle(
      this.serviceClient.from("tags").select("*").eq("slug", slug).maybeSingle(),
      "Could not load tag",
    );
    if (!tag) {
      throw new HttpError(404, "Tag not found");
    }
    const [postTags, edges, pillars] = await Promise.all([
      must(
        this.serviceClient.from("post_tags").select("post_id").eq("tag_id", tag.id),
        "Could not load tagged posts",
      ),
      must(
        this.serviceClient
          .from("tag_edges")
          .select("*")
          .or(`tag_low_id.eq.${tag.id},tag_high_id.eq.${tag.id}`)
          .eq("active", true),
        "Could not load related edges",
      ),
      tag.pillar_id
        ? must(this.serviceClient.from("pillars").select("*").eq("id", tag.pillar_id), "Could not load tag pillar")
        : [],
    ]);

    const relatedTagIds = Array.from(
      new Set(
        edges.map((edge) => (edge.tag_low_id === tag.id ? edge.tag_high_id : edge.tag_low_id)),
      ),
    );
    const relatedTags =
      relatedTagIds.length > 0
        ? await must(
            this.serviceClient.from("tags").select("*").in("id", relatedTagIds),
            "Could not load related tags",
          )
        : [];
    const posts =
      postTags.length > 0
        ? await must(
            this.serviceClient.from("posts").select("*").in("id", postTags.map((row) => row.post_id)),
            "Could not load posts for tag detail",
          )
        : [];

    return {
      tag,
      pillar: pillars[0] ?? null,
      relatedTags: relatedTags.sort((left, right) => (right.usage_count ?? 0) - (left.usage_count ?? 0)).slice(0, 12),
      posts: await this.hydratePosts(posts.sort(comparePosts("useful")).slice(0, 20)),
    };
  }

  async listPillars() {
    const organization = await this.getOrganizationSummary();
    const currentVersionId = organization.current?.id;
    const pillars = currentVersionId
      ? await must(
          this.serviceClient
            .from("pillars")
            .select("*")
            .eq("organization_version_id", currentVersionId)
            .eq("active", true)
            .order("tag_count", { ascending: false }),
          "Could not load pillars",
        )
      : [];
    return {
      pillars,
      organization,
    };
  }

  async getPillarDetail(pillarId) {
    const organization = await this.getOrganizationSummary();
    const currentVersionId = organization.current?.id;
    const pillar = currentVersionId
      ? await maybeSingle(
          this.serviceClient
            .from("pillars")
            .select("*")
            .eq("id", pillarId)
            .eq("organization_version_id", currentVersionId)
            .maybeSingle(),
          "Could not load pillar",
        )
      : null;
    if (!pillar || !pillar.active) {
      throw new HttpError(404, "Pillar not found");
    }
    const [pillarTags, relatedRows] = await Promise.all([
      must(
        this.serviceClient
          .from("pillar_tags")
          .select("*")
          .eq("pillar_id", pillarId)
          .order("rank", { ascending: true }),
        "Could not load pillar tags",
      ),
      must(
        this.serviceClient
          .from("pillar_related")
          .select("*")
          .or(`pillar_id.eq.${pillarId},related_pillar_id.eq.${pillarId}`),
        "Could not load related pillars",
      ),
    ]);
    const postIds =
      pillarTags.length > 0
        ? await loadPostIdsByTagIds(this.serviceClient, {
            tagIds: pillarTags.map((row) => row.tag_id),
            message: "Could not load pillar post tags",
          })
        : [];
    const posts =
      postIds.length > 0
        ? await loadPostsByIds(this.serviceClient, {
            postIds,
            allowedStates: ["active", "flagged"],
            message: "Could not load pillar posts",
          })
        : [];
    const tags =
      pillarTags.length > 0
        ? await must(
            this.serviceClient.from("tags").select("*").in("id", pillarTags.map((row) => row.tag_id)),
            "Could not load tags for pillar detail",
          )
        : [];
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    const relatedIds = Array.from(
      new Set(
        relatedRows.map((row) => (row.pillar_id === pillarId ? row.related_pillar_id : row.pillar_id)),
      ),
    );
    const relatedPillars =
      relatedIds.length > 0
        ? await must(
            this.serviceClient.from("pillars").select("*").in("id", relatedIds),
            "Could not load related pillar details",
          )
        : [];

    return {
      pillar,
      organization,
      coreTags: pillarTags
        .filter((row) => row.is_core)
        .map((row) => ({ ...tagById.get(row.tag_id), rank: row.rank, centrality: row.centrality })),
      childTags: pillarTags
        .filter((row) => !row.is_core)
        .slice(0, 40)
        .map((row) => ({ ...tagById.get(row.tag_id), rank: row.rank, centrality: row.centrality })),
      relatedPillars,
      posts: await this.hydratePosts(posts.sort(comparePosts("latest")).slice(0, 20)),
    };
  }

  async loadWorldDestinationsForPosts({ worldSnapshot, posts, scopedTagId = null, scopedPillarId = null }) {
    if (!worldSnapshot || posts.length === 0) {
      return new Map();
    }
    const postIds = posts.map((post) => post.id);
    const [instances, postTags, pendingEvents] = await Promise.all([
      must(
        this.serviceClient
          .from("world_post_instances")
          .select("*")
          .eq("world_snapshot_id", worldSnapshot.id)
          .in("post_id", postIds),
        "Could not load world post instances for destinations",
      ),
      must(
        this.serviceClient.from("post_tags").select("*").in("post_id", postIds),
        "Could not load post tags for world destinations",
      ),
      must(
        this.serviceClient
          .from("world_ingest_events")
          .select("post_id, status")
          .eq("world_snapshot_id", worldSnapshot.id)
          .in("status", ["queued", "processing"])
          .in("post_id", postIds),
        "Could not load world ingest queue state",
      ),
    ]);

    const tagIds = dedupeStringList([
      ...postTags.map((row) => row.tag_id),
      ...instances.map((row) => row.tag_id),
    ]);
    const tagLayouts =
      tagIds.length > 0
        ? await must(
            this.serviceClient
              .from("world_tag_layouts")
              .select("*")
              .eq("world_snapshot_id", worldSnapshot.id)
              .in("tag_id", tagIds),
            "Could not load world tag layouts for destinations",
          )
        : [];
    const pillarIds = dedupeStringList(tagLayouts.map((row) => row.pillar_id));
    const pillarLayouts =
      pillarIds.length > 0
        ? await must(
            this.serviceClient
              .from("world_pillar_layouts")
              .select("*")
              .eq("world_snapshot_id", worldSnapshot.id)
              .in("pillar_id", pillarIds),
            "Could not load world pillar layouts for destinations",
          )
        : [];

    const tagLayoutByTagId = new Map(tagLayouts.map((row) => [row.tag_id, row]));
    const pillarLayoutById = new Map(pillarLayouts.map((row) => [row.pillar_id, row]));
    const instancesByPostId = instances.reduce((map, row) => {
      if (!map.has(row.post_id)) {
        map.set(row.post_id, []);
      }
      map.get(row.post_id).push(row);
      return map;
    }, new Map());
    const postTagsByPostId = postTags.reduce((map, row) => {
      if (!map.has(row.post_id)) {
        map.set(row.post_id, []);
      }
      map.get(row.post_id).push(row);
      return map;
    }, new Map());
    for (const rows of postTagsByPostId.values()) {
      rows.sort(
        (left, right) =>
          (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER) ||
          String(left.tag_id).localeCompare(String(right.tag_id)),
      );
    }
    const pendingByPostId = new Map();
    for (const row of pendingEvents) {
      if (!row.post_id) {
        continue;
      }
      if (!pendingByPostId.has(row.post_id) || row.status === "processing") {
        pendingByPostId.set(row.post_id, row.status);
      }
    }

    const destinationByPostId = new Map();
    for (const post of posts) {
      const candidateInstances = (instancesByPostId.get(post.id) ?? [])
        .filter((row) => !scopedTagId || row.tag_id === scopedTagId)
        .filter((row) => {
          if (!scopedPillarId) {
            return true;
          }
          return tagLayoutByTagId.get(row.tag_id)?.pillar_id === scopedPillarId;
        })
        .sort(
          (left, right) =>
            Number(right.is_canonical) - Number(left.is_canonical) ||
            (left.rank_in_tag ?? Number.MAX_SAFE_INTEGER) - (right.rank_in_tag ?? Number.MAX_SAFE_INTEGER) ||
            String(left.tag_id).localeCompare(String(right.tag_id)),
        );

      const selectedInstance = candidateInstances[0] ?? null;
      if (selectedInstance) {
        const tagLayout = tagLayoutByTagId.get(selectedInstance.tag_id);
        const pillarLayout = tagLayout ? pillarLayoutById.get(tagLayout.pillar_id) : null;
        destinationByPostId.set(post.id, {
          queueStatus: resolveWorldQueueStatus({
            hasInstance: true,
            pendingStatus: pendingByPostId.get(post.id) ?? null,
          }),
          destination: {
            world_snapshot_id: worldSnapshot.id,
            post_id: post.id,
            tag_id: selectedInstance.tag_id,
            position_x: selectedInstance.position_x,
            position_y: selectedInstance.position_y,
            position_z: selectedInstance.position_z,
            heading_y: pillarLayout ? computeHeadingToPillar(selectedInstance, pillarLayout) : 0,
            is_canonical: selectedInstance.is_canonical,
            display_tier: selectedInstance.display_tier,
          },
        });
        continue;
      }

      const candidatePostTags = (postTagsByPostId.get(post.id) ?? [])
        .filter((row) => !scopedTagId || row.tag_id === scopedTagId)
        .filter((row) => {
          if (!scopedPillarId) {
            return true;
          }
          return tagLayoutByTagId.get(row.tag_id)?.pillar_id === scopedPillarId;
        });
      const fallbackTagRow =
        candidatePostTags.find((row) => row.tag_id === post.primary_tag_id) ??
        candidatePostTags[0] ??
        null;
      if (!fallbackTagRow) {
        destinationByPostId.set(post.id, {
          queueStatus: pendingByPostId.get(post.id) ?? "queued",
          destination: null,
        });
        continue;
      }
      const tagLayout = tagLayoutByTagId.get(fallbackTagRow.tag_id);
      const pillarLayout = tagLayout ? pillarLayoutById.get(tagLayout.pillar_id) : null;
      if (!tagLayout || !pillarLayout) {
        destinationByPostId.set(post.id, {
          queueStatus: pendingByPostId.get(post.id) ?? "queued",
          destination: null,
        });
        continue;
      }
      const anchor = computeTagAnchorPosition(pillarLayout, tagLayout);
      destinationByPostId.set(post.id, {
        queueStatus: pendingByPostId.get(post.id) ?? "queued",
        destination: {
          world_snapshot_id: worldSnapshot.id,
          post_id: post.id,
          tag_id: fallbackTagRow.tag_id,
          position_x: Number(anchor.x.toFixed(4)),
          position_y: Number(anchor.y.toFixed(4)),
          position_z: Number(anchor.z.toFixed(4)),
          heading_y: computeHeadingToPillar(
            {
              position_x: anchor.x,
              position_y: anchor.y,
              position_z: anchor.z,
            },
            pillarLayout,
          ),
          is_canonical: fallbackTagRow.tag_id === post.primary_tag_id,
          display_tier: "hidden",
        },
      });
    }

    return destinationByPostId;
  }

  async getCurrentWorldMeta() {
    const { settings, organization, currentVersion, worldSnapshot } = await this.ensureCurrentWorldContext();
    const queueLag = await this.getWorldQueueLag(worldSnapshot.id, settings);
    return {
      organization,
      worldSnapshotId: worldSnapshot.id,
      organizationVersionId: currentVersion.id,
      status: worldSnapshot.status,
      layoutAlgorithm: worldSnapshot.layout_algorithm,
      builtAt: worldSnapshot.built_at,
      bounds: {
        minX: worldSnapshot.bounds_x_min,
        maxX: worldSnapshot.bounds_x_max,
        minZ: worldSnapshot.bounds_z_min,
        maxZ: worldSnapshot.bounds_z_max,
      },
      renderer: buildWorldRendererConfig(settings),
      queueLag,
    };
  }

  async streamCurrentWorld(input) {
    const { settings, currentVersion, worldSnapshot } = await this.ensureCurrentWorldContext();
    let cellXMin = clampInteger(input.cell_x_min, -2, -10000, 10000);
    let cellXMax = clampInteger(input.cell_x_max, 2, -10000, 10000);
    let cellZMin = clampInteger(input.cell_z_min, -2, -10000, 10000);
    let cellZMax = clampInteger(input.cell_z_max, 2, -10000, 10000);
    if (cellXMin > cellXMax) {
      [cellXMin, cellXMax] = [cellXMax, cellXMin];
    }
    if (cellZMin > cellZMax) {
      [cellZMin, cellZMax] = [cellZMax, cellZMin];
    }
    const pillarCellRange = expandWorldCellRange(
      {
        cellXMin,
        cellXMax,
        cellZMin,
        cellZMax,
      },
      computePillarStreamPaddingCells(settings),
    );
    const tagCellRange = expandWorldCellRange(
      {
        cellXMin,
        cellXMax,
        cellZMin,
        cellZMax,
      },
      computeTagStreamPaddingCells(settings),
    );
    const presenceCellRange = expandWorldCellRange(
      {
        cellXMin,
        cellXMax,
        cellZMin,
        cellZMax,
      },
      computeActorStreamPaddingCells(settings),
    );

    const [pillars, tagLayouts, postInstances, presenceRows] = await Promise.all([
      must(
        this.serviceClient
          .from("world_pillar_layouts")
          .select("*")
          .eq("world_snapshot_id", worldSnapshot.id)
          .gte("cell_x", pillarCellRange.cellXMin)
          .lte("cell_x", pillarCellRange.cellXMax)
          .gte("cell_z", pillarCellRange.cellZMin)
          .lte("cell_z", pillarCellRange.cellZMax),
        "Could not load streamed world pillar layouts",
      ),
      must(
        this.serviceClient
          .from("world_tag_layouts")
          .select("*")
          .eq("world_snapshot_id", worldSnapshot.id)
          .gte("cell_x", tagCellRange.cellXMin)
          .lte("cell_x", tagCellRange.cellXMax)
          .gte("cell_z", tagCellRange.cellZMin)
          .lte("cell_z", tagCellRange.cellZMax),
        "Could not load streamed world tag layouts",
      ),
      must(
        this.serviceClient
          .from("world_post_instances")
          .select("*")
          .eq("world_snapshot_id", worldSnapshot.id)
          .neq("display_tier", "hidden")
          .gte("cell_x", cellXMin)
          .lte("cell_x", cellXMax)
          .gte("cell_z", cellZMin)
          .lte("cell_z", cellZMax),
        "Could not load streamed world post instances",
      ),
      must(
        this.serviceClient
          .from("live_presence_sessions")
          .select("*")
          .eq("world_snapshot_id", worldSnapshot.id)
          .gt("expires_at", nowIso()),
        "Could not load live presence sessions",
      ),
    ]);

    const pillarDetails =
      pillars.length > 0
        ? await must(
            this.serviceClient
              .from("pillars")
              .select("*")
              .in("id", dedupeStringList(pillars.map((row) => row.pillar_id))),
            "Could not load streamed pillar details",
          )
        : [];
    const tagDetails =
      tagLayouts.length > 0
        ? await must(
            this.serviceClient
              .from("tags")
              .select("*")
              .in("id", dedupeStringList(tagLayouts.map((row) => row.tag_id))),
            "Could not load streamed tag details",
          )
        : [];
    const hydratedPosts =
      postInstances.length > 0
        ? await this.hydratePosts(
            await must(
              this.serviceClient
                .from("posts")
                .select("*")
                .in("id", dedupeStringList(postInstances.map((row) => row.post_id))),
              "Could not load streamed post details",
            ),
          )
        : [];

    const pillarById = new Map(pillars.map((row) => [row.pillar_id, row]));
    const pillarDetailById = new Map(pillarDetails.map((row) => [row.id, row]));
    const tagDetailById = new Map(tagDetails.map((row) => [row.id, row]));
    const hydratedPostById = new Map(hydratedPosts.map((row) => [row.id, row]));
    const streamedTags = tagLayouts.map((row) => {
      const pillar = pillarById.get(row.pillar_id);
      const anchor = pillar ? computeTagAnchorPosition(pillar, row) : { x: 0, y: 0, z: 0 };
      return {
        ...row,
        position_x: Number(anchor.x.toFixed(4)),
        position_y: Number(anchor.y.toFixed(4)),
        position_z: Number(anchor.z.toFixed(4)),
        tag: tagDetailById.get(row.tag_id) ?? null,
        pillar: pillarDetailById.get(row.pillar_id) ?? null,
      };
    });
    const tagById = new Map(streamedTags.map((row) => [row.tag_id, row]));
    const streamedPosts = postInstances.map((row) => {
      const tag = tagById.get(row.tag_id);
      const pillar = tag ? pillarById.get(tag.pillar_id) : null;
      return {
        ...row,
        pillar_id: tag?.pillar_id ?? null,
        heading_y: pillar ? computeHeadingToPillar(row, pillar) : 0,
        post: hydratedPostById.get(row.post_id) ?? null,
        tag: tagDetailById.get(row.tag_id) ?? null,
        pillar: tag ? pillarDetailById.get(tag.pillar_id) ?? null : null,
      };
    });

    const filteredPresence = presenceRows.filter((row) => {
      const cellX = Math.floor(row.position_x / Math.max(1, settings.world_cell_size));
      const cellZ = Math.floor(row.position_z / Math.max(1, settings.world_cell_size));
      return (
        cellX >= presenceCellRange.cellXMin
        && cellX <= presenceCellRange.cellXMax
        && cellZ >= presenceCellRange.cellZMin
        && cellZ <= presenceCellRange.cellZMax
      );
    });
    const installationIds = dedupeStringList(filteredPresence.map((row) => row.installation_id));
    const agents =
      installationIds.length > 0
        ? await must(
            this.serviceClient
              .from("agent_installations")
              .select("id, display_name, platform, host_name")
              .in("id", installationIds),
            "Could not load agent presence labels",
          )
        : [];
    const agentById = new Map(agents.map((row) => [row.id, row]));

    return {
      worldSnapshotId: worldSnapshot.id,
      organizationVersionId: currentVersion.id,
      cellRange: {
        cellXMin,
        cellXMax,
        cellZMin,
        cellZMax,
      },
      pillarCellRange,
      tagCellRange,
      presenceCellRange,
      pillars: pillars.map((row) => ({
        ...row,
        pillar: pillarDetailById.get(row.pillar_id) ?? null,
      })),
      tags: streamedTags,
      postInstances: streamedPosts,
      presence: filteredPresence.map((row) => ({
        ...row,
        actor: row.installation_id ? agentById.get(row.installation_id) ?? null : null,
      })),
    };
  }

  async searchWorld(input) {
    const { currentVersion, worldSnapshot } = await this.ensureCurrentWorldContext();
    const result = await this.queryPostsForSearch(input, {
      defaultLimit: 20,
      maxLimit: 30,
    });
    const hydrated = await this.hydratePosts(result.posts);
    const destinations = await this.loadWorldDestinationsForPosts({
      worldSnapshot,
      posts: result.posts,
      scopedTagId: result.tagId,
      scopedPillarId: result.pillarId || null,
    });

    return {
      worldSnapshotId: worldSnapshot.id,
      organizationVersionId: currentVersion.id,
      sort: result.sort,
      hits: hydrated.map((post) => {
        const worldInfo = destinations.get(post.id) ?? { destination: null, queueStatus: "queued" };
        return {
          post,
          destination: worldInfo.destination,
          worldQueueStatus: worldInfo.queueStatus,
        };
      }),
    };
  }

  async getWorldPostInstances(postId) {
    const { currentVersion, worldSnapshot } = await this.ensureCurrentWorldContext();
    const post = await maybeSingle(
      this.serviceClient.from("posts").select("*").eq("id", postId).maybeSingle(),
      "Could not load world post",
    );
    if (!post) {
      throw new HttpError(404, "Post not found");
    }

    const instances = await must(
      this.serviceClient
        .from("world_post_instances")
        .select("*")
        .eq("world_snapshot_id", worldSnapshot.id)
        .eq("post_id", postId)
        .order("rank_in_tag", { ascending: true }),
      "Could not load world post instances",
    );
    const hydrated = (await this.hydratePosts([post]))[0];

    if (instances.length === 0) {
      const fallback = await this.loadWorldDestinationsForPosts({
        worldSnapshot,
        posts: [post],
      });
      const info = fallback.get(postId);
      return {
        worldSnapshotId: worldSnapshot.id,
        organizationVersionId: currentVersion.id,
        post: hydrated,
        instances: info?.destination
          ? [
              {
                ...info.destination,
                queue_status: info.queueStatus,
              },
            ]
          : [],
      };
    }

    const tagIds = dedupeStringList(instances.map((row) => row.tag_id));
    const tagLayouts = await must(
      this.serviceClient
        .from("world_tag_layouts")
        .select("*")
        .eq("world_snapshot_id", worldSnapshot.id)
        .in("tag_id", tagIds),
      "Could not load world tag layouts for instances",
    );
    const pillarIds = dedupeStringList(tagLayouts.map((row) => row.pillar_id));
    const pillarLayouts =
      pillarIds.length > 0
        ? await must(
            this.serviceClient
              .from("world_pillar_layouts")
              .select("*")
              .eq("world_snapshot_id", worldSnapshot.id)
              .in("pillar_id", pillarIds),
            "Could not load world pillar layouts for instances",
          )
        : [];
    const tagLayoutByTagId = new Map(tagLayouts.map((row) => [row.tag_id, row]));
    const pillarLayoutById = new Map(pillarLayouts.map((row) => [row.pillar_id, row]));

    return {
      worldSnapshotId: worldSnapshot.id,
      organizationVersionId: currentVersion.id,
      post: hydrated,
      instances: instances.map((row) => {
        const tagLayout = tagLayoutByTagId.get(row.tag_id);
        const pillarLayout = tagLayout ? pillarLayoutById.get(tagLayout.pillar_id) : null;
        return {
          ...row,
          pillar_id: tagLayout?.pillar_id ?? null,
          heading_y: pillarLayout ? computeHeadingToPillar(row, pillarLayout) : 0,
          queue_status: "ready",
        };
      }),
    };
  }

  async upsertViewerPresence(input) {
    const viewerSessionId = String(input.viewerSessionId ?? "").trim();
    if (!viewerSessionId) {
      throw new HttpError(400, "viewerSessionId is required");
    }

    const { settings, currentVersion, worldSnapshot } = await this.ensureCurrentWorldContext();
    const payload = {
      actor_type: "viewer",
      viewer_session_id: viewerSessionId,
      world_snapshot_id: worldSnapshot.id,
      position_x: Number(input.position_x ?? 0) || 0,
      position_y: Number(input.position_y ?? 0) || 0,
      position_z: Number(input.position_z ?? 0) || 0,
      heading_y: Number(input.heading_y ?? 0) || 0,
      movement_state: typeof input.movement_state === "object" && input.movement_state
        ? input.movement_state
        : {},
      last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + settings.world_presence_ttl_seconds * 1000).toISOString(),
    };

    const existing = await maybeSingle(
      this.serviceClient
        .from("live_presence_sessions")
        .select("*")
        .eq("viewer_session_id", viewerSessionId)
        .maybeSingle(),
      "Could not load viewer presence session",
    );

    const row = existing
      ? await must(
          this.serviceClient
            .from("live_presence_sessions")
            .update(payload)
            .eq("id", existing.id)
            .select("*")
            .single(),
          "Could not update viewer presence session",
        )
      : await must(
          this.serviceClient
            .from("live_presence_sessions")
            .insert(payload)
            .select("*")
            .single(),
          "Could not create viewer presence session",
        );

    return {
      worldSnapshotId: worldSnapshot.id,
      organizationVersionId: currentVersion.id,
      session: row,
    };
  }

  async rebuildTagGraphState(pruneTagIds = []) {
    const [postTags, tags] = await Promise.all([
      must(
        this.serviceClient.from("post_tags").select("post_id, tag_id"),
        "Could not load post tags for tag graph rebuild",
      ),
      must(
        this.serviceClient.from("tags").select("id"),
        "Could not load tags for tag graph rebuild",
      ),
    ]);

    const tagPostIds = new Map();
    const tagIdsByPostId = new Map();
    for (const row of postTags) {
      if (!tagPostIds.has(row.tag_id)) {
        tagPostIds.set(row.tag_id, new Set());
      }
      tagPostIds.get(row.tag_id).add(row.post_id);

      if (!tagIdsByPostId.has(row.post_id)) {
        tagIdsByPostId.set(row.post_id, []);
      }
      tagIdsByPostId.get(row.post_id).push(row.tag_id);
    }

    const tagUpdates = tags.map((tag) => {
      const count = tagPostIds.get(tag.id)?.size ?? 0;
      return {
        id: tag.id,
        usage_count: count,
        post_count: count,
        updated_at: nowIso(),
      };
    });

    if (tagUpdates.length > 0) {
      await Promise.all(
        tagUpdates.map((row) =>
          must(
            this.serviceClient
              .from("tags")
              .update({
                usage_count: row.usage_count,
                post_count: row.post_count,
                updated_at: row.updated_at,
              })
              .eq("id", row.id),
            "Could not rebuild tag counters",
          )),
      );
    }

    const removableTagIds = dedupeStringList(pruneTagIds).filter(
      (tagId) => (tagPostIds.get(tagId)?.size ?? 0) === 0,
    );
    if (removableTagIds.length > 0) {
      await must(
        this.serviceClient.from("tags").delete().in("id", removableTagIds),
        "Could not prune empty tags after external cleanup",
      );
    }

    const edgeWeights = new Map();
    for (const tagIds of tagIdsByPostId.values()) {
      const uniqueTagIds = dedupeStringList(tagIds).sort();
      for (let index = 0; index < uniqueTagIds.length; index += 1) {
        for (let cursor = index + 1; cursor < uniqueTagIds.length; cursor += 1) {
          const key = `${uniqueTagIds[index]}:${uniqueTagIds[cursor]}`;
          edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        }
      }
    }

    await must(
      this.serviceClient.from("tag_edges").delete().gte("weight", 0),
      "Could not clear tag edges for rebuild",
    );

    const edgeRows = Array.from(edgeWeights.entries()).map(([key, weight]) => {
      const [tag_low_id, tag_high_id] = key.split(":");
      return {
        tag_low_id,
        tag_high_id,
        weight,
        active: true,
        updated_at: nowIso(),
      };
    });

    if (edgeRows.length > 0) {
      await must(
        this.serviceClient.from("tag_edges").insert(edgeRows),
        "Could not rebuild tag edges",
      );
    }

    return {
      tagCount: Math.max(0, tagUpdates.length - removableTagIds.length),
      edgeCount: edgeRows.length,
      prunedTagCount: removableTagIds.length,
    };
  }

  async syncCuratedCorpus() {
    return await runCuratedCorpusSync(this);
  }

  async purgeExternalContent() {
    const [posts, postTags, tags, installations] = await Promise.all([
      must(
        this.serviceClient
          .from("posts")
          .select("id, author_installation_id, title, body_plain, search_text, tag_search_text"),
        "Could not load posts for external content cleanup",
      ),
      must(
        this.serviceClient.from("post_tags").select("post_id, tag_id, label_snapshot"),
        "Could not load post tags for external content cleanup",
      ),
      must(
        this.serviceClient.from("tags").select("id, slug, label"),
        "Could not load tags for external content cleanup",
      ),
      must(
        this.serviceClient.from("agent_installations").select("id, display_name, device_id, auth_email"),
        "Could not load installations for external content cleanup",
      ),
    ]);

    const authorById = new Map(installations.map((row) => [row.id, row]));
    const tagById = new Map(tags.map((row) => [row.id, row]));
    const postTagsByPostId = postTags.reduce((map, row) => {
      if (!map.has(row.post_id)) {
        map.set(row.post_id, []);
      }
      map.get(row.post_id).push(row);
      return map;
    }, new Map());

    const matchedInstallationIds = new Set(
      installations
        .filter((installation) => shouldPurgeExternalInstallation(installation))
        .map((installation) => installation.id),
    );
    const matchedPostIds = new Set();
    const candidateTagIds = new Set(
      tags
        .filter((tag) => shouldPurgeExternalTag(tag))
        .map((tag) => tag.id),
    );

    for (const post of posts) {
      const rows = postTagsByPostId.get(post.id) ?? [];
      const tagTexts = rows.map((row) => row.label_snapshot || tagById.get(row.tag_id)?.label || "");
      const author = authorById.get(post.author_installation_id) ?? null;
      if (
        matchedInstallationIds.has(post.author_installation_id)
        || shouldPurgeExternalPost({
          post,
          author,
          tagTexts,
        })
      ) {
        matchedPostIds.add(post.id);
        for (const row of rows) {
          candidateTagIds.add(row.tag_id);
        }
      }
    }

    const postIdList = Array.from(matchedPostIds);
    const installationIdList = Array.from(matchedInstallationIds);
    const candidateTagIdList = Array.from(candidateTagIds);

    if (postIdList.length === 0 && installationIdList.length === 0 && candidateTagIdList.length === 0) {
      return {
        matchedPostCount: 0,
        deletedPostCount: 0,
        matchedInstallationCount: 0,
        deletedInstallationCount: 0,
        matchedTagCount: 0,
        prunedTagCount: 0,
        rebuiltTagCount: 0,
        rebuiltEdgeCount: 0,
        recomputed: false,
        world: null,
        worldQueue: null,
      };
    }

    if (postIdList.length > 0) {
      await must(
        this.serviceClient.from("posts").delete().in("id", postIdList),
        "Could not delete external content posts",
      );
    }

    if (installationIdList.length > 0) {
      await must(
        this.serviceClient.from("agent_installations").delete().in("id", installationIdList),
        "Could not delete external content installations",
      );
    }

    const tagGraph = await this.rebuildTagGraphState(candidateTagIdList);
    const shouldRecompute =
      postIdList.length > 0 || installationIdList.length > 0 || tagGraph.prunedTagCount > 0;
    const recompute = shouldRecompute ? await this.recomputePillars() : null;

    return {
      matchedPostCount: postIdList.length,
      deletedPostCount: postIdList.length,
      matchedInstallationCount: installationIdList.length,
      deletedInstallationCount: installationIdList.length,
      matchedTagCount: candidateTagIdList.length,
      prunedTagCount: tagGraph.prunedTagCount,
      rebuiltTagCount: tagGraph.tagCount,
      rebuiltEdgeCount: tagGraph.edgeCount,
      recomputed: Boolean(recompute),
      world: recompute?.world ?? null,
      worldQueue: recompute?.worldQueue ?? null,
    };
  }

  async recomputePillars(options = {}) {
    const forcePromoteCurrent = Boolean(options?.forcePromoteCurrent);
    const [settings, tags, edges, versions] = await Promise.all([
      this.getSettings(),
      must(this.serviceClient.from("tags").select("*"), "Could not load tags for pillar recompute"),
      must(this.serviceClient.from("tag_edges").select("*"), "Could not load tag edges for pillar recompute"),
      this.ensureOrganizationVersions(),
    ]);

    const [currentExistingPillars, nextExistingPillars] = await Promise.all([
      this.loadPillarsForVersion(versions.current.id),
      this.loadPillarsForVersion(versions.next.id),
    ]);

    const nextGraph = computePillarGraph({
      tags,
      edges,
      existingPillars: nextExistingPillars,
      coreSize: settings.pillar_core_size,
      similarityThreshold: settings.related_similarity_threshold,
    });

    const snapshotAt = nowIso();
    const nextResult = await this.persistGraphToVersion({
      version: versions.next,
      existingPillars: nextExistingPillars,
      graph: nextGraph,
      snapshotAt,
    });

    let currentResult = null;
    const shouldPromoteCurrent =
      forcePromoteCurrent
      || currentExistingPillars.length === 0 ||
      isPromotionDue(versions.current, settings.pillar_promotion_interval_hours);

    if (shouldPromoteCurrent) {
      const currentGraph = computePillarGraph({
        tags,
        edges,
        existingPillars: currentExistingPillars,
        coreSize: settings.pillar_core_size,
        similarityThreshold: settings.related_similarity_threshold,
      });

      currentResult = await this.persistGraphToVersion({
        version: versions.current,
        existingPillars: currentExistingPillars,
        graph: currentGraph,
        snapshotAt,
        promotedAt: snapshotAt,
      });

      await this.applyCurrentOrganizationAssignments(
        currentResult.graph,
        currentResult.placeholderToPersistedId,
      );
    }

    const [nextWorldResult, currentWorldResult] = await Promise.all([
      this.rebuildWorldSnapshotForVersion({ version: versions.next, settings }),
      this.rebuildWorldSnapshotForVersion({ version: versions.current, settings }),
    ]);

    if (currentResult) {
      await this.enqueueWorldIngestEvent({
        eventType: "snapshot_promoted",
        worldSnapshotId: currentWorldResult.worldSnapshot.id,
        payload: {
          organizationVersionId: versions.current.id,
          promotedAt: snapshotAt,
        },
      });
    }

    const worldQueue = await this.processWorldIngestQueue(settings.world_queue_batch_size);

    return {
      pillars: nextResult.pillars,
      related: nextResult.graph.pillarRelated,
      organization: await this.getOrganizationSummary(),
      promotedCurrent: Boolean(currentResult),
      forcePromoteCurrent,
      currentPillars: currentResult?.pillars ?? currentExistingPillars.filter((pillar) => pillar.active),
      nextPillars: nextResult.pillars,
      world: {
        current: currentWorldResult.worldSnapshot,
        next: nextWorldResult.worldSnapshot,
      },
      worldQueue,
    };
  }
}
