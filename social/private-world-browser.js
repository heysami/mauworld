function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCreatorUsername(world = {}) {
  return String(world.creator?.username ?? world.creator_username ?? "unknown").trim() || "unknown";
}

function getDimensionsLabel(world = {}) {
  return [world.width, world.length, world.height]
    .map((value) => Number(value ?? 0) || 0)
    .join("x");
}

function getLineageLabel(world = {}) {
  if (world.lineage?.is_imported) {
    return `Forked from ${world.lineage.origin_world_name || world.lineage.origin_world_id || "another world"}`;
  }
  return "Original world";
}

export function getPrivateWorldBrowserKey(world = {}) {
  const worldId = String(world.world_id ?? "").trim();
  const creatorUsername = getCreatorUsername(world).toLowerCase();
  return `${worldId}:${creatorUsername}`;
}

export function buildPrivateWorldBrowserResultsMarkup(worlds = [], options = {}) {
  const resultDataAttribute = String(options.resultDataAttribute || "data-private-world-browser-result").trim();
  const selectedKey = String(options.selectedKey ?? "").trim();
  const includeCreator = options.includeCreator !== false;
  const includeOccupancy = options.includeOccupancy === true;
  const includeLineage = options.includeLineage === true;
  const includeStatus = options.includeStatus === true;

  return (Array.isArray(worlds) ? worlds : []).map((world) => {
    const key = getPrivateWorldBrowserKey(world);
    const metaParts = [];
    if (includeCreator) {
      metaParts.push(`@${getCreatorUsername(world)}`);
    }
    metaParts.push(String(world.world_type || "world"));
    metaParts.push(getDimensionsLabel(world));
    if (includeStatus && world.active_instance?.status) {
      metaParts.push(String(world.active_instance.status));
    }
    if (includeOccupancy) {
      metaParts.push(`${Math.max(0, Number(world.active_instance?.viewer_count ?? 0) || 0)} inside`);
    }
    if (includeLineage) {
      metaParts.push(getLineageLabel(world));
    }
    return `
      <button
        class="world-result ${selectedKey === key ? "is-active" : ""}"
        type="button"
        ${resultDataAttribute}="${htmlEscape(key)}"
      >
        <div class="world-result__title">${htmlEscape(world.name || "Private world")}</div>
        <p class="world-result__body">${htmlEscape(world.about || "No description yet.")}</p>
        <div class="world-result__meta">
          ${metaParts.map((part) => `<span>${htmlEscape(part)}</span>`).join("")}
        </div>
      </button>
    `;
  }).join("");
}
