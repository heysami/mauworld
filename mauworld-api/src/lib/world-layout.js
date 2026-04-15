const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BASE_PILLAR_RING_CAPACITY = 8;
const TAGS_PER_BRANCH_RING = 8;

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringHash(input) {
  let hash = 0;
  const value = String(input ?? "");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sortByCountAndSlug(left, right) {
  return (
    (right.tag_count ?? 0) - (left.tag_count ?? 0) ||
    (right.edge_count ?? 0) - (left.edge_count ?? 0) ||
    String(left.slug ?? left.id ?? "").localeCompare(String(right.slug ?? right.id ?? ""))
  );
}

function clampPositiveInt(value, fallback) {
  return Math.max(1, Math.floor(toNumber(value, fallback)));
}

function dedupeRowsByKey(rows, buildKey, compare) {
  const selected = new Map();
  for (const row of rows) {
    const key = buildKey(row);
    const existing = selected.get(key);
    if (!existing || compare(row, existing) < 0) {
      selected.set(key, row);
    }
  }
  return [...selected.values()];
}

function cellForCoordinate(value, cellSize) {
  return Math.floor(value / Math.max(1, cellSize));
}

function ringPosition(index) {
  if (index === 0) {
    return { ring: 0, slot: 0, slotsInRing: 1 };
  }
  let remaining = index - 1;
  let ring = 1;
  let slotsInRing = BASE_PILLAR_RING_CAPACITY;
  while (remaining >= slotsInRing) {
    remaining -= slotsInRing;
    ring += 1;
    slotsInRing += 4;
  }
  return {
    ring,
    slot: remaining,
    slotsInRing,
  };
}

function computePillarImportance(pillar) {
  return toNumber(pillar.tag_count, 0) + toNumber(pillar.edge_count, 0) * 0.5 + toNumber(pillar.core_size, 0) * 2;
}

function computePillarLayout(worldSnapshotId, pillar, index, settings) {
  const cellSize = clampPositiveInt(settings.world_cell_size, 64);
  const levelCount = clampPositiveInt(settings.world_levels_per_pillar, 4);
  const importanceScore = computePillarImportance(pillar);
  const radius = 18 + Math.min(40, Math.sqrt(Math.max(1, toNumber(pillar.tag_count, 1))) * 4);
  const height = 56 + Math.min(144, toNumber(pillar.core_size, 0) * 10 + toNumber(pillar.tag_count, 0) * 2 + toNumber(pillar.edge_count, 0) * 0.75);
  const ringInfo = ringPosition(index);
  const baseSpacing = Math.max(150, cellSize * 2.6 + radius * 2);
  const angleJitter = ((stringHash(pillar.id) % 360) * Math.PI) / 1800;
  const angle =
    ringInfo.ring === 0
      ? 0
      : (2 * Math.PI * ringInfo.slot) / ringInfo.slotsInRing - Math.PI / 2 + angleJitter;
  const radialDistance = ringInfo.ring * baseSpacing;
  const position_x = ringInfo.ring === 0 ? 0 : Number((Math.cos(angle) * radialDistance).toFixed(4));
  const position_z = ringInfo.ring === 0 ? 0 : Number((Math.sin(angle) * radialDistance).toFixed(4));
  return {
    world_snapshot_id: worldSnapshotId,
    pillar_id: pillar.id,
    position_x,
    position_y: 0,
    position_z,
    radius: Number(radius.toFixed(4)),
    height: Number(height.toFixed(4)),
    level_count: levelCount,
    importance_score: Number(importanceScore.toFixed(4)),
    cell_x: cellForCoordinate(position_x, cellSize),
    cell_z: cellForCoordinate(position_z, cellSize),
  };
}

function computeBranchDepth(index) {
  return 1 + Math.floor(index / TAGS_PER_BRANCH_RING);
}

export function computeTagAnchorPosition(pillarLayout, tagLayout) {
  return {
    x: pillarLayout.position_x + Math.cos(tagLayout.orbit_angle) * tagLayout.orbit_radius,
    y: pillarLayout.position_y + tagLayout.y_offset,
    z: pillarLayout.position_z + Math.sin(tagLayout.orbit_angle) * tagLayout.orbit_radius,
  };
}

function computeTagLayoutsForPillar(worldSnapshotId, pillarLayout, pillarTagRows, settings) {
  const cellSize = clampPositiveInt(settings.world_cell_size, 64);
  const groups = new Map();
  const rankedRows = [...pillarTagRows].sort(
    (left, right) => (left.rank ?? 0) - (right.rank ?? 0) || String(left.tag_id).localeCompare(String(right.tag_id)),
  );

  for (let index = 0; index < rankedRows.length; index += 1) {
    const row = rankedRows[index];
    const branchDepth = computeBranchDepth(index);
    if (!groups.has(branchDepth)) {
      groups.set(branchDepth, []);
    }
    groups.get(branchDepth).push({ row, index });
  }

  const tagLayouts = [];
  for (const [branchDepth, entries] of groups.entries()) {
    const count = entries.length;
    const orbitRadius = pillarLayout.radius + 30 + branchDepth * 24;
    const yOffsetBase = Math.min(
      pillarLayout.height - 8,
      14 + branchDepth * 14 + Math.max(0, pillarLayout.height * 0.08),
    );
    for (let slot = 0; slot < entries.length; slot += 1) {
      const { row } = entries[slot];
      const angleOffset = ((stringHash(row.tag_id) % 360) * Math.PI) / 1800;
      const orbitAngle = (2 * Math.PI * slot) / Math.max(1, count) + angleOffset;
      const preview = {
        orbit_angle: Number(orbitAngle.toFixed(6)),
        orbit_radius: Number(orbitRadius.toFixed(4)),
        y_offset: Number(Math.min(pillarLayout.height - 8, yOffsetBase).toFixed(4)),
      };
      const anchor = computeTagAnchorPosition(pillarLayout, preview);
      tagLayouts.push({
        world_snapshot_id: worldSnapshotId,
        pillar_id: pillarLayout.pillar_id,
        tag_id: row.tag_id,
        orbit_angle: preview.orbit_angle,
        orbit_radius: preview.orbit_radius,
        y_offset: preview.y_offset,
        branch_depth: branchDepth,
        active_post_count: 0,
        visible_post_count: 0,
        cell_x: cellForCoordinate(anchor.x, cellSize),
        cell_z: cellForCoordinate(anchor.z, cellSize),
      });
    }
  }

  return tagLayouts;
}

export function computeWorldDisplayTier(rankInTag, visiblePostsPerTag) {
  const visibleLimit = Math.max(0, Math.floor(toNumber(visiblePostsPerTag, 10)));
  if (visibleLimit > 0 && rankInTag > visibleLimit) {
    return "hidden";
  }
  if (rankInTag <= 3) {
    return "hero";
  }
  if (rankInTag <= 10) {
    return "standard";
  }
  if (rankInTag <= 30) {
    return "hint";
  }
  return "hidden";
}

export function computePopularityScore(post, referenceTime = new Date()) {
  const referenceMs = new Date(referenceTime).getTime();
  const createdAtMs = new Date(post.created_at).getTime();
  const ageHours = Math.max(0, (referenceMs - createdAtMs) / (60 * 60 * 1000));
  const freshnessBonus = Math.max(0, 72 - ageHours) / 12;
  return Number(((toNumber(post.score, 0) * 4) + (toNumber(post.comment_count, 0) * 2) + freshnessBonus).toFixed(4));
}

function computeSizeFactor(displayTier, popularityScore, topPopularityScore) {
  const ratio = topPopularityScore > 0 ? popularityScore / topPopularityScore : 0;
  if (displayTier === "hero") {
    return Number((1.4 + ratio * 0.35).toFixed(4));
  }
  if (displayTier === "standard") {
    return Number((1.05 + ratio * 0.2).toFixed(4));
  }
  if (displayTier === "hint") {
    return Number((0.72 + ratio * 0.12).toFixed(4));
  }
  return 0.48;
}

function computeLevelIndex(rankInTag, levelCount, visiblePostsPerTag) {
  const effectiveVisible = Math.max(1, Math.floor(toNumber(visiblePostsPerTag, 10) || 10));
  const postsPerLevel = Math.max(1, Math.ceil(effectiveVisible / Math.max(1, levelCount)));
  return Math.max(0, levelCount - 1 - Math.floor((Math.min(rankInTag, effectiveVisible) - 1) / postsPerLevel));
}

export function computeHeadingToPillar(position, pillarLayout) {
  return Number(
    Math.atan2(
      pillarLayout.position_x - position.position_x,
      pillarLayout.position_z - position.position_z,
    ).toFixed(6),
  );
}

function compareRankedPosts(left, right) {
  return (
    right.popularity_score - left.popularity_score ||
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
    String(left.id).localeCompare(String(right.id))
  );
}

export function computeTagPostInstancesForLayout(params) {
  const {
    worldSnapshotId,
    tagLayout,
    pillarLayout,
    posts,
    settings,
    canonicalTagByPostId,
    referenceTime = new Date(),
  } = params;
  const cellSize = clampPositiveInt(settings.world_cell_size, 64);
  const visiblePostsPerTag = Math.max(0, Math.floor(toNumber(settings.world_visible_posts_per_tag, 10)));
  const levelCount = clampPositiveInt(settings.world_levels_per_pillar, pillarLayout.level_count || 4);
  const anchor = computeTagAnchorPosition(pillarLayout, tagLayout);
  const rankedPosts = posts
    .map((post) => ({
      ...post,
      popularity_score: computePopularityScore(post, referenceTime),
    }))
    .sort(compareRankedPosts);
  const topPopularityScore = rankedPosts[0]?.popularity_score ?? 0;
  const verticalStep = Math.max(10, pillarLayout.height / (levelCount + 1));

  return rankedPosts.map((post, index) => {
    const rankInTag = index + 1;
    const displayTier = computeWorldDisplayTier(rankInTag, visiblePostsPerTag);
    const levelIndex = computeLevelIndex(rankInTag, levelCount, visiblePostsPerTag);
    const spiralAngle = GOLDEN_ANGLE * index + ((stringHash(post.id) % 360) * Math.PI) / 3600;
    const radialDistance = 10 + Math.sqrt(rankInTag) * 5 + (displayTier === "hidden" ? 12 : 0);
    const position_x = Number((anchor.x + Math.cos(spiralAngle) * radialDistance).toFixed(4));
    const position_z = Number((anchor.z + Math.sin(spiralAngle) * radialDistance).toFixed(4));
    const position_y = Number((anchor.y + levelIndex * verticalStep).toFixed(4));
    return {
      world_snapshot_id: worldSnapshotId,
      post_id: post.id,
      tag_id: tagLayout.tag_id,
      is_canonical: canonicalTagByPostId.get(post.id) === tagLayout.tag_id,
      position_x,
      position_y,
      position_z,
      level_index: levelIndex,
      rank_in_tag: rankInTag,
      popularity_score: post.popularity_score,
      size_factor: computeSizeFactor(displayTier, post.popularity_score, topPopularityScore),
      display_tier: displayTier,
      cell_x: cellForCoordinate(position_x, cellSize),
      cell_z: cellForCoordinate(position_z, cellSize),
    };
  });
}

function isSearchableState(state) {
  return ["active", "flagged"].includes(String(state ?? ""));
}

function sortPostTagsByOrdinal(left, right) {
  return (
    toNumber(left.ordinal, Number.MAX_SAFE_INTEGER) - toNumber(right.ordinal, Number.MAX_SAFE_INTEGER) ||
    new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime() ||
    String(left.tag_id).localeCompare(String(right.tag_id))
  );
}

function sortPillarTagsByRank(left, right) {
  return (
    toNumber(left.rank, Number.MAX_SAFE_INTEGER) - toNumber(right.rank, Number.MAX_SAFE_INTEGER) ||
    new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime() ||
    String(left.tag_id).localeCompare(String(right.tag_id))
  );
}

function dedupePillarTags(rows) {
  return dedupeRowsByKey(
    rows,
    (row) => `${row.pillar_id}:${row.tag_id}`,
    sortPillarTagsByRank,
  );
}

export function dedupePostTags(rows) {
  return dedupeRowsByKey(
    rows,
    (row) => `${row.post_id}:${row.tag_id}`,
    sortPostTagsByOrdinal,
  );
}

function updateBounds(bounds, x, z) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

export function computeWorldLayout(params) {
  const {
    worldSnapshotId,
    pillars = [],
    pillarTags = [],
    posts = [],
    postTags = [],
    settings = {},
    referenceTime = new Date(),
  } = params;

  const searchablePosts = posts.filter((post) => isSearchableState(post.state));
  const dedupedPillarTags = dedupePillarTags(pillarTags);
  const dedupedPostTags = dedupePostTags(postTags);
  const searchablePostIds = new Set(searchablePosts.map((post) => post.id));
  const sortedPillars = [...pillars].filter((pillar) => pillar.active !== false).sort(sortByCountAndSlug);
  const pillarLayouts = sortedPillars.map((pillar, index) => computePillarLayout(worldSnapshotId, pillar, index, settings));
  const pillarLayoutById = new Map(pillarLayouts.map((row) => [row.pillar_id, row]));
  const pillarTagsByPillarId = new Map();

  for (const row of dedupedPillarTags) {
    if (!pillarLayoutById.has(row.pillar_id)) {
      continue;
    }
    if (!pillarTagsByPillarId.has(row.pillar_id)) {
      pillarTagsByPillarId.set(row.pillar_id, []);
    }
    pillarTagsByPillarId.get(row.pillar_id).push(row);
  }

  const tagLayouts = [];
  for (const pillarLayout of pillarLayouts) {
    const rows = pillarTagsByPillarId.get(pillarLayout.pillar_id) ?? [];
    tagLayouts.push(...computeTagLayoutsForPillar(worldSnapshotId, pillarLayout, rows, settings));
  }

  const tagLayoutByTagId = new Map(tagLayouts.map((row) => [row.tag_id, row]));
  const postTagsByTagId = new Map();
  const postTagsByPostId = new Map();

  for (const row of dedupedPostTags) {
    if (!searchablePostIds.has(row.post_id) || !tagLayoutByTagId.has(row.tag_id)) {
      continue;
    }
    if (!postTagsByTagId.has(row.tag_id)) {
      postTagsByTagId.set(row.tag_id, []);
    }
    if (!postTagsByPostId.has(row.post_id)) {
      postTagsByPostId.set(row.post_id, []);
    }
    postTagsByTagId.get(row.tag_id).push(row);
    postTagsByPostId.get(row.post_id).push(row);
  }

  for (const rows of postTagsByTagId.values()) {
    rows.sort(sortPostTagsByOrdinal);
  }
  for (const rows of postTagsByPostId.values()) {
    rows.sort(sortPostTagsByOrdinal);
  }

  const canonicalTagByPostId = new Map();
  for (const post of searchablePosts) {
    const rows = postTagsByPostId.get(post.id) ?? [];
    const canonicalRow =
      rows.find((row) => row.tag_id === post.primary_tag_id) ??
      rows[0] ??
      null;
    if (canonicalRow) {
      canonicalTagByPostId.set(post.id, canonicalRow.tag_id);
    }
  }

  const postById = new Map(searchablePosts.map((post) => [post.id, post]));
  const postInstances = [];

  for (const tagLayout of tagLayouts) {
    const pillarLayout = pillarLayoutById.get(tagLayout.pillar_id);
    const rows = postTagsByTagId.get(tagLayout.tag_id) ?? [];
    const tagPosts = rows.map((row) => postById.get(row.post_id)).filter(Boolean);
    const instances = computeTagPostInstancesForLayout({
      worldSnapshotId,
      tagLayout,
      pillarLayout,
      posts: tagPosts,
      settings,
      canonicalTagByPostId,
      referenceTime,
    });
    tagLayout.active_post_count = instances.length;
    tagLayout.visible_post_count = instances.filter((row) => row.display_tier !== "hidden").length;
    postInstances.push(...instances);
  }

  const bounds = {
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  let boundsInitialized = false;
  const includeBoundsPoint = (x, z) => {
    if (!boundsInitialized) {
      bounds.minX = x;
      bounds.maxX = x;
      bounds.minZ = z;
      bounds.maxZ = z;
      boundsInitialized = true;
      return;
    }
    updateBounds(bounds, x, z);
  };

  for (const pillarLayout of pillarLayouts) {
    includeBoundsPoint(pillarLayout.position_x, pillarLayout.position_z);
  }
  for (const tagLayout of tagLayouts) {
    const pillarLayout = pillarLayoutById.get(tagLayout.pillar_id);
    const anchor = computeTagAnchorPosition(pillarLayout, tagLayout);
    includeBoundsPoint(anchor.x, anchor.z);
  }
  for (const instance of postInstances) {
    includeBoundsPoint(instance.position_x, instance.position_z);
  }

  return {
    pillarLayouts,
    tagLayouts,
    postInstances,
    bounds: {
      minX: Number(bounds.minX.toFixed(4)),
      maxX: Number(bounds.maxX.toFixed(4)),
      minZ: Number(bounds.minZ.toFixed(4)),
      maxZ: Number(bounds.maxZ.toFixed(4)),
    },
    metrics: {
      pillarCount: pillarLayouts.length,
      tagCount: tagLayouts.length,
      postInstanceCount: postInstances.length,
      visiblePostInstanceCount: postInstances.filter((row) => row.display_tier !== "hidden").length,
    },
  };
}
