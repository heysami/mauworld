import crypto from "node:crypto";
import JSZip from "jszip";
import { HttpError } from "./http.js";
import { stripMarkdown } from "./text.js";

const PUBLIC_LIBRARY_ACTIVE_STATE = "active";
const PUBLIC_LIBRARY_LISTING_KINDS = new Set(["world_package", "game", "resource"]);
const PUBLIC_LIBRARY_RESOURCE_KINDS = new Set(["texture", "animation", "video", "sound", "model"]);
const PUBLIC_LIBRARY_DELIVERY_MODES = new Set(["download", "contact"]);
const PUBLIC_LIBRARY_SORT_MODES = new Set(["newest", "top-rated"]);
const MAX_PUBLIC_LIBRARY_RESULTS = 120;
const MAX_PUBLIC_LIBRARY_MEDIA_FILES = 8;
const MAX_PUBLIC_LIBRARY_REVIEW_COMMENT_CHARS = 1200;

function nowIso() {
  return new Date().toISOString();
}

async function must(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error) {
    throw new HttpError(500, message, error.message);
  }
  return data;
}

async function maybeSingle(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error && error.code !== "PGRST116") {
    throw new HttpError(500, message, error.message);
  }
  return data ?? null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clipText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clampLimit(value, fallback = 24, max = MAX_PUBLIC_LIBRARY_RESULTS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(numeric));
}

function buildSearchText(values = []) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => stripMarkdown(value))
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(filename = "file.bin") {
  const cleaned = String(filename ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || "file.bin";
}

function inferContentTypeFromFilename(filename = "") {
  const lowerFilename = String(filename ?? "").trim().toLowerCase();
  if (lowerFilename.endsWith(".png")) {
    return "image/png";
  }
  if (lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerFilename.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowerFilename.endsWith(".gif")) {
    return "image/gif";
  }
  if (lowerFilename.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lowerFilename.endsWith(".webm")) {
    return "video/webm";
  }
  if (lowerFilename.endsWith(".mov")) {
    return "video/quicktime";
  }
  if (lowerFilename.endsWith(".glb")) {
    return "model/gltf-binary";
  }
  if (lowerFilename.endsWith(".gltf")) {
    return "model/gltf+json";
  }
  if (lowerFilename.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lowerFilename.endsWith(".wav")) {
    return "audio/wav";
  }
  if (lowerFilename.endsWith(".ogg")) {
    return "audio/ogg";
  }
  if (lowerFilename.endsWith(".json")) {
    return "application/json";
  }
  if (lowerFilename.endsWith(".zip")) {
    return "application/zip";
  }
  return "application/octet-stream";
}

function inferExtensionFromContentType(contentType = "", fallback = "bin") {
  const normalized = String(contentType ?? "").trim().toLowerCase();
  const explicit = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "application/json": "json",
    "application/zip": "zip",
  };
  return explicit[normalized] ?? fallback;
}

function sanitizeRequiredText(value, fieldName, maxLength = 400) {
  const sanitized = clipText(stripMarkdown(value), maxLength);
  if (!sanitized) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  return sanitized;
}

function sanitizeOptionalText(value, maxLength = 4000) {
  return clipText(stripMarkdown(value), maxLength);
}

function sanitizeOptionalContactText(value, maxLength = 2000) {
  return clipText(value, maxLength);
}

function parseRating(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new HttpError(400, "Invalid rating");
  }
  const rounded = Math.floor(numeric);
  if (rounded < 1 || rounded > 5) {
    throw new HttpError(400, "Invalid rating");
  }
  return rounded;
}

function normalizeSortMode(value) {
  const normalized = lower(value);
  return PUBLIC_LIBRARY_SORT_MODES.has(normalized) ? normalized : "newest";
}

function normalizeListingKind(value) {
  const normalized = lower(value);
  if (!PUBLIC_LIBRARY_LISTING_KINDS.has(normalized)) {
    throw new HttpError(400, "Invalid listing kind");
  }
  return normalized;
}

function normalizeDeliveryMode(value) {
  const normalized = lower(value);
  if (!PUBLIC_LIBRARY_DELIVERY_MODES.has(normalized)) {
    throw new HttpError(400, "Invalid delivery mode");
  }
  return normalized;
}

function listingDownloadRoute(listingId) {
  return `/api/public/library/listings/${encodeURIComponent(listingId)}/download`;
}

export function resolvePublicLibraryResourceKind(asset = {}, requestedKind = "") {
  const assetType = lower(asset.asset_type ?? asset.assetType);
  const requested = lower(requestedKind);
  if (assetType === "sound") {
    if (requested && requested !== "sound") {
      throw new HttpError(400, "That asset can only be published as a sound resource");
    }
    return "sound";
  }
  if (assetType === "texture") {
    const mediaKind = lower(asset.context?.media_kind ?? asset.context?.mediaKind);
    const resolved = mediaKind === "video_texture" ? "video" : "texture";
    if (requested && requested !== resolved) {
      throw new HttpError(400, `That asset can only be published as a ${resolved} resource`);
    }
    return resolved;
  }
  if (assetType === "model") {
    if (requested && requested !== "model" && requested !== "animation") {
      throw new HttpError(400, "Models can only be published as 3D models or animation resources");
    }
    return requested === "animation" ? "animation" : "model";
  }
  throw new HttpError(400, "That asset type cannot be published in the public library");
}

export function serializePublicLibrarySnapshotResource(asset = {}, resourceKind = "") {
  return {
    id: asset.id,
    asset_type: asset.asset_type,
    resource_kind: resourceKind,
    name: asset.name,
    provider: asset.provider ?? null,
    intended_use: asset.intended_use ?? null,
    world_context_summary: asset.world_context_summary ?? null,
    source_world_id: asset.source_world_id ?? null,
    source_world_name: asset.source_world_name ?? null,
    context: cloneJson(asset.context ?? {}),
    spec: cloneJson(asset.spec ?? {}),
    provider_metadata: cloneJson(asset.provider_metadata ?? {}),
    bounds: cloneJson(asset.bounds ?? {}),
    created_at: asset.created_at ?? null,
    updated_at: asset.updated_at ?? null,
    files: (Array.isArray(asset.files) ? asset.files : []).map((file) => ({
      role: file.role,
      filename: file.filename,
      content_type: file.content_type,
      size_bytes: file.size_bytes,
    })),
  };
}

function serializePublicLibraryCreator(profile = {}, summary = {}) {
  return {
    id: profile.id ?? null,
    username: profile.username ?? null,
    display_name: profile.display_name ?? null,
    profile_rating_average: Number(summary.profile_rating_average ?? 0) || 0,
    profile_review_count: Math.max(0, Number(summary.profile_review_count ?? 0) || 0),
    active_listing_count: Math.max(0, Number(summary.active_listing_count ?? 0) || 0),
  };
}

function serializePublicLibraryMedia(store, row = {}) {
  const storage = store.serviceClient.storage.from(row.bucket ?? store.config.mediaBucket);
  const { data } = storage.getPublicUrl(row.object_path);
  return {
    id: row.id,
    sort_order: row.sort_order ?? 0,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    media_type: String(row.file_meta?.media_type ?? "").trim() || (String(row.content_type ?? "").startsWith("video/") ? "video" : "image"),
    url: data?.publicUrl ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function serializePublicLibraryReview(row = {}, author = null) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    author: author
      ? {
          id: author.id,
          username: author.username,
          display_name: author.display_name,
        }
      : null,
  };
}

function serializePublicLibraryListing(store, row = {}, {
  owner = null,
  creatorSummary = {},
  media = [],
  reviews = [],
  viewerReview = null,
  viewerProfileId = "",
  includeSnapshot = false,
} = {}) {
  const canEdit = Boolean(viewerProfileId && owner?.id && viewerProfileId === owner.id);
  const hasDownload = row.state === PUBLIC_LIBRARY_ACTIVE_STATE
    && row.delivery_mode === "download"
    && row.download_object_path
    && row.download_filename;
  const payload = {
    id: row.id,
    kind: row.kind,
    resource_kind: row.resource_kind ?? null,
    title: row.title,
    description: row.description,
    delivery_mode: row.delivery_mode,
    contact_instructions: row.contact_instructions ?? "",
    state: row.state,
    rating_average: Number(row.rating_average ?? 0) || 0,
    review_count: Math.max(0, Number(row.review_count ?? 0) || 0),
    published_at: row.published_at ?? row.created_at ?? nowIso(),
    snapshot_updated_at: row.snapshot_updated_at ?? row.updated_at ?? row.created_at ?? nowIso(),
    created_at: row.created_at ?? nowIso(),
    updated_at: row.updated_at ?? row.created_at ?? nowIso(),
    source: {
      world_id: row.source_world_id ?? null,
      creator_username: row.source_creator_username ?? null,
      game_id: row.source_game_id ?? null,
      asset_id: row.source_asset_id ?? null,
    },
    download: {
      available: Boolean(hasDownload),
      href: hasDownload ? listingDownloadRoute(row.id) : null,
      filename: row.download_filename ?? null,
      content_type: row.download_content_type ?? null,
      size_bytes: Math.max(0, Number(row.download_size_bytes ?? 0) || 0),
    },
    owner: serializePublicLibraryCreator(owner ?? {}, creatorSummary),
    media,
    reviews,
    viewer_review: viewerReview ?? null,
    permissions: {
      can_edit: canEdit,
      can_review: Boolean(viewerProfileId) && !canEdit,
    },
  };
  if (includeSnapshot) {
    payload.source_snapshot = cloneJson(row.source_snapshot ?? {});
  }
  return payload;
}

async function loadProfilesByIds(store, ids = []) {
  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return new Map();
  }
  const rows = await must(
    store.serviceClient.from("user_profiles").select("*").in("id", normalizedIds),
    "Could not load user profiles",
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadProfileByUsername(store, username) {
  const normalized = lower(username);
  if (!normalized) {
    throw new HttpError(400, "Invalid username");
  }
  const row = await maybeSingle(
    store.serviceClient.from("user_profiles").select("*").eq("username", normalized).maybeSingle(),
    "Could not load public library profile",
  );
  if (!row) {
    throw new HttpError(404, "Profile not found");
  }
  return row;
}

async function loadListingMediaRows(store, listingIds = []) {
  const normalizedIds = Array.from(new Set((Array.isArray(listingIds) ? listingIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return [];
  }
  return await must(
    store.serviceClient
      .from("public_library_listing_media")
      .select("*")
      .in("listing_id", normalizedIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    "Could not load public library media",
  );
}

async function loadListingReviewRows(store, listingIds = []) {
  const normalizedIds = Array.from(new Set((Array.isArray(listingIds) ? listingIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return [];
  }
  return await must(
    store.serviceClient
      .from("public_library_listing_reviews")
      .select("*")
      .in("listing_id", normalizedIds)
      .order("created_at", { ascending: false }),
    "Could not load public library listing reviews",
  );
}

async function loadProfileReviewRows(store, reviewedProfileIds = []) {
  const normalizedIds = Array.from(new Set((Array.isArray(reviewedProfileIds) ? reviewedProfileIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return [];
  }
  return await must(
    store.serviceClient
      .from("public_library_profile_reviews")
      .select("*")
      .in("reviewed_profile_id", normalizedIds)
      .order("created_at", { ascending: false }),
    "Could not load public library profile reviews",
  );
}

function mapRowsByKey(rows = [], key) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const groupKey = row?.[key];
    if (!groupKey) {
      continue;
    }
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(row);
  }
  return grouped;
}

async function loadCreatorSummaryMap(store, profileIds = []) {
  const normalizedIds = Array.from(new Set((Array.isArray(profileIds) ? profileIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return new Map();
  }
  const [listingRows, reviewRows] = await Promise.all([
    must(
      store.serviceClient
        .from("public_library_listings")
        .select("owner_profile_id")
        .eq("state", PUBLIC_LIBRARY_ACTIVE_STATE)
        .in("owner_profile_id", normalizedIds),
      "Could not load public library listing counts",
    ),
    must(
      store.serviceClient
        .from("public_library_profile_reviews")
        .select("reviewed_profile_id, rating")
        .in("reviewed_profile_id", normalizedIds),
      "Could not load public library profile rating summaries",
    ),
  ]);
  const listingCounts = new Map();
  for (const row of listingRows) {
    const profileId = String(row.owner_profile_id ?? "").trim();
    if (!profileId) {
      continue;
    }
    listingCounts.set(profileId, (listingCounts.get(profileId) ?? 0) + 1);
  }
  const ratingStats = new Map();
  for (const row of reviewRows) {
    const profileId = String(row.reviewed_profile_id ?? "").trim();
    if (!profileId) {
      continue;
    }
    const current = ratingStats.get(profileId) ?? { total: 0, count: 0 };
    current.total += Number(row.rating ?? 0) || 0;
    current.count += 1;
    ratingStats.set(profileId, current);
  }
  const summaries = new Map();
  for (const profileId of normalizedIds) {
    const stats = ratingStats.get(profileId) ?? { total: 0, count: 0 };
    summaries.set(profileId, {
      profile_rating_average: stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
      profile_review_count: stats.count,
      active_listing_count: listingCounts.get(profileId) ?? 0,
    });
  }
  return summaries;
}

function buildMediaStoragePath(ownerProfileId, listingId, index, filename) {
  return `public-library/${ownerProfileId}/${listingId}/media/${String(index + 1).padStart(2, "0")}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${sanitizeFilename(filename)}`;
}

function buildDownloadStoragePath(ownerProfileId, listingId, filename) {
  return `public-library/${ownerProfileId}/${listingId}/download/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${sanitizeFilename(filename)}`;
}

async function uploadStorageBuffer(store, objectPath, buffer, contentType) {
  const storage = store.serviceClient.storage.from(store.config.mediaBucket);
  const { error } = await storage.upload(objectPath, buffer, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new HttpError(500, "Could not upload public library file", error.message);
  }
}

async function removeStorageObjectIfPresent(store, bucket, objectPath) {
  const normalizedBucket = String(bucket ?? store.config.mediaBucket).trim() || store.config.mediaBucket;
  const normalizedPath = String(objectPath ?? "").trim();
  if (!normalizedPath) {
    return;
  }
  try {
    await store.serviceClient.storage.from(normalizedBucket).remove([normalizedPath]);
  } catch (_error) {
    // Best effort cleanup only.
  }
}

async function downloadStorageBuffer(store, bucket, objectPath) {
  const storage = store.serviceClient.storage.from(bucket ?? store.config.mediaBucket);
  const { data, error } = await storage.download(objectPath);
  if (error || !data) {
    throw new HttpError(500, "Could not download public library file", error?.message);
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function persistListingMedia(store, listingId, ownerProfileId, files = []) {
  const normalizedFiles = (Array.isArray(files) ? files : []).slice(0, MAX_PUBLIC_LIBRARY_MEDIA_FILES);
  if (!normalizedFiles.length) {
    return [];
  }
  const insertedRows = [];
  for (let index = 0; index < normalizedFiles.length; index += 1) {
    const file = normalizedFiles[index];
    const filename = sanitizeFilename(file.filename || `preview-${index + 1}`);
    const contentType = clipText(file.content_type ?? file.contentType ?? inferContentTypeFromFilename(filename), 160)
      || inferContentTypeFromFilename(filename);
    if (!String(contentType).startsWith("image/") && !String(contentType).startsWith("video/")) {
      throw new HttpError(400, "Preview uploads must be image or video files");
    }
    const buffer = Buffer.isBuffer(file.buffer)
      ? file.buffer
      : Buffer.from(String(file.base64 ?? ""), "base64");
    const objectPath = buildMediaStoragePath(ownerProfileId, listingId, index, filename);
    await uploadStorageBuffer(store, objectPath, buffer, contentType);
    const inserted = await must(
      store.serviceClient
        .from("public_library_listing_media")
        .insert({
          listing_id: listingId,
          sort_order: index,
          bucket: store.config.mediaBucket,
          object_path: objectPath,
          filename,
          content_type: contentType,
          size_bytes: buffer.length,
          file_meta: {
            media_type: String(contentType).startsWith("video/") ? "video" : "image",
          },
        })
        .select("*")
        .single(),
      "Could not store public library media metadata",
    );
    insertedRows.push(inserted);
  }
  return insertedRows;
}

async function replaceListingDownload(store, listingId, ownerProfileId, downloadFile = null, existingRow = null) {
  const previousPath = String(existingRow?.download_object_path ?? "").trim();
  const previousBucket = String(existingRow?.download_bucket ?? "").trim() || store.config.mediaBucket;
  if (!downloadFile) {
    if (previousPath) {
      await removeStorageObjectIfPresent(store, previousBucket, previousPath);
    }
    return {
      download_bucket: null,
      download_object_path: null,
      download_filename: null,
      download_content_type: null,
      download_size_bytes: 0,
    };
  }
  const filename = sanitizeFilename(downloadFile.filename || "download.bin");
  const contentType = clipText(downloadFile.contentType ?? downloadFile.content_type ?? inferContentTypeFromFilename(filename), 160)
    || inferContentTypeFromFilename(filename);
  const buffer = Buffer.isBuffer(downloadFile.buffer)
    ? downloadFile.buffer
    : Buffer.from(downloadFile.buffer ?? []);
  const objectPath = buildDownloadStoragePath(ownerProfileId, listingId, filename);
  await uploadStorageBuffer(store, objectPath, buffer, contentType);
  if (previousPath) {
    await removeStorageObjectIfPresent(store, previousBucket, previousPath);
  }
  return {
    download_bucket: store.config.mediaBucket,
    download_object_path: objectPath,
    download_filename: filename,
    download_content_type: contentType,
    download_size_bytes: buffer.length,
  };
}

async function loadOwnedWorldForPublish(store, profile, worldId) {
  const normalizedWorldId = clipText(worldId, 120);
  if (!normalizedWorldId) {
    throw new HttpError(400, "Invalid source world");
  }
  const world = await maybeSingle(
    store.serviceClient
      .from("private_worlds")
      .select("*")
      .eq("world_id", normalizedWorldId)
      .eq("creator_profile_id", profile.id)
      .maybeSingle(),
    "Could not load private world publish source",
  );
  if (!world) {
    throw new HttpError(404, "Private world source not found");
  }
  const detail = await store.getPrivateWorldDetail({
    worldId: world.world_id,
    creatorUsername: profile.username,
    profile,
    includeContent: false,
    allowGuest: false,
  });
  return detail.world;
}

async function buildWorldPackageSnapshot(store, profile, sourceWorldId, deliveryMode) {
  const world = await loadOwnedWorldForPublish(store, profile, sourceWorldId);
  const exportedJson = await store.exportPrivateWorld(profile, {
    worldId: world.world_id,
    creatorUsername: profile.username,
    format: "json",
  });
  const snapshot = {
    format: "mauworld.public-library.snapshot.v1",
    snapshot_kind: "world_package",
    source: {
      world_id: world.world_id,
      creator_username: profile.username,
      source_updated_at: world.updated_at ?? world.created_at ?? nowIso(),
    },
    package: cloneJson(exportedJson.package ?? {}),
  };
  let downloadFile = null;
  if (deliveryMode === "download") {
    const exportedArchive = await store.exportPrivateWorld(profile, {
      worldId: world.world_id,
      creatorUsername: profile.username,
      format: "archive",
    });
    downloadFile = {
      buffer: exportedArchive.archiveBuffer,
      filename: exportedArchive.filename || `${world.world_id}.mauworld.zip`,
      contentType: exportedArchive.contentType || "application/zip",
    };
  }
  return {
    sourceSnapshot: snapshot,
    downloadFile,
    defaults: {
      title: world.name || "Private world package",
      description: world.about || "",
    },
    sourceRefs: {
      source_world_id: world.world_id,
      source_creator_username: profile.username,
      source_game_id: null,
      source_asset_id: null,
      resource_kind: null,
    },
  };
}

async function buildGameSnapshot(store, profile, sourceGameId, deliveryMode) {
  const game = (await store.getWorldGame(profile, {
    gameId: clipText(sourceGameId, 120),
  })).game;
  const exported = await store.exportWorldGame(profile, {
    gameId: game.id,
  });
  const snapshot = {
    format: "mauworld.public-library.snapshot.v1",
    snapshot_kind: "game",
    source: {
      game_id: game.id,
      source_updated_at: game.updated_at ?? game.created_at ?? nowIso(),
    },
    package: cloneJson(exported.package ?? {}),
  };
  let downloadFile = null;
  if (deliveryMode === "download") {
    downloadFile = {
      buffer: Buffer.from(JSON.stringify(exported.package ?? {}, null, 2), "utf8"),
      filename: exported.filename || `${sanitizeFilename(game.title || "mauworld-game")}.mauworld-game.json`,
      contentType: "application/json",
    };
  }
  return {
    sourceSnapshot: snapshot,
    downloadFile,
    defaults: {
      title: game.title || "Game package",
      description: game.manifest?.description || game.prompt || "",
    },
    sourceRefs: {
      source_world_id: null,
      source_creator_username: null,
      source_game_id: game.id,
      source_asset_id: null,
      resource_kind: null,
    },
  };
}

async function loadAssetFileRows(store, assetId) {
  return await must(
    store.serviceClient
      .from("private_world_asset_files")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true }),
    "Could not load private world asset files for public library",
  );
}

async function buildResourceSnapshotBundle(store, listingAsset, rawFileRows = []) {
  const snapshot = serializePublicLibrarySnapshotResource(listingAsset.asset, listingAsset.resourceKind);
  const zip = new JSZip();
  zip.file("snapshot.json", JSON.stringify({
    format: "mauworld.public-library.bundle.v1",
    snapshot,
  }, null, 2));
  for (const [index, fileRow] of rawFileRows.entries()) {
    const sanitizedFilename = sanitizeFilename(fileRow.filename || "");
    const extension = sanitizedFilename.includes(".")
      ? sanitizedFilename.split(".").pop()
      : inferExtensionFromContentType(fileRow.content_type, "bin");
    const archiveFilename = sanitizedFilename || `${sanitizeFilename(fileRow.role || "file")}.${extension}`;
    const archivePath = `files/${String(index + 1).padStart(2, "0")}-${archiveFilename}`;
    zip.file(archivePath, await downloadStorageBuffer(store, fileRow.bucket ?? store.config.mediaBucket, fileRow.object_path));
  }
  const filenameBase = sanitizeFilename(listingAsset.asset.name || listingAsset.resourceKind || "resource");
  return {
    buffer: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    filename: `${filenameBase}.mauworld-resource.zip`,
    contentType: "application/zip",
  };
}

async function buildResourceSnapshot(store, profile, sourceAssetId, requestedResourceKind, deliveryMode) {
  const assetPayload = await store.getPrivateWorldAsset(profile, {
    assetId: clipText(sourceAssetId, 120),
  });
  const asset = assetPayload.asset;
  const resourceKind = resolvePublicLibraryResourceKind(asset, requestedResourceKind);
  const snapshot = {
    format: "mauworld.public-library.snapshot.v1",
    snapshot_kind: "resource",
    source: {
      asset_id: asset.id,
      source_updated_at: asset.updated_at ?? asset.created_at ?? nowIso(),
    },
    resource_kind: resourceKind,
    asset: serializePublicLibrarySnapshotResource(asset, resourceKind),
  };
  let downloadFile = null;
  if (deliveryMode === "download") {
    const rawFileRows = await loadAssetFileRows(store, asset.id);
    downloadFile = await buildResourceSnapshotBundle(store, {
      asset,
      resourceKind,
    }, rawFileRows);
  }
  return {
    sourceSnapshot: snapshot,
    downloadFile,
    defaults: {
      title: asset.name || "Resource",
      description: asset.world_context_summary || asset.intended_use || "",
    },
    sourceRefs: {
      source_world_id: null,
      source_creator_username: null,
      source_game_id: null,
      source_asset_id: asset.id,
      resource_kind: resourceKind,
    },
  };
}

async function buildListingSourceSnapshot(store, profile, input = {}) {
  const kind = normalizeListingKind(input.kind);
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode ?? input.delivery_mode);
  if (kind === "world_package") {
    return await buildWorldPackageSnapshot(store, profile, input.sourceWorldId ?? input.source_world_id, deliveryMode);
  }
  if (kind === "game") {
    return await buildGameSnapshot(store, profile, input.sourceGameId ?? input.source_game_id, deliveryMode);
  }
  return await buildResourceSnapshot(
    store,
    profile,
    input.sourceAssetId ?? input.source_asset_id,
    input.resourceKind ?? input.resource_kind,
    deliveryMode,
  );
}

function buildListingPayload(profile, input = {}, snapshotResult = {}, existingRow = null) {
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode ?? input.delivery_mode ?? existingRow?.delivery_mode ?? "download");
  const title = sanitizeRequiredText(
    input.title ?? snapshotResult.defaults?.title ?? existingRow?.title ?? "Untitled listing",
    "title",
    120,
  );
  const description = sanitizeOptionalText(
    input.description ?? snapshotResult.defaults?.description ?? existingRow?.description ?? "",
    4000,
  );
  const contactInstructions = deliveryMode === "contact"
    ? sanitizeRequiredText(
        input.contactInstructions ?? input.contact_instructions ?? existingRow?.contact_instructions ?? "",
        "contact instructions",
        2000,
      )
    : sanitizeOptionalContactText(input.contactInstructions ?? input.contact_instructions ?? existingRow?.contact_instructions ?? "", 2000);
  const kind = normalizeListingKind(input.kind ?? existingRow?.kind);
  const resourceKind = kind === "resource"
    ? (() => {
        const candidate = lower(
          input.resourceKind
          ?? input.resource_kind
          ?? snapshotResult.sourceRefs?.resource_kind
          ?? existingRow?.resource_kind,
        );
        if (!PUBLIC_LIBRARY_RESOURCE_KINDS.has(candidate)) {
          throw new HttpError(400, "Invalid resource kind");
        }
        return candidate;
      })()
    : null;
  return {
    owner_profile_id: profile.id,
    source_world_id: snapshotResult.sourceRefs?.source_world_id ?? existingRow?.source_world_id ?? null,
    source_creator_username: snapshotResult.sourceRefs?.source_creator_username ?? existingRow?.source_creator_username ?? null,
    source_game_id: snapshotResult.sourceRefs?.source_game_id ?? existingRow?.source_game_id ?? null,
    source_asset_id: snapshotResult.sourceRefs?.source_asset_id ?? existingRow?.source_asset_id ?? null,
    kind,
    resource_kind: resourceKind,
    title,
    description,
    search_text: buildSearchText([
      title,
      description,
      kind.replaceAll("_", " "),
      resourceKind,
      profile.username,
      profile.display_name,
      snapshotResult.sourceSnapshot?.asset?.source_world_name,
    ]),
    source_snapshot: cloneJson(snapshotResult.sourceSnapshot ?? existingRow?.source_snapshot ?? {}),
    delivery_mode: deliveryMode,
    contact_instructions: contactInstructions || null,
    state: existingRow?.state ?? PUBLIC_LIBRARY_ACTIVE_STATE,
    published_at: existingRow?.published_at ?? nowIso(),
    snapshot_updated_at: snapshotResult.sourceSnapshot ? nowIso() : (existingRow?.snapshot_updated_at ?? nowIso()),
    updated_at: nowIso(),
  };
}

async function recomputeListingReviewAggregate(store, listingId) {
  const rows = await must(
    store.serviceClient
      .from("public_library_listing_reviews")
      .select("rating")
      .eq("listing_id", listingId),
    "Could not load public library review aggregate",
  );
  const count = rows.length;
  const average = count > 0
    ? Number((rows.reduce((sum, row) => sum + (Number(row.rating ?? 0) || 0), 0) / count).toFixed(2))
    : 0;
  await must(
    store.serviceClient
      .from("public_library_listings")
      .update({
        rating_average: average,
        review_count: count,
        updated_at: nowIso(),
      })
      .eq("id", listingId),
    "Could not update public library review aggregate",
  );
  return { rating_average: average, review_count: count };
}

async function loadListingRowById(store, listingId) {
  const normalizedId = clipText(listingId, 120);
  if (!normalizedId) {
    throw new HttpError(400, "Invalid listingId");
  }
  const row = await maybeSingle(
    store.serviceClient.from("public_library_listings").select("*").eq("id", normalizedId).maybeSingle(),
    "Could not load public library listing",
  );
  if (!row) {
    throw new HttpError(404, "Listing not found");
  }
  return row;
}

async function hydrateListings(store, rows = [], options = {}) {
  const listingRows = Array.isArray(rows) ? rows : [];
  const listingIds = listingRows.map((row) => row.id).filter(Boolean);
  const ownerIds = listingRows.map((row) => row.owner_profile_id).filter(Boolean);
  const [ownerMap, creatorSummaryMap, mediaRows, reviewRows, viewerReviewRows] = await Promise.all([
    loadProfilesByIds(store, ownerIds),
    loadCreatorSummaryMap(store, ownerIds),
    loadListingMediaRows(store, listingIds),
    options.includeReviews === true ? loadListingReviewRows(store, listingIds) : Promise.resolve([]),
    options.viewerProfileId
      ? must(
          store.serviceClient
            .from("public_library_listing_reviews")
            .select("*")
            .eq("reviewer_profile_id", options.viewerProfileId)
            .in("listing_id", listingIds),
          "Could not load viewer listing reviews",
        )
      : Promise.resolve([]),
  ]);
  const mediaMap = mapRowsByKey(mediaRows, "listing_id");
  const reviewMap = mapRowsByKey(reviewRows, "listing_id");
  const viewerReviewMap = new Map((Array.isArray(viewerReviewRows) ? viewerReviewRows : []).map((row) => [row.listing_id, row]));
  const reviewAuthorIds = reviewRows.map((row) => row.reviewer_profile_id).filter(Boolean);
  const reviewAuthorMap = await loadProfilesByIds(store, reviewAuthorIds);
  return listingRows.map((row) => serializePublicLibraryListing(store, row, {
    owner: ownerMap.get(row.owner_profile_id) ?? null,
    creatorSummary: creatorSummaryMap.get(row.owner_profile_id) ?? {},
    media: (mediaMap.get(row.id) ?? []).map((entry) => serializePublicLibraryMedia(store, entry)),
    reviews: (reviewMap.get(row.id) ?? []).map((entry) => serializePublicLibraryReview(entry, reviewAuthorMap.get(entry.reviewer_profile_id) ?? null)),
    viewerReview: viewerReviewMap.has(row.id)
      ? serializePublicLibraryReview(
          viewerReviewMap.get(row.id),
          reviewAuthorMap.get(viewerReviewMap.get(row.id).reviewer_profile_id)
            ?? ownerMap.get(options.viewerProfileId)
            ?? null,
        )
      : null,
    viewerProfileId: options.viewerProfileId ?? "",
    includeSnapshot: options.includeSnapshot === true,
  }));
}

async function hydrateSingleListing(store, row, options = {}) {
  const [listing] = await hydrateListings(store, [row], options);
  return listing ?? null;
}

function isOwner(profile = null, row = {}) {
  return Boolean(profile?.id) && String(profile.id) === String(row.owner_profile_id ?? "");
}

function ensureActiveListingVisible(row, viewerProfile = null) {
  if (row.state === PUBLIC_LIBRARY_ACTIVE_STATE || isOwner(viewerProfile, row)) {
    return;
  }
  throw new HttpError(404, "Listing not found");
}

function ensureOwner(profile, row) {
  if (!isOwner(profile, row)) {
    throw new HttpError(403, "Only the listing owner can modify this listing");
  }
}

export function installPublicLibraryStore(MauworldStore) {
  MauworldStore.prototype.listPublicLibraryListings = async function listPublicLibraryListings(input = {}, viewerProfile = null) {
    const limit = clampLimit(input.limit, 24, MAX_PUBLIC_LIBRARY_RESULTS);
    const sort = normalizeSortMode(input.sort);
    const queryText = lower(input.q);
    const kindFilter = input.kind ? normalizeListingKind(input.kind) : "";
    const resourceKindFilter = input.resourceKind || input.resource_kind
      ? lower(input.resourceKind ?? input.resource_kind)
      : "";
    if (resourceKindFilter && !PUBLIC_LIBRARY_RESOURCE_KINDS.has(resourceKindFilter)) {
      throw new HttpError(400, "Invalid resource kind");
    }
    const rawRows = await must(
      this.serviceClient
        .from("public_library_listings")
        .select("*")
        .eq("state", PUBLIC_LIBRARY_ACTIVE_STATE)
        .order(sort === "top-rated" ? "rating_average" : "published_at", { ascending: false })
        .limit(Math.max(limit * 4, 80)),
      "Could not load public library listings",
    );
    const ownerMap = await loadProfilesByIds(this, rawRows.map((row) => row.owner_profile_id));
    const filteredRows = rawRows
      .filter((row) => !kindFilter || row.kind === kindFilter)
      .filter((row) => !resourceKindFilter || row.resource_kind === resourceKindFilter)
      .filter((row) => {
        if (!queryText) {
          return true;
        }
        const owner = ownerMap.get(row.owner_profile_id) ?? null;
        const haystack = buildSearchText([
          row.search_text,
          owner?.username,
          owner?.display_name,
        ]);
        return haystack.includes(queryText);
      })
      .sort((left, right) => {
        if (sort === "top-rated") {
          return (Number(right.rating_average ?? 0) || 0) - (Number(left.rating_average ?? 0) || 0)
            || (Number(right.review_count ?? 0) || 0) - (Number(left.review_count ?? 0) || 0)
            || new Date(right.published_at ?? right.created_at ?? 0).getTime() - new Date(left.published_at ?? left.created_at ?? 0).getTime();
        }
        return new Date(right.published_at ?? right.created_at ?? 0).getTime() - new Date(left.published_at ?? left.created_at ?? 0).getTime();
      })
      .slice(0, limit);
    return {
      listings: await hydrateListings(this, filteredRows, {
        viewerProfileId: viewerProfile?.id ?? "",
      }),
      filters: {
        q: queryText,
        sort,
        kind: kindFilter || null,
        resource_kind: resourceKindFilter || null,
      },
    };
  };

  MauworldStore.prototype.getPublicLibraryListing = async function getPublicLibraryListing(input = {}, viewerProfile = null) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    ensureActiveListingVisible(row, viewerProfile);
    return {
      listing: await hydrateSingleListing(this, row, {
        includeReviews: true,
        viewerProfileId: viewerProfile?.id ?? "",
      }),
    };
  };

  MauworldStore.prototype.downloadPublicLibraryListing = async function downloadPublicLibraryListing(input = {}) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    if (row.state !== PUBLIC_LIBRARY_ACTIVE_STATE) {
      throw new HttpError(404, "Listing not found");
    }
    if (row.delivery_mode !== "download" || !row.download_object_path) {
      throw new HttpError(404, "Listing download not found");
    }
    return {
      buffer: await downloadStorageBuffer(this, row.download_bucket ?? this.config.mediaBucket, row.download_object_path),
      filename: row.download_filename || "download.bin",
      contentType: row.download_content_type || "application/octet-stream",
    };
  };

  MauworldStore.prototype.getPublicLibraryProfile = async function getPublicLibraryProfile(input = {}, viewerProfile = null) {
    const profile = await loadProfileByUsername(this, input.username);
    const creatorSummary = (await loadCreatorSummaryMap(this, [profile.id])).get(profile.id) ?? {
      profile_rating_average: 0,
      profile_review_count: 0,
      active_listing_count: 0,
    };
    if (creatorSummary.active_listing_count <= 0 && (!viewerProfile || viewerProfile.id !== profile.id)) {
      throw new HttpError(404, "Profile not found");
    }
    const [listingRows, reviewRows, viewerReviewRow] = await Promise.all([
      must(
        this.serviceClient
          .from("public_library_listings")
          .select("*")
          .eq("owner_profile_id", profile.id)
          .eq("state", PUBLIC_LIBRARY_ACTIVE_STATE)
          .order("published_at", { ascending: false })
          .limit(48),
        "Could not load creator listings",
      ),
      must(
        this.serviceClient
          .from("public_library_profile_reviews")
          .select("*")
          .eq("reviewed_profile_id", profile.id)
          .order("created_at", { ascending: false }),
        "Could not load creator reviews",
      ),
      viewerProfile?.id
        ? maybeSingle(
            this.serviceClient
              .from("public_library_profile_reviews")
              .select("*")
              .eq("reviewed_profile_id", profile.id)
              .eq("reviewer_profile_id", viewerProfile.id)
              .maybeSingle(),
            "Could not load viewer creator review",
          )
        : Promise.resolve(null),
    ]);
    const reviewerProfiles = await loadProfilesByIds(this, reviewRows.map((row) => row.reviewer_profile_id));
    return {
      profile: {
        ...serializePublicLibraryCreator(profile, creatorSummary),
        permissions: {
          can_review: Boolean(viewerProfile?.id) && String(viewerProfile.id) !== String(profile.id),
        },
      },
      listings: await hydrateListings(this, listingRows, {
        viewerProfileId: viewerProfile?.id ?? "",
      }),
      reviews: reviewRows.map((row) => serializePublicLibraryReview(row, reviewerProfiles.get(row.reviewer_profile_id) ?? null)),
      viewer_review: viewerReviewRow ? serializePublicLibraryReview(viewerReviewRow, viewerProfile) : null,
    };
  };

  MauworldStore.prototype.listOwnPublicLibraryListings = async function listOwnPublicLibraryListings(profile, input = {}) {
    const stateFilter = lower(input.state);
    const limit = clampLimit(input.limit, 48, MAX_PUBLIC_LIBRARY_RESULTS);
    const rows = await must(
      this.serviceClient
        .from("public_library_listings")
        .select("*")
        .eq("owner_profile_id", profile.id)
        .order("updated_at", { ascending: false })
        .limit(limit),
      "Could not load your public library listings",
    );
    const filteredRows = rows.filter((row) => !stateFilter || row.state === stateFilter);
    return {
      listings: await hydrateListings(this, filteredRows, {
        viewerProfileId: profile.id,
        includeSnapshot: true,
      }),
    };
  };

  MauworldStore.prototype.publishPublicLibraryListing = async function publishPublicLibraryListing(profile, input = {}) {
    const mediaFiles = Array.isArray(input.mediaFiles) ? input.mediaFiles : [];
    if (!mediaFiles.length) {
      throw new HttpError(400, "At least one preview image or video is required");
    }
    const snapshotResult = await buildListingSourceSnapshot(this, profile, input);
    const listingId = crypto.randomUUID();
    const downloadFields = await replaceListingDownload(
      this,
      listingId,
      profile.id,
      normalizeDeliveryMode(input.deliveryMode ?? input.delivery_mode) === "download"
        ? snapshotResult.downloadFile
        : null,
      null,
    );
    const basePayload = buildListingPayload(profile, input, snapshotResult, null);
    const inserted = await must(
      this.serviceClient
        .from("public_library_listings")
        .insert({
          id: listingId,
          ...basePayload,
          ...downloadFields,
          published_at: nowIso(),
          snapshot_updated_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .select("*")
        .single(),
      "Could not create public library listing",
    );
    await persistListingMedia(this, listingId, profile.id, mediaFiles);
    return {
      listing: await hydrateSingleListing(this, inserted, {
        includeReviews: true,
        viewerProfileId: profile.id,
      }),
    };
  };

  MauworldStore.prototype.updatePublicLibraryListing = async function updatePublicLibraryListing(profile, input = {}) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    ensureOwner(profile, row);
    const republishSnapshot = input.republish_snapshot === true
      || input.republishSnapshot === true
      || lower(input.republish_snapshot ?? input.republishSnapshot) === "true";
    const requestedResourceKind = lower(input.resourceKind ?? input.resource_kind);
    if (
      !republishSnapshot
      && row.kind === "resource"
      && requestedResourceKind
      && requestedResourceKind !== String(row.resource_kind ?? "").trim()
    ) {
      throw new HttpError(400, "Republish the snapshot to change the resource kind");
    }
    let snapshotResult = {
      sourceSnapshot: row.source_snapshot,
      sourceRefs: {
        source_world_id: row.source_world_id,
        source_creator_username: row.source_creator_username,
        source_game_id: row.source_game_id,
        source_asset_id: row.source_asset_id,
        resource_kind: row.resource_kind,
      },
      defaults: {
        title: row.title,
        description: row.description,
      },
      downloadFile: null,
    };
    if (republishSnapshot) {
      snapshotResult = await buildListingSourceSnapshot(this, profile, {
        kind: row.kind,
        deliveryMode: input.deliveryMode ?? input.delivery_mode ?? row.delivery_mode,
        sourceWorldId: row.source_world_id,
        sourceGameId: row.source_game_id,
        sourceAssetId: row.source_asset_id,
        resourceKind: input.resourceKind ?? input.resource_kind ?? row.resource_kind,
      });
    }
    const deliveryMode = normalizeDeliveryMode(input.deliveryMode ?? input.delivery_mode ?? row.delivery_mode);
    if (
      deliveryMode === "download"
      && !republishSnapshot
      && !row.download_object_path
    ) {
      throw new HttpError(400, "Republish the snapshot before enabling downloads for this listing");
    }
    const downloadFields = republishSnapshot || deliveryMode !== row.delivery_mode
      ? await replaceListingDownload(
          this,
          row.id,
          profile.id,
          deliveryMode === "download"
            ? (republishSnapshot ? snapshotResult.downloadFile : null)
            : null,
          row,
        )
      : {
          download_bucket: row.download_bucket,
          download_object_path: row.download_object_path,
          download_filename: row.download_filename,
          download_content_type: row.download_content_type,
          download_size_bytes: row.download_size_bytes,
        };
    const payload = buildListingPayload(profile, {
      ...input,
      kind: row.kind,
      deliveryMode,
      resourceKind: input.resourceKind ?? input.resource_kind ?? row.resource_kind,
    }, snapshotResult, row);
    const updated = await must(
      this.serviceClient
        .from("public_library_listings")
        .update({
          ...payload,
          ...downloadFields,
          published_at: row.published_at ?? nowIso(),
        })
        .eq("id", row.id)
        .eq("owner_profile_id", profile.id)
        .select("*")
        .single(),
      "Could not update public library listing",
    );
    return {
      listing: await hydrateSingleListing(this, updated, {
        includeReviews: true,
        viewerProfileId: profile.id,
      }),
    };
  };

  MauworldStore.prototype.archivePublicLibraryListing = async function archivePublicLibraryListing(profile, input = {}) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    ensureOwner(profile, row);
    await must(
      this.serviceClient
        .from("public_library_listings")
        .update({
          state: "archived",
          updated_at: nowIso(),
        })
        .eq("id", row.id)
        .eq("owner_profile_id", profile.id),
      "Could not archive public library listing",
    );
    return {
      archived: true,
      listing_id: row.id,
    };
  };

  MauworldStore.prototype.upsertPublicLibraryListingReview = async function upsertPublicLibraryListingReview(profile, input = {}) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    if (row.state !== PUBLIC_LIBRARY_ACTIVE_STATE) {
      throw new HttpError(404, "Listing not found");
    }
    if (String(row.owner_profile_id ?? "") === String(profile.id ?? "")) {
      throw new HttpError(403, "You cannot review your own listing");
    }
    const comment = sanitizeRequiredText(input.comment, "comment", MAX_PUBLIC_LIBRARY_REVIEW_COMMENT_CHARS);
    const rating = parseRating(input.rating);
    const existing = await maybeSingle(
      this.serviceClient
        .from("public_library_listing_reviews")
        .select("*")
        .eq("listing_id", row.id)
        .eq("reviewer_profile_id", profile.id)
        .maybeSingle(),
      "Could not load existing public library review",
    );
    if (existing) {
      await must(
        this.serviceClient
          .from("public_library_listing_reviews")
          .update({
            rating,
            comment,
            updated_at: nowIso(),
          })
          .eq("id", existing.id),
        "Could not update public library review",
      );
    } else {
      await must(
        this.serviceClient
          .from("public_library_listing_reviews")
          .insert({
            listing_id: row.id,
            reviewer_profile_id: profile.id,
            rating,
            comment,
          }),
        "Could not create public library review",
      );
    }
    await recomputeListingReviewAggregate(this, row.id);
    return await this.getPublicLibraryListing({ listingId: row.id }, profile);
  };

  MauworldStore.prototype.deletePublicLibraryListingReview = async function deletePublicLibraryListingReview(profile, input = {}) {
    const row = await loadListingRowById(this, input.listingId ?? input.id);
    if (row.state !== PUBLIC_LIBRARY_ACTIVE_STATE) {
      throw new HttpError(404, "Listing not found");
    }
    await must(
      this.serviceClient
        .from("public_library_listing_reviews")
        .delete()
        .eq("listing_id", row.id)
        .eq("reviewer_profile_id", profile.id),
      "Could not delete public library review",
    );
    await recomputeListingReviewAggregate(this, row.id);
    return await this.getPublicLibraryListing({ listingId: row.id }, profile);
  };

  MauworldStore.prototype.upsertPublicLibraryProfileReview = async function upsertPublicLibraryProfileReview(profile, input = {}) {
    const reviewedProfile = await loadProfileByUsername(this, input.username);
    if (String(reviewedProfile.id ?? "") === String(profile.id ?? "")) {
      throw new HttpError(403, "You cannot review your own profile");
    }
    const creatorSummary = (await loadCreatorSummaryMap(this, [reviewedProfile.id])).get(reviewedProfile.id) ?? {
      active_listing_count: 0,
    };
    if (creatorSummary.active_listing_count <= 0) {
      throw new HttpError(404, "Profile not found");
    }
    const comment = sanitizeRequiredText(input.comment, "comment", MAX_PUBLIC_LIBRARY_REVIEW_COMMENT_CHARS);
    const rating = parseRating(input.rating);
    const existing = await maybeSingle(
      this.serviceClient
        .from("public_library_profile_reviews")
        .select("*")
        .eq("reviewed_profile_id", reviewedProfile.id)
        .eq("reviewer_profile_id", profile.id)
        .maybeSingle(),
      "Could not load existing creator review",
    );
    if (existing) {
      await must(
        this.serviceClient
          .from("public_library_profile_reviews")
          .update({
            rating,
            comment,
            updated_at: nowIso(),
          })
          .eq("id", existing.id),
        "Could not update creator review",
      );
    } else {
      await must(
        this.serviceClient
          .from("public_library_profile_reviews")
          .insert({
            reviewed_profile_id: reviewedProfile.id,
            reviewer_profile_id: profile.id,
            rating,
            comment,
          }),
        "Could not create creator review",
      );
    }
    return await this.getPublicLibraryProfile({ username: reviewedProfile.username }, profile);
  };

  MauworldStore.prototype.deletePublicLibraryProfileReview = async function deletePublicLibraryProfileReview(profile, input = {}) {
    const reviewedProfile = await loadProfileByUsername(this, input.username);
    await must(
      this.serviceClient
        .from("public_library_profile_reviews")
        .delete()
        .eq("reviewed_profile_id", reviewedProfile.id)
        .eq("reviewer_profile_id", profile.id),
      "Could not delete creator review",
    );
    return await this.getPublicLibraryProfile({ username: reviewedProfile.username }, profile);
  };
}
