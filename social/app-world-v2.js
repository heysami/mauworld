import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { createWorldVisitorSystem, updateMascotMotion } from "./world-visitors.js";

const { fetchJson, formatRelativeTime, mauworldApiUrl } = window.MauworldSocial;

const elements = {
  canvas: document.querySelector("[data-world-canvas]"),
  focusVeil: document.querySelector("[data-world-focus-veil]"),
  focusFrame: document.querySelector("[data-world-focus-frame]"),
  searchForm: document.querySelector("[data-world-search-form]"),
  searchStatus: document.querySelector("[data-world-search-status]"),
  results: document.querySelector("[data-world-results]"),
  selected: document.querySelector("[data-world-selected]"),
  focusKind: document.querySelector("[data-world-focus-kind]"),
  meta: document.querySelector("[data-world-meta]"),
  queue: document.querySelector("[data-world-queue]"),
  camera: document.querySelector("[data-world-camera]"),
  loading: document.querySelector("[data-world-loading]"),
  toast: document.querySelector("[data-world-toast]"),
  touchpad: document.querySelector("[data-world-touchpad]"),
  stage: document.querySelector("[data-world-stage]"),
  stageKicker: document.querySelector("[data-world-stage-kicker]"),
  stageTitle: document.querySelector("[data-world-stage-title]"),
  stageCopy: document.querySelector("[data-world-stage-copy]"),
  stageMeta: document.querySelector("[data-world-stage-meta]"),
  resultsPanel: document.querySelector(".world-results-panel"),
  inspector: document.querySelector(".world-inspector"),
  inspectorClose: document.querySelector("[data-world-inspector-close]"),
};

elements.focusPieces = {
  top: document.querySelector('[data-world-focus-piece="top"]'),
  left: document.querySelector('[data-world-focus-piece="left"]'),
  right: document.querySelector('[data-world-focus-piece="right"]'),
  bottom: document.querySelector('[data-world-focus-piece="bottom"]'),
};

const WORLD_API = {
  meta: "/public/world/current/meta",
  stream: "/public/world/current/stream",
  search: "/public/world/search",
  presence: "/public/world/current/presence",
};

const CAMERA = {
  minY: 12,
  maxY: 360,
  lookMin: -1.1,
  lookMax: 1.1,
  movementSpeed: 48,
  verticalSpeed: 34,
  wheelFactor: 0.14,
  focusDurationMs: 1400,
};

const PLAYER_VIEW = {
  lookHeight: 7.6,
  minRadius: 16,
  maxRadius: 110,
  defaultRadius: 28,
};

const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"]);

const WORLD_STREAM = {
  mobileRange: 5,
  desktopRange: 6,
  retainPadding: 8,
  renderPadding: 1,
  fogMultiplier: 2.4,
};

const WORLD_STYLE = {
  background: "#fbfcff",
  fog: "#f4fbff",
  ground: "#ffffff",
  groundGlow: "#fff3be",
  line: "#c9dcff",
  ink: "#1f2f68",
  muted: "#7282b9",
  outline: "#33407a",
  white: "#ffffff",
  trailOutline: "#bcc3cf",
  accents: ["#ff4fa8", "#2dd8ff", "#ffd84d", "#7ce85b", "#ff9548", "#7ed7ff"],
};

const SKYLINE_BAND_ASSETS = {
  "skyline-band-primary": new URL("./assets/skyline-band-primary.svg", import.meta.url).href,
  "skyline-band-secondary": new URL("./assets/skyline-band-secondary.svg", import.meta.url).href,
};

const skylineTextureCache = new Map();
let toonGradientTexture = null;

const state = {
  meta: null,
  stream: null,
  searchPayload: null,
  activeResultId: null,
  focusedResult: null,
  openTagId: null,
  hoveredResultId: null,
  activeCellWindow: null,
  currentCellKey: "",
  loading: true,
  streamLoading: false,
  searchLoading: false,
  searchSubmitted: false,
  focusAnimation: null,
  lastPresenceAt: 0,
  lastStreamCheckAt: 0,
  initialViewFramed: false,
  viewerSessionId: "",
  moveButtons: new Set(),
  navigationPosition: new THREE.Vector3(0, 76, 156),
  cameraRadius: PLAYER_VIEW.defaultRadius,
  travelAnimation: null,
  postFocusTagId: null,
  postFocusMix: 0,
  postFocusMixTarget: 0,
  focusReturnRadius: PLAYER_VIEW.defaultRadius,
  trailAccumulator: 0,
  worldCache: {
    pillars: new Map(),
    tags: new Map(),
    posts: new Map(),
  },
};

const sceneState = {
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  root: null,
  decor: new THREE.Group(),
  pillars: new THREE.Group(),
  lines: new THREE.Group(),
  tags: new THREE.Group(),
  posts: new THREE.Group(),
  presence: new THREE.Group(),
  visitors: new THREE.Group(),
  effects: new THREE.Group(),
  focusGhosts: new THREE.Group(),
  focusQueued: new THREE.Group(),
  routes: new THREE.Group(),
  trails: new THREE.Group(),
  player: new THREE.Group(),
  billboards: [],
  persistentBillboards: [],
  animatedDecor: [],
  animatedPillars: [],
  animatedPosts: [],
  animatedTags: [],
  animatedPresence: [],
  clickable: [],
  snow: null,
  snowData: [],
  snowBounds: null,
  playerAvatar: null,
  visitorSystem: null,
  trailPuffs: [],
  routeGuide: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  floorMarker: null,
};

const billboardParentQuaternion = new THREE.Quaternion();

const inputState = {
  keys: new Set(),
  pointerDown: false,
  dragDistance: 0,
  lastPointerX: 0,
  lastPointerY: 0,
  pointerMoved: false,
  yaw: 0,
  pitch: 0.66,
};

function createViewerSessionId() {
  const existing = window.localStorage.getItem("mauworldViewerSessionId");
  if (existing) {
    return existing;
  }
  const next = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem("mauworldViewerSessionId", next);
  return next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getPillarLodSettings() {
  const lod = state.meta?.renderer?.lod ?? {};
  const fog = state.meta?.renderer?.fog ?? {};
  const cellSize = Math.max(16, Math.floor(Number(lod.cellSize) || 64));
  const billboardDistance = Math.max(16, Math.floor(Number(fog.billboardDistance) || 420));
  const nearDistance = Math.max(16, Math.floor(Number(fog.lodNearDistance) || 180));
  const configuredProxyHysteresis = Number(lod.pillarProxyHysteresis);
  const baseProxyDistance = Math.max(nearDistance * 1.1, cellSize * 2.3, billboardDistance * 0.52);
  const proxyDistance = Math.max(
    48,
    Math.floor(Number(lod.pillarProxyDistance) || baseProxyDistance * 10),
  );
  return {
    cellSize,
    streamPaddingCells: Math.max(
      2,
      Math.floor(Number(lod.pillarStreamPaddingCells) || Math.ceil(proxyDistance / cellSize) + 2),
    ),
    proxyDistance,
    proxyHysteresis: clamp(
      Number.isFinite(configuredProxyHysteresis) ? configuredProxyHysteresis : 0,
      0,
      0.4,
    ),
  };
}

function getTagLodSettings() {
  const lod = state.meta?.renderer?.lod ?? {};
  const fog = state.meta?.renderer?.fog ?? {};
  const cellSize = Math.max(16, Math.floor(Number(lod.cellSize) || 64));
  const billboardDistance = Math.max(16, Math.floor(Number(fog.billboardDistance) || 420));
  const nearDistance = Math.max(16, Math.floor(Number(fog.lodNearDistance) || 180));
  const proxyDistance = Math.max(
    36,
    Math.floor(Number(lod.tagProxyDistance) || Math.max(nearDistance * 0.92, cellSize * 1.8, billboardDistance * 0.36)),
  );
  return {
    cellSize,
    streamPaddingCells: Math.max(
      2,
      Math.floor(Number(lod.tagStreamPaddingCells) || Math.ceil(proxyDistance / cellSize) + 2),
    ),
    proxyDistance,
    proxyHysteresis: clamp(
      Number(lod.tagProxyHysteresis) || Math.max(0.09, Math.min(0.2, (cellSize * 0.34) / Math.max(1, proxyDistance))),
      0.01,
      0.35,
    ),
  };
}

function getActorLodSettings() {
  const lod = state.meta?.renderer?.lod ?? {};
  const fog = state.meta?.renderer?.fog ?? {};
  const cellSize = Math.max(16, Math.floor(Number(lod.cellSize) || 64));
  const billboardDistance = Math.max(16, Math.floor(Number(fog.billboardDistance) || 420));
  const nearDistance = Math.max(16, Math.floor(Number(fog.lodNearDistance) || 180));
  const baseProxyDistance = Math.max(nearDistance * 0.84, cellSize * 1.45, billboardDistance * 0.28);
  const proxyDistance = Math.max(
    28,
    Math.floor(Number(lod.actorProxyDistance) || baseProxyDistance * 3),
  );
  return {
    cellSize,
    streamPaddingCells: Math.max(
      2,
      Math.floor(Number(lod.actorStreamPaddingCells) || Math.ceil(proxyDistance / cellSize) + 1),
    ),
    proxyDistance,
    proxyHysteresis: clamp(
      Number(lod.actorProxyHysteresis) || Math.max(0.08, Math.min(0.18, (cellSize * 0.32) / Math.max(1, proxyDistance))),
      0.01,
      0.3,
    ),
  };
}

function getConnectionLodSettings() {
  const fog = state.meta?.renderer?.fog ?? {};
  const cellSize = Math.max(16, Math.floor(Number(state.meta?.renderer?.lod?.cellSize) || 64));
  const billboardDistance = Math.max(16, Math.floor(Number(fog.billboardDistance) || 420));
  const nearDistance = Math.max(16, Math.floor(Number(fog.lodNearDistance) || 180));
  const proxyDistance = Math.max(44, Math.floor(Math.max(nearDistance * 0.88, cellSize * 1.8, billboardDistance * 0.3)));
  return {
    proxyDistance,
    proxyHysteresis: clamp(Math.max(0.08, Math.min(0.18, (cellSize * 0.34) / Math.max(1, proxyDistance))), 0.01, 0.3),
  };
}

function normalizeAngle(angle) {
  let next = angle;
  while (next > Math.PI) {
    next -= Math.PI * 2;
  }
  while (next < -Math.PI) {
    next += Math.PI * 2;
  }
  return next;
}

function shortestAngleDelta(from, to) {
  return normalizeAngle(to - from);
}

function getFlatForwardVector(yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function getCameraPlanarBasis() {
  const fallbackForward = getFlatForwardVector(inputState.yaw);
  if (!sceneState.camera) {
    return {
      forward: fallbackForward,
      right: new THREE.Vector3(Math.cos(inputState.yaw), 0, -Math.sin(inputState.yaw)),
    };
  }

  const forward = new THREE.Vector3();
  sceneState.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.000001) {
    forward.copy(fallbackForward);
  } else {
    forward.normalize();
  }

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 0.000001) {
    right.set(Math.cos(inputState.yaw), 0, -Math.sin(inputState.yaw));
  } else {
    right.normalize();
  }

  return { forward, right };
}

function getCameraMovementBasis() {
  const planarBasis = getCameraPlanarBasis();
  if (!sceneState.camera) {
    return planarBasis;
  }

  const fullForward = new THREE.Vector3();
  sceneState.camera.getWorldDirection(fullForward);
  if (fullForward.lengthSq() < 0.000001) {
    return planarBasis;
  }
  fullForward.normalize();

  const tiltMix = clamp((Math.abs(inputState.pitch) - 0.34) / 0.5, 0, 1);
  const forward = planarBasis.forward.clone().lerp(fullForward, tiltMix);
  if (forward.lengthSq() < 0.000001) {
    forward.copy(planarBasis.forward);
  } else {
    forward.normalize();
  }

  return {
    forward,
    right: planarBasis.right,
  };
}

function yawFromVector(vector) {
  return normalizeAngle(Math.atan2(-vector.x, -vector.z));
}

function computeLookAngles(from, to) {
  const delta = new THREE.Vector3().subVectors(to, from);
  const horizontal = Math.max(0.0001, Math.hypot(delta.x, delta.z));
  return {
    yaw: normalizeAngle(Math.atan2(-delta.x, -delta.z)),
    pitch: clamp(Math.atan2(delta.y, horizontal), CAMERA.lookMin, CAMERA.lookMax),
  };
}

function getNavigationPosition() {
  return state.navigationPosition;
}

function getPlayerLookTarget(position = state.navigationPosition) {
  return position.clone().add(new THREE.Vector3(0, PLAYER_VIEW.lookHeight, 0));
}

function getCameraForwardVector(yaw = inputState.yaw, pitch = inputState.pitch) {
  const cosPitch = Math.cos(pitch);
  return new THREE.Vector3(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  ).normalize();
}

function isPostFocusModeActive() {
  return state.postFocusMixTarget > 0.001 || state.postFocusMix > 0.001;
}

function setPostFocusMode(active, tagId = null) {
  if (active) {
    if (state.postFocusMixTarget < 0.5) {
      state.focusReturnRadius = state.cameraRadius;
    }
    state.postFocusTagId = tagId ?? state.focusedResult?.destination?.tag_id ?? state.postFocusTagId;
    state.postFocusMixTarget = 0.62;
    return;
  }
  state.postFocusMixTarget = 0;
  state.postFocusTagId = null;
  state.cameraRadius = clamp(
    state.focusReturnRadius || state.cameraRadius,
    PLAYER_VIEW.minRadius,
    PLAYER_VIEW.maxRadius,
  );
}

function shouldPreservePostFocusForTag(tagId) {
  return !state.postFocusTagId || state.postFocusTagId === tagId || state.postFocusMixTarget < 0.5;
}

function syncCameraToFollowTarget() {
  if (!sceneState.camera) {
    return;
  }
  const target = getPlayerLookTarget();
  const radius = clamp(state.cameraRadius, PLAYER_VIEW.minRadius, PLAYER_VIEW.maxRadius);
  const cosPitch = Math.cos(inputState.pitch);
  const thirdPersonPosition = new THREE.Vector3(
    target.x + Math.sin(inputState.yaw) * cosPitch * radius,
    target.y - Math.sin(inputState.pitch) * radius,
    target.z + Math.cos(inputState.yaw) * cosPitch * radius,
  );
  const firstPersonPosition = target.clone();
  const firstPersonLookTarget = target.clone().addScaledVector(getCameraForwardVector(), 48);
  const focusMix = clamp(state.postFocusMix, 0, 1);
  sceneState.camera.position.copy(thirdPersonPosition.lerp(firstPersonPosition, focusMix));
  sceneState.camera.lookAt(target.clone().lerp(firstPersonLookTarget, focusMix));
}

function aimCameraAt(position, target) {
  state.navigationPosition.copy(target).add(new THREE.Vector3(0, -PLAYER_VIEW.lookHeight, 0));
  state.cameraRadius = clamp(
    position.distanceTo(target),
    PLAYER_VIEW.minRadius,
    PLAYER_VIEW.maxRadius,
  );
  const { yaw, pitch } = computeLookAngles(position, target);
  inputState.yaw = yaw;
  inputState.pitch = pitch;
  syncCameraToFollowTarget();
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncateText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function fitCanvasText(context, value, maxWidth) {
  let text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  while (text.length > 1 && context.measureText(`${text}...`).width > maxWidth) {
    text = text.slice(0, -1).trimEnd();
  }
  return `${text || ""}...`;
}

function wrapCanvasText(context, value, maxWidth, maxLines = 2) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current);
    if (lines.length >= maxLines - 1) {
      const remainder = [word, ...words.slice(index + 1)].join(" ");
      lines.push(fitCanvasText(context, remainder, maxWidth));
      return lines;
    }
    current = word;
  }

  if (current) {
    lines.push(fitCanvasText(context, current, maxWidth));
  }

  return lines.slice(0, maxLines);
}

function hashString(value) {
  let hash = 0;
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickAccent(seed, offset = 0) {
  return WORLD_STYLE.accents[(hashString(seed) + offset) % WORLD_STYLE.accents.length];
}

function pickAccentSet(seed) {
  return {
    primary: pickAccent(seed, 0),
    secondary: pickAccent(seed, 2),
    tertiary: pickAccent(seed, 4),
  };
}

function isCellWithinWindow(cellX, cellZ, window = state.activeCellWindow) {
  if (!window || !Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
    return true;
  }
  return (
    cellX >= window.cell_x_min
    && cellX <= window.cell_x_max
    && cellZ >= window.cell_z_min
    && cellZ <= window.cell_z_max
  );
}

function expandCellWindow(window = state.activeCellWindow, padding = 0) {
  if (!window) {
    return null;
  }
  const extra = Math.max(0, Math.floor(Number(padding) || 0));
  return {
    cell_x_min: window.cell_x_min - extra,
    cell_x_max: window.cell_x_max + extra,
    cell_z_min: window.cell_z_min - extra,
    cell_z_max: window.cell_z_max + extra,
  };
}

function getPillarCacheKey(entry) {
  return String(entry?.pillar_id ?? "");
}

function getTagCacheKey(entry) {
  return `${entry?.pillar_id ?? ""}:${entry?.tag_id ?? ""}`;
}

function getPostCacheKey(entry) {
  return `${entry?.post_id ?? ""}:${entry?.tag_id ?? ""}`;
}

function isVisibleWorldPost(entry) {
  return entry?.display_tier !== "hidden";
}

function getPillarRenderPadding() {
  return Math.max(WORLD_STREAM.renderPadding, getPillarLodSettings().streamPaddingCells);
}

function getPillarRetainPadding() {
  return Math.max(WORLD_STREAM.retainPadding, getPillarRenderPadding() + 1);
}

function getTagRenderPadding() {
  return Math.max(WORLD_STREAM.renderPadding, getTagLodSettings().streamPaddingCells);
}

function getTagRetainPadding() {
  return Math.max(WORLD_STREAM.retainPadding, getTagRenderPadding() + 1);
}

function mergeStreamIntoCache(streamPayload) {
  for (const pillar of streamPayload.pillars ?? []) {
    state.worldCache.pillars.set(getPillarCacheKey(pillar), pillar);
  }
  for (const tag of streamPayload.tags ?? []) {
    state.worldCache.tags.set(getTagCacheKey(tag), tag);
  }
  for (const post of streamPayload.postInstances ?? []) {
    state.worldCache.posts.set(getPostCacheKey(post), post);
  }
}

function pruneWorldCache() {
  const window = state.activeCellWindow;
  if (!window) {
    return;
  }
  const minX = window.cell_x_min - WORLD_STREAM.retainPadding;
  const maxX = window.cell_x_max + WORLD_STREAM.retainPadding;
  const minZ = window.cell_z_min - WORLD_STREAM.retainPadding;
  const maxZ = window.cell_z_max + WORLD_STREAM.retainPadding;
  const pillarPadding = getPillarRetainPadding();
  const tagPadding = getTagRetainPadding();
  const pillarMinX = window.cell_x_min - pillarPadding;
  const pillarMaxX = window.cell_x_max + pillarPadding;
  const pillarMinZ = window.cell_z_min - pillarPadding;
  const pillarMaxZ = window.cell_z_max + pillarPadding;
  const tagMinX = window.cell_x_min - tagPadding;
  const tagMaxX = window.cell_x_max + tagPadding;
  const tagMinZ = window.cell_z_min - tagPadding;
  const tagMaxZ = window.cell_z_max + tagPadding;
  const shouldKeep = (entry, bounds) =>
    !Number.isFinite(entry?.cell_x)
    || !Number.isFinite(entry?.cell_z)
    || (
      entry.cell_x >= bounds.minX
      && entry.cell_x <= bounds.maxX
      && entry.cell_z >= bounds.minZ
      && entry.cell_z <= bounds.maxZ
    );

  for (const [key, entry] of state.worldCache.pillars.entries()) {
    if (!shouldKeep(entry, {
      minX: pillarMinX,
      maxX: pillarMaxX,
      minZ: pillarMinZ,
      maxZ: pillarMaxZ,
    })) {
      state.worldCache.pillars.delete(key);
    }
  }
  for (const [key, entry] of state.worldCache.tags.entries()) {
    if (!shouldKeep(entry, {
      minX: tagMinX,
      maxX: tagMaxX,
      minZ: tagMinZ,
      maxZ: tagMaxZ,
    })) {
      state.worldCache.tags.delete(key);
    }
  }
  for (const [key, entry] of state.worldCache.posts.entries()) {
    if (!shouldKeep(entry, { minX, maxX, minZ, maxZ })) {
      state.worldCache.posts.delete(key);
    }
  }
}

function filterPresenceRows(presence = []) {
  return presence.filter((entry) => {
    const viewerSessionId = entry?.viewer_session_id ?? entry?.viewerSessionId;
    return !viewerSessionId || viewerSessionId !== state.viewerSessionId;
  });
}

function getCachedWorldPayload(presence = []) {
  const window = state.activeCellWindow;
  const pillarPadding = getPillarRenderPadding();
  const tagPadding = getTagRenderPadding();
  const minX = window ? window.cell_x_min - WORLD_STREAM.renderPadding : Number.NEGATIVE_INFINITY;
  const maxX = window ? window.cell_x_max + WORLD_STREAM.renderPadding : Number.POSITIVE_INFINITY;
  const minZ = window ? window.cell_z_min - WORLD_STREAM.renderPadding : Number.NEGATIVE_INFINITY;
  const maxZ = window ? window.cell_z_max + WORLD_STREAM.renderPadding : Number.POSITIVE_INFINITY;
  const pillarMinX = window ? window.cell_x_min - pillarPadding : Number.NEGATIVE_INFINITY;
  const pillarMaxX = window ? window.cell_x_max + pillarPadding : Number.POSITIVE_INFINITY;
  const pillarMinZ = window ? window.cell_z_min - pillarPadding : Number.NEGATIVE_INFINITY;
  const pillarMaxZ = window ? window.cell_z_max + pillarPadding : Number.POSITIVE_INFINITY;
  const tagMinX = window ? window.cell_x_min - tagPadding : Number.NEGATIVE_INFINITY;
  const tagMaxX = window ? window.cell_x_max + tagPadding : Number.POSITIVE_INFINITY;
  const tagMinZ = window ? window.cell_z_min - tagPadding : Number.NEGATIVE_INFINITY;
  const tagMaxZ = window ? window.cell_z_max + tagPadding : Number.POSITIVE_INFINITY;
  const shouldRender = (entry, bounds) =>
    !window
    || !Number.isFinite(entry?.cell_x)
    || !Number.isFinite(entry?.cell_z)
    || (
      entry.cell_x >= bounds.minX
      && entry.cell_x <= bounds.maxX
      && entry.cell_z >= bounds.minZ
      && entry.cell_z <= bounds.maxZ
    );

  const postInstances = [...state.worldCache.posts.values()]
    .filter((entry) => shouldRender(entry, { minX, maxX, minZ, maxZ }))
    .sort((left, right) => (right.popularity_score ?? 0) - (left.popularity_score ?? 0));
  const renderableTagIds = new Set(
    postInstances
      .filter(isVisibleWorldPost)
      .map((entry) => entry.tag_id),
  );

  return {
    pillars: [...state.worldCache.pillars.values()]
      .filter((entry) => shouldRender(entry, {
        minX: pillarMinX,
        maxX: pillarMaxX,
        minZ: pillarMinZ,
        maxZ: pillarMaxZ,
      }))
      .sort((left, right) => (right.importance_score ?? 0) - (left.importance_score ?? 0)),
    tags: [...state.worldCache.tags.values()]
      .filter((entry) => shouldRender(entry, {
        minX: tagMinX,
        maxX: tagMaxX,
        minZ: tagMinZ,
        maxZ: tagMaxZ,
      }))
      .filter((entry) => renderableTagIds.has(entry.tag_id))
      .sort((left, right) => (right.active_post_count ?? 0) - (left.active_post_count ?? 0)),
    postInstances,
    presence: filterPresenceRows(presence),
  };
}

function formatQueueLabel(status) {
  if (status === "processing") {
    return "Queue processing";
  }
  if (status === "queued") {
    return "Queued for world";
  }
  return "Live in world";
}

function resolveResultQueueStatus(result) {
  if (result?.destination) {
    return "ready";
  }
  return result?.worldQueueStatus || "queued";
}

function normalizeWorldResult(result) {
  if (!result) {
    return result;
  }
  return {
    ...result,
    worldQueueStatus: resolveResultQueueStatus(result),
  };
}

async function postJson(path, body) {
  const response = await fetch(mauworldApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function disposeMaterial(material) {
  if (!material) {
    return;
  }
  const textures = ["map", "alphaMap", "emissiveMap"];
  for (const key of textures) {
    if (material[key]) {
      material[key].dispose();
    }
  }
  material.dispose();
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (node.geometry) {
        node.geometry.dispose();
      }
      if (Array.isArray(node.material)) {
        node.material.forEach(disposeMaterial);
      } else {
        disposeMaterial(node.material);
      }
    });
  }
}

function showToast(message, durationMs = 3600) {
  if (!elements.toast) {
    return;
  }
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, durationMs);
}

function setSearchStatus(text) {
  if (elements.searchStatus) {
    elements.searchStatus.textContent = text;
  }
}

function clearSearchResults() {
  state.searchPayload = null;
  state.searchSubmitted = false;
  elements.resultsPanel?.classList.add("is-empty");
  if (elements.results) {
    elements.results.innerHTML = "";
  }
  setSearchStatus("");
}

function clearSearchQuery() {
  const searchInput = elements.searchForm?.querySelector('input[name="q"]');
  if (searchInput) {
    searchInput.value = "";
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  document.body.classList.toggle("is-world-loading", isLoading);
  if (elements.loading) {
    elements.loading.setAttribute("aria-hidden", String(!isLoading));
  }
  updateStagePanel();
}

function summarizeBodyMarkdown(markdown, fallback = "", maxLength = 220) {
  const source = String(markdown ?? "").trim();
  if (!source) {
    return truncateText(fallback, maxLength) || "No body text.";
  }
  const cleaned = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(Source:|Author:|Community:|Imported:|Focus:)/i.test(line))
    .join(" ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(cleaned || fallback, maxLength) || "No body text.";
}

function renderInlinePostMarkup(value) {
  const source = String(value ?? "");
  if (!source) {
    return "";
  }
  const pattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(https?:\/\/[^\s<]+)/g;
  let html = "";
  let lastIndex = 0;

  const renderLink = (href, label) => {
    try {
      const safeHref = new URL(href, window.location.href).toString();
      if (!/^https?:/i.test(safeHref)) {
        return htmlEscape(label);
      }
      return `<a href="${htmlEscape(safeHref)}" target="_blank" rel="noreferrer">${htmlEscape(label)}</a>`;
    } catch {
      return htmlEscape(label);
    }
  };

  for (const match of source.matchAll(pattern)) {
    html += htmlEscape(source.slice(lastIndex, match.index));
    if (match[1]) {
      html += renderLink(match[1], "Image");
    } else if (match[2] && match[3]) {
      html += renderLink(match[3], match[2]);
    } else if (match[4]) {
      html += `<code>${htmlEscape(match[4])}</code>`;
    } else if (match[5]) {
      html += `<strong>${htmlEscape(match[5])}</strong>`;
    } else if (match[6]) {
      html += `<em>${htmlEscape(match[6])}</em>`;
    } else if (match[7]) {
      html += renderLink(match[7], match[7]);
    }
    lastIndex = match.index + match[0].length;
  }

  html += htmlEscape(source.slice(lastIndex));
  return html;
}

function renderFullPostBody(markdown, fallback = "") {
  const source = String(markdown ?? fallback ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) {
    return '<p class="world-selected__paragraph is-empty">No body text.</p>';
  }

  const blocks = [];
  const paragraphLines = [];
  let listType = "";
  let listItems = [];
  let inCodeBlock = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push(
      `<p class="world-selected__paragraph">${renderInlinePostMarkup(paragraphLines.join(" "))}</p>`,
    );
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = "";
      listItems = [];
      return;
    }
    const tagName = listType === "ol" ? "ol" : "ul";
    blocks.push(
      `<${tagName} class="world-selected__list">${listItems
        .map((item) => `<li>${renderInlinePostMarkup(item)}</li>`)
        .join("")}</${tagName}>`,
    );
    listType = "";
    listItems = [];
  };

  const flushCode = () => {
    if (!inCodeBlock) {
      return;
    }
    blocks.push(
      `<pre class="world-selected__code"><code>${htmlEscape(codeLines.join("\n"))}</code></pre>`,
    );
    inCodeBlock = false;
    codeLines = [];
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCode();
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(4, headingMatch[1].length + 1);
      blocks.push(
        `<h${level} class="world-selected__heading world-selected__heading--h${level}">${renderInlinePostMarkup(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push(
        `<blockquote class="world-selected__quote">${renderInlinePostMarkup(quoteMatch[1])}</blockquote>`,
      );
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();

  return blocks.join("") || '<p class="world-selected__paragraph is-empty">No body text.</p>';
}

function hasSearchIntent() {
  const formData = new FormData(elements.searchForm);
  return Boolean(
    state.searchSubmitted
    || String(formData.get("q") ?? "").trim()
    || String(formData.get("tag") ?? "").trim(),
  );
}

function createLabelTexture(lines, options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 640;
  const height = options.height ?? 320;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const background = options.background ?? "rgba(255, 255, 255, 0.96)";
  const border = options.border ?? "rgba(51, 64, 122, 0.14)";
  const accent = options.accent ?? WORLD_STYLE.accents[1];
  const bodyColor = options.bodyColor ?? WORLD_STYLE.ink;
  const mutedColor = options.mutedColor ?? WORLD_STYLE.muted;

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.lineWidth = 6;
  context.strokeStyle = border;
  context.strokeRect(3, 3, width - 6, height - 6);
  context.fillStyle = accent;
  context.fillRect(0, 0, width, 14);

  const title = lines[0] ?? "";
  const subtitle = lines[1] ?? "";
  const detail = lines[2] ?? "";

  context.fillStyle = bodyColor;
  context.font = "700 44px Manrope, sans-serif";
  context.textBaseline = "top";
  context.fillText(truncateText(title, 28), 34, 42);

  context.fillStyle = mutedColor;
  context.font = "600 28px Manrope, sans-serif";
  context.fillText(truncateText(subtitle, 46), 34, 112);

  context.font = "500 24px Manrope, sans-serif";
  context.fillText(truncateText(detail, 56), 34, 164);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createCompactCardTexture(title, subtitle = "", options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 720;
  const height = options.height ?? 220;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const accent = options.accent ?? pickAccent(title);
  const background = options.background ?? "rgba(255, 255, 255, 0.98)";
  const border = options.border ?? accent;
  const bodyColor = options.bodyColor ?? WORLD_STYLE.ink;
  const mutedColor = options.mutedColor ?? WORLD_STYLE.muted;

  context.clearRect(0, 0, width, height);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(255, 255, 255, 0.78)";
  context.fillRect(14, 14, width - 28, height - 28);
  context.strokeStyle = "rgba(51, 64, 122, 0.12)";
  context.lineWidth = 2;
  context.strokeRect(13, 13, width - 26, height - 26);
  context.lineWidth = 8;
  context.strokeStyle = border;
  context.strokeRect(4, 4, width - 8, height - 8);
  context.fillStyle = accent;
  context.fillRect(0, 0, width, 12);
  context.fillRect(width - 84, height - 22, 56, 10);

  context.fillStyle = bodyColor;
  const titleFontSize = options.titleFontSize ?? 44;
  const titleLineHeight = options.titleLineHeight ?? Math.round(titleFontSize * 1.04);
  const titleMaxLines = Math.max(1, options.titleLines ?? 1);
  context.font = `800 ${titleFontSize}px Manrope, sans-serif`;
  context.textBaseline = "top";
  const titleLines = wrapCanvasText(context, title, width - 60, titleMaxLines);
  titleLines.forEach((line, index) => {
    context.fillText(line, 30, 34 + index * titleLineHeight);
  });

  if (subtitle) {
    context.fillStyle = mutedColor;
    const subtitleFontSize = options.subtitleFontSize ?? 28;
    context.font = `600 ${subtitleFontSize}px Manrope, sans-serif`;
    context.fillText(
      fitCanvasText(context, subtitle, width - 60),
      30,
      34 + titleLines.length * titleLineHeight + 16,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createTagTextTexture(label, options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 768;
  const height = options.height ?? 160;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const accent = options.accent ?? pickAccent(label);
  const secondary = options.secondary ?? WORLD_STYLE.outline;
  const text = `#${truncateText(label || "tag", 24)}`;

  context.clearRect(0, 0, width, height);
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.lineJoin = "round";
  context.font = "800 72px Manrope, sans-serif";
  context.lineWidth = 18;
  context.strokeStyle = accent;
  context.strokeText(text, width / 2, height / 2 - 8);
  context.lineWidth = 5;
  context.strokeStyle = secondary;
  context.strokeText(text, width / 2, height / 2 - 8);
  context.fillStyle = WORLD_STYLE.white;
  context.font = "800 72px Manrope, sans-serif";
  context.fillText(text, width / 2, height / 2 - 8);

  context.fillStyle = accent;
  context.fillRect(width * 0.24, height - 28, width * 0.52, 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createCircleTexture(options = {}) {
  const canvas = document.createElement("canvas");
  const size = options.size ?? 256;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const fill = options.fill ?? "rgba(248, 252, 247, 0.72)";
  const stroke = options.stroke ?? "rgba(46, 184, 184, 0.88)";
  const glow = options.glow ?? "rgba(46, 184, 184, 0.22)";

  context.clearRect(0, 0, size, size);
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  context.fillStyle = glow;
  context.fill();

  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.22, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();

  context.lineWidth = size * 0.04;
  context.strokeStyle = stroke;
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createPillarProxyTexture(options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 320;
  const height = options.height ?? 640;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const primary = options.primary ?? WORLD_STYLE.accents[0];
  const secondary = options.secondary ?? WORLD_STYLE.accents[1];
  const fill = options.fill ?? "rgba(255, 255, 255, 0.94)";
  const outline = options.outline ?? WORLD_STYLE.outline;
  const glow = options.glow ?? `${primary}33`;

  const drawRoundedRect = (x, y, rectWidth, rectHeight, radius) => {
    const safeRadius = Math.min(radius, rectWidth / 2, rectHeight / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + rectWidth - safeRadius, y);
    context.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + safeRadius);
    context.lineTo(x + rectWidth, y + rectHeight - safeRadius);
    context.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - safeRadius, y + rectHeight);
    context.lineTo(x + safeRadius, y + rectHeight);
    context.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  };

  const centerX = width / 2;
  const bodyWidth = width * 0.28;
  const bodyX = centerX - bodyWidth / 2;
  const bodyTop = height * 0.14;
  const bodyHeight = height * 0.7;
  const capHeight = height * 0.065;
  const bandWidth = bodyWidth * 1.26;
  const bandX = centerX - bandWidth / 2;
  const baseY = bodyTop + bodyHeight;

  context.clearRect(0, 0, width, height);

  const glowGradient = context.createRadialGradient(
    centerX,
    bodyTop + bodyHeight * 0.28,
    bodyWidth * 0.12,
    centerX,
    bodyTop + bodyHeight * 0.28,
    width * 0.34,
  );
  glowGradient.addColorStop(0, glow);
  glowGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glowGradient;
  context.beginPath();
  context.ellipse(centerX, bodyTop + bodyHeight * 0.28, width * 0.26, height * 0.34, 0, 0, Math.PI * 2);
  context.fill();

  drawRoundedRect(bodyX, bodyTop, bodyWidth, bodyHeight, bodyWidth * 0.42);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = width * 0.028;
  context.strokeStyle = outline;
  context.stroke();

  context.fillStyle = primary;
  drawRoundedRect(centerX - bodyWidth * 0.72, bodyTop - capHeight * 0.46, bodyWidth * 1.44, capHeight, capHeight * 0.48);
  context.fill();

  context.fillStyle = secondary;
  for (const offset of [0.24, 0.48, 0.7]) {
    drawRoundedRect(bandX, bodyTop + bodyHeight * offset, bandWidth, height * 0.032, height * 0.016);
    context.fill();
  }

  context.fillStyle = `${secondary}66`;
  context.beginPath();
  context.ellipse(centerX, bodyTop + bodyHeight * 0.12, bodyWidth * 0.72, height * 0.055, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = `${primary}55`;
  context.beginPath();
  context.ellipse(centerX, baseY + height * 0.018, bodyWidth * 0.92, height * 0.042, 0, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMascotProxyTexture(options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 256;
  const height = options.height ?? 320;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const primary = options.primary ?? WORLD_STYLE.accents[0];
  const secondary = options.secondary ?? WORLD_STYLE.accents[1];
  const outline = options.outline ?? WORLD_STYLE.outline;

  const drawRoundedRect = (x, y, rectWidth, rectHeight, radius) => {
    const safeRadius = Math.min(radius, rectWidth / 2, rectHeight / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + rectWidth - safeRadius, y);
    context.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + safeRadius);
    context.lineTo(x + rectWidth, y + rectHeight - safeRadius);
    context.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - safeRadius, y + rectHeight);
    context.lineTo(x + safeRadius, y + rectHeight);
    context.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  };

  context.clearRect(0, 0, width, height);

  context.fillStyle = `${primary}26`;
  context.beginPath();
  context.ellipse(width * 0.5, height * 0.5, width * 0.34, height * 0.42, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.95)";
  context.strokeStyle = outline;
  context.lineWidth = width * 0.022;
  context.beginPath();
  context.arc(width * 0.5, height * 0.32, width * 0.16, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  drawRoundedRect(width * 0.37, height * 0.43, width * 0.26, height * 0.23, width * 0.08);
  context.fill();
  context.stroke();

  context.fillStyle = primary;
  context.beginPath();
  context.moveTo(width * 0.38, height * 0.23);
  context.lineTo(width * 0.31, height * 0.09);
  context.lineTo(width * 0.44, height * 0.18);
  context.closePath();
  context.fill();

  context.fillStyle = secondary;
  context.beginPath();
  context.moveTo(width * 0.62, height * 0.23);
  context.lineTo(width * 0.69, height * 0.09);
  context.lineTo(width * 0.56, height * 0.18);
  context.closePath();
  context.fill();

  context.fillStyle = outline;
  context.beginPath();
  context.arc(width * 0.46, height * 0.32, width * 0.015, 0, Math.PI * 2);
  context.arc(width * 0.54, height * 0.32, width * 0.015, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = `${primary}aa`;
  context.beginPath();
  context.ellipse(width * 0.5, height * 0.47, width * 0.16, height * 0.038, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = `${secondary}cc`;
  context.beginPath();
  context.arc(width * 0.5, height * 0.78, width * 0.05, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createConfettiTexture(options = {}) {
  const canvas = document.createElement("canvas");
  const size = options.size ?? 192;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const fill = options.fill ?? "rgba(255, 255, 255, 0.98)";
  const stroke = options.stroke ?? "rgba(255, 255, 255, 0.46)";
  const fold = options.fold ?? "rgba(255, 255, 255, 0.3)";
  const width = size * 0.23;
  const height = size * 0.42;

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(size / 2, size / 2);
  context.rotate(Math.PI / 4);
  context.beginPath();
  context.moveTo(-width, -height * 0.78);
  context.lineTo(width, -height);
  context.lineTo(width * 1.06, height * 0.82);
  context.lineTo(-width * 0.94, height);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = size * 0.028;
  context.strokeStyle = stroke;
  context.stroke();
  context.beginPath();
  context.moveTo(-width * 0.7, -height * 0.16);
  context.lineTo(width * 0.74, height * 0.1);
  context.strokeStyle = fold;
  context.lineWidth = size * 0.02;
  context.stroke();
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function getToonGradientTexture() {
  if (toonGradientTexture) {
    return toonGradientTexture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  context.fillStyle = "#444444";
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = "#8d8d8d";
  context.fillRect(1, 0, 1, 1);
  context.fillStyle = "#d7d7d7";
  context.fillRect(2, 0, 1, 1);
  context.fillStyle = "#ffffff";
  context.fillRect(3, 0, 1, 1);

  toonGradientTexture = new THREE.CanvasTexture(canvas);
  toonGradientTexture.minFilter = THREE.NearestFilter;
  toonGradientTexture.magFilter = THREE.NearestFilter;
  toonGradientTexture.generateMipmaps = false;
  toonGradientTexture.needsUpdate = true;
  return toonGradientTexture;
}

function registerBillboard(mesh, persistent = false) {
  const registry = persistent ? sceneState.persistentBillboards : sceneState.billboards;
  if (!registry.includes(mesh)) {
    registry.push(mesh);
  }
}

function unregisterBillboard(mesh, persistent = false) {
  const registry = persistent ? sceneState.persistentBillboards : sceneState.billboards;
  const index = registry.indexOf(mesh);
  if (index >= 0) {
    registry.splice(index, 1);
  }
}

function unregisterBillboardsInGroup(root, persistent = false) {
  root.traverse((node) => {
    unregisterBillboard(node, persistent);
  });
}

function syncBillboardToCamera(mesh) {
  if (!mesh || !sceneState.camera) {
    return;
  }
  const parent = mesh.parent;
  if (!parent) {
    mesh.quaternion.copy(sceneState.camera.quaternion);
    return;
  }
  parent.getWorldQuaternion(billboardParentQuaternion);
  mesh.quaternion.copy(billboardParentQuaternion).invert().multiply(sceneState.camera.quaternion);
}

function getMeshMaterialOpacity(material) {
  if (!material) {
    return 1;
  }
  if (Array.isArray(material)) {
    return Math.max(0, ...material.map((entry) => getMeshMaterialOpacity(entry)));
  }
  return typeof material.opacity === "number" ? material.opacity : 1;
}

function isObjectHierarchyVisible(object) {
  let current = object;
  while (current) {
    if (current.visible === false) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function isClickablePayloadPickable(payload) {
  if (!payload?.mesh || !isObjectHierarchyVisible(payload.mesh)) {
    return false;
  }
  if (getMeshMaterialOpacity(payload.mesh.material) <= 0.12) {
    return false;
  }

  if (payload.type === "post") {
    const entry = getScenePostEntry(payload.data?.post_id, payload.data?.tag_id);
    return Boolean(
      entry
      && entry.targetVisible
      && entry.group.visible
      && entry.card.visible
      && entry.visibilityProgress > 0.22,
    );
  }

  if (payload.type === "tag") {
    const entry = getAnimatedTagEntry(payload.data?.tag_id);
    if (!entry || !entry.group.visible) {
      return false;
    }
    if (payload.mesh === entry.proxy) {
      return entry.proxy.visible && getMeshMaterialOpacity(entry.proxy.material) > 0.16;
    }
    if (payload.mesh === entry.label) {
      return entry.label.visible && getMeshMaterialOpacity(entry.label.material) > 0.16;
    }
    return getMeshMaterialOpacity(entry.center.material) > 0.16;
  }

  if (payload.type === "pillar") {
    return getMeshMaterialOpacity(payload.mesh.material) > 0.18;
  }

  return true;
}

function createBillboard(texture, width, height, options = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: options.depthTest ?? true,
    depthWrite: false,
    opacity: options.opacity ?? 1,
    fog: options.fog ?? true,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = options.renderOrder ?? 10;
  registerBillboard(mesh, options.persistent === true);
  return mesh;
}

function getPostCardLayout(entry) {
  const cardTextureWidth = 700;
  const cardTextureHeight = entry.display_tier === "hero" ? 272 : 248;
  const cardWidth = 8.6 + entry.size_factor * 4.8 + (entry.display_tier === "hero" ? 1.6 : 0);
  const cardHeight = cardWidth * (cardTextureHeight / cardTextureWidth);
  const elevation = cardHeight * 0.62;
  return {
    cardTextureWidth,
    cardTextureHeight,
    cardWidth,
    cardHeight,
    elevation,
  };
}

function createBranchConnection(start, end, options = {}) {
  const accent = options.accent ?? WORLD_STYLE.accents[1];
  const outerRadius = options.outerRadius ?? 0.11;
  const innerRadius = outerRadius * 0.54;
  const connectionLod = getConnectionLodSettings();
  const distance = start.distanceTo(end);
  const midpoint = start.clone().lerp(end, 0.5);
  midpoint.y += clamp(distance * 0.18, 2.6, 10.5);
  const curve = new THREE.CatmullRomCurve3([start.clone(), midpoint, end.clone()]);
  const segments = clamp(Math.round(distance * 2.4), 16, 42);
  const detailGroup = new THREE.Group();
  const lod = new THREE.LOD();
  lod.autoUpdate = true;

  const outer = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, outerRadius, 8, false),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: options.outerOpacity ?? 0.32,
      depthWrite: false,
      fog: false,
    }),
  );
  outer.renderOrder = 4;
  detailGroup.add(outer);

  const inner = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, innerRadius, 8, false),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(WORLD_STYLE.white),
      transparent: true,
      opacity: options.innerOpacity ?? 0.72,
      depthWrite: false,
      fog: false,
    }),
  );
  inner.renderOrder = 5;
  detailGroup.add(inner);

  const endpointRadius = outerRadius * 1.85;
  const startOrb = new THREE.Mesh(
    new THREE.SphereGeometry(endpointRadius, 10, 10),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      fog: false,
    }),
  );
  startOrb.position.copy(start);
  startOrb.renderOrder = 4;
  detailGroup.add(startOrb);

  const endOrb = new THREE.Mesh(
    new THREE.SphereGeometry(endpointRadius * 0.92, 10, 10),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      fog: false,
    }),
  );
  endOrb.position.copy(end);
  endOrb.renderOrder = 4;
  detailGroup.add(endOrb);

  const proxyGeometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
  const proxy = new THREE.Line(
    proxyGeometry,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: Math.max(options.outerOpacity ?? 0.32, 0.24),
      fog: false,
    }),
  );
  proxy.renderOrder = 4;
  proxy.visible = false;

  lod.addLevel(detailGroup, 0);
  lod.addLevel(proxy, connectionLod.proxyDistance, connectionLod.proxyHysteresis);
  return lod;
}

function createCloudTexture(options = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 640;
  const height = options.height ?? 320;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const fill = options.fill ?? "rgba(255, 255, 255, 0.96)";
  const stroke = options.stroke ?? "rgba(190, 226, 255, 0.98)";

  context.clearRect(0, 0, width, height);
  context.beginPath();
  context.moveTo(98, 214);
  context.bezierCurveTo(66, 168, 118, 120, 172, 132);
  context.bezierCurveTo(188, 84, 260, 76, 316, 112);
  context.bezierCurveTo(342, 70, 420, 78, 444, 128);
  context.bezierCurveTo(506, 112, 560, 158, 544, 214);
  context.lineTo(544, 240);
  context.lineTo(98, 240);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 10;
  context.strokeStyle = stroke;
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createOutlineShell(geometry, color, scale = 1.08) {
  const shell = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.BackSide,
      transparent: true,
      opacity: 1,
      fog: false,
    }),
  );
  shell.scale.setScalar(scale);
  return shell;
}

function configureSkylineBandTexture(texture, repeatX) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeatX, 1);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if (sceneState.renderer?.capabilities?.getMaxAnisotropy) {
    texture.anisotropy = sceneState.renderer.capabilities.getMaxAnisotropy();
  }
  texture.needsUpdate = true;
  return texture;
}

function buildSkylineBandSvg(seed, options = {}) {
  const accent = options.accent ?? pickAccent(seed, 0);
  const secondary = options.secondary ?? pickAccent(seed, 2);
  const width = options.width ?? 6144;
  const height = options.height ?? 1024;

  const baseY = Math.round(height * 0.72);
  let cursor = 0;
  let path = `M 0 ${baseY}`;
  const towerCount = 34;
  for (let index = 0; index < towerCount; index += 1) {
    const gap = 14 + (hashString(`${seed}-gap-${index}`) % 38);
    const buildingWidth = 46 + (hashString(`${seed}-width-${index}`) % 120);
    const buildingHeight = 88 + (hashString(`${seed}-height-${index}`) % 236);
    const roofInset = 8 + (hashString(`${seed}-roof-${index}`) % 20);
    const x0 = cursor + gap;
    const x1 = x0 + buildingWidth;
    const roofY = baseY - buildingHeight;
    const notchLeft = x0 + buildingWidth * 0.18;
    const notchRight = x1 - buildingWidth * 0.18;
    path += ` L ${x0} ${baseY} L ${x0} ${roofY + roofInset} L ${notchLeft} ${roofY + roofInset} L ${notchLeft} ${roofY} L ${notchRight} ${roofY} L ${notchRight} ${roofY + roofInset} L ${x1} ${roofY + roofInset} L ${x1} ${baseY}`;
    cursor = x1;
  }
  path += ` L ${width} ${baseY}`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="skylineFill-${seed}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.76" />
        </linearGradient>
        <linearGradient id="skylineGlow-${seed}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${secondary}" stop-opacity="0.34" />
          <stop offset="100%" stop-color="${accent}" stop-opacity="0.08" />
        </linearGradient>
        <filter id="skylineBlur-${seed}" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="transparent" />
      <path d="${path}" fill="url(#skylineGlow-${seed})" opacity="0.16" filter="url(#skylineBlur-${seed})" transform="translate(0,-4)" />
      <path d="${path}" fill="url(#skylineFill-${seed})" stroke="${accent}" stroke-width="6" stroke-linejoin="round" shape-rendering="geometricPrecision" />
      <path d="M 0 ${baseY} H ${width}" stroke="${secondary}" stroke-width="8" stroke-opacity="0.28" />
    </svg>
  `;
  return svg;
}

function createSkylineBandTexture(seed, options = {}) {
  const accent = options.accent ?? pickAccent(seed, 0);
  const secondary = options.secondary ?? pickAccent(seed, 2);
  const repeatX = options.repeatX ?? 6;
  const width = options.width ?? 6144;
  const height = options.height ?? 1024;
  const assetUrl = SKYLINE_BAND_ASSETS[seed];
  const cacheKey = assetUrl
    ? `${seed}:${assetUrl}:${repeatX}`
    : `${seed}:${accent}:${secondary}:${repeatX}:${width}:${height}`;
  if (skylineTextureCache.has(cacheKey)) {
    return skylineTextureCache.get(cacheKey);
  }

  const source = assetUrl
    ? assetUrl
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSkylineBandSvg(seed, { accent, secondary, width, height }))}`;
  const texture = configureSkylineBandTexture(new THREE.TextureLoader().load(source), repeatX);
  skylineTextureCache.set(cacheKey, texture);
  return texture;
}

function createFloatingTower(seed, options = {}) {
  const accents = pickAccentSet(seed);
  const towerWidth = options.width ?? 18;
  const towerDepth = options.depth ?? 16;
  const towerHeight = options.height ?? 140;
  const group = new THREE.Group();
  const bodies = [];
  const outlines = [];
  const bands = [];
  const segments = [
    { height: towerHeight * 0.52, scale: 1 },
    { height: towerHeight * 0.28, scale: 0.78 },
    { height: towerHeight * 0.18, scale: 0.58 },
  ];

  let offsetY = 0;
  segments.forEach((segment, index) => {
    const geometry = new THREE.BoxGeometry(
      towerWidth * segment.scale,
      segment.height,
      towerDepth * segment.scale,
    );
    const outline = createOutlineShell(geometry, pickAccent(seed, index), 1.08);
    outline.position.y = offsetY + segment.height / 2;
    group.add(outline);
    outlines.push(outline);

    const body = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(WORLD_STYLE.white),
        transparent: true,
        opacity: 0.22,
      }),
    );
    body.position.copy(outline.position);
    group.add(body);
    bodies.push(body);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(
        Math.max(towerWidth, towerDepth) * segment.scale * 0.78,
        0.46,
        10,
        36,
      ),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(pickAccent(seed, index + 1)),
        transparent: true,
        opacity: 0.28,
        fog: false,
      }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = offsetY + segment.height * 0.86;
    group.add(band);
    bands.push(band);

    offsetY += segment.height * 0.82;
  });

  const halo = createBillboard(
    createCircleTexture({
      fill: "rgba(255, 255, 255, 0.52)",
      stroke: accents.primary,
      glow: `${accents.secondary}33`,
    }),
    towerWidth * 1.6,
    towerWidth * 1.6,
    {
      opacity: 0.14,
      fog: false,
      renderOrder: 3,
    },
  );
  halo.position.y = offsetY + 12;
  group.add(halo);

  return {
    group,
    bodies,
    outlines,
    bands,
    halo,
  };
}

function createMascotFigure(seed, options = {}) {
  const accents = pickAccentSet(seed);
  const scale = options.scale ?? 1;
  const outlineColor = options.outlineColor ?? WORLD_STYLE.outline;
  const group = new THREE.Group();
  const detailGroup = new THREE.Group();
  const poseRoot = new THREE.Group();
  detailGroup.add(poseRoot);

  const bodyGeometry = new THREE.CapsuleGeometry(1.45 * scale, 2.4 * scale, 6, 16);
  const headGeometry = new THREE.SphereGeometry(2.15 * scale, 24, 24);
  const earGeometry = new THREE.ConeGeometry(0.8 * scale, 1.9 * scale, 16);
  const limbGeometry = new THREE.CapsuleGeometry(0.38 * scale, 1.3 * scale, 4, 10);

  const whiteMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(WORLD_STYLE.white) });
  const primaryMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(accents.primary) });
  const secondaryMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(accents.secondary) });
  const faceMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(outlineColor), fog: false });

  const bodyShell = createOutlineShell(bodyGeometry, outlineColor, 1.12);
  bodyShell.position.y = 4.2 * scale;
  poseRoot.add(bodyShell);

  const body = new THREE.Mesh(bodyGeometry, whiteMaterial);
  body.position.y = 4.2 * scale;
  poseRoot.add(body);

  const headShell = createOutlineShell(headGeometry, outlineColor, 1.12);
  headShell.position.y = 8.3 * scale;
  poseRoot.add(headShell);

  const head = new THREE.Mesh(headGeometry, whiteMaterial);
  head.position.y = 8.3 * scale;
  poseRoot.add(head);

  for (const side of [-1, 1]) {
    const earShell = createOutlineShell(earGeometry, accents.primary, 1.12);
    earShell.position.set(side * 1.45 * scale, 11 * scale, 0);
    earShell.rotation.z = side * 0.36;
    poseRoot.add(earShell);

    const ear = new THREE.Mesh(earGeometry, side > 0 ? primaryMaterial : secondaryMaterial);
    ear.position.copy(earShell.position);
    ear.rotation.copy(earShell.rotation);
    poseRoot.add(ear);

    const arm = new THREE.Mesh(limbGeometry, side > 0 ? secondaryMaterial : primaryMaterial);
    arm.position.set(side * 2.25 * scale, 4.9 * scale, 0.1 * scale);
    arm.rotation.z = side * 0.84;
    poseRoot.add(arm);
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.25 * scale, 10, 10), faceMaterial);
    eye.position.set(side * 0.72 * scale, 8.45 * scale, 1.92 * scale);
    poseRoot.add(eye);

    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.3 * scale, 10, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(side > 0 ? accents.primary : accents.secondary),
        transparent: true,
        opacity: 0.82,
        fog: false,
      }),
    );
    cheek.position.set(side * 1.2 * scale, 7.65 * scale, 1.8 * scale);
    poseRoot.add(cheek);
  }

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.9 * scale, 0.2 * scale, 10, 42),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accents.primary),
      transparent: true,
      opacity: 0.9,
      fog: false,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 5.6 * scale;
  poseRoot.add(halo);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.46 * scale, 16, 16),
    new THREE.MeshToonMaterial({ color: new THREE.Color(accents.tertiary) }),
  );
  orb.position.set(0, 12.8 * scale, 0);
  poseRoot.add(orb);

  let lod = null;
  let proxy = null;
  if (options.lod?.enabled) {
    lod = new THREE.LOD();
    lod.autoUpdate = options.lod.autoUpdate !== false;
    proxy = createBillboard(
      createMascotProxyTexture({
        primary: accents.primary,
        secondary: accents.secondary,
        outline: outlineColor,
      }),
      7.6 * scale,
      9.4 * scale,
      {
        opacity: 0.9,
        fog: false,
        renderOrder: 7,
      },
    );
    proxy.position.set(0, 6.1 * scale, 0);
    proxy.visible = false;
    lod.addLevel(detailGroup, 0);
    lod.addLevel(proxy, options.lod.distance ?? 150, options.lod.hysteresis ?? 0.12);
    group.add(lod);
  } else {
    group.add(detailGroup);
  }

  return {
    group,
    detailGroup,
    poseRoot,
    halo,
    orb,
    lod,
    proxy,
    proxyBaseY: proxy?.position.y ?? 0,
  };
}

function getWorldBounds(streamPayload) {
  const points = [
    ...(streamPayload.pillars ?? []).map((entry) => ({
      x: entry.position_x,
      z: entry.position_z,
    })),
    ...(streamPayload.tags ?? []).map((entry) => ({
      x: entry.position_x,
      z: entry.position_z,
    })),
  ];

  if (points.length === 0 && state.meta?.bounds) {
    return {
      minX: state.meta.bounds.minX,
      maxX: state.meta.bounds.maxX,
      minZ: state.meta.bounds.minZ,
      maxZ: state.meta.bounds.maxZ,
    };
  }

  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z),
      maxZ: Math.max(bounds.maxZ, point.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
}

function getConfettiFieldBounds() {
  const fallbackCenterX = sceneState.snowBounds?.centerX
    ?? sceneState.camera?.position.x
    ?? state.navigationPosition.x;
  const fallbackCenterZ = sceneState.snowBounds?.centerZ
    ?? sceneState.camera?.position.z
    ?? state.navigationPosition.z;

  if (!state.meta?.bounds) {
    return {
      centerX: fallbackCenterX,
      centerZ: fallbackCenterZ,
      halfX: 320,
      halfZ: 380,
      minY: -36,
      maxY: Math.max(CAMERA.maxY + 64, 320),
    };
  }

  const centerX = (state.meta.bounds.minX + state.meta.bounds.maxX) / 2;
  const centerZ = (state.meta.bounds.minZ + state.meta.bounds.maxZ) / 2;
  const spanX = Math.max(1, state.meta.bounds.maxX - state.meta.bounds.minX);
  const spanZ = Math.max(1, state.meta.bounds.maxZ - state.meta.bounds.minZ);
  return {
    centerX,
    centerZ,
    halfX: Math.max(360, spanX * 1.15),
    halfZ: Math.max(420, spanZ * 1.2),
    minY: -36,
    maxY: Math.max(CAMERA.maxY + 72, 340),
  };
}

function resetConfettiField() {
  if (!sceneState.snow || !sceneState.snowData.length) {
    return;
  }

  const bounds = getConfettiFieldBounds();
  sceneState.snowBounds = bounds;
  const positions = sceneState.snow.geometry.attributes.position.array;
  const heightRange = bounds.maxY - bounds.minY;

  for (let index = 0; index < sceneState.snowData.length; index += 1) {
    const particle = sceneState.snowData[index];
    particle.x = bounds.centerX + (Math.random() - 0.5) * bounds.halfX * 2;
    particle.y = bounds.minY + Math.random() * heightRange;
    particle.baseY = particle.y;
    particle.z = bounds.centerZ + (Math.random() - 0.5) * bounds.halfZ * 2;
    positions[index * 3] = particle.x;
    positions[index * 3 + 1] = particle.y;
    positions[index * 3 + 2] = particle.z;
  }

  sceneState.snow.geometry.attributes.position.needsUpdate = true;
}

function syncConfettiFieldBounds() {
  sceneState.snowBounds = getConfettiFieldBounds();
}

function rebuildVirtualDecor(streamPayload) {
  sceneState.animatedDecor = [];
  clearGroup(sceneState.decor);

  const bounds = getWorldBounds(streamPayload);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minZ)) {
    return;
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(180, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.78);
  const mainPillar = [...(streamPayload.pillars ?? [])]
    .sort((left, right) => (right.importance_score ?? 0) - (left.importance_score ?? 0))[0];
  const gridY = -Math.max(72, span * 0.32);
  const gridExtent = span * 2.8;
  const minorStep = Math.max(18, Math.round(span / 12));
  const majorStep = minorStep * 4;
  const minorPositions = [];
  const majorPositions = [];

  for (let offset = -gridExtent / 2; offset <= gridExtent / 2; offset += minorStep) {
    const target = Math.round(offset);
    const bucket = Math.abs(target) % majorStep === 0 ? majorPositions : minorPositions;
    bucket.push(
      centerX + target,
      gridY,
      centerZ - gridExtent / 2,
      centerX + target,
      gridY,
      centerZ + gridExtent / 2,
    );
    bucket.push(
      centerX - gridExtent / 2,
      gridY,
      centerZ + target,
      centerX + gridExtent / 2,
      gridY,
      centerZ + target,
    );
  }

  const minorGrid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(minorPositions, 3),
    ),
    new THREE.LineBasicMaterial({
      color: new THREE.Color("#b7dcff"),
      transparent: true,
      opacity: 0.05,
      fog: false,
    }),
  );
  const majorGrid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(majorPositions, 3),
    ),
    new THREE.LineBasicMaterial({
      color: new THREE.Color("#ff8fc8"),
      transparent: true,
      opacity: 0.08,
      fog: false,
    }),
  );
  sceneState.decor.add(minorGrid);
  sceneState.decor.add(majorGrid);
  sceneState.animatedDecor.push({
    kind: "altitude-grid",
    minor: minorGrid,
    major: majorGrid,
    gridY,
  });

  for (let index = 0; index < 4; index += 1) {
    const curve = new THREE.EllipseCurve(
      0,
      0,
      span * (0.34 + index * 0.15),
      span * (0.2 + index * 0.11),
      0,
      Math.PI * 2,
      false,
      index * 0.36,
    );
    const points = curve.getPoints(160).map(
      (point) => new THREE.Vector3(centerX + point.x, -1.4 + index * 0.04, centerZ + point.y),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(
      geometry,
      new THREE.LineBasicMaterial({
        color: new THREE.Color(pickAccent(`floor-${index}`)),
        transparent: true,
        opacity: 0.14,
        fog: false,
      }),
    );
    sceneState.decor.add(line);
  }

  for (let index = 0; index < 16; index += 1) {
    const angle = index * ((Math.PI * 2) / 16) + (index % 2) * 0.12;
    const radiusX = span * (1.5 + (index % 4) * 0.08);
    const radiusZ = span * (1.72 + (index % 3) * 0.1);
    const x = centerX + Math.cos(angle) * radiusX;
    const z = centerZ + Math.sin(angle) * radiusZ;
    const baseY = 44 + (index % 5) * 16;
    const tower = createFloatingTower(`skyline-${index}`, {
      width: 14 + (index % 4) * 3.5,
      depth: 12 + ((index + 1) % 3) * 3.2,
      height: 92 + (index % 6) * 24,
    });
    tower.group.position.set(x, baseY, z);
    tower.group.rotation.y = -angle + Math.PI / 2 + ((index % 3) - 1) * 0.08;
    sceneState.decor.add(tower.group);
    sceneState.animatedDecor.push({
      kind: "skyline",
      ...tower,
      anchor: new THREE.Vector3(x, baseY, z),
      baseY,
      bob: 0.18 + (index % 4) * 0.04,
      phase: index * 0.44,
      spin: ((index % 2 === 0 ? 1 : -1) * (0.006 + (index % 3) * 0.002)),
    });
  }

  [
    {
      seed: "skyline-band-primary",
      radius: Math.max(span * 5.8, 1200),
      height: 900 / 2,
      yOffset: 120,
      opacity: 0.18,
      repeatX: 6.8,
      drift: 0.18,
      scrollSpeed: 0.0022,
    },
    {
      seed: "skyline-band-secondary",
      radius: Math.max(span * 6.7, 1450),
      height: 1040 / 3,
      yOffset: 156,
      opacity: 0.11,
      repeatX: 5.4,
      drift: 0.14,
      scrollSpeed: -0.0012,
    },
  ].forEach((layer, index) => {
    const texture = createSkylineBandTexture(layer.seed, {
      accent: pickAccent(layer.seed, 0),
      secondary: pickAccent(layer.seed, 2),
      repeatX: layer.repeatX,
    });
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: layer.opacity,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 96, 1, true),
      material,
    );
    mesh.position.set(centerX, layer.yOffset + 180, centerZ);
    mesh.rotation.y = index * 0.18;
    mesh.frustumCulled = false;
    sceneState.decor.add(mesh);
    sceneState.animatedDecor.push({
      kind: "skyline-band",
      mesh,
      texture,
      radius: layer.radius,
      height: layer.height,
      yOffset: layer.yOffset,
      baseRotationY: mesh.rotation.y,
      baseOpacity: layer.opacity,
      drift: layer.drift,
      scrollSpeed: layer.scrollSpeed,
      phase: index * 1.4,
    });
  });

  if (mainPillar) {
    const accents = pickAccentSet(mainPillar.pillar_id);
    const orbitCenter = new THREE.Vector3(
      mainPillar.position_x,
      mainPillar.position_y + mainPillar.height * 0.58,
      mainPillar.position_z,
    );
    [accents.primary, accents.secondary, accents.tertiary].forEach((color, index) => {
      const baseRotationX = Math.PI / 2 + index * 0.14;
      const baseRotationY = index * 0.32;
      const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(mainPillar.radius * (2.3 + index * 0.68), 0.72, 10, 96),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.34,
          fog: false,
        }),
      );
      orbit.position.copy(orbitCenter);
      orbit.rotation.x = baseRotationX;
      orbit.rotation.y = baseRotationY;
      sceneState.decor.add(orbit);
      sceneState.animatedDecor.push({
        kind: "orbit",
        mesh: orbit,
        speed: (index % 2 === 0 ? 1 : -1) * (0.06 + index * 0.03),
        baseRotationX,
        baseRotationY,
        tiltAmplitudeX: 0.045 + index * 0.016,
        tiltAmplitudeY: 0.03 + index * 0.012,
        tiltSpeedX: 0.52 + index * 0.12,
        tiltSpeedY: 0.34 + index * 0.09,
        phase: index * 1.2,
      });
    });
  }

  const cloudTexture = createCloudTexture();
  [
    { x: centerX - span * 0.54, y: 188, z: centerZ - span * 0.2, width: 146, height: 74 },
    { x: centerX + span * 0.56, y: 212, z: centerZ - span * 0.08, width: 172, height: 88 },
    { x: centerX - span * 0.22, y: 236, z: centerZ + span * 0.42, width: 134, height: 68 },
    { x: centerX + span * 0.18, y: 176, z: centerZ + span * 0.52, width: 118, height: 60 },
  ].forEach((entry, index) => {
    const cloud = createBillboard(
      cloudTexture,
      entry.width,
      entry.height,
      {
        opacity: 0.82,
        fog: false,
        renderOrder: 1,
      },
    );
    cloud.position.set(entry.x, entry.y, entry.z);
    sceneState.decor.add(cloud);
    sceneState.animatedDecor.push({
      kind: "cloud",
      mesh: cloud,
      baseY: entry.y,
      floatRange: 5 + index * 1.2,
      phase: index * 1.4,
    });
  });

  for (let index = 0; index < 34; index += 1) {
    const spark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34 + (index % 4) * 0.12, 0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(pickAccent(`spark-${index}`)),
        transparent: true,
        opacity: 0.88,
        fog: false,
      }),
    );
    spark.position.set(
      centerX + Math.cos(index * 0.54) * (span * (0.18 + (index % 6) * 0.06)),
      34 + (index % 8) * 12,
      centerZ + Math.sin(index * 0.54) * (span * (0.16 + (index % 6) * 0.08)),
    );
    sceneState.decor.add(spark);
    sceneState.animatedDecor.push({
      kind: "spark",
      mesh: spark,
      baseY: spark.position.y,
      bob: 0.52 + (index % 5) * 0.08,
      phase: index * 0.34,
      spin: 0.38 + (index % 4) * 0.1,
    });
  }
}

function buildPillarObject(entry) {
  const pillar = entry.pillar ?? {};
  const accents = pickAccentSet(entry.pillar_id || pillar.title);
  const group = new THREE.Group();
  const anchor = new THREE.Vector3(entry.position_x, entry.position_y + entry.height * 0.5, entry.position_z);
  const detailGroup = new THREE.Group();
  group.position.set(entry.position_x, entry.position_y, entry.position_z);

  const pillarLod = getPillarLodSettings();
  const lod = new THREE.LOD();
  lod.autoUpdate = false;

  const pillarGeometry = new THREE.CylinderGeometry(entry.radius, entry.radius * 1.08, entry.height, 28, 1, false);
  const outline = createOutlineShell(pillarGeometry, accents.primary, 1.04);
  outline.position.y = entry.height / 2;
  detailGroup.add(outline);

  const baseMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(WORLD_STYLE.white),
    transparent: true,
    opacity: 0.88,
  });
  const pillarMesh = new THREE.Mesh(pillarGeometry, baseMaterial);
  pillarMesh.position.y = entry.height / 2;
  detailGroup.add(pillarMesh);

  const bands = [accents.primary, accents.secondary, accents.tertiary].map((color, index) => {
    const baseY = entry.height * (0.22 + index * 0.2);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(entry.radius * (1.14 + index * 0.09), 0.34 + index * 0.02, 10, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.86,
        fog: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = baseY;
    detailGroup.add(ring);
    return {
      mesh: ring,
      baseY,
      bobAmount: 0.36 + index * 0.12,
      bobSpeed: 0.62 + index * 0.14,
      phase: index * 0.9,
      pulse: 0.018 + index * 0.008,
    };
  });

  const capGeometry = new THREE.TorusGeometry(entry.radius * 1.16, Math.max(0.62, entry.radius * 0.08), 12, 40);
  const capMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(accents.secondary),
    transparent: true,
    opacity: 0.82,
    fog: false,
  });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.rotation.x = Math.PI / 2;
  cap.position.y = entry.height + 2.4;
  detailGroup.add(cap);

  const flowTexture = createCircleTexture({
    fill: "rgba(255, 255, 255, 0.74)",
    stroke: accents.secondary,
    glow: `${accents.primary}44`,
    size: 128,
  });
  const flowCount = clamp(Math.round(entry.height / 5), 12, 28);
  const flowPositions = new Float32Array(flowCount * 3);
  const flowData = Array.from({ length: flowCount }, (_, index) => {
    const angle = ((Math.PI * 2) / flowCount) * index + Math.random() * 0.45;
    const radius = entry.radius * (0.42 + Math.random() * 0.38);
    const lift = Math.random();
    flowPositions[index * 3] = Math.cos(angle) * radius;
    flowPositions[index * 3 + 1] = lift * entry.height;
    flowPositions[index * 3 + 2] = Math.sin(angle) * radius;
    return {
      angle,
      radius,
      offset: lift,
      speed: 0.08 + Math.random() * 0.16,
      spin: (Math.random() - 0.5) * 0.24,
    };
  });
  const flowGeometry = new THREE.BufferGeometry();
  const flowAttribute = new THREE.BufferAttribute(flowPositions, 3);
  flowAttribute.setUsage(THREE.DynamicDrawUsage);
  flowGeometry.setAttribute("position", flowAttribute);
  const flow = new THREE.Points(
    flowGeometry,
    new THREE.PointsMaterial({
      map: flowTexture,
      size: 1.18,
      transparent: true,
      opacity: 0.52,
      alphaTest: 0.02,
      depthWrite: false,
      fog: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    }),
  );
  flow.position.y = 0.8;
  detailGroup.add(flow);

  const crown = createBillboard(
    createCircleTexture({
      fill: "rgba(255, 255, 255, 0.72)",
      stroke: accents.primary,
      glow: `${accents.secondary}44`,
    }),
    entry.radius * 4.8,
    entry.radius * 4.8,
    {
      opacity: 0.24,
      fog: false,
      renderOrder: 6,
    },
  );
  crown.position.set(0, entry.height + 6.4, 0);
  detailGroup.add(crown);

  const label = createBillboard(
    createCompactCardTexture(
      pillar.title || "Pillar",
      `${pillar.tag_count ?? 0} tags`,
      {
        width: 660,
        height: 190,
        accent: accents.primary,
      },
    ),
    25,
    7.2,
  );
  label.position.set(0, entry.height + 15.2, 0);
  detailGroup.add(label);

  const proxy = createBillboard(
    createPillarProxyTexture({
      primary: accents.primary,
      secondary: accents.secondary,
      outline: accents.primary,
      glow: `${accents.secondary}2d`,
    }),
    Math.max(16, entry.radius * 3),
    Math.max(44, entry.height * 0.94),
    {
      opacity: 0.82,
      renderOrder: 5,
    },
  );
  proxy.position.set(0, entry.height * 0.47, 0);
  proxy.visible = false;

  lod.addLevel(detailGroup, 0);
  lod.addLevel(proxy, pillarLod.proxyDistance, pillarLod.proxyHysteresis);
  group.add(lod);
  if (sceneState.camera) {
    lod.update(sceneState.camera);
  }

  sceneState.animatedPillars.push({
    lod,
    detailGroup,
    anchor,
    body: pillarMesh,
    outline,
    bands,
    cap,
    capBaseY: cap.position.y,
    crown,
    label,
    flow,
    flowData,
    proxy,
    proxyBaseY: proxy.position.y,
    height: entry.height,
    phase: (hashString(entry.pillar_id || pillar.title) % 360) * 0.024,
    cellX: entry.cell_x,
    cellZ: entry.cell_z,
  });
  sceneState.clickable.push({
    mesh: pillarMesh,
    type: "pillar",
    data: entry,
  });
  return group;
}

function getTagWeight(entry) {
  return Math.max(
    0,
    Number(entry?.active_post_count ?? 0),
    Number(entry?.visible_post_count ?? 0),
  );
}

function computeTagHomeAnchor(entry) {
  const pillar = state.stream?.pillars?.find((row) => row.pillar_id === entry.pillar_id);
  if (!pillar) {
    return new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  }

  const siblings = (state.stream?.tags ?? [])
    .filter((row) => row.pillar_id === entry.pillar_id)
    .sort((left, right) =>
      getTagWeight(right) - getTagWeight(left)
      || Number(right.visible_post_count ?? 0) - Number(left.visible_post_count ?? 0)
      || Number(left.branch_depth ?? 0) - Number(right.branch_depth ?? 0)
      || String(left.tag_id).localeCompare(String(right.tag_id)));
  if (siblings.length === 0) {
    return new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  }

  const rankIndex = Math.max(0, siblings.findIndex((row) => row.tag_id === entry.tag_id));
  const weights = siblings.map((row) => getTagWeight(row));
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const rankMix = siblings.length <= 1 ? 0.72 : 1 - (rankIndex / Math.max(1, siblings.length - 1));
  const weightMix = maxWeight > minWeight
    ? (getTagWeight(entry) - minWeight) / Math.max(1, maxWeight - minWeight)
    : rankMix;
  const prominence = clamp(weightMix * 0.78 + rankMix * 0.22, 0, 1);
  const minOffset = Math.min(pillar.height - 18, Math.max(20, pillar.height * 0.24));
  const maxOffset = Math.min(pillar.height - 10, Math.max(minOffset + 20, pillar.height * 0.9));
  const yOffset = minOffset + (maxOffset - minOffset) * prominence;
  return new THREE.Vector3(
    entry.position_x,
    pillar.position_y + yOffset,
    entry.position_z,
  );
}

function buildTagObject(entry) {
  const tag = entry.tag ?? {};
  const accents = pickAccentSet(entry.tag_id || tag.label);
  const group = new THREE.Group();
  const detailGroup = new THREE.Group();
  const homeAnchor = computeTagHomeAnchor(entry);
  const tagLod = getTagLodSettings();
  const lod = new THREE.LOD();
  lod.autoUpdate = true;
  group.position.copy(homeAnchor);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.28, 10, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accents.primary),
      transparent: true,
      opacity: 0.58,
      fog: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  detailGroup.add(ring);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(4.4, 5.5, 40),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accents.secondary),
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.1;
  detailGroup.add(halo);

  const centerGeometry = new THREE.SphereGeometry(1.45, 18, 18);
  const outline = createOutlineShell(centerGeometry, accents.primary, 1.18);
  detailGroup.add(outline);

  const center = new THREE.Mesh(
    centerGeometry,
    new THREE.MeshToonMaterial({
      color: new THREE.Color(WORLD_STYLE.white),
      transparent: true,
      opacity: 0.96,
    }),
  );
  detailGroup.add(center);

  const beacon = createBillboard(
    createCircleTexture({
      fill: "rgba(255, 255, 255, 0.78)",
      stroke: accents.secondary,
      glow: `${accents.primary}44`,
    }),
    12,
    12,
    {
      opacity: 0.28,
      fog: false,
      renderOrder: 8,
    },
  );
  beacon.position.set(0, 0.2, 0);
  detailGroup.add(beacon);

  const labelWidth = clamp(15 + ((tag.label ?? "").length * 0.5), 18, 30);
  const labelHeight = labelWidth * (160 / 768);
  const label = createBillboard(
    createTagTextTexture(
      tag.label || "tag",
      {
        accent: accents.primary,
        secondary: accents.secondary,
      },
    ),
    labelWidth,
    labelHeight,
    {
      opacity: 0.76,
      fog: false,
      depthTest: false,
      renderOrder: 9,
    },
  );
  label.position.set(0, 7.9, 0);
  detailGroup.add(label);

  const proxyWidth = clamp(10 + ((tag.label ?? "").length * 0.32), 12, 20);
  const proxyHeight = proxyWidth * (140 / 640);
  const proxy = createBillboard(
    createTagTextTexture(
      tag.label || "tag",
      {
        accent: accents.primary,
        secondary: accents.secondary,
      },
    ),
    proxyWidth,
    proxyHeight,
    {
      opacity: 0.9,
      fog: false,
      depthTest: false,
      renderOrder: 8,
    },
  );
  proxy.position.set(0, 5.8, 0);
  proxy.visible = false;

  lod.addLevel(detailGroup, 0);
  lod.addLevel(proxy, tagLod.proxyDistance, tagLod.proxyHysteresis);
  group.add(lod);

  sceneState.animatedTags.push({
    tagId: entry.tag_id,
    group,
    lod,
    detailGroup,
    anchor: homeAnchor.clone(),
    homeAnchor: homeAnchor.clone(),
    displayAnchor: homeAnchor.clone(),
    outline,
    center,
    ring,
    halo,
    beacon,
    label,
    proxy,
    proxyBaseY: proxy.position.y,
    cellX: entry.cell_x,
    cellZ: entry.cell_z,
    speed: 0.18 + entry.branch_depth * 0.05,
  });
  sceneState.clickable.push(
    {
      mesh: center,
      type: "tag",
      data: entry,
    },
    {
      mesh: label,
      type: "tag",
      data: entry,
    },
    {
      mesh: proxy,
      type: "tag",
      data: entry,
    },
  );
  return group;
}

function buildPostObject(entry) {
  const post = entry.post ?? {};
  const accents = pickAccentSet(entry.post_id || post.title);
  const group = new THREE.Group();
  const anchor = new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  group.position.copy(anchor);
  group.visible = false;

  const color =
    entry.display_tier === "hero"
      ? accents.primary
      : entry.display_tier === "standard"
        ? accents.secondary
        : accents.tertiary;
  const {
    cardTextureWidth,
    cardTextureHeight,
    cardWidth,
    cardHeight,
    elevation,
  } = getPostCardLayout(entry);

  const card = createBillboard(
    createCompactCardTexture(
      post.title || truncateText(post.body_plain || "Post", 28),
      "",
      {
        width: cardTextureWidth,
        height: cardTextureHeight,
        accent: color,
        border: accents.primary,
        titleLines: entry.display_tier === "hero" ? 3 : 2,
        titleFontSize: entry.display_tier === "hero" ? 46 : 42,
        titleLineHeight: entry.display_tier === "hero" ? 48 : 44,
      },
    ),
    cardWidth,
    cardHeight,
    {
      opacity: 0.9,
      renderOrder: 10,
    },
  );
  card.position.set(0, elevation, 0);
  group.add(card);

  const baseMarker = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(2.4, cardWidth * 0.16), 28),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  baseMarker.rotation.x = -Math.PI / 2;
  baseMarker.position.y = 0.18;
  group.add(baseMarker);

  const proxy = createBillboard(
    createCircleTexture({
      fill: "rgba(255, 255, 255, 0.22)",
      stroke: accents.primary,
      glow: `${accents.secondary}33`,
    }),
    Math.max(3.8, cardWidth * 0.42),
    Math.max(3.8, cardWidth * 0.42),
    {
      opacity: 0.16,
      fog: false,
      renderOrder: 8,
    },
  );
  proxy.position.set(0, elevation * 0.78, 0);
  group.add(proxy);

  sceneState.animatedPosts.push({
    tagId: entry.tag_id,
    postId: entry.post_id,
    group,
    card,
    baseMarker,
    proxy,
    anchor,
    homeAnchor: anchor.clone(),
    displayAnchor: anchor.clone(),
    cardWidth,
    cardHeight,
    cardElevation: elevation,
    cellX: entry.cell_x,
    cellZ: entry.cell_z,
    displayTier: entry.display_tier,
    sourceDisplayTier: entry.source_display_tier ?? entry.display_tier,
    rankInTag: entry.rank_in_tag ?? Number.MAX_SAFE_INTEGER,
    targetVisible: false,
    visibilityProgress: 0,
    visibilitySpeed: 10 + (hashString(`${entry.post_id}:${entry.tag_id}`) % 4),
    syntheticFocusReveal: entry.synthetic_focus_reveal === true,
  });

  const clickablePayload = {
    mesh: card,
    type: "post",
    data: entry,
  };
  sceneState.clickable.push(clickablePayload);
  return group;
}

function removeAnimatedPostEntry(entry) {
  if (!entry) {
    return;
  }
  unregisterBillboardsInGroup(entry.group);
  if (entry.group.parent) {
    entry.group.parent.remove(entry.group);
  }
  entry.group.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(node.material);
    }
  });
  const animatedIndex = sceneState.animatedPosts.indexOf(entry);
  if (animatedIndex >= 0) {
    sceneState.animatedPosts.splice(animatedIndex, 1);
  }
  sceneState.clickable = sceneState.clickable.filter((payload) => payload.mesh !== entry.card);
}

function buildPresenceObject(entry) {
  const actor = entry.actor ?? {};
  const group = new THREE.Group();
  group.position.set(entry.position_x, entry.position_y, entry.position_z);
  const seed = actor.id || actor.display_name || entry.actor_type;
  const color = entry.actor_type === "agent" ? pickAccent(seed, 1) : pickAccent(seed, 3);
  const actorLod = getActorLodSettings();
  const mascot = createMascotFigure(seed, {
    scale: 0.72,
    outlineColor: color,
    lod: {
      enabled: true,
      autoUpdate: true,
      distance: actorLod.proxyDistance,
      hysteresis: actorLod.proxyHysteresis,
    },
  });
  group.add(mascot.group);

  const labelWidth = clamp(12 + String(actor.display_name || entry.actor_type || "agent").length * 0.28, 14, 24);
  const labelHeight = labelWidth * (160 / 768);
  const label = createBillboard(
    createTagTextTexture(
      actor.display_name || (entry.actor_type === "agent" ? "agent" : "visitor"),
      {
        accent: color,
        secondary: WORLD_STYLE.outline,
      },
    ),
    labelWidth,
    labelHeight,
    {
      opacity: 0.92,
      fog: false,
      depthTest: false,
      renderOrder: 9,
    },
  );
  label.position.set(0, 13.8, 0);
  group.add(label);

  sceneState.animatedPresence.push({
    group,
    lod: mascot.lod,
    halo: mascot.halo,
    orb: mascot.orb,
    orbBaseY: mascot.orb.position.y,
    proxy: mascot.proxy,
    proxyBaseY: mascot.proxyBaseY,
    label,
    baseY: entry.position_y,
    bob: 0.55 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
  });
  return group;
}

function syncLocalAvatar(elapsedSeconds = sceneState.clock.elapsedTime) {
  if (!sceneState.playerAvatar) {
    return;
  }
  const avatar = sceneState.playerAvatar;
  avatar.group.visible = state.postFocusMix < 0.55;
  const position = getNavigationPosition();
  const deltaSeconds = Math.max(1 / 240, avatar.lastSyncElapsed == null ? 1 / 60 : elapsedSeconds - avatar.lastSyncElapsed);
  avatar.lastSyncElapsed = elapsedSeconds;
  const { forward, right } = getCameraPlanarBasis();
  updateMascotMotion(avatar, {
    deltaSeconds,
    elapsedSeconds,
    nextPosition: position,
    maxSpeed: CAMERA.movementSpeed * 1.35,
    movementBasisForward: forward,
    movementBasisRight: right,
    idleFacingYaw: avatar.facingYaw,
    bobAmplitude: 0.16,
    bobSpeed: 1.6,
  });
}

function clearRouteGuide() {
  if (!sceneState.routeGuide) {
    return;
  }
  sceneState.routes.remove(sceneState.routeGuide.group);
  sceneState.routeGuide = null;
}

function cancelTravelAnimation() {
  state.travelAnimation = null;
  clearRouteGuide();
}

function buildTravelCurve(start, end) {
  const midpoint = start.clone().lerp(end, 0.5);
  midpoint.y += Math.min(22, 8 + start.distanceTo(end) * 0.06);
  return new THREE.CatmullRomCurve3([start.clone(), midpoint, end.clone()]);
}

function showRouteGuide(curve, color = WORLD_STYLE.accents[0]) {
  clearRouteGuide();
  const points = curve.getPoints(140);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.54,
      fog: false,
    }),
  );
  const startMarker = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.4, 28),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  startMarker.rotation.x = -Math.PI / 2;
  startMarker.position.copy(points[0]);
  const endMarker = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 4.2, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  endMarker.rotation.x = -Math.PI / 2;
  endMarker.position.copy(points[points.length - 1]);

  const group = new THREE.Group();
  group.add(line);
  group.add(startMarker);
  group.add(endMarker);
  sceneState.routes.add(group);
  sceneState.routeGuide = {
    group,
    line,
    startMarker,
    endMarker,
  };
}

function computeApproachAnchor(destination, distance = 12, lift = -6, sourcePosition = getNavigationPosition()) {
  const target = new THREE.Vector3(
    destination.position_x,
    destination.position_y,
    destination.position_z,
  );
  const approachVector = new THREE.Vector3(
    target.x - sourcePosition.x,
    0,
    target.z - sourcePosition.z,
  );
  if (approachVector.lengthSq() < 0.0001) {
    approachVector.copy(getFlatForwardVector(
      Number.isFinite(destination.heading_y) ? destination.heading_y : inputState.yaw,
    ));
  } else {
    approachVector.normalize();
  }
  const anchor = target.clone().sub(approachVector.multiplyScalar(distance));
  anchor.y = Math.max(CAMERA.minY, target.y + lift);
  return {
    anchor,
    yaw: yawFromVector(approachVector),
  };
}

function spawnTrailPuff(position, travelVector) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.position.y += 1.35;
  const radius = 0.3 + Math.random() * 0.16;
  const geometry = new THREE.SphereGeometry(radius, 16, 16);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshToonMaterial({
      color: new THREE.Color(WORLD_STYLE.white),
      gradientMap: getToonGradientTexture(),
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      fog: false,
    }),
  );
  const shell = createOutlineShell(geometry, WORLD_STYLE.trailOutline, 1.12);
  shell.material.opacity = 0.58;
  mesh.add(shell);
  group.add(mesh);

  const pieces = [{
    mesh,
    shell,
    velocity: new THREE.Vector3(
      -travelVector.x * 0.018 + (Math.random() - 0.5) * 0.18,
      0.08 + Math.random() * 0.1,
      -travelVector.z * 0.018 + (Math.random() - 0.5) * 0.18,
    ),
    growth: 0.18 + Math.random() * 0.16,
  }];
  sceneState.trails.add(group);
  sceneState.trailPuffs.push({
    group,
    pieces,
    age: 0,
    lifetime: 1.1 + Math.random() * 0.28,
    drift: new THREE.Vector3(
      -travelVector.x * 0.004,
      0.05 + Math.random() * 0.04,
      -travelVector.z * 0.004,
    ),
  });
}

function leaveMovementTrail(previousPosition, nextPosition, deltaSeconds) {
  const delta = new THREE.Vector3().subVectors(nextPosition, previousPosition);
  const distance = delta.length();
  if (distance < 0.02) {
    state.trailAccumulator = 0;
    return;
  }
  state.trailAccumulator += distance;
  if (state.trailAccumulator < 2.2 || deltaSeconds <= 0) {
    return;
  }
  state.trailAccumulator = 0;
  spawnTrailPuff(previousPosition.clone(), delta);
}

function startGuidedTravel(result) {
  if (!result?.destination) {
    renderSelected(result);
    showToast("This post is still queued for placement. The world route will appear once placement is ready.");
    return;
  }

  const start = getNavigationPosition().clone();
  const approach = computeApproachAnchor(result.destination, 11, -7, start);
  const end = approach.anchor;
  const curve = buildTravelCurve(start, end);
  const distance = start.distanceTo(end);
  const routeColor = pickAccent(result.destination.post_id || result.post?.title || "route");
  const enablePostFocus = shouldPreservePostFocusForTag(result.destination.tag_id);
  if (!enablePostFocus) {
    setPostFocusMode(false);
  }
  showRouteGuide(curve, routeColor);

  state.activeResultId = result.post?.id ?? state.activeResultId;
  state.focusedResult = result;
  state.openTagId = null;
  syncExpandedTagState();
  state.travelAnimation = {
    phase: "preview",
    previewStartedAt: performance.now(),
    travelStartedAt: 0,
    previewMs: 850,
    travelMs: clamp(Math.round(distance * 58), 2600, 7200),
    curve,
    fromRadius: state.cameraRadius,
    toRadius: clamp(20 + Math.min(8, distance * 0.03), PLAYER_VIEW.minRadius, PLAYER_VIEW.maxRadius),
    toYaw: approach.yaw,
    toPitch: clamp(0.18, CAMERA.lookMin, CAMERA.lookMax),
    result,
    enablePostFocus,
  };
  renderSelected(result);
  if (sceneState.floorMarker) {
    sceneState.floorMarker.visible = true;
    sceneState.floorMarker.position.set(result.destination.position_x, 0.2, result.destination.position_z);
  }
  loadStreamForPosition(end, true).catch((error) => showToast(error.message));
}

function clearFocusGhost() {
  unregisterBillboardsInGroup(sceneState.focusGhosts);
  clearGroup(sceneState.focusGhosts);
}

function hasVisibleFocusedPost(result) {
  if (!result?.destination || !state.stream?.postInstances) {
    return false;
  }
  if (state.openTagId !== result.destination.tag_id) {
    return false;
  }
  return state.stream.postInstances.some(
    (entry) =>
      entry.post_id === result.destination.post_id
      && entry.tag_id === result.destination.tag_id,
  );
}

function hasRenderableFocusedPost(result) {
  if (!result?.destination) {
    return false;
  }
  if (state.openTagId !== result.destination.tag_id) {
    return false;
  }
  return sceneState.animatedPosts.some(
    (entry) =>
      entry.postId === result.destination.post_id
      && entry.tagId === result.destination.tag_id,
  );
}

function hasPresenceCheckingFocusedPost(result) {
  if (!result?.destination || !state.stream?.presence?.length) {
    return false;
  }
  const anchor = new THREE.Vector3(
    result.destination.position_x,
    result.destination.position_y ?? 0,
    result.destination.position_z,
  );
  return state.stream.presence.some((entry) => {
    const position = new THREE.Vector3(
      entry.position_x ?? 0,
      entry.position_y ?? 0,
      entry.position_z ?? 0,
    );
    return position.distanceTo(anchor) <= 18;
  });
}

function hasNewerPostForFocusedNode(result) {
  if (!result?.destination || !state.stream?.postInstances?.length || !result.post?.created_at) {
    return false;
  }
  const focusedCreatedAt = new Date(result.post.created_at).getTime();
  if (!Number.isFinite(focusedCreatedAt)) {
    return false;
  }
  return state.stream.postInstances.some((entry) => {
    if (entry.tag_id !== result.destination.tag_id || entry.post_id === result.destination.post_id) {
      return false;
    }
    const createdAt = new Date(entry.post?.created_at ?? 0).getTime();
    return Number.isFinite(createdAt) && createdAt > focusedCreatedAt;
  });
}

function syncFocusedGhost() {
  clearFocusGhost();
  const result = state.focusedResult;
  const queueStatus = resolveResultQueueStatus(result);
  sceneState.visitorSystem?.syncQueuedResult(result, {
    interrupted: hasPresenceCheckingFocusedPost(result) || hasNewerPostForFocusedNode(result),
  });
  if (!result?.destination) {
    return;
  }
  const shouldGhost = queueStatus !== "ready" || !hasRenderableFocusedPost(result);
  if (!shouldGhost) {
    return;
  }

  const post = result.post ?? {};
  const accent = queueStatus === "ready" ? WORLD_STYLE.accents[1] : WORLD_STYLE.accents[0];
  const group = new THREE.Group();
  group.position.set(
    result.destination.position_x,
    result.destination.position_y,
    result.destination.position_z,
  );

  const ghostCardWidth = 15.5;
  const ghostCardHeight = ghostCardWidth * (200 / 640);
  const ghostSubtitle = queueStatus === "ready" ? "" : "Queued for world placement";
  const card = createBillboard(
    createCompactCardTexture(
      post.title || truncateText(post.body_plain || "Post", 26),
      ghostSubtitle,
      {
        width: 640,
        height: 200,
        accent,
        background: "rgba(255, 255, 255, 0.94)",
        titleLines: ghostSubtitle ? 1 : 2,
      },
    ),
    ghostCardWidth,
    ghostCardHeight,
    {
      opacity: 0.94,
      fog: false,
      depthTest: false,
      renderOrder: 11,
    },
  );
  card.position.set(0, 12.8, 0);
  group.add(card);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(7.2, 8.8, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.16;
  group.add(ring);

  sceneState.focusGhosts.add(group);
}

function getAnimatedTagEntry(tagId) {
  return sceneState.animatedTags.find((entry) => entry.tagId === tagId) ?? null;
}

function getRenderedTagAnchor(tag) {
  const animated = sceneState.animatedTags.find((entry) => entry.tagId === tag.tag_id);
  if (animated?.displayAnchor) {
    return animated.displayAnchor;
  }
  return computeTagHomeAnchor(tag);
}

function getRenderedTagAnchorById(tagId) {
  const animated = getAnimatedTagEntry(tagId);
  if (animated?.displayAnchor) {
    return animated.displayAnchor.clone();
  }
  const tag = state.stream?.tags?.find((entry) => entry.tag_id === tagId);
  if (tag) {
    return computeTagHomeAnchor(tag);
  }
  return null;
}

function getAnimatedPostEntry(postId, tagId = null) {
  return sceneState.animatedPosts.find((entry) =>
    entry.postId === postId && (tagId == null || entry.tagId === tagId)) ?? null;
}

function getScenePostEntry(postId, tagId, options = {}) {
  return sceneState.animatedPosts.find((entry) => {
    if (entry.postId !== postId || entry.tagId !== tagId) {
      return false;
    }
    if (options.syntheticOnly && !entry.syntheticFocusReveal) {
      return false;
    }
    if (options.excludeSynthetic && entry.syntheticFocusReveal) {
      return false;
    }
    return true;
  }) ?? null;
}

function buildFocusedRevealPostPayload() {
  const result = state.focusedResult;
  const queueStatus = resolveResultQueueStatus(result);
  if (queueStatus !== "ready" || !result?.destination) {
    return null;
  }
  if (state.openTagId !== result.destination.tag_id) {
    return null;
  }
  if (result.destination.display_tier !== "hidden") {
    return null;
  }

  const cellSize = Math.max(1, state.meta?.renderer?.lod?.cellSize ?? 64);
  const score = Math.max(0, Number(result.post?.score ?? 0));
  const commentCount = Math.max(0, Number(result.post?.comment_count ?? 0));
  const sizeFactor = clamp(0.96 + Math.log1p(score * 4 + commentCount * 2) / 4.8, 0.96, 1.26);

  return {
    world_snapshot_id: result.destination.world_snapshot_id ?? state.meta?.worldSnapshotId ?? null,
    post_id: result.destination.post_id,
    tag_id: result.destination.tag_id,
    position_x: result.destination.position_x,
    position_y: result.destination.position_y ?? 0,
    position_z: result.destination.position_z,
    heading_y: result.destination.heading_y ?? 0,
    display_tier: "standard",
    source_display_tier: result.destination.display_tier,
    rank_in_tag: Number.MAX_SAFE_INTEGER - 1,
    size_factor: sizeFactor,
    cell_x: Math.floor((result.destination.position_x ?? 0) / cellSize),
    cell_z: Math.floor((result.destination.position_z ?? 0) / cellSize),
    post: result.post ?? null,
    synthetic_focus_reveal: true,
  };
}

function syncFocusedRevealedPost() {
  const desired = buildFocusedRevealPostPayload();
  const syntheticEntry = sceneState.animatedPosts.find((entry) => entry.syntheticFocusReveal) ?? null;
  const actualEntry = desired
    ? getScenePostEntry(desired.post_id, desired.tag_id, { excludeSynthetic: true })
    : null;

  if (syntheticEntry) {
    const matchesDesired =
      desired
      && syntheticEntry.postId === desired.post_id
      && syntheticEntry.tagId === desired.tag_id;
    if (!matchesDesired || actualEntry) {
      removeAnimatedPostEntry(syntheticEntry);
    }
  }

  if (!desired || actualEntry || getScenePostEntry(desired.post_id, desired.tag_id, { syntheticOnly: true })) {
    return;
  }

  const group = buildPostObject(desired);
  sceneState.posts.add(group);
}

function getRenderedPostAnchor(post) {
  const animated = getAnimatedPostEntry(post.post_id, post.tag_id);
  if (animated?.displayAnchor) {
    return animated.displayAnchor;
  }
  return new THREE.Vector3(post.position_x, post.position_y, post.position_z);
}

function getRenderedPostAnchorById(postId, tagId, fallback = null) {
  const animated = getAnimatedPostEntry(postId, tagId);
  if (animated?.displayAnchor) {
    return animated.displayAnchor.clone();
  }
  if (fallback) {
    return fallback.clone();
  }
  return null;
}

function getPostLayoutBasis(tagId, tagAnchor) {
  const tag = state.stream?.tags?.find((entry) => entry.tag_id === tagId) ?? null;
  const pillar = tag
    ? state.stream?.pillars?.find((entry) => entry.pillar_id === tag.pillar_id) ?? null
    : null;
  const outward = new THREE.Vector3();
  if (pillar) {
    outward.set(tagAnchor.x - pillar.position_x, 0, tagAnchor.z - pillar.position_z);
  }
  if (outward.lengthSq() < 0.0001) {
    const angle = ((hashString(tagId) % 360) * Math.PI) / 180;
    outward.set(Math.cos(angle), 0, Math.sin(angle));
  } else {
    outward.normalize();
  }
  const right = new THREE.Vector3(-outward.z, 0, outward.x).normalize();
  return { outward, right };
}

function buildPackedPostRows(posts) {
  const horizontalGap = 2.6;
  const verticalGap = 3.2;
  const maxCardWidth = Math.max(...posts.map((post) => post.cardWidth ?? 12));
  const totalArea = posts.reduce(
    (sum, post) => sum + ((post.cardWidth ?? 12) + horizontalGap) * ((post.cardHeight ?? 4.5) + verticalGap),
    0,
  );
  const targetRowWidth = clamp(
    Math.sqrt(totalArea * 1.35),
    maxCardWidth * 1.35,
    Math.max(maxCardWidth * 3.6, 56),
  );

  const rows = [];
  let currentRow = null;
  for (const post of posts) {
    const width = post.cardWidth ?? 12;
    const height = post.cardHeight ?? 4.5;
    const nextWidth = currentRow ? currentRow.width + horizontalGap + width : width;
    if (currentRow && currentRow.items.length > 0 && nextWidth > targetRowWidth) {
      rows.push(currentRow);
      currentRow = null;
    }
    if (!currentRow) {
      currentRow = {
        items: [],
        width: 0,
        height: 0,
      };
    }
    const item = { post, width, height };
    currentRow.items.push(item);
    currentRow.width = currentRow.items.length === 1 ? width : currentRow.width + horizontalGap + width;
    currentRow.height = Math.max(currentRow.height, height);
  }
  if (currentRow && currentRow.items.length > 0) {
    rows.push(currentRow);
  }

  return {
    rows,
    horizontalGap,
    verticalGap,
    maxCardWidth,
    maxCardHeight: Math.max(...posts.map((post) => post.cardHeight ?? 4.5)),
  };
}

function computeOpenPostDisplayAnchors(tagId) {
  const tagAnchor = getRenderedTagAnchorById(tagId);
  if (!tagAnchor) {
    return new Map();
  }

  const posts = sceneState.animatedPosts
    .filter((entry) => entry.tagId === tagId && entry.displayTier !== "hidden")
    .sort((left, right) =>
      (left.rankInTag ?? Number.MAX_SAFE_INTEGER) - (right.rankInTag ?? Number.MAX_SAFE_INTEGER)
      || String(left.postId).localeCompare(String(right.postId)));

  if (posts.length === 0) {
    return new Map();
  }

  const { outward, right } = getPostLayoutBasis(tagId, tagAnchor);
  const {
    rows,
    horizontalGap,
    verticalGap,
    maxCardWidth,
    maxCardHeight,
  } = buildPackedPostRows(posts);
  const positions = new Map();

  const totalHeight =
    rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * verticalGap;
  const baseDistance = Math.max(16, 8 + maxCardWidth * 0.72);
  const rowDepthStep = Math.max(5.2, maxCardHeight * 1.05);

  let currentTop = totalHeight / 2;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    let cursorX = -row.width / 2;
    const rowDistance = baseDistance + rowIndex * rowDepthStep;
    const rowCenterBase = tagAnchor.clone().addScaledVector(outward, rowDistance);

    for (const item of row.items) {
      const centerX = cursorX + item.width / 2;
      const centerY = currentTop - item.height / 2;
      positions.set(
        item.post.postId,
        rowCenterBase.clone()
          .addScaledVector(right, centerX)
          .add(new THREE.Vector3(0, centerY, 0)),
      );
      cursorX += item.width + horizontalGap;
    }

    currentTop -= row.height + verticalGap;
  }

  return positions;
}

function computeFocusedPostView(result, sourcePosition = getNavigationPosition()) {
  if (!result?.destination) {
    return null;
  }

  const animated = getAnimatedPostEntry(result.destination.post_id, result.destination.tag_id);
  const anchor = animated?.displayAnchor?.clone()
    ?? new THREE.Vector3(
      result.destination.position_x,
      result.destination.position_y ?? 0,
      result.destination.position_z,
    );
  const cardElevation = animated?.cardElevation ?? 5.2;
  const cardWidth = animated?.cardWidth ?? 12;
  const cardHeight = animated?.cardHeight ?? 6.8;
  const focusTarget = anchor.clone().add(new THREE.Vector3(0, cardElevation * 0.86, 0));
  const eyeOrigin = getPlayerLookTarget(sourcePosition);
  const planarApproach = new THREE.Vector3(
    focusTarget.x - eyeOrigin.x,
    0,
    focusTarget.z - eyeOrigin.z,
  );
  if (planarApproach.lengthSq() < 0.0001) {
    planarApproach.copy(getFlatForwardVector(result.destination.heading_y ?? inputState.yaw)).multiplyScalar(-1);
  } else {
    planarApproach.normalize();
  }
  const eyeDistance = Math.max(18, cardWidth * 1.35, cardHeight * 2.05);
  const eyePosition = focusTarget.clone().sub(planarApproach.multiplyScalar(eyeDistance));
  eyePosition.y = focusTarget.y - 0.18;
  const navigationTarget = eyePosition.clone().sub(new THREE.Vector3(0, PLAYER_VIEW.lookHeight, 0));
  navigationTarget.y = clamp(navigationTarget.y, CAMERA.minY, CAMERA.maxY);
  const { yaw, pitch } = computeLookAngles(eyePosition, focusTarget);
  return {
    position: navigationTarget,
    yaw,
    pitch,
  };
}

function getFocusedAnimatedPost() {
  const destination = state.focusedResult?.destination;
  if (!destination?.post_id) {
    return null;
  }
  return getAnimatedPostEntry(destination.post_id, destination.tag_id);
}

function projectWorldPointToCanvas(point) {
  if (!sceneState.camera || !elements.canvas) {
    return null;
  }
  const projected = point.clone().project(sceneState.camera);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1.2 || projected.z > 1.2) {
    return null;
  }
  const width = elements.canvas.clientWidth || window.innerWidth;
  const height = elements.canvas.clientHeight || window.innerHeight;
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    z: projected.z,
  };
}

function computeFocusedPostScreenRect() {
  const entry = getFocusedAnimatedPost();
  if (!entry || !entry.group.visible) {
    return null;
  }

  const scale = entry.group.scale?.x ?? 1;
  const center = entry.group.position.clone().add(new THREE.Vector3(0, entry.cardElevation * scale, 0));
  const right = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(sceneState.camera.quaternion)
    .multiplyScalar((entry.cardWidth * scale) / 2);
  const up = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(sceneState.camera.quaternion)
    .multiplyScalar((entry.cardHeight * scale) / 2);
  const corners = [
    center.clone().add(right).add(up),
    center.clone().add(right).sub(up),
    center.clone().sub(right).add(up),
    center.clone().sub(right).sub(up),
  ].map(projectWorldPointToCanvas).filter(Boolean);
  if (corners.length < 4) {
    return null;
  }

  const width = elements.canvas.clientWidth || window.innerWidth;
  const height = elements.canvas.clientHeight || window.innerHeight;
  const paddingX = 120;
  const paddingY = 84;
  const left = clamp(Math.min(...corners.map((corner) => corner.x)) - paddingX, 0, width);
  const rightEdge = clamp(Math.max(...corners.map((corner) => corner.x)) + paddingX, 0, width);
  const top = clamp(Math.min(...corners.map((corner) => corner.y)) - paddingY, 0, height);
  const bottom = clamp(Math.max(...corners.map((corner) => corner.y)) + paddingY, 0, height);
  if (rightEdge - left < 12 || bottom - top < 12) {
    return null;
  }
  return {
    left,
    top,
    right: rightEdge,
    bottom,
    width: rightEdge - left,
    height: bottom - top,
  };
}

function hideFocusVeil() {
  if (!elements.focusVeil) {
    return;
  }
  elements.focusVeil.style.opacity = "0";
  elements.focusVeil.hidden = true;
  if (elements.focusFrame) {
    elements.focusFrame.style.opacity = "0";
  }
}

function updateFocusVeil() {
  if (!elements.focusVeil || !elements.focusFrame || !elements.focusPieces) {
    return;
  }
  const mix = clamp(state.postFocusMix, 0, 1);
  const rect = mix > 0.02 ? computeFocusedPostScreenRect() : null;
  if (!rect) {
    hideFocusVeil();
    return;
  }

  const width = elements.canvas.clientWidth || window.innerWidth;
  const height = elements.canvas.clientHeight || window.innerHeight;
  elements.focusVeil.hidden = false;
  elements.focusVeil.style.opacity = String(mix * 0.34);

  const pieces = elements.focusPieces;
  pieces.top.style.left = "0px";
  pieces.top.style.top = "0px";
  pieces.top.style.width = `${width}px`;
  pieces.top.style.height = `${rect.top}px`;

  pieces.left.style.left = "0px";
  pieces.left.style.top = `${rect.top}px`;
  pieces.left.style.width = `${rect.left}px`;
  pieces.left.style.height = `${rect.height}px`;

  pieces.right.style.left = `${rect.right}px`;
  pieces.right.style.top = `${rect.top}px`;
  pieces.right.style.width = `${Math.max(0, width - rect.right)}px`;
  pieces.right.style.height = `${rect.height}px`;

  pieces.bottom.style.left = "0px";
  pieces.bottom.style.top = `${rect.bottom}px`;
  pieces.bottom.style.width = `${width}px`;
  pieces.bottom.style.height = `${Math.max(0, height - rect.bottom)}px`;

  elements.focusFrame.style.left = `${rect.left}px`;
  elements.focusFrame.style.top = `${rect.top}px`;
  elements.focusFrame.style.width = `${rect.width}px`;
  elements.focusFrame.style.height = `${rect.height}px`;
  elements.focusFrame.style.opacity = String(0.06 + mix * 0.08);
}

function syncFocusedFloorMarker() {
  if (!sceneState.floorMarker) {
    return;
  }
  if (!state.focusedResult?.destination) {
    sceneState.floorMarker.visible = false;
    return;
  }
  const animated = getAnimatedPostEntry(
    state.focusedResult.destination.post_id,
    state.focusedResult.destination.tag_id,
  );
  const anchor = animated?.displayAnchor
    ?? animated?.anchor
    ?? new THREE.Vector3(
      state.focusedResult.destination.position_x,
      state.focusedResult.destination.position_y ?? 0,
      state.focusedResult.destination.position_z,
    );
  sceneState.floorMarker.visible = true;
  sceneState.floorMarker.position.set(anchor.x, 0.2, anchor.z);
}

function syncExpandedTagState() {
  syncFocusedRevealedPost();

  for (const entry of sceneState.animatedPosts) {
    entry.targetVisible = state.openTagId === entry.tagId;
    if (entry.targetVisible) {
      entry.group.visible = true;
    }
  }

  for (const entry of sceneState.animatedTags) {
    const isOpen = state.openTagId === entry.tagId;
    entry.isOpen = isOpen;
    entry.center.scale.setScalar(isOpen ? 1.18 : 1);
    entry.displayAnchor.copy(entry.homeAnchor);
    entry.group.position.copy(entry.homeAnchor);
  }

  const openPostDisplayAnchors = state.openTagId ? computeOpenPostDisplayAnchors(state.openTagId) : new Map();
  for (const entry of sceneState.animatedPosts) {
    const displayAnchor = entry.targetVisible ? openPostDisplayAnchors.get(entry.postId) : null;
    entry.displayAnchor.copy(displayAnchor ?? entry.homeAnchor);
    if (!entry.targetVisible) {
      entry.group.position.copy(entry.homeAnchor);
    }
  }

  if (state.stream) {
    rebuildConnections(state.stream.pillars, state.stream.tags, state.stream.postInstances);
  }
  syncFocusedFloorMarker();
  syncFocusedGhost();
}

function closeSelectedPost() {
  cancelTravelAnimation();
  setPostFocusMode(false);
  state.activeResultId = null;
  state.focusedResult = null;
  state.openTagId = null;
  if (sceneState.floorMarker) {
    sceneState.floorMarker.visible = false;
  }
  syncExpandedTagState();
  renderSelected(null);
  renderSearchResults();
}

function openTagCloud(entry) {
  cancelTravelAnimation();
  setPostFocusMode(false);
  const isSameTag = state.openTagId === entry.tag_id;
  if (isSameTag) {
    state.openTagId = null;
    state.activeResultId = null;
    state.focusedResult = null;
    state.focusAnimation = null;
    if (sceneState.floorMarker) {
      sceneState.floorMarker.visible = false;
    }
    renderSelected(null);
    renderSearchResults();
    syncExpandedTagState();
    return;
  }

  state.openTagId = entry.tag_id;
  state.activeResultId = null;
  state.focusedResult = null;
  if (sceneState.floorMarker) {
    sceneState.floorMarker.visible = false;
  }
  renderSelected(null);
  renderSearchResults();
  syncExpandedTagState();

  const renderedAnchor = getRenderedTagAnchorById(entry.tag_id)
    ?? new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  const approach = computeApproachAnchor(
    {
      position_x: renderedAnchor.x,
      position_y: renderedAnchor.y + 2,
      position_z: renderedAnchor.z,
      heading_y: inputState.yaw,
    },
    clamp((entry.orbit_radius ?? 22) * 0.32 + 10, 12, 18),
    -2,
  );

  state.focusAnimation = {
    startedAt: performance.now(),
    fromPosition: getNavigationPosition().clone(),
    toPosition: approach.anchor,
    fromYaw: inputState.yaw,
    toYaw: approach.yaw,
    fromPitch: inputState.pitch,
    toPitch: clamp(0.16, CAMERA.lookMin, CAMERA.lookMax),
    fromRadius: state.cameraRadius,
    toRadius: clamp(20, PLAYER_VIEW.minRadius, PLAYER_VIEW.maxRadius),
    durationMs: 900,
  };

  loadStreamForPosition(approach.anchor, true).catch((error) => showToast(error.message));
}

function buildSceneSelectionResult(entry) {
  if (!entry?.post_id) {
    return null;
  }
  const fallbackAnchor = new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  const renderedAnchor = getRenderedPostAnchorById(entry.post_id, entry.tag_id, fallbackAnchor) ?? fallbackAnchor;
  const renderedTagAnchor = getRenderedTagAnchorById(entry.tag_id);
  const headingSource = renderedTagAnchor
    ? new THREE.Vector3().subVectors(renderedTagAnchor, renderedAnchor)
    : null;
  return {
    post: entry.post ?? null,
    worldQueueStatus: "ready",
    destination: {
      world_snapshot_id: state.meta?.worldSnapshotId ?? entry.world_snapshot_id ?? null,
      post_id: entry.post_id,
      tag_id: entry.tag_id,
      position_x: renderedAnchor.x,
      position_y: renderedAnchor.y,
      position_z: renderedAnchor.z,
      heading_y: headingSource && headingSource.lengthSq() > 0.0001
        ? yawFromVector(headingSource)
        : entry.heading_y ?? 0,
    },
  };
}

function openPostDetail(entry) {
  cancelTravelAnimation();
  const result = buildSceneSelectionResult(entry);
  if (!result?.destination?.post_id) {
    return;
  }
  const currentPosition = getNavigationPosition().clone();
  const enablePostFocus = shouldPreservePostFocusForTag(result.destination.tag_id);
  if (enablePostFocus) {
    setPostFocusMode(true, result.destination.tag_id);
  } else {
    setPostFocusMode(false);
  }
  const focusView = enablePostFocus ? computeFocusedPostView(result, currentPosition) : null;
  const approach = focusView
    ? { anchor: focusView.position, yaw: focusView.yaw, pitch: focusView.pitch }
    : computeApproachAnchor(result.destination, 9.5, -6.5, currentPosition);
  const focusDistance = currentPosition.distanceTo(approach.anchor);
  state.activeResultId = result.destination.post_id;
  state.focusedResult = result;
  state.openTagId = result.destination.tag_id ?? state.openTagId;
  if (sceneState.floorMarker) {
    sceneState.floorMarker.visible = true;
    sceneState.floorMarker.position.set(
      result.destination.position_x,
      0.2,
      result.destination.position_z,
    );
  }
  state.focusAnimation = {
    startedAt: performance.now(),
    durationMs: clamp(Math.round(focusDistance * 34), 680, 1500),
    fromPosition: currentPosition,
    toPosition: approach.anchor,
    fromRadius: state.cameraRadius,
    toRadius: focusView ? state.cameraRadius : clamp(18, PLAYER_VIEW.minRadius, PLAYER_VIEW.maxRadius),
    fromYaw: inputState.yaw,
    toYaw: approach.yaw,
    fromPitch: inputState.pitch,
    toPitch: focusView ? approach.pitch : clamp(0.16, CAMERA.lookMin, CAMERA.lookMax),
  };
  syncExpandedTagState();
  syncFocusedGhost();
  renderSearchResults();
  renderSelected(result);
  loadStreamForPosition(approach.anchor, true).catch((error) => showToast(error.message));
}

function rebuildConnections(pillars, tags, posts) {
  clearGroup(sceneState.lines);
  if (pillars.length === 0 || tags.length === 0) {
    return;
  }
  const pillarById = new Map(pillars.map((entry) => [entry.pillar_id, entry]));
  const tagById = new Map(tags.map((entry) => [entry.tag_id, entry]));
  const positions = [];
  for (const tag of tags) {
    const pillar = pillarById.get(tag.pillar_id);
    if (!pillar) {
      continue;
    }
    const renderedTagAnchor = getRenderedTagAnchor(tag);
    positions.push(pillar.position_x, pillar.position_y + pillar.height, pillar.position_z);
    positions.push(renderedTagAnchor.x, renderedTagAnchor.y, renderedTagAnchor.z);
  }
  for (const post of posts) {
    if (state.openTagId !== post.tag_id) {
      continue;
    }
    const tag = tagById.get(post.tag_id);
    if (!tag) {
      continue;
    }
    const renderedTagAnchor = getRenderedTagAnchor(tag);
    const renderedPostAnchor = getRenderedPostAnchor(post);
    positions.push(renderedTagAnchor.x, renderedTagAnchor.y, renderedTagAnchor.z);
    positions.push(renderedPostAnchor.x, renderedPostAnchor.y, renderedPostAnchor.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (positions.length > 0) {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(WORLD_STYLE.line),
      transparent: true,
      opacity: 0.2,
      fog: false,
    });
    sceneState.lines.add(new THREE.LineSegments(geometry, material));
  }

  for (const entry of sceneState.animatedPosts) {
    if (state.openTagId !== entry.tagId || entry.displayTier === "hidden") {
      continue;
    }
    const tag = tagById.get(entry.tagId);
    if (!tag) {
      continue;
    }
    const renderedTagAnchor = getRenderedTagAnchor(tag);
    const renderedPostAnchor = entry.displayAnchor ?? entry.anchor;
    const start = new THREE.Vector3(
      renderedTagAnchor.x,
      renderedTagAnchor.y + 0.18,
      renderedTagAnchor.z,
    );
    const end = new THREE.Vector3(
      renderedPostAnchor.x,
      renderedPostAnchor.y + entry.cardElevation * 0.76,
      renderedPostAnchor.z,
    );
    const accents = pickAccentSet(entry.postId || `${entry.tagId}:${entry.postId}`);
    const branch = createBranchConnection(start, end, {
      accent: entry.displayTier === "hero" ? accents.primary : accents.secondary,
      outerRadius: entry.displayTier === "hero" ? 0.16 : entry.displayTier === "standard" ? 0.12 : 0.095,
      outerOpacity: entry.displayTier === "hero" ? 0.38 : 0.3,
      innerOpacity: entry.displayTier === "hero" ? 0.8 : 0.68,
    });
    sceneState.lines.add(branch);
  }

  const focusedResult = state.focusedResult;
  const focusedDestination = focusedResult?.destination;
  const focusedQueueStatus = resolveResultQueueStatus(focusedResult);
  const shouldLinkFocusedGhost =
    focusedDestination?.tag_id
    && state.openTagId === focusedDestination.tag_id
    && (focusedQueueStatus !== "ready" || !hasRenderableFocusedPost(focusedResult));
  if (!shouldLinkFocusedGhost) {
    return;
  }

  const focusedTag = tagById.get(focusedDestination.tag_id);
  const renderedTagAnchor = focusedTag
    ? getRenderedTagAnchor(focusedTag)
    : getRenderedTagAnchorById(focusedDestination.tag_id);
  if (!renderedTagAnchor) {
    return;
  }

  const focusedAnchor = getRenderedPostAnchorById(
    focusedDestination.post_id,
    focusedDestination.tag_id,
    new THREE.Vector3(
      focusedDestination.position_x,
      focusedDestination.position_y ?? 0,
      focusedDestination.position_z,
    ),
  );
  if (!focusedAnchor) {
    return;
  }

  const focusedElevation = getFocusedAnimatedPost()?.cardElevation ?? 5.2;
  const branch = createBranchConnection(
    new THREE.Vector3(
      renderedTagAnchor.x,
      renderedTagAnchor.y + 0.18,
      renderedTagAnchor.z,
    ),
    new THREE.Vector3(
      focusedAnchor.x,
      focusedAnchor.y + focusedElevation * 0.76,
      focusedAnchor.z,
    ),
    {
      accent: focusedQueueStatus === "ready" ? WORLD_STYLE.accents[1] : WORLD_STYLE.accents[0],
      outerRadius: 0.18,
      outerOpacity: 0.44,
      innerOpacity: 0.88,
    },
  );
  sceneState.lines.add(branch);
}

function rebuildScene(streamPayload) {
  sceneState.billboards = [];
  sceneState.animatedDecor = [];
  sceneState.animatedPillars = [];
  sceneState.animatedPosts = [];
  sceneState.animatedTags = [];
  sceneState.animatedPresence = [];
  sceneState.clickable = [];

  clearGroup(sceneState.decor);
  clearGroup(sceneState.pillars);
  clearGroup(sceneState.tags);
  clearGroup(sceneState.posts);
  clearGroup(sceneState.presence);

  rebuildVirtualDecor(streamPayload);
  for (const pillar of streamPayload.pillars) {
    sceneState.pillars.add(buildPillarObject(pillar));
  }
  for (const tag of streamPayload.tags) {
    sceneState.tags.add(buildTagObject(tag));
  }
  for (const post of streamPayload.postInstances) {
    sceneState.posts.add(buildPostObject(post));
  }
  for (const presence of streamPayload.presence) {
    sceneState.presence.add(buildPresenceObject(presence));
  }
  rebuildConnections(streamPayload.pillars, streamPayload.tags, streamPayload.postInstances);
  sceneState.visitorSystem?.syncAmbient(streamPayload.tags);
  syncExpandedTagState();
  syncFocusedGhost();
}

function initScene() {
  sceneState.renderer = new THREE.WebGLRenderer({
    canvas: elements.canvas,
    antialias: true,
    alpha: false,
  });
  sceneState.renderer.outputColorSpace = THREE.SRGBColorSpace;
  sceneState.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  sceneState.scene = new THREE.Scene();
  sceneState.scene.background = new THREE.Color(WORLD_STYLE.background);
  sceneState.scene.fog = new THREE.Fog(WORLD_STYLE.fog, 170, 1600);

  sceneState.camera = new THREE.PerspectiveCamera(
    58,
    window.innerWidth / Math.max(1, window.innerHeight - 77),
    0.1,
    2400,
  );
  sceneState.camera.position.set(0, 108, 128);
  sceneState.camera.rotation.order = "YXZ";

  const ambient = new THREE.HemisphereLight("#ffffff", "#ffe8f8", 1.48);
  ambient.position.set(0, 180, 0);
  sceneState.scene.add(ambient);

  const sun = new THREE.DirectionalLight("#fff4be", 1.16);
  sun.position.set(120, 280, 80);
  sceneState.scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2400, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(WORLD_STYLE.ground),
      transparent: true,
      opacity: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  sceneState.scene.add(ground);

  sceneState.floorMarker = new THREE.Mesh(
    new THREE.RingGeometry(10, 12.6, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(WORLD_STYLE.accents[0]),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  sceneState.floorMarker.rotation.x = -Math.PI / 2;
  sceneState.floorMarker.visible = false;
  sceneState.scene.add(sceneState.floorMarker);

  sceneState.effects.add(sceneState.focusGhosts);
  sceneState.effects.add(sceneState.focusQueued);
  sceneState.root = new THREE.Group();
  sceneState.root.add(sceneState.decor);
  sceneState.root.add(sceneState.pillars);
  sceneState.root.add(sceneState.lines);
  sceneState.root.add(sceneState.tags);
  sceneState.root.add(sceneState.posts);
  sceneState.root.add(sceneState.presence);
  sceneState.root.add(sceneState.visitors);
  sceneState.root.add(sceneState.player);
  sceneState.root.add(sceneState.trails);
  sceneState.root.add(sceneState.routes);
  sceneState.root.add(sceneState.effects);
  sceneState.scene.add(sceneState.root);

  const viewerAvatar = createMascotFigure("viewer-self", {
    scale: 0.92,
    outlineColor: WORLD_STYLE.accents[0],
  });
  sceneState.player.add(viewerAvatar.group);
  sceneState.playerAvatar = {
    group: viewerAvatar.group,
    position: getNavigationPosition().clone(),
    poseRoot: viewerAvatar.poseRoot,
    halo: viewerAvatar.halo,
    orb: viewerAvatar.orb,
    orbBaseY: viewerAvatar.orb.position.y,
    opacity: 1,
    targetOpacity: 1,
    bobPhase: Math.random() * Math.PI * 2,
    lastPosition: getNavigationPosition().clone(),
    lastSyncElapsed: 0,
    leanX: 0,
    leanZ: 0,
    targetLeanX: 0,
    targetLeanZ: 0,
    facingYaw: normalizeAngle(inputState.yaw + Math.PI),
  };
  sceneState.visitorSystem = createWorldVisitorSystem({
    ambientRoot: sceneState.visitors,
    queuedRoot: sceneState.focusQueued,
    createMascotFigure,
    getActorLodSettings,
    createBillboard,
    unregisterBillboard,
    pickAccent,
    worldStyle: WORLD_STYLE,
  });
  syncLocalAvatar(0);

  const confettiBounds = getConfettiFieldBounds();
  sceneState.snowBounds = confettiBounds;
  const snowGeometry = new THREE.BufferGeometry();
  const snowCount = 2200;
  const snowPositions = new Float32Array(snowCount * 3);
  const snowColors = new Float32Array(snowCount * 3);
  sceneState.snowData = Array.from({ length: snowCount }, (_, index) => {
    const color = new THREE.Color(pickAccent(`confetti-${index}`))
      .lerp(new THREE.Color("#ffffff"), 0.03 + Math.random() * 0.08);
    snowColors[index * 3] = color.r;
    snowColors[index * 3 + 1] = color.g;
    snowColors[index * 3 + 2] = color.b;
    const x = confettiBounds.centerX + (Math.random() - 0.5) * confettiBounds.halfX * 2;
    const y = confettiBounds.minY + Math.random() * (confettiBounds.maxY - confettiBounds.minY);
    const z = confettiBounds.centerZ + (Math.random() - 0.5) * confettiBounds.halfZ * 2;
    snowPositions[index * 3] = x;
    snowPositions[index * 3 + 1] = y;
    snowPositions[index * 3 + 2] = z;
    return {
      x,
      y,
      baseY: y,
      z,
      driftX: (Math.random() - 0.5) * 4.2,
      driftZ: (Math.random() - 0.5) * 4.8,
      bobAmount: 0.28 + Math.random() * 1.1,
      bobSpeed: 0.22 + Math.random() * 0.52,
      sway: 0.6 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
    };
  });
  snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  snowGeometry.setAttribute("color", new THREE.BufferAttribute(snowColors, 3));
  sceneState.snow = new THREE.Points(
    snowGeometry,
    new THREE.PointsMaterial({
      map: createConfettiTexture({
        fill: "rgba(255, 255, 255, 0.98)",
        stroke: "rgba(255, 255, 255, 0.42)",
        fold: "rgba(255, 255, 255, 0.28)",
        size: 92,
      }),
      size: 1.7,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.12,
      blending: THREE.NormalBlending,
      fog: false,
      vertexColors: true,
    }),
  );
  sceneState.snow.renderOrder = 2;
  sceneState.scene.add(sceneState.snow);

  updateCameraRotation();
  resizeScene();
}

function resizeScene() {
  const width = window.innerWidth;
  const height = Math.max(320, window.innerHeight);
  sceneState.renderer.setSize(width, height, false);
  sceneState.camera.aspect = width / height;
  sceneState.camera.updateProjectionMatrix();
}

function updateCameraRotation() {
  syncCameraToFollowTarget();
}

function updateMetaPanel() {
  if (!elements.meta || !elements.queue) {
    updateStagePanel();
    return;
  }

  if (!state.meta) {
    elements.meta.innerHTML = '<p class="world-empty">No current snapshot available.</p>';
    elements.queue.innerHTML = '<p class="world-empty">No queue data.</p>';
    updateStagePanel();
    return;
  }

  elements.meta.innerHTML = `
    <div class="world-meta-list">
      <div><strong>Status</strong><span>${htmlEscape(state.meta.status)}</span></div>
      <div><strong>Snapshot</strong><span>${htmlEscape(state.meta.worldSnapshotId.slice(0, 8))}</span></div>
      <div><strong>Footprint</strong><span>${Math.round(state.meta.bounds.maxX - state.meta.bounds.minX)} x ${Math.round(state.meta.bounds.maxZ - state.meta.bounds.minZ)}</span></div>
    </div>
  `;

  elements.queue.innerHTML = `
    <div class="world-queue-list">
      <div><strong>Pending</strong><span>${state.meta.queueLag.pendingCount}</span></div>
      <div><strong>Processing</strong><span>${state.meta.queueLag.processingCount}</span></div>
      <div><strong>Delay</strong><span>${Math.max(0, Math.round(state.meta.queueLag.estimatedDelayMs / 1000))}s</span></div>
    </div>
  `;

  updateStagePanel();
}

function updateCameraPanel() {
  if (!elements.camera) {
    return;
  }
  const position = getNavigationPosition();
  const cellSize = state.meta?.renderer?.lod?.cellSize ?? 64;
  const cellX = Math.floor(position.x / Math.max(1, cellSize));
  const cellZ = Math.floor(position.z / Math.max(1, cellSize));
  elements.camera.innerHTML = `
    <div class="world-camera-list">
      <div><strong>Cell</strong><span>${cellX}, ${cellZ}</span></div>
      <div><strong>X / Z</strong><span>${position.x.toFixed(1)} / ${position.z.toFixed(1)}</span></div>
      <div><strong>Height</strong><span>${position.y.toFixed(1)}</span></div>
    </div>
  `;
}

function getStreamCounts() {
  return {
    pillars: state.stream?.pillars?.length ?? 0,
    tags: state.stream?.tags?.length ?? 0,
    posts: state.stream?.postInstances?.length ?? 0,
    presence: state.stream?.presence?.length ?? 0,
  };
}

function updateStagePanel() {
  if (!elements.stage) {
    return;
  }

  const counts = getStreamCounts();
  const hasVisibleScene = counts.pillars + counts.tags + counts.posts > 0;

  if (hasVisibleScene && !state.loading) {
    elements.stage.hidden = true;
    return;
  }

  let kicker = "Preparing the world";
  let title = "Current snapshot is still forming.";
  let copy = "Search for a post to jump to a known branch, or free-roam while the scene worker finishes placement.";
  const meta = [];

  if (!state.meta) {
    kicker = "Connecting";
    title = "Connecting to the current snapshot.";
    copy = "Loading the world map, the active cells, and the first set of placements.";
  } else if (state.loading || state.meta.status !== "ready") {
    kicker = "Snapshot building";
    title = "Placements are still streaming in.";
    copy = "Search is already live. Physical placements continue settling into the active world.";
    meta.push(`Status ${state.meta.status}`);
    meta.push(`${state.meta.queueLag.pendingCount} pending`);
    meta.push(`${Math.max(0, Math.round(state.meta.queueLag.estimatedDelayMs / 1000))}s scene delay`);
  } else {
    const position = getNavigationPosition() ?? { x: 0, z: 0 };
    const cellSize = state.meta?.renderer?.lod?.cellSize ?? 64;
    const cellX = Math.floor(position.x / Math.max(1, cellSize));
    const cellZ = Math.floor(position.z / Math.max(1, cellSize));
    kicker = "Quiet cell";
    title = "This cell is quiet.";
    copy = "Search for a post or keep moving until another cluster drifts into range.";
    meta.push(`${counts.presence} live visitors nearby`);
    meta.push(`Camera cell ${cellX}, ${cellZ}`);
  }

  elements.stage.hidden = false;
  elements.stageKicker.textContent = kicker;
  elements.stageTitle.textContent = title;
  elements.stageCopy.textContent = copy;
  elements.stageMeta.innerHTML = meta.map((entry) => `<span class="world-chip">${htmlEscape(entry)}</span>`).join("");
}

function renderSelected(result) {
  if (!elements.selected || !elements.inspector || !elements.focusKind) {
    return;
  }
  if (!result) {
    elements.inspector?.classList.add("is-empty");
    elements.focusKind.textContent = "Post";
    elements.selected.innerHTML = "";
    return;
  }

  elements.inspector?.classList.remove("is-empty");
  const post = result.post ?? {};
  const media = post.media?.[0];
  const fullBody = renderFullPostBody(post.body_md, post.body_plain);
  const tagSummary = post.tags?.slice(0, 5).map((tag) => `#${tag.label}`).join(" ") || "No visible tags";
  const postHref = post.id ? `/social/post.html?id=${encodeURIComponent(post.id)}` : "";
  const queueStatus = resolveResultQueueStatus(result);
  elements.focusKind.textContent = result.destination ? "Post" : "Queued";
  elements.selected.innerHTML = `
    <div class="world-selected__meta">
      <span class="world-chip">${htmlEscape(post.source_mode?.replaceAll("_", " ") || "post")}</span>
      <span class="world-chip ${queueStatus === "ready" ? "world-chip--ready" : "world-chip--queue"}">${htmlEscape(formatQueueLabel(queueStatus))}</span>
      <span class="world-chip">${htmlEscape(post.pillar?.title || "Unassigned pillar")}</span>
    </div>
    <div class="world-selected__title">${htmlEscape(post.title || truncateText(post.body_plain || "Post", 80))}</div>
    <div class="world-selected__meta">
      <span>${htmlEscape(tagSummary)}</span>
      <span>${htmlEscape(post.created_at ? formatRelativeTime(post.created_at) : "now")}</span>
      <span>Score ${Number(post.score ?? 0)}</span>
      <span>Comments ${Number(post.comment_count ?? 0)}</span>
    </div>
    ${media ? `<img class="world-selected__media" src="${htmlEscape(media.url)}" alt="${htmlEscape(media.alt_text || post.title || "Post image")}" />` : ""}
    <div class="world-selected__scroll">
      <div class="world-selected__content">${fullBody}</div>
    </div>
    ${postHref ? `<a class="world-selected__link" href="${postHref}">Open full post</a>` : ""}
  `;
}

function focusOnDestination(result) {
  startGuidedTravel(normalizeWorldResult(result));
}

function renderSearchResults() {
  const hits = state.searchPayload?.hits ?? [];
  if (hits.length === 0) {
    if (!hasSearchIntent()) {
      elements.resultsPanel?.classList.add("is-empty");
      elements.results.innerHTML = "";
      return;
    }
    elements.resultsPanel?.classList.remove("is-empty");
    elements.results.innerHTML = '<p class="world-empty">No routes match this search in the current snapshot.</p>';
    return;
  }

  elements.resultsPanel?.classList.remove("is-empty");
  elements.results.innerHTML = hits
    .map((hit) => {
      const post = hit.post ?? {};
      const isActive = state.activeResultId === post.id;
      const summary = summarizeBodyMarkdown(post.body_md, post.body_plain, 120);
      const queueStatus = resolveResultQueueStatus(hit);
      const metaBits = [
        post.tags?.slice(0, 2).map((tag) => `#${tag.label}`).join(" ") || post.pillar?.title || "",
        post.created_at ? formatRelativeTime(post.created_at) : "now",
      ].filter(Boolean);
      return `
        <button class="world-result ${isActive ? "is-active" : ""}" type="button" data-result-id="${htmlEscape(post.id)}">
          <div class="world-result__title">${htmlEscape(post.title || truncateText(post.body_plain || "Post", 90))}</div>
          <p class="world-result__body">${htmlEscape(summary)}</p>
          <div class="world-result__meta">
            ${metaBits.map((entry) => `<span>${htmlEscape(entry)}</span>`).join("")}
            ${queueStatus === "ready" ? "" : `<span class="world-chip world-chip--queue">${htmlEscape(formatQueueLabel(queueStatus))}</span>`}
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of elements.results.querySelectorAll("[data-result-id]")) {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-result-id");
      const result = hits.find((entry) => entry.post?.id === id);
      state.activeResultId = id;
      focusOnDestination(result);
      clearSearchQuery();
      clearSearchResults();
    });
  }
}

function buildCellWindow(position = getNavigationPosition(), options = {}) {
  const cellSize = state.meta?.renderer?.lod?.cellSize ?? 64;
  const range = window.innerWidth < 780 ? WORLD_STREAM.mobileRange : WORLD_STREAM.desktopRange;
  const centerX = Math.floor(position.x / Math.max(1, cellSize));
  const centerZ = Math.floor(position.z / Math.max(1, cellSize));
  const stickyMargin = Math.max(1, Math.min(2, range - 1));
  const sticky = options.sticky !== false;

  if (sticky && state.activeCellWindow) {
    const keepMinX = state.activeCellWindow.cell_x_min + stickyMargin;
    const keepMaxX = state.activeCellWindow.cell_x_max - stickyMargin;
    const keepMinZ = state.activeCellWindow.cell_z_min + stickyMargin;
    const keepMaxZ = state.activeCellWindow.cell_z_max - stickyMargin;
    if (
      centerX >= keepMinX
      && centerX <= keepMaxX
      && centerZ >= keepMinZ
      && centerZ <= keepMaxZ
    ) {
      return state.activeCellWindow;
    }
  }

  return {
    cell_x_min: centerX - range,
    cell_x_max: centerX + range,
    cell_z_min: centerZ - range,
    cell_z_max: centerZ + range,
    key: `${centerX - range}:${centerX + range}:${centerZ - range}:${centerZ + range}`,
  };
}

async function loadMeta(force = false) {
  if (state.meta && !force) {
    updateMetaPanel();
    return state.meta;
  }
  const payload = await fetchJson(WORLD_API.meta);
  state.meta = payload;
  const nearDistance = payload.renderer?.fog?.lodNearDistance ?? 180;
  const farDistance = payload.renderer?.fog?.farDistance ?? 720;
  const fogFar = farDistance * WORLD_STREAM.fogMultiplier;
  sceneState.scene.fog = new THREE.Fog(WORLD_STYLE.fog, nearDistance, fogFar);
  sceneState.camera.far = Math.max(2400, fogFar + 640);
  sceneState.camera.updateProjectionMatrix();
  syncConfettiFieldBounds();
  updateMetaPanel();
  return payload;
}

async function loadStream(force = false) {
  return loadStreamForPosition(getNavigationPosition(), force);
}

async function loadStreamForPosition(position, force = false) {
  if (!state.meta || state.streamLoading) {
    return;
  }
  const nextWindow = buildCellWindow(position, { sticky: !force });
  if (!force && nextWindow.key === state.currentCellKey) {
    return;
  }

  state.streamLoading = true;
  try {
    const payload = await fetchJson(WORLD_API.stream, nextWindow);
    state.activeCellWindow = nextWindow;
    mergeStreamIntoCache(payload);
    pruneWorldCache();
    state.stream = getCachedWorldPayload(payload.presence);
    state.currentCellKey = nextWindow.key;
    rebuildScene(state.stream);
    frameInitialViewFromStream();
    updateStagePanel();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.streamLoading = false;
  }
}

async function runSearch() {
  if (state.searchLoading) {
    return;
  }
  const formData = new FormData(elements.searchForm);
  const query = String(formData.get("q") ?? "").trim();
  const tag = String(formData.get("tag") ?? "").trim();
  if (!query && !tag) {
    clearSearchResults();
    return;
  }
  state.searchLoading = true;
  state.searchSubmitted = true;
  setSearchStatus("Searching the current world...");
  try {
    const payload = await fetchJson(WORLD_API.search, {
      q: query,
      tag,
      sort: formData.get("sort") || "latest",
      limit: 12,
    });
    const normalizedPayload = {
      ...payload,
      hits: (payload.hits ?? []).map((hit) => normalizeWorldResult(hit)),
    };
    state.searchPayload = normalizedPayload;
    if (!state.activeResultId && normalizedPayload.hits[0]?.post?.id) {
      state.activeResultId = normalizedPayload.hits[0].post.id;
      renderSelected(normalizedPayload.hits[0]);
    }
    renderSearchResults();
    setSearchStatus("");
  } catch (error) {
    state.searchPayload = { hits: [] };
    renderSearchResults();
    setSearchStatus(error.message);
  } finally {
    state.searchLoading = false;
  }
}

async function sendPresence() {
  if (!state.meta) {
    return;
  }
  const now = Date.now();
  if (now - state.lastPresenceAt < 4000) {
    return;
  }
  state.lastPresenceAt = now;

  const forward = new THREE.Vector3();
  forward.copy(getFlatForwardVector(inputState.yaw));
  try {
    await postJson(WORLD_API.presence, {
      viewerSessionId: state.viewerSessionId,
      position_x: Number(state.navigationPosition.x.toFixed(4)),
      position_y: Number(state.navigationPosition.y.toFixed(4)),
      position_z: Number(state.navigationPosition.z.toFixed(4)),
      heading_y: Number(inputState.yaw.toFixed(4)),
      movement_state: {
        forward: Number(forward.x.toFixed(4)),
        lift: Number(state.navigationPosition.y.toFixed(4)),
      },
    });
  } catch (_error) {
    // Presence is best-effort.
  }
}

function updateSnow(deltaSeconds, elapsedSeconds) {
  if (!sceneState.snow || !sceneState.camera) {
    return;
  }
  const positions = sceneState.snow.geometry.attributes.position.array;
  const bounds = sceneState.snowBounds ?? getConfettiFieldBounds();
  sceneState.snowBounds = bounds;
  const minX = bounds.centerX - bounds.halfX;
  const maxX = bounds.centerX + bounds.halfX;
  const minZ = bounds.centerZ - bounds.halfZ;
  const maxZ = bounds.centerZ + bounds.halfZ;
  for (let index = 0; index < sceneState.snowData.length; index += 1) {
    const particle = sceneState.snowData[index];
    particle.x += particle.driftX * deltaSeconds;
    particle.z += particle.driftZ * deltaSeconds;
    particle.x += Math.sin(elapsedSeconds * particle.sway + particle.phase) * 0.12;
    particle.z += Math.cos(elapsedSeconds * (particle.sway * 0.82) + particle.phase) * 0.1;
    particle.y = particle.baseY
      + Math.sin(elapsedSeconds * particle.bobSpeed + particle.phase) * particle.bobAmount
      + Math.cos(elapsedSeconds * (particle.bobSpeed * 0.62) + particle.phase * 0.5) * particle.bobAmount * 0.28;
    if (particle.x < minX) {
      particle.x += bounds.halfX * 2;
    } else if (particle.x > maxX) {
      particle.x -= bounds.halfX * 2;
    }
    if (particle.z < minZ) {
      particle.z += bounds.halfZ * 2;
    } else if (particle.z > maxZ) {
      particle.z -= bounds.halfZ * 2;
    }

    positions[index * 3] = particle.x;
    positions[index * 3 + 1] = particle.y;
    positions[index * 3 + 2] = particle.z;
  }
  sceneState.snow.geometry.attributes.position.needsUpdate = true;
}

function updateAnimatedObjects(deltaSeconds, elapsedSeconds) {
  const billboardDistance = state.meta?.renderer?.fog?.billboardDistance ?? 420;
  const nearDistance = state.meta?.renderer?.fog?.lodNearDistance ?? 180;
  const farDistance = state.meta?.renderer?.fog?.farDistance ?? 720;
  const pillarLod = getPillarLodSettings();
  const tagLod = getTagLodSettings();
  const actorLod = getActorLodSettings();
  const pillarActiveWindow = expandCellWindow(state.activeCellWindow, getPillarRenderPadding());
  const retainedDistance = farDistance * WORLD_STREAM.fogMultiplier;
  const focusedDestination = state.focusedResult?.destination;
  const focusIsolation = clamp(state.postFocusMix / 0.62, 0, 1);

  for (const entry of sceneState.animatedDecor) {
    if (entry.kind === "orbit") {
      entry.mesh.rotation.x = entry.baseRotationX + Math.sin(elapsedSeconds * entry.tiltSpeedX + entry.phase) * entry.tiltAmplitudeX;
      entry.mesh.rotation.y = entry.baseRotationY + Math.cos(elapsedSeconds * entry.tiltSpeedY + entry.phase * 0.7) * entry.tiltAmplitudeY;
      entry.mesh.rotation.z += deltaSeconds * entry.speed;
      continue;
    }
    if (entry.kind === "altitude-grid") {
      const altitudeMix = clamp(
        (sceneState.camera.position.y - CAMERA.minY) / Math.max(1, CAMERA.maxY - CAMERA.minY),
        0,
        1,
      );
      entry.minor.material.opacity = 0.04 + altitudeMix * 0.07;
      entry.major.material.opacity = 0.075 + altitudeMix * 0.11;
      continue;
    }
    if (entry.kind === "cloud") {
      entry.mesh.position.y = entry.baseY + Math.sin(elapsedSeconds * 0.32 + entry.phase) * entry.floatRange;
      continue;
    }
    if (entry.kind === "skyline-band") {
      entry.mesh.position.x = sceneState.camera.position.x;
      entry.mesh.position.z = sceneState.camera.position.z;
      entry.mesh.position.y = sceneState.camera.position.y + entry.yOffset + Math.sin(elapsedSeconds * entry.drift + entry.phase) * 4.2;
      entry.mesh.rotation.y = entry.baseRotationY + Math.sin(elapsedSeconds * entry.drift * 0.72 + entry.phase) * 0.018;
      entry.mesh.material.opacity = entry.baseOpacity + Math.sin(elapsedSeconds * entry.drift + entry.phase) * 0.02;
      if (entry.texture) {
        entry.texture.offset.x = ((elapsedSeconds * entry.scrollSpeed) % 1 + 1) % 1;
      }
      continue;
    }
    if (entry.kind === "skyline") {
      const distance = entry.anchor.distanceTo(sceneState.camera.position);
      const fade = 1 - clamp(
        (distance - nearDistance * 1.6) / Math.max(1, retainedDistance * 1.18 - nearDistance * 1.6),
        0,
        1,
      );
      entry.group.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 2.8;
      entry.group.rotation.y += deltaSeconds * entry.spin;
      for (const body of entry.bodies) {
        body.material.opacity = 0.04 + fade * 0.18;
      }
      for (const outline of entry.outlines) {
        outline.material.opacity = 0.08 + fade * 0.26;
      }
      for (const band of entry.bands) {
        band.material.opacity = 0.06 + fade * 0.16;
        band.rotation.z += deltaSeconds * 0.08;
      }
      entry.halo.material.opacity = 0.03 + fade * 0.1;
      continue;
    }
    if (entry.kind === "mascot") {
      entry.group.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 2.1;
      entry.group.rotation.y += deltaSeconds * entry.spin;
      if (entry.halo) {
        entry.halo.rotation.z += deltaSeconds * 1.24;
      }
      if (entry.orb) {
        entry.orb.position.y = entry.orbBaseY + Math.sin(elapsedSeconds * 1.8 + entry.phase) * 0.6;
      }
      continue;
    }
    if (entry.kind === "spark") {
      entry.mesh.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 4.6;
      entry.mesh.rotation.x += deltaSeconds * entry.spin;
      entry.mesh.rotation.y += deltaSeconds * entry.spin * 1.2;
    }
  }

  for (const entry of sceneState.animatedPillars) {
    if (entry.lod?.levels?.[1]) {
      entry.lod.levels[1].distance = pillarLod.proxyDistance;
      entry.lod.levels[1].hysteresis = pillarLod.proxyHysteresis;
    }
    entry.lod?.update(sceneState.camera);
    const distance = entry.anchor.distanceTo(sceneState.camera.position);
    const activeCell = isCellWithinWindow(entry.cellX, entry.cellZ, pillarActiveWindow);
    const fade = 1 - clamp((distance - nearDistance * 0.4) / Math.max(1, retainedDistance - nearDistance * 0.4), 0, 1);
    const worldMix = activeCell ? 1 : 0.42;
    entry.body.material.opacity = (0.28 + fade * 0.68) * worldMix;
    entry.outline.material.opacity = (activeCell ? 0.9 : 0.42) * fade;
    for (const band of entry.bands) {
      band.mesh.material.opacity = (activeCell ? 0.58 : 0.26) + fade * 0.18;
      band.mesh.position.y = band.baseY + Math.sin(elapsedSeconds * band.bobSpeed + band.phase + entry.phase) * band.bobAmount;
      const pulse = 1 + Math.sin(elapsedSeconds * (band.bobSpeed + 0.1) + band.phase) * band.pulse;
      band.mesh.scale.setScalar(pulse);
    }
    entry.cap.position.y = entry.capBaseY + Math.sin(elapsedSeconds * 0.76 + entry.phase) * 0.6;
    entry.cap.material.opacity = (0.24 + fade * 0.56) * worldMix;
    entry.crown.material.opacity = (activeCell ? 0.16 : 0.08) + fade * 0.12;
    const crownPulse = 1 + Math.sin(elapsedSeconds * 0.9 + entry.phase) * 0.05;
    entry.crown.scale.set(crownPulse, crownPulse, 1);
    entry.label.material.opacity = activeCell
      ? 0.26 + fade * 0.66
      : 0.1 + fade * 0.18;
    entry.proxy.position.y = entry.proxyBaseY + Math.sin(elapsedSeconds * 0.42 + entry.phase) * 0.4;
    entry.proxy.material.opacity = (
      activeCell
        ? 0.34 + fade * 0.48
        : 0.16 + fade * 0.22
    ) * (entry.proxy.visible ? 1 : 0);
    if (entry.flow && entry.flowData?.length) {
      const positions = entry.flow.geometry.attributes.position.array;
      for (let index = 0; index < entry.flowData.length; index += 1) {
        const particle = entry.flowData[index];
        const offset = index * 3;
        const progress = (particle.offset + elapsedSeconds * particle.speed) % 1;
        const angle = particle.angle + elapsedSeconds * particle.spin;
        positions[offset] = Math.cos(angle) * particle.radius;
        positions[offset + 1] = progress * entry.height;
        positions[offset + 2] = Math.sin(angle) * particle.radius;
      }
      entry.flow.geometry.attributes.position.needsUpdate = true;
      entry.flow.material.opacity = (activeCell ? 0.24 : 0.1) + fade * 0.22;
    }
  }

  for (const entry of sceneState.animatedPosts) {
    const visibilityTarget = entry.targetVisible ? 1 : 0;
    const visibilityMix = 1 - Math.exp(-deltaSeconds * entry.visibilitySpeed);
    entry.visibilityProgress += (visibilityTarget - entry.visibilityProgress) * visibilityMix;
    if (!entry.targetVisible && entry.visibilityProgress <= 0.01) {
      entry.visibilityProgress = 0;
      entry.group.visible = false;
      entry.card.visible = false;
      entry.proxy.visible = false;
      continue;
    }
    entry.group.visible = true;

    if (!entry.group.visible) {
      continue;
    }
    const reveal = easeInOutCubic(clamp(entry.visibilityProgress, 0, 1));
    const renderedAnchor = entry.displayAnchor ?? entry.anchor;
    const distance = renderedAnchor.distanceTo(sceneState.camera.position);
    const activeCell = isCellWithinWindow(entry.cellX, entry.cellZ);
    const fade = 1 - clamp((distance - nearDistance * 0.46) / Math.max(1, retainedDistance - nearDistance * 0.46), 0, 1);
    const minOpacity =
      entry.displayTier === "hero" ? 0.44 : entry.displayTier === "standard" ? 0.28 : 0.18;
    const maxOpacity =
      entry.displayTier === "hero" ? 0.98 : entry.displayTier === "standard" ? 0.9 : 0.8;
    const cardRange = activeCell ? billboardDistance * 1.25 : billboardDistance * 0.62;
    const isFocusedEntry =
      Boolean(focusedDestination)
      && entry.postId === focusedDestination.post_id
      && entry.tagId === focusedDestination.tag_id;
    const backgroundOpacityFactor = focusedDestination && !isFocusedEntry
      ? 1 - focusIsolation * 0.7
      : 1;
    entry.group.position.copy(renderedAnchor);
    entry.group.position.y += (1 - reveal) * 1.6;
    const scale = 0.84 + reveal * 0.16;
    entry.group.scale.setScalar(scale);
    entry.card.renderOrder = isFocusedEntry ? 14 : 10;
    entry.proxy.renderOrder = isFocusedEntry ? 12 : 8;

    entry.card.material.opacity =
      ((minOpacity + (maxOpacity - minOpacity) * fade) * (activeCell ? 1 : 0.54))
      * reveal
      * backgroundOpacityFactor;
    entry.card.visible = reveal > 0.06 && distance <= cardRange;
    entry.proxy.visible = reveal > 0.04 && (!entry.card.visible || !activeCell);
    entry.proxy.material.opacity = activeCell
      ? (0.04 + (1 - fade) * 0.12) * reveal * backgroundOpacityFactor
      : (0.16 + fade * 0.18) * reveal * backgroundOpacityFactor;
    entry.baseMarker.material.opacity = activeCell
      ? (0.05 + fade * 0.1) * reveal * backgroundOpacityFactor
      : (0.12 + fade * 0.08) * reveal * backgroundOpacityFactor;
  }

  for (const entry of sceneState.animatedTags) {
    if (entry.lod?.levels?.[1]) {
      entry.lod.levels[1].distance = tagLod.proxyDistance;
      entry.lod.levels[1].hysteresis = tagLod.proxyHysteresis;
    }
    entry.ring.rotation.z += deltaSeconds * entry.speed;
    entry.halo.rotation.z -= deltaSeconds * entry.speed * 0.62;
    const distance = (entry.displayAnchor ?? entry.anchor).distanceTo(sceneState.camera.position);
    const activeCell = isCellWithinWindow(entry.cellX, entry.cellZ);
    const farMix = clamp((distance - nearDistance * 0.8) / Math.max(1, retainedDistance - nearDistance * 0.8), 0, 1);
    entry.label.visible = true;
    entry.label.material.opacity = entry.isOpen
      ? (activeCell ? 0.96 - farMix * 0.16 : 0.52 - farMix * 0.12)
      : (activeCell ? 0.74 - farMix * 0.2 : 0.32 - farMix * 0.08);
    entry.beacon.material.opacity = entry.isOpen
      ? (activeCell ? 0.18 + farMix * 0.08 : 0.22 + farMix * 0.1)
      : (activeCell ? 0.2 + farMix * 0.18 : 0.24 + farMix * 0.12);
    entry.ring.material.opacity = entry.isOpen
      ? (activeCell ? 0.74 + farMix * 0.12 : 0.32 + farMix * 0.08)
      : (activeCell ? 0.34 + farMix * 0.16 : 0.18 + farMix * 0.1);
    entry.halo.material.opacity = entry.isOpen
      ? (activeCell ? 0.24 + farMix * 0.08 : 0.12 + farMix * 0.06)
      : (activeCell ? 0.1 + farMix * 0.08 : 0.06 + farMix * 0.05);
    entry.outline.material.opacity = entry.isOpen
      ? (activeCell ? 0.92 : 0.48)
      : (activeCell ? 0.74 : 0.36);
    entry.center.material.opacity = entry.isOpen
      ? (activeCell ? 1 : 0.54)
      : (activeCell ? 0.86 : 0.34);
    if (entry.proxy) {
      entry.proxy.position.y = entry.proxyBaseY + Math.sin(elapsedSeconds * (0.8 + entry.speed) + entry.speed * 10) * 0.18;
      entry.proxy.material.opacity = entry.isOpen
        ? (activeCell ? 0.86 - farMix * 0.14 : 0.46 - farMix * 0.1)
        : (activeCell ? 0.72 - farMix * 0.18 : 0.3 - farMix * 0.08);
    }
  }

  for (const entry of sceneState.animatedPresence) {
    if (entry.lod?.levels?.[1]) {
      entry.lod.levels[1].distance = actorLod.proxyDistance;
      entry.lod.levels[1].hysteresis = actorLod.proxyHysteresis;
    }
    entry.group.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 1.2;
    entry.group.rotation.y += deltaSeconds * 0.24;
    if (entry.halo) {
      entry.halo.rotation.z += deltaSeconds * 1.14;
    }
    if (entry.orb) {
      entry.orb.position.y = entry.orbBaseY + Math.sin(elapsedSeconds * 1.4 + entry.phase) * 0.26;
    }
    if (entry.label) {
      const distance = entry.group.position.distanceTo(sceneState.camera.position);
      entry.label.material.opacity = 1 - clamp((distance - nearDistance * 0.45) / Math.max(1, retainedDistance - nearDistance * 0.45), 0, 1);
    }
    if (entry.proxy) {
      entry.proxy.position.y = entry.proxyBaseY + Math.sin(elapsedSeconds * 1.1 + entry.phase) * 0.2;
      entry.proxy.material.opacity = 0.54;
    }
  }

  if (sceneState.routeGuide) {
    sceneState.routeGuide.startMarker.rotation.z += deltaSeconds * 0.9;
    sceneState.routeGuide.endMarker.rotation.z -= deltaSeconds * 1.1;
    const pulse = 1 + Math.sin(elapsedSeconds * 2.2) * 0.08;
    sceneState.routeGuide.endMarker.scale.setScalar(pulse);
  }

  for (let index = sceneState.trailPuffs.length - 1; index >= 0; index -= 1) {
    const entry = sceneState.trailPuffs[index];
    entry.age += deltaSeconds;
    const life = clamp(entry.age / entry.lifetime, 0, 1);
    entry.group.position.addScaledVector(entry.drift, deltaSeconds);
    entry.group.position.y += deltaSeconds * 0.08;
    for (const piece of entry.pieces) {
      piece.mesh.position.addScaledVector(piece.velocity, deltaSeconds);
      const scale = 1 + life * piece.growth;
      piece.mesh.scale.setScalar(scale);
      piece.mesh.material.opacity = (1 - life) * 0.88;
      piece.shell.material.opacity = (1 - life) * 0.46;
    }
    if (life >= 1) {
      sceneState.trails.remove(entry.group);
      for (const piece of entry.pieces) {
        piece.shell.geometry.dispose();
        piece.shell.material.dispose();
        piece.mesh.geometry.dispose();
        piece.mesh.material.dispose();
      }
      sceneState.trailPuffs.splice(index, 1);
    }
  }

  syncLocalAvatar(elapsedSeconds);
  sceneState.visitorSystem?.update(deltaSeconds, elapsedSeconds);

  for (const mesh of [...sceneState.billboards, ...sceneState.persistentBillboards]) {
    syncBillboardToCamera(mesh);
  }
}

function updatePostFocusTransition(deltaSeconds) {
  const previousMix = state.postFocusMix;
  const mix = 1 - Math.exp(-deltaSeconds * 7.5);
  state.postFocusMix += (state.postFocusMixTarget - state.postFocusMix) * mix;
  if (Math.abs(state.postFocusMixTarget - state.postFocusMix) < 0.001) {
    state.postFocusMix = state.postFocusMixTarget;
  }
  if (sceneState.playerAvatar?.group) {
    sceneState.playerAvatar.group.visible = state.postFocusMix < 0.55;
  }
  if (Math.abs(previousMix - state.postFocusMix) > 0.0001 && !state.focusAnimation && !state.travelAnimation) {
    syncCameraToFollowTarget();
  }
}

function applyFocusAnimation() {
  if (!state.focusAnimation) {
    return;
  }
  const now = performance.now();
  const elapsed = now - state.focusAnimation.startedAt;
  const t = clamp(elapsed / state.focusAnimation.durationMs, 0, 1);
  const eased = easeInOutCubic(t);

  state.navigationPosition.lerpVectors(
    state.focusAnimation.fromPosition,
    state.focusAnimation.toPosition,
    eased,
  );
  state.cameraRadius =
    (state.focusAnimation.fromRadius ?? state.cameraRadius) +
    ((state.focusAnimation.toRadius ?? state.cameraRadius) - (state.focusAnimation.fromRadius ?? state.cameraRadius)) * eased;

  inputState.yaw = normalizeAngle(
    state.focusAnimation.fromYaw + shortestAngleDelta(state.focusAnimation.fromYaw, state.focusAnimation.toYaw) * eased,
  );
  inputState.pitch = state.focusAnimation.fromPitch + (state.focusAnimation.toPitch - state.focusAnimation.fromPitch) * eased;
  syncCameraToFollowTarget();

  if (t >= 1) {
    state.focusAnimation = null;
  }
}

function applyTravelAnimation(deltaSeconds) {
  if (!state.travelAnimation) {
    return;
  }
  const animation = state.travelAnimation;
  const now = performance.now();
  if (animation.phase === "preview") {
    const previewT = clamp((now - animation.previewStartedAt) / animation.previewMs, 0, 1);
    if (sceneState.routeGuide) {
      sceneState.routeGuide.line.material.opacity = 0.24 + previewT * 0.42;
    }
    if (previewT >= 1) {
      animation.phase = "travel";
      animation.travelStartedAt = now;
    }
    return;
  }

  const previousPosition = getNavigationPosition().clone();
  const t = clamp((now - animation.travelStartedAt) / animation.travelMs, 0, 1);
  const eased = easeInOutCubic(t);
  const nextPosition = animation.curve.getPoint(eased);
  state.navigationPosition.copy(nextPosition);
  state.cameraRadius = animation.fromRadius + (animation.toRadius - animation.fromRadius) * eased;
  inputState.yaw = normalizeAngle(
    inputState.yaw + shortestAngleDelta(inputState.yaw, animation.toYaw) * Math.min(1, deltaSeconds * 2.4),
  );
  inputState.pitch = inputState.pitch + (animation.toPitch - inputState.pitch) * Math.min(1, deltaSeconds * 2.2);
  syncCameraToFollowTarget();
  leaveMovementTrail(previousPosition, nextPosition, deltaSeconds);

  if (sceneState.routeGuide) {
    sceneState.routeGuide.line.material.opacity = 0.16 + (1 - eased) * 0.34;
  }

  if (t >= 1) {
    const result = animation.result;
    state.travelAnimation = null;
    clearRouteGuide();
    state.openTagId = result.destination?.tag_id ?? null;
    state.focusedResult = result;
    syncExpandedTagState();
    if (animation.enablePostFocus && result.destination?.tag_id) {
      setPostFocusMode(true, result.destination.tag_id);
      const focusView = computeFocusedPostView(result, getNavigationPosition());
      if (focusView) {
        const currentPosition = getNavigationPosition().clone();
        state.focusAnimation = {
          startedAt: performance.now(),
          durationMs: 900,
          fromPosition: currentPosition,
          toPosition: focusView.position,
          fromRadius: state.cameraRadius,
          toRadius: state.cameraRadius,
          fromYaw: inputState.yaw,
          toYaw: focusView.yaw,
          fromPitch: inputState.pitch,
          toPitch: focusView.pitch,
        };
      }
    } else {
      setPostFocusMode(false);
    }
    syncFocusedGhost();
    renderSearchResults();
    renderSelected(result);
  }
}

function updateMovement(deltaSeconds) {
  const activeKeys = new Set([...inputState.keys, ...state.moveButtons]);
  const hasMovementIntent = ["w", "a", "s", "d", "q", "e", "forward", "backward", "left", "right", "up", "down"]
    .some((key) => activeKeys.has(key));

  if (hasMovementIntent && (state.focusAnimation || state.travelAnimation) && isPostFocusModeActive()) {
    state.focusAnimation = null;
    cancelTravelAnimation();
  }

  if (state.focusAnimation || state.travelAnimation) {
    return;
  }
  const previousPosition = getNavigationPosition().clone();
  const { forward, right } = getCameraMovementBasis();
  const velocity = new THREE.Vector3();
  let vertical = 0;

  if (activeKeys.has("w") || activeKeys.has("forward")) {
    velocity.add(forward);
  }
  if (activeKeys.has("s") || activeKeys.has("backward")) {
    velocity.sub(forward);
  }
  if (activeKeys.has("a") || activeKeys.has("left")) {
    velocity.sub(right);
  }
  if (activeKeys.has("d") || activeKeys.has("right")) {
    velocity.add(right);
  }
  if (activeKeys.has("q") || activeKeys.has("down")) {
    vertical -= 1;
  }
  if (activeKeys.has("e") || activeKeys.has("up")) {
    vertical += 1;
  }

  if (velocity.lengthSq() === 0 && vertical === 0) {
    return;
  }

  if (isPostFocusModeActive()) {
    closeSelectedPost();
  }

  const speedMultiplier = inputState.keys.has("shift") ? 2.1 : 1;
  if (velocity.lengthSq() > 0) {
    velocity.normalize();
    state.navigationPosition.addScaledVector(
      velocity,
      deltaSeconds * CAMERA.movementSpeed * speedMultiplier,
    );
  }
  state.navigationPosition.y = clamp(
    state.navigationPosition.y + vertical * deltaSeconds * CAMERA.verticalSpeed * speedMultiplier,
    CAMERA.minY,
    CAMERA.maxY,
  );
  syncCameraToFollowTarget();
  leaveMovementTrail(previousPosition, getNavigationPosition(), deltaSeconds);
}

function pickSceneObject(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  sceneState.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  sceneState.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  const clickableEntries = sceneState.clickable.filter((entry) => isClickablePayloadPickable(entry));
  if (clickableEntries.length === 0) {
    return;
  }
  const hits = sceneState.raycaster.intersectObjects(
    clickableEntries.map((entry) => entry.mesh),
    false,
  );
  const top = hits.find((hit) => {
    const payload = clickableEntries.find((entry) => entry.mesh === hit.object);
    return Boolean(payload && isClickablePayloadPickable(payload));
  });
  if (!top) {
    return;
  }
  const payload = clickableEntries.find((entry) => entry.mesh === top.object);
  if (!payload) {
    return;
  }

  if (payload.type === "post") {
    openPostDetail(payload.data);
  } else if (payload.type === "pillar") {
    return;
  } else if (payload.type === "tag") {
    openTagCloud(payload.data);
  }
}

function getPrimaryPillar(entries = state.stream?.pillars ?? []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  return entries.reduce((best, entry) => {
    if (!best) {
      return entry;
    }
    return (entry.importance_score ?? 0) > (best.importance_score ?? 0) ? entry : best;
  }, null);
}

function computeOpeningShot(anchor, options = {}) {
  const player = new THREE.Vector3(
    anchor.x,
    anchor.y + Math.max(62, options.height * 0.38),
    anchor.z + Math.max(150, options.height * 0.78),
  );
  const target = getPlayerLookTarget(player);
  const position = new THREE.Vector3(
    player.x,
    Math.min(CAMERA.maxY - 2, target.y + Math.max(62, options.height * 0.16)),
    player.z + Math.max(86, options.radius * 2.2),
  );
  return { position, target, player };
}

function getLevelOpeningCameraPosition(position, target) {
  const leveled = position.clone();
  leveled.y = target.y;
  return leveled;
}

function positionCameraForWorldMeta() {
  if (!state.meta || state.initialViewFramed) {
    return;
  }
  const centerX = (state.meta.bounds.minX + state.meta.bounds.maxX) / 2;
  const centerZ = (state.meta.bounds.minZ + state.meta.bounds.maxZ) / 2;
  const spanX = Math.max(1, state.meta.bounds.maxX - state.meta.bounds.minX);
  const spanZ = Math.max(1, state.meta.bounds.maxZ - state.meta.bounds.minZ);
  const frame = computeOpeningShot(
    new THREE.Vector3(centerX, 0, centerZ),
    {
      height: Math.max(150, Math.min(220, Math.max(spanX, spanZ) * 0.46)),
      radius: Math.max(26, Math.min(42, Math.max(spanX, spanZ) * 0.08)),
    },
  );
  const { position, target } = frame;
  aimCameraAt(getLevelOpeningCameraPosition(position, target), target);
}

function frameInitialViewFromStream() {
  if (!state.stream || state.initialViewFramed) {
    return;
  }
  const primaryPillar = getPrimaryPillar(state.stream.pillars);
  if (primaryPillar) {
    const frame = computeOpeningShot(
      new THREE.Vector3(primaryPillar.position_x, primaryPillar.position_y, primaryPillar.position_z),
      {
        height: primaryPillar.height,
        radius: primaryPillar.radius,
      },
    );
    aimCameraAt(getLevelOpeningCameraPosition(frame.position, frame.target), frame.target);
    state.initialViewFramed = true;
    return;
  }
  const anchors = [
    ...state.stream.pillars.map((entry) => new THREE.Vector3(entry.position_x, entry.position_y + entry.height * 0.4, entry.position_z)),
    ...state.stream.tags.map((entry) => computeTagHomeAnchor(entry)),
  ];
  if (anchors.length === 0) {
    return;
  }
  const bounds = anchors.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
      minZ: Math.min(acc.minZ, point.z),
      maxZ: Math.max(acc.maxZ, point.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  const cameraDistance = Math.min(
    (state.meta?.renderer?.lod?.cellSize ?? 64) * 2.8,
    Math.max(138, Math.max(spanX, spanZ) * 0.56),
  );
  const target = new THREE.Vector3(center.x, center.y + Math.max(12, spanY * 0.14), center.z);
  const position = new THREE.Vector3(
    center.x + cameraDistance * 0.42,
    Math.max(112, center.y + spanY * 0.44 + 56),
    center.z + cameraDistance,
  );
  aimCameraAt(getLevelOpeningCameraPosition(position, target), target);
  state.initialViewFramed = true;
}

function onPointerDown(event) {
  inputState.pointerDown = true;
  inputState.dragDistance = 0;
  inputState.pointerMoved = false;
  inputState.lastPointerX = event.clientX;
  inputState.lastPointerY = event.clientY;
  elements.canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!inputState.pointerDown || state.travelAnimation) {
    return;
  }
  const deltaX = event.clientX - inputState.lastPointerX;
  const deltaY = event.clientY - inputState.lastPointerY;
  inputState.dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
  inputState.pointerMoved = inputState.dragDistance > 4;
  inputState.lastPointerX = event.clientX;
  inputState.lastPointerY = event.clientY;

  inputState.yaw -= deltaX * 0.0045;
  inputState.pitch = clamp(inputState.pitch - deltaY * 0.0036, CAMERA.lookMin, CAMERA.lookMax);
  updateCameraRotation();
}

function onPointerUp(event) {
  const clickLike = !inputState.pointerMoved;
  inputState.pointerDown = false;
  elements.canvas.releasePointerCapture(event.pointerId);
  if (clickLike) {
    pickSceneObject(event);
  }
}

function onWheel(event) {
  event.preventDefault();
  if (state.focusAnimation || state.travelAnimation) {
    return;
  }
  state.cameraRadius = clamp(
    state.cameraRadius + event.deltaY * 0.045,
    PLAYER_VIEW.minRadius,
    PLAYER_VIEW.maxRadius,
  );
  syncCameraToFollowTarget();
}

function registerInput() {
  window.addEventListener("resize", resizeScene);
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (MOVEMENT_KEYS.has(key)) {
      event.preventDefault();
    }
    inputState.keys.add(key);
    if (key === "escape") {
      closeSelectedPost();
    }
  });
  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (MOVEMENT_KEYS.has(key)) {
      event.preventDefault();
    }
    inputState.keys.delete(key);
  });

  elements.canvas.addEventListener("pointerdown", onPointerDown);
  elements.canvas.addEventListener("pointermove", onPointerMove);
  elements.canvas.addEventListener("pointerup", onPointerUp);
  elements.canvas.addEventListener("pointercancel", () => {
    inputState.pointerDown = false;
  });
  elements.canvas.addEventListener("wheel", onWheel, { passive: false });

  if (elements.touchpad) {
    for (const button of elements.touchpad.querySelectorAll("[data-move]")) {
      const direction = button.getAttribute("data-move");
      const start = () => state.moveButtons.add(direction);
      const end = () => state.moveButtons.delete(direction);
      button.addEventListener("pointerdown", start);
      button.addEventListener("pointerup", end);
      button.addEventListener("pointerleave", end);
      button.addEventListener("pointercancel", end);
    }
  }

  elements.inspectorClose?.addEventListener("click", () => {
    closeSelectedPost();
  });

  const searchInput = elements.searchForm?.querySelector('input[name="q"]');
  searchInput?.addEventListener("input", () => {
    if (String(searchInput.value ?? "").trim()) {
      return;
    }
    clearSearchResults();
  });
}

function animate() {
  const deltaSeconds = Math.min(0.05, sceneState.clock.getDelta());
  const elapsedSeconds = sceneState.clock.elapsedTime;
  const now = performance.now();

  updatePostFocusTransition(deltaSeconds);
  applyFocusAnimation();
  applyTravelAnimation(deltaSeconds);
  updateMovement(deltaSeconds);
  updateSnow(deltaSeconds, elapsedSeconds);
  updateAnimatedObjects(deltaSeconds, elapsedSeconds);
  updateFocusVeil();
  updateCameraPanel();
  sendPresence();
  if (now - state.lastStreamCheckAt > 450) {
    state.lastStreamCheckAt = now;
    loadStream().catch((error) => showToast(error.message));
  }

  sceneState.renderer.render(sceneState.scene, sceneState.camera);
  window.requestAnimationFrame(animate);
}

async function bootstrapWorld() {
  state.viewerSessionId = createViewerSessionId();
  initScene();
  registerInput();
  renderSelected(null);
  renderSearchResults();
  try {
    await loadMeta(true);
    positionCameraForWorldMeta();
    await loadStream(true);
    frameInitialViewFromStream();
    await loadStream(true);
    setSearchStatus("");
  } catch (error) {
    setSearchStatus(error.message);
    showToast(error.message, 6000);
  }

  window.setInterval(() => {
    loadMeta(true).catch((error) => showToast(error.message));
  }, 10000);

  window.setInterval(() => {
    loadStream().catch((error) => showToast(error.message));
  }, 5000);

  animate();
  setLoading(false);
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch().catch((error) => showToast(error.message));
});

void bootstrapWorld();
