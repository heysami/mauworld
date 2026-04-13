import { sha256Hex } from "./security.js";
import { tokenizeLabel } from "./text.js";

function addEdge(map, from, to, weight) {
  if (!map.has(from)) {
    map.set(from, []);
  }
  map.get(from).push({ to, weight });
}

function buildAdjacency(tags, edges) {
  const adjacency = new Map();
  for (const tag of tags) {
    adjacency.set(tag.id, []);
  }
  for (const edge of edges) {
    if (!edge.active || edge.weight <= 0) {
      continue;
    }
    addEdge(adjacency, edge.tag_low_id, edge.tag_high_id, edge.weight);
    addEdge(adjacency, edge.tag_high_id, edge.tag_low_id, edge.weight);
  }
  return adjacency;
}

function connectedComponents(tags, adjacency) {
  const visited = new Set();
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
  const components = [];

  for (const tag of tags) {
    if (visited.has(tag.id)) {
      continue;
    }
    const queue = [tag.id];
    const componentTagIds = [];
    visited.add(tag.id);

    while (queue.length > 0) {
      const current = queue.shift();
      componentTagIds.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor.to)) {
          continue;
        }
        visited.add(neighbor.to);
        queue.push(neighbor.to);
      }
    }

    components.push(componentTagIds.map((tagId) => tagMap.get(tagId)).filter(Boolean));
  }

  return components;
}

function computeDegreeCentrality(component, adjacency) {
  return component
    .map((tag) => {
      const centrality = (adjacency.get(tag.id) ?? []).reduce((sum, entry) => sum + entry.weight, 0);
      return {
        tag,
        centrality,
      };
    })
    .sort((left, right) => right.centrality - left.centrality || left.tag.slug.localeCompare(right.tag.slug));
}

function buildComponentKey(tags) {
  return sha256Hex(tags.map((tag) => tag.id).sort().join("|"));
}

function buildPillarTitle(coreTags) {
  const labels = coreTags.slice(0, 3).map((entry) => entry.tag.label);
  return labels.length > 0 ? labels.join(" / ") : "Untitled Pillar";
}

function buildPillarSlug(coreTags, componentKey) {
  const head = coreTags[0]?.tag?.slug ?? "pillar";
  return `${head}-${componentKey.slice(0, 8)}`;
}

function computeRelatedPillars(pillars, threshold) {
  const related = [];
  for (let i = 0; i < pillars.length; i += 1) {
    for (let j = i + 1; j < pillars.length; j += 1) {
      const leftTokens = new Set(pillars[i].coreTokens);
      const rightTokens = new Set(pillars[j].coreTokens);
      const union = new Set([...leftTokens, ...rightTokens]);
      const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
      const similarity = union.size === 0 ? 0 : overlap / union.size;
      if (similarity >= threshold) {
        related.push({
          pillar_id: pillars[i].id,
          related_pillar_id: pillars[j].id,
          similarity,
        });
      }
    }
  }
  return related;
}

export function computePillarGraph(params) {
  const coreSize = Math.max(1, Number(params.coreSize) || 25);
  const similarityThreshold = Number(params.similarityThreshold) || 0.18;
  const tags = params.tags ?? [];
  const edges = params.edges ?? [];
  const existingPillarsByComponentKey = new Map(
    (params.existingPillars ?? []).map((pillar) => [pillar.component_key, pillar]),
  );
  const adjacency = buildAdjacency(tags, edges);
  const components = connectedComponents(tags, adjacency);
  const nextPillars = [];
  const nextPillarTags = [];
  const nextTagAssignments = [];

  for (const component of components) {
    const ranked = computeDegreeCentrality(component, adjacency);
    const componentKey = buildComponentKey(component);
    const existing = existingPillarsByComponentKey.get(componentKey);
    const coreTags = ranked.slice(0, coreSize);
    const pillar = {
      id: existing?.id ?? null,
      component_key: componentKey,
      slug: existing?.slug ?? buildPillarSlug(coreTags, componentKey),
      title: buildPillarTitle(coreTags),
      core_size: coreTags.length,
      tag_count: component.length,
      edge_count: component.reduce(
        (sum, tag) => sum + (adjacency.get(tag.id) ?? []).length,
        0,
      ) / 2,
      active: true,
      coreTokens: Array.from(
        new Set(coreTags.flatMap((entry) => tokenizeLabel(entry.tag.label))),
      ),
    };
    nextPillars.push(pillar);

    ranked.forEach((entry, index) => {
      const isCore = index < coreSize;
      nextPillarTags.push({
        pillar_component_key: componentKey,
        tag_id: entry.tag.id,
        rank: index + 1,
        centrality: entry.centrality,
        is_core: isCore,
      });
      nextTagAssignments.push({
        tag_id: entry.tag.id,
        pillar_component_key: componentKey,
        pillar_rank: index + 1,
        is_pillar_core: isCore,
      });
    });
  }

  const resolvedPillars = nextPillars.map((pillar, index) => ({
    ...pillar,
    id: pillar.id ?? `generated-${index + 1}`,
  }));
  const componentKeyToId = new Map(resolvedPillars.map((pillar) => [pillar.component_key, pillar.id]));

  return {
    pillars: resolvedPillars.map(({ coreTokens, ...pillar }) => pillar),
    pillarTags: nextPillarTags.map((entry) => ({
      pillar_id: componentKeyToId.get(entry.pillar_component_key),
      tag_id: entry.tag_id,
      rank: entry.rank,
      centrality: entry.centrality,
      is_core: entry.is_core,
    })),
    tagAssignments: nextTagAssignments.map((entry) => ({
      tag_id: entry.tag_id,
      pillar_id: componentKeyToId.get(entry.pillar_component_key),
      pillar_rank: entry.pillar_rank,
      is_pillar_core: entry.is_pillar_core,
    })),
    pillarRelated: computeRelatedPillars(
      resolvedPillars.map((pillar) => ({
        id: pillar.id,
        coreTokens: pillar.coreTokens ?? [],
      })),
      similarityThreshold,
    ),
  };
}
