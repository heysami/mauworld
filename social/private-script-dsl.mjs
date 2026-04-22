import { normalizePrivateInputKey } from "./private-input.mjs";

export const SCRIPT_FUNCTION_HEADER_RE = /^#\s*function(?:\[([a-z0-9_-]+)\])?:\s*(.*)$/i;

const PRIVATE_WORLD_BLOCK_UNIT = 5;
const DEFAULT_PLAYER_MOVE_SPEED = 4.317 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_SPRINT_SPEED = 5.612 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_ACCELERATION = 26;
const DEFAULT_PLAYER_DECELERATION = 22;
const DEFAULT_PLAYER_AIR_CONTROL = 0.72;
const DEFAULT_PLAYER_GROUND_FRICTION = 0.8;
const DEFAULT_PLAYER_BRAKING_FRICTION = 0.92;
const DEFAULT_PLAYER_TURN_SPEED = 14;
const DEFAULT_PLAYER_JUMP_HEIGHT = 12.5 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_JUMP_COUNT = 1;
const DEFAULT_PLAYER_JUMP_BUFFER_MS = 160;
const DEFAULT_PLAYER_COYOTE_TIME_MS = 100;
const DEFAULT_PLAYER_GRAVITY_SCALE = 1;
const DEFAULT_PLAYER_MAX_FALL_SPEED = 80;
const DEFAULT_PLAYER_SLIDE_ON_CEILING = true;
const DEFAULT_PLAYER_SLOPE_LIMIT_DEG = 46;
const DEFAULT_PLAYER_STEP_HEIGHT = 2.4;
const DEFAULT_PLAYER_FLOOR_SNAP_LENGTH = 0.3;
const DEFAULT_PLAYER_SAFE_MARGIN = 0.08;
const DEFAULT_PLAYER_CARRY_RIDERS = false;
const DEFAULT_PLAYER_PLATFORM_LEAVE_BEHAVIOR = "inherit";
const DEFAULT_PLAYER_INHERIT_PLATFORM_VELOCITY = true;
const DEFAULT_PLAYER_MOVE_FORWARD_KEY = "w";
const DEFAULT_PLAYER_MOVE_BACK_KEY = "s";
const DEFAULT_PLAYER_MOVE_LEFT_KEY = "a";
const DEFAULT_PLAYER_MOVE_RIGHT_KEY = "d";
const DEFAULT_PLAYER_JUMP_KEY = "space";
const DEFAULT_PLAYER_SPRINT_KEY = "shift";
const DEFAULT_PLAYER_INTERACT_KEY = "e";
const DEFAULT_PLAYER_FIRE_KEY = "mouse_left";
const DEFAULT_PLAYER_ALT_FIRE_KEY = "mouse_right";
const DEFAULT_DRAG_BUTTON = "mouse_left";
const DEFAULT_DRAG_PAN_SPEED = 1;
const DEFAULT_DRAG_SENSITIVITY = 1;
const DEFAULT_DRAG_ZOOM_SPEED = 1;
const DEFAULT_DRAG_ZOOM_MIN = 16;
const DEFAULT_DRAG_ZOOM_MAX = 110;
const DEFAULT_DRAG_EDGE_PAN_SPEED = 0;
const DEFAULT_DRAG_SMOOTH_TIME = 0;
const DEFAULT_FACE_MOUSE_SNAP_MODE = "4_way";
const DEFAULT_FACE_MOUSE_TURN_SMOOTHING = 0;
const DEFAULT_FACE_MOUSE_ROTATE_BODY = true;
const DEFAULT_FACE_MOUSE_ROTATE_WEAPON_ONLY = false;
const DEFAULT_FACE_MOUSE_DEADZONE_PX = 8;
const DEFAULT_WORLD_FRICTION = 0.4;
const DEFAULT_WORLD_RESTITUTION = 0;
const DEFAULT_WORLD_TERMINAL_VELOCITY = 120;
const SCRIPT_RUNTIME_MODULE_KIND = "script.runtime";
const SCRIPT_RUNTIME_RESERVED_IDENTIFIERS = new Set([
  "if",
  "let",
  "return",
  "true",
  "false",
  "null",
  "self",
  "scene",
  "dt",
  "time",
  "entity",
  "entities",
  "players",
  "nearest",
  "sort_by_distance",
  "distance",
  "normalize",
  "length",
  "vec",
  "clamp",
  "min",
  "max",
]);

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
  "move_platform",
  "switch_scene",
  "set_material",
  "set_visibility",
  "toggle_particles",
  "set_text",
  "set_screen_state",
  "start_scene",
]);

const MODULE_KINDS = new Set([
  "playmode.wasd_jump",
  "camera.overworld_drag_pan",
  "behavior.face_mouse_orthogonal",
  "physics.world",
  SCRIPT_RUNTIME_MODULE_KIND,
]);

const PRIVATE_WORLD_MODULE_DEFINITION_DATA = {
  "playmode.wasd_jump": {
    scope: "player",
    params: [
      { name: "move_speed", type: "number", min: 0, max: 4096 },
      { name: "sprint_speed", type: "number", min: 0, max: 4096 },
      { name: "acceleration", type: "number", min: 0, max: 4096 },
      { name: "deceleration", type: "number", min: 0, max: 4096 },
      { name: "air_control", type: "number", min: 0, max: 1 },
      { name: "ground_friction", type: "number", min: 0, max: 16 },
      { name: "braking_friction", type: "number", min: 0, max: 16 },
      { name: "turn_speed", type: "number", min: 0, max: 128 },
      { name: "jump_enabled", type: "boolean" },
      { name: "jump_height", type: "number", min: 0, max: 4096 },
      { name: "jump_count", type: "integer", min: 1, max: 8 },
      { name: "jump_buffer_ms", type: "integer", min: 0, max: 5000 },
      { name: "coyote_time_ms", type: "integer", min: 0, max: 5000 },
      { name: "gravity_scale", type: "number", min: 0, max: 20 },
      { name: "max_fall_speed", type: "number", min: 0, max: 4096 },
      { name: "slide_on_ceiling", type: "boolean" },
      { name: "slope_limit_deg", type: "number", min: 0, max: 89 },
      { name: "step_height", type: "number", min: 0, max: 256 },
      { name: "floor_snap_length", type: "number", min: 0, max: 256 },
      { name: "safe_margin", type: "number", min: 0, max: 8 },
      { name: "collider_height", type: "number", min: 0.1, max: 512 },
      { name: "collider_radius", type: "number", min: 0.05, max: 256 },
      { name: "carry_riders", type: "boolean" },
      { name: "platform_leave_behavior", type: "enum", values: ["inherit", "drop", "cancel"] },
      { name: "inherit_platform_velocity", type: "boolean" },
    ],
    bindings: [
      { name: "move_forward_key", type: "input" },
      { name: "move_back_key", type: "input" },
      { name: "move_left_key", type: "input" },
      { name: "move_right_key", type: "input" },
      { name: "jump_key", type: "input" },
      { name: "sprint_key", type: "input" },
      { name: "interact_key", type: "input" },
      { name: "fire_key", type: "input" },
      { name: "alt_fire_key", type: "input" },
    ],
  },
  "camera.overworld_drag_pan": {
    scope: "player",
    params: [
      { name: "drag_enabled", type: "boolean" },
      { name: "pan_speed", type: "number", min: 0, max: 64 },
      { name: "drag_sensitivity", type: "number", min: 0, max: 32 },
      { name: "clamp_to_world", type: "boolean" },
      { name: "zoom_speed", type: "number", min: 0, max: 32 },
      { name: "zoom_min", type: "number", min: 0, max: 4096 },
      { name: "zoom_max", type: "number", min: 0, max: 4096 },
      { name: "edge_pan_speed", type: "number", min: 0, max: 64 },
      { name: "smooth_time", type: "number", min: 0, max: 10 },
    ],
    bindings: [
      { name: "drag_button", type: "input" },
    ],
  },
  "behavior.face_mouse_orthogonal": {
    scope: "player",
    params: [
      { name: "enabled", type: "boolean" },
      { name: "snap_mode", type: "enum", values: ["free", "4_way", "8_way"] },
      { name: "turn_smoothing", type: "number", min: 0, max: 16 },
      { name: "rotate_body", type: "boolean" },
      { name: "rotate_weapon_only", type: "boolean" },
      { name: "deadzone_px", type: "number", min: 0, max: 4096 },
    ],
    bindings: [],
  },
  "physics.world": {
    scope: "scene",
    params: [
      { name: "gravity", type: "vector3", min: -256, max: 256 },
      { name: "default_friction", type: "number", min: 0, max: 16 },
      { name: "default_restitution", type: "number", min: 0, max: 4 },
      { name: "terminal_velocity", type: "number", min: 0, max: 4096 },
    ],
    bindings: [],
  },
  [SCRIPT_RUNTIME_MODULE_KIND]: {
    scope: "runtime",
    allowed_target_scopes: ["scene", "entity"],
    allow_custom_params: true,
    params: [],
    bindings: [],
  },
};

export const PRIVATE_WORLD_MODULE_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(PRIVATE_WORLD_MODULE_DEFINITION_DATA).map(([moduleKind, definition]) => [
      moduleKind,
      Object.freeze({
        scope: definition.scope,
        allowed_target_scopes: Object.freeze([...(definition.allowed_target_scopes ?? [])]),
        allow_custom_params: definition.allow_custom_params === true,
        params: Object.freeze(definition.params.map((entry) => Object.freeze({ ...entry }))),
        bindings: Object.freeze(definition.bindings.map((entry) => Object.freeze({ ...entry }))),
      }),
    ]),
  ),
);

const PRIVATE_WORLD_PARAM_DEFINITION_MAP = new Map(
  Object.values(PRIVATE_WORLD_MODULE_DEFINITION_DATA)
    .flatMap((definition) => definition.params)
    .map((entry) => [entry.name, entry]),
);

const PRIVATE_WORLD_BINDING_DEFINITION_MAP = new Map(
  Object.values(PRIVATE_WORLD_MODULE_DEFINITION_DATA)
    .flatMap((definition) => definition.bindings)
    .map((entry) => [entry.name, entry]),
);

const PRIVATE_WORLD_TARGET_COLLECTIONS = [
  { key: "voxels", kind: "voxel" },
  { key: "primitives", kind: "primitive" },
  { key: "panels", kind: "panel" },
  { key: "models", kind: "model" },
  { key: "screens", kind: "screen" },
  { key: "players", kind: "player" },
  { key: "texts", kind: "text" },
  { key: "trigger_zones", kind: "trigger" },
  { key: "prefab_instances", kind: "prefab_instance" },
  { key: "particles", kind: "particle" },
];

const PREFAB_INSTANCE_RULE_ACTIONS = new Set([
  "teleport",
  "move_platform",
  "set_visibility",
  "set_material",
]);

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, numeric));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function sanitizeVector3(input = {}, fallback = { x: 0, y: 0, z: 0 }, limits = { min: -4096, max: 4096 }) {
  return {
    x: Number(clampNumber(input.x, fallback.x, limits.min, limits.max).toFixed(4)),
    y: Number(clampNumber(input.y, fallback.y, limits.min, limits.max).toFixed(4)),
    z: Number(clampNumber(input.z, fallback.z, limits.min, limits.max).toFixed(4)),
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function slugToken(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createFallbackFunctionId(index = 0) {
  return `scriptfn_logic_${index + 1}`;
}

function tokenizeDslSegment(value = "") {
  return String(value ?? "")
    .match(/"[^"]*"|'[^']*'|\S+/g)
    ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
}

function parseDslVector(token = "") {
  const match = String(token ?? "").match(/^([a-z]+)\(([-0-9.]+),([-0-9.]+),([-0-9.]+)\)$/i);
  if (!match) {
    return null;
  }
  return {
    kind: String(match[1] ?? "").trim().toLowerCase(),
    value: sanitizeVector3({
      x: Number(match[2]),
      y: Number(match[3]),
      z: Number(match[4]),
    }),
  };
}

function parseDslLiteralValue(token = "") {
  const normalized = String(token ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  if (normalized === "null") {
    return null;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/i.test(normalized)) {
    return numeric;
  }
  return normalized;
}

function parseDirectiveVectorValue(rawValue = "") {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return null;
  }
  const vectorToken = parseDslVector(value);
  if (vectorToken) {
    return vectorToken.value;
  }
  const directMatch = value.match(/^\(?\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)?$/);
  if (!directMatch) {
    return null;
  }
  return sanitizeVector3({
    x: Number(directMatch[1]),
    y: Number(directMatch[2]),
    z: Number(directMatch[3]),
  });
}

function parseDirectiveBooleanValue(rawValue = "", fallback = false) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
    return false;
  }
  return fallback;
}

function normalizePrivateInputToken(value = "") {
  const normalized = normalizePrivateInputKey({ key: value, code: value });
  return normalized || String(value ?? "").trim().toLowerCase();
}

function normalizeEnumToken(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getModuleDefinition(moduleKind = "") {
  return PRIVATE_WORLD_MODULE_DEFINITION_DATA[String(moduleKind ?? "").trim().toLowerCase()] ?? null;
}

function getModuleParamDefinition(moduleKind = "", param = "") {
  return getModuleDefinition(moduleKind)?.params?.find((entry) => entry.name === param) ?? null;
}

function getModuleBindingDefinition(moduleKind = "", binding = "") {
  return getModuleDefinition(moduleKind)?.bindings?.find((entry) => entry.name === binding) ?? null;
}

export function buildPrivateWorldScriptTargetCatalog(sceneDoc = {}) {
  const catalog = new Map([
    ["scene", {
      id: "scene",
      target_scope: "scene",
      target_kind: "scene",
    }],
  ]);
  for (const collection of PRIVATE_WORLD_TARGET_COLLECTIONS) {
    for (const entry of Array.isArray(sceneDoc?.[collection.key]) ? sceneDoc[collection.key] : []) {
      const entryId = String(entry?.id ?? "").trim();
      if (!entryId) {
        continue;
      }
      catalog.set(entryId, {
        id: entryId,
        target_scope: "entity",
        target_kind: collection.kind,
      });
    }
  }
  return catalog;
}

export function isPrivateWorldRuleTargetAllowed(action = "", targetKind = "") {
  const normalizedAction = String(action ?? "").trim().toLowerCase();
  const normalizedTargetKind = String(targetKind ?? "").trim().toLowerCase();
  if (!normalizedAction || !normalizedTargetKind) {
    return true;
  }
  if (normalizedTargetKind === "prefab_instance") {
    return PREFAB_INSTANCE_RULE_ACTIONS.has(normalizedAction);
  }
  return true;
}

function getPlayerColliderDefaults(player = {}) {
  const scale = Math.max(0.25, finiteNumber(player?.scale, PRIVATE_WORLD_BLOCK_UNIT));
  return {
    collider_height: Number((1.8 * scale).toFixed(4)),
    collider_radius: Number(((0.6 * scale) / 2).toFixed(4)),
  };
}

function buildDefaultPlayerControlParams(player = {}) {
  const colliderDefaults = getPlayerColliderDefaults(player);
  return {
    move_speed: DEFAULT_PLAYER_MOVE_SPEED,
    sprint_speed: DEFAULT_PLAYER_SPRINT_SPEED,
    acceleration: DEFAULT_PLAYER_ACCELERATION,
    deceleration: DEFAULT_PLAYER_DECELERATION,
    air_control: DEFAULT_PLAYER_AIR_CONTROL,
    ground_friction: DEFAULT_PLAYER_GROUND_FRICTION,
    braking_friction: DEFAULT_PLAYER_BRAKING_FRICTION,
    turn_speed: DEFAULT_PLAYER_TURN_SPEED,
    jump_enabled: player.jump_enabled === true,
    jump_height: DEFAULT_PLAYER_JUMP_HEIGHT,
    jump_count: DEFAULT_PLAYER_JUMP_COUNT,
    jump_buffer_ms: DEFAULT_PLAYER_JUMP_BUFFER_MS,
    coyote_time_ms: DEFAULT_PLAYER_COYOTE_TIME_MS,
    gravity_scale: DEFAULT_PLAYER_GRAVITY_SCALE,
    max_fall_speed: DEFAULT_PLAYER_MAX_FALL_SPEED,
    slide_on_ceiling: DEFAULT_PLAYER_SLIDE_ON_CEILING,
    slope_limit_deg: DEFAULT_PLAYER_SLOPE_LIMIT_DEG,
    step_height: DEFAULT_PLAYER_STEP_HEIGHT,
    floor_snap_length: DEFAULT_PLAYER_FLOOR_SNAP_LENGTH,
    safe_margin: DEFAULT_PLAYER_SAFE_MARGIN,
    collider_height: colliderDefaults.collider_height,
    collider_radius: colliderDefaults.collider_radius,
    carry_riders: DEFAULT_PLAYER_CARRY_RIDERS,
    platform_leave_behavior: DEFAULT_PLAYER_PLATFORM_LEAVE_BEHAVIOR,
    inherit_platform_velocity: DEFAULT_PLAYER_INHERIT_PLATFORM_VELOCITY,
  };
}

function buildDefaultPlayerControlBindings() {
  return {
    move_forward_key: DEFAULT_PLAYER_MOVE_FORWARD_KEY,
    move_back_key: DEFAULT_PLAYER_MOVE_BACK_KEY,
    move_left_key: DEFAULT_PLAYER_MOVE_LEFT_KEY,
    move_right_key: DEFAULT_PLAYER_MOVE_RIGHT_KEY,
    jump_key: DEFAULT_PLAYER_JUMP_KEY,
    sprint_key: DEFAULT_PLAYER_SPRINT_KEY,
    interact_key: DEFAULT_PLAYER_INTERACT_KEY,
    fire_key: DEFAULT_PLAYER_FIRE_KEY,
    alt_fire_key: DEFAULT_PLAYER_ALT_FIRE_KEY,
  };
}

function buildDefaultOverworldDragParams() {
  return {
    drag_enabled: true,
    pan_speed: DEFAULT_DRAG_PAN_SPEED,
    drag_sensitivity: DEFAULT_DRAG_SENSITIVITY,
    clamp_to_world: true,
    zoom_speed: DEFAULT_DRAG_ZOOM_SPEED,
    zoom_min: DEFAULT_DRAG_ZOOM_MIN,
    zoom_max: DEFAULT_DRAG_ZOOM_MAX,
    edge_pan_speed: DEFAULT_DRAG_EDGE_PAN_SPEED,
    smooth_time: DEFAULT_DRAG_SMOOTH_TIME,
  };
}

function buildDefaultFaceMouseParams() {
  return {
    enabled: false,
    snap_mode: DEFAULT_FACE_MOUSE_SNAP_MODE,
    turn_smoothing: DEFAULT_FACE_MOUSE_TURN_SMOOTHING,
    rotate_body: DEFAULT_FACE_MOUSE_ROTATE_BODY,
    rotate_weapon_only: DEFAULT_FACE_MOUSE_ROTATE_WEAPON_ONLY,
    deadzone_px: DEFAULT_FACE_MOUSE_DEADZONE_PX,
  };
}

function buildDefaultWorldPhysicsParams(sceneDoc = {}) {
  return {
    gravity: sanitizeVector3(sceneDoc?.settings?.gravity, { x: 0, y: -9.8, z: 0 }, { min: -40, max: 40 }),
    default_friction: DEFAULT_WORLD_FRICTION,
    default_restitution: DEFAULT_WORLD_RESTITUTION,
    terminal_velocity: DEFAULT_WORLD_TERMINAL_VELOCITY,
  };
}

function formatDslScalarValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  }
  return String(value ?? "").trim();
}

function formatDslDirectiveValue(param = "", value = null) {
  if (value == null) {
    return "";
  }
  const definition = PRIVATE_WORLD_PARAM_DEFINITION_MAP.get(String(param ?? "").trim().toLowerCase()) ?? null;
  if (definition?.type === "vector3") {
    const vector = sanitizeVector3(value);
    return `(${formatDslScalarValue(vector.x)},${formatDslScalarValue(vector.y)},${formatDslScalarValue(vector.z)})`;
  }
  return formatDslScalarValue(value);
}

function sanitizeModuleParamValue(moduleKind = "", param = "", value, fallback = null) {
  const definition = getModuleParamDefinition(moduleKind, param);
  if (!definition) {
    return value ?? fallback;
  }
  if (definition.type === "boolean") {
    return parseDirectiveBooleanValue(value, Boolean(fallback));
  }
  if (definition.type === "vector3") {
    const limits = {
      min: Number.isFinite(definition.min) ? definition.min : -4096,
      max: Number.isFinite(definition.max) ? definition.max : 4096,
    };
    return sanitizeVector3(value, fallback ?? { x: 0, y: 0, z: 0 }, limits);
  }
  if (definition.type === "enum") {
    const normalized = normalizeEnumToken(value);
    return definition.values.includes(normalized)
      ? normalized
      : (definition.values.includes(normalizeEnumToken(fallback)) ? normalizeEnumToken(fallback) : definition.values[0]);
  }
  if (definition.type === "integer") {
    return clampInteger(
      value,
      finiteNumber(fallback, definition.min ?? 0),
      Number.isFinite(definition.min) ? definition.min : -4096,
      Number.isFinite(definition.max) ? definition.max : 4096,
    );
  }
  if (definition.type === "number") {
    return clampNumber(
      value,
      finiteNumber(fallback, definition.min ?? 0),
      Number.isFinite(definition.min) ? definition.min : -4096,
      Number.isFinite(definition.max) ? definition.max : 4096,
    );
  }
  return String(value ?? fallback ?? "").trim();
}

function sanitizeModuleBindingValue(moduleKind = "", binding = "", value, fallback = "") {
  const definition = getModuleBindingDefinition(moduleKind, binding);
  if (!definition || definition.type !== "input") {
    return String(value ?? fallback ?? "").trim();
  }
  return normalizePrivateInputToken(value) || normalizePrivateInputToken(fallback) || "";
}

function listModuleParams(moduleKind = "") {
  return getModuleDefinition(moduleKind)?.params ?? [];
}

function listModuleBindings(moduleKind = "") {
  return getModuleDefinition(moduleKind)?.bindings ?? [];
}

export function serializePrivateWorldModuleFunctionBody(moduleConfig = {}) {
  const moduleKind = normalizeModuleKind(moduleConfig?.module_kind ?? moduleConfig?.moduleKind ?? "");
  if (!moduleKind) {
    return "";
  }
  const targetId = String(moduleConfig?.target_id ?? moduleConfig?.targetId ?? "").trim() || (moduleKind === "physics.world" ? "scene" : "");
  const enabled = moduleConfig?.enabled !== false;
  const lines = [
    `@module ${moduleKind}`,
    targetId ? `@target ${targetId}` : "",
    `@enabled ${enabled ? "true" : "false"}`,
  ].filter(Boolean);
  if (moduleKind === SCRIPT_RUNTIME_MODULE_KIND) {
    for (const [name, value] of Object.entries(moduleConfig?.params ?? {})) {
      if (!isValidScriptRuntimeIdentifier(name)) {
        continue;
      }
      lines.push(`@set ${name} ${formatScriptRuntimeDirectiveValue(value)}`);
    }
    const programSource = String(moduleConfig?.program_source ?? moduleConfig?.programSource ?? "").trim();
    return [...lines, programSource].filter(Boolean).join("\n").trim();
  }
  for (const definition of listModuleBindings(moduleKind)) {
    const rawValue = moduleConfig?.bindings?.[definition.name];
    const value = sanitizeModuleBindingValue(moduleKind, definition.name, rawValue, "");
    if (!value) {
      continue;
    }
    lines.push(`@bind ${definition.name} ${value}`);
  }
  for (const definition of listModuleParams(moduleKind)) {
    const fallback = null;
    const value = sanitizeModuleParamValue(moduleKind, definition.name, moduleConfig?.params?.[definition.name], fallback);
    lines.push(`@set ${definition.name} ${formatDslDirectiveValue(definition.name, value)}`);
  }
  return lines.join("\n").trim();
}

function resolveEntityAlias(aliasMap, value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  if (!(aliasMap instanceof Map)) {
    return raw;
  }
  return aliasMap.get(raw) ?? aliasMap.get(slugToken(raw)) ?? raw;
}

export function normalizeScriptFunctionEntry(entry = {}, index = 0) {
  return {
    id: String(entry.id ?? "").trim() || createFallbackFunctionId(index),
    name: String(entry.name ?? "").trim() || `Function ${index + 1}`,
    body: String(entry.body ?? "").replace(/\s+$/g, ""),
  };
}

export function parseScriptFunctionLibrary(value = "") {
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
    if (!current && !line.trim()) {
      continue;
    }
    const headerMatch = line.match(SCRIPT_FUNCTION_HEADER_RE);
    if (headerMatch) {
      pushCurrent();
      current = {
        id: String(headerMatch[1] ?? "").trim() || createFallbackFunctionId(functions.length),
        name: String(headerMatch[2] ?? "").trim() || `Function ${functions.length + 1}`,
        lines: [],
      };
      continue;
    }
    if (!current) {
      current = {
        id: createFallbackFunctionId(functions.length),
        name: "Main function",
        lines: [],
      };
    }
    current.lines.push(line);
  }
  pushCurrent();
  return functions;
}

export function serializeScriptFunctionLibrary(functions = []) {
  return functions
    .map((entry, index) => normalizeScriptFunctionEntry(entry, index))
    .map((entry) => [`# function[${entry.id}]: ${entry.name}`, entry.body].filter((part) => part !== "").join("\n"))
    .join("\n\n")
    .trim();
}

function normalizeModuleKind(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MODULE_KINDS.has(normalized) ? normalized : "";
}

function parseDirectiveValue(param = "", rawValue = "") {
  const normalizedParam = String(param ?? "").trim().toLowerCase();
  if (!normalizedParam) {
    return rawValue;
  }
  const definition = PRIVATE_WORLD_PARAM_DEFINITION_MAP.get(normalizedParam);
  if (definition?.type === "vector3" || normalizedParam === "gravity") {
    return parseDirectiveVectorValue(rawValue);
  }
  if (definition?.type === "boolean") {
    return parseDirectiveBooleanValue(rawValue, true);
  }
  if (definition?.type === "enum") {
    return normalizeEnumToken(rawValue);
  }
  if (definition?.type === "number" || definition?.type === "integer") {
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      return definition.type === "integer" ? Math.round(numericValue) : numericValue;
    }
    return null;
  }
  if (normalizedParam.endsWith("_key") || normalizedParam.endsWith("_button")) {
    return normalizePrivateInputToken(rawValue);
  }
  const numericValue = Number(rawValue);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }
  return String(rawValue ?? "").trim();
}

function isValidScriptRuntimeIdentifier(value = "") {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value ?? "").trim());
}

function parseScriptRuntimeDirectiveValue(rawValue = "") {
  const trimmed = String(rawValue ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const vector = parseDirectiveVectorValue(trimmed);
  if (vector) {
    return vector;
  }
  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    return parseDirectiveBooleanValue(trimmed, false);
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/i.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function formatScriptRuntimeDirectiveValue(value = null) {
  if (value == null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return formatDslScalarValue(value);
  }
  if (
    value
    && typeof value === "object"
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  ) {
    const vector = sanitizeVector3(value);
    return `(${formatDslScalarValue(vector.x)},${formatDslScalarValue(vector.y)},${formatDslScalarValue(vector.z)})`;
  }
  const text = String(value ?? "");
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function tokenizeScriptRuntimeExpression(source = "", lineNumber = 0) {
  const tokens = [];
  const text = String(source ?? "");
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const twoChar = text.slice(index, index + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar, line: lineNumber });
      index += 2;
      continue;
    }
    if (["+", "-", "*", "/", "!", "<", ">", "(", ")", ".", ","].includes(char)) {
      tokens.push({
        type: ["(", ")", ".", ","].includes(char) ? "punctuation" : "operator",
        value: char,
        line: lineNumber,
      });
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        const next = text[cursor];
        if (next === "\\") {
          const escaped = text[cursor + 1] ?? "";
          if (escaped === "n") {
            value += "\n";
          } else if (escaped === "t") {
            value += "\t";
          } else {
            value += escaped;
          }
          cursor += 2;
          continue;
        }
        if (next === quote) {
          closed = true;
          cursor += 1;
          break;
        }
        value += next;
        cursor += 1;
      }
      if (!closed) {
        return {
          tokens: [],
          errors: [{ line: lineNumber, message: "Unterminated string literal in script.runtime expression." }],
        };
      }
      tokens.push({ type: "string", value, line: lineNumber });
      index = cursor;
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(text[index + 1] ?? ""))) {
      let cursor = index + 1;
      while (cursor < text.length && /[\d.]/.test(text[cursor])) {
        cursor += 1;
      }
      const value = text.slice(index, cursor);
      if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(value)) {
        return {
          tokens: [],
          errors: [{ line: lineNumber, message: `Invalid numeric literal \`${value}\` in script.runtime expression.` }],
        };
      }
      tokens.push({ type: "number", value: Number(value), line: lineNumber });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let cursor = index + 1;
      while (cursor < text.length && /[A-Za-z0-9_]/.test(text[cursor])) {
        cursor += 1;
      }
      tokens.push({ type: "identifier", value: text.slice(index, cursor), line: lineNumber });
      index = cursor;
      continue;
    }
    return {
      tokens: [],
      errors: [{ line: lineNumber, message: `Unexpected token \`${char}\` in script.runtime expression.` }],
    };
  }
  tokens.push({ type: "eof", value: "", line: lineNumber });
  return { tokens, errors: [] };
}

function createScriptRuntimeExpressionParser(tokens = [], lineNumber = 0) {
  let index = 0;
  const peek = () => tokens[index] ?? { type: "eof", value: "", line: lineNumber };
  const advance = () => {
    const token = peek();
    index += 1;
    return token;
  };
  const matchValue = (...values) => {
    const token = peek();
    if (values.includes(token.value)) {
      advance();
      return token;
    }
    return null;
  };
  const expectValue = (value, message) => {
    const token = advance();
    if (token.value !== value) {
      throw new Error(message || `Expected \`${value}\`.`);
    }
    return token;
  };
  const parsePrimary = () => {
    const token = advance();
    if (token.type === "number") {
      return { type: "Literal", value: token.value, line: token.line };
    }
    if (token.type === "string") {
      return { type: "Literal", value: token.value, line: token.line };
    }
    if (token.type === "identifier") {
      if (token.value === "true" || token.value === "false") {
        return { type: "Literal", value: token.value === "true", line: token.line };
      }
      if (token.value === "null") {
        return { type: "Literal", value: null, line: token.line };
      }
      return { type: "Identifier", name: token.value, line: token.line };
    }
    if (token.value === "(") {
      const expression = parseExpression();
      expectValue(")", "Missing closing `)` in script.runtime expression.");
      return expression;
    }
    throw new Error(`Unexpected token \`${token.value || token.type}\` in script.runtime expression.`);
  };
  const parseCallMember = () => {
    let expression = parsePrimary();
    while (true) {
      if (matchValue(".")) {
        const property = advance();
        if (property.type !== "identifier") {
          throw new Error("Expected a property name after `.` in script.runtime expression.");
        }
        expression = {
          type: "MemberExpression",
          object: expression,
          property: { type: "Identifier", name: property.value, line: property.line },
          line: property.line,
        };
        continue;
      }
      if (matchValue("(")) {
        const args = [];
        if (!matchValue(")")) {
          do {
            args.push(parseExpression());
          } while (matchValue(","));
          expectValue(")", "Missing closing `)` after function arguments.");
        }
        expression = {
          type: "CallExpression",
          callee: expression,
          arguments: args,
          line: expression.line ?? lineNumber,
        };
        continue;
      }
      break;
    }
    return expression;
  };
  const parseUnary = () => {
    const operator = matchValue("!", "-");
    if (operator) {
      return {
        type: "UnaryExpression",
        operator: operator.value,
        argument: parseUnary(),
        line: operator.line,
      };
    }
    return parseCallMember();
  };
  const parseBinary = (nextParser, operators = [], nodeType = "BinaryExpression") => {
    let left = nextParser();
    while (operators.includes(peek().value)) {
      const operator = advance();
      const right = nextParser();
      left = {
        type: nodeType,
        operator: operator.value,
        left,
        right,
        line: operator.line,
      };
    }
    return left;
  };
  const parseMultiplicative = () => parseBinary(parseUnary, ["*", "/"]);
  const parseAdditive = () => parseBinary(parseMultiplicative, ["+", "-"]);
  const parseComparison = () => parseBinary(parseAdditive, ["<", ">", "<=", ">="]);
  const parseEquality = () => parseBinary(parseComparison, ["==", "!="]);
  const parseLogicalAnd = () => parseBinary(parseEquality, ["&&"], "LogicalExpression");
  const parseLogicalOr = () => parseBinary(parseLogicalAnd, ["||"], "LogicalExpression");
  const parseExpression = () => parseLogicalOr();
  return {
    parseExpression,
    peek,
  };
}

function parseScriptRuntimeExpression(source = "", lineNumber = 0) {
  const tokenized = tokenizeScriptRuntimeExpression(source, lineNumber);
  if (tokenized.errors.length > 0) {
    return {
      expression: null,
      errors: tokenized.errors,
    };
  }
  try {
    const parser = createScriptRuntimeExpressionParser(tokenized.tokens, lineNumber);
    const expression = parser.parseExpression();
    if (parser.peek().type !== "eof") {
      return {
        expression: null,
        errors: [{ line: lineNumber, message: `Unexpected token \`${parser.peek().value}\` in script.runtime expression.` }],
      };
    }
    return { expression, errors: [] };
  } catch (error) {
    return {
      expression: null,
      errors: [{ line: lineNumber, message: error instanceof Error ? error.message : "Invalid script.runtime expression." }],
    };
  }
}

function findTopLevelAssignmentIndex(source = "") {
  const text = String(source ?? "");
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== "=" || depth !== 0) {
      continue;
    }
    const previous = text[index - 1] ?? "";
    const next = text[index + 1] ?? "";
    if (previous === "=" || previous === "!" || previous === "<" || previous === ">" || next === "=") {
      continue;
    }
    return index;
  }
  return -1;
}

function isValidScriptRuntimeAssignmentTarget(expression = null) {
  if (!expression) {
    return false;
  }
  if (expression.type === "Identifier") {
    return true;
  }
  if (expression.type !== "MemberExpression") {
    return false;
  }
  return isValidScriptRuntimeAssignmentTarget(expression.object);
}

function isScriptRuntimeIfStatementText(text = "") {
  return /^if(?:\s|\()/.test(String(text ?? "").trim());
}

function parseScriptRuntimeStatementFromText(text = "", lineNumber = 0, errors = []) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("else")) {
    errors.push({ line: lineNumber, message: "`else` is not supported in script.runtime yet." });
    return null;
  }
  if (trimmed === "return") {
    return { type: "ReturnStatement", argument: null, line: lineNumber };
  }
  if (trimmed.startsWith("return ")) {
    const parsed = parseScriptRuntimeExpression(trimmed.slice(7), lineNumber);
    errors.push(...parsed.errors);
    return parsed.expression
      ? { type: "ReturnStatement", argument: parsed.expression, line: lineNumber }
      : null;
  }
  if (trimmed.startsWith("let ")) {
    const declaration = trimmed.slice(4).trim();
    const assignmentIndex = findTopLevelAssignmentIndex(declaration);
    if (assignmentIndex < 0) {
      errors.push({ line: lineNumber, message: "Expected `let name = expression` in script.runtime code." });
      return null;
    }
    const name = declaration.slice(0, assignmentIndex).trim();
    if (!isValidScriptRuntimeIdentifier(name)) {
      errors.push({ line: lineNumber, message: `Invalid script.runtime variable name \`${name || "(empty)"}\`.` });
      return null;
    }
    if (SCRIPT_RUNTIME_RESERVED_IDENTIFIERS.has(name)) {
      errors.push({ line: lineNumber, message: `Script variable \`${name}\` is reserved by script.runtime.` });
      return null;
    }
    const parsed = parseScriptRuntimeExpression(declaration.slice(assignmentIndex + 1).trim(), lineNumber);
    errors.push(...parsed.errors);
    return parsed.expression
      ? {
        type: "VariableDeclaration",
        name,
        init: parsed.expression,
        line: lineNumber,
      }
      : null;
  }
  const assignmentIndex = findTopLevelAssignmentIndex(trimmed);
  if (assignmentIndex >= 0) {
    const leftParsed = parseScriptRuntimeExpression(trimmed.slice(0, assignmentIndex).trim(), lineNumber);
    const rightParsed = parseScriptRuntimeExpression(trimmed.slice(assignmentIndex + 1).trim(), lineNumber);
    errors.push(...leftParsed.errors, ...rightParsed.errors);
    if (
      leftParsed.expression
      && leftParsed.expression.type !== "Identifier"
      && leftParsed.expression.type !== "MemberExpression"
    ) {
      errors.push({ line: lineNumber, message: "The left side of a script.runtime assignment must be a variable or property path." });
      return null;
    }
    if (leftParsed.expression && !isValidScriptRuntimeAssignmentTarget(leftParsed.expression)) {
      errors.push({ line: lineNumber, message: "script.runtime assignments must be rooted at a variable, `self`, or `scene`." });
      return null;
    }
    return leftParsed.expression && rightParsed.expression
      ? {
        type: "AssignmentStatement",
        target: leftParsed.expression,
        value: rightParsed.expression,
        line: lineNumber,
      }
      : null;
  }
  const parsed = parseScriptRuntimeExpression(trimmed, lineNumber);
  errors.push(...parsed.errors);
  return parsed.expression
    ? { type: "ExpressionStatement", expression: parsed.expression, line: lineNumber }
    : null;
}

function parseScriptRuntimeIfHead(text = "", lineNumber = 0) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("if")) {
    return {
      test: null,
      remainder: "",
      errors: [{ line: lineNumber, message: "Expected an `if (...)` statement in script.runtime code." }],
    };
  }
  let index = 2;
  while (index < trimmed.length && /\s/.test(trimmed[index])) {
    index += 1;
  }
  if (trimmed[index] !== "(") {
    return {
      test: null,
      remainder: "",
      errors: [{ line: lineNumber, message: "Expected `(` after `if` in script.runtime code." }],
    };
  }
  let depth = 0;
  let quote = "";
  let closingIndex = -1;
  for (let cursor = index; cursor < trimmed.length; cursor += 1) {
    const char = trimmed[cursor];
    if (quote) {
      if (char === "\\") {
        cursor += 1;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        closingIndex = cursor;
        break;
      }
    }
  }
  if (closingIndex < 0) {
    return {
      test: null,
      remainder: "",
      errors: [{ line: lineNumber, message: "Missing closing `)` in script.runtime `if` statement." }],
    };
  }
  const parsed = parseScriptRuntimeExpression(trimmed.slice(index + 1, closingIndex), lineNumber);
  return {
    test: parsed.expression,
    remainder: trimmed.slice(closingIndex + 1).trim(),
    errors: parsed.errors,
  };
}

function parseScriptRuntimeProgram(programLines = []) {
  const normalizedLines = (Array.isArray(programLines) ? programLines : [])
    .map((entry) => ({
      line: String(entry?.line ?? "").trim(),
      lineNumber: Number(entry?.lineNumber ?? 0) || 0,
    }))
    .filter((entry) => entry.line);
  const errors = [];
  let index = 0;

  const parseInlineOrBlockStatement = (text = "", lineNumber = 0) => {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed === "{") {
      return parseBlock(true);
    }
    if (isScriptRuntimeIfStatementText(trimmed)) {
      return parseIfStatement(trimmed, lineNumber);
    }
    if (trimmed === "}") {
      errors.push({ line: lineNumber, message: "Unexpected `}` in script.runtime code." });
      return null;
    }
    return parseScriptRuntimeStatementFromText(trimmed, lineNumber, errors);
  };

  const parseIfStatement = (text = "", lineNumber = 0) => {
    const parsedHead = parseScriptRuntimeIfHead(text, lineNumber);
    errors.push(...parsedHead.errors);
    if (!parsedHead.test) {
      return null;
    }
    if (parsedHead.remainder === "{") {
      return {
        type: "IfStatement",
        test: parsedHead.test,
        consequent: parseBlock(true),
        alternate: null,
        line: lineNumber,
      };
    }
    if (parsedHead.remainder) {
      return {
        type: "IfStatement",
        test: parsedHead.test,
        consequent: parseInlineOrBlockStatement(parsedHead.remainder, lineNumber),
        alternate: null,
        line: lineNumber,
      };
    }
    if (index >= normalizedLines.length) {
      errors.push({ line: lineNumber, message: "Missing consequent statement after `if (...)` in script.runtime code." });
      return null;
    }
    const nextEntry = normalizedLines[index];
    index += 1;
    return {
      type: "IfStatement",
      test: parsedHead.test,
      consequent: parseInlineOrBlockStatement(nextEntry.line, nextEntry.lineNumber),
      alternate: null,
      line: lineNumber,
    };
  };

  const parseNextStatement = () => {
    if (index >= normalizedLines.length) {
      return null;
    }
    const entry = normalizedLines[index];
    index += 1;
    if (entry.line === "}") {
      return { type: "__close__", line: entry.lineNumber };
    }
    if (entry.line === "{") {
      return parseBlock(true);
    }
    if (isScriptRuntimeIfStatementText(entry.line)) {
      return parseIfStatement(entry.line, entry.lineNumber);
    }
    return parseScriptRuntimeStatementFromText(entry.line, entry.lineNumber, errors);
  };

  const parseBlock = (expectClose = false) => {
    const body = [];
    const blockLine = normalizedLines[Math.max(0, index - 1)]?.lineNumber ?? 0;
    while (index < normalizedLines.length) {
      const statement = parseNextStatement();
      if (!statement) {
        continue;
      }
      if (statement.type === "__close__") {
        if (!expectClose) {
          errors.push({ line: statement.line, message: "Unexpected `}` in script.runtime code." });
          continue;
        }
        return {
          type: "BlockStatement",
          body,
          line: blockLine,
        };
      }
      body.push(statement);
    }
    if (expectClose) {
      errors.push({ line: blockLine, message: "Missing closing `}` in script.runtime block." });
    }
    return {
      type: "BlockStatement",
      body,
      line: blockLine,
    };
  };

  const program = parseBlock(false);
  return {
    program: {
      type: "Program",
      body: program.body ?? [],
      line: 1,
    },
    errors,
  };
}

function buildImplicitPlayerControl(player = {}) {
  const playerId = String(player.id ?? "").trim();
  if (!playerId) {
    return null;
  }
  return {
    target_id: playerId,
    module_kind: "playmode.wasd_jump",
    enabled: player.movement_enabled !== false,
    params: buildDefaultPlayerControlParams(player),
    bindings: buildDefaultPlayerControlBindings(player),
  };
}

function buildImplicitCameraBehaviors(player = {}) {
  const playerId = String(player.id ?? "").trim();
  if (!playerId) {
    return null;
  }
  return {
    overworld_drag_pan: {
      target_id: playerId,
      module_kind: "camera.overworld_drag_pan",
      enabled: String(player.camera_mode ?? "").trim().toLowerCase() === "overworld",
      params: buildDefaultOverworldDragParams(player),
      bindings: {
        drag_button: DEFAULT_DRAG_BUTTON,
      },
    },
    face_mouse_orthogonal: {
      target_id: playerId,
      module_kind: "behavior.face_mouse_orthogonal",
      enabled: false,
      params: buildDefaultFaceMouseParams(player),
      bindings: {},
    },
  };
}

export function buildImplicitPrivateWorldScriptConfig(sceneDoc = {}) {
  const players = Array.isArray(sceneDoc?.players) ? sceneDoc.players : [];
  const playerControls = {};
  const cameraBehaviors = {};
  for (const player of players) {
    const playerId = String(player?.id ?? "").trim();
    if (!playerId) {
      continue;
    }
    const control = buildImplicitPlayerControl(player);
    if (control) {
      playerControls[playerId] = control;
    }
    const behaviors = buildImplicitCameraBehaviors(player);
    if (behaviors) {
      cameraBehaviors[playerId] = behaviors;
    }
  }
  return {
    world_physics: {
      module_kind: "physics.world",
      target_id: "scene",
      enabled: true,
      params: buildDefaultWorldPhysicsParams(sceneDoc),
      bindings: {},
    },
    player_controls: playerControls,
    camera_behaviors: cameraBehaviors,
    action_metadata: {
      input_tokens: [],
      key_triggers: [],
      directional_force_rule_ids: [],
    },
    runtime_scripts: [],
    modules: [],
  };
}

function getTargetCatalog(options = {}) {
  if (options.targetCatalog instanceof Map) {
    return options.targetCatalog;
  }
  return buildPrivateWorldScriptTargetCatalog(options.sceneDoc ?? {});
}

function parseScriptFunctionDirectives(entry = {}, index = 0, options = {}) {
  const aliasMap = options.entityAliases instanceof Map ? options.entityAliases : new Map();
  const targetCatalog = getTargetCatalog(options);
  const normalizedEntry = normalizeScriptFunctionEntry(entry, index);
  const rawLines = String(normalizedEntry.body ?? "").replace(/\r\n/g, "\n").split("\n");
  const comments = [];
  const nonDirectiveLines = [];
  const directives = [];
  const errors = [];
  let moduleKind = "";
  let targetId = "";
  let targetScope = "";
  let targetKind = "";
  let targetRawValue = "";
  let targetLineNumber = 0;
  let enabled = null;
  const params = {};
  const bindings = {};

  for (const [lineIndex, rawLine] of rawLines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
      comments.push(rawLine);
      continue;
    }
    if (!trimmed.startsWith("@")) {
      nonDirectiveLines.push({
        line: rawLine,
        lineNumber: lineIndex + 1,
      });
      continue;
    }
    const directiveTokens = tokenizeDslSegment(trimmed.slice(1));
    const directive = String(directiveTokens.shift() ?? "").trim().toLowerCase();
    const name = String(directiveTokens[0] ?? "").trim().toLowerCase();
    const rawValue = directive === "set" || directive === "bind"
      ? String(directiveTokens.slice(1).join(" ") ?? "").trim()
      : String(directiveTokens.join(" ") ?? "").trim();
    const rest = directiveTokens.join(" ").trim();
    directives.push({
      directive,
      name,
      raw_value: rawValue,
      value: rest,
      lineNumber: lineIndex + 1,
    });
    if (directive === "module") {
      const normalizedModuleKind = normalizeModuleKind(rest);
      if (!normalizedModuleKind) {
        errors.push({ line: lineIndex + 1, message: `Unsupported module: ${rest || "(empty)"}` });
        continue;
      }
      moduleKind = normalizedModuleKind;
      continue;
    }
    if (directive === "target") {
      targetRawValue = rest;
      targetLineNumber = lineIndex + 1;
      if (rest.toLowerCase() === "scene") {
        targetId = "scene";
        targetScope = "scene";
        targetKind = "scene";
      } else {
        targetId = resolveEntityAlias(aliasMap, rest);
        const targetDescriptor = targetCatalog.get(targetId) ?? null;
        targetScope = targetDescriptor?.target_scope ?? (targetId ? "entity" : "");
        targetKind = targetDescriptor?.target_kind ?? "";
      }
      if (!targetId) {
        errors.push({ line: lineIndex + 1, message: "Directive `@target` requires an id or `scene`." });
      }
      continue;
    }
    if (directive === "enabled") {
      enabled = parseDirectiveBooleanValue(rest, true);
      continue;
    }
    if (directive === "set") {
      const param = String(directiveTokens.shift() ?? "").trim().toLowerCase();
      const valueText = directiveTokens.join(" ").trim();
      if (!param) {
        errors.push({ line: lineIndex + 1, message: "Directive `@set` requires a parameter name." });
        continue;
      }
      const parsedValue = moduleKind === SCRIPT_RUNTIME_MODULE_KIND
        ? parseScriptRuntimeDirectiveValue(valueText)
        : parseDirectiveValue(param, valueText);
      if ((parsedValue == null && valueText !== "null") || parsedValue === "") {
        errors.push({
          line: lineIndex + 1,
          message: valueText
            ? `Directive \`@set ${param}\` has an invalid value.`
            : `Directive \`@set ${param}\` requires a value.`,
        });
        continue;
      }
      params[param] = parsedValue;
      continue;
    }
    if (directive === "bind") {
      const binding = String(directiveTokens.shift() ?? "").trim().toLowerCase();
      const valueText = directiveTokens.join(" ").trim();
      const normalizedBinding = normalizePrivateInputToken(valueText);
      if (!binding) {
        errors.push({ line: lineIndex + 1, message: "Directive `@bind` requires a binding name." });
        continue;
      }
      if (!normalizedBinding) {
        errors.push({ line: lineIndex + 1, message: `Directive \`@bind ${binding}\` requires an input token.` });
        continue;
      }
      bindings[binding] = normalizedBinding;
      continue;
    }
    errors.push({ line: lineIndex + 1, message: `Unsupported directive: @${directive}` });
  }

  if (moduleKind) {
    const moduleDefinition = getModuleDefinition(moduleKind);
    if (moduleDefinition?.scope === "scene") {
      if (!targetScope) {
        targetId = "scene";
        targetScope = "scene";
        targetKind = "scene";
      } else if (targetScope !== "scene") {
        errors.push({ line: targetLineNumber || 1, message: "Module `physics.world` must target `scene`." });
      }
    } else if (moduleDefinition?.scope === "player") {
      if (targetScope !== "entity" || !targetId) {
        errors.push({ line: targetLineNumber || 1, message: `Module \`${moduleKind}\` requires an explicit player target.` });
      } else if (targetCatalog.has(targetId) && targetKind !== "player") {
        errors.push({ line: targetLineNumber || 1, message: `Module \`${moduleKind}\` can only target players.` });
      }
    } else if (moduleDefinition?.scope === "runtime") {
      const allowedTargetScopes = Array.isArray(moduleDefinition.allowed_target_scopes)
        ? moduleDefinition.allowed_target_scopes
        : ["scene", "entity"];
      if (!targetScope || !targetId) {
        errors.push({ line: targetLineNumber || 1, message: `Module \`${moduleKind}\` requires an explicit scene or entity target.` });
      } else if (!allowedTargetScopes.includes(targetScope)) {
        errors.push({ line: targetLineNumber || 1, message: `Module \`${moduleKind}\` cannot target ${targetScope}.` });
      }
    }
  }

  if (moduleKind) {
    const definition = getModuleDefinition(moduleKind);
    for (const directive of directives) {
      if (directive.directive === "set") {
        if (definition?.allow_custom_params === true) {
          if (!isValidScriptRuntimeIdentifier(directive.name)) {
            errors.push({ line: directive.lineNumber, message: `Script constant \`${directive.name || "(empty)"}\` must be a valid identifier.` });
            continue;
          }
          if (SCRIPT_RUNTIME_RESERVED_IDENTIFIERS.has(directive.name)) {
            errors.push({ line: directive.lineNumber, message: `Script constant \`${directive.name}\` is reserved by script.runtime.` });
          }
          continue;
        }
        const paramDefinition = getModuleParamDefinition(moduleKind, directive.name);
        if (!paramDefinition) {
          errors.push({ line: directive.lineNumber, message: `Parameter \`${directive.name || "(empty)"}\` is not supported by module \`${moduleKind}\`.` });
          continue;
        }
        const rawValue = String(directive.raw_value ?? "").trim();
        if (paramDefinition.type === "boolean") {
          const normalized = rawValue.toLowerCase();
          if (!["true", "false", "yes", "no", "on", "off", "1", "0"].includes(normalized)) {
            errors.push({ line: directive.lineNumber, message: `Parameter \`${directive.name}\` expects true or false.` });
          }
        } else if (paramDefinition.type === "enum") {
          const normalized = normalizeEnumToken(rawValue);
          if (!paramDefinition.values.includes(normalized)) {
            errors.push({ line: directive.lineNumber, message: `Parameter \`${directive.name}\` must be one of: ${paramDefinition.values.join(", ")}.` });
          }
        } else if (paramDefinition.type === "number" || paramDefinition.type === "integer") {
          const numericValue = Number(rawValue);
          if (!Number.isFinite(numericValue)) {
            errors.push({ line: directive.lineNumber, message: `Parameter \`${directive.name}\` expects a numeric value.` });
          } else if (
            (Number.isFinite(paramDefinition.min) && numericValue < paramDefinition.min)
            || (Number.isFinite(paramDefinition.max) && numericValue > paramDefinition.max)
          ) {
            errors.push({
              line: directive.lineNumber,
              message: `Parameter \`${directive.name}\` must stay between ${paramDefinition.min} and ${paramDefinition.max}.`,
            });
          }
        } else if (paramDefinition.type === "vector3") {
          const vector = parseDirectiveVectorValue(rawValue);
          if (!vector) {
            errors.push({ line: directive.lineNumber, message: `Parameter \`${directive.name}\` expects a vector like (0,-9.8,0).` });
          }
        }
      } else if (directive.directive === "bind") {
        const bindingDefinition = getModuleBindingDefinition(moduleKind, directive.name);
        if (!bindingDefinition) {
          errors.push({ line: directive.lineNumber, message: `Binding \`${directive.name || "(empty)"}\` is not supported by module \`${moduleKind}\`.` });
        }
      }
    }
  }

  if (moduleKind && targetScope === "entity" && targetId && !targetCatalog.has(targetId)) {
    errors.push({
      line: targetLineNumber || 1,
      message: `Target \`${targetRawValue || targetId}\` no longer exists in this scene.`,
    });
  }

  const programLines = moduleKind === SCRIPT_RUNTIME_MODULE_KIND ? nonDirectiveLines : [];
  const ruleLines = moduleKind === SCRIPT_RUNTIME_MODULE_KIND ? [] : nonDirectiveLines;
  let programAst = null;
  if (moduleKind === SCRIPT_RUNTIME_MODULE_KIND) {
    const parsedProgram = parseScriptRuntimeProgram(programLines);
    programAst = parsedProgram.program;
    errors.push(...(parsedProgram.errors ?? []));
  }

  return {
    ...normalizedEntry,
    module_kind: moduleKind,
    target_id: targetId || null,
    target_scope: targetScope || null,
    target_kind: targetKind || null,
    enabled,
    params,
    bindings,
    directives,
    comments,
    ruleLines,
    programLines,
    programSource: programLines.map((line) => line.line).join("\n").trim(),
    programAst,
    errors,
  };
}

function compileRuleLine(line = "", index = 0, options = {}) {
  const aliasMap = options.entityAliases instanceof Map ? options.entityAliases : new Map();
  const functionEntry = options.functionEntry ?? null;
  const buildRuleError = (message = "") => ({
    line: Number(options.lineNumber ?? index + 1) || (index + 1),
    message,
    function_id: functionEntry?.id ?? null,
    function_name: functionEntry?.name ?? null,
  });
  const [rawTrigger, rawAction] = String(line ?? "").split(/\s*->\s*/);
  if (!rawTrigger || !rawAction) {
    return {
      rule: null,
      errors: [buildRuleError("Expected `trigger -> action`")],
    };
  }
  const triggerTokens = tokenizeDslSegment(rawTrigger);
  const actionTokens = tokenizeDslSegment(rawAction);
  const trigger = String(triggerTokens.shift() ?? "").trim().toLowerCase();
  const action = String(actionTokens.shift() ?? "").trim().toLowerCase();
  if (!ALLOWED_RULE_TRIGGERS.has(trigger)) {
    return {
      rule: null,
      errors: [buildRuleError(`Unsupported trigger: ${trigger || "(empty)"}`)],
    };
  }
  if (!ALLOWED_RULE_ACTIONS.has(action)) {
    return {
      rule: null,
      errors: [buildRuleError(`Unsupported action: ${action || "(empty)"}`)],
    };
  }

  const rule = {
    id: `rule_dsl_${index + 1}`,
    trigger,
    action,
    source_line_number: Number(options.lineNumber ?? index + 1) || (index + 1),
    source_id: null,
    target_id: null,
    key: null,
    key_binding_ref: null,
    delay_ms: 0,
    payload: {},
    function_id: functionEntry?.id ?? null,
    function_name: functionEntry?.name ?? null,
  };

  for (let tokenIndex = 0; tokenIndex < triggerTokens.length; tokenIndex += 1) {
    const token = triggerTokens[tokenIndex];
    const next = triggerTokens[tokenIndex + 1];
    if (token === "from" && next) {
      rule.source_id = resolveEntityAlias(aliasMap, next);
      tokenIndex += 1;
    } else if (token === "key" && next) {
      const bindingRef = String(next ?? "").trim().toLowerCase();
      if (PRIVATE_WORLD_BINDING_DEFINITION_MAP.has(bindingRef)) {
        rule.key = bindingRef;
        rule.key_binding_ref = bindingRef;
      } else {
        rule.key = normalizePrivateInputToken(next);
      }
      tokenIndex += 1;
    } else if (token === "after" && next) {
      const match = String(next).match(/^([-0-9.]+)(ms|s)?$/i);
      if (match) {
        const value = Number(match[1]);
        const unit = String(match[2] ?? "ms").toLowerCase();
        rule.delay_ms = clampInteger(unit === "s" ? value * 1000 : value, 0, 0, 600000);
        tokenIndex += 1;
      }
    }
  }

  const freeTextTokens = [];
  for (let tokenIndex = 0; tokenIndex < actionTokens.length; tokenIndex += 1) {
    const token = actionTokens[tokenIndex];
    const next = actionTokens[tokenIndex + 1];
    const vector = parseDslVector(token);
    if (vector?.kind === "force") {
      rule.payload.force = vector.value;
      continue;
    }
    if (vector?.kind === "position") {
      rule.payload.position = vector.value;
      continue;
    }
    if (vector?.kind === "delta" || vector?.kind === "offset" || vector?.kind === "path") {
      rule.payload.motion_delta = vector.value;
      continue;
    }
    if (token === "to" && next) {
      rule.target_id = resolveEntityAlias(aliasMap, next);
      tokenIndex += 1;
    } else if (token === "scene" && next) {
      rule.payload.scene_id = next;
      tokenIndex += 1;
    } else if (token === "target" && next) {
      rule.payload.target_id = resolveEntityAlias(aliasMap, next);
      tokenIndex += 1;
    } else if (token === "particle" && next) {
      rule.payload.particle_id = resolveEntityAlias(aliasMap, next);
      tokenIndex += 1;
    } else if (token === "text" && next) {
      rule.payload.text_id = resolveEntityAlias(aliasMap, next);
      tokenIndex += 1;
    } else if (token === "value" && next && action !== "set_screen_state") {
      rule.payload.value = next;
      tokenIndex += 1;
    } else if (token === "visible" && next) {
      rule.payload.visible = next === "true";
      tokenIndex += 1;
    } else if (token === "enabled" && next) {
      rule.payload.enabled = next === "true";
      tokenIndex += 1;
    } else if (token === "duration" && next) {
      const match = String(next).match(/^([-0-9.]+)(ms|s)?$/i);
      if (match) {
        const value = Number(match[1]);
        const unit = String(match[2] ?? "ms").toLowerCase();
        rule.payload.duration_ms = clampInteger(unit === "s" ? value * 1000 : value, 3000, 100, 600000);
        tokenIndex += 1;
      }
    } else if ((token === "loop" || token === "mode" || token === "repeat") && next) {
      rule.payload.loop_mode = String(next).trim().toLowerCase();
      tokenIndex += 1;
    } else if ((token === "direction" || token === "dir") && next) {
      const normalizedDirection = String(next).trim().toLowerCase();
      if (normalizedDirection === "facing" || normalizedDirection === "player_facing") {
        rule.payload.force_direction = "player_facing";
        tokenIndex += 1;
      }
    } else if ((token === "strength" || token === "magnitude") && next) {
      const numericValue = Number(next);
      if (Number.isFinite(numericValue)) {
        rule.payload.force_magnitude = numericValue;
        tokenIndex += 1;
      }
    } else if (action === "set_screen_state" && (token === "path" || token === "key" || token === "field") && next) {
      rule.payload.path = String(next).trim();
      tokenIndex += 1;
    } else if (action === "set_screen_state" && token === "value" && next) {
      rule.payload.value = parseDslLiteralValue(next);
      tokenIndex += 1;
    } else if (token === "force" && actionTokens.length >= tokenIndex + 4) {
      rule.payload.force = sanitizeVector3({
        x: Number(actionTokens[tokenIndex + 1]),
        y: Number(actionTokens[tokenIndex + 2]),
        z: Number(actionTokens[tokenIndex + 3]),
      });
      tokenIndex += 3;
    } else if (token === "position" && actionTokens.length >= tokenIndex + 4) {
      rule.payload.position = sanitizeVector3({
        x: Number(actionTokens[tokenIndex + 1]),
        y: Number(actionTokens[tokenIndex + 2]),
        z: Number(actionTokens[tokenIndex + 3]),
      });
      tokenIndex += 3;
    } else {
      freeTextTokens.push(token);
    }
  }

  if (action === "set_text" && !rule.payload.value && freeTextTokens.length > 0) {
    rule.payload.value = freeTextTokens.join(" ").slice(0, 160);
  }
  if (action === "set_screen_state" && rule.payload.value === undefined && freeTextTokens.length > 0) {
    rule.payload.value = parseDslLiteralValue(freeTextTokens.join(" "));
  }

  return {
    rule,
    errors: [],
  };
}

function applyPlayerControlModule(scriptConfig, functionEntry) {
  const playerId = String(functionEntry?.target_id ?? "").trim();
  if (!playerId) {
    return;
  }
  const existing = scriptConfig.player_controls[playerId] ?? buildImplicitPlayerControl({
    id: playerId,
    jump_enabled: false,
    movement_enabled: true,
    scale: PRIVATE_WORLD_BLOCK_UNIT,
  });
  const next = {
    ...existing,
    target_id: playerId,
    module_kind: "playmode.wasd_jump",
    enabled: functionEntry.enabled == null ? existing.enabled : functionEntry.enabled === true,
    params: {
      ...cloneJson(existing.params),
    },
    bindings: {
      ...cloneJson(existing.bindings),
    },
  };
  for (const definition of listModuleParams("playmode.wasd_jump")) {
    if (!Object.hasOwn(functionEntry.params, definition.name)) {
      continue;
    }
    next.params[definition.name] = sanitizeModuleParamValue(
      "playmode.wasd_jump",
      definition.name,
      functionEntry.params[definition.name],
      next.params[definition.name],
    );
  }
  for (const definition of listModuleBindings("playmode.wasd_jump")) {
    if (!Object.hasOwn(functionEntry.bindings, definition.name)) {
      continue;
    }
    next.bindings[definition.name] = sanitizeModuleBindingValue(
      "playmode.wasd_jump",
      definition.name,
      functionEntry.bindings[definition.name],
      next.bindings[definition.name],
    );
  }
  scriptConfig.player_controls[playerId] = next;
}

function ensureCameraBehaviorEntry(scriptConfig, playerId) {
  const existing = scriptConfig.camera_behaviors[playerId] ?? buildImplicitCameraBehaviors({ id: playerId, camera_mode: "" });
  if (!existing) {
    return null;
  }
  const normalized = {
    overworld_drag_pan: cloneJson(existing.overworld_drag_pan),
    face_mouse_orthogonal: cloneJson(existing.face_mouse_orthogonal),
  };
  scriptConfig.camera_behaviors[playerId] = normalized;
  return normalized;
}

function applyCameraBehaviorModule(scriptConfig, functionEntry) {
  const playerId = String(functionEntry?.target_id ?? "").trim();
  if (!playerId) {
    return;
  }
  const behaviors = ensureCameraBehaviorEntry(scriptConfig, playerId);
  if (!behaviors) {
    return;
  }
  if (functionEntry.module_kind === "camera.overworld_drag_pan") {
    const existing = behaviors.overworld_drag_pan ?? {
      target_id: playerId,
      module_kind: "camera.overworld_drag_pan",
      enabled: false,
      params: {
        drag_enabled: true,
        clamp_to_world: true,
      },
      bindings: {
        drag_button: DEFAULT_DRAG_BUTTON,
      },
    };
    const next = {
      ...existing,
      enabled: functionEntry.enabled == null ? existing.enabled : functionEntry.enabled === true,
      params: {
        ...cloneJson(existing.params),
      },
      bindings: {
        ...cloneJson(existing.bindings),
      },
    };
    for (const definition of listModuleParams("camera.overworld_drag_pan")) {
      if (!Object.hasOwn(functionEntry.params, definition.name)) {
        continue;
      }
      next.params[definition.name] = sanitizeModuleParamValue(
        "camera.overworld_drag_pan",
        definition.name,
        functionEntry.params[definition.name],
        next.params[definition.name],
      );
    }
    for (const definition of listModuleBindings("camera.overworld_drag_pan")) {
      if (!Object.hasOwn(functionEntry.bindings, definition.name)) {
        continue;
      }
      next.bindings[definition.name] = sanitizeModuleBindingValue(
        "camera.overworld_drag_pan",
        definition.name,
        functionEntry.bindings[definition.name],
        next.bindings[definition.name],
      );
    }
    behaviors.overworld_drag_pan = next;
    return;
  }
  if (functionEntry.module_kind === "behavior.face_mouse_orthogonal") {
    const existing = behaviors.face_mouse_orthogonal ?? {
      target_id: playerId,
      module_kind: "behavior.face_mouse_orthogonal",
      enabled: false,
      params: {
        enabled: false,
      },
      bindings: {},
    };
    const nextEnabled = functionEntry.enabled == null
      ? (Object.hasOwn(functionEntry.params, "enabled") ? functionEntry.params.enabled === true : existing.enabled)
      : functionEntry.enabled === true;
    const next = {
      ...existing,
      enabled: nextEnabled,
      params: {
        ...cloneJson(existing.params),
        enabled: nextEnabled,
      },
      bindings: {
        ...cloneJson(existing.bindings),
      },
    };
    for (const definition of listModuleParams("behavior.face_mouse_orthogonal")) {
      if (!Object.hasOwn(functionEntry.params, definition.name)) {
        continue;
      }
      next.params[definition.name] = sanitizeModuleParamValue(
        "behavior.face_mouse_orthogonal",
        definition.name,
        functionEntry.params[definition.name],
        next.params[definition.name],
      );
    }
    next.params.enabled = next.enabled;
    behaviors.face_mouse_orthogonal = next;
  }
}

function applyWorldPhysicsModule(scriptConfig, functionEntry) {
  const existing = scriptConfig.world_physics ?? buildImplicitPrivateWorldScriptConfig({}).world_physics;
  const next = {
    ...existing,
    enabled: functionEntry.enabled == null ? existing.enabled : functionEntry.enabled === true,
    params: {
      ...cloneJson(existing.params),
    },
    bindings: {
      ...cloneJson(existing.bindings),
    },
  };
  for (const definition of listModuleParams("physics.world")) {
    if (!Object.hasOwn(functionEntry.params, definition.name)) {
      continue;
    }
    next.params[definition.name] = sanitizeModuleParamValue(
      "physics.world",
      definition.name,
      functionEntry.params[definition.name],
      next.params[definition.name],
    );
  }
  scriptConfig.world_physics = next;
}

function collectActionMetadata(rules = [], scriptConfig = null) {
  const inputTokens = new Set();
  const keyTriggers = [];
  const directionalForceRuleIds = [];
  for (const rule of rules) {
    if (rule?.trigger === "key_press" && rule?.key) {
      const normalizedKey = rule.key_binding_ref
        ? String(rule.key_binding_ref).trim().toLowerCase()
        : normalizePrivateInputToken(rule.key);
      if (normalizedKey && !rule.key_binding_ref) {
        inputTokens.add(normalizedKey);
      }
      keyTriggers.push({
        rule_id: rule.id,
        function_id: rule.function_id ?? null,
        key: normalizedKey,
        key_binding_ref: rule.key_binding_ref ?? null,
        action: rule.action,
        target_id: rule.target_id ?? null,
      });
    }
    if (rule?.action === "apply_force" && rule?.payload?.force_direction === "player_facing") {
      directionalForceRuleIds.push(rule.id);
    }
  }
  if (scriptConfig?.player_controls) {
    for (const entry of Object.values(scriptConfig.player_controls)) {
      for (const value of Object.values(entry?.bindings ?? {})) {
        const normalized = normalizePrivateInputToken(value);
        if (normalized) {
          inputTokens.add(normalized);
        }
      }
    }
  }
  if (scriptConfig?.camera_behaviors) {
    for (const behaviors of Object.values(scriptConfig.camera_behaviors)) {
      for (const behavior of Object.values(behaviors ?? {})) {
        for (const value of Object.values(behavior?.bindings ?? {})) {
          const normalized = normalizePrivateInputToken(value);
          if (normalized) {
            inputTokens.add(normalized);
          }
        }
      }
    }
  }
  return {
    input_tokens: Array.from(inputTokens).filter(Boolean),
    key_triggers: keyTriggers,
    directional_force_rule_ids: directionalForceRuleIds,
  };
}

function buildScriptConfigModules(functions = []) {
  return functions
    .filter((entry) => entry?.module_kind)
    .map((entry) => ({
      function_id: entry.id,
      function_name: entry.name,
      module_kind: entry.module_kind,
      target_id: entry.target_id,
      target_scope: entry.target_scope,
      target_kind: entry.target_kind ?? null,
      enabled: entry.enabled,
      params: cloneJson(entry.params),
      bindings: cloneJson(entry.bindings),
      rule_count: entry.ruleLines.length,
      program_line_count: Array.isArray(entry.programLines) ? entry.programLines.length : 0,
    }));
}

function applyScriptRuntimeModule(scriptConfig, functionEntry) {
  if (!scriptConfig || !functionEntry?.programAst) {
    return;
  }
  scriptConfig.runtime_scripts.push({
    function_id: functionEntry.id,
    function_name: functionEntry.name,
    module_kind: functionEntry.module_kind,
    target_id: functionEntry.target_id,
    target_scope: functionEntry.target_scope,
    target_kind: functionEntry.target_kind ?? null,
    enabled: functionEntry.enabled !== false,
    constants: cloneJson(functionEntry.params),
    program_source: String(functionEntry.programSource ?? "").trim(),
    program_ast: cloneJson(functionEntry.programAst),
    program_line_count: Array.isArray(functionEntry.programLines) ? functionEntry.programLines.length : 0,
  });
}

function buildPrivateWorldScriptConfig(functions = [], rules = [], options = {}) {
  const scriptConfig = buildImplicitPrivateWorldScriptConfig(options.sceneDoc ?? {});
  scriptConfig.modules = buildScriptConfigModules(functions);
  for (const functionEntry of functions) {
    if (!functionEntry?.module_kind || Array.isArray(functionEntry.errors) && functionEntry.errors.length > 0) {
      continue;
    }
    if (functionEntry.module_kind === "playmode.wasd_jump") {
      applyPlayerControlModule(scriptConfig, functionEntry);
      continue;
    }
    if (
      functionEntry.module_kind === "camera.overworld_drag_pan"
      || functionEntry.module_kind === "behavior.face_mouse_orthogonal"
    ) {
      applyCameraBehaviorModule(scriptConfig, functionEntry);
      continue;
    }
    if (functionEntry.module_kind === "physics.world") {
      applyWorldPhysicsModule(scriptConfig, functionEntry);
      continue;
    }
    if (functionEntry.module_kind === SCRIPT_RUNTIME_MODULE_KIND) {
      applyScriptRuntimeModule(scriptConfig, functionEntry);
    }
  }
  scriptConfig.action_metadata = collectActionMetadata(rules, scriptConfig);
  return scriptConfig;
}

export function parsePrivateWorldScriptFunctions(input, options = {}) {
  return parseScriptFunctionLibrary(input).map((entry, index) => parseScriptFunctionDirectives(entry, index, options));
}

export function compilePrivateWorldScriptDsl(input, options = {}) {
  const functions = parsePrivateWorldScriptFunctions(input, options);
  const rules = [];
  const errors = [];
  let ruleIndex = 0;
  for (const functionEntry of functions) {
    errors.push(...(functionEntry.errors ?? []));
    for (const ruleLine of functionEntry.ruleLines ?? []) {
      const compiled = compileRuleLine(ruleLine.line, ruleIndex, {
        entityAliases: options.entityAliases,
        functionEntry,
        lineNumber: ruleLine.lineNumber,
      });
      errors.push(...compiled.errors);
      if (compiled.rule) {
        rules.push(compiled.rule);
        ruleIndex += 1;
      }
    }
  }
  const scriptConfig = buildPrivateWorldScriptConfig(functions, rules, options);
  return {
    rules,
    errors,
    functions,
    script_config: scriptConfig,
  };
}
