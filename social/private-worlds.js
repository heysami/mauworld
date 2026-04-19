import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { createPatternedMaterial } from "./private-world-materials.js";
import { renderScreenHtmlTexture } from "./screen-texture.js";
import { createBrowserMediaController } from "./world-browser-media.js?v=20260418b";
import {
  createChatBubbleState,
  createChatBubbleRenderer,
  createChatFeature,
  createLocalDisplayShare,
  createNearbyDisplayShareFeature,
  launchNearbyDisplayShare,
  getBrowserShareKindLabel,
  getDisplayShareStageLayout,
  getDisplayShareStagePlaceholderText,
  getDisplayShareLaunchState,
  getDisplayShareReadyPresentation,
  getLocalDisplaySharePresentation,
  isLocalDisplayShareActive,
  isEmojiOnlyChatText as sharedIsEmojiOnlyChatText,
  normalizeBrowserShareKind,
  normalizeHostedBrowserSession,
  sanitizeBrowserShareTitle,
  setDisplayShareOverlayState,
  syncDisplayShareActionButtons,
  syncDisplayShareExpandButton,
  syncWorldPanelTabLabels,
  updateChatBubbleGhosts,
} from "./world-interactions.js?v=20260418h";
import {
  SHARED_BROWSER_SHARE_LAYOUT,
  SHARED_CHAT_BUBBLE_LAYOUT,
  getSharedBrowserScreenOffsetY,
} from "./world-overhead-layout.js";
import {
  buildPrivateWorldBrowserResultsMarkup,
  getPrivateWorldBrowserKey,
} from "./private-world-browser.js";
import { createBubbleTexture, updateMascotMotion } from "./world-visitors.js";
import {
  createWorldGamesApi,
  createWorldGameLibrary,
  createWorldGameShell,
} from "./world-games-ui.js?v=20260419f";

const { mauworldApiUrl } = window.MauworldSocial;

const AI_REASONING_STORAGE_KEY = "mauworldPrivateWorldAiReasoning";
const AI_IMAGE_STORAGE_KEY = "mauworldPrivateWorldAiImage";
const AI_MODEL_STORAGE_KEY = "mauworldPrivateWorldAiModel";
const GUEST_SESSION_KEY = "mauworldPrivateWorldGuestSession";
const PRIVATE_VIEWER_INSTANCE_KEY = "mauworldPrivateWorldViewerInstance";
const TOOL_PRESET_STORAGE_KEY = "mauworldPrivateWorldToolPresets";
const TOOL_PRESET_PANEL_COLLAPSED_STORAGE_KEY = "mauworldPrivateWorldToolPresetPanelCollapsed";
const RUNTIME_INPUT_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "space", "shift"]);
const LAUNCHER_TABS = new Set(["worlds", "access"]);
const LAUNCHER_WORLD_BROWSER_TABS = new Set(["mine", "all"]);
const PRIVATE_PANEL_TABS = new Set(["chat", "share", "live", "world"]);
const SCENE_DRAWER_TABS = new Set(["scenes", "items", "assets", "prefabs", "logic"]);
const WORLD_PANEL_SECTIONS = new Set(["overview", "ai", "editors", "feed"]);
const PRIVATE_CAMERA = {
  minY: 0,
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
const PRIVATE_WORLD_BLOCK_UNIT = 5;
const PRIVATE_WORLD_DEFAULT_SIZE = {
  width: 60,
  length: 40,
  height: 30,
};
const PRIVATE_PLAYER_METRICS = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
};
const PRIVATE_PLAYER_DEFAULT_SCALE = PRIVATE_WORLD_BLOCK_UNIT;
const PRIVATE_PLAYER_CAMERA = {
  firstPersonLookDistance: 3.8,
  thirdPersonDistance: 4.8,
  thirdPersonHeight: 2.2,
  topDownHeight: 8,
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
const PRIVATE_CHAT_MAX_ENTRIES = 28;
const PRIVATE_CHAT_BUBBLE = SHARED_CHAT_BUBBLE_LAYOUT;
const PRIVATE_BROWSER_SHARE = SHARED_BROWSER_SHARE_LAYOUT;
const PRIVATE_BROWSER_RADIUS = PRIVATE_BROWSER_SHARE.radius;
const PRIVATE_LOCAL_PREVIEW_SESSION_ID = "__private_local_preview__";
const BUILD_PLACEMENT_SHORTCUTS = new Map([
  ["1", "voxel"],
  ["2", "primitive"],
  ["3", "player"],
  ["4", "screen"],
  ["5", "text"],
  ["6", "trigger"],
]);
const BUILD_TRANSFORM_SHORTCUTS = new Map([
  ["q", "move"],
  ["e", "scale"],
  ["shift", "multi"],
  ["r", "rotate"],
  ["t", "delete"],
]);
const BUILD_TRANSFORM_AXIS_SHORTCUTS = new Map([
  ["1", "x"],
  ["2", "z"],
  ["3", "y"],
]);
const TOOL_PRESET_KINDS = ["voxel", "primitive", "player", "screen", "text", "trigger"];
const AI_PROVIDER_SESSION_KEYS = {
  reasoning: AI_REASONING_STORAGE_KEY,
  image: AI_IMAGE_STORAGE_KEY,
  model: AI_MODEL_STORAGE_KEY,
};
const MATERIALIZABLE_ENTITY_KINDS = new Set(["voxel", "primitive", "panel", "model", "screen", "text"]);
const FACING_MODE_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "billboard", label: "Billboard" },
  { value: "upright_billboard", label: "Upright billboard" },
];

const gltfLoader = new GLTFLoader();
const previewTextureAssetCache = new Map();
const previewModelAssetCache = new Map();
const TOOL_PRESET_BUILTINS = {
  voxel: [
    {
      id: "grass-block",
      name: "Grass Block",
      builtin: true,
      entry: {
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
        material: { color: "#85b84f", texture_preset: "grass" },
        shape_preset: "cube",
      },
    },
    {
      id: "stone-block",
      name: "Stone Block",
      builtin: true,
      entry: {
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
        material: { color: "#d3d8e2", texture_preset: "stone" },
        shape_preset: "cube",
      },
    },
    {
      id: "pillar",
      name: "Pillar",
      builtin: true,
      entry: {
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT * 2, z: PRIVATE_WORLD_BLOCK_UNIT },
        material: { color: "#d3d8e2", texture_preset: "stone" },
        shape_preset: "cube",
      },
    },
  ],
  primitive: [
    {
      id: "cube",
      name: "Cube",
      builtin: true,
      entry: {
        shape: "box",
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#d3d8e2", texture_preset: "stone" },
        rigid_mode: "rigid",
        physics: { gravity_scale: 1, restitution: 0.2, friction: 0.7, mass: 1 },
        particle_effect: "",
        trail_effect: "",
      },
    },
    {
      id: "sphere",
      name: "Sphere",
      builtin: true,
      entry: {
        shape: "sphere",
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#b6d7ff", texture_preset: "none" },
        rigid_mode: "rigid",
        physics: { gravity_scale: 1, restitution: 0.45, friction: 0.35, mass: 1 },
        particle_effect: "",
        trail_effect: "",
      },
    },
    {
      id: "capsule",
      name: "Capsule",
      builtin: true,
      entry: {
        shape: "capsule",
        scale: { x: PRIVATE_WORLD_BLOCK_UNIT * 0.8, y: PRIVATE_WORLD_BLOCK_UNIT * 1.4, z: PRIVATE_WORLD_BLOCK_UNIT * 0.8 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#ffd6e8", texture_preset: "none" },
        rigid_mode: "rigid",
        physics: { gravity_scale: 1, restitution: 0.2, friction: 0.8, mass: 1 },
        particle_effect: "",
        trail_effect: "",
      },
    },
    {
      id: "poster-panel",
      name: "Panel",
      builtin: true,
      entry: {
        label: "Panel",
        shape: "panel",
        scale: { x: 4, y: 2.25, z: 0.1 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#f4f7fb", texture_preset: "none", emissive_intensity: 0 },
        rigid_mode: "ghost",
        physics: { gravity_scale: 0, restitution: 0, friction: 0.7, mass: 0 },
        facing_mode: "fixed",
        particle_effect: "",
        trail_effect: "",
        invisible: false,
        group_id: "",
      },
    },
    {
      id: "wide-panel",
      name: "Wide Panel",
      builtin: true,
      entry: {
        label: "Wide Panel",
        shape: "panel",
        scale: { x: 6, y: 2.5, z: 0.1 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#f4f7fb", texture_preset: "none", emissive_intensity: 0 },
        rigid_mode: "ghost",
        physics: { gravity_scale: 0, restitution: 0, friction: 0.7, mass: 0 },
        facing_mode: "fixed",
        particle_effect: "",
        trail_effect: "",
        invisible: false,
        group_id: "",
      },
    },
  ],
  player: [
    {
      id: "player-standard",
      name: "Standard Player",
      builtin: true,
      entry: {
        label: "Player",
        scale: PRIVATE_PLAYER_DEFAULT_SCALE,
        rotation: { x: 0, y: 0, z: 0 },
        camera_mode: "third_person",
        body_mode: "rigid",
        occupiable: true,
      },
    },
    {
      id: "player-ghost",
      name: "Ghost Player",
      builtin: true,
      entry: {
        label: "Ghost Player",
        scale: PRIVATE_PLAYER_DEFAULT_SCALE,
        rotation: { x: 0, y: 0, z: 0 },
        camera_mode: "third_person",
        body_mode: "ghost",
        occupiable: true,
      },
    },
  ],
  screen: [
    {
      id: "screen-panel",
      name: "Panel Screen",
      builtin: true,
      entry: {
        scale: { x: 4, y: 2.25, z: 0.2 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#ffffff", texture_preset: "none" },
        html: "<div style=\"padding:24px\"><h1>Hello world</h1><p>Static world screen.</p></div>",
      },
    },
    {
      id: "screen-banner",
      name: "Wide Banner",
      builtin: true,
      entry: {
        scale: { x: 6, y: 2, z: 0.2 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#ffffff", texture_preset: "none" },
        html: "<div style=\"padding:20px;text-align:center\"><h1>Banner</h1><p>Wide responsive screen.</p></div>",
      },
    },
  ],
  text: [
    {
      id: "text-label",
      name: "Label",
      builtin: true,
      entry: {
        value: "Welcome",
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
        material: { color: "#ffffff", texture_preset: "none" },
        group_id: "",
      },
    },
    {
      id: "text-title",
      name: "Title",
      builtin: true,
      entry: {
        value: "Title",
        rotation: { x: 0, y: 0, z: 0 },
        scale: 2,
        material: { color: "#ffffff", texture_preset: "none" },
        group_id: "",
      },
    },
  ],
  trigger: [
    {
      id: "trigger-zone",
      name: "Zone",
      builtin: true,
      entry: {
        label: "Start Zone",
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
        invisible: true,
      },
    },
    {
      id: "trigger-gate",
      name: "Gate",
      builtin: true,
      entry: {
        label: "Gate Zone",
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 4, z: 1.5 },
        invisible: true,
      },
    },
  ],
};
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
const PRIVATE_SCENE_ENVIRONMENT_PRESETS = {
  blank: {
    background: "#fbfcff",
    fog: "#f4fbff",
    ground: "#ffffff",
    line: "#c9dcff",
    outline: "#33407a",
    gridPrimary: "#7fa7ff",
    gridSecondary: "#bfd6ff",
    ambientSky: "#ffffff",
    ambientGround: "#ffe8f8",
    sunColor: "#fff4be",
    sunIntensity: 1.16,
    sunPosition: { x: 120, y: 280, z: 80 },
    skyGradient: null,
  },
  day: {
    background: "#dff3ff",
    fog: "#e7f7ff",
    ground: "#f7fbff",
    line: "#9cc6ff",
    outline: "#3a609a",
    gridPrimary: "#6e9fff",
    gridSecondary: "#d0e2ff",
    ambientSky: "#f7fbff",
    ambientGround: "#d5ebff",
    sunColor: "#fff2c4",
    sunIntensity: 1.1,
    sunPosition: { x: 140, y: 260, z: 40 },
    skyGradient: [
      { stop: 0, color: "#6db5ff" },
      { stop: 0.5, color: "#ccecff" },
      { stop: 1, color: "#fefefe" },
    ],
  },
  sunset: {
    background: "#ffe5d6",
    fog: "#ffe8dc",
    ground: "#fff8f2",
    line: "#ffb28f",
    outline: "#7c4c5d",
    gridPrimary: "#ff8f70",
    gridSecondary: "#ffd7ca",
    ambientSky: "#fff0df",
    ambientGround: "#ffd3c2",
    sunColor: "#ffd17a",
    sunIntensity: 0.94,
    sunPosition: { x: 180, y: 120, z: -110 },
    skyGradient: [
      { stop: 0, color: "#6c5aa8" },
      { stop: 0.34, color: "#ff8a6d" },
      { stop: 0.72, color: "#ffd2a6" },
      { stop: 1, color: "#fff5ea" },
    ],
  },
  night: {
    background: "#08111f",
    fog: "#0f1b31",
    ground: "#13243f",
    line: "#4e77b8",
    outline: "#c0d7ff",
    gridPrimary: "#88aafc",
    gridSecondary: "#37558f",
    ambientSky: "#b7d4ff",
    ambientGround: "#122541",
    sunColor: "#d6e6ff",
    sunIntensity: 0.52,
    sunPosition: { x: -80, y: 180, z: 130 },
    skyGradient: [
      { stop: 0, color: "#06101d" },
      { stop: 0.58, color: "#132344" },
      { stop: 1, color: "#28456d" },
    ],
    stars: 28,
  },
};
const PRIVATE_SCENE_AMBIENT_PRESETS = {
  even: {
    hemisphereIntensity: 1.48,
    sunIntensityMultiplier: 1,
  },
  dim: {
    hemisphereIntensity: 0.76,
    sunIntensityMultiplier: 0.9,
  },
};

let privateToonGradientTexture = null;
const privateBillboardParentQuaternion = new THREE.Quaternion();
const privateBillboardCameraQuaternion = new THREE.Quaternion();

const elements = {
  entryLoading: document.querySelector("[data-entry-loading]"),
  entryLoadingTitle: document.querySelector("[data-entry-loading-title]"),
  entryLoadingNote: document.querySelector("[data-entry-loading-note]"),
  launcher: document.querySelector("[data-launcher]"),
  launcherToggle: document.querySelector("[data-launcher-toggle]"),
  launcherClose: document.querySelector("[data-launcher-close]"),
  launcherTitle: document.querySelector("[data-launcher-title]"),
  sceneDrawer: document.querySelector("[data-scene-drawer]"),
  sceneToolsToggle: document.querySelector("[data-scene-tools-toggle]"),
  sceneToolsClose: document.querySelector("[data-scene-tools-close]"),
  inspector: document.querySelector("[data-inspector]"),
  selectionClear: document.querySelector("[data-selection-clear]"),
  authForm: document.querySelector("[data-auth-form]"),
  authStatus: document.querySelector("[data-auth-status]"),
  accessHeading: document.querySelector("[data-access-heading]"),
  accessNote: document.querySelector("[data-access-note]"),
  profileForm: document.querySelector("[data-profile-form]"),
  accountActions: document.querySelector("[data-account-actions]"),
  accountSignout: document.querySelector("[data-account-signout]"),
  createWorldForm: document.querySelector("[data-create-world-form]"),
  createWorldDialog: document.querySelector("[data-create-world-dialog]"),
  publicWorldType: document.querySelector("[data-public-world-type]"),
  refreshWorlds: document.querySelector("[data-refresh-worlds]"),
  worldSearch: document.querySelector("[data-world-search]"),
  worldList: document.querySelector("[data-world-list]"),
  launcherWorldTypeField: document.querySelector("[data-launcher-world-type-field]"),
  importForm: document.querySelector("[data-import-form]"),
  resolveForm: document.querySelector("[data-resolve-form]"),
  panelRoot: document.querySelector("[data-private-panel]"),
  panelTitle: document.querySelector("[data-private-panel-title]"),
  panelSubtitle: document.querySelector("[data-private-panel-subtitle]"),
  panelModeLabel: document.querySelector("[data-private-panel-mode-label]"),
  panelModeNote: document.querySelector("[data-private-panel-mode-note]"),
  sceneModeBadge: document.querySelector("[data-private-scene-mode-badge]"),
  sceneModeBadgeLabel: document.querySelector("[data-private-scene-mode-badge-label]"),
  panelSessionLabel: document.querySelector("[data-private-session-label]"),
  panelOpenAccess: document.querySelector("[data-private-open-access]"),
  panelChatComposer: document.querySelector("[data-private-chat-composer]"),
  panelChatInput: document.querySelector("[data-private-chat-input]"),
  panelChatReactions: document.querySelector(".world-chat-reactions"),
  panelChatEmpty: document.querySelector("[data-private-chat-empty]"),
  panelVoiceToggle: document.querySelector("[data-private-voice-toggle]"),
  panelVoiceStatus: document.querySelector("[data-private-voice-status]"),
  panelVoiceOfferStack: document.querySelector("[data-private-voice-offer-stack]"),
  panelVoiceRequestStack: document.querySelector("[data-private-voice-request-stack]"),
  panelRuntimeActions: document.querySelector("[data-private-runtime-actions]"),
  panelLiveSearchForm: document.querySelector("[data-private-live-search-form]"),
  panelLiveSearchInput: document.querySelector("[data-private-live-search-input]"),
  panelLiveStatus: document.querySelector("[data-private-live-status]"),
  panelLiveResults: document.querySelector("[data-private-live-results]"),
  panelShareStatus: document.querySelector("[data-private-share-status]"),
  panelShareCopy: document.querySelector("[data-private-copy-link]"),
  panelShareNative: document.querySelector("[data-private-native-share]"),
  panelBrowserPanel: document.querySelector("[data-private-browser-panel]"),
  panelBrowserShare: document.querySelector("[data-private-browser-panel] .world-browser-share"),
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
  panelShareRequestStack: document.querySelector("[data-private-share-request-stack]"),
  panelShareGroupSummary: document.querySelector("[data-private-share-group-summary]"),
  panelWorldMeta: document.querySelector("[data-private-panel-world-meta]"),
  panelModeBuild: document.querySelector("[data-private-panel-mode-build]"),
  panelModePlay: document.querySelector("[data-private-panel-mode-play]"),
  buildScenePicker: document.querySelector("[data-private-build-scene-picker]"),
  buildSceneSelect: document.querySelector("[data-private-build-scene-select]"),
  panelLibrary: document.querySelector("[data-private-panel-library]"),
  panelExport: document.querySelector("[data-private-panel-export]"),
  panelEnter: document.querySelector("[data-private-panel-enter]"),
  panelLeave: document.querySelector("[data-private-panel-leave]"),
  panelReady: document.querySelector("[data-private-panel-ready]"),
  panelRelease: document.querySelector("[data-private-panel-release]"),
  panelReset: document.querySelector("[data-private-panel-reset]"),
  sceneDrawer: document.querySelector("[data-scene-drawer]"),
  sceneDrawerTabButtons: [...document.querySelectorAll("[data-scene-drawer-tab]")],
  sceneDrawerViews: [...document.querySelectorAll("[data-scene-drawer-view]")],
  sceneLibraryHint: document.querySelector("[data-scene-library-hint]"),
  sceneLibraryList: document.querySelector("[data-scene-library-list]"),
  sceneSwitchButton: document.querySelector("[data-scene-switch-button]"),
  sceneDrawerSceneIndicator: document.querySelector("[data-scene-drawer-scene-indicator]"),
  sceneForm: document.querySelector("[data-scene-form]"),
  sceneEnvironmentHint: document.querySelector("[data-scene-environment-hint]"),
  saveScene: document.querySelector("[data-save-scene]"),
  refreshScene: document.querySelector("[data-refresh-scene]"),
  scriptFunctionSearch: document.querySelector("[data-script-function-search]"),
  scriptFunctionSearchHint: document.querySelector("[data-script-function-search-hint]"),
  scriptFunctionList: document.querySelector("[data-script-function-list]"),
  scriptFunctionEditor: document.querySelector("[data-script-function-editor]"),
  scriptFunctionEmpty: document.querySelector("[data-script-function-empty]"),
  scriptFunctionFields: document.querySelector("[data-script-function-fields]"),
  scriptFunctionName: document.querySelector("[data-script-function-name]"),
  scriptFunctionMeta: document.querySelector("[data-script-function-meta]"),
  scriptFunctionBody: document.querySelector("[data-script-function-body]"),
  scriptFunctionPrompt: document.querySelector("[data-script-function-prompt]"),
  scriptFunctionOpenGenerate: document.querySelector("[data-script-function-open-generate]"),
  scriptFunctionNew: document.querySelector("[data-script-function-new]"),
  scriptFunctionDelete: document.querySelector("[data-script-function-delete]"),
  scriptFunctionGenerate: document.querySelector("[data-script-function-generate]"),
  entitySections: document.querySelector("[data-entity-sections]"),
  entitySearch: document.querySelector("[data-entity-search]"),
  entitySearchHint: document.querySelector("[data-entity-search-hint]"),
  entityFilter: document.querySelector("[data-entity-filter]"),
  entityLibrarySummary: document.querySelector("[data-entity-library-summary]"),
  entityEditor: document.querySelector("[data-entity-editor]"),
  entityEmpty: document.querySelector("[data-entity-empty]"),
  selectionLabel: document.querySelector("[data-selection-label]"),
  assetSearch: document.querySelector("[data-asset-search]"),
  assetTypeFilter: document.querySelector("[data-asset-type-filter]"),
  assetStatus: document.querySelector("[data-asset-status]"),
  assetContext: document.querySelector("[data-asset-context]"),
  assetSections: document.querySelector("[data-asset-sections]"),
  assetGenerateTexture: document.querySelector("[data-asset-generate-texture]"),
  assetGenerateModel: document.querySelector("[data-asset-generate-model]"),
  prefabList: document.querySelector("[data-prefab-list]"),
  prefabDetail: document.querySelector("[data-prefab-detail]"),
  prefabSearch: document.querySelector("[data-prefab-search]"),
  prefabSearchHint: document.querySelector("[data-prefab-search-hint]"),
  removeEntity: document.querySelector("[data-remove-entity]"),
  convertPrefab: document.querySelector("[data-convert-prefab]"),
  placePrefab: document.querySelector("[data-place-prefab]"),
  previewCanvas: document.querySelector("[data-preview-canvas]"),
  runtimeStatus: document.querySelector("[data-runtime-status]"),
  readyToggle: document.querySelector("[data-ready-toggle]"),
  releasePlayer: document.querySelector("[data-release-player]"),
  resetScene: document.querySelector("[data-reset-scene]"),
  collaboratorForm: document.querySelector("[data-collaborator-form]"),
  saveCollaborator: document.querySelector("[data-save-collaborator]"),
  collaboratorList: document.querySelector("[data-collaborator-list]"),
  aiForm: document.querySelector("[data-ai-form]"),
  aiStatus: document.querySelector("[data-ai-status]"),
  aiOutput: document.querySelector("[data-ai-output]"),
  generateHtml: document.querySelector("[data-generate-html]"),
  generateScript: document.querySelector("[data-generate-script]"),
  aiDialogBackdrop: document.querySelector("[data-ai-dialog-backdrop]"),
  aiDialog: document.querySelector("[data-ai-dialog]"),
  aiDialogClose: document.querySelector("[data-ai-dialog-close]"),
  aiDialogTitle: document.querySelector("[data-ai-dialog-title]"),
  aiDialogNote: document.querySelector("[data-ai-dialog-note]"),
  aiDialogThread: document.querySelector("[data-ai-dialog-thread]"),
  aiDialogStatus: document.querySelector("[data-ai-dialog-status]"),
  aiDialogInput: document.querySelector("[data-ai-dialog-input]"),
  aiDialogSend: document.querySelector("[data-ai-dialog-send]"),
  aiDialogGenerate: document.querySelector("[data-ai-dialog-generate]"),
  aiDialogApply: document.querySelector("[data-ai-dialog-apply]"),
  aiDialogResultPanel: document.querySelector("[data-ai-dialog-result-panel]"),
  aiDialogResultTitle: document.querySelector("[data-ai-dialog-result-title]"),
  aiDialogResult: document.querySelector("[data-ai-dialog-result]"),
  eventLog: document.querySelector("[data-event-log]"),
  worldSectionNav: document.querySelector("[aria-label=\"World tools\"]"),
  addVoxel: document.querySelector("[data-add-voxel]"),
  addPrimitive: document.querySelector("[data-add-primitive]"),
  addPlayer: document.querySelector("[data-add-player]"),
  addScreen: document.querySelector("[data-add-screen]"),
  addText: document.querySelector("[data-add-text]"),
  addTrigger: document.querySelector("[data-add-trigger]"),
  addParticle: document.querySelector("[data-add-particle]"),
  addRule: document.querySelector("[data-add-rule]"),
  toolPresetPanel: document.querySelector("[data-tool-preset-panel]"),
  toolPresetCompact: document.querySelector("[data-tool-preset-compact]"),
  toolPresetContent: document.querySelector("[data-tool-preset-content]"),
  toolPresetTitle: document.querySelector("[data-tool-preset-title]"),
  toolPresetHint: document.querySelector("[data-tool-preset-hint]"),
  toolPresetCurrentName: document.querySelector("[data-tool-preset-current-name]"),
  toolPresetSelect: document.querySelector("[data-tool-preset-select]"),
  toolPresetSummary: document.querySelector("[data-tool-preset-summary]"),
  toolPresetName: document.querySelector("[data-tool-preset-name]"),
  toolPresetCollapse: document.querySelector("[data-tool-preset-collapse]"),
  toolPresetExpand: document.querySelector("[data-tool-preset-expand]"),
  saveToolPreset: document.querySelector("[data-save-tool-preset]"),
  updateToolPreset: document.querySelector("[data-update-tool-preset]"),
  deleteToolPreset: document.querySelector("[data-delete-tool-preset]"),
};

elements.launcherSections = [...document.querySelectorAll("[data-launcher-section]")];
elements.launcherWorldTabButtons = [...document.querySelectorAll("[data-launcher-world-tab]")];
elements.openCreateWorldButtons = [...document.querySelectorAll("[data-open-create-world]")];
elements.closeCreateWorldButtons = [...document.querySelectorAll("[data-close-create-world]")];
elements.privatePanelTabButtons = [...document.querySelectorAll("[data-private-panel-tab]")];
elements.privatePanelViews = [...document.querySelectorAll("[data-private-panel-view]")];
elements.panelChatReactionButtons = [...document.querySelectorAll("[data-private-chat-reaction]")];
elements.panelBrowserShareModes = [...document.querySelectorAll("[data-private-browser-share-mode]")];
elements.sceneAddButtons = [...document.querySelectorAll("[data-scene-add-button]")];
elements.worldSectionJumpButtons = [...document.querySelectorAll("[data-world-section-jump]")];
elements.worldSections = [...document.querySelectorAll("[data-world-section]")];
syncWorldPanelTabLabels(elements.privatePanelTabButtons, "data-private-panel-tab");

function createEmptyToolPresetCustoms() {
  return Object.fromEntries(TOOL_PRESET_KINDS.map((kind) => [kind, []]));
}

function createDefaultToolPresetSelection() {
  return Object.fromEntries(TOOL_PRESET_KINDS.map((kind) => [kind, TOOL_PRESET_BUILTINS[kind]?.[0]?.id || ""]));
}

function createBaseToolPresetEntry(kind) {
  if (kind === "voxel") {
    return {
      scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
      material: { color: "#85b84f", texture_preset: "grass", emissive_intensity: 0 },
      shape_preset: "cube",
      invisible: false,
    };
  }
  if (kind === "primitive") {
    return {
      shape: "box",
      scale: { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT },
      rotation: { x: 0, y: 0, z: 0 },
      material: { color: "#d3d8e2", texture_preset: "stone", emissive_intensity: 0 },
      rigid_mode: "rigid",
      physics: { gravity_scale: 1, restitution: 0.2, friction: 0.7, mass: 1 },
      particle_effect: "",
      trail_effect: "",
      invisible: false,
      group_id: "",
    };
  }
  if (kind === "panel") {
    return {
      label: "Panel",
      scale: { x: 4, y: 2.25, z: 0.1 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { color: "#f4f7fb", texture_preset: "none", emissive_intensity: 0 },
      facing_mode: "fixed",
      invisible: false,
      group_id: "",
    };
  }
  if (kind === "player") {
    return {
      label: "Player",
      scale: PRIVATE_PLAYER_DEFAULT_SCALE,
      rotation: { x: 0, y: 0, z: 0 },
      camera_mode: "third_person",
      body_mode: "rigid",
      occupiable: true,
    };
  }
  if (kind === "screen") {
    return {
      scale: { x: 4, y: 2.25, z: 0.2 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { color: "#ffffff", texture_preset: "none" },
      facing_mode: "fixed",
      html: "<div style=\"padding:24px\"><h1>Hello world</h1><p>Static world screen.</p></div>",
    };
  }
  if (kind === "text") {
    return {
      value: "Welcome",
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      material: { color: "#ffffff", texture_preset: "none" },
      facing_mode: "fixed",
      group_id: "",
    };
  }
  if (kind === "trigger") {
    return {
      label: "Start Zone",
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
      invisible: true,
    };
  }
  return {};
}

function deepMerge(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return deepClone(overrideValue ?? baseValue);
  }
  if (!baseValue || typeof baseValue !== "object" || !overrideValue || typeof overrideValue !== "object") {
    return deepClone(overrideValue ?? baseValue);
  }
  const merged = deepClone(baseValue);
  for (const [key, value] of Object.entries(overrideValue)) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = deepClone(value);
    }
  }
  return merged;
}

function extractToolPresetEntry(kind, entry = {}) {
  const normalized = deepMerge(createBaseToolPresetEntry(kind), deepClone(entry));
  delete normalized.id;
  delete normalized.position;
  if (kind !== "voxel" && kind !== "player" && kind !== "screen" && kind !== "text" && kind !== "trigger" && kind !== "primitive") {
    return normalized;
  }
  return normalized;
}

function normalizeCustomToolPreset(kind, preset, index = 0) {
  if (!preset || typeof preset !== "object") {
    return null;
  }
  const name = String(preset.name ?? `Preset ${index + 1}`).trim() || `Preset ${index + 1}`;
  const rawId = slugToken(preset.id || "");
  const id = rawId
    ? (rawId.startsWith("custom-") ? rawId : `custom-${rawId}`)
    : `custom-${slugToken(name) || `${kind}-preset-${index + 1}`}`;
  return {
    id,
    name,
    builtin: false,
    entry: extractToolPresetEntry(kind, preset.entry ?? preset),
  };
}

function loadStoredToolPresetState() {
  const fallback = {
    customs: createEmptyToolPresetCustoms(),
    selected: createDefaultToolPresetSelection(),
  };
  try {
    const raw = window.localStorage.getItem(TOOL_PRESET_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    const customs = createEmptyToolPresetCustoms();
    const selected = createDefaultToolPresetSelection();
    for (const kind of TOOL_PRESET_KINDS) {
      if (Array.isArray(parsed?.customs?.[kind])) {
        customs[kind] = parsed.customs[kind]
          .map((preset, index) => normalizeCustomToolPreset(kind, preset, index))
          .filter(Boolean);
      }
      if (typeof parsed?.selected?.[kind] === "string" && parsed.selected[kind].trim()) {
        selected[kind] = parsed.selected[kind].trim();
      }
    }
    return { customs, selected };
  } catch (_error) {
    return fallback;
  }
}

const initialToolPresetState = loadStoredToolPresetState();

function loadStoredToolPresetPanelCollapsed() {
  return true;
}

function createEmptyPrivateBrowserMediaState() {
  return {
    enabled: null,
    connected: false,
    transport: "jpeg-sequence",
    roomName: "",
    canPublish: false,
    remoteVideoSessionId: "",
    remoteAudioBySession: new Map(),
    remoteAudioSessionId: "",
    remoteAudioAvailable: false,
    remoteAudioBlocked: false,
    remoteAudioError: "",
    lastPlayError: "",
  };
}

function createEmptyAiDialogState() {
  return {
    open: false,
    key: "",
    artifactType: "screen_html",
    targetKind: "world",
    targetId: "",
    title: "AI brainstorm",
    note: "Start with a brief, let the AI surface assumptions and questions, then generate when it is ready.",
    applyLabel: "",
    messages: [],
    input: "",
    result: "",
    generatedAsset: null,
    status: "",
    statusTone: "",
    busy: false,
  };
}

const state = {
  authConfig: null,
  supabase: null,
  session: null,
  authReady: false,
  profile: null,
  publicWorlds: [],
  publicWorldsLoading: false,
  publicWorldsError: "",
  worlds: [],
  worldsLoading: false,
  worldsError: "",
  selectedWorld: null,
  selectedSceneId: "",
  sceneDrawerFocusId: "",
  buildReturnSceneId: "",
  selectedPrefabId: "",
  toolPresetSelection: initialToolPresetState.selected,
  toolPresetCustoms: initialToolPresetState.customs,
  toolPresetPanelCollapsed: loadStoredToolPresetPanelCollapsed(),
  selectedScriptFunctionId: "",
  prefabQuery: "",
  prefabPlacementId: "",
  scriptFunctionQuery: "",
  entityQuery: "",
  entityFilterKind: "all",
  assets: [],
  assetsLoading: false,
  assetQuery: "",
  assetFilterType: "all",
  sceneDrafts: new Map(),
  screenAiPromptDrafts: new Map(),
  aiThreadDrafts: new Map(),
  sceneEditorSceneId: "",
  aiDialog: createEmptyAiDialogState(),
  placementTool: "",
  placementShortcutTool: "",
  builderSelection: null,
  builderSelectionSet: [],
  worldSocket: null,
  preview: null,
  eventLog: [],
  livePresence: new Map(),
  joinedAsGuest: false,
  joined: false,
  entryLoading: false,
  launcherOpen: false,
  createWorldDialogOpen: false,
  sceneDrawerOpen: false,
  sceneDrawerTab: "scenes",
  activeLockEntityKey: "",
  runtimeSnapshot: null,
  pressedRuntimeKeys: new Set(),
  launcherTab: "access",
  launcherWorldTab: "mine",
  privatePanelTab: "chat",
  worldPanelSection: "overview",
  mode: "play",
  lockHeartbeatTimer: 0,
  privateChatEntries: [],
  activeChats: new Map(),
  browserSessions: new Map(),
  localBrowserSessionId: "",
  localVoiceSessionId: "",
  browserMediaController: null,
  pendingBrowserShare: null,
  localBrowserShare: null,
  pendingVoiceShare: null,
  localVoiceShare: null,
  localBrowserPreviewStream: null,
  browserShareMode: "screen",
  browserPanelRemoteSessionId: "",
  pendingShareJoin: null,
  pendingShareJoinCancellationAnchorSessionId: "",
  incomingShareJoinRequests: [],
  voiceJoinOffer: null,
  pendingVoiceJoin: null,
  pendingVoiceJoinCancellationAnchorSessionId: "",
  incomingVoiceJoinRequests: [],
  gameSessions: new Map(),
  selectedWorldGameId: "",
  pendingGameShareGameId: "",
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
  buildSuppressedClick: null,
  buildModifierKeys: new Set(),
  buildDrag: null,
  buildHover: null,
  launcherIntentHandled: false,
  previewPointer: {
    clientX: 0,
    clientY: 0,
    pointerId: 0,
    inside: false,
  },
  launchHandled: false,
  launchRequestPromise: null,
  launchRequestQueued: false,
  authRefreshPromise: null,
  authRefreshQueued: false,
};

const privateInputState = {
  keys: new Set(),
  sprintHoldSeconds: 0,
  pointerDown: false,
  dragDistance: 0,
  lastPointerX: 0,
  lastPointerY: 0,
  pointerId: 0,
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

function getPrivateViewerInstanceId() {
  const existing = window.sessionStorage.getItem(PRIVATE_VIEWER_INSTANCE_KEY);
  if (existing) {
    return existing;
  }
  const next = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(PRIVATE_VIEWER_INSTANCE_KEY, next);
  return next;
}

function parsePrivateViewerSessionId(viewerSessionId = "") {
  const raw = String(viewerSessionId ?? "").trim();
  if (!raw) {
    return {
      kind: "",
      subjectId: "",
      instanceId: "",
    };
  }
  if (raw.startsWith("profile:")) {
    const [, profileId = "", instanceId = ""] = raw.split(":");
    return {
      kind: "profile",
      subjectId: String(profileId ?? "").trim(),
      instanceId: String(instanceId ?? "").trim(),
    };
  }
  if (raw.startsWith("guest:")) {
    const [, guestSessionId = "", instanceId = ""] = raw.split(":");
    return {
      kind: "guest",
      subjectId: String(guestSessionId ?? "").trim(),
      instanceId: String(instanceId ?? "").trim(),
    };
  }
  return {
    kind: raw.startsWith("guest_") ? "guest" : "",
    subjectId: raw,
    instanceId: "",
  };
}

function setStatus(text) {
  if (elements.authStatus) {
    elements.authStatus.textContent = text || "";
  }
}

function setEntryLoading(active, options = {}) {
  state.entryLoading = active === true;
  if (elements.entryLoadingTitle && options.title) {
    elements.entryLoadingTitle.textContent = options.title;
  } else if (elements.entryLoadingTitle && !state.entryLoading) {
    elements.entryLoadingTitle.textContent = "Opening private world";
  }
  if (elements.entryLoadingNote && options.note) {
    elements.entryLoadingNote.textContent = options.note;
  } else if (elements.entryLoadingNote && !state.entryLoading) {
    elements.entryLoadingNote.textContent = "Loading the scene you picked.";
  }
  if (elements.entryLoading) {
    elements.entryLoading.hidden = !state.entryLoading;
  }
  document.body.classList.toggle("is-world-entry-loading", state.entryLoading);
}

function waitForUiPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function setPrivateShareStatus(text) {
  if (elements.panelShareStatus) {
    elements.panelShareStatus.textContent = text || "";
    return;
  }
  setStatus(text);
}

function canCopyToClipboard() {
  return typeof navigator?.clipboard?.writeText === "function" || typeof document?.execCommand === "function";
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) {
    return false;
  }
  if (typeof navigator?.clipboard?.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return true;
  }
  if (typeof document?.execCommand !== "function") {
    throw new Error("Clipboard copy is not available in this browser.");
  }
  const textarea = document.createElement("textarea");
  const previousActiveElement = document.activeElement;
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (previousActiveElement instanceof HTMLElement) {
    previousActiveElement.focus?.({ preventScroll: true });
  }
  if (!copied) {
    throw new Error("Could not copy entry link.");
  }
  return true;
}

function getPrivateViewerSessionId() {
  const instanceId = getPrivateViewerInstanceId();
  if (state.profile?.id) {
    return `profile:${state.profile.id}:${instanceId}`;
  }
  return `guest:${getGuestSessionId()}:${instanceId}`;
}

function getPrivateDisplayName() {
  return state.profile?.display_name || state.profile?.username || "guest viewer";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function getPrivateProfileId() {
  return String(state.profile?.id ?? "").trim();
}

const privateWorldGamesApi = createWorldGamesApi({
  getAccessToken: () => String(state.session?.access_token ?? "").trim(),
});

const privateGameLibrary = createWorldGameLibrary({
  api: privateWorldGamesApi,
  storagePrefix: "mauworld-private-world-games",
  onSelect(game) {
    state.selectedWorldGameId = String(game?.id ?? "").trim();
    updatePrivateBrowserPanel();
  },
  onGenerated(game) {
    state.selectedWorldGameId = String(game?.id ?? "").trim();
    updatePrivateBrowserPanel();
  },
  onShare(game) {
    void startPrivateWorldGameShare(game);
  },
});

const privateGameShell = createWorldGameShell({
  getViewerSessionId: getPrivateViewerSessionId,
  getProfileId: getPrivateProfileId,
  onOpenSession(sessionId) {
    const sent = sendWorldSocketMessage({
      type: "game:open",
      sessionId,
    });
    if (!sent) {
      privateGameShell.setStatus("Private world share is offline.");
      setPrivateBrowserStatus("Private world share is offline.");
    }
  },
  onClaimSeat(sessionId, seatId) {
    sendWorldSocketMessage({
      type: "game:seat-claim",
      sessionId,
      seatId,
    });
  },
  onReleaseSeat(sessionId) {
    sendWorldSocketMessage({
      type: "game:seat-release",
      sessionId,
    });
  },
  onReady(sessionId, ready) {
    sendWorldSocketMessage({
      type: "game:ready",
      sessionId,
      ready,
    });
  },
  onStartMatch(sessionId) {
    sendWorldSocketMessage({
      type: "game:start-match",
      sessionId,
    });
  },
  onAction(sessionId, action) {
    sendWorldSocketMessage({
      type: "game:action",
      sessionId,
      action,
    });
  },
  onState(sessionId, nextState) {
    sendWorldSocketMessage({
      type: "game:state",
      sessionId,
      state: nextState,
    });
  },
  onPreview(sessionId, preview) {
    sendWorldSocketMessage({
      type: "game:preview",
      sessionId,
      preview,
    });
  },
  onCopy(sessionId) {
    if (!state.session) {
      setPrivateBrowserStatus("Sign in to copy this game.");
      return;
    }
    sendWorldSocketMessage({
      type: "game:copy",
      sessionId,
    });
  },
});

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

function normalizePrivatePanelTab(tab) {
  return PRIVATE_PANEL_TABS.has(tab) ? tab : "chat";
}

function normalizeWorldPanelSection(section) {
  return WORLD_PANEL_SECTIONS.has(section) ? section : "overview";
}

function normalizeSceneDrawerTab(tab) {
  return SCENE_DRAWER_TABS.has(tab) ? tab : "scenes";
}

function renderWorldPanelSections(options = {}) {
  const activeSection = normalizeWorldPanelSection(state.worldPanelSection);
  state.worldPanelSection = activeSection;
  const hasWorld = Boolean(state.selectedWorld);
  for (const button of elements.worldSectionJumpButtons ?? []) {
    const sectionName = normalizeWorldPanelSection(button.getAttribute("data-world-section-jump") || "");
    const isActive = hasWorld && sectionName === activeSection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }
  for (const section of elements.worldSections ?? []) {
    const sectionName = normalizeWorldPanelSection(section.getAttribute("data-world-section") || "");
    const isActive = hasWorld && sectionName === activeSection;
    section.hidden = !isActive;
    section.setAttribute("aria-hidden", String(!isActive));
  }
  const fieldName = String(options.fieldName || "").trim();
  if (!fieldName || !hasWorld || state.privatePanelTab !== "world" || activeSection !== "ai") {
    return;
  }
  window.requestAnimationFrame(() => {
    const field = elements.aiForm?.elements?.[fieldName];
    field?.focus?.();
    if (fieldName.toLowerCase().includes("apikey") && typeof field?.select === "function") {
      field.select();
    }
  });
}

function setWorldPanelSection(section, options = {}) {
  state.worldPanelSection = normalizeWorldPanelSection(String(section ?? "").trim().toLowerCase());
  if (options.openWorldPanel !== false && state.selectedWorld) {
    setPrivatePanelTab("world");
  }
  renderWorldPanelSections(options);
}

function renderSceneDrawerTabs() {
  const activeTab = normalizeSceneDrawerTab(state.sceneDrawerTab);
  state.sceneDrawerTab = activeTab;
  for (const button of elements.sceneDrawerTabButtons ?? []) {
    const isActive = button.getAttribute("data-scene-drawer-tab") === activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
  for (const view of elements.sceneDrawerViews ?? []) {
    const isActive = view.getAttribute("data-scene-drawer-view") === activeTab;
    view.hidden = !isActive;
    view.setAttribute("aria-hidden", String(!isActive));
  }
}

function setSceneDrawerTab(tab) {
  const nextTab = normalizeSceneDrawerTab(tab);
  if (nextTab !== "scenes" && state.sceneDrawerFocusId !== state.selectedSceneId) {
    if (state.sceneEditorSceneId) {
      rememberSceneDraft();
    }
    state.sceneDrawerFocusId = state.selectedSceneId;
  }
  state.sceneDrawerTab = nextTab;
  renderSceneDrawerTabs();
  renderSceneLibrary();
  renderSceneDrawerSceneIndicator();
  renderSceneEditor();
  if (elements.sceneDrawer) {
    elements.sceneDrawer.scrollTop = 0;
  }
}

function resetHorizontalScroll(element) {
  if (!element) {
    return;
  }
  if (element.scrollLeft !== 0) {
    element.scrollLeft = 0;
  }
}

function settleHorizontalScroll(element) {
  if (!element) {
    return;
  }
  resetHorizontalScroll(element);
  window.requestAnimationFrame(() => {
    resetHorizontalScroll(element);
  });
  window.setTimeout(() => {
    resetHorizontalScroll(element);
  }, 32);
}

function setPrivatePanelTab(tab, options = {}) {
  const nextTab = normalizePrivatePanelTab(tab);
  const refreshWorld = options.refreshWorld === true;
  state.privatePanelTab = nextTab;
  if (nextTab !== "share" && state.browserOverlayOpen) {
    setPrivateBrowserOverlayOpen(false);
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
  renderWorldPanelSections();
  if (nextTab === "live") {
    renderPrivateLiveSharesList();
  }
  if (refreshWorld && state.selectedWorld) {
    renderSelectedWorld();
  }
  settleHorizontalScroll(elements.panelRoot);
}

function updateShellState() {
  const activePlacementTool = getActivePlacementTool();
  const activePrefabPlacementId = getActivePrefabPlacementId();
  const buildTransformMode = getResolvedBuildTransformMode();
  const authGated = state.authReady === true && !state.session;
  document.body.classList.toggle("has-world", Boolean(state.selectedWorld));
  document.body.classList.toggle("is-launcher-open", state.launcherOpen === true);
  document.body.classList.toggle("is-auth-gated", authGated);
  document.body.classList.toggle("is-world-entry-loading", state.entryLoading === true);
  document.body.classList.toggle("is-create-world-dialog-open", state.createWorldDialogOpen === true);
  document.body.classList.toggle("is-scene-drawer-open", state.sceneDrawerOpen === true);
  document.body.classList.toggle("is-ai-dialog-open", state.aiDialog.open === true);
  document.body.classList.toggle("is-signed-in", Boolean(state.session));
  document.body.classList.toggle(
    "has-placement-tool",
    Boolean((activePlacementTool || activePrefabPlacementId) && canUsePlacementTools()),
  );
  document.body.classList.toggle(
    "has-selection",
    Boolean(hasBuilderSelection() && state.mode === "build" && isEditor()),
  );
  for (const mode of ["move", "scale", "rotate", "multi", "delete"]) {
    document.body.classList.toggle(`is-build-${mode}`, buildTransformMode === mode);
  }
  for (const kind of ["voxel", "primitive", "panel", "player", "screen", "text", "trigger"]) {
    const button = getPlacementToolButton(kind);
    if (!button) {
      continue;
    }
    const active = kind === activePlacementTool && canUsePlacementTools();
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.title = buildPlacementToolLabel(kind);
  }
  if (elements.placePrefab) {
    const hasActivePrefab = Boolean(state.selectedPrefabId);
    const isArmed = Boolean(activePrefabPlacementId) && activePrefabPlacementId === state.selectedPrefabId;
    elements.placePrefab.classList.toggle("is-active", isArmed);
    elements.placePrefab.textContent = isArmed ? "Cancel world placement" : "Use in world";
    elements.placePrefab.disabled = !canUsePlacementTools() || !hasActivePrefab;
  }
  if (elements.prefabSearch) {
    elements.prefabSearch.disabled = !state.selectedWorld;
  }
  if (elements.launcherClose) {
    elements.launcherClose.hidden = authGated;
  }
  if (elements.createWorldDialog) {
    elements.createWorldDialog.hidden = !(state.createWorldDialogOpen && state.launcherTab === "worlds" && state.session);
  }
  setLauncherTab(state.launcherTab);
  setPrivatePanelTab(state.privatePanelTab, { syncMode: false });
  renderToolPresetPanel();
  syncPreviewCanvasCursor();
}

function setLauncherOpen(open) {
  state.launcherOpen = !state.session ? true : open === true;
  if (state.launcherOpen) {
    state.sceneDrawerOpen = false;
    writeBuilderSelection([]);
    if (!LAUNCHER_TABS.has(state.launcherTab)) {
      state.launcherTab = getPreferredLauncherTab();
    }
  } else {
    state.createWorldDialogOpen = false;
  }
  updateShellState();
}

function setCreateWorldDialogOpen(open) {
  state.createWorldDialogOpen = open === true && state.session && state.launcherTab === "worlds";
  if (state.createWorldDialogOpen) {
    state.launcherOpen = true;
    state.sceneDrawerOpen = false;
    writeBuilderSelection([]);
  }
  updateShellState();
}

function setSceneDrawerOpen(open) {
  state.sceneDrawerOpen = open === true;
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
  return sharedIsEmojiOnlyChatText(value);
}

function createPrivateActorBubbleState(color, options = {}) {
  return createChatBubbleState({
    accent: color,
    anchorY: Number(options.anchorY ?? PRIVATE_CHAT_BUBBLE.anchorY) || PRIVATE_CHAT_BUBBLE.anchorY,
    baseWidth: PRIVATE_CHAT_BUBBLE.baseWidth,
    baseHeight: PRIVATE_CHAT_BUBBLE.baseHeight,
    stroke: PRIVATE_WORLD_STYLE.outline,
    createTexture: createBubbleTexture,
    createBillboard: createPrivateBillboard,
    persistent: options.persistent === true,
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

const privateChatBubbleRenderer = createChatBubbleRenderer({
  baseWidth: PRIVATE_CHAT_BUBBLE.baseWidth,
  baseHeight: PRIVATE_CHAT_BUBBLE.baseHeight,
  minWidth: PRIVATE_CHAT_BUBBLE.minWidth,
  minHeight: PRIVATE_CHAT_BUBBLE.minHeight,
  maxTextureWidth: PRIVATE_CHAT_BUBBLE.textureMaxWidth,
  maxTextureHeight: PRIVATE_CHAT_BUBBLE.textureMaxHeight,
  maxLines: PRIVATE_CHAT_BUBBLE.maxLines,
  stroke: PRIVATE_WORLD_STYLE.outline,
  getDefaultAccent: () => PRIVATE_WORLD_STYLE.accents[1],
  createTexture: createBubbleTexture,
  createBillboard: createPrivateBillboard,
  getGhostState: () => ({
    root: state.preview?.chatBubbleGhosts ?? null,
    entries: state.preview?.animatedChatBubbleGhosts ?? null,
  }),
  isEmojiOnly: isEmojiOnlyPrivateChatText,
  clampSize: clampNumber,
  orientToCamera: orientPrivateBillboardToCamera,
});

function removePrivateChatBubbleGhost(preview, entry) {
  const activePreview = preview ?? state.preview;
  if (!activePreview?.animatedChatBubbleGhosts || !entry?.mesh) {
    return;
  }
  if (entry.mesh.parent) {
    entry.mesh.parent.remove(entry.mesh);
  }
  entry.mesh.geometry?.dispose?.();
  entry.mesh.material?.map?.dispose?.();
  entry.mesh.material?.dispose?.();
  const index = activePreview.animatedChatBubbleGhosts.indexOf(entry);
  if (index >= 0) {
    activePreview.animatedChatBubbleGhosts.splice(index, 1);
  }
}

function applyPrivateChatBubbleToActor(actorEntry, chatEvent) {
  privateChatBubbleRenderer.apply(actorEntry, chatEvent);
}

function updatePrivateActorBubble(actorEntry, deltaSeconds, camera = state.preview?.camera) {
  privateChatBubbleRenderer.update(actorEntry, deltaSeconds, { camera });
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

function getPrivateDisplayNameForSessionId(viewerSessionId = "") {
  const normalized = String(viewerSessionId ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized === getPrivateViewerSessionId()) {
    return getPrivateDisplayName();
  }
  const presenceEntry = state.livePresence.get(normalized);
  if (presenceEntry) {
    return getPrivatePresenceDisplayName(presenceEntry);
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
  const getPlayerAnchorPosition = (playerEntityId = "") => {
    const playerId = String(playerEntityId ?? "").trim();
    if (!playerId) {
      return null;
    }
    const renderedPosition = state.preview?.entityMeshes?.get(playerId)?.position ?? null;
    if (renderedPosition) {
      return renderedPosition;
    }
    const runtimePlayer = state.runtimeSnapshot?.players?.find((entry) => entry.id === playerId) ?? null;
    if (!runtimePlayer?.position) {
      return null;
    }
    return new THREE.Vector3(
      Number(runtimePlayer.position.x ?? 0) || 0,
      Number(runtimePlayer.position.y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
      Number(runtimePlayer.position.z ?? 0) || 0,
    );
  };
  const participants = state.selectedWorld?.active_instance?.participants ?? [];
  const getParticipantByViewerSessionId = (viewerSessionId = "") => {
    const identity = parsePrivateViewerSessionId(viewerSessionId);
    if (!identity.subjectId) {
      return null;
    }
    if (identity.kind === "profile") {
      const profileId = identity.subjectId;
      return participants.find((entry) => String(entry.profile?.id ?? entry.profile_id ?? "").trim() === profileId) ?? null;
    }
    return participants.find(
      (entry) => String(entry.guest_session_id ?? entry.guestSessionId ?? "").trim() === identity.subjectId,
    ) ?? null;
  };
  if (normalized === getPrivateViewerSessionId()) {
    const localAvatarPosition = state.preview?.viewerAvatar?.group?.visible !== false
      ? state.preview?.viewerAvatar?.group?.position ?? null
      : null;
    if (localAvatarPosition) {
      return localAvatarPosition;
    }
    const localParticipant = getLocalParticipant();
    const occupiedPlayerPosition = getPlayerAnchorPosition(localParticipant?.player_entity_id);
    if (occupiedPlayerPosition) {
      return occupiedPlayerPosition;
    }
    const localPresencePosition = getPrivatePresencePosition();
    return state.preview?.viewerAvatar?.group?.position
      ?? new THREE.Vector3(localPresencePosition.x, localPresencePosition.y, localPresencePosition.z);
  }
  const renderedPresenceEntry = state.preview?.presenceEntries?.get(normalized) ?? null;
  const renderedPosition = renderedPresenceEntry?.group?.position ?? null;
  if (renderedPosition && renderedPresenceEntry.group.visible !== false) {
    return renderedPosition;
  }
  const entry = state.livePresence.get(normalized);
  if (entry) {
    return new THREE.Vector3(
      Number(entry.position_x ?? 0) || 0,
      Number(entry.position_y ?? PRIVATE_CAMERA.minY) || PRIVATE_CAMERA.minY,
      Number(entry.position_z ?? 0) || 0,
    );
  }
  const occupiedPlayerPosition = getPlayerAnchorPosition(getParticipantByViewerSessionId(normalized)?.player_entity_id);
  if (occupiedPlayerPosition) {
    return occupiedPlayerPosition;
  }
  return null;
}

function getPrivateBrowserHostAnchorGroup(hostSessionId = "") {
  const normalized = String(hostSessionId ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized === getPrivateViewerSessionId()) {
    const localGroup = state.preview?.viewerAvatar?.group ?? null;
    return localGroup?.visible !== false ? localGroup : null;
  }
  const presenceGroup = state.preview?.presenceEntries?.get(normalized)?.group ?? null;
  return presenceGroup?.visible !== false ? presenceGroup : null;
}

function setPrivateShareBubbleParent(entry, parent = null) {
  const nextParent = parent ?? state.preview?.browserShares ?? null;
  if (!entry?.group || !nextParent || entry.group.parent === nextParent) {
    return;
  }
  nextParent.add(entry.group);
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
  const spatialCenter = getPrivateBrowserSpatialCenter(session);
  if (!spatialCenter) {
    return "";
  }
  const listenerPosition = getPrivatePresencePosition();
  const planarDistance = Math.hypot(
    listenerPosition.x - spatialCenter.x,
    listenerPosition.z - spatialCenter.z,
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
  const spatialCenter = getPrivateBrowserSpatialCenter(session);
  if (!spatialCenter) {
    return 0;
  }
  const listenerPosition = getPrivatePresencePosition();
  const planarDistance = Math.hypot(
    listenerPosition.x - spatialCenter.x,
    listenerPosition.z - spatialCenter.z,
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
  const aspectRatio = Number(entry.session?.aspectRatio) || PRIVATE_BROWSER_SHARE.aspectRatio;
  if (Math.abs((entry.geometryAspectRatio ?? 0) - aspectRatio) < 0.01) {
    return;
  }
  const width = PRIVATE_BROWSER_SHARE.screenWidth;
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
  const aspectRatio = Number(entry.session?.aspectRatio) || PRIVATE_BROWSER_SHARE.aspectRatio;
  const baseWidth = PRIVATE_BROWSER_SHARE.screenWidth;
  const baseHeight = baseWidth / Math.max(0.1, aspectRatio);
  const bubbleWidth = shareKind === "audio"
    ? PRIVATE_BROWSER_SHARE.placeholderAudioWidth
    : PRIVATE_BROWSER_SHARE.placeholderVideoWidth;
  const bubbleHeight = bubbleWidth / PRIVATE_BROWSER_SHARE.placeholderAspectRatio;
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

  const aspectRatio = Number(session.aspectRatio) || PRIVATE_BROWSER_SHARE.aspectRatio;
  const width = PRIVATE_BROWSER_SHARE.screenWidth;
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
  frame.frustumCulled = false;
  frameShell.frustumCulled = false;
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

function getPrivateLocalPreviewBubbleSession() {
  const localPreviewShare = state.localBrowserShare?.hasVideo
    ? state.localBrowserShare
    : state.pendingBrowserShare?.hasVideo
      ? state.pendingBrowserShare
      : null;
  if (!localPreviewShare || !elements.panelBrowserVideo?.srcObject) {
    return null;
  }
  const realSessionId = String(state.localBrowserSessionId ?? "").trim();
  if (realSessionId && state.browserSessions.has(realSessionId)) {
    return null;
  }
  return {
    sessionId: realSessionId || PRIVATE_LOCAL_PREVIEW_SESSION_ID,
    hostSessionId: getPrivateViewerSessionId(),
    title: String(localPreviewShare.title ?? "").trim() || "Live share",
    shareKind: localPreviewShare.shareKind || "screen",
    hasVideo: true,
    hasAudio: localPreviewShare.hasAudio === true,
    aspectRatio: Number(localPreviewShare.aspectRatio) || PRIVATE_BROWSER_SHARE.aspectRatio,
    sessionMode: "display-share",
    frameTransport: "local-preview",
    deliveryMode: "full",
    _syntheticLocalPreview: true,
  };
}

function getPrivateShareBubbleSessions() {
  const sessions = [...state.browserSessions.values()];
  const localPreviewSession = getPrivateLocalPreviewBubbleSession();
  if (localPreviewSession) {
    sessions.push(localPreviewSession);
  }
  return sessions;
}

function reconcilePrivateShareBubbles() {
  const preview = state.preview;
  if (!preview?.browserShareEntries) {
    return;
  }
  const bubbleSessions = getPrivateShareBubbleSessions();
  const activeIds = new Set(bubbleSessions.map((session) => String(session.sessionId ?? "").trim()).filter(Boolean));
  for (const sessionId of [...preview.browserShareEntries.keys()]) {
    if (!activeIds.has(sessionId)) {
      removePrivateShareBubbleEntry(sessionId);
    }
  }
  for (const session of bubbleSessions) {
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

function getPrivateGameBubbleAspectRatio(session = {}) {
  const previewFrame = session?.latest_preview ?? null;
  if (previewFrame?.width && previewFrame?.height) {
    return Math.max(0.6, Math.min(2.4, Number(previewFrame.width) / Math.max(1, Number(previewFrame.height))));
  }
  return Math.max(0.6, Math.min(2.4, Number(session?.game?.manifest?.aspect_ratio) || PRIVATE_BROWSER_SHARE.aspectRatio));
}

function getPrivateGameBubblePlaceholderKey(session = {}) {
  const occupiedSeats = normalizePrivateGameSeats(session).filter((seat) => seat.viewer_session_id).length;
  return [
    getPrivateGameSessionTitle(session),
    getPrivateGameSessionDescription(session),
    String(session?.started === true),
    `${occupiedSeats}/${getPrivateGameSeatCapacity(session)}`,
  ].join(":");
}

function createPrivateGameBubbleTexture(session = {}) {
  const occupiedSeats = normalizePrivateGameSeats(session).filter((seat) => seat.viewer_session_id).length;
  const capacity = getPrivateGameSeatCapacity(session);
  const title = String(getPrivateGameSessionTitle(session) || "Nearby game").slice(0, 42);
  const description = String(getPrivateGameSessionDescription(session) || "").slice(0, 60);
  const statusLine = `${session?.started === true ? "Match live" : "Lobby open"} · ${occupiedSeats}/${capacity} seats`;
  const detail = description ? `${statusLine} · Click to open` : "Click to open and join";
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) {
    return createBubbleTexture("🎮", {
      accent: PRIVATE_WORLD_STYLE.accents[1],
      stroke: PRIVATE_WORLD_STYLE.outline,
      text: `${title}${description ? `\n${description}` : ""}`,
      label: "Live Game",
      width: 420,
      height: 300,
      maxLines: 4,
    });
  }
  context.fillStyle = "rgba(255, 255, 255, 0.98)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineWidth = 6;
  context.strokeStyle = "rgba(32, 50, 104, 0.2)";
  context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  context.fillStyle = PRIVATE_WORLD_STYLE.accents[1];
  context.fillRect(0, 0, canvas.width, 14);

  context.fillStyle = "#17305c";
  context.font = "700 44px Manrope, sans-serif";
  context.textBaseline = "top";
  context.fillText(title, 34, 42);

  context.fillStyle = "#4a6297";
  context.font = "600 28px Manrope, sans-serif";
  context.fillText(description || statusLine, 34, 112);

  context.font = "500 24px Manrope, sans-serif";
  context.fillText(detail, 34, 164);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function updatePrivateGameBubbleGeometry(entry) {
  if (!entry?.frame || !entry?.frameShell) {
    return;
  }
  const aspectRatio = getPrivateGameBubbleAspectRatio(entry.session);
  if (Math.abs((entry.geometryAspectRatio ?? 0) - aspectRatio) < 0.01) {
    return;
  }
  const width = PRIVATE_BROWSER_SHARE.screenWidth;
  const height = width / Math.max(0.1, aspectRatio);
  entry.frame.geometry.dispose();
  entry.frame.geometry = new THREE.PlaneGeometry(width, height);
  entry.frameShell.geometry.dispose();
  entry.frameShell.geometry = new THREE.PlaneGeometry(width + 1.2, height + 1.2);
  entry.geometryAspectRatio = aspectRatio;
}

function removePrivateGameBubbleEntry(sessionId = "") {
  const preview = state.preview;
  const entry = preview?.gameShareEntries?.get(String(sessionId ?? "").trim());
  if (!entry) {
    return;
  }
  preview.gameShareEntries.delete(entry.sessionId);
  preview.entityPickables = preview.entityPickables.filter((mesh) => mesh !== entry.frame);
  entry.group.parent?.remove(entry.group);
  entry.liveTexture?.dispose?.();
  entry.placeholderTexture?.dispose?.();
  entry.frame.geometry?.dispose?.();
  entry.frameShell.geometry?.dispose?.();
  entry.frame.material?.dispose?.();
  entry.frameShell.material?.dispose?.();
}

function ensurePrivateGameBubbleEntry(session = {}) {
  const preview = state.preview;
  if (!preview?.gameShares) {
    return null;
  }
  const sessionId = String(session.session_id ?? "").trim();
  if (!sessionId) {
    return null;
  }
  const existing = preview.gameShareEntries.get(sessionId);
  if (existing) {
    existing.session = { ...existing.session, ...session };
    existing.hostSessionId = String(session.host_viewer_session_id ?? existing.hostSessionId ?? "").trim();
    updatePrivateGameBubbleGeometry(existing);
    return existing;
  }
  const aspectRatio = getPrivateGameBubbleAspectRatio(session);
  const width = PRIVATE_BROWSER_SHARE.screenWidth;
  const height = width / aspectRatio;
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
  const placeholderTexture = createPrivateGameBubbleTexture(session);
  const frame = createPrivateBillboard(placeholderTexture, width, height, {
    opacity: 1,
    fog: false,
    depthTest: false,
    renderOrder: 10,
    persistent: true,
  });
  frame.frustumCulled = false;
  frame.userData.privateWorldGameSessionId = sessionId;
  preview.entityPickables.push(frame);
  group.add(frame);
  preview.gameShares.add(group);
  const entry = {
    sessionId,
    hostSessionId: String(session.host_viewer_session_id ?? "").trim(),
    session,
    group,
    frameShell,
    frame,
    liveImage,
    liveTexture,
    placeholderTexture,
    position: new THREE.Vector3(),
    targetPosition: new THREE.Vector3(),
    currentPreviewAt: "",
    geometryAspectRatio: aspectRatio,
    placeholderKey: getPrivateGameBubblePlaceholderKey(session),
  };
  preview.gameShareEntries.set(sessionId, entry);
  return entry;
}

function updatePrivateGameBubblePresentation(entry) {
  if (!entry?.frame) {
    return;
  }
  updatePrivateGameBubbleGeometry(entry);
  const nextPlaceholderKey = getPrivateGameBubblePlaceholderKey(entry.session);
  if (entry.placeholderKey !== nextPlaceholderKey) {
    entry.placeholderTexture?.dispose?.();
    entry.placeholderTexture = createPrivateGameBubbleTexture(entry.session);
    entry.placeholderKey = nextPlaceholderKey;
  }
  const previewFrame = entry.session?.latest_preview ?? null;
  if (previewFrame?.data_url && previewFrame.updated_at && previewFrame.updated_at !== entry.currentPreviewAt) {
    entry.currentPreviewAt = previewFrame.updated_at;
    entry.liveImage.src = previewFrame.data_url;
  }
  const desiredMap = previewFrame?.data_url ? entry.liveTexture : entry.placeholderTexture;
  const showingPlaceholder = desiredMap === entry.placeholderTexture;
  entry.frame.scale.set(1, 1, 1);
  entry.frame.position.set(0, 0, 0);
  entry.frame.material.depthTest = false;
  entry.frame.material.opacity = showingPlaceholder ? 0.99 : 1;
  entry.frame.renderOrder = 10;
  entry.frameShell.visible = true;
  entry.frameShell.material.opacity = showingPlaceholder ? 0.94 : 0.92;
  if (entry.frame.material.map !== desiredMap) {
    entry.frame.material.map = desiredMap;
    entry.frame.material.needsUpdate = true;
  }
  entry.frame.material.needsUpdate = true;
}

function updatePrivateGameBubbles(deltaSeconds = 0.016, elapsedSeconds = 0) {
  const preview = state.preview;
  if (!preview?.gameShareEntries) {
    return;
  }
  const activeSessions = [...state.gameSessions.values()];
  const activeIds = new Set(activeSessions.map((session) => String(session?.session_id ?? "").trim()).filter(Boolean));
  for (const sessionId of [...preview.gameShareEntries.keys()]) {
    if (!activeIds.has(sessionId)) {
      removePrivateGameBubbleEntry(sessionId);
    }
  }
  for (const session of activeSessions) {
    const entry = ensurePrivateGameBubbleEntry(session);
    if (!entry) {
      continue;
    }
    if (!preview.entityPickables.includes(entry.frame)) {
      preview.entityPickables.push(entry.frame);
    }
    entry.session = session;
    entry.hostSessionId = String(session.host_viewer_session_id ?? entry.hostSessionId ?? "").trim();
    const hostPosition = getPrivateBrowserHostPosition(entry.hostSessionId);
    if (!hostPosition) {
      entry.group.visible = false;
      continue;
    }
    entry.targetPosition.copy(hostPosition);
    entry.targetPosition.y += getSharedBrowserScreenOffsetY(true, elapsedSeconds);
    entry.position.lerp(entry.targetPosition, 1 - Math.exp(-deltaSeconds * 8));
    entry.group.position.copy(entry.position);
    entry.group.rotation.set(0, 0, 0);
    entry.group.visible = true;
    updatePrivateGameBubblePresentation(entry);
  }
}

function removePrivateBrowserAnchorEntry(anchorSessionId = "") {
  const preview = state.preview;
  const normalizedAnchorSessionId = String(anchorSessionId ?? "").trim();
  const entry = preview?.browserAnchorEntries?.get(normalizedAnchorSessionId);
  if (!entry) {
    return;
  }
  preview.browserAnchorEntries.delete(normalizedAnchorSessionId);
  entry.group.parent?.remove(entry.group);
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
}

function updatePrivateBrowserAnchorGeometry(entry) {
  if (!entry?.fill || !entry?.ring) {
    return;
  }
  if (Math.abs((entry.radius ?? 0) - PRIVATE_BROWSER_RADIUS) < 0.01) {
    return;
  }
  const ringInnerRadius = Math.max(0.1, PRIVATE_BROWSER_RADIUS - 2.2);
  entry.fill.geometry.dispose();
  entry.fill.geometry = new THREE.CircleGeometry(PRIVATE_BROWSER_RADIUS, 96);
  entry.ring.geometry.dispose();
  entry.ring.geometry = new THREE.RingGeometry(ringInnerRadius, PRIVATE_BROWSER_RADIUS, 96);
  entry.radius = PRIVATE_BROWSER_RADIUS;
}

function ensurePrivateBrowserAnchorEntry(session = {}) {
  const preview = state.preview;
  if (!preview?.browserAnchors) {
    return null;
  }
  const anchorSessionId = String(session.sessionId ?? "").trim();
  if (!anchorSessionId) {
    return null;
  }
  const existing = preview.browserAnchorEntries.get(anchorSessionId);
  if (existing) {
    existing.session = session;
    existing.hostSessionId = String(session.hostSessionId ?? existing.hostSessionId ?? "").trim();
    updatePrivateBrowserAnchorGeometry(existing);
    return existing;
  }
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(PRIVATE_BROWSER_RADIUS, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.accents[0]),
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.renderOrder = 3;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.1, PRIVATE_BROWSER_RADIUS - 2.2), PRIVATE_BROWSER_RADIUS, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PRIVATE_WORLD_STYLE.accents[0]),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 4;
  const group = new THREE.Group();
  group.add(fill);
  group.add(ring);
  preview.browserAnchors.add(group);
  const entry = {
    session,
    hostSessionId: String(session.hostSessionId ?? "").trim(),
    group,
    fill,
    ring,
    radius: PRIVATE_BROWSER_RADIUS,
  };
  preview.browserAnchorEntries.set(anchorSessionId, entry);
  return entry;
}

function reconcilePrivateBrowserAnchors() {
  const preview = state.preview;
  if (!preview?.browserAnchorEntries) {
    return;
  }
  const browserAnchorSessions = [...state.browserSessions.values()]
    .filter((session) =>
      isPrivateBrowserOriginSession(session)
      && session?.movementLocked === true
      && String(session?.sessionMode ?? "").trim() === "display-share");
  const gameAnchorSessions = [...state.gameSessions.values()]
    .filter((session) =>
      isPrivateGameOriginSession(session)
      && (session?.movement_locked === true || session?.movementLocked === true))
    .map((session) => ({
      sessionId: String(session?.session_id ?? "").trim(),
      hostSessionId: String(session?.host_viewer_session_id ?? "").trim(),
    }));
  const anchorSessions = [...browserAnchorSessions, ...gameAnchorSessions];
  const activeAnchorIds = new Set(
    anchorSessions
      .map((session) => String(session.sessionId ?? "").trim())
      .filter(Boolean),
  );
  for (const anchorSessionId of [...preview.browserAnchorEntries.keys()]) {
    if (!activeAnchorIds.has(anchorSessionId)) {
      removePrivateBrowserAnchorEntry(anchorSessionId);
    }
  }
  for (const session of anchorSessions) {
    if (!activeAnchorIds.has(String(session.sessionId ?? "").trim())) {
      continue;
    }
    ensurePrivateBrowserAnchorEntry(session);
  }
}

function updatePrivateBrowserAnchors() {
  const preview = state.preview;
  if (!preview?.browserAnchorEntries) {
    return;
  }
  reconcilePrivateBrowserAnchors();
  if (preview.browserAnchors) {
    preview.browserAnchors.visible = true;
  }
  for (const entry of preview.browserAnchorEntries.values()) {
    const hostPosition = getPrivateBrowserHostPosition(entry.hostSessionId);
    if (!hostPosition) {
      entry.group.visible = false;
      continue;
    }
    updatePrivateBrowserAnchorGeometry(entry);
    entry.group.visible = true;
    entry.group.position.set(hostPosition.x, hostPosition.y + 0.12, hostPosition.z);
  }
}

function updatePrivateShareBubbles(deltaSeconds, elapsedSeconds) {
  const preview = state.preview;
  if (!preview?.camera) {
    return;
  }
  reconcilePrivateShareBubbles();
  updatePrivateBrowserAnchors();
  const bubbleSessions = getPrivateShareBubbleSessions();
  if (bubbleSessions.length === 0) {
    return;
  }
  for (const session of bubbleSessions) {
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
    const hostAnchorGroup = getPrivateBrowserHostAnchorGroup(session.hostSessionId);
    const offsetY = getSharedBrowserScreenOffsetY(showingLiveMedia, elapsedSeconds);
    setPrivateShareBubbleParent(entry, hostAnchorGroup);
    entry.group.visible = true;
    entry.group.rotation.set(0, 0, 0);
    if (hostAnchorGroup) {
      entry.group.position.set(0, offsetY, 0);
    } else {
      entry.targetPosition.copy(hostPosition);
      entry.targetPosition.y += offsetY;
      entry.position.lerp(entry.targetPosition, 1 - Math.exp(-deltaSeconds * 8));
      entry.group.position.copy(entry.position);
    }
    orientPrivateBillboardToCamera(entry.frame, preview.camera);
  }
}

function updatePrivateChatBubbleGhosts(preview, deltaSeconds, camera = preview?.camera) {
  updateChatBubbleGhosts({
    entries: preview?.animatedChatBubbleGhosts ?? null,
    deltaSeconds,
    camera,
    orientToCamera: orientPrivateBillboardToCamera,
    removeGhost: (entry) => removePrivateChatBubbleGhost(preview, entry),
  });
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
  return state.session ? "worlds" : "access";
}

function getLauncherTitle() {
  if (state.launcherTab === "access") {
    if (!state.authReady) {
      return "Checking Account";
    }
    return state.session ? "Account" : "Sign In";
  }
  return "Select Worlds";
}

function renderLauncherTitle() {
  if (elements.launcherTitle) {
    elements.launcherTitle.textContent = getLauncherTitle();
  }
}

function normalizeLauncherWorldTab(tab) {
  return LAUNCHER_WORLD_BROWSER_TABS.has(tab) ? tab : "mine";
}

function getLauncherSearchPlaceholder() {
  return normalizeLauncherWorldTab(state.launcherWorldTab) === "all"
    ? "Search all private worlds"
    : "Search your private worlds";
}

function renderLauncherWorldTabs() {
  const activeTab = normalizeLauncherWorldTab(state.launcherWorldTab);
  state.launcherWorldTab = activeTab;
  for (const button of elements.launcherWorldTabButtons ?? []) {
    const isActive = button.getAttribute("data-launcher-world-tab") === activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }
  if (elements.worldSearch) {
    elements.worldSearch.placeholder = getLauncherSearchPlaceholder();
  }
  if (elements.launcherWorldTypeField) {
    elements.launcherWorldTypeField.hidden = activeTab !== "all";
  }
  if (elements.publicWorldType) {
    elements.publicWorldType.disabled = activeTab !== "all";
  }
}

function setLauncherWorldTab(tab, options = {}) {
  state.launcherWorldTab = normalizeLauncherWorldTab(tab);
  renderLauncherWorldTabs();
  renderLauncherWorldBrowser();
  if (options.load === false) {
    return;
  }
  if (state.launcherWorldTab === "all") {
    void loadPublicWorlds();
    return;
  }
  if (state.session) {
    void loadWorlds();
  }
}

function setLauncherTab(tab) {
  const nextTab = LAUNCHER_TABS.has(tab) ? tab : getPreferredLauncherTab();
  state.launcherTab = nextTab;
  if (nextTab !== "worlds" || !state.session) {
    state.createWorldDialogOpen = false;
  }
  for (const section of elements.launcherSections ?? []) {
    const active = section.getAttribute("data-launcher-section") === nextTab;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  }
  renderLauncherTitle();
  renderLauncherWorldTabs();
}

function getViewerSpawnPosition(world = state.selectedWorld) {
  if (!world) {
    return new THREE.Vector3(0, PRIVATE_CAMERA.minY, 0);
  }
  const rig = getPrivateViewerRigConfig(world);
  const width = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world?.width ?? PRIVATE_WORLD_DEFAULT_SIZE.width) || PRIVATE_WORLD_DEFAULT_SIZE.width);
  const length = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world?.length ?? PRIVATE_WORLD_DEFAULT_SIZE.length) || PRIVATE_WORLD_DEFAULT_SIZE.length);
  return new THREE.Vector3(
    clampNumber(-width * 0.06, -2, -4, 4),
    rig.spawnHeight,
    clampNumber(length * 0.08, 0, -4, 8),
  );
}

function getPrivateViewerRigConfig(world = state.selectedWorld) {
  const width = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world?.width ?? PRIVATE_WORLD_DEFAULT_SIZE.width) || PRIVATE_WORLD_DEFAULT_SIZE.width);
  const length = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world?.length ?? PRIVATE_WORLD_DEFAULT_SIZE.length) || PRIVATE_WORLD_DEFAULT_SIZE.length);
  const height = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 2, Number(world?.height ?? PRIVATE_WORLD_DEFAULT_SIZE.height) || PRIVATE_WORLD_DEFAULT_SIZE.height);
  const minRadius = PRIVATE_PLAYER_VIEW.minRadius;
  const defaultRadius = PRIVATE_PLAYER_VIEW.defaultRadius;
  const maxRadius = PRIVATE_PLAYER_VIEW.maxRadius;
  const spawnHeight = PRIVATE_CAMERA.minY;
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
  state.buildSuppressedClick = null;
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
  { kind: "voxel", key: "voxels", label: "Voxels", singular: "Voxel" },
  { kind: "primitive", key: "primitives", label: "Objects", singular: "Object" },
  { kind: "panel", key: "panels", label: "Panels", singular: "Panel" },
  { kind: "model", key: "models", label: "Models", singular: "Model" },
  { kind: "player", key: "players", label: "Players", singular: "Player" },
  { kind: "screen", key: "screens", label: "Screens", singular: "Screen" },
  { kind: "text", key: "texts", label: "3D Text", singular: "3D Text" },
  { kind: "trigger", key: "trigger_zones", label: "Trigger Zones", singular: "Trigger Zone" },
  { kind: "particle", key: "particles", label: "Particles", singular: "Particle" },
  { kind: "prefab_instance", key: "prefab_instances", label: "Prefab Instances", singular: "Prefab Instance" },
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

const PRIMITIVE_SHAPES = ["box", "sphere", "capsule", "cylinder", "cone", "plane", "panel"];
const PLAYER_CAMERA_MODES = ["third_person", "first_person", "top_down"];
const PLAYER_BODY_MODES = ["rigid", "ghost"];
const EFFECT_OPTIONS = ["", "sparkles", "smoke", "glow", "embers", "mist"];
const TRAIL_OPTIONS = ["", "ribbon", "glow", "spark", "comet"];
const SCRIPT_FUNCTION_HEADER_RE = /^#\s*function(?:\[([a-z0-9_-]+)\])?:\s*(.*)$/i;

function isPlacementToolKind(kind) {
  return kind === "voxel"
    || kind === "primitive"
    || kind === "panel"
    || kind === "player"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger";
}

function isToolPresetKind(kind) {
  return TOOL_PRESET_KINDS.includes(kind);
}

function getToolPresetOptions(kind) {
  if (!isToolPresetKind(kind)) {
    return [];
  }
  return [
    ...(TOOL_PRESET_BUILTINS[kind] ?? []),
    ...(state.toolPresetCustoms?.[kind] ?? []),
  ];
}

function getSelectedToolPresetId(kind) {
  const options = getToolPresetOptions(kind);
  const selectedId = String(state.toolPresetSelection?.[kind] ?? "").trim();
  if (options.some((preset) => preset.id === selectedId)) {
    return selectedId;
  }
  return options[0]?.id || "";
}

function getToolPreset(kind, presetId = getSelectedToolPresetId(kind)) {
  return getToolPresetOptions(kind).find((preset) => preset.id === presetId) ?? null;
}

function persistToolPresetState() {
  try {
    window.localStorage.setItem(TOOL_PRESET_STORAGE_KEY, JSON.stringify({
      selected: state.toolPresetSelection,
      customs: state.toolPresetCustoms,
    }));
  } catch (_error) {
    // local storage can fail in private browsing; presets still work for this session
  }
}

function setSelectedToolPreset(kind, presetId) {
  if (!isToolPresetKind(kind)) {
    return;
  }
  const nextPresetId = String(presetId ?? "").trim();
  const options = getToolPresetOptions(kind);
  const resolvedPresetId = options.some((preset) => preset.id === nextPresetId)
    ? nextPresetId
    : (options[0]?.id || "");
  state.toolPresetSelection[kind] = resolvedPresetId;
  persistToolPresetState();
  renderToolPresetPanel();
  updateShellState();
}

function buildToolPresetDisplayName(kind) {
  if (kind === "voxel") {
    return "Voxel";
  }
  if (kind === "primitive") {
    return "Object";
  }
  if (kind === "panel") {
    return "Panel";
  }
  if (kind === "player") {
    return "Player";
  }
  if (kind === "model") {
    return "Model";
  }
  if (kind === "screen") {
    return "Screen";
  }
  if (kind === "text") {
    return "Text";
  }
  if (kind === "trigger") {
    return "Trigger";
  }
  return "Tool";
}

function createCustomToolPresetId(kind, name = "") {
  const baseToken = slugToken(name) || `${kind}-preset`;
  let nextId = `custom-${baseToken}-${Date.now().toString(36)}`;
  let suffix = 1;
  while (getToolPresetOptions(kind).some((preset) => preset.id === nextId)) {
    suffix += 1;
    nextId = `custom-${baseToken}-${Date.now().toString(36)}-${suffix}`;
  }
  return nextId;
}

function getSelectedEntityForToolPreset(kind) {
  if (!isToolPresetKind(kind)) {
    return null;
  }
  try {
    const sceneDoc = parseSceneTextarea();
    const selected = getSelectedEntity(sceneDoc);
    if (!selected || selected.kind !== kind) {
      return null;
    }
    return selected.entry;
  } catch (_error) {
    return null;
  }
}

function saveToolPreset(kind, options = {}) {
  if (!isToolPresetKind(kind)) {
    return;
  }
  const sourceEntry = options.sourceEntry
    ? extractToolPresetEntry(kind, options.sourceEntry)
    : extractToolPresetEntry(kind, getToolPreset(kind)?.entry ?? createBaseToolPresetEntry(kind));
  const nextName = String(options.name ?? "").trim() || `${buildToolPresetDisplayName(kind)} Preset ${Math.max(1, (state.toolPresetCustoms?.[kind] ?? []).length + 1)}`;
  const nextPreset = {
    id: createCustomToolPresetId(kind, nextName),
    name: nextName,
    builtin: false,
    entry: sourceEntry,
  };
  state.toolPresetCustoms[kind] = [
    ...(state.toolPresetCustoms?.[kind] ?? []),
    nextPreset,
  ];
  state.toolPresetSelection[kind] = nextPreset.id;
  persistToolPresetState();
  renderToolPresetPanel();
  updateShellState();
}

function updateCustomToolPreset(kind, presetId, sourceEntry) {
  if (!isToolPresetKind(kind) || !sourceEntry) {
    return;
  }
  const nextPresets = [...(state.toolPresetCustoms?.[kind] ?? [])];
  const targetIndex = nextPresets.findIndex((preset) => preset.id === presetId);
  if (targetIndex < 0) {
    return;
  }
  nextPresets[targetIndex] = {
    ...nextPresets[targetIndex],
    entry: extractToolPresetEntry(kind, sourceEntry),
  };
  state.toolPresetCustoms[kind] = nextPresets;
  persistToolPresetState();
  renderToolPresetPanel();
  updateShellState();
}

function deleteCustomToolPreset(kind, presetId) {
  if (!isToolPresetKind(kind)) {
    return;
  }
  state.toolPresetCustoms[kind] = (state.toolPresetCustoms?.[kind] ?? []).filter((preset) => preset.id !== presetId);
  const fallbackPresetId = getToolPresetOptions(kind).find((preset) => preset.id !== presetId)?.id || "";
  state.toolPresetSelection[kind] = fallbackPresetId;
  persistToolPresetState();
  renderToolPresetPanel();
  updateShellState();
}

function getPlacementToolButton(kind) {
  if (kind === "voxel") {
    return elements.addVoxel;
  }
  if (kind === "primitive") {
    return elements.addPrimitive;
  }
  if (kind === "panel") {
    return elements.addPanel;
  }
  if (kind === "player") {
    return elements.addPlayer;
  }
  if (kind === "screen") {
    return elements.addScreen;
  }
  if (kind === "text") {
    return elements.addText;
  }
  if (kind === "trigger") {
    return elements.addTrigger;
  }
  return null;
}

function canUsePlacementTools() {
  return Boolean(state.selectedWorld && isEditor() && state.mode === "build");
}

function getActivePlacementTool() {
  const temporary = String(state.placementShortcutTool ?? "").trim();
  if (isPlacementToolKind(temporary)) {
    return temporary;
  }
  const persistent = String(state.placementTool ?? "").trim();
  return isPlacementToolKind(persistent) ? persistent : "";
}

function getActivePrefabPlacementId() {
  return canUsePlacementTools() ? String(state.prefabPlacementId ?? "").trim() : "";
}

function clearPlacementTool(options = {}) {
  const temporaryOnly = options.temporaryOnly === true;
  if (temporaryOnly) {
    state.placementShortcutTool = "";
  } else {
    state.placementShortcutTool = "";
    state.placementTool = "";
    state.prefabPlacementId = "";
  }
  if (state.previewPointer.inside && canUsePlacementTools()) {
    refreshBuildHoverFromStoredPointer();
  } else {
    state.buildHover = null;
    syncBuildPlacementOverlay();
  }
  updateShellState();
}

function setPlacementTool(kind, options = {}) {
  const normalized = isPlacementToolKind(kind) ? kind : "";
  if (!canUsePlacementTools() && normalized) {
    return;
  }
  if (options.temporary === true) {
    state.placementShortcutTool = normalized;
  } else {
    state.prefabPlacementId = "";
    state.placementTool = normalized && state.placementTool === normalized ? "" : normalized;
  }
  refreshBuildHoverFromStoredPointer();
  syncBuildPlacementOverlay();
  updateShellState();
}

function armPrefabPlacement(prefabId = state.selectedPrefabId, options = {}) {
  const normalizedPrefabId = String(prefabId ?? "").trim();
  if (!canUsePlacementTools()) {
    return;
  }
  state.selectedPrefabId = normalizedPrefabId;
  state.placementShortcutTool = "";
  state.placementTool = "";
  state.prefabPlacementId = options.toggle === true && state.prefabPlacementId === normalizedPrefabId ? "" : normalizedPrefabId;
  refreshBuildHoverFromStoredPointer();
  syncBuildPlacementOverlay();
  updateShellState();
}

function buildPlacementToolLabel(kind) {
  const shortcut = [...BUILD_PLACEMENT_SHORTCUTS.entries()].find(([, value]) => value === kind)?.[0] || "";
  const presetName = getToolPreset(kind)?.name || "";
  const suffix = presetName ? ` · ${presetName}` : "";
  if (kind === "voxel") {
    return `${shortcut ? `Voxel (${shortcut})` : "Voxel"}${suffix}`;
  }
  if (kind === "primitive") {
    return `${shortcut ? `Object (${shortcut})` : "Object"}${suffix}`;
  }
  if (kind === "panel") {
    return `${shortcut ? `Panel (${shortcut})` : "Panel"}${suffix}`;
  }
  if (kind === "player") {
    return `${shortcut ? `Player (${shortcut})` : "Player"}${suffix}`;
  }
  if (kind === "screen") {
    return `${shortcut ? `Screen (${shortcut})` : "Screen"}${suffix}`;
  }
  if (kind === "text") {
    return `${shortcut ? `Text (${shortcut})` : "Text"}${suffix}`;
  }
  if (kind === "trigger") {
    return `${shortcut ? `Trigger (${shortcut})` : "Trigger"}${suffix}`;
  }
  return "";
}

function getPlacementShortcutTool(event) {
  const key = String(event?.key ?? "").trim();
  if (BUILD_PLACEMENT_SHORTCUTS.has(key)) {
    return BUILD_PLACEMENT_SHORTCUTS.get(key) || "";
  }
  const code = String(event?.code ?? "").trim();
  if (code.startsWith("Digit")) {
    return BUILD_PLACEMENT_SHORTCUTS.get(code.slice(5)) || "";
  }
  if (code.startsWith("Numpad")) {
    return BUILD_PLACEMENT_SHORTCUTS.get(code.slice(6)) || "";
  }
  return "";
}

function getBuildTransformAxisShortcut(event) {
  const key = String(event?.key ?? "").trim();
  if (BUILD_TRANSFORM_AXIS_SHORTCUTS.has(key)) {
    return BUILD_TRANSFORM_AXIS_SHORTCUTS.get(key) || "";
  }
  const code = String(event?.code ?? "").trim();
  if (code.startsWith("Digit")) {
    return BUILD_TRANSFORM_AXIS_SHORTCUTS.get(code.slice(5)) || "";
  }
  if (code.startsWith("Numpad")) {
    return BUILD_TRANSFORM_AXIS_SHORTCUTS.get(code.slice(6)) || "";
  }
  return "";
}

function createEntityRef(kind, id) {
  const normalizedKind = String(kind ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  if (!normalizedKind || !normalizedId) {
    return null;
  }
  return {
    kind: normalizedKind,
    id: normalizedId,
  };
}

function isSameEntityRef(left, right) {
  return Boolean(
    left
    && right
    && String(left.kind ?? "").trim() === String(right.kind ?? "").trim()
    && String(left.id ?? "").trim() === String(right.id ?? "").trim(),
  );
}

function normalizeEntityRefs(refs = []) {
  const normalized = [];
  for (const ref of refs) {
    const next = createEntityRef(ref?.kind, ref?.id);
    if (!next || normalized.some((entry) => isSameEntityRef(entry, next))) {
      continue;
    }
    normalized.push(next);
  }
  return normalized;
}

function writeBuilderSelection(refs = [], primaryRef = null) {
  const normalizedRefs = normalizeEntityRefs(refs);
  const normalizedPrimary = createEntityRef(primaryRef?.kind, primaryRef?.id)
    ?? normalizedRefs[normalizedRefs.length - 1]
    ?? null;
  if (!normalizedPrimary) {
    state.builderSelection = null;
    state.builderSelectionSet = [];
    return;
  }
  const orderedRefs = normalizedRefs.filter((entry) => !isSameEntityRef(entry, normalizedPrimary));
  orderedRefs.push(normalizedPrimary);
  state.builderSelection = normalizedPrimary;
  state.builderSelectionSet = orderedRefs.length > 1 ? orderedRefs : [];
}

function getBuilderSelectionRefs() {
  if (state.builderSelectionSet?.length) {
    return normalizeEntityRefs(state.builderSelectionSet);
  }
  const primary = createEntityRef(state.builderSelection?.kind, state.builderSelection?.id);
  return primary ? [primary] : [];
}

function getEntityPersistentGroupId(entry = {}) {
  return String(entry?.group_id ?? "").trim();
}

function getPersistentGroupRefs(sceneDoc, groupId = "") {
  const normalizedGroupId = String(groupId ?? "").trim();
  if (!normalizedGroupId) {
    return [];
  }
  const refs = [];
  for (const config of ENTITY_COLLECTIONS) {
    for (const entry of getEntityArray(sceneDoc, config.key)) {
      if (getEntityPersistentGroupId(entry) !== normalizedGroupId) {
        continue;
      }
      refs.push({ kind: config.kind, id: entry.id });
    }
  }
  return normalizeEntityRefs(refs);
}

function expandSelectionRefsWithPersistentGroups(refs = [], sceneDoc) {
  const normalizedRefs = normalizeEntityRefs(refs);
  if (!sceneDoc || !normalizedRefs.length) {
    return normalizedRefs;
  }
  const expanded = [...normalizedRefs];
  for (const ref of normalizedRefs) {
    const selected = findEntityByRef(sceneDoc, ref);
    const groupId = getEntityPersistentGroupId(selected?.entry);
    if (!groupId) {
      continue;
    }
    for (const groupedRef of getPersistentGroupRefs(sceneDoc, groupId)) {
      if (!expanded.some((entry) => isSameEntityRef(entry, groupedRef))) {
        expanded.push(groupedRef);
      }
    }
  }
  return normalizeEntityRefs(expanded);
}

function getSelectionPersistentGroupInfo(sceneDoc = parseSceneTextarea(), selectedEntities = getSelectedEntities(sceneDoc)) {
  const selectedRefs = normalizeEntityRefs(selectedEntities.map((entry) => ({ kind: entry.kind, id: entry.entry.id })));
  const groupIds = [...new Set(selectedEntities.map((entry) => getEntityPersistentGroupId(entry.entry)).filter(Boolean))];
  if (groupIds.length !== 1) {
    return {
      groupId: "",
      memberRefs: [],
      isWholeGroupSelected: false,
    };
  }
  const memberRefs = getPersistentGroupRefs(sceneDoc, groupIds[0]);
  const isWholeGroupSelected = memberRefs.length > 1
    && memberRefs.length === selectedRefs.length
    && memberRefs.every((memberRef) => selectedRefs.some((selectedRef) => isSameEntityRef(selectedRef, memberRef)));
  return {
    groupId: groupIds[0],
    memberRefs,
    isWholeGroupSelected,
  };
}

function createNextPersistentGroupId(sceneDoc) {
  const usedGroupIds = new Set();
  for (const config of ENTITY_COLLECTIONS) {
    for (const entry of getEntityArray(sceneDoc, config.key)) {
      const groupId = getEntityPersistentGroupId(entry);
      if (groupId) {
        usedGroupIds.add(groupId);
      }
    }
  }
  let index = 1;
  while (usedGroupIds.has(`group_${index}`)) {
    index += 1;
  }
  return `group_${index}`;
}

function hasBuilderSelection() {
  return getBuilderSelectionRefs().length > 0;
}

function isEntitySelected(kind, id) {
  const ref = createEntityRef(kind, id);
  return Boolean(ref && getBuilderSelectionRefs().some((entry) => isSameEntityRef(entry, ref)));
}

function getBuildTransformShortcut(event) {
  return BUILD_TRANSFORM_SHORTCUTS.get(normalizeRuntimeKey(event)) || "";
}

function hasBuildTransformAxisModifier() {
  return state.buildModifierKeys.has("q")
    || state.buildModifierKeys.has("e")
    || state.buildModifierKeys.has("r");
}

function getBuildTransformAxisLock(transformMode = getBuildTransformMode()) {
  if (transformMode !== "move" && transformMode !== "scale" && transformMode !== "rotate") {
    return "";
  }
  for (const key of ["1", "2", "3"]) {
    if (state.buildModifierKeys.has(key)) {
      return BUILD_TRANSFORM_AXIS_SHORTCUTS.get(key) || "";
    }
  }
  return "";
}

function canUseBuildTransformShortcuts() {
  return canUsePlacementTools() && !getActivePlacementTool() && !getActivePrefabPlacementId();
}

function getBuildTransformMode() {
  if (!canUseBuildTransformShortcuts()) {
    return "";
  }
  if (state.buildModifierKeys.has("t")) {
    return "delete";
  }
  if (state.buildModifierKeys.has("r")) {
    return "rotate";
  }
  if (state.buildModifierKeys.has("e")) {
    return "scale";
  }
  if (state.buildModifierKeys.has("q")) {
    return "move";
  }
  if (state.buildModifierKeys.has("shift")) {
    return "multi";
  }
  return "";
}

function getResolvedBuildTransformMode(transformMode = getBuildTransformMode(), sceneDoc = null) {
  if (!transformMode || (transformMode !== "scale" && transformMode !== "rotate")) {
    return transformMode;
  }
  if (Array.isArray(sceneDoc)) {
    return resolveBuildTransformModeForSelection(transformMode, sceneDoc);
  }
  try {
    return resolveBuildTransformModeForSelection(transformMode, getSelectedEntities(sceneDoc ?? parseSceneTextarea()));
  } catch (_error) {
    return transformMode;
  }
}

function resolveBuildTransformModeForSelection(transformMode = "", selectedEntities = []) {
  if (!transformMode || (transformMode !== "scale" && transformMode !== "rotate")) {
    return transformMode;
  }
  if (selectedEntities.length > 1 && !canGroupScaleRotateSelection(selectedEntities)) {
    return "move";
  }
  return transformMode;
}

function getEntityCollection(key) {
  return ENTITY_COLLECTIONS.find((entry) => entry.key === key || entry.kind === key) ?? null;
}

function getEntityArray(sceneDoc, key) {
  return Array.isArray(sceneDoc?.[key]) ? sceneDoc[key] : [];
}

function findEntityByRef(sceneDoc, ref) {
  const normalizedRef = createEntityRef(ref?.kind, ref?.id);
  if (!normalizedRef) {
    return null;
  }
  const config = getEntityCollection(normalizedRef.kind);
  if (!config) {
    return null;
  }
  const entries = getEntityArray(sceneDoc, config.key);
  const index = entries.findIndex((entry) => entry.id === normalizedRef.id);
  if (index < 0) {
    return null;
  }
  return {
    ...config,
    index,
    entry: entries[index],
  };
}

function getDisplayNameForEntity(kind, entry = {}, index = 0) {
  if (kind === "voxel") {
    return entry.id || `Voxel ${index + 1}`;
  }
  if (kind === "primitive") {
    return entry.label || entry.id || `Object ${index + 1}`;
  }
  if (kind === "panel") {
    return entry.label || entry.id || `Panel ${index + 1}`;
  }
  if (kind === "model") {
    return entry.label || entry.id || `Model ${index + 1}`;
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

function truncatePrivateUiLabel(value = "", maxLength = 48) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}

function buildCompactEntityTitle(kind, entry = {}, index = 0) {
  const config = getEntityCollection(kind);
  const fallbackLabel = config?.singular || "Item";
  if (kind === "text") {
    const value = truncatePrivateUiLabel(entry.value, 42);
    return value || `${fallbackLabel} ${index + 1}`;
  }
  const label = String(entry.label ?? "").trim();
  if (label) {
    return truncatePrivateUiLabel(label, 42);
  }
  if (kind === "model" && String(entry.asset_id ?? "").trim()) {
    return truncatePrivateUiLabel(`Model ${index + 1}`, 42);
  }
  if (kind === "screen") {
    return `Screen ${index + 1}`;
  }
  if (kind === "panel") {
    return `Panel ${index + 1}`;
  }
  if (kind === "primitive") {
    return `Object ${index + 1}`;
  }
  if (kind === "voxel") {
    return `Voxel ${index + 1}`;
  }
  if (kind === "player") {
    return `Player ${index + 1}`;
  }
  if (kind === "trigger") {
    return `Trigger ${index + 1}`;
  }
  if (kind === "particle") {
    return `Particle ${index + 1}`;
  }
  if (kind === "prefab_instance") {
    return `Prefab ${index + 1}`;
  }
  return `${fallbackLabel} ${index + 1}`;
}

function getSelectedEntity(sceneDoc = parseSceneTextarea()) {
  return findEntityByRef(sceneDoc, state.builderSelection);
}

function getSelectedEntities(sceneDoc = parseSceneTextarea()) {
  return getBuilderSelectionRefs()
    .map((ref) => findEntityByRef(sceneDoc, ref))
    .filter(Boolean);
}

function ensureBuilderSelection(sceneDoc = parseSceneTextarea()) {
  const expandedRefs = expandSelectionRefsWithPersistentGroups(getBuilderSelectionRefs(), sceneDoc);
  const validSelections = expandedRefs
    .map((ref) => findEntityByRef(sceneDoc, ref))
    .filter(Boolean);
  if (!validSelections.length) {
    writeBuilderSelection([]);
    return null;
  }
  const selected = validSelections.find((entry) => isSameEntityRef({ kind: entry.kind, id: entry.entry.id }, state.builderSelection))
    ?? validSelections[validSelections.length - 1];
  writeBuilderSelection(
    validSelections.map((entry) => ({ kind: entry.kind, id: entry.entry.id })),
    { kind: selected.kind, id: selected.entry.id },
  );
  return selected;
}

function setBuilderSelection(kind, id, options = {}) {
  const nextRef = createEntityRef(kind, id);
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    sceneDoc = null;
  }
  if (!nextRef) {
    writeBuilderSelection([]);
  } else if (options.append === true) {
    const nextRefs = getBuilderSelectionRefs();
    if (!nextRefs.some((entry) => isSameEntityRef(entry, nextRef))) {
      nextRefs.push(nextRef);
    }
    writeBuilderSelection(expandSelectionRefsWithPersistentGroups(nextRefs, sceneDoc), nextRef);
  } else {
    writeBuilderSelection(expandSelectionRefsWithPersistentGroups([nextRef], sceneDoc), nextRef);
  }
  updateShellState();
  renderSceneBuilder();
  updatePreviewFromSelection();
}

function getAiProviderFieldNames(group) {
  if (group === "image") {
    return {
      provider: "imageProvider",
      model: "imageModel",
      apiKey: "imageApiKey",
    };
  }
  if (group === "model") {
    return {
      provider: "modelProvider",
      model: "modelModel",
      apiKey: "modelApiKey",
    };
  }
  return {
    provider: "reasoningProvider",
    model: "reasoningModel",
    apiKey: "reasoningApiKey",
  };
}

function readAiProviderState(group) {
  const storageKey = AI_PROVIDER_SESSION_KEYS[group];
  if (!storageKey) {
    return { provider: "openai", model: "", apiKey: "" };
  }
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}");
    return {
      provider: String(parsed.provider ?? "openai").trim() || "openai",
      model: String(parsed.model ?? "").trim(),
      apiKey: String(parsed.apiKey ?? "").trim(),
    };
  } catch (_error) {
    return {
      provider: group === "model" ? "meshy" : "openai",
      model: "",
      apiKey: "",
    };
  }
}

function writeAiProviderState(group, value = {}) {
  const storageKey = AI_PROVIDER_SESSION_KEYS[group];
  if (!storageKey) {
    return;
  }
  const nextValue = {
    provider: String(value.provider ?? "").trim(),
    model: String(value.model ?? "").trim(),
    apiKey: String(value.apiKey ?? "").trim(),
  };
  if (!nextValue.provider && !nextValue.model && !nextValue.apiKey) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }
  window.sessionStorage.setItem(storageKey, JSON.stringify(nextValue));
}

function getAiProviderState(group) {
  const names = getAiProviderFieldNames(group);
  const stored = readAiProviderState(group);
  return {
    provider: String(elements.aiForm?.elements?.[names.provider]?.value ?? stored.provider ?? "").trim() || stored.provider || (group === "model" ? "meshy" : "openai"),
    model: String(elements.aiForm?.elements?.[names.model]?.value ?? stored.model ?? "").trim() || stored.model || "",
    apiKey: String(elements.aiForm?.elements?.[names.apiKey]?.value ?? stored.apiKey ?? "").trim() || stored.apiKey || "",
  };
}

function syncAiProviderFormFromSession() {
  for (const group of ["reasoning", "image", "model"]) {
    const names = getAiProviderFieldNames(group);
    const value = readAiProviderState(group);
    if (elements.aiForm?.elements?.[names.provider] && !elements.aiForm.elements[names.provider].value) {
      elements.aiForm.elements[names.provider].value = value.provider || (group === "model" ? "meshy" : "openai");
    }
    if (elements.aiForm?.elements?.[names.model] && !elements.aiForm.elements[names.model].value) {
      elements.aiForm.elements[names.model].value = value.model
        || (group === "reasoning" ? "gpt-5.4-mini" : group === "image" ? "gpt-image-1" : "meshy-4");
    }
    if (elements.aiForm?.elements?.[names.apiKey]) {
      elements.aiForm.elements[names.apiKey].value = value.apiKey || "";
    }
  }
}

function setAiBuilderStatus(text = "", tone = "") {
  if (!elements.aiStatus) {
    return;
  }
  elements.aiStatus.textContent = String(text ?? "");
  if (tone) {
    elements.aiStatus.dataset.tone = tone;
  } else {
    delete elements.aiStatus.dataset.tone;
  }
}

function refreshAiBuilderStatus() {
  const reasoning = getAiProviderState("reasoning");
  const image = getAiProviderState("image");
  const model = getAiProviderState("model");
  if (!state.session) {
    setAiBuilderStatus("Sign in to use AI Builder.", "error");
    return;
  }
  if (!reasoning.apiKey) {
    setAiBuilderStatus("Add your text reasoning API key to enable brainstorming and generation.", "error");
    return;
  }
  const readyBits = [
    `Reasoning ${reasoning.provider}${reasoning.model ? ` · ${reasoning.model}` : ""}`,
    image.apiKey ? `Texture ${image.provider}${image.model ? ` · ${image.model}` : ""}` : "Texture key missing",
    model.apiKey ? `3D ${model.provider}${model.model ? ` · ${model.model}` : ""}` : "3D key missing",
  ];
  setAiBuilderStatus(readyBits.join(" | "), image.apiKey && model.apiKey ? "success" : "");
}

function cloneAiDialogMessages(messages = []) {
  return Array.isArray(messages)
    ? messages
      .map((entry) => ({
        role: String(entry?.role ?? "user").trim().toLowerCase() === "assistant" ? "assistant" : "user",
        text: String(entry?.text ?? "").trim(),
      }))
      .filter((entry) => entry.text)
    : [];
}

function cloneAiDialogState(dialog = {}) {
  return {
    ...createEmptyAiDialogState(),
    ...dialog,
    messages: cloneAiDialogMessages(dialog.messages),
    generatedAsset: dialog.generatedAsset ? deepClone(dialog.generatedAsset) : null,
  };
}

function getAiDialogThreadKey(config = {}) {
  const artifactType = String(config.artifactType ?? "screen_html").trim().toLowerCase() || "screen_html";
  const targetKind = String(config.targetKind ?? "world").trim().toLowerCase() || "world";
  const targetId = String(config.targetId ?? "world").trim() || "world";
  return `${artifactType}:${targetKind}:${targetId}`;
}

function persistAiDialogThreadState() {
  if (!state.aiDialog.key) {
    return;
  }
  state.aiThreadDrafts.set(state.aiDialog.key, cloneAiDialogState({
    ...state.aiDialog,
    open: false,
    busy: false,
  }));
}

function setAiDialogStatus(text = "", tone = "") {
  state.aiDialog.status = String(text ?? "");
  state.aiDialog.statusTone = String(tone ?? "");
}

function renderAiDialog() {
  const dialog = state.aiDialog;
  if (elements.aiDialogBackdrop) {
    elements.aiDialogBackdrop.hidden = !dialog.open;
  }
  if (elements.aiDialog) {
    elements.aiDialog.hidden = !dialog.open;
  }
  if (elements.aiDialogTitle) {
    elements.aiDialogTitle.textContent = dialog.title || "AI brainstorm";
  }
  if (elements.aiDialogNote) {
    elements.aiDialogNote.textContent = dialog.note
      || "Start with a brief, let the AI surface assumptions and questions, then generate when it is ready.";
  }
  if (elements.aiDialogThread) {
    elements.aiDialogThread.innerHTML = dialog.messages.length
      ? dialog.messages.map((entry) => `
        <article class="pw-ai-dialog__message pw-ai-dialog__message--${entry.role}">
          <strong>${entry.role === "assistant" ? "AI" : "You"}</strong>
          <p>${htmlEscape(entry.text)}</p>
        </article>
      `).join("")
      : '<div class="pw-ai-dialog__empty">Start with a short brief. The AI answers with assumptions and questions first, then you decide when to generate the final result.</div>';
  }
  if (elements.aiDialogStatus) {
    elements.aiDialogStatus.textContent = dialog.status || "";
    if (dialog.statusTone) {
      elements.aiDialogStatus.dataset.tone = dialog.statusTone;
    } else {
      delete elements.aiDialogStatus.dataset.tone;
    }
  }
  if (elements.aiDialogInput && elements.aiDialogInput.value !== dialog.input) {
    elements.aiDialogInput.value = dialog.input || "";
  }
  if (elements.aiDialogInput) {
    elements.aiDialogInput.disabled = !dialog.open || dialog.busy || !state.selectedWorld || !state.session;
  }
  if (elements.aiDialogSend) {
    elements.aiDialogSend.disabled = !dialog.open || dialog.busy || !state.selectedWorld || !state.session;
  }
  const canGenerate = dialog.messages.some((entry) => entry.role === "assistant");
  if (elements.aiDialogGenerate) {
    elements.aiDialogGenerate.disabled = !dialog.open || dialog.busy || !canGenerate || !state.selectedWorld || !state.session;
  }
  if (elements.aiDialogApply) {
    const canApply = dialog.artifactType === "texture"
      ? Boolean(dialog.generatedAsset) && dialog.targetKind !== "world"
      : Boolean(dialog.result) && dialog.targetKind !== "world";
    elements.aiDialogApply.hidden = !canApply;
    elements.aiDialogApply.disabled = !canApply || dialog.busy;
    if (canApply) {
      elements.aiDialogApply.textContent = dialog.applyLabel || "Apply result";
    }
  }
  if (elements.aiDialogResultPanel) {
    elements.aiDialogResultPanel.hidden = !dialog.result;
  }
  if (elements.aiDialogResultTitle) {
    elements.aiDialogResultTitle.textContent =
      dialog.artifactType === "screen_html"
        ? "Generated HTML"
        : dialog.artifactType === "world_script"
          ? "Generated script"
          : dialog.artifactType === "texture"
            ? "Generated texture asset"
            : "Generated model asset";
  }
  if (elements.aiDialogResult && elements.aiDialogResult.value !== dialog.result) {
    elements.aiDialogResult.value = dialog.result || "";
  }
  if (elements.aiDialogResult) {
    elements.aiDialogResult.disabled = !dialog.open || dialog.busy;
  }
}

function closeAiDialog(options = {}) {
  if (state.aiDialog.open && options.preserve !== false) {
    persistAiDialogThreadState();
  }
  state.aiDialog = createEmptyAiDialogState();
  updateShellState();
  renderAiDialog();
}

function buildSceneLogicAiObjective(prompt, selectedFunction = ensureSelectedScriptFunction()) {
  return [
    String(prompt ?? "").trim(),
    selectedFunction?.name ? `Target function name: ${selectedFunction.name}.` : "",
    "This should end up as one self-contained Mauworld logic function.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildScreenAiObjective(entry, prompt) {
  const viewport = entry ? getScreenTextureRenderSize(entry) : null;
  return [
    String(prompt ?? "").trim(),
    viewport ? `This should fit a Mauworld screen with an approximate viewport of ${viewport.width} by ${viewport.height}.` : "",
    entry?.html ? `Current HTML to replace or improve: ${String(entry.html).slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getAiDialogTargetContext(dialog = state.aiDialog) {
  if (dialog.targetKind === "screen") {
    const sceneDoc = parseSceneTextarea();
    const found = findEntityByRef(sceneDoc, { kind: "screen", id: dialog.targetId });
    const entry = found?.entry ?? null;
    const viewport = entry ? getScreenTextureRenderSize(entry) : null;
    return {
      valid: Boolean(entry),
      error: entry ? "" : "That screen is no longer available.",
      objective: buildScreenAiObjective(entry, getScreenAiPrompt(dialog.targetId)),
      targetLabel: entry ? getDisplayNameForEntity("screen", entry, found?.index ?? 0) : "Screen",
      currentArtifact: entry?.html || "",
      viewportSummary: viewport ? `${viewport.width} x ${viewport.height}` : "",
    };
  }
  if (dialog.targetKind === "script_function") {
    const selectedFunction = getSceneScriptFunctions().find((entry) => entry.id === dialog.targetId) ?? null;
    return {
      valid: Boolean(selectedFunction),
      error: selectedFunction ? "" : "That logic function is no longer available.",
      objective: buildSceneLogicAiObjective(elements.scriptFunctionPrompt?.value ?? "", selectedFunction),
      targetLabel: selectedFunction?.name ? `Logic function ${selectedFunction.name}` : "Scene logic function",
      currentArtifact: selectedFunction?.body || "",
      viewportSummary: "",
    };
  }
  if (dialog.artifactType === "texture") {
    if (dialog.targetKind === "world" || !dialog.targetId) {
      return {
        valid: true,
        error: "",
        objective: [
          String(elements.aiForm?.elements?.objective?.value ?? "").trim(),
          "Generate a reusable texture asset for this world.",
        ].filter(Boolean).join(" "),
        targetLabel: "Texture library asset",
        currentArtifact: "",
        viewportSummary: "",
        entityContext: "",
      };
    }
    const sceneDoc = parseSceneTextarea();
    const found = findEntityByRef(sceneDoc, { kind: dialog.targetKind, id: dialog.targetId });
    const entry = found?.entry ?? null;
    return {
      valid: Boolean(entry),
      error: entry ? "" : "That object is no longer available.",
      objective: [
        String(elements.aiForm?.elements?.objective?.value ?? "").trim(),
        `Generate a reusable texture for ${getDisplayNameForEntity(dialog.targetKind, entry || {}, found?.index ?? 0)}.`,
      ].filter(Boolean).join(" "),
      targetLabel: entry ? getDisplayNameForEntity(dialog.targetKind, entry, found?.index ?? 0) : "Texture target",
      currentArtifact: entry ? JSON.stringify(entry.material ?? {}, null, 2) : "",
      viewportSummary: "",
      entityContext: entry ? buildEntitySummary(dialog.targetKind, entry) : "",
    };
  }
  if (dialog.artifactType === "3d_model") {
    const sceneDoc = parseSceneTextarea();
    const found = dialog.targetId ? findEntityByRef(sceneDoc, { kind: dialog.targetKind, id: dialog.targetId }) : null;
    const entry = found?.entry ?? null;
    return {
      valid: true,
      error: "",
      objective: [
        String(elements.aiForm?.elements?.objective?.value ?? "").trim(),
        "Generate a reusable Mauworld 3D model library asset.",
      ].filter(Boolean).join(" "),
      targetLabel: entry ? getDisplayNameForEntity(dialog.targetKind, entry, found?.index ?? 0) : "Model library asset",
      currentArtifact: entry ? JSON.stringify(entry, null, 2) : "",
      viewportSummary: "",
      entityContext: entry ? buildEntitySummary(dialog.targetKind, entry) : "",
    };
  }
  return {
    valid: true,
    error: "",
    objective: String(elements.aiForm?.elements?.objective?.value ?? "").trim(),
    targetLabel: dialog.artifactType === "screen_html" ? "Scratch screen output" : "Scratch script output",
    currentArtifact: String(elements.aiOutput?.value ?? "").trim(),
    viewportSummary: "",
    entityContext: "",
  };
}

function buildAiRequestOptions(dialog = state.aiDialog) {
  if (!state.selectedWorld) {
    throw new Error("Open a world before using AI Builder.");
  }
  if (!state.session) {
    throw new Error("Sign in to use AI Builder.");
  }
  const reasoning = getAiProviderState("reasoning");
  writeAiProviderState("reasoning", reasoning);
  if (!reasoning.apiKey) {
    throw new Error("Missing text reasoning API key");
  }
  const targetContext = getAiDialogTargetContext(dialog);
  if (!targetContext.valid) {
    throw new Error(targetContext.error || "That AI target is no longer available.");
  }
  return {
    provider: reasoning.provider,
    model: reasoning.model || "gpt-5.4-mini",
    apiKey: reasoning.apiKey,
    artifactType: dialog.artifactType,
    worldName: state.selectedWorld.name,
    worldAbout: state.selectedWorld.about,
    objective: targetContext.objective,
    sceneSummary: JSON.stringify(getSelectedScene()?.compiled_doc?.stats ?? {}),
    targetLabel: targetContext.targetLabel,
    currentArtifact: targetContext.currentArtifact,
    viewportSummary: targetContext.viewportSummary,
    entityContext: targetContext.entityContext,
  };
}

function openAiDialog(config = {}) {
  const key = getAiDialogThreadKey(config);
  const stored = cloneAiDialogState(state.aiThreadDrafts.get(key) ?? {});
  state.aiDialog = cloneAiDialogState({
    ...stored,
    ...config,
    open: true,
    key,
    busy: false,
    status: "",
    statusTone: "",
    messages: stored.messages,
    result: stored.result || "",
    generatedAsset: stored.generatedAsset || null,
    input: stored.input || "",
  });
  updateShellState();
  renderAiDialog();
  const seedPrompt = String(config.seedPrompt ?? "").trim();
  const shouldAutoStart = Boolean(seedPrompt) && !stored.messages.length && !stored.result;
  if (shouldAutoStart) {
    void sendAiDialogMessage(seedPrompt);
    return;
  }
  window.setTimeout(() => {
    elements.aiDialogInput?.focus?.();
  }, 0);
}

async function sendAiDialogMessage(seedText = "") {
  const message = String(seedText || state.aiDialog.input || "").trim();
  if (!message) {
    setAiDialogStatus("Add a short brief first.", "error");
    renderAiDialog();
    elements.aiDialogInput?.focus?.();
    return;
  }
  const nextMessages = [...state.aiDialog.messages, { role: "user", text: message }];
  state.aiDialog.messages = nextMessages;
  state.aiDialog.input = "";
  state.aiDialog.busy = true;
  setAiDialogStatus("Thinking through assumptions and questions...", "");
  persistAiDialogThreadState();
  renderAiDialog();
  try {
    const request = buildAiRequestOptions();
    const endpoint = state.aiDialog.artifactType === "texture" || state.aiDialog.artifactType === "3d_model"
      ? "/private/assets/ai/brainstorm"
      : "/private/worlds/ai/brainstorm";
    const payload = await apiFetch(endpoint, {
      method: "POST",
      body: {
        ...request,
        messages: nextMessages,
      },
    });
    const reply = String(payload.text ?? "").trim() || "I need a little more detail before I can help shape this.";
    state.aiDialog.messages = [...nextMessages, { role: "assistant", text: reply }];
    state.aiDialog.busy = false;
    setAiDialogStatus("AI replied. Revise the thread or generate when it feels right.", "success");
    persistAiDialogThreadState();
    renderAiDialog();
    window.setTimeout(() => {
      elements.aiDialogInput?.focus?.();
    }, 0);
  } catch (error) {
    state.aiDialog.busy = false;
    setAiDialogStatus(error.message, "error");
    persistAiDialogThreadState();
    renderAiDialog();
    handleAiGenerationError(error, { confirm: false });
  }
}

async function generateAiDialogResult() {
  if (!state.aiDialog.messages.some((entry) => entry.role === "assistant")) {
    setAiDialogStatus("Ask AI first so it can answer with assumptions and questions before you generate.", "error");
    renderAiDialog();
    return;
  }
  if (String(state.aiDialog.input || "").trim()) {
    setAiDialogStatus("Send your latest revision to AI first, then generate from the updated thread.", "error");
    renderAiDialog();
    elements.aiDialogInput?.focus?.();
    return;
  }
  const kind = state.aiDialog.artifactType === "screen_html"
    ? "html"
    : state.aiDialog.artifactType === "world_script"
      ? "script"
      : state.aiDialog.artifactType;
  state.aiDialog.busy = true;
  setAiDialogStatus(
    kind === "html"
      ? "Generating final HTML..."
      : kind === "script"
        ? "Generating final script..."
        : kind === "texture"
          ? "Generating texture asset..."
          : "Generating 3D model asset...",
    "",
  );
  renderAiDialog();
  try {
    const request = buildAiRequestOptions();
    if (kind === "texture" || kind === "3d_model") {
      const reasoning = getAiProviderState("reasoning");
      const generationSettings = kind === "texture" ? getAiProviderState("image") : getAiProviderState("model");
      const endpoint = kind === "texture" ? "/private/assets/ai/texture" : "/private/assets/ai/model";
      if (!generationSettings.apiKey) {
        throw new Error(kind === "texture" ? "Missing image texture API key" : "Missing 3D model API key");
      }
      writeAiProviderState(kind === "texture" ? "image" : "model", generationSettings);
      const payload = await apiFetch(endpoint, {
        method: "POST",
        timeoutMs: kind === "3d_model" ? 300000 : 60000,
        body: {
          worldId: state.selectedWorld.world_id,
          worldName: state.selectedWorld.name,
          worldAbout: state.selectedWorld.about,
          objective: request.objective,
          sceneSummary: request.sceneSummary,
          messages: state.aiDialog.messages,
          targetLabel: request.targetLabel,
          currentArtifact: request.currentArtifact,
          entityContext: request.entityContext,
          reasoningProvider: reasoning.provider,
          reasoningModel: reasoning.model || "gpt-5.4-mini",
          reasoningApiKey: reasoning.apiKey,
          imageProvider: kind === "texture" ? generationSettings.provider : undefined,
          imageModel: kind === "texture" ? generationSettings.model : undefined,
          imageApiKey: kind === "texture" ? generationSettings.apiKey : undefined,
          modelProvider: kind === "3d_model" ? generationSettings.provider : undefined,
          modelModel: kind === "3d_model" ? generationSettings.model : undefined,
          modelApiKey: kind === "3d_model" ? generationSettings.apiKey : undefined,
        },
      });
      state.aiDialog.generatedAsset = payload.asset || null;
      state.aiDialog.result = payload.asset ? JSON.stringify(payload.asset, null, 2) : "";
      await loadAssets();
      if (kind === "texture" && state.aiDialog.generatedAsset && state.aiDialog.targetId) {
        applyTextureAssetToSelection(state.aiDialog.generatedAsset.id, {
          targetKind: state.aiDialog.targetKind,
          targetId: state.aiDialog.targetId,
        });
      }
    } else {
      const generatedText = await generateAi(kind, {
        objective: request.objective,
        sceneSummary: request.sceneSummary,
        messages: state.aiDialog.messages,
        targetLabel: request.targetLabel,
        currentArtifact: request.currentArtifact,
        viewportSummary: request.viewportSummary,
        outputTarget: elements.aiDialogResult,
        mirrorToAiOutput: state.aiDialog.targetKind === "world",
      });
      state.aiDialog.result = String(generatedText ?? "").trim();
      state.aiDialog.generatedAsset = null;
    }
    state.aiDialog.busy = false;
    setAiDialogStatus("Final result ready. Review it, then apply it when you are happy.", "success");
    persistAiDialogThreadState();
    renderAiDialog();
  } catch (error) {
    state.aiDialog.busy = false;
    setAiDialogStatus(error.message, "error");
    persistAiDialogThreadState();
    renderAiDialog();
    handleAiGenerationError(error, { confirm: false });
  }
}

function applyAiDialogResult() {
  const result = String(elements.aiDialogResult?.value ?? state.aiDialog.result ?? "").trim();
  if (!result) {
    setAiDialogStatus("Generate something first.", "error");
    renderAiDialog();
    return;
  }
  if (state.aiDialog.artifactType === "texture") {
    if (!state.aiDialog.generatedAsset?.id) {
      setAiDialogStatus("Generate a texture asset first.", "error");
      renderAiDialog();
      return;
    }
    applyTextureAssetToSelection(state.aiDialog.generatedAsset.id, {
      targetKind: state.aiDialog.targetKind,
      targetId: state.aiDialog.targetId,
    });
    setAiDialogStatus("Applied texture to the selected item.", "success");
    persistAiDialogThreadState();
    renderAiDialog();
    return;
  }
  if (state.aiDialog.targetKind === "screen") {
    let applied = false;
    mutateSceneDoc((sceneDoc) => {
      const found = findEntityByRef(sceneDoc, { kind: "screen", id: state.aiDialog.targetId });
      if (!found?.entry) {
        return;
      }
      found.entry.html = result;
      applied = true;
    });
    if (!applied) {
      setAiDialogStatus("That screen is no longer available.", "error");
      renderAiDialog();
      return;
    }
    state.aiDialog.result = result;
    setAiDialogStatus("Applied to the screen.", "success");
    persistAiDialogThreadState();
    renderAiDialog();
    return;
  }
  if (state.aiDialog.targetKind === "script_function") {
    let applied = false;
    const normalizedBody = normalizeGeneratedScriptBody(result);
    mutateSceneScriptFunctions((functions) => {
      const target = functions.find((entry) => entry.id === state.aiDialog.targetId);
      if (!target) {
        return;
      }
      target.body = normalizedBody;
      applied = true;
    });
    if (!applied) {
      setAiDialogStatus("That logic function is no longer available.", "error");
      renderAiDialog();
      return;
    }
    state.aiDialog.result = normalizedBody;
    setAiDialogStatus("Applied to the function.", "success");
    persistAiDialogThreadState();
    renderAiDialog();
    focusSelectedScriptFunctionBody();
    return;
  }
  if (elements.aiOutput) {
    elements.aiOutput.value = result;
  }
  state.aiDialog.result = result;
  setAiDialogStatus("Saved as the latest result in AI Builder.", "success");
  persistAiDialogThreadState();
  renderAiDialog();
}

function focusAiBuilder(fieldName = "reasoningApiKey") {
  setWorldPanelSection("ai", { fieldName });
}

function promptForAiBuilder(message, options = {}) {
  const fieldName = options.fieldName || "reasoningApiKey";
  setAiBuilderStatus(message, "error");
  setStatus(message);
  if (state.selectedWorld) {
    setPrivatePanelTab("world");
  }
  let shouldOpen = true;
  if (options.confirm !== false && typeof window.confirm === "function") {
    shouldOpen = window.confirm(`${message}\n\nOpen AI Builder now?`);
  }
  if (shouldOpen) {
    focusAiBuilder(fieldName);
  }
}

function handleAiGenerationError(error, options = {}) {
  const message = String(error?.message || "Could not generate with AI.");
  if (/missing text reasoning api key/i.test(message)) {
    promptForAiBuilder("AI Builder needs your text reasoning API key before it can generate.", {
      fieldName: "reasoningApiKey",
      confirm: options.confirm !== false,
    });
    return;
  }
  if (/missing image texture api key/i.test(message)) {
    promptForAiBuilder("AI Builder needs your image texture API key before it can generate textures.", {
      fieldName: "imageApiKey",
      confirm: options.confirm !== false,
    });
    return;
  }
  if (/missing 3d model api key/i.test(message)) {
    promptForAiBuilder("AI Builder needs your 3D model API key before it can generate models.", {
      fieldName: "modelApiKey",
      confirm: options.confirm !== false,
    });
    return;
  }
  if (/unsupported ai provider/i.test(message)) {
    promptForAiBuilder(message, {
      fieldName: "reasoningProvider",
      confirm: options.confirm !== false,
    });
    return;
  }
  setAiBuilderStatus(message, "error");
  setStatus(message);
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

function getLauncherIntent() {
  const params = new URLSearchParams(window.location.search);
  return {
    create: params.get("intent") === "create",
  };
}

function selectedWorldMatchesLaunchRequest(launch = getLaunchRequest(), world = state.selectedWorld) {
  if (!launch?.worldId || !launch?.creatorUsername || !world?.world_id || !world?.creator?.username) {
    return false;
  }
  return (
    String(world.world_id).trim() === String(launch.worldId).trim()
    && String(world.creator.username).trim().toLowerCase() === String(launch.creatorUsername).trim().toLowerCase()
  );
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
      viewerSessionId: getPrivateViewerSessionId(),
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
  return sendWorldSocketMessage({
    type: "chat:send",
    text: message,
  });
}

const privateChatFeature = createChatFeature({
  input: elements.panelChatInput,
  form: elements.panelChatComposer,
  reactionButtons: elements.panelChatReactionButtons,
  reactionAttribute: "data-private-chat-reaction",
  onAfterInputChange: () => {
    renderPrivateChat();
  },
  onSubmit: sendPrivateChat,
  onBeforeReaction() {
    setPrivatePanelTab("chat");
  },
  onSubmitFailed: () => {
    renderPrivateChat();
  },
  onReactionFailed: () => {
    renderPrivateChat();
  },
});

function openPrivateChatComposer() {
  if (!elements.panelChatInput) {
    return;
  }
  setPrivatePanelTab("chat");
  if (elements.panelChatInput.disabled) {
    return;
  }
  elements.panelChatInput.focus();
  elements.panelChatInput.select();
}

function isEditablePrivateTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
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
  const localAudibleStream = state.localBrowserShare?.hasAudio
    ? state.localBrowserShare.stream
    : state.pendingBrowserShare?.hasAudio
      ? state.pendingBrowserShare.stream
      : null;
  const shouldPlayAudio = Boolean(localAudibleStream && element.srcObject === localAudibleStream);
  element.autoplay = true;
  element.playsInline = true;
  element.muted = !shouldPlayAudio;
  element.defaultMuted = !shouldPlayAudio;
  element.volume = shouldPlayAudio ? 1 : 0;
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

function resumePrivateBrowserMediaPlayback() {
  const seen = new Set();
  const candidates = [];
  if (elements.panelBrowserVideo) {
    candidates.push(elements.panelBrowserVideo);
  }
  for (const session of state.browserSessions.values()) {
    if (session?._remoteElement) {
      candidates.push(session._remoteElement);
    }
  }
  for (const element of candidates) {
    if (!element || seen.has(element)) {
      continue;
    }
    seen.add(element);
    if (element.srcObject && element.paused) {
      ensurePrivateBrowserVideoPlayback(element);
    }
  }
  void getPrivateBrowserMediaController().resumePlayback({
    sessionId: state.browserPanelRemoteSessionId || state.browserMediaState.remoteAudioSessionId,
    kinds: ["audio", "video"],
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

function getPrivateBrowserStagePlaceholderText({
  localSession = null,
  remoteSession = null,
  needsManualPlaybackStart = false,
  needsManualAudioStart = false,
} = {}) {
  return getDisplayShareStagePlaceholderText({
    localSession,
    remoteSession,
    needsManualPlaybackStart,
    needsManualAudioStart,
    getSessionShareKind: getPrivateBrowserSessionShareKind,
    strings: {
      blockedAutoplay: "Browser blocked autoplay. Press start to watch this live stream.",
      enableAudioVoice: "Press enable sound to hear this live voice stream.",
      enableAudioDefault: "Press enable sound to hear this live stream.",
      localAudio: "Voice-only share is live inside this private world.",
      remoteAudio: (session) => `Listening to ${session?.title || "live voice"} from inside this private world.`,
      localCamera: "Video share is live inside this private world.",
      remoteCamera: (session) => `Watching ${session?.title || "live video"} from this private world.`,
      remoteDisplay: (session) => `Watching ${session?.title || "nearby share"} from this private world.`,
      localBrowser: "This browser session is live in this private world.",
      remoteBrowser: (session) => `Viewing ${session?.title || "nearby share"} from this private world.`,
    },
  });
}

function setPrivateBrowserOverlayOpen(open) {
  state.browserOverlayOpen = Boolean(open);
  setDisplayShareOverlayState({
    open: state.browserOverlayOpen,
    panel: elements.panelBrowserPanel,
    overlayRoot: elements.panelBrowserOverlayRoot,
    dockMarker: elements.panelBrowserDock,
    backdrop: elements.panelBrowserBackdrop,
    expandButton: elements.panelBrowserExpand,
    stage: elements.panelBrowserStage,
    updateView: updatePrivateBrowserPanel,
  });
}

function getLocalPrivateBrowserSession() {
  return state.localBrowserSessionId ? state.browserSessions.get(state.localBrowserSessionId) ?? null : null;
}

function releasePrivateBrowserShare(share, { stopTracks = false } = {}) {
  if (!share) {
    return;
  }
  share.observedTrack?.removeEventListener?.("ended", share.endedHandler);
  if (stopTracks || share.stopTracksOnRelease === true) {
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
  if (activeShare.sessionId) {
    clearPrivateShareBubbleVideo(activeShare.sessionId);
  }
}

function dropLocalPrivateBrowserSession(sessionId, { unpublish = true } = {}) {
  const normalized = String(sessionId ?? "").trim();
  if (!normalized) {
    return false;
  }
  state.browserMediaController?.removeSession?.(normalized);
  if (unpublish) {
    void state.browserMediaController?.unpublishSession?.(normalized);
  }
  state.browserSessions.delete(normalized);
  if (state.localBrowserSessionId === normalized) {
    state.localBrowserSessionId = "";
  }
  if (state.localVoiceSessionId === normalized) {
    state.localVoiceSessionId = "";
  }
  if (state.browserPanelRemoteSessionId === normalized) {
    state.browserPanelRemoteSessionId = "";
    if (!state.localBrowserShare) {
      setPrivateBrowserPreviewStream(null);
    }
  }
  ensurePrivateRemoteAudioStateMap().delete(normalized);
  syncPrivateRemoteAudioState();
  removePrivateShareBubbleEntry(normalized);
  return true;
}

function getLocalPrivateVoiceSession() {
  return state.localVoiceSessionId ? state.browserSessions.get(state.localVoiceSessionId) ?? null : null;
}

function ensurePrivateRemoteAudioStateMap() {
  if (!(state.browserMediaState.remoteAudioBySession instanceof Map)) {
    state.browserMediaState.remoteAudioBySession = new Map();
  }
  return state.browserMediaState.remoteAudioBySession;
}

function isPrivateRemotePanelSessionCandidate(session = {}) {
  return Boolean(
    session
    && session.hostSessionId !== getPrivateViewerSessionId()
    && session.deliveryMode === "full"
    && session.hasVideo !== false
    && !isPrivatePersistentVoiceSession(session),
  );
}

function getPrivateRemotePanelSessionId(preferredSessionId = "") {
  const currentSessionId = String(state.browserPanelRemoteSessionId ?? "").trim();
  if (currentSessionId && isPrivateRemotePanelSessionCandidate(state.browserSessions.get(currentSessionId))) {
    return currentSessionId;
  }
  const normalizedPreferredSessionId = String(preferredSessionId ?? "").trim();
  const candidates = [...state.browserSessions.values()]
    .filter((session) => isPrivateRemotePanelSessionCandidate(session))
    .sort((left, right) =>
      Number(isPrivateBrowserOriginSession(right)) - Number(isPrivateBrowserOriginSession(left))
      || Number(String(right.sessionId ?? "").trim() === normalizedPreferredSessionId)
        - Number(String(left.sessionId ?? "").trim() === normalizedPreferredSessionId)
      || Date.parse(left.startedAt ?? 0) - Date.parse(right.startedAt ?? 0)
      || String(left.sessionId ?? "").localeCompare(String(right.sessionId ?? "")));
  return String(candidates[0]?.sessionId ?? "").trim();
}

function syncPrivateRemoteAudioState(preferredSessionId = "") {
  const audioStates = ensurePrivateRemoteAudioStateMap();
  const normalizedPreferredSessionId = String(preferredSessionId ?? "").trim();
  const selectedSessionId = normalizedPreferredSessionId || String(state.browserPanelRemoteSessionId ?? "").trim();
  let resolvedSessionId = "";
  let resolvedState = null;
  if (selectedSessionId) {
    const selectedState = audioStates.get(selectedSessionId) ?? null;
    if (selectedState?.available === true) {
      resolvedSessionId = selectedSessionId;
      resolvedState = selectedState;
    }
  }
  if (!resolvedState) {
    const fallbackEntry = [...audioStates.entries()].find(([, entry]) => entry?.available === true) ?? null;
    if (fallbackEntry) {
      resolvedSessionId = String(fallbackEntry[0] ?? "").trim();
      resolvedState = fallbackEntry[1];
    }
  }
  state.browserMediaState.remoteAudioSessionId = resolvedSessionId;
  state.browserMediaState.remoteAudioAvailable = resolvedState?.available === true;
  state.browserMediaState.remoteAudioBlocked = resolvedState?.blocked === true;
  state.browserMediaState.remoteAudioError = String(resolvedState?.error ?? "").trim();
}

function clearPendingPrivateVoiceShare({ stopTracks = false } = {}) {
  if (!state.pendingVoiceShare) {
    return;
  }
  releasePrivateBrowserShare(state.pendingVoiceShare, { stopTracks });
  state.pendingVoiceShare = null;
}

function clearLocalPrivateVoiceShare({ stopTracks = false, sessionId = "" } = {}) {
  const activeShare = state.localVoiceShare;
  if (!activeShare) {
    return;
  }
  if (sessionId && activeShare.sessionId && activeShare.sessionId !== sessionId) {
    return;
  }
  releasePrivateBrowserShare(activeShare, { stopTracks });
  state.localVoiceShare = null;
}

function getPrivateVoiceShareActionLabel() {
  const localVoiceSession = getLocalPrivateVoiceSession();
  if (state.pendingVoiceShare) {
    return "Starting...";
  }
  return localVoiceSession ? "Stop Persistent Voice Chat" : "Start Persistent Voice Chat";
}

function createPrivatePersistentVoiceContributionShare() {
  const sourceStream = state.localVoiceShare?.stream ?? null;
  const sourceAudioTrack = sourceStream?.getAudioTracks?.()[0] ?? null;
  if (!sourceAudioTrack || String(sourceAudioTrack.readyState ?? "live") === "ended") {
    return null;
  }
  const clonedStream = new MediaStream([sourceAudioTrack.clone()]);
  const share = createLocalDisplayShare(clonedStream, {
    title: "",
    shareKind: "audio",
    hasVideo: false,
    hasAudio: true,
    aspectRatio: 1.2,
    fallbackWidth: 540,
    fallbackHeight: 432,
    isPendingShare: (candidate) => state.pendingBrowserShare?.stream === candidate.stream,
    isLocalShare: (candidate) => state.localBrowserShare?.stream === candidate.stream,
    onEndedWhilePending() {
      clearPendingPrivateBrowserShare({ stopTracks: false });
      updatePrivateBrowserPanel();
    },
    onEndedWhileLive() {
      const sessionId = String(state.localBrowserShare?.sessionId ?? state.localBrowserSessionId ?? "").trim();
      clearLocalPrivateBrowserShare({ stopTracks: false, sessionId });
      dropLocalPrivateBrowserSession(sessionId);
      if (sessionId) {
        sendWorldSocketMessage({
          type: "browser:stop",
          sessionId,
        });
      }
      updatePrivateBrowserPanel();
    },
  });
  share.stopTracksOnRelease = true;
  return share;
}

function startPrivatePersistentVoiceContribution(anchorSessionId) {
  const normalizedAnchorSessionId = String(anchorSessionId ?? "").trim();
  if (!normalizedAnchorSessionId) {
    return false;
  }
  const existingLocalSession = getLocalPrivateBrowserSession();
  if (existingLocalSession) {
    const sameContribution = isPrivateBrowserMemberSession(existingLocalSession)
      && getPrivateBrowserSessionShareKind(existingLocalSession) === "audio"
      && getPrivateBrowserAnchorSessionId(existingLocalSession) === normalizedAnchorSessionId;
    if (sameContribution) {
      return true;
    }
    setPrivateBrowserStatus("Stop your current nearby share before joining with persistent voice.");
    return false;
  }
  if (state.pendingBrowserShare) {
    setPrivateBrowserStatus("Finish the current nearby share first.");
    return false;
  }
  const share = createPrivatePersistentVoiceContributionShare();
  if (!share) {
    setPrivateBrowserStatus("Restart persistent voice chat, then try joining again.");
    return false;
  }
  state.pendingBrowserShare = share;
  setPrivateBrowserStatus("Adding your persistent voice to this nearby share...");
  const sent = sendWorldSocketMessage({
    type: "browser:start",
    mode: "display-share",
    title: "",
    shareKind: "audio",
    hasVideo: false,
    hasAudio: true,
    aspectRatio: share.aspectRatio,
    anchorSessionId: normalizedAnchorSessionId,
  });
  if (!sent) {
    clearPendingPrivateBrowserShare({ stopTracks: true });
    updatePrivateBrowserPanel();
    setPrivateBrowserStatus("Private world share is offline right now.");
    return false;
  }
  updatePrivateBrowserPanel();
  return true;
}

function bindPrivatePanelPress(button, handler) {
  if (!button || typeof handler !== "function") {
    return;
  }
  let lastHandledAt = 0;
  const run = (event) => {
    const now = Date.now();
    if (now - lastHandledAt < 240) {
      return;
    }
    lastHandledAt = now;
    if (event?.type === "pointerup") {
      event.preventDefault();
    }
    handler(event);
  };
  button.addEventListener("click", run);
  button.addEventListener("pointerup", run);
}

function updatePrivateVoicePanel() {
  const localVoiceSession = getLocalPrivateVoiceSession();
  const localContributionSession = getLocalPrivateBrowserSession();
  if (!localVoiceSession && !state.pendingVoiceShare) {
    state.voiceJoinOffer = null;
    clearPendingPrivateVoiceJoinState();
  }
  const canToggle = Boolean(state.session && isPrivateWorldReadyForShare());
  const pendingVoiceJoinAnchorSessionId = String(state.pendingVoiceJoin?.anchorSessionId ?? "").trim();
  const cancelingVoiceJoinRequest = pendingVoiceJoinAnchorSessionId
    && isPrivateVoiceJoinCancellationPending(pendingVoiceJoinAnchorSessionId);
  if (elements.panelVoiceToggle) {
    elements.panelVoiceToggle.disabled = !canToggle && !localVoiceSession && !state.pendingVoiceShare;
    elements.panelVoiceToggle.textContent = getPrivateVoiceShareActionLabel();
  }
  if (elements.panelVoiceStatus) {
    if (!state.session) {
      elements.panelVoiceStatus.textContent = "Sign in to keep a nearby voice channel open.";
    } else if (!state.selectedWorld) {
      elements.panelVoiceStatus.textContent = "Open a private world to use persistent voice chat.";
    } else if (!getLocalParticipant()) {
      elements.panelVoiceStatus.textContent = "Enter this private world to use persistent voice chat.";
    } else if (state.pendingVoiceShare) {
      elements.panelVoiceStatus.textContent = "Starting persistent voice chat...";
    } else if (pendingVoiceJoinAnchorSessionId) {
      const hostName = getPrivateDisplayNameForSessionId(state.pendingVoiceJoin?.anchorHostSessionId) || "nearby host";
      elements.panelVoiceStatus.textContent = cancelingVoiceJoinRequest
        ? `Canceling your request to join ${hostName}'s live voice group...`
        : `Waiting for ${hostName} to approve your voice join.`;
    } else if (localVoiceSession) {
      elements.panelVoiceStatus.textContent = Boolean(
        localContributionSession
        && isPrivateBrowserMemberSession(localContributionSession)
        && getPrivateBrowserSessionShareKind(localContributionSession) === "audio",
      )
        ? "Persistent voice chat is joined to the nearby live group."
        : "Persistent voice chat is live nearby.";
    } else {
      elements.panelVoiceStatus.textContent = "Keep your mic nearby without showing up in What's Live.";
    }
  }
}

function handlePrivateIncomingVoiceJoinDecision(anchorSessionId, requesterSessionId, approved) {
  const sent = sendWorldSocketMessage({
    type: "voice:join-decision",
    anchorSessionId,
    requesterSessionId,
    approved,
  });
  if (!sent) {
    setPrivateBrowserStatus("Private world share is offline right now.");
    return false;
  }
  state.incomingVoiceJoinRequests = state.incomingVoiceJoinRequests.filter((request) =>
    !(request.anchorSessionId === anchorSessionId && request.requesterSessionId === requesterSessionId));
  updatePrivateBrowserPanel();
  return true;
}

function renderPrivateShareJoinRequests() {
  if (!elements.panelShareRequestStack) {
    return;
  }
  if (state.incomingShareJoinRequests.length === 0 && state.incomingVoiceJoinRequests.length === 0) {
    elements.panelShareRequestStack.innerHTML = "";
    elements.panelShareRequestStack.hidden = true;
    return;
  }
  elements.panelShareRequestStack.hidden = false;
  const shareRequestCards = state.incomingShareJoinRequests.map((request) => `
    <div class="world-request-card">
      <div class="world-request-card__title">${htmlEscape(request.requesterDisplayName || "Nearby visitor")}</div>
      <div class="world-request-card__body">Wants to join with ${htmlEscape(getBrowserShareKindLabel(request.shareKind || "screen").toLowerCase())}.</div>
      <div class="world-request-card__actions">
        <button type="button" data-private-share-join-decision="approve" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Approve</button>
        <button type="button" data-private-share-join-decision="decline" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Decline</button>
      </div>
    </div>
  `);
  const voiceRequestCards = state.incomingVoiceJoinRequests.map((request) => `
    <div class="world-request-card">
      <div class="world-request-card__title">${htmlEscape(request.requesterDisplayName || "Nearby visitor")}</div>
      <div class="world-request-card__body">Wants their persistent voice chat heard in your live group.</div>
      <div class="world-request-card__actions">
        <button type="button" data-private-share-panel-voice-join-decision="approve" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Approve</button>
        <button type="button" data-private-share-panel-voice-join-decision="decline" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Decline</button>
      </div>
    </div>
  `);
  elements.panelShareRequestStack.innerHTML = [...shareRequestCards, ...voiceRequestCards].join("");
  for (const button of elements.panelShareRequestStack.querySelectorAll("[data-private-share-join-decision]")) {
    bindPrivatePanelPress(button, () => {
      const anchorSessionId = String(button.getAttribute("data-anchor-session-id") ?? "").trim();
      const requesterSessionId = String(button.getAttribute("data-requester-session-id") ?? "").trim();
      const approved = button.getAttribute("data-private-share-join-decision") === "approve";
      const sent = sendWorldSocketMessage({
        type: "share:join-decision",
        anchorSessionId,
        requesterSessionId,
        approved,
      });
      if (!sent) {
        setPrivateBrowserStatus("Private world share is offline right now.");
        return;
      }
      state.incomingShareJoinRequests = state.incomingShareJoinRequests.filter((request) =>
        !(request.anchorSessionId === anchorSessionId && request.requesterSessionId === requesterSessionId));
      updatePrivateBrowserPanel();
    });
  }
  for (const button of elements.panelShareRequestStack.querySelectorAll("[data-private-share-panel-voice-join-decision]")) {
    bindPrivatePanelPress(button, () => {
      const anchorSessionId = String(button.getAttribute("data-anchor-session-id") ?? "").trim();
      const requesterSessionId = String(button.getAttribute("data-requester-session-id") ?? "").trim();
      const approved = button.getAttribute("data-private-share-panel-voice-join-decision") === "approve";
      handlePrivateIncomingVoiceJoinDecision(anchorSessionId, requesterSessionId, approved);
    });
  }
}

function isPrivateVoiceJoinCancellationPending(anchorSessionId = "") {
  return String(state.pendingVoiceJoinCancellationAnchorSessionId ?? "").trim() === String(anchorSessionId ?? "").trim()
    && Boolean(anchorSessionId);
}

function clearPendingPrivateVoiceJoinState() {
  state.pendingVoiceJoin = null;
  state.pendingVoiceJoinCancellationAnchorSessionId = "";
}

function cancelPendingPrivateVoiceJoinRequest() {
  const anchorSessionId = String(state.pendingVoiceJoin?.anchorSessionId ?? "").trim();
  if (!anchorSessionId || isPrivateVoiceJoinCancellationPending(anchorSessionId)) {
    return false;
  }
  const cancelled = sendWorldSocketMessage({
    type: "voice:join-cancel",
    anchorSessionId,
  });
  if (!cancelled) {
    setPrivateBrowserStatus("Private world share is offline right now.");
    return false;
  }
  state.pendingVoiceJoinCancellationAnchorSessionId = anchorSessionId;
  updatePrivateBrowserPanel();
  return true;
}

function renderPrivateVoiceJoinOffers() {
  if (!elements.panelVoiceOfferStack) {
    return;
  }
  const offer = state.voiceJoinOffer;
  const pendingJoin = state.pendingVoiceJoin;
  const activeAnchorSessionId = String(pendingJoin?.anchorSessionId ?? offer?.anchorSessionId ?? "").trim();
  if (!activeAnchorSessionId) {
    elements.panelVoiceOfferStack.innerHTML = "";
    elements.panelVoiceOfferStack.hidden = true;
    return;
  }
  const anchorHostSessionId = String(pendingJoin?.anchorHostSessionId ?? offer?.anchorHostSessionId ?? "").trim();
  const hostName = getPrivateDisplayNameForSessionId(anchorHostSessionId);
  const anchorSession = pendingJoin?.anchorSession ?? offer?.anchorSession ?? null;
  const title = anchorSession?.title
    ? `"${anchorSession.title}"`
    : "this nearby live share";
  const canceling = isPrivateVoiceJoinCancellationPending(activeAnchorSessionId);
  elements.panelVoiceOfferStack.hidden = false;
  elements.panelVoiceOfferStack.innerHTML = pendingJoin
    ? `
      <div class="world-request-card">
        <div class="world-request-card__title">Voice Join Requested</div>
        <div class="world-request-card__body">Waiting for ${htmlEscape(hostName || "Nearby host")} to approve ${htmlEscape(title)}.</div>
        <div class="world-request-card__actions">
          <button type="button" data-private-voice-join-cancel="true" ${canceling ? "disabled" : ""}>${canceling ? "Canceling..." : "Cancel Request"}</button>
        </div>
      </div>
    `
    : `
      <div class="world-request-card">
        <div class="world-request-card__title">Join Nearby Voice Group?</div>
        <div class="world-request-card__body">${htmlEscape(hostName || "Nearby host")} is live with ${htmlEscape(title)}.</div>
        <div class="world-request-card__actions">
          <button type="button" data-private-voice-offer-decision="accept">Join</button>
          <button type="button" data-private-voice-offer-decision="decline">Stay Nearby</button>
        </div>
      </div>
    `;
  for (const button of elements.panelVoiceOfferStack.querySelectorAll("[data-private-voice-join-cancel]")) {
    bindPrivatePanelPress(button, () => {
      cancelPendingPrivateVoiceJoinRequest();
    });
  }
  for (const button of elements.panelVoiceOfferStack.querySelectorAll("[data-private-voice-offer-decision]")) {
    bindPrivatePanelPress(button, () => {
      const localVoiceSession = getLocalPrivateVoiceSession();
      if (!localVoiceSession || !isPrivatePersistentVoiceSession(localVoiceSession)) {
        state.voiceJoinOffer = null;
        updatePrivateVoicePanel();
        renderPrivateVoiceJoinOffers();
        setPrivateBrowserStatus("Start persistent voice chat again to answer this offer.");
        return;
      }
      const accepted = button.getAttribute("data-private-voice-offer-decision") === "accept";
      const sent = sendWorldSocketMessage({
        type: "voice:join-offer-response",
        anchorSessionId: offer.anchorSessionId,
        accepted,
      });
      if (!sent) {
        setPrivateBrowserStatus("Private world share is offline right now.");
        return;
      }
      if (accepted) {
        state.pendingVoiceJoin = {
          anchorSessionId: offer.anchorSessionId,
          anchorHostSessionId: offer.anchorHostSessionId,
          anchorSession: offer.anchorSession ?? null,
        };
        state.pendingVoiceJoinCancellationAnchorSessionId = "";
        state.voiceJoinOffer = null;
        updatePrivateBrowserPanel();
        return;
      }
      if (!accepted) {
        state.voiceJoinOffer = null;
        updatePrivateVoicePanel();
        renderPrivateVoiceJoinOffers();
      }
    });
  }
}

function renderPrivateVoiceJoinRequests() {
  if (!elements.panelVoiceRequestStack) {
    return;
  }
  if (state.incomingVoiceJoinRequests.length === 0) {
    elements.panelVoiceRequestStack.innerHTML = "";
    elements.panelVoiceRequestStack.hidden = true;
    return;
  }
  elements.panelVoiceRequestStack.hidden = false;
  elements.panelVoiceRequestStack.innerHTML = state.incomingVoiceJoinRequests.map((request) => `
    <div class="world-request-card">
      <div class="world-request-card__title">${htmlEscape(request.requesterDisplayName || "Nearby visitor")}</div>
      <div class="world-request-card__body">Wants their persistent voice chat heard in your live group.</div>
      <div class="world-request-card__actions">
        <button type="button" data-private-voice-join-decision="approve" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Approve</button>
        <button type="button" data-private-voice-join-decision="decline" data-anchor-session-id="${htmlEscape(request.anchorSessionId)}" data-requester-session-id="${htmlEscape(request.requesterSessionId)}">Decline</button>
      </div>
    </div>
  `).join("");
  for (const button of elements.panelVoiceRequestStack.querySelectorAll("[data-private-voice-join-decision]")) {
    bindPrivatePanelPress(button, () => {
      const anchorSessionId = String(button.getAttribute("data-anchor-session-id") ?? "").trim();
      const requesterSessionId = String(button.getAttribute("data-requester-session-id") ?? "").trim();
      const approved = button.getAttribute("data-private-voice-join-decision") === "approve";
      handlePrivateIncomingVoiceJoinDecision(anchorSessionId, requesterSessionId, approved);
    });
  }
}

function renderPrivateShareGroupSummary() {
  if (!elements.panelShareGroupSummary) {
    return;
  }
  const localSession = getLocalPrivateBrowserSession();
  const anchorSession = getPrivateShareJoinTarget();
  if (!anchorSession) {
    elements.panelShareGroupSummary.innerHTML = "";
    elements.panelShareGroupSummary.hidden = true;
    return;
  }
  const memberNames = getPrivateShareGroupSessions(anchorSession.sessionId)
    .filter((session) => isPrivateBrowserMemberSession(session))
    .map((session) => getPrivateDisplayNameForSessionId(session.hostSessionId) || session.hostSessionId)
    .filter(Boolean);
  const hostName = getPrivateDisplayNameForSessionId(anchorSession.hostSessionId) || "Nearby host";
  const viewerCount = Math.min(getPrivateBrowserSessionViewerCount(anchorSession), getPrivateBrowserSessionMaxViewers(anchorSession));
  const maxViewers = getPrivateBrowserSessionMaxViewers(anchorSession);
  const pendingState = state.pendingShareJoin?.anchorSessionId === anchorSession.sessionId
    ? state.pendingShareJoin.approved
      ? "Approved. Choose what to share."
      : isPrivateShareJoinCancellationPending(anchorSession.sessionId)
        ? "Canceling request..."
        : "Waiting for approval."
    : "";
  const summaryCopy = localSession
    ? isPrivateBrowserOriginSession(localSession)
      ? "You are the anchor for this nearby share group. Movement stays locked while it is live."
      : "You are contributing inside this nearby share group. Leaving the circle will stop your share."
    : `Join ${hostName}'s nearby share group without creating another live row.`;
  elements.panelShareGroupSummary.hidden = false;
  elements.panelShareGroupSummary.innerHTML = `
    <div class="world-group-summary__title">${htmlEscape(getPrivateBrowserSessionTitle(anchorSession))}</div>
    <div class="world-group-summary__meta">
      <span>${htmlEscape(hostName)}</span>
      <span>${viewerCount}/${maxViewers} viewers</span>
      <span>${memberNames.length} contributor${memberNames.length === 1 ? "" : "s"}</span>
    </div>
    <div class="world-group-summary__body">${htmlEscape(summaryCopy)}</div>
    ${memberNames.length > 0 ? `<div class="world-group-summary__contributors">${htmlEscape(memberNames.join(" • "))}</div>` : ""}
    ${pendingState ? `<div class="world-group-summary__note">${htmlEscape(pendingState)}</div>` : ""}
  `;
}

function renderPrivateGameShareGroupSummary() {
  if (!elements.panelShareGroupSummary) {
    return;
  }
  const localSession = getLocalPrivateGameSession();
  const anchorSession = getPrivateGameShareJoinTarget();
  if (!anchorSession) {
    elements.panelShareGroupSummary.innerHTML = "";
    elements.panelShareGroupSummary.hidden = true;
    return;
  }
  const memberNames = getPrivateGameShareGroupSessions(anchorSession.session_id)
    .filter((session) => isPrivateGameMemberSession(session))
    .map((session) => getPrivateGameHostName(session))
    .filter(Boolean);
  const hostName = getPrivateGameHostName(anchorSession);
  const viewerCount = Math.max(0, Number(anchorSession?.viewer_count ?? anchorSession?.viewerCount) || 0);
  const maxViewers = Math.max(1, Number(anchorSession?.max_viewers ?? anchorSession?.maxViewers) || PRIVATE_WORLD_MAX_RECIPIENTS);
  const pendingState = state.pendingShareJoin?.anchorSessionId === String(anchorSession?.session_id ?? "").trim()
    ? state.pendingShareJoin.approved
      ? "Approved. Share your game to add it to this nearby group."
      : isPrivateShareJoinCancellationPending(anchorSession.session_id)
        ? "Canceling request..."
        : "Waiting for approval."
    : "";
  const summaryCopy = localSession
    ? isPrivateGameOriginSession(localSession)
      ? "You are the anchor for this nearby game group. Movement stays locked while it is live."
      : "You are contributing a game inside this nearby group. Leaving the circle will stop it."
    : `Join ${hostName}'s nearby game group without creating another live row.`;
  elements.panelShareGroupSummary.hidden = false;
  elements.panelShareGroupSummary.innerHTML = `
    <div class="world-group-summary__title">${htmlEscape(getPrivateGameSessionTitle(anchorSession))}</div>
    <div class="world-group-summary__meta">
      <span>${htmlEscape(hostName)}</span>
      <span>${viewerCount}/${maxViewers} viewers</span>
      <span>${memberNames.length} contributor${memberNames.length === 1 ? "" : "s"}</span>
    </div>
    <div class="world-group-summary__body">${htmlEscape(summaryCopy)}</div>
    ${memberNames.length > 0 ? `<div class="world-group-summary__contributors">${htmlEscape(memberNames.join(" • "))}</div>` : ""}
    ${pendingState ? `<div class="world-group-summary__note">${htmlEscape(pendingState)}</div>` : ""}
  `;
}

function isPrivateShareJoinCancellationPending(anchorSessionId = "") {
  return String(state.pendingShareJoinCancellationAnchorSessionId ?? "").trim() === String(anchorSessionId ?? "").trim()
    && Boolean(anchorSessionId);
}

function clearPendingPrivateShareJoinState() {
  state.pendingShareJoin = null;
  state.pendingShareJoinCancellationAnchorSessionId = "";
}

function cancelPendingPrivateShareJoinRequest() {
  const anchorSessionId = String(state.pendingShareJoin?.anchorSessionId ?? "").trim();
  if (!anchorSessionId || state.pendingShareJoin?.approved === true || isPrivateShareJoinCancellationPending(anchorSessionId)) {
    return false;
  }
  const cancelled = sendWorldSocketMessage({
    type: "share:join-cancel",
    anchorSessionId,
  });
  if (!cancelled) {
    setPrivateBrowserStatus("Private world share is offline right now.");
    return false;
  }
  state.pendingShareJoinCancellationAnchorSessionId = anchorSessionId;
  updatePrivateBrowserPanel();
  return true;
}

async function handlePrivateNearbyShareLaunch({ defaultLaunch, getLocalSession, getSelectedMode }) {
  const selectedMode = normalizeBrowserShareKind(getSelectedMode?.(), state.browserShareMode);
  if (selectedMode === "game") {
    const localGameSession = getLocalPrivateGameSession();
    if (localGameSession) {
      requestOpenPrivateGameSession(localGameSession);
      return true;
    }
    if (!getSelectedPrivateWorldGame()) {
      await startPrivateWorldGameShare();
      return true;
    }
    const joinTarget = getPrivateGameShareJoinTarget();
    const approvedJoin = state.pendingShareJoin?.approved === true ? state.pendingShareJoin : null;
    if (!joinTarget || (approvedJoin && approvedJoin.anchorSessionId === String(joinTarget?.session_id ?? "").trim())) {
      await startPrivateWorldGameShare();
      return true;
    }
    if (!isPrivateWorldReadyForShare()) {
      updatePrivateBrowserPanel();
      return true;
    }
    state.pendingShareJoin = {
      anchorSessionId: String(joinTarget?.session_id ?? "").trim(),
      anchorHostSessionId: String(joinTarget?.host_viewer_session_id ?? "").trim(),
      shareKind: "game",
      approved: false,
    };
    state.pendingShareJoinCancellationAnchorSessionId = "";
    const sent = sendWorldSocketMessage({
      type: "share:join-request",
      anchorSessionId: joinTarget.session_id,
      shareKind: "game",
    });
    if (!sent) {
      clearPendingPrivateShareJoinState();
      updatePrivateBrowserPanel();
      setPrivateBrowserStatus("Private world share is offline right now.");
      return true;
    }
    updatePrivateBrowserPanel();
    setPrivateBrowserStatus(`Asked ${getPrivateGameHostName(joinTarget) || "the nearby host"} to join.`);
    return true;
  }
  const localSession = getLocalSession();
  if (localSession) {
    return defaultLaunch();
  }
  const joinTarget = getPrivateShareJoinTarget();
  const approvedJoin = state.pendingShareJoin?.approved === true ? state.pendingShareJoin : null;
  if (!joinTarget || (approvedJoin && approvedJoin.anchorSessionId === joinTarget.sessionId)) {
    return defaultLaunch();
  }
  if (!isPrivateWorldReadyForShare()) {
    updatePrivateBrowserPanel();
    return true;
  }
  const shareKind = selectedMode;
  state.pendingShareJoin = {
    anchorSessionId: joinTarget.sessionId,
    anchorHostSessionId: joinTarget.hostSessionId,
    shareKind,
    approved: false,
  };
  state.pendingShareJoinCancellationAnchorSessionId = "";
  const sent = sendWorldSocketMessage({
    type: "share:join-request",
    anchorSessionId: joinTarget.sessionId,
    shareKind,
  });
  if (!sent) {
    clearPendingPrivateShareJoinState();
    updatePrivateBrowserPanel();
    setPrivateBrowserStatus("Private world share is offline right now.");
    return true;
  }
  updatePrivateBrowserPanel();
  setPrivateBrowserStatus(`Asked ${getPrivateDisplayNameForSessionId(joinTarget.hostSessionId) || "the nearby host"} to join.`);
  return true;
}

const privateBrowserShareFeature = createNearbyDisplayShareFeature({
  modeButtons: elements.panelBrowserShareModes,
  modeAttribute: "data-private-browser-share-mode",
  titleInput: elements.panelBrowserShareTitle,
  launchButton: elements.panelBrowserLaunch,
  getMode: () => state.browserShareMode,
  setMode(mode) {
    state.browserShareMode = mode;
  },
  onModeChanged() {
    if (state.browserShareMode === "game" && state.browserOverlayOpen) {
      setPrivateBrowserOverlayOpen(false);
    }
    updatePrivateBrowserPanel();
  },
  handleLaunch: handlePrivateNearbyShareLaunch,
  getTitleInputValue: () => elements.panelBrowserShareTitle?.value ?? "",
  getSessionShareKind: getPrivateBrowserSessionShareKind,
  getPendingShare: () => state.pendingBrowserShare,
  getLocalSession: getLocalPrivateBrowserSession,
  getLocalShare: () => state.localBrowserShare,
  clearPendingShare: clearPendingPrivateBrowserShare,
  clearLocalShare: clearLocalPrivateBrowserShare,
  onLocalShareEnded({ sessionId }) {
    dropLocalPrivateBrowserSession(sessionId);
    renderPrivateLiveSharesList();
  },
  getFallbackSize: () => ({ width: 16, height: 9 }),
  stopLiveShare(sessionId) {
    sendWorldSocketMessage({
      type: "browser:stop",
      sessionId,
    });
  },
  startLiveShare(payload) {
    return sendWorldSocketMessage({
      type: "browser:start",
      ...payload,
    });
  },
  beginShare: startLocalPrivateNearbyShare,
  patchSession(sessionId, sessionPatch) {
    state.browserSessions.set(sessionId, sessionPatch);
  },
  getDisplaySurface: () => state.localBrowserShare?.displaySurface || "",
  setStatus: setPrivateBrowserStatus,
  updateView: updatePrivateBrowserPanel,
  updatingStatusText: "Updating live share title...",
  canLaunch: () => isPrivateWorldReadyForShare(),
  onCannotLaunch() {
    updatePrivateBrowserPanel();
  },
  onUnsupported(message) {
    setPrivateBrowserStatus(message);
  },
  onError(message, error) {
    setPrivateBrowserStatus(error?.message || message);
  },
  unsupportedMessages: {
    screen: "This browser does not support screen sharing.",
    camera: "This browser does not support camera sharing.",
    audio: "This browser does not support voice sharing.",
  },
  failureMessages: {
    screen: "Could not start screen sharing.",
    camera: "Could not start video sharing.",
    audio: "Could not start voice sharing.",
  },
});

function startLocalPrivateNearbyShare(share) {
  if (!isPrivateWorldReadyForShare()) {
    updatePrivateBrowserPanel();
    return false;
  }
  if (!share) {
    return false;
  }
  state.browserPanelRemoteSessionId = "";
  clearPendingPrivateBrowserShare({ stopTracks: true });
  state.pendingBrowserShare = share;
  setLocalPrivateBrowserPreviewStream(share.hasVideo ? share.stream : null);
  setPrivateBrowserStatus("Starting nearby share...");
  const existingLocalSession = getLocalPrivateBrowserSession();
  const approvedJoin = state.pendingShareJoin?.approved === true ? state.pendingShareJoin : null;
  const anchorSessionId = approvedJoin?.anchorSessionId
    || (isPrivateBrowserMemberSession(existingLocalSession) ? getPrivateBrowserAnchorSessionId(existingLocalSession) : "");
  const memberShare = Boolean(anchorSessionId);
  const sent = sendWorldSocketMessage({
    type: "browser:start",
    mode: "display-share",
    title: memberShare ? "" : share.title,
    shareKind: share.shareKind,
    hasVideo: share.hasVideo,
    hasAudio: share.hasAudio,
    aspectRatio: share.aspectRatio,
    displaySurface: share.displaySurface,
    anchorSessionId,
  });
  if (!sent) {
    clearPendingPrivateBrowserShare({ stopTracks: true });
    setPrivateBrowserStatus("Live share is offline right now.");
    updatePrivateBrowserPanel();
    return false;
  }
  updatePrivateBrowserPanel();
  return true;
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
      const nextPanelSessionId = getPrivateRemotePanelSessionId(sessionId);
      if (!state.localBrowserShare && elements.panelBrowserVideo && nextPanelSessionId) {
        state.browserPanelRemoteSessionId = nextPanelSessionId;
      }
      if (!state.localBrowserShare && elements.panelBrowserVideo && nextPanelSessionId === sessionId) {
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
      const normalizedSessionId = String(sessionId ?? "").trim();
      if (!normalizedSessionId) {
        return;
      }
      const audioStates = ensurePrivateRemoteAudioStateMap();
      if (available === true) {
        audioStates.set(normalizedSessionId, {
          available: true,
          blocked: blocked === true,
          error: String(error ?? "").trim(),
        });
      } else {
        audioStates.delete(normalizedSessionId);
      }
      syncPrivateRemoteAudioState(normalizedSessionId);
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

function isPrivateWorldReadyForShare() {
  return Boolean(
    state.session
    && state.selectedWorld
    && getLocalParticipant()
    && state.browserMediaState.enabled !== false
    && state.worldSocket?.readyState === WebSocket.OPEN
    && !state.authRefreshPromise
  );
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
  privateBrowserShareFeature.setSelectedMode(share.shareKind);
  setLocalPrivateBrowserPreviewStream(share.hasVideo ? share.stream : null);
  if (elements.panelBrowserShareTitle) {
    elements.panelBrowserShareTitle.value = share.title || "";
  }
  if (share.hasVideo && elements.panelBrowserVideo) {
    setPrivateShareBubbleVideo(sessionId, elements.panelBrowserVideo);
  } else {
    clearPrivateShareBubbleVideo(sessionId);
  }
  void getPrivateBrowserMediaController().publishStream({
    sessionId,
    stream: share.stream,
    viewerSessionId: getPrivateViewerSessionId(),
    worldSnapshotId: getPrivateBrowserWorldKey(),
  }).then((published) => {
    if (!published) {
      clearLocalPrivateBrowserShare({ stopTracks: true, sessionId });
      dropLocalPrivateBrowserSession(sessionId);
      sendWorldSocketMessage({
        type: "browser:stop",
        sessionId,
      });
      updatePrivateBrowserPanel();
    }
  }).catch(() => {
    clearLocalPrivateBrowserShare({ stopTracks: true, sessionId });
    dropLocalPrivateBrowserSession(sessionId);
    sendWorldSocketMessage({
      type: "browser:stop",
      sessionId,
    });
    updatePrivateBrowserPanel();
  });
}

function attachLocalPrivateVoiceShare(sessionId, share) {
  if (!share || !sessionId || !getPrivateBrowserWorldKey()) {
    return;
  }
  clearLocalPrivateVoiceShare({ stopTracks: true });
  state.localVoiceShare = {
    ...share,
    sessionId,
  };
  void getPrivateBrowserMediaController().publishStream({
    sessionId,
    stream: share.stream,
    viewerSessionId: getPrivateViewerSessionId(),
    worldSnapshotId: getPrivateBrowserWorldKey(),
  }).then((published) => {
    if (!published) {
      clearLocalPrivateVoiceShare({ stopTracks: true, sessionId });
      dropLocalPrivateBrowserSession(sessionId);
      sendWorldSocketMessage({
        type: "voice:stop",
        sessionId,
      });
      updatePrivateVoicePanel();
    }
  }).catch(() => {
    clearLocalPrivateVoiceShare({ stopTracks: true, sessionId });
    dropLocalPrivateBrowserSession(sessionId);
    sendWorldSocketMessage({
      type: "voice:stop",
      sessionId,
    });
    updatePrivateVoicePanel();
  });
}

async function startPrivatePersistentVoiceChat() {
  if (!isPrivateWorldReadyForShare()) {
    updatePrivateBrowserPanel();
    return false;
  }
  clearPendingPrivateVoiceShare({ stopTracks: true });
  const started = await launchNearbyDisplayShare({
    shareKind: "audio",
    getRequestedTitle: () => "",
    createShare: (stream, shareOptions = {}) => createLocalDisplayShare(stream, {
      ...shareOptions,
      title: "",
      shareKind: "audio",
      hasVideo: false,
      hasAudio: true,
      aspectRatio: 1.2,
      fallbackWidth: 540,
      fallbackHeight: 432,
      isPendingShare: (candidate) => state.pendingVoiceShare?.stream === candidate.stream,
      isLocalShare: (candidate) => state.localVoiceShare?.stream === candidate.stream,
      onEndedWhilePending() {
        clearPendingPrivateVoiceShare({ stopTracks: false });
        updatePrivateVoicePanel();
      },
      onEndedWhileLive() {
        const sessionId = String(state.localVoiceShare?.sessionId ?? state.localVoiceSessionId ?? "").trim();
        clearLocalPrivateVoiceShare({ stopTracks: false, sessionId });
        dropLocalPrivateBrowserSession(sessionId);
        if (sessionId) {
          sendWorldSocketMessage({
            type: "voice:stop",
            sessionId,
          });
        }
        updatePrivateVoicePanel();
      },
    }),
    startShare(share) {
      state.pendingVoiceShare = share;
      const sent = sendWorldSocketMessage({
        type: "voice:start",
      });
      if (!sent) {
        clearPendingPrivateVoiceShare({ stopTracks: true });
        updatePrivateVoicePanel();
        setPrivateBrowserStatus("Private world share is offline right now.");
        return false;
      }
      updatePrivateVoicePanel();
      return true;
    },
    onUnsupported(message) {
      setPrivateBrowserStatus(message);
    },
    onError(message, error) {
      setPrivateBrowserStatus(error?.message || message);
    },
    unsupportedMessages: {
      audio: "This browser does not support voice sharing.",
    },
    failureMessages: {
      audio: "Could not start voice sharing.",
    },
  });
  updatePrivateVoicePanel();
  return started;
}

function stopPrivatePersistentVoiceChat() {
  const localVoiceSession = getLocalPrivateVoiceSession();
  if (localVoiceSession) {
    return sendWorldSocketMessage({
      type: "voice:stop",
      sessionId: localVoiceSession.sessionId,
    });
  }
  if (state.pendingVoiceShare) {
    clearPendingPrivateVoiceShare({ stopTracks: true });
    updatePrivateVoicePanel();
    return true;
  }
  return false;
}

function updatePrivateBrowserSessionState(sessionPatch = {}) {
  const sessionId = String(sessionPatch.sessionId ?? "").trim();
  if (!sessionId) {
    return;
  }
  const previous = state.browserSessions.get(sessionId) ?? {};
  const next = normalizeHostedBrowserSession({
    ...previous,
    ...sessionPatch,
    deliveryMode: sessionPatch.deliveryMode ?? previous.deliveryMode ?? "placeholder",
    frameTransport: sessionPatch.frameTransport ?? previous.frameTransport ?? "jpeg-sequence",
    lastFrameDataUrl: sessionPatch.lastFrameDataUrl ?? previous.lastFrameDataUrl ?? "",
    lastFrameId: Number(sessionPatch.lastFrameId ?? previous.lastFrameId) || 0,
    sessionMode: sessionPatch.sessionMode ?? previous.sessionMode ?? "display-share",
    aspectRatio: Number(sessionPatch.aspectRatio ?? previous.aspectRatio) || PRIVATE_BROWSER_SHARE.aspectRatio,
  }, getPrivateViewerSessionId());
  state.browserSessions.set(sessionId, next);
  if (next.hasVideo === false) {
    clearPrivateShareBubbleVideo(next.sessionId);
  }

  if (next.hostSessionId === getPrivateViewerSessionId()) {
    if (isPrivatePersistentVoiceSession(next)) {
      state.localVoiceSessionId = next.sessionId;
    } else {
      state.localBrowserSessionId = next.sessionId;
    }
    if (isLiveKitBrowserTransport(next.frameTransport) && getPrivateBrowserWorldKey()) {
      void getPrivateBrowserMediaController().connect({
        viewerSessionId: getPrivateViewerSessionId(),
        worldSnapshotId: getPrivateBrowserWorldKey(),
        canPublish: true,
      });
    }
    if (isPrivatePersistentVoiceSession(next) && state.pendingVoiceShare?.stream) {
      const pendingVoiceShare = state.pendingVoiceShare;
      state.pendingVoiceShare = null;
      attachLocalPrivateVoiceShare(next.sessionId, pendingVoiceShare);
    } else if (next.sessionMode === "display-share" && state.pendingBrowserShare?.stream) {
      const pendingShare = state.pendingBrowserShare;
      state.pendingBrowserShare = null;
      attachLocalPrivateBrowserShare(next.sessionId, pendingShare);
    }
    if (isPrivateBrowserMemberSession(next)) {
      clearPendingPrivateShareJoinState();
    }
  }

  reconcilePrivateShareBubbles();
  reconcilePrivateBrowserAnchors();
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
  if (hostSessionId && hostSessionId === getPrivateViewerSessionId() && sessionId === state.localVoiceSessionId) {
    clearPendingPrivateVoiceShare();
  } else if (hostSessionId && hostSessionId === getPrivateViewerSessionId()) {
    clearPendingPrivateBrowserShare();
  }
  clearLocalPrivateBrowserShare({ sessionId });
  clearLocalPrivateVoiceShare({ sessionId });
  dropLocalPrivateBrowserSession(sessionId);
  if (state.pendingShareJoin?.anchorSessionId === sessionId) {
    clearPendingPrivateShareJoinState();
  }
  if (state.pendingShareJoinCancellationAnchorSessionId === sessionId) {
    state.pendingShareJoinCancellationAnchorSessionId = "";
  }
  if (state.pendingVoiceJoin?.anchorSessionId === sessionId) {
    clearPendingPrivateVoiceJoinState();
  }
  if (state.pendingVoiceJoinCancellationAnchorSessionId === sessionId) {
    state.pendingVoiceJoinCancellationAnchorSessionId = "";
  }
  if (state.voiceJoinOffer?.anchorSessionId === sessionId) {
    state.voiceJoinOffer = null;
  }
  state.incomingShareJoinRequests = state.incomingShareJoinRequests.filter((request) => request.anchorSessionId !== sessionId);
  state.incomingVoiceJoinRequests = state.incomingVoiceJoinRequests.filter((request) => request.anchorSessionId !== sessionId);
  reconcilePrivateShareBubbles();
  reconcilePrivateBrowserAnchors();
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function updatePrivateGameSessionState(sessionPatch = {}) {
  const sessionId = String(sessionPatch?.session_id ?? "").trim();
  if (!sessionId) {
    return;
  }
  const previous = state.gameSessions.get(sessionId) ?? {};
  const next = {
    ...previous,
    ...cloneJson(sessionPatch),
    session_id: sessionId,
  };
  state.gameSessions.set(sessionId, next);
  if (
    state.pendingGameShareGameId
    && String(next?.host_viewer_session_id ?? "").trim() === getPrivateViewerSessionId()
    && String(next?.game?.id ?? "").trim() === state.pendingGameShareGameId
  ) {
    state.pendingGameShareGameId = "";
    requestOpenPrivateGameSession(next);
  }
  if (
    String(next?.host_viewer_session_id ?? "").trim() === getPrivateViewerSessionId()
    && isPrivateGameMemberSession(next)
  ) {
    clearPendingPrivateShareJoinState();
  }
  if (privateGameShell.isOpen(sessionId)) {
    privateGameShell.updateSession(next);
  }
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function handlePrivateGamePreview(payload = {}) {
  const sessionId = String(payload.sessionId ?? "").trim();
  const existing = state.gameSessions.get(sessionId);
  if (!existing) {
    return;
  }
  state.gameSessions.set(sessionId, {
    ...existing,
    latest_preview: cloneJson(payload.preview ?? null),
  });
  if (privateGameShell.isOpen(sessionId)) {
    privateGameShell.updateSession(state.gameSessions.get(sessionId));
  }
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function handlePrivateGameStop(payload = {}) {
  const sessionId = String(payload.sessionId ?? "").trim();
  if (!sessionId) {
    return;
  }
  const stoppedSession = state.gameSessions.get(sessionId);
  state.gameSessions.delete(sessionId);
  if (state.pendingShareJoin?.anchorSessionId === sessionId) {
    clearPendingPrivateShareJoinState();
  }
  if (state.pendingShareJoinCancellationAnchorSessionId === sessionId) {
    state.pendingShareJoinCancellationAnchorSessionId = "";
  }
  if (
    stoppedSession
    && String(stoppedSession?.host_viewer_session_id ?? "").trim() === getPrivateViewerSessionId()
  ) {
    state.pendingGameShareGameId = "";
  }
  if (privateGameShell.isOpen(sessionId)) {
    privateGameShell.close();
    setPrivateBrowserStatus("That game share just ended.");
  }
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function resetPrivateBrowserState({ disconnectController = false, stopTracks = false } = {}) {
  if (state.browserOverlayOpen) {
    setPrivateBrowserOverlayOpen(false);
  }
  clearPendingPrivateBrowserShare({ stopTracks });
  clearLocalPrivateBrowserShare({ stopTracks });
  clearPendingPrivateVoiceShare({ stopTracks });
  clearLocalPrivateVoiceShare({ stopTracks });
  for (const sessionId of state.browserSessions.keys()) {
    state.browserMediaController?.removeSession?.(sessionId);
  }
  state.browserSessions = new Map();
  state.localBrowserSessionId = "";
  state.localVoiceSessionId = "";
  state.browserPanelRemoteSessionId = "";
  state.pendingShareJoin = null;
  state.pendingShareJoinCancellationAnchorSessionId = "";
  state.incomingShareJoinRequests = [];
  state.voiceJoinOffer = null;
  state.pendingVoiceJoin = null;
  state.pendingVoiceJoinCancellationAnchorSessionId = "";
  state.incomingVoiceJoinRequests = [];
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
  reconcilePrivateBrowserAnchors();
  updatePrivateBrowserPanel();
  renderPrivateLiveSharesList();
}

function updatePrivateGamePanel({ canShare, socketReady }) {
  const localGameSession = getLocalPrivateGameSession();
  const selectedGame = getSelectedPrivateWorldGame();
  const joinTarget = getPrivateGameShareJoinTarget();
  const pendingShareJoinRequest = Boolean(
    !localGameSession
    && state.pendingShareJoin?.shareKind === "game"
    && state.pendingShareJoin?.anchorSessionId
    && state.pendingShareJoin?.approved !== true,
  );
  const cancelingShareJoinRequest = pendingShareJoinRequest
    && isPrivateShareJoinCancellationPending(state.pendingShareJoin?.anchorSessionId);
  const joinMode = Boolean(!localGameSession && joinTarget);
  const joinStateMatches = String(state.pendingShareJoin?.anchorSessionId ?? "").trim() === String(joinTarget?.session_id ?? "").trim();
  const joinApproved = joinMode && joinStateMatches && state.pendingShareJoin?.approved === true;
  const previewUrl = String(localGameSession?.latest_preview?.data_url ?? "").trim();
  elements.panelBrowserPanel?.classList.add("is-game-mode");
  elements.panelBrowserPanel?.classList.remove("is-docked-compact");
  elements.panelBrowserStage?.classList.add("is-active");
  elements.panelBrowserStage?.classList.remove("is-collapsed", "is-permission-only", "needs-video-start");
  elements.panelBrowserShare?.classList.toggle("is-join-mode", joinMode);
  if (elements.panelBrowserStage) {
    elements.panelBrowserStage.tabIndex = -1;
    elements.panelBrowserStage.setAttribute("aria-hidden", "false");
  }
  if (elements.panelBrowserShareTitle) {
    elements.panelBrowserShareTitle.disabled = true;
    if (document.activeElement !== elements.panelBrowserShareTitle) {
      elements.panelBrowserShareTitle.value = "";
    }
  }
  renderPrivateShareJoinRequests();
  renderPrivateGameShareGroupSummary();
  updatePrivateVoicePanel();
  renderPrivateVoiceJoinOffers();
  renderPrivateVoiceJoinRequests();

  if (!state.selectedWorld) {
    setPrivateBrowserStatus("Open a world to share games.");
    updatePrivateBrowserSummary({
      state: "offline",
      badge: "Offline",
      current: "No world selected",
      hint: "Open a world first.",
    });
  } else if (!state.session) {
    setPrivateBrowserStatus("Sign in to save or share games.");
    updatePrivateBrowserSummary({
      state: "offline",
      badge: "Signed out",
      current: "Sign in to go live",
      hint: "Signed-in participants can generate, save, and share HTML games.",
    });
  } else if (pendingShareJoinRequest) {
    const hostName = getPrivateGameHostName(joinTarget ?? {});
    setPrivateBrowserStatus(
      cancelingShareJoinRequest
        ? `Canceling your nearby game request to ${hostName}...`
        : `Waiting for ${hostName} to approve your nearby game request...`,
    );
    updatePrivateBrowserSummary({
      state: "starting",
      badge: cancelingShareJoinRequest ? "Canceling" : "Waiting",
      current: selectedGame ? `Requested ${getPrivateSavedGameTitle(selectedGame)}` : "Requested Game",
      hint: cancelingShareJoinRequest
        ? "This request will disappear from the anchor host as soon as the world socket updates."
        : "Once approved, sharing your game keeps it attached to this nearby group without creating another live row.",
    });
  } else if (state.pendingGameShareGameId) {
    setPrivateBrowserStatus("Starting your game share...");
    updatePrivateBrowserSummary({
      state: "starting",
      badge: "Starting",
      current: "Starting your game",
      hint: "The host window opens as soon as the world socket confirms the share.",
    });
  } else if (localGameSession) {
    const seatedPlayers = normalizePrivateGameSeats(localGameSession).filter((seat) => seat.viewer_session_id).length;
    const maxSeats = getPrivateGameSeatCapacity(localGameSession);
    const memberShare = isPrivateGameMemberSession(localGameSession);
    setPrivateBrowserStatus(
      localGameSession.started
        ? (memberShare ? "Your game match is live inside this nearby group." : "Your game match is live in this world.")
        : (memberShare ? "Your game lobby is open inside this nearby group." : "Your game lobby is open in this world."),
    );
    updatePrivateBrowserSummary({
      state: "live",
      badge: memberShare ? "Group" : (localGameSession.started ? "Live" : "Lobby"),
      current: getPrivateGameSessionTitle(localGameSession),
      hint: memberShare
        ? `${seatedPlayers} / ${maxSeats} seats claimed. Leaving the anchor circle stops this contributor game share.`
        : `${seatedPlayers} / ${maxSeats} seats claimed. Movement stays locked while this anchor game is live.`,
    });
  } else if (joinMode && selectedGame) {
    const hostName = getPrivateGameHostName(joinTarget);
    setPrivateBrowserStatus(`Join ${hostName}'s nearby game group after approval.`);
    updatePrivateBrowserSummary({
      state: "draft",
      badge: "Join",
      current: getPrivateSavedGameTitle(selectedGame),
      hint: joinApproved
        ? "Approval is in. Share Game to add this as a contributor game without creating another live row."
        : "Share Game to ask the anchor host for access first.",
    });
  } else if (selectedGame) {
    setPrivateBrowserStatus(`Selected ${getPrivateSavedGameTitle(selectedGame)}.`);
    updatePrivateBrowserSummary({
      state: "draft",
      badge: "Ready",
      current: getPrivateSavedGameTitle(selectedGame),
      hint: "Share it nearby, or open the library to generate something new.",
    });
  } else {
    setPrivateBrowserStatus("Pick or generate a game to share in this world.");
    updatePrivateBrowserSummary({
      state: "idle",
      badge: "Library",
      current: "No game selected",
      hint: "Open the library to choose a saved game or generate one with your local AI key.",
    });
  }

  if (elements.panelBrowserLaunch) {
    if (localGameSession) {
      elements.panelBrowserLaunch.textContent = "Open Game";
      elements.panelBrowserLaunch.disabled = !canShare;
    } else if (pendingShareJoinRequest) {
      elements.panelBrowserLaunch.textContent = cancelingShareJoinRequest ? "Canceling..." : "Waiting...";
      elements.panelBrowserLaunch.disabled = true;
    } else if (!selectedGame) {
      elements.panelBrowserLaunch.textContent = "Open Library";
      elements.panelBrowserLaunch.disabled = !canShare;
    } else if (joinMode) {
      elements.panelBrowserLaunch.textContent = joinApproved ? "Share Game" : "Request Game";
      elements.panelBrowserLaunch.disabled = !canShare || Boolean(state.pendingGameShareGameId);
    } else {
      elements.panelBrowserLaunch.textContent = "Share Game";
      elements.panelBrowserLaunch.disabled = !canShare || Boolean(state.pendingGameShareGameId);
    }
  }
  if (elements.panelBrowserStop) {
    elements.panelBrowserStop.hidden = !(localGameSession || pendingShareJoinRequest);
    if (pendingShareJoinRequest) {
      elements.panelBrowserStop.textContent = cancelingShareJoinRequest ? "Canceling..." : "Cancel Request";
      elements.panelBrowserStop.disabled = cancelingShareJoinRequest || !socketReady;
    } else {
      elements.panelBrowserStop.textContent = "Stop";
      elements.panelBrowserStop.disabled = !socketReady;
    }
  }
  if (elements.panelBrowserExpand) {
    elements.panelBrowserExpand.disabled = !localGameSession;
    syncDisplayShareExpandButton(elements.panelBrowserExpand, false);
  }
  if (elements.panelBrowserResume) {
    elements.panelBrowserResume.hidden = true;
  }
  if (elements.panelBrowserVideo) {
    elements.panelBrowserVideo.hidden = true;
  }
  setPrivateBrowserPreviewStream(null);
  if (elements.panelBrowserFrame && previewUrl) {
    elements.panelBrowserFrame.hidden = false;
    if (elements.panelBrowserFrame.getAttribute("src") !== previewUrl) {
      elements.panelBrowserFrame.src = previewUrl;
    }
    elements.panelBrowserPlaceholder.hidden = true;
  } else if (elements.panelBrowserFrame && elements.panelBrowserPlaceholder) {
    elements.panelBrowserFrame.hidden = true;
    elements.panelBrowserFrame.removeAttribute("src");
    elements.panelBrowserPlaceholder.hidden = false;
    elements.panelBrowserPlaceholder.textContent = localGameSession
      ? "Open the game window to play, publish previews, and let nearby visitors claim seats."
      : pendingShareJoinRequest
        ? "Waiting for the anchor host to approve this nearby game request."
        : joinMode && selectedGame
          ? "Share Game to add this game inside the nearby group once the host approves."
      : selectedGame
        ? `${getPrivateSavedGameTitle(selectedGame)} is ready to share in this world.`
        : "Open the game library to choose or generate a simple HTML game.";
  }
}

function updatePrivateBrowserPanel() {
  if (state.localBrowserShare && !isLocalDisplayShareActive(state.localBrowserShare)) {
    const endedSessionId = String(state.localBrowserShare.sessionId ?? state.localBrowserSessionId ?? "").trim();
    clearLocalPrivateBrowserShare({ stopTracks: false, sessionId: endedSessionId });
    dropLocalPrivateBrowserSession(endedSessionId);
    if (endedSessionId) {
      sendWorldSocketMessage({
        type: "browser:stop",
        sessionId: endedSessionId,
      });
    }
  }
  if (state.localVoiceShare && !isLocalDisplayShareActive(state.localVoiceShare)) {
    const endedVoiceSessionId = String(state.localVoiceShare.sessionId ?? state.localVoiceSessionId ?? "").trim();
    clearLocalPrivateVoiceShare({ stopTracks: false, sessionId: endedVoiceSessionId });
    dropLocalPrivateBrowserSession(endedVoiceSessionId);
    if (endedVoiceSessionId) {
      sendWorldSocketMessage({
        type: "voice:stop",
        sessionId: endedVoiceSessionId,
      });
    }
  }
  const world = state.selectedWorld;
  const gameMode = state.browserShareMode === "game";
  const localParticipant = getLocalParticipant();
  const localSession = getLocalPrivateBrowserSession();
  const localVoiceSession = getLocalPrivateVoiceSession();
  const joinTarget = getPrivateShareJoinTarget();
  const joinMode = Boolean(!localSession && joinTarget);
  const pendingShareJoinRequest = Boolean(!localSession && state.pendingShareJoin?.anchorSessionId && state.pendingShareJoin.approved !== true);
  const cancelingShareJoinRequest = pendingShareJoinRequest
    && isPrivateShareJoinCancellationPending(state.pendingShareJoin?.anchorSessionId);
  const titleLocked = joinMode || isPrivateBrowserMemberSession(localSession);
  const draft = privateBrowserShareFeature.getDraft(localSession);
  if (state.browserPanelRemoteSessionId && !state.browserSessions.has(state.browserPanelRemoteSessionId)) {
    state.browserPanelRemoteSessionId = "";
  }
  const mediaAvailable = state.browserMediaState.enabled !== false;
  const socketReady = state.worldSocket?.readyState === WebSocket.OPEN;
  const authStable = !state.authRefreshPromise;
  const remoteSession = state.browserPanelRemoteSessionId
    ? state.browserSessions.get(state.browserPanelRemoteSessionId) ?? null
    : localSession
      ? null
      : [...state.browserSessions.values()].find(
        (session) =>
          session.hostSessionId !== getPrivateViewerSessionId()
          && session.deliveryMode === "full"
          && !isPrivatePersistentVoiceSession(session),
      ) ?? null;
  const canShare = Boolean(state.session && world && localParticipant && mediaAvailable && socketReady && authStable);
  if (gameMode) {
    updatePrivateGamePanel({ canShare, socketReady });
    return;
  }
  elements.panelBrowserPanel?.classList.remove("is-game-mode");
  const previewStream = state.pendingBrowserShare?.hasVideo
    ? state.pendingBrowserShare.stream
    : state.localBrowserShare?.hasVideo
      ? state.localBrowserShare.stream
      : state.localBrowserPreviewStream ?? null;
  const remoteSessionHasVideo = Boolean(remoteSession && remoteSession.hasVideo !== false);
  const hasRemotePanelVideo = Boolean(
    !previewStream
    && remoteSessionHasVideo
    && remoteSession
    && elements.panelBrowserVideo?.srcObject
    && state.browserPanelRemoteSessionId === remoteSession.sessionId,
  );
  const needsPlaybackStart = Boolean(
    !previewStream
    && remoteSession
    && remoteSessionHasVideo
    && String(state.browserMediaState.lastPlayError || "").includes("NotAllowedError"),
  );
  const needsAudioStart = Boolean(
    remoteSession
    && state.browserMediaState.remoteAudioAvailable
    && state.browserMediaState.remoteAudioBlocked
    && state.browserMediaState.remoteAudioSessionId === remoteSession.sessionId,
  );
  const frameUrl = localSession?.lastFrameDataUrl ?? remoteSession?.lastFrameDataUrl ?? "";
  const hasActiveBrowserMedia = Boolean(previewStream || hasRemotePanelVideo || remoteSession || localSession || frameUrl);
  const stageLayout = getDisplayShareStageLayout({
    overlayOpen: state.browserOverlayOpen,
    needsManualPlaybackStart: needsPlaybackStart,
    needsManualAudioStart: needsAudioStart,
  });

  privateBrowserShareFeature.setSelectedMode(state.browserShareMode);
  elements.panelBrowserPanel?.classList.toggle("is-docked-compact", stageLayout.collapseDockedStage);
  elements.panelBrowserStage?.classList.toggle("is-active", hasActiveBrowserMedia);
  elements.panelBrowserStage?.classList.toggle("is-collapsed", stageLayout.collapseDockedStage);
  elements.panelBrowserStage?.classList.toggle("is-permission-only", stageLayout.permissionOnlyDockedStage);
  elements.panelBrowserStage?.classList.toggle("needs-video-start", stageLayout.needsManualPlaybackStart);
  if (elements.panelBrowserStage) {
    elements.panelBrowserStage.tabIndex = state.browserOverlayOpen ? 0 : -1;
    elements.panelBrowserStage.setAttribute("aria-hidden", stageLayout.collapseDockedStage ? "true" : "false");
  }
  if (elements.panelBrowserShareTitle) {
    elements.panelBrowserShareTitle.disabled = !canShare || titleLocked;
    if (titleLocked && document.activeElement !== elements.panelBrowserShareTitle) {
      elements.panelBrowserShareTitle.value = "";
    }
  }
  elements.panelBrowserShare?.classList.toggle("is-join-mode", titleLocked);
  renderPrivateShareJoinRequests();
  renderPrivateShareGroupSummary();
  updatePrivateVoicePanel();
  renderPrivateVoiceJoinOffers();
  renderPrivateVoiceJoinRequests();
  const launchState = getDisplayShareLaunchState({
    canShare,
    pending: Boolean(state.pendingBrowserShare),
    localSession,
    draft,
  });
  syncDisplayShareActionButtons({
    launchButton: elements.panelBrowserLaunch,
    stopButton: elements.panelBrowserStop,
    launchState,
    showStop: Boolean(localSession || pendingShareJoinRequest),
  });
  if (!localSession && pendingShareJoinRequest && elements.panelBrowserLaunch) {
    elements.panelBrowserLaunch.textContent = cancelingShareJoinRequest ? "Canceling..." : "Waiting...";
    elements.panelBrowserLaunch.disabled = true;
  } else if (!localSession && joinMode && elements.panelBrowserLaunch) {
    const joinStateMatches = state.pendingShareJoin?.anchorSessionId === joinTarget?.sessionId;
    const waitingForApproval = joinStateMatches && state.pendingShareJoin.approved !== true;
    const joinApproved = joinStateMatches && state.pendingShareJoin.approved === true;
    elements.panelBrowserLaunch.textContent = waitingForApproval
      ? "Waiting..."
      : joinApproved
        ? `Start ${getBrowserShareKindLabel(state.browserShareMode)}`
        : `Request ${getBrowserShareKindLabel(state.browserShareMode)}`;
    elements.panelBrowserLaunch.disabled = !canShare || waitingForApproval || Boolean(state.pendingBrowserShare);
  }
  if (elements.panelBrowserStop) {
    if (pendingShareJoinRequest) {
      elements.panelBrowserStop.hidden = false;
      elements.panelBrowserStop.textContent = cancelingShareJoinRequest ? "Canceling..." : "Cancel Request";
      elements.panelBrowserStop.disabled = cancelingShareJoinRequest || !socketReady;
      elements.panelBrowserStop.setAttribute("aria-hidden", "false");
    } else {
      elements.panelBrowserStop.textContent = "Stop";
    }
  }
  syncDisplayShareExpandButton(elements.panelBrowserExpand, state.browserOverlayOpen);

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
  } else if (state.pendingShareJoin?.anchorSessionId && state.pendingShareJoin.approved !== true) {
    const hostName = getPrivateDisplayNameForSessionId(state.pendingShareJoin.anchorHostSessionId) || "nearby host";
    setPrivateBrowserStatus(
      cancelingShareJoinRequest
        ? `Canceling your nearby share request to ${hostName}...`
        : `Waiting for ${hostName} to approve your nearby share request...`,
    );
    updatePrivateBrowserSummary({
      state: "starting",
      badge: cancelingShareJoinRequest ? "Canceling" : "Waiting",
      current: `Requested ${getBrowserShareKindLabel(state.pendingShareJoin.shareKind || state.browserShareMode)}`,
      hint: cancelingShareJoinRequest
        ? "This request will disappear from the anchor host as soon as the world socket updates."
        : "Once approved, you can choose your screen, video, or voice and it will stay attached to this anchor group.",
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
  } else if (!localSession && localParticipant && joinTarget) {
    const hostName = getPrivateDisplayNameForSessionId(joinTarget.hostSessionId) || "Nearby host";
    setPrivateBrowserStatus(`Join ${hostName}'s nearby share group after approval.`);
    updatePrivateBrowserSummary({
      state: "draft",
      badge: "Join",
      current: getPrivateBrowserSessionTitle(joinTarget),
      hint: "Choose Screen, Video, or Voice to request access. Contributor shares stay above your own character and stay out of What's Live.",
    });
  } else if (!localParticipant) {
    setPrivateBrowserStatus("Enter this world to start a live share.");
    updatePrivateBrowserSummary({
      state: "idle",
      badge: "Idle",
      current: "Enter to share",
      hint: "Join this private world first.",
    });
  } else if (isPrivateBrowserMemberSession(localSession)) {
    const anchorSession = resolvePrivateOriginSession(localSession);
    const anchorHostName = getPrivateDisplayNameForSessionId(anchorSession?.hostSessionId) || "nearby host";
    const shareKind = getBrowserShareKindLabel(getPrivateBrowserSessionShareKind(localSession));
    setPrivateBrowserStatus(
      state.localBrowserShare?.sessionId === localSession.sessionId
        ? `Sharing ${shareKind.toLowerCase()} inside ${anchorHostName}'s nearby group.`
        : `Allow ${shareKind.toLowerCase()} access to contribute inside ${anchorHostName}'s nearby group.`,
    );
    updatePrivateBrowserSummary({
      state: "live",
      badge: "Group",
      current: `${shareKind} contributor`,
      hint: "You can move while sharing, but leaving the anchor circle stops this contributor share.",
    });
  } else if (localSession?.sessionMode === "display-share") {
    const presentation = getLocalDisplaySharePresentation({
      localSession,
      localShare: state.localBrowserShare,
      draft,
      audienceLabel: "this private world",
      screenPrompt: "Share a tab or window to start the live stream.",
    });
    if (presentation) {
      if (localSession.movementLocked === true) {
        presentation.hint = `${presentation.hint} Movement stays locked while this anchor share is live.`;
      }
      if (!authStable || !socketReady) {
        presentation.hint = "This private world is reconnecting, but your live share is still on.";
      } else if (!mediaAvailable) {
        presentation.hint = "Live media is unavailable for new shares right now, but this share is still on.";
      }
      setPrivateBrowserStatus(presentation.status);
      updatePrivateBrowserSummary(presentation);
    }
  } else if (!authStable || !socketReady) {
    setPrivateBrowserStatus("Private world is still connecting. Wait a moment, then share again.");
    updatePrivateBrowserSummary({
      state: "starting",
      badge: "Starting",
      current: "Connecting world",
      hint: "Nearby Share will turn on once this private world finishes reconnecting.",
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
    setPrivateBrowserStatus("Share a screen, video, or voice nearby.");
    updatePrivateBrowserSummary(
      getDisplayShareReadyPresentation({
        draft,
        scopeLabel: "in this private world",
      }),
    );
  }

  if (previewStream) {
    setLocalPrivateBrowserPreviewStream(previewStream);
  } else if (remoteSession?._remoteElement?.srcObject && elements.panelBrowserVideo) {
    if (elements.panelBrowserVideo.srcObject !== remoteSession._remoteElement.srcObject) {
      elements.panelBrowserVideo.srcObject = remoteSession._remoteElement.srcObject;
    }
    elements.panelBrowserVideo.hidden = false;
    ensurePrivateBrowserVideoPlayback(elements.panelBrowserVideo);
  } else if (!hasRemotePanelVideo) {
    setPrivateBrowserPreviewStream(null);
  }

  if (!elements.panelBrowserFrame || !elements.panelBrowserPlaceholder) {
    return;
  }
  if (previewStream || hasRemotePanelVideo) {
    if (elements.panelBrowserVideo) {
      elements.panelBrowserVideo.hidden = false;
    }
    elements.panelBrowserFrame.hidden = true;
    elements.panelBrowserFrame.removeAttribute("src");
    elements.panelBrowserPlaceholder.hidden = !needsPlaybackStart;
    if (needsPlaybackStart) {
      elements.panelBrowserPlaceholder.textContent = getPrivateBrowserStagePlaceholderText({
        localSession,
        remoteSession,
        needsManualPlaybackStart: true,
      });
    }
    if (elements.panelBrowserResume) {
      elements.panelBrowserResume.hidden = !stageLayout.needsPermissionAction;
      elements.panelBrowserResume.textContent = needsPlaybackStart ? "Start Stream" : "Enable Sound";
    }
    return;
  }
  if (frameUrl) {
    if (elements.panelBrowserVideo) {
      elements.panelBrowserVideo.hidden = true;
    }
    elements.panelBrowserFrame.hidden = false;
    if (elements.panelBrowserFrame.getAttribute("src") !== frameUrl) {
      elements.panelBrowserFrame.src = frameUrl;
    }
    elements.panelBrowserPlaceholder.hidden = true;
    if (elements.panelBrowserResume) {
      elements.panelBrowserResume.hidden = true;
    }
    return;
  }
  if (elements.panelBrowserVideo) {
    elements.panelBrowserVideo.hidden = true;
  }
  elements.panelBrowserFrame.hidden = true;
  elements.panelBrowserFrame.removeAttribute("src");
  elements.panelBrowserPlaceholder.hidden = false;
  elements.panelBrowserPlaceholder.textContent = getPrivateBrowserStagePlaceholderText({
    localSession,
    remoteSession,
    needsManualPlaybackStart: needsPlaybackStart,
    needsManualAudioStart: needsAudioStart,
  });
  if (elements.panelBrowserResume) {
    elements.panelBrowserResume.hidden = !stageLayout.needsPermissionAction;
    elements.panelBrowserResume.textContent = needsPlaybackStart ? "Start Stream" : "Enable Sound";
  }
  if (!localVoiceSession && !state.pendingVoiceShare) {
    state.voiceJoinOffer = state.voiceJoinOffer?.anchorSessionId ? state.voiceJoinOffer : null;
  }
}

async function apiFetch(path, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
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
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 15000));
  const retryCount = Number.isFinite(Number(options.retryCount))
    ? Math.max(0, Math.floor(Number(options.retryCount)))
    : (method === "GET" ? 1 : 0);
  const requestUrl = mauworldApiUrl(path, options.search);
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await fetch(requestUrl, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      const aborted = error?.name === "AbortError";
      const networkFailure = aborted || error instanceof TypeError || /failed to fetch/i.test(String(error?.message ?? ""));
      const canRetry = attempt < retryCount && networkFailure;
      if (canRetry) {
        await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      if (aborted) {
        throw new Error("Mauworld API timed out. Please try again in a moment.");
      }
      if (error instanceof TypeError || /failed to fetch/i.test(String(error?.message ?? ""))) {
        throw new Error("Could not reach Mauworld right now. Please refresh or try again in a moment.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("Could not complete the request.");
}

async function fetchAuthConfig() {
  state.authReady = false;
  renderSessionSummary();
  renderAccessSection();
  updateShellState();
  try {
    state.authConfig = await apiFetch("/public/auth/config");
    state.supabase = createClient(state.authConfig.supabaseUrl, state.authConfig.supabaseAnonKey);
    const { data } = await state.supabase.auth.getSession();
    state.session = data.session;
    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      void refreshAuthState();
    });
  } finally {
    state.authReady = true;
    renderSessionSummary();
    renderAccessSection();
    updateShellState();
  }
}

async function runRefreshAuthState() {
  renderSessionSummary();
  renderAccessSection();
  if (!state.session) {
    await releaseSceneLock();
    state.profile = null;
    state.publicWorlds = [];
    state.publicWorldsLoading = false;
    state.publicWorldsError = "";
    state.worlds = [];
    state.worldsLoading = false;
    state.worldsError = "";
    state.assets = [];
    state.assetsLoading = false;
    state.selectedWorld = null;
    state.selectedSceneId = "";
    state.selectedPrefabId = "";
    state.selectedScriptFunctionId = "";
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
    state.buildSuppressedClick = null;
    resetPrivateBrowserState({ disconnectController: true, stopTracks: true });
    setEntryLoading(false);
    renderProfile();
    renderLauncherWorldBrowser();
    renderSelectedWorld();
    renderAssetsLibrary();
    setLauncherTab("access");
    setLauncherOpen(true);
    disconnectWorldSocket();
    return;
  }
  try {
    state.worldsLoading = true;
    state.worldsError = "";
    renderLauncherWorldBrowser();
    const payload = await apiFetch("/private/profile");
    state.profile = payload.profile;
    renderProfile();
    renderAccessSection();
    renderSessionSummary();
    await loadAssets();
    await loadWorlds();
    const launch = getLaunchRequest();
    const launcherIntent = getLauncherIntent();
    const hasLaunchRequest = Boolean(launch.worldId && launch.creatorUsername);
    const launchParticipant = getLocalParticipant(state.selectedWorld);
    const shouldReplayLaunch =
      hasLaunchRequest
      && (
        !selectedWorldMatchesLaunchRequest(launch)
        || (launch.autojoin && (!launchParticipant || launchParticipant.join_role === "guest"))
      );
    if (shouldReplayLaunch) {
      await handleLaunchRequest({ force: true });
    }
    if (state.launcherTab === "access") {
      setLauncherTab("worlds");
    }
    if (!hasLaunchRequest && !state.selectedWorld) {
      setLauncherOpen(true);
      setLauncherTab(getPreferredLauncherTab());
      if (launcherIntent.create && !state.launcherIntentHandled) {
        state.launcherIntentHandled = true;
        setCreateWorldDialogOpen(true);
      }
    }
  } catch (error) {
    state.worldsLoading = false;
    state.worldsError = String(error?.message || "Could not load your private worlds.");
    renderWorldList();
    setStatus(error.message);
  }
}

async function refreshAuthState() {
  state.authRefreshQueued = true;
  if (state.authRefreshPromise) {
    return state.authRefreshPromise;
  }
  state.authRefreshPromise = (async () => {
    while (state.authRefreshQueued) {
      state.authRefreshQueued = false;
      await runRefreshAuthState();
    }
  })().finally(() => {
    state.authRefreshPromise = null;
  });
  return state.authRefreshPromise;
}

function renderProfile() {
  if (!state.authReady || !state.session || !state.profile) {
    elements.profileForm.hidden = true;
    return;
  }
  elements.profileForm.hidden = false;
  elements.profileForm.elements.username.value = state.profile.username || "";
  elements.profileForm.elements.displayName.value = state.profile.display_name || "";
}

function renderAccessSection() {
  const authReady = state.authReady === true;
  const signedIn = Boolean(state.session);
  if (!authReady) {
    if (elements.accessHeading) {
      elements.accessHeading.textContent = "Checking account";
    }
    if (elements.accessNote) {
      elements.accessNote.textContent = "Loading your account before this private world opens.";
    }
    if (elements.authForm) {
      elements.authForm.hidden = true;
    }
    if (elements.profileForm) {
      elements.profileForm.hidden = true;
    }
    if (elements.accountActions) {
      elements.accountActions.hidden = true;
    }
    renderLauncherTitle();
    return;
  }
  if (elements.accessHeading) {
    elements.accessHeading.textContent = signedIn ? "Account" : "Sign in";
  }
  if (elements.accessNote) {
    elements.accessNote.textContent = signedIn
      ? "Edit your profile here, or sign out when you are done."
      : "There is no shared demo login here. Use your own email and password, or create an account first.";
  }
  if (elements.authForm) {
    elements.authForm.hidden = signedIn;
  }
  if (!signedIn && elements.profileForm) {
    elements.profileForm.hidden = true;
  }
  if (elements.accountActions) {
    elements.accountActions.hidden = !signedIn;
  }
  renderLauncherTitle();
}

function renderSessionSummary() {
  if (!elements.panelSessionLabel || !elements.panelOpenAccess) {
    return;
  }
  if (!state.authReady) {
    elements.panelSessionLabel.textContent = "Checking your account.";
    elements.panelOpenAccess.textContent = "Loading";
    elements.panelOpenAccess.disabled = true;
    return;
  }
  elements.panelOpenAccess.disabled = false;
  if (state.session && state.profile) {
    elements.panelSessionLabel.textContent = `Signed in as @${state.profile.username || "user"}.`;
    elements.panelOpenAccess.textContent = "Account";
    return;
  }
  if (state.session) {
    elements.panelSessionLabel.textContent = "Signed in.";
    elements.panelOpenAccess.textContent = "Account";
    return;
  }
  elements.panelSessionLabel.textContent = "Sign in to open your private worlds.";
  elements.panelOpenAccess.textContent = "Sign In";
}

async function loadWorlds() {
  if (!state.session) {
    state.worldsLoading = false;
    state.worldsError = "";
    state.worlds = [];
    renderLauncherWorldBrowser();
    return;
  }
  state.worldsLoading = true;
  state.worldsError = "";
  renderLauncherWorldBrowser();
  try {
    const payload = await apiFetch("/private/worlds", {
      search: {
        q: elements.worldSearch?.value || "",
      },
    });
    state.worlds = payload.worlds ?? [];
    state.worldsError = "";
  } catch (error) {
    state.worldsError = String(error?.message || "Could not load your private worlds.");
  } finally {
    state.worldsLoading = false;
    renderLauncherWorldBrowser();
    if (state.launcherOpen && !state.selectedWorld && !state.worldsError) {
      setLauncherTab(getPreferredLauncherTab());
    }
  }
}

async function loadAssets() {
  if (!state.session) {
    state.assetsLoading = false;
    state.assets = [];
    renderAssetsLibrary();
    return;
  }
  state.assetsLoading = true;
  renderAssetsLibrary();
  try {
    const payload = await apiFetch("/private/assets", {
      search: {
        q: state.assetQuery || "",
        assetType: state.assetFilterType === "all" ? undefined : state.assetFilterType,
      },
    });
    state.assets = payload.assets ?? [];
  } catch (_error) {
    state.assets = [];
  } finally {
    state.assetsLoading = false;
    renderAssetsLibrary();
  }
}

async function loadPublicWorlds() {
  state.publicWorldsLoading = true;
  state.publicWorldsError = "";
  renderLauncherWorldBrowser();
  try {
    const payload = await apiFetch("/public/private-worlds", {
      search: {
        q: elements.worldSearch?.value || "",
        worldType: elements.publicWorldType?.value || "",
      },
    });
    state.publicWorlds = payload.worlds ?? [];
    state.publicWorldsError = "";
  } catch (error) {
    state.publicWorldsError = String(error?.message || "Could not load all private worlds.");
  } finally {
    state.publicWorldsLoading = false;
    renderLauncherWorldBrowser();
  }
}

function renderLauncherWorldBrowser() {
  if (!elements.worldList) {
    return;
  }
  renderLauncherWorldTabs();
  const activeTab = normalizeLauncherWorldTab(state.launcherWorldTab);
  const worlds = activeTab === "all" ? state.publicWorlds : state.worlds;
  const loading = activeTab === "all" ? state.publicWorldsLoading : state.worldsLoading;
  const error = activeTab === "all" ? state.publicWorldsError : state.worldsError;
  if (loading) {
    elements.worldList.innerHTML = [
      '<div class="world-private-gate__placeholder" aria-hidden="true"></div>',
      '<div class="world-private-gate__placeholder" aria-hidden="true"></div>',
      '<div class="world-private-gate__placeholder" aria-hidden="true"></div>',
    ].join("");
    return;
  }
  if (error) {
    elements.worldList.innerHTML = `<p class="world-empty">${htmlEscape(error)}</p>`;
    return;
  }
  if (!worlds.length) {
    elements.worldList.innerHTML = activeTab === "all"
      ? '<p class="world-empty">No private worlds match this search right now.</p>'
      : '<div class="pw-world-card"><p>No private worlds yet. Create one to get started.</p></div>';
    return;
  }
  elements.worldList.innerHTML = buildPrivateWorldBrowserResultsMarkup(worlds, {
    selectedKey: state.selectedWorld ? getPrivateWorldBrowserKey(state.selectedWorld) : "",
    resultDataAttribute: "data-launcher-world-result",
    includeCreator: activeTab === "all",
    includeOccupancy: activeTab === "all",
    includeLineage: activeTab === "all",
    includeStatus: activeTab !== "all",
  });
}

function renderWorldList() {
  renderLauncherWorldBrowser();
}

function buildMetaRows(world) {
  if (!world) {
    return [];
  }
  const creatorUsername = String(world.creator?.username ?? world.creator_username ?? "").trim();
  const creatorDisplayName = String(world.creator?.display_name ?? world.creator_display_name ?? creatorUsername).trim();
  const dimensions = [world.width, world.length, world.height]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const sizeLabel = dimensions.length === 3
    ? `${dimensions[0]} × ${dimensions[1]} × ${dimensions[2]}`
    : "Not set";
  const typeParts = [
    String(world.world_type ?? "").trim(),
    String(world.template_size ?? "").trim(),
  ].filter(Boolean);
  const viewerCount = Number(world.active_instance?.viewer_count);
  const maxViewers = Number(world.max_viewers);
  const viewerLabel = Number.isFinite(viewerCount) && Number.isFinite(maxViewers) && maxViewers > 0
    ? `${Math.max(0, viewerCount)} inside now · ${Math.max(1, maxViewers)} max`
    : Number.isFinite(viewerCount)
      ? `${Math.max(0, viewerCount)} inside now`
      : Number.isFinite(maxViewers) && maxViewers > 0
        ? `${Math.max(1, maxViewers)} max`
        : "No live occupancy";
  const lineageImported = Boolean(
    world.lineage?.is_imported
    || world.origin_world_id
    || world.origin_creator_username
    || world.origin_world_name,
  );
  const lineageWorld = String(world.lineage?.origin_world_name ?? world.lineage?.origin_world_id ?? world.origin_world_name ?? world.origin_world_id ?? "").trim();
  const lineageCreator = String(world.lineage?.origin_creator_username ?? world.origin_creator_username ?? "").trim();
  const creatorLabel = creatorDisplayName && creatorUsername && creatorDisplayName.toLowerCase() !== creatorUsername.toLowerCase()
    ? `${creatorDisplayName} (@${creatorUsername})`
    : creatorUsername
      ? `@${creatorUsername}`
      : creatorDisplayName || "Unknown creator";
  const activeStatus = String(world.active_instance?.status ?? "").trim().toLowerCase();
  const isActive = activeStatus === "active";
  return [
    { label: "World ID", value: String(world.world_id ?? "").trim() || "Not set" },
    { label: "Creator", value: creatorLabel },
    { label: "Size", value: sizeLabel },
    { label: "Type", value: typeParts.join(" · ") || "Not set" },
    { label: "Viewers", value: viewerLabel },
    { label: "Entry", value: isActive ? "Copy Entry above to jump straight in." : "Inactive right now. The entry link still resolves it." },
    {
      label: "Lineage",
      value: lineageImported
        ? `Forked from ${lineageWorld || "another world"}${lineageCreator ? ` by @${lineageCreator}` : ""}`
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
      <span>${htmlEscape(String(row.value ?? "").trim() || "Not set")}</span>
    </div>
  `).join("");
}

function getSceneById(sceneId = "", world = state.selectedWorld) {
  const normalizedSceneId = String(sceneId ?? "").trim();
  if (!normalizedSceneId) {
    return null;
  }
  return (world?.scenes ?? []).find((scene) => scene.id === normalizedSceneId) ?? null;
}

function getSelectedScene() {
  return getSceneById(state.selectedSceneId) ?? state.selectedWorld?.scenes?.[0] ?? null;
}

function getSceneDrawerFocusedScene() {
  return getSceneById(state.sceneDrawerFocusId) ?? getSelectedScene();
}

function getSceneEditorScene() {
  return state.sceneDrawerTab === "scenes"
    ? getSceneDrawerFocusedScene()
    : getSelectedScene();
}

function syncSceneDrawerFocusScene(world = state.selectedWorld) {
  const scenes = Array.isArray(world?.scenes) ? world.scenes : [];
  if (!scenes.length) {
    state.sceneDrawerFocusId = "";
    return null;
  }
  if (state.sceneDrawerTab !== "scenes") {
    state.sceneDrawerFocusId = getSelectedScene()?.id ?? scenes[0].id;
    return getSceneById(state.sceneDrawerFocusId, world);
  }
  const focusedScene = getSceneById(state.sceneDrawerFocusId, world);
  if (focusedScene) {
    return focusedScene;
  }
  state.sceneDrawerFocusId = getSelectedScene()?.id ?? scenes[0].id;
  return getSceneById(state.sceneDrawerFocusId, world);
}

function resolvePreferredSelectedSceneId(world = state.selectedWorld, options = {}) {
  const scenes = Array.isArray(world?.scenes) ? world.scenes : [];
  if (!scenes.length) {
    return "";
  }
  const previousSelectedSceneId = String(options.previousSelectedSceneId ?? state.selectedSceneId ?? "").trim();
  const activeSceneId = String(world?.active_instance?.active_scene_id ?? "").trim();
  const defaultSceneId = activeSceneId
    || String(world?.default_scene_id ?? "").trim()
    || scenes.find((scene) => scene.is_default === true)?.id
    || scenes[0]?.id
    || "";
  const canPreserveSelection =
    options.preferSelected !== false
    && state.mode === "build"
    && world?.permissions?.can_edit === true
    && scenes.some((scene) => scene.id === previousSelectedSceneId);
  return canPreserveSelection ? previousSelectedSceneId : defaultSceneId;
}

function getDefaultScene(world = state.selectedWorld) {
  const scenes = world?.scenes ?? [];
  return scenes.find((scene) => scene.id === world?.default_scene_id)
    ?? scenes.find((scene) => scene.is_default === true)
    ?? scenes[0]
    ?? null;
}

function buildSceneEditorSnapshot(scene = getSceneEditorScene(), overrides = {}) {
  const sceneId = String(overrides.sceneId ?? scene?.id ?? state.sceneEditorSceneId ?? state.selectedSceneId ?? "").trim();
  if (!sceneId || !elements.sceneForm?.elements) {
    return null;
  }
  return {
    sceneId,
    name: overrides.name != null
      ? String(overrides.name)
      : String(elements.sceneForm.elements.name?.value ?? scene?.name ?? ""),
    isDefault: overrides.isDefault != null
      ? Boolean(overrides.isDefault)
      : elements.sceneForm.elements.isDefault?.checked === true,
    sceneDocText: overrides.sceneDocText != null
      ? String(overrides.sceneDocText)
      : String(elements.sceneForm.elements.sceneDoc?.value ?? (scene ? JSON.stringify(scene.scene_doc ?? {}, null, 2) : "")),
    scriptDslText: overrides.scriptDslText != null
      ? String(overrides.scriptDslText)
      : String(elements.sceneForm.elements.scriptDsl?.value ?? scene?.scene_doc?.script_dsl ?? ""),
  };
}

function getSceneDraft(sceneId = state.sceneEditorSceneId || state.selectedSceneId) {
  const key = String(sceneId ?? "").trim();
  return key ? state.sceneDrafts.get(key) ?? null : null;
}

function rememberSceneDraft(overrides = {}) {
  const snapshot = buildSceneEditorSnapshot(getSceneEditorScene(), overrides);
  if (snapshot?.sceneId) {
    state.sceneDrafts.set(snapshot.sceneId, snapshot);
  }
}

function discardSceneDraft(sceneId = state.sceneEditorSceneId || state.selectedSceneId) {
  const key = String(sceneId ?? "").trim();
  if (!key) {
    return;
  }
  state.sceneDrafts.delete(key);
  if (state.sceneEditorSceneId === key) {
    state.sceneEditorSceneId = "";
  }
}

function buildSceneDocFromDraft(scene = null, draft = null) {
  if (!scene && !draft) {
    return null;
  }
  const sceneDocText = String(draft?.sceneDocText ?? JSON.stringify(scene?.scene_doc ?? {}, null, 2));
  try {
    const sceneDoc = JSON.parse(sceneDocText || "{}");
    sceneDoc.script_dsl = String(draft?.scriptDslText ?? sceneDoc.script_dsl ?? scene?.scene_doc?.script_dsl ?? "").trim();
    return sceneDoc;
  } catch (_error) {
    return scene?.scene_doc ?? null;
  }
}

function normalizePrivateSceneEnvironmentSettings(settings = {}) {
  const skybox = String(settings?.skybox ?? settings?.skyboxPreset ?? "blank").trim().toLowerCase();
  const ambientLight = String(settings?.ambient_light ?? settings?.ambientLight ?? "even").trim().toLowerCase();
  return {
    skybox: Object.hasOwn(PRIVATE_SCENE_ENVIRONMENT_PRESETS, skybox) ? skybox : "blank",
    ambient_light: Object.hasOwn(PRIVATE_SCENE_AMBIENT_PRESETS, ambientLight) ? ambientLight : "even",
  };
}

function buildPrivateSceneEnvironmentTheme(settings = {}) {
  const normalized = normalizePrivateSceneEnvironmentSettings(settings);
  const skyboxPreset = PRIVATE_SCENE_ENVIRONMENT_PRESETS[normalized.skybox] ?? PRIVATE_SCENE_ENVIRONMENT_PRESETS.blank;
  const ambientPreset = PRIVATE_SCENE_AMBIENT_PRESETS[normalized.ambient_light] ?? PRIVATE_SCENE_AMBIENT_PRESETS.even;
  return {
    ...PRIVATE_WORLD_STYLE,
    ...skyboxPreset,
    skybox: normalized.skybox,
    ambient_light: normalized.ambient_light,
    ambientIntensity: ambientPreset.hemisphereIntensity,
    sunIntensity: Number((skyboxPreset.sunIntensity * ambientPreset.sunIntensityMultiplier).toFixed(4)),
  };
}

function getPrivateSceneEnvironmentSettings(sceneDoc = null) {
  return normalizePrivateSceneEnvironmentSettings(
    sceneDoc?.settings
      ?? getSelectedScene()?.scene_doc?.settings
      ?? {},
  );
}

function buildSceneEnvironmentHint(settings = {}) {
  const normalized = normalizePrivateSceneEnvironmentSettings(settings);
  const skyboxLabel = normalized.skybox === "blank"
    ? "White background"
    : normalized.skybox === "day"
      ? "Day sky"
      : normalized.skybox === "sunset"
        ? "Sunset sky"
        : "Night sky";
  const ambientLabel = normalized.ambient_light === "dim" ? "dimmer ambient light" : "even ambient light";
  return `${skyboxLabel} with ${ambientLabel}.`;
}

function renderSceneEnvironmentControls(sceneDoc = null) {
  if (!elements.sceneForm?.elements) {
    return;
  }
  const settings = getPrivateSceneEnvironmentSettings(sceneDoc);
  if (elements.sceneForm.elements.sceneSkybox) {
    elements.sceneForm.elements.sceneSkybox.value = settings.skybox;
  }
  if (elements.sceneForm.elements.sceneAmbientLight) {
    elements.sceneForm.elements.sceneAmbientLight.value = settings.ambient_light;
  }
  if (elements.sceneEnvironmentHint) {
    elements.sceneEnvironmentHint.textContent = buildSceneEnvironmentHint(settings);
  }
}

function buildEmptySceneDoc() {
  return {
    settings: {
      gravity: { x: 0, y: -9.8, z: 0 },
      camera_mode: "third_person",
      start_on_ready: true,
      skybox: "blank",
      ambient_light: "even",
    },
    voxels: [],
    primitives: [],
    panels: [],
    models: [],
    screens: [],
    players: [],
    texts: [],
    trigger_zones: [],
    prefabs: [],
    prefab_instances: [],
    particles: [],
    rules: [],
    script_dsl: "",
  };
}

function buildSceneCountLabel(count = 0) {
  return `${count} scene${count === 1 ? "" : "s"}`;
}

function createNextSceneName(scenes = state.selectedWorld?.scenes ?? []) {
  const usedNames = new Set((scenes ?? []).map((scene) => String(scene?.name ?? "").trim().toLowerCase()).filter(Boolean));
  let index = (scenes?.length ?? 0) + 1;
  while (usedNames.has(`scene ${index}`.toLowerCase())) {
    index += 1;
  }
  return `Scene ${index}`;
}

function createScriptFunctionId(seed = "") {
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `scriptfn_${slugToken(seed || `logic_${Date.now().toString(36)}_${randomToken}`)}`;
}

function normalizeScriptFunctionEntry(entry = {}, index = 0) {
  return {
    id: String(entry.id ?? "").trim() || createScriptFunctionId(`logic_${index + 1}`),
    name: String(entry.name ?? "").trim() || `Function ${index + 1}`,
    body: String(entry.body ?? "").replace(/\s+$/g, ""),
  };
}

function parseScriptFunctionLibrary(value = "") {
  const source = String(value ?? "").replace(/\r\n/g, "\n");
  if (!source.trim()) {
    return [];
  }
  const lines = source.split("\n");
  const functions = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) {
      return;
    }
    functions.push(normalizeScriptFunctionEntry({
      id: current.id,
      name: current.name,
      body: current.lines.join("\n").replace(/^\n+|\n+$/g, ""),
    }, functions.length));
    current = null;
  };
  for (const line of lines) {
    const headerMatch = line.match(SCRIPT_FUNCTION_HEADER_RE);
    if (headerMatch) {
      pushCurrent();
      current = {
        id: String(headerMatch[1] ?? "").trim() || createScriptFunctionId(`logic_${functions.length + 1}`),
        name: String(headerMatch[2] ?? "").trim() || `Function ${functions.length + 1}`,
        lines: [],
      };
      continue;
    }
    if (!current) {
      current = {
        id: createScriptFunctionId(`logic_${functions.length + 1}`),
        name: "Main function",
        lines: [],
      };
    }
    current.lines.push(line);
  }
  pushCurrent();
  return functions;
}

function serializeScriptFunctionLibrary(functions = []) {
  return functions
    .map((entry, index) => normalizeScriptFunctionEntry(entry, index))
    .map((entry) => [`# function[${entry.id}]: ${entry.name}`, entry.body].filter((part) => part !== "").join("\n"))
    .join("\n\n")
    .trim();
}

function getSceneScriptFunctions() {
  return parseScriptFunctionLibrary(elements.sceneForm?.elements?.scriptDsl?.value || "");
}

function buildScriptFunctionSummary(entry = {}) {
  const body = String(entry.body ?? "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ruleLines = lines.filter((line) => !line.startsWith("#") && !line.startsWith("//"));
  return {
    lineCount: ruleLines.length,
    preview: ruleLines[0] || "No rules yet",
  };
}

function getScreenAiPrompt(screenId = "") {
  const normalizedScreenId = String(screenId ?? "").trim();
  if (!normalizedScreenId) {
    return "";
  }
  return String(state.screenAiPromptDrafts.get(normalizedScreenId) ?? "");
}

function setScreenAiPrompt(screenId = "", value = "") {
  const normalizedScreenId = String(screenId ?? "").trim();
  if (!normalizedScreenId) {
    return;
  }
  state.screenAiPromptDrafts.set(normalizedScreenId, String(value ?? ""));
}

function ensureSelectedScriptFunction(functions = getSceneScriptFunctions()) {
  const normalizedFunctions = Array.isArray(functions) ? functions : [];
  if (!normalizedFunctions.length) {
    state.selectedScriptFunctionId = "";
    return null;
  }
  const selected = normalizedFunctions.find((entry) => entry.id === state.selectedScriptFunctionId) ?? normalizedFunctions[0];
  state.selectedScriptFunctionId = selected.id;
  return selected;
}

function renderSceneLogicLibrary() {
  if (!elements.scriptFunctionList || !elements.sceneForm?.elements) {
    return;
  }
  const scene = getSelectedScene();
  const hasScene = Boolean(scene);
  const canEdit = hasScene && isEditor() && state.mode === "build";
  const functions = getSceneScriptFunctions();
  const normalizedQuery = String(state.scriptFunctionQuery ?? "").trim().toLowerCase();
  const visibleFunctions = functions.filter((entry) => {
    const haystack = [entry.name, entry.body].join(" ").toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });
  if (visibleFunctions.length > 0 && !visibleFunctions.some((entry) => entry.id === state.selectedScriptFunctionId)) {
    state.selectedScriptFunctionId = visibleFunctions[0].id;
  }
  const selectedFunction = ensureSelectedScriptFunction(functions);
  const editorFunction = hasScene && visibleFunctions.length ? selectedFunction : null;
  if (elements.scriptFunctionSearch && elements.scriptFunctionSearch.value !== String(state.scriptFunctionQuery ?? "")) {
    elements.scriptFunctionSearch.value = String(state.scriptFunctionQuery ?? "");
  }
  if (elements.scriptFunctionSearch) {
    elements.scriptFunctionSearch.disabled = !hasScene;
  }
  if (elements.scriptFunctionNew) {
    elements.scriptFunctionNew.disabled = !canEdit;
  }
  if (elements.scriptFunctionOpenGenerate) {
    elements.scriptFunctionOpenGenerate.disabled = !canEdit || !state.selectedWorld || !state.session;
  }
  if (elements.scriptFunctionDelete) {
    elements.scriptFunctionDelete.disabled = !canEdit || !editorFunction;
  }
  if (elements.scriptFunctionGenerate) {
    elements.scriptFunctionGenerate.disabled = !canEdit || !state.selectedWorld || !state.session;
  }
  if (!hasScene) {
    elements.scriptFunctionList.innerHTML = '<div class="pw-script-card"><p>No scene selected yet.</p></div>';
    if (elements.scriptFunctionSearchHint) {
      elements.scriptFunctionSearchHint.textContent = "Open a scene to organize its logic.";
    }
  } else if (!functions.length) {
    elements.scriptFunctionList.innerHTML = '<div class="pw-script-card"><p>No functions yet. Add one to keep scene logic in tidy pieces.</p></div>';
    if (elements.scriptFunctionSearchHint) {
      elements.scriptFunctionSearchHint.textContent = "Each function compiles back into the single scene script automatically.";
    }
  } else if (!visibleFunctions.length) {
    elements.scriptFunctionList.innerHTML = '<div class="pw-script-card"><p>No functions match that search.</p></div>';
    if (elements.scriptFunctionSearchHint) {
      elements.scriptFunctionSearchHint.textContent = "Try a different function name or clear the search.";
    }
  } else {
    if (elements.scriptFunctionSearchHint) {
      elements.scriptFunctionSearchHint.textContent = `${visibleFunctions.length} function${visibleFunctions.length === 1 ? "" : "s"} in this scene. Click one to edit, or generate into the current selection.`;
    }
    elements.scriptFunctionList.innerHTML = visibleFunctions.map((entry, index) => {
      const summary = buildScriptFunctionSummary(entry);
      const isSelected = selectedFunction?.id === entry.id;
      return `
        <article class="pw-script-card ${isSelected ? "is-active" : ""}" data-script-function-id="${htmlEscape(entry.id)}">
          <div class="pw-script-card__head">
            <div class="pw-script-card__title">
              <strong>${htmlEscape(entry.name)}</strong>
              <span>${summary.lineCount} rule${summary.lineCount === 1 ? "" : "s"}</span>
            </div>
            <span class="pw-script-card__badge">${isSelected ? "editing" : `f${index + 1}`}</span>
          </div>
          <p>${htmlEscape(summary.preview)}</p>
        </article>
      `;
    }).join("");
  }

  const showEditor = Boolean(editorFunction);
  if (elements.scriptFunctionEmpty) {
    elements.scriptFunctionEmpty.hidden = showEditor;
    elements.scriptFunctionEmpty.textContent = !hasScene
      ? "Open a scene to start shaping scene logic."
      : !functions.length
        ? "Add a function to start shaping scene logic."
        : !visibleFunctions.length
          ? "No function matches the current search."
          : "Select a function to edit its rules.";
  }
  if (elements.scriptFunctionFields) {
    elements.scriptFunctionFields.hidden = !showEditor;
  }
  if (!editorFunction) {
    if (elements.scriptFunctionName) {
      elements.scriptFunctionName.value = "";
      elements.scriptFunctionName.disabled = true;
    }
    if (elements.scriptFunctionBody) {
      elements.scriptFunctionBody.value = "";
      elements.scriptFunctionBody.disabled = true;
    }
    if (elements.scriptFunctionMeta) {
      elements.scriptFunctionMeta.textContent = "";
    }
    if (elements.scriptFunctionPrompt) {
      elements.scriptFunctionPrompt.disabled = true;
    }
    return;
  }
  const summary = buildScriptFunctionSummary(editorFunction);
  if (elements.scriptFunctionName) {
    elements.scriptFunctionName.disabled = !canEdit;
    if (elements.scriptFunctionName.value !== editorFunction.name) {
      elements.scriptFunctionName.value = editorFunction.name;
    }
  }
  if (elements.scriptFunctionBody) {
    elements.scriptFunctionBody.disabled = !canEdit;
    if (elements.scriptFunctionBody.value !== editorFunction.body) {
      elements.scriptFunctionBody.value = editorFunction.body;
    }
  }
  if (elements.scriptFunctionPrompt) {
    elements.scriptFunctionPrompt.disabled = !canEdit || !state.session;
  }
  if (elements.scriptFunctionMeta) {
    elements.scriptFunctionMeta.textContent = `${summary.lineCount} rule${summary.lineCount === 1 ? "" : "s"} · comments are okay · saved as one scene script behind the scenes`;
  }
}

function mutateSceneScriptFunctions(mutator, options = {}) {
  if (!elements.sceneForm?.elements?.scriptDsl) {
    return [];
  }
  const nextFunctions = getSceneScriptFunctions().map((entry, index) => normalizeScriptFunctionEntry(entry, index));
  mutator(nextFunctions);
  const scriptDslText = serializeScriptFunctionLibrary(nextFunctions);
  elements.sceneForm.elements.scriptDsl.value = scriptDslText;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.script_dsl = scriptDslText;
  }, {
    renderBuilder: false,
    updatePreview: false,
  });
  if (options.render !== false) {
    renderSceneLogicLibrary();
  }
  return nextFunctions;
}

function normalizeGeneratedScriptBody(value = "") {
  let cleaned = String(value ?? "").trim();
  const fenced = cleaned.match(/^```(?:[\w-]+)?\n?([\s\S]*?)```$/);
  if (fenced) {
    cleaned = String(fenced[1] ?? "").trim();
  }
  return cleaned
    .split(/\r?\n/)
    .filter((line) => !SCRIPT_FUNCTION_HEADER_RE.test(line.trim()))
    .join("\n")
    .trim();
}

function focusSelectedScriptFunctionBody() {
  window.setTimeout(() => {
    elements.scriptFunctionBody?.focus?.();
    if (elements.scriptFunctionBody?.value) {
      elements.scriptFunctionBody.selectionStart = elements.scriptFunctionBody.value.length;
      elements.scriptFunctionBody.selectionEnd = elements.scriptFunctionBody.value.length;
    }
  }, 0);
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
  if (isEditor() && state.sceneEditorSceneId === String(scene.id ?? "").trim()) {
    try {
      return parseSceneTextarea();
    } catch (error) {
      if (state.mode === "build") {
        throw error;
      }
    }
  }
  return buildSceneDocFromDraft(scene, getSceneDraft(scene.id)) ?? scene.scene_doc ?? null;
}

function setMode(mode, options = {}) {
  const nextMode = mode === "build" && isEditor() ? "build" : "play";
  const previousMode = state.mode;
  state.mode = nextMode;
  if (nextMode === "play") {
    state.buildModifierKeys.clear();
    endBuildDrag();
    state.buildSuppressedClick = null;
    clearPlacementTool();
    writeBuilderSelection([]);
    state.sceneDrawerOpen = false;
  }
  if (nextMode === "build") {
    if (previousMode === "play" && state.buildReturnSceneId) {
      const returnScene = state.selectedWorld?.scenes?.find((scene) => scene.id === state.buildReturnSceneId) ?? null;
      if (returnScene) {
        state.selectedSceneId = returnScene.id;
      }
    }
    for (const key of ["q", "e", "shift"]) {
      privateInputState.keys.delete(key);
    }
  }
  document.body.classList.toggle("is-play-mode", nextMode === "play");
  document.body.classList.toggle("is-build-mode", nextMode === "build");
  if (nextMode === "build") {
    refreshBuildHoverFromStoredPointer();
  }
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

function migrateLegacyPanelsInSceneDoc(sceneDoc = {}) {
  const nextSceneDoc = typeof sceneDoc === "object" && sceneDoc ? sceneDoc : {};
  const legacyPanels = Array.isArray(nextSceneDoc.panels) ? nextSceneDoc.panels : [];
  if (!legacyPanels.length) {
    return nextSceneDoc;
  }
  const convertedPanels = legacyPanels.map((panel, index) => ({
    id: panel?.id || `panel_${index + 1}`,
    label: String(panel?.label ?? `Panel ${index + 1}`).trim() || `Panel ${index + 1}`,
    shape: "panel",
    position: deepClone(panel?.position ?? { x: 0, y: 2, z: 0 }),
    rotation: deepClone(panel?.rotation ?? { x: 0, y: 0, z: 0 }),
    scale: deepClone(panel?.scale ?? { x: 4, y: 2.25, z: 0.1 }),
    material: deepClone(panel?.material ?? { color: "#f4f7fb", texture_preset: "none", emissive_intensity: 0 }),
    rigid_mode: String(panel?.rigid_mode ?? panel?.rigidMode ?? "ghost").trim().toLowerCase() === "rigid" ? "rigid" : "ghost",
    physics: deepClone(panel?.physics ?? { gravity_scale: 0, restitution: 0, friction: 0.7, mass: 0 }),
    facing_mode: normalizeFacingMode(panel?.facing_mode ?? panel?.facingMode),
    particle_effect: String(panel?.particle_effect ?? panel?.particleEffect ?? "").trim(),
    trail_effect: String(panel?.trail_effect ?? panel?.trailEffect ?? "").trim(),
    invisible: panel?.invisible === true,
    group_id: String(panel?.group_id ?? panel?.groupId ?? "").trim(),
  }));
  nextSceneDoc.primitives = [...convertedPanels, ...(Array.isArray(nextSceneDoc.primitives) ? nextSceneDoc.primitives : [])];
  nextSceneDoc.panels = [];
  return nextSceneDoc;
}

function parseSceneTextarea() {
  try {
    const sceneDoc = migrateLegacyPanelsInSceneDoc(JSON.parse(elements.sceneForm?.elements.sceneDoc.value || "{}"));
    if (elements.sceneForm?.elements.scriptDsl) {
      sceneDoc.script_dsl = String(elements.sceneForm.elements.scriptDsl.value || "").trim();
    }
    return sceneDoc;
  } catch (error) {
    throw new Error(`Scene JSON is invalid: ${error.message}`);
  }
}

function renderSceneEditor() {
  const scene = getSceneEditorScene();
  const canEdit = isEditor();
  const buildMode = state.mode === "build";
  const sceneId = String(scene?.id ?? "").trim();
  const draft = getSceneDraft(sceneId);
  const selectedScene = getSelectedScene();
  const selectedSceneId = String(selectedScene?.id ?? "").trim();
  const isFocusedSceneActive = Boolean(sceneId) && sceneId === selectedSceneId;
  let sceneDocForControls = buildEmptySceneDoc();
  if (!scene) {
    elements.sceneForm.elements.name.value = "";
    elements.sceneForm.elements.isDefault.checked = false;
    elements.sceneForm.elements.sceneDoc.value = "";
    elements.sceneForm.elements.scriptDsl.value = "";
    state.selectedScriptFunctionId = "";
    state.scriptFunctionQuery = "";
    state.sceneEditorSceneId = "";
  } else if (!draft || state.sceneEditorSceneId !== sceneId) {
    elements.sceneForm.elements.name.value = draft?.name ?? scene?.name ?? "";
    elements.sceneForm.elements.isDefault.checked = draft?.isDefault ?? scene?.is_default === true;
    elements.sceneForm.elements.sceneDoc.value = draft?.sceneDocText ?? JSON.stringify(scene.scene_doc ?? {}, null, 2);
    elements.sceneForm.elements.scriptDsl.value = draft?.scriptDslText ?? scene?.scene_doc?.script_dsl ?? "";
    state.selectedScriptFunctionId = "";
    state.scriptFunctionQuery = "";
    state.sceneEditorSceneId = sceneId;
  }
  try {
    sceneDocForControls = JSON.parse(elements.sceneForm.elements.sceneDoc.value || "{}");
  } catch (_error) {
    sceneDocForControls = scene?.scene_doc ?? buildEmptySceneDoc();
  }
  if (elements.sceneSwitchButton) {
    const canSwitchScene = Boolean(scene) && canEdit && buildMode && !isFocusedSceneActive;
    elements.sceneSwitchButton.hidden = !scene;
    elements.sceneSwitchButton.disabled = !canSwitchScene;
    elements.sceneSwitchButton.textContent = isFocusedSceneActive
      ? "Current editing scene"
      : "Switch to this scene";
  }
  elements.saveScene.disabled = !canEdit || !scene || !buildMode || !isFocusedSceneActive;
  elements.refreshScene.disabled = !scene;
  elements.sceneForm.elements.name.disabled = !canEdit || !buildMode || !isFocusedSceneActive;
  elements.sceneForm.elements.isDefault.disabled = !canEdit || !buildMode || !isFocusedSceneActive;
  elements.sceneForm.elements.sceneSkybox.disabled = !canEdit || !scene || !buildMode || !isFocusedSceneActive;
  elements.sceneForm.elements.sceneAmbientLight.disabled = !canEdit || !scene || !buildMode || !isFocusedSceneActive;
  elements.sceneForm.elements.scriptDsl.disabled = !canEdit || !buildMode || !isFocusedSceneActive;
  elements.sceneForm.elements.sceneDoc.disabled = !canEdit || !buildMode || !isFocusedSceneActive;
  renderSceneEnvironmentControls(sceneDocForControls);
  renderSceneLogicLibrary();
  const buildPanel = document.querySelector("[data-build-panel]");
  if (buildPanel) {
    buildPanel.hidden = false;
  }
  renderSceneBuilder();
}

function buildSceneLibrarySummary(scene = {}) {
  const stats = scene.compiled_doc?.stats ?? {};
  const entityCount =
    Number(stats.solid_voxel_count ?? 0)
    + Number(stats.primitive_count ?? 0)
    + Number(stats.panel_count ?? 0)
    + Number(stats.model_count ?? 0)
    + Number(stats.screen_count ?? 0)
    + Number(stats.player_count ?? 0)
    + Number(stats.text_count ?? 0)
    + Number(stats.trigger_zone_count ?? 0)
    + Number(stats.prefab_instance_count ?? 0);
  const ruleCount = Number(stats.dsl_rule_count ?? stats.rule_count ?? 0);
  const meta = [];
  meta.push(`${entityCount} item${entityCount === 1 ? "" : "s"}`);
  meta.push(`${ruleCount} rule${ruleCount === 1 ? "" : "s"}`);
  if (scene.is_default) {
    meta.push("default");
  }
  return meta.join(" · ");
}

function getSceneStatusLabel(scene = getSelectedScene()) {
  if (!scene) {
    return "none";
  }
  const activeRuntimeSceneId = state.selectedWorld?.active_instance?.active_scene_id || "";
  if (scene.id === activeRuntimeSceneId) {
    return "live";
  }
  if (scene.id === state.selectedSceneId) {
    return "editing";
  }
  if (scene.is_default) {
    return "default";
  }
  return "saved";
}

function renderSceneDrawerSceneIndicator(scene = getSceneDrawerFocusedScene()) {
  if (!elements.sceneDrawerSceneIndicator) {
    return;
  }
  if (!scene) {
    elements.sceneDrawerSceneIndicator.innerHTML = `
      <span>Scene Focus</span>
      <strong>No scene selected</strong>
      <small>Pick a scene from the Scenes tab.</small>
    `;
    return;
  }
  const activeRuntimeSceneId = String(state.selectedWorld?.active_instance?.active_scene_id ?? "").trim();
  const activeRuntimeScene = activeRuntimeSceneId
    ? (state.selectedWorld?.scenes ?? []).find((entry) => entry.id === activeRuntimeSceneId) ?? null
    : null;
  const selectedScene = getSelectedScene();
  const status = getSceneStatusLabel(scene);
  const statusNote = activeRuntimeScene && activeRuntimeScene.id !== scene.id
    ? `Live now: ${activeRuntimeScene.name || "Untitled Scene"}`
    : buildSceneLibrarySummary(scene);
  const editingNote = selectedScene && selectedScene.id !== scene.id
    ? `Editing in world: ${selectedScene.name || "Untitled Scene"}`
    : "";
  elements.sceneDrawerSceneIndicator.innerHTML = `
    <span>Scene Focus</span>
    <strong>${htmlEscape(scene.name || "Untitled Scene")}</strong>
    <small>${htmlEscape(status)} · ${htmlEscape(buildSceneLibrarySummary(scene))}</small>
    ${statusNote !== buildSceneLibrarySummary(scene) ? `<small>${htmlEscape(statusNote)}</small>` : ""}
    ${editingNote ? `<small>${htmlEscape(editingNote)}</small>` : ""}
  `;
}

function renderSceneLibrary() {
  if (!elements.sceneLibraryList) {
    return;
  }
  const scenes = state.selectedWorld?.scenes ?? [];
  if (elements.sceneLibraryHint) {
    elements.sceneLibraryHint.textContent = scenes.length
      ? `${buildSceneCountLabel(scenes.length)} ready. Pick one to review on the right, then switch only when you want the world to move there.`
      : "No scenes yet. Add one to start building a different room, level, or state.";
  }
  if (!scenes.length) {
    elements.sceneLibraryList.innerHTML = '<div class="pw-scene-library-item"><p class="pw-builder-empty">No scenes yet.</p></div>';
    return;
  }
  const activeRuntimeSceneId = state.selectedWorld?.active_instance?.active_scene_id || "";
  elements.sceneLibraryList.innerHTML = scenes.map((scene) => `
    <button
      type="button"
      class="pw-scene-library-item ${scene.id === state.sceneDrawerFocusId ? "is-active" : ""}"
      data-scene-library-id="${htmlEscape(scene.id)}"
    >
      <div class="pw-scene-library-item__head">
        <strong>${htmlEscape(scene.name)}</strong>
        <span>${scene.id === activeRuntimeSceneId ? "live" : scene.id === state.selectedSceneId ? "editing" : scene.is_default ? "default" : "saved"}</span>
      </div>
      <small>${htmlEscape(buildSceneLibrarySummary(scene))}</small>
    </button>
  `).join("");
}

function buildQuickSceneOptionLabel(scene = {}) {
  const status = getSceneStatusLabel(scene);
  return `${scene.name || "Untitled Scene"}${status ? ` · ${status}` : ""}`;
}

function focusSceneInDrawer(sceneId) {
  const nextSceneId = String(sceneId ?? "").trim();
  if (!nextSceneId || nextSceneId === state.sceneDrawerFocusId) {
    return;
  }
  if (state.sceneEditorSceneId) {
    rememberSceneDraft();
  }
  const scenes = state.selectedWorld?.scenes ?? [];
  if (!scenes.some((scene) => scene.id === nextSceneId)) {
    return;
  }
  state.sceneDrawerFocusId = nextSceneId;
  renderSceneLibrary();
  renderSceneDrawerSceneIndicator();
  renderSceneEditor();
}

function selectSceneForEditing(sceneId) {
  const nextSceneId = String(sceneId ?? "").trim();
  if (!nextSceneId || nextSceneId === state.selectedSceneId) {
    return;
  }
  const scenes = state.selectedWorld?.scenes ?? [];
  if (!scenes.some((scene) => scene.id === nextSceneId)) {
    return;
  }
  state.selectedSceneId = nextSceneId;
  state.sceneDrawerFocusId = nextSceneId;
  renderSelectedWorld();
}

function buildOptions(options = [], selectedValue = "") {
  return options.map((value) => `
    <option value="${htmlEscape(value)}" ${String(selectedValue) === String(value) ? "selected" : ""}>${htmlEscape(value || "none")}</option>
  `).join("");
}

function buildLabeledOptions(options = [], selectedValue = "") {
  return options.map((option) => `
    <option value="${htmlEscape(option.value)}" ${String(selectedValue) === String(option.value) ? "selected" : ""}>${htmlEscape(option.label || option.value || "none")}</option>
  `).join("");
}

function normalizeFacingMode(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "billboard") {
    return "billboard";
  }
  if (normalized === "upright_billboard" || normalized === "billboard_y") {
    return "upright_billboard";
  }
  return "fixed";
}

function getFacingModeLabel(value = "") {
  const normalized = normalizeFacingMode(value);
  return FACING_MODE_OPTIONS.find((entry) => entry.value === normalized)?.label || "Fixed";
}

function isPrimitivePanelShape(entry = {}) {
  return String(entry?.shape ?? "").trim().toLowerCase() === "panel";
}

function getPrimitivePanelDimensions(entry = {}) {
  return {
    x: Math.max(0.2, Number(entry.scale?.x ?? 4) || 4),
    y: Math.max(0.2, Number(entry.scale?.y ?? 2.25) || 2.25),
    z: Math.max(0.05, Number(entry.scale?.z ?? 0.1) || 0.1),
  };
}

function getPrimitivePlacementPresetEntry() {
  return extractToolPresetEntry("primitive", getToolPreset("primitive")?.entry ?? createBaseToolPresetEntry("primitive"));
}

function buildFacingModeOptions(selectedValue = "fixed") {
  return buildLabeledOptions(FACING_MODE_OPTIONS, normalizeFacingMode(selectedValue));
}

function buildFacingModeEditor(entry = {}, note = "Fixed uses the saved rotation. Billboard turns toward each viewer, and upright billboard only turns around Y.") {
  return `
    <label>
      <span>Facing</span>
      <select data-entity-field="facing_mode" data-value-type="text">${buildFacingModeOptions(entry.facing_mode || "fixed")}</select>
    </label>
    <p class="pw-inspector-note">${htmlEscape(note)}</p>
  `;
}

function buildEntitySummary(kind, entry = {}) {
  if (kind === "particle") {
    return `${entry.target_id || "no target"} · ${describeVector3(entry.position)} · ${entry.enabled === false ? "off" : "on"}`;
  }
  if (kind === "prefab_instance") {
    return `${entry.prefab_id || "choose prefab"} · ${describeVector3(entry.position)}`;
  }
  if (kind === "model") {
    const bounds = entry.bounds ?? { x: 1, y: 1, z: 1 };
    const textureLabel = entry.material?.texture_asset_id ? "asset texture" : (entry.material?.texture_preset || "none");
    return `${describeVector3(entry.position)} · ${textureLabel} · ${Number(bounds.x ?? 1).toFixed(1)} x ${Number(bounds.y ?? 1).toFixed(1)} x ${Number(bounds.z ?? 1).toFixed(1)}`;
  }
  if (kind === "primitive" && isPrimitivePanelShape(entry)) {
    const scale = getPrimitivePanelDimensions(entry);
    const textureLabel = entry.material?.texture_asset_id ? "asset texture" : (entry.material?.texture_preset || "none");
    return `${describeVector3(entry.position)} · ${getFacingModeLabel(entry.facing_mode)} · ${textureLabel} · ${Number(scale.x ?? 4).toFixed(1)} x ${Number(scale.y ?? 2.25).toFixed(1)}`;
  }
  if (kind === "panel") {
    const scale = entry.scale ?? { x: 4, y: 2.25, z: 0.1 };
    const textureLabel = entry.material?.texture_asset_id ? "asset texture" : (entry.material?.texture_preset || "none");
    return `${describeVector3(entry.position)} · ${getFacingModeLabel(entry.facing_mode)} · ${textureLabel} · ${Number(scale.x ?? 4).toFixed(1)} x ${Number(scale.y ?? 2.25).toFixed(1)}`;
  }
  if (kind === "screen") {
    return `${describeVector3(entry.position)} · ${getFacingModeLabel(entry.facing_mode)} · ${String(entry.html || "").slice(0, 18) || "empty html"}`;
  }
  if (kind === "text") {
    return `${describeVector3(entry.position)} · ${getFacingModeLabel(entry.facing_mode)} · scale ${Number(entry.scale ?? 1).toFixed(1)}`;
  }
  const details = [];
  if (entry.material?.texture_preset) {
    details.push(entry.material.texture_preset);
  }
  if ((Number(entry.material?.emissive_intensity) || 0) > 0) {
    details.push(`light ${roundPrivateValue(entry.material.emissive_intensity, 1)}`);
  }
  if (entry.invisible === true) {
    details.push("hidden in play");
  }
  return `${describeVector3(entry.position)}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

function renderSceneBuilder() {
  if (!elements.entitySections || !elements.entityEditor || !elements.prefabList || !elements.prefabDetail) {
    return;
  }
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    writeBuilderSelection([]);
    updateShellState();
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">Fix the scene JSON to continue editing.</p></div>';
    if (elements.entityLibrarySummary) {
      elements.entityLibrarySummary.innerHTML = "";
    }
    elements.entityEditor.innerHTML = "";
    elements.prefabList.innerHTML = "";
    elements.prefabDetail.innerHTML = "";
    return;
  }
  const selected = ensureBuilderSelection(sceneDoc);
  updateShellState();
  if (elements.entitySearch && elements.entitySearch.value !== String(state.entityQuery ?? "")) {
    elements.entitySearch.value = String(state.entityQuery ?? "");
  }
  if (elements.entityFilter && elements.entityFilter.value !== String(state.entityFilterKind ?? "all")) {
    elements.entityFilter.value = String(state.entityFilterKind ?? "all");
  }
  if (elements.prefabSearch && elements.prefabSearch.value !== String(state.prefabQuery ?? "")) {
    elements.prefabSearch.value = String(state.prefabQuery ?? "");
  }
  renderEntitySections(sceneDoc, selected);
  renderEntityInspector(sceneDoc, selected);
  renderPrefabList(sceneDoc);
  renderAssetsLibrary();
  renderToolPresetPanel();
  const inspectorDisabled = !isEditor() || state.mode !== "build";
  for (const field of elements.entityEditor.querySelectorAll("input, select, textarea")) {
    field.disabled = inspectorDisabled;
  }
}

function renderEntitySections(sceneDoc, selected = null) {
  const normalizedQuery = String(state.entityQuery ?? "").trim().toLowerCase();
  const normalizedKind = String(state.entityFilterKind ?? "all").trim() || "all";
  const allEntries = ENTITY_COLLECTIONS.flatMap((config) => getEntityArray(sceneDoc, config.key).map((entry, index) => {
    const name = getDisplayNameForEntity(config.kind, entry, index);
    const summary = buildEntitySummary(config.kind, entry);
    return {
      config,
      entry,
      index,
      name,
      summary,
      searchText: [config.label, entry.id, name, summary, entry.label, entry.value, entry.effect, entry.prefab_id].filter(Boolean).join(" ").toLowerCase(),
    };
  }));
  const totalCount = allEntries.length;
  const visibleEntries = allEntries
    .filter((item) => (normalizedKind === "all" || item.config.kind === normalizedKind) && (!normalizedQuery || item.searchText.includes(normalizedQuery)))
    .sort((left, right) => {
      const leftSelected = isEntitySelected(left.config.kind, left.entry.id) ? 1 : 0;
      const rightSelected = isEntitySelected(right.config.kind, right.entry.id) ? 1 : 0;
      if (leftSelected !== rightSelected) {
        return rightSelected - leftSelected;
      }
      const kindCompare = left.config.label.localeCompare(right.config.label);
      if (kindCompare !== 0) {
        return kindCompare;
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    });
  const selectedEntries = getSelectedEntities(sceneDoc);
  const selectedSummary = !selectedEntries.length
    ? "No item selected."
    : selectedEntries.length === 1
      ? `${getDisplayNameForEntity(selectedEntries[0].kind, selectedEntries[0].entry, selectedEntries[0].index)} selected.`
      : `${selectedEntries.length} items selected together.`;
  const typeCounts = ENTITY_COLLECTIONS.map((config) => ({
    kind: config.kind,
    label: config.label,
    count: allEntries.filter((item) => item.config.kind === config.kind).length,
  })).filter((entry) => entry.count > 0);
  const filterLabel = normalizedKind === "all"
    ? "All items"
    : getEntityCollection(normalizedKind)?.label || "Items";
  const filterConfig = normalizedKind === "all" ? null : getEntityCollection(normalizedKind);
  const scopedSceneCount = normalizedKind === "all"
    ? totalCount
    : (typeCounts.find((entry) => entry.kind === normalizedKind)?.count ?? 0);
  const filterCountLabel = ((scopedSceneCount === 1 ? filterConfig?.singular : filterConfig?.label) || "item").toLowerCase();
  const scopedSceneSummary = normalizedKind === "all"
    ? `${totalCount} item${totalCount === 1 ? "" : "s"} in this scene.`
    : `${scopedSceneCount} ${filterCountLabel} in this scene.`;
  const breakdownMarkup = normalizedKind === "all" && typeCounts.length > 0
    ? `
      <div class="pw-item-summary__breakdown">
        ${typeCounts.map((entry) => `
          <span><strong>${htmlEscape(entry.count)}</strong> ${htmlEscape(entry.label)}</span>
        `).join("")}
      </div>
    `
    : "";
  if (elements.entitySearch) {
    elements.entitySearch.disabled = totalCount === 0;
  }
  if (elements.entityFilter) {
    elements.entityFilter.disabled = totalCount === 0;
  }
  if (elements.entitySearchHint) {
    elements.entitySearchHint.textContent = totalCount === 0
      ? "Add items to this scene, then browse them here when the world gets crowded."
      : !visibleEntries.length
        ? "No items match this search or type filter."
        : `${visibleEntries.length} item${visibleEntries.length === 1 ? "" : "s"} shown. Click one to select it and edit it in the inspector.`;
  }
  if (elements.entityLibrarySummary) {
    elements.entityLibrarySummary.innerHTML = `
      <div class="pw-scene-focus">
        <div class="pw-scene-focus__head">
          <strong>${htmlEscape(filterLabel)}</strong>
          <span>${visibleEntries.length} shown</span>
        </div>
        <small>${htmlEscape(scopedSceneSummary)}</small>
        ${breakdownMarkup}
        <small>${htmlEscape(selectedSummary)}</small>
      </div>
    `;
  }
  if (!totalCount) {
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">No items in this scene yet.</p></div>';
    return;
  }
  if (!visibleEntries.length) {
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">No items match that search yet.</p></div>';
    return;
  }
  elements.entitySections.innerHTML = visibleEntries.map((item) => `
    <button
      type="button"
      class="pw-scene-library-item pw-entity-row ${isEntitySelected(item.config.kind, item.entry.id) ? "is-active" : ""}"
      data-select-kind="${htmlEscape(item.config.kind)}"
      data-select-id="${htmlEscape(item.entry.id)}"
    >
      <div class="pw-scene-library-item__head">
        <strong>${htmlEscape(item.name)}</strong>
        <span>${htmlEscape(item.config.label)}</span>
      </div>
      <small>${htmlEscape(item.summary)}</small>
      ${item.entry.id && item.entry.id !== item.name ? `<small>${htmlEscape(item.entry.id)}</small>` : ""}
    </button>
  `).join("");
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

function buildMaterialEditor(material = {}, options = {}) {
  const fieldPrefix = String(options.pathPrefix ?? "material.");
  const allowEmission = options.allowEmission === true;
  const textureTargetKind = String(options.textureTargetKind ?? "").trim();
  const textureTargetId = String(options.textureTargetId ?? "").trim();
  const linkedTextureId = String(material.texture_asset_id ?? "").trim();
  const linkedTexture = linkedTextureId ? getPrivateAssetById(linkedTextureId) : null;
  const linkedTextureThumb = getPrivateAssetFile(linkedTexture, "base_color");
  const canChooseTexture = Boolean(textureTargetKind && textureTargetId && canApplyTextureToRef(textureTargetKind, textureTargetId));
  const textureActionsDisabled = !canChooseTexture || !state.session || !state.selectedWorld || !isEditor() || state.mode !== "build";
  const textureTitle = linkedTexture?.name
    || (linkedTextureId ? "Linked texture asset" : "No custom texture linked");
  const textureSummary = linkedTexture
    ? (linkedTexture.intended_use || linkedTexture.world_context_summary || buildAssetSummary(linkedTexture))
    : linkedTextureId
      ? `Texture asset ${linkedTextureId} is linked here, but it is not available in your library right now.`
      : `Current pattern: ${material.texture_preset || "none"}. Choose a library texture or generate a new one with AI.`;
  const textureIdNote = linkedTextureId
    ? `<small class="pw-material-texture-card__id">${htmlEscape(linkedTextureId)}</small>`
    : "";
  const texturePreview = linkedTextureThumb?.url
    ? `<img class="pw-material-texture-card__thumb" src="${htmlEscape(linkedTextureThumb.url)}" alt="${htmlEscape(textureTitle)} preview" />`
    : `<div class="pw-material-texture-card__thumb pw-material-texture-card__thumb--empty" aria-hidden="true">${htmlEscape(material.texture_preset || "none")}</div>`;
  const textureActions = canChooseTexture
    ? `
      <div class="pw-inline-actions pw-material-texture-card__actions">
        <button type="button" data-open-texture-library ${textureActionsDisabled ? "disabled" : ""}>Choose from library</button>
        <button type="button" class="is-muted" data-generate-texture-from-inspector ${textureActionsDisabled ? "disabled" : ""}>Generate with AI</button>
        ${linkedTextureId ? `<button type="button" class="is-muted" data-clear-texture-asset-path="${htmlEscape(fieldPrefix)}" ${textureActionsDisabled ? "disabled" : ""}>Clear</button>` : ""}
      </div>
    `
    : "";
  return `
    <div class="pw-inspector-grid pw-inspector-grid--2">
      <div>
        <label>
          <span>Color</span>
          <input type="color" data-entity-field="${htmlEscape(`${fieldPrefix}color`)}" data-value-type="color" value="${htmlEscape(material.color || "#c8d0d8")}" />
        </label>
      </div>
      <div>
        <label>
          <span>Pattern</span>
          <select data-entity-field="${htmlEscape(`${fieldPrefix}texture_preset`)}" data-value-type="text">
            ${buildOptions(MATERIAL_PRESET_OPTIONS, material.texture_preset || "none")}
          </select>
        </label>
      </div>
    </div>
    <section class="pw-material-texture-card">
      <div class="pw-material-texture-card__row">
        ${texturePreview}
        <div class="pw-material-texture-card__body">
          <span class="pw-material-texture-card__eyebrow">Texture</span>
          <strong>${htmlEscape(textureTitle)}</strong>
          <p class="pw-material-texture-card__summary">${htmlEscape(textureSummary)}</p>
          ${textureIdNote}
        </div>
      </div>
      ${textureActions}
    </section>
    ${allowEmission ? `
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Light Emission</span>
            <input type="number" min="0" max="8" step="0.1" data-entity-field="${htmlEscape(`${fieldPrefix}emissive_intensity`)}" data-value-type="number" value="${htmlEscape(material.emissive_intensity ?? 0)}" />
          </label>
        </div>
      </div>
    ` : ""}
  `;
}

function getPrivateAssetById(assetId = "") {
  const normalizedAssetId = String(assetId ?? "").trim();
  if (!normalizedAssetId) {
    return null;
  }
  return (state.assets ?? []).find((asset) => asset.id === normalizedAssetId) ?? null;
}

function getPrivateAssetFile(asset, role = "") {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  if (!asset || !normalizedRole) {
    return null;
  }
  return (asset.files ?? []).find((file) => String(file.role ?? "").trim().toLowerCase() === normalizedRole) ?? null;
}

function canApplyTextureToRef(targetKind = "", targetId = "") {
  if (!MATERIALIZABLE_ENTITY_KINDS.has(String(targetKind ?? "").trim())) {
    return false;
  }
  try {
    const sceneDoc = parseSceneTextarea();
    return Boolean(findEntityByRef(sceneDoc, { kind: targetKind, id: targetId })?.entry);
  } catch (_error) {
    return false;
  }
}

function getSelectedTextureAttachTarget() {
  const targetKind = String(state.builderSelection?.kind ?? "").trim();
  const targetId = String(state.builderSelection?.id ?? "").trim();
  if (!targetKind || !targetId || !MATERIALIZABLE_ENTITY_KINDS.has(targetKind)) {
    return null;
  }
  try {
    const sceneDoc = parseSceneTextarea();
    const found = findEntityByRef(sceneDoc, { kind: targetKind, id: targetId });
    if (!found?.entry) {
      return null;
    }
    return {
      kind: targetKind,
      id: targetId,
      entry: found.entry,
      index: found.index,
      name: getDisplayNameForEntity(targetKind, found.entry, found.index),
      title: buildCompactEntityTitle(targetKind, found.entry, found.index),
      meta: [
        getEntityCollection(targetKind)?.singular || "Item",
        found.entry?.id ? truncatePrivateUiLabel(found.entry.id, 72) : "",
      ].filter(Boolean).join(" · "),
      summary: buildEntitySummary(targetKind, found.entry),
    };
  } catch (_error) {
    return null;
  }
}

function applyTextureAssetToSelection(assetId, options = {}) {
  const targetKind = String(options.targetKind ?? state.builderSelection?.kind ?? "").trim();
  const targetId = String(options.targetId ?? state.builderSelection?.id ?? "").trim();
  if (!assetId || !canApplyTextureToRef(targetKind, targetId)) {
    return false;
  }
  mutateSceneDoc((sceneDoc) => {
    const found = findEntityByRef(sceneDoc, { kind: targetKind, id: targetId });
    if (!found?.entry) {
      return;
    }
    found.entry.material = found.entry.material || { color: "#c8d0d8", texture_preset: "none", emissive_intensity: 0 };
    found.entry.material.texture_asset_id = assetId;
    found.entry.material.texture_preset = "none";
  });
  pushEvent("asset:texture-applied", assetId);
  return true;
}

function clearTextureAssetFromSelection(pathPrefix = "material.") {
  const normalizedPrefix = String(pathPrefix ?? "material.").trim() || "material.";
  updateSelectedEntityField(`${normalizedPrefix}texture_asset_id`, "", "text", { renderBuilder: false });
  updateSelectedEntityField(`${normalizedPrefix}texture_preset`, "none", "text");
}

function placeModelAsset(assetId, options = {}) {
  const asset = getPrivateAssetById(assetId);
  if (!asset || asset.asset_type !== "model") {
    return false;
  }
  let placed = false;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.models = Array.isArray(sceneDoc.models) ? sceneDoc.models : [];
    const nextId = `model_${slugToken(asset.name || asset.id)}_${sceneDoc.models.length + 1}`;
    sceneDoc.models.push({
      id: nextId,
      asset_id: asset.id,
      label: asset.name || `Model ${sceneDoc.models.length + 1}`,
      position: options.position ?? { x: sceneDoc.models.length * 3, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      bounds: asset.bounds ?? { x: 1, y: 1, z: 1 },
      material: { color: "#ffffff", texture_preset: "none", texture_asset_id: null, emissive_intensity: 0 },
      rigid_mode: "rigid",
      physics: { gravity_scale: 1, restitution: 0.12, friction: 0.72, mass: 1 },
      invisible: false,
      group_id: null,
    });
    writeBuilderSelection([{ kind: "model", id: nextId }], { kind: "model", id: nextId });
    placed = true;
  });
  if (placed) {
    setSceneDrawerTab("assets");
    pushEvent("asset:model-placed", asset.name || asset.id);
  }
  return placed;
}

function buildAssetSummary(asset = {}) {
  const fileRoles = (asset.files ?? []).map((file) => String(file.role ?? "").trim()).filter(Boolean);
  const roleSummary = fileRoles.slice(0, 3).join(", ") || "no files";
  return [
    asset.asset_type === "model"
      ? `${Number(asset.bounds?.x ?? 1).toFixed(1)} x ${Number(asset.bounds?.y ?? 1).toFixed(1)} x ${Number(asset.bounds?.z ?? 1).toFixed(1)}`
      : "texture",
    asset.provider || "manual",
    roleSummary,
    asset.status || "ready",
  ].join(" · ");
}

function openAssetAiDialog(kind = "texture") {
  if (!state.selectedWorld || !state.session) {
    focusAiBuilder();
    return;
  }
  const selected = (() => {
    try {
      return getSelectedEntity(parseSceneTextarea());
    } catch (_error) {
      return null;
    }
  })();
  const supportsTextureTarget = kind === "texture" && MATERIALIZABLE_ENTITY_KINDS.has(selected?.kind || "");
  const targetKind = kind === "texture"
    ? (supportsTextureTarget ? selected.kind : "world")
    : (selected?.kind || "world");
  const targetId = kind === "texture"
    ? (supportsTextureTarget ? selected.entry.id : "")
    : (selected?.entry?.id || "");
  openAiDialog({
    artifactType: kind === "texture" ? "texture" : "3d_model",
    targetKind,
    targetId,
    title: kind === "texture" ? "Texture brainstorm" : "3D model brainstorm",
    note: kind === "texture"
      ? "Let the text model ask a few sharp questions first, then it writes a structured texture spec and hands it to the image provider."
      : "Let the text model frame the model first, then it writes a structured 3D spec and hands it to the model provider.",
    applyLabel: kind === "texture" ? "Apply texture" : "",
  });
}

function openTextureAssetLibrary(options = {}) {
  const target = getSelectedTextureAttachTarget();
  if (!target) {
    setStatus("Select one item with a material first, then choose a texture for it.");
    return false;
  }
  state.assetFilterType = "texture";
  if (options.resetQuery !== false) {
    state.assetQuery = "";
  }
  if (elements.assetTypeFilter) {
    elements.assetTypeFilter.value = "texture";
  }
  if (elements.assetSearch) {
    elements.assetSearch.value = state.assetQuery;
  }
  setSceneDrawerOpen(true);
  setSceneDrawerTab("assets");
  setStatus(`Choose a texture for ${target.title}.`);
  void loadAssets();
  window.requestAnimationFrame(() => {
    elements.assetSearch?.focus?.();
  });
  return true;
}

function renderAssetsLibrary() {
  if (!elements.assetSections) {
    return;
  }
  const activeTextureTarget = getSelectedTextureAttachTarget();
  const filterType = String(state.assetFilterType ?? "all").trim() || "all";
  const showAssetContext = Boolean(activeTextureTarget && filterType !== "model");
  if (elements.assetSearch && elements.assetSearch.value !== String(state.assetQuery ?? "")) {
    elements.assetSearch.value = String(state.assetQuery ?? "");
  }
  if (elements.assetTypeFilter && elements.assetTypeFilter.value !== filterType) {
    elements.assetTypeFilter.value = filterType;
  }
  if (elements.assetContext) {
    if (showAssetContext) {
      elements.assetContext.hidden = false;
      elements.assetContext.innerHTML = `
        <span>Texture target</span>
        <strong title="${htmlEscape(activeTextureTarget.name)}">${htmlEscape(activeTextureTarget.title)}</strong>
        ${activeTextureTarget.meta ? `<small class="pw-asset-context__meta">${htmlEscape(activeTextureTarget.meta)}</small>` : ""}
        <small>Choose a library texture to attach it here, or generate a new one for this item.</small>
      `;
    } else {
      elements.assetContext.hidden = true;
      elements.assetContext.innerHTML = "";
    }
  }
  if (!state.session) {
    elements.assetSections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">Sign in to use account assets.</p></div>';
    if (elements.assetStatus) {
      elements.assetStatus.textContent = "";
    }
    if (elements.assetContext) {
      elements.assetContext.hidden = true;
      elements.assetContext.innerHTML = "";
    }
    return;
  }
  const query = String(state.assetQuery ?? "").trim().toLowerCase();
  const assets = (state.assets ?? [])
    .filter((asset) => filterType === "all" || asset.asset_type === filterType)
    .filter((asset) => {
      if (!query) {
        return true;
      }
      const haystack = [
        asset.name,
        asset.asset_type,
        asset.provider,
        asset.intended_use,
        asset.world_context_summary,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  if (elements.assetStatus) {
    elements.assetStatus.textContent = state.assetsLoading
      ? "Loading shared assets..."
      : `${assets.length} asset${assets.length === 1 ? "" : "s"} shown.`;
  }
  if (!assets.length) {
    elements.assetSections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">No shared assets match this filter yet.</p></div>';
    return;
  }
  elements.assetSections.innerHTML = assets.map((asset) => {
    const isReady = String(asset.status ?? "ready").trim().toLowerCase() === "ready";
    const canApplyTexture = isReady && asset.asset_type === "texture" && Boolean(activeTextureTarget);
    const thumbnail = getPrivateAssetFile(asset, asset.asset_type === "model" ? "thumbnail" : "base_color");
    return `
      <article class="pw-prefab-card">
        <div class="pw-prefab-card__head">
          <strong>${htmlEscape(asset.name || asset.id)}</strong>
          <span>${htmlEscape(asset.asset_type === "model" ? "Model" : "Texture")}</span>
        </div>
        ${thumbnail?.url ? `<img class="pw-asset-thumb" src="${htmlEscape(thumbnail.url)}" alt="${htmlEscape(asset.name || asset.id)}" />` : ""}
        <p>${htmlEscape(buildAssetSummary(asset))}</p>
        <small>${htmlEscape(asset.intended_use || asset.world_context_summary || "Ready across your private worlds.")}</small>
        <div class="pw-inline-actions">
          ${asset.asset_type === "texture"
            ? `<button type="button" ${canApplyTexture ? `data-apply-texture-asset="${htmlEscape(asset.id)}"` : "disabled"}>${!isReady ? "Waiting for ready" : canApplyTexture ? "Attach to selected item" : "Pick a material item"}</button>`
            : `<button type="button" ${isReady ? `data-place-model-asset="${htmlEscape(asset.id)}"` : "disabled"}>${isReady ? "Place in world" : "Waiting for ready"}</button>`}
        </div>
      </article>
    `;
  }).join("");
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

function buildToolPresetSummary(kind, entry = {}) {
  if (kind === "voxel") {
    const scale = getPrivateVoxelScale(entry.scale);
    const extra = [];
    if ((Number(entry.material?.emissive_intensity) || 0) > 0) {
      extra.push(`light ${roundPrivateValue(entry.material.emissive_intensity, 1)}`);
    }
    if (entry.invisible === true) {
      extra.push("hidden in play");
    }
    return [entry.shape_preset || "cube", entry.material?.texture_preset || "none", `${roundPrivateValue(scale.x, 1)} x ${roundPrivateValue(scale.y, 1)} x ${roundPrivateValue(scale.z, 1)}`, ...extra].join(" · ");
  }
  if (kind === "primitive") {
    const scale = entry.scale ?? { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT };
    const extra = [];
    if ((Number(entry.material?.emissive_intensity) || 0) > 0) {
      extra.push(`light ${roundPrivateValue(entry.material.emissive_intensity, 1)}`);
    }
    if (entry.invisible === true) {
      extra.push("hidden in play");
    }
    if (isPrimitivePanelShape(entry)) {
      const panelScale = getPrimitivePanelDimensions(entry);
      return [
        "panel",
        getFacingModeLabel(entry.facing_mode),
        `${roundPrivateValue(panelScale.x ?? 4, 1)} x ${roundPrivateValue(panelScale.y ?? 2.25, 1)}`,
        entry.material?.texture_asset_id ? "asset texture" : (entry.material?.texture_preset || "none"),
        ...extra,
      ].join(" · ");
    }
    return [entry.shape || "box", entry.rigid_mode || "rigid", `${roundPrivateValue(scale.x ?? 1, 1)} x ${roundPrivateValue(scale.y ?? 1, 1)} x ${roundPrivateValue(scale.z ?? 1, 1)}`, ...extra].join(" · ");
  }
  if (kind === "panel") {
    const scale = entry.scale ?? { x: 4, y: 2.25, z: 0.1 };
    const extra = [];
    if ((Number(entry.material?.emissive_intensity) || 0) > 0) {
      extra.push(`light ${roundPrivateValue(entry.material.emissive_intensity, 1)}`);
    }
    if (entry.invisible === true) {
      extra.push("hidden in play");
    }
    return [
      getFacingModeLabel(entry.facing_mode),
      `${roundPrivateValue(scale.x ?? 4, 1)} x ${roundPrivateValue(scale.y ?? 2.25, 1)}`,
      entry.material?.texture_asset_id ? "asset texture" : (entry.material?.texture_preset || "none"),
      ...extra,
    ].join(" · ");
  }
  if (kind === "player") {
    return `${entry.camera_mode || "third_person"} · ${entry.body_mode || "rigid"} · scale ${roundPrivateValue(entry.scale ?? 1, 1)}`;
  }
  if (kind === "screen") {
    const scale = entry.scale ?? { x: 4, y: 2.25, z: 0.2 };
    return `${getFacingModeLabel(entry.facing_mode)} · ${roundPrivateValue(scale.x ?? 4, 1)} x ${roundPrivateValue(scale.y ?? 2.25, 1)} screen · ${stripHtmlTags(entry.html || "").slice(0, 40) || "custom html"}`;
  }
  if (kind === "text") {
    return `${getFacingModeLabel(entry.facing_mode)} · "${String(entry.value || "").slice(0, 36) || "Text"}" · scale ${roundPrivateValue(entry.scale ?? 1, 1)}`;
  }
  if (kind === "trigger") {
    const scale = entry.scale ?? { x: 2, y: 2, z: 2 };
    return `${entry.label || "Trigger"} · ${roundPrivateValue(scale.x ?? 2, 1)} x ${roundPrivateValue(scale.y ?? 2, 1)} x ${roundPrivateValue(scale.z ?? 2, 1)}`;
  }
  return "";
}

function stripHtmlTags(value = "") {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderToolPresetPanel() {
  if (!elements.toolPresetPanel) {
    return;
  }
  const kind = getActivePlacementTool();
  if (!isToolPresetKind(kind) || !canUsePlacementTools()) {
    elements.toolPresetPanel.hidden = true;
    return;
  }
  const presetOptions = getToolPresetOptions(kind);
  const selectedPresetId = getSelectedToolPresetId(kind);
  const selectedPreset = getToolPreset(kind, selectedPresetId) ?? presetOptions[0] ?? null;
  const selectedEntry = getSelectedEntityForToolPreset(kind);
  const canUpdateFromSelection = Boolean(selectedEntry && selectedPreset && selectedPreset.builtin !== true);
  const canDeletePreset = Boolean(selectedPreset && selectedPreset.builtin !== true);
  const saveFromSelection = Boolean(selectedEntry);
  elements.toolPresetPanel.hidden = false;
  elements.toolPresetPanel.classList.toggle("is-collapsed", state.toolPresetPanelCollapsed === true);
  if (elements.toolPresetCompact) {
    elements.toolPresetCompact.hidden = state.toolPresetPanelCollapsed !== true;
  }
  if (elements.toolPresetContent) {
    elements.toolPresetContent.hidden = state.toolPresetPanelCollapsed === true;
  }
  if (elements.toolPresetCurrentName) {
    elements.toolPresetCurrentName.textContent = selectedPreset?.name || `${buildToolPresetDisplayName(kind)} preset`;
  }
  if (elements.toolPresetCollapse) {
    elements.toolPresetCollapse.setAttribute("aria-expanded", String(state.toolPresetPanelCollapsed !== true));
  }
  if (elements.toolPresetExpand) {
    elements.toolPresetExpand.setAttribute("aria-expanded", String(state.toolPresetPanelCollapsed !== true));
  }
  if (elements.toolPresetTitle) {
    elements.toolPresetTitle.textContent = `${buildToolPresetDisplayName(kind)} Presets`;
  }
  if (elements.toolPresetHint) {
    elements.toolPresetHint.textContent = saveFromSelection
      ? `New ${buildToolPresetDisplayName(kind).toLowerCase()} placements will use this preset. Save or update from the selected item when it looks right.`
      : `New ${buildToolPresetDisplayName(kind).toLowerCase()} placements will use this preset until you switch to another one.`;
  }
  if (elements.toolPresetSelect) {
    elements.toolPresetSelect.innerHTML = presetOptions.map((preset) => `
      <option value="${htmlEscape(preset.id)}">${htmlEscape(preset.name)}${preset.builtin ? " · built in" : ""}</option>
    `).join("");
    elements.toolPresetSelect.value = selectedPresetId;
    elements.toolPresetSelect.disabled = presetOptions.length <= 1 && !saveFromSelection;
  }
  if (elements.toolPresetSummary) {
    elements.toolPresetSummary.textContent = selectedPreset
      ? buildToolPresetSummary(kind, selectedPreset.entry)
      : "No preset available yet.";
  }
  if (elements.toolPresetName) {
    elements.toolPresetName.placeholder = `New ${buildToolPresetDisplayName(kind).toLowerCase()} preset`;
  }
  if (elements.saveToolPreset) {
    elements.saveToolPreset.textContent = saveFromSelection ? "Save From Selection" : "Save Copy";
    elements.saveToolPreset.disabled = !selectedPreset;
  }
  if (elements.updateToolPreset) {
    elements.updateToolPreset.disabled = !canUpdateFromSelection;
    elements.updateToolPreset.textContent = selectedPreset?.builtin ? "Built In" : "Update From Selection";
  }
  if (elements.deleteToolPreset) {
    elements.deleteToolPreset.disabled = !canDeletePreset;
  }
}

function setToolPresetPanelCollapsed(collapsed) {
  state.toolPresetPanelCollapsed = collapsed === true;
  try {
    window.localStorage.setItem(
      TOOL_PRESET_PANEL_COLLAPSED_STORAGE_KEY,
      state.toolPresetPanelCollapsed ? "1" : "0",
    );
  } catch (_error) {
    // ignore storage failures
  }
  renderToolPresetPanel();
}

function getSelectedPrefabEntry(prefabId = state.selectedPrefabId) {
  const normalizedPrefabId = String(prefabId ?? "").trim();
  if (!normalizedPrefabId) {
    return null;
  }
  return (state.selectedWorld?.prefabs ?? []).find((entry) => entry.id === normalizedPrefabId) ?? null;
}

function getPrefabEntryCounts(prefabDoc = {}) {
  return {
    voxel: (prefabDoc.voxels ?? []).length,
    primitive: (prefabDoc.primitives ?? []).length,
    panel: (prefabDoc.panels ?? []).length,
    model: (prefabDoc.models ?? []).length,
    screen: (prefabDoc.screens ?? []).length,
    player: (prefabDoc.players ?? []).length,
    text: (prefabDoc.texts ?? []).length,
    trigger: (prefabDoc.trigger_zones ?? []).length,
    particle: (prefabDoc.particles ?? []).length,
    prefab_instance: (prefabDoc.prefab_instances ?? []).length,
  };
}

function getPrefabTypeSummary(counts = {}) {
  const labels = [];
  if (counts.voxel) {
    labels.push("voxels");
  }
  if (counts.primitive) {
    labels.push("objects");
  }
  if (counts.panel) {
    labels.push("panels");
  }
  if (counts.model) {
    labels.push("models");
  }
  if (counts.screen) {
    labels.push("screens");
  }
  if (counts.player) {
    labels.push("players");
  }
  if (counts.text) {
    labels.push("text");
  }
  if (counts.trigger) {
    labels.push("triggers");
  }
  if (counts.particle) {
    labels.push("effects");
  }
  if (counts.prefab_instance) {
    labels.push("linked prefabs");
  }
  return labels.slice(0, 3).join(" · ") || "empty";
}

function getEntityApproxRenderSize(kind, entry = {}) {
  if (kind === "voxel") {
    const scale = getPrivateVoxelScale(entry.scale);
    return new THREE.Vector3(scale.x, scale.y, scale.z);
  }
  if (kind === "primitive") {
    if (isPrimitivePanelShape(entry)) {
      const scale = getPrimitivePanelDimensions(entry);
      return new THREE.Vector3(scale.x, scale.y, scale.z);
    }
    const scale = entry.scale ?? { x: 1, y: 1, z: 1 };
    if (entry.shape === "plane") {
      return new THREE.Vector3(scale.x || 1, Math.max(0.1, (scale.y || 1) * 0.1), scale.z || 1);
    }
    return new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
  }
  if (kind === "panel") {
    return new THREE.Vector3(
      Math.max(0.2, Number(entry.scale?.x ?? 4) || 4),
      Math.max(0.2, Number(entry.scale?.y ?? 2.25) || 2.25),
      Math.max(0.05, Number(entry.scale?.z ?? 0.1) || 0.1),
    );
  }
  if (kind === "model") {
    const scale = entry.scale ?? { x: 1, y: 1, z: 1 };
    const bounds = entry.bounds ?? { x: 1, y: 1, z: 1 };
    return new THREE.Vector3(
      (scale.x || 1) * (bounds.x || 1),
      (scale.y || 1) * (bounds.y || 1),
      (scale.z || 1) * (bounds.z || 1),
    );
  }
  if (kind === "player") {
    const scale = Math.max(0.2, Number(entry.scale ?? 1) || 1);
    return new THREE.Vector3(
      PRIVATE_PLAYER_METRICS.width * scale,
      PRIVATE_PLAYER_METRICS.height * scale,
      PRIVATE_PLAYER_METRICS.width * scale,
    );
  }
  if (kind === "screen") {
    return new THREE.Vector3(
      Math.max(0.2, Number(entry.scale?.x ?? 4) || 4),
      Math.max(0.2, Number(entry.scale?.y ?? 2.25) || 2.25),
      Math.max(0.05, Number(entry.scale?.z ?? 0.1) || 0.1),
    );
  }
  if (kind === "text") {
    const scale = Math.max(0.2, Number(entry.scale ?? 1) || 1);
    return new THREE.Vector3(4.5 * scale, 1.2 * scale, 0.12 * scale);
  }
  if (kind === "trigger") {
    return new THREE.Vector3(
      Math.max(0.2, Number(entry.scale?.x ?? 2) || 2),
      Math.max(0.2, Number(entry.scale?.y ?? 2) || 2),
      Math.max(0.2, Number(entry.scale?.z ?? 2) || 2),
    );
  }
  if (kind === "particle") {
    return new THREE.Vector3(
      Math.max(0.3, Number(entry.scale?.x ?? 1) || 1) * 1.4,
      Math.max(0.3, Number(entry.scale?.y ?? 1) || 1) * 1.8,
      Math.max(0.3, Number(entry.scale?.z ?? 1) || 1) * 1.4,
    );
  }
  return new THREE.Vector3(1, 1, 1);
}

function buildBoundsBoxFromEntry(kind, entry = {}, nestedBox = null) {
  const position = new THREE.Vector3(
    Number(entry.position?.x ?? 0) || 0,
    Number(entry.position?.y ?? 0) || 0,
    Number(entry.position?.z ?? 0) || 0,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    Number(entry.rotation?.x ?? 0) || 0,
    Number(entry.rotation?.y ?? 0) || 0,
    Number(entry.rotation?.z ?? 0) || 0,
  ));
  const box = nestedBox
    ? nestedBox.clone()
    : new THREE.Box3(
      new THREE.Vector3().copy(getEntityApproxRenderSize(kind, entry)).multiplyScalar(-0.5),
      getEntityApproxRenderSize(kind, entry).multiplyScalar(0.5),
    );
  const scaleVector = kind === "prefab_instance"
    ? new THREE.Vector3(
      Math.max(0.1, Number(entry.scale?.x ?? 1) || 1),
      Math.max(0.1, Number(entry.scale?.y ?? 1) || 1),
      Math.max(0.1, Number(entry.scale?.z ?? 1) || 1),
    )
    : new THREE.Vector3(1, 1, 1);
  box.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, scaleVector));
  return box;
}

function getPrefabDocBounds(prefabDoc = {}, visitedIds = new Set()) {
  let bounds = null;
  const collections = [
    ["voxel", prefabDoc.voxels ?? []],
    ["primitive", prefabDoc.primitives ?? []],
    ["panel", prefabDoc.panels ?? []],
    ["model", prefabDoc.models ?? []],
    ["screen", prefabDoc.screens ?? []],
    ["player", prefabDoc.players ?? []],
    ["text", prefabDoc.texts ?? []],
    ["trigger", prefabDoc.trigger_zones ?? []],
    ["particle", prefabDoc.particles ?? []],
    ["prefab_instance", prefabDoc.prefab_instances ?? []],
  ];
  for (const [kind, entries] of collections) {
    for (const entry of entries) {
      let entryBounds = null;
      if (kind === "prefab_instance") {
        const nestedPrefabId = String(entry.prefab_id ?? "").trim();
        if (!nestedPrefabId || visitedIds.has(nestedPrefabId)) {
          continue;
        }
        const nestedPrefab = getSelectedPrefabEntry(nestedPrefabId);
        const nestedBounds = nestedPrefab ? getPrefabDocBounds(nestedPrefab.prefab_doc ?? {}, new Set([...visitedIds, nestedPrefabId])) : null;
        if (!nestedBounds) {
          continue;
        }
        entryBounds = buildBoundsBoxFromEntry(kind, entry, nestedBounds);
      } else {
        entryBounds = buildBoundsBoxFromEntry(kind, entry);
      }
      if (!bounds) {
        bounds = entryBounds.clone();
      } else {
        bounds.union(entryBounds);
      }
    }
  }
  return bounds;
}

function getPrefabLibraryMeta(prefab) {
  const doc = prefab?.prefab_doc ?? {};
  const counts = getPrefabEntryCounts(doc);
  const itemCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const bounds = getPrefabDocBounds(doc);
  const dimensions = bounds ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
  const typeSummary = getPrefabTypeSummary(counts);
  return {
    itemCount,
    typeSummary,
    dimensions,
    sizeSummary: `${roundPrivateValue(dimensions.x, 1)} x ${roundPrivateValue(dimensions.y, 1)} x ${roundPrivateValue(dimensions.z, 1)}`,
    searchText: [prefab?.name || "", typeSummary].join(" ").toLowerCase(),
  };
}

function buildPersistentGroupInspectorActions(sceneDoc, selectedEntities = []) {
  if (!isEditor() || state.mode !== "build" || selectedEntities.length < 2) {
    return "";
  }
  const groupInfo = getSelectionPersistentGroupInfo(sceneDoc, selectedEntities);
  if (groupInfo.isWholeGroupSelected) {
    return `
      <div class="pw-runtime-actions">
        <button type="button" class="is-muted" data-ungroup-selection="${htmlEscape(groupInfo.groupId)}">Ungroup</button>
      </div>
      <p class="pw-inspector-note">Persistent group ${htmlEscape(groupInfo.groupId)}. Selecting one member now brings back the whole group.</p>
    `;
  }
  return `
    <div class="pw-runtime-actions">
      <button type="button" data-group-selection="true">Group Selection</button>
    </div>
    <p class="pw-inspector-note">Save this temporary selection as a persistent group so it comes back together later.</p>
  `;
}

function renderEntityInspector(sceneDoc, selected = null) {
  const selectedEntities = getSelectedEntities(sceneDoc);
  if (!selected) {
    elements.selectionLabel.textContent = "No selection";
    elements.entityEmpty.hidden = false;
    elements.entityEditor.innerHTML = "";
    elements.removeEntity.disabled = true;
    elements.convertPrefab.disabled = true;
    return;
  }
  if (selectedEntities.length > 1) {
    elements.selectionLabel.textContent = `${selectedEntities.length} selected`;
    elements.entityEmpty.hidden = true;
    elements.removeEntity.disabled = !isEditor() || state.mode !== "build";
    elements.convertPrefab.disabled = true;
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">This group moves together. Hold Shift to add more, drag it while Shift is held, or hold Q for axis grabbers.</p>
      ${buildPersistentGroupInspectorActions(sceneDoc, selectedEntities)}
      <div class="pw-builder-group">
        <div class="pw-builder-group__header">
          <strong>Selection</strong>
          <span>${selectedEntities.length}</span>
        </div>
        <div class="pw-builder-group__items">
          ${selectedEntities.map((entry, index) => `
            <div class="pw-builder-item is-active">
              <strong>${htmlEscape(getDisplayNameForEntity(entry.kind, entry.entry, index))}</strong>
              <small>${htmlEscape(buildEntitySummary(entry.kind, entry.entry))}</small>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    return;
  }
  const { kind, entry } = selected;
  elements.selectionLabel.textContent = getDisplayNameForEntity(kind, entry);
  elements.entityEmpty.hidden = true;
  elements.removeEntity.disabled = !isEditor() || state.mode !== "build";
  elements.convertPrefab.disabled = !isEditor() || state.mode !== "build" || kind === "particle" || kind === "prefab_instance";

  if (kind === "voxel") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Solid static voxel. Pattern presets render directly in the preview. Invisible voxels stay translucent in Build mode so you can still grab and edit them.</p>
      ${buildMaterialEditor(entry.material, { allowEmission: true, textureTargetKind: kind, textureTargetId: entry.id })}
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
      <div class="pw-checkbox">
        <input type="checkbox" data-entity-field="invisible" data-value-type="checkbox" ${entry.invisible === true ? "checked" : ""} />
        <span>Invisible in play</span>
      </div>
    `;
    return;
  }

  if (kind === "primitive") {
    const primitiveFacingEditor = isPrimitivePanelShape(entry)
      ? buildFacingModeEditor(entry, "Fixed uses the saved rotation. Billboard turns this panel toward each viewer, and upright billboard only rotates around Y.")
      : "";
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Physics objects can collide, stack, bounce, and carry particles or trails. Invisible objects stay translucent in Build mode so their light and transform are still easy to edit.</p>
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
      ${buildMaterialEditor(entry.material, { allowEmission: true, textureTargetKind: kind, textureTargetId: entry.id })}
      ${primitiveFacingEditor}
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
      <div class="pw-checkbox">
        <input type="checkbox" data-entity-field="invisible" data-value-type="checkbox" ${entry.invisible === true ? "checked" : ""} />
        <span>Invisible in play</span>
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

  if (kind === "panel") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Panels are flat material surfaces for posters, decals, signs, and framed art. Use Facing when it should stay in world space or turn toward each viewer.</p>
      <label>
        <span>Label</span>
        <input type="text" data-entity-field="label" data-value-type="text" value="${htmlEscape(entry.label || "")}" />
      </label>
      ${buildMaterialEditor(entry.material, { allowEmission: true, textureTargetKind: kind, textureTargetId: entry.id })}
      ${buildFacingModeEditor(entry)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale || { x: 4, y: 2.25, z: 0.1 })}</div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Group</span>
            <input type="text" data-entity-field="group_id" data-value-type="text" value="${htmlEscape(entry.group_id || "")}" placeholder="optional group name" />
          </label>
        </div>
        <div class="pw-checkbox">
          <input type="checkbox" data-entity-field="invisible" data-value-type="checkbox" ${entry.invisible === true ? "checked" : ""} />
          <span>Invisible in play</span>
        </div>
      </div>
    `;
    return;
  }

  if (kind === "model") {
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Custom model assets use their stored GLB for rendering and an approximate box collider from the saved bounds.</p>
      <label>
        <span>Label</span>
        <input type="text" data-entity-field="label" data-value-type="text" value="${htmlEscape(entry.label || "")}" />
      </label>
      <label>
        <span>Asset ID</span>
        <input type="text" data-entity-field="asset_id" data-value-type="text" value="${htmlEscape(entry.asset_id || "")}" />
      </label>
      ${buildMaterialEditor(entry.material, { allowEmission: true, textureTargetKind: kind, textureTargetId: entry.id })}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Bounds", "bounds", entry.bounds || { x: 1, y: 1, z: 1 })}</div>
      <div class="pw-inspector-grid pw-inspector-grid--2">
        <div>
          <label>
            <span>Rigid Mode</span>
            <select data-entity-field="rigid_mode" data-value-type="text">${buildOptions(["rigid", "ghost"], entry.rigid_mode || "rigid")}</select>
          </label>
        </div>
        <div>
          <label>
            <span>Group</span>
            <input type="text" data-entity-field="group_id" data-value-type="text" value="${htmlEscape(entry.group_id || "")}" placeholder="optional group name" />
          </label>
        </div>
      </div>
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
        <div class="pw-checkbox">
          <input type="checkbox" data-entity-field="invisible" data-value-type="checkbox" ${entry.invisible === true ? "checked" : ""} />
          <span>Invisible in play</span>
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
    const aiDisabled = !state.selectedWorld || !state.session || !isEditor() || state.mode !== "build";
    const screenPrompt = getScreenAiPrompt(entry.id);
    elements.entityEditor.innerHTML = `
      <p class="pw-inspector-note">Static HTML and CSS only. No custom JavaScript or remote resources. Width and height changes now reflow the HTML to match the new viewport instead of just stretching it.</p>
      ${buildMaterialEditor(entry.material, { textureTargetKind: kind, textureTargetId: entry.id })}
      ${buildFacingModeEditor(entry)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <label>
        <span>Screen HTML</span>
        <textarea rows="10" data-entity-field="html" data-value-type="text" spellcheck="false">${htmlEscape(entry.html || "")}</textarea>
      </label>
      <label class="pw-screen-ai">
        <span>Starting brief</span>
        <textarea rows="3" data-screen-ai-prompt="${htmlEscape(entry.id)}" spellcheck="false" placeholder="Optional starting brief for the brainstorm thread." ${aiDisabled ? "disabled" : ""}>${htmlEscape(screenPrompt)}</textarea>
      </label>
      <div class="pw-inline-actions">
        <button type="button" data-screen-ai-generate="${htmlEscape(entry.id)}" ${aiDisabled ? "disabled" : ""}>Brainstorm HTML</button>
      </div>
      <p class="pw-screen-ai__hint">Opens a brainstorm thread first, then generates from that thread and lets you apply the result back to this screen.</p>
    `;
    return;
  }

  if (kind === "text") {
    elements.entityEditor.innerHTML = `
      ${buildMaterialEditor(entry.material, { textureTargetKind: kind, textureTargetId: entry.id })}
      ${buildFacingModeEditor(entry)}
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
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
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
      <p class="pw-inspector-note">These are visible animated effects in the preview and play scene. Position, rotation, and scale are relative to the chosen target.</p>
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
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale || { x: 1, y: 1, z: 1 })}</div>
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
      ${buildMaterialEditor(entry.overrides?.material ?? { color: "#c8d0d8", texture_preset: "none", emissive_intensity: 0 }, {
        pathPrefix: "overrides.material.",
        allowEmission: true,
      })}
    `;
  }
}

function renderPrefabList(sceneDoc) {
  const prefabs = state.selectedWorld?.prefabs ?? [];
  const normalizedQuery = String(state.prefabQuery ?? "").trim().toLowerCase();
  const canEditPrefabs = isEditor() && state.mode === "build";
  const visiblePrefabs = prefabs
    .map((prefab) => ({
      prefab,
      meta: getPrefabLibraryMeta(prefab),
    }))
    .filter(({ prefab, meta }) => !normalizedQuery || meta.searchText.includes(normalizedQuery) || String(prefab.id ?? "").toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftActive = left.prefab.id === state.prefabPlacementId ? 2 : left.prefab.id === state.selectedPrefabId ? 1 : 0;
      const rightActive = right.prefab.id === state.prefabPlacementId ? 2 : right.prefab.id === state.selectedPrefabId ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return String(right.prefab.updated_at ?? "").localeCompare(String(left.prefab.updated_at ?? ""));
    });
  if (!prefabs.length) {
    state.selectedPrefabId = "";
    elements.prefabList.innerHTML = '<div class="pw-prefab-card"><p>No prefabs yet. Select an object and convert it into one.</p></div>';
    if (elements.prefabDetail) {
      elements.prefabDetail.innerHTML = `
        <section class="pw-builder-panel pw-prefab-detail pw-prefab-detail--empty">
          <h3>Prefab details</h3>
          <p class="pw-builder-empty">Select an object and turn it into a prefab to start building a reusable library.</p>
        </section>
      `;
    }
    if (elements.prefabSearchHint) {
      elements.prefabSearchHint.textContent = "Turn a scene item into a prefab, then place it in the world from here.";
    }
    return;
  }
  if (!visiblePrefabs.length) {
    elements.prefabList.innerHTML = '<div class="pw-prefab-card"><p>No prefabs match that search.</p></div>';
    if (elements.prefabDetail) {
      elements.prefabDetail.innerHTML = `
        <section class="pw-builder-panel pw-prefab-detail pw-prefab-detail--empty">
          <h3>Prefab details</h3>
          <p class="pw-builder-empty">No prefab matches that search. Try another name or clear the filter.</p>
        </section>
      `;
    }
    if (elements.prefabSearchHint) {
      elements.prefabSearchHint.textContent = "Try a different name or clear the search.";
    }
    return;
  }
  const selectedEntry = visiblePrefabs.find(({ prefab }) => prefab.id === state.selectedPrefabId)
    ?? visiblePrefabs.find(({ prefab }) => prefab.id === state.prefabPlacementId)
    ?? visiblePrefabs[0];
  const activePrefab = selectedEntry?.prefab ?? null;
  if (activePrefab && state.selectedPrefabId !== activePrefab.id) {
    state.selectedPrefabId = activePrefab.id;
  }
  if (elements.prefabSearchHint) {
    elements.prefabSearchHint.textContent = state.prefabPlacementId
      ? `Placing ${activePrefab?.name || "prefab"} in the world. Click a spot in build mode to drop it.`
      : `${visiblePrefabs.length} prefab${visiblePrefabs.length === 1 ? "" : "s"} ready. Pick one, then click in the world to place it.`;
  }
  elements.prefabList.innerHTML = visiblePrefabs.map(({ prefab, meta }) => {
    const isSelected = activePrefab?.id === prefab.id;
    const isArmed = state.prefabPlacementId === prefab.id;
    const status = isArmed ? "armed" : isSelected ? "selected" : "saved";
    return `
      <button
        type="button"
        class="pw-scene-library-item pw-prefab-row ${isSelected ? "is-active" : ""} ${isArmed ? "is-armed" : ""}"
        data-prefab-card-select="${htmlEscape(prefab.id)}"
      >
        <div class="pw-scene-library-item__head">
          <strong>${htmlEscape(prefab.name)}</strong>
          <span>${status}</span>
        </div>
        <small>${htmlEscape(meta.itemCount)} item${meta.itemCount === 1 ? "" : "s"} · ${htmlEscape(meta.sizeSummary)}</small>
        <small>${htmlEscape(meta.typeSummary)}</small>
      </button>
    `;
  }).join("");
  if (elements.prefabDetail && selectedEntry) {
    const { prefab, meta } = selectedEntry;
    const isArmed = state.prefabPlacementId === prefab.id;
    const status = isArmed ? "armed" : "selected";
    const updatedAt = prefab.updated_at ? new Date(prefab.updated_at).toLocaleString() : "new";
    elements.prefabDetail.innerHTML = `
      <section class="pw-builder-panel pw-prefab-detail">
        <div class="pw-panel__header">
          <h3>Prefab details</h3>
          <span class="pw-prefab-card__badge">${status}</span>
        </div>
        <div class="pw-scene-focus">
          <div class="pw-scene-focus__head">
            <strong>${htmlEscape(prefab.name)}</strong>
            <span>${htmlEscape(meta.typeSummary)}</span>
          </div>
          <small>${htmlEscape(meta.itemCount)} item${meta.itemCount === 1 ? "" : "s"} · ${htmlEscape(meta.sizeSummary)}</small>
          <small>Updated ${htmlEscape(updatedAt)}</small>
        </div>
        <label>
          <span>Name</span>
          <input type="text" data-prefab-name="${htmlEscape(prefab.id)}" value="${htmlEscape(prefab.name)}" ${canEditPrefabs ? "" : "disabled"} />
        </label>
        <div class="pw-prefab-card__actions">
          <button type="button" data-place-prefab-id="${htmlEscape(prefab.id)}" ${canEditPrefabs ? "" : "disabled"}>${isArmed ? "Cancel world placement" : "Use in world"}</button>
          <button type="button" class="is-muted" data-delete-prefab="${htmlEscape(prefab.id)}" ${canEditPrefabs ? "" : "disabled"}>Remove</button>
        </div>
      </section>
    `;
  }
}

function renderWorldMeta() {
  const rows = buildMetaRows(state.selectedWorld);
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
      ? "Sign in to open this private world."
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

function getPrivateSavedGameTitle(game = {}, fallback = "Nearby game") {
  return sanitizeBrowserShareTitle(game?.title ?? game?.manifest?.title ?? "", fallback);
}

function normalizePrivateGameSeats(session = {}) {
  return Array.isArray(session?.seats) ? session.seats : [];
}

function getPrivateGameSeatCapacity(session = {}) {
  return Math.max(1, normalizePrivateGameSeats(session).length || Number(session?.game?.manifest?.max_players) || 1);
}

function getPrivateGameSessionTitle(session = {}) {
  return getPrivateSavedGameTitle(session?.game ?? {}, "Nearby game");
}

function getPrivateGameSessionDescription(session = {}) {
  return sanitizeBrowserShareTitle(session?.game?.manifest?.description ?? "", "");
}

function getPrivateGameHostName(session = {}) {
  return getPrivateDisplayNameForSessionId(session?.host_viewer_session_id)
    || String(session?.host_display_name ?? "").trim()
    || "nearby host";
}

function getPrivateGameSessionRole(session = {}) {
  const value = String(session?.group_role ?? session?.groupRole ?? "").trim().toLowerCase();
  return value === "member" ? "member" : "origin";
}

function isPrivateGameOriginSession(session = {}) {
  return getPrivateGameSessionRole(session) === "origin";
}

function isPrivateGameMemberSession(session = {}) {
  return getPrivateGameSessionRole(session) === "member";
}

function getPrivateGameSessionAnchorSessionId(session = {}) {
  if (isPrivateGameOriginSession(session)) {
    return String(session?.session_id ?? "").trim();
  }
  return String(session?.anchor_session_id ?? session?.anchorSessionId ?? "").trim();
}

function getPrivateGameSessionAnchorHostSessionId(session = {}) {
  if (isPrivateGameOriginSession(session)) {
    return String(session?.host_viewer_session_id ?? "").trim();
  }
  return String(session?.anchor_host_session_id ?? session?.anchorHostSessionId ?? "").trim();
}

function resolvePrivateGameOriginSession(session = {}) {
  const anchorSessionId = getPrivateGameSessionAnchorSessionId(session);
  if (!anchorSessionId) {
    return null;
  }
  if (String(session?.session_id ?? "").trim() === anchorSessionId && isPrivateGameOriginSession(session)) {
    return session;
  }
  return state.gameSessions.get(anchorSessionId) ?? null;
}

function isPrivateListedLiveGameSession(session = {}) {
  return isPrivateGameOriginSession(session) && session?.listed_live !== false && session?.listedLive !== false;
}

function getNearbyPrivateOriginGameSession(excludeHostSessionId = getPrivateViewerSessionId()) {
  const viewerPosition = getPrivateNavigationPosition();
  let bestSession = null;
  let bestDistanceSquared = Infinity;
  for (const session of state.gameSessions.values()) {
    if (!isPrivateListedLiveGameSession(session)) {
      continue;
    }
    if (
      excludeHostSessionId
      && String(session?.host_viewer_session_id ?? "").trim() === String(excludeHostSessionId ?? "").trim()
    ) {
      continue;
    }
    const hostPosition = getPrivateBrowserHostPosition(session?.host_viewer_session_id);
    if (!hostPosition) {
      continue;
    }
    const dx = viewerPosition.x - hostPosition.x;
    const dz = viewerPosition.z - hostPosition.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared > PRIVATE_BROWSER_RADIUS * PRIVATE_BROWSER_RADIUS || distanceSquared >= bestDistanceSquared) {
      continue;
    }
    bestSession = session;
    bestDistanceSquared = distanceSquared;
  }
  return bestSession;
}

function getPrivateGameShareGroupSessions(anchorSessionId = "") {
  const normalizedAnchorSessionId = String(anchorSessionId ?? "").trim();
  if (!normalizedAnchorSessionId) {
    return [];
  }
  return [...state.gameSessions.values()]
    .filter((session) =>
      (isPrivateGameOriginSession(session) && String(session?.session_id ?? "").trim() === normalizedAnchorSessionId)
      || getPrivateGameSessionAnchorSessionId(session) === normalizedAnchorSessionId)
    .sort((left, right) =>
      Number(isPrivateGameOriginSession(right)) - Number(isPrivateGameOriginSession(left))
      || Date.parse(left?.created_at ?? 0) - Date.parse(right?.created_at ?? 0)
      || String(left?.host_viewer_session_id ?? "").localeCompare(String(right?.host_viewer_session_id ?? "")));
}

function getPrivateGameShareJoinTarget() {
  const localSession = getLocalPrivateGameSession();
  if (localSession) {
    return resolvePrivateGameOriginSession(localSession);
  }
  const pendingAnchorSessionId = String(state.pendingShareJoin?.anchorSessionId ?? "").trim();
  if (pendingAnchorSessionId) {
    return state.gameSessions.get(pendingAnchorSessionId) ?? null;
  }
  return getNearbyPrivateOriginGameSession();
}

function isLocalPrivateOriginGameShareLocked() {
  const localSession = getLocalPrivateGameSession();
  return Boolean(localSession && isPrivateGameOriginSession(localSession) && (localSession?.movement_locked === true || localSession?.movementLocked === true));
}

function getLocalPrivateGameSession() {
  const viewerSessionId = getPrivateViewerSessionId();
  const browserWorldKey = state.worldSocketKey || (
    state.selectedWorld
      ? `private:${state.selectedWorld.world_id}:${String(state.selectedWorld.creator?.username ?? "").trim().toLowerCase()}`
      : ""
  );
  return [...state.gameSessions.values()].find((session) =>
    String(session?.binding_key ?? "").trim() === browserWorldKey
    && String(session?.host_viewer_session_id ?? "").trim() === viewerSessionId) ?? null;
}

function getVisiblePrivateGameSessions(query = "") {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  return [...state.gameSessions.values()]
    .filter((session) => isPrivateListedLiveGameSession(session))
    .filter((session) => {
      if (!normalizedQuery) {
        return true;
      }
      const haystack = `${getPrivateGameSessionTitle(session)} ${getPrivateGameSessionDescription(session)} ${getPrivateGameHostName(session)}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) =>
      Number(String(right?.host_viewer_session_id ?? "").trim() === getPrivateViewerSessionId())
      - Number(String(left?.host_viewer_session_id ?? "").trim() === getPrivateViewerSessionId())
      || Number(right?.started === true) - Number(left?.started === true)
      || Date.parse(right?.updated_at ?? 0) - Date.parse(left?.updated_at ?? 0)
      || getPrivateGameSessionTitle(left).localeCompare(getPrivateGameSessionTitle(right)));
}

function getSelectedPrivateWorldGame() {
  return privateGameLibrary.getSelectedGame();
}

async function openPrivateWorldGameLibrary(options = {}) {
  if (!state.session) {
    setPrivateBrowserStatus("Sign in to save or share games.");
    return;
  }
  try {
    await privateGameLibrary.open({
      selectGameId: options.selectGameId ?? state.selectedWorldGameId,
      forceRefresh: options.forceRefresh === true,
    });
  } catch (error) {
    setPrivateBrowserStatus(error?.message || "Could not open the game library.");
  }
}

async function startPrivateWorldGameShare(game = null) {
  const targetGame = game ?? getSelectedPrivateWorldGame();
  const approvedJoin = state.pendingShareJoin?.approved === true && state.pendingShareJoin?.shareKind === "game"
    ? state.pendingShareJoin
    : null;
  if (!state.session) {
    setPrivateBrowserStatus("Sign in to share games in private worlds.");
    return false;
  }
  if (!targetGame) {
    await openPrivateWorldGameLibrary();
    return true;
  }
  if (!isPrivateWorldReadyForShare()) {
    updatePrivateBrowserPanel();
    return true;
  }
  const sent = sendWorldSocketMessage({
    type: "game:start-share",
    gameId: targetGame.id,
    anchorSessionId: approvedJoin?.anchorSessionId ?? "",
  });
  if (!sent) {
    setPrivateBrowserStatus("Private world share is offline right now.");
    return false;
  }
  state.selectedWorldGameId = targetGame.id;
  state.pendingGameShareGameId = targetGame.id;
  updatePrivateBrowserPanel();
  return true;
}

function requestOpenPrivateGameSession(session = {}) {
  if (!session?.session_id) {
    return false;
  }
  privateGameShell.requestOpen(session);
  return true;
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

function getPrivateBrowserSessionRole(session = {}) {
  const explicitRole = String(session?.groupRole ?? "").trim().toLowerCase();
  if (explicitRole === "origin" || explicitRole === "member" || explicitRole === "persistent-voice") {
    return explicitRole;
  }
  if (String(session?.sessionSlot ?? "").trim().toLowerCase() === "persistent-voice") {
    return "persistent-voice";
  }
  if (String(session?.sessionMode ?? "").trim().toLowerCase() === "display-share") {
    return "origin";
  }
  return "";
}

function hasPrivatePersistentVoiceSlot(session = {}) {
  return String(session?.sessionSlot ?? "").trim().toLowerCase() === "persistent-voice"
    || String(session?.groupRole ?? "").trim().toLowerCase() === "persistent-voice";
}

function isPrivateBrowserOriginSession(session = {}) {
  return getPrivateBrowserSessionRole(session) === "origin";
}

function isPrivateBrowserMemberSession(session = {}) {
  return getPrivateBrowserSessionRole(session) === "member";
}

function isPrivatePersistentVoiceSession(session = {}) {
  return hasPrivatePersistentVoiceSlot(session);
}

function getPrivateBrowserAnchorSessionId(session = {}) {
  if (isPrivateBrowserOriginSession(session)) {
    return String(session?.sessionId ?? "").trim();
  }
  return String(session?.anchorSessionId ?? "").trim();
}

function getPrivateBrowserAnchorHostSessionId(session = {}) {
  if (isPrivateBrowserOriginSession(session)) {
    return String(session?.hostSessionId ?? "").trim();
  }
  return String(session?.anchorHostSessionId ?? "").trim();
}

function isPrivateJoinedPersistentVoiceSession(session = {}) {
  return isPrivatePersistentVoiceSession(session)
    && session?.groupJoined === true
    && Boolean(getPrivateBrowserAnchorSessionId(session));
}

function resolvePrivateOriginSession(session = {}) {
  const anchorSessionId = getPrivateBrowserAnchorSessionId(session);
  if (!anchorSessionId) {
    return null;
  }
  if (String(session?.sessionId ?? "").trim() === anchorSessionId && isPrivateBrowserOriginSession(session)) {
    return session;
  }
  return state.browserSessions.get(anchorSessionId) ?? null;
}

function isPrivateListedLiveSession(session = {}) {
  return String(session?.sessionMode ?? "").trim() === "display-share"
    && isPrivateBrowserOriginSession(session)
    && !isPrivatePersistentVoiceSession(session)
    && session?.listedLive !== false;
}

function getPrivateBrowserSpatialCenter(session = {}) {
  const anchorHostSessionId =
    isPrivateBrowserMemberSession(session) || isPrivateJoinedPersistentVoiceSession(session)
      ? getPrivateBrowserAnchorHostSessionId(session)
      : "";
  const hostSessionId = anchorHostSessionId || String(session?.hostSessionId ?? "").trim();
  return getPrivateBrowserHostPosition(hostSessionId);
}

function getNearbyPrivateOriginSession(excludeHostSessionId = getPrivateViewerSessionId()) {
  const viewerPosition = getPrivatePresencePosition();
  let bestSession = null;
  let bestDistanceSquared = Infinity;
  for (const session of state.browserSessions.values()) {
    if (!isPrivateListedLiveSession(session)) {
      continue;
    }
    if (excludeHostSessionId && String(session.hostSessionId ?? "").trim() === String(excludeHostSessionId ?? "").trim()) {
      continue;
    }
    const hostPosition = getPrivateBrowserHostPosition(session.hostSessionId);
    if (!hostPosition) {
      continue;
    }
    const dx = viewerPosition.x - hostPosition.x;
    const dz = viewerPosition.z - hostPosition.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared > PRIVATE_BROWSER_RADIUS * PRIVATE_BROWSER_RADIUS || distanceSquared >= bestDistanceSquared) {
      continue;
    }
    bestSession = session;
    bestDistanceSquared = distanceSquared;
  }
  return bestSession;
}

function getPrivateShareGroupSessions(anchorSessionId = "") {
  const normalizedAnchorSessionId = String(anchorSessionId ?? "").trim();
  if (!normalizedAnchorSessionId) {
    return [];
  }
  return [...state.browserSessions.values()]
    .filter((session) =>
      (isPrivateBrowserOriginSession(session) && String(session.sessionId ?? "").trim() === normalizedAnchorSessionId)
      || getPrivateBrowserAnchorSessionId(session) === normalizedAnchorSessionId)
    .sort((left, right) =>
      Number(isPrivateBrowserOriginSession(right)) - Number(isPrivateBrowserOriginSession(left))
      || Date.parse(left.startedAt ?? 0) - Date.parse(right.startedAt ?? 0)
      || String(left.hostSessionId ?? "").localeCompare(String(right.hostSessionId ?? "")));
}

function getPrivateShareJoinTarget() {
  const localSession = getLocalPrivateBrowserSession();
  if (localSession) {
    return resolvePrivateOriginSession(localSession);
  }
  const pendingAnchorSessionId = String(state.pendingShareJoin?.anchorSessionId ?? "").trim();
  if (pendingAnchorSessionId) {
    return state.browserSessions.get(pendingAnchorSessionId) ?? null;
  }
  return getNearbyPrivateOriginSession();
}

function isPrivateOriginShareLocked() {
  const localSession = getLocalPrivateBrowserSession();
  if (localSession && isPrivateBrowserOriginSession(localSession) && localSession.movementLocked === true) {
    return true;
  }
  return isLocalPrivateOriginGameShareLocked();
}

function getPrivateLiveShareSessions(query = "") {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  return [...state.browserSessions.values()]
    .filter((session) => isPrivateListedLiveSession(session))
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
  const allBrowserSessions = getPrivateLiveShareSessions("");
  const filteredBrowserSessions = query.trim() ? getPrivateLiveShareSessions(query) : allBrowserSessions;
  const allGameSessions = getVisiblePrivateGameSessions("");
  const filteredGameSessions = query.trim() ? getVisiblePrivateGameSessions(query) : allGameSessions;
  const totalSessions = allBrowserSessions.length + allGameSessions.length;
  const totalFiltered = filteredBrowserSessions.length + filteredGameSessions.length;

  if (totalSessions === 0) {
    elements.panelLiveStatus.textContent = "No live shares right now.";
    elements.panelLiveResults.innerHTML = "";
    return;
  }

  if (totalFiltered === 0) {
    elements.panelLiveStatus.textContent = "No live shares match that title.";
    elements.panelLiveResults.innerHTML = "";
    return;
  }

  elements.panelLiveStatus.textContent = query.trim()
    ? `${totalFiltered} matching live ${totalFiltered === 1 ? "share" : "shares"}`
    : `${totalFiltered} live ${totalFiltered === 1 ? "share" : "shares"}`;

  const browserMarkup = filteredBrowserSessions.map((session) => {
    const title = getPrivateBrowserSessionTitle(session);
    const shareKindLabel = getBrowserShareKindLabel(session.shareKind || "screen");
    const viewerCount = Math.min(getPrivateBrowserSessionViewerCount(session), getPrivateBrowserSessionMaxViewers(session));
    const maxViewers = getPrivateBrowserSessionMaxViewers(session);
    const contributorCount = Math.max(0, getPrivateShareGroupSessions(session.sessionId).filter((entry) => isPrivateBrowserMemberSession(entry)).length);
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
          ${contributorCount > 0 ? `<span>${contributorCount} contributor${contributorCount === 1 ? "" : "s"}</span>` : ""}
        </div>
      </button>
    `;
  }).join("");
  const gameMarkup = filteredGameSessions.map((session) => {
    const title = getPrivateGameSessionTitle(session);
    const playerCount = normalizePrivateGameSeats(session).filter((seat) => seat.viewer_session_id).length;
    const maxPlayers = getPrivateGameSeatCapacity(session);
    const contributorCount = Math.max(0, getPrivateGameShareGroupSessions(session.session_id).filter((entry) => isPrivateGameMemberSession(entry)).length);
    return `
      <button
        class="world-live-result"
        type="button"
        data-private-live-game-session-id="${htmlEscape(session.session_id)}"
      >
        <div class="world-live-result__top">
          <div class="world-live-result__title">${htmlEscape(title)}</div>
          <div class="world-live-result__count">${playerCount}/${maxPlayers} seats</div>
        </div>
        <div class="world-live-result__meta">
          <span class="world-live-result__badge">Game</span>
          <span>${htmlEscape(getPrivateGameHostName(session))} is hosting now.</span>
          <span>${htmlEscape(session.started ? "Match live" : "Lobby open")}</span>
          ${contributorCount > 0 ? `<span>${contributorCount} contributor${contributorCount === 1 ? "" : "s"}</span>` : ""}
        </div>
      </button>
    `;
  }).join("");

  elements.panelLiveResults.innerHTML = `${browserMarkup}${gameMarkup}`;

  for (const button of elements.panelLiveResults.querySelectorAll("[data-private-live-session-id]")) {
    button.addEventListener("click", () => {
      focusPrivateLiveShare(button.getAttribute("data-private-live-session-id"));
    });
  }
  for (const button of elements.panelLiveResults.querySelectorAll("[data-private-live-game-session-id]")) {
    button.addEventListener("click", () => {
      const session = state.gameSessions.get(button.getAttribute("data-private-live-game-session-id"));
      if (session) {
        requestOpenPrivateGameSession(session);
      }
    });
  }
}

function renderPrivateShare() {
  if (!elements.panelShareStatus) {
    return;
  }
  const world = state.selectedWorld;
  const isActive = Boolean(world?.active_instance);
  const canShare = Boolean(world);
  const canCopy = canShare && canCopyToClipboard();
  if (elements.panelShareCopy) {
    elements.panelShareCopy.disabled = !canCopy;
  }
  if (elements.panelShareNative) {
    elements.panelShareNative.disabled = !canShare || (
      typeof navigator.share !== "function"
      && !canCopy
    );
  }
  elements.panelShareStatus.textContent = !world
    ? "Open a world to copy its entry link."
    : isActive
      ? "Copy or share the direct entry link for this active private world."
      : "This world is inactive, but the entry link still resolves it for signed-in access.";
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
  if (!elements.runtimeStatus) {
    return;
  }
  const instance = state.selectedWorld?.active_instance;
  if (!instance) {
    elements.runtimeStatus.innerHTML = "<div class=\"pw-world-meta__row\"><strong>Instance</strong><span>Inactive</span></div>";
    return;
  }
  const world = state.selectedWorld;
  const participants = instance.participants ?? [];
  const runtime = state.runtimeSnapshot ?? instance.runtime ?? null;
  const runtimePlayers = runtime?.players ?? [];
  const runtimeObjects = runtime?.dynamic_objects ?? [];
  const defaultScene = getDefaultScene(world);
  const localParticipant = getLocalParticipant(world);
  elements.runtimeStatus.innerHTML = `
    <div class="pw-world-meta__row">
      <strong>Status</strong>
      <span>${htmlEscape(runtime?.status || instance.status)} · scene ${htmlEscape(runtime?.scene_name || instance.active_scene_name || defaultScene?.name || "unknown")}</span>
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
      <span>${localParticipant?.join_role === "player"
        ? "You are inside a player. Ready Up marks this player as prepared, and Leave Player returns to viewer mode."
        : "Viewers can walk around immediately. Click a player capsule to inhabit it, then Ready Up appears for that player."}</span>
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
  const hadAiDialogOpen = state.aiDialog.open;
  syncRuntimeFromWorld(world);
  if (!world) {
    writeBuilderSelection([]);
    state.sceneDrawerOpen = false;
    state.sceneDrawerFocusId = "";
    state.launcherTab = getPreferredLauncherTab();
    state.aiDialog = createEmptyAiDialogState();
    if (hadAiDialogOpen) {
      updateShellState();
    }
  }
  if (state.mode === "build" && !isEditor()) {
    state.mode = "play";
  }
  syncSceneDrawerFocusScene(world);
  if (elements.panelTitle) {
    elements.panelTitle.textContent = world?.name || "No world selected";
  }
  if (elements.panelSubtitle) {
    elements.panelSubtitle.textContent = world
      ? `${world.creator.username} · ${world.world_type}${world.active_instance ? ` · ${world.active_instance.status}` : ""}`
      : "Open or create a world to enter the scene.";
  }
  settleHorizontalScroll(elements.panelRoot);
  renderWorldMeta();
  renderSceneLibrary();
  renderSceneDrawerTabs();
  renderSceneDrawerSceneIndicator();
  renderSceneEditor();
  renderAssetsLibrary();
  renderCollaborators();
  renderPrivateShare();
  updatePrivateBrowserPanel();
  renderAiDialog();

  const hasWorld = Boolean(world);
  const canEdit = isEditor();
  const localParticipant = getLocalParticipant(world);
  if (elements.panelModeLabel) {
    elements.panelModeLabel.textContent = !hasWorld
      ? "No world open"
      : state.mode === "build"
        ? "Build mode"
        : "Play mode";
  }
  if (elements.panelModeNote) {
    elements.panelModeNote.textContent = !hasWorld
      ? "Open a world to switch modes."
      : state.mode === "build"
        ? "Place and edit things here. Physics is paused. Hold Q/E/R, then 1 red X, 2 blue Z, 3 green Y."
        : "Walk the scene here. Physics and scripts run live.";
  }
  if (elements.sceneModeBadge) {
    const badgeMode = !hasWorld ? "none" : state.mode;
    elements.sceneModeBadge.dataset.mode = badgeMode;
    elements.sceneModeBadge.hidden = false;
  }
  if (elements.sceneModeBadgeLabel) {
    elements.sceneModeBadgeLabel.textContent = !hasWorld
      ? "No world"
      : state.mode === "build"
        ? "Build"
        : "Play";
  }
  state.joined = Boolean(localParticipant);
  state.joinedAsGuest = !state.session && localParticipant?.join_role === "guest";
  const joinedAsPlayer = localParticipant?.join_role === "player";
  const showEnterControl = hasWorld && Boolean(state.session) && !localParticipant;
  const showLeaveControl = hasWorld && Boolean(localParticipant) && !joinedAsPlayer;
  const showReadyControl = hasWorld && state.session && joinedAsPlayer;
  const showReleaseControl = hasWorld && state.session && joinedAsPlayer;
  const showResetControl = hasWorld && canEdit;
  const readyLabel = localParticipant?.ready === true ? "Not Ready" : "Ready Up";
  if (!hasWorld) {
    state.privatePanelTab = "chat";
  } else {
    state.privatePanelTab = normalizePrivatePanelTab(state.privatePanelTab);
  }
  renderSessionSummary();
  for (const button of elements.privatePanelTabButtons ?? []) {
    button.disabled = !hasWorld;
  }
  if (elements.sceneToolsToggle) {
    elements.sceneToolsToggle.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }
  for (const button of elements.sceneAddButtons ?? []) {
    button.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }
  elements.saveCollaborator.disabled = !hasWorld || !canEdit;
  elements.generateHtml.disabled = !hasWorld || !state.session;
  elements.generateScript.disabled = !hasWorld || !state.session;
  if (elements.assetGenerateTexture) {
    elements.assetGenerateTexture.disabled = !hasWorld || !state.session || !canEdit || state.mode !== "build";
  }
  if (elements.assetGenerateModel) {
    elements.assetGenerateModel.disabled = !hasWorld || !state.session || !canEdit || state.mode !== "build";
  }
  for (const button of elements.worldSectionJumpButtons ?? []) {
    button.disabled = !hasWorld;
  }
  renderWorldPanelSections();
  refreshAiBuilderStatus();
  if (elements.panelModeBuild) {
    elements.panelModeBuild.disabled = !hasWorld || !canEdit;
    elements.panelModeBuild.classList.toggle("is-active", state.mode === "build");
  }
  if (elements.panelModePlay) {
    elements.panelModePlay.disabled = !hasWorld;
    elements.panelModePlay.classList.toggle("is-active", state.mode === "play");
  }
  if (elements.buildScenePicker) {
    const showBuildScenePicker = hasWorld && canEdit && state.mode === "build";
    elements.buildScenePicker.hidden = !showBuildScenePicker;
  }
  if (elements.buildSceneSelect) {
    const scenes = state.selectedWorld?.scenes ?? [];
    const showBuildScenePicker = hasWorld && canEdit && state.mode === "build";
    if (!showBuildScenePicker) {
      elements.buildSceneSelect.innerHTML = "";
      elements.buildSceneSelect.disabled = true;
    } else if (!scenes.length) {
      elements.buildSceneSelect.innerHTML = '<option value="">No scenes yet</option>';
      elements.buildSceneSelect.disabled = true;
    } else {
      elements.buildSceneSelect.innerHTML = scenes.map((scene) => `
        <option value="${htmlEscape(scene.id)}" ${scene.id === state.selectedSceneId ? "selected" : ""}>
          ${htmlEscape(buildQuickSceneOptionLabel(scene))}
        </option>
      `).join("");
      elements.buildSceneSelect.disabled = scenes.length <= 1;
    }
  }
  if (elements.panelLibrary) {
    elements.panelLibrary.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }
  if (elements.panelExport) {
    elements.panelExport.disabled = !hasWorld || !state.session;
  }
  if (elements.panelEnter) {
    elements.panelEnter.hidden = !showEnterControl;
    elements.panelEnter.disabled = !showEnterControl;
  }
  if (elements.panelLeave) {
    elements.panelLeave.hidden = !showLeaveControl;
    elements.panelLeave.disabled = !showLeaveControl;
  }
  if (elements.panelReady) {
    elements.panelReady.hidden = !showReadyControl;
    elements.panelReady.disabled = !showReadyControl;
    elements.panelReady.textContent = readyLabel;
  }
  if (elements.panelRelease) {
    elements.panelRelease.hidden = !showReleaseControl;
    elements.panelRelease.disabled = !showReleaseControl;
  }
  if (elements.panelReset) {
    elements.panelReset.hidden = !showResetControl;
    elements.panelReset.disabled = !showResetControl;
  }
  if (elements.panelRuntimeActions) {
    elements.panelRuntimeActions.hidden =
      !showEnterControl
      && !showLeaveControl
      && !showReadyControl
      && !showReleaseControl
      && !showResetControl;
  }
  if (elements.readyToggle) {
    elements.readyToggle.hidden = !showReadyControl;
    elements.readyToggle.disabled = !showReadyControl;
    elements.readyToggle.textContent = readyLabel;
  }
  if (elements.releasePlayer) {
    elements.releasePlayer.hidden = !showReleaseControl;
    elements.releasePlayer.disabled = !showReleaseControl;
  }
  if (elements.resetScene) {
    elements.resetScene.hidden = !showResetControl;
    elements.resetScene.disabled = !showResetControl;
  }
  if (elements.panelShareCopy) {
    elements.panelShareCopy.disabled = !hasWorld || !canCopyToClipboard();
  }
  if (elements.panelShareNative) {
    elements.panelShareNative.disabled = !hasWorld || (
      typeof navigator.share !== "function"
      && !canCopyToClipboard()
    );
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
    if (!button) {
      continue;
    }
    button.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }

  if (elements.removeEntity) {
    elements.removeEntity.disabled = !hasWorld || !canEdit || state.mode !== "build" || !hasBuilderSelection();
  }
  if (elements.convertPrefab) {
    const selectionKind = state.builderSelection?.kind || "";
    const hasSingleSelection = getBuilderSelectionRefs().length === 1;
    elements.convertPrefab.disabled = !hasWorld || !canEdit || state.mode !== "build" || !hasSingleSelection || selectionKind === "particle" || selectionKind === "prefab_instance";
  }
  if (elements.placePrefab) {
    elements.placePrefab.disabled = !hasWorld || !canEdit || state.mode !== "build" || !state.selectedPrefabId;
    elements.placePrefab.classList.toggle("is-active", Boolean(state.prefabPlacementId) && state.prefabPlacementId === state.selectedPrefabId);
    elements.placePrefab.textContent = state.prefabPlacementId && state.prefabPlacementId === state.selectedPrefabId
      ? "Cancel world placement"
      : "Use in world";
  }

  setMode(state.mode, { syncPanelTab: false });
  updateShellState();
  updatePreviewFromSelection();
  renderPrivateChat();
  updatePrivateBrowserPanel();
}

function snapBuildValue(value, step = 0.1) {
  const safeStep = Math.max(0.01, Number(step) || 0.1);
  return Math.round((Number(value) || 0) / safeStep) * safeStep;
}

function roundPrivateValue(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

function getPrivateVoxelScale(scale = {}) {
  return {
    x: Math.max(0.1, Number(scale?.x ?? PRIVATE_WORLD_BLOCK_UNIT) || PRIVATE_WORLD_BLOCK_UNIT),
    y: Math.max(0.1, Number(scale?.y ?? PRIVATE_WORLD_BLOCK_UNIT) || PRIVATE_WORLD_BLOCK_UNIT),
    z: Math.max(0.1, Number(scale?.z ?? PRIVATE_WORLD_BLOCK_UNIT) || PRIVATE_WORLD_BLOCK_UNIT),
  };
}

function getHalfExtentsFromScale(scale = {}) {
  return {
    x: Math.max(0.05, Number(scale?.x ?? 0) / 2),
    y: Math.max(0.05, Number(scale?.y ?? 0) / 2),
    z: Math.max(0.05, Number(scale?.z ?? 0) / 2),
  };
}

function clampVoxelCenterToBounds(value, size, axis, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minEdge = axis === "x" ? bounds.minX : bounds.minZ;
  const maxEdge = axis === "x" ? bounds.maxX : bounds.maxZ;
  const minCenter = minEdge + size / 2;
  const maxCenter = maxEdge - size / 2;
  return clampNumber(value, value, minCenter, Math.max(minCenter, maxCenter));
}

function snapVoxelAxisToGrid(value, size, axis, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minEdge = axis === "x" ? bounds.minX : bounds.minZ;
  const snapped = minEdge + size / 2 + Math.round(((Number(value) || 0) - minEdge - size / 2) / size) * size;
  return roundPrivateValue(clampVoxelCenterToBounds(snapped, size, axis, world));
}

function snapVoxelElevationToGrid(value, size, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minCenter = size / 2;
  const maxCenter = Math.max(minCenter, bounds.height - size / 2);
  const snapped = minCenter + Math.round(((Number(value) || 0) - minCenter) / size) * size;
  return roundPrivateValue(clampNumber(snapped, snapped, minCenter, maxCenter));
}

function snapVoxelPositionToGrid(position = {}, scale = {}, world = state.selectedWorld) {
  const voxelScale = getPrivateVoxelScale(scale);
  return {
    x: snapVoxelAxisToGrid(position.x, voxelScale.x, "x", world),
    y: snapVoxelElevationToGrid(position.y, voxelScale.y, world),
    z: snapVoxelAxisToGrid(position.z, voxelScale.z, "z", world),
  };
}

function boxesTouchOrOverlap(leftPosition = {}, leftScale = {}, rightPosition = {}, rightScale = {}) {
  const leftHalf = getHalfExtentsFromScale(leftScale);
  const rightHalf = getHalfExtentsFromScale(rightScale);
  const epsilon = 0.0001;
  return (
    Math.abs((leftPosition.x ?? 0) - (rightPosition.x ?? 0)) < leftHalf.x + rightHalf.x - epsilon
    && Math.abs((leftPosition.y ?? 0) - (rightPosition.y ?? 0)) < leftHalf.y + rightHalf.y - epsilon
    && Math.abs((leftPosition.z ?? 0) - (rightPosition.z ?? 0)) < leftHalf.z + rightHalf.z - epsilon
  );
}

function isVoxelPlacementOccupied(sceneDoc, position, scale, ignoreId = "") {
  return (sceneDoc?.voxels ?? []).some((voxel) => (
    voxel?.id !== ignoreId
    && boxesTouchOrOverlap(position, scale, voxel.position ?? {}, voxel.scale ?? {})
  ));
}

function buildVoxelAxisCandidates(size, axis, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minEdge = axis === "x" ? bounds.minX : bounds.minZ;
  const maxEdge = axis === "x" ? bounds.maxX : bounds.maxZ;
  const candidates = [];
  for (let cursor = minEdge + size / 2; cursor <= maxEdge - size / 2 + 0.0001; cursor += size) {
    candidates.push(roundPrivateValue(cursor));
  }
  return candidates.sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
}

function getDefaultVoxelPlacement(sceneDoc, world = state.selectedWorld) {
  const scale = {
    x: PRIVATE_WORLD_BLOCK_UNIT,
    y: PRIVATE_WORLD_BLOCK_UNIT,
    z: PRIVATE_WORLD_BLOCK_UNIT,
  };
  const selected = getSelectedEntity(sceneDoc);
  if (selected?.kind === "voxel" && selected.entry?.position) {
    const anchorScale = getPrivateVoxelScale(selected.entry.scale);
    const anchorPosition = selected.entry.position;
    const adjacentCandidates = [
      {
        x: anchorPosition.x,
        y: anchorPosition.y + (anchorScale.y + scale.y) / 2,
        z: anchorPosition.z,
      },
      {
        x: anchorPosition.x + (anchorScale.x + scale.x) / 2,
        y: anchorPosition.y,
        z: anchorPosition.z,
      },
      {
        x: anchorPosition.x - (anchorScale.x + scale.x) / 2,
        y: anchorPosition.y,
        z: anchorPosition.z,
      },
      {
        x: anchorPosition.x,
        y: anchorPosition.y,
        z: anchorPosition.z + (anchorScale.z + scale.z) / 2,
      },
      {
        x: anchorPosition.x,
        y: anchorPosition.y,
        z: anchorPosition.z - (anchorScale.z + scale.z) / 2,
      },
    ]
      .map((candidate) => snapVoxelPositionToGrid(candidate, scale, world))
      .filter((candidate) => !isVoxelPlacementOccupied(sceneDoc, candidate, scale));
    if (adjacentCandidates.length > 0) {
      return adjacentCandidates[0];
    }
  }

  const xCandidates = buildVoxelAxisCandidates(scale.x, "x", world);
  const zCandidates = buildVoxelAxisCandidates(scale.z, "z", world);
  const groundY = snapVoxelElevationToGrid(scale.y / 2, scale.y, world);
  for (const z of zCandidates) {
    for (const x of xCandidates) {
      const candidate = { x, y: groundY, z };
      if (!isVoxelPlacementOccupied(sceneDoc, candidate, scale)) {
        return candidate;
      }
    }
  }
  return {
    x: snapVoxelAxisToGrid(0, scale.x, "x", world),
    y: groundY,
    z: snapVoxelAxisToGrid(0, scale.z, "z", world),
  };
}

function snapPlacementAxisToBlockGrid(value, axis, size = PRIVATE_WORLD_BLOCK_UNIT, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minEdge = axis === "x" ? bounds.minX : bounds.minZ;
  const maxEdge = axis === "x" ? bounds.maxX : bounds.maxZ;
  const blockCenter = minEdge
    + PRIVATE_WORLD_BLOCK_UNIT / 2
    + Math.round(((Number(value) || 0) - minEdge - PRIVATE_WORLD_BLOCK_UNIT / 2) / PRIVATE_WORLD_BLOCK_UNIT) * PRIVATE_WORLD_BLOCK_UNIT;
  const minCenter = minEdge + size / 2;
  const maxCenter = maxEdge - size / 2;
  return roundPrivateValue(clampNumber(blockCenter, blockCenter, minCenter, Math.max(minCenter, maxCenter)));
}

function clampPlacementCenterY(value, size, world = state.selectedWorld) {
  const bounds = getPrivateWorldBounds(world);
  const minCenter = size / 2;
  const maxCenter = Math.max(minCenter, bounds.height - size / 2);
  return roundPrivateValue(clampNumber(Number(value) || minCenter, value, minCenter, maxCenter));
}

function getToolPlacementDimensions(kind) {
  if (kind === "voxel") {
    return { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT };
  }
  if (kind === "primitive") {
    const presetEntry = getPrimitivePlacementPresetEntry();
    if (isPrimitivePanelShape(presetEntry)) {
      return getPrimitivePanelDimensions(presetEntry);
    }
    return { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT };
  }
  if (kind === "panel") {
    return { x: 4, y: 2.25, z: 0.1 };
  }
  if (kind === "player") {
    return {
      x: PRIVATE_PLAYER_METRICS.width * PRIVATE_PLAYER_DEFAULT_SCALE,
      y: PRIVATE_PLAYER_METRICS.height * PRIVATE_PLAYER_DEFAULT_SCALE,
      z: PRIVATE_PLAYER_METRICS.width * PRIVATE_PLAYER_DEFAULT_SCALE,
    };
  }
  if (kind === "screen") {
    return { x: 4, y: 2.25, z: 0.2 };
  }
  if (kind === "text") {
    return { x: PRIVATE_WORLD_BLOCK_UNIT, y: 3, z: PRIVATE_WORLD_BLOCK_UNIT };
  }
  if (kind === "trigger") {
    return { x: 2, y: 2, z: 2 };
  }
  return { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT };
}

function getToolPlacementCenterYOffset(kind, supportTopY = 0) {
  const dimensions = getToolPlacementDimensions(kind);
  if (kind === "text") {
    return clampPlacementCenterY(supportTopY + dimensions.y, dimensions.y);
  }
  if (kind === "trigger") {
    return clampPlacementCenterY(supportTopY + 0.5, dimensions.y);
  }
  return clampPlacementCenterY(supportTopY + dimensions.y / 2, dimensions.y);
}

function getPrefabPlacementProfile(prefabId = state.selectedPrefabId) {
  const prefab = getSelectedPrefabEntry(prefabId);
  if (!prefab) {
    return null;
  }
  const bounds = getPrefabDocBounds(prefab.prefab_doc ?? {});
  if (!bounds) {
    return {
      prefab,
      bounds: new THREE.Box3(
        new THREE.Vector3(-PRIVATE_WORLD_BLOCK_UNIT / 2, 0, -PRIVATE_WORLD_BLOCK_UNIT / 2),
        new THREE.Vector3(PRIVATE_WORLD_BLOCK_UNIT / 2, PRIVATE_WORLD_BLOCK_UNIT, PRIVATE_WORLD_BLOCK_UNIT / 2),
      ),
    };
  }
  return { prefab, bounds };
}

function resolvePrefabPlacementPreview(prefabId, sceneDoc, context) {
  if (!prefabId || !context || !state.selectedWorld) {
    return null;
  }
  const profile = getPrefabPlacementProfile(prefabId);
  if (!profile) {
    return null;
  }
  const gridCell = resolveBuildGridCell(context);
  if (!gridCell) {
    return null;
  }
  const dimensions = profile.bounds.getSize(new THREE.Vector3());
  const localCenter = profile.bounds.getCenter(new THREE.Vector3());
  let supportTopY = 0;
  const dominantNormal = getDominantHitNormal(context.hit);
  if (context.hit?.object && dominantNormal?.y > 0) {
    const hitBounds = new THREE.Box3().setFromObject(context.hit.object);
    supportTopY = Number(hitBounds.max.y ?? 0) || 0;
  }
  const worldCenter = {
    x: snapPlacementAxisToBlockGrid(gridCell.x, "x", Math.max(0.2, dimensions.x)),
    y: clampPlacementCenterY(supportTopY + Math.max(0.2, dimensions.y) / 2, Math.max(0.2, dimensions.y)),
    z: snapPlacementAxisToBlockGrid(gridCell.z, "z", Math.max(0.2, dimensions.z)),
  };
  const position = {
    x: roundPrivateValue(worldCenter.x - localCenter.x),
    y: roundPrivateValue(worldCenter.y - localCenter.y),
    z: roundPrivateValue(worldCenter.z - localCenter.z),
  };
  return {
    kind: "prefab",
    prefabId,
    label: profile.prefab.name || "Prefab",
    key: `prefab:${prefabId}:${position.x}:${position.y}:${position.z}`,
    position,
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: {
      x: Math.max(0.2, dimensions.x),
      y: Math.max(0.2, dimensions.y),
      z: Math.max(0.2, dimensions.z),
    },
    valid: true,
    supportTopY,
  };
}

function getScreenTextureRenderSize(screen = {}) {
  const baseWidth = 1024;
  const baseHeight = 576;
  const baseAspect = baseWidth / baseHeight;
  const scaleX = Math.max(0.1, Number(screen.scale?.x ?? 4) || 4);
  const scaleY = Math.max(0.1, Number(screen.scale?.y ?? 2.25) || 2.25);
  const aspect = scaleX / Math.max(0.1, scaleY);
  let width = baseWidth;
  let height = baseHeight;
  if (aspect > baseAspect) {
    width = Math.round(baseHeight * aspect);
  } else if (aspect < baseAspect) {
    height = Math.round(baseWidth / Math.max(0.1, aspect));
  }
  const maxDimension = 2048;
  const scaleDown = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(384, Math.round(width * scaleDown)),
    height: Math.max(256, Math.round(height * scaleDown)),
  };
}

function getDominantHitNormal(hit) {
  if (!hit?.face?.normal || !hit?.object) {
    return null;
  }
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const absoluteX = Math.abs(normal.x);
  const absoluteY = Math.abs(normal.y);
  const absoluteZ = Math.abs(normal.z);
  if (absoluteX >= absoluteY && absoluteX >= absoluteZ) {
    return new THREE.Vector3(Math.sign(normal.x) || 1, 0, 0);
  }
  if (absoluteY >= absoluteX && absoluteY >= absoluteZ) {
    return new THREE.Vector3(0, Math.sign(normal.y) || 1, 0);
  }
  return new THREE.Vector3(0, 0, Math.sign(normal.z) || 1);
}

function getPreviewPointerContext(pointerSource) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  if (!metrics) {
    return null;
  }
  const { preview, pointer } = metrics;
  preview.raycaster.setFromCamera(pointer, preview.camera);
  const hit = getFirstPreviewEntityHit(preview.raycaster.intersectObjects(preview.entityPickables, false));
  const groundPoint = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hasGround = preview.raycaster.ray.intersectPlane(groundPlane, groundPoint);
  return {
    preview,
    hit,
    groundPoint: hasGround ? groundPoint.clone() : null,
  };
}

function getFirstPreviewEntityHit(intersections = []) {
  const buildMode = state.mode === "build" && isEditor();
  for (const hit of intersections) {
    if (!hit?.object) {
      continue;
    }
    if (hit.object.userData?.privateWorldBuildOnly && !buildMode) {
      continue;
    }
    return hit;
  }
  return null;
}

function resolveBuildGridCell(context) {
  if (!context?.groundPoint || !state.selectedWorld) {
    return null;
  }
  return {
    x: snapPlacementAxisToBlockGrid(context.groundPoint.x, "x"),
    y: 0.06,
    z: snapPlacementAxisToBlockGrid(context.groundPoint.z, "z"),
  };
}

function resolvePlacementPreview(kind, sceneDoc, context) {
  if (!isPlacementToolKind(kind) || !context || !state.selectedWorld) {
    return null;
  }
  const dimensions = getToolPlacementDimensions(kind);
  const primitivePresetEntry = kind === "primitive" ? getPrimitivePlacementPresetEntry() : null;
  if (kind === "voxel") {
    const dominantNormal = getDominantHitNormal(context.hit);
    let position = null;
    if (dominantNormal) {
      position = snapVoxelPositionToGrid({
        x: context.hit.point.x + dominantNormal.x * (dimensions.x / 2 + 0.05),
        y: context.hit.point.y + dominantNormal.y * (dimensions.y / 2 + 0.05),
        z: context.hit.point.z + dominantNormal.z * (dimensions.z / 2 + 0.05),
      }, dimensions, state.selectedWorld);
    } else if (context.groundPoint) {
      position = snapVoxelPositionToGrid({
        x: context.groundPoint.x,
        y: dimensions.y / 2,
        z: context.groundPoint.z,
      }, dimensions, state.selectedWorld);
    }
    if (!position) {
      return null;
    }
    const occupied = isVoxelPlacementOccupied(sceneDoc, position, dimensions);
    return {
      kind,
      key: `${kind}:${position.x}:${position.y}:${position.z}`,
      position,
      rotation: { x: 0, y: 0, z: 0 },
      dimensions,
      valid: !occupied,
      supportTopY: position.y - dimensions.y / 2,
    };
  }

  const gridCell = resolveBuildGridCell(context);
  if (!gridCell) {
    return null;
  }
  let supportTopY = 0;
  const dominantNormal = getDominantHitNormal(context.hit);
  if (context.hit?.object && dominantNormal?.y > 0) {
    const bounds = new THREE.Box3().setFromObject(context.hit.object);
    supportTopY = Number(bounds.max.y ?? 0) || 0;
  }
  const position = {
    x: snapPlacementAxisToBlockGrid(gridCell.x, "x", dimensions.x),
    y: getToolPlacementCenterYOffset(kind, supportTopY),
    z: snapPlacementAxisToBlockGrid(gridCell.z, "z", dimensions.z),
  };
  return {
    kind,
    key: `${kind}:${position.x}:${position.y}:${position.z}`,
    position,
    rotation: { x: 0, y: 0, z: 0 },
    dimensions,
    shape: primitivePresetEntry?.shape || "",
    valid: true,
    supportTopY,
  };
}

function getEntityRefFromHit(hit) {
  return createEntityRef(
    hit?.object?.userData?.privateWorldEntityKind,
    hit?.object?.userData?.privateWorldEntityId,
  );
}

function canMoveEntityKind(kind) {
  return kind === "voxel"
    || kind === "primitive"
    || kind === "panel"
    || kind === "player"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "particle"
    || kind === "prefab_instance";
}

function canScaleEntityKind(kind) {
  return kind === "primitive"
    || kind === "panel"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "particle"
    || kind === "prefab_instance";
}

function canRotateEntityKind(kind) {
  return kind === "primitive"
    || kind === "panel"
    || kind === "player"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "particle"
    || kind === "prefab_instance";
}

function canAxisScaleEntity(selection) {
  return Boolean(selection && canScaleEntityKind(selection.kind) && typeof selection.entry?.scale === "object");
}

function canGroupScaleRotateSelection(selections = []) {
  return Array.isArray(selections)
    && selections.length > 1
    && selections.every((selection) => canScaleEntityKind(selection.kind) && canRotateEntityKind(selection.kind));
}

function canScaleSelection(selections = []) {
  if (!Array.isArray(selections) || !selections.length) {
    return false;
  }
  if (selections.length === 1) {
    return canScaleEntityKind(selections[0].kind);
  }
  return canGroupScaleRotateSelection(selections);
}

function canRotateSelection(selections = []) {
  if (!Array.isArray(selections) || !selections.length) {
    return false;
  }
  if (selections.length === 1) {
    return canRotateEntityKind(selections[0].kind);
  }
  return canGroupScaleRotateSelection(selections);
}

function canAxisScaleSelection(selections = []) {
  return Array.isArray(selections)
    && selections.length > 0
    && selections.every((selection) => canAxisScaleEntity(selection));
}

function getBaseBuildAxisVector(axis) {
  if (axis === "x") {
    return new THREE.Vector3(1, 0, 0);
  }
  if (axis === "y") {
    return new THREE.Vector3(0, 1, 0);
  }
  return new THREE.Vector3(0, 0, 1);
}

function getOverlayBoundsForRefs(preview, refs = []) {
  if (!preview || !refs.length) {
    return null;
  }
  const box = new THREE.Box3();
  let hasBounds = false;
  for (const ref of refs) {
    const mesh = preview.entityMeshes.get(ref.id);
    if (!mesh) {
      continue;
    }
    mesh.updateWorldMatrix(true, true);
    const nextBox = new THREE.Box3().setFromObject(mesh);
    if (!Number.isFinite(nextBox.min.x) || !Number.isFinite(nextBox.max.x)) {
      continue;
    }
    if (!hasBounds) {
      box.copy(nextBox);
      hasBounds = true;
    } else {
      box.union(nextBox);
    }
  }
  return hasBounds ? box : null;
}

function getObjectLocalBounds(object) {
  if (!object) {
    return null;
  }
  object.updateWorldMatrix(true, true);
  const inverseWorld = object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  let hasBounds = false;
  object.traverse((node) => {
    if (!node?.geometry) {
      return;
    }
    const geometry = node.geometry;
    geometry.computeBoundingBox?.();
    if (!geometry.boundingBox) {
      return;
    }
    const localMatrix = new THREE.Matrix4().copy(inverseWorld).multiply(node.matrixWorld);
    const nextBox = geometry.boundingBox.clone().applyMatrix4(localMatrix);
    if (!Number.isFinite(nextBox.min.x) || !Number.isFinite(nextBox.max.x)) {
      return;
    }
    if (!hasBounds) {
      box.copy(nextBox);
      hasBounds = true;
    } else {
      box.union(nextBox);
    }
  });
  return hasBounds ? box : null;
}

function createOverlayFrame(center, size, quaternion = new THREE.Quaternion(), oriented = false) {
  return {
    center,
    size: new THREE.Vector3(
      Math.max(0.12, Number(size?.x ?? 0.12) || 0.12),
      Math.max(0.12, Number(size?.y ?? 0.12) || 0.12),
      Math.max(0.12, Number(size?.z ?? 0.12) || 0.12),
    ),
    quaternion,
    oriented,
  };
}

function getOverlayFrameFromBox(box) {
  if (!box) {
    return null;
  }
  return createOverlayFrame(
    box.getCenter(new THREE.Vector3()),
    box.getSize(new THREE.Vector3()),
    new THREE.Quaternion(),
    false,
  );
}

function getOverlayFrameForObject(object) {
  if (!object) {
    return null;
  }
  const localBounds = getObjectLocalBounds(object);
  if (!localBounds) {
    return null;
  }
  const worldScale = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  object.getWorldScale(worldScale);
  object.getWorldQuaternion(worldQuaternion);
  const localSize = localBounds.getSize(new THREE.Vector3());
  const worldSize = new THREE.Vector3(
    Math.abs(localSize.x * worldScale.x),
    Math.abs(localSize.y * worldScale.y),
    Math.abs(localSize.z * worldScale.z),
  );
  const worldCenter = localBounds.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
  return createOverlayFrame(worldCenter, worldSize, worldQuaternion, true);
}

function getOverlayFrameForRefs(preview, refs = []) {
  if (!preview || !refs.length) {
    return null;
  }
  if (refs.length === 1) {
    const object = preview.entityMeshes.get(refs[0].id);
    const frame = getOverlayFrameForObject(object);
    if (frame) {
      return frame;
    }
  }
  return getOverlayFrameFromBox(getOverlayBoundsForRefs(preview, refs));
}

function expandOverlayFrame(frame, padding = 0) {
  if (!frame) {
    return null;
  }
  const size = frame.size.clone().addScalar(Math.max(0, Number(padding) || 0) * 2);
  return createOverlayFrame(
    frame.center.clone(),
    size,
    frame.quaternion?.clone?.() ?? new THREE.Quaternion(),
    frame.oriented === true,
  );
}

function getSelectionOutlinePadding(count = 1) {
  if (count <= 1) {
    return 0.18;
  }
  return Math.min(PRIVATE_WORLD_BLOCK_UNIT * 0.35, 0.18 + (count - 1) * PRIVATE_WORLD_BLOCK_UNIT * 0.05);
}

function buildOverlayOutline(preview, frame, options = {}) {
  if (!preview?.buildOverlay || !frame) {
    return null;
  }
  const geometry = new THREE.BoxGeometry(
    Math.max(0.12, frame.size.x),
    Math.max(0.12, frame.size.y),
    Math.max(0.12, frame.size.z),
  );
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(options.color || "#5da5ff"),
      transparent: true,
      opacity: options.opacity ?? 0.48,
      fog: false,
    }),
  );
  outline.position.copy(frame.center);
  outline.quaternion.copy(frame.quaternion ?? new THREE.Quaternion());
  preview.buildOverlay.add(outline);
  return outline;
}

function getTransformHandleSpecs(frame) {
  if (!frame) {
    return [];
  }
  const halfSize = frame.size.clone().multiplyScalar(0.5);
  return [
    { axis: "x", direction: -1, key: "x:-1", position: new THREE.Vector3(-halfSize.x, 0, 0) },
    { axis: "x", direction: 1, key: "x:1", position: new THREE.Vector3(halfSize.x, 0, 0) },
    { axis: "y", direction: -1, key: "y:-1", position: new THREE.Vector3(0, -halfSize.y, 0) },
    { axis: "y", direction: 1, key: "y:1", position: new THREE.Vector3(0, halfSize.y, 0) },
    { axis: "z", direction: -1, key: "z:-1", position: new THREE.Vector3(0, 0, -halfSize.z) },
    { axis: "z", direction: 1, key: "z:1", position: new THREE.Vector3(0, 0, halfSize.z) },
  ];
}

function getRotateHandleSpecs(frame) {
  if (!frame) {
    return [];
  }
  const halfSize = frame.size.clone().multiplyScalar(0.5);
  return [
    { axis: "x", key: "rx:-1:-1", position: new THREE.Vector3(0, -halfSize.y, -halfSize.z) },
    { axis: "x", key: "rx:-1:1", position: new THREE.Vector3(0, -halfSize.y, halfSize.z) },
    { axis: "x", key: "rx:1:-1", position: new THREE.Vector3(0, halfSize.y, -halfSize.z) },
    { axis: "x", key: "rx:1:1", position: new THREE.Vector3(0, halfSize.y, halfSize.z) },
    { axis: "y", key: "ry:-1:-1", position: new THREE.Vector3(-halfSize.x, 0, -halfSize.z) },
    { axis: "y", key: "ry:-1:1", position: new THREE.Vector3(-halfSize.x, 0, halfSize.z) },
    { axis: "y", key: "ry:1:-1", position: new THREE.Vector3(halfSize.x, 0, -halfSize.z) },
    { axis: "y", key: "ry:1:1", position: new THREE.Vector3(halfSize.x, 0, halfSize.z) },
    { axis: "z", key: "rz:-1:-1", position: new THREE.Vector3(-halfSize.x, -halfSize.y, 0) },
    { axis: "z", key: "rz:-1:1", position: new THREE.Vector3(-halfSize.x, halfSize.y, 0) },
    { axis: "z", key: "rz:1:-1", position: new THREE.Vector3(halfSize.x, -halfSize.y, 0) },
    { axis: "z", key: "rz:1:1", position: new THREE.Vector3(halfSize.x, halfSize.y, 0) },
  ];
}

function getTransformHandleColor(axis) {
  if (axis === "x") {
    return "#ff7d96";
  }
  if (axis === "y") {
    return "#7fe46a";
  }
  return "#5eb9ff";
}

function getPreviewPointerMetrics(pointerSource) {
  const preview = ensurePreview();
  const clientX = Number(pointerSource?.clientX);
  const clientY = Number(pointerSource?.clientY);
  if (!preview || !Number.isFinite(clientX) || !Number.isFinite(clientY) || !elements.previewCanvas) {
    return null;
  }
  const rect = elements.previewCanvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const canvasX = clientX - rect.left;
  const canvasY = clientY - rect.top;
  return {
    preview,
    rect,
    canvasX,
    canvasY,
    pointer: new THREE.Vector2(
      (canvasX / width) * 2 - 1,
      -((canvasY / height) * 2 - 1),
    ),
  };
}

function projectWorldPointToPreviewScreen(worldPoint, preview = state.preview, rect = null) {
  if (!preview?.camera || !worldPoint) {
    return null;
  }
  const activeRect = rect ?? elements.previewCanvas?.getBoundingClientRect?.();
  if (!activeRect) {
    return null;
  }
  const screenPosition = worldPoint.clone().project(preview.camera);
  if (
    !Number.isFinite(screenPosition.x)
    || !Number.isFinite(screenPosition.y)
    || screenPosition.z < -1
    || screenPosition.z > 1
  ) {
    return null;
  }
  return {
    depth: screenPosition.z,
    x: (screenPosition.x * 0.5 + 0.5) * activeRect.width,
    y: (-screenPosition.y * 0.5 + 0.5) * activeRect.height,
  };
}

function getPreviewWorldUnitsPerPixel(distance, preview = state.preview, rect = null) {
  const activeRect = rect ?? elements.previewCanvas?.getBoundingClientRect?.();
  if (!preview?.camera || !activeRect) {
    return 0.1;
  }
  const fovRadians = THREE.MathUtils.degToRad(Number(preview.camera.fov) || 58);
  return (
    Math.max(0.1, distance) * 2 * Math.tan(fovRadians / 2)
  ) / Math.max(1, activeRect.height);
}

function syncPreviewCanvasCursor() {
  if (!elements.previewCanvas) {
    return;
  }
  let cursor = "";
  if (state.mode === "build" && isEditor()) {
    if (getActivePlacementTool() || getActivePrefabPlacementId()) {
      cursor = "crosshair";
    } else if (state.buildDrag?.handle) {
      cursor = "grabbing";
    } else if (state.buildHover?.transformHandle) {
      cursor = "grab";
    }
  }
  elements.previewCanvas.style.cursor = cursor;
}

function getOverlayFrameProjectedRect(frame, preview = state.preview, rect = null) {
  if (!frame) {
    return null;
  }
  const halfSize = frame.size.clone().multiplyScalar(0.5);
  const quaternion = frame.quaternion ?? new THREE.Quaternion();
  const projectedPoints = [];
  for (const x of [-halfSize.x, halfSize.x]) {
    for (const y of [-halfSize.y, halfSize.y]) {
      for (const z of [-halfSize.z, halfSize.z]) {
        const projectedPoint = projectWorldPointToPreviewScreen(
          new THREE.Vector3(x, y, z).applyQuaternion(quaternion).add(frame.center),
          preview,
          rect,
        );
        if (projectedPoint) {
          projectedPoints.push(projectedPoint);
        }
      }
    }
  }
  if (!projectedPoints.length) {
    return null;
  }
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const point of projectedPoints) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  bounds.width = Math.max(0, bounds.maxX - bounds.minX);
  bounds.height = Math.max(0, bounds.maxY - bounds.minY);
  bounds.diagonal = Math.hypot(bounds.width, bounds.height);
  return bounds;
}

function getTransformHandleWorldPosition(frame, handle, includeOffset = true) {
  if (!frame || !handle) {
    return null;
  }
  const frameQuaternion = frame.quaternion ?? new THREE.Quaternion();
  const worldPosition = handle.position
    .clone()
    .applyQuaternion(frameQuaternion)
    .add(frame.center);
  if (!includeOffset) {
    return worldPosition;
  }
  const handleSize = clampNumber(Math.max(frame.size.x, frame.size.y, frame.size.z) * 0.12, 1.1, 0.6, 2.4);
  const handleOffset = Math.max(0.24, handleSize * 0.58);
  const axisVector = getBuildDragAxisVector(handle.axis, frame);
  return worldPosition.addScaledVector(axisVector, handle.direction * handleOffset);
}

function getRotateHandleWorldPosition(frame, handle) {
  if (!frame || !handle) {
    return null;
  }
  const frameQuaternion = frame.quaternion ?? new THREE.Quaternion();
  const maxSize = Math.max(frame.size.x, frame.size.y, frame.size.z);
  const handleThickness = clampNumber(maxSize * 0.1, 0.72, 0.5, 1.5);
  const handleOffset = Math.max(0.18, handleThickness * 0.4);
  const outward = handle.position.clone();
  if (outward.lengthSq() < 0.0001) {
    outward.copy(getBuildDragAxisVector(handle.axis, frame));
  } else {
    outward.applyQuaternion(frameQuaternion).normalize();
  }
  return handle.position
    .clone()
    .applyQuaternion(frameQuaternion)
    .add(frame.center)
    .addScaledVector(outward, handleOffset);
}

function getTransformHandleHit(pointerSource) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  const preview = metrics?.preview;
  if (!preview?.transformPickables?.length || !metrics) {
    return null;
  }
  preview.buildOverlay?.updateMatrixWorld?.(true);
  const {
    rect,
    canvasX: pointerX,
    canvasY: pointerY,
    pointer,
  } = metrics;
  const hoveredHandleKey = state.buildHover?.transformHandle?.key ?? "";
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  preview.camera.matrixWorld.extractBasis(cameraRight, cameraUp, cameraForward);
  cameraRight.normalize();
  cameraUp.normalize();
  const projectWorldPoint = (worldPoint) => projectWorldPointToPreviewScreen(worldPoint, preview, rect);
  const rankHandle = (object, rayDistance = null) => {
    const handle = object?.userData?.privateWorldTransformHandle;
    if (!handle) {
      return null;
    }
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const screenPoint = projectWorldPoint(worldPosition);
    if (!screenPoint) {
      return null;
    }
    const geometry = object.geometry;
    geometry?.computeBoundingSphere?.();
    const sphereRadius = Number(geometry?.boundingSphere?.radius ?? 0) || 0;
    let projectedRadiusPx = 0;
    if (sphereRadius > 0) {
      const worldScale = object.getWorldScale(new THREE.Vector3());
      const radiusWorld = sphereRadius * Math.max(
        Math.abs(worldScale.x),
        Math.abs(worldScale.y),
        Math.abs(worldScale.z),
      );
      const rightEdge = projectWorldPoint(
        worldPosition.clone().addScaledVector(cameraRight, radiusWorld),
      );
      const upEdge = projectWorldPoint(
        worldPosition.clone().addScaledVector(cameraUp, radiusWorld),
      );
      projectedRadiusPx = Math.max(
        rightEdge ? Math.hypot(rightEdge.x - screenPoint.x, rightEdge.y - screenPoint.y) : 0,
        upEdge ? Math.hypot(upEdge.x - screenPoint.x, upEdge.y - screenPoint.y) : 0,
      );
    }
    const baseThresholdPx = handle.type === "rotate" ? 34 : 28;
    return {
      handle,
      object,
      depth: screenPoint.depth,
      rayDistance,
      screenDistance: Math.hypot(screenPoint.x - pointerX, screenPoint.y - pointerY),
      thresholdPx: Math.max(baseThresholdPx, projectedRadiusPx + 8),
    };
  };
  const chooseCandidate = (candidates, { requireThreshold = true } = {}) => {
    const rankedCandidates = candidates
      .filter(Boolean)
      .filter((candidate) => !requireThreshold || candidate.screenDistance <= (
        candidate.handle?.key === hoveredHandleKey
          ? candidate.thresholdPx + 10
          : candidate.thresholdPx
      ))
      .sort((left, right) =>
        left.screenDistance - right.screenDistance
        || (left.rayDistance ?? left.depth) - (right.rayDistance ?? right.depth)
        || left.depth - right.depth
      );
    if (!rankedCandidates.length) {
      return null;
    }
    if (!hoveredHandleKey) {
      return rankedCandidates[0];
    }
    const stickyCandidate = rankedCandidates.find((candidate) => candidate.handle?.key === hoveredHandleKey);
    if (!stickyCandidate) {
      return rankedCandidates[0];
    }
    const bestCandidate = rankedCandidates[0];
    if (!bestCandidate || bestCandidate.handle?.key === hoveredHandleKey) {
      return stickyCandidate;
    }
    return bestCandidate.screenDistance + 10 < stickyCandidate.screenDistance
      ? bestCandidate
      : stickyCandidate;
  };
  const chooseOutsideCandidate = (candidates) => candidates
    .filter(Boolean)
    .sort((left, right) =>
      left.screenDistance - right.screenDistance
      || left.depth - right.depth
    );
  const pickableByHandleKey = new Map();
  for (const object of preview.transformPickables) {
    const handleKey = object?.userData?.privateWorldTransformHandle?.key;
    if (handleKey && !pickableByHandleKey.has(handleKey)) {
      pickableByHandleKey.set(handleKey, object);
    }
  }
  const selectionRefs = getBuilderSelectionRefs();
  const baseSelectionFrame = selectionRefs.length
    ? getOverlayFrameForRefs(preview, selectionRefs)
    : null;
  const handleSelectionFrame = baseSelectionFrame
    ? expandOverlayFrame(
      baseSelectionFrame,
      getSelectionOutlinePadding(selectionRefs.length),
    )
    : null;
  const handleType = preview.transformPickables[0]?.userData?.privateWorldTransformHandle?.type ?? "";
  const resolvedTransformMode = getResolvedBuildTransformMode();
  const axisLock = getBuildTransformAxisLock(resolvedTransformMode);
  preview.raycaster.setFromCamera(pointer, preview.camera);
  if (handleSelectionFrame && axisLock) {
    const projectedPivot = projectWorldPoint(baseSelectionFrame?.center ?? handleSelectionFrame.center);
    const pointerVector = projectedPivot
      ? new THREE.Vector2(pointerX - projectedPivot.x, pointerY - projectedPivot.y)
      : null;
    const pointerDirection = pointerVector && pointerVector.lengthSq() > 36
      ? pointerVector.clone().normalize()
      : null;
    const lockedCandidates = (handleType === "rotate"
      ? getRotateHandleSpecs(handleSelectionFrame)
      : getTransformHandleSpecs(handleSelectionFrame)
    )
      .filter((handle) => handle.axis === axisLock)
      .map((handle) => {
        const object = pickableByHandleKey.get(handle.key);
        if (!object) {
          return null;
        }
        const screenPoint = projectWorldPoint(
          handleType === "rotate"
            ? getRotateHandleWorldPosition(handleSelectionFrame, handle)
            : getTransformHandleWorldPosition(handleSelectionFrame, handle),
        );
        if (!screenPoint) {
          return null;
        }
        return {
          handle: object.userData.privateWorldTransformHandle,
          object,
          depth: screenPoint.depth,
          alignment: pointerDirection
            ? new THREE.Vector2(
              screenPoint.x - projectedPivot.x,
              screenPoint.y - projectedPivot.y,
            ).normalize().dot(pointerDirection)
            : -Infinity,
          screenDistance: Math.hypot(screenPoint.x - pointerX, screenPoint.y - pointerY),
        };
      })
      .filter(Boolean)
      .sort((left, right) =>
        (pointerDirection ? right.alignment - left.alignment : 0)
        || left.screenDistance - right.screenDistance
        || left.depth - right.depth
      );
    const bestLockedCandidate = lockedCandidates[0] ?? null;
    const stickyLockedCandidate = hoveredHandleKey
      ? lockedCandidates.find((candidate) => candidate.handle?.key === hoveredHandleKey)
      : null;
    const lockedCandidate = stickyLockedCandidate
      && bestLockedCandidate
      && bestLockedCandidate.handle?.key !== stickyLockedCandidate.handle?.key
      && (
        pointerDirection
          ? bestLockedCandidate.alignment - stickyLockedCandidate.alignment <= 0.12
          : bestLockedCandidate.screenDistance + 14 >= stickyLockedCandidate.screenDistance
      )
      ? stickyLockedCandidate
      : bestLockedCandidate;
    if (lockedCandidate) {
      return {
        object: lockedCandidate.object,
        distance: lockedCandidate.depth,
      };
    }
  }
  const hoveredEntityHit = getFirstPreviewEntityHit(preview.raycaster.intersectObjects(preview.entityPickables, false));
  const hoveredEntityRef = getEntityRefFromHit(hoveredEntityHit);
  const pointerIsOverSelection = Boolean(
    hoveredEntityRef
    && selectionRefs.some((ref) => isSameEntityRef(ref, hoveredEntityRef))
  );
  if (handleSelectionFrame && !pointerIsOverSelection) {
    const outsideCandidates = handleType === "rotate"
      ? getRotateHandleSpecs(handleSelectionFrame).map((handle) => {
        const object = pickableByHandleKey.get(handle.key);
        if (!object) {
          return null;
        }
        const screenPoint = projectWorldPoint(getRotateHandleWorldPosition(handleSelectionFrame, handle));
        if (!screenPoint) {
          return null;
        }
        return {
          handle: object.userData.privateWorldTransformHandle,
          object,
          depth: screenPoint.depth,
          screenDistance: Math.hypot(screenPoint.x - pointerX, screenPoint.y - pointerY),
        };
      })
      : getTransformHandleSpecs(handleSelectionFrame).map((handle) => {
        const object = pickableByHandleKey.get(handle.key);
        if (!object) {
          return null;
        }
        const screenPoint = projectWorldPoint(getTransformHandleWorldPosition(handleSelectionFrame, handle));
        if (!screenPoint) {
          return null;
        }
        return {
          handle: object.userData.privateWorldTransformHandle,
          object,
          depth: screenPoint.depth,
          screenDistance: Math.hypot(screenPoint.x - pointerX, screenPoint.y - pointerY),
        };
      });
    const rankedOutsideCandidates = chooseOutsideCandidate(outsideCandidates);
    const bestOutsideCandidate = rankedOutsideCandidates[0] ?? null;
    const stickyOutsideCandidate = hoveredHandleKey
      ? rankedOutsideCandidates.find((candidate) => candidate.handle?.key === hoveredHandleKey)
      : null;
    const outsideCandidate = stickyOutsideCandidate
      && bestOutsideCandidate
      && bestOutsideCandidate.handle?.key !== stickyOutsideCandidate.handle?.key
      && bestOutsideCandidate.screenDistance + 14 >= stickyOutsideCandidate.screenDistance
      ? stickyOutsideCandidate
      : bestOutsideCandidate;
    if (outsideCandidate) {
      return {
        object: outsideCandidate.object,
        distance: outsideCandidate.depth,
      };
    }
  }
  const rayCandidates = [];
  const seenObjects = new Set();
  for (const hit of preview.raycaster.intersectObjects(preview.transformPickables, false)) {
    if (!hit?.object || seenObjects.has(hit.object)) {
      continue;
    }
    seenObjects.add(hit.object);
    const candidate = rankHandle(hit.object, hit.distance);
    if (candidate) {
      rayCandidates.push(candidate);
    }
  }
  const rayCandidate = chooseCandidate(rayCandidates, { requireThreshold: false });
  if (rayCandidate) {
    return {
      object: rayCandidate.object,
      distance: rayCandidate.rayDistance ?? rayCandidate.depth,
    };
  }
  const candidate = chooseCandidate(
    preview.transformPickables.map((object) => rankHandle(object)),
  );
  return candidate
    ? {
      object: candidate.object,
      distance: candidate.depth,
    }
    : null;
}

function getOverlayBoundsSignature(box) {
  if (!box) {
    return "none";
  }
  return [
    box.min.x,
    box.min.y,
    box.min.z,
    box.max.x,
    box.max.y,
    box.max.z,
  ].map((value) => roundPrivateValue(value, 3)).join(":");
}

function getOverlayFrameSignature(frame) {
  if (!frame) {
    return "none";
  }
  const quaternion = frame.quaternion ?? new THREE.Quaternion();
  return [
    frame.center?.x,
    frame.center?.y,
    frame.center?.z,
    frame.size?.x,
    frame.size?.y,
    frame.size?.z,
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
    frame.oriented ? 1 : 0,
  ].map((value) => roundPrivateValue(value, 3)).join(":");
}

function recordBuildSuppressedClick(event) {
  state.buildSuppressedClick = {
    at: performance.now(),
    clientX: Number(event?.clientX ?? 0) || 0,
    clientY: Number(event?.clientY ?? 0) || 0,
  };
}

function shouldSuppressBuildClick(event) {
  const pending = state.buildSuppressedClick;
  if (!pending) {
    return false;
  }
  state.buildSuppressedClick = null;
  const elapsed = performance.now() - pending.at;
  if (elapsed > 240) {
    return false;
  }
  const deltaX = (Number(event?.clientX ?? 0) || 0) - pending.clientX;
  const deltaY = (Number(event?.clientY ?? 0) || 0) - pending.clientY;
  return Math.hypot(deltaX, deltaY) <= 12;
}

function refreshBuildHoverFromPointer(pointerSource) {
  if (!canUsePlacementTools() || !state.previewPointer.inside) {
    state.buildHover = null;
    syncBuildPlacementOverlay();
    return null;
  }
  const context = getPreviewPointerContext(pointerSource);
  if (!context) {
    state.buildHover = null;
    syncBuildPlacementOverlay();
    return null;
  }
  const toolKind = getActivePlacementTool();
  const prefabPlacementId = getActivePrefabPlacementId();
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
    ensureBuilderSelection(sceneDoc);
  } catch (_error) {
    if (toolKind || prefabPlacementId) {
      state.buildHover = null;
      syncBuildPlacementOverlay();
      return null;
    }
  }
  const transformMode = sceneDoc
    ? getResolvedBuildTransformMode(getBuildTransformMode(), sceneDoc)
    : getBuildTransformMode();
  const transformHandleHit = transformMode ? getTransformHandleHit(pointerSource) : null;
  const hoveredTransformHandle = transformHandleHit?.object?.userData?.privateWorldTransformHandle
    ? { ...transformHandleHit.object.userData.privateWorldTransformHandle }
    : null;
  const placementArmed = Boolean(prefabPlacementId || toolKind);
  state.buildHover = {
    context,
    gridCell: placementArmed ? resolveBuildGridCell(context) : null,
    placement: placementArmed && prefabPlacementId && sceneDoc
      ? resolvePrefabPlacementPreview(prefabPlacementId, sceneDoc, context)
      : placementArmed && toolKind && sceneDoc
        ? resolvePlacementPreview(toolKind, sceneDoc, context)
        : null,
    entityRef: hoveredTransformHandle ? null : getEntityRefFromHit(context.hit),
    transformHandle: hoveredTransformHandle,
  };
  syncBuildPlacementOverlay();
  return state.buildHover;
}

function refreshBuildHoverFromStoredPointer() {
  if (!state.previewPointer.inside) {
    state.buildHover = null;
    syncBuildPlacementOverlay();
    return null;
  }
  return refreshBuildHoverFromPointer(state.previewPointer);
}

function clearBuildPlacementOverlay(preview = state.preview) {
  if (!preview?.buildOverlay) {
    return;
  }
  preview.transformPickables = [];
  for (const child of [...preview.buildOverlay.children]) {
    preview.buildOverlay.remove(child);
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material?.dispose?.());
      } else {
        node.material?.dispose?.();
      }
    });
  }
  preview.buildOverlayKey = "";
}

function buildPlacementGhost(preview, placement) {
  if (!preview?.buildOverlay || !placement) {
    return;
  }
  const accent = placement.kind === "voxel" ? "#85b84f" : placement.kind === "prefab" ? "#ff8a5c" : "#4ca7ff";
  const invalidAccent = "#ff5a7a";
  const color = placement.valid ? accent : invalidAccent;
  const dimensions = placement.dimensions || getToolPlacementDimensions(placement.kind);
  const overlayOpacity = placement.valid ? 0.18 : 0.12;
  const outlineOpacity = placement.valid ? 0.56 : 0.8;

  const cellHighlight = new THREE.Mesh(
    new THREE.BoxGeometry(PRIVATE_WORLD_BLOCK_UNIT, 0.08, PRIVATE_WORLD_BLOCK_UNIT),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(placement.valid ? "#7ce85b" : invalidAccent),
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      fog: false,
    }),
  );
  cellHighlight.position.set(
    snapPlacementAxisToBlockGrid(placement.position.x, "x"),
    placement.supportTopY + 0.08,
    snapPlacementAxisToBlockGrid(placement.position.z, "z"),
  );
  preview.buildOverlay.add(cellHighlight);

  let geometry = new THREE.BoxGeometry(1, 1, 1);
  let scale = dimensions;
  if (placement.kind === "player") {
    geometry = new THREE.CapsuleGeometry(
      PRIVATE_PLAYER_METRICS.width / 2,
      PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
      8,
      16,
    );
    scale = {
      x: PRIVATE_PLAYER_DEFAULT_SCALE,
      y: PRIVATE_PLAYER_DEFAULT_SCALE,
      z: PRIVATE_PLAYER_DEFAULT_SCALE,
    };
  } else if (placement.kind === "primitive" && placement.shape === "panel") {
    geometry = new THREE.PlaneGeometry(1, 1);
    scale = { x: dimensions.x, y: dimensions.y, z: 1 };
  } else if (placement.kind === "panel") {
    geometry = new THREE.PlaneGeometry(1, 1);
    scale = { x: dimensions.x, y: dimensions.y, z: 1 };
  } else if (placement.kind === "screen") {
    geometry = new THREE.BoxGeometry(1, 1, 0.1);
  } else if (placement.kind === "prefab") {
    geometry = new THREE.BoxGeometry(
      Math.max(0.2, dimensions.x),
      Math.max(0.2, dimensions.y),
      Math.max(0.2, dimensions.z),
    );
  } else if (placement.kind === "trigger") {
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: outlineOpacity,
        fog: false,
      }),
    );
    wire.position.set(placement.position.x, placement.position.y, placement.position.z);
    preview.buildOverlay.add(wire);
    return;
  } else if (placement.kind === "text") {
    geometry = new THREE.PlaneGeometry(4.5, 1.2);
    scale = { x: 1, y: 1, z: 1 };
  }

  const ghost = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: overlayOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    }),
  );
  ghost.position.set(placement.position.x, placement.position.y, placement.position.z);
  ghost.rotation.set(placement.rotation?.x || 0, placement.rotation?.y || 0, placement.rotation?.z || 0);
  ghost.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
  preview.buildOverlay.add(ghost);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      placement.kind === "text"
        ? new THREE.BoxGeometry(4.5, 1.2, 0.12)
        : placement.kind === "primitive" && placement.shape === "panel"
          ? new THREE.BoxGeometry(dimensions.x, dimensions.y, Math.max(0.05, dimensions.z))
        : placement.kind === "panel"
          ? new THREE.BoxGeometry(dimensions.x, dimensions.y, Math.max(0.05, dimensions.z))
        : placement.kind === "screen"
          ? new THREE.BoxGeometry(dimensions.x, dimensions.y, Math.max(0.1, dimensions.z))
          : placement.kind === "prefab"
            ? new THREE.BoxGeometry(Math.max(0.2, dimensions.x), Math.max(0.2, dimensions.y), Math.max(0.2, dimensions.z))
          : placement.kind === "player"
            ? new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z)
            : new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z)
    ),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: outlineOpacity,
      fog: false,
    }),
  );
  outline.position.copy(ghost.position);
  outline.rotation.copy(ghost.rotation);
  preview.buildOverlay.add(outline);
}

function buildTransformHandles(preview, frame, hoveredHandleKey = "", lockedHandleKey = "") {
  if (!preview?.buildOverlay || !frame) {
    return;
  }
  const size = frame.size;
  const frameQuaternion = frame.quaternion ?? new THREE.Quaternion();
  const handleSize = clampNumber(Math.max(size.x, size.y, size.z) * 0.12, 1.1, 0.6, 2.4);
  const dragHandleKey = state.buildDrag?.handle?.key ?? "";
  const hasLockedHandle = Boolean(lockedHandleKey);
  const pickSize = Math.max(handleSize * 3.2, 2.2);
  const handleOffset = Math.max(0.24, handleSize * 0.58);
  for (const handle of getTransformHandleSpecs(frame)) {
    const isActive = handle.key === dragHandleKey;
    const isLocked = !isActive && handle.key === lockedHandleKey;
    const isHovered = !isActive && !isLocked && handle.key === hoveredHandleKey;
    const axisVector = getBuildDragAxisVector(handle.axis, frame);
    const handlePosition = handle.position
      .clone()
      .applyQuaternion(frameQuaternion)
      .add(frame.center)
      .addScaledVector(axisVector, handle.direction * handleOffset);
    const visualSize = handleSize * (isActive ? 1.28 : isLocked ? 1.2 : isHovered ? 1.12 : 1);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(visualSize, visualSize, visualSize),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(getTransformHandleColor(handle.axis)),
        transparent: true,
        opacity: isActive ? 1 : isLocked ? 1 : isHovered ? 0.96 : hasLockedHandle ? 0.32 : 0.82,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.position.copy(handlePosition);
    mesh.quaternion.copy(frameQuaternion);
    preview.buildOverlay.add(mesh);
    if (isHovered || isActive || isLocked) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(visualSize * 1.18, visualSize * 1.18, visualSize * 1.18)),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(isActive || isLocked ? "#ffffff" : getTransformHandleColor(handle.axis)),
          transparent: true,
          opacity: isActive ? 0.94 : isLocked ? 0.98 : 0.62,
          depthTest: false,
          fog: false,
        }),
      );
      outline.position.copy(handlePosition);
      outline.quaternion.copy(frameQuaternion);
      preview.buildOverlay.add(outline);
      if (isLocked) {
        const accentOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(visualSize * 1.34, visualSize * 1.34, visualSize * 1.34)),
          new THREE.LineBasicMaterial({
            color: new THREE.Color(getTransformHandleColor(handle.axis)),
            transparent: true,
            opacity: 0.82,
            depthTest: false,
            fog: false,
          }),
        );
        accentOutline.position.copy(handlePosition);
        accentOutline.quaternion.copy(frameQuaternion);
        preview.buildOverlay.add(accentOutline);
      }
    }

    const pickMesh = new THREE.Mesh(
      new THREE.BoxGeometry(pickSize, pickSize, pickSize),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffffff"),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    pickMesh.position.copy(handlePosition);
    pickMesh.quaternion.copy(frameQuaternion);
    pickMesh.userData.privateWorldTransformHandle = {
      type: "translate-scale",
      axis: handle.axis,
      direction: handle.direction,
      key: handle.key,
    };
    preview.buildOverlay.add(pickMesh);
    preview.transformPickables.push(pickMesh);
  }
}

function buildRotateHandles(preview, frame, hoveredHandleKey = "", lockedAxis = "") {
  if (!preview?.buildOverlay || !frame) {
    return;
  }
  const center = frame.center;
  const size = frame.size;
  const frameQuaternion = frame.quaternion ?? new THREE.Quaternion();
  const maxSize = Math.max(size.x, size.y, size.z);
  const handleThickness = clampNumber(maxSize * 0.1, 0.72, 0.5, 1.5);
  const handleLength = clampNumber(maxSize * 0.3, 1.6, 1.05, 3.8);
  const dragHandleKey = state.buildDrag?.handle?.key ?? "";
  const dragHandleAxis = state.buildDrag?.handle?.axis ?? "";
  const hasLockedAxis = Boolean(lockedAxis);
  const pickThickness = Math.max(handleThickness * 3.2, 2.3);
  const pickLength = Math.max(handleLength * 1.55, 3.1);
  const handleOffset = Math.max(0.18, handleThickness * 0.4);
  const buildDimensions = (axis, longSide, shortSide) => ({
    x: axis === "x" ? longSide : shortSide,
    y: axis === "y" ? longSide : shortSide,
    z: axis === "z" ? longSide : shortSide,
  });
  for (const handle of getRotateHandleSpecs(frame)) {
    const axisIsLocked = hasLockedAxis && handle.axis === lockedAxis;
    const isActive = axisIsLocked
      ? dragHandleAxis === lockedAxis && Boolean(state.buildDrag?.handle)
      : handle.key === dragHandleKey;
    const isLocked = !isActive && axisIsLocked;
    const isHovered = !isActive && !isLocked && handle.key === hoveredHandleKey;
    const outward = handle.position.clone();
    if (outward.lengthSq() < 0.0001) {
      outward.copy(getBuildDragAxisVector(handle.axis, frame));
    } else {
      outward.applyQuaternion(frameQuaternion).normalize();
    }
    const handlePosition = handle.position
      .clone()
      .applyQuaternion(frameQuaternion)
      .add(center)
      .addScaledVector(outward, handleOffset);
    const visibleDimensions = buildDimensions(
      handle.axis,
      handleLength * (isActive ? 1.22 : isLocked ? 1.14 : isHovered ? 1.08 : 1),
      handleThickness * (isActive ? 1.32 : isLocked ? 1.18 : isHovered ? 1.12 : 1),
    );
    const pickDimensions = buildDimensions(handle.axis, pickLength, pickThickness);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(visibleDimensions.x, visibleDimensions.y, visibleDimensions.z),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(getTransformHandleColor(handle.axis)),
        transparent: true,
        opacity: isActive ? 1 : isLocked ? 1 : isHovered ? 0.96 : hasLockedAxis ? 0.34 : 0.86,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.position.copy(handlePosition);
    mesh.quaternion.copy(frameQuaternion);
    preview.buildOverlay.add(mesh);
    if (isHovered || isActive || isLocked) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(
          visibleDimensions.x * 1.14,
          visibleDimensions.y * 1.14,
          visibleDimensions.z * 1.14,
        )),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(isActive || isLocked ? "#ffffff" : getTransformHandleColor(handle.axis)),
          transparent: true,
          opacity: isActive ? 0.9 : isLocked ? 0.98 : 0.58,
          depthTest: false,
          fog: false,
        }),
      );
      outline.position.copy(handlePosition);
      outline.quaternion.copy(frameQuaternion);
      preview.buildOverlay.add(outline);
      if (isLocked) {
        const accentOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(
            visibleDimensions.x * 1.28,
            visibleDimensions.y * 1.28,
            visibleDimensions.z * 1.28,
          )),
          new THREE.LineBasicMaterial({
            color: new THREE.Color(getTransformHandleColor(handle.axis)),
            transparent: true,
            opacity: 0.8,
            depthTest: false,
            fog: false,
          }),
        );
        accentOutline.position.copy(handlePosition);
        accentOutline.quaternion.copy(frameQuaternion);
        preview.buildOverlay.add(accentOutline);
      }
    }

    const pickMesh = new THREE.Mesh(
      new THREE.BoxGeometry(pickDimensions.x, pickDimensions.y, pickDimensions.z),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffffff"),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    pickMesh.position.copy(handlePosition);
    pickMesh.quaternion.copy(frameQuaternion);
    pickMesh.userData.privateWorldTransformHandle = {
      type: "rotate",
      axis: handle.axis,
      key: handle.key,
    };
    preview.buildOverlay.add(pickMesh);
    preview.transformPickables.push(pickMesh);
  }
}

function syncBuildPlacementOverlay(preview = state.preview) {
  if (!preview?.buildOverlay) {
    return;
  }
  const buildMode = canUsePlacementTools();
  const hover = buildMode ? state.buildHover : null;
  const activeTool = buildMode ? getActivePlacementTool() : "";
  const activePrefabPlacementId = buildMode ? getActivePrefabPlacementId() : "";
  const placementArmed = Boolean(activeTool || activePrefabPlacementId);
  const requestedTransformMode = buildMode ? getBuildTransformMode() : "";
  const hoveredHandleKey = hover?.transformHandle?.key ?? "";
  const dragHandleKey = state.buildDrag?.handle?.key ?? "";
  const displayedHandleKey = dragHandleKey || hoveredHandleKey;
  const gridCell = placementArmed ? hover?.gridCell ?? null : null;
  const placement = placementArmed ? hover?.placement ?? null : null;
  const hoveredEntityRef = displayedHandleKey ? null : hover?.entityRef ?? null;
  const selectionRefs = buildMode ? getBuilderSelectionRefs() : [];
  let selectedEntities = [];
  if (selectionRefs.length) {
    try {
      selectedEntities = getSelectedEntities(parseSceneTextarea());
    } catch (_error) {
      selectedEntities = [];
    }
  }
  const transformMode = buildMode
    ? getResolvedBuildTransformMode(requestedTransformMode, selectedEntities)
    : "";
  const axisLock = buildMode ? getBuildTransformAxisLock(transformMode) : "";
  const selectionFrame = selectionRefs.length ? getOverlayFrameForRefs(preview, selectionRefs) : null;
  const overlayKey = [
    buildMode ? "build" : "idle",
    activePrefabPlacementId ? `prefab:${activePrefabPlacementId}` : activeTool || "none",
    transformMode || "none",
    axisLock || "noaxislock",
    selectionRefs.map((entry) => `${entry.kind}:${entry.id}`).join(",") || "noselection",
    getOverlayFrameSignature(selectionFrame),
    hoveredEntityRef ? `${hoveredEntityRef.kind}:${hoveredEntityRef.id}` : "nohover",
    displayedHandleKey || "nohandle",
    dragHandleKey || "nodrag",
    gridCell ? `${gridCell.x}:${gridCell.z}` : "nogrid",
    placement ? `${placement.key}:${placement.valid ? "ok" : "blocked"}` : "noplacement",
  ].join("|");
  if (preview.buildOverlayKey === overlayKey) {
    syncPreviewCanvasCursor();
    return;
  }
  clearBuildPlacementOverlay(preview);
  preview.buildOverlay.visible = buildMode;
  syncPreviewCanvasCursor();
  if (!buildMode) {
    return;
  }
  if (gridCell) {
    const cursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(PRIVATE_WORLD_BLOCK_UNIT, 0.04, PRIVATE_WORLD_BLOCK_UNIT)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color("#7fa7ff"),
        transparent: true,
        opacity: 0.4,
        fog: false,
      }),
    );
    cursor.position.set(gridCell.x, gridCell.y, gridCell.z);
    preview.buildOverlay.add(cursor);
  }
  if (placement) {
    buildPlacementGhost(preview, placement);
  }
  const drawSelectionOutline = (refs, options = {}) => {
    const rawFrame = getOverlayFrameForRefs(preview, refs);
    if (!rawFrame) {
      return null;
    }
    const paddedFrame = expandOverlayFrame(rawFrame, options.padding ?? getSelectionOutlinePadding(refs.length));
    buildOverlayOutline(preview, paddedFrame, {
      color: options.color,
      opacity: options.opacity,
    });
    return paddedFrame;
  };
  if (selectionRefs.length > 1) {
    for (const ref of selectionRefs) {
      drawSelectionOutline([ref], {
        color: "#8fb8ff",
        opacity: 0.24,
        padding: 0.08,
      });
    }
  }
  const groupFrame = selectionRefs.length
    ? drawSelectionOutline(selectionRefs, {
      color: transformMode === "delete" ? "#ff6a86" : "#5da5ff",
      opacity: selectionRefs.length > 1 ? 0.6 : 0.44,
      padding: getSelectionOutlinePadding(selectionRefs.length),
    })
    : null;
  if (transformMode === "delete" && hoveredEntityRef) {
    drawSelectionOutline([hoveredEntityRef], {
      color: "#ff546f",
      opacity: 0.88,
      padding: 0.12,
    });
  } else if ((transformMode === "move" || transformMode === "scale" || transformMode === "rotate") && hoveredEntityRef && !isEntitySelected(hoveredEntityRef.kind, hoveredEntityRef.id)) {
    drawSelectionOutline([hoveredEntityRef], {
      color: transformMode === "scale" ? "#7fe46a" : transformMode === "rotate" ? "#ffb15a" : "#7fc9ff",
      opacity: 0.5,
      padding: 0.1,
    });
  }
  if ((transformMode === "move" || transformMode === "multi") && groupFrame) {
    buildTransformHandles(preview, groupFrame, displayedHandleKey, axisLock ? displayedHandleKey : "");
  } else if (transformMode === "scale" && groupFrame && canScaleSelection(selectedEntities)) {
    if (canAxisScaleSelection(selectedEntities)) {
      buildTransformHandles(preview, groupFrame, displayedHandleKey, axisLock ? displayedHandleKey : "");
    }
  } else if (transformMode === "rotate" && groupFrame && canRotateSelection(selectedEntities)) {
    buildRotateHandles(preview, groupFrame, axisLock ? "" : displayedHandleKey, axisLock);
  }
  preview.buildOverlay.updateMatrixWorld(true);
  preview.buildOverlayKey = overlayKey;
}

function raycastPreviewPointer(event) {
  const metrics = getPreviewPointerMetrics(event);
  if (!metrics) {
    return null;
  }
  const { preview, pointer } = metrics;
  preview.raycaster.setFromCamera(pointer, preview.camera);
  return getFirstPreviewEntityHit(preview.raycaster.intersectObjects(preview.entityPickables, false));
}

function getBuildDragPoint(event, plane) {
  const metrics = getPreviewPointerMetrics(event);
  if (!metrics || !plane) {
    return null;
  }
  const { preview, pointer } = metrics;
  preview.raycaster.setFromCamera(pointer, preview.camera);
  const point = new THREE.Vector3();
  return preview.raycaster.ray.intersectPlane(plane, point) ? point : null;
}

function getBuildDragAxisVector(axis, frame = null) {
  const vector = getBaseBuildAxisVector(axis);
  if (frame?.oriented && frame.quaternion) {
    vector.applyQuaternion(frame.quaternion).normalize();
  }
  return vector;
}

function getBuildDragAxisPlane(axis, origin, preview = state.preview, axisVectorOverride = null) {
  if (!preview?.camera) {
    return null;
  }
  const axisVector = axisVectorOverride?.clone?.() ?? getBuildDragAxisVector(axis);
  const cameraDirection = new THREE.Vector3();
  preview.camera.getWorldDirection(cameraDirection);
  let tangent = new THREE.Vector3().crossVectors(cameraDirection, axisVector);
  if (tangent.lengthSq() < 0.0001) {
    tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axisVector);
  }
  if (tangent.lengthSq() < 0.0001) {
    tangent = new THREE.Vector3(1, 0, 0);
  }
  const planeNormal = new THREE.Vector3().crossVectors(axisVector, tangent).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, origin);
}

function createBuildAxisScreenDrag(pointerSource, axisVector, pivot, frame = null) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  if (!metrics || !axisVector || !pivot) {
    return null;
  }
  const axisLength = Math.max(
    1,
    Number(frame?.size?.x ?? 0),
    Number(frame?.size?.y ?? 0),
    Number(frame?.size?.z ?? 0),
  );
  const sampleWorld = clampNumber(axisLength * 0.3, 1, 0.8, 4);
  const projectedPivot = projectWorldPointToPreviewScreen(pivot, metrics.preview, metrics.rect);
  const projectedAxis = projectWorldPointToPreviewScreen(
    pivot.clone().addScaledVector(axisVector, sampleWorld),
    metrics.preview,
    metrics.rect,
  );
  if (projectedPivot && projectedAxis) {
    const axisScreen = new THREE.Vector2(
      projectedAxis.x - projectedPivot.x,
      projectedAxis.y - projectedPivot.y,
    );
    const axisPixels = axisScreen.length();
    if (axisPixels >= 10) {
      axisScreen.normalize();
      return {
        kind: "linear-axis",
        startX: metrics.canvasX,
        startY: metrics.canvasY,
        directionX: axisScreen.x,
        directionY: axisScreen.y,
        worldUnitsPerPixel: sampleWorld / axisPixels,
      };
    }
  }
  const cameraDirection = new THREE.Vector3();
  metrics.preview.camera.getWorldDirection(cameraDirection);
  const axisAlignment = axisVector.clone().normalize().dot(cameraDirection.normalize());
  const worldUnitsPerPixel = getPreviewWorldUnitsPerPixel(
    metrics.preview.camera.position.distanceTo(pivot),
    metrics.preview,
    metrics.rect,
  ) * 1.35;
  return {
    kind: "linear-axis",
    startX: metrics.canvasX,
    startY: metrics.canvasY,
    directionX: 0,
    directionY: -1,
    worldUnitsPerPixel: worldUnitsPerPixel * (axisAlignment >= 0 ? 1 : -1),
  };
}

function createBuildRotateScreenDrag(pointerSource, frame, handle, axisVector, pivot) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  if (!metrics || !frame || !handle || !axisVector || !pivot) {
    return null;
  }
  const frameQuaternion = frame.quaternion ?? new THREE.Quaternion();
  const maxSize = Math.max(frame.size.x, frame.size.y, frame.size.z);
  const handleThickness = clampNumber(maxSize * 0.1, 0.72, 0.5, 1.5);
  const handleOffset = Math.max(0.18, handleThickness * 0.4);
  const handleSpec = getRotateHandleSpecs(frame).find((entry) => entry.key === handle.key);
  if (!handleSpec) {
    return null;
  }
  const outward = handleSpec.position.clone();
  if (outward.lengthSq() < 0.0001) {
    outward.copy(getBuildDragAxisVector(handle.axis, frame));
  } else {
    outward.applyQuaternion(frameQuaternion).normalize();
  }
  const handlePosition = handleSpec.position
    .clone()
    .applyQuaternion(frameQuaternion)
    .add(pivot)
    .addScaledVector(outward, handleOffset);
  const projectedPivot = projectWorldPointToPreviewScreen(pivot, metrics.preview, metrics.rect);
  const projectedHandle = projectWorldPointToPreviewScreen(handlePosition, metrics.preview, metrics.rect);
  const radial = handlePosition.clone().sub(pivot);
  const tangent = new THREE.Vector3().crossVectors(axisVector, radial);
  if (projectedPivot && projectedHandle && tangent.lengthSq() > 0.0001) {
    const tangentSampleDistance = clampNumber(radial.length() * 0.35, 1, 0.8, 3);
    const projectedTangent = projectWorldPointToPreviewScreen(
      handlePosition.clone().addScaledVector(tangent.normalize(), tangentSampleDistance),
      metrics.preview,
      metrics.rect,
    );
    if (projectedTangent) {
      const tangentScreen = new THREE.Vector2(
        projectedTangent.x - projectedHandle.x,
        projectedTangent.y - projectedHandle.y,
      );
      const tangentPixels = tangentScreen.length();
      const radiusPixels = Math.hypot(
        projectedHandle.x - projectedPivot.x,
        projectedHandle.y - projectedPivot.y,
      );
      if (tangentPixels >= 8 && radiusPixels >= 18) {
        tangentScreen.normalize();
        return {
          kind: "rotate-axis",
          mode: "linear",
          startX: metrics.canvasX,
          startY: metrics.canvasY,
          directionX: tangentScreen.x,
          directionY: tangentScreen.y,
          radiansPerPixel: 1 / radiusPixels,
        };
      }
    }
  }
  if (!projectedPivot) {
    return null;
  }
  const cameraDirection = new THREE.Vector3();
  metrics.preview.camera.getWorldDirection(cameraDirection);
  return {
    kind: "rotate-axis",
    mode: "angle",
    centerX: projectedPivot.x,
    centerY: projectedPivot.y,
    startAngle: Math.atan2(
      metrics.canvasY - projectedPivot.y,
      metrics.canvasX - projectedPivot.x,
    ),
    angleSign: axisVector.clone().normalize().dot(cameraDirection.normalize()) >= 0 ? 1 : -1,
  };
}

function getBuildScreenDragAmount(pointerSource, screenDrag) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  if (!metrics || screenDrag?.kind !== "linear-axis") {
    return null;
  }
  const deltaX = metrics.canvasX - screenDrag.startX;
  const deltaY = metrics.canvasY - screenDrag.startY;
  return (
    deltaX * (screenDrag.directionX ?? 0)
    + deltaY * (screenDrag.directionY ?? 0)
  ) * (screenDrag.worldUnitsPerPixel ?? 0);
}

function getBuildScreenDragAngle(pointerSource, screenDrag) {
  const metrics = getPreviewPointerMetrics(pointerSource);
  if (!metrics || screenDrag?.kind !== "rotate-axis") {
    return null;
  }
  if (screenDrag.mode === "linear") {
    const deltaX = metrics.canvasX - screenDrag.startX;
    const deltaY = metrics.canvasY - screenDrag.startY;
    return (
      deltaX * (screenDrag.directionX ?? 0)
      + deltaY * (screenDrag.directionY ?? 0)
    ) * (screenDrag.radiansPerPixel ?? 0);
  }
  const currentAngle = Math.atan2(
    metrics.canvasY - (screenDrag.centerY ?? 0),
    metrics.canvasX - (screenDrag.centerX ?? 0),
  );
  return normalizeAngle((currentAngle - (screenDrag.startAngle ?? 0)) * (screenDrag.angleSign ?? 1));
}

function getBuildMoveStep(kind) {
  return kind === "trigger" ? 0.25 : 0.1;
}

function getBuildScaleStep(kind) {
  return kind === "trigger" ? 0.25 : 0.1;
}

function getBuildScaleMinimum(kind, axis = "x") {
  if (kind === "panel" && axis === "z") {
    return 0.05;
  }
  if (kind === "screen" && axis === "z") {
    return 0.05;
  }
  if (kind === "text") {
    return 0.2;
  }
  return 0.1;
}

function setEntityPositionValue(selection, entry, axis, value) {
  entry.position = entry.position || { x: 0, y: 0, z: 0 };
  entry.position[axis] = snapBuildValue(value, getBuildMoveStep(selection.kind));
}

function applyPositionScaleAroundPivot(selection, entry, factors, pivot) {
  if (!pivot) {
    return;
  }
  const startPosition = selection.startPosition ?? { x: 0, y: 0, z: 0 };
  entry.position = entry.position || { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"]) {
    const axisFactor = Number(factors?.[axis] ?? 1) || 1;
    const pivotValue = Number(pivot[axis] ?? 0) || 0;
    const nextValue = pivotValue + ((Number(startPosition[axis] ?? 0) || 0) - pivotValue) * axisFactor;
    setEntityPositionValue(selection, entry, axis, nextValue);
  }
}

function applyGroupUniformScaleToEntity(selection, entry, factor, pivot) {
  applyUniformScaleToEntity(selection, entry, factor);
  applyPositionScaleAroundPivot(selection, entry, { x: factor, y: factor, z: factor }, pivot);
}

function applyGroupAxisScaleToEntity(selection, entry, axis, factor, pivot) {
  if (typeof selection.startScale !== "object" || !pivot) {
    return;
  }
  entry.scale = entry.scale || { x: 1, y: 1, z: 1 };
  for (const currentAxis of ["x", "y", "z"]) {
    const baseValue = Number(selection.startScale?.[currentAxis] ?? entry.scale?.[currentAxis] ?? 1) || 1;
    entry.scale[currentAxis] = currentAxis === axis
      ? clampNumber(
        snapBuildValue(baseValue * factor, getBuildScaleStep(selection.kind)),
        baseValue,
        getBuildScaleMinimum(selection.kind, currentAxis),
        128,
      )
      : baseValue;
  }
  applyPositionScaleAroundPivot(selection, entry, {
    x: axis === "x" ? factor : 1,
    y: axis === "y" ? factor : 1,
    z: axis === "z" ? factor : 1,
  }, pivot);
}

function getSignedAngleAroundAxis(startVector, currentVector, axisVector) {
  const start = startVector.clone().projectOnPlane(axisVector);
  const current = currentVector.clone().projectOnPlane(axisVector);
  if (start.lengthSq() < 0.0001 || current.lengthSq() < 0.0001) {
    return 0;
  }
  start.normalize();
  current.normalize();
  const cross = new THREE.Vector3().crossVectors(start, current);
  return Math.atan2(cross.dot(axisVector), start.dot(current));
}

function applyRotationToEntity(selection, entry, axis, angle, pivot, axisVectorOverride = null) {
  if (!canRotateEntityKind(selection.kind) || !pivot) {
    return;
  }
  const axisVector = (axisVectorOverride?.clone?.() ?? getBuildDragAxisVector(axis)).normalize();
  const startPosition = selection.startPosition ?? { x: 0, y: 0, z: 0 };
  const nextPosition = new THREE.Vector3(
    Number(startPosition.x ?? 0) || 0,
    Number(startPosition.y ?? 0) || 0,
    Number(startPosition.z ?? 0) || 0,
  ).sub(pivot).applyAxisAngle(axisVector, angle).add(pivot);
  for (const currentAxis of ["x", "y", "z"]) {
    setEntityPositionValue(selection, entry, currentAxis, nextPosition[currentAxis]);
  }
  entry.rotation = entry.rotation || { x: 0, y: 0, z: 0 };
  const startRotation = selection.startRotation ?? { x: 0, y: 0, z: 0 };
  const startEuler = new THREE.Euler(
    Number(startRotation.x ?? 0) || 0,
    Number(startRotation.y ?? 0) || 0,
    Number(startRotation.z ?? 0) || 0,
    "XYZ",
  );
  const startQuaternion = new THREE.Quaternion().setFromEuler(startEuler);
  const localAxis = getBaseBuildAxisVector(axis).normalize();
  const localWorldAxis = localAxis.clone().applyQuaternion(startQuaternion).normalize();
  const rotateInLocalSpace = !axisVectorOverride || localWorldAxis.dot(axisVector) > 0.999;
  const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(
    rotateInLocalSpace ? localAxis : axisVector,
    angle,
  );
  const nextQuaternion = rotateInLocalSpace
    ? startQuaternion.clone().multiply(deltaQuaternion)
    : deltaQuaternion.clone().multiply(startQuaternion);
  const nextEuler = new THREE.Euler().setFromQuaternion(nextQuaternion.normalize(), "XYZ");
  entry.rotation.x = roundPrivateValue(nextEuler.x);
  entry.rotation.y = roundPrivateValue(nextEuler.y);
  entry.rotation.z = roundPrivateValue(nextEuler.z);
}

function applyFreeMoveToEntity(selection, entry, delta) {
  const startPosition = selection.startPosition ?? { x: 0, y: 0, z: 0 };
  entry.position = entry.position || { x: 0, y: 0, z: 0 };
  if (selection.kind === "voxel") {
    const snapped = snapVoxelPositionToGrid(
      {
        x: startPosition.x + delta.x,
        y: startPosition.y,
        z: startPosition.z + delta.z,
      },
      entry.scale,
      state.selectedWorld,
    );
    entry.position.x = snapped.x;
    entry.position.y = snapped.y;
    entry.position.z = snapped.z;
    return;
  }
  const step = getBuildMoveStep(selection.kind);
  entry.position.x = snapBuildValue(startPosition.x + delta.x, step);
  entry.position.z = snapBuildValue(startPosition.z + delta.z, step);
  entry.position.y = startPosition.y;
}

function applyAxisMoveToEntity(selection, entry, axis, amount, axisVector = null) {
  const startPosition = selection.startPosition ?? { x: 0, y: 0, z: 0 };
  entry.position = entry.position || { x: 0, y: 0, z: 0 };
  entry.position.x = startPosition.x;
  entry.position.y = startPosition.y;
  entry.position.z = startPosition.z;
  if (selection.kind === "voxel") {
    const voxelScale = getPrivateVoxelScale(entry.scale);
    if (axis === "x") {
      entry.position.x = snapVoxelAxisToGrid(startPosition.x + amount, voxelScale.x, "x", state.selectedWorld);
    } else if (axis === "y") {
      entry.position.y = snapVoxelElevationToGrid(startPosition.y + amount, voxelScale.y, state.selectedWorld);
    } else {
      entry.position.z = snapVoxelAxisToGrid(startPosition.z + amount, voxelScale.z, "z", state.selectedWorld);
    }
    return;
  }
  const step = getBuildMoveStep(selection.kind);
  if (axisVector?.lengthSq?.() > 0.0001) {
    const nextPosition = new THREE.Vector3(
      Number(startPosition.x ?? 0) || 0,
      Number(startPosition.y ?? 0) || 0,
      Number(startPosition.z ?? 0) || 0,
    ).addScaledVector(axisVector, amount);
    entry.position.x = snapBuildValue(nextPosition.x, step);
    entry.position.y = snapBuildValue(nextPosition.y, step);
    entry.position.z = snapBuildValue(nextPosition.z, step);
    return;
  }
  entry.position[axis] = snapBuildValue(startPosition[axis] + amount, step);
}

function applyUniformScaleToEntity(selection, entry, factor) {
  if (!canScaleEntityKind(selection.kind)) {
    return;
  }
  const nextFactor = clampNumber(factor, factor, 0.2, 24);
  if (typeof selection.startScale === "number") {
    entry.scale = clampNumber(
      snapBuildValue(selection.startScale * nextFactor, getBuildScaleStep(selection.kind)),
      selection.startScale,
      getBuildScaleMinimum(selection.kind),
      64,
    );
    return;
  }
  entry.scale = entry.scale || { x: 1, y: 1, z: 1 };
  for (const axis of ["x", "y", "z"]) {
    const baseValue = Number(selection.startScale?.[axis] ?? 1) || 1;
    entry.scale[axis] = clampNumber(
      snapBuildValue(baseValue * nextFactor, getBuildScaleStep(selection.kind)),
      baseValue,
      getBuildScaleMinimum(selection.kind, axis),
      128,
    );
  }
}

function applyAxisScaleToEntity(selection, entry, axis, direction, amount, axisVector = null) {
  if (typeof selection.startScale !== "object") {
    return;
  }
  entry.position = entry.position || { x: 0, y: 0, z: 0 };
  entry.scale = entry.scale || { x: 1, y: 1, z: 1 };
  entry.position.x = selection.startPosition?.x ?? 0;
  entry.position.y = selection.startPosition?.y ?? 0;
  entry.position.z = selection.startPosition?.z ?? 0;
  const startSize = Number(selection.startScale?.[axis] ?? 1) || 1;
  const nextSize = clampNumber(
    snapBuildValue(startSize + amount * direction, getBuildScaleStep(selection.kind)),
    startSize,
    getBuildScaleMinimum(selection.kind, axis),
    128,
  );
  const appliedDelta = (nextSize - startSize) * direction;
  entry.scale[axis] = nextSize;
  if (axisVector?.lengthSq?.() > 0.0001) {
    const nextPosition = new THREE.Vector3(
      Number(selection.startPosition?.x ?? 0) || 0,
      Number(selection.startPosition?.y ?? 0) || 0,
      Number(selection.startPosition?.z ?? 0) || 0,
    ).addScaledVector(axisVector, appliedDelta / 2);
    const step = getBuildMoveStep(selection.kind);
    entry.position.x = snapBuildValue(nextPosition.x, step);
    entry.position.y = snapBuildValue(nextPosition.y, step);
    entry.position.z = snapBuildValue(nextPosition.z, step);
    return;
  }
  entry.position[axis] = snapBuildValue(
    (selection.startPosition?.[axis] ?? 0) + appliedDelta / 2,
    getBuildMoveStep(selection.kind),
  );
}

function beginBuildDrag(event, hit = raycastPreviewPointer(event)) {
  const requestedTransformMode = getBuildTransformMode();
  if (!requestedTransformMode || requestedTransformMode === "delete") {
    return false;
  }
  let directHandleHit = getTransformHandleHit(event);
  const hoveredEntityRef = state.buildHover?.entityRef ?? getEntityRefFromHit(hit);
  let hoveredHandle = directHandleHit?.object?.userData?.privateWorldTransformHandle
    ? { ...directHandleHit.object.userData.privateWorldTransformHandle }
    : (state.buildHover?.transformHandle ?? null);
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    return false;
  }
  let selectedEntities = getSelectedEntities(sceneDoc);
  const transformMode = resolveBuildTransformModeForSelection(requestedTransformMode, selectedEntities);
  if (transformMode === "multi" && hoveredEntityRef && !isEntitySelected(hoveredEntityRef.kind, hoveredEntityRef.id) && !hoveredHandle) {
    return false;
  }
  if (
    requestedTransformMode === transformMode
    && (transformMode === "move" || transformMode === "scale" || transformMode === "rotate")
    && !hoveredHandle
    && hoveredEntityRef
    && !isEntitySelected(hoveredEntityRef.kind, hoveredEntityRef.id)
  ) {
    setBuilderSelection(hoveredEntityRef.kind, hoveredEntityRef.id);
    try {
      sceneDoc = parseSceneTextarea();
      selectedEntities = getSelectedEntities(sceneDoc);
    } catch (_error) {
      return false;
    }
    directHandleHit = getTransformHandleHit(event);
    hoveredHandle = directHandleHit?.object?.userData?.privateWorldTransformHandle
      ? { ...directHandleHit.object.userData.privateWorldTransformHandle }
      : hoveredHandle;
  }
  if (!selectedEntities.length) {
    return false;
  }
  if (transformMode === "scale" && !canScaleSelection(selectedEntities)) {
    return false;
  }
  if (transformMode === "rotate" && !canRotateSelection(selectedEntities)) {
    return false;
  }
  const selectionRefs = getBuilderSelectionRefs();
  const selectionFrame = getOverlayFrameForRefs(state.preview, selectionRefs);
  if (!selectionFrame) {
    return false;
  }
  const handleFrame = expandOverlayFrame(selectionFrame, getSelectionOutlinePadding(selectionRefs.length));
  const pivot = selectionFrame.center.clone();
  let plane = null;
  let startPoint = null;
  let axis = null;
  let axisVector = null;
  let direction = 0;
  let screenDrag = null;
  let dragType = transformMode === "scale" ? "scale-uniform" : "move-plane";
  if (hoveredHandle) {
    axis = hoveredHandle.axis;
    axisVector = getBuildDragAxisVector(axis, selectionFrame);
    if (transformMode === "rotate") {
      if (hoveredHandle.type !== "rotate") {
        return false;
      }
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVector, pivot);
      startPoint = getBuildDragPoint(event, plane);
      screenDrag = createBuildRotateScreenDrag(event, handleFrame, hoveredHandle, axisVector, pivot);
      if (!startPoint && !screenDrag) {
        return false;
      }
      dragType = "rotate-axis";
    } else {
      if (hoveredHandle.type === "rotate") {
        return false;
      }
      direction = hoveredHandle.direction;
      plane = getBuildDragAxisPlane(axis, pivot, state.preview, axisVector);
      startPoint = getBuildDragPoint(event, plane);
      screenDrag = createBuildAxisScreenDrag(event, axisVector, pivot, handleFrame);
      if (!startPoint && !screenDrag) {
        return false;
      }
      dragType = transformMode === "scale" ? "scale-axis" : "move-axis";
    }
  } else if (transformMode === "scale") {
    if (!hoveredEntityRef || !selectedEntities.some((selection) => isSameEntityRef(hoveredEntityRef, { kind: selection.kind, id: selection.entry.id }))) {
      return false;
    }
  } else if (transformMode === "rotate") {
    return false;
  } else {
    if (!hoveredEntityRef || !canMoveEntityKind(hoveredEntityRef.kind)) {
      return false;
    }
    const planeY = pivot.y;
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    startPoint = getBuildDragPoint(event, plane);
    if (!startPoint) {
      return false;
    }
  }
  state.buildDrag = {
    pointerId: event.pointerId,
    type: dragType,
    plane,
    axis,
    axisVector: axisVector?.clone?.() ?? null,
    direction,
    handle: hoveredHandle ? { ...hoveredHandle } : null,
    pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
    startPoint: startPoint?.clone?.() ?? null,
    startVector: dragType === "rotate-axis"
      ? (startPoint ? startPoint.clone().sub(pivot) : null)
      : null,
    screenDrag,
    preferScreenDrag: Boolean(hoveredHandle && screenDrag),
    startBoundsSize: selectionFrame.size.clone(),
    startClientX: event.clientX,
    startClientY: event.clientY,
    selection: selectedEntities.map((selection) => ({
      ref: { kind: selection.kind, id: selection.entry.id },
      kind: selection.kind,
      startPosition: deepClone(selection.entry.position ?? { x: 0, y: 0, z: 0 }),
      startRotation: deepClone(selection.entry.rotation ?? { x: 0, y: 0, z: 0 }),
      startScale: typeof selection.entry.scale === "number"
        ? Number(selection.entry.scale)
        : deepClone(selection.entry.scale ?? { x: 1, y: 1, z: 1 }),
    })),
    moved: false,
  };
  syncBuildPlacementOverlay();
  return true;
}

function updateBuildDrag(event) {
  if (!state.buildDrag || state.buildDrag.pointerId !== event.pointerId) {
    return false;
  }
  let amount = 0;
  let factor = 1;
  let angle = 0;
  if (
    state.buildDrag.type === "move-plane"
    || state.buildDrag.type === "move-axis"
    || state.buildDrag.type === "scale-axis"
    || state.buildDrag.type === "rotate-axis"
  ) {
    const preferScreenDrag = Boolean(state.buildDrag.preferScreenDrag && state.buildDrag.screenDrag);
    const screenAmount = preferScreenDrag
      && (state.buildDrag.type === "move-axis" || state.buildDrag.type === "scale-axis")
      ? getBuildScreenDragAmount(event, state.buildDrag.screenDrag)
      : null;
    const screenAngle = preferScreenDrag && state.buildDrag.type === "rotate-axis"
      ? getBuildScreenDragAngle(event, state.buildDrag.screenDrag)
      : null;
    const point = (
      (state.buildDrag.type === "move-plane")
      || (!Number.isFinite(screenAmount) && !Number.isFinite(screenAngle))
    )
      ? getBuildDragPoint(event, state.buildDrag.plane)
      : null;
    const hasPlanePoint = Boolean(point && state.buildDrag.startPoint);
    const delta = hasPlanePoint
      ? new THREE.Vector3().subVectors(point, state.buildDrag.startPoint)
      : new THREE.Vector3();
    const axisVector = state.buildDrag.axisVector?.clone?.()
      ?? getBuildDragAxisVector(state.buildDrag.axis);
    if (state.buildDrag.type === "move-plane") {
      if (!hasPlanePoint) {
        return false;
      }
      amount = 0;
      state.buildDrag.delta = delta;
      state.buildDrag.moved = state.buildDrag.moved || delta.lengthSq() > 0.0004;
    } else if (state.buildDrag.type === "rotate-axis") {
      if (Number.isFinite(screenAngle)) {
        angle = screenAngle;
      } else if (hasPlanePoint) {
        const pivot = new THREE.Vector3(
          Number(state.buildDrag.pivot?.x ?? 0) || 0,
          Number(state.buildDrag.pivot?.y ?? 0) || 0,
          Number(state.buildDrag.pivot?.z ?? 0) || 0,
        );
        const startVector = state.buildDrag.startVector?.clone?.() ?? null;
        const currentVector = point.clone().sub(pivot);
        if (!startVector) {
          return false;
        }
        angle = getSignedAngleAroundAxis(startVector, currentVector, axisVector);
      } else {
        angle = getBuildScreenDragAngle(event, state.buildDrag.screenDrag);
        if (!Number.isFinite(angle)) {
          return false;
        }
      }
      state.buildDrag.moved = state.buildDrag.moved || Math.abs(angle) > 0.01;
    } else {
      amount = Number.isFinite(screenAmount)
        ? screenAmount
        : hasPlanePoint
          ? delta.dot(axisVector)
          : getBuildScreenDragAmount(event, state.buildDrag.screenDrag);
      if (!Number.isFinite(amount)) {
        return false;
      }
      state.buildDrag.moved = state.buildDrag.moved || Math.abs(amount) > 0.02;
    }
  } else if (state.buildDrag.type === "scale-uniform") {
    const pixelDelta = (event.clientX - state.buildDrag.startClientX) - (event.clientY - state.buildDrag.startClientY);
    factor = clampNumber(1 + pixelDelta * 0.01, 1, 0.2, 24);
    state.buildDrag.moved = state.buildDrag.moved || Math.abs(pixelDelta) > 2;
  }
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const selectionCount = state.buildDrag?.selection?.length ?? 0;
    const isGroupSelection = selectionCount > 1;
    const pivot = state.buildDrag?.pivot
      ? new THREE.Vector3(state.buildDrag.pivot.x, state.buildDrag.pivot.y, state.buildDrag.pivot.z)
      : null;
    const axisFactor = state.buildDrag?.type === "scale-axis"
      ? clampNumber(
        1 + (amount * (state.buildDrag.direction || 1)) / Math.max(0.2, Number(state.buildDrag.startBoundsSize?.[state.buildDrag.axis] ?? 1) || 1),
        1,
        0.2,
        24,
      )
      : 1;
    for (const selection of state.buildDrag?.selection ?? []) {
      const current = findEntityByRef(sceneDoc, selection.ref);
      if (!current?.entry) {
        continue;
      }
      if (state.buildDrag.type === "move-plane") {
        applyFreeMoveToEntity(selection, current.entry, state.buildDrag.delta ?? new THREE.Vector3());
      } else if (state.buildDrag.type === "move-axis") {
        applyAxisMoveToEntity(selection, current.entry, state.buildDrag.axis, amount, state.buildDrag.axisVector);
      } else if (state.buildDrag.type === "scale-axis") {
        if (isGroupSelection) {
          applyGroupAxisScaleToEntity(selection, current.entry, state.buildDrag.axis, axisFactor, pivot);
        } else {
          applyAxisScaleToEntity(
            selection,
            current.entry,
            state.buildDrag.axis,
            state.buildDrag.direction,
            amount,
            state.buildDrag.axisVector,
          );
        }
      } else if (state.buildDrag.type === "scale-uniform") {
        if (isGroupSelection) {
          applyGroupUniformScaleToEntity(selection, current.entry, factor, pivot);
        } else {
          applyUniformScaleToEntity(selection, current.entry, factor);
        }
      } else if (state.buildDrag.type === "rotate-axis") {
        applyRotationToEntity(
          selection,
          current.entry,
          state.buildDrag.axis,
          angle,
          pivot,
          state.buildDrag.axisVector,
        );
      }
    }
  });
  return true;
}

function endBuildDrag(pointerId = 0, pointerEvent = null) {
  if (!state.buildDrag || (pointerId && state.buildDrag.pointerId !== pointerId)) {
    return;
  }
  if (state.buildDrag.moved && pointerEvent) {
    recordBuildSuppressedClick(pointerEvent);
  }
  state.buildDrag = null;
  syncBuildPlacementOverlay();
}

function buildPlacementEntry(kind, sceneDoc, placement) {
  if (!placement?.position) {
    return null;
  }
  if (kind === "voxel") {
    const nextId = `voxel_${(sceneDoc.voxels?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.voxels = sceneDoc.voxels || [];
        sceneDoc.voxels.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
        });
      },
    };
  }
  if (kind === "primitive") {
    const nextId = `primitive_${(sceneDoc.primitives?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.primitives = sceneDoc.primitives || [];
        sceneDoc.primitives.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
        });
      },
    };
  }
  if (kind === "panel") {
    const nextId = `panel_${(sceneDoc.panels?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.panels = sceneDoc.panels || [];
        sceneDoc.panels.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
          label: presetEntry.label && !/^panel(?:\s+\d+)?$/i.test(String(presetEntry.label).trim())
            ? presetEntry.label
            : `Panel ${(sceneDoc.panels?.length ?? 0) + 1}`,
        });
      },
    };
  }
  if (kind === "player") {
    const nextId = `player_${(sceneDoc.players?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.players = sceneDoc.players || [];
        sceneDoc.players.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
          label: presetEntry.label && !/^player(?:\s+\d+)?$/i.test(String(presetEntry.label).trim())
            ? presetEntry.label
            : `Player ${(sceneDoc.players?.length ?? 0) + 1}`,
        });
      },
    };
  }
  if (kind === "screen") {
    const nextId = `screen_${(sceneDoc.screens?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.screens = sceneDoc.screens || [];
        sceneDoc.screens.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
        });
      },
    };
  }
  if (kind === "text") {
    const nextId = `text_${(sceneDoc.texts?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.texts = sceneDoc.texts || [];
        sceneDoc.texts.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
        });
      },
    };
  }
  if (kind === "trigger") {
    const nextId = `trigger_${(sceneDoc.trigger_zones?.length ?? 0) + 1}`;
    const presetEntry = extractToolPresetEntry(kind, getToolPreset(kind)?.entry);
    return {
      kind,
      id: nextId,
      push() {
        sceneDoc.trigger_zones = sceneDoc.trigger_zones || [];
        sceneDoc.trigger_zones.push({
          id: nextId,
          position: deepClone(placement.position),
          ...deepClone(presetEntry),
        });
      },
    };
  }
  return null;
}

function placeActiveTool(placement = state.buildHover?.placement, toolKind = getActivePlacementTool()) {
  const prefabPlacementId = getActivePrefabPlacementId();
  if (prefabPlacementId) {
    if (!placement || placement.kind !== "prefab" || placement.prefabId !== prefabPlacementId || placement.valid === false) {
      return false;
    }
    return placeSelectedPrefab(prefabPlacementId, placement);
  }
  if (!toolKind || placement?.kind !== toolKind || placement?.valid === false) {
    return false;
  }
  let placed = false;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const nextEntry = buildPlacementEntry(toolKind, sceneDoc, placement);
    if (!nextEntry) {
      return;
    }
    nextEntry.push();
    writeBuilderSelection([{ kind: nextEntry.kind, id: nextEntry.id }], { kind: nextEntry.kind, id: nextEntry.id });
    placed = true;
  });
  if (placed) {
    refreshBuildHoverFromStoredPointer();
  }
  return placed;
}

function adjustSelectedEntityByWheel(event) {
  if (!isEditor() || state.mode !== "build" || !hasBuilderSelection() || getBuilderSelectionRefs().length !== 1) {
    return false;
  }
  const rotateMode = event.shiftKey && getBuildTransformMode() !== "multi";
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

  if (isPrivateOriginShareLocked()) {
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
  const player = getPossessedPreviewPlayer(preview);
  if (!player) {
    return false;
  }
  const yaw = Number(player.rotation?.y ?? 0) || 0;
  const scale = Math.max(0.25, Number(player.scale ?? PRIVATE_PLAYER_DEFAULT_SCALE) || PRIVATE_PLAYER_DEFAULT_SCALE);
  const eyeOffset = (PRIVATE_PLAYER_METRICS.eyeHeight - PRIVATE_PLAYER_METRICS.height / 2) * scale;
  if (player.camera_mode === "first_person") {
    preview.camera.position.set(player.position.x, player.position.y + eyeOffset, player.position.z);
    preview.camera.lookAt(
      player.position.x + Math.sin(yaw) * PRIVATE_PLAYER_CAMERA.firstPersonLookDistance * scale,
      player.position.y + eyeOffset,
      player.position.z - Math.cos(yaw) * PRIVATE_PLAYER_CAMERA.firstPersonLookDistance * scale,
    );
    return true;
  }
  if (player.camera_mode === "top_down") {
    preview.camera.position.set(
      player.position.x,
      player.position.y + PRIVATE_PLAYER_CAMERA.topDownHeight * scale,
      player.position.z + 0.01,
    );
    preview.camera.lookAt(player.position.x, player.position.y + eyeOffset, player.position.z);
    return true;
  }
  preview.camera.position.set(
    player.position.x - Math.sin(yaw) * PRIVATE_PLAYER_CAMERA.thirdPersonDistance * scale,
    player.position.y + PRIVATE_PLAYER_CAMERA.thirdPersonHeight * scale,
    player.position.z + Math.cos(yaw) * PRIVATE_PLAYER_CAMERA.thirdPersonDistance * scale,
  );
  preview.camera.lookAt(player.position.x, player.position.y + eyeOffset, player.position.z);
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

function buildPrivateSkyDome(theme = PRIVATE_WORLD_STYLE) {
  if (!Array.isArray(theme.skyGradient) || theme.skyGradient.length === 0) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  for (const stop of theme.skyGradient) {
    gradient.addColorStop(clampNumber(stop.stop, 0, 0, 1), stop.color);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const starCount = Math.max(0, Math.floor(Number(theme.stars) || 0));
  if (starCount > 0) {
    for (let index = 0; index < starCount; index += 1) {
      const normalizedX = ((index * 67) % 97) / 97;
      const normalizedY = ((index * 43) % 71) / 71;
      const radius = 0.6 + ((index * 29) % 5) * 0.16;
      const alpha = 0.35 + (((index * 17) % 7) / 10);
      context.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      context.beginPath();
      context.arc(
        normalizedX * canvas.width,
        normalizedY * canvas.height * 0.62,
        radius,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 18),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
}

function applyPrivatePreviewAtmosphere(preview, theme = buildPrivateSceneEnvironmentTheme()) {
  if (!preview?.scene) {
    return;
  }
  if (preview.scene.background?.isColor) {
    preview.scene.background.set(theme.background);
  } else {
    preview.scene.background = new THREE.Color(theme.background);
  }
  if (preview.scene.fog?.isFog) {
    preview.scene.fog.color.set(theme.fog);
    preview.scene.fog.near = theme.skybox === "night" ? 120 : 170;
    preview.scene.fog.far = theme.skybox === "night" ? 1120 : 1600;
  } else {
    preview.scene.fog = new THREE.Fog(
      theme.fog,
      theme.skybox === "night" ? 120 : 170,
      theme.skybox === "night" ? 1120 : 1600,
    );
  }
  if (preview.ambientLight) {
    preview.ambientLight.color.set(theme.ambientSky);
    preview.ambientLight.groundColor.set(theme.ambientGround);
    preview.ambientLight.intensity = theme.ambientIntensity;
  }
  if (preview.sunLight) {
    preview.sunLight.color.set(theme.sunColor);
    preview.sunLight.intensity = theme.sunIntensity;
    preview.sunLight.position.set(
      theme.sunPosition?.x ?? 120,
      theme.sunPosition?.y ?? 280,
      theme.sunPosition?.z ?? 80,
    );
  }
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

function refreshPrivatePreviewEnvironment(preview = state.preview, world = state.selectedWorld, sceneDoc = null) {
  if (!preview?.environment) {
    return;
  }
  const sceneEnvironmentSettings = normalizePrivateSceneEnvironmentSettings(
    sceneDoc?.settings
      ?? preview.sceneEnvironmentSettings
      ?? getSelectedScene()?.scene_doc?.settings
      ?? {},
  );
  preview.sceneEnvironmentSettings = sceneEnvironmentSettings;
  const theme = buildPrivateSceneEnvironmentTheme(sceneEnvironmentSettings);
  const bounds = getPrivateWorldBounds(world);
  const nextKey = `${bounds.width}:${bounds.length}:${bounds.height}:${theme.skybox}:${theme.ambient_light}`;
  const nextVisualStateKey = `${nextKey}:${world ? "1" : "0"}:${state.mode}:${isEditor() ? "1" : "0"}:${preview.showGridHint === true ? "1" : "0"}`;
  if (preview.environmentVisualStateKey === nextVisualStateKey) {
    return;
  }
  preview.environmentVisualStateKey = nextVisualStateKey;
  applyPrivatePreviewAtmosphere(preview, theme);
  if (preview.environmentKey === nextKey) {
    syncPrivatePreviewEnvironmentState(preview);
    return;
  }
  preview.environmentKey = nextKey;
  clearPrivatePreviewEnvironment(preview);

  const skyDome = buildPrivateSkyDome(theme);
  if (skyDome) {
    preview.environment.add(skyDome);
  }

  const groundRadius = clampNumber(Math.max(bounds.width, bounds.length) * 0.82, 48, 28, 240);
  const ground = new THREE.Mesh(
    world
      ? new THREE.PlaneGeometry(bounds.width, bounds.length)
      : new THREE.CircleGeometry(groundRadius, 72),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.ground),
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
        color: new THREE.Color(theme.line),
        transparent: true,
        opacity: 0.54,
        fog: false,
      }),
    )
    : new THREE.Mesh(
      new THREE.RingGeometry(groundRadius * 0.985, groundRadius, 96),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(theme.line),
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
  const gridDivisions = Math.max(1, Math.round(gridSize / PRIVATE_WORLD_BLOCK_UNIT));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, theme.gridPrimary, theme.gridSecondary);
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
      color: new THREE.Color(theme.outline),
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
    preview.groundRim.material.opacity = noWorld ? 0.46 : (buildMode ? (showGridHint ? 0.62 : 0.5) : 0.18);
  }
  preview.buildGrid.visible = noWorld || buildMode;
  if (preview.buildGrid.material) {
    const materials = Array.isArray(preview.buildGrid.material)
      ? preview.buildGrid.material
      : [preview.buildGrid.material];
    for (const material of materials) {
      material.opacity = noWorld ? 0.22 : (buildMode ? (showGridHint ? 0.44 : 0.34) : 0);
    }
  }
  if (preview.buildFootprint) {
    preview.buildFootprint.visible = noWorld || buildMode;
    preview.buildFootprint.material.opacity = noWorld ? 0.3 : (buildMode ? (showGridHint ? 0.48 : 0.5) : 0);
  }
}

function buildWorldBoundsPreview(world = state.selectedWorld, theme = buildPrivateSceneEnvironmentTheme()) {
  if (!world) {
    return null;
  }
  const width = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world.width ?? PRIVATE_WORLD_DEFAULT_SIZE.width) || PRIVATE_WORLD_DEFAULT_SIZE.width);
  const length = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 4, Number(world.length ?? PRIVATE_WORLD_DEFAULT_SIZE.length) || PRIVATE_WORLD_DEFAULT_SIZE.length);
  const height = Math.max(PRIVATE_WORLD_BLOCK_UNIT * 2, Number(world.height ?? PRIVATE_WORLD_DEFAULT_SIZE.height) || PRIVATE_WORLD_DEFAULT_SIZE.height);
  const group = new THREE.Group();
  const boundsGeometry = new THREE.BoxGeometry(width, height, length);
  const boundsEdges = new THREE.EdgesGeometry(boundsGeometry);
  const boundsLines = new THREE.LineSegments(
    boundsEdges,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(theme.line),
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
        color: new THREE.Color(theme.outline),
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
  const initialWidth = elements.previewCanvas.clientWidth || 640;
  const initialHeight = elements.previewCanvas.clientHeight || 360;
  const renderer = new THREE.WebGLRenderer({
    canvas: elements.previewCanvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(initialWidth, initialHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PRIVATE_WORLD_STYLE.background);
  scene.fog = new THREE.Fog(PRIVATE_WORLD_STYLE.fog, 170, 1600);

  const camera = new THREE.PerspectiveCamera(58, initialWidth / Math.max(1, initialHeight), 0.1, 2400);
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
    buildOverlay: new THREE.Group(),
    actors: new THREE.Group(),
    presence: new THREE.Group(),
    chatBubbleGhosts: new THREE.Group(),
    browserAnchors: new THREE.Group(),
    browserShares: new THREE.Group(),
    gameShares: new THREE.Group(),
    trails: new THREE.Group(),
    raycaster: new THREE.Raycaster(),
    entityPickables: [],
    transformPickables: [],
    entityMeshes: new Map(),
    billboards: [],
    effectSystems: [],
    animatedChatBubbleGhosts: [],
    trailPuffs: [],
    presenceEntries: new Map(),
    browserAnchorEntries: new Map(),
    browserShareEntries: new Map(),
    gameShareEntries: new Map(),
    lastFrameAt: performance.now(),
    viewportWidth: Math.round(initialWidth),
    viewportHeight: Math.round(initialHeight),
    ambientLight: ambient,
    sunLight,
  };
  buildPreviewEnvironment(state.preview);
  state.preview.scene.add(state.preview.root);
  state.preview.scene.add(state.preview.buildOverlay);
  state.preview.scene.add(state.preview.actors);
  state.preview.scene.add(state.preview.presence);
  state.preview.scene.add(state.preview.browserAnchors);
  state.preview.scene.add(state.preview.browserShares);
  state.preview.scene.add(state.preview.gameShares);
  state.preview.scene.add(state.preview.trails);
  state.preview.scene.add(state.preview.chatBubbleGhosts);
  ensureViewerAvatar(state.preview);
  resetViewerRig();
  syncPrivateCameraToFollowTarget(state.preview);

  const render = (timestamp = performance.now()) => {
    if (!state.preview) {
      return;
    }
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (timestamp - state.preview.lastFrameAt) / 1000));
    state.preview.lastFrameAt = timestamp;
    setPreviewRendererSize(state.preview, elements.previewCanvas.clientWidth || 640, elements.previewCanvas.clientHeight || 360);
    refreshPrivatePreviewEnvironment(state.preview);
    advanceRuntimeVisuals(state.preview, deltaSeconds);
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
    updatePrivateGameBubbles(deltaSeconds, timestamp / 1000);
    updatePrivateRemoteBrowserAudioMix();
    updatePrivateChatBubbleGhosts(state.preview, deltaSeconds, state.preview.camera);
    updatePreviewEffects(state.preview, timestamp / 1000);
    updateViewerTrailPuffs(state.preview, deltaSeconds);
    updatePrivateWorldBillboards(state.preview);
    state.preview.renderer.render(state.preview.scene, state.preview.camera);
    window.requestAnimationFrame(render);
  };

  window.addEventListener("resize", render);
  elements.previewCanvas.addEventListener("pointerdown", (event) => {
    state.previewPointer.clientX = event.clientX;
    state.previewPointer.clientY = event.clientY;
    state.previewPointer.pointerId = event.pointerId;
    state.previewPointer.inside = true;
    refreshBuildHoverFromPointer(event);
    if (state.mode === "build" && isEditor()) {
      if (getActivePlacementTool() || getActivePrefabPlacementId()) {
        privateInputState.pointerDown = false;
        privateInputState.pointerMoved = false;
        privateInputState.dragDistance = 0;
        privateInputState.pointerId = 0;
        state.viewerSuppressClickAt = 0;
        return;
      }
      const transformMode = getBuildTransformMode();
      if (transformMode === "delete" && state.buildHover?.entityRef) {
        return;
      }
      if (transformMode === "multi" && state.buildHover?.entityRef && !isEntitySelected(state.buildHover.entityRef.kind, state.buildHover.entityRef.id) && !state.buildHover?.transformHandle) {
        return;
      }
      if (beginBuildDrag(event)) {
        elements.previewCanvas.setPointerCapture(event.pointerId);
        return;
      }
      if (transformMode === "move" || transformMode === "scale" || transformMode === "rotate") {
        privateInputState.pointerDown = false;
        privateInputState.pointerMoved = false;
        privateInputState.dragDistance = 0;
        privateInputState.pointerId = 0;
        state.viewerSuppressClickAt = 0;
        return;
      }
    }
    if (state.mode !== "play" && state.mode !== "build") {
      return;
    }
    privateInputState.pointerDown = true;
    privateInputState.dragDistance = 0;
    privateInputState.pointerMoved = false;
    privateInputState.pointerId = event.pointerId;
    privateInputState.lastPointerX = event.clientX;
    privateInputState.lastPointerY = event.clientY;
    elements.previewCanvas.setPointerCapture(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointermove", (event) => {
    state.previewPointer.clientX = event.clientX;
    state.previewPointer.clientY = event.clientY;
    state.previewPointer.pointerId = event.pointerId;
    state.previewPointer.inside = true;
    if (state.mode === "build" && isEditor()) {
      refreshBuildHoverFromPointer(event);
    }
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
    state.previewPointer.clientX = event.clientX;
    state.previewPointer.clientY = event.clientY;
    state.previewPointer.pointerId = event.pointerId;
    state.previewPointer.inside = true;
    refreshBuildHoverFromPointer(event);
    if (state.buildDrag && state.buildDrag.pointerId === event.pointerId) {
      endBuildDrag(event.pointerId, event);
      elements.previewCanvas.releasePointerCapture?.(event.pointerId);
      return;
    }
    state.viewerSuppressClickAt = privateInputState.pointerMoved ? performance.now() : 0;
    privateInputState.pointerDown = false;
    privateInputState.pointerId = 0;
    elements.previewCanvas.releasePointerCapture?.(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointercancel", (event) => {
    state.previewPointer.inside = false;
    state.buildHover = null;
    syncBuildPlacementOverlay();
    endBuildDrag(event.pointerId);
    privateInputState.pointerDown = false;
    privateInputState.pointerMoved = false;
    privateInputState.pointerId = 0;
    elements.previewCanvas.releasePointerCapture?.(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointerleave", () => {
    if (privateInputState.pointerDown) {
      return;
    }
    state.previewPointer.inside = false;
    state.buildHover = null;
    syncBuildPlacementOverlay();
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
    if (state.mode === "build" && shouldSuppressBuildClick(event)) {
      return;
    }
    if (state.mode === "build" && (getActivePlacementTool() || getActivePrefabPlacementId())) {
      refreshBuildHoverFromPointer(event);
      placeActiveTool();
      return;
    }
    if (state.viewerSuppressClickAt && performance.now() - state.viewerSuppressClickAt < 240) {
      return;
    }
    const transformMode = state.mode === "build" ? getBuildTransformMode() : "";
    const transformHandleHit = state.mode === "build" && (transformMode === "move" || transformMode === "scale" || transformMode === "rotate")
      ? getTransformHandleHit(event)
      : null;
    if (state.mode === "build" && transformHandleHit?.object?.userData?.privateWorldTransformHandle) {
      return;
    }
    const hit = raycastPreviewPointer(event);
    const entityRef = getEntityRefFromHit(hit);
    if (state.mode === "build") {
      if (transformMode === "delete") {
        if (entityRef) {
          deleteEntityRef(entityRef);
          refreshBuildHoverFromStoredPointer();
        } else if (hasBuilderSelection()) {
          setBuilderSelection("", "");
        }
        return;
      }
      if (transformMode === "multi") {
        if (entityRef) {
          setBuilderSelection(entityRef.kind, entityRef.id, { append: true });
        } else if (hasBuilderSelection()) {
          setBuilderSelection("", "");
        }
        return;
      }
      if (transformMode === "move" || transformMode === "scale" || transformMode === "rotate") {
        if (entityRef) {
          setBuilderSelection(entityRef.kind, entityRef.id);
        }
        return;
      }
      if (entityRef) {
        setBuilderSelection(entityRef.kind, entityRef.id);
        return;
      }
      if (hasBuilderSelection()) {
        setBuilderSelection("", "");
      }
      return;
    }
    if (state.mode !== "play" || !state.session || getLocalParticipant()?.join_role === "player") {
      return;
    }
    const gameSessionId = String(hit?.object?.userData?.privateWorldGameSessionId ?? "").trim();
    if (gameSessionId) {
      const session = state.gameSessions.get(gameSessionId);
      if (session) {
        requestOpenPrivateGameSession(session);
      }
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
  preview.transformPickables = [];
  preview.entityMeshes.clear();
  preview.billboards = [];
  disposePreviewEffects(preview);
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

function cloneMaterialForPreview(material) {
  if (!material?.clone) {
    return material;
  }
  const clone = material.clone();
  clone.map = material.map || null;
  clone.normalMap = material.normalMap || null;
  clone.roughnessMap = material.roughnessMap || null;
  clone.metalnessMap = material.metalnessMap || null;
  clone.aoMap = material.aoMap || null;
  return clone;
}

function clonePreviewModelScene(scene) {
  const clone = scene.clone(true);
  clone.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    if (Array.isArray(node.material)) {
      node.material = node.material.map((material) => cloneMaterialForPreview(material));
    } else {
      node.material = cloneMaterialForPreview(node.material);
    }
  });
  return clone;
}

async function loadTextureFromUrl(url) {
  return await new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}

function getTextureAssetRepeat(scale = { x: 1, y: 1, z: 1 }) {
  return {
    x: Math.max(1, Number(scale?.x ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
    y: Math.max(1, Number(scale?.z ?? scale?.y ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
  };
}

async function applyTextureAssetMapsToMaterial(material, textureAssetId, scale = { x: 1, y: 1, z: 1 }) {
  if (!material || !textureAssetId) {
    return;
  }
  const asset = getPrivateAssetById(textureAssetId);
  if (!asset) {
    return;
  }
  const cacheKey = textureAssetId;
  let cached = previewTextureAssetCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const roles = ["base_color", "normal", "roughness", "metallic", "ambient_occlusion", "emissive"];
      const mapEntries = await Promise.all(roles.map(async (role) => {
        const file = getPrivateAssetFile(asset, role);
        if (!file?.url) {
          return [role, null];
        }
        try {
          return [role, await loadTextureFromUrl(file.url)];
        } catch (_error) {
          return [role, null];
        }
      }));
      return Object.fromEntries(mapEntries);
    })();
    previewTextureAssetCache.set(cacheKey, cached);
  }
  const textures = await cached;
  const repeat = getTextureAssetRepeat(scale);
  if (textures.base_color) {
    textures.base_color.repeat.set(repeat.x, repeat.y);
    material.map = textures.base_color;
    material.color?.set?.("#ffffff");
  }
  if (textures.normal) {
    textures.normal.repeat.set(repeat.x, repeat.y);
    material.normalMap = textures.normal;
  }
  if (textures.roughness) {
    textures.roughness.repeat.set(repeat.x, repeat.y);
    material.roughnessMap = textures.roughness;
  }
  if (textures.metallic) {
    textures.metallic.repeat.set(repeat.x, repeat.y);
    material.metalnessMap = textures.metallic;
  }
  if (textures.ambient_occlusion) {
    textures.ambient_occlusion.repeat.set(repeat.x, repeat.y);
    material.aoMap = textures.ambient_occlusion;
  }
  if (textures.emissive) {
    textures.emissive.repeat.set(repeat.x, repeat.y);
    material.emissiveMap = textures.emissive;
  }
  material.needsUpdate = true;
}

async function loadPreviewModelAssetScene(asset) {
  const glbFile = getPrivateAssetFile(asset, "model_glb");
  if (!glbFile?.url) {
    return null;
  }
  let cached = previewModelAssetCache.get(asset.id);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      gltfLoader.load(
        glbFile.url,
        (gltf) => resolve(gltf.scene || null),
        undefined,
        reject,
      );
    });
    previewModelAssetCache.set(asset.id, cached);
  }
  return await cached;
}

function makeMaterial(material = {}, scale = { x: 1, y: 1, z: 1 }, { selected = false } = {}) {
  const built = createPatternedMaterial(THREE, material, {
    repeatX: Math.max(1, Number(scale?.x ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
    repeatY: Math.max(1, Number(scale?.z ?? scale?.y ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
  });
  if (material?.texture_asset_id) {
    void applyTextureAssetMapsToMaterial(built, material.texture_asset_id, scale);
  }
  const baseEmissiveIntensity = Math.max(0, Number(material?.emissive_intensity ?? material?.emissiveIntensity ?? 0) || 0);
  if (selected) {
    if (baseEmissiveIntensity <= 0) {
      built.emissive = new THREE.Color("#355f9b");
    }
    built.emissiveIntensity = Number((baseEmissiveIntensity + 0.22).toFixed(4));
  }
  return built;
}

function getObjectMaterials(object) {
  if (!object?.material) {
    return [];
  }
  return Array.isArray(object.material) ? object.material : [object.material];
}

function applyRenderableVisibility(object, {
  invisibleInPlay = false,
  runtimeVisible = true,
  buildGhostOpacity = 0.36,
} = {}) {
  const materials = getObjectMaterials(object);
  const shouldGhost = invisibleInPlay === true && state.mode === "build" && isEditor();
  const shouldHideVisual = runtimeVisible === false || (invisibleInPlay === true && state.mode === "play");
  object.userData.privateWorldRenderVisible = !shouldHideVisual || shouldGhost;
  object.visible = !shouldHideVisual || shouldGhost;
  for (const material of materials) {
    if (!material) {
      continue;
    }
    if (material.userData.__pwBaseOpacity == null) {
      material.userData.__pwBaseOpacity = Number(material.opacity ?? 1);
      material.userData.__pwBaseTransparent = material.transparent === true;
      material.userData.__pwBaseDepthWrite = material.depthWrite !== false;
    }
    const baseOpacity = Number(material.userData.__pwBaseOpacity ?? 1) || 1;
    const nextOpacity = shouldHideVisual
      ? 0
      : shouldGhost
        ? Math.min(baseOpacity, buildGhostOpacity)
        : baseOpacity;
    material.opacity = nextOpacity;
    material.transparent = shouldGhost || shouldHideVisual || material.userData.__pwBaseTransparent === true;
    material.depthWrite = shouldHideVisual ? false : material.userData.__pwBaseDepthWrite !== false;
    material.needsUpdate = true;
  }
}

function attachEmissionLight(object, material = {}, scale = { x: 1, y: 1, z: 1 }, { runtimeVisible = true } = {}) {
  const emissiveIntensity = Math.max(0, Number(material?.emissive_intensity ?? material?.emissiveIntensity ?? 0) || 0);
  if (!object || emissiveIntensity <= 0) {
    return null;
  }
  const maxExtent = Math.max(
    1,
    Number(scale?.x ?? 1) || 1,
    Number(scale?.y ?? 1) || 1,
    Number(scale?.z ?? 1) || 1,
  );
  const light = new THREE.PointLight(
    material?.color || "#ffffff",
    Number((emissiveIntensity * 1.8).toFixed(4)),
    Number((maxExtent * 6 + emissiveIntensity * 8).toFixed(4)),
    1.8,
  );
  light.position.set(0, 0, 0);
  light.visible = runtimeVisible !== false;
  object.add(light);
  return light;
}

function addTextBillboard(preview, value, position, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = options.selected ? "rgba(255,246,251,0.98)" : "rgba(255,255,255,0.98)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = options.selected ? "#ff4fa8" : "#243b64";
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = options.selected ? "#8f2457" : "#14213d";
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
  mesh.rotation.set(options.rotation?.x || 0, options.rotation?.y || 0, options.rotation?.z || 0);
  mesh.scale.setScalar(Math.max(0.2, Number(options.scale ?? 1) || 1));
  (options.parent ?? preview.root).add(mesh);
  return mesh;
}

function buildPanelPreviewMaterial(material = {}, scale = { x: 4, y: 2.25 }, options = {}) {
  const built = makeMaterial(
    material,
    {
      x: Math.max(0.2, Number(scale?.x ?? 4) || 4),
      y: Math.max(0.2, Number(scale?.y ?? 2.25) || 2.25),
      z: Math.max(0.2, Number(scale?.y ?? 2.25) || 2.25),
    },
    options,
  );
  built.side = THREE.DoubleSide;
  built.needsUpdate = true;
  return built;
}

function registerPreviewBillboard(preview, object, facingMode = "fixed") {
  if (!preview || !object) {
    return;
  }
  const mode = normalizeFacingMode(facingMode);
  if (mode === "fixed") {
    return;
  }
  preview.billboards = Array.isArray(preview.billboards) ? preview.billboards : [];
  preview.billboards.push({ object, mode });
}

function updatePrivateWorldBillboards(preview) {
  if (!preview?.camera || !Array.isArray(preview.billboards) || !preview.billboards.length) {
    return;
  }
  const cameraWorld = preview.camera.position.clone();
  for (const entry of preview.billboards) {
    const object = entry?.object;
    if (!object?.parent) {
      continue;
    }
    if (entry.mode === "billboard") {
      object.lookAt(cameraWorld);
      continue;
    }
    const localTarget = cameraWorld.clone();
    object.parent.worldToLocal(localTarget);
    const dx = localTarget.x - object.position.x;
    const dz = localTarget.z - object.position.z;
    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) {
      continue;
    }
    object.rotation.set(0, Math.atan2(dx, dz), 0);
  }
}

function createParticleSystem(preview, anchorId, effectName, color, particleId = anchorId, options = {}) {
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
  let helper = null;
  if (particleId && particleId !== anchorId) {
    helper = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.8, 1.4),
      new THREE.MeshBasicMaterial({
        color: color || "#ff5a7a",
        wireframe: true,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    helper.userData.privateWorldEntityId = particleId;
    helper.userData.privateWorldEntityKind = "particle";
    helper.userData.privateWorldBuildOnly = true;
    preview.root.add(helper);
    preview.entityMeshes.set(particleId, helper);
    preview.entityPickables.push(helper);
  }
  return {
    kind: "particle",
    anchorId,
    particleId,
    object: points,
    helper,
    positions,
    seeds,
    effectName: effectName || "sparkles",
    offset: deepClone(options.position ?? { x: 0, y: 0, z: 0 }),
    rotation: deepClone(options.rotation ?? { x: 0, y: 0, z: 0 }),
    scale: deepClone(options.scale ?? { x: 1, y: 1, z: 1 }),
    selected: options.selected === true,
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
    const anchor = effect.anchorId ? preview.entityMeshes.get(effect.anchorId) : null;
    const worldPosition = new THREE.Vector3();
    const anchorScale = new THREE.Vector3(1, 1, 1);
    if (anchor) {
      anchor.getWorldPosition(worldPosition);
      anchor.getWorldScale(anchorScale);
    }
    const offset = new THREE.Vector3(
      Number(effect.offset?.x ?? 0) || 0,
      Number(effect.offset?.y ?? 0) || 0,
      Number(effect.offset?.z ?? 0) || 0,
    );
    const effectScale = {
      x: Math.max(0.1, Number(effect.scale?.x ?? 1) || 1),
      y: Math.max(0.1, Number(effect.scale?.y ?? 1) || 1),
      z: Math.max(0.1, Number(effect.scale?.z ?? 1) || 1),
    };
    const anchorVisible = !effect.anchorId || Boolean(anchor && anchor.userData?.privateWorldRenderVisible !== false);
    effect.object.visible = anchorVisible;
    effect.object.position.copy(worldPosition).add(offset);
    effect.object.rotation.set(
      Number(effect.rotation?.x ?? 0) || 0,
      Number(effect.rotation?.y ?? 0) || 0,
      Number(effect.rotation?.z ?? 0) || 0,
    );
    effect.object.scale.set(
      Math.max(0.8, anchorScale.x) * effectScale.x,
      Math.max(0.75, anchorScale.y) * effectScale.y,
      Math.max(0.8, anchorScale.z) * effectScale.z,
    );
    if (effect.kind === "particle") {
      const runtimeParticle = state.runtimeSnapshot?.particles?.find((entry) => entry.id === effect.particleId);
      effect.object.visible = effect.object.visible && runtimeParticle?.enabled !== false;
      for (let index = 0; index < effect.seeds.length; index += 1) {
        const seed = effect.seeds[index];
        const progress = (elapsedSeconds * seed.speed + seed.phase) % 1;
        const orbit = elapsedSeconds * (seed.speed * 1.2) + seed.phase;
        const offset = index * 3;
        effect.positions[offset] = Math.cos(orbit) * seed.radius;
        effect.positions[offset + 1] = 0.4 + progress * seed.height;
        effect.positions[offset + 2] = Math.sin(orbit) * seed.radius;
      }
      effect.object.geometry.attributes.position.needsUpdate = true;
      if (effect.helper) {
        effect.helper.visible = state.mode === "build" && isEditor();
        effect.helper.position.copy(effect.object.position);
        effect.helper.rotation.copy(effect.object.rotation);
        effect.helper.scale.set(effectScale.x, effectScale.y, effectScale.z);
        effect.helper.material.color = new THREE.Color(effect.selected ? "#ffd659" : effect.object.material.color);
      }
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
  if (state.mode !== "play" || !runtime || activeSceneId !== state.selectedSceneId) {
    return {
      dynamicById: new Map(),
      dynamicObjects: [],
      playerById: new Map(),
      players: [],
    };
  }
  return {
    dynamicById: new Map((runtime.dynamic_objects ?? []).map((entry) => [entry.id, entry])),
    dynamicObjects: runtime.dynamic_objects ?? [],
    playerById: new Map((runtime.players ?? []).map((entry) => [entry.id, entry])),
    players: runtime.players ?? [],
  };
}

function setPreviewRendererSize(preview, width, height) {
  if (!preview?.renderer || !preview?.camera) {
    return;
  }
  const nextWidth = Math.max(1, Math.round(Number(width) || 640));
  const nextHeight = Math.max(1, Math.round(Number(height) || 360));
  if (preview.viewportWidth === nextWidth && preview.viewportHeight === nextHeight) {
    return;
  }
  preview.viewportWidth = nextWidth;
  preview.viewportHeight = nextHeight;
  preview.camera.aspect = nextWidth / Math.max(1, nextHeight);
  preview.camera.updateProjectionMatrix();
  preview.renderer.setSize(nextWidth, nextHeight, false);
}

function applyRuntimeEntryToMesh(mesh, runtimeEntry = {}, options = {}) {
  if (!mesh || !runtimeEntry) {
    return;
  }
  const leadSeconds = clampNumber(options.leadSeconds, 1 / 30, 0, 0.08);
  const position = runtimeEntry.position ?? {};
  const velocity = runtimeEntry.velocity ?? {};
  const rotation = runtimeEntry.rotation ?? {};
  const targetPosition = mesh.userData.privateWorldRuntimeTargetPosition ?? new THREE.Vector3();
  targetPosition.set(
    clampNumber(position.x, mesh.position.x, -4096, 4096) + ((Number(velocity.x) || 0) * leadSeconds),
    clampNumber(position.y, mesh.position.y, -4096, 4096) + ((Number(velocity.y) || 0) * leadSeconds),
    clampNumber(position.z, mesh.position.z, -4096, 4096) + ((Number(velocity.z) || 0) * leadSeconds),
  );
  mesh.userData.privateWorldRuntimeTargetPosition = targetPosition;
  const targetQuaternion = mesh.userData.privateWorldRuntimeTargetQuaternion ?? new THREE.Quaternion();
  targetQuaternion.setFromEuler(new THREE.Euler(
    clampNumber(rotation.x, mesh.rotation.x, -Math.PI * 4, Math.PI * 4),
    clampNumber(rotation.y, mesh.rotation.y, -Math.PI * 4, Math.PI * 4),
    clampNumber(rotation.z, mesh.rotation.z, -Math.PI * 4, Math.PI * 4),
  ));
  mesh.userData.privateWorldRuntimeTargetQuaternion = targetQuaternion;
  const scale = typeof runtimeEntry.scale === "number"
    ? { x: runtimeEntry.scale, y: runtimeEntry.scale, z: runtimeEntry.scale }
    : (runtimeEntry.scale ?? options.fallbackScale ?? null);
  if (scale) {
    const targetScale = mesh.userData.privateWorldRuntimeTargetScale ?? new THREE.Vector3();
    targetScale.set(
      clampNumber(scale.x, mesh.scale.x, 0.01, 4096),
      clampNumber(scale.y, mesh.scale.y, 0.01, 4096),
      clampNumber(scale.z, mesh.scale.z, 0.01, 4096),
    );
    mesh.userData.privateWorldRuntimeTargetScale = targetScale;
  }
  if (mesh.userData.privateWorldRuntimeInitialized !== true) {
    mesh.position.copy(targetPosition);
    mesh.quaternion.copy(targetQuaternion);
    if (mesh.userData.privateWorldRuntimeTargetScale) {
      mesh.scale.copy(mesh.userData.privateWorldRuntimeTargetScale);
    }
    mesh.userData.privateWorldRuntimeInitialized = true;
  }
  applyRenderableVisibility(mesh, {
    runtimeVisible: runtimeEntry.visible !== false,
  });

  const runtimeMaterial = runtimeEntry.material_override
    ? { ...(runtimeEntry.material ?? {}), ...runtimeEntry.material_override }
    : runtimeEntry.material ?? null;
  if (runtimeMaterial?.color) {
    for (const material of getObjectMaterials(mesh)) {
      material.color?.set?.(runtimeMaterial.color);
      if (runtimeMaterial.texture_asset_id) {
        void applyTextureAssetMapsToMaterial(material, runtimeMaterial.texture_asset_id, runtimeEntry.scale ?? options.fallbackScale ?? { x: 1, y: 1, z: 1 });
      }
      if (material.emissiveIntensity !== undefined) {
        material.emissiveIntensity = Math.max(
          Number(material.emissiveIntensity || 0),
          Math.max(0, Number(runtimeMaterial.emissive_intensity ?? runtimeMaterial.emissiveIntensity ?? 0) || 0),
        );
      }
      material.needsUpdate = true;
    }
  }
  if (options.playerColor) {
    for (const material of getObjectMaterials(mesh)) {
      material.color?.set?.(options.playerColor);
      material.needsUpdate = true;
    }
  }
}

function advanceRuntimeVisuals(preview, deltaSeconds) {
  if (!preview?.entityMeshes?.size) {
    return;
  }
  const positionAlpha = 1 - Math.exp(-deltaSeconds * 18);
  const rotationAlpha = 1 - Math.exp(-deltaSeconds * 20);
  const scaleAlpha = 1 - Math.exp(-deltaSeconds * 16);
  for (const mesh of preview.entityMeshes.values()) {
    const targetPosition = mesh?.userData?.privateWorldRuntimeTargetPosition;
    const targetQuaternion = mesh?.userData?.privateWorldRuntimeTargetQuaternion;
    const targetScale = mesh?.userData?.privateWorldRuntimeTargetScale;
    if (targetPosition) {
      if (mesh.position.distanceToSquared(targetPosition) <= 0.000001) {
        mesh.position.copy(targetPosition);
      } else {
        mesh.position.lerp(targetPosition, positionAlpha);
      }
    }
    if (targetQuaternion) {
      if (1 - Math.abs(mesh.quaternion.dot(targetQuaternion)) <= 0.000001) {
        mesh.quaternion.copy(targetQuaternion);
      } else {
        mesh.quaternion.slerp(targetQuaternion, rotationAlpha);
      }
    }
    if (targetScale) {
      if (mesh.scale.distanceToSquared(targetScale) <= 0.000001) {
        mesh.scale.copy(targetScale);
      } else {
        mesh.scale.lerp(targetScale, scaleAlpha);
      }
    }
  }
}

function syncPreviewRuntimeSnapshot(snapshot) {
  const preview = state.preview;
  if (!preview || !snapshot || state.mode !== "play") {
    return false;
  }
  const activeSceneId = String(snapshot.active_scene_id ?? "").trim();
  if (!activeSceneId || activeSceneId !== state.selectedSceneId) {
    return false;
  }
  const dynamicObjects = Array.isArray(snapshot.dynamic_objects) ? snapshot.dynamic_objects : [];
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  for (const entry of [...dynamicObjects, ...players]) {
    if (!preview.entityMeshes.has(entry.id)) {
      return false;
    }
  }
  for (const runtimePrimitive of dynamicObjects) {
    applyRuntimeEntryToMesh(preview.entityMeshes.get(runtimePrimitive.id), runtimePrimitive);
  }
  for (const runtimePlayer of players) {
    applyRuntimeEntryToMesh(preview.entityMeshes.get(runtimePlayer.id), runtimePlayer, {
      fallbackScale: runtimePlayer?.scale
        ? { x: runtimePlayer.scale, y: runtimePlayer.scale, z: runtimePlayer.scale }
        : null,
      playerColor: runtimePlayer?.occupied_by_username
        ? "#ff5a6f"
        : (runtimePlayer?.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f"),
    });
  }
  return true;
}

function getPossessedPreviewPlayer(preview = state.preview) {
  const player = getPossessedRuntimePlayer();
  if (!player) {
    return null;
  }
  const mesh = preview?.entityMeshes?.get(player.id);
  if (!mesh) {
    return player;
  }
  return {
    ...player,
    position: {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    },
    rotation: {
      ...(player.rotation ?? {}),
      x: mesh.rotation.x,
      y: mesh.rotation.y,
      z: mesh.rotation.z,
    },
    scale: mesh.scale.x || player.scale,
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
  const attachPrefabPickable = (object, metadata = null) => {
    if (!metadata?.id) {
      return object;
    }
    object.userData.privateWorldEntityId = metadata.id;
    object.userData.privateWorldEntityKind = metadata.kind;
    preview.entityPickables.push(object);
    return object;
  };
  const addPrefabMesh = (parent, geometry, material, position, rotation = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 }, metadata = null) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
    attachPrefabPickable(mesh, metadata);
    parent.add(mesh);
    return mesh;
  };
  const getPrimitiveGeometry = (primitive = {}) => {
    if (primitive.shape === "sphere") {
      return new THREE.SphereGeometry(0.5, 24, 24);
    }
    if (primitive.shape === "cylinder") {
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    }
    if (primitive.shape === "cone") {
      return new THREE.ConeGeometry(0.5, 1, 20);
    }
    if (primitive.shape === "panel") {
      return new THREE.PlaneGeometry(1, 1);
    }
    if (primitive.shape === "plane") {
      return new THREE.BoxGeometry(1, 0.1, 1);
    }
    return new THREE.BoxGeometry(1, 1, 1);
  };
  const runtimeTransforms = getRuntimeTransformMaps();
  const particleEffects = [];
  const isSelected = (kind, id) => isEntitySelected(kind, id);
  const renderPrefabDocument = (parent, prefabDoc = {}, options = {}) => {
    const metadata = options.metadata ?? null;
    const selected = options.selected === true;
    const inheritedMaterial = options.materialOverride ?? null;
    const visitedPrefabIds = options.visitedPrefabIds ?? new Set();
    let renderedAny = false;
    const getMergedMaterial = (material = {}) => inheritedMaterial
      ? { ...material, ...inheritedMaterial }
      : material;

    for (const [index, voxel] of (prefabDoc.voxels ?? []).entries()) {
      renderedAny = true;
      const mesh = addPrefabMesh(
        parent,
        new THREE.BoxGeometry(1, 1, 1),
        makeMaterial(getMergedMaterial(voxel.material), voxel.scale, { selected }),
        voxel.position || { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        voxel.scale || { x: 1, y: 1, z: 1 },
        metadata ?? { id: voxel.id || `prefab_voxel_${index}`, kind: "voxel" },
      );
      applyRenderableVisibility(mesh, {
        invisibleInPlay: voxel.invisible === true,
      });
      attachEmissionLight(mesh, getMergedMaterial(voxel.material), voxel.scale || { x: 1, y: 1, z: 1 });
    }

    for (const [index, primitive] of (prefabDoc.primitives ?? []).entries()) {
      renderedAny = true;
      const primitiveScale = primitive.scale || { x: 1, y: 1, z: 1 };
      const isPanelPrimitive = isPrimitivePanelShape(primitive);
      const mesh = addPrefabMesh(
        parent,
        getPrimitiveGeometry(primitive),
        isPanelPrimitive
          ? buildPanelPreviewMaterial(getMergedMaterial(primitive.material), primitiveScale, { selected })
          : makeMaterial(getMergedMaterial(primitive.material), primitiveScale, { selected }),
        primitive.position || { x: 0, y: 1, z: 0 },
        primitive.rotation || { x: 0, y: 0, z: 0 },
        isPanelPrimitive
          ? { x: primitiveScale.x || 4, y: primitiveScale.y || 2.25, z: 1 }
          : primitiveScale,
        metadata ?? { id: primitive.id || `prefab_primitive_${index}`, kind: "primitive" },
      );
      applyRenderableVisibility(mesh, {
        invisibleInPlay: primitive.invisible === true,
      });
      attachEmissionLight(mesh, getMergedMaterial(primitive.material), primitiveScale);
      if (isPanelPrimitive) {
        registerPreviewBillboard(preview, mesh, primitive.facing_mode);
      }
      if (selected && mesh.material?.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = Math.max(Number(mesh.material.emissiveIntensity || 0), 0.3);
      }
    }

    for (const [index, panel] of (prefabDoc.panels ?? []).entries()) {
      renderedAny = true;
      const panelScale = panel.scale ?? { x: 4, y: 2.25, z: 0.1 };
      const mesh = addPrefabMesh(
        parent,
        new THREE.PlaneGeometry(1, 1),
        buildPanelPreviewMaterial(getMergedMaterial(panel.material), panelScale, { selected }),
        panel.position || { x: 0, y: 2, z: 0 },
        panel.rotation || { x: 0, y: 0, z: 0 },
        { x: panelScale.x || 4, y: panelScale.y || 2.25, z: 1 },
        metadata ?? { id: panel.id || `prefab_panel_${index}`, kind: "panel" },
      );
      applyRenderableVisibility(mesh, {
        invisibleInPlay: panel.invisible === true,
      });
      attachEmissionLight(mesh, getMergedMaterial(panel.material), panelScale);
      registerPreviewBillboard(preview, mesh, panel.facing_mode);
    }

    for (const [index, model] of (prefabDoc.models ?? []).entries()) {
      renderedAny = true;
      const modelGroup = new THREE.Group();
      modelGroup.position.set(model.position?.x || 0, model.position?.y || 1, model.position?.z || 0);
      modelGroup.rotation.set(model.rotation?.x || 0, model.rotation?.y || 0, model.rotation?.z || 0);
      modelGroup.scale.set(model.scale?.x || 1, model.scale?.y || 1, model.scale?.z || 1);
      attachPrefabPickable(modelGroup, metadata ?? { id: model.id || `prefab_model_${index}`, kind: "model" });
      parent.add(modelGroup);
      const bounds = model.bounds ?? { x: 1, y: 1, z: 1 };
      const placeholder = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, bounds.x || 1), Math.max(0.2, bounds.y || 1), Math.max(0.2, bounds.z || 1)),
        makeMaterial(getMergedMaterial(model.material), bounds, { selected }),
      );
      modelGroup.add(placeholder);
      const asset = getPrivateAssetById(model.asset_id);
      if (asset) {
        void loadPreviewModelAssetScene(asset).then((loadedScene) => {
          if (!loadedScene || !modelGroup.parent) {
            return;
          }
          const clone = clonePreviewModelScene(loadedScene);
          clone.scale.set(bounds.x || 1, bounds.y || 1, bounds.z || 1);
          clone.traverse((node) => {
            if (!node.isMesh) {
              return;
            }
            if (Array.isArray(node.material)) {
              node.material.forEach((material) => {
                if (model.material?.texture_asset_id) {
                  void applyTextureAssetMapsToMaterial(material, model.material.texture_asset_id, bounds);
                }
              });
            } else if (node.material && model.material?.texture_asset_id) {
              void applyTextureAssetMapsToMaterial(node.material, model.material.texture_asset_id, bounds);
            }
          });
          placeholder.removeFromParent();
          placeholder.geometry?.dispose?.();
          placeholder.material?.dispose?.();
          modelGroup.add(clone);
        }).catch(() => {
          // keep placeholder
        });
      }
    }

    for (const [index, player] of (prefabDoc.players ?? []).entries()) {
      renderedAny = true;
      const tint = getMergedMaterial({ color: player.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f", texture_preset: "none" });
      const mesh = addPrefabMesh(
        parent,
        new THREE.CapsuleGeometry(
          PRIVATE_PLAYER_METRICS.width / 2,
          PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
          8,
          16,
        ),
        makeMaterial(
          tint,
          { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
          { selected },
        ),
        player.position || { x: 0, y: 1, z: 0 },
        player.rotation || { x: 0, y: 0, z: 0 },
        { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
        metadata ?? { id: player.id || `prefab_player_${index}`, kind: "player" },
      );
    }

    for (const [index, screen] of (prefabDoc.screens ?? []).entries()) {
      renderedAny = true;
      const resolvedMaterial = getMergedMaterial(screen.material);
      const material = new THREE.MeshBasicMaterial({
        color: resolvedMaterial?.color || "#ffffff",
        toneMapped: false,
      });
      const mesh = addPrefabMesh(
        parent,
        new THREE.BoxGeometry(1, 1, 0.1),
        material,
        screen.position || { x: 0, y: 2, z: 0 },
        screen.rotation || { x: 0, y: 0, z: 0 },
        screen.scale || { x: 4, y: 2, z: 0.1 },
        metadata ?? { id: screen.id || `prefab_screen_${index}`, kind: "screen" },
      );
      const textureViewport = getScreenTextureRenderSize(screen);
      void renderScreenHtmlTexture(THREE, screen, {
        width: textureViewport.width,
        height: textureViewport.height,
      }).then((texture) => {
        if (!texture || !mesh.parent) {
          return;
        }
        material.map = texture;
        material.color.set("#ffffff");
        material.needsUpdate = true;
      }).catch(() => {
        // ignore transient screen texture failures
      });
      registerPreviewBillboard(preview, mesh, screen.facing_mode);
    }

    for (const [index, text] of (prefabDoc.texts ?? []).entries()) {
      renderedAny = true;
      const mesh = addTextBillboard(preview, text.value || text.text, text.position || { x: 0, y: 2, z: 0 }, {
        parent,
        rotation: text.rotation || { x: 0, y: 0, z: 0 },
        scale: text.scale ?? 1,
        selected,
      });
      attachPrefabPickable(mesh, metadata ?? { id: text.id || `prefab_text_${index}`, kind: "text" });
      registerPreviewBillboard(preview, mesh, text.facing_mode);
    }

    for (const [index, trigger] of (prefabDoc.trigger_zones ?? prefabDoc.triggerZones ?? []).entries()) {
      renderedAny = true;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: selected ? "#ffd659" : "#ff4f78",
          wireframe: true,
          transparent: true,
          opacity: 0.55,
        }),
      );
      mesh.position.set(trigger.position?.x || 0, trigger.position?.y || 0.5, trigger.position?.z || 0);
      mesh.rotation.set(trigger.rotation?.x || 0, trigger.rotation?.y || 0, trigger.rotation?.z || 0);
      mesh.scale.set(trigger.scale?.x || 2, trigger.scale?.y || 2, trigger.scale?.z || 2);
      attachPrefabPickable(mesh, metadata ?? { id: trigger.id || `prefab_trigger_${index}`, kind: "trigger" });
      parent.add(mesh);
    }

    for (const nestedInstance of prefabDoc.prefab_instances ?? []) {
      if (nestedInstance.overrides?.visible === false) {
        continue;
      }
      const nestedPrefabId = String(nestedInstance.prefab_id ?? "").trim();
      if (!nestedPrefabId || visitedPrefabIds.has(nestedPrefabId)) {
        continue;
      }
      const nestedPrefab = getSelectedPrefabEntry(nestedPrefabId);
      if (!nestedPrefab) {
        continue;
      }
      const nestedGroup = new THREE.Group();
      nestedGroup.position.set(
        nestedInstance.position?.x || 0,
        nestedInstance.position?.y || 0,
        nestedInstance.position?.z || 0,
      );
      nestedGroup.rotation.set(
        nestedInstance.rotation?.x || 0,
        nestedInstance.rotation?.y || 0,
        nestedInstance.rotation?.z || 0,
      );
      nestedGroup.scale.set(
        nestedInstance.scale?.x || 1,
        nestedInstance.scale?.y || 1,
        nestedInstance.scale?.z || 1,
      );
      parent.add(nestedGroup);
      renderedAny = renderPrefabDocument(nestedGroup, nestedPrefab.prefab_doc ?? {}, {
        metadata,
        selected,
        materialOverride: nestedInstance.overrides?.material
          ? { ...(inheritedMaterial ?? {}), ...nestedInstance.overrides.material }
          : inheritedMaterial,
        visitedPrefabIds: new Set([...visitedPrefabIds, nestedPrefabId]),
      }) || renderedAny;
    }

    return renderedAny;
  };
  refreshPrivatePreviewEnvironment(preview, state.selectedWorld, sceneDoc);
  const environmentTheme = buildPrivateSceneEnvironmentTheme(getPrivateSceneEnvironmentSettings(sceneDoc));
  const authoredPrimitiveById = new Map(
    (sceneDoc.primitives ?? [])
      .filter((entry) => entry?.id != null)
      .map((entry) => [String(entry.id), entry]),
  );
  const authoredModelById = new Map(
    (sceneDoc.models ?? [])
      .filter((entry) => entry?.id != null)
      .map((entry) => [String(entry.id), entry]),
  );
  const useRuntimePrimitivePreview = state.mode === "play" && runtimeTransforms.dynamicObjects.length > 0;
  const renderPrimitiveMesh = (primitiveSource = {}, options = {}) => {
    const authoredPrimitive = options.authoredPrimitive ?? null;
    const primitiveId = String(options.id ?? primitiveSource.id ?? authoredPrimitive?.id ?? "").trim();
    const resolvedPrimitiveScale = options.scale
      ?? primitiveSource?.scale
      ?? authoredPrimitive?.scale
      ?? { x: 1, y: 1, z: 1 };
    const isPanelPrimitive = isPrimitivePanelShape(primitiveSource?.shape ? primitiveSource : (authoredPrimitive ?? primitiveSource));
    const resolvedPrimitiveMaterial = options.material
      ?? (primitiveSource?.material_override
        ? { ...(primitiveSource.material ?? authoredPrimitive?.material ?? {}), ...primitiveSource.material_override }
        : (primitiveSource?.material ?? authoredPrimitive?.material ?? { color: "#edf2f8", texture_preset: "none" }));
    const mesh = addMesh(
      getPrimitiveGeometry(primitiveSource?.shape ? primitiveSource : (authoredPrimitive ?? primitiveSource)),
      isPanelPrimitive
        ? buildPanelPreviewMaterial(
          resolvedPrimitiveMaterial,
          resolvedPrimitiveScale,
          {
            selected: options.selected === true,
          },
        )
        : makeMaterial(
          resolvedPrimitiveMaterial,
          resolvedPrimitiveScale,
          {
            selected: options.selected === true,
          },
        ),
      primitiveSource?.position || authoredPrimitive?.position || { x: 0, y: 1, z: 0 },
      primitiveSource?.rotation || authoredPrimitive?.rotation || { x: 0, y: 0, z: 0 },
      isPanelPrimitive
        ? { x: resolvedPrimitiveScale.x || 4, y: resolvedPrimitiveScale.y || 2.25, z: 1 }
        : resolvedPrimitiveScale,
      primitiveId ? { id: primitiveId, kind: "primitive" } : null,
    );
    applyRenderableVisibility(mesh, {
      invisibleInPlay: authoredPrimitive?.invisible === true,
      runtimeVisible: options.runtimeVisible,
    });
    attachEmissionLight(
      mesh,
      resolvedPrimitiveMaterial,
      resolvedPrimitiveScale,
      {
        runtimeVisible: options.runtimeVisible,
      },
    );
    if (isPanelPrimitive) {
      registerPreviewBillboard(preview, mesh, primitiveSource?.facing_mode ?? authoredPrimitive?.facing_mode);
    }
    const effectColor = resolvedPrimitiveMaterial?.color || authoredPrimitive?.material?.color || "#ffb16a";
    if (authoredPrimitive?.particle_effect) {
      particleEffects.push(createParticleSystem(preview, primitiveId, authoredPrimitive.particle_effect, effectColor));
    }
    if (authoredPrimitive?.trail_effect) {
      particleEffects.push(createTrailSystem(preview, primitiveId, authoredPrimitive.trail_effect, effectColor));
    }
    if (options.selected === true && mesh.material?.emissiveIntensity !== undefined) {
      mesh.material.emissiveIntensity = Math.max(Number(mesh.material.emissiveIntensity || 0), 0.3);
    }
    return mesh;
  };
  const renderPanelMesh = (panelEntry = {}, options = {}) => {
    const panelScale = panelEntry.scale ?? { x: 4, y: 2.25, z: 0.1 };
    const resolvedMaterial = panelEntry.material ?? { color: "#f4f7fb", texture_preset: "none", emissive_intensity: 0 };
    const mesh = addMesh(
      new THREE.PlaneGeometry(1, 1),
      buildPanelPreviewMaterial(resolvedMaterial, panelScale, {
        selected: options.selected === true,
      }),
      panelEntry.position || { x: 0, y: 2, z: 0 },
      panelEntry.rotation || { x: 0, y: 0, z: 0 },
      { x: panelScale.x || 4, y: panelScale.y || 2.25, z: 1 },
      options.id ? { id: options.id, kind: "panel" } : null,
    );
    applyRenderableVisibility(mesh, {
      invisibleInPlay: panelEntry.invisible === true,
      runtimeVisible: options.runtimeVisible,
    });
    attachEmissionLight(mesh, resolvedMaterial, panelScale, {
      runtimeVisible: options.runtimeVisible,
    });
    registerPreviewBillboard(preview, mesh, panelEntry.facing_mode);
    return mesh;
  };
  const renderModelMesh = (modelEntry = {}, options = {}) => {
    const metadata = options.id ? { id: options.id, kind: "model" } : null;
    const group = new THREE.Group();
    group.position.set(
      modelEntry.position?.x || 0,
      modelEntry.position?.y || 1,
      modelEntry.position?.z || 0,
    );
    group.rotation.set(
      modelEntry.rotation?.x || 0,
      modelEntry.rotation?.y || 0,
      modelEntry.rotation?.z || 0,
    );
    group.scale.set(
      modelEntry.scale?.x || 1,
      modelEntry.scale?.y || 1,
      modelEntry.scale?.z || 1,
    );
    if (metadata?.id) {
      group.userData.privateWorldEntityId = metadata.id;
      group.userData.privateWorldEntityKind = metadata.kind;
      preview.entityPickables.push(group);
      preview.entityMeshes.set(metadata.id, group);
    }
    preview.root.add(group);
    const bounds = modelEntry.bounds ?? { x: 1, y: 1, z: 1 };
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.2, bounds.x || 1), Math.max(0.2, bounds.y || 1), Math.max(0.2, bounds.z || 1)),
      makeMaterial(modelEntry.material ?? { color: "#dde7f2", texture_preset: "none" }, bounds, {
        selected: options.selected === true,
      }),
    );
    group.add(placeholder);
    applyRenderableVisibility(group, {
      invisibleInPlay: modelEntry.invisible === true,
      runtimeVisible: options.runtimeVisible,
    });
    const asset = getPrivateAssetById(modelEntry.asset_id);
    if (asset) {
      void loadPreviewModelAssetScene(asset).then((loadedScene) => {
        if (!loadedScene || !group.parent) {
          return;
        }
        const clone = clonePreviewModelScene(loadedScene);
        clone.scale.set(bounds.x || 1, bounds.y || 1, bounds.z || 1);
        clone.traverse((node) => {
          if (!node.isMesh) {
            return;
          }
          if (Array.isArray(node.material)) {
            node.material.forEach((material) => {
              if (modelEntry.material?.texture_asset_id) {
                void applyTextureAssetMapsToMaterial(material, modelEntry.material.texture_asset_id, bounds);
              }
            });
          } else if (node.material && modelEntry.material?.texture_asset_id) {
            void applyTextureAssetMapsToMaterial(node.material, modelEntry.material.texture_asset_id, bounds);
          }
        });
        placeholder.removeFromParent();
        placeholder.geometry?.dispose?.();
        placeholder.material?.dispose?.();
        group.add(clone);
      }).catch(() => {
        // keep placeholder
      });
    }
    return group;
  };
  const hasPlacedGeometry = Boolean(
    (sceneDoc.voxels?.length ?? 0)
    || (sceneDoc.primitives?.length ?? 0)
    || (sceneDoc.panels?.length ?? 0)
    || (sceneDoc.models?.length ?? 0)
    || (sceneDoc.screens?.length ?? 0)
    || (sceneDoc.texts?.length ?? 0)
    || (sceneDoc.prefab_instances?.length ?? 0),
  );
  preview.showGridHint = !hasPlacedGeometry;
  syncPrivatePreviewEnvironmentState(preview);
  const boundsPreview = state.mode === "build" && isEditor()
    ? buildWorldBoundsPreview(state.selectedWorld, environmentTheme)
    : null;
  if (boundsPreview) {
    preview.root.add(boundsPreview);
  }

  for (const [index, voxel] of (sceneDoc.voxels ?? []).entries()) {
    const mesh = addMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(voxel.material, voxel.scale, {
        selected: isSelected("voxel", voxel.id),
      }),
      voxel.position || { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      voxel.scale || { x: 1, y: 1, z: 1 },
      { id: voxel.id || `voxel_${index}`, kind: "voxel" },
    );
    applyRenderableVisibility(mesh, {
      invisibleInPlay: voxel.invisible === true,
    });
    attachEmissionLight(mesh, voxel.material, voxel.scale || { x: 1, y: 1, z: 1 });
  }

  for (const primitive of sceneDoc.primitives ?? []) {
    if (useRuntimePrimitivePreview) {
      continue;
    }
    const runtimePrimitive = runtimeTransforms.dynamicById.get(primitive.id);
    renderPrimitiveMesh(runtimePrimitive ?? primitive, {
      id: primitive.id,
      authoredPrimitive: primitive,
      scale: runtimePrimitive?.scale || primitive.scale || { x: 1, y: 1, z: 1 },
      material: runtimePrimitive?.material_override
        ? { ...(runtimePrimitive.material ?? primitive.material ?? {}), ...runtimePrimitive.material_override }
        : (runtimePrimitive?.material ?? primitive.material),
      runtimeVisible: runtimePrimitive?.visible !== false,
      selected: isSelected("primitive", primitive.id),
    });
  }

  for (const panel of sceneDoc.panels ?? []) {
    renderPanelMesh(panel, {
      id: panel.id,
      selected: isSelected("panel", panel.id),
    });
  }

  for (const model of sceneDoc.models ?? []) {
    const runtimeModel = runtimeTransforms.dynamicById.get(model.id);
    renderModelMesh(runtimeModel ?? model, {
      id: model.id,
      selected: isSelected("model", model.id),
      runtimeVisible: runtimeModel?.visible !== false,
    });
  }

  for (const player of sceneDoc.players ?? []) {
    const runtimePlayer = runtimeTransforms.playerById.get(player.id);
    const resolvedPlayerScale = runtimePlayer?.scale || player.scale || 1;
    const mesh = addMesh(
      new THREE.CapsuleGeometry(
        PRIVATE_PLAYER_METRICS.width / 2,
        PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
        8,
        16,
      ),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : (player.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f"), texture_preset: "none" },
        { x: resolvedPlayerScale, y: resolvedPlayerScale, z: resolvedPlayerScale },
        {
          selected: isSelected("player", player.id),
        },
      ),
      runtimePlayer?.position || player.position || { x: 0, y: 1, z: 0 },
      runtimePlayer?.rotation || player.rotation || { x: 0, y: 0, z: 0 },
      { x: resolvedPlayerScale, y: resolvedPlayerScale, z: resolvedPlayerScale },
      { id: player.id, kind: "player" },
    );
    applyRenderableVisibility(mesh, {
      runtimeVisible: runtimePlayer?.visible !== false,
    });
    mesh.userData.privateWorldPlayerId = player.id;
  }

  for (const runtimePlayer of runtimeTransforms.players) {
    const playerId = runtimePlayer.id;
    if ((sceneDoc.players ?? []).some((entry) => entry.id === playerId)) {
      continue;
    }
    const mesh = addMesh(
      new THREE.CapsuleGeometry(
        PRIVATE_PLAYER_METRICS.width / 2,
        PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
        8,
        16,
      ),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : (runtimePlayer?.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f"), texture_preset: "none" },
        {
          x: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
          y: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
          z: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
        },
      ),
      runtimePlayer.position || { x: 0, y: 1, z: 0 },
      runtimePlayer.rotation || { x: 0, y: 0, z: 0 },
      {
        x: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
        y: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
        z: runtimePlayer?.scale || PRIVATE_PLAYER_DEFAULT_SCALE,
      },
      { id: playerId, kind: "player" },
    );
    applyRenderableVisibility(mesh, {
      runtimeVisible: runtimePlayer?.visible !== false,
    });
    mesh.userData.privateWorldPlayerId = playerId;
  }

  for (const prefabInstance of sceneDoc.prefab_instances ?? []) {
    const prefab = getSelectedPrefabEntry(prefabInstance.prefab_id);
    if (!prefab || prefabInstance.overrides?.visible === false) {
      continue;
    }
    const group = new THREE.Group();
    group.position.set(
      prefabInstance.position?.x || 0,
      prefabInstance.position?.y || 0,
      prefabInstance.position?.z || 0,
    );
    group.rotation.set(
      prefabInstance.rotation?.x || 0,
      prefabInstance.rotation?.y || 0,
      prefabInstance.rotation?.z || 0,
    );
    group.scale.set(
      prefabInstance.scale?.x || 1,
      prefabInstance.scale?.y || 1,
      prefabInstance.scale?.z || 1,
    );
    preview.root.add(group);
    preview.entityMeshes.set(prefabInstance.id, group);
    const rendered = renderPrefabDocument(group, prefab.prefab_doc ?? {}, {
      metadata: { id: prefabInstance.id, kind: "prefab_instance" },
      selected: isSelected("prefab_instance", prefabInstance.id),
      materialOverride: prefabInstance.overrides?.material ?? null,
      visitedPrefabIds: new Set([String(prefab.id ?? "").trim()]),
    });
    if (!rendered) {
      const fallbackBounds = getPrefabDocBounds(prefab.prefab_doc ?? {});
      const fallbackSize = fallbackBounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
      const fallbackCenter = fallbackBounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.5, 0);
      const fallback = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            Math.max(0.4, fallbackSize.x),
            Math.max(0.4, fallbackSize.y),
            Math.max(0.4, fallbackSize.z),
          ),
        ),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(isSelected("prefab_instance", prefabInstance.id) ? "#ffb36e" : "#ff8a5c"),
          transparent: true,
          opacity: 0.7,
          fog: false,
        }),
      );
      fallback.position.copy(fallbackCenter);
      attachPrefabPickable(fallback, { id: prefabInstance.id, kind: "prefab_instance" });
      group.add(fallback);
    }
  }

  for (const screen of sceneDoc.screens ?? []) {
    const material = new THREE.MeshBasicMaterial({
      color: screen.material?.color || "#ffffff",
      toneMapped: false,
    });
    const mesh = addMesh(
      new THREE.BoxGeometry(1, 1, 0.1),
      material,
      screen.position || { x: 0, y: 2, z: 0 },
      screen.rotation || { x: 0, y: 0, z: 0 },
      screen.scale || { x: 4, y: 2, z: 0.1 },
      { id: screen.id, kind: "screen" },
    );
    const textureViewport = getScreenTextureRenderSize(screen);
    void renderScreenHtmlTexture(THREE, screen, {
      width: textureViewport.width,
      height: textureViewport.height,
    }).then((texture) => {
      if (!texture || !mesh.parent) {
        return;
      }
      material.map = texture;
      material.color.set("#ffffff");
      material.needsUpdate = true;
    }).catch(() => {
      // ignore transient screen texture failures
    });
    registerPreviewBillboard(preview, mesh, screen.facing_mode);
  }

  for (const runtimePrimitive of runtimeTransforms.dynamicObjects) {
    const objectId = runtimePrimitive.id;
    if (String(runtimePrimitive?.entity_kind ?? "").trim() === "model") {
      const authoredModel = authoredModelById.get(String(objectId ?? "")) ?? null;
      if (authoredModel) {
        continue;
      }
      renderModelMesh(runtimePrimitive, {
        id: objectId,
        runtimeVisible: runtimePrimitive?.visible !== false,
        selected: isSelected("model", objectId),
      });
      continue;
    }
    const authoredPrimitive = authoredPrimitiveById.get(String(objectId ?? "")) ?? null;
    if (!useRuntimePrimitivePreview && authoredPrimitive) {
      continue;
    }
    renderPrimitiveMesh(runtimePrimitive, {
      id: objectId,
      authoredPrimitive,
      scale: runtimePrimitive?.scale || authoredPrimitive?.scale || { x: 1, y: 1, z: 1 },
      material: runtimePrimitive?.material_override
        ? { ...(runtimePrimitive.material ?? authoredPrimitive?.material ?? {}), ...runtimePrimitive.material_override }
        : (runtimePrimitive?.material ?? authoredPrimitive?.material ?? { color: "#edf2f8", texture_preset: "none" }),
      runtimeVisible: runtimePrimitive?.visible !== false,
      selected: isSelected("primitive", objectId),
    });
  }

  for (const text of sceneDoc.texts ?? []) {
    const mesh = addTextBillboard(preview, text.value || text.text, text.position || { x: 0, y: 2, z: 0 }, {
      rotation: text.rotation || { x: 0, y: 0, z: 0 },
      scale: text.scale ?? 1,
      selected: isSelected("text", text.id),
    });
    mesh.userData.privateWorldEntityId = text.id;
    mesh.userData.privateWorldEntityKind = "text";
    preview.entityPickables.push(mesh);
    preview.entityMeshes.set(text.id, mesh);
    registerPreviewBillboard(preview, mesh, text.facing_mode);
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
    mesh.rotation.set(trigger.rotation?.x || 0, trigger.rotation?.y || 0, trigger.rotation?.z || 0);
    mesh.scale.set(trigger.scale?.x || 2, trigger.scale?.y || 2, trigger.scale?.z || 2);
    mesh.userData.privateWorldEntityId = trigger.id;
    mesh.userData.privateWorldEntityKind = "trigger";
    preview.entityPickables.push(mesh);
    preview.entityMeshes.set(trigger.id, mesh);
    if (isSelected("trigger", trigger.id)) {
      mesh.material.color = new THREE.Color("#ffd659");
    }
    mesh.visible = state.mode === "build" && isEditor();
    preview.root.add(mesh);
  }

  for (const particle of sceneDoc.particles ?? []) {
    particleEffects.push(createParticleSystem(preview, particle.target_id, particle.effect, particle.color, particle.id, {
      position: particle.position,
      rotation: particle.rotation,
      scale: particle.scale,
      selected: isSelected("particle", particle.id),
    }));
  }

  preview.effectSystems = particleEffects;
  syncBuildPlacementOverlay(preview);
}

function connectWorldSocket() {
  const world = state.selectedWorld;
  if (!world) {
    disconnectWorldSocket();
    return;
  }
  const socketKey = [
    world.world_id,
    String(world.creator.username ?? "").trim().toLowerCase(),
    getPrivateViewerSessionId(),
  ].join(":");
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
        if (payload.event?.type !== "lock:updated") {
          pushEvent(payload.event?.type || "world:event", JSON.stringify(payload.event));
          void openWorld(world.world_id, world.creator.username, true);
        }
      } else if (payload.type === "world:runtime") {
        const previousRuntime = state.runtimeSnapshot;
        state.runtimeSnapshot = payload.snapshot ?? null;
        if (state.selectedWorld?.active_instance) {
          state.selectedWorld.active_instance.runtime = payload.snapshot ?? null;
          if (payload.snapshot?.status) {
            state.selectedWorld.active_instance.status = payload.snapshot.status;
          }
        }
        if (state.selectedWorld?.active_instance && payload.snapshot?.active_scene_id) {
          state.selectedWorld.active_instance.active_scene_id = payload.snapshot.active_scene_id;
          state.selectedSceneId = resolvePreferredSelectedSceneId(state.selectedWorld, {
            previousSelectedSceneId: state.selectedSceneId,
          });
        }
        renderRuntimeStatus();
        const activeSceneChanged = String(previousRuntime?.active_scene_id ?? "") !== String(payload.snapshot?.active_scene_id ?? "");
        if (activeSceneChanged || !syncPreviewRuntimeSnapshot(payload.snapshot)) {
          updatePreviewFromSelection();
        }
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
      } else if (payload.type === "game:session") {
        updatePrivateGameSessionState(payload.session ?? {});
      } else if (payload.type === "game:preview") {
        handlePrivateGamePreview(payload);
      } else if (payload.type === "game:stop-share") {
        handlePrivateGameStop(payload);
      } else if (payload.type === "game:open") {
        privateGameShell.openPayload(payload);
        updatePrivateGameSessionState(payload.session ?? {});
      } else if (payload.type === "game:state") {
        const sessionId = String(payload.sessionId ?? "").trim();
        const existing = state.gameSessions.get(sessionId);
        if (existing) {
          state.gameSessions.set(sessionId, {
            ...existing,
            authoritative_state: cloneJson(payload.state ?? null),
          });
        }
        privateGameShell.updateState(sessionId, payload.state ?? null);
      } else if (payload.type === "game:action") {
        privateGameShell.deliverAction(payload.sessionId, payload.action ?? null, payload.actor ?? null);
      } else if (payload.type === "game:copy") {
        state.selectedWorldGameId = String(payload?.game?.id ?? "").trim();
        privateGameLibrary.notifyCopied(payload.game ?? null);
        setPrivateBrowserStatus(payload?.game?.title ? `Saved ${payload.game.title} to your library.` : "Game copied to your library.");
      } else if (payload.type === "game:error") {
        privateGameShell.setStatus(payload.message || "Game share failed.");
        setPrivateBrowserStatus(payload.message || "Game share failed.");
      } else if (payload.type === "share:join-required") {
        clearPendingPrivateBrowserShare({ stopTracks: true });
        state.pendingShareJoin = {
          anchorSessionId: String(payload.anchorSessionId ?? payload.anchorSession?.sessionId ?? "").trim(),
          anchorHostSessionId: String(payload.anchorHostSessionId ?? payload.anchorSession?.hostSessionId ?? "").trim(),
          shareKind: normalizeBrowserShareKind(payload.shareKind, state.browserShareMode),
          approved: false,
        };
        state.pendingShareJoinCancellationAnchorSessionId = "";
        updatePrivateBrowserPanel();
      } else if (payload.type === "share:join-request") {
        const requestKey = `${String(payload.anchorSessionId ?? "").trim()}:${String(payload.requesterSessionId ?? "").trim()}`;
        state.incomingShareJoinRequests = [
          ...state.incomingShareJoinRequests.filter((request) =>
            `${request.anchorSessionId}:${request.requesterSessionId}` !== requestKey),
          {
            anchorSessionId: String(payload.anchorSessionId ?? "").trim(),
            requesterSessionId: String(payload.requesterSessionId ?? "").trim(),
            requesterDisplayName: String(payload.requesterDisplayName ?? "").trim(),
            shareKind: normalizeBrowserShareKind(payload.shareKind, "screen"),
            anchorSession: payload.anchorSession ?? null,
          },
        ];
        updatePrivateBrowserPanel();
      } else if (payload.type === "share:join-requested") {
        const anchorSessionId = String(payload.anchorSessionId ?? state.pendingShareJoin?.anchorSessionId ?? "").trim();
        if (isPrivateShareJoinCancellationPending(anchorSessionId)) {
          return;
        }
        state.pendingShareJoin = {
          ...(state.pendingShareJoin ?? {}),
          anchorSessionId,
          anchorHostSessionId: String(payload.anchorHostSessionId ?? state.pendingShareJoin?.anchorHostSessionId ?? "").trim(),
          shareKind: normalizeBrowserShareKind(state.pendingShareJoin?.shareKind, state.browserShareMode),
          approved: false,
        };
        updatePrivateBrowserPanel();
      } else if (payload.type === "share:join-cancelled") {
        const anchorSessionId = String(payload.anchorSessionId ?? "").trim();
        const requesterSessionId = String(payload.requesterSessionId ?? "").trim();
        if (requesterSessionId && requesterSessionId !== getPrivateViewerSessionId()) {
          state.incomingShareJoinRequests = state.incomingShareJoinRequests.filter((request) =>
            !(request.anchorSessionId === anchorSessionId && request.requesterSessionId === requesterSessionId));
          updatePrivateBrowserPanel();
          return;
        }
        if (state.pendingShareJoin?.anchorSessionId === anchorSessionId || isPrivateShareJoinCancellationPending(anchorSessionId)) {
          clearPendingPrivateShareJoinState();
          updatePrivateBrowserPanel();
        }
      } else if (payload.type === "share:join-resolved") {
        const anchorSessionId = String(payload.anchorSessionId ?? "").trim();
        if (isPrivateShareJoinCancellationPending(anchorSessionId)) {
          return;
        }
        if (payload.approved !== true) {
          clearPendingPrivateShareJoinState();
          updatePrivateBrowserPanel();
        } else {
          state.pendingShareJoin = {
            anchorSessionId,
            anchorHostSessionId: String(payload.anchorHostSessionId ?? "").trim(),
            shareKind: normalizeBrowserShareKind(state.pendingShareJoin?.shareKind, state.browserShareMode),
            approved: true,
          };
          state.pendingShareJoinCancellationAnchorSessionId = "";
          updatePrivateBrowserPanel();
          void privateBrowserShareFeature.launch();
        }
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
      } else if (payload.type === "voice:join-offer") {
        state.voiceJoinOffer = {
          sessionId: String(payload.sessionId ?? "").trim(),
          anchorSessionId: String(payload.anchorSessionId ?? "").trim(),
          anchorHostSessionId: String(payload.anchorHostSessionId ?? "").trim(),
          anchorSession: payload.anchorSession ?? null,
        };
        clearPendingPrivateVoiceJoinState();
        updatePrivateVoicePanel();
        renderPrivateVoiceJoinOffers();
      } else if (payload.type === "voice:join-requested") {
        const anchorSessionId = String(payload.anchorSessionId ?? state.pendingVoiceJoin?.anchorSessionId ?? "").trim();
        if (isPrivateVoiceJoinCancellationPending(anchorSessionId)) {
          return;
        }
        state.pendingVoiceJoin = {
          ...(state.pendingVoiceJoin ?? {}),
          anchorSessionId,
          anchorHostSessionId: String(payload.anchorHostSessionId ?? state.pendingVoiceJoin?.anchorHostSessionId ?? "").trim(),
          anchorSession: payload.anchorSession ?? state.pendingVoiceJoin?.anchorSession ?? state.voiceJoinOffer?.anchorSession ?? null,
        };
        state.pendingVoiceJoinCancellationAnchorSessionId = "";
        state.voiceJoinOffer = null;
        updatePrivateBrowserPanel();
      } else if (payload.type === "voice:join-request") {
        const requestKey = `${String(payload.anchorSessionId ?? "").trim()}:${String(payload.requesterSessionId ?? "").trim()}`;
        state.incomingVoiceJoinRequests = [
          ...state.incomingVoiceJoinRequests.filter((request) =>
            `${request.anchorSessionId}:${request.requesterSessionId}` !== requestKey),
          {
            anchorSessionId: String(payload.anchorSessionId ?? "").trim(),
            requesterSessionId: String(payload.requesterSessionId ?? "").trim(),
            requesterDisplayName: String(payload.requesterDisplayName ?? "").trim(),
            sessionId: String(payload.sessionId ?? "").trim(),
          },
        ];
        updatePrivateBrowserPanel();
      } else if (payload.type === "voice:join-cancelled") {
        const anchorSessionId = String(payload.anchorSessionId ?? "").trim();
        const requesterSessionId = String(payload.requesterSessionId ?? "").trim();
        if (requesterSessionId && requesterSessionId !== getPrivateViewerSessionId()) {
          state.incomingVoiceJoinRequests = state.incomingVoiceJoinRequests.filter((request) =>
            !(request.anchorSessionId === anchorSessionId && request.requesterSessionId === requesterSessionId));
          updatePrivateBrowserPanel();
          return;
        }
        if (
          state.pendingVoiceJoin?.anchorSessionId === anchorSessionId
          || isPrivateVoiceJoinCancellationPending(anchorSessionId)
          || state.voiceJoinOffer?.anchorSessionId === anchorSessionId
        ) {
          clearPendingPrivateVoiceJoinState();
          if (state.voiceJoinOffer?.anchorSessionId === anchorSessionId) {
            state.voiceJoinOffer = null;
          }
          updatePrivateBrowserPanel();
          if (payload.message) {
            setPrivateBrowserStatus(payload.message);
          }
        }
      } else if (payload.type === "voice:join-resolved") {
        const approved = payload.approved === true;
        clearPendingPrivateVoiceJoinState();
        state.voiceJoinOffer = null;
        updatePrivateVoicePanel();
        renderPrivateVoiceJoinOffers();
        if (approved) {
          const started = startPrivatePersistentVoiceContribution(payload.anchorSessionId);
          if (!started) {
            return;
          }
        }
        if (payload.message) {
          setPrivateBrowserStatus(payload.message);
        }
      } else if (payload.type === "voice:error") {
        clearPendingPrivateVoiceShare({ stopTracks: true });
        updatePrivateVoicePanel();
      } else if (payload.type === "browser:error") {
        clearPendingPrivateBrowserShare({ stopTracks: true });
        if (state.pendingShareJoin?.approved === true) {
          clearPendingPrivateShareJoinState();
        }
        setPrivateBrowserStatus(payload.message || "Live share failed.");
        updatePrivateBrowserPanel();
      } else if (payload.type === "world:snapshot") {
        if (payload.world?.world_id === state.selectedWorld?.world_id) {
          const previousSelectedSceneId = state.selectedSceneId;
          state.selectedWorld = payload.world;
          state.selectedSceneId = resolvePreferredSelectedSceneId(payload.world, {
            previousSelectedSceneId,
          });
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
    state.gameSessions.clear();
    privateGameShell.close();
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
  state.gameSessions.clear();
  renderPrivateChat();
  updatePrivateBrowserPanel();
}

async function openWorld(worldId, creatorUsername, includeContent = true, options = {}) {
  const previousWorldKey = state.selectedWorld
    ? `${state.selectedWorld.world_id}:${String(state.selectedWorld.creator?.username ?? "").trim().toLowerCase()}`
    : "";
  const requestedWorldKey = `${String(worldId ?? "").trim()}:${String(creatorUsername ?? "").trim().toLowerCase()}`;
  const showEntryLoading =
    options.entryLoading === true
    || (
      options.entryLoading !== false
      && Boolean(previousWorldKey)
      && previousWorldKey !== requestedWorldKey
    );
  if (showEntryLoading) {
    setEntryLoading(true, {
      title: options.loadingTitle || (previousWorldKey ? "Switching private worlds" : "Opening private world"),
      note: options.loadingNote || "Loading the scene you picked.",
    });
    await waitForUiPaint();
  }
  try {
    const previousSelectedSceneId = String(state.selectedSceneId ?? "").trim();
    const payload = await apiFetch(`/private/worlds/${encodeURIComponent(worldId)}`, {
      search: {
        creatorUsername,
        includeContent: includeContent ? "true" : "false",
        guestSessionId: state.session ? undefined : getGuestSessionId(),
      },
    });
    const nextWorldKey = payload.world
      ? `${payload.world.world_id}:${String(payload.world.creator?.username ?? "").trim().toLowerCase()}`
      : "";
    state.selectedWorld = payload.world;
    state.selectedSceneId = previousWorldKey === nextWorldKey
      ? resolvePreferredSelectedSceneId(payload.world, {
        previousSelectedSceneId,
      })
      : resolvePreferredSelectedSceneId(payload.world, {
        previousSelectedSceneId: "",
        preferSelected: false,
      });
    state.selectedPrefabId = payload.world?.prefabs?.[0]?.id || "";
    state.selectedScriptFunctionId = "";
    writeBuilderSelection([]);
    state.buildModifierKeys.clear();
    endBuildDrag();
    state.buildSuppressedClick = null;
    state.buildHover = null;
    state.launcherOpen = false;
    state.sceneDrawerOpen = false;
    if (!previousWorldKey || previousWorldKey !== nextWorldKey) {
      state.buildReturnSceneId = "";
      state.previewPointer.inside = false;
      clearPlacementTool();
      state.sceneDrafts.clear();
      state.screenAiPromptDrafts.clear();
      state.sceneEditorSceneId = "";
      state.scriptFunctionQuery = "";
      state.privateChatEntries = [];
      state.activeChats.clear();
      state.livePresence.clear();
      reconcilePrivatePresenceScene();
      resetViewerRig(payload.world);
      resetPrivateBrowserState({ disconnectController: true, stopTracks: true });
    }
    if (options.entryMode) {
      setMode(options.entryMode, { syncPanelTab: false });
    }
    syncRuntimeFromWorld(payload.world);
    renderSelectedWorld();
    connectWorldSocket();
    const shouldAutoJoin =
      options.autoJoin !== false
      && Boolean(state.session)
      && !getLocalParticipant(payload.world);
    if (shouldAutoJoin) {
      await joinWorld({ switchPanelTab: false });
    }
    if (options.entryMode === "play" && options.startRuntimeOnEntry !== false) {
      try {
        await ensurePlayRuntimeStarted({
          keepPanelTab: state.privatePanelTab,
        });
      } catch (error) {
        setStatus(error.message || "Could not start play mode.");
      }
    }
  } finally {
    if (showEntryLoading) {
      setEntryLoading(false);
    }
  }
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
    setLauncherOpen(true);
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
  await openWorld(payload.world.world_id, payload.world.creator.username, true, {
    entryLoading: true,
    entryMode: "play",
    loadingTitle: "Creating private world",
    loadingNote: "Preparing your default scene.",
  });
  try {
    await joinWorld();
  } catch (error) {
    setStatus(error.message);
  }
  elements.createWorldForm.reset();
  setCreateWorldDialogOpen(false);
}

async function saveCurrentScene(options = {}) {
  const scene = getSceneEditorScene();
  if (!scene || !state.selectedWorld) {
    return null;
  }
  const keepDrawerOpen = options.keepDrawerOpen ?? (state.sceneDrawerOpen === true);
  const keepPanelTab = options.keepPanelTab ?? state.privatePanelTab;
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
  discardSceneDraft(scene.id);
  if (options.pushEvent !== false) {
    pushEvent("scene:saved", payload.scene.name);
  }
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
  state.sceneDrawerOpen = keepDrawerOpen;
  state.privatePanelTab = keepPanelTab;
  renderSelectedWorld();
  return payload;
}

async function saveScene(event) {
  event.preventDefault();
  await saveCurrentScene();
}

async function createScene() {
  if (!state.selectedWorld || !isEditor()) {
    return;
  }
  const nextName = createNextSceneName(state.selectedWorld.scenes ?? []);
  const keepDrawerOpen = state.sceneDrawerOpen === true;
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/scenes`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      name: nextName,
      isDefault: false,
      sceneDoc: buildEmptySceneDoc(),
    },
  });
  pushEvent("scene:created", payload.scene.name);
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
  state.selectedSceneId = payload.scene.id;
  state.sceneDrawerFocusId = payload.scene.id;
  state.sceneDrawerOpen = keepDrawerOpen;
  renderSelectedWorld();
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
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.selectedWorld.world_id}.mauworld.zip`;
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
    format: "json",
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
  await loadAssets();
  await loadWorlds();
  await openWorld(imported.world.world_id, imported.world.creator.username, true, {
    entryLoading: true,
    entryMode: "play",
    loadingTitle: "Opening forked world",
    loadingNote: "Loading your new private copy.",
  });
  try {
    await joinWorld();
  } catch (error) {
    setStatus(error.message);
  }
}

async function importPackage(event) {
  event.preventDefault();
  if (!state.session) {
    setLauncherTab("access");
    setLauncherOpen(true);
    setStatus("Sign in to import a world package.");
    return;
  }
  const file = elements.importForm.elements.packageFile.files?.[0];
  if (!file) {
    return;
  }
  let payload = null;
  if (file.name.endsWith(".zip") || file.type.includes("zip")) {
    const response = await fetch(mauworldApiUrl("/private/worlds/import-archive"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.session.access_token}`,
        "Content-Type": file.type || "application/zip",
      },
      body: await file.arrayBuffer(),
    });
    payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Import failed (${response.status})`);
    }
  } else {
    const content = JSON.parse(await file.text());
    payload = await apiFetch("/private/worlds/import", {
      method: "POST",
      body: content,
    });
  }
  pushEvent("world:imported", payload.world.world_id);
  await loadAssets();
  await loadWorlds();
  await openWorld(payload.world.world_id, payload.world.creator.username, true, {
    entryLoading: true,
    entryMode: "play",
    loadingTitle: "Opening imported world",
    loadingNote: "Loading the imported scene.",
  });
  elements.importForm.reset();
  setCreateWorldDialogOpen(false);
}

async function resolveWorld(event) {
  event.preventDefault();
  const formData = new FormData(elements.resolveForm);
  const worldId = String(formData.get("worldId") ?? "").trim();
  const creatorUsername = String(formData.get("creatorUsername") ?? "").trim();
  await openWorld(worldId, creatorUsername, true, {
    entryLoading: true,
    entryMode: "play",
    loadingTitle: "Opening private world",
    loadingNote: "Loading the world you picked.",
  });
  elements.resolveForm.reset();
  setCreateWorldDialogOpen(false);
}

async function joinWorld(options = {}) {
  if (!state.selectedWorld) {
    return;
  }
  const showJoinLoading = state.entryLoading !== true;
  const localParticipant = getLocalParticipant(state.selectedWorld);
  if (localParticipant) {
    state.joined = true;
    state.joinedAsGuest = !state.session && localParticipant.join_role === "guest";
    renderSelectedWorld();
    if (options.switchPanelTab !== false) {
      setPrivatePanelTab("chat");
    }
    return;
  }
  if (!state.session) {
    setLauncherTab("access");
    setLauncherOpen(true);
    setStatus("Sign in to enter this private world.");
    return;
  }
  if (showJoinLoading) {
    setEntryLoading(true, {
      title: "Entering private world",
      note: "Stepping into the scene.",
    });
    await waitForUiPaint();
  }
  try {
    const anchor = getJoinAnchorPayload();
    const payload = await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/join`, {
      method: "POST",
      body: {
        creatorUsername: state.selectedWorld.creator.username,
        guestSessionId: undefined,
        displayName: getPrivateDisplayName(),
        joinRole: "viewer",
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
    if (options.switchPanelTab !== false) {
      setPrivatePanelTab("chat");
    }
    pushEvent("world:joined", `${payload.world.name}`);
  } finally {
    if (showJoinLoading) {
      setEntryLoading(false);
    }
  }
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
  const showLeaveLoading = state.entryLoading !== true;
  if (showLeaveLoading) {
    setEntryLoading(true, {
      title: "Leaving private world",
      note: "Updating your viewer state.",
    });
    await waitForUiPaint();
  }
  try {
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
    state.buildSuppressedClick = null;
    pushEvent("world:left", state.selectedWorld.name);
    await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true, {
      autoJoin: false,
      entryLoading: false,
    });
  } finally {
    if (showLeaveLoading) {
      setEntryLoading(false);
    }
  }
}

async function setReadyState(nextReady, options = {}) {
  if (!state.selectedWorld) {
    return;
  }
  const keepPanelTab = options.keepPanelTab ?? state.privatePanelTab;
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/ready`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      ready: nextReady === true,
    },
  });
  if (options.pushEvent !== false) {
    pushEvent("ready:updated", nextReady ? "Ready" : "Not ready");
  }
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
  state.privatePanelTab = keepPanelTab;
  renderSelectedWorld();
}

async function setReady() {
  if (!state.selectedWorld) {
    return;
  }
  const localParticipant = getLocalParticipant(state.selectedWorld);
  await setReadyState(!(localParticipant?.ready === true));
}

async function startScene(options = {}) {
  if (!state.selectedWorld) {
    return;
  }
  const keepPanelTab = options.keepPanelTab ?? state.privatePanelTab;
  const body = {
    creatorUsername: state.selectedWorld.creator.username,
  };
  if (options.sceneId !== undefined) {
    body.sceneId = options.sceneId;
  }
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/start-scene`, {
    method: "POST",
    body,
  });
  if (options.pushEvent !== false) {
    pushEvent("scene:started", state.selectedWorld.name);
  }
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
  state.privatePanelTab = keepPanelTab;
  renderSelectedWorld();
}

async function ensurePlayRuntimeStarted(options = {}) {
  if (!state.selectedWorld || !state.session) {
    return false;
  }
  const runtime = state.runtimeSnapshot ?? state.selectedWorld.active_instance?.runtime ?? null;
  const activeSceneId = String(runtime?.active_scene_id || state.selectedWorld.active_instance?.active_scene_id || "").trim();
  const targetSceneSeed = options.sceneId ?? activeSceneId ?? getDefaultScene(state.selectedWorld)?.id ?? state.selectedSceneId ?? "";
  const targetSceneId = String(targetSceneSeed).trim();
  const sceneAlreadyRunning = runtime?.scene_started === true && (!targetSceneId || activeSceneId === targetSceneId);
  if (sceneAlreadyRunning) {
    return false;
  }
  const startOptions = {
    keepPanelTab: options.keepPanelTab ?? state.privatePanelTab,
    pushEvent: options.pushEvent ?? false,
  };
  if (options.sceneId !== undefined) {
    startOptions.sceneId = options.sceneId;
  }
  await startScene(startOptions);
  return true;
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

async function enterPlayMode() {
  if (!state.selectedWorld) {
    return;
  }
  const showPlayLoading = state.entryLoading !== true;
  if (showPlayLoading) {
    setEntryLoading(true, {
      title: "Starting play mode",
      note: "Saving the scene and starting physics.",
    });
    await waitForUiPaint();
  }
  try {
    const keepPanelTab = "chat";
    const previousBuildSceneId = state.selectedSceneId;
    if (isEditor() && getSelectedScene()) {
      await saveCurrentScene({
        pushEvent: false,
        keepPanelTab: state.privatePanelTab,
      });
    }
    const defaultScene = getDefaultScene(state.selectedWorld);
    if (previousBuildSceneId) {
      state.buildReturnSceneId = previousBuildSceneId;
    }
    if (defaultScene?.id) {
      state.selectedSceneId = defaultScene.id;
    }
    if (!getLocalParticipant()) {
      await joinWorld({ switchPanelTab: false });
    }
    const targetSceneId = defaultScene?.id || state.selectedSceneId;
    if (state.session) {
      await ensurePlayRuntimeStarted({
        sceneId: targetSceneId,
        keepPanelTab,
        pushEvent: false,
      });
    }
    state.privatePanelTab = keepPanelTab;
    setMode("play");
    renderSelectedWorld();
    await waitForUiPaint();
  } finally {
    if (showPlayLoading) {
      setEntryLoading(false);
    }
  }
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

function mutateSceneDoc(mutator, options = {}) {
  const sceneDoc = parseSceneTextarea();
  mutator(sceneDoc);
  if (elements.sceneForm?.elements.scriptDsl) {
    sceneDoc.script_dsl = String(elements.sceneForm.elements.scriptDsl.value || sceneDoc.script_dsl || "").trim();
  }
  const sceneDocText = JSON.stringify(sceneDoc, null, 2);
  elements.sceneForm.elements.sceneDoc.value = sceneDocText;
  elements.sceneForm.elements.scriptDsl.value = sceneDoc.script_dsl || "";
  rememberSceneDraft({
    sceneDocText,
    scriptDslText: sceneDoc.script_dsl || "",
  });
  state.sceneEditorSceneId = state.selectedSceneId;
  if (options.renderBuilder !== false) {
    renderSceneBuilder();
  }
  if (options.updatePreview !== false) {
    updatePreviewFromSelection();
  }
}

function updateSelectedEntityField(path, rawValue, valueType = "text", options = {}) {
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntity(sceneDoc);
    if (!selected) {
      return;
    }
    let value = rawValue;
    if (valueType === "number") {
      const currentValue = Number(path.split(".").reduce((cursor, key) => cursor?.[key], selected.entry) ?? 0) || 0;
      value = path.endsWith("emissive_intensity")
        ? clampNumber(rawValue, currentValue, 0, 8)
        : clampNumber(rawValue, currentValue, -4096, 4096);
    } else if (valueType === "checkbox") {
      value = rawValue === true;
    } else if (valueType === "color") {
      value = /^#[0-9a-f]{6}$/i.test(String(rawValue ?? "")) ? String(rawValue).toLowerCase() : "#c8d0d8";
    } else {
      value = String(rawValue ?? "");
    }
    setByPath(selected.entry, path, value);
    if (valueType === "text" && String(value).trim() === "") {
      if (path === "group_id" || path === "particle_effect" || path === "trail_effect" || path === "prefab_id" || path === "target_id" || path.endsWith("texture_asset_id") || path === "asset_id") {
        setByPath(selected.entry, path, null);
      }
      if (path === "overrides.material.texture_preset") {
        setByPath(selected.entry, path, "none");
      }
    }
  }, options);
}

function groupSelectedEntities() {
  mutateSceneDoc((sceneDoc) => {
    const selectedEntities = getSelectedEntities(sceneDoc);
    if (selectedEntities.length < 2) {
      return;
    }
    const nextGroupId = createNextPersistentGroupId(sceneDoc);
    for (const selection of selectedEntities) {
      selection.entry.group_id = nextGroupId;
    }
    const refs = selectedEntities.map((selection) => ({ kind: selection.kind, id: selection.entry.id }));
    writeBuilderSelection(expandSelectionRefsWithPersistentGroups(refs, sceneDoc), refs[refs.length - 1] ?? null);
  });
}

function ungroupSelectedEntities() {
  mutateSceneDoc((sceneDoc) => {
    const selectedEntities = getSelectedEntities(sceneDoc);
    if (!selectedEntities.length) {
      return;
    }
    const groupInfo = getSelectionPersistentGroupInfo(sceneDoc, selectedEntities);
    const refsToKeepSelected = selectedEntities.map((selection) => ({ kind: selection.kind, id: selection.entry.id }));
    if (groupInfo.isWholeGroupSelected) {
      for (const memberRef of groupInfo.memberRefs) {
        const member = findEntityByRef(sceneDoc, memberRef);
        if (member?.entry && "group_id" in member.entry) {
          delete member.entry.group_id;
        } else if (member?.entry) {
          member.entry.group_id = null;
          delete member.entry.group_id;
        }
      }
    } else {
      for (const selection of selectedEntities) {
        if ("group_id" in selection.entry) {
          delete selection.entry.group_id;
        } else {
          selection.entry.group_id = null;
          delete selection.entry.group_id;
        }
      }
    }
    writeBuilderSelection(refsToKeepSelected, refsToKeepSelected[refsToKeepSelected.length - 1] ?? null);
  });
}

function removeEntityRefFromSelection(ref) {
  const remaining = getBuilderSelectionRefs().filter((entry) => !isSameEntityRef(entry, ref));
  writeBuilderSelection(remaining, remaining[remaining.length - 1] ?? null);
}

function deleteEntityRef(ref) {
  const normalizedRef = createEntityRef(ref?.kind, ref?.id);
  if (!normalizedRef) {
    return false;
  }
  let removed = false;
  mutateSceneDoc((sceneDoc) => {
    const selected = findEntityByRef(sceneDoc, normalizedRef);
    if (!selected) {
      return;
    }
    sceneDoc[selected.key].splice(selected.index, 1);
    removeEntityRefFromSelection(normalizedRef);
    removed = true;
  });
  return removed;
}

function removeSelectedEntity() {
  mutateSceneDoc((sceneDoc) => {
    const selected = getSelectedEntities(sceneDoc);
    if (!selected.length) {
      return;
    }
    for (const entry of [...selected].sort((left, right) => right.index - left.index)) {
      sceneDoc[entry.key].splice(entry.index, 1);
    }
    writeBuilderSelection([]);
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
        skybox: "blank",
        ambient_light: "even",
      },
      voxels: key === "voxels" ? [localEntry] : [],
      primitives: key === "primitives" ? [localEntry] : [],
      panels: key === "panels" ? [localEntry] : [],
      models: key === "models" ? [localEntry] : [],
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
  if (getBuilderSelectionRefs().length !== 1) {
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
    writeBuilderSelection([{
      kind: "prefab_instance",
      id: nextSceneDoc.prefab_instances[nextSceneDoc.prefab_instances.length - 1].id,
    }], {
      kind: "prefab_instance",
      id: nextSceneDoc.prefab_instances[nextSceneDoc.prefab_instances.length - 1].id,
    });
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
  if (state.prefabPlacementId === prefabId) {
    state.prefabPlacementId = "";
  }
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.prefab_instances = (sceneDoc.prefab_instances ?? []).filter((entry) => entry.prefab_id !== prefabId);
    if (state.builderSelection?.kind === "prefab_instance" && !sceneDoc.prefab_instances.some((entry) => entry.id === state.builderSelection.id)) {
      writeBuilderSelection([]);
    }
  });
  pushEvent("prefab:removed", prefabId);
}

function placeSelectedPrefab(prefabId = state.selectedPrefabId, placement = null) {
  if (!prefabId) {
    return false;
  }
  let placed = false;
  void acquireSceneLock();
  mutateSceneDoc((sceneDoc) => {
    sceneDoc.prefab_instances = sceneDoc.prefab_instances || [];
    const instanceId = `prefabinst_${slugToken(prefabId)}_${sceneDoc.prefab_instances.length + 1}`;
    sceneDoc.prefab_instances.push({
      id: instanceId,
      prefab_id: prefabId,
      label: `Instance ${sceneDoc.prefab_instances.length + 1}`,
      position: placement?.kind === "prefab" && placement.prefabId === prefabId
        ? deepClone(placement.position)
        : { x: sceneDoc.prefab_instances.length * 2.5, y: 0, z: 0 },
      rotation: placement?.kind === "prefab" && placement.prefabId === prefabId
        ? deepClone(placement.rotation ?? { x: 0, y: 0, z: 0 })
        : { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      overrides: {
        material: null,
        visible: true,
      },
    });
    writeBuilderSelection([{ kind: "prefab_instance", id: instanceId }], { kind: "prefab_instance", id: instanceId });
    placed = true;
  });
  if (placed) {
    refreshBuildHoverFromStoredPointer();
  }
  pushEvent("prefab:instanced", prefabId);
  return placed;
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
    setPlacementTool("voxel");
  });

  elements.addPrimitive.addEventListener("click", () => {
    setPlacementTool("primitive");
  });

  elements.addPlayer.addEventListener("click", () => {
    setPlacementTool("player");
  });

  elements.addScreen.addEventListener("click", () => {
    setPlacementTool("screen");
  });

  elements.addText.addEventListener("click", () => {
    setPlacementTool("text");
  });

  elements.addTrigger.addEventListener("click", () => {
    setPlacementTool("trigger");
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
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        enabled: true,
        color: "#ff5a7a",
      });
      writeBuilderSelection([{ kind: "particle", id: nextId }], { kind: "particle", id: nextId });
    });
  });

  elements.addRule.addEventListener("click", () => {
    setSceneDrawerTab("logic");
    setSceneDrawerOpen(true);
    window.setTimeout(() => {
      const existingFunctions = getSceneScriptFunctions();
      if (!existingFunctions.length && isEditor() && state.mode === "build") {
        mutateSceneScriptFunctions((functions) => {
          functions.push(normalizeScriptFunctionEntry({
            id: createScriptFunctionId("logic"),
            name: "Function 1",
            body: "",
          }, functions.length));
        });
      } else {
        renderSceneLogicLibrary();
      }
      focusSelectedScriptFunctionBody();
    }, 0);
  });
}

async function generateAi(kind, options = {}) {
  if (!state.selectedWorld) {
    return "";
  }
  if (!state.session) {
    throw new Error("Sign in to use AI Builder.");
  }
  const reasoning = getAiProviderState("reasoning");
  const provider = String(options.provider ?? reasoning.provider ?? "openai").trim() || "openai";
  const model = String(options.model ?? reasoning.model ?? "gpt-5.4-mini").trim() || "gpt-5.4-mini";
  const apiKey = String(options.apiKey ?? reasoning.apiKey ?? "").trim();
  writeAiProviderState("reasoning", { provider, model, apiKey });
  if (!apiKey) {
    throw new Error("Missing text reasoning API key");
  }
  setAiBuilderStatus(kind === "html" ? "Generating screen HTML..." : "Generating script...", "");
  const path = kind === "html" ? "/private/worlds/ai/screen-html" : "/private/worlds/ai/script";
  const payload = await apiFetch(path, {
    method: "POST",
    body: {
      provider,
      model,
      apiKey,
      worldName: state.selectedWorld.name,
      worldAbout: state.selectedWorld.about,
      objective: options.objective ?? elements.aiForm?.elements?.objective?.value ?? "",
      sceneSummary: options.sceneSummary ?? JSON.stringify(getSelectedScene()?.compiled_doc?.stats ?? {}),
      messages: cloneAiDialogMessages(options.messages ?? []),
      targetLabel: options.targetLabel ?? "",
      currentArtifact: options.currentArtifact ?? "",
      viewportSummary: options.viewportSummary ?? "",
    },
  });
  const text = String(payload.text ?? "").trim();
  if (options.outputTarget instanceof HTMLTextAreaElement) {
    options.outputTarget.value = text;
  } else if (options.mirrorToAiOutput !== false && elements.aiOutput) {
    elements.aiOutput.value = text;
  }
  setAiBuilderStatus(kind === "html" ? "Generated screen HTML." : "Generated script.", "success");
  pushEvent("ai:generated", kind === "html" ? "Generated screen HTML" : "Generated script");
  return text;
}

function openWorldAiDialog(kind = "html") {
  const isHtml = kind === "html";
  openAiDialog({
    artifactType: isHtml ? "screen_html" : "world_script",
    targetKind: "world",
    targetId: isHtml ? "world-screen" : "world-script",
    title: isHtml ? "Screen HTML brainstorm" : "Script brainstorm",
    note: isHtml
      ? "Talk through the screen first. The AI replies with assumptions and questions before you generate the final HTML."
      : "Talk through the world logic first. The AI replies with assumptions and questions before you generate the final script.",
    seedPrompt: String(elements.aiForm?.elements?.objective?.value ?? "").trim(),
  });
}

function openSceneLogicAiDialog() {
  if (!state.selectedWorld || !isEditor() || state.mode !== "build") {
    return false;
  }
  let selectedFunction = ensureSelectedScriptFunction();
  if (!selectedFunction) {
    mutateSceneScriptFunctions((functions) => {
      const nextIndex = functions.length;
      const nextFunction = normalizeScriptFunctionEntry({
        id: createScriptFunctionId("logic"),
        name: `Function ${nextIndex + 1}`,
        body: "",
      }, nextIndex);
      functions.push(nextFunction);
      state.selectedScriptFunctionId = nextFunction.id;
    });
    selectedFunction = ensureSelectedScriptFunction();
  }
  if (!selectedFunction) {
    setStatus("Create or select a function first.");
    return false;
  }
  openAiDialog({
    artifactType: "world_script",
    targetKind: "script_function",
    targetId: selectedFunction.id,
    title: `Brainstorm ${selectedFunction.name}`,
    note: "Let the AI shape assumptions and questions first. Generate only when this function feels settled.",
    applyLabel: "Apply to function",
    seedPrompt: String(elements.scriptFunctionPrompt?.value ?? "").trim(),
  });
  return true;
}

function openScreenAiDialog(screenId = "") {
  if (!state.selectedWorld || !isEditor() || state.mode !== "build") {
    return false;
  }
  const normalizedScreenId = String(screenId ?? "").trim();
  const selected = findEntityByRef(parseSceneTextarea(), { kind: "screen", id: normalizedScreenId });
  if (!selected?.entry) {
    setStatus("Select the screen you want to generate HTML for first.");
    return false;
  }
  openAiDialog({
    artifactType: "screen_html",
    targetKind: "screen",
    targetId: normalizedScreenId,
    title: `Brainstorm ${getDisplayNameForEntity("screen", selected.entry, selected.index)}`,
    note: "Talk through layout and content first. Generate only when the thread feels ready, then apply it back to this screen.",
    applyLabel: "Apply to screen",
    seedPrompt: getScreenAiPrompt(normalizedScreenId).trim(),
  });
  return true;
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
}

function bindEvents() {
  elements.launcherToggle?.addEventListener("click", () => {
    if (!state.launcherOpen) {
      setLauncherTab(getPreferredLauncherTab());
    }
    setLauncherOpen(!state.launcherOpen);
  });
  elements.launcherClose?.addEventListener("click", () => {
    setLauncherOpen(false);
  });
  for (const button of elements.privatePanelTabButtons ?? []) {
    button.addEventListener("click", () => {
      setPrivatePanelTab(button.getAttribute("data-private-panel-tab") || "chat", {
        refreshWorld: true,
      });
    });
  }
  elements.panelRoot?.addEventListener("scroll", () => {
    resetHorizontalScroll(elements.panelRoot);
  }, { passive: true });
  elements.panelOpenAccess?.addEventListener("click", () => {
    setLauncherTab("access");
    setLauncherOpen(true);
  });
  for (const button of elements.openCreateWorldButtons ?? []) {
    button.addEventListener("click", () => {
      setLauncherTab("worlds");
      setLauncherOpen(true);
      setCreateWorldDialogOpen(true);
    });
  }
  for (const button of elements.closeCreateWorldButtons ?? []) {
    button.addEventListener("click", () => {
      setCreateWorldDialogOpen(false);
    });
  }
  privateChatFeature.bind();
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
    const shareUrl = buildPrivateWorldEntryUrl(state.selectedWorld);
    if (!shareUrl) {
      return;
    }
    try {
      await copyTextToClipboard(shareUrl);
      setPrivateShareStatus("Entry link copied.");
    } catch (error) {
      setPrivateShareStatus(error.message || "Could not copy entry link.");
      setStatus(error.message || "Could not copy entry link.");
    }
  });
  elements.panelShareNative?.addEventListener("click", async () => {
    const shareUrl = buildPrivateWorldEntryUrl(state.selectedWorld);
    if (!shareUrl) {
      return;
    }
    try {
      if (typeof navigator.share !== "function") {
        await copyTextToClipboard(shareUrl);
        setPrivateShareStatus("Entry link copied.");
        return;
      }
      await navigator.share({
        title: state.selectedWorld?.name || "Mauworld Private World",
        text: state.selectedWorld?.about || "Join this private Mauworld scene.",
        url: shareUrl,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      setPrivateShareStatus(error?.message || "Could not share entry link.");
      setStatus(error?.message || "Could not share entry link.");
    }
  });
  const resumePrivateBrowserMediaFromGesture = () => {
    resumePrivateBrowserMediaPlayback();
  };
  window.addEventListener("pointerdown", resumePrivateBrowserMediaFromGesture, { capture: true });
  window.addEventListener("touchstart", resumePrivateBrowserMediaFromGesture, { capture: true, passive: true });
  window.addEventListener("keydown", resumePrivateBrowserMediaFromGesture, { capture: true });
  elements.panelBrowserExpand?.addEventListener("click", () => {
    if (state.browserShareMode === "game") {
      const localGameSession = getLocalPrivateGameSession();
      if (localGameSession) {
        requestOpenPrivateGameSession(localGameSession);
      } else {
        void openPrivateWorldGameLibrary();
      }
      return;
    }
    setPrivateBrowserOverlayOpen(!state.browserOverlayOpen);
  });
  elements.panelBrowserBackdrop?.addEventListener("click", () => {
    setPrivateBrowserOverlayOpen(false);
  });
  privateBrowserShareFeature.bind();
  elements.panelBrowserStop?.addEventListener("click", () => {
    if (state.browserShareMode === "game") {
      const sessionId = getLocalPrivateGameSession()?.session_id || "";
      if (sessionId) {
        sendWorldSocketMessage({
          type: "game:stop-share",
          sessionId,
        });
      } else {
        cancelPendingPrivateShareJoinRequest();
      }
      return;
    }
    const sessionId = getLocalPrivateBrowserSession()?.sessionId || "";
    if (sessionId) {
      sendWorldSocketMessage({
        type: "browser:stop",
        sessionId,
      });
      return;
    }
    cancelPendingPrivateShareJoinRequest();
  });
  elements.panelVoiceToggle?.addEventListener("click", () => {
    if (getLocalPrivateVoiceSession() || state.pendingVoiceShare) {
      stopPrivatePersistentVoiceChat();
      updatePrivateVoicePanel();
      return;
    }
    void startPrivatePersistentVoiceChat();
  });
  elements.panelBrowserResume?.addEventListener("click", () => {
    resumePrivateBrowserMediaPlayback();
  });
  elements.panelModeBuild?.addEventListener("click", () => {
    setMode("build", { syncPanelTab: false });
    renderSelectedWorld();
  });
  elements.panelModePlay?.addEventListener("click", () => {
    void enterPlayMode().catch((error) => {
      setStatus(error.message || "Could not enter play mode.");
    });
  });
  elements.panelLibrary?.addEventListener("click", () => {
    if (state.selectedWorld && isEditor()) {
      setSceneDrawerOpen(true);
      setPrivatePanelTab("world");
      setWorldPanelSection("overview", { openWorldPanel: false });
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
  elements.accountSignout?.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (error) {
      setStatus(error.message);
    }
  });
  elements.profileForm.addEventListener("submit", saveProfile);
  elements.createWorldForm.addEventListener("submit", handleCreateWorld);
  for (const button of elements.launcherWorldTabButtons ?? []) {
    button.addEventListener("click", () => {
      setLauncherWorldTab(button.getAttribute("data-launcher-world-tab") || "mine");
    });
  }
  elements.publicWorldType.addEventListener("change", () => {
    if (normalizeLauncherWorldTab(state.launcherWorldTab) === "all") {
      void loadPublicWorlds();
    }
  });
  elements.refreshWorlds.addEventListener("click", () => {
    if (normalizeLauncherWorldTab(state.launcherWorldTab) === "all") {
      void loadPublicWorlds();
      return;
    }
    void loadWorlds();
  });
  elements.worldSearch.addEventListener("input", () => {
    if (normalizeLauncherWorldTab(state.launcherWorldTab) === "all") {
      void loadPublicWorlds();
      return;
    }
    void loadWorlds();
  });
  elements.worldList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-launcher-world-result]");
    if (!card) {
      return;
    }
    const activeTab = normalizeLauncherWorldTab(state.launcherWorldTab);
    const worlds = activeTab === "all" ? state.publicWorlds : state.worlds;
    const key = card.getAttribute("data-launcher-world-result") || "";
    const world = worlds.find((entry) => getPrivateWorldBrowserKey(entry) === key);
    if (!world) {
      return;
    }
    void openWorld(world.world_id, world.creator?.username || world.creator_username || "", true, {
      entryLoading: true,
      entryMode: "play",
      loadingTitle: "Opening private world",
      loadingNote: "Loading the world you picked.",
    }).catch((error) => {
      setStatus(error.message);
    });
  });
  elements.importForm.addEventListener("submit", importPackage);
  elements.resolveForm.addEventListener("submit", resolveWorld);
  elements.toolPresetSelect?.addEventListener("change", () => {
    const kind = getActivePlacementTool();
    if (!isToolPresetKind(kind)) {
      return;
    }
    setSelectedToolPreset(kind, elements.toolPresetSelect.value);
  });
  elements.toolPresetCollapse?.addEventListener("click", () => {
    setToolPresetPanelCollapsed(true);
  });
  elements.toolPresetExpand?.addEventListener("click", () => {
    setToolPresetPanelCollapsed(false);
  });
  elements.saveToolPreset?.addEventListener("click", () => {
    const kind = getActivePlacementTool();
    if (!isToolPresetKind(kind)) {
      return;
    }
    const sourceEntry = getSelectedEntityForToolPreset(kind) || getToolPreset(kind)?.entry;
    if (!sourceEntry) {
      return;
    }
    saveToolPreset(kind, {
      name: elements.toolPresetName?.value,
      sourceEntry,
    });
    if (elements.toolPresetName) {
      elements.toolPresetName.value = "";
    }
    setStatus(`${buildToolPresetDisplayName(kind)} preset saved.`);
  });
  elements.updateToolPreset?.addEventListener("click", () => {
    const kind = getActivePlacementTool();
    const selectedPresetId = getSelectedToolPresetId(kind);
    const selectedPreset = getToolPreset(kind, selectedPresetId);
    const selectedEntry = getSelectedEntityForToolPreset(kind);
    if (!isToolPresetKind(kind) || !selectedEntry || !selectedPreset || selectedPreset.builtin) {
      return;
    }
    updateCustomToolPreset(kind, selectedPresetId, selectedEntry);
    setStatus(`${selectedPreset.name} updated from the current selection.`);
  });
  elements.deleteToolPreset?.addEventListener("click", () => {
    const kind = getActivePlacementTool();
    const selectedPresetId = getSelectedToolPresetId(kind);
    const selectedPreset = getToolPreset(kind, selectedPresetId);
    if (!isToolPresetKind(kind) || !selectedPreset || selectedPreset.builtin) {
      return;
    }
    deleteCustomToolPreset(kind, selectedPresetId);
    setStatus(`${selectedPreset.name} removed.`);
  });
  for (const button of elements.sceneDrawerTabButtons ?? []) {
    button.addEventListener("click", () => {
      setSceneDrawerTab(button.getAttribute("data-scene-drawer-tab") || "scenes");
    });
  }
  elements.sceneLibraryList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-library-id]");
    if (!button) {
      return;
    }
    focusSceneInDrawer(button.getAttribute("data-scene-library-id"));
  });
  elements.buildSceneSelect?.addEventListener("change", () => {
    selectSceneForEditing(elements.buildSceneSelect?.value);
  });
  for (const button of elements.sceneAddButtons ?? []) {
    button.addEventListener("click", () => {
      void createScene().catch((error) => {
        setStatus(error.message || "Could not create scene.");
      });
    });
  }
  elements.sceneForm.addEventListener("submit", saveScene);
  elements.refreshScene.addEventListener("click", () => {
    discardSceneDraft();
    renderSceneEditor();
    updatePreviewFromSelection();
  });
  elements.sceneSwitchButton?.addEventListener("click", () => {
    const scene = getSceneDrawerFocusedScene();
    if (!scene) {
      return;
    }
    selectSceneForEditing(scene.id);
  });
  elements.sceneForm.elements.name.addEventListener("input", () => {
    rememberSceneDraft();
  });
  elements.sceneForm.elements.isDefault.addEventListener("change", () => {
    rememberSceneDraft();
  });
  elements.sceneForm.elements.sceneSkybox?.addEventListener("change", () => {
    void acquireSceneLock();
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.settings = sceneDoc.settings || {};
      sceneDoc.settings.skybox = normalizePrivateSceneEnvironmentSettings({
        skybox: elements.sceneForm.elements.sceneSkybox.value,
      }).skybox;
    }, {
      renderBuilder: false,
    });
    renderSceneEnvironmentControls(parseSceneTextarea());
  });
  elements.sceneForm.elements.sceneAmbientLight?.addEventListener("change", () => {
    void acquireSceneLock();
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.settings = sceneDoc.settings || {};
      sceneDoc.settings.ambient_light = normalizePrivateSceneEnvironmentSettings({
        ambient_light: elements.sceneForm.elements.sceneAmbientLight.value,
      }).ambient_light;
    }, {
      renderBuilder: false,
    });
    renderSceneEnvironmentControls(parseSceneTextarea());
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("input", () => {
    rememberSceneDraft();
    try {
      const parsed = JSON.parse(elements.sceneForm.elements.sceneDoc.value || "{}");
      renderSceneEnvironmentControls(parsed);
      if (typeof parsed?.script_dsl === "string" && parsed.script_dsl !== elements.sceneForm.elements.scriptDsl.value) {
        elements.sceneForm.elements.scriptDsl.value = parsed.script_dsl;
        rememberSceneDraft({ scriptDslText: parsed.script_dsl });
        renderSceneLogicLibrary();
      }
    } catch (_error) {
      // let the raw JSON editor stay freeform while the user is typing
    }
    updatePreviewFromSelection();
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("focus", () => {
    void acquireSceneLock();
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("blur", () => {
    void releaseSceneLock();
  });
  elements.scriptFunctionSearch?.addEventListener("input", () => {
    state.scriptFunctionQuery = elements.scriptFunctionSearch.value || "";
    renderSceneLogicLibrary();
  });
  elements.entitySearch?.addEventListener("input", () => {
    state.entityQuery = elements.entitySearch.value || "";
    renderSceneBuilder();
  });
  elements.entityFilter?.addEventListener("change", () => {
    state.entityFilterKind = elements.entityFilter.value || "all";
    renderSceneBuilder();
  });
  elements.assetSearch?.addEventListener("input", () => {
    state.assetQuery = elements.assetSearch.value || "";
    void loadAssets();
  });
  elements.assetTypeFilter?.addEventListener("change", () => {
    state.assetFilterType = elements.assetTypeFilter.value || "all";
    void loadAssets();
  });
  elements.assetGenerateTexture?.addEventListener("click", () => {
    openAssetAiDialog("texture");
  });
  elements.assetGenerateModel?.addEventListener("click", () => {
    openAssetAiDialog("model");
  });
  elements.assetSections?.addEventListener("click", (event) => {
    const textureButton = event.target.closest("[data-apply-texture-asset]");
    if (textureButton) {
      applyTextureAssetToSelection(textureButton.getAttribute("data-apply-texture-asset"));
      return;
    }
    const modelButton = event.target.closest("[data-place-model-asset]");
    if (modelButton) {
      placeModelAsset(modelButton.getAttribute("data-place-model-asset"));
    }
  });
  elements.scriptFunctionList?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-script-function-id]");
    if (!card) {
      return;
    }
    state.selectedScriptFunctionId = card.getAttribute("data-script-function-id");
    renderSceneLogicLibrary();
  });
  elements.scriptFunctionNew?.addEventListener("click", () => {
    mutateSceneScriptFunctions((functions) => {
      const nextIndex = functions.length;
      const nextFunction = normalizeScriptFunctionEntry({
        id: createScriptFunctionId("logic"),
        name: `Function ${nextIndex + 1}`,
        body: "",
      }, nextIndex);
      functions.push(nextFunction);
      state.selectedScriptFunctionId = nextFunction.id;
    });
    focusSelectedScriptFunctionBody();
  });
  elements.scriptFunctionOpenGenerate?.addEventListener("click", () => {
    openSceneLogicAiDialog();
  });
  elements.scriptFunctionDelete?.addEventListener("click", () => {
    mutateSceneScriptFunctions((functions) => {
      const selectedIndex = functions.findIndex((entry) => entry.id === state.selectedScriptFunctionId);
      if (selectedIndex < 0) {
        return;
      }
      functions.splice(selectedIndex, 1);
      state.selectedScriptFunctionId = functions[Math.max(0, selectedIndex - 1)]?.id || functions[0]?.id || "";
    });
  });
  elements.scriptFunctionName?.addEventListener("focus", () => {
    void acquireSceneLock();
  });
  elements.scriptFunctionBody?.addEventListener("focus", () => {
    void acquireSceneLock();
  });
  elements.scriptFunctionName?.addEventListener("input", () => {
    mutateSceneScriptFunctions((functions) => {
      const selected = functions.find((entry) => entry.id === state.selectedScriptFunctionId);
      if (!selected) {
        return;
      }
      selected.name = elements.scriptFunctionName.value;
    }, { render: false });
  });
  elements.scriptFunctionBody?.addEventListener("input", () => {
    mutateSceneScriptFunctions((functions) => {
      const selected = functions.find((entry) => entry.id === state.selectedScriptFunctionId);
      if (!selected) {
        return;
      }
      selected.body = elements.scriptFunctionBody.value;
    }, { render: false });
  });
  elements.scriptFunctionName?.addEventListener("change", () => {
    mutateSceneScriptFunctions((functions) => {
      const selected = functions.find((entry) => entry.id === state.selectedScriptFunctionId);
      if (!selected) {
        return;
      }
      selected.name = elements.scriptFunctionName.value;
    });
  });
  elements.scriptFunctionBody?.addEventListener("change", () => {
    mutateSceneScriptFunctions((functions) => {
      const selected = functions.find((entry) => entry.id === state.selectedScriptFunctionId);
      if (!selected) {
        return;
      }
      selected.body = elements.scriptFunctionBody.value;
    });
  });
  elements.scriptFunctionName?.addEventListener("blur", () => {
    renderSceneLogicLibrary();
    void releaseSceneLock();
  });
  elements.scriptFunctionBody?.addEventListener("blur", () => {
    renderSceneLogicLibrary();
    void releaseSceneLock();
  });
  elements.scriptFunctionGenerate?.addEventListener("click", () => {
    openSceneLogicAiDialog();
  });
  elements.entitySections.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-kind][data-select-id]");
    if (!button) {
      return;
    }
    setBuilderSelection(
      button.getAttribute("data-select-kind"),
      button.getAttribute("data-select-id"),
      { append: getBuildTransformMode() === "multi" || event.shiftKey },
    );
  });
  elements.entityEditor.addEventListener("input", (event) => {
    const screenPromptField = event.target.closest("[data-screen-ai-prompt]");
    if (screenPromptField) {
      setScreenAiPrompt(screenPromptField.getAttribute("data-screen-ai-prompt"), screenPromptField.value);
      return;
    }
    const field = event.target.closest("[data-entity-field]");
    if (!field) {
      return;
    }
    updateSelectedEntityField(
      field.getAttribute("data-entity-field"),
      field.type === "checkbox" ? field.checked : field.value,
      field.getAttribute("data-value-type") || "text",
      { renderBuilder: false },
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
  elements.entityEditor.addEventListener("click", (event) => {
    const openTextureLibraryButton = event.target.closest("[data-open-texture-library]");
    if (openTextureLibraryButton) {
      openTextureAssetLibrary();
      return;
    }
    const generateTextureButton = event.target.closest("[data-generate-texture-from-inspector]");
    if (generateTextureButton) {
      openAssetAiDialog("texture");
      return;
    }
    const clearTextureButton = event.target.closest("[data-clear-texture-asset-path]");
    if (clearTextureButton) {
      clearTextureAssetFromSelection(clearTextureButton.getAttribute("data-clear-texture-asset-path") || "material.");
      return;
    }
    const screenGenerateButton = event.target.closest("[data-screen-ai-generate]");
    if (screenGenerateButton) {
      openScreenAiDialog(screenGenerateButton.getAttribute("data-screen-ai-generate"));
      return;
    }
    const groupButton = event.target.closest("[data-group-selection]");
    if (groupButton) {
      groupSelectedEntities();
      return;
    }
    const ungroupButton = event.target.closest("[data-ungroup-selection]");
    if (ungroupButton) {
      ungroupSelectedEntities();
    }
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
    armPrefabPlacement(state.selectedPrefabId, { toggle: true });
    renderSceneBuilder();
  });
  const handlePrefabLibraryClick = (event) => {
    const selectButton = event.target.closest("[data-select-prefab]");
    if (selectButton) {
      state.selectedPrefabId = selectButton.getAttribute("data-select-prefab");
      renderSceneBuilder();
      return;
    }
    const placeButton = event.target.closest("[data-place-prefab-id]");
    if (placeButton) {
      const prefabId = placeButton.getAttribute("data-place-prefab-id");
      state.selectedPrefabId = prefabId;
      armPrefabPlacement(prefabId, { toggle: true });
      renderSceneBuilder();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-prefab]");
    if (deleteButton) {
      void deletePrefab(deleteButton.getAttribute("data-delete-prefab")).catch((error) => {
        setStatus(error.message);
      });
      return;
    }
    const card = event.target.closest("[data-prefab-card-select]");
    if (card) {
      state.selectedPrefabId = card.getAttribute("data-prefab-card-select");
      renderSceneBuilder();
    }
  };
  const handlePrefabRenameChange = (event) => {
    const input = event.target.closest("[data-prefab-name]");
    if (!input) {
      return;
    }
    void renamePrefab(input.getAttribute("data-prefab-name"), input.value).catch((error) => {
      setStatus(error.message);
    });
  };
  elements.prefabList.addEventListener("click", handlePrefabLibraryClick);
  elements.prefabDetail?.addEventListener("click", handlePrefabLibraryClick);
  elements.prefabList.addEventListener("change", handlePrefabRenameChange);
  elements.prefabDetail?.addEventListener("change", handlePrefabRenameChange);
  elements.prefabSearch?.addEventListener("input", () => {
    state.prefabQuery = elements.prefabSearch.value || "";
    renderSceneBuilder();
  });
  elements.readyToggle?.addEventListener("click", () => {
    void setReady();
  });
  elements.releasePlayer?.addEventListener("click", () => {
    void releasePlayer();
  });
  elements.resetScene?.addEventListener("click", () => {
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
  syncAiProviderFormFromSession();
  refreshAiBuilderStatus();
  for (const group of ["reasoning", "image", "model"]) {
    const names = getAiProviderFieldNames(group);
    elements.aiForm.elements[names.provider]?.addEventListener("change", () => {
      writeAiProviderState(group, getAiProviderState(group));
      refreshAiBuilderStatus();
    });
    elements.aiForm.elements[names.model]?.addEventListener("input", () => {
      writeAiProviderState(group, getAiProviderState(group));
      refreshAiBuilderStatus();
    });
    elements.aiForm.elements[names.apiKey]?.addEventListener("input", () => {
      writeAiProviderState(group, getAiProviderState(group));
      refreshAiBuilderStatus();
    });
  }
  for (const button of elements.worldSectionJumpButtons ?? []) {
    button.addEventListener("click", () => {
      const sectionName = button.getAttribute("data-world-section-jump") || "";
      setWorldPanelSection(sectionName);
    });
  }
  elements.aiDialogBackdrop?.addEventListener("click", () => {
    closeAiDialog();
  });
  elements.aiDialogClose?.addEventListener("click", () => {
    closeAiDialog();
  });
  elements.aiDialogInput?.addEventListener("input", (event) => {
    state.aiDialog.input = event.target.value;
    persistAiDialogThreadState();
  });
  elements.aiDialogInput?.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void sendAiDialogMessage();
    }
  });
  elements.aiDialogSend?.addEventListener("click", () => {
    void sendAiDialogMessage();
  });
  elements.aiDialogGenerate?.addEventListener("click", () => {
    void generateAiDialogResult();
  });
  elements.aiDialogApply?.addEventListener("click", () => {
    applyAiDialogResult();
  });
  elements.aiDialogResult?.addEventListener("input", (event) => {
    state.aiDialog.result = event.target.value;
    persistAiDialogThreadState();
  });
  elements.generateHtml.addEventListener("click", () => {
    openWorldAiDialog("html");
  });
  elements.generateScript.addEventListener("click", () => {
    openWorldAiDialog("script");
  });
  window.addEventListener("keydown", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    if (
      event.key === "/"
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !isEditablePrivateTarget(event.target)
    ) {
      event.preventDefault();
      openPrivateChatComposer();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    const buildShortcut = getBuildTransformShortcut(event);
    const axisShortcut = getBuildTransformAxisShortcut(event);
    if ((!buildShortcut && !axisShortcut) || !canUsePlacementTools()) {
      return;
    }
    const buildKey = normalizeRuntimeKey(event);
    const axisModifierActive = hasBuildTransformAxisModifier();
    const activatingAxisShortcut = Boolean(
      axisShortcut
      && (
        axisModifierActive
        || buildShortcut === "move"
        || buildShortcut === "scale"
        || buildShortcut === "rotate"
      ),
    );
    if (buildShortcut || activatingAxisShortcut) {
      event.preventDefault();
    }
    state.buildModifierKeys.add(buildKey);
    privateInputState.keys.delete(buildKey);
    if (
      state.placementShortcutTool
      && getBuildTransformAxisLock(
        buildShortcut === "move" || buildShortcut === "scale" || buildShortcut === "rotate"
          ? buildShortcut
          : getResolvedBuildTransformMode()
      )
    ) {
      clearPlacementTool({ temporaryOnly: true });
      return;
    }
    if (!buildShortcut && !activatingAxisShortcut) {
      return;
    }
    refreshBuildHoverFromStoredPointer();
    updateShellState();
  });
  window.addEventListener("keydown", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    if (event.defaultPrevented && getBuildTransformAxisShortcut(event)) {
      return;
    }
    const toolKind = getPlacementShortcutTool(event);
    if (!toolKind || !canUsePlacementTools()) {
      return;
    }
    event.preventDefault();
    if (event.repeat && state.placementShortcutTool === toolKind) {
      return;
    }
    setPlacementTool(toolKind, { temporary: true });
  });
  window.addEventListener("keydown", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    const key = normalizeRuntimeKey(event);
    if (getBuildTransformShortcut(event) && canUsePlacementTools()) {
      return;
    }
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
    if (state.aiDialog.open) {
      return;
    }
    const buildShortcut = getBuildTransformShortcut(event);
    const axisShortcut = getBuildTransformAxisShortcut(event);
    const buildKey = normalizeRuntimeKey(event);
    const axisShortcutActive = Boolean(
      axisShortcut
      && (
        hasBuildTransformAxisModifier()
        || state.buildDrag?.handle
        || getBuildTransformAxisLock(getResolvedBuildTransformMode())
      ),
    );
    if ((buildShortcut || axisShortcut) && (canUsePlacementTools() || state.buildModifierKeys.has(buildKey))) {
      state.buildModifierKeys.delete(buildKey);
    }
    if (buildShortcut || axisShortcutActive) {
      event.preventDefault();
      endBuildDrag();
      refreshBuildHoverFromStoredPointer();
      updateShellState();
      return;
    }
  });
  window.addEventListener("keyup", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    if (event.defaultPrevented && getBuildTransformAxisShortcut(event)) {
      return;
    }
    const toolKind = getPlacementShortcutTool(event);
    if (!toolKind) {
      return;
    }
    event.preventDefault();
    if (state.placementShortcutTool === toolKind) {
      clearPlacementTool({ temporaryOnly: true });
      refreshBuildHoverFromStoredPointer();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (state.aiDialog.open) {
      return;
    }
    const key = normalizeRuntimeKey(event);
    if (getBuildTransformShortcut(event) && canUsePlacementTools()) {
      return;
    }
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
    state.buildModifierKeys.clear();
    privateInputState.keys.clear();
    privateInputState.sprintHoldSeconds = 0;
    privateInputState.pointerDown = false;
    privateInputState.pointerId = 0;
    privateInputState.pointerMoved = false;
    privateInputState.dragDistance = 0;
    state.viewerSuppressClickAt = 0;
    state.buildSuppressedClick = null;
    state.previewPointer.inside = false;
    state.buildHover = null;
    endBuildDrag();
    clearPlacementTool({ temporaryOnly: true });
    for (const key of keys) {
      void sendRuntimeInput(key, "up");
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (state.aiDialog.open) {
      event.preventDefault();
      closeAiDialog();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    if (state.browserOverlayOpen) {
      setPrivateBrowserOverlayOpen(false);
      return;
    }
    if (getActivePlacementTool() || getActivePrefabPlacementId()) {
      clearPlacementTool();
      return;
    }
    if (hasBuilderSelection()) {
      setBuilderSelection("", "");
      return;
    }
    if (state.createWorldDialogOpen) {
      setCreateWorldDialogOpen(false);
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

async function handleLaunchRequest(options = {}) {
  if (options.force === true) {
    state.launchRequestQueued = true;
  }
  if (state.launchRequestPromise) {
    return state.launchRequestPromise;
  }
  let forceRun = options.force === true;
  state.launchRequestPromise = (async () => {
    while (true) {
      state.launchRequestQueued = false;
      if (state.launchHandled && forceRun !== true) {
        return;
      }
      const launch = getLaunchRequest();
      if (!launch.worldId || !launch.creatorUsername) {
        return;
      }
      if (!state.session) {
        setLauncherTab("access");
        setLauncherOpen(true);
        setStatus("Sign in to continue to this private world.");
        pushEvent("launcher", "Sign in to continue to this private world");
        return;
      }
      state.launchHandled = true;
      await openWorld(launch.worldId, launch.creatorUsername, true, {
        entryLoading: true,
        entryMode: "play",
        loadingTitle: launch.fork ? "Preparing private world" : "Opening private world",
        loadingNote: launch.fork ? "Loading the source world before the fork opens." : "Loading the scene you picked.",
      });
      if (launch.fork) {
        try {
          await forkSelectedWorld();
          return;
        } catch (error) {
          setStatus(error.message);
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
      if (!state.launchRequestQueued) {
        return;
      }
      forceRun = true;
    }
  })().finally(() => {
    state.launchRequestPromise = null;
    state.launchRequestQueued = false;
  });
  return state.launchRequestPromise;
}

async function init() {
  bindEvents();
  renderEventLog();
  renderPrivateChat();
  renderPrivateShare();
  updatePrivateBrowserPanel();
  const launch = getLaunchRequest();
  if (launch.worldId && launch.creatorUsername) {
    setEntryLoading(true, {
      title: "Opening private world",
      note: "Checking your account before the scene opens.",
    });
  }
  renderSessionSummary();
  renderAccessSection();
  ensurePreview();
  setLauncherTab(getPreferredLauncherTab());
  setMode(state.mode);
  privateBrowserShareFeature.setSelectedMode(state.browserShareMode);
  updateShellState();
  await fetchAuthConfig();
  await refreshAuthState();
  await handleLaunchRequest();
}

void init().catch((error) => {
  setEntryLoading(false);
  renderSessionSummary();
  renderAccessSection();
  updateShellState();
  setStatus(error.message || "Could not initialize private worlds page");
  pushEvent("init:error", error.message || "Unknown initialization failure");
});
