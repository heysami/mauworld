import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
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
  addRule: document.querySelector("[data-add-rule]"),
};

const state = {
  authConfig: null,
  supabase: null,
  session: null,
  profile: null,
  worlds: [],
  selectedWorld: null,
  selectedSceneId: "",
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
    return JSON.parse(elements.sceneForm?.elements.sceneDoc.value || "{}");
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
  elements.saveScene.disabled = !canEdit || !scene || !buildMode;
  elements.refreshScene.disabled = !scene;
  elements.sceneForm.elements.name.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.isDefault.disabled = !canEdit || !buildMode;
  elements.sceneForm.elements.sceneDoc.disabled = !canEdit || !buildMode;
  const buildPanel = document.querySelector("[data-build-panel]");
  if (buildPanel) {
    buildPanel.hidden = false;
  }
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
      <strong>${htmlEscape(entry.profile?.display_name || entry.profile?.username || "unknown")}</strong>
      <div>@${htmlEscape(entry.profile?.username || "unknown")} · ${htmlEscape(entry.role)}</div>
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
    elements.addRule,
  ]) {
    button.disabled = !hasWorld || !canEdit || state.mode !== "build";
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
  return preview.raycaster.intersectObjects(preview.playerPickables, false)[0] ?? null;
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
    playerPickables: [],
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
    if (state.mode !== "play" || !state.session || getLocalParticipant()?.join_role === "player") {
      return;
    }
    const hit = raycastPreviewPointer(event);
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
  preview.playerPickables = [];
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

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.06,
  });
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

  const addMesh = (geometry, material, position, rotation = { x: 0, y: 0, z: 0 }, scale = { x: 1, y: 1, z: 1 }) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
    preview.root.add(mesh);
  };
  const runtimeTransforms = getRuntimeTransformMaps();

  for (const voxel of sceneDoc.voxels ?? []) {
    addMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(voxel.material?.color || "#c0c4ca"),
      voxel.position || { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      voxel.scale || { x: 1, y: 1, z: 1 },
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
    addMesh(
      geometry,
      makeMaterial(runtimePrimitive?.material_override?.color || primitive.material?.color || "#edf2f8"),
      runtimePrimitive?.position || primitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive?.rotation || primitive.rotation || { x: 0, y: 0, z: 0 },
      primitive.scale || { x: 1, y: 1, z: 1 },
    );
  }

  for (const player of sceneDoc.players ?? []) {
    const runtimePlayer = runtimeTransforms.playerById.get(player.id);
    const mesh = addMesh(
      new THREE.CapsuleGeometry(0.35, 1.3, 8, 16),
      makeMaterial(runtimePlayer?.occupied_by_username ? "#ff5a6f" : (player.body_mode === "ghost" ? "#6dd3ff" : "#ff8e4f")),
      runtimePlayer?.position || player.position || { x: 0, y: 1, z: 0 },
      runtimePlayer?.rotation || player.rotation || { x: 0, y: 0, z: 0 },
      { x: player.scale || 1, y: player.scale || 1, z: player.scale || 1 },
    );
    mesh.userData.privateWorldPlayerId = player.id;
    preview.playerPickables.push(mesh);
  }

  for (const [playerId, runtimePlayer] of runtimeTransforms.playerById.entries()) {
    if ((sceneDoc.players ?? []).some((entry) => entry.id === playerId)) {
      continue;
    }
    const mesh = addMesh(
      new THREE.CapsuleGeometry(0.35, 1.3, 8, 16),
      makeMaterial(runtimePlayer?.occupied_by_username ? "#ff5a6f" : "#ff8e4f"),
      runtimePlayer.position || { x: 0, y: 1, z: 0 },
      runtimePlayer.rotation || { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );
    mesh.userData.privateWorldPlayerId = playerId;
    preview.playerPickables.push(mesh);
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
    );
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
      makeMaterial(runtimePrimitive?.material_override?.color || "#edf2f8"),
      runtimePrimitive.position || { x: 0, y: 1, z: 0 },
      runtimePrimitive.rotation || { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );
  }

  for (const text of sceneDoc.texts ?? []) {
    addTextBillboard(preview, text.value || text.text, text.position || { x: 0, y: 2, z: 0 });
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
    preview.root.add(mesh);
  }
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
  elements.sceneForm.elements.sceneDoc.value = JSON.stringify(sceneDoc, null, 2);
  updatePreviewFromSelection();
}

function attachQuickAddButtons() {
  elements.addVoxel.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.voxels = sceneDoc.voxels || [];
      sceneDoc.voxels.push({
        id: `voxel_${sceneDoc.voxels.length + 1}`,
        position: { x: sceneDoc.voxels.length * 1.25, y: 0.5, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        material: { color: "#85b84f", texture_preset: "grass" },
      });
    });
  });

  elements.addPrimitive.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.primitives = sceneDoc.primitives || [];
      sceneDoc.primitives.push({
        id: `primitive_${sceneDoc.primitives.length + 1}`,
        shape: "box",
        position: { x: sceneDoc.primitives.length * 1.8, y: 1, z: -2 },
        scale: { x: 1.5, y: 1.5, z: 1.5 },
        rotation: { x: 0, y: 0, z: 0 },
        material: { color: "#d3d8e2", texture_preset: "stone" },
        physics: { gravity_scale: 1, restitution: 0.2, friction: 0.7, mass: 1 },
      });
    });
  });

  elements.addPlayer.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.players = sceneDoc.players || [];
      sceneDoc.players.push({
        id: `player_${sceneDoc.players.length + 1}`,
        label: `Player ${sceneDoc.players.length + 1}`,
        position: { x: 0, y: 1, z: sceneDoc.players.length * 2.4 },
        camera_mode: "third_person",
        body_mode: "rigid",
      });
    });
  });

  elements.addScreen.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.screens = sceneDoc.screens || [];
      sceneDoc.screens.push({
        id: `screen_${sceneDoc.screens.length + 1}`,
        position: { x: 0, y: 2.6, z: -4 - sceneDoc.screens.length },
        scale: { x: 4, y: 2.25, z: 0.2 },
        material: { color: "#ffffff", texture_preset: "none" },
        html: "<div style=\"padding:24px\"><h1>Hello world</h1><p>Static world screen.</p></div>",
      });
    });
  });

  elements.addText.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.texts = sceneDoc.texts || [];
      sceneDoc.texts.push({
        id: `text_${sceneDoc.texts.length + 1}`,
        value: "Welcome",
        position: { x: 0, y: 3, z: 2 + sceneDoc.texts.length },
        scale: 1,
        material: { color: "#ffffff", texture_preset: "none" },
      });
    });
  });

  elements.addTrigger.addEventListener("click", () => {
    mutateSceneDoc((sceneDoc) => {
      sceneDoc.trigger_zones = sceneDoc.trigger_zones || [];
      sceneDoc.trigger_zones.push({
        id: `trigger_${sceneDoc.trigger_zones.length + 1}`,
        label: "Start Zone",
        position: { x: 0, y: 0.5, z: 6 + sceneDoc.trigger_zones.length },
        scale: { x: 2, y: 2, z: 2 },
      });
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
    void openWorld(card.getAttribute("data-world-card"), card.getAttribute("data-world-creator"), true);
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
  elements.sceneForm.elements.sceneDoc.addEventListener("focus", () => {
    void acquireSceneLock();
  });
  elements.sceneForm.elements.sceneDoc.addEventListener("blur", () => {
    void releaseSceneLock();
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
  await refreshAuthState();
  await handleLaunchRequest();
}

void init().catch((error) => {
  setStatus(error.message || "Could not initialize private worlds page");
  pushEvent("init:error", error.message || "Unknown initialization failure");
});
