import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { createPatternedMaterial } from "./private-world-materials.js";
import { renderScreenHtmlTexture } from "./screen-texture.js";
import { createBrowserMediaController } from "./world-browser-media.js";
import { createBubbleTexture, updateMascotMotion } from "./world-visitors.js";

const { mauworldApiUrl } = window.MauworldSocial;

const AI_KEY_STORAGE_KEY = "mauworldPrivateWorldAiKey";
const GUEST_SESSION_KEY = "mauworldPrivateWorldGuestSession";
const RUNTIME_INPUT_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "space", "shift"]);
const LAUNCHER_TABS = new Set(["create", "worlds", "access", "import"]);
const PRIVATE_PANEL_TABS = new Set(["chat", "share", "live", "build", "world"]);
const PRIVATE_CAMERA = {
  minY: 8,
  maxY: 360,
  lookMin: -1.1,
  lookMax: 1.1,
  movementSpeed: 48,
  verticalSpeed: 34,
  wheelFactor: 0.14,
};
const PRIVATE_PLAYER_VIEW = {
  lookHeight: 7.6,
  minRadius: 16,
  maxRadius: 110,
  defaultRadius: 28,
};
const PRIVATE_MOVEMENT_INTENT_KEYS = [
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "forward",
  "backward",
  "left",
  "right",
  "up",
  "down",
];
const PRIVATE_SPRINT_MOVEMENT_KEYS = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "forward",
  "backward",
  "left",
  "right",
];
const PRIVATE_SPRINT = {
  maxMultiplier: 5,
  rampSeconds: 10,
  decaySeconds: 10,
};
const PRIVATE_OVERHEAD_SCALE = 1;
const PRIVATE_CHAT_MAX_ENTRIES = 28;
const PRIVATE_CHAT_BUBBLE_BASE_WIDTH = 18 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_CHAT_BUBBLE_BASE_HEIGHT = 12 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_WIDTH = 820;
const PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_HEIGHT = 620;
const PRIVATE_CHAT_BUBBLE_MAX_LINES = 8;
const PRIVATE_CHAT_BUBBLE_MIN_WIDTH = 6.2 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_CHAT_BUBBLE_MIN_HEIGHT = 4.9 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_BROWSER_RADIUS = 96;
const PRIVATE_BROWSER_ASPECT_RATIO = 16 / 9;
const PRIVATE_BROWSER_SCREEN_WIDTH = 20 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_BROWSER_PLACEHOLDER_ASPECT_RATIO = 384 / 280;
const PRIVATE_BROWSER_PLACEHOLDER_AUDIO_WIDTH = 7.8 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_BROWSER_PLACEHOLDER_VIDEO_WIDTH = 8.6 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_BROWSER_LIVE_OFFSET_Y = 18 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_BROWSER_PLACEHOLDER_OFFSET_Y = 15.4 * PRIVATE_OVERHEAD_SCALE;
const PRIVATE_WORLD_STYLE = {
  background: "#fbfcff",
  fog: "#f4fbff",
  ground: "#ffffff",
  line: "#c9dcff",
  lineMuted: "#deebfa",
  outline: "#33407a",
  white: "#ffffff",
  trailOutline: "#bcc3cf",
  accents: ["#ff4fa8", "#2dd8ff", "#ffd84d", "#7ce85b", "#ff9548", "#7ed7ff"],
};

let privateToonGradientTexture = null;
const privateBillboardParentQuaternion = new THREE.Quaternion();
const privateBillboardCameraQuaternion = new THREE.Quaternion();
const privateChatGhostWorldPosition = new THREE.Vector3();
const privateChatGhostWorldScale = new THREE.Vector3();

const elements = {
  launcher: document.querySelector("[data-launcher]"),
  launcherToggle: document.querySelector("[data-launcher-toggle]"),
  launcherClose: document.querySelector("[data-launcher-close]"),
  sceneDrawer: document.querySelector("[data-scene-drawer]"),
  sceneToolsToggle: document.querySelector("[data-scene-tools-toggle]"),
  sceneToolsClose: document.querySelector("[data-scene-tools-close]"),
  worldMenu: document.querySelector("[data-world-menu]"),
  worldMenuToggle: document.querySelector("[data-world-menu-toggle]"),
  worldMenuClose: document.querySelector("[data-world-menu-close]"),
  inspector: document.querySelector("[data-inspector]"),
  selectionClear: document.querySelector("[data-selection-clear]"),
  authForm: document.querySelector("[data-auth-form]"),
  authStatus: document.querySelector("[data-auth-status]"),
  profileForm: document.querySelector("[data-profile-form]"),
  createWorldForm: document.querySelector("[data-create-world-form]"),
  refreshPublicWorlds: document.querySelector("[data-refresh-public-worlds]"),
  publicWorldSearch: document.querySelector("[data-public-world-search]"),
  publicWorldType: document.querySelector("[data-public-world-type]"),
  publicWorldList: document.querySelector("[data-public-world-list]"),
  refreshWorlds: document.querySelector("[data-refresh-worlds]"),
  worldSearch: document.querySelector("[data-world-search]"),
  worldList: document.querySelector("[data-world-list]"),
  importForm: document.querySelector("[data-import-form]"),
  resolveForm: document.querySelector("[data-resolve-form]"),
  panelTitle: document.querySelector("[data-private-panel-title]"),
  panelSubtitle: document.querySelector("[data-private-panel-subtitle]"),
  panelSessionLabel: document.querySelector("[data-private-session-label]"),
  panelOpenAccess: document.querySelector("[data-private-open-access]"),
  panelChatComposer: document.querySelector("[data-private-chat-composer]"),
  panelChatInput: document.querySelector("[data-private-chat-input]"),
  panelChatReactions: document.querySelector(".world-chat-reactions"),
  panelChatEmpty: document.querySelector("[data-private-chat-empty]"),
  panelLiveSearchForm: document.querySelector("[data-private-live-search-form]"),
  panelLiveSearchInput: document.querySelector("[data-private-live-search-input]"),
  panelLiveStatus: document.querySelector("[data-private-live-status]"),
  panelLiveResults: document.querySelector("[data-private-live-results]"),
  panelShareStatus: document.querySelector("[data-private-share-status]"),
  panelShareMeta: document.querySelector("[data-private-share-meta]"),
  panelShareCopy: document.querySelector("[data-private-copy-link]"),
  panelShareNative: document.querySelector("[data-private-native-share]"),
  panelBrowserPanel: document.querySelector("[data-private-browser-panel]"),
  panelBrowserDock: document.querySelector("[data-private-browser-dock]"),
  panelBrowserOverlayRoot: document.querySelector("[data-private-browser-overlay-root]"),
  panelBrowserBackdrop: document.querySelector("[data-private-browser-backdrop]"),
  panelBrowserExpand: document.querySelector("[data-private-browser-expand]"),
  panelBrowserLaunch: document.querySelector("[data-private-browser-launch]"),
  panelBrowserStop: document.querySelector("[data-private-browser-stop]"),
  panelBrowserShareTitle: document.querySelector("[data-private-browser-share-title]"),
  panelBrowserSummaryBadge: document.querySelector("[data-private-browser-summary-badge]"),
  panelBrowserSummaryCurrent: document.querySelector("[data-private-browser-summary-current]"),
  panelBrowserSummaryHint: document.querySelector("[data-private-browser-summary-hint]"),
  panelBrowserStatus: document.querySelector("[data-private-browser-status]"),
  panelBrowserStage: document.querySelector("[data-private-browser-stage]"),
  panelBrowserVideo: document.querySelector("[data-private-browser-video]"),
  panelBrowserFrame: document.querySelector("[data-private-browser-frame]"),
  panelBrowserPlaceholder: document.querySelector("[data-private-browser-placeholder]"),
  panelBrowserResume: document.querySelector("[data-private-browser-resume]"),
  panelBuildSummary: document.querySelector("[data-private-build-summary]"),
  panelWorldMeta: document.querySelector("[data-private-panel-world-meta]"),
  panelEvents: document.querySelector("[data-private-panel-events]"),
  panelModeBuild: document.querySelector("[data-private-panel-mode-build]"),
  panelModePlay: document.querySelector("[data-private-panel-mode-play]"),
  panelScenes: document.querySelector("[data-private-panel-scenes]"),
  panelWorld: document.querySelector("[data-private-panel-world]"),
  panelExport: document.querySelector("[data-private-panel-export]"),
  panelEnter: document.querySelector("[data-private-panel-enter]"),
  panelLeave: document.querySelector("[data-private-panel-leave]"),
  panelReady: document.querySelector("[data-private-panel-ready]"),
  panelStart: document.querySelector("[data-private-panel-start]"),
  panelRelease: document.querySelector("[data-private-panel-release]"),
  panelReset: document.querySelector("[data-private-panel-reset]"),
  worldMeta: document.querySelector("[data-world-meta]"),
  sceneStrip: document.querySelector("[data-scene-strip]"),
  sceneForm: document.querySelector("[data-scene-form]"),
  saveScene: document.querySelector("[data-save-scene]"),
  refreshScene: document.querySelector("[data-refresh-scene]"),
  entitySections: document.querySelector("[data-entity-sections]"),
  entityEditor: document.querySelector("[data-entity-editor]"),
  entityEmpty: document.querySelector("[data-entity-empty]"),
  selectionLabel: document.querySelector("[data-selection-label]"),
  prefabList: document.querySelector("[data-prefab-list]"),
  removeEntity: document.querySelector("[data-remove-entity]"),
  convertPrefab: document.querySelector("[data-convert-prefab]"),
  placePrefab: document.querySelector("[data-place-prefab]"),
  previewCanvas: document.querySelector("[data-preview-canvas]"),
  runtimeStatus: document.querySelector("[data-runtime-status]"),
  readyToggle: document.querySelector("[data-ready-toggle]"),
  startScene: document.querySelector("[data-start-scene]"),
  releasePlayer: document.querySelector("[data-release-player]"),
  resetScene: document.querySelector("[data-reset-scene]"),
  collaboratorForm: document.querySelector("[data-collaborator-form]"),
  saveCollaborator: document.querySelector("[data-save-collaborator]"),
  collaboratorList: document.querySelector("[data-collaborator-list]"),
  aiForm: document.querySelector("[data-ai-form]"),
  aiOutput: document.querySelector("[data-ai-output]"),
  generateHtml: document.querySelector("[data-generate-html]"),
  generateScript: document.querySelector("[data-generate-script]"),
  eventLog: document.querySelector("[data-event-log]"),
  addVoxel: document.querySelector("[data-add-voxel]"),
  addPrimitive: document.querySelector("[data-add-primitive]"),
  addPlayer: document.querySelector("[data-add-player]"),
  addScreen: document.querySelector("[data-add-screen]"),
  addText: document.querySelector("[data-add-text]"),
  addTrigger: document.querySelector("[data-add-trigger]"),
  addParticle: document.querySelector("[data-add-particle]"),
  addRule: document.querySelector("[data-add-rule]"),
};

elements.launcherTabButtons = [...document.querySelectorAll("[data-launcher-tab]")];
elements.launcherSections = [...document.querySelectorAll("[data-launcher-section]")];
elements.privatePanelTabButtons = [...document.querySelectorAll("[data-private-panel-tab]")];
elements.privatePanelViews = [...document.querySelectorAll("[data-private-panel-view]")];
elements.panelChatReactionButtons = [...document.querySelectorAll("[data-private-chat-reaction]")];
elements.panelBrowserShareModes = [...document.querySelectorAll("[data-private-browser-share-mode]")];

function createEmptyPrivateBrowserMediaState() {
  return {
    enabled: null,
    connected: false,
    transport: "jpeg-sequence",
    roomName: "",
    canPublish: false,
    remoteVideoSessionId: "",
    remoteAudioSessionId: "",
    remoteAudioAvailable: false,
    remoteAudioBlocked: false,
    remoteAudioError: "",
    lastPlayError: "",
  };
}

const state = {
  authConfig: null,
  supabase: null,
  session: null,
  profile: null,
  publicWorlds: [],
  worlds: [],
  selectedWorld: null,
  selectedSceneId: "",
  selectedPrefabId: "",
  builderSelection: null,
  worldSocket: null,
  preview: null,
  eventLog: [],
  livePresence: new Map(),
  joinedAsGuest: false,
  joined: false,
  launcherOpen: false,
  sceneDrawerOpen: false,
  worldMenuOpen: false,
  activeLockEntityKey: "",
  runtimeSnapshot: null,
  pressedRuntimeKeys: new Set(),
  launcherTab: "create",
  privatePanelTab: "chat",
  mode: "play",
  lockHeartbeatTimer: 0,
  privateChatEntries: [],
  activeChats: new Map(),
  browserSessions: new Map(),
  localBrowserSessionId: "",
  browserMediaController: null,
  pendingBrowserShare: null,
  localBrowserShare: null,
  localBrowserPreviewStream: null,
  browserShareMode: "screen",
  browserPanelRemoteSessionId: "",
  browserOverlayOpen: false,
  browserMediaState: createEmptyPrivateBrowserMediaState(),
  browserMediaCanvas: null,
  browserMediaCanvasContext: null,
  browserMediaImage: null,
  browserMediaPendingFrameId: 0,
  worldSocketKey: "",
  viewerPosition: new THREE.Vector3(0, PRIVATE_CAMERA.minY, 10),
  viewerCameraPosition: new THREE.Vector3(8, PRIVATE_CAMERA.minY + 6, 20),
  cameraRadius: PRIVATE_PLAYER_VIEW.defaultRadius,
  liveShareQuery: "",
  trailAccumulator: 0,
  lastPresenceSentAt: 0,
  viewerSuppressClickAt: 0,
  buildDrag: null,
  launchHandled: false,
};

const privateInputState = {
  keys: new Set(),
  sprintHoldSeconds: 0,
  pointerDown: false,
  dragDistance: 0,
  lastPointerX: 0,
  lastPointerY: 0,
  pointerMoved: false,
  yaw: 0,
  pitch: 0.66,
};

function getGuestSessionId() {
  const existing = window.sessionStorage.getItem(GUEST_SESSION_KEY);
  if (existing) {
    return existing;
  }
  const next = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(GUEST_SESSION_KEY, next);
  return next;
}

function setStatus(text) {
  if (elements.authStatus) {
    elements.authStatus.textContent = text || "";
  }
}

function getPrivateViewerSessionId() {
  if (state.profile?.id) {
    return `profile:${state.profile.id}`;
  }
  return getGuestSessionId();
}

function getPrivateDisplayName() {
  return state.profile?.display_name || state.profile?.username || "guest viewer";
}

function getPrivateBrowserMediaCanvas() {
  if (!state.browserMediaCanvas) {
    state.browserMediaCanvas = document.createElement("canvas");
    state.browserMediaCanvas.width = 960;
    state.browserMediaCanvas.height = 540;
    state.browserMediaCanvasContext = state.browserMediaCanvas.getContext("2d");
    state.browserMediaImage = new Image();
  }
  if (state.browserMediaCanvas.width !== 960 || state.browserMediaCanvas.height !== 540) {
    state.browserMediaCanvas.width = 960;
    state.browserMediaCanvas.height = 540;
  }
  return state.browserMediaCanvas;
}

function drawPrivateBrowserMediaFrame(frame = {}) {
  if (!frame?.dataUrl) {
    return;
  }
  const nextFrameId = Math.max(0, Math.floor(Number(frame.frameId) || 0));
  if (nextFrameId < state.browserMediaPendingFrameId) {
    return;
  }
  state.browserMediaPendingFrameId = nextFrameId;
  const canvas = getPrivateBrowserMediaCanvas();
  const context = state.browserMediaCanvasContext;
  const image = state.browserMediaImage;
  if (!canvas || !context || !image) {
    return;
  }
  image.onload = () => {
    if (nextFrameId < state.browserMediaPendingFrameId) {
      return;
    }
    const sourceWidth = image.naturalWidth || frame.width || canvas.width;
    const sourceHeight = image.naturalHeight || frame.height || canvas.height;
    const scale = Math.min(canvas.width / Math.max(1, sourceWidth), canvas.height / Math.max(1, sourceHeight));
    const drawWidth = Math.max(1, sourceWidth * scale);
    const drawHeight = Math.max(1, sourceHeight * scale);
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;
    context.fillStyle = "#02050f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  };
  image.src = frame.dataUrl;
}

function publishLocalPrivateBrowserMedia(sessionId) {
  const session = state.browserSessions.get(sessionId);
  const worldSnapshotId = getPrivateBrowserWorldKey();
  if (
    !session
    || session.hostSessionId !== getPrivateViewerSessionId()
    || session.frameTransport !== "livekit-canvas"
    || !worldSnapshotId
  ) {
    return;
  }
  void getPrivateBrowserMediaController().publishCanvas({
    sessionId,
    canvas: getPrivateBrowserMediaCanvas(),
    fps: 24,
    viewerSessionId: getPrivateViewerSessionId(),
    worldSnapshotId,
  });
}

function getPrivateBrowserWorldKey(world = state.selectedWorld) {
  if (!world?.world_id || !world?.creator?.username) {
    return "";
  }
  return `private:${world.world_id}:${String(world.creator.username).trim().toLowerCase()}`;
}

function setPrivatePanelTab(tab, options = {}) {
  const nextTab = PRIVATE_PANEL_TABS.has(tab) ? tab : "build";
  const syncMode = options.syncMode !== false;
  state.privatePanelTab = nextTab;
  if (syncMode && nextTab === "build" && state.mode !== "build" && isEditor()) {
    setMode("build");
    return;
  }
  for (const button of elements.privatePanelTabButtons ?? []) {
    const active = button.getAttribute("data-private-panel-tab") === nextTab;
    button.classList.toggle("is-active", active);
    if (button.getAttribute("role") === "tab") {
      button.setAttribute("aria-selected", String(active));
    } else {
      button.setAttribute("aria-pressed", String(active));
    }
  }
  for (const view of elements.privatePanelViews ?? []) {
    view.hidden = view.getAttribute("data-private-panel-view") !== nextTab;
  }
  if (nextTab === "live") {
    renderPrivateLiveSharesList();
  }
}

function updateShellState() {
  document.body.classList.toggle("has-world", Boolean(state.selectedWorld));
  document.body.classList.toggle("is-launcher-open", state.launcherOpen === true);
  document.body.classList.toggle("is-scene-drawer-open", state.sceneDrawerOpen === true);
  document.body.classList.toggle("is-world-menu-open", state.worldMenuOpen === true);
  document.body.classList.toggle("is-signed-in", Boolean(state.session));
  document.body.classList.toggle(
    "has-selection",
    Boolean(state.builderSelection && state.mode === "build" && isEditor()),
  );
  setLauncherTab(state.launcherTab);
  setPrivatePanelTab(state.privatePanelTab, { syncMode: false });
}

function setLauncherOpen(open) {
  state.launcherOpen = open === true;
  if (state.launcherOpen) {
    state.sceneDrawerOpen = false;
    state.worldMenuOpen = false;
    state.builderSelection = null;
    if (!LAUNCHER_TABS.has(state.launcherTab)) {
      state.launcherTab = getPreferredLauncherTab();
    }
  }
  updateShellState();
}

function setSceneDrawerOpen(open) {
  state.sceneDrawerOpen = open === true;
  if (state.sceneDrawerOpen) {
    state.worldMenuOpen = false;
  }
  updateShellState();
}

function setWorldMenuOpen(open) {
  state.worldMenuOpen = open === true;
  if (state.worldMenuOpen) {
    state.sceneDrawerOpen = false;
  }
  updateShellState();
}

function pushEvent(title, body) {
  state.eventLog.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    body,
    createdAt: new Date().toLocaleTimeString(),
  });
  state.eventLog = state.eventLog.slice(0, 18);
  renderEventLog();
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeAngle(angle) {
  let next = Number(angle) || 0;
  while (next > Math.PI) {
    next -= Math.PI * 2;
  }
  while (next < -Math.PI) {
    next += Math.PI * 2;
  }
  return next;
}

function hashPrivateString(value = "") {
  let hash = 0;
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickPrivateAccent(seed, offset = 0) {
  return PRIVATE_WORLD_STYLE.accents[(hashPrivateString(seed) + offset) % PRIVATE_WORLD_STYLE.accents.length];
}

function pickPrivateAccentSet(seed) {
  return {
    primary: pickPrivateAccent(seed, 0),
    secondary: pickPrivateAccent(seed, 2),
    tertiary: pickPrivateAccent(seed, 4),
  };
}

function getPrivateToonGradientTexture() {
  if (privateToonGradientTexture) {
    return privateToonGradientTexture;
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

  privateToonGradientTexture = new THREE.CanvasTexture(canvas);
  privateToonGradientTexture.minFilter = THREE.NearestFilter;
  privateToonGradientTexture.magFilter = THREE.NearestFilter;
  privateToonGradientTexture.generateMipmaps = false;
  privateToonGradientTexture.needsUpdate = true;
  return privateToonGradientTexture;
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

function createPrivateBillboard(texture, width, height, options = {}) {
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
  return mesh;
}

function createViewerAvatarFigure(options = {}) {
  const seed = options.seed ?? "viewer-self";
  const scale = options.scale ?? 0.52;
  const accents = pickPrivateAccentSet(seed);
  const outlineColor = options.outlineColor ?? PRIVATE_WORLD_STYLE.accents[0];
  const primary = options.primary ?? accents.primary;
  const secondary = options.secondary ?? accents.secondary;
  const tertiary = options.tertiary ?? accents.tertiary;
  const group = new THREE.Group();
  const poseRoot = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.9 * scale, 40),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#dfe7f5"),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      fog: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  shadow.scale.set(1.16, 0.72, 1);
  group.add(shadow);
  group.add(poseRoot);

  const bodyGeometry = new THREE.CapsuleGeometry(1.45 * scale, 2.4 * scale, 6, 16);
  const headGeometry = new THREE.SphereGeometry(2.15 * scale, 24, 24);
  const earGeometry = new THREE.ConeGeometry(0.8 * scale, 1.9 * scale, 16);
  const limbGeometry = new THREE.CapsuleGeometry(0.38 * scale, 1.3 * scale, 4, 10);

  const whiteMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(PRIVATE_WORLD_STYLE.white) });
  const primaryMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(primary) });
  const secondaryMaterial = new THREE.MeshToonMaterial({ color: new THREE.Color(secondary) });
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
    const earShell = createOutlineShell(earGeometry, primary, 1.12);
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
        color: new THREE.Color(side > 0 ? primary : secondary),
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
      color: new THREE.Color(primary),
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
    new THREE.MeshToonMaterial({ color: new THREE.Color(tertiary) }),
  );
  orb.position.set(0, 12.8 * scale, 0);
  poseRoot.add(orb);

  return {
    group,
    poseRoot,
    halo,
    orb,
    shadow,
  };
}

function isEmojiOnlyPrivateChatText(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return false;
  }
  const compact = trimmed.replace(/\s+/gu, "");
  return /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+$/u.test(compact);
}

function createPrivateActorBubbleState(color, options = {}) {
  const anchorY = Number(options.anchorY ?? 15.2) || 15.2;
  const bubble = createPrivateBillboard(
    createBubbleTexture("💬", {
      accent: color,
      stroke: PRIVATE_WORLD_STYLE.outline,
      text: "",
    }),
    PRIVATE_CHAT_BUBBLE_BASE_WIDTH,
    PRIVATE_CHAT_BUBBLE_BASE_HEIGHT,
    {
      opacity: 0,
      fog: false,
      depthTest: false,
      renderOrder: 11,
      persistent: options.persistent === true,
    },
  );
  bubble.visible = false;
  bubble.position.set(0, anchorY, 0);
  return {
    mesh: bubble,
    currentKey: "",
    opacity: 0,
    targetOpacity: 0,
    duration: 0,
    elapsed: 0,
    highEnergy: false,
    bounceCount: 0,
    anchorY,
    baseWidth: PRIVATE_CHAT_BUBBLE_BASE_WIDTH,
    baseHeight: PRIVATE_CHAT_BUBBLE_BASE_HEIGHT,
    width: PRIVATE_CHAT_BUBBLE_BASE_WIDTH,
    height: PRIVATE_CHAT_BUBBLE_BASE_HEIGHT,
    targetWidth: PRIVATE_CHAT_BUBBLE_BASE_WIDTH,
    targetHeight: PRIVATE_CHAT_BUBBLE_BASE_HEIGHT,
  };
}

function removePrivateChatBubbleGhost(preview, entry) {
  if (!preview?.animatedChatBubbleGhosts || !entry?.mesh) {
    return;
  }
  if (entry.mesh.parent) {
    entry.mesh.parent.remove(entry.mesh);
  }
  entry.mesh.geometry?.dispose?.();
  entry.mesh.material?.map?.dispose?.();
  entry.mesh.material?.dispose?.();
  const index = preview.animatedChatBubbleGhosts.indexOf(entry);
  if (index >= 0) {
    preview.animatedChatBubbleGhosts.splice(index, 1);
  }
}

function spawnPrivateChatBubbleGhost(actorEntry, texture, preview = state.preview) {
  if (!preview?.chatBubbleGhosts || !actorEntry?.bubble?.mesh || !texture || actorEntry.bubble.opacity <= 0.04) {
    texture?.dispose?.();
    return;
  }
  actorEntry.bubble.mesh.updateWorldMatrix(true, false);
  actorEntry.bubble.mesh.getWorldPosition(privateChatGhostWorldPosition);
  actorEntry.bubble.mesh.getWorldScale(privateChatGhostWorldScale);
  const baseWidth = Number(actorEntry.bubble.baseWidth) || PRIVATE_CHAT_BUBBLE_BASE_WIDTH;
  const baseHeight = Number(actorEntry.bubble.baseHeight) || PRIVATE_CHAT_BUBBLE_BASE_HEIGHT;
  const mesh = createPrivateBillboard(texture, baseWidth, baseHeight, {
    opacity: actorEntry.bubble.mesh.material.opacity,
    fog: false,
    depthTest: false,
    renderOrder: 10,
  });
  mesh.position.copy(privateChatGhostWorldPosition);
  mesh.scale.copy(privateChatGhostWorldScale);
  preview.chatBubbleGhosts.add(mesh);
  preview.animatedChatBubbleGhosts.push({
    mesh,
    opacity: actorEntry.bubble.mesh.material.opacity,
    lifetime: 1.55 + Math.random() * 0.35,
    age: 0,
    drift: new THREE.Vector3(
      (Math.random() - 0.5) * 0.32,
      2.6 + Math.random() * 0.8,
      (Math.random() - 0.5) * 0.14,
    ),
    scaleBase: privateChatGhostWorldScale.clone(),
  });
}

function orientPrivateBillboardToCamera(mesh, camera) {
  if (!mesh || !camera) {
    return;
  }
  const parent = mesh.parent;
  if (!parent) {
    mesh.quaternion.copy(camera.quaternion);
    return;
  }
  parent.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(privateBillboardParentQuaternion);
  camera.getWorldQuaternion(privateBillboardCameraQuaternion);
  privateBillboardParentQuaternion.invert();
  mesh.quaternion.copy(privateBillboardParentQuaternion.multiply(privateBillboardCameraQuaternion));
}

function getPrivateChatBubbleTargetSize(texture, bubble) {
  const baseWidth = Number(bubble?.baseWidth) || PRIVATE_CHAT_BUBBLE_BASE_WIDTH;
  const baseHeight = Number(bubble?.baseHeight) || PRIVATE_CHAT_BUBBLE_BASE_HEIGHT;
  const layout = texture?.userData?.bubbleLayout ?? null;
  if (!layout?.hasText) {
    return { width: baseWidth, height: baseHeight };
  }
  const maxTextureWidth = Math.max(
    1,
    Number(layout.maxWidth) || Number(layout.width) || PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_WIDTH,
  );
  const maxTextureHeight = Math.max(
    1,
    Number(layout.maxHeight) || Number(layout.height) || PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_HEIGHT,
  );
  return {
    width: clampNumber(
      baseWidth * ((Number(layout.width) || maxTextureWidth) / maxTextureWidth),
      baseWidth,
      PRIVATE_CHAT_BUBBLE_MIN_WIDTH,
      baseWidth,
    ),
    height: clampNumber(
      baseHeight * ((Number(layout.height) || maxTextureHeight) / maxTextureHeight),
      baseHeight,
      PRIVATE_CHAT_BUBBLE_MIN_HEIGHT,
      baseHeight,
    ),
  };
}

function applyPrivateChatBubbleToActor(actorEntry, chatEvent) {
  if (!actorEntry?.bubble) {
    return;
  }
  if (!chatEvent || Date.parse(chatEvent.expiresAt ?? 0) <= Date.now()) {
    actorEntry.bubble.targetOpacity = 0;
    return;
  }
  const accent = actorEntry.bubbleAccent ?? PRIVATE_WORLD_STYLE.accents[1];
  const text = String(chatEvent.text ?? "").trim();
  const emojiOnly = chatEvent.mode !== "placeholder" && isEmojiOnlyPrivateChatText(text);
  const symbol = chatEvent.mode === "placeholder" ? "..." : emojiOnly ? text : "💬";
  const bubbleText = emojiOnly ? "" : text;
  const bubbleKey = `${chatEvent.mode}:${text}:${accent}`;
  if (actorEntry.bubble.currentKey !== bubbleKey) {
    const previousKey = actorEntry.bubble.currentKey;
    const previousMap = actorEntry.bubble.mesh.material.map;
    const nextTexture = createBubbleTexture(symbol, {
      accent,
      stroke: PRIVATE_WORLD_STYLE.outline,
      text: bubbleText,
      width: bubbleText ? PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_WIDTH : undefined,
      height: bubbleText ? PRIVATE_CHAT_BUBBLE_TEXTURE_MAX_HEIGHT : undefined,
      maxLines: bubbleText ? PRIVATE_CHAT_BUBBLE_MAX_LINES : undefined,
    });
    actorEntry.bubble.mesh.material.map = nextTexture;
    actorEntry.bubble.mesh.material.needsUpdate = true;
    const nextSize = getPrivateChatBubbleTargetSize(nextTexture, actorEntry.bubble);
    actorEntry.bubble.targetWidth = nextSize.width;
    actorEntry.bubble.targetHeight = nextSize.height;
    if (previousMap) {
      if (previousKey && !previousKey.startsWith("placeholder:")) {
        spawnPrivateChatBubbleGhost(actorEntry, previousMap);
      } else {
        previousMap.dispose?.();
      }
    }
    actorEntry.bubble.currentKey = bubbleKey;
  }
  actorEntry.bubble.mesh.visible = true;
  actorEntry.bubble.targetOpacity = 1;
  actorEntry.bubble.duration = Math.max(0.5, (Date.parse(chatEvent.expiresAt) - Date.now()) / 1000);
  actorEntry.bubble.elapsed = 0;
  actorEntry.bubble.highEnergy = chatEvent.mode !== "placeholder";
  actorEntry.bubble.bounceCount = actorEntry.bubble.highEnergy ? 2 : 0;
}

function updatePrivateActorBubble(actorEntry, deltaSeconds, camera = state.preview?.camera) {
  if (!actorEntry?.bubble?.mesh) {
    return;
  }
  actorEntry.bubble.width += (actorEntry.bubble.targetWidth - actorEntry.bubble.width) * (1 - Math.exp(-deltaSeconds * 12));
  actorEntry.bubble.height += (actorEntry.bubble.targetHeight - actorEntry.bubble.height) * (1 - Math.exp(-deltaSeconds * 12));
  actorEntry.bubble.opacity += (actorEntry.bubble.targetOpacity - actorEntry.bubble.opacity) * (1 - Math.exp(-deltaSeconds * 10));
  if (Math.abs(actorEntry.bubble.opacity - actorEntry.bubble.targetOpacity) < 0.004) {
    actorEntry.bubble.opacity = actorEntry.bubble.targetOpacity;
  }
  if (actorEntry.bubble.targetOpacity > 0) {
    actorEntry.bubble.elapsed += deltaSeconds;
    if (actorEntry.bubble.elapsed >= actorEntry.bubble.duration) {
      actorEntry.bubble.targetOpacity = 0;
    }
  }
  const bounce =
    actorEntry.bubble.highEnergy && actorEntry.bubble.duration > 0
      ? Math.abs(Math.sin((actorEntry.bubble.elapsed / actorEntry.bubble.duration) * Math.PI * actorEntry.bubble.bounceCount)) * 0.9
      : 0;
  actorEntry.bubble.mesh.visible = actorEntry.bubble.opacity > 0.01 && actorEntry.group.visible !== false;
  actorEntry.bubble.mesh.position.y = actorEntry.bubble.anchorY + bounce;
  const pulse = 0.92 + actorEntry.bubble.opacity * 0.08;
  actorEntry.bubble.mesh.scale.set(
    (actorEntry.bubble.width / actorEntry.bubble.baseWidth) * pulse,
    (actorEntry.bubble.height / actorEntry.bubble.baseHeight) * pulse,
    1,
  );
  actorEntry.bubble.mesh.material.opacity = actorEntry.bubble.opacity * (actorEntry.opacity ?? 1);
  if (camera) {
    orientPrivateBillboardToCamera(actorEntry.bubble.mesh, camera);
  }
}

function pruneExpiredPrivateChatEvents() {
  const now = Date.now();
  for (const [presenceId, event] of state.activeChats.entries()) {
    if (Date.parse(event.expiresAt ?? 0) > now) {
      continue;
    }
    state.activeChats.delete(presenceId);
    const presenceEntry = state.preview?.presenceEntries?.get(presenceId);
    if (presenceEntry?.bubble) {
      presenceEntry.bubble.targetOpacity = 0;
    }
    if (presenceId === getPrivateViewerSessionId() && state.preview?.viewerAvatar?.bubble) {
      state.preview.viewerAvatar.bubble.targetOpacity = 0;
    }
  }
}

function getPrivatePresenceEntryId(entry = {}) {
  return String(entry.viewer_session_id ?? entry.viewerSessionId ?? entry.id ?? "").trim();
}

function getPrivatePresenceDisplayName(entry = {}) {
  const actor = entry.actor ?? {};
  const actorName = String(actor.display_name ?? actor.displayName ?? "").trim();
  if (actorName) {
    return actorName;
  }
  const movementName = String(entry.movement_state?.displayName ?? entry.movement_state?.display_name ?? "").trim();
  if (movementName) {
    return movementName;
  }
  return "viewer";
}

function buildPrivatePresenceObject(entry) {
  const presenceId = getPrivatePresenceEntryId(entry);
  const displayName = getPrivatePresenceDisplayName(entry);
  const seed = hashPrivateString(presenceId || displayName);
  const accents = PRIVATE_WORLD_STYLE.accents;
  const primary = accents[seed % accents.length];
  const secondary = accents[(seed + 2) % accents.length];
  const tertiary = accents[(seed + 4) % accents.length];
  const figure = createViewerAvatarFigure({
    scale: 0.72,
    outlineColor: primary,
    primary,
    secondary,
    tertiary,
  });
  figure.group.position.set(
    Number(entry.position_x ?? 0) || 0,
    Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
    Number(entry.position_z ?? 0) || 0,
  );
  const bubble = createPrivateActorBubbleState(primary);
  figure.group.add(bubble.mesh);
  return {
    id: presenceId,
    group: figure.group,
    shadow: figure.shadow,
    halo: figure.halo,
    orb: figure.orb,
    orbBaseY: figure.orb.position.y,
    baseY: Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
    position: new THREE.Vector3(
      Number(entry.position_x ?? 0) || 0,
      Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
      Number(entry.position_z ?? 0) || 0,
    ),
    targetPosition: new THREE.Vector3(
      Number(entry.position_x ?? 0) || 0,
      Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
      Number(entry.position_z ?? 0) || 0,
    ),
    displayName,
    bob: 0.55 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    bubble,
    bubbleAccent: primary,
  };
}

function getPrivateBrowserHostPosition(hostSessionId = "") {
  const normalized = String(hostSessionId ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized === getPrivateViewerSessionId()) {
    return state.preview?.viewerAvatar?.group?.position
      ?? new THREE.Vector3(state.viewerPosition.x, state.viewerPosition.y, state.viewerPosition.z);
  }
  const renderedPosition = state.preview?.presenceEntries?.get(normalized)?.group?.position ?? null;
  if (renderedPosition) {
    return renderedPosition;
  }
  const entry = state.livePresence.get(normalized);
  if (!entry) {
    return null;
  }
  return new THREE.Vector3(
    Number(entry.position_x ?? 0) || 0,
    Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
    Number(entry.position_z ?? 0) || 0,
  );
}

function getPrivateBrowserSessionShareKind(session = {}) {
  return normalizeBrowserShareKind(session?.shareKind, session?.sessionMode === "remote-browser" ? "browser" : "screen");
}

function getPrivateBrowserPlaceholderBadge(session = {}) {
  if (
    !session
    || String(session.hostSessionId ?? "").trim() === getPrivateViewerSessionId()
    || session.deliveryMode !== "placeholder"
  ) {
    return "";
  }
  const maxViewers = getPrivateBrowserSessionMaxViewers(session);
  const viewerCount = getPrivateBrowserSessionViewerCount(session);
  if (viewerCount < maxViewers) {
    return "";
  }
  const hostPosition = getPrivateBrowserHostPosition(session.hostSessionId);
  if (!hostPosition) {
    return "";
  }
  const listenerPosition = getPrivatePresencePosition();
  const planarDistance = Math.hypot(
    listenerPosition.x - hostPosition.x,
    listenerPosition.z - hostPosition.z,
  );
  if (planarDistance > Math.max(16, PRIVATE_BROWSER_RADIUS)) {
    return "";
  }
  return "FULL";
}

function computePrivateRemoteBrowserAudioVolume(session) {
  if (!session || session.hostSessionId === getPrivateViewerSessionId() || session.deliveryMode !== "full") {
    return 0;
  }
  const hostPosition = getPrivateBrowserHostPosition(session.hostSessionId);
  if (!hostPosition) {
    return 0;
  }
  const listenerPosition = getPrivatePresencePosition();
  const planarDistance = Math.hypot(
    listenerPosition.x - hostPosition.x,
    listenerPosition.z - hostPosition.z,
  );
  const maxDistance = Math.max(16, PRIVATE_BROWSER_RADIUS);
  const fullVolumeDistance = Math.min(8, Math.max(5, maxDistance * 0.08));
  if (planarDistance <= fullVolumeDistance) {
    return 1;
  }
  if (planarDistance >= maxDistance) {
    return 0;
  }
  const t = clampNumber(
    (planarDistance - fullVolumeDistance) / Math.max(1, maxDistance - fullVolumeDistance),
    0,
    0,
    1,
  );
  const gain = Math.pow(1 - t, 3.5);
  return gain < 0.02 ? 0 : gain;
}

function updatePrivateRemoteBrowserAudioMix() {
  if (!state.browserMediaController) {
    return;
  }
  for (const session of state.browserSessions.values()) {
    if (session.hostSessionId === getPrivateViewerSessionId()) {
      continue;
    }
    state.browserMediaController.setRemoteAudioVolume({
      sessionId: session.sessionId,
      volume: computePrivateRemoteBrowserAudioVolume(session),
    });
  }
}

function getPrivateBrowserPlaceholderTextureKey(session = {}) {
  return [
    getPrivateBrowserSessionShareKind(session),
    String(session?.deliveryMode ?? "placeholder"),
    String(getPrivateBrowserPlaceholderBadge(session)),
  ].join(":");
}

function createPrivateShareBubbleTexture(session = {}) {
  const shareKind = getPrivateBrowserSessionShareKind(session);
  const badge = getPrivateBrowserPlaceholderBadge(session);
  const accent = shareKind === "audio"
    ? PRIVATE_WORLD_STYLE.accents[3]
    : shareKind === "camera"
      ? PRIVATE_WORLD_STYLE.accents[0]
      : PRIVATE_WORLD_STYLE.accents[1];
  const symbol = shareKind === "audio"
    ? "📞"
    : shareKind === "camera"
      ? "🤩"
      : "📺";
  return createBubbleTexture(symbol, {
    accent,
    stroke: PRIVATE_WORLD_STYLE.outline,
    badge,
    badgeBackground: badge ? "rgba(255, 79, 168, 0.92)" : undefined,
    badgeStroke: badge ? "rgba(255, 255, 255, 0.26)" : undefined,
  });
}

function updatePrivateShareBubbleGeometry(entry) {
  if (!entry?.frame || !entry?.frameShell) {
    return;
  }
  const aspectRatio = Number(entry.session?.aspectRatio) || PRIVATE_BROWSER_ASPECT_RATIO;
  if (Math.abs((entry.geometryAspectRatio ?? 0) - aspectRatio) < 0.01) {
    return;
  }
  const width = PRIVATE_BROWSER_SCREEN_WIDTH;
  const height = width / Math.max(0.1, aspectRatio);
  entry.frame.geometry.dispose();
  entry.frame.geometry = new THREE.PlaneGeometry(width, height);
  entry.frameShell.geometry.dispose();
  entry.frameShell.geometry = new THREE.PlaneGeometry(width + 1.2, height + 1.2);
  entry.geometryAspectRatio = aspectRatio;
}

function updatePrivateShareBubbleAspectFromVideo(entry, videoElement) {
  if (!entry || !videoElement) {
    return;
  }
  const applyAspect = () => {
    const width = Math.max(0, Math.floor(Number(videoElement.videoWidth) || 0));
    const height = Math.max(0, Math.floor(Number(videoElement.videoHeight) || 0));
    if (!width || !height) {
      return;
    }
    const nextAspectRatio = width / Math.max(1, height);
    if (Math.abs(nextAspectRatio - (Number(entry.session?.aspectRatio) || 0)) < 0.01) {
      return;
    }
    entry.session = {
      ...entry.session,
      aspectRatio: nextAspectRatio,
    };
    updatePrivateShareBubbleGeometry(entry);
  };
  if (videoElement.videoWidth && videoElement.videoHeight) {
    applyAspect();
    return;
  }
  videoElement.addEventListener("loadedmetadata", applyAspect, { once: true });
}

function isPrivateShareBubbleShowingLiveMedia(entry) {
  return Boolean(entry?.deliveryMode === "full" && (entry.videoTexture || entry.currentFrameId > 0));
}

function updatePrivateShareBubblePresentation(entry) {
  if (!entry?.frame) {
    return;
  }
  const nextPlaceholderKey = getPrivateBrowserPlaceholderTextureKey(entry.session);
  if (entry.placeholderKey !== nextPlaceholderKey) {
    entry.placeholderTexture?.dispose?.();
    entry.placeholderTexture = createPrivateShareBubbleTexture(entry.session);
    entry.placeholderKey = nextPlaceholderKey;
  }
  const hasRemoteVideo = entry.deliveryMode === "full" && entry.videoTexture;
  const hasLiveFrame = entry.deliveryMode === "full" && entry.currentFrameId > 0;
  const desiredMap = hasRemoteVideo
    ? entry.videoTexture
    : hasLiveFrame
      ? entry.liveTexture
      : entry.placeholderTexture;
  const showingPlaceholder = desiredMap === entry.placeholderTexture;
  const shareKind = getPrivateBrowserSessionShareKind(entry.session);
  const aspectRatio = Number(entry.session?.aspectRatio) || PRIVATE_BROWSER_ASPECT_RATIO;
  const baseWidth = PRIVATE_BROWSER_SCREEN_WIDTH;
  const baseHeight = baseWidth / Math.max(0.1, aspectRatio);
  const bubbleWidth = shareKind === "audio"
    ? PRIVATE_BROWSER_PLACEHOLDER_AUDIO_WIDTH
    : PRIVATE_BROWSER_PLACEHOLDER_VIDEO_WIDTH;
  const bubbleHeight = bubbleWidth / PRIVATE_BROWSER_PLACEHOLDER_ASPECT_RATIO;
  const scaleX = showingPlaceholder ? bubbleWidth / baseWidth : 1;
  const scaleY = showingPlaceholder ? bubbleHeight / Math.max(0.1, baseHeight) : 1;
  entry.frame.scale.set(scaleX, scaleY, 1);
  entry.frame.position.set(0, 0, 0);
  entry.frame.material.depthTest = false;
  entry.frame.material.opacity = showingPlaceholder ? 0.96 : 1;
  entry.frame.renderOrder = showingPlaceholder ? 11 : 10;
  entry.frameShell.visible = false;
  if (entry.frame.material.map !== desiredMap) {
    entry.frame.material.map = desiredMap;
    entry.frame.material.needsUpdate = true;
  }
  entry.frame.material.needsUpdate = true;
}

function setPrivateShareBubbleVideo(sessionId, videoElement) {
  const preview = state.preview;
  if (!preview?.browserShareEntries) {
    return;
  }
  const entry = preview.browserShareEntries.get(sessionId);
  if (!entry || !videoElement) {
    return;
  }
  if (entry.videoElement === videoElement && entry.videoTexture) {
    updatePrivateShareBubblePresentation(entry);
    return;
  }
  clearPrivateShareBubbleVideo(sessionId);
  entry.videoElement = videoElement;
  entry.videoTexture = new THREE.VideoTexture(videoElement);
  entry.videoTexture.colorSpace = THREE.SRGBColorSpace;
  entry.videoTexture.generateMipmaps = false;
  entry.videoTexture.minFilter = THREE.LinearFilter;
  entry.videoTexture.magFilter = THREE.LinearFilter;
  updatePrivateShareBubbleAspectFromVideo(entry, videoElement);
  updatePrivateShareBubblePresentation(entry);
}

function clearPrivateShareBubbleVideo(sessionId) {
  const preview = state.preview;
  if (!preview?.browserShareEntries) {
    return;
  }
  const entry = preview.browserShareEntries.get(sessionId);
  if (!entry) {
    return;
  }
  entry.videoTexture?.dispose?.();
  entry.videoTexture = null;
  if (entry.videoElement && entry.videoElement !== elements.panelBrowserVideo) {
    entry.videoElement.remove?.();
  }
  entry.videoElement = null;
  updatePrivateShareBubblePresentation(entry);
}

function updatePrivateShareBubbleFrame(sessionId, frame) {
  const preview = state.preview;
  if (!preview?.browserShareEntries) {
    return;
  }
  const entry = preview.browserShareEntries.get(sessionId);
  if (!entry || !frame?.dataUrl || Number(frame.frameId ?? 0) <= entry.currentFrameId) {
    return;
  }
  entry.currentFrameId = Number(frame.frameId ?? 0);
  entry.liveImage.src = frame.dataUrl;
  updatePrivateShareBubblePresentation(entry);
}

function removePrivateShareBubbleEntry(sessionId) {
  const preview = state.preview;
  const entry = preview?.browserShareEntries?.get(sessionId);
  if (!entry) {
    return;
  }
  clearPrivateShareBubbleVideo(sessionId);
  preview.browserShareEntries.delete(sessionId);
  entry.group.parent?.remove(entry.group);
  entry.liveTexture?.dispose?.();
  entry.placeholderTexture?.dispose?.();
  entry.frame.geometry?.dispose?.();
  entry.frameShell.geometry?.dispose?.();
  entry.frame.material?.dispose?.();
  entry.frameShell.material?.dispose?.();
}

function ensurePrivateShareBubbleEntry(session = {}) {
  const preview = state.preview;
  if (!preview?.browserShares) {
    return null;
  }
  const sessionId = String(session.sessionId ?? "").trim();
  if (!sessionId) {
    return null;
  }
  const existing = preview.browserShareEntries.get(sessionId);
  if (existing) {
    existing.session = { ...existing.session, ...session };
    existing.hostSessionId = String(session.hostSessionId ?? existing.hostSessionId ?? "").trim();
    updatePrivateShareBubbleGeometry(existing);
    return existing;
  }

  const aspectRatio = Number(session.aspectRatio) || PRIVATE_BROWSER_ASPECT_RATIO;
  const width = PRIVATE_BROWSER_SCREEN_WIDTH;
  const height = width / Math.max(0.1, aspectRatio);
  const group = new THREE.Group();
  const frameShell = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 1.2, height + 1.2),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#0d1537"),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: false,
    }),
  );
  frameShell.renderOrder = 9;
  group.add(frameShell);

  const liveImage = new Image();
  const liveTexture = new THREE.Texture(liveImage);
  liveTexture.colorSpace = THREE.SRGBColorSpace;
  liveImage.addEventListener("load", () => {
    liveTexture.needsUpdate = true;
  });
  const placeholderTexture = createPrivateShareBubbleTexture(session);
  const frame = createPrivateBillboard(placeholderTexture, width, height, {
    opacity: 1,
    fog: false,
    depthTest: false,
    renderOrder: 10,
    persistent: true,
  });
  group.add(frame);
  preview.browserShares.add(group);
  const entry = {
    sessionId,
    hostSessionId: String(session.hostSessionId ?? "").trim(),
    session,
    group,
    frameShell,
    frame,
    liveImage,
    liveTexture,
    placeholderTexture,
    placeholderKey: getPrivateBrowserPlaceholderTextureKey(session),
    videoElement: null,
    videoTexture: null,
    position: new THREE.Vector3(),
    targetPosition: new THREE.Vector3(),
    currentFrameId: 0,
    deliveryMode: String(session.deliveryMode ?? "placeholder"),
    geometryAspectRatio: aspectRatio,
  };
  preview.browserShareEntries.set(sessionId, entry);
  updatePrivateShareBubblePresentation(entry);
  return entry;
}

function reconcilePrivateShareBubbles() {
  const preview = state.preview;
  if (!preview?.browserShareEntries) {
    return;
  }
  const activeIds = new Set([...state.browserSessions.keys()]);
  for (const sessionId of [...preview.browserShareEntries.keys()]) {
    if (!activeIds.has(sessionId)) {
      removePrivateShareBubbleEntry(sessionId);
    }
  }
  for (const session of state.browserSessions.values()) {
    const entry = ensurePrivateShareBubbleEntry(session);
    if (!entry) {
      continue;
    }
    entry.deliveryMode = session.deliveryMode ?? "placeholder";
    entry.session = session;
    entry.hostSessionId = String(session.hostSessionId ?? entry.hostSessionId ?? "").trim();
    updatePrivateShareBubbleGeometry(entry);
    if (session.hasVideo === false) {
      clearPrivateShareBubbleVideo(session.sessionId);
    }
    if (session._remoteElement) {
      setPrivateShareBubbleVideo(session.sessionId, session._remoteElement);
    } else if (
      session.hostSessionId === getPrivateViewerSessionId()
      && elements.panelBrowserVideo
      && elements.panelBrowserVideo.srcObject
    ) {
      setPrivateShareBubbleVideo(session.sessionId, elements.panelBrowserVideo);
    }
    updatePrivateShareBubblePresentation(entry);
  }
}

function updatePrivateShareBubbles(deltaSeconds, elapsedSeconds) {
  const preview = state.preview;
  if (!preview?.browserShareEntries?.size || !preview?.camera) {
    return;
  }
  for (const session of state.browserSessions.values()) {
    const entry = ensurePrivateShareBubbleEntry(session);
    if (!entry) {
      continue;
    }
    const hostPosition = getPrivateBrowserHostPosition(session.hostSessionId);
    if (!hostPosition) {
      entry.group.visible = false;
      continue;
    }
    entry.session = session;
    entry.hostSessionId = String(session.hostSessionId ?? entry.hostSessionId ?? "").trim();
    entry.deliveryMode = session.deliveryMode ?? "placeholder";
    updatePrivateShareBubbleGeometry(entry);
    updatePrivateShareBubblePresentation(entry);
    const showingLiveMedia = isPrivateShareBubbleShowingLiveMedia(entry);
    entry.targetPosition.copy(hostPosition);
    entry.targetPosition.y += showingLiveMedia
      ? PRIVATE_BROWSER_LIVE_OFFSET_Y + Math.sin(elapsedSeconds * 1.3) * 0.7
      : PRIVATE_BROWSER_PLACEHOLDER_OFFSET_Y + Math.sin(elapsedSeconds * 1.1) * 0.18;
    entry.position.lerp(entry.targetPosition, 1 - Math.exp(-deltaSeconds * 8));
    entry.group.visible = true;
    entry.group.position.copy(entry.position);
    entry.group.rotation.set(0, 0, 0);
    entry.frame.quaternion.copy(preview.camera.quaternion);
  }
}

function updatePrivateChatBubbleGhosts(preview, deltaSeconds, camera = preview?.camera) {
  if (!preview?.animatedChatBubbleGhosts?.length) {
    return;
  }
  for (let index = preview.animatedChatBubbleGhosts.length - 1; index >= 0; index -= 1) {
    const entry = preview.animatedChatBubbleGhosts[index];
    entry.age += deltaSeconds;
    const life = clampNumber(entry.age / entry.lifetime, 0, 0, 1);
    entry.mesh.position.addScaledVector(entry.drift, deltaSeconds);
    entry.mesh.scale.copy(entry.scaleBase).multiplyScalar(1 + life * 0.18);
    entry.mesh.material.opacity = entry.opacity * Math.pow(1 - life, 1.6);
    if (camera) {
      orientPrivateBillboardToCamera(entry.mesh, camera);
    }
    if (life >= 1) {
      removePrivateChatBubbleGhost(preview, entry);
    }
  }
}

function removePrivatePresenceObject(presenceId) {
  const preview = state.preview;
  const entry = preview?.presenceEntries?.get(presenceId);
  if (!entry) {
    return;
  }
  preview.presenceEntries.delete(presenceId);
  entry.group.parent?.remove(entry.group);
  entry.group.traverse((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => {
        material?.map?.dispose?.();
        material?.dispose?.();
      });
    } else {
      node.material?.map?.dispose?.();
      node.material?.dispose?.();
    }
  });
}

function upsertPrivatePresenceObject(entry) {
  const preview = state.preview;
  const presenceId = getPrivatePresenceEntryId(entry);
  if (!preview?.presence || !presenceId || presenceId === getPrivateViewerSessionId()) {
    return;
  }
  const displayName = getPrivatePresenceDisplayName(entry);
  const existing = preview.presenceEntries.get(presenceId);
  if (!existing) {
    const next = buildPrivatePresenceObject(entry);
    preview.presenceEntries.set(presenceId, next);
    preview.presence.add(next.group);
    applyPrivateChatBubbleToActor(next, state.activeChats.get(presenceId));
    return;
  }
  existing.displayName = displayName;
  existing.baseY = Number(entry.position_y ?? existing.baseY) || existing.baseY;
  existing.targetPosition.set(
    Number(entry.position_x ?? existing.targetPosition.x) || 0,
    Number(entry.position_y ?? existing.targetPosition.y) || existing.targetPosition.y,
    Number(entry.position_z ?? existing.targetPosition.z) || 0,
  );
}

function reconcilePrivatePresenceScene() {
  const preview = state.preview;
  if (!preview?.presenceEntries) {
    return;
  }
  const desiredIds = new Set(
    [...state.livePresence.values()]
      .map((entry) => getPrivatePresenceEntryId(entry))
      .filter((presenceId) => presenceId && presenceId !== getPrivateViewerSessionId()),
  );
  for (const presenceId of [...preview.presenceEntries.keys()]) {
    if (!desiredIds.has(presenceId)) {
      removePrivatePresenceObject(presenceId);
    }
  }
  for (const entry of state.livePresence.values()) {
    upsertPrivatePresenceObject(entry);
  }
}

function mergePrivatePresenceRows(rows = [], options = {}) {
  if (options.replaceViewerSnapshot) {
    state.livePresence.clear();
  }
  for (const entry of rows) {
    const presenceId = getPrivatePresenceEntryId(entry);
    if (!presenceId || presenceId === getPrivateViewerSessionId()) {
      continue;
    }
    state.livePresence.set(presenceId, {
      ...entry,
    });
  }
  reconcilePrivatePresenceScene();
}

function removePrivatePresence(presenceId) {
  const normalized = String(presenceId ?? "").trim();
  if (!normalized) {
    return;
  }
  state.livePresence.delete(normalized);
  removePrivatePresenceObject(normalized);
}

function updatePrivatePresenceScene(deltaSeconds, elapsedSeconds) {
  const preview = state.preview;
  if (!preview?.presenceEntries) {
    return;
  }
  for (const entry of preview.presenceEntries.values()) {
    entry.position.lerp(entry.targetPosition, 1 - Math.exp(-deltaSeconds * 7.5));
    entry.group.position.copy(entry.position);
    entry.group.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 0.9;
    if (entry.shadow) {
      entry.shadow.position.y = -entry.group.position.y + 0.05;
    }
    if (entry.halo) {
      entry.halo.rotation.z += deltaSeconds * 1.14;
    }
    if (entry.orb) {
      entry.orb.position.y = entry.orbBaseY + Math.sin(elapsedSeconds * 1.4 + entry.phase) * 0.26;
    }
    updatePrivateActorBubble(entry, deltaSeconds, preview.camera);
  }
}

function getPreferredLauncherTab() {
  if (state.selectedWorld || state.worlds.length > 0) {
    return "worlds";
  }
  return "create";
}

function setLauncherTab(tab) {
  const nextTab = LAUNCHER_TABS.has(tab) ? tab : getPreferredLauncherTab();
  state.launcherTab = nextTab;
  for (const button of elements.launcherTabButtons ?? []) {
    const active = button.getAttribute("data-launcher-tab") === nextTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const section of elements.launcherSections ?? []) {
    const active = section.getAttribute("data-launcher-section") === nextTab;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  }
}

function getViewerSpawnPosition(world = state.selectedWorld) {
  if (!world) {
    return new THREE.Vector3(0, PRIVATE_CAMERA.minY + 0.8, 0);
  }
  const rig = getPrivateViewerRigConfig(world);
  const width = Math.max(12, Number(world?.width ?? 40) || 40);
  const length = Math.max(12, Number(world?.length ?? 40) || 40);
  return new THREE.Vector3(
    clampNumber(-width * 0.06, -2, -4, 4),
    rig.spawnHeight,
    clampNumber(length * 0.08, 0, -4, 8),
  );
}

function getPrivateViewerRigConfig(world = state.selectedWorld) {
  const width = Math.max(4, Number(world?.width ?? (world ? 40 : 64)) || (world ? 40 : 64));
  const length = Math.max(4, Number(world?.length ?? (world ? 40 : 64)) || (world ? 40 : 64));
  const height = Math.max(2, Number(world?.height ?? (world ? 10 : 12)) || (world ? 10 : 12));
  const minRadius = PRIVATE_PLAYER_VIEW.minRadius;
  const defaultRadius = PRIVATE_PLAYER_VIEW.defaultRadius;
  const maxRadius = PRIVATE_PLAYER_VIEW.maxRadius;
  const spawnHeight = clampNumber(
    PRIVATE_CAMERA.minY,
    PRIVATE_CAMERA.minY,
    6,
    Math.max(PRIVATE_CAMERA.minY, height + 6),
  );
  const lookHeight = PRIVATE_PLAYER_VIEW.lookHeight;
  return {
    width,
    length,
    height,
    minRadius,
    defaultRadius,
    maxRadius,
    spawnHeight,
    lookHeight,
    minY: PRIVATE_CAMERA.minY,
    maxY: Math.max(PRIVATE_CAMERA.minY + 8, height + 12),
  };
}

function getPrivateWorldBounds(world = state.selectedWorld) {
  const rig = getPrivateViewerRigConfig(world);
  const { width, length, height } = rig;
  return {
    width,
    length,
    height,
    minX: -width / 2,
    maxX: width / 2,
    minZ: -length / 2,
    maxZ: length / 2,
    minY: rig.minY,
    maxY: rig.maxY,
  };
}

function clampViewerPositionToWorldBounds(position, world = state.selectedWorld) {
  if (!position) {
    return position;
  }
  const bounds = getPrivateWorldBounds(world);
  position.x = clampNumber(position.x, position.x, bounds.minX, bounds.maxX);
  position.z = clampNumber(position.z, position.z, bounds.minZ, bounds.maxZ);
  position.y = clampNumber(position.y, position.y, bounds.minY, bounds.maxY);
  return position;
}

function resetViewerRig(world = state.selectedWorld) {
  const rig = getPrivateViewerRigConfig(world);
  privateInputState.yaw = 0;
  privateInputState.pitch = world ? -0.34 : 0.66;
  privateInputState.sprintHoldSeconds = 0;
  privateInputState.pointerDown = false;
  privateInputState.pointerMoved = false;
  privateInputState.dragDistance = 0;
  privateInputState.keys.clear();
  state.cameraRadius = rig.defaultRadius;
  state.trailAccumulator = 0;
  state.viewerSuppressClickAt = 0;
  state.viewerPosition.copy(getViewerSpawnPosition(world));
  state.viewerCameraPosition.set(
    state.viewerPosition.x,
    state.viewerPosition.y + Math.max(4, rig.defaultRadius * 0.42),
    state.viewerPosition.z + state.cameraRadius,
  );
  if (state.preview?.camera) {
    syncPrivateCameraToFollowTarget(state.preview);
  }
  if (state.preview?.viewerAvatar) {
    state.preview.viewerAvatar.position.copy(state.viewerPosition);
    state.preview.viewerAvatar.lastPosition.copy(state.viewerPosition);
    state.preview.viewerAvatar.group.position.copy(state.viewerPosition);
    state.preview.viewerAvatar.facingYaw = normalizeAngle(privateInputState.yaw + Math.PI);
  }
}

function setByPath(target, path, value) {
  const segments = String(path ?? "").split(".").filter(Boolean);
  if (!segments.length) {
    return;
  }
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

function getPrivateFlatForwardVector(yaw = privateInputState.yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

function getPrivatePlayerLookTarget(position = state.viewerPosition, world = state.selectedWorld) {
  const rig = getPrivateViewerRigConfig(world);
  return position.clone().add(new THREE.Vector3(0, rig.lookHeight, 0));
}

function getPrivateCameraForwardVector(yaw = privateInputState.yaw, pitch = privateInputState.pitch) {
  const cosPitch = Math.cos(pitch);
  return new THREE.Vector3(
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  ).normalize();
}

function getPrivateCameraPlanarBasis(preview = state.preview) {
  const fallbackForward = getPrivateFlatForwardVector();
  if (!preview?.camera) {
    return {
      forward: fallbackForward,
      right: new THREE.Vector3(Math.cos(privateInputState.yaw), 0, -Math.sin(privateInputState.yaw)),
    };
  }

  const forward = new THREE.Vector3();
  preview.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.000001) {
    forward.copy(fallbackForward);
  } else {
    forward.normalize();
  }

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 0.000001) {
    right.set(Math.cos(privateInputState.yaw), 0, -Math.sin(privateInputState.yaw));
  } else {
    right.normalize();
  }
  return { forward, right };
}

function getPrivateCameraMovementBasis(preview = state.preview) {
  const planarBasis = getPrivateCameraPlanarBasis(preview);
  if (!preview?.camera) {
    return planarBasis;
  }
  const fullForward = new THREE.Vector3();
  preview.camera.getWorldDirection(fullForward);
  if (fullForward.lengthSq() < 0.000001) {
    return planarBasis;
  }
  fullForward.normalize();
  const tiltMix = Math.max(0, Math.min(1, (Math.abs(privateInputState.pitch) - 0.34) / 0.5));
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

function syncPrivateCameraToFollowTarget(preview = state.preview) {
  if (!preview?.camera) {
    return;
  }
  const rig = getPrivateViewerRigConfig();
  const target = getPrivatePlayerLookTarget();
  const radius = clampNumber(
    state.cameraRadius,
    state.cameraRadius,
    rig.minRadius,
    rig.maxRadius,
  );
  const cosPitch = Math.cos(privateInputState.pitch);
  const nextPosition = new THREE.Vector3(
    target.x + Math.sin(privateInputState.yaw) * cosPitch * radius,
    target.y - Math.sin(privateInputState.pitch) * radius,
    target.z + Math.cos(privateInputState.yaw) * cosPitch * radius,
  );
  preview.camera.position.copy(nextPosition);
  preview.camera.lookAt(target);
  state.viewerCameraPosition.copy(preview.camera.position);
}

function deleteByPath(target, path) {
  const segments = String(path ?? "").split(".").filter(Boolean);
  if (!segments.length) {
    return;
  }
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    cursor = cursor?.[segments[index]];
    if (!cursor || typeof cursor !== "object") {
      return;
    }
  }
  delete cursor[segments[segments.length - 1]];
}

function describeVector3(input = {}) {
  return `${Number(input.x ?? 0).toFixed(1)}, ${Number(input.y ?? 0).toFixed(1)}, ${Number(input.z ?? 0).toFixed(1)}`;
}

const ENTITY_COLLECTIONS = [
  { kind: "voxel", key: "voxels", label: "Voxels" },
  { kind: "primitive", key: "primitives", label: "Objects" },
  { kind: "player", key: "players", label: "Players" },
  { kind: "screen", key: "screens", label: "Screens" },
  { kind: "text", key: "texts", label: "3D Text" },
  { kind: "trigger", key: "trigger_zones", label: "Trigger Zones" },
  { kind: "particle", key: "particles", label: "Particles" },
  { kind: "prefab_instance", key: "prefab_instances", label: "Prefab Instances" },
];

const MATERIAL_PRESET_OPTIONS = [
  "none",
  "grass",
  "wood",
  "wall",
  "floor",
  "stone",
  "metal",
  "glass",
  "fabric",
];

const PRIMITIVE_SHAPES = ["box", "sphere", "capsule", "cylinder", "cone", "plane"];
const PLAYER_CAMERA_MODES = ["third_person", "first_person", "top_down"];
const PLAYER_BODY_MODES = ["rigid", "ghost"];
const EFFECT_OPTIONS = ["", "sparkles", "smoke", "glow", "embers", "mist"];
const TRAIL_OPTIONS = ["", "ribbon", "glow", "spark", "comet"];

function getEntityCollection(key) {
  return ENTITY_COLLECTIONS.find((entry) => entry.key === key || entry.kind === key) ?? null;
}

function getEntityArray(sceneDoc, key) {
  return Array.isArray(sceneDoc?.[key]) ? sceneDoc[key] : [];
}

function getDisplayNameForEntity(kind, entry = {}, index = 0) {
  if (kind === "voxel") {
    return entry.id || `Voxel ${index + 1}`;
  }
  if (kind === "primitive") {
    return entry.label || entry.id || `Object ${index + 1}`;
  }
  if (kind === "player") {
    return entry.label || entry.id || `Player ${index + 1}`;
  }
  if (kind === "screen") {
    return entry.id || `Screen ${index + 1}`;
  }
  if (kind === "text") {
    return entry.value || entry.id || `Text ${index + 1}`;
  }
  if (kind === "trigger") {
    return entry.label || entry.id || `Trigger ${index + 1}`;
  }
  if (kind === "particle") {
    return entry.effect || entry.id || `Particle ${index + 1}`;
  }
  if (kind === "prefab_instance") {
    return entry.label || entry.id || `Prefab ${index + 1}`;
  }
  return entry.id || `Item ${index + 1}`;
}

function getSelectedEntity(sceneDoc = parseSceneTextarea()) {
  if (!state.builderSelection?.kind || !state.builderSelection?.id) {
    return null;
  }
  const config = getEntityCollection(state.builderSelection.kind);
  if (!config) {
    return null;
  }
  const entries = getEntityArray(sceneDoc, config.key);
  const index = entries.findIndex((entry) => entry.id === state.builderSelection.id);
  if (index < 0) {
    return null;
  }
  return {
    ...config,
    index,
    entry: entries[index],
  };
}

function ensureBuilderSelection(sceneDoc = parseSceneTextarea()) {
  const selected = getSelectedEntity(sceneDoc);
  if (selected) {
    return selected;
  }
  state.builderSelection = null;
  return null;
}

function setBuilderSelection(kind, id) {
  state.builderSelection = kind && id ? { kind, id } : null;
  updateShellState();
  renderSceneBuilder();
  updatePreviewFromSelection();
}

function setAiKey(value) {
  if (value) {
    window.sessionStorage.setItem(AI_KEY_STORAGE_KEY, value);
  } else {
    window.sessionStorage.removeItem(AI_KEY_STORAGE_KEY);
  }
}

function getAiKey() {
  return window.sessionStorage.getItem(AI_KEY_STORAGE_KEY) || "";
}

function getJoinAnchorPayload() {
  const params = new URLSearchParams(window.location.search);
  const asNumber = (key) => {
    const raw = params.get(key);
    if (raw == null || raw === "") {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    publicWorldSnapshotId: params.get("publicWorldSnapshotId") || undefined,
    position_x: asNumber("anchorX") ?? 0,
    position_y: asNumber("anchorY") ?? 0,
    position_z: asNumber("anchorZ") ?? 0,
  };
}

function getLaunchRequest() {
  const params = new URLSearchParams(window.location.search);
  const worldId = String(params.get("worldId") ?? "").trim();
  const creatorUsername = String(params.get("creatorUsername") ?? "").trim();
  return {
    worldId: worldId || "",
    creatorUsername: creatorUsername || "",
    autojoin: params.get("autojoin") === "true",
    fork: params.get("fork") === "true",
  };
}

function normalizeRuntimeKey(event) {
  const key = String(event.key ?? "").trim().toLowerCase();
  if (key === " ") {
    return "space";
  }
  return key;
}

function buildSocketUrl(worldId, creatorUsername) {
  const url = new URL(
    mauworldApiUrl("/ws/private/worlds", {
      worldId,
      creatorUsername,
      accessToken: state.session?.access_token || "",
      guestSessionId: state.session ? "" : getGuestSessionId(),
    }),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sendWorldSocketMessage(payload) {
  if (!state.worldSocket || state.worldSocket.readyState !== WebSocket.OPEN) {
    return false;
  }
  state.worldSocket.send(JSON.stringify(payload));
  return true;
}

function getPrivatePresencePosition() {
  const possessed = getPossessedRuntimePlayer();
  if (possessed?.position) {
    return {
      x: Number(possessed.position.x ?? 0) || 0,
      y: Number(possessed.position.y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
      z: Number(possessed.position.z ?? 0) || 0,
      heading: Number(possessed.rotation?.y ?? privateInputState.yaw) || privateInputState.yaw,
    };
  }
  return {
    x: state.viewerPosition.x,
    y: state.viewerPosition.y,
    z: state.viewerPosition.z,
    heading: privateInputState.yaw,
  };
}

function sendPrivatePresence(force = false) {
  if (!state.joined || !getLocalParticipant()) {
    return false;
  }
  const now = performance.now();
  if (!force && now - state.lastPresenceSentAt < 120) {
    return false;
  }
  state.lastPresenceSentAt = now;
  const position = getPrivatePresencePosition();
  return sendWorldSocketMessage({
    type: "presence:update",
    position_x: Number(position.x.toFixed(4)),
    position_y: Number(position.y.toFixed(4)),
    position_z: Number(position.z.toFixed(4)),
    heading_y: Number(position.heading.toFixed(4)),
  });
}

function pushPrivateChatEntry(payload = {}) {
  const text = String(payload.text ?? "").trim();
  if (!text) {
    return;
  }
  const actorSessionId = String(payload.actorSessionId ?? payload.viewerSessionId ?? "").trim();
  const expiresAt = payload.expiresAt
    || new Date(Date.now() + Math.max(2200, Math.min(8800, text.length * 82 + 2400))).toISOString();
  const createdAt = payload.createdAt
    ? new Date(payload.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  state.privateChatEntries.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    actorSessionId,
    displayName: String(payload.displayName ?? payload.actor?.display_name ?? "viewer").trim() || "viewer",
    text,
    createdAt,
  });
  state.privateChatEntries = state.privateChatEntries.slice(0, PRIVATE_CHAT_MAX_ENTRIES);
  if (actorSessionId) {
    state.activeChats.set(actorSessionId, {
      text,
      mode: payload.mode === "placeholder" ? "placeholder" : "full",
      expiresAt,
    });
    const presenceEntry = state.preview?.presenceEntries?.get(actorSessionId);
    if (presenceEntry) {
      applyPrivateChatBubbleToActor(presenceEntry, state.activeChats.get(actorSessionId));
    }
    if (actorSessionId === getPrivateViewerSessionId() && state.preview?.viewerAvatar) {
      applyPrivateChatBubbleToActor(state.preview.viewerAvatar, state.activeChats.get(actorSessionId));
    }
  }
  renderPrivateChat();
}

function sendPrivateChat(text) {
  const message = String(text ?? "").trim();
  if (!message || !state.selectedWorld || !state.session || !getLocalParticipant()) {
    return false;
  }
  const sent = sendWorldSocketMessage({
    type: "chat:send",
    text: message,
  });
  if (sent && elements.panelChatInput) {
    elements.panelChatInput.value = "";
  }
  return sent;
}

function sanitizeBrowserShareTitle(rawTitle, fallback = "") {
  const cleaned = String(rawTitle ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

function normalizeBrowserShareKind(rawKind, fallback = "screen") {
  const value = String(rawKind ?? "").trim().toLowerCase();
  if (value === "screen" || value === "camera" || value === "audio") {
    return value;
  }
  return fallback;
}

function getDisplayShareLabel(videoTrack) {
  const settings = videoTrack?.getSettings?.() ?? {};
  const displaySurface = String(settings.displaySurface ?? "").trim().toLowerCase();
  if (displaySurface === "browser") {
    return "Shared tab";
  }
  if (displaySurface === "window") {
    return "Shared window";
  }
  return "Shared screen";
}

function getDefaultBrowserShareTitle(shareKind, videoTrack = null) {
  const kind = normalizeBrowserShareKind(shareKind, "screen");
  if (kind === "camera") {
    return "Live video";
  }
  if (kind === "audio") {
    return "Live voice";
  }
  return getDisplayShareLabel(videoTrack);
}

function getBrowserShareKindLabel(shareKind) {
  const kind = normalizeBrowserShareKind(shareKind, "screen");
  if (kind === "camera") {
    return "Video";
  }
  if (kind === "audio") {
    return "Voice";
  }
  return "Screen";
}

function isLiveKitBrowserTransport(frameTransport) {
  return String(frameTransport ?? "").startsWith("livekit");
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function setLocalPrivateBrowserPreviewStream(stream = null) {
  state.localBrowserPreviewStream = stream ?? null;
  setPrivateBrowserPreviewStream(state.localBrowserPreviewStream);
}

function ensurePrivateBrowserVideoPlayback(element) {
  if (!element) {
    return;
  }
  element.autoplay = true;
  element.playsInline = true;
  element.muted = true;
  element.defaultMuted = true;
  const playPromise = element.play?.();
  playPromise?.then?.(() => {
    if (state.browserMediaState.lastPlayError) {
      state.browserMediaState.lastPlayError = "";
      updatePrivateBrowserPanel();
    }
  });
  playPromise?.catch?.((error) => {
    const message = String(error?.name || error?.message || "play failed");
    if (state.browserMediaState.lastPlayError !== message) {
      state.browserMediaState.lastPlayError = message;
      updatePrivateBrowserPanel();
    }
  });
}

function setPrivateBrowserPreviewStream(stream) {
  if (!elements.panelBrowserVideo) {
    return;
  }
  if (elements.panelBrowserVideo.srcObject !== stream) {
    elements.panelBrowserVideo.srcObject = stream ?? null;
  }
  elements.panelBrowserVideo.hidden = !stream;
  if (stream) {
    ensurePrivateBrowserVideoPlayback(elements.panelBrowserVideo);
  } else {
    elements.panelBrowserVideo.pause?.();
  }
}

function setPrivateBrowserStatus(text) {
  if (elements.panelBrowserStatus) {
    elements.panelBrowserStatus.textContent = text || "";
  }
}

function updatePrivateBrowserSummary(summary = {}) {
  if (elements.panelBrowserSummaryBadge) {
    elements.panelBrowserSummaryBadge.textContent = summary.badge || "Idle";
    elements.panelBrowserSummaryBadge.dataset.state = summary.state || "idle";
  }
  if (elements.panelBrowserSummaryCurrent) {
    elements.panelBrowserSummaryCurrent.textContent = summary.current || "Not sharing yet";
  }
  if (elements.panelBrowserSummaryHint) {
    elements.panelBrowserSummaryHint.textContent = summary.hint || "";
  }
}

function setPrivateBrowserOverlayOpen(open) {
  state.browserOverlayOpen = Boolean(open);
  if (!elements.panelBrowserPanel) {
    return;
  }
  if (state.browserOverlayOpen) {
    elements.panelBrowserOverlayRoot?.append(elements.panelBrowserPanel);
  } else {
    elements.panelBrowserDock?.before(elements.panelBrowserPanel);
  }
  elements.panelBrowserPanel.classList.toggle("is-expanded", state.browserOverlayOpen);
  elements.panelBrowserBackdrop?.classList.toggle("is-visible", state.browserOverlayOpen);
  elements.panelBrowserBackdrop?.setAttribute("aria-hidden", state.browserOverlayOpen ? "false" : "true");
  if (elements.panelBrowserExpand) {
    elements.panelBrowserExpand.textContent = state.browserOverlayOpen ? "Dock" : "Focus";
    elements.panelBrowserExpand.setAttribute("aria-expanded", String(state.browserOverlayOpen));
  }
  if (elements.panelBrowserStage) {
    elements.panelBrowserStage.tabIndex = state.browserOverlayOpen ? 0 : -1;
  }
}

function getSelectedPrivateBrowserShareMode() {
  return normalizeBrowserShareKind(state.browserShareMode, "screen");
}

function setSelectedPrivateBrowserShareMode(mode) {
  state.browserShareMode = normalizeBrowserShareKind(mode, "screen");
  for (const button of elements.panelBrowserShareModes ?? []) {
    const active = button.getAttribute("data-private-browser-share-mode") === state.browserShareMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function getRequestedPrivateBrowserShareTitle(fallback = "") {
  return sanitizeBrowserShareTitle(elements.panelBrowserShareTitle?.value ?? "", fallback);
}

function getLocalPrivateBrowserSession() {
  return state.localBrowserSessionId ? state.browserSessions.get(state.localBrowserSessionId) ?? null : null;
}

function createLocalPrivateBrowserShare(stream, options = {}) {
  const videoTrack = stream?.getVideoTracks?.()[0] ?? null;
  const audioTrack = stream?.getAudioTracks?.()[0] ?? null;
  const shareKind = normalizeBrowserShareKind(options.shareKind, "screen");
  const settings = videoTrack?.getSettings?.() ?? {};
  const share = {
    stream,
    videoTrack,
    audioTrack,
    observedTrack: videoTrack ?? audioTrack ?? null,
    shareKind,
    title: sanitizeBrowserShareTitle(options.title, getDefaultBrowserShareTitle(shareKind, videoTrack)),
    displaySurface: String(options.displaySurface ?? settings.displaySurface ?? "").trim().toLowerCase(),
    aspectRatio: Number(options.aspectRatio) > 0
      ? Number(options.aspectRatio)
      : Math.max(0.3, Number(settings.width) || 16) / Math.max(1, Number(settings.height) || 9),
    hasVideo: options.hasVideo === true || (options.hasVideo !== false && Boolean(videoTrack)),
    hasAudio: options.hasAudio === true || (options.hasAudio !== false && Boolean(audioTrack)),
    endedHandler: null,
  };
  share.endedHandler = () => {
    if (state.pendingBrowserShare?.stream === share.stream) {
      clearPendingPrivateBrowserShare({ stopTracks: false });
      updatePrivateBrowserPanel();
      return;
    }
    if (state.localBrowserShare?.stream !== share.stream) {
      return;
    }
    const sessionId = state.localBrowserShare?.sessionId || "";
    clearLocalPrivateBrowserShare({ stopTracks: false, sessionId });
    if (sessionId) {
      sendWorldSocketMessage({
        type: "browser:stop",
        sessionId,
      });
    }
    updatePrivateBrowserPanel();
  };
  share.observedTrack?.addEventListener?.("ended", share.endedHandler, { once: true });
  return share;
}

function releasePrivateBrowserShare(share, { stopTracks = false } = {}) {
  if (!share) {
    return;
  }
  share.observedTrack?.removeEventListener?.("ended", share.endedHandler);
  if (stopTracks) {
    stopMediaStream(share.stream);
  }
}

function clearPendingPrivateBrowserShare({ stopTracks = false } = {}) {
  if (!state.pendingBrowserShare) {
    return;
  }
  releasePrivateBrowserShare(state.pendingBrowserShare, { stopTracks });
  state.pendingBrowserShare = null;
  if (!state.localBrowserShare) {
    setLocalPrivateBrowserPreviewStream(null);
  }
}

function clearLocalPrivateBrowserShare({ stopTracks = false, sessionId = "" } = {}) {
  const activeShare = state.localBrowserShare;
  if (!activeShare) {
    return;
  }
  if (sessionId && activeShare.sessionId && activeShare.sessionId !== sessionId) {
    return;
  }
  releasePrivateBrowserShare(activeShare, { stopTracks });
  state.localBrowserShare = null;
  setLocalPrivateBrowserPreviewStream(null);
}

async function fetchPrivateBrowserMediaToken({ canPublish = false } = {}) {
  const viewerSessionId = getPrivateViewerSessionId();
  const worldSnapshotId = getPrivateBrowserWorldKey();
  if (!viewerSessionId || !worldSnapshotId) {
    return { enabled: false };
  }
  try {
    return await apiFetch("/public/world/current/browser-media-token", {
      method: "POST",
      body: {
        viewerSessionId,
        worldSnapshotId,
        canPublish,
      },
    });
  } catch (_error) {
    return { enabled: false };
  }
}

function getPrivateBrowserMediaController() {
  if (state.browserMediaController) {
    return state.browserMediaController;
  }
  state.browserMediaController = createBrowserMediaController({
    fetchToken: ({ canPublish = false } = {}) => fetchPrivateBrowserMediaToken({ canPublish }),
    onRemoteTrack: ({ sessionId, track, element }) => {
      const existing = state.browserSessions.get(sessionId) ?? {};
      state.browserSessions.set(sessionId, {
        ...existing,
        _remoteElement: element ?? existing._remoteElement ?? null,
      });
      if (!state.localBrowserShare && elements.panelBrowserVideo) {
        state.browserPanelRemoteSessionId = sessionId;
        state.browserMediaState.remoteVideoSessionId = sessionId;
        track.attach(elements.panelBrowserVideo);
        elements.panelBrowserVideo.hidden = false;
        ensurePrivateBrowserVideoPlayback(elements.panelBrowserVideo);
      }
      if (element) {
        setPrivateShareBubbleVideo(sessionId, element);
      }
      updatePrivateBrowserPanel();
    },
    onRemoteTrackRemoved: ({ sessionId }) => {
      const existing = state.browserSessions.get(sessionId);
      if (existing) {
        state.browserSessions.set(sessionId, {
          ...existing,
          _remoteElement: null,
        });
      }
      if (state.browserPanelRemoteSessionId === sessionId && !state.localBrowserShare && elements.panelBrowserVideo) {
        state.browserPanelRemoteSessionId = "";
        elements.panelBrowserVideo.pause?.();
        elements.panelBrowserVideo.removeAttribute("src");
        elements.panelBrowserVideo.srcObject = null;
        elements.panelBrowserVideo.hidden = true;
      }
      if (state.browserMediaState.remoteVideoSessionId === sessionId) {
        state.browserMediaState.remoteVideoSessionId = "";
      }
      clearPrivateShareBubbleVideo(sessionId);
      updatePrivateBrowserPanel();
    },
    onRemoteAudioState: ({ sessionId, available, blocked, error }) => {
      state.browserMediaState.remoteAudioSessionId = available ? String(sessionId ?? "").trim() : "";
      state.browserMediaState.remoteAudioAvailable = available === true;
      state.browserMediaState.remoteAudioBlocked = blocked === true;
      state.browserMediaState.remoteAudioError = String(error ?? "").trim();
      updatePrivateBrowserPanel();
    },
    onStatus: ({ enabled, transport, connected, roomName, canPublish }) => {
      state.browserMediaState.enabled = enabled;
      state.browserMediaState.connected = connected === true;
      state.browserMediaState.transport = transport || state.browserMediaState.transport;
      state.browserMediaState.roomName = roomName || "";
      state.browserMediaState.canPublish = canPublish === true;
      updatePrivateBrowserPanel();
    },
  });
  return state.browserMediaController;
}

function syncPrivateBrowserMediaSubscription(sessionId, subscribed) {
  const session = state.browserSessions.get(sessionId);
  if (!session || !isLiveKitBrowserTransport(session.frameTransport)) {
    return;
  }
  void getPrivateBrowserMediaController().setSubscribed({
    sessionId,
    subscribed,
    viewerSessionId: getPrivateViewerSessionId(),
    worldSnapshotId: getPrivateBrowserWorldKey(),
    canPublish: session.hostSessionId === getPrivateViewerSessionId(),
  });
}

function attachLocalPrivateBrowserShare(sessionId, share) {
  if (!share || !sessionId || !getPrivateBrowserWorldKey()) {
    return;
  }
  clearLocalPrivateBrowserShare({ stopTracks: true });
  state.localBrowserShare = {
    ...share,
    sessionId,
  };
  setSelectedPrivateBrowserShareMode(share.shareKind);
  setLocalPrivateBrowserPreviewStream(share.hasVideo ? share.stream : null);
  if (elements.panelBrowserShareTitle) {
    elements.panelBrowserShareTitle.value = share.title || "";
  }
  void getPrivateBrowserMediaController().publishStream({
    sessionId,
    stream: share.stream,
    viewerSessionId: getPrivateViewerSessionId(),
    worldSnapshotId: getPrivateBrowserWorldKey(),
  }).then((published) => {
    if (!published) {
      clearLocalPrivateBrowserShare({ stopTracks: true, sessionId });
      sendWorldSocketMessage({
        type: "browser:stop",
        sessionId,
      });
      updatePrivateBrowserPanel();
    }
  }).catch(() => {
    clearLocalPrivateBrowserShare({ stopTracks: true, sessionId });
    sendWorldSocketMessage({
      type: "browser:stop",
      sessionId,
    });
    updatePrivateBrowserPanel();
  });
}

function updatePrivateBrowserSessionState(sessionPatch = {}) {
  const sessionId = String(sessionPatch.sessionId ?? "").trim();
  if (!sessionId) {
    return;
  }
  const previous = state.browserSessions.get(sessionId) ?? {};
  const next = {
    ...previous,
    ...sessionPatch,
    deliveryMode: sessionPatch.deliveryMode ?? previous.deliveryMode ?? "placeholder",
    frameTransport: sessionPatch.frameTransport ?? previous.frameTransport ?? "jpeg-sequence",
    lastFrameDataUrl: sessionPatch.lastFrameDataUrl ?? previous.lastFrameDataUrl ?? "",
    lastFrameId: Number(sessionPatch.lastFrameId ?? previous.lastFrameId) || 0,
    sessionMode: sessionPatch.sessionMode ?? previous.sessionMode ?? "display-share",
    aspectRatio: Number(sessionPatch.aspectRatio ?? previous.aspectRatio) || PRIVATE_BROWSER_ASPECT_RATIO,
  };
  state.browserSessions.set(sessionId, next);
  if (next.hasVideo === false) {
    clearPrivateShareBubbleVideo(next.sessionId);
  }

  if (next.hostSessionId === getPrivateViewerSessionId()) {
    state.localBrowserSessionId = next.sessionId;
    if (isLiveKitBrowserTransport(next.frameTransport) && getPrivateBrowserWorldKey()) {
      void getPrivateBrowserMediaController().connect({
        viewerSessionId: getPrivateViewerSessionId(),
        worldSnapshotId: getPrivateBrowserWorldKey(),
        canPublish: true,
      });
    }
    if (next.sessionMode === "display-share" && state.pendingBrowserShare?.stream) {
      const pendingShare = state.pendingBrowserShare;
      state.pendingBrowserShare = null;
      attachLocalPrivateBrowserShare(next.sessionId, pendingShare);
    }
  }

  reconcilePrivateShareBubbles();
  if (
    next.hostSessionId === getPrivateViewerSessionId()
    && state.localBrowserShare?.sessionId === next.sessionId
    && state.localBrowserShare?.hasVideo
    && elements.panelBrowserVideo
  ) {
    setPrivateShareBubbleVideo(next.sessionId, elements.panelBrowserVideo);
  }
  if (next.lastFrameDataUrl && next.lastFrameId > 0) {
    updatePrivateShareBubbleFrame(next.sessionId, {
      sessionId: next.sessionId,
      frameId: next.lastFrameId,
      dataUrl: next.lastFrameDataUrl,
    });
  }
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function handlePrivateBrowserFrame(payload = {}) {
  const sessionId = String(payload.sessionId ?? "").trim();
  const existing = state.browserSessions.get(sessionId);
  if (!existing) {
    return;
  }
  const next = {
    ...existing,
    lastFrameDataUrl: payload.dataUrl,
    lastFrameId: Number(payload.frameId ?? 0) || 0,
    title: payload.title ?? existing.title,
    url: payload.url ?? existing.url,
  };
  state.browserSessions.set(sessionId, next);
  if (sessionId === state.localBrowserSessionId) {
    drawPrivateBrowserMediaFrame(payload);
    publishLocalPrivateBrowserMedia(sessionId);
  }
  updatePrivateShareBubbleFrame(sessionId, payload);
  updatePrivateBrowserPanel();
}

function handlePrivateBrowserStop(payload = {}) {
  const sessionId = String(payload.sessionId ?? "").trim();
  const hostSessionId = String(payload.hostSessionId ?? "").trim();
  if (!sessionId) {
    return;
  }
  if (hostSessionId && hostSessionId === getPrivateViewerSessionId()) {
    clearPendingPrivateBrowserShare();
  }
  clearLocalPrivateBrowserShare({ sessionId });
  getPrivateBrowserMediaController().removeSession?.(sessionId);
  void getPrivateBrowserMediaController().unpublishSession(sessionId);
  state.browserSessions.delete(sessionId);
  if (state.localBrowserSessionId === sessionId) {
    state.localBrowserSessionId = "";
  }
  if (state.browserPanelRemoteSessionId === sessionId) {
    state.browserPanelRemoteSessionId = "";
    if (!state.localBrowserShare) {
      setPrivateBrowserPreviewStream(null);
    }
  }
  reconcilePrivateShareBubbles();
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function resetPrivateBrowserState({ disconnectController = false, stopTracks = false } = {}) {
  if (state.browserOverlayOpen) {
    setPrivateBrowserOverlayOpen(false);
  }
  clearPendingPrivateBrowserShare({ stopTracks });
  clearLocalPrivateBrowserShare({ stopTracks });
  for (const sessionId of state.browserSessions.keys()) {
    state.browserMediaController?.removeSession?.(sessionId);
  }
  state.browserSessions = new Map();
  state.localBrowserSessionId = "";
  state.browserPanelRemoteSessionId = "";
  state.browserMediaState = createEmptyPrivateBrowserMediaState();
  setLocalPrivateBrowserPreviewStream(null);
  if (elements.panelBrowserFrame) {
    elements.panelBrowserFrame.hidden = true;
    elements.panelBrowserFrame.removeAttribute("src");
  }
  if (disconnectController) {
    void state.browserMediaController?.disconnect?.();
    state.browserMediaController = null;
  }
  reconcilePrivateShareBubbles();
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

async function launchPrivateScreenShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setPrivateBrowserStatus("This browser does not support screen sharing.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 24, max: 30 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
      },
      audio: true,
    });
    const videoTrack = stream?.getVideoTracks?.()[0] ?? null;
    const share = createLocalPrivateBrowserShare(stream, {
      shareKind: "screen",
      title: getRequestedPrivateBrowserShareTitle(getDefaultBrowserShareTitle("screen", videoTrack)),
    });
    state.pendingBrowserShare = share;
    setLocalPrivateBrowserPreviewStream(share.hasVideo ? share.stream : null);
    updatePrivateBrowserPanel();
    const sent = sendWorldSocketMessage({
      type: "browser:start",
      mode: "display-share",
      title: share.title,
      shareKind: share.shareKind,
      hasVideo: share.hasVideo,
      hasAudio: share.hasAudio,
      aspectRatio: share.aspectRatio,
      displaySurface: share.displaySurface,
    });
    if (!sent) {
      clearPendingPrivateBrowserShare({ stopTracks: true });
      setPrivateBrowserStatus("Live share is offline right now.");
      updatePrivateBrowserPanel();
    }
  } catch (error) {
    if (error?.name !== "AbortError" && error?.name !== "NotAllowedError") {
      setPrivateBrowserStatus(error?.message || "Could not start screen sharing.");
    }
  }
}

async function launchPrivateCameraShare() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setPrivateBrowserStatus("This browser does not support camera sharing.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        frameRate: { ideal: 24, max: 30 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        facingMode: "user",
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const share = createLocalPrivateBrowserShare(stream, {
      shareKind: "camera",
      title: getRequestedPrivateBrowserShareTitle(getDefaultBrowserShareTitle("camera")),
    });
    state.pendingBrowserShare = share;
    setLocalPrivateBrowserPreviewStream(share.hasVideo ? share.stream : null);
    updatePrivateBrowserPanel();
    const sent = sendWorldSocketMessage({
      type: "browser:start",
      mode: "display-share",
      title: share.title,
      shareKind: share.shareKind,
      hasVideo: share.hasVideo,
      hasAudio: share.hasAudio,
      aspectRatio: share.aspectRatio,
      displaySurface: share.displaySurface,
    });
    if (!sent) {
      clearPendingPrivateBrowserShare({ stopTracks: true });
      setPrivateBrowserStatus("Live share is offline right now.");
      updatePrivateBrowserPanel();
    }
  } catch (error) {
    if (error?.name !== "AbortError" && error?.name !== "NotAllowedError") {
      setPrivateBrowserStatus(error?.message || "Could not start video sharing.");
    }
  }
}

async function launchPrivateVoiceShare() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setPrivateBrowserStatus("This browser does not support voice sharing.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const share = createLocalPrivateBrowserShare(stream, {
      shareKind: "audio",
      title: getRequestedPrivateBrowserShareTitle(getDefaultBrowserShareTitle("audio")),
      hasVideo: false,
      hasAudio: true,
      aspectRatio: 1.2,
    });
    state.pendingBrowserShare = share;
    setLocalPrivateBrowserPreviewStream(null);
    updatePrivateBrowserPanel();
    const sent = sendWorldSocketMessage({
      type: "browser:start",
      mode: "display-share",
      title: share.title,
      shareKind: share.shareKind,
      hasVideo: share.hasVideo,
      hasAudio: share.hasAudio,
      aspectRatio: share.aspectRatio,
      displaySurface: share.displaySurface,
    });
    if (!sent) {
      clearPendingPrivateBrowserShare({ stopTracks: true });
      setPrivateBrowserStatus("Live share is offline right now.");
      updatePrivateBrowserPanel();
    }
  } catch (error) {
    if (error?.name !== "AbortError" && error?.name !== "NotAllowedError") {
      setPrivateBrowserStatus(error?.message || "Could not start voice sharing.");
    }
  }
}

async function launchPrivateShare() {
  const localParticipant = getLocalParticipant();
  if (!state.session || !state.selectedWorld || !localParticipant) {
    updatePrivateBrowserPanel();
    return;
  }
  const shareMode = getSelectedPrivateBrowserShareMode();
  if (shareMode === "camera") {
    await launchPrivateCameraShare();
    return;
  }
  if (shareMode === "audio") {
    await launchPrivateVoiceShare();
    return;
  }
  await launchPrivateScreenShare();
}

function updatePrivateBrowserPanel() {
  const world = state.selectedWorld;
  const localParticipant = getLocalParticipant();
  const localSession = getLocalPrivateBrowserSession();
  if (state.browserPanelRemoteSessionId && !state.browserSessions.has(state.browserPanelRemoteSessionId)) {
    state.browserPanelRemoteSessionId = "";
  }
  const mediaAvailable = state.browserMediaState.enabled !== false;
  const remoteSession = state.browserPanelRemoteSessionId
    ? state.browserSessions.get(state.browserPanelRemoteSessionId) ?? null
    : localSession
      ? null
      : [...state.browserSessions.values()].find(
        (session) => session.hostSessionId !== getPrivateViewerSessionId() && session.deliveryMode === "full",
      ) ?? null;
  const canShare = Boolean(state.session && world && localParticipant && mediaAvailable);
  const previewStream = state.pendingBrowserShare?.hasVideo
    ? state.pendingBrowserShare.stream
    : state.localBrowserShare?.hasVideo
      ? state.localBrowserShare.stream
      : state.localBrowserPreviewStream ?? null;
  const showingRemoteVideo = Boolean(
    !previewStream
    && remoteSession
    && elements.panelBrowserVideo?.srcObject
    && state.browserPanelRemoteSessionId === remoteSession.sessionId,
  );
  const needsPlaybackStart = Boolean(showingRemoteVideo && String(state.browserMediaState.lastPlayError || "").includes("NotAllowedError"));
  const needsAudioStart = Boolean(
    remoteSession
    && state.browserMediaState.remoteAudioAvailable
    && state.browserMediaState.remoteAudioBlocked
    && state.browserMediaState.remoteAudioSessionId === remoteSession.sessionId,
  );

  setSelectedPrivateBrowserShareMode(state.browserShareMode);
  if (elements.panelBrowserShareTitle) {
    elements.panelBrowserShareTitle.disabled = !canShare;
  }
  if (elements.panelBrowserLaunch) {
    elements.panelBrowserLaunch.disabled = !canShare || Boolean(state.pendingBrowserShare);
    elements.panelBrowserLaunch.textContent = state.pendingBrowserShare ? "Starting..." : (localSession ? "Share Again" : "Share");
  }
  if (elements.panelBrowserStop) {
    elements.panelBrowserStop.disabled = !localSession;
  }
  if (elements.panelBrowserExpand) {
    elements.panelBrowserExpand.disabled = !previewStream && !showingRemoteVideo && !remoteSession;
  }

  if (!world) {
    setPrivateBrowserStatus("Open a world to use nearby share.");
    updatePrivateBrowserSummary({
      state: "offline",
      badge: "Offline",
      current: "No world selected",
      hint: "Open a world first.",
    });
  } else if (state.pendingBrowserShare) {
    setPrivateBrowserStatus(`Starting ${getBrowserShareKindLabel(state.pendingBrowserShare.shareKind).toLowerCase()} share...`);
    updatePrivateBrowserSummary({
      state: "starting",
      badge: "Starting",
      current: `Starting ${getBrowserShareKindLabel(state.pendingBrowserShare.shareKind)}`,
      hint: state.pendingBrowserShare.title
        ? `"${state.pendingBrowserShare.title}" will go live after the permission prompt finishes.`
        : "Finish the permission prompt to go live.",
    });
  } else if (localSession) {
    const shareKind = getBrowserShareKindLabel(localSession.shareKind || "screen");
    setPrivateBrowserStatus(`${shareKind} is live nearby.`);
    updatePrivateBrowserSummary({
      state: "live",
      badge: "Live",
      current: `${shareKind} live${localSession.title ? ` - ${localSession.title}` : ""}`,
      hint: "Change the type, then press Share again to replace the live share.",
    });
  } else if (remoteSession) {
    const shareKind = getBrowserShareKindLabel(remoteSession.shareKind || "screen");
    setPrivateBrowserStatus(
      shareKind === "Voice"
        ? `Listening to ${remoteSession.title || "live voice"} from this private world.`
        : `Viewing ${remoteSession.title || "nearby share"} from this private world.`,
    );
    updatePrivateBrowserSummary({
      state: "draft",
      badge: "Nearby",
      current: shareKind === "Voice"
        ? `Hearing ${remoteSession.title || "live voice"}`
        : `Seeing ${remoteSession.title || "nearby share"}`,
      hint: state.session
        ? "Your Share controls still start your own nearby share."
        : "Sign in if you want to start your own nearby share.",
    });
  } else if (!state.session) {
    setPrivateBrowserStatus("Guests can watch but cannot start nearby share.");
    updatePrivateBrowserSummary({
      state: "offline",
      badge: "Signed out",
      current: "Sign in to go live",
      hint: "Signed-in participants can share screen, video, or voice.",
    });
  } else if (!localParticipant) {
    setPrivateBrowserStatus("Enter this world to start a live share.");
    updatePrivateBrowserSummary({
      state: "idle",
      badge: "Idle",
      current: "Enter to share",
      hint: "Join this private world first.",
    });
  } else if (!mediaAvailable) {
    setPrivateBrowserStatus("Live share is unavailable right now.");
    updatePrivateBrowserSummary({
      state: "offline",
      badge: "Offline",
      current: "Live share unavailable",
      hint: "Live media is not available on this server right now.",
    });
  } else {
    const draftKind = getBrowserShareKindLabel(getSelectedPrivateBrowserShareMode());
    const draftTitle = sanitizeBrowserShareTitle(elements.panelBrowserShareTitle?.value ?? "", "");
    setPrivateBrowserStatus("Share a screen, video, or voice nearby.");
    updatePrivateBrowserSummary({
      state: "idle",
      badge: "Idle",
      current: draftTitle ? `Ready: ${draftKind} "${draftTitle}"` : `Ready: ${draftKind}`,
      hint: "Pick a type, add a title if you want, then press Share.",
    });
  }

  if (previewStream) {
    setLocalPrivateBrowserPreviewStream(previewStream);
  } else if (remoteSession?._remoteElement?.srcObject && elements.panelBrowserVideo) {
    if (elements.panelBrowserVideo.srcObject !== remoteSession._remoteElement.srcObject) {
      elements.panelBrowserVideo.srcObject = remoteSession._remoteElement.srcObject;
    }
    elements.panelBrowserVideo.hidden = false;
    ensurePrivateBrowserVideoPlayback(elements.panelBrowserVideo);
  } else if (!showingRemoteVideo) {
    setPrivateBrowserPreviewStream(null);
  }

  if (elements.panelBrowserFrame) {
    elements.panelBrowserFrame.hidden = true;
    elements.panelBrowserFrame.removeAttribute("src");
  }
  if (elements.panelBrowserPlaceholder) {
    const hasDisplayedVideo = Boolean(elements.panelBrowserVideo?.srcObject);
    let placeholder = "Share a screen, video, or voice nearby.";
    if (needsPlaybackStart) {
      placeholder = "Browser blocked autoplay. Press start to watch this live stream.";
    } else if (needsAudioStart) {
      placeholder = remoteSession?.shareKind === "audio"
        ? "Press enable sound to hear this live voice stream."
        : "Press enable sound to hear this live stream.";
    } else if (localSession?.shareKind === "audio") {
      placeholder = "Voice is live inside this private world.";
    } else if (remoteSession?.shareKind === "audio") {
      placeholder = "Listening to live voice from inside this private world.";
    } else if (remoteSession && !hasDisplayedVideo) {
      placeholder = "Waiting for the live stream to appear.";
    }
    elements.panelBrowserPlaceholder.hidden = hasDisplayedVideo;
    elements.panelBrowserPlaceholder.textContent = placeholder;
  }
  if (elements.panelBrowserResume) {
    const needsPermissionAction = needsPlaybackStart || needsAudioStart;
    elements.panelBrowserResume.hidden = !needsPermissionAction;
    elements.panelBrowserResume.textContent = needsPlaybackStart ? "Start Stream" : "Enable Sound";
  }
}

async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (state.session?.access_token && !headers.Authorization) {
    headers.Authorization = `Bearer ${state.session.access_token}`;
  }
  if (options.body === undefined) {
    delete headers["Content-Type"];
  }
  const response = await fetch(mauworldApiUrl(path, options.search), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function fetchAuthConfig() {
  state.authConfig = await apiFetch("/public/auth/config");
  state.supabase = createClient(state.authConfig.supabaseUrl, state.authConfig.supabaseAnonKey);
  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;
  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    void refreshAuthState();
  });
}

async function refreshAuthState() {
  renderSessionSummary();
  if (!state.session) {
    await releaseSceneLock();
    state.profile = null;
    state.worlds = [];
    state.runtimeSnapshot = null;
    state.privateChatEntries = [];
    state.activeChats.clear();
    state.livePresence.clear();
    reconcilePrivatePresenceScene();
    state.pressedRuntimeKeys.clear();
    privateInputState.keys.clear();
    privateInputState.sprintHoldSeconds = 0;
    privateInputState.pointerDown = false;
    privateInputState.pointerMoved = false;
    privateInputState.dragDistance = 0;
    state.viewerSuppressClickAt = 0;
    resetPrivateBrowserState({ disconnectController: true, stopTracks: true });
    renderProfile();
    renderWorldList();
    renderSelectedWorld();
    setLauncherTab("access");
    disconnectWorldSocket();
    return;
  }
  try {
    const payload = await apiFetch("/private/profile");
    state.profile = payload.profile;
    renderProfile();
    renderSessionSummary();
    await loadWorlds();
    if (state.selectedWorld?.world_id && state.selectedWorld?.creator?.username) {
      await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
    }
    if (!state.selectedWorld) {
      setLauncherTab(getPreferredLauncherTab());
    }
  } catch (error) {
    setStatus(error.message);
  }
}

function renderProfile() {
  if (!state.profile) {
    elements.profileForm.hidden = true;
    return;
  }
  elements.profileForm.hidden = false;
  elements.profileForm.elements.username.value = state.profile.username || "";
  elements.profileForm.elements.displayName.value = state.profile.display_name || "";
}

function renderSessionSummary() {
  if (!elements.panelSessionLabel || !elements.panelOpenAccess) {
    return;
  }
  const localParticipant = getLocalParticipant();
  if (state.session && state.profile) {
    elements.panelSessionLabel.textContent = `Signed in as @${state.profile.username || "user"}. Access opens profile and sign out.`;
    elements.panelOpenAccess.textContent = "Profile";
    return;
  }
  if (state.session) {
    elements.panelSessionLabel.textContent = "Signed in. Access opens profile and sign out.";
    elements.panelOpenAccess.textContent = "Profile";
    return;
  }
  if (localParticipant?.join_role === "guest") {
    elements.panelSessionLabel.textContent = "Viewing as guest. Access opens sign in or account creation.";
    elements.panelOpenAccess.textContent = "Access";
    return;
  }
  elements.panelSessionLabel.textContent = "Signed out. Access opens sign in or account creation.";
  elements.panelOpenAccess.textContent = "Access";
}

async function loadWorlds() {
  if (!state.session) {
    state.worlds = [];
    renderWorldList();
    return;
  }
  const payload = await apiFetch("/private/worlds", {
    search: {
      q: elements.worldSearch?.value || "",
    },
  });
  state.worlds = payload.worlds ?? [];
  renderWorldList();
  if (state.launcherOpen && !state.selectedWorld) {
    setLauncherTab(getPreferredLauncherTab());
  }
}

async function loadPublicWorlds() {
  const payload = await apiFetch("/public/private-worlds", {
    search: {
      q: elements.publicWorldSearch?.value || "",
      worldType: elements.publicWorldType?.value || "",
    },
  });
  state.publicWorlds = payload.worlds ?? [];
  renderPublicWorldList();
}

function renderPublicWorldList() {
  if (!elements.publicWorldList) {
    return;
  }
  if (!state.publicWorlds.length) {
    elements.publicWorldList.innerHTML = '<div class="pw-world-card"><p>No worlds match this search yet.</p></div>';
    return;
  }
  elements.publicWorldList.innerHTML = state.publicWorlds.map((world) => `
    <article class="pw-world-card ${state.selectedWorld?.world_id === world.world_id ? "is-active" : ""}" data-world-card="${htmlEscape(world.world_id)}" data-world-creator="${htmlEscape(world.creator.username)}">
      <h3>${htmlEscape(world.name)}</h3>
      <p>${htmlEscape(world.about)}</p>
      <small>${htmlEscape(world.creator.username)} · ${htmlEscape(world.world_type)} · ${Number(world.width)}×${Number(world.length)}×${Number(world.height)}${world.active_instance ? ` · ${htmlEscape(world.active_instance.status)}` : ""}</small>
    </article>
  `).join("");
}

function renderWorldList() {
  if (!elements.worldList) {
    return;
  }
  if (!state.worlds.length) {
    elements.worldList.innerHTML = '<div class="pw-world-card"><p>No private worlds yet.</p></div>';
    return;
  }
  elements.worldList.innerHTML = state.worlds.map((world) => `
    <article class="pw-world-card ${state.selectedWorld?.world_id === world.world_id ? "is-active" : ""}" data-world-card="${htmlEscape(world.world_id)}" data-world-creator="${htmlEscape(world.creator.username)}">
      <h3>${htmlEscape(world.name)}</h3>
      <p>${htmlEscape(world.about)}</p>
      <small>${htmlEscape(world.creator.username)} · ${htmlEscape(world.world_type)} · ${Number(world.width)}×${Number(world.length)}×${Number(world.height)}</small>
    </article>
  `).join("");
}

function buildMetaRows(world) {
  if (!world) {
    return [];
  }
  return [
    { label: "World ID", value: world.world_id },
    { label: "Creator", value: `${world.creator.display_name || world.creator.username} (@${world.creator.username})` },
    { label: "Size", value: `${world.width} × ${world.length} × ${world.height}` },
    { label: "Type", value: `${world.world_type} · ${world.template_size}` },
    { label: "Viewers", value: `${world.active_instance?.viewer_count ?? 0} / ${world.max_viewers}` },
    {
      label: "Lineage",
      value: world.lineage?.is_imported
        ? `Forked from ${world.lineage.origin_world_id} by @${world.lineage.origin_creator_username}`
        : "Original world",
    },
  ];
}

function buildPrivateWorldEntryUrl(world = state.selectedWorld) {
  if (!world) {
    return "";
  }
  const url = new URL("/social/private-worlds.html", window.location.origin);
  url.searchParams.set("worldId", world.world_id);
  url.searchParams.set("creatorUsername", world.creator.username);
  url.searchParams.set("autojoin", "true");
  return url.toString();
}

function renderMetaRows(target, rows) {
  if (!target) {
    return;
  }
  target.innerHTML = rows.map((row) => `
    <div class="pw-world-meta__row">
      <strong>${htmlEscape(row.label)}</strong>
      <span>${htmlEscape(row.value)}</span>
    </div>
  `).join("");
}

function getSelectedScene() {
  return state.selectedWorld?.scenes?.find((scene) => scene.id === state.selectedSceneId) ?? state.selectedWorld?.scenes?.[0] ?? null;
}

function isEditor() {
  return state.selectedWorld?.permissions?.can_edit === true;
}

function getLocalParticipant(world = state.selectedWorld) {
  if (!world?.active_instance?.participants?.length) {
    return null;
  }
  if (state.profile?.id) {
    return world.active_instance.participants.find((entry) => entry.profile?.id === state.profile.id) ?? null;
  }
  return world.active_instance.participants.find((entry) => entry.guest_session_id === getGuestSessionId()) ?? null;
}

function getPossessedRuntimePlayer() {
  const localParticipant = getLocalParticipant();
  if (!localParticipant?.player_entity_id) {
    return null;
  }
  return state.runtimeSnapshot?.players?.find((entry) => entry.id === localParticipant.player_entity_id) ?? null;
}

function getRenderableSceneDoc() {
  const scene = getSelectedScene();
  if (!scene) {
    return null;
  }
  if (state.mode === "play") {
    return scene.compiled_doc?.runtime?.resolved_scene_doc ?? scene.scene_doc ?? null;
  }
  return parseSceneTextarea();
}

function setMode(mode) {
  const nextMode = mode === "build" && isEditor() ? "build" : "play";
  state.mode = nextMode;
  if (nextMode === "play") {
    state.builderSelection = null;
    state.sceneDrawerOpen = false;
    if (state.privatePanelTab === "build") {
      state.privatePanelTab = "chat";
    }
  } else {
    state.privatePanelTab = "build";
  }
  document.body.classList.toggle("is-play-mode", nextMode === "play");
  updateShellState();
  syncPrivatePreviewEnvironmentState();
  updatePreviewFromSelection();
}

function syncRuntimeFromWorld(world = state.selectedWorld) {
  const nextRuntime = world?.active_instance?.runtime ?? null;
  if (!nextRuntime) {
    if (!world?.active_instance) {
      state.runtimeSnapshot = null;
    }
    return;
  }
  const nextTick = Number(nextRuntime.tick ?? 0);
  const currentTick = Number(state.runtimeSnapshot?.tick ?? -1);
  if (!state.runtimeSnapshot || nextTick >= currentTick) {
    state.runtimeSnapshot = nextRuntime;
  }
}

function parseSceneTextarea() {
  try {
    const sceneDoc = JSON.parse(elements.sceneForm?.elements.sceneDoc.value || "{}");
    if (elements.sceneForm?.elements.scriptDsl) {
      sceneDoc.script_dsl = String(elements.sceneForm.elements.scriptDsl.value || "").trim();
    }
    return sceneDoc;
  } catch (error) {
    throw new Error(`Scene JSON is invalid: ${error.message}`);
  }
}

function renderSceneEditor() {
  const scene = getSelectedScene();
  const canEdit = isEditor();
  const buildMode = state.mode === "build";
  elements.sceneForm.elements.name.value = scene?.name || "";
  elements.sceneForm.elements.isDefault.checked = scene?.is_default === true;
  elements.sceneForm.elements.sceneDoc.value = scene ? JSON.stringify(scene.scene_doc, null, 2) : "";
  elements.sceneForm.elements.scriptDsl.value = scene?.scene_doc?.script_dsl || "";
  elements.saveScene.disabled = !canEdit || !scene || !buildMode;
  elements.refreshScene.disabled = !scene;
  elements.sceneForm.elements.name.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.isDefault.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.scriptDsl.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.sceneDoc.disabled = !canEdit || !buildMode;
  const buildPanel = document.querySelector("[data-build-panel]");
  if (buildPanel) {
    buildPanel.hidden = false;
  }
  renderSceneBuilder();
}

function renderSceneStrip() {
  if (!elements.sceneStrip) {
    return;
  }
  const scenes = state.selectedWorld?.scenes ?? [];
  elements.sceneStrip.innerHTML = scenes.map((scene) => `
    <button type="button" class="pw-scene-pill ${scene.id === state.selectedSceneId ? "is-active" : ""}" data-scene-id="${htmlEscape(scene.id)}">
      <strong>${htmlEscape(scene.name)}</strong>
      <span>${scene.version ? `v${scene.version}` : ""}${scene.is_default ? " · default" : ""}</span>
    </button>
  `).join("");
}

function buildOptions(options = [], selectedValue = "") {
  return options.map((value) => `
    <option value="${htmlEscape(value)}" ${String(selectedValue) === String(value) ? "selected" : ""}>${htmlEscape(value || "none")}</option>
  `).join("");
}

function buildEntitySummary(kind, entry = {}) {
  if (kind === "particle") {
    return `${entry.target_id || "no target"} · ${entry.enabled === false ? "off" : "on"}`;
  }
  if (kind === "prefab_instance") {
    return `${entry.prefab_id || "choose prefab"} · ${describeVector3(entry.position)}`;
  }
  if (kind === "screen") {
    return `${describeVector3(entry.position)} · ${String(entry.html || "").slice(0, 18) || "empty html"}`;
  }
  if (kind === "text") {
    return `${describeVector3(entry.position)} · scale ${Number(entry.scale ?? 1).toFixed(1)}`;
  }
  return `${describeVector3(entry.position)}${entry.material?.texture_preset ? ` · ${entry.material.texture_preset}` : ""}`;
}

function renderSceneBuilder() {
  if (!elements.entitySections || !elements.entityEditor || !elements.prefabList) {
    return;
  }
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    state.builderSelection = null;
    updateShellState();
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">Fix the scene JSON to continue editing.</p></div>';
    elements.entityEditor.innerHTML = "";
    elements.prefabList.innerHTML = "";
    return;
  }
  const selected = ensureBuilderSelection(sceneDoc);
  updateShellState();
  renderEntitySections(sceneDoc, selected);
  renderEntityInspector(sceneDoc, selected);
  renderPrefabList(sceneDoc);
  const inspectorDisabled = !isEditor() || state.mode !== "build";
  for (const field of elements.entityEditor.querySelectorAll("input, select, textarea")) {
    field.disabled = inspectorDisabled;
  }
}

function renderEntitySections(sceneDoc, selected = null) {
  elements.entitySections.innerHTML = ENTITY_COLLECTIONS.map((config) => {
    const entries = getEntityArray(sceneDoc, config.key);
    return `
      <section class="pw-builder-group">
        <div class="pw-builder-group__header">
          <strong>${htmlEscape(config.label)}</strong>
          <span>${entries.length}</span>
        </div>
        <div class="pw-builder-group__items">
          ${entries.length > 0
    ? entries.map((entry, index) => `
                <button
                  type="button"
                  class="pw-builder-item ${(selected?.kind === config.kind && selected?.entry?.id === entry.id) ? "is-active" : ""}"
                  data-select-kind="${htmlEscape(config.kind)}"
                  data-select-id="${htmlEscape(entry.id)}"
                >
                  <strong>${htmlEscape(getDisplayNameForEntity(config.kind, entry, index))}</strong>
                  <small>${htmlEscape(buildEntitySummary(config.kind, entry))}</small>
                </button>
              `).join("")
    : '<p class="pw-builder-empty">Nothing here yet.</p>'}
        </div>
      </section>
    `;
  }).join("");
}

function buildVectorFields(label, basePath, value = {}) {
  return `
    <div>
      <label>
        <span>${htmlEscape(label)} X</span>
        <input type="number" step="0.1" data-entity-field="${htmlEscape(basePath)}.x" data-value-type="number" value="${htmlEscape(value.x ?? 0)}" />
      </label>
    </div>
    <div>
      <label>
        <span>${htmlEscape(label)} Y</span>
        <input type="number" step="0.1" data-entity-field="${htmlEscape(basePath)}.y" data-value-type="number" value="${htmlEscape(value.y ?? 0)}" />
      </label>
    </div>
    <div>
      <label>
        <span>${htmlEscape(label)} Z</span>
        <input type="number" step="0.1" data-entity-field="${htmlEscape(basePath)}.z" data-value-type="number" value="${htmlEscape(value.z ?? 0)}" />
      </label>
    </div>
  `;
}

function buildMaterialEditor(material = {}) {
  return `
    <div class="pw-inspector-grid pw-inspector-grid--2">
      <div>
        <label>
          <span>Color</span>
          <input type="color" data-entity-field="material.color" data-value-type="color" value="${htmlEscape(material.color || "#c8d0d8")}" />
        </label>
      </div>
      <div>
        <label>
          <span>Pattern</span>
          <select data-entity-field="material.texture_preset" data-value-type="text">
            ${buildOptions(MATERIAL_PRESET_OPTIONS, material.texture_preset || "none")}
          </select>
        </label>
      </div>
    </div>
  `;
}

function buildTargetOptions(sceneDoc, selectedValue = "") {
  const options = [];
  for (const config of ENTITY_COLLECTIONS.filter((entry) => entry.kind !== "particle" && entry.kind !== "prefab_instance")) {
    for (const entry of getEntityArray(sceneDoc, config.key)) {
      options.push({
        value: entry.id,
        label: `${config.label}: ${getDisplayNameForEntity(config.kind, entry)}`,
      });
    }
  }
  return options.map((option) => `
    <option value="${htmlEscape(option.value)}" ${option.value === selectedValue ? "selected" : ""}>${htmlEscape(option.label)}</option>
  `).join("");
}

function renderEntityInspector(sceneDoc, selected = null) {
  if (!selected) {
    elements.selectionLabel.textContent = "No selection";
    elements.entityEmpty.hidden = false;
    elements.entityEditor.innerHTML = "";
    elements.removeEntity.disabled = true;
    elements.convertPrefab.disabled = true;
    return;
  }
  const { kind, entry } = selected;
  elements.selectionLabel.textContent = getDisplayNameForEntity(kind, entry);
  elements.entityEmpty.hidden = true;
  elements.removeEntity.disabled = !isEditor() || state.mode !== "build";
  elements.convertPrefab.disabled = !isEditor() || state.mode !== "build" || kind === "particle" || kind === "prefab_instance";

  if (kind === "voxel") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Solid static voxel. Pattern presets render directly in the preview.</p>
      ${buildMaterialEditor(entry.material)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Shape</span>
            <input type="text" data-entity-field="shape_preset" data-value-type="text" value="${htmlEscape(entry.shape_preset || "cube")}" />
          </label>
        </div>
        <div>
          <label>
            <span>Group</span>
            <input type="text" data-entity-field="group_id" data-value-type="text" value="${htmlEscape(entry.group_id || "")}" placeholder="optional group name" />
          </label>
        </div>
      </div>
    `;
    return;
  }

  if (kind === "primitive") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Physics objects can collide, stack, bounce, and carry particles or trails.</p>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Shape</span>
            <select data-entity-field="shape" data-value-type="text">${buildOptions(PRIMITIVE_SHAPES, entry.shape || "box")}</select>
          </label>
        </div>
        <div>
          <label>
            <span>Rigid Mode</span>
            <select data-entity-field="rigid_mode" data-value-type="text">${buildOptions(["rigid", "ghost"], entry.rigid_mode || "rigid")}</select>
          </label>
        </div>
      </div>
      ${buildMaterialEditor(entry.material)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <div class="pw-inspector-grid">
        <div>
          <label>
            <span>Gravity</span>
            <input type="number" step="0.1" data-entity-field="physics.gravity_scale" data-value-type="number" value="${htmlEscape(entry.physics?.gravity_scale ?? 1)}" />
          </label>
        </div>
        <div>
          <label>
            <span>Bounce</span>
            <input type="number" step="0.05" data-entity-field="physics.restitution" data-value-type="number" value="${htmlEscape(entry.physics?.restitution ?? 0.12)}" />
          </label>
        </div>
        <div>
          <label>
            <span>Friction</span>
            <input type="number" step="0.05" data-entity-field="physics.friction" data-value-type="number" value="${htmlEscape(entry.physics?.friction ?? 0.72)}" />
          </label>
        </div>
      </div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Mass</span>
            <input type="number" step="0.1" data-entity-field="physics.mass" data-value-type="number" value="${htmlEscape(entry.physics?.mass ?? 1)}" />
          </label>
        </div>
        <div>
          <label>
            <span>Group</span>
            <input type="text" data-entity-field="group_id" data-value-type="text" value="${htmlEscape(entry.group_id || "")}" placeholder="optional group name" />
          </label>
        </div>
      </div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Particle Effect</span>
            <select data-entity-field="particle_effect" data-value-type="text">${buildOptions(EFFECT_OPTIONS, entry.particle_effect || "")}</select>
          </label>
        </div>
        <div>
          <label>
            <span>Trail Effect</span>
            <select data-entity-field="trail_effect" data-value-type="text">${buildOptions(TRAIL_OPTIONS, entry.trail_effect || "")}</select>
          </label>
        </div>
      </div>
    `;
    return;
  }

  if (kind === "player") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Everyone enters as a floating viewer. Possession happens by clicking a player in Play mode.</p>
      <label>
        <span>Label</span>
        <input type="text" data-entity-field="label" data-value-type="text" value="${htmlEscape(entry.label || "")}" />
      </label>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Camera</span>
            <select data-entity-field="camera_mode" data-value-type="text">${buildOptions(PLAYER_CAMERA_MODES, entry.camera_mode || "third_person")}</select>
          </label>
        </div>
        <div>
          <label>
            <span>Body</span>
            <select data-entity-field="body_mode" data-value-type="text">${buildOptions(PLAYER_BODY_MODES, entry.body_mode || "rigid")}</select>
          </label>
        </div>
      </div>
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Scale</span>
            <input type="number" step="0.1" data-entity-field="scale" data-value-type="number" value="${htmlEscape(entry.scale ?? 1)}" />
          </label>
        </div>
        <div class="pw-checkbox">
          <input type="checkbox" data-entity-field="occupiable" data-value-type="checkbox" ${entry.occupiable !== false ? "checked" : ""} />
          <span>Can be occupied</span>
        </div>
      </div>
    `;
    return;
  }

  if (kind === "screen") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Static HTML and CSS only. No custom JavaScript or remote resources.</p>
      ${buildMaterialEditor(entry.material)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <label>
        <span>Screen HTML</span>
        <textarea rows="10" data-entity-field="html" data-value-type="text" spellcheck="false">${htmlEscape(entry.html || "")}</textarea>
      </label>
    `;
    return;
  }

  if (kind === "text") {
    elements.entityEditor.innerHTML = `
      ${buildMaterialEditor(entry.material)}
      <label>
        <span>Text</span>
        <input type="text" data-entity-field="value" data-value-type="text" value="${htmlEscape(entry.value || "")}" />
      </label>
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Scale</span>
            <input type="number" step="0.1" data-entity-field="scale" data-value-type="number" value="${htmlEscape(entry.scale ?? 1)}" />
          </label>
        </div>
        <div>
          <label>
            <span>Group</span>
            <input type="text" data-entity-field="group_id" data-value-type="text" value="${htmlEscape(entry.group_id || "")}" />
          </label>
        </div>
      </div>
    `;
    return;
  }

  if (kind === "trigger") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Trigger zones are invisible in play, but stay wireframed in Build mode.</p>
      <label>
        <span>Label</span>
        <input type="text" data-entity-field="label" data-value-type="text" value="${htmlEscape(entry.label || "")}" />
      </label>
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <div class="pw-checkbox">
        <input type="checkbox" data-entity-field="invisible" data-value-type="checkbox" ${entry.invisible !== false ? "checked" : ""} />
        <span>Invisible in play</span>
      </div>
    `;
    return;
  }

  if (kind === "particle") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">These are visible animated effects in the preview and play scene.</p>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Effect</span>
            <select data-entity-field="effect" data-value-type="text">${buildOptions(EFFECT_OPTIONS.filter(Boolean), entry.effect || "sparkles")}</select>
          </label>
        </div>
        <div>
          <label>
            <span>Color</span>
            <input type="color" data-entity-field="color" data-value-type="color" value="${htmlEscape(entry.color || "#ff5a7a")}" />
          </label>
        </div>
      </div>
      <label>
        <span>Target</span>
        <select data-entity-field="target_id" data-value-type="text">
          <option value="">Choose target</option>
          ${buildTargetOptions(sceneDoc, entry.target_id || "")}
        </select>
      </label>
      <div class="pw-checkbox">
        <input type="checkbox" data-entity-field="enabled" data-value-type="checkbox" ${entry.enabled !== false ? "checked" : ""} />
        <span>Enabled</span>
      </div>
    `;
    return;
  }

  if (kind === "prefab_instance") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Prefab instances stay linked to the world prefab definition. Save the scene after placing or adjusting them.</p>
      <label>
        <span>Label</span>
        <input type="text" data-entity-field="label" data-value-type="text" value="${htmlEscape(entry.label || "")}" />
      </label>
      <label>
        <span>Prefab</span>
        <select data-entity-field="prefab_id" data-value-type="text">
          <option value="">Choose prefab</option>
          ${(state.selectedWorld?.prefabs ?? []).map((prefab) => `
            <option value="${htmlEscape(prefab.id)}" ${prefab.id === entry.prefab_id ? "selected" : ""}>${htmlEscape(prefab.name)}</option>
          `).join("")}
        </select>
      </label>
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <div class="pw-checkbox">
        <input type="checkbox" data-entity-field="overrides.visible" data-value-type="checkbox" ${entry.overrides?.visible !== false ? "checked" : ""} />
        <span>Visible</span>
      </div>
      ${buildMaterialEditor(entry.overrides?.material ?? { color: "#c8d0d8", texture_preset: "none" }).replaceAll("material.", "overrides.material.")}
    `;
  }
}

function renderPrefabList(sceneDoc) {
  const prefabs = state.selectedWorld?.prefabs ?? [];
  elements.placePrefab.disabled = !isEditor() || state.mode !== "build" || !state.selectedPrefabId;
  if (!prefabs.length) {
    elements.prefabList.innerHTML = '<div class="pw-prefab-card"><p>No prefabs yet. Select an object and convert it into one.</p></div>';
    return;
  }
  elements.prefabList.innerHTML = prefabs.map((prefab) => {
    const doc = prefab.prefab_doc ?? {};
    const itemCount = [
      ...(doc.voxels ?? []),
      ...(doc.primitives ?? []),
      ...(doc.screens ?? []),
      ...(doc.players ?? []),
      ...(doc.texts ?? []),
      ...(doc.trigger_zones ?? []),
    ].length;
    return `
      <article class="pw-prefab-card ${state.selectedPrefabId === prefab.id ? "is-active" : ""}" data-prefab-card="${htmlEscape(prefab.id)}">
        <label>
          <span>Name</span>
          <input type="text" data-prefab-name="${htmlEscape(prefab.id)}" value="${htmlEscape(prefab.name)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""} />
        </label>
        <div class="pw-prefab-card__meta">
          <span>${itemCount} item${itemCount === 1 ? "" : "s"}</span>
          <span>${htmlEscape(prefab.updated_at ? new Date(prefab.updated_at).toLocaleString() : "new")}</span>
        </div>
        <div class="pw-prefab-card__actions">
          <button type="button" class="is-muted" data-select-prefab="${htmlEscape(prefab.id)}">Select</button>
          <button type="button" class="is-muted" data-place-prefab-id="${htmlEscape(prefab.id)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""}>Place Instance</button>
          <button type="button" class="is-muted" data-delete-prefab="${htmlEscape(prefab.id)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""}>Remove</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderWorldMeta() {
  const rows = buildMetaRows(state.selectedWorld);
  renderMetaRows(elements.worldMeta, rows);
  renderMetaRows(elements.panelWorldMeta, rows);
}

function renderPrivateChat() {
  if (!elements.panelChatInput) {
    return;
  }
  const localParticipant = getLocalParticipant();
  const canChat = Boolean(state.session && state.selectedWorld && localParticipant);
  elements.panelChatInput.disabled = !canChat;
  const chatHint = !state.selectedWorld
    ? "Open Worlds to create or enter a private world."
    : !state.session
      ? localParticipant
        ? "Viewing as guest. Sign in to chat, edit, or take a player."
        : "Enter as guest to look around, or sign in for chat and editing."
      : !localParticipant
        ? "Enter this world to speak nearby."
        : "";
  if (elements.panelChatReactions) {
    elements.panelChatReactions.hidden = !canChat;
    elements.panelChatReactions.style.display = canChat ? "" : "none";
  }
  if (elements.panelChatEmpty) {
    elements.panelChatEmpty.hidden = canChat;
    elements.panelChatEmpty.textContent = chatHint;
  }
  for (const button of elements.panelChatReactionButtons ?? []) {
    button.disabled = !canChat;
  }
  elements.panelChatInput.placeholder = canChat ? "/ say something nearby and press Enter" : chatHint;
}

function getPrivateBrowserSessionTitle(session = {}) {
  const explicitTitle = sanitizeBrowserShareTitle(session?.title ?? "", "");
  if (explicitTitle) {
    return explicitTitle;
  }
  if (session?.url) {
    return session.url;
  }
  return `${getBrowserShareKindLabel(session?.shareKind || "screen")} live`;
}

function getPrivateBrowserSessionViewerCount(session = {}) {
  const value = Number(session.viewerCount);
  if (Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}

function getPrivateBrowserSessionMaxViewers(session = {}) {
  const value = Number(session.maxViewers);
  if (Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return 20;
}

function getPrivateLiveShareSessions(query = "") {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  return [...state.browserSessions.values()]
    .filter((session) => {
      if (!normalizedQuery) {
        return true;
      }
      return getPrivateBrowserSessionTitle(session).toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) =>
      Number(right.hostSessionId === getPrivateViewerSessionId()) - Number(left.hostSessionId === getPrivateViewerSessionId())
      || getPrivateBrowserSessionViewerCount(right) - getPrivateBrowserSessionViewerCount(left)
      || Date.parse(right.startedAt ?? 0) - Date.parse(left.startedAt ?? 0)
      || getPrivateBrowserSessionTitle(left).localeCompare(getPrivateBrowserSessionTitle(right)));
}

function focusPrivateLiveShare(sessionId) {
  const session = state.browserSessions.get(sessionId);
  if (!session) {
    renderPrivateLiveSharesList();
    return false;
  }
  if (session.hostSessionId === getPrivateViewerSessionId()) {
    state.browserPanelRemoteSessionId = "";
  } else {
    state.browserPanelRemoteSessionId = session.sessionId;
  }
  updatePrivateBrowserPanel();
  setPrivatePanelTab("share");
  return true;
}

function renderPrivateLiveSharesList() {
  if (!elements.panelLiveResults || !elements.panelLiveStatus) {
    return;
  }
  const query = String(state.liveShareQuery ?? "");
  const allSessions = getPrivateLiveShareSessions("");
  const filteredSessions = query.trim() ? getPrivateLiveShareSessions(query) : allSessions;

  if (allSessions.length === 0) {
    elements.panelLiveStatus.textContent = "No live shares right now.";
    elements.panelLiveResults.innerHTML = "";
    return;
  }

  if (filteredSessions.length === 0) {
    elements.panelLiveStatus.textContent = "No live shares match that title.";
    elements.panelLiveResults.innerHTML = "";
    return;
  }

  elements.panelLiveStatus.textContent = query.trim()
    ? `${filteredSessions.length} matching live ${filteredSessions.length === 1 ? "share" : "shares"}`
    : `${filteredSessions.length} live ${filteredSessions.length === 1 ? "share" : "shares"}`;

  elements.panelLiveResults.innerHTML = filteredSessions.map((session) => {
    const title = getPrivateBrowserSessionTitle(session);
    const shareKindLabel = getBrowserShareKindLabel(session.shareKind || "screen");
    const viewerCount = Math.min(getPrivateBrowserSessionViewerCount(session), getPrivateBrowserSessionMaxViewers(session));
    const maxViewers = getPrivateBrowserSessionMaxViewers(session);
    const isOwn = session.hostSessionId === getPrivateViewerSessionId();
    const isActive =
      session.sessionId === state.browserPanelRemoteSessionId
      || (isOwn && session.sessionId === state.localBrowserSessionId);
    return `
      <button
        class="world-live-result ${isActive ? "is-active" : ""}"
        type="button"
        data-private-live-session-id="${htmlEscape(session.sessionId)}"
      >
        <div class="world-live-result__top">
          <div class="world-live-result__title">${htmlEscape(title)}</div>
          <div class="world-live-result__count">${viewerCount}/${maxViewers} viewers</div>
        </div>
        <div class="world-live-result__meta">
          <span class="world-live-result__badge">${htmlEscape(shareKindLabel)}</span>
          <span>${isOwn ? "You are sharing this now." : "Someone here is sharing now."}</span>
        </div>
      </button>
    `;
  }).join("");

  for (const button of elements.panelLiveResults.querySelectorAll("[data-private-live-session-id]")) {
    button.addEventListener("click", () => {
      focusPrivateLiveShare(button.getAttribute("data-private-live-session-id"));
    });
  }
}

function renderPrivateShare() {
  if (!elements.panelShareStatus || !elements.panelShareMeta) {
    return;
  }
  const world = state.selectedWorld;
  const shareUrl = buildPrivateWorldEntryUrl(world);
  const isActive = Boolean(world?.active_instance);
  const canShare = Boolean(world);
  if (elements.panelShareCopy) {
    elements.panelShareCopy.disabled = !canShare;
  }
  if (elements.panelShareNative) {
    elements.panelShareNative.disabled = !canShare || typeof navigator.share !== "function";
  }
  elements.panelShareStatus.textContent = !world
    ? "Open a world to copy its entry link."
    : isActive
      ? "Copy or share the direct entry link for this active private world."
      : "This world is inactive, but the entry link still resolves it for signed-in access.";
  elements.panelShareMeta.innerHTML = !world ? "" : `
    <div class="pw-world-meta__row">
      <strong>Creator</strong>
      <span>${htmlEscape(world.creator.username)}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Type</strong>
      <span>${htmlEscape(world.world_type)} · ${htmlEscape(world.template_size)}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Occupancy</strong>
      <span>${Number(world.active_instance?.viewer_count ?? 0)} / ${Number(world.max_viewers ?? 20)}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Entry</strong>
      <span>${htmlEscape(isActive ? "Direct autojoin link ready" : "Resolve link ready")}</span>
    </div>
  `;
}

function renderBuildSummary() {
  if (!elements.panelBuildSummary) {
    return;
  }
  const world = state.selectedWorld;
  const localParticipant = getLocalParticipant(world);
  const runtime = state.runtimeSnapshot ?? world?.active_instance?.runtime ?? null;
  const activeSceneName = runtime?.scene_name || world?.active_instance?.active_scene_name || getSelectedScene()?.name || "Main Scene";
  if (!world) {
    elements.panelBuildSummary.innerHTML = `
      <div class="pw-world-meta__row">
        <strong>Session</strong>
        <span>Open or create a world to enter.</span>
      </div>
    `;
    return;
  }
  elements.panelBuildSummary.innerHTML = `
    <div class="pw-world-meta__row">
      <strong>Mode</strong>
      <span>${state.mode === "build" ? "Build" : "Play"} · ${isEditor() ? "editor access" : "viewer access"}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Scene</strong>
      <span>${htmlEscape(activeSceneName)}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Status</strong>
      <span>${htmlEscape(runtime?.status || world.active_instance?.status || "inactive")}${runtime?.tick ? ` · tick ${Number(runtime.tick)}` : ""}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Presence</strong>
      <span>${localParticipant ? `${localParticipant.join_role}${localParticipant.player_entity_id ? " · possessed" : ""}` : "outside world"}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Controls</strong>
      <span>${state.mode === "build"
        ? "Select in-world, drag to move, Shift + wheel to rotate, Alt + wheel to scale."
        : "WASD to move, hold Shift to sprint, Q/E to rise or drop, drag to look, wheel to zoom."}</span>
    </div>
  `;
}

function renderCollaborators() {
  const collaborators = state.selectedWorld?.collaborators ?? [];
  elements.collaboratorList.innerHTML = collaborators.map((entry) => `
    <div class="pw-collaborator-item">
      <div class="pw-collaborator-item__meta">
        <strong>${htmlEscape(entry.profile?.display_name || entry.profile?.username || "unknown")}</strong>
        <div>@${htmlEscape(entry.profile?.username || "unknown")} · ${htmlEscape(entry.role)}</div>
      </div>
      ${entry.role !== "creator" && isEditor()
    ? `<button type="button" class="is-muted" data-remove-collaborator="${htmlEscape(entry.profile?.username || "")}">Remove</button>`
    : ""}
    </div>
  `).join("") || '<div class="pw-collaborator-item">No collaborators yet.</div>';
}

function renderRuntimeStatus() {
  const instance = state.selectedWorld?.active_instance;
  if (!instance) {
    elements.runtimeStatus.innerHTML = "<div class=\"pw-world-meta__row\"><strong>Instance</strong><span>Inactive</span></div>";
    return;
  }
  const participants = instance.participants ?? [];
  const runtime = state.runtimeSnapshot ?? instance.runtime ?? null;
  const runtimePlayers = runtime?.players ?? [];
  const runtimeObjects = runtime?.dynamic_objects ?? [];
  elements.runtimeStatus.innerHTML = `
    <div class="pw-world-meta__row">
      <strong>Status</strong>
      <span>${htmlEscape(runtime?.status || instance.status)} · scene ${htmlEscape(runtime?.scene_name || instance.active_scene_name || "unknown")}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Players</strong>
      <span>${participants.map((entry) => `${entry.profile?.display_name || entry.profile?.username || "viewer"}${entry.ready ? " ready" : ""}`).join(", ") || "No visible players"}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Runtime</strong>
      <span>${runtime ? `tick ${Number(runtime.tick ?? 0)} · ${runtime.scene_started ? "running" : "waiting"} · ${runtimeObjects.length} dynamic` : "No runtime snapshot yet"}</span>
    </div>
    <div class="pw-world-meta__row">
      <strong>Controls</strong>
      <span>${state.mode === "build" && isEditor()
        ? "Build mode: click to select, drag to move, Shift + wheel to rotate, Alt + wheel to scale."
        : getLocalParticipant()?.join_role === "player"
          ? "WASD / Arrows to move, Space to jump, Release to return to viewer."
          : "Viewer mode by default. WASD to move, hold Shift to sprint, Q/E to rise or drop, drag to look, wheel to zoom, then click a player capsule to possess it."}</span>
    </div>
    ${runtimePlayers.length > 0 ? `
      <div class="pw-world-meta__row">
        <strong>Positions</strong>
        <span>${runtimePlayers.map((entry) => `${entry.label}: ${entry.position.x.toFixed(1)}, ${entry.position.y.toFixed(1)}, ${entry.position.z.toFixed(1)}`).join(" · ")}</span>
      </div>
    ` : ""}
  `;
}

function renderSelectedWorld() {
  const world = state.selectedWorld;
  syncRuntimeFromWorld(world);
  if (!world) {
    state.builderSelection = null;
    state.sceneDrawerOpen = false;
    state.worldMenuOpen = false;
    state.launcherTab = getPreferredLauncherTab();
  }
  if (state.mode === "build" && !isEditor()) {
    state.mode = "play";
  }
  if (elements.panelTitle) {
    elements.panelTitle.textContent = world?.name || "No world selected";
  }
  if (elements.panelSubtitle) {
    elements.panelSubtitle.textContent = world
      ? `${world.creator.username} · ${world.world_type}${world.active_instance ? ` · ${world.active_instance.status}` : ""}`
      : "Open or create a world to enter the scene.";
  }
  renderWorldMeta();
  renderSceneStrip();
  renderSceneEditor();
  renderCollaborators();
  renderRuntimeStatus();
  renderBuildSummary();
  renderPrivateShare();
  updatePrivateBrowserPanel();

  const hasWorld = Boolean(world);
  const canEdit = isEditor();
  const localParticipant = getLocalParticipant(world);
  state.joined = Boolean(localParticipant);
  state.joinedAsGuest = !state.session && localParticipant?.join_role === "guest";
  const joinedAsPlayer = localParticipant?.join_role === "player";
  renderSessionSummary();
  for (const button of elements.privatePanelTabButtons ?? []) {
    const tab = button.getAttribute("data-private-panel-tab") || "";
    if (tab === "build") {
      button.disabled = !hasWorld || !canEdit;
    } else if (tab === "world") {
      button.disabled = !hasWorld;
    } else {
      button.disabled = !hasWorld;
    }
  }
  if (elements.sceneToolsToggle) {
    elements.sceneToolsToggle.disabled = !hasWorld || !canEdit;
  }
  if (elements.worldMenuToggle) {
    elements.worldMenuToggle.disabled = !hasWorld;
  }
  elements.readyToggle.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  elements.startScene.disabled = !hasWorld || !state.session || !world.active_instance;
  elements.releasePlayer.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  elements.resetScene.disabled = !hasWorld || !canEdit;
  elements.saveCollaborator.disabled = !hasWorld || !canEdit;
  elements.generateHtml.disabled = !hasWorld || !state.session;
  elements.generateScript.disabled = !hasWorld || !state.session;
  if (elements.panelModeBuild) {
    elements.panelModeBuild.disabled = !hasWorld || !canEdit;
    elements.panelModeBuild.classList.toggle("is-active", state.mode === "build");
  }
  if (elements.panelModePlay) {
    elements.panelModePlay.disabled = !hasWorld;
    elements.panelModePlay.classList.toggle("is-active", state.mode === "play");
  }
  if (elements.panelScenes) {
    elements.panelScenes.disabled = !hasWorld || !canEdit;
  }
  if (elements.panelWorld) {
    elements.panelWorld.disabled = !hasWorld;
  }
  if (elements.panelExport) {
    elements.panelExport.disabled = !hasWorld || !state.session;
  }
  if (elements.panelEnter) {
    elements.panelEnter.disabled = !hasWorld || Boolean(localParticipant);
  }
  if (elements.panelLeave) {
    elements.panelLeave.disabled = !hasWorld || !localParticipant;
  }
  if (elements.panelReady) {
    elements.panelReady.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  }
  if (elements.panelStart) {
    elements.panelStart.disabled = !hasWorld || !state.session || !world.active_instance;
  }
  if (elements.panelRelease) {
    elements.panelRelease.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  }
  if (elements.panelReset) {
    elements.panelReset.disabled = !hasWorld || !canEdit;
  }
  if (elements.panelShareCopy) {
    elements.panelShareCopy.disabled = !hasWorld;
  }
  if (elements.panelShareNative) {
    elements.panelShareNative.disabled = !hasWorld || typeof navigator.share !== "function";
  }

  for (const button of [
    elements.addVoxel,
    elements.addPrimitive,
    elements.addPlayer,
    elements.addScreen,
    elements.addText,
    elements.addTrigger,
    elements.addParticle,
    elements.addRule,
  ]) {
    button.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }

  if (elements.removeEntity) {
    elements.removeEntity.disabled = !hasWorld || !canEdit || state.mode !== "build" || !state.builderSelection;
  }
  if (elements.convertPrefab) {
    const selectionKind = state.builderSelection?.kind || "";
    elements.convertPrefab.disabled = !hasWorld || !canEdit || state.mode !== "build" || !state.builderSelection || selectionKind === "particle" || selectionKind === "prefab_instance";
  }
  if (elements.placePrefab) {
    elements.placePrefab.disabled = !hasWorld || !canEdit || state.mode !== "build" || !state.selectedPrefabId;
  }

  setMode(state.mode);
  updateShellState();
  updatePreviewFromSelection();
  renderPrivateChat();
  updatePrivateBrowserPanel();
}

function snapBuildValue(value, step = 0.1) {
  const safeStep = Math.max(0.01, Number(step) || 0.1);
  return Math.round((Number(value) || 0) / safeStep) * safeStep;
}

function raycastPreviewPointer(event) {
  const preview = ensurePreview();
  if (!preview) {
    return null;
  }
  const rect = elements.previewCanvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
  );
  preview.raycaster.setFromCamera(pointer, preview.camera);
  return preview.raycaster.intersectObjects(preview.entityPickables, false)[0] ?? null;
}

function getBuildDragPoint(event, plane) {
  const preview = ensurePreview();
  if (!preview || !plane) {
    return null;
  }
  const rect = elements.previewCanvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
  );
  preview.raycaster.setFromCamera(pointer, preview.camera);
  const point = new THREE.Vector3();
  return preview.raycaster.ray.intersectPlane(plane, point) ? point : null;
}

function canDirectManipulateSelection(kind) {
  return kind === "voxel"
    || kind === "primitive"
    || kind === "player"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "prefab_instance";
}

function beginBuildDrag(event, hit = raycastPreviewPointer(event)) {
  const entityKind = hit?.object?.userData?.privateWorldEntityKind;
  const entityId = hit?.object?.userData?.privateWorldEntityId;
  if (!entityKind || !entityId) {
    return false;
  }
  setBuilderSelection(entityKind, entityId);
  if (!canDirectManipulateSelection(entityKind)) {
    return false;
  }
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    return false;
  }
  const selected = getSelectedEntity(sceneDoc);
  if (!selected?.entry) {
    return false;
  }
  const planeY = Number(selected.entry.position?.y ?? 0) || 0;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const point = getBuildDragPoint(event, plane);
  if (!point) {
    return false;
  }
  state.buildDrag = {
    pointerId: event.pointerId,
    kind: selected.kind,
    id: selected.entry.id,
    plane,
    startPoint: point.clone(),
    startPosition: deepClone(selected.entry.position ?? { x: 0, y: planeY, z: 0 }),
  };
  return true;
}

function updateBuildDrag(event) {
  if (!state.buildDrag || state.buildDrag.pointerId !== event.pointerId) {
    return false;
  }
  const point = getBuildDragPoint(event, state.buildDrag.plane);
  if (!point) {
    return false;
  }
  const delta = new THREE.Vector3().subVectors(point, state.buildDrag.startPoint);
  const step = state.buildDrag.kind === "voxel" ? 0.5 : state.buildDrag.kind === "trigger" ? 0.25 : 0.1;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntity(sceneDoc);
    if (!selected?.entry || selected.entry.id !== state.buildDrag?.id) {
      return;
    }
    selected.entry.position = selected.entry.position || { x: 0, y: 0, z: 0 };
    selected.entry.position.x = snapBuildValue(state.buildDrag.startPosition.x + delta.x, step);
    selected.entry.position.z = snapBuildValue(state.buildDrag.startPosition.z + delta.z, step);
    selected.entry.position.y = state.buildDrag.startPosition.y;
  });
  return true;
}

function endBuildDrag(pointerId = 0) {
  if (!state.buildDrag || (pointerId && state.buildDrag.pointerId !== pointerId)) {
    return;
  }
  state.buildDrag = null;
}

function adjustSelectedEntityByWheel(event) {
  if (!isEditor() || state.mode !== "build" || !state.builderSelection) {
    return false;
  }
  const rotateMode = event.shiftKey;
  const scaleMode = event.altKey;
  if (!rotateMode && !scaleMode) {
    return false;
  }
  event.preventDefault();
  const delta = Number(event.deltaY) || 0;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntity(sceneDoc);
    if (!selected?.entry) {
      return;
    }
    if (rotateMode) {
      selected.entry.rotation = selected.entry.rotation || { x: 0, y: 0, z: 0 };
      selected.entry.rotation.y = clampNumber(
        (selected.entry.rotation.y ?? 0) + delta * 0.004,
        selected.entry.rotation.y ?? 0,
        -Math.PI * 8,
        Math.PI * 8,
      );
      return;
    }
    if (typeof selected.entry.scale === "number") {
      selected.entry.scale = clampNumber((selected.entry.scale ?? 1) + delta * -0.003, selected.entry.scale ?? 1, 0.2, 64);
      return;
    }
    selected.entry.scale = selected.entry.scale || { x: 1, y: 1, z: 1 };
    for (const axis of ["x", "y", "z"]) {
      selected.entry.scale[axis] = clampNumber(
        (selected.entry.scale?.[axis] ?? 1) + delta * -0.003,
        selected.entry.scale?.[axis] ?? 1,
        0.1,
        128,
      );
    }
  });
  return true;
}

function hasPrivateMovementIntent(activeKeys) {
  return PRIVATE_MOVEMENT_INTENT_KEYS.some((key) => activeKeys.has(key));
}

function hasPrivateSprintIntent(activeKeys) {
  return activeKeys.has("shift") && PRIVATE_SPRINT_MOVEMENT_KEYS.some((key) => activeKeys.has(key));
}

function getPrivateSprintSpeedMultiplier() {
  const progress = Math.max(0, Math.min(1, privateInputState.sprintHoldSeconds / PRIVATE_SPRINT.rampSeconds));
  const easedProgress = progress * progress * (3 - 2 * progress);
  return 1 + (PRIVATE_SPRINT.maxMultiplier - 1) * easedProgress;
}

function ensureViewerAvatar(preview) {
  if (preview.viewerAvatar) {
    return preview.viewerAvatar;
  }
  const figure = createViewerAvatarFigure({
    seed: "viewer-self",
    scale: 0.92,
    outlineColor: PRIVATE_WORLD_STYLE.accents[0],
  });
  const avatar = {
    group: figure.group,
    shadow: figure.shadow,
    position: state.viewerPosition.clone(),
    poseRoot: figure.poseRoot,
    halo: figure.halo,
    orb: figure.orb,
    orbBaseY: figure.orb.position.y,
    opacity: 1,
    targetOpacity: 1,
    bobPhase: Math.random() * Math.PI * 2,
    lastPosition: state.viewerPosition.clone(),
    lastSyncElapsed: 0,
    leanX: 0,
    leanZ: 0,
    targetLeanX: 0,
    targetLeanZ: 0,
    facingYaw: normalizeAngle(privateInputState.yaw + Math.PI),
    bubbleAccent: PRIVATE_WORLD_STYLE.accents[0],
    bubble: createPrivateActorBubbleState(PRIVATE_WORLD_STYLE.accents[0], {
      persistent: true,
    }),
  };
  avatar.group.add(avatar.bubble.mesh);
  avatar.group.position.copy(state.viewerPosition);
  if (avatar.shadow) {
    avatar.shadow.position.y = -avatar.group.position.y + 0.05;
  }
  preview.actors.add(avatar.group);
  preview.viewerAvatar = avatar;
  applyPrivateChatBubbleToActor(avatar, state.activeChats.get(getPrivateViewerSessionId()));
  return avatar;
}

function updatePrivateMovement(preview, deltaSeconds) {
  const activeKeys = new Set(privateInputState.keys);
  const sprintIntentActive = hasPrivateSprintIntent(activeKeys);
  privateInputState.sprintHoldSeconds = sprintIntentActive
    ? Math.min(PRIVATE_SPRINT.rampSeconds, privateInputState.sprintHoldSeconds + deltaSeconds)
    : Math.max(
      0,
      privateInputState.sprintHoldSeconds - (deltaSeconds * PRIVATE_SPRINT.rampSeconds) / PRIVATE_SPRINT.decaySeconds,
    );

  if (!hasPrivateMovementIntent(activeKeys)) {
    return;
  }

  const previousPosition = state.viewerPosition.clone();
  const { forward, right } = getPrivateCameraMovementBasis(preview);
  const velocity = new THREE.Vector3();
  let vertical = 0;

  if (activeKeys.has("w") || activeKeys.has("forward") || activeKeys.has("arrowup")) {
    velocity.add(forward);
  }
  if (activeKeys.has("s") || activeKeys.has("backward") || activeKeys.has("arrowdown")) {
    velocity.sub(forward);
  }
  if (activeKeys.has("a") || activeKeys.has("left") || activeKeys.has("arrowleft")) {
    velocity.sub(right);
  }
  if (activeKeys.has("d") || activeKeys.has("right") || activeKeys.has("arrowright")) {
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

  const speedMultiplier = sprintIntentActive ? getPrivateSprintSpeedMultiplier() : 1;
  if (velocity.lengthSq() > 0) {
    velocity.normalize();
    state.viewerPosition.addScaledVector(
      velocity,
      deltaSeconds * PRIVATE_CAMERA.movementSpeed * speedMultiplier,
    );
  }
  state.viewerPosition.y = clampNumber(
    state.viewerPosition.y + vertical * deltaSeconds * PRIVATE_CAMERA.verticalSpeed * speedMultiplier,
    state.viewerPosition.y,
    PRIVATE_CAMERA.minY,
    PRIVATE_CAMERA.maxY,
  );
  clampViewerPositionToWorldBounds(state.viewerPosition);
  syncPrivateCameraToFollowTarget(preview);
  leaveViewerMovementTrail(preview, previousPosition, state.viewerPosition, deltaSeconds);
}

function syncPrivateLocalAvatar(preview, elapsedSeconds) {
  const avatar = ensureViewerAvatar(preview);
  avatar.group.visible = true;
  const deltaSeconds = Math.max(1 / 240, avatar.lastSyncElapsed == null ? 1 / 60 : elapsedSeconds - avatar.lastSyncElapsed);
  avatar.lastSyncElapsed = elapsedSeconds;
  const { forward, right } = getPrivateCameraPlanarBasis(preview);
  updateMascotMotion(avatar, {
    deltaSeconds,
    elapsedSeconds,
    nextPosition: state.viewerPosition,
    maxSpeed: PRIVATE_CAMERA.movementSpeed * 1.35,
    movementBasisForward: forward,
    movementBasisRight: right,
    idleFacingYaw: avatar.facingYaw,
    bobAmplitude: 0.16,
    bobSpeed: 1.6,
  });
  if (avatar.shadow) {
    avatar.shadow.position.y = -avatar.group.position.y + 0.05;
  }
  updatePrivateActorBubble(avatar, deltaSeconds, preview.camera);
}

function updatePossessedCamera(preview) {
  const player = getPossessedRuntimePlayer();
  if (!player) {
    return false;
  }
  const yaw = Number(player.rotation?.y ?? 0) || 0;
  if (player.camera_mode === "first_person") {
    preview.camera.position.set(player.position.x, player.position.y + 1.25 * (player.scale || 1), player.position.z);
    preview.camera.lookAt(
      player.position.x + Math.sin(yaw) * 4,
      player.position.y + 1.1 * (player.scale || 1),
      player.position.z - Math.cos(yaw) * 4,
    );
    return true;
  }
  if (player.camera_mode === "top_down") {
    preview.camera.position.set(player.position.x, player.position.y + 18, player.position.z + 0.01);
    preview.camera.lookAt(player.position.x, player.position.y, player.position.z);
    return true;
  }
  preview.camera.position.set(
    player.position.x - Math.sin(yaw) * 7,
    player.position.y + 4.2,
    player.position.z + Math.cos(yaw) * 7,
  );
  preview.camera.lookAt(player.position.x, player.position.y + 1.2, player.position.z);
  return true;
}

function buildPreviewEnvironment(preview) {
  const environment = new THREE.Group();
  preview.scene.add(environment);
  preview.environment = environment;
  preview.ground = null;
  preview.groundRim = null;
  preview.groundGlow = null;
  preview.buildGrid = null;
  preview.buildFootprint = null;
  refreshPrivatePreviewEnvironment(preview);
}

function clearPrivatePreviewEnvironment(preview) {
  if (!preview?.environment) {
    return;
  }
  for (const child of [...preview.environment.children]) {
    if (!child) {
      continue;
    }
    preview.environment.remove(child);
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => {
          material?.map?.dispose?.();
          material?.dispose?.();
        });
      } else {
        node.material?.map?.dispose?.();
        node.material?.dispose?.();
      }
    });
  }
}

function refreshPrivatePreviewEnvironment(preview = state.preview, world = state.selectedWorld) {
  if (!preview?.environment) {
    return;
  }
  const bounds = getPrivateWorldBounds(world);
  const nextKey = `${bounds.width}:${bounds.length}:${bounds.height}`;
  if (preview.environmentKey === nextKey) {
    syncPrivatePreviewEnvironmentState(preview);
    return;
  }
  preview.environmentKey = nextKey;
  clearPrivatePreviewEnvironment(preview);

  const groundRadius = clampNumber(Math.max(bounds.width, bounds.length) * 0.82, 48, 28, 240);
  const ground = new THREE.Mesh(
    world
      ? new THREE.PlaneGeometry(bounds.width, bounds.length)
      : new THREE.CircleGeometry(groundRadius, 72),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.ground),
      transparent: true,
      opacity: world ? 0.98 : 1,
      side: THREE.DoubleSide,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  preview.environment.add(ground);

  const groundRim = world
    ? new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(bounds.width, bounds.length)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(PRIVATE_WORLD_STYLE.line),
        transparent: true,
        opacity: 0.54,
        fog: false,
      }),
    )
    : new THREE.Mesh(
      new THREE.RingGeometry(groundRadius * 0.985, groundRadius, 96),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PRIVATE_WORLD_STYLE.line),
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
  groundRim.rotation.x = -Math.PI / 2;
  groundRim.position.y = 0.02;
  preview.environment.add(groundRim);

  const gridSize = Math.max(bounds.width, bounds.length);
  const gridDivisions = Math.max(4, Math.round(gridSize));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, "#7fa7ff", "#bfd6ff");
  grid.position.y = 0.04;
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    material.opacity = 0.32;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
  }
  preview.environment.add(grid);

  const footprint = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(bounds.width, 0.04, bounds.length)),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.outline),
      transparent: true,
      opacity: 0.44,
      fog: false,
    }),
  );
  footprint.position.y = 0.08;
  preview.environment.add(footprint);
  preview.ground = ground;
  preview.groundRim = groundRim;
  preview.groundGlow = null;
  preview.buildGrid = grid;
  preview.buildFootprint = footprint;
  syncPrivatePreviewEnvironmentState(preview);
}

function syncPrivatePreviewEnvironmentState(preview = state.preview) {
  if (!preview?.buildGrid) {
    return;
  }
  const noWorld = !state.selectedWorld;
  const buildMode = state.mode === "build" && isEditor();
  const showGridHint = preview.showGridHint === true;
  if (preview.ground) {
    preview.ground.visible = true;
  }
  if (preview.groundRim) {
    preview.groundRim.visible = true;
    preview.groundRim.material.opacity = noWorld ? 0.46 : (showGridHint ? 0.62 : 0.5);
  }
  preview.buildGrid.visible = noWorld || Boolean(state.selectedWorld);
  if (preview.buildGrid.material) {
    const materials = Array.isArray(preview.buildGrid.material)
      ? preview.buildGrid.material
      : [preview.buildGrid.material];
    for (const material of materials) {
      material.opacity = noWorld ? 0.22 : (showGridHint ? 0.44 : (buildMode ? 0.34 : 0.22));
    }
  }
  if (preview.buildFootprint) {
    preview.buildFootprint.visible = true;
    preview.buildFootprint.material.opacity = noWorld ? 0.3 : (showGridHint ? 0.48 : (buildMode ? 0.5 : 0.34));
  }
}

function buildWorldBoundsPreview(world = state.selectedWorld) {
  if (!world) {
    return null;
  }
  const width = Math.max(4, Number(world.width ?? 24) || 24);
  const length = Math.max(4, Number(world.length ?? 24) || 24);
  const height = Math.max(2, Number(world.height ?? 8) || 8);
  const group = new THREE.Group();
  const boundsGeometry = new THREE.BoxGeometry(width, height, length);
  const boundsEdges = new THREE.EdgesGeometry(boundsGeometry);
  const boundsLines = new THREE.LineSegments(
    boundsEdges,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.line),
      transparent: true,
      opacity: world.world_type === "field" ? 0.22 : 0.32,
      fog: false,
    }),
  );
  boundsLines.position.set(0, height / 2, 0);
  group.add(boundsLines);

  if (world.world_type === "room") {
    const wallMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffffff"),
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMaterial.clone());
    backWall.position.set(0, height / 2, -length / 2);
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMaterial.clone());
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-width / 2, height / 2, 0);
    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMaterial.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(width / 2, height / 2, 0);
    group.add(backWall, leftWall, rightWall);
  }

  if (world.world_type === "board") {
    const rail = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, Math.max(0.4, height * 0.14), length)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(PRIVATE_WORLD_STYLE.outline),
        transparent: true,
        opacity: 0.26,
        fog: false,
      }),
    );
    rail.position.y = Math.max(0.2, height * 0.07);
    group.add(rail);
  }
  return group;
}

function ensurePreview() {
  if (state.preview || !elements.previewCanvas) {
    return state.preview;
  }
  const renderer = new THREE.WebGLRenderer({
    canvas: elements.previewCanvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(elements.previewCanvas.clientWidth || 640, 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PRIVATE_WORLD_STYLE.background);
  scene.fog = new THREE.Fog(PRIVATE_WORLD_STYLE.fog, 170, 1600);

  const camera = new THREE.PerspectiveCamera(58, (elements.previewCanvas.clientWidth || 640) / 360, 0.1, 2400);
  camera.position.copy(state.viewerCameraPosition);
  camera.rotation.order = "YXZ";
  camera.lookAt(getPrivatePlayerLookTarget());

  const ambient = new THREE.HemisphereLight("#ffffff", "#ffe8f8", 1.48);
  ambient.position.set(0, 180, 0);
  const sunLight = new THREE.DirectionalLight("#fff4be", 1.16);
  sunLight.position.set(120, 280, 80);
  scene.add(ambient, sunLight);

  state.preview = {
    renderer,
    scene,
    camera,
    root: new THREE.Group(),
    actors: new THREE.Group(),
    presence: new THREE.Group(),
    chatBubbleGhosts: new THREE.Group(),
    browserShares: new THREE.Group(),
    trails: new THREE.Group(),
    raycaster: new THREE.Raycaster(),
    entityPickables: [],
    entityMeshes: new Map(),
    effectSystems: [],
    animatedChatBubbleGhosts: [],
    trailPuffs: [],
    presenceEntries: new Map(),
    browserShareEntries: new Map(),
    lastFrameAt: performance.now(),
  };
  buildPreviewEnvironment(state.preview);
  state.preview.scene.add(state.preview.root);
  state.preview.scene.add(state.preview.actors);
  state.preview.scene.add(state.preview.presence);
  state.preview.scene.add(state.preview.chatBubbleGhosts);
  state.preview.scene.add(state.preview.browserShares);
  state.preview.scene.add(state.preview.trails);
  ensureViewerAvatar(state.preview);
  resetViewerRig();
  syncPrivateCameraToFollowTarget(state.preview);

  const render = (timestamp = performance.now()) => {
    if (!state.preview) {
      return;
    }
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (timestamp - state.preview.lastFrameAt) / 1000));
    state.preview.lastFrameAt = timestamp;
    const width = elements.previewCanvas.clientWidth || 640;
    const height = elements.previewCanvas.clientHeight || 360;
    state.preview.camera.aspect = width / Math.max(1, height);
    state.preview.camera.updateProjectionMatrix();
    state.preview.renderer.setSize(width, height, false);
    refreshPrivatePreviewEnvironment(state.preview);
    const possessed = state.mode === "play" && updatePossessedCamera(state.preview);
    if (possessed) {
      if (state.preview.viewerAvatar) {
        state.preview.viewerAvatar.group.visible = false;
      }
    } else {
      updatePrivateMovement(state.preview, deltaSeconds);
      syncPrivateLocalAvatar(state.preview, timestamp / 1000);
    }
    sendPrivatePresence();
    pruneExpiredPrivateChatEvents();
    updatePrivatePresenceScene(deltaSeconds, timestamp / 1000);
    updatePrivateShareBubbles(deltaSeconds, timestamp / 1000);
    updatePrivateRemoteBrowserAudioMix();
    updatePrivateChatBubbleGhosts(state.preview, deltaSeconds, state.preview.camera);
    updatePreviewEffects(state.preview, timestamp / 1000);
    updateViewerTrailPuffs(state.preview, deltaSeconds);
    state.preview.renderer.render(state.preview.scene, state.preview.camera);
    window.requestAnimationFrame(render);
  };

  window.addEventListener("resize", render);
  elements.previewCanvas.addEventListener("pointerdown", (event) => {
    if (state.mode === "build" && isEditor()) {
      if (beginBuildDrag(event)) {
        elements.previewCanvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (state.mode !== "play" && state.mode !== "build") {
      return;
    }
    privateInputState.pointerDown = true;
    privateInputState.dragDistance = 0;
    privateInputState.pointerMoved = false;
    privateInputState.lastPointerX = event.clientX;
    privateInputState.lastPointerY = event.clientY;
    elements.previewCanvas.setPointerCapture(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointermove", (event) => {
    if (state.buildDrag && state.buildDrag.pointerId === event.pointerId) {
      event.preventDefault();
      updateBuildDrag(event);
      return;
    }
    if (!privateInputState.pointerDown) {
      return;
    }
    const deltaX = event.clientX - privateInputState.lastPointerX;
    const deltaY = event.clientY - privateInputState.lastPointerY;
    privateInputState.dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
    privateInputState.pointerMoved = privateInputState.dragDistance > 4;
    privateInputState.lastPointerX = event.clientX;
    privateInputState.lastPointerY = event.clientY;
    privateInputState.yaw -= deltaX * 0.0045;
    privateInputState.pitch = clampNumber(
      privateInputState.pitch - deltaY * 0.0036,
      privateInputState.pitch,
      PRIVATE_CAMERA.lookMin,
      PRIVATE_CAMERA.lookMax,
    );
    syncPrivateCameraToFollowTarget(state.preview);
  });
  elements.previewCanvas.addEventListener("pointerup", (event) => {
    if (state.buildDrag && state.buildDrag.pointerId === event.pointerId) {
      endBuildDrag(event.pointerId);
      elements.previewCanvas.releasePointerCapture?.(event.pointerId);
      return;
    }
    state.viewerSuppressClickAt = privateInputState.pointerMoved ? performance.now() : 0;
    privateInputState.pointerDown = false;
    elements.previewCanvas.releasePointerCapture?.(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointercancel", (event) => {
    endBuildDrag(event.pointerId);
    privateInputState.pointerDown = false;
    privateInputState.pointerMoved = false;
    elements.previewCanvas.releasePointerCapture?.(event.pointerId);
  });
  elements.previewCanvas.addEventListener("wheel", (event) => {
    if (adjustSelectedEntityByWheel(event)) {
      return;
    }
    event.preventDefault();
    if (getPossessedRuntimePlayer()) {
      return;
    }
    const rig = getPrivateViewerRigConfig();
    state.cameraRadius = clampNumber(
      state.cameraRadius + event.deltaY * PRIVATE_CAMERA.wheelFactor,
      rig.defaultRadius,
      rig.minRadius,
      rig.maxRadius,
    );
    syncPrivateCameraToFollowTarget(state.preview);
  }, { passive: false });
  elements.previewCanvas.addEventListener("click", (event) => {
    if (state.viewerSuppressClickAt && performance.now() - state.viewerSuppressClickAt < 240) {
      return;
    }
    const hit = raycastPreviewPointer(event);
    const entityKind = hit?.object?.userData?.privateWorldEntityKind;
    const entityId = hit?.object?.userData?.privateWorldEntityId;
    if (state.mode === "build" && entityKind && entityId) {
      setBuilderSelection(entityKind, entityId);
      return;
    }
    if (state.mode !== "play" || !state.session || getLocalParticipant()?.join_role === "player") {
      return;
    }
    const playerEntityId = hit?.object?.userData?.privateWorldPlayerId;
    if (playerEntityId) {
      void occupyPlayer(playerEntityId);
    }
  });
  window.requestAnimationFrame(render);
  return state.preview;
}

function clearPreviewRoot() {
  const preview = ensurePreview();
  if (!preview) {
    return;
  }
  preview.entityPickables = [];
  preview.entityMeshes.clear();
  disposePreviewEffects(preview);
  for (const entry of [...(preview.animatedChatBubbleGhosts ?? [])]) {
    removePrivateChatBubbleGhost(preview, entry);
  }
  for (const child of [...preview.root.children]) {
    preview.root.remove(child);
    child.traverse((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material?.dispose?.());
      } else {
        node.material?.dispose?.();
      }
    });
  }
}

function disposePreviewEffects(preview) {
  for (const effect of preview.effectSystems ?? []) {
    effect.object?.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material?.dispose?.());
      } else {
        node.material?.dispose?.();
      }
    });
    effect.object?.removeFromParent?.();
  }
  preview.effectSystems = [];
}

function makeMaterial(material = {}, scale = { x: 1, y: 1, z: 1 }, { selected = false } = {}) {
  const built = createPatternedMaterial(THREE, material, {
    repeatX: Math.max(1, Number(scale?.x ?? 1) * 0.9),
    repeatY: Math.max(1, Number(scale?.z ?? scale?.y ?? 1) * 0.9),
  });
  if (selected) {
    built.emissive = new THREE.Color("#355f9b");
    built.emissiveIntensity = 0.22;
  }
  return built;
}

function addTextBillboard(preview, value, position) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(255,255,255,0.98)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#243b64";
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = "#14213d";
  context.font = "700 42px Manrope, sans-serif";
  context.textBaseline = "middle";
  context.fillText(String(value ?? "").slice(0, 32), 24, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 1.2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.position.set(position.x, position.y, position.z);
  preview.root.add(mesh);
  return mesh;
}

function createParticleSystem(preview, anchorId, effectName, color, particleId = anchorId) {
  const count = String(effectName).includes("smoke") ? 28 : 18;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const seeds = Array.from({ length: count }, (_, index) => ({
    radius: 0.2 + (index % 5) * 0.06,
    height: (index / count) * 1.8,
    speed: 0.6 + (index % 7) * 0.08,
    phase: index * 0.72,
  }));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: color || "#ff5a7a",
    size: String(effectName).includes("smoke") ? 0.3 : 0.18,
    transparent: true,
    opacity: String(effectName).includes("smoke") ? 0.34 : 0.82,
    depthWrite: false,
    blending: String(effectName).includes("smoke") ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  preview.root.add(points);
  return {
    kind: "particle",
    anchorId,
    particleId,
    object: points,
    positions,
    seeds,
    effectName: effectName || "sparkles",
  };
}

function createTrailSystem(preview, anchorId, effectName, color) {
  const historyLength = 18;
  const points = Array.from({ length: historyLength }, () => new THREE.Vector3());
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: color || "#ffcc66",
    transparent: true,
    opacity: String(effectName).includes("glow") ? 0.84 : 0.56,
  });
  const line = new THREE.Line(geometry, material);
  preview.root.add(line);
  return {
    kind: "trail",
    anchorId,
    object: line,
    history: points,
  };
}

function spawnViewerTrailPuff(preview, position, travelVector) {
  if (!preview?.trails) {
    return;
  }
  const group = new THREE.Group();
  group.position.copy(position);
  group.position.y += 1.35;
  const radius = 0.3 + Math.random() * 0.16;
  const geometry = new THREE.SphereGeometry(radius, 16, 16);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshToonMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.white),
      gradientMap: getPrivateToonGradientTexture(),
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      fog: false,
    }),
  );
  const shell = createOutlineShell(geometry, PRIVATE_WORLD_STYLE.trailOutline, 1.12);
  shell.material.opacity = 0.58;
  mesh.add(shell);
  group.add(mesh);
  preview.trails.add(group);
  preview.trailPuffs.push({
    group,
    mesh,
    shell,
    velocity: new THREE.Vector3(
      -travelVector.x * 0.018 + (Math.random() - 0.5) * 0.18,
      0.08 + Math.random() * 0.1,
      -travelVector.z * 0.018 + (Math.random() - 0.5) * 0.18,
    ),
    drift: new THREE.Vector3(-travelVector.x * 0.004, 0.05 + Math.random() * 0.04, -travelVector.z * 0.004),
    growth: 0.18 + Math.random() * 0.16,
    age: 0,
    lifetime: 1.1 + Math.random() * 0.28,
  });
}

function leaveViewerMovementTrail(preview, previousPosition, nextPosition, deltaSeconds) {
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
  spawnViewerTrailPuff(preview, previousPosition.clone(), delta);
}

function updateViewerTrailPuffs(preview, deltaSeconds) {
  if (!preview?.trailPuffs?.length) {
    return;
  }
  for (let index = preview.trailPuffs.length - 1; index >= 0; index -= 1) {
    const entry = preview.trailPuffs[index];
    entry.age += deltaSeconds;
    const life = Math.min(1, entry.age / Math.max(0.0001, entry.lifetime));
    entry.group.position.addScaledVector(entry.drift, deltaSeconds);
    entry.group.position.y += deltaSeconds * 0.08;
    entry.mesh.position.addScaledVector(entry.velocity, deltaSeconds);
    const scale = 1 + entry.growth * life;
    entry.mesh.scale.setScalar(scale);
    entry.mesh.material.opacity = (1 - life) * 0.88;
    if (entry.shell?.material) {
      entry.shell.material.opacity = (1 - life) * 0.46;
    }
    if (life >= 1) {
      preview.trails.remove(entry.group);
      entry.group.traverse((node) => {
        if (node.geometry) {
          node.geometry.dispose();
        }
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach((material) => material.dispose?.());
          } else {
            node.material.dispose?.();
          }
        }
      });
      preview.trailPuffs.splice(index, 1);
    }
  }
}

function updatePreviewEffects(preview, elapsedSeconds) {
  for (const effect of preview.effectSystems ?? []) {
    const anchor = preview.entityMeshes.get(effect.anchorId);
    if (!anchor) {
      effect.object.visible = false;
      continue;
    }
    effect.object.visible = anchor.visible !== false;
    const worldPosition = new THREE.Vector3();
    anchor.getWorldPosition(worldPosition);
    const anchorScale = new THREE.Vector3();
    anchor.getWorldScale(anchorScale);
    if (effect.kind === "particle") {
      const runtimeParticle = state.runtimeSnapshot?.particles?.find((entry) => entry.id === effect.particleId);
      effect.object.visible = effect.object.visible && runtimeParticle?.enabled !== false;
      for (let index = 0; index < effect.seeds.length; index += 1) {
        const seed = effect.seeds[index];
        const progress = (elapsedSeconds * seed.speed + seed.phase) % 1;
        const orbit = elapsedSeconds * (seed.speed * 1.2) + seed.phase;
        const offset = index * 3;
        effect.positions[offset] = worldPosition.x + Math.cos(orbit) * seed.radius * Math.max(0.8, anchorScale.x);
        effect.positions[offset + 1] = worldPosition.y + 0.4 + progress * seed.height * Math.max(0.75, anchorScale.y);
        effect.positions[offset + 2] = worldPosition.z + Math.sin(orbit) * seed.radius * Math.max(0.8, anchorScale.z);
      }
      effect.object.geometry.attributes.position.needsUpdate = true;
      continue;
    }
    if (effect.kind === "trail") {
      effect.history.unshift(worldPosition.clone());
      effect.history.pop();
      effect.object.geometry.setFromPoints(effect.history);
      effect.object.geometry.attributes.position.needsUpdate = true;
    }
  }
}

function getRuntimeTransformMaps() {
  const runtime = state.runtimeSnapshot;
  const activeSceneId = runtime?.active_scene_id || state.selectedWorld?.active_instance?.active_scene_id || "";
  if (!runtime || activeSceneId !== state.selectedSceneId) {
    return {
      dynamicById: new Map(),
      playerById: new Map(),
    };
  }
  return {
    dynamicById: new Map((runtime.dynamic_objects ?? []).map((entry) => [entry.id, entry])),
    playerById: new Map((runtime.players ?? []).map((entry) => [entry.id, entry])),
  };
}

function updatePreviewFromSelection() {
  const preview = ensurePreview();
  clearPreviewRoot();
  if (!preview) {
    return;
  }

  let sceneDoc = null;
  try {
    sceneDoc = getRenderableSceneDoc();
  } catch (_error) {
    preview.root.visible = false;
    return;
  }
  if (!sceneDoc) {
    preview.root.visible = false;
    return;
  }
  preview.root.visible = true;

  const addMesh = (geometry, material, position, rotation = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 }, metadata = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
    if (metadata?.id) {
      mesh.userData.privateWorldEntityId = metadata.id;
      mesh.userData.privateWorldEntityKind = metadata.kind;
      preview.entityPickables.push(mesh);
      preview.entityMeshes.set(metadata.id, mesh);
    }
    preview.root.add(mesh);
    return mesh;
  };
  const runtimeTransforms = getRuntimeTransformMaps();
  const particleEffects = [];
  const selectedEntity = state.builderSelection;
  refreshPrivatePreviewEnvironment(preview, state.selectedWorld);
  const hasPlacedGeometry = Boolean(
    (sceneDoc.voxels?.length ?? 0)
    || (sceneDoc.primitives?.length ?? 0)
    || (sceneDoc.screens?.length ?? 0)
    || (sceneDoc.text3d?.length ?? 0),
  );
  preview.showGridHint = !hasPlacedGeometry;
  syncPrivatePreviewEnvironmentState(preview);
  const boundsPreview = (state.mode === "build" && isEditor()) || !hasPlacedGeometry
    ? buildWorldBoundsPreview(state.selectedWorld)
    : null;
  if (boundsPreview) {
    preview.root.add(boundsPreview);
  }

  for (const [index, voxel] of (sceneDoc.voxels ?? []).entries()) {
    addMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(voxel.material, voxel.scale, {
        selected: selectedEntity?.kind === "voxel" && selectedEntity?.id === voxel.id,
      }),
      voxel.position || { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      voxel.scale || { x: 1, y: 1, z: 1 },
      { id: voxel.id || `voxel_${index}`, kind: "voxel" },
    );
  }

  for (const primitive of sceneDoc.primitives ?? []) {
    const runtimePrimitive = runtimeTransforms.dynamicById.get(primitive.id);
    let geometry = new THREE.BoxGeometry(1, 1, 1);
    if (primitive.shape === "sphere") {
      geometry = new THREE.SphereGeometry(0.5, 24, 24);
    } else if (primitive.shape === "cylinder") {
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    } else if (primitive.shape === "cone") {
      geometry = new THREE.ConeGeometry(0.5, 1, 20);
    } else if (primitive.shape === "plane") {
      geometry = new THREE.BoxGeometry(1, 0.1, 1);
    }
    const mesh = addMesh(
      geometry,
      makeMaterial(
        runtimePrimitive?.material_override
          ? { ...primitive.material, ...runtimePrimitive.material_override }
          : primitive.material,
        primitive.scale,
        {
          selected: selectedEntity?.kind === "primitive" && selectedEntity?.id === primitive.id,
        },
      ),
      runtimePrimitive?.position || primitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive?.rotation || primitive.rotation || { x: 0, y: 0, z: 0 },
      primitive.scale || { x: 1, y: 1, z: 1 },
      { id: primitive.id, kind: "primitive" },
    );
    if (primitive.particle_effect) {
      particleEffects.push(createParticleSystem(preview, primitive.id, primitive.particle_effect, primitive.material?.color || "#ffb16a"));
    }
    if (primitive.trail_effect) {
      particleEffects.push(createTrailSystem(preview, primitive.id, primitive.trail_effect, primitive.material?.color || "#ffcf84"));
    }
    if (selectedEntity?.kind === "primitive" && selectedEntity?.id === primitive.id) {
      mesh.material.emissiveIntensity = 0.3;
    }
  }

  for (const player of sceneDoc.players ?? []) {
    const runtimePlayer = runtimeTransforms.playerById.get(player.id);
    const mesh = addMesh(
      new THREE.CapsuleGeometry(0.35, 1.3, 8, 16),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : (player.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f"), texture_preset: "none" },
        { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
        {
          selected: selectedEntity?.kind === "player" && selectedEntity?.id === player.id,
        },
      ),
      runtimePlayer?.position || player.position || { x: 0, y: 1, z: 0 },
      runtimePlayer?.rotation || player.rotation || { x: 0, y: 0, z: 0 },
      { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
      { id: player.id, kind: "player" },
    );
    mesh.userData.privateWorldPlayerId = player.id;
  }

  for (const [playerId, runtimePlayer] of runtimeTransforms.playerById.entries()) {
    if ((sceneDoc.players ?? []).some((entry) => entry.id === playerId)) {
      continue;
    }
    const mesh = addMesh(
      new THREE.CapsuleGeometry(0.35, 1.3, 8, 16),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : "#ff8e4f", texture_preset: "none" },
        { x: 1, y: 1, z: 1 },
      ),
      runtimePlayer.position || { x: 0, y: 1, z: 0 },
      runtimePlayer.rotation || { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { id: playerId, kind: "player" },
    );
    mesh.userData.privateWorldPlayerId = playerId;
  }

  for (const screen of sceneDoc.screens ?? []) {
    const material = new THREE.MeshStandardMaterial({
      color: screen.material?.color || "#ffffff",
      roughness: 0.42,
      metalness: 0.08,
      emissive: "#4f6d8f",
      emissiveIntensity: 0.2,
    });
    const mesh = addMesh(
      new THREE.BoxGeometry(1, 1, 0.1),
      material,
      screen.position || { x: 0, y: 2, z: 0 },
      screen.rotation || { x: 0, y: 0, z: 0 },
      screen.scale || { x: 4, y: 2, z: 0.1 },
      { id: screen.id, kind: "screen" },
    );
    if (selectedEntity?.kind === "screen" && selectedEntity?.id === screen.id) {
      material.emissive = new THREE.Color("#355f9b");
      material.emissiveIntensity = 0.24;
    }
    void renderScreenHtmlTexture(THREE, screen, {
      width: 1024,
      height: 576,
    }).then((texture) => {
      if (!texture || !mesh.parent) {
        return;
      }
      material.map = texture;
      material.emissiveIntensity = 0.06;
      material.needsUpdate = true;
    }).catch(() => {
      // ignore transient screen texture failures
    });
  }

  for (const [objectId, runtimePrimitive] of runtimeTransforms.dynamicById.entries()) {
    if ((sceneDoc.primitives ?? []).some((entry) => entry.id === objectId)) {
      continue;
    }
    addMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(runtimePrimitive?.material_override ?? { color: "#edf2f8", texture_preset: "none" }),
      runtimePrimitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive.rotation || { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { id: objectId, kind: "primitive" },
    );
  }

  for (const text of sceneDoc.texts ?? []) {
    const mesh = addTextBillboard(preview, text.value || text.text, text.position || { x: 0, y: 2, z: 0 });
    mesh.userData.privateWorldEntityId = text.id;
    mesh.userData.privateWorldEntityKind = "text";
    preview.entityPickables.push(mesh);
    preview.entityMeshes.set(text.id, mesh);
  }

  for (const trigger of sceneDoc.trigger_zones ?? sceneDoc.triggerZones ?? []) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: "#ff4f78",
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      }),
    );
    mesh.position.set(trigger.position?.x || 0, trigger.position?.y || 0.5, trigger.position?.z || 0);
    mesh.scale.set(trigger.scale?.x || 2, trigger.scale?.y || 2, trigger.scale?.z || 2);
    mesh.userData.privateWorldEntityId = trigger.id;
    mesh.userData.privateWorldEntityKind = "trigger";
    preview.entityPickables.push(mesh);
    preview.entityMeshes.set(trigger.id, mesh);
    if (selectedEntity?.kind === "trigger" && selectedEntity?.id === trigger.id) {
      mesh.material.color = new THREE.Color("#ffd659");
    }
    preview.root.add(mesh);
  }

  for (const particle of sceneDoc.particles ?? []) {
    if (!particle.target_id) {
      continue;
    }
    particleEffects.push(createParticleSystem(preview, particle.target_id, particle.effect, particle.color, particle.id));
  }

  preview.effectSystems = particleEffects;
}

function connectWorldSocket() {
  const world = state.selectedWorld;
  if (!world) {
    disconnectWorldSocket();
    return;
  }
  const socketKey = `${world.world_id}:${String(world.creator.username ?? "").trim().toLowerCase()}`;
  if (
    state.worldSocket
    && state.worldSocket.readyState !== WebSocket.CLOSED
    && state.worldSocket.readyState !== WebSocket.CLOSING
    && state.worldSocketKey === socketKey
  ) {
    return;
  }
  disconnectWorldSocket();
  const socket = new WebSocket(buildSocketUrl(world.world_id, world.creator.username));
  state.worldSocket = socket;
  state.worldSocketKey = socketKey;
  socket.addEventListener("open", () => {
    renderPrivateChat();
    updatePrivateBrowserPanel();
    renderPrivateLiveSharesList();
    sendPrivatePresence(true);
  });
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "world:event") {
        pushEvent(payload.event?.type || "world:event", JSON.stringify(payload.event));
        void openWorld(world.world_id, world.creator.username, true);
      } else if (payload.type === "world:runtime") {
        state.runtimeSnapshot = payload.snapshot ?? null;
        if (state.selectedWorld?.active_instance && payload.snapshot?.active_scene_id) {
          state.selectedWorld.active_instance.active_scene_id = payload.snapshot.active_scene_id;
          state.selectedSceneId = payload.snapshot.active_scene_id;
        }
        renderRuntimeStatus();
        updatePreviewFromSelection();
      } else if (payload.type === "world:error") {
        pushEvent("world:error", payload.message || "Unknown world socket error");
      } else if (payload.type === "presence:snapshot") {
        mergePrivatePresenceRows(payload.presence ?? [], { replaceViewerSnapshot: true });
      } else if (payload.type === "presence:update") {
        mergePrivatePresenceRows([payload.presence ?? {}]);
      } else if (payload.type === "presence:remove") {
        removePrivatePresence(payload.viewerSessionId);
      } else if (payload.type === "chat:event") {
        pushPrivateChatEntry(payload);
      } else if (payload.type === "chat:error") {
        pushEvent("chat:error", payload.message || "Could not send chat");
      } else if (payload.type === "browser:session") {
        updatePrivateBrowserSessionState(payload.session ?? {});
      } else if (payload.type === "browser:subscribe") {
        updatePrivateBrowserSessionState({
          ...(state.browserSessions.get(payload.sessionId) ?? {}),
          sessionId: payload.sessionId,
          hostSessionId: payload.hostSessionId,
          deliveryMode: "full",
          viewerCount: payload.viewerCount,
          maxViewers: payload.maxViewers,
        });
        syncPrivateBrowserMediaSubscription(payload.sessionId, true);
      } else if (payload.type === "browser:unsubscribe") {
        updatePrivateBrowserSessionState({
          ...(state.browserSessions.get(payload.sessionId) ?? {}),
          sessionId: payload.sessionId,
          hostSessionId: payload.hostSessionId,
          deliveryMode: "placeholder",
          viewerCount: payload.viewerCount,
          maxViewers: payload.maxViewers,
        });
        syncPrivateBrowserMediaSubscription(payload.sessionId, false);
      } else if (payload.type === "browser:frame") {
        handlePrivateBrowserFrame(payload);
      } else if (payload.type === "browser:stop") {
        handlePrivateBrowserStop(payload);
      } else if (payload.type === "browser:error") {
        clearPendingPrivateBrowserShare({ stopTracks: true });
        setPrivateBrowserStatus(payload.message || "Live share failed.");
        updatePrivateBrowserPanel();
      } else if (payload.type === "world:snapshot") {
        if (payload.world?.world_id === state.selectedWorld?.world_id) {
          state.selectedWorld = payload.world;
          state.selectedSceneId = payload.world?.active_instance?.active_scene_id || getSelectedScene()?.id || payload.world?.scenes?.[0]?.id || "";
          syncRuntimeFromWorld(payload.world);
          renderSelectedWorld();
        }
      }
    } catch (_error) {
      // ignore malformed frames
    }
  });
  socket.addEventListener("close", () => {
    state.worldSocketKey = "";
    state.livePresence.clear();
    reconcilePrivatePresenceScene();
    renderPrivateChat();
    updatePrivateBrowserPanel();
    renderPrivateLiveSharesList();
  });
}

function disconnectWorldSocket() {
  if (state.worldSocket) {
    state.worldSocket.close();
    state.worldSocket = null;
  }
  state.worldSocketKey = "";
  renderPrivateChat();
  updatePrivateBrowserPanel();
}

async function openWorld(worldId, creatorUsername, includeContent = true) {
  const previousWorldKey = state.selectedWorld ? `${state.selectedWorld.world_id}:${state.selectedWorld.creator.username}` : "";
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(worldId)}`, {
    search: {
      creatorUsername,
      includeContent: includeContent ? "true" : "false",
      guestSessionId: state.session ? undefined : getGuestSessionId(),
    },
  });
  const nextWorldKey = payload.world ? `${payload.world.world_id}:${payload.world.creator.username}` : "";
  state.selectedWorld = payload.world;
  state.selectedSceneId = payload.world?.active_instance?.active_scene_id || payload.world?.scenes?.[0]?.id || "";
  state.selectedPrefabId = payload.world?.prefabs?.[0]?.id || "";
  state.builderSelection = null;
  state.launcherOpen = false;
  state.sceneDrawerOpen = false;
  state.worldMenuOpen = false;
  if (!previousWorldKey || previousWorldKey !== nextWorldKey) {
    state.privateChatEntries = [];
    state.activeChats.clear();
    state.livePresence.clear();
    reconcilePrivatePresenceScene();
    resetViewerRig(payload.world);
    resetPrivateBrowserState({ disconnectController: true, stopTracks: true });
  }
  syncRuntimeFromWorld(payload.world);
  renderSelectedWorld();
  connectWorldSocket();
}

async function saveProfile(event) {
  event.preventDefault();
  const formData = new FormData(elements.profileForm);
  const payload = await apiFetch("/private/profile", {
    method: "PATCH",
    body: {
      username: formData.get("username"),
      displayName: formData.get("displayName"),
    },
  });
  state.profile = payload.profile;
  renderProfile();
  await loadWorlds();
  setStatus("Profile saved.");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.authForm);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const submitter = event.submitter?.getAttribute?.("data-auth-action") || "signin";
  try {
    if (submitter === "signin") {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }
      setStatus("Signed in.");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function signUp() {
  const formData = new FormData(elements.authForm);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const { error } = await state.supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
  setStatus("Account created. If your project requires email confirmation, confirm it before signing in.");
}

async function signOut() {
  const { error } = await state.supabase.auth.signOut();
  if (error) {
    throw error;
  }
  setStatus("Signed out.");
}

async function handleCreateWorld(event) {
  event.preventDefault();
  if (!state.session) {
    setLauncherTab("access");
    setStatus("Sign in first.");
    return;
  }
  const formData = new FormData(elements.createWorldForm);
  const payload = await apiFetch("/private/worlds", {
    method: "POST",
    body: {
      name: formData.get("name"),
      about: formData.get("about"),
      worldType: formData.get("worldType"),
      templateSize: formData.get("templateSize"),
      width: formData.get("width") || undefined,
      length: formData.get("length") || undefined,
      height: formData.get("height") || undefined,
    },
  });
  pushEvent("world:created", `${payload.world.name} created`);
  await loadWorlds();
  state.mode = "build";
  await openWorld(payload.world.world_id, payload.world.creator.username, true);
  try {
    await joinWorld();
  } catch (error) {
    setStatus(error.message);
  }
  elements.createWorldForm.reset();
}

async function saveScene(event) {
  event.preventDefault();
  const scene = getSelectedScene();
  if (!scene || !state.selectedWorld) {
    return;
  }
  const sceneDoc = parseSceneTextarea();
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/scenes/${encodeURIComponent(scene.id)}`, {
    method: "PATCH",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      name: elements.sceneForm.elements.name.value,
      isDefault: elements.sceneForm.elements.isDefault.checked,
      sceneDoc,
    },
  });
  pushEvent("scene:saved", payload.scene.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function exportWorld() {
  if (!state.selectedWorld) {
    return;
  }
  const response = await fetch(mauworldApiUrl(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/export`, {
    creatorUsername: state.selectedWorld.creator.username,
  }), {
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Export failed (${response.status})`);
  }
  const blob = new Blob([JSON.stringify(payload.package, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.selectedWorld.world_id}.mauworld.json`;
  link.click();
  URL.revokeObjectURL(url);
  pushEvent("world:exported", state.selectedWorld.world_id);
}

async function forkSelectedWorld() {
  if (!state.selectedWorld || !state.session) {
    throw new Error("Sign in to fork this world.");
  }
  const response = await fetch(mauworldApiUrl(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/export`, {
    creatorUsername: state.selectedWorld.creator.username,
  }), {
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Fork export failed (${response.status})`);
  }
  const imported = await apiFetch("/private/worlds/import", {
    method: "POST",
    body: payload.package,
  });
  pushEvent("world:forked", `${imported.world.world_id} from ${state.selectedWorld.world_id}`);
  state.mode = "build";
  await loadWorlds();
  await openWorld(imported.world.world_id, imported.world.creator.username, true);
  try {
    await joinWorld();
  } catch (error) {
    setStatus(error.message);
  }
}

async function importPackage(event) {
  event.preventDefault();
  if (!state.session) {
    setStatus("Sign in to import a world package.");
    return;
  }
  const file = elements.importForm.elements.packageFile.files?.[0];
  if (!file) {
    return;
  }
  const content = JSON.parse(await file.text());
  const payload = await apiFetch("/private/worlds/import", {
    method: "POST",
    body: content,
  });
  pushEvent("world:imported", payload.world.world_id);
  await loadWorlds();
  await openWorld(payload.world.world_id, payload.world.creator.username, true);
  elements.importForm.reset();
}

async function resolveWorld(event) {
  event.preventDefault();
  const formData = new FormData(elements.resolveForm);
  const worldId = String(formData.get("worldId") ?? "").trim();
  const creatorUsername = String(formData.get("creatorUsername") ?? "").trim();
  await openWorld(worldId, creatorUsername, true);
}

async function joinWorld() {
  if (!state.selectedWorld) {
    return;
  }
  const anchor = getJoinAnchorPayload();
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/join`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      guestSessionId: state.session ? undefined : getGuestSessionId(),
      displayName: getPrivateDisplayName(),
      joinRole: state.session ? "viewer" : "guest",
      publicWorldSnapshotId: anchor.publicWorldSnapshotId,
      position_x: anchor.position_x,
      position_y: anchor.position_y,
      position_z: anchor.position_z,
    },
  });
  state.joined = true;
  state.joinedAsGuest = !state.session;
  state.selectedWorld = payload.world;
  renderSelectedWorld();
  pushEvent("world:joined", `${payload.world.name}`);
}

async function occupyPlayer(playerEntityId) {
  if (!state.selectedWorld || !state.session) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/participants/occupy`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      playerEntityId,
    },
  });
  pushEvent("player:occupied", playerEntityId);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function releasePlayer() {
  if (!state.selectedWorld || !state.session) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/participants/release`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
    },
  });
  state.pressedRuntimeKeys.clear();
  pushEvent("player:released", state.selectedWorld.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function leaveWorld() {
  if (!state.selectedWorld) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/leave`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      guestSessionId: state.joinedAsGuest ? getGuestSessionId() : undefined,
    },
  });
  state.joined = false;
  state.joinedAsGuest = false;
  state.activeChats.clear();
  state.livePresence.clear();
  reconcilePrivatePresenceScene();
  state.pressedRuntimeKeys.clear();
  privateInputState.keys.clear();
  privateInputState.sprintHoldSeconds = 0;
  privateInputState.pointerDown = false;
  privateInputState.pointerMoved = false;
  privateInputState.dragDistance = 0;
  state.viewerSuppressClickAt = 0;
  pushEvent("world:left", state.selectedWorld.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function setReady() {
  if (!state.selectedWorld) {
    return;
  }
  const localParticipant = getLocalParticipant(state.selectedWorld);
  const nextReady = !(localParticipant?.ready === true);
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/ready`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      ready: nextReady,
    },
  });
  pushEvent("ready:updated", nextReady ? "Ready" : "Not ready");
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function startScene() {
  if (!state.selectedWorld) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/start-scene`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
    },
  });
  pushEvent("scene:started", state.selectedWorld.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function resetScene() {
  if (!state.selectedWorld) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/reset-scene`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
    },
  });
  pushEvent("scene:reset", state.selectedWorld.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

async function sendRuntimeInput(key, runtimeState = "down") {
  if (!state.selectedWorld || !state.session || getLocalParticipant()?.join_role !== "player") {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/input`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      key,
      state: runtimeState,
    },
  });
}

async function addCollaborator(event) {
  event.preventDefault();
  if (!state.selectedWorld) {
    return;
  }
  const formData = new FormData(elements.collaboratorForm);
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/collaborators`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      username: formData.get("username"),
      role: formData.get("role"),
    },
  });
  elements.collaboratorForm.reset();
  pushEvent("collaborator:updated", "Collaborator saved");
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
}

function mutateSceneDoc(mutator) {
  const sceneDoc = parseSceneTextarea();
  mutator(sceneDoc);
  if (elements.sceneForm?.elements.scriptDsl) {
    sceneDoc.script_dsl = String(elements.sceneForm.elements.scriptDsl.value || sceneDoc.script_dsl || "").trim();
  }
  elements.sceneForm.elements.sceneDoc.value = JSON.stringify(sceneDoc, null, 2);
  renderSceneBuilder();
  updatePreviewFromSelection();
}

function updateSelectedEntityField(path, rawValue, valueType = "text") {
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntity(sceneDoc);
    if (!selected) {
      return;
    }
    let value = rawValue;
    if (valueType === "number") {
      const currentValue = Number(path.split(".").reduce((cursor, key) => cursor?.[key], selected.entry) ?? 0) || 0;
      value = clampNumber(rawValue, currentValue, -4096, 4096);
    } else if (valueType === "checkbox") {
      value = rawValue === true;
    } else if (valueType === "color") {
      value = /^#[0-9a-f]{6}$/i.test(String(rawValue ?? "")) ? String(rawValue).toLowerCase() : "#c8d0d8";
    } else {
      value = String(rawValue ?? "");
    }
    setByPath(selected.entry, path, value);
    if (valueType === "text" && String(value).trim() === "") {
      if (path === "group_id" || path === "particle_effect" || path === "trail_effect" || path === "prefab_id" || path === "target_id") {
        setByPath(selected.entry, path, null);
      }
      if (path === "overrides.material.texture_preset") {
        setByPath(selected.entry, path, "none");
      }
    }
  });
}

function removeSelectedEntity() {
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntity(sceneDoc);
    if (!selected) {
      return;
    }
    sceneDoc[selected.key].splice(selected.index, 1);
    state.builderSelection = null;
  });
}

function buildPrefabDocFromSelection(selection) {
  const localEntry = deepClone(selection.entry);
  const anchorPosition = deepClone(localEntry.position ?? { x: 0, y: 0, z: 0 });
  const anchorRotation = deepClone(localEntry.rotation ?? { x: 0, y: 0, z: 0 });
  if (localEntry.position) {
    localEntry.position = { x: 0, y: 0, z: 0 };
  }
  if (localEntry.rotation) {
    localEntry.rotation = { x: 0, y: 0, z: 0 };
  }
  const key = selection.key;
  return {
    anchorPosition,
    anchorRotation,
    prefabDoc: {
      settings: {
        gravity: { x: 0, y: -9.8, z: 0 },
        camera_mode: "third_person",
        start_on_ready: true,
      },
      voxels: key === "voxels" ? [localEntry] : [],
      primitives: key === "primitives" ? [localEntry] : [],
      screens: key === "screens" ? [localEntry] : [],
      players: key === "players" ? [localEntry] : [],
      texts: key === "texts" ? [localEntry] : [],
      trigger_zones: key === "trigger_zones" ? [localEntry] : [],
      prefabs: [],
      prefab_instances: [],
      particles: key === "particles" ? [localEntry] : [],
      rules: [],
      script_dsl: "",
    },
  };
}

async function convertSelectionToPrefab() {
  if (!state.selectedWorld || !isEditor()) {
    return;
  }
  const sceneDoc = parseSceneTextarea();
  const selected = getSelectedEntity(sceneDoc);
  if (!selected || selected.kind === "particle" || selected.kind === "prefab_instance") {
    return;
  }
  const prefabBaseName = getDisplayNameForEntity(selected.kind, selected.entry);
  const { anchorPosition, anchorRotation, prefabDoc } = buildPrefabDocFromSelection(selected);
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/prefabs`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      name: `${prefabBaseName} Prefab`,
      prefabDoc,
    },
  });
  state.selectedWorld.prefabs = [...(state.selectedWorld.prefabs ?? []), payload.prefab];
  state.selectedPrefabId = payload.prefab.id;
  mutateSceneDoc((nextSceneDoc) => {
    const latestSelection = getSelectedEntity(nextSceneDoc);
    if (!latestSelection) {
      return;
    }
    nextSceneDoc[latestSelection.key].splice(latestSelection.index, 1);
    nextSceneDoc.prefab_instances = nextSceneDoc.prefab_instances || [];
    nextSceneDoc.prefab_instances.push({
      id: `prefabinst_${slugToken(payload.prefab.name)}_${nextSceneDoc.prefab_instances.length + 1}`,
      prefab_id: payload.prefab.id,
      label: prefabBaseName,
      position: anchorPosition,
      rotation: anchorRotation,
      scale: { x: 1, y: 1, z: 1 },
      overrides: {
        material: null,
        visible: true,
      },
    });
    state.builderSelection = {
      kind: "prefab_instance",
      id: nextSceneDoc.prefab_instances[nextSceneDoc.prefab_instances.length - 1].id,
    };
  });
  pushEvent("prefab:created", payload.prefab.name);
}

async function renamePrefab(prefabId, name) {
  if (!state.selectedWorld || !isEditor()) {
    return;
  }
  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) {
    return;
  }
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/prefabs/${encodeURIComponent(prefabId)}`, {
    method: "PATCH",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      name: trimmedName,
      prefabDoc: (state.selectedWorld.prefabs ?? []).find((entry) => entry.id === prefabId)?.prefab_doc ?? {},
    },
  });
  state.selectedWorld.prefabs = (state.selectedWorld.prefabs ?? []).map((entry) => entry.id === prefabId ? payload.prefab : entry);
  renderSceneBuilder();
  pushEvent("prefab:renamed", payload.prefab.name);
}

async function deletePrefab(prefabId) {
  if (!state.selectedWorld || !isEditor()) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/prefabs/${encodeURIComponent(prefabId)}`, {
    method: "DELETE",
    search: {
      creatorUsername: state.selectedWorld.creator.username,
    },
  });
  state.selectedWorld.prefabs = (state.selectedWorld.prefabs ?? []).filter((entry) => entry.id !== prefabId);
  if (state.selectedPrefabId === prefabId) {
    state.selectedPrefabId = "";
  }
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.prefab_instances = (sceneDoc.prefab_instances ?? []).filter((entry) => entry.prefab_id !== prefabId);
    if (state.builderSelection?.kind === "prefab_instance" && !sceneDoc.prefab_instances.some((entry) => entry.id === state.builderSelection.id)) {
      state.builderSelection = null;
    }
  });
  pushEvent("prefab:removed", prefabId);
}

function placeSelectedPrefab(prefabId = state.selectedPrefabId) {
  if (!prefabId) {
    return;
  }
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.prefab_instances = sceneDoc.prefab_instances || [];
    const instanceId = `prefabinst_${slugToken(prefabId)}_${sceneDoc.prefab_instances.length + 1}`;
    sceneDoc.prefab_instances.push({
      id: instanceId,
      prefab_id: prefabId,
      label: `Instance ${sceneDoc.prefab_instances.length + 1}`,
      position: { x: sceneDoc.prefab_instances.length * 2.5, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      overrides: {
        material: null,
        visible: true,
      },
    });
    state.builderSelection = {
      kind: "prefab_instance",
      id: instanceId,
    };
  });
  pushEvent("prefab:instanced", prefabId);
}

async function removeCollaborator(username) {
  if (!state.selectedWorld || !username) {
    return;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/collaborators/${encodeURIComponent(username)}`, {
    method: "DELETE",
    search: {
      creatorUsername: state.selectedWorld.creator.username,
    },
  });
  state.selectedWorld.collaborators = (state.selectedWorld.collaborators ?? []).filter((entry) => entry.profile?.username !== username);
  renderCollaborators();
  pushEvent("collaborator:removed", username);
}

function attachQuickAddButtons() {
  elements.addVoxel.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.voxels = sceneDoc.voxels || [];
      const nextId = `voxel_${sceneDoc.voxels.length + 1}`;
      sceneDoc.voxels.push({
        id: nextId,
        position: { x: sceneDoc.voxels.length * 1.25, y: 0.5, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        material: { color: "#85b84f", texture_preset: "grass" },
      });
      state.builderSelection = { kind: "voxel", id: nextId };
    });
  });

  elements.addPrimitive.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.primitives = sceneDoc.primitives || [];
      const nextId = `primitive_${sceneDoc.primitives.length + 1}`;
      sceneDoc.primitives.push({
        id: nextId,
        shape: "box",
        position: { x: sceneDoc.primitives.length * 1.8, y: 1, z: -2 },
        scale: { x: 1.5, y: 1.5, z: 1.5 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#d3d8e2", texture_preset: "stone" },
        physics: { gravity_scale: 1, restitution: 0.2, friction: 0.7, mass: 1 },
      });
      state.builderSelection = { kind: "primitive", id: nextId };
    });
  });

  elements.addPlayer.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.players = sceneDoc.players || [];
      const nextId = `player_${sceneDoc.players.length + 1}`;
      sceneDoc.players.push({
        id: nextId,
        label: `Player ${sceneDoc.players.length + 1}`,
        position: { x: 0, y: 1, z: sceneDoc.players.length * 2.4 },
        camera_mode: "third_person",
        body_mode: "rigid",
      });
      state.builderSelection = { kind: "player", id: nextId };
    });
  });

  elements.addScreen.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.screens = sceneDoc.screens || [];
      const nextId = `screen_${sceneDoc.screens.length + 1}`;
      sceneDoc.screens.push({
        id: nextId,
        position: { x: 0, y: 2.6, z: -4 - sceneDoc.screens.length },
        scale: { x: 4, y: 2.25, z: 0.2 },
        material: { color: "#ffffff", texture_preset: "none" },
        html: "<div style=\"padding:24px\"><h1>Hello world</h1><p>Static world screen.</p></div>",
      });
      state.builderSelection = { kind: "screen", id: nextId };
    });
  });

  elements.addText.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.texts = sceneDoc.texts || [];
      const nextId = `text_${sceneDoc.texts.length + 1}`;
      sceneDoc.texts.push({
        id: nextId,
        value: "Welcome",
        position: { x: 0, y: 3, z: 2 + sceneDoc.texts.length },
        scale: 1,
        material: { color: "#ffffff", texture_preset: "none" },
      });
      state.builderSelection = { kind: "text", id: nextId };
    });
  });

  elements.addTrigger.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.trigger_zones = sceneDoc.trigger_zones || [];
      const nextId = `trigger_${sceneDoc.trigger_zones.length + 1}`;
      sceneDoc.trigger_zones.push({
        id: nextId,
        label: "Start Zone",
        position: { x: 0, y: 0.5, z: 6 + sceneDoc.trigger_zones.length },
        scale: { x: 2, y: 2, z: 2 },
      });
      state.builderSelection = { kind: "trigger", id: nextId };
    });
  });

  elements.addParticle.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.particles = sceneDoc.particles || [];
      const targetId = sceneDoc.primitives?.[0]?.id || sceneDoc.players?.[0]?.id || sceneDoc.voxels?.[0]?.id || "";
      const nextId = `particle_${sceneDoc.particles.length + 1}`;
      sceneDoc.particles.push({
        id: nextId,
        effect: "sparkles",
        target_id: targetId,
        enabled: true,
        color: "#ff5a7a",
      });
      state.builderSelection = { kind: "particle", id: nextId };
    });
  });

  elements.addRule.addEventListener("click", () => {
    setSceneDrawerOpen(true);
    window.setTimeout(() => {
      elements.sceneForm?.elements?.scriptDsl?.focus?.();
    }, 0);
  });
}

async function generateAi(kind) {
  if (!state.selectedWorld) {
    return;
  }
  const formData = new FormData(elements.aiForm);
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  setAiKey(apiKey);
  const path = kind === "html" ? "/private/worlds/ai/screen-html" : "/private/worlds/ai/script";
  const payload = await apiFetch(path, {
    method: "POST",
    body: {
      provider: formData.get("provider"),
      model: formData.get("model"),
      apiKey,
      worldName: state.selectedWorld.name,
      worldAbout: state.selectedWorld.about,
      objective: formData.get("objective"),
      sceneSummary: JSON.stringify(getSelectedScene()?.compiled_doc?.stats ?? {}),
    },
  });
  elements.aiOutput.value = payload.text || "";
  pushEvent("ai:generated", kind === "html" ? "Generated screen HTML" : "Generated script");
}

async function acquireSceneLock() {
  if (!isEditor() || !state.selectedWorld || !getSelectedScene()) {
    return;
  }
  const entityKey = `scene-json:${getSelectedScene().id}`;
  if (state.activeLockEntityKey === entityKey) {
    return;
  }
  try {
    await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/locks/acquire`, {
      method: "POST",
      body: {
        creatorUsername: state.selectedWorld.creator.username,
        sceneId: getSelectedScene().id,
        entityKey,
      },
    });
    state.activeLockEntityKey = entityKey;
    if (state.lockHeartbeatTimer) {
      window.clearInterval(state.lockHeartbeatTimer);
    }
    state.lockHeartbeatTimer = window.setInterval(() => {
      if (!state.activeLockEntityKey || !state.selectedWorld || !getSelectedScene()) {
        return;
      }
      void apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/locks/heartbeat`, {
        method: "POST",
        body: {
          creatorUsername: state.selectedWorld.creator.username,
          sceneId: getSelectedScene().id,
          entityKey: state.activeLockEntityKey,
        },
      }).catch(() => {
        // best-effort
      });
    }, 15000);
    pushEvent("lock:acquired", entityKey);
  } catch (error) {
    pushEvent("lock:error", error.message);
  }
}

async function releaseSceneLock() {
  if (!state.activeLockEntityKey || !state.selectedWorld || !getSelectedScene()) {
    return;
  }
  try {
    await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/locks/release`, {
      method: "POST",
      body: {
        creatorUsername: state.selectedWorld.creator.username,
        sceneId: getSelectedScene().id,
        entityKey: state.activeLockEntityKey,
      },
    });
  } catch (_error) {
    // ignore
  }
  if (state.lockHeartbeatTimer) {
    window.clearInterval(state.lockHeartbeatTimer);
    state.lockHeartbeatTimer = 0;
  }
  state.activeLockEntityKey = "";
}

function renderEventLog() {
  const markup = state.eventLog.map((entry) => `
    <article class="pw-event-log__item">
      <strong>${htmlEscape(entry.title)}</strong>
      <div>${htmlEscape(entry.body || "")}</div>
      <small>${htmlEscape(entry.createdAt)}</small>
    </article>
  `).join("") || '<article class="pw-event-log__item">No live events yet.</article>';
  if (elements.eventLog) {
    elements.eventLog.innerHTML = markup;
  }
  if (elements.panelEvents) {
    elements.panelEvents.innerHTML = markup;
  }
}

function bindEvents() {
  elements.launcherToggle?.addEventListener("click", () => {
    if (!state.launcherOpen) {
      setLauncherTab(state.selectedWorld ? "worlds" : getPreferredLauncherTab());
    }
    setLauncherOpen(!state.launcherOpen);
  });
  elements.launcherClose?.addEventListener("click", () => {
    setLauncherOpen(false);
  });
  for (const button of elements.launcherTabButtons ?? []) {
    button.addEventListener("click", () => {
      setLauncherTab(button.getAttribute("data-launcher-tab") || getPreferredLauncherTab());
    });
  }
  for (const button of elements.privatePanelTabButtons ?? []) {
    button.addEventListener("click", () => {
      setPrivatePanelTab(button.getAttribute("data-private-panel-tab") || "build");
    });
  }
  elements.panelOpenAccess?.addEventListener("click", () => {
    setLauncherTab("access");
    setLauncherOpen(true);
  });
  elements.panelChatComposer?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!sendPrivateChat(elements.panelChatInput?.value || "")) {
      renderPrivateChat();
    }
  });
  elements.panelChatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      elements.panelChatInput?.blur();
    }
  });
  for (const button of elements.panelChatReactionButtons ?? []) {
    button.addEventListener("click", () => {
      if (!sendPrivateChat(button.getAttribute("data-private-chat-reaction") || button.textContent || "")) {
        renderPrivateChat();
      }
    });
  }
  elements.panelLiveSearchInput?.addEventListener("input", () => {
    state.liveShareQuery = String(elements.panelLiveSearchInput?.value ?? "");
    renderPrivateLiveSharesList();
  });
  elements.panelLiveSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.liveShareQuery = String(elements.panelLiveSearchInput?.value ?? "");
    renderPrivateLiveSharesList();
  });
  elements.panelShareCopy?.addEventListener("click", async () => {
    const shareUrl = buildPrivateWorldEntryUrl();
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (elements.panelShareStatus) {
        elements.panelShareStatus.textContent = "Entry link copied.";
      }
    } catch (error) {
      setStatus(error.message || "Could not copy entry link");
    }
  });
  elements.panelShareNative?.addEventListener("click", async () => {
    const shareUrl = buildPrivateWorldEntryUrl();
    if (!shareUrl || !navigator.share) {
      return;
    }
    try {
      await navigator.share({
        title: state.selectedWorld?.name || "Mauworld Private World",
        text: state.selectedWorld?.about || "Join this private Mauworld scene.",
        url: shareUrl,
      });
    } catch (_error) {
      // user canceled native share
    }
  });
  elements.panelBrowserExpand?.addEventListener("click", () => {
    setPrivateBrowserOverlayOpen(!state.browserOverlayOpen);
  });
  elements.panelBrowserBackdrop?.addEventListener("click", () => {
    setPrivateBrowserOverlayOpen(false);
  });
  elements.panelBrowserShareTitle?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void launchPrivateShare();
  });
  for (const button of elements.panelBrowserShareModes ?? []) {
    button.addEventListener("click", () => {
      setSelectedPrivateBrowserShareMode(button.getAttribute("data-private-browser-share-mode") || "screen");
      updatePrivateBrowserPanel();
    });
  }
  elements.panelBrowserLaunch?.addEventListener("click", () => {
    void launchPrivateShare();
  });
  elements.panelBrowserStop?.addEventListener("click", () => {
    const sessionId = getLocalPrivateBrowserSession()?.sessionId || "";
    if (!sessionId) {
      return;
    }
    sendWorldSocketMessage({
      type: "browser:stop",
      sessionId,
    });
  });
  elements.panelBrowserResume?.addEventListener("click", () => {
    void getPrivateBrowserMediaController().resumePlayback({
      sessionId: state.browserPanelRemoteSessionId || state.browserMediaState.remoteAudioSessionId,
      kinds: ["audio", "video"],
    });
  });
  elements.panelModeBuild?.addEventListener("click", () => {
    setMode("build");
    renderSelectedWorld();
  });
  elements.panelModePlay?.addEventListener("click", () => {
    setMode("play");
    renderSelectedWorld();
  });
  elements.panelScenes?.addEventListener("click", () => {
    if (state.selectedWorld && isEditor()) {
      setSceneDrawerOpen(true);
      setPrivatePanelTab("build");
    }
  });
  elements.panelWorld?.addEventListener("click", () => {
    if (state.selectedWorld) {
      setWorldMenuOpen(true);
      setPrivatePanelTab("world");
    }
  });
  elements.panelExport?.addEventListener("click", () => {
    void exportWorld();
  });
  elements.panelEnter?.addEventListener("click", () => {
    void joinWorld();
  });
  elements.panelLeave?.addEventListener("click", () => {
    void leaveWorld();
  });
  elements.panelReady?.addEventListener("click", () => {
    void setReady();
  });
  elements.panelStart?.addEventListener("click", () => {
    void startScene();
  });
  elements.panelRelease?.addEventListener("click", () => {
    void releasePlayer();
  });
  elements.panelReset?.addEventListener("click", () => {
    void resetScene();
  });
  elements.sceneToolsToggle?.addEventListener("click", () => {
    if (!state.selectedWorld) {
      return;
    }
    setSceneDrawerOpen(!state.sceneDrawerOpen);
  });
  elements.sceneToolsClose?.addEventListener("click", () => {
    setSceneDrawerOpen(false);
  });
  elements.worldMenuToggle?.addEventListener("click", () => {
    if (!state.selectedWorld) {
      return;
    }
    setWorldMenuOpen(!state.worldMenuOpen);
  });
  elements.worldMenuClose?.addEventListener("click", () => {
    setWorldMenuOpen(false);
  });
  elements.selectionClear?.addEventListener("click", () => {
    setBuilderSelection("", "");
  });
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.authForm.querySelector('[data-auth-action="signup"]').addEventListener("click", async () => {
    try {
      await signUp();
    } catch (error) {
      setStatus(error.message);
    }
  });
  elements.authForm.querySelector('[data-auth-action="signout"]').addEventListener("click", async () => {
    try {
      await signOut();
    } catch (error) {
      setStatus(error.message);
    }
  });
  elements.profileForm.addEventListener("submit", saveProfile);
  elements.createWorldForm.addEventListener("submit", handleCreateWorld);
  elements.refreshPublicWorlds.addEventListener("click", () => {
    void loadPublicWorlds();
  });
  elements.publicWorldSearch.addEventListener("input", () => {
    void loadPublicWorlds();
  });
  elements.publicWorldType.addEventListener("change", () => {
    void loadPublicWorlds();
  });
  elements.publicWorldList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-world-card]");
    if (!card) {
      return;
    }
    void openWorld(card.getAttribute("data-world-card"), card.getAttribute("data-world-creator"), true).catch((error) => {
      setStatus(error.message);
    });
  });
  elements.refreshWorlds.addEventListener("click", () => {
    void loadWorlds();
  });
  elements.worldSearch.addEventListener("input", () => {
    void loadWorlds();
  });
  elements.worldList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-world-card]");
    if (!card) {
      return;
    }
    void openWorld(card.getAttribute("data-world-card"), card.getAttribute("data-world-creator"), true).catch((error) => {
      setStatus(error.message);
    });
  });
  elements.importForm.addEventListener("submit", importPackage);
  elements.resolveForm.addEventListener("submit", resolveWorld);
  elements.sceneStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-id]");
    if (!button) {
      return;
    }
    state.selectedSceneId = button.getAttribute("data-scene-id");
    setSceneDrawerOpen(false);
    renderSelectedWorld();
  });
  elements.sceneForm.addEventListener("submit", saveScene);
  elements.refreshScene.addEventListener("click", () => {
    renderSceneEditor();
    updatePreviewFromSelection();
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("input", updatePreviewFromSelection);
  elements.sceneForm.elements.scriptDsl.addEventListener("input", () => {
    void acquireSceneLock();
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.script_dsl = String(elements.sceneForm.elements.scriptDsl.value || "").trim();
    });
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("focus", () => {
    void acquireSceneLock();
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("blur", () => {
    void releaseSceneLock();
  });
  elements.entitySections.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-kind][data-select-id]");
    if (!button) {
      return;
    }
    setBuilderSelection(button.getAttribute("data-select-kind"), button.getAttribute("data-select-id"));
  });
  elements.entityEditor.addEventListener("input", (event) => {
    const field = event.target.closest("[data-entity-field]");
    if (!field) {
      return;
    }
    updateSelectedEntityField(
      field.getAttribute("data-entity-field"),
      field.type === "checkbox" ? field.checked : field.value,
      field.getAttribute("data-value-type") || "text",
    );
  });
  elements.entityEditor.addEventListener("change", (event) => {
    const field = event.target.closest("[data-entity-field]");
    if (!field) {
      return;
    }
    updateSelectedEntityField(
      field.getAttribute("data-entity-field"),
      field.type === "checkbox" ? field.checked : field.value,
      field.getAttribute("data-value-type") || "text",
    );
  });
  elements.removeEntity.addEventListener("click", () => {
    removeSelectedEntity();
  });
  elements.convertPrefab.addEventListener("click", () => {
    void convertSelectionToPrefab().catch((error) => {
      setStatus(error.message);
    });
  });
  elements.placePrefab.addEventListener("click", () => {
    placeSelectedPrefab();
  });
  elements.prefabList.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-select-prefab]");
    if (selectButton) {
      state.selectedPrefabId = selectButton.getAttribute("data-select-prefab");
      renderSceneBuilder();
      return;
    }
    const placeButton = event.target.closest("[data-place-prefab-id]");
    if (placeButton) {
      state.selectedPrefabId = placeButton.getAttribute("data-place-prefab-id");
      placeSelectedPrefab(state.selectedPrefabId);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-prefab]");
    if (deleteButton) {
      void deletePrefab(deleteButton.getAttribute("data-delete-prefab")).catch((error) => {
        setStatus(error.message);
      });
    }
  });
  elements.prefabList.addEventListener("change", (event) => {
    const input = event.target.closest("[data-prefab-name]");
    if (!input) {
      return;
    }
    void renamePrefab(input.getAttribute("data-prefab-name"), input.value).catch((error) => {
      setStatus(error.message);
    });
  });
  elements.readyToggle.addEventListener("click", () => {
    void setReady();
  });
  elements.startScene.addEventListener("click", () => {
    void startScene();
  });
  elements.releasePlayer.addEventListener("click", () => {
    void releasePlayer();
  });
  elements.resetScene.addEventListener("click", () => {
    void resetScene();
  });
  elements.collaboratorForm.addEventListener("submit", addCollaborator);
  elements.collaboratorList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-collaborator]");
    if (!button) {
      return;
    }
    void removeCollaborator(button.getAttribute("data-remove-collaborator")).catch((error) => {
      setStatus(error.message);
    });
  });
  elements.aiForm.elements.apiKey.value = getAiKey();
  elements.aiForm.elements.apiKey.addEventListener("input", (event) => {
    setAiKey(event.target.value);
  });
  elements.generateHtml.addEventListener("click", () => {
    void generateAi("html");
  });
  elements.generateScript.addEventListener("click", () => {
    void generateAi("script");
  });
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    const key = normalizeRuntimeKey(event);
    if (!RUNTIME_INPUT_KEYS.has(key)) {
      return;
    }
    event.preventDefault();
    if (getLocalParticipant()?.join_role === "player") {
      if (state.pressedRuntimeKeys.has(key)) {
        return;
      }
      state.pressedRuntimeKeys.add(key);
      void sendRuntimeInput(key, "down");
      return;
    }
    privateInputState.keys.add(key);
  });
  window.addEventListener("keyup", (event) => {
    const key = normalizeRuntimeKey(event);
    if (!RUNTIME_INPUT_KEYS.has(key)) {
      return;
    }
    event.preventDefault();
    if (getLocalParticipant()?.join_role === "player") {
      state.pressedRuntimeKeys.delete(key);
      void sendRuntimeInput(key, "up");
      return;
    }
    privateInputState.keys.delete(key);
  });
  window.addEventListener("blur", () => {
    const keys = [...state.pressedRuntimeKeys];
    state.pressedRuntimeKeys.clear();
    privateInputState.keys.clear();
    privateInputState.sprintHoldSeconds = 0;
    privateInputState.pointerDown = false;
    privateInputState.pointerMoved = false;
    privateInputState.dragDistance = 0;
    state.viewerSuppressClickAt = 0;
    for (const key of keys) {
      void sendRuntimeInput(key, "up");
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    if (state.browserOverlayOpen) {
      setPrivateBrowserOverlayOpen(false);
      return;
    }
    if (state.builderSelection) {
      setBuilderSelection("", "");
      return;
    }
    if (state.worldMenuOpen) {
      setWorldMenuOpen(false);
      return;
    }
    if (state.sceneDrawerOpen) {
      setSceneDrawerOpen(false);
      return;
    }
    if (state.launcherOpen) {
      setLauncherOpen(false);
    }
  });
  attachQuickAddButtons();
}

async function handleLaunchRequest() {
  if (state.launchHandled) {
    return;
  }
  const launch = getLaunchRequest();
  if (!launch.worldId || !launch.creatorUsername) {
    return;
  }
  state.launchHandled = true;
  await openWorld(launch.worldId, launch.creatorUsername, true);
  if (launch.fork) {
    try {
      await forkSelectedWorld();
      return;
    } catch (error) {
      setStatus(error.message);
      if (!state.session) {
        setLauncherOpen(true);
      }
      pushEvent("launcher:fork:error", error.message);
    }
  }
  if (launch.autojoin) {
    try {
      await joinWorld();
      pushEvent("launcher", "Joined from public world");
    } catch (error) {
      setStatus(error.message);
      pushEvent("launcher:error", error.message);
    }
  }
}

async function init() {
  bindEvents();
  renderEventLog();
  renderPrivateChat();
  renderPrivateShare();
  updatePrivateBrowserPanel();
  renderBuildSummary();
  renderSessionSummary();
  ensurePreview();
  setLauncherTab(getPreferredLauncherTab());
  setMode(state.mode);
  setSelectedPrivateBrowserShareMode(state.browserShareMode);
  updateShellState();
  await fetchAuthConfig();
  await refreshAuthState();
  await handleLaunchRequest();
}

void init().catch((error) => {
  setStatus(error.message || "Could not initialize private worlds page");
  pushEvent("init:error", error.message || "Unknown initialization failure");
});
