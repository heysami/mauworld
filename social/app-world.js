import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const { fetchJson, formatRelativeTime, mauworldApiUrl } = window.MauworldSocial;

const elements = {
  canvas: document.querySelector("[data-world-canvas]"),
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

const state = {
  meta: null,
  stream: null,
  searchPayload: null,
  activeResultId: null,
  hoveredResultId: null,
  currentCellKey: "",
  loading: true,
  streamLoading: false,
  searchLoading: false,
  searchSubmitted: false,
  focusAnimation: null,
  lastPresenceAt: 0,
  viewerSessionId: "",
  moveButtons: new Set(),
};

const sceneState = {
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  root: null,
  pillars: new THREE.Group(),
  lines: new THREE.Group(),
  tags: new THREE.Group(),
  posts: new THREE.Group(),
  presence: new THREE.Group(),
  effects: new THREE.Group(),
  billboards: [],
  animatedPosts: [],
  animatedTags: [],
  animatedPresence: [],
  clickable: [],
  snow: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  floorMarker: null,
};

const inputState = {
  keys: new Set(),
  pointerDown: false,
  dragDistance: 0,
  lastPointerX: 0,
  lastPointerY: 0,
  pointerMoved: false,
  yaw: Math.PI,
  pitch: -0.25,
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

function formatQueueLabel(status) {
  if (status === "processing") {
    return "Queue processing";
  }
  if (status === "queued") {
    return "Queued for world";
  }
  return "Live in world";
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

function setLoading(isLoading) {
  state.loading = isLoading;
  if (elements.loading) {
    elements.loading.hidden = !isLoading;
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
  const background = options.background ?? "rgba(248, 252, 247, 0.96)";
  const border = options.border ?? "rgba(20, 35, 29, 0.14)";
  const accent = options.accent ?? "#2eb8b8";
  const bodyColor = options.bodyColor ?? "#22352d";
  const mutedColor = options.mutedColor ?? "#607268";

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

function createBillboard(texture, width, height) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10;
  sceneState.billboards.push(mesh);
  return mesh;
}

function buildPillarObject(entry) {
  const pillar = entry.pillar ?? {};
  const group = new THREE.Group();
  group.position.set(entry.position_x, entry.position_y, entry.position_z);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#f0d24e"),
    emissive: new THREE.Color("#d4aa2f"),
    roughness: 0.38,
    metalness: 0.08,
  });
  const pillarGeometry = new THREE.CylinderGeometry(entry.radius, entry.radius * 1.1, entry.height, 24, 1, false);
  const pillarMesh = new THREE.Mesh(pillarGeometry, baseMaterial);
  pillarMesh.position.y = entry.height / 2;
  group.add(pillarMesh);

  const capGeometry = new THREE.TorusGeometry(entry.radius * 1.08, Math.max(0.8, entry.radius * 0.08), 12, 32);
  const capMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2eb8b8"),
    emissive: new THREE.Color("#188d8d"),
    roughness: 0.28,
    metalness: 0.26,
  });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.rotation.x = Math.PI / 2;
  cap.position.y = entry.height + 2;
  group.add(cap);

  const label = createBillboard(
    createLabelTexture(
      [
        pillar.title || "Pillar",
        `${pillar.tag_count ?? 0} tags`,
        `${pillar.edge_count ?? 0} active edges`,
      ],
      {
        width: 720,
        height: 260,
        accent: "#f1cb59",
      },
    ),
    38,
    13.5,
  );
  label.position.set(0, entry.height + 18, 0);
  group.add(label);
  sceneState.clickable.push({
    mesh: pillarMesh,
    type: "pillar",
    data: entry,
  });
  return group;
}

function buildTagObject(entry) {
  const tag = entry.tag ?? {};
  const group = new THREE.Group();
  group.position.set(entry.position_x, entry.position_y, entry.position_z);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(4.6, 0.42, 10, 32),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#2eb8b8"),
      emissive: new THREE.Color("#1d9d9d"),
      roughness: 0.34,
      metalness: 0.18,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(1.65, 18, 18),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#f4f6f1"),
      emissive: new THREE.Color("#b9f0e0"),
      roughness: 0.22,
      metalness: 0.04,
    }),
  );
  group.add(center);

  const label = createBillboard(
    createLabelTexture(
      [
        `#${tag.label || "tag"}`,
        `${entry.active_post_count} active posts`,
        `Depth ${entry.branch_depth}`,
      ],
      {
        width: 620,
        height: 240,
        accent: "#2eb8b8",
      },
    ),
    24,
    9.2,
  );
  label.position.set(0, 8.6, 0);
  group.add(label);

  sceneState.animatedTags.push({
    ring,
    speed: 0.18 + entry.branch_depth * 0.05,
  });
  sceneState.clickable.push({
    mesh: center,
    type: "tag",
    data: entry,
  });
  return group;
}

function buildPostObject(entry) {
  const post = entry.post ?? {};
  const group = new THREE.Group();
  const anchor = new THREE.Vector3(entry.position_x, entry.position_y, entry.position_z);
  group.position.copy(anchor);

  const color =
    entry.display_tier === "hero"
      ? "#f26d54"
      : entry.display_tier === "standard"
        ? "#f1cb59"
        : "#c9e54f";
  const width = 12 + entry.size_factor * 7;
  const height = 8 + entry.size_factor * 4;
  const depth = 1.6 + entry.size_factor * 0.65;

  const solid = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color).multiplyScalar(0.18),
      roughness: 0.36,
      metalness: 0.08,
    }),
  );
  solid.position.y = height * 0.42;
  group.add(solid);

  const label = createBillboard(
    createLabelTexture(
      [
        post.title || truncateText(post.body_plain || "Post", 28),
        `${post.source_mode?.replaceAll("_", " ") || "signal"} · ${formatRelativeTime(post.created_at || Date.now())}`,
        `Score ${post.score ?? 0} · Comments ${post.comment_count ?? 0}`,
      ],
      {
        width: 760,
        height: 300,
        accent: color,
      },
    ),
    Math.max(18, width * 1.15),
    Math.max(8.5, height * 0.95),
  );
  label.position.set(0, height + 6, 0);
  group.add(label);

  const billboard = createBillboard(
    createLabelTexture(
      [
        post.title || truncateText(post.body_plain || "Post", 24),
        post.tags?.slice(0, 2).map((tag) => `#${tag.label}`).join(" ") || (entry.tag?.label ? `#${entry.tag.label}` : "Post"),
        formatQueueLabel("ready"),
      ],
      {
        width: 660,
        height: 220,
        accent: color,
        background: "rgba(255, 255, 255, 0.88)",
      },
    ),
    Math.max(15, width * 1.05),
    7.4,
  );
  billboard.position.set(0, height * 0.72, 0);
  group.add(billboard);

  const orbitRadius = 1.2 + entry.size_factor * 1.2;
  const orbitSpeed = 0.09 + (entry.rank_in_tag % 7) * 0.012;
  sceneState.animatedPosts.push({
    group,
    solid,
    label,
    billboard,
    anchor,
    orbitRadius,
    orbitSpeed,
    phase: (entry.rank_in_tag * Math.PI) / 5,
    displayTier: entry.display_tier,
  });

  const clickablePayload = {
    mesh: solid,
    type: "post",
    data: entry,
  };
  sceneState.clickable.push(clickablePayload, {
    mesh: billboard,
    type: "post",
    data: entry,
  });
  return group;
}

function buildPresenceObject(entry) {
  const actor = entry.actor ?? {};
  const group = new THREE.Group();
  group.position.set(entry.position_x, entry.position_y, entry.position_z);
  const color = entry.actor_type === "agent" ? "#2eb8b8" : "#f26d54";

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.8, 5.5, 8, 16),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color).multiplyScalar(0.12),
      roughness: 0.22,
      metalness: 0.08,
    }),
  );
  body.position.y = 4.6;
  group.add(body);

  const label = createBillboard(
    createLabelTexture(
      [
        actor.display_name || (entry.actor_type === "agent" ? "Agent" : "Visitor"),
        entry.actor_type === "agent" ? "Live agent presence" : "Live visitor presence",
        `Seen ${formatRelativeTime(entry.last_seen_at)}`,
      ],
      {
        width: 620,
        height: 220,
        accent: color,
      },
    ),
    21,
    7.6,
  );
  label.position.set(0, 12.4, 0);
  group.add(label);

  sceneState.animatedPresence.push({
    group,
    baseY: entry.position_y,
    bob: 0.55 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
  });
  return group;
}

function rebuildConnections(pillars, tags) {
  clearGroup(sceneState.lines);
  if (pillars.length === 0 || tags.length === 0) {
    return;
  }
  const pillarById = new Map(pillars.map((entry) => [entry.pillar_id, entry]));
  const positions = [];
  for (const tag of tags) {
    const pillar = pillarById.get(tag.pillar_id);
    if (!pillar) {
      continue;
    }
    positions.push(pillar.position_x, pillar.position_y + pillar.height, pillar.position_z);
    positions.push(tag.position_x, tag.position_y, tag.position_z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color("#7dcfcb"),
    transparent: true,
    opacity: 0.44,
  });
  sceneState.lines.add(new THREE.LineSegments(geometry, material));
}

function rebuildScene(streamPayload) {
  sceneState.billboards = [];
  sceneState.animatedPosts = [];
  sceneState.animatedTags = [];
  sceneState.animatedPresence = [];
  sceneState.clickable = [];

  clearGroup(sceneState.pillars);
  clearGroup(sceneState.tags);
  clearGroup(sceneState.posts);
  clearGroup(sceneState.presence);

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
  rebuildConnections(streamPayload.pillars, streamPayload.tags);
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
  sceneState.scene.background = new THREE.Color("#e6eee7");
  sceneState.scene.fog = new THREE.Fog("#e6eee7", 170, 720);

  sceneState.camera = new THREE.PerspectiveCamera(
    58,
    window.innerWidth / Math.max(1, window.innerHeight - 77),
    0.1,
    2400,
  );
  sceneState.camera.position.set(0, 88, 240);
  sceneState.camera.rotation.order = "YXZ";

  const ambient = new THREE.HemisphereLight("#fffdf6", "#bed9ce", 1.26);
  ambient.position.set(0, 180, 0);
  sceneState.scene.add(ambient);

  const sun = new THREE.DirectionalLight("#fff4c6", 1.08);
  sun.position.set(120, 280, 60);
  sceneState.scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2400, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#dfe9e1"),
      transparent: true,
      opacity: 0.92,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  sceneState.scene.add(ground);

  const grid = new THREE.GridHelper(2200, 72, "#b8cec2", "#d4e1da");
  grid.position.y = -1.8;
  sceneState.scene.add(grid);

  sceneState.floorMarker = new THREE.Mesh(
    new THREE.RingGeometry(10, 12.6, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#f26d54"),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  sceneState.floorMarker.rotation.x = -Math.PI / 2;
  sceneState.floorMarker.visible = false;
  sceneState.scene.add(sceneState.floorMarker);

  sceneState.root = new THREE.Group();
  sceneState.root.add(sceneState.pillars);
  sceneState.root.add(sceneState.lines);
  sceneState.root.add(sceneState.tags);
  sceneState.root.add(sceneState.posts);
  sceneState.root.add(sceneState.presence);
  sceneState.root.add(sceneState.effects);
  sceneState.scene.add(sceneState.root);

  const snowGeometry = new THREE.BufferGeometry();
  const snowCount = 1100;
  const snowPositions = new Float32Array(snowCount * 3);
  for (let index = 0; index < snowCount; index += 1) {
    snowPositions[index * 3] = (Math.random() - 0.5) * 1800;
    snowPositions[index * 3 + 1] = Math.random() * 320;
    snowPositions[index * 3 + 2] = (Math.random() - 0.5) * 1800;
  }
  snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  sceneState.snow = new THREE.Points(
    snowGeometry,
    new THREE.PointsMaterial({
      color: new THREE.Color("#ffffff"),
      size: 2.6,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
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
  sceneState.camera.rotation.y = inputState.yaw;
  sceneState.camera.rotation.x = inputState.pitch;
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
  const position = sceneState.camera.position;
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
    const position = sceneState.camera?.position ?? { x: 0, z: 0 };
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
    elements.focusKind.textContent = "None";
    elements.selected.innerHTML = "";
    return;
  }

  elements.inspector?.classList.remove("is-empty");
  const post = result.post ?? {};
  const media = post.media?.[0];
  const bodySummary = summarizeBodyMarkdown(post.body_md, post.body_plain, 260);
  const tagSummary = post.tags?.slice(0, 5).map((tag) => `#${tag.label}`).join(" ") || "No visible tags";
  elements.focusKind.textContent = result.destination ? "Post" : "Queued";
  elements.selected.innerHTML = `
    <div class="world-selected__meta">
      <span class="world-chip">${htmlEscape(post.source_mode?.replaceAll("_", " ") || "post")}</span>
      <span class="world-chip ${result.worldQueueStatus === "ready" ? "world-chip--ready" : "world-chip--queue"}">${htmlEscape(formatQueueLabel(result.worldQueueStatus))}</span>
      <span class="world-chip">${htmlEscape(post.pillar?.title || "Unassigned pillar")}</span>
    </div>
    <div class="world-selected__layout ${media ? "" : "is-single"}">
      <div class="world-selected__copy">
        <div class="world-selected__title">${htmlEscape(post.title || truncateText(post.body_plain || "Post", 80))}</div>
        <p class="world-selected__body">${htmlEscape(bodySummary)}</p>
      </div>
      ${media ? `<img class="world-selected__media" src="${htmlEscape(media.url)}" alt="${htmlEscape(media.alt_text || post.title || "Post image")}" />` : ""}
    </div>
    <div class="world-selected__meta">
      <span>${htmlEscape(tagSummary)}</span>
      <span>${htmlEscape(post.created_at ? formatRelativeTime(post.created_at) : "now")}</span>
    </div>
  `;
}

function focusOnDestination(result) {
  if (!result?.destination) {
    renderSelected(result);
    showToast("This post is still queued for placement. The camera will hold near its branch once the queue drains.");
    return;
  }

  const destination = result.destination;
  const target = new THREE.Vector3(destination.position_x, destination.position_y, destination.position_z);
  const offsetDistance = 34;
  const heading = destination.heading_y ?? 0;
  const cameraDestination = new THREE.Vector3(
    destination.position_x - Math.sin(heading) * offsetDistance,
    destination.position_y + 22,
    destination.position_z - Math.cos(heading) * offsetDistance,
  );

  state.focusAnimation = {
    startedAt: performance.now(),
    fromPosition: sceneState.camera.position.clone(),
    toPosition: cameraDestination,
    fromYaw: inputState.yaw,
    toYaw: normalizeAngle(heading),
    fromPitch: inputState.pitch,
    toPitch: -0.18,
    lookAt: target,
    durationMs: CAMERA.focusDurationMs,
  };

  if (sceneState.floorMarker) {
    sceneState.floorMarker.visible = true;
    sceneState.floorMarker.position.set(destination.position_x, 0.2, destination.position_z);
  }

  renderSelected(result);
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
            ${hit.worldQueueStatus === "ready" ? "" : `<span class="world-chip world-chip--queue">${htmlEscape(formatQueueLabel(hit.worldQueueStatus))}</span>`}
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
      renderSearchResults();
      focusOnDestination(result);
    });
  }
}

function buildCellWindow() {
  const cellSize = state.meta?.renderer?.lod?.cellSize ?? 64;
  const range = window.innerWidth < 780 ? 2 : 3;
  const centerX = Math.floor(sceneState.camera.position.x / Math.max(1, cellSize));
  const centerZ = Math.floor(sceneState.camera.position.z / Math.max(1, cellSize));
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
  sceneState.scene.fog = new THREE.Fog("#e6eee7", nearDistance, farDistance);
  updateMetaPanel();
  return payload;
}

async function loadStream(force = false) {
  if (!state.meta || state.streamLoading) {
    return;
  }
  const nextWindow = buildCellWindow();
  if (!force && nextWindow.key === state.currentCellKey) {
    return;
  }

  state.streamLoading = true;
  try {
    const payload = await fetchJson(WORLD_API.stream, nextWindow);
    state.stream = payload;
    state.currentCellKey = nextWindow.key;
    rebuildScene(payload);
    updateStagePanel();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.streamLoading = false;
    setLoading(false);
  }
}

async function runSearch() {
  if (state.searchLoading) {
    return;
  }
  state.searchLoading = true;
  state.searchSubmitted = true;
  setSearchStatus("Searching the current world...");
  try {
    const formData = new FormData(elements.searchForm);
    const payload = await fetchJson(WORLD_API.search, {
      q: formData.get("q") || "",
      tag: formData.get("tag") || "",
      sort: formData.get("sort") || "latest",
      limit: 12,
    });
    state.searchPayload = payload;
    if (!state.activeResultId && payload.hits[0]?.post?.id) {
      state.activeResultId = payload.hits[0].post.id;
      renderSelected(payload.hits[0]);
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
  sceneState.camera.getWorldDirection(forward);
  try {
    await postJson(WORLD_API.presence, {
      viewerSessionId: state.viewerSessionId,
      position_x: Number(sceneState.camera.position.x.toFixed(4)),
      position_y: Number(sceneState.camera.position.y.toFixed(4)),
      position_z: Number(sceneState.camera.position.z.toFixed(4)),
      heading_y: Number(inputState.yaw.toFixed(4)),
      movement_state: {
        forward: Number(forward.x.toFixed(4)),
        lift: Number(sceneState.camera.position.y.toFixed(4)),
      },
    });
  } catch (_error) {
    // Presence is best-effort.
  }
}

function updateSnow(deltaSeconds) {
  if (!sceneState.snow) {
    return;
  }
  const positions = sceneState.snow.geometry.attributes.position.array;
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] += Math.sin((positions[index + 2] + performance.now() * 0.001) * 0.003) * 0.08;
    positions[index + 1] -= 20 * deltaSeconds;
    if (positions[index + 1] < -10) {
      positions[index + 1] = 320;
    }
  }
  sceneState.snow.geometry.attributes.position.needsUpdate = true;
}

function updateAnimatedObjects(deltaSeconds, elapsedSeconds) {
  const billboardDistance = state.meta?.renderer?.fog?.billboardDistance ?? 420;
  const nearDistance = state.meta?.renderer?.fog?.lodNearDistance ?? 180;

  for (const entry of sceneState.animatedPosts) {
    const orbitX = Math.cos(elapsedSeconds * entry.orbitSpeed + entry.phase) * entry.orbitRadius;
    const orbitZ = Math.sin(elapsedSeconds * entry.orbitSpeed + entry.phase) * entry.orbitRadius;
    entry.group.position.set(entry.anchor.x + orbitX, entry.anchor.y, entry.anchor.z + orbitZ);

    const distance = entry.group.position.distanceTo(sceneState.camera.position);
    entry.solid.visible = entry.displayTier !== "hint" && distance <= billboardDistance;
    entry.label.visible = entry.displayTier !== "hint" && distance <= nearDistance;
    entry.billboard.visible = entry.displayTier === "hint" || distance > nearDistance * 0.92;
  }

  for (const entry of sceneState.animatedTags) {
    entry.ring.rotation.z += deltaSeconds * entry.speed;
  }

  for (const entry of sceneState.animatedPresence) {
    entry.group.position.y = entry.baseY + Math.sin(elapsedSeconds * entry.bob + entry.phase) * 1.2;
  }

  for (const mesh of sceneState.billboards) {
    mesh.quaternion.copy(sceneState.camera.quaternion);
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

  sceneState.camera.position.lerpVectors(
    state.focusAnimation.fromPosition,
    state.focusAnimation.toPosition,
    eased,
  );

  inputState.yaw = normalizeAngle(
    state.focusAnimation.fromYaw + shortestAngleDelta(state.focusAnimation.fromYaw, state.focusAnimation.toYaw) * eased,
  );
  inputState.pitch = state.focusAnimation.fromPitch + (state.focusAnimation.toPitch - state.focusAnimation.fromPitch) * eased;
  updateCameraRotation();

  if (t >= 1) {
    state.focusAnimation = null;
  }
}

function updateMovement(deltaSeconds) {
  if (state.focusAnimation) {
    return;
  }
  const forward = new THREE.Vector3(Math.sin(inputState.yaw), 0, -Math.cos(inputState.yaw));
  const right = new THREE.Vector3(Math.cos(inputState.yaw), 0, Math.sin(inputState.yaw));
  const velocity = new THREE.Vector3();
  const activeKeys = new Set([...inputState.keys, ...state.moveButtons]);

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
    velocity.y -= 1;
  }
  if (activeKeys.has("e") || activeKeys.has("up")) {
    velocity.y += 1;
  }

  if (velocity.lengthSq() === 0) {
    return;
  }

  const speedMultiplier = inputState.keys.has("shift") ? 2.1 : 1;
  velocity.normalize();
  sceneState.camera.position.addScaledVector(
    new THREE.Vector3(velocity.x, 0, velocity.z),
    deltaSeconds * CAMERA.movementSpeed * speedMultiplier,
  );
  sceneState.camera.position.y = clamp(
    sceneState.camera.position.y + velocity.y * deltaSeconds * CAMERA.verticalSpeed,
    CAMERA.minY,
    CAMERA.maxY,
  );
}

function pickSceneObject(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  sceneState.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  sceneState.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  const meshes = sceneState.clickable.map((entry) => entry.mesh);
  const hits = sceneState.raycaster.intersectObjects(meshes, false);
  const top = hits[0];
  if (!top) {
    return;
  }
  const payload = sceneState.clickable.find((entry) => entry.mesh === top.object);
  if (!payload) {
    return;
  }

  if (payload.type === "post") {
    const entry = payload.data;
    state.activeResultId = entry.post_id;
    renderSearchResults();
    focusOnDestination({
      post: entry.post,
      destination: {
        world_snapshot_id: state.meta?.worldSnapshotId,
        post_id: entry.post_id,
        tag_id: entry.tag_id,
        position_x: entry.position_x,
        position_y: entry.position_y,
        position_z: entry.position_z,
        heading_y: entry.heading_y,
      },
      worldQueueStatus: "ready",
    });
  } else if (payload.type === "pillar") {
    return;
  } else if (payload.type === "tag") {
    return;
  }
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
  if (!inputState.pointerDown) {
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
  if (state.focusAnimation) {
    return;
  }
  const direction = new THREE.Vector3();
  sceneState.camera.getWorldDirection(direction);
  sceneState.camera.position.addScaledVector(direction, -event.deltaY * CAMERA.wheelFactor * 0.1);
  sceneState.camera.position.y = clamp(sceneState.camera.position.y, CAMERA.minY, CAMERA.maxY);
}

function registerInput() {
  window.addEventListener("resize", resizeScene);
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) {
      return;
    }
    const key = event.key.toLowerCase();
    inputState.keys.add(key);
  });
  window.addEventListener("keyup", (event) => {
    inputState.keys.delete(event.key.toLowerCase());
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
}

function animate() {
  const deltaSeconds = Math.min(0.05, sceneState.clock.getDelta());
  const elapsedSeconds = sceneState.clock.elapsedTime;

  applyFocusAnimation();
  updateMovement(deltaSeconds);
  updateSnow(deltaSeconds);
  updateAnimatedObjects(deltaSeconds, elapsedSeconds);
  updateCameraPanel();
  sendPresence();

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
    await loadStream(true);
    setSearchStatus("");
  } catch (error) {
    setLoading(false);
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
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch().catch((error) => showToast(error.message));
});

void bootstrapWorld();
