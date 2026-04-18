import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { createPatternedMaterial } from "./private-world-materials.js";
import { renderScreenHtmlTexture } from "./screen-texture.js";
import { createBrowserMediaController } from "./world-browser-media.js";
import {
  createChatBubbleState,
  createChatBubbleRenderer,
  createChatFeature,
  createNearbyDisplayShareFeature,
  getBrowserShareKindLabel,
  getDisplayShareStageLayout,
  getDisplayShareStagePlaceholderText,
  getDisplayShareLaunchState,
  getLocalDisplaySharePresentation,
  isLocalDisplayShareActive,
  isEmojiOnlyChatText as sharedIsEmojiOnlyChatText,
  normalizeBrowserShareKind,
  normalizeHostedBrowserSession,
  sanitizeBrowserShareTitle,
  setDisplayShareOverlayState,
  updateChatBubbleGhosts,
} from "./world-interactions.js";
import {
  SHARED_BROWSER_SHARE_LAYOUT,
  SHARED_CHAT_BUBBLE_LAYOUT,
  getSharedBrowserScreenOffsetY,
} from "./world-overhead-layout.js";
import { createBubbleTexture, updateMascotMotion } from "./world-visitors.js";

const { mauworldApiUrl } = window.MauworldSocial;

const AI_KEY_STORAGE_KEY = "mauworldPrivateWorldAiKey";
const GUEST_SESSION_KEY = "mauworldPrivateWorldGuestSession";
const TOOL_PRESET_STORAGE_KEY = "mauworldPrivateWorldToolPresets";
const RUNTIME_INPUT_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "space", "shift"]);
const LAUNCHER_TABS = new Set(["worlds", "access"]);
const PRIVATE_PANEL_TABS = new Set(["chat", "share", "live", "build", "world"]);
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
const TOOL_PRESET_KINDS = ["voxel", "primitive", "player", "screen", "text", "trigger"];
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
  panelRuntimeActions: document.querySelector("[data-private-runtime-actions]"),
  panelRuntimeNote: document.querySelector("[data-private-runtime-note]"),
  panelLiveSearchForm: document.querySelector("[data-private-live-search-form]"),
  panelLiveSearchInput: document.querySelector("[data-private-live-search-input]"),
  panelLiveStatus: document.querySelector("[data-private-live-status]"),
  panelLiveResults: document.querySelector("[data-private-live-results]"),
  panelShareStatus: document.querySelector("[data-private-share-status]"),
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
  panelWorldMeta: document.querySelector("[data-private-panel-world-meta]"),
  panelModeBuild: document.querySelector("[data-private-panel-mode-build]"),
  panelModePlay: document.querySelector("[data-private-panel-mode-play]"),
  panelScenes: document.querySelector("[data-private-panel-scenes]"),
  panelExport: document.querySelector("[data-private-panel-export]"),
  panelEnter: document.querySelector("[data-private-panel-enter]"),
  panelLeave: document.querySelector("[data-private-panel-leave]"),
  panelReady: document.querySelector("[data-private-panel-ready]"),
  panelRelease: document.querySelector("[data-private-panel-release]"),
  panelReset: document.querySelector("[data-private-panel-reset]"),
  sceneDock: document.querySelector("[data-scene-dock]"),
  sceneDockSummary: document.querySelector("[data-scene-dock-summary]"),
  sceneDockOpen: document.querySelector("[data-scene-dock-open]"),
  sceneStrip: document.querySelector("[data-scene-strip]"),
  sceneLibraryHint: document.querySelector("[data-scene-library-hint]"),
  sceneLibraryList: document.querySelector("[data-scene-library-list]"),
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
  entityEditor: document.querySelector("[data-entity-editor]"),
  entityEmpty: document.querySelector("[data-entity-empty]"),
  selectionLabel: document.querySelector("[data-selection-label]"),
  prefabList: document.querySelector("[data-prefab-list]"),
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
  toolPresetPanel: document.querySelector("[data-tool-preset-panel]"),
  toolPresetTitle: document.querySelector("[data-tool-preset-title]"),
  toolPresetHint: document.querySelector("[data-tool-preset-hint]"),
  toolPresetSelect: document.querySelector("[data-tool-preset-select]"),
  toolPresetSummary: document.querySelector("[data-tool-preset-summary]"),
  toolPresetName: document.querySelector("[data-tool-preset-name]"),
  saveToolPreset: document.querySelector("[data-save-tool-preset]"),
  updateToolPreset: document.querySelector("[data-update-tool-preset]"),
  deleteToolPreset: document.querySelector("[data-delete-tool-preset]"),
};

elements.launcherSections = [...document.querySelectorAll("[data-launcher-section]")];
elements.openCreateWorldButtons = [...document.querySelectorAll("[data-open-create-world]")];
elements.closeCreateWorldButtons = [...document.querySelectorAll("[data-close-create-world]")];
elements.privatePanelTabButtons = [...document.querySelectorAll("[data-private-panel-tab]")];
elements.privatePanelViews = [...document.querySelectorAll("[data-private-panel-view]")];
elements.panelChatReactionButtons = [...document.querySelectorAll("[data-private-chat-reaction]")];
elements.panelBrowserShareModes = [...document.querySelectorAll("[data-private-browser-share-mode]")];
elements.sceneAddButtons = [...document.querySelectorAll("[data-scene-add-button]")];

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
      html: "<div style=\"padding:24px\"><h1>Hello world</h1><p>Static world screen.</p></div>",
    };
  }
  if (kind === "text") {
    return {
      value: "Welcome",
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      material: { color: "#ffffff", texture_preset: "none" },
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
  authReady: false,
  profile: null,
  publicWorlds: [],
  worlds: [],
  selectedWorld: null,
  selectedSceneId: "",
  buildReturnSceneId: "",
  selectedPrefabId: "",
  toolPresetSelection: initialToolPresetState.selected,
  toolPresetCustoms: initialToolPresetState.customs,
  selectedScriptFunctionId: "",
  prefabQuery: "",
  prefabPlacementId: "",
  scriptFunctionQuery: "",
  sceneDrafts: new Map(),
  screenAiPromptDrafts: new Map(),
  sceneEditorSceneId: "",
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
  activeLockEntityKey: "",
  runtimeSnapshot: null,
  pressedRuntimeKeys: new Set(),
  launcherTab: "access",
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

function normalizePrivatePanelTab(tab) {
  return PRIVATE_PANEL_TABS.has(tab) ? tab : "chat";
}

function setPrivatePanelTab(tab, options = {}) {
  const nextTab = normalizePrivatePanelTab(tab);
  const syncMode = options.syncMode !== false;
  const refreshWorld = options.refreshWorld === true;
  const enterBuildMode = syncMode && nextTab === "build" && state.mode !== "build" && isEditor();
  const exitBuildMode = syncMode && nextTab !== "build" && state.mode === "build";
  state.privatePanelTab = nextTab;
  if (enterBuildMode) {
    setMode("build", { syncPanelTab: false });
  }
  if (exitBuildMode) {
    setMode("play", { syncPanelTab: false });
  }
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
  if (nextTab === "live") {
    renderPrivateLiveSharesList();
  }
  if (refreshWorld && state.selectedWorld) {
    renderSelectedWorld();
  }
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
  for (const kind of ["voxel", "primitive", "player", "screen", "text", "trigger"]) {
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
    const sessionId = String(viewerSessionId ?? "").trim();
    if (!sessionId) {
      return null;
    }
    if (sessionId.startsWith("profile:")) {
      const profileId = sessionId.slice("profile:".length).trim();
      return participants.find((entry) => String(entry.profile?.id ?? entry.profile_id ?? "").trim() === profileId) ?? null;
    }
    return participants.find(
      (entry) => String(entry.guest_session_id ?? entry.guestSessionId ?? "").trim() === sessionId,
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

function updatePrivateShareBubbles(deltaSeconds, elapsedSeconds) {
  const preview = state.preview;
  if (!preview?.camera) {
    return;
  }
  reconcilePrivateShareBubbles();
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
const SCRIPT_FUNCTION_HEADER_RE = /^#\s*function(?:\[([a-z0-9_-]+)\])?:\s*(.*)$/i;

function isPlacementToolKind(kind) {
  return kind === "voxel"
    || kind === "primitive"
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
  if (kind === "player") {
    return "Player";
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
  if (state.browserPanelRemoteSessionId === normalized) {
    state.browserPanelRemoteSessionId = "";
    if (!state.localBrowserShare) {
      setPrivateBrowserPreviewStream(null);
    }
  }
  removePrivateShareBubbleEntry(normalized);
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
    updatePrivateBrowserPanel();
  },
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
  dropLocalPrivateBrowserSession(sessionId);
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
  const world = state.selectedWorld;
  const localParticipant = getLocalParticipant();
  const localSession = getLocalPrivateBrowserSession();
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
        (session) => session.hostSessionId !== getPrivateViewerSessionId() && session.deliveryMode === "full",
      ) ?? null;
  const canShare = Boolean(state.session && world && localParticipant && mediaAvailable && socketReady && authStable);
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
    elements.panelBrowserShareTitle.disabled = !canShare;
  }
  if (elements.panelBrowserLaunch) {
    const launchState = getDisplayShareLaunchState({
      canShare,
      pending: Boolean(state.pendingBrowserShare),
      localSession,
      draft,
    });
    elements.panelBrowserLaunch.disabled = launchState.disabled;
    elements.panelBrowserLaunch.textContent = launchState.label;
  }
  if (elements.panelBrowserStop) {
    elements.panelBrowserStop.disabled = !localSession;
  }
  if (elements.panelBrowserExpand) {
    elements.panelBrowserExpand.textContent = state.browserOverlayOpen ? "Dock" : "Focus";
    elements.panelBrowserExpand.setAttribute("aria-expanded", String(state.browserOverlayOpen));
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
  } else if (localSession?.sessionMode === "display-share") {
    const presentation = getLocalDisplaySharePresentation({
      localSession,
      localShare: state.localBrowserShare,
      draft,
      audienceLabel: "this private world",
      screenPrompt: "Share a tab or window to start the live stream.",
    });
    if (presentation) {
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
    updatePrivateBrowserSummary({
      state: "idle",
      badge: "Idle",
      current: draft.draftTitle ? `Ready: ${draft.draftModeLabel} "${draft.draftTitle}"` : `Ready: ${draft.draftModeLabel}`,
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
    state.worlds = [];
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
    renderWorldList();
    renderSelectedWorld();
    setLauncherTab("access");
    setLauncherOpen(true);
    disconnectWorldSocket();
    return;
  }
  try {
    const payload = await apiFetch("/private/profile");
    state.profile = payload.profile;
    renderProfile();
    renderAccessSection();
    renderSessionSummary();
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
    elements.worldList.innerHTML = '<div class="pw-world-card"><p>No private worlds yet. Create or import one to get started.</p></div>';
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
  const isActive = Boolean(world.active_instance);
  return [
    { label: "World ID", value: world.world_id },
    { label: "Creator", value: `${world.creator.display_name || world.creator.username} (@${world.creator.username})` },
    { label: "Size", value: `${world.width} × ${world.length} × ${world.height}` },
    { label: "Type", value: `${world.world_type} · ${world.template_size}` },
    { label: "Viewers", value: `${world.active_instance?.viewer_count ?? 0} / ${world.max_viewers}` },
    { label: "Entry", value: isActive ? "Direct autojoin link ready" : "Resolve link ready" },
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

function getDefaultScene(world = state.selectedWorld) {
  const scenes = world?.scenes ?? [];
  return scenes.find((scene) => scene.id === world?.default_scene_id)
    ?? scenes.find((scene) => scene.is_default === true)
    ?? scenes[0]
    ?? null;
}

function buildSceneEditorSnapshot(scene = getSelectedScene(), overrides = {}) {
  const sceneId = String(overrides.sceneId ?? scene?.id ?? state.selectedSceneId ?? "").trim();
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

function getSceneDraft(sceneId = state.selectedSceneId) {
  const key = String(sceneId ?? "").trim();
  return key ? state.sceneDrafts.get(key) ?? null : null;
}

function rememberSceneDraft(overrides = {}) {
  const snapshot = buildSceneEditorSnapshot(getSelectedScene(), overrides);
  if (snapshot?.sceneId) {
    state.sceneDrafts.set(snapshot.sceneId, snapshot);
  }
}

function discardSceneDraft(sceneId = state.selectedSceneId) {
  const key = String(sceneId ?? "").trim();
  if (!key) {
    return;
  }
  state.sceneDrafts.delete(key);
  if (state.sceneEditorSceneId === key) {
    state.sceneEditorSceneId = "";
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
    elements.scriptFunctionDelete.disabled = !canEdit || !selectedFunction;
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

  const showEditor = Boolean(selectedFunction);
  if (elements.scriptFunctionEmpty) {
    elements.scriptFunctionEmpty.hidden = showEditor;
    elements.scriptFunctionEmpty.textContent = functions.length
      ? "Select a function to edit its rules."
      : "Add a function to start shaping scene logic.";
  }
  if (elements.scriptFunctionFields) {
    elements.scriptFunctionFields.hidden = !showEditor;
  }
  if (!selectedFunction) {
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
  const summary = buildScriptFunctionSummary(selectedFunction);
  if (elements.scriptFunctionName) {
    elements.scriptFunctionName.disabled = !canEdit;
    if (elements.scriptFunctionName.value !== selectedFunction.name) {
      elements.scriptFunctionName.value = selectedFunction.name;
    }
  }
  if (elements.scriptFunctionBody) {
    elements.scriptFunctionBody.disabled = !canEdit;
    if (elements.scriptFunctionBody.value !== selectedFunction.body) {
      elements.scriptFunctionBody.value = selectedFunction.body;
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
  if (isEditor() && state.sceneEditorSceneId === String(scene.id ?? "").trim()) {
    try {
      return parseSceneTextarea();
    } catch (error) {
      if (state.mode === "build") {
        throw error;
      }
    }
  }
  if (state.mode === "play") {
    return scene.compiled_doc?.runtime?.resolved_scene_doc ?? scene.scene_doc ?? null;
  }
  return parseSceneTextarea();
}

function setMode(mode, options = {}) {
  const nextMode = mode === "build" && isEditor() ? "build" : "play";
  const previousMode = state.mode;
  const syncPanelTab = options.syncPanelTab !== false;
  state.mode = nextMode;
  if (nextMode === "play") {
    state.buildModifierKeys.clear();
    endBuildDrag();
    state.buildSuppressedClick = null;
    clearPlacementTool();
    writeBuilderSelection([]);
    state.sceneDrawerOpen = false;
    if (syncPanelTab && state.privatePanelTab === "build") {
      state.privatePanelTab = "chat";
    }
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
    if (syncPanelTab && state.privatePanelTab !== "build") {
      state.privatePanelTab = "build";
    }
  }
  document.body.classList.toggle("is-play-mode", nextMode === "play");
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
  const sceneId = String(scene?.id ?? "").trim();
  const draft = getSceneDraft(sceneId);
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
  elements.saveScene.disabled = !canEdit || !scene || !buildMode;
  elements.refreshScene.disabled = !scene;
  elements.sceneForm.elements.name.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.isDefault.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.sceneSkybox.disabled = !canEdit || !scene || !buildMode;
  elements.sceneForm.elements.sceneAmbientLight.disabled = !canEdit || !scene || !buildMode;
  elements.sceneForm.elements.scriptDsl.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.sceneDoc.disabled = !canEdit || !buildMode;
  renderSceneEnvironmentControls(sceneDocForControls);
  renderSceneLogicLibrary();
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
  if (elements.sceneDockSummary) {
    elements.sceneDockSummary.textContent = scenes.length
      ? `${buildSceneCountLabel(scenes.length)} · ${getSelectedScene()?.name || "No selection"}`
      : "No scenes yet";
  }
  elements.sceneStrip.innerHTML = scenes.map((scene) => `
    <button type="button" class="pw-scene-pill ${scene.id === state.selectedSceneId ? "is-active" : ""}" data-scene-id="${htmlEscape(scene.id)}">
      <strong>${htmlEscape(scene.name)}</strong>
      <span>${scene.version ? `v${scene.version}` : ""}${scene.is_default ? " · default" : ""}</span>
    </button>
  `).join("");
}

function buildSceneLibrarySummary(scene = {}) {
  const stats = scene.compiled_doc?.stats ?? {};
  const entityCount =
    Number(stats.solid_voxel_count ?? 0)
    + Number(stats.primitive_count ?? 0)
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

function renderSceneLibrary() {
  if (!elements.sceneLibraryList) {
    return;
  }
  const scenes = state.selectedWorld?.scenes ?? [];
  if (elements.sceneLibraryHint) {
    elements.sceneLibraryHint.textContent = scenes.length
      ? `${buildSceneCountLabel(scenes.length)} ready. Switch here, then edit the selected scene below.`
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
      class="pw-scene-library-item ${scene.id === state.selectedSceneId ? "is-active" : ""}"
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

function buildOptions(options = [], selectedValue = "") {
  return options.map((value) => `
    <option value="${htmlEscape(value)}" ${String(selectedValue) === String(value) ? "selected" : ""}>${htmlEscape(value || "none")}</option>
  `).join("");
}

function buildEntitySummary(kind, entry = {}) {
  if (kind === "particle") {
    return `${entry.target_id || "no target"} · ${describeVector3(entry.position)} · ${entry.enabled === false ? "off" : "on"}`;
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
  if (!elements.entitySections || !elements.entityEditor || !elements.prefabList) {
    return;
  }
  let sceneDoc = null;
  try {
    sceneDoc = parseSceneTextarea();
  } catch (_error) {
    writeBuilderSelection([]);
    updateShellState();
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">Fix the scene JSON to continue editing.</p></div>';
    elements.entityEditor.innerHTML = "";
    elements.prefabList.innerHTML = "";
    return;
  }
  const selected = ensureBuilderSelection(sceneDoc);
  updateShellState();
  if (elements.prefabSearch && elements.prefabSearch.value !== String(state.prefabQuery ?? "")) {
    elements.prefabSearch.value = String(state.prefabQuery ?? "");
  }
  renderEntitySections(sceneDoc, selected);
  renderEntityInspector(sceneDoc, selected);
  renderPrefabList(sceneDoc);
  renderToolPresetPanel();
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
                  class="pw-builder-item ${isEntitySelected(config.kind, entry.id) ? "is-active" : ""}"
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

function buildMaterialEditor(material = {}, options = {}) {
  const fieldPrefix = String(options.pathPrefix ?? "material.");
  const allowEmission = options.allowEmission === true;
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
    return [entry.shape || "box", entry.rigid_mode || "rigid", `${roundPrivateValue(scale.x ?? 1, 1)} x ${roundPrivateValue(scale.y ?? 1, 1)} x ${roundPrivateValue(scale.z ?? 1, 1)}`, ...extra].join(" · ");
  }
  if (kind === "player") {
    return `${entry.camera_mode || "third_person"} · ${entry.body_mode || "rigid"} · scale ${roundPrivateValue(entry.scale ?? 1, 1)}`;
  }
  if (kind === "screen") {
    const scale = entry.scale ?? { x: 4, y: 2.25, z: 0.2 };
    return `${roundPrivateValue(scale.x ?? 4, 1)} x ${roundPrivateValue(scale.y ?? 2.25, 1)} screen · ${stripHtmlTags(entry.html || "").slice(0, 40) || "custom html"}`;
  }
  if (kind === "text") {
    return `"${String(entry.value || "").slice(0, 36) || "Text"}" · scale ${roundPrivateValue(entry.scale ?? 1, 1)}`;
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
    const scale = entry.scale ?? { x: 1, y: 1, z: 1 };
    if (entry.shape === "plane") {
      return new THREE.Vector3(scale.x || 1, Math.max(0.1, (scale.y || 1) * 0.1), scale.z || 1);
    }
    return new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
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
      ${buildMaterialEditor(entry.material, { allowEmission: true })}
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
      ${buildMaterialEditor(entry.material, { allowEmission: true })}
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
      ${buildMaterialEditor(entry.material)}
      <div class="pw-inspector-grid">${buildVectorFields("Position", "position", entry.position)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Rotation", "rotation", entry.rotation)}</div>
      <div class="pw-inspector-grid">${buildVectorFields("Scale", "scale", entry.scale)}</div>
      <label>
        <span>Screen HTML</span>
        <textarea rows="10" data-entity-field="html" data-value-type="text" spellcheck="false">${htmlEscape(entry.html || "")}</textarea>
      </label>
      <label class="pw-screen-ai">
        <span>Generate HTML prompt</span>
        <textarea rows="3" data-screen-ai-prompt="${htmlEscape(entry.id)}" spellcheck="false" placeholder="Design a clean scoreboard, menu, instructions panel, or whatever this screen should show." ${aiDisabled ? "disabled" : ""}>${htmlEscape(screenPrompt)}</textarea>
      </label>
      <div class="pw-inline-actions">
        <button type="button" data-screen-ai-generate="${htmlEscape(entry.id)}" ${aiDisabled ? "disabled" : ""}>Generate HTML</button>
      </div>
      <p class="pw-screen-ai__hint">Uses the provider, model, and API key from AI Builder, then writes the result into this screen.</p>
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
    elements.prefabList.innerHTML = '<div class="pw-prefab-card"><p>No prefabs yet. Select an object and convert it into one.</p></div>';
    if (elements.prefabSearchHint) {
      elements.prefabSearchHint.textContent = "Turn a scene item into a prefab, then place it in the world from here.";
    }
    return;
  }
  if (!visiblePrefabs.length) {
    elements.prefabList.innerHTML = '<div class="pw-prefab-card"><p>No prefabs match that search.</p></div>';
    if (elements.prefabSearchHint) {
      elements.prefabSearchHint.textContent = "Try a different name or clear the search.";
    }
    return;
  }
  const activePrefab = visiblePrefabs.find(({ prefab }) => prefab.id === state.prefabPlacementId || prefab.id === state.selectedPrefabId)?.prefab ?? null;
  if (elements.prefabSearchHint) {
    elements.prefabSearchHint.textContent = state.prefabPlacementId
      ? `Placing ${activePrefab?.name || "prefab"} in the world. Click a spot in build mode to drop it.`
      : `${visiblePrefabs.length} prefab${visiblePrefabs.length === 1 ? "" : "s"} ready. Pick one, then click in the world to place it.`;
  }
  elements.prefabList.innerHTML = visiblePrefabs.map(({ prefab, meta }) => {
    const isSelected = state.selectedPrefabId === prefab.id;
    const isArmed = state.prefabPlacementId === prefab.id;
    return `
      <article class="pw-prefab-card ${isSelected ? "is-active" : ""} ${isArmed ? "is-armed" : ""}" data-prefab-card="${htmlEscape(prefab.id)}" data-prefab-card-select="${htmlEscape(prefab.id)}">
        <div class="pw-prefab-card__head">
          <div class="pw-prefab-card__title">
            <strong>${htmlEscape(prefab.name)}</strong>
            <span>${htmlEscape(meta.typeSummary)}</span>
          </div>
          <span class="pw-prefab-card__badge">${isArmed ? "armed" : isSelected ? "selected" : "saved"}</span>
        </div>
        <p>${htmlEscape(meta.itemCount)} item${meta.itemCount === 1 ? "" : "s"} · ${htmlEscape(meta.sizeSummary)}</p>
        <div class="pw-prefab-card__meta">
          <span>${htmlEscape(prefab.updated_at ? new Date(prefab.updated_at).toLocaleString() : "new")}</span>
          <span>${htmlEscape(meta.typeSummary)}</span>
        </div>
        <label>
          <span>Name</span>
          <input type="text" data-prefab-name="${htmlEscape(prefab.id)}" value="${htmlEscape(prefab.name)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""} />
        </label>
        <div class="pw-prefab-card__actions">
          <button type="button" data-place-prefab-id="${htmlEscape(prefab.id)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""}>${isArmed ? "Cancel" : "Use in world"}</button>
          <button type="button" class="is-muted" data-select-prefab="${htmlEscape(prefab.id)}">Details</button>
          <button type="button" class="is-muted" data-delete-prefab="${htmlEscape(prefab.id)}" ${!isEditor() || state.mode !== "build" ? "disabled" : ""}>Remove</button>
        </div>
      </article>
    `;
  }).join("");
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
  syncRuntimeFromWorld(world);
  if (!world) {
    writeBuilderSelection([]);
    state.sceneDrawerOpen = false;
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
  renderSceneLibrary();
  renderSceneEditor();
  renderCollaborators();
  renderRuntimeStatus();
  renderPrivateShare();
  updatePrivateBrowserPanel();

  const hasWorld = Boolean(world);
  const canEdit = isEditor();
  const localParticipant = getLocalParticipant(world);
  state.joined = Boolean(localParticipant);
  state.joinedAsGuest = !state.session && localParticipant?.join_role === "guest";
  const joinedAsPlayer = localParticipant?.join_role === "player";
  const showEnterControl = hasWorld && Boolean(state.session) && !localParticipant;
  const showLeaveControl = hasWorld && Boolean(localParticipant) && !joinedAsPlayer;
  const showReadyControl = hasWorld && state.session && joinedAsPlayer;
  const showReleaseControl = hasWorld && state.session && joinedAsPlayer;
  const showResetControl = hasWorld && canEdit;
  const readyLabel = localParticipant?.ready === true ? "Not Ready" : "Ready Up";
  if (!hasWorld || (state.privatePanelTab === "build" && !canEdit)) {
    state.privatePanelTab = "chat";
  } else {
    state.privatePanelTab = normalizePrivatePanelTab(state.privatePanelTab);
  }
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
    elements.sceneToolsToggle.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }
  if (elements.sceneDock) {
    elements.sceneDock.hidden = !hasWorld || !canEdit || state.mode !== "build";
  }
  for (const button of elements.sceneAddButtons ?? []) {
    button.disabled = !hasWorld || !canEdit || state.mode !== "build";
  }
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
    elements.panelScenes.disabled = !hasWorld || !canEdit || state.mode !== "build";
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
  if (elements.panelRuntimeNote) {
    elements.panelRuntimeNote.textContent = !hasWorld
      ? "Open or create a world to enter."
      : !localParticipant
        ? "Opening a world should place you inside it. If you ever leave, Enter World brings you back."
        : joinedAsPlayer
          ? `${readyLabel} changes this player's ready state. Leave Player returns you to viewer mode.${showResetControl ? " Reset Scene is editor-only." : ""}`
          : `Click a player capsule to inhabit it. ${showResetControl ? "Reset Scene returns everyone to the world's default scene." : "Ready Up appears after you take a player."}`;
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
  if (kind === "voxel" || kind === "primitive") {
    return { x: PRIVATE_WORLD_BLOCK_UNIT, y: PRIVATE_WORLD_BLOCK_UNIT, z: PRIVATE_WORLD_BLOCK_UNIT };
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
  const preview = ensurePreview();
  const clientX = Number(pointerSource?.clientX);
  const clientY = Number(pointerSource?.clientY);
  if (!preview || !Number.isFinite(clientX) || !Number.isFinite(clientY) || !elements.previewCanvas) {
    return null;
  }
  const rect = elements.previewCanvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
  );
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
    || kind === "player"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "particle"
    || kind === "prefab_instance";
}

function canScaleEntityKind(kind) {
  return kind === "primitive"
    || kind === "screen"
    || kind === "text"
    || kind === "trigger"
    || kind === "particle"
    || kind === "prefab_instance";
}

function canRotateEntityKind(kind) {
  return kind === "primitive"
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

function getSelectionOutlinePadding(count = 1) {
  if (count <= 1) {
    return 0.18;
  }
  return Math.min(PRIVATE_WORLD_BLOCK_UNIT * 0.35, 0.18 + (count - 1) * PRIVATE_WORLD_BLOCK_UNIT * 0.05);
}

function buildOverlayOutline(preview, box, options = {}) {
  if (!preview?.buildOverlay || !box) {
    return null;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const geometry = new THREE.BoxGeometry(
    Math.max(0.12, size.x),
    Math.max(0.12, size.y),
    Math.max(0.12, size.z),
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
  outline.position.copy(center);
  preview.buildOverlay.add(outline);
  return outline;
}

function getTransformHandleSpecs(box) {
  if (!box) {
    return [];
  }
  const center = box.getCenter(new THREE.Vector3());
  return [
    { axis: "x", direction: -1, key: "x:-1", position: new THREE.Vector3(box.min.x, center.y, center.z) },
    { axis: "x", direction: 1, key: "x:1", position: new THREE.Vector3(box.max.x, center.y, center.z) },
    { axis: "y", direction: -1, key: "y:-1", position: new THREE.Vector3(center.x, box.min.y, center.z) },
    { axis: "y", direction: 1, key: "y:1", position: new THREE.Vector3(center.x, box.max.y, center.z) },
    { axis: "z", direction: -1, key: "z:-1", position: new THREE.Vector3(center.x, center.y, box.min.z) },
    { axis: "z", direction: 1, key: "z:1", position: new THREE.Vector3(center.x, center.y, box.max.z) },
  ];
}

function getRotateHandleSpecs(box) {
  if (!box) {
    return [];
  }
  const center = box.getCenter(new THREE.Vector3());
  return [
    { axis: "x", key: "rx:-1:-1", position: new THREE.Vector3(center.x, box.min.y, box.min.z) },
    { axis: "x", key: "rx:-1:1", position: new THREE.Vector3(center.x, box.min.y, box.max.z) },
    { axis: "x", key: "rx:1:-1", position: new THREE.Vector3(center.x, box.max.y, box.min.z) },
    { axis: "x", key: "rx:1:1", position: new THREE.Vector3(center.x, box.max.y, box.max.z) },
    { axis: "y", key: "ry:-1:-1", position: new THREE.Vector3(box.min.x, center.y, box.min.z) },
    { axis: "y", key: "ry:-1:1", position: new THREE.Vector3(box.min.x, center.y, box.max.z) },
    { axis: "y", key: "ry:1:-1", position: new THREE.Vector3(box.max.x, center.y, box.min.z) },
    { axis: "y", key: "ry:1:1", position: new THREE.Vector3(box.max.x, center.y, box.max.z) },
    { axis: "z", key: "rz:-1:-1", position: new THREE.Vector3(box.min.x, box.min.y, center.z) },
    { axis: "z", key: "rz:-1:1", position: new THREE.Vector3(box.min.x, box.max.y, center.z) },
    { axis: "z", key: "rz:1:-1", position: new THREE.Vector3(box.max.x, box.min.y, center.z) },
    { axis: "z", key: "rz:1:1", position: new THREE.Vector3(box.max.x, box.max.y, center.z) },
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

function getTransformHandleHit(pointerSource) {
  const preview = ensurePreview();
  if (!preview?.transformPickables?.length || !elements.previewCanvas) {
    return null;
  }
  const clientX = Number(pointerSource?.clientX);
  const clientY = Number(pointerSource?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  const rect = elements.previewCanvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
  );
  preview.raycaster.setFromCamera(pointer, preview.camera);
  return preview.raycaster.intersectObjects(preview.transformPickables, false)[0] ?? null;
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
  state.buildHover = {
    context,
    gridCell: resolveBuildGridCell(context),
    placement: prefabPlacementId && sceneDoc
      ? resolvePrefabPlacementPreview(prefabPlacementId, sceneDoc, context)
      : toolKind && sceneDoc
        ? resolvePlacementPreview(toolKind, sceneDoc, context)
        : null,
    entityRef: getEntityRefFromHit(context.hit),
    transformHandle: transformHandleHit?.object?.userData?.privateWorldTransformHandle
      ? { ...transformHandleHit.object.userData.privateWorldTransformHandle }
      : null,
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

function buildTransformHandles(preview, box, hoveredHandleKey = "") {
  if (!preview?.buildOverlay || !box) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const handleSize = clampNumber(Math.max(size.x, size.y, size.z) * 0.12, 1.1, 0.6, 2.4);
  const pickSize = Math.max(handleSize * 2.4, 1.6);
  const handleOffset = Math.max(0.24, handleSize * 0.58);
  for (const handle of getTransformHandleSpecs(box)) {
    const isHovered = handle.key === hoveredHandleKey;
    const axisVector = getBuildDragAxisVector(handle.axis);
    const handlePosition = handle.position.clone().addScaledVector(axisVector, handle.direction * handleOffset);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(handleSize, handleSize, handleSize),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(getTransformHandleColor(handle.axis)),
        transparent: true,
        opacity: isHovered ? 1 : 0.82,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.position.copy(handlePosition);
    mesh.scale.setScalar(isHovered ? 1.22 : 1);
    preview.buildOverlay.add(mesh);

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

function buildRotateHandles(preview, box, hoveredHandleKey = "") {
  if (!preview?.buildOverlay || !box) {
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const handleThickness = clampNumber(maxSize * 0.1, 0.72, 0.5, 1.5);
  const handleLength = clampNumber(maxSize * 0.3, 1.6, 1.05, 3.8);
  const pickThickness = Math.max(handleThickness * 2.8, 1.9);
  const pickLength = Math.max(handleLength * 1.35, 2.4);
  const handleOffset = Math.max(0.18, handleThickness * 0.4);
  const buildDimensions = (axis, longSide, shortSide) => ({
    x: axis === "x" ? longSide : shortSide,
    y: axis === "y" ? longSide : shortSide,
    z: axis === "z" ? longSide : shortSide,
  });
  for (const handle of getRotateHandleSpecs(box)) {
    const isHovered = handle.key === hoveredHandleKey;
    const outward = handle.position.clone().sub(center);
    if (outward.lengthSq() < 0.0001) {
      outward.copy(getBuildDragAxisVector(handle.axis));
    } else {
      outward.normalize();
    }
    const handlePosition = handle.position.clone().addScaledVector(outward, handleOffset);
    const visibleDimensions = buildDimensions(handle.axis, handleLength, handleThickness);
    const pickDimensions = buildDimensions(handle.axis, pickLength, pickThickness);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(visibleDimensions.x, visibleDimensions.y, visibleDimensions.z),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(getTransformHandleColor(handle.axis)),
        transparent: true,
        opacity: isHovered ? 1 : 0.86,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.position.copy(handlePosition);
    mesh.scale.setScalar(isHovered ? 1.16 : 1);
    preview.buildOverlay.add(mesh);

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
  const requestedTransformMode = buildMode ? getBuildTransformMode() : "";
  const gridCell = hover?.gridCell ?? null;
  const placement = hover?.placement ?? null;
  const hoveredEntityRef = hover?.entityRef ?? null;
  const hoveredHandleKey = hover?.transformHandle?.key ?? "";
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
  const selectionBounds = selectionRefs.length ? getOverlayBoundsForRefs(preview, selectionRefs) : null;
  const overlayKey = [
    buildMode ? "build" : "idle",
    activePrefabPlacementId ? `prefab:${activePrefabPlacementId}` : activeTool || "none",
    transformMode || "none",
    selectionRefs.map((entry) => `${entry.kind}:${entry.id}`).join(",") || "noselection",
    getOverlayBoundsSignature(selectionBounds),
    hoveredEntityRef ? `${hoveredEntityRef.kind}:${hoveredEntityRef.id}` : "nohover",
    hoveredHandleKey || "nohandle",
    gridCell ? `${gridCell.x}:${gridCell.z}` : "nogrid",
    placement ? `${placement.key}:${placement.valid ? "ok" : "blocked"}` : "noplacement",
  ].join("|");
  if (preview.buildOverlayKey === overlayKey) {
    return;
  }
  clearBuildPlacementOverlay(preview);
  preview.buildOverlay.visible = buildMode;
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
    const rawBounds = getOverlayBoundsForRefs(preview, refs);
    if (!rawBounds) {
      return null;
    }
    const paddedBounds = rawBounds.clone().expandByScalar(options.padding ?? getSelectionOutlinePadding(refs.length));
    buildOverlayOutline(preview, paddedBounds, {
      color: options.color,
      opacity: options.opacity,
    });
    return paddedBounds;
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
  const groupBounds = selectionRefs.length
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
  if ((transformMode === "move" || transformMode === "multi") && groupBounds) {
    buildTransformHandles(preview, groupBounds, hoveredHandleKey);
  } else if (transformMode === "scale" && groupBounds && canScaleSelection(selectedEntities)) {
    if (canAxisScaleSelection(selectedEntities)) {
      buildTransformHandles(preview, groupBounds, hoveredHandleKey);
    }
  } else if (transformMode === "rotate" && groupBounds && canRotateSelection(selectedEntities)) {
    buildRotateHandles(preview, groupBounds, hoveredHandleKey);
  }
  preview.buildOverlayKey = overlayKey;
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
  return getFirstPreviewEntityHit(preview.raycaster.intersectObjects(preview.entityPickables, false));
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

function getBuildDragAxisVector(axis) {
  if (axis === "x") {
    return new THREE.Vector3(1, 0, 0);
  }
  if (axis === "y") {
    return new THREE.Vector3(0, 1, 0);
  }
  return new THREE.Vector3(0, 0, 1);
}

function getBuildDragAxisPlane(axis, origin, preview = state.preview) {
  if (!preview?.camera) {
    return null;
  }
  const axisVector = getBuildDragAxisVector(axis);
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

function getBuildMoveStep(kind) {
  return kind === "trigger" ? 0.25 : 0.1;
}

function getBuildScaleStep(kind) {
  return kind === "trigger" ? 0.25 : 0.1;
}

function getBuildScaleMinimum(kind, axis = "x") {
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

function applyRotationToEntity(selection, entry, axis, angle, pivot) {
  if (!canRotateEntityKind(selection.kind) || !pivot) {
    return;
  }
  const axisVector = getBuildDragAxisVector(axis);
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
  entry.rotation.x = Number(startRotation.x ?? 0) || 0;
  entry.rotation.y = Number(startRotation.y ?? 0) || 0;
  entry.rotation.z = Number(startRotation.z ?? 0) || 0;
  entry.rotation[axis] = roundPrivateValue(clampNumber(
    (Number(startRotation[axis] ?? 0) || 0) + angle,
    Number(startRotation[axis] ?? 0) || 0,
    -Math.PI * 16,
    Math.PI * 16,
  ));
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

function applyAxisMoveToEntity(selection, entry, axis, amount) {
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

function applyAxisScaleToEntity(selection, entry, axis, direction, amount) {
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
  const hoveredEntityRef = state.buildHover?.entityRef ?? getEntityRefFromHit(hit);
  const hoveredHandle = state.buildHover?.transformHandle ?? null;
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
  const selectionBounds = getOverlayBoundsForRefs(state.preview, getBuilderSelectionRefs());
  if (!selectionBounds) {
    return false;
  }
  const pivot = selectionBounds.getCenter(new THREE.Vector3());
  let plane = null;
  let startPoint = null;
  let axis = null;
  let direction = 0;
  let dragType = transformMode === "scale" ? "scale-uniform" : "move-plane";
  if (hoveredHandle) {
    axis = hoveredHandle.axis;
    if (transformMode === "rotate") {
      if (hoveredHandle.type !== "rotate") {
        return false;
      }
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(getBuildDragAxisVector(axis), pivot);
      startPoint = getBuildDragPoint(event, plane);
      if (!startPoint) {
        return false;
      }
      dragType = "rotate-axis";
    } else {
      if (hoveredHandle.type === "rotate") {
        return false;
      }
      direction = hoveredHandle.direction;
      plane = getBuildDragAxisPlane(axis, pivot);
      startPoint = getBuildDragPoint(event, plane);
      if (!startPoint) {
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
    direction,
    pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
    startPoint: startPoint?.clone?.() ?? null,
    startVector: dragType === "rotate-axis"
      ? startPoint.clone().sub(pivot)
      : null,
    startBoundsSize: selectionBounds.getSize(new THREE.Vector3()),
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
    const point = getBuildDragPoint(event, state.buildDrag.plane);
    if (!point || !state.buildDrag.startPoint) {
      return false;
    }
    const delta = new THREE.Vector3().subVectors(point, state.buildDrag.startPoint);
    if (state.buildDrag.type === "move-plane") {
      amount = 0;
      state.buildDrag.delta = delta;
      state.buildDrag.moved = state.buildDrag.moved || delta.lengthSq() > 0.0004;
    } else if (state.buildDrag.type === "rotate-axis") {
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
      angle = getSignedAngleAroundAxis(startVector, currentVector, getBuildDragAxisVector(state.buildDrag.axis));
      state.buildDrag.moved = state.buildDrag.moved || Math.abs(angle) > 0.01;
    } else {
      amount = delta.dot(getBuildDragAxisVector(state.buildDrag.axis));
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
        applyAxisMoveToEntity(selection, current.entry, state.buildDrag.axis, amount);
      } else if (state.buildDrag.type === "scale-axis") {
        if (isGroupSelection) {
          applyGroupAxisScaleToEntity(selection, current.entry, state.buildDrag.axis, axisFactor, pivot);
        } else {
          applyAxisScaleToEntity(selection, current.entry, state.buildDrag.axis, state.buildDrag.direction, amount);
        }
      } else if (state.buildDrag.type === "scale-uniform") {
        if (isGroupSelection) {
          applyGroupUniformScaleToEntity(selection, current.entry, factor, pivot);
        } else {
          applyUniformScaleToEntity(selection, current.entry, factor);
        }
      } else if (state.buildDrag.type === "rotate-axis") {
        applyRotationToEntity(selection, current.entry, state.buildDrag.axis, angle, pivot);
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
  applyPrivatePreviewAtmosphere(preview, theme);
  const bounds = getPrivateWorldBounds(world);
  const nextKey = `${bounds.width}:${bounds.length}:${bounds.height}:${theme.skybox}:${theme.ambient_light}`;
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
    buildOverlay: new THREE.Group(),
    actors: new THREE.Group(),
    presence: new THREE.Group(),
    chatBubbleGhosts: new THREE.Group(),
    browserShares: new THREE.Group(),
    trails: new THREE.Group(),
    raycaster: new THREE.Raycaster(),
    entityPickables: [],
    transformPickables: [],
    entityMeshes: new Map(),
    effectSystems: [],
    animatedChatBubbleGhosts: [],
    trailPuffs: [],
    presenceEntries: new Map(),
    browserShareEntries: new Map(),
    lastFrameAt: performance.now(),
    ambientLight: ambient,
    sunLight,
  };
  buildPreviewEnvironment(state.preview);
  state.preview.scene.add(state.preview.root);
  state.preview.scene.add(state.preview.buildOverlay);
  state.preview.scene.add(state.preview.actors);
  state.preview.scene.add(state.preview.presence);
  state.preview.scene.add(state.preview.browserShares);
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
    state.previewPointer.clientX = event.clientX;
    state.previewPointer.clientY = event.clientY;
    state.previewPointer.pointerId = event.pointerId;
    state.previewPointer.inside = true;
    refreshBuildHoverFromPointer(event);
    if (state.mode === "build" && isEditor()) {
      if (getActivePlacementTool() || getActivePrefabPlacementId()) {
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
    if (state.viewerSuppressClickAt && performance.now() - state.viewerSuppressClickAt < 240) {
      return;
    }
    if (state.mode === "build" && (getActivePlacementTool() || getActivePrefabPlacementId())) {
      refreshBuildHoverFromPointer(event);
      placeActiveTool();
      return;
    }
    const hit = raycastPreviewPointer(event);
    const entityRef = getEntityRefFromHit(hit);
    if (state.mode === "build") {
      const transformMode = getBuildTransformMode();
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

function makeMaterial(material = {}, scale = { x: 1, y: 1, z: 1 }, { selected = false } = {}) {
  const built = createPatternedMaterial(THREE, material, {
    repeatX: Math.max(1, Number(scale?.x ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
    repeatY: Math.max(1, Number(scale?.z ?? scale?.y ?? PRIVATE_WORLD_BLOCK_UNIT) / PRIVATE_WORLD_BLOCK_UNIT),
  });
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
      const mesh = addPrefabMesh(
        parent,
        getPrimitiveGeometry(primitive),
        makeMaterial(getMergedMaterial(primitive.material), primitive.scale, { selected }),
        primitive.position || { x: 0, y: 1, z: 0 },
        primitive.rotation || { x: 0, y: 0, z: 0 },
        primitive.scale || { x: 1, y: 1, z: 1 },
        metadata ?? { id: primitive.id || `prefab_primitive_${index}`, kind: "primitive" },
      );
      applyRenderableVisibility(mesh, {
        invisibleInPlay: primitive.invisible === true,
      });
      attachEmissionLight(mesh, getMergedMaterial(primitive.material), primitive.scale || { x: 1, y: 1, z: 1 });
      if (selected && mesh.material?.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = Math.max(Number(mesh.material.emissiveIntensity || 0), 0.3);
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
      const material = new THREE.MeshStandardMaterial({
        color: resolvedMaterial?.color || "#ffffff",
        roughness: 0.42,
        metalness: 0.08,
        emissive: "#4f6d8f",
        emissiveIntensity: selected ? 0.24 : 0.2,
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
        material.emissiveIntensity = selected ? 0.16 : 0.06;
        material.needsUpdate = true;
      }).catch(() => {
        // ignore transient screen texture failures
      });
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
  const hasPlacedGeometry = Boolean(
    (sceneDoc.voxels?.length ?? 0)
    || (sceneDoc.primitives?.length ?? 0)
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
          selected: isSelected("primitive", primitive.id),
        },
      ),
      runtimePrimitive?.position || primitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive?.rotation || primitive.rotation || { x: 0, y: 0, z: 0 },
      primitive.scale || { x: 1, y: 1, z: 1 },
      { id: primitive.id, kind: "primitive" },
    );
    applyRenderableVisibility(mesh, {
      invisibleInPlay: primitive.invisible === true,
      runtimeVisible: runtimePrimitive?.visible !== false,
    });
    attachEmissionLight(
      mesh,
      runtimePrimitive?.material_override
        ? { ...primitive.material, ...runtimePrimitive.material_override }
        : primitive.material,
      primitive.scale || { x: 1, y: 1, z: 1 },
      {
        runtimeVisible: runtimePrimitive?.visible !== false,
      },
    );
    if (primitive.particle_effect) {
      particleEffects.push(createParticleSystem(preview, primitive.id, primitive.particle_effect, primitive.material?.color || "#ffb16a"));
    }
    if (primitive.trail_effect) {
      particleEffects.push(createTrailSystem(preview, primitive.id, primitive.trail_effect, primitive.material?.color || "#ffcf84"));
    }
    if (isSelected("primitive", primitive.id)) {
      mesh.material.emissiveIntensity = Math.max(Number(mesh.material.emissiveIntensity || 0), 0.3);
    }
  }

  for (const player of sceneDoc.players ?? []) {
    const runtimePlayer = runtimeTransforms.playerById.get(player.id);
    const mesh = addMesh(
      new THREE.CapsuleGeometry(
        PRIVATE_PLAYER_METRICS.width / 2,
        PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
        8,
        16,
      ),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : (player.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f"), texture_preset: "none" },
        { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
        {
          selected: isSelected("player", player.id),
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
      new THREE.CapsuleGeometry(
        PRIVATE_PLAYER_METRICS.width / 2,
        PRIVATE_PLAYER_METRICS.height - PRIVATE_PLAYER_METRICS.width,
        8,
        16,
      ),
      makeMaterial(
        { color: runtimePlayer?.occupied_by_username ? "#ff5a6f" : "#ff8e4f", texture_preset: "none" },
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
    if (isSelected("screen", screen.id)) {
      material.emissive = new THREE.Color("#355f9b");
      material.emissiveIntensity = 0.24;
    }
    const textureViewport = getScreenTextureRenderSize(screen);
    void renderScreenHtmlTexture(THREE, screen, {
      width: textureViewport.width,
      height: textureViewport.height,
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
    const mesh = addMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(runtimePrimitive?.material_override ?? { color: "#edf2f8", texture_preset: "none" }),
      runtimePrimitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive.rotation || { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { id: objectId, kind: "primitive" },
    );
    applyRenderableVisibility(mesh, {
      runtimeVisible: runtimePrimitive?.visible !== false,
    });
    attachEmissionLight(
      mesh,
      runtimePrimitive?.material_override ?? runtimePrimitive?.material ?? { color: "#edf2f8", texture_preset: "none" },
      { x: 1, y: 1, z: 1 },
      {
        runtimeVisible: runtimePrimitive?.visible !== false,
      },
    );
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
    const defaultSceneId = payload.world?.active_instance?.active_scene_id
      || payload.world?.default_scene_id
      || payload.world?.scenes?.find((scene) => scene.is_default === true)?.id
      || payload.world?.scenes?.[0]?.id
      || "";
    const canPreserveSceneSelection =
      previousWorldKey === nextWorldKey
      && state.mode === "build"
      && payload.world?.permissions?.can_edit === true
      && (payload.world?.scenes ?? []).some((scene) => scene.id === previousSelectedSceneId);
    state.selectedSceneId = canPreserveSceneSelection ? previousSelectedSceneId : defaultSceneId;
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
  state.mode = "build";
  await openWorld(payload.world.world_id, payload.world.creator.username, true, {
    entryLoading: true,
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
  const scene = getSelectedScene();
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
  await openWorld(imported.world.world_id, imported.world.creator.username, true, {
    entryLoading: true,
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
  const content = JSON.parse(await file.text());
  const payload = await apiFetch("/private/worlds/import", {
    method: "POST",
    body: content,
  });
  pushEvent("world:imported", payload.world.world_id);
  await loadWorlds();
  await openWorld(payload.world.world_id, payload.world.creator.username, true, {
    entryLoading: true,
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
  await apiFetch(`/private/worlds/${encodeURIComponent(state.selectedWorld.world_id)}/start-scene`, {
    method: "POST",
    body: {
      creatorUsername: state.selectedWorld.creator.username,
      sceneId: options.sceneId ?? state.selectedSceneId,
    },
  });
  if (options.pushEvent !== false) {
    pushEvent("scene:started", state.selectedWorld.name);
  }
  await openWorld(state.selectedWorld.world_id, state.selectedWorld.creator.username, true);
  state.privatePanelTab = keepPanelTab;
  renderSelectedWorld();
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
  const runtime = state.runtimeSnapshot ?? state.selectedWorld?.active_instance?.runtime ?? null;
  const activeSceneId = runtime?.active_scene_id || state.selectedWorld?.active_instance?.active_scene_id || "";
  const targetSceneId = defaultScene?.id || state.selectedSceneId;
  const sceneAlreadyRunning = runtime?.scene_started === true && activeSceneId === targetSceneId;
  if (state.session && isEditor() && !sceneAlreadyRunning) {
    await startScene({
      sceneId: targetSceneId,
      keepPanelTab,
      pushEvent: false,
    });
  }
  state.privatePanelTab = keepPanelTab;
  setMode("play");
  renderSelectedWorld();
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
      if (path === "group_id" || path === "particle_effect" || path === "trail_effect" || path === "prefab_id" || path === "target_id") {
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
  const provider = String(options.provider ?? elements.aiForm?.elements?.provider?.value ?? "openai").trim() || "openai";
  const model = String(options.model ?? elements.aiForm?.elements?.model?.value ?? "gpt-5.4-mini").trim() || "gpt-5.4-mini";
  const apiKey = String(options.apiKey ?? elements.aiForm?.elements?.apiKey?.value ?? "").trim();
  setAiKey(apiKey);
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
    },
  });
  const text = String(payload.text ?? "").trim();
  if (options.outputTarget instanceof HTMLTextAreaElement) {
    options.outputTarget.value = text;
  } else if (elements.aiOutput) {
    elements.aiOutput.value = text;
  }
  pushEvent("ai:generated", kind === "html" ? "Generated screen HTML" : "Generated script");
  return text;
}

async function generateSceneLogicFunction() {
  if (!state.selectedWorld || !isEditor() || state.mode !== "build") {
    return;
  }
  const prompt = String(elements.scriptFunctionPrompt?.value ?? "").trim();
  if (!prompt) {
    setStatus("Add a short prompt for the logic you want generated.");
    elements.scriptFunctionPrompt?.focus?.();
    return;
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
  const objective = [
    prompt,
    selectedFunction?.name ? `Write one self-contained Mauworld logic function called "${selectedFunction.name}".` : "Write one self-contained Mauworld logic function.",
    "Return only the DSL rules for that function. No markdown fences. No explanation.",
  ].join(" ");
  const generatedText = normalizeGeneratedScriptBody(await generateAi("script", {
    objective,
    outputTarget: elements.aiOutput,
  }));
  if (!generatedText) {
    setStatus("The AI returned an empty logic function.");
    return;
  }
  mutateSceneScriptFunctions((functions) => {
    const target = functions.find((entry) => entry.id === state.selectedScriptFunctionId) ?? functions[functions.length - 1] ?? null;
    if (!target) {
      return;
    }
    target.body = generatedText;
  });
  focusSelectedScriptFunctionBody();
}

async function generateSelectedScreenHtml(screenId = "") {
  if (!state.selectedWorld || !isEditor() || state.mode !== "build") {
    return;
  }
  const normalizedScreenId = String(screenId ?? "").trim();
  const selected = getSelectedEntity(parseSceneTextarea());
  if (!selected?.entry || selected.kind !== "screen" || selected.entry.id !== normalizedScreenId) {
    setStatus("Select the screen you want to generate HTML for first.");
    return;
  }
  const prompt = getScreenAiPrompt(normalizedScreenId).trim();
  if (!prompt) {
    setStatus("Add a short prompt for this screen first.");
    elements.entityEditor.querySelector("[data-screen-ai-prompt]")?.focus?.();
    return;
  }
  const viewport = getScreenTextureRenderSize(selected.entry);
  const objective = [
    prompt,
    `This should fit a Mauworld screen with an approximate viewport of ${viewport.width} by ${viewport.height}.`,
    selected.entry.html ? `Current HTML to replace or improve: ${String(selected.entry.html).slice(0, 600)}` : "",
  ].filter(Boolean).join(" ");
  const generatedHtml = await generateAi("html", {
    objective,
    outputTarget: elements.aiOutput,
  });
  if (!generatedHtml) {
    setStatus("The AI returned empty screen HTML.");
    return;
  }
  mutateSceneDoc((sceneDoc) => {
    const current = getSelectedEntity(sceneDoc);
    if (!current?.entry || current.kind !== "screen" || current.entry.id !== normalizedScreenId) {
      return;
    }
    current.entry.html = generatedHtml;
  });
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
      setPrivatePanelTab(button.getAttribute("data-private-panel-tab") || "build", {
        refreshWorld: true,
      });
    });
  }
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
    setPrivateBrowserOverlayOpen(!state.browserOverlayOpen);
  });
  elements.panelBrowserBackdrop?.addEventListener("click", () => {
    setPrivateBrowserOverlayOpen(false);
  });
  privateBrowserShareFeature.bind();
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
  elements.panelScenes?.addEventListener("click", () => {
    if (state.selectedWorld && isEditor()) {
      setSceneDrawerOpen(true);
      setPrivatePanelTab("build");
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
    void openWorld(card.getAttribute("data-world-card"), card.getAttribute("data-world-creator"), true, {
      entryLoading: true,
      loadingTitle: "Opening private world",
      loadingNote: "Loading the world you picked.",
    }).catch((error) => {
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
    void openWorld(card.getAttribute("data-world-card"), card.getAttribute("data-world-creator"), true, {
      entryLoading: true,
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
  elements.sceneStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-id]");
    if (!button) {
      return;
    }
    state.selectedSceneId = button.getAttribute("data-scene-id");
    renderSelectedWorld();
  });
  elements.sceneDockOpen?.addEventListener("click", () => {
    if (!state.selectedWorld || !isEditor()) {
      return;
    }
    setSceneDrawerOpen(true);
    setPrivatePanelTab("build");
  });
  elements.sceneLibraryList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-library-id]");
    if (!button) {
      return;
    }
    state.selectedSceneId = button.getAttribute("data-scene-library-id");
    renderSelectedWorld();
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
    discardSceneDraft(state.selectedSceneId);
    renderSceneEditor();
    updatePreviewFromSelection();
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
    if (!ensureSelectedScriptFunction()) {
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
    } else {
      renderSceneLogicLibrary();
    }
    window.setTimeout(() => {
      elements.scriptFunctionPrompt?.focus?.();
    }, 0);
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
    void generateSceneLogicFunction().catch((error) => {
      setStatus(error.message);
    });
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
    const screenGenerateButton = event.target.closest("[data-screen-ai-generate]");
    if (screenGenerateButton) {
      void generateSelectedScreenHtml(screenGenerateButton.getAttribute("data-screen-ai-generate")).catch((error) => {
        setStatus(error.message);
      });
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
  elements.prefabList.addEventListener("click", (event) => {
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
    if (card && !event.target.closest("button, input, select, textarea, label")) {
      state.selectedPrefabId = card.getAttribute("data-prefab-card-select");
      renderSceneBuilder();
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
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
      return;
    }
    const buildShortcut = getBuildTransformShortcut(event);
    if (!buildShortcut || !canUsePlacementTools()) {
      return;
    }
    event.preventDefault();
    const buildKey = normalizeRuntimeKey(event);
    state.buildModifierKeys.add(buildKey);
    privateInputState.keys.delete(buildKey);
    refreshBuildHoverFromStoredPointer();
    updateShellState();
  });
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) {
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
    const buildShortcut = getBuildTransformShortcut(event);
    const buildKey = normalizeRuntimeKey(event);
    if (buildShortcut && (canUsePlacementTools() || state.buildModifierKeys.has(buildKey))) {
      event.preventDefault();
      state.buildModifierKeys.delete(buildKey);
      endBuildDrag();
      refreshBuildHoverFromStoredPointer();
      updateShellState();
      return;
    }
  });
  window.addEventListener("keyup", (event) => {
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
