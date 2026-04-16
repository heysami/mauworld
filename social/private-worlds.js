import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { createPatternedMaterial } from "./private-world-materials.js";
import { renderScreenHtmlTexture } from "./screen-texture.js";

const { mauworldApiUrl } = window.MauworldSocial;

const AI_KEY_STORAGE_KEY = "mauworldPrivateWorldAiKey";
const GUEST_SESSION_KEY = "mauworldPrivateWorldGuestSession";
const RUNTIME_INPUT_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "space", "shift"]);

const elements = {
  authForm: document.querySelector("[data-auth-form]"),
  authState: document.querySelector("[data-auth-state]"),
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
  selectedTitle: document.querySelector("[data-selected-title]"),
  selectedSubtitle: document.querySelector("[data-selected-subtitle]"),
  exportWorld: document.querySelector("[data-export-world]"),
  joinWorld: document.querySelector("[data-join-world]"),
  leaveWorld: document.querySelector("[data-leave-world]"),
  modeBuild: document.querySelector("[data-mode-build]"),
  modePlay: document.querySelector("[data-mode-play]"),
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
  joinedAsGuest: false,
  joined: false,
  activeLockEntityKey: "",
  runtimeSnapshot: null,
  pressedRuntimeKeys: new Set(),
  pressedViewerKeys: new Set(),
  mode: "play",
  lockHeartbeatTimer: 0,
  viewerYaw: -0.65,
  viewerPitch: -0.32,
  viewerMoveSpeed: 18,
  viewerLookActive: false,
  viewerLookPointerId: 0,
  viewerLookLastX: 0,
  viewerLookLastY: 0,
  launchHandled: false,
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
  for (const config of ENTITY_COLLECTIONS) {
    const first = getEntityArray(sceneDoc, config.key)[0];
    if (first) {
      state.builderSelection = {
        kind: config.kind,
        id: first.id,
      };
      return {
        ...config,
        index: 0,
        entry: first,
      };
    }
  }
  state.builderSelection = null;
  return null;
}

function setBuilderSelection(kind, id) {
  state.builderSelection = kind && id ? { kind, id } : null;
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
  elements.authState.textContent = state.session ? "Signed in" : "Signed out";
  if (!state.session) {
    await releaseSceneLock();
    state.profile = null;
    state.worlds = [];
    state.runtimeSnapshot = null;
    state.pressedRuntimeKeys.clear();
    state.pressedViewerKeys.clear();
    renderProfile();
    renderWorldList();
    renderSelectedWorld();
    disconnectWorldSocket();
    return;
  }
  try {
    const payload = await apiFetch("/private/profile");
    state.profile = payload.profile;
    renderProfile();
    await loadWorlds();
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
  if (state.profile?.username) {
    return world.active_instance.participants.find((entry) => entry.profile?.username === state.profile.username) ?? null;
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
  document.body.classList.toggle("is-play-mode", nextMode === "play");
  elements.modeBuild?.classList.toggle("is-active", nextMode === "build");
  elements.modePlay?.classList.toggle("is-active", nextMode === "play");
  if (elements.modeBuild) {
    elements.modeBuild.setAttribute("aria-pressed", String(nextMode === "build"));
    elements.modeBuild.disabled = !isEditor();
  }
  if (elements.modePlay) {
    elements.modePlay.setAttribute("aria-pressed", String(nextMode === "play"));
  }
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
    elements.entitySections.innerHTML = '<div class="pw-builder-group"><p class="pw-builder-empty">Fix the scene JSON to continue editing.</p></div>';
    elements.entityEditor.innerHTML = "";
    elements.prefabList.innerHTML = "";
    return;
  }
  const selected = ensureBuilderSelection(sceneDoc);
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
  elements.worldMeta.innerHTML = rows.map((row) => `
    <div class="pw-world-meta__row">
      <strong>${htmlEscape(row.label)}</strong>
      <span>${htmlEscape(row.value)}</span>
    </div>
  `).join("");
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
      <span>${getLocalParticipant()?.join_role === "player" ? "WASD / Arrows to move, Space to jump, Release to return to viewer" : "Viewer mode by default. Click a player capsule in Play to possess it."}</span>
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
  if (state.mode === "build" && !isEditor()) {
    state.mode = "play";
  }
  elements.selectedTitle.textContent = world?.name || "No world selected";
  elements.selectedSubtitle.textContent = world
    ? `${world.about} · ${world.creator.username}${world.lineage?.imported_at ? ` · forked from ${world.lineage.origin_world_id}` : ""}`
    : "Pick a world or resolve one by id and creator.";
  renderWorldMeta();
  renderSceneStrip();
  renderSceneEditor();
  renderCollaborators();
  renderRuntimeStatus();

  const hasWorld = Boolean(world);
  const canEdit = isEditor();
  const localParticipant = getLocalParticipant(world);
  const joinedAsPlayer = localParticipant?.join_role === "player";
  elements.exportWorld.disabled = !hasWorld || !state.session;
  elements.joinWorld.disabled = !hasWorld;
  elements.leaveWorld.disabled = !hasWorld;
  elements.readyToggle.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  elements.startScene.disabled = !hasWorld || !state.session || !world.active_instance;
  elements.releasePlayer.disabled = !hasWorld || !state.session || !joinedAsPlayer;
  elements.resetScene.disabled = !hasWorld || !canEdit;
  elements.saveCollaborator.disabled = !hasWorld || !canEdit;
  elements.generateHtml.disabled = !hasWorld || !state.session;
  elements.generateScript.disabled = !hasWorld || !state.session;

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
  updatePreviewFromSelection();
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

function updateFloatingViewerCamera(preview, deltaSeconds) {
  const moveDirection = new THREE.Vector3();
  const forward = new THREE.Vector3(Math.sin(state.viewerYaw), 0, Math.cos(state.viewerYaw) * -1).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  if (state.pressedViewerKeys.has("w") || state.pressedViewerKeys.has("arrowup")) {
    moveDirection.add(forward);
  }
  if (state.pressedViewerKeys.has("s") || state.pressedViewerKeys.has("arrowdown")) {
    moveDirection.sub(forward);
  }
  if (state.pressedViewerKeys.has("d") || state.pressedViewerKeys.has("arrowright")) {
    moveDirection.add(right);
  }
  if (state.pressedViewerKeys.has("a") || state.pressedViewerKeys.has("arrowleft")) {
    moveDirection.sub(right);
  }
  if (moveDirection.lengthSq() > 0.0001) {
    moveDirection.normalize().multiplyScalar(state.viewerMoveSpeed * deltaSeconds);
    preview.camera.position.add(moveDirection);
  }
  const lookTarget = new THREE.Vector3(
    preview.camera.position.x + Math.sin(state.viewerYaw) * Math.cos(state.viewerPitch),
    preview.camera.position.y + Math.sin(state.viewerPitch),
    preview.camera.position.z - Math.cos(state.viewerYaw) * Math.cos(state.viewerPitch),
  );
  preview.camera.lookAt(lookTarget);
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

function ensurePreview() {
  if (state.preview || !elements.previewCanvas) {
    return state.preview;
  }
  const renderer = new THREE.WebGLRenderer({
    canvas: elements.previewCanvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(elements.previewCanvas.clientWidth || 640, 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eef4fb");

  const camera = new THREE.PerspectiveCamera(48, (elements.previewCanvas.clientWidth || 640) / 360, 0.1, 5000);
  camera.position.set(18, 18, 24);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight("#ffffff", 1.2);
  const light = new THREE.DirectionalLight("#ffffff", 1.4);
  light.position.set(16, 24, 12);
  scene.add(ambient, light);

  const grid = new THREE.GridHelper(48, 24, "#9ab4d4", "#d4dfed");
  grid.position.y = 0;
  scene.add(grid);

  state.preview = {
    renderer,
    scene,
    camera,
    root: new THREE.Group(),
    raycaster: new THREE.Raycaster(),
    entityPickables: [],
    entityMeshes: new Map(),
    effectSystems: [],
    lastFrameAt: performance.now(),
  };
  state.preview.scene.add(state.preview.root);

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
    if (!(state.mode === "play" && updatePossessedCamera(state.preview))) {
      updateFloatingViewerCamera(state.preview, deltaSeconds);
    }
    updatePreviewEffects(state.preview, timestamp / 1000);
    state.preview.renderer.render(state.preview.scene, state.preview.camera);
    window.requestAnimationFrame(render);
  };

  window.addEventListener("resize", render);
  elements.previewCanvas.addEventListener("pointerdown", (event) => {
    if (state.mode !== "play") {
      return;
    }
    state.viewerLookActive = true;
    state.viewerLookPointerId = event.pointerId;
    state.viewerLookLastX = event.clientX;
    state.viewerLookLastY = event.clientY;
    elements.previewCanvas.setPointerCapture(event.pointerId);
  });
  elements.previewCanvas.addEventListener("pointermove", (event) => {
    if (!state.viewerLookActive || state.viewerLookPointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - state.viewerLookLastX;
    const deltaY = event.clientY - state.viewerLookLastY;
    state.viewerLookLastX = event.clientX;
    state.viewerLookLastY = event.clientY;
    state.viewerYaw -= deltaX * 0.005;
    state.viewerPitch = Math.max(-1.2, Math.min(1.2, state.viewerPitch - deltaY * 0.004));
  });
  elements.previewCanvas.addEventListener("pointerup", (event) => {
    if (state.viewerLookPointerId === event.pointerId) {
      state.viewerLookActive = false;
      elements.previewCanvas.releasePointerCapture?.(event.pointerId);
    }
  });
  elements.previewCanvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.mode !== "play" || getPossessedRuntimePlayer()) {
      return;
    }
    const forward = new THREE.Vector3(Math.sin(state.viewerYaw), Math.sin(state.viewerPitch), -Math.cos(state.viewerYaw)).normalize();
    state.preview.camera.position.addScaledVector(forward, event.deltaY > 0 ? -1.5 : 1.5);
  }, { passive: false });
  elements.previewCanvas.addEventListener("click", (event) => {
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
    return;
  }
  if (!sceneDoc) {
    return;
  }

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
  disconnectWorldSocket();
  const world = state.selectedWorld;
  if (!world) {
    return;
  }
  const socket = new WebSocket(buildSocketUrl(world.world_id, world.creator.username));
  state.worldSocket = socket;
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
}

function disconnectWorldSocket() {
  if (state.worldSocket) {
    state.worldSocket.close();
    state.worldSocket = null;
  }
}

async function openWorld(worldId, creatorUsername, includeContent = true) {
  const payload = await apiFetch(`/private/worlds/${encodeURIComponent(worldId)}`, {
    search: {
      creatorUsername,
      includeContent: includeContent ? "true" : "false",
    },
  });
  state.selectedWorld = payload.world;
  state.selectedSceneId = payload.world?.active_instance?.active_scene_id || payload.world?.scenes?.[0]?.id || "";
  state.selectedPrefabId = payload.world?.prefabs?.[0]?.id || "";
  state.builderSelection = null;
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
  await loadPublicWorlds();
  await openWorld(payload.world.world_id, payload.world.creator.username, true);
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
  await loadPublicWorlds();
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
      displayName: state.profile?.display_name || "guest viewer",
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
  state.pressedRuntimeKeys.clear();
  state.pressedViewerKeys.clear();
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
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.rules = sceneDoc.rules || [];
      sceneDoc.rules.push({
        id: `rule_${sceneDoc.rules.length + 1}`,
        trigger: "all_players_ready",
        action: "start_scene",
      });
      sceneDoc.script_dsl = (sceneDoc.script_dsl ? `${sceneDoc.script_dsl}\n` : "") + "all_players_ready -> start_scene";
    });
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
  elements.eventLog.innerHTML = state.eventLog.map((entry) => `
    <article class="pw-event-log__item">
      <strong>${htmlEscape(entry.title)}</strong>
      <div>${htmlEscape(entry.body || "")}</div>
      <small>${htmlEscape(entry.createdAt)}</small>
    </article>
  `).join("") || '<article class="pw-event-log__item">No live events yet.</article>';
}

function bindEvents() {
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
  elements.exportWorld.addEventListener("click", () => {
    void exportWorld();
  });
  elements.modeBuild.addEventListener("click", () => {
    setMode("build");
    renderSelectedWorld();
  });
  elements.modePlay.addEventListener("click", () => {
    setMode("play");
    renderSelectedWorld();
  });
  elements.joinWorld.addEventListener("click", () => {
    void joinWorld();
  });
  elements.leaveWorld.addEventListener("click", () => {
    void leaveWorld();
  });
  elements.sceneStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scene-id]");
    if (!button) {
      return;
    }
    state.selectedSceneId = button.getAttribute("data-scene-id");
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
    state.pressedViewerKeys.add(key);
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
    state.pressedViewerKeys.delete(key);
  });
  window.addEventListener("blur", () => {
    const keys = [...state.pressedRuntimeKeys];
    state.pressedRuntimeKeys.clear();
    state.pressedViewerKeys.clear();
    for (const key of keys) {
      void sendRuntimeInput(key, "up");
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
  ensurePreview();
  await fetchAuthConfig();
  await loadPublicWorlds();
  await refreshAuthState();
  await handleLaunchRequest();
}

void init().catch((error) => {
  setStatus(error.message || "Could not initialize private worlds page");
  pushEvent("init:error", error.message || "Unknown initialization failure");
});
