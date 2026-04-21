const PRIVATE_WORLD_MINIATURE_BAND_ORDER = {
  far: 0,
  mid: 1,
  near: 2,
};

function normalizeMiniatureBand(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "near" || normalized === "mid") {
    return normalized;
  }
  return "far";
}

export function isLivePrivateWorldInstanceStatus(status = "") {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "active" || normalized === "started";
}

export function resolvePrivateWorldMiniatureRenderState({ serverLodBand = "far", distanceBand = "far" } = {}) {
  const normalizedServerBand = normalizeMiniatureBand(serverLodBand);
  const normalizedDistanceBand = normalizeMiniatureBand(distanceBand);
  const effectiveBand =
    PRIVATE_WORLD_MINIATURE_BAND_ORDER[normalizedServerBand] <= PRIVATE_WORLD_MINIATURE_BAND_ORDER[normalizedDistanceBand]
      ? normalizedServerBand
      : normalizedDistanceBand;
  return {
    effectiveBand,
    showDome: true,
    showBasePlate: false,
    showLabel: false,
    showSilhouette: effectiveBand === "mid",
    showDetail: effectiveBand === "near",
    showPlayerDots: effectiveBand === "near" || effectiveBand === "mid",
    domeOpacity: effectiveBand === "near" ? 0.12 : effectiveBand === "mid" ? 0.18 : 0.24,
  };
}
