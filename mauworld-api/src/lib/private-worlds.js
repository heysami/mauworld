import crypto from "node:crypto";
import { HttpError } from "./http.js";
import { assertSafePublicText, stripMarkdown } from "./text.js";

export const PRIVATE_WORLD_LIMITS = {
  maxViewers: 20,
  maxPlayers: 8,
  lockTtlSeconds: 30,
};

export const PRIVATE_WORLD_TYPE_DEFINITIONS = {
  room: {
    templates: {
      small: { width: 24, length: 16, height: 8 },
      medium: { width: 40, length: 20, height: 10 },
      large: { width: 64, length: 32, height: 16 },
    },
    cap: { width: 96, length: 48, height: 24 },
  },
  field: {
    templates: {
      small: { width: 96, length: 96, height: 16 },
      medium: { width: 180, length: 180, height: 32 },
      large: { width: 300, length: 300, height: 50 },
    },
    cap: { width: 512, length: 512, height: 64 },
  },
  board: {
    templates: {
      small: { width: 24, length: 24, height: 4 },
      medium: { width: 48, length: 48, height: 8 },
      large: { width: 80, length: 80, height: 12 },
    },
    cap: { width: 128, length: 128, height: 16 },
  },
};

const ALLOWED_WORLD_TYPES = new Set(Object.keys(PRIVATE_WORLD_TYPE_DEFINITIONS));
const ALLOWED_TEMPLATE_SIZES = new Set(["small", "medium", "large"]);
const ALLOWED_TEXTURE_PRESETS = new Set(["none", "grass", "wood", "wall", "floor", "stone", "glass", "metal"]);
const ALLOWED_PRIMITIVE_SHAPES = new Set(["box", "sphere", "capsule", "cylinder", "cone", "plane"]);
const ALLOWED_PLAYER_CAMERA_MODES = new Set(["first_person", "third_person", "top_down"]);
const ALLOWED_PLAYER_BODY_MODES = new Set(["rigid", "ghost"]);
const ALLOWED_RULE_TRIGGERS = new Set([
  "zone_enter",
  "zone_exit",
  "key_press",
  "timer",
  "scene_start",
  "all_players_ready",
]);
const ALLOWED_RULE_ACTIONS = new Set([
  "apply_force",
  "teleport",
  "switch_scene",
  "set_material",
  "set_visibility",
  "toggle_particles",
  "set_text",
  "start_scene",
]);

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function slugToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function plainSearchText(values = []) {
  return values
    .map((value) => stripMarkdown(String(value ?? "")))
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeColor(input, fallback = "#b8bec8") {
  const value = String(input ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  return fallback;
}

function sanitizeTexturePreset(input, fallback = "none") {
  const value = String(input ?? "").trim().toLowerCase();
  return ALLOWED_TEXTURE_PRESETS.has(value) ? value : fallback;
}

function sanitizeVector3(input = {}, fallback = { x: 0, y: 0, z: 0 }, limits = { min: -4096, max: 4096 }) {
  return {
    x: Number(clampNumber(input.x, fallback.x, limits.min, limits.max).toFixed(4)),
    y: Number(clampNumber(input.y, fallback.y, limits.min, limits.max).toFixed(4)),
    z: Number(clampNumber(input.z, fallback.z, limits.min, limits.max).toFixed(4)),
  };
}

function sanitizeScale3(input = {}, fallback = { x: 1, y: 1, z: 1 }) {
  return {
    x: Number(clampNumber(input.x, fallback.x, 0.1, 1024).toFixed(4)),
    y: Number(clampNumber(input.y, fallback.y, 0.1, 1024).toFixed(4)),
    z: Number(clampNumber(input.z, fallback.z, 0.1, 1024).toFixed(4)),
  };
}

function sanitizeEuler3(input = {}) {
  return {
    x: Number(clampNumber(input.x, 0, -Math.PI * 2, Math.PI * 2).toFixed(6)),
    y: Number(clampNumber(input.y, 0, -Math.PI * 2, Math.PI * 2).toFixed(6)),
    z: Number(clampNumber(input.z, 0, -Math.PI * 2, Math.PI * 2).toFixed(6)),
  };
}

function ensureEntityId(prefix, value) {
  const cleaned = slugToken(value);
  if (cleaned) {
    return `${prefix}_${cleaned}`;
  }
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function normalizeUsername(input) {
  const value = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!value || value.length < 3 || value.length > 24) {
    throw new HttpError(400, "Username must be 3 to 24 characters using letters, numbers, dot, dash, or underscore");
  }
  return value;
}

export function sanitizeWorldText(input, fieldName, maxLength) {
  const value = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    throw new HttpError(400, `Invalid ${fieldName}`);
  }
  const sliced = value.slice(0, maxLength);
  assertSafePublicText(sliced, fieldName);
  return sliced;
}

export function buildPrivateWorldSearchText(input = {}) {
  return plainSearchText([
    input.name,
    input.about,
    input.creatorUsername,
    input.originWorldId,
    input.originCreatorUsername,
    input.originWorldName,
  ]);
}

export function generatePrivateWorldId() {
  return `mw_${crypto.randomBytes(5).toString("hex")}`;
}

export function resolvePrivateWorldSize(input = {}) {
  const worldType = String(input.worldType ?? input.world_type ?? "").trim().toLowerCase();
  if (!ALLOWED_WORLD_TYPES.has(worldType)) {
    throw new HttpError(400, "Invalid private world type");
  }
  const definition = PRIVATE_WORLD_TYPE_DEFINITIONS[worldType];
  const templateSize = String(input.templateSize ?? input.template_size ?? "medium").trim().toLowerCase();
  if (!ALLOWED_TEMPLATE_SIZES.has(templateSize)) {
    throw new HttpError(400, "Invalid private world template size");
  }
  const template = definition.templates[templateSize];
  return {
    worldType,
    templateSize,
    width: clampInteger(input.width, template.width, 4, definition.cap.width),
    length: clampInteger(input.length, template.length, 4, definition.cap.length),
    height: clampInteger(input.height, template.height, 2, definition.cap.height),
    cap: cloneJson(definition.cap),
  };
}

function sanitizePhysics(input = {}, { rigid = true } = {}) {
  return {
    rigid: rigid !== false,
    gravity_scale: Number(clampNumber(input.gravity_scale, 1, 0, 4).toFixed(4)),
    restitution: Number(clampNumber(input.restitution, 0.12, 0, 1.4).toFixed(4)),
    friction: Number(clampNumber(input.friction, 0.72, 0, 2).toFixed(4)),
    mass: Number(clampNumber(input.mass, rigid ? 1 : 0, 0, 500).toFixed(4)),
  };
}

function sanitizeMaterial(input = {}, fallbackColor = "#c8d0d8") {
  return {
    color: sanitizeColor(input.color, fallbackColor),
    texture_preset: sanitizeTexturePreset(input.texture_preset ?? input.texturePreset, "none"),
  };
}

function sanitizeVoxelEntry(entry = {}, index = 0) {
  return {
    id: ensureEntityId("voxel", entry.id || `voxel-${index + 1}`),
    position: sanitizeVector3(entry.position, { x: 0, y: 0, z: 0 }),
    scale: sanitizeScale3(entry.scale, { x: 1, y: 1, z: 1 }),
    material: sanitizeMaterial(entry.material, "#c0c4ca"),
    shape_preset: String(entry.shape_preset ?? entry.shapePreset ?? "cube").trim().toLowerCase() || "cube",
    solid: true,
    group_id: String(entry.group_id ?? entry.groupId ?? "").trim() || null,
  };
}

function sanitizePrimitiveEntry(entry = {}, index = 0) {
  const shape = String(entry.shape ?? "box").trim().toLowerCase();
  return {
    id: ensureEntityId("primitive", entry.id || `primitive-${index + 1}`),
    shape: ALLOWED_PRIMITIVE_SHAPES.has(shape) ? shape : "box",
    position: sanitizeVector3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: sanitizeEuler3(entry.rotation),
    scale: sanitizeScale3(entry.scale, { x: 1, y: 1, z: 1 }),
    material: sanitizeMaterial(entry.material, "#e8edf2"),
    physics: sanitizePhysics(entry.physics, { rigid: entry.rigid !== false }),
    rigid_mode: String(entry.rigid_mode ?? entry.rigidMode ?? (entry.rigid === false ? "ghost" : "rigid")).trim().toLowerCase() === "ghost"
      ? "ghost"
      : "rigid",
    group_id: String(entry.group_id ?? entry.groupId ?? "").trim() || null,
    particle_effect: String(entry.particle_effect ?? entry.particleEffect ?? "").trim() || null,
    trail_effect: String(entry.trail_effect ?? entry.trailEffect ?? "").trim() || null,
  };
}

function sanitizeScreenHtml(input) {
  const source = String(input ?? "").trim();
  if (!source) {
    return "";
  }
  let html = source
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<(iframe|object|embed|link|meta|base)[^>]*>/gi, "")
    .replace(/\son[a-z-]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son[a-z-]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8" /><style>body{margin:0;font-family:Manrope,Arial,sans-serif;background:#f7f9fb;color:#14213d;}*{box-sizing:border-box;}</style></head><body>${html}</body></html>`;
  }
  assertSafePublicText(stripMarkdown(html).slice(0, 2000) || "screen", "screen html");
  return html;
}

function sanitizeScreenEntry(entry = {}, index = 0) {
  const html = sanitizeScreenHtml(entry.html ?? entry.html_source ?? entry.htmlSource ?? "");
  return {
    id: ensureEntityId("screen", entry.id || `screen-${index + 1}`),
    position: sanitizeVector3(entry.position, { x: 0, y: 2, z: 0 }),
    rotation: sanitizeEuler3(entry.rotation),
    scale: sanitizeScale3(entry.scale, { x: 4, y: 2.25, z: 0.2 }),
    material: sanitizeMaterial(entry.material, "#ffffff"),
    html,
    html_hash: crypto.createHash("sha256").update(html).digest("hex"),
    group_id: String(entry.group_id ?? entry.groupId ?? "").trim() || null,
  };
}

function sanitizePlayerEntry(entry = {}, index = 0) {
  const cameraMode = String(entry.camera_mode ?? entry.cameraMode ?? "third_person").trim().toLowerCase();
  const bodyMode = String(entry.body_mode ?? entry.bodyMode ?? "rigid").trim().toLowerCase();
  return {
    id: ensureEntityId("player", entry.id || `player-${index + 1}`),
    label: String(entry.label ?? `Player ${index + 1}`).trim().slice(0, 48) || `Player ${index + 1}`,
    position: sanitizeVector3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: sanitizeEuler3(entry.rotation),
    scale: Number(clampNumber(entry.scale, 1, 0.25, 6).toFixed(4)),
    camera_mode: ALLOWED_PLAYER_CAMERA_MODES.has(cameraMode) ? cameraMode : "third_person",
    body_mode: ALLOWED_PLAYER_BODY_MODES.has(bodyMode) ? bodyMode : "rigid",
    occupiable: entry.occupiable !== false,
  };
}

function sanitizeText3Entry(entry = {}, index = 0) {
  const value = sanitizeWorldText(entry.value ?? entry.text ?? `Text ${index + 1}`, "3d text", 160);
  return {
    id: ensureEntityId("text3d", entry.id || `text-${index + 1}`),
    value,
    position: sanitizeVector3(entry.position, { x: 0, y: 2, z: 0 }),
    rotation: sanitizeEuler3(entry.rotation),
    scale: Number(clampNumber(entry.scale, 1, 0.2, 8).toFixed(4)),
    material: sanitizeMaterial(entry.material, "#ffffff"),
    group_id: String(entry.group_id ?? entry.groupId ?? "").trim() || null,
  };
}

function sanitizeTriggerZoneEntry(entry = {}, index = 0) {
  return {
    id: ensureEntityId("trigger", entry.id || `trigger-${index + 1}`),
    position: sanitizeVector3(entry.position, { x: 0, y: 0.5, z: 0 }),
    scale: sanitizeScale3(entry.scale, { x: 2, y: 2, z: 2 }),
    label: String(entry.label ?? `Trigger ${index + 1}`).trim().slice(0, 48) || `Trigger ${index + 1}`,
    invisible: entry.invisible !== false,
  };
}

function sanitizePrefabEntry(entry = {}, index = 0) {
  return {
    id: ensureEntityId("prefab", entry.id || `prefab-${index + 1}`),
    name: sanitizeWorldText(entry.name ?? `Prefab ${index + 1}`, "prefab name", 80),
    entity_ids: Array.from(new Set((Array.isArray(entry.entity_ids) ? entry.entity_ids : []).map((value) => String(value ?? "").trim()).filter(Boolean))),
    instance_count: clampInteger(entry.instance_count, 0, 0, 256),
  };
}

function sanitizeParticleEntry(entry = {}, index = 0) {
  return {
    id: ensureEntityId("particle", entry.id || `particle-${index + 1}`),
    effect: String(entry.effect ?? "sparkles").trim().toLowerCase().slice(0, 40) || "sparkles",
    target_id: String(entry.target_id ?? entry.targetId ?? "").trim() || null,
    enabled: entry.enabled !== false,
    color: sanitizeColor(entry.color, "#ff5a7a"),
  };
}

function sanitizeRuleEntry(entry = {}, index = 0) {
  const trigger = String(entry.trigger ?? "").trim().toLowerCase();
  const action = String(entry.action ?? "").trim().toLowerCase();
  if (!ALLOWED_RULE_TRIGGERS.has(trigger)) {
    throw new HttpError(400, `Invalid rule trigger at index ${index + 1}`);
  }
  if (!ALLOWED_RULE_ACTIONS.has(action)) {
    throw new HttpError(400, `Invalid rule action at index ${index + 1}`);
  }
  return {
    id: ensureEntityId("rule", entry.id || `rule-${index + 1}`),
    trigger,
    action,
    source_id: String(entry.source_id ?? entry.sourceId ?? "").trim() || null,
    target_id: String(entry.target_id ?? entry.targetId ?? "").trim() || null,
    key: String(entry.key ?? "").trim().toLowerCase() || null,
    delay_ms: clampInteger(entry.delay_ms, 0, 0, 600000),
    payload: cloneJson(entry.payload ?? {}),
  };
}

function buildRuleDsl(rules = []) {
  return rules
    .map((rule) => {
      const scope = [
        rule.source_id ? `from ${rule.source_id}` : "",
        rule.target_id ? `to ${rule.target_id}` : "",
        rule.key ? `key ${rule.key}` : "",
        rule.delay_ms ? `after ${rule.delay_ms}ms` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `${rule.trigger} -> ${rule.action}${scope ? ` ${scope}` : ""}`;
    })
    .join("\n");
}

export function createDefaultSceneDoc() {
  return {
    settings: {
      gravity: { x: 0, y: -9.8, z: 0 },
      camera_mode: "third_person",
      start_on_ready: true,
    },
    voxels: [],
    primitives: [],
    screens: [],
    players: [
      {
        id: "player_default",
        label: "Player 1",
        position: { x: 0, y: 1, z: 0 },
        camera_mode: "third_person",
        body_mode: "rigid",
        occupiable: true,
      },
    ],
    texts: [],
    trigger_zones: [],
    prefabs: [],
    particles: [],
    rules: [],
    script_dsl: "",
  };
}

export function normalizeSceneDoc(input = {}) {
  const source = typeof input === "object" && input ? input : {};
  const settingsCameraMode = String(source.settings?.camera_mode ?? source.settings?.cameraMode ?? "third_person")
    .trim()
    .toLowerCase();
  const voxels = (Array.isArray(source.voxels) ? source.voxels : []).slice(0, 4096).map(sanitizeVoxelEntry);
  const primitives = (Array.isArray(source.primitives) ? source.primitives : []).slice(0, 512).map(sanitizePrimitiveEntry);
  const screens = (Array.isArray(source.screens) ? source.screens : []).slice(0, 64).map(sanitizeScreenEntry);
  const players = (Array.isArray(source.players) ? source.players : []).slice(0, PRIVATE_WORLD_LIMITS.maxPlayers).map(sanitizePlayerEntry);
  const texts = (Array.isArray(source.texts) ? source.texts : []).slice(0, 256).map(sanitizeText3Entry);
  const triggerZones = (Array.isArray(source.trigger_zones ?? source.triggerZones) ? (source.trigger_zones ?? source.triggerZones) : []).slice(0, 128).map(sanitizeTriggerZoneEntry);
  const prefabs = (Array.isArray(source.prefabs) ? source.prefabs : []).slice(0, 256).map(sanitizePrefabEntry);
  const particles = (Array.isArray(source.particles) ? source.particles : []).slice(0, 256).map(sanitizeParticleEntry);
  const rules = (Array.isArray(source.rules) ? source.rules : []).slice(0, 256).map(sanitizeRuleEntry);
  const scriptDsl = String(source.script_dsl ?? source.scriptDsl ?? buildRuleDsl(rules)).trim().slice(0, 20000);
  return {
    settings: {
      gravity: sanitizeVector3(source.settings?.gravity, { x: 0, y: -9.8, z: 0 }, { min: -40, max: 40 }),
      camera_mode: ALLOWED_PLAYER_CAMERA_MODES.has(settingsCameraMode)
        ? settingsCameraMode
        : "third_person",
      start_on_ready: source.settings?.start_on_ready !== false,
    },
    voxels,
    primitives,
    screens,
    players,
    texts,
    trigger_zones: triggerZones,
    prefabs,
    particles,
    rules,
    script_dsl: scriptDsl,
  };
}

export function compileSceneDoc(sceneDoc = {}, world = {}) {
  const doc = normalizeSceneDoc(sceneDoc);
  const solidVoxelCount = doc.voxels.length;
  const dynamicObjectCount = doc.primitives.filter((entry) => entry.rigid_mode === "rigid").length;
  return {
    stats: {
      solid_voxel_count: solidVoxelCount,
      primitive_count: doc.primitives.length,
      dynamic_object_count: dynamicObjectCount,
      screen_count: doc.screens.length,
      player_count: doc.players.length,
      text_count: doc.texts.length,
      trigger_zone_count: doc.trigger_zones.length,
      prefab_count: doc.prefabs.length,
      rule_count: doc.rules.length,
    },
    world: {
      world_type: world.world_type ?? null,
      width: Number(world.width ?? 0) || 0,
      length: Number(world.length ?? 0) || 0,
      height: Number(world.height ?? 0) || 0,
    },
    collision: {
      static_solids: doc.voxels.map((entry) => ({
        id: entry.id,
        position: entry.position,
        scale: entry.scale,
      })),
    },
    runtime: {
      players: doc.players.map((entry) => ({
        id: entry.id,
        position: entry.position,
        rotation: entry.rotation,
        scale: entry.scale,
        camera_mode: entry.camera_mode,
        body_mode: entry.body_mode,
      })),
      dynamic_objects: doc.primitives.map((entry) => ({
        id: entry.id,
        position: entry.position,
        rotation: entry.rotation,
        velocity: { x: 0, y: 0, z: 0 },
        angular_velocity: { x: 0, y: 0, z: 0 },
        physics: entry.physics,
        rigid_mode: entry.rigid_mode,
      })),
      trigger_zones: doc.trigger_zones,
      rules: doc.rules,
      particles: doc.particles,
    },
    miniature: {
      static_voxels: doc.voxels.map((entry) => ({
        id: entry.id,
        position: entry.position,
        scale: entry.scale,
        material: entry.material,
      })),
      screens: doc.screens.map((entry) => ({
        id: entry.id,
        position: entry.position,
        scale: entry.scale,
      })),
      players: doc.players.map((entry) => ({
        id: entry.id,
        position: entry.position,
      })),
    },
  };
}

export function computeMiniatureDimensions(world = {}) {
  const width = Math.max(1, Number(world.width) || 1);
  const length = Math.max(1, Number(world.length) || 1);
  const height = Math.max(1, Number(world.height) || 1);
  const longest = Math.max(width, length);
  const targetLongest = Math.min(18, Number((12 * Math.sqrt(longest / 40)).toFixed(4)));
  const scale = targetLongest / Math.max(1, longest);
  return {
    width: Number((width * scale).toFixed(4)),
    length: Number((length * scale).toFixed(4)),
    height: Number(Math.min(3, Number((height * scale).toFixed(4))).toFixed(4)),
  };
}

export function buildPrivateWorldExportPackage(input = {}) {
  const exportedAt = nowIso();
  return {
    format: "mauworld.private-world.v1",
    exported_at: exportedAt,
    credits: {
      origin_world_id: input.world.world_id,
      origin_creator_username: input.creator.username,
      origin_world_name: input.world.name,
      exported_by_username: input.exportedBy?.username ?? input.creator.username,
    },
    world: {
      world_type: input.world.world_type,
      template_size: input.world.template_size,
      width: input.world.width,
      length: input.world.length,
      height: input.world.height,
      name: input.world.name,
      about: input.world.about,
      max_viewers: input.world.max_viewers,
      max_players: input.world.max_players,
      default_scene_name: input.defaultSceneName ?? null,
      lineage: {
        origin_world_id: input.world.origin_world_id ?? input.world.world_id,
        origin_creator_username: input.world.origin_creator_username ?? input.creator.username,
        origin_world_name: input.world.origin_world_name ?? input.world.name,
      },
    },
    prefabs: cloneJson(input.prefabs ?? []),
    scenes: cloneJson(input.scenes ?? []),
  };
}

export function validatePrivateWorldExportPackage(input = {}) {
  const format = String(input.format ?? "").trim();
  if (format !== "mauworld.private-world.v1") {
    throw new HttpError(400, "Invalid Mauworld world package");
  }
  const world = input.world ?? {};
  const size = resolvePrivateWorldSize({
    worldType: world.world_type,
    templateSize: world.template_size,
    width: world.width,
    length: world.length,
    height: world.height,
  });
  const name = sanitizeWorldText(world.name ?? "Imported world", "world name", 96);
  const about = sanitizeWorldText(world.about ?? "Imported Mauworld package", "world about", 240);
  const prefabs = Array.isArray(input.prefabs)
    ? input.prefabs.slice(0, 256).map((entry, index) => ({
        name: sanitizeWorldText(entry?.name ?? `Prefab ${index + 1}`, "prefab name", 80),
        prefab_doc: cloneJson(entry?.prefab_doc ?? entry?.prefabDoc ?? {}),
      }))
    : [];
  const rawScenes = Array.isArray(input.scenes) ? input.scenes.slice(0, 64) : [];
  if (rawScenes.length === 0) {
    throw new HttpError(400, "World package must include at least one scene");
  }
  const scenes = rawScenes.map((entry, index) => ({
    name: sanitizeWorldText(entry.name ?? `Scene ${index + 1}`, "scene name", 80),
    scene_doc: normalizeSceneDoc(entry.scene_doc ?? entry.sceneDoc ?? entry),
  }));
  return {
    format,
    world: {
      ...size,
      name,
      about,
      max_viewers: clampInteger(world.max_viewers, PRIVATE_WORLD_LIMITS.maxViewers, 1, 100),
      max_players: clampInteger(world.max_players, PRIVATE_WORLD_LIMITS.maxPlayers, 1, PRIVATE_WORLD_LIMITS.maxPlayers),
      default_scene_name: String(world.default_scene_name ?? "").trim() || scenes[0].name,
      lineage: {
        origin_world_id: String(world.lineage?.origin_world_id ?? input.credits?.origin_world_id ?? "").trim() || null,
        origin_creator_username: String(world.lineage?.origin_creator_username ?? input.credits?.origin_creator_username ?? "").trim().toLowerCase() || null,
        origin_world_name: String(world.lineage?.origin_world_name ?? input.credits?.origin_world_name ?? "").trim() || null,
      },
    },
    credits: {
      origin_world_id: String(input.credits?.origin_world_id ?? "").trim() || null,
      origin_creator_username: String(input.credits?.origin_creator_username ?? "").trim().toLowerCase() || null,
      origin_world_name: String(input.credits?.origin_world_name ?? "").trim() || null,
    },
    prefabs,
    scenes,
  };
}
