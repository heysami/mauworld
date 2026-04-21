import { normalizePrivateInputKey } from "./private-input.mjs";

export const SCRIPT_FUNCTION_HEADER_RE = /^#\s*function(?:\[([a-z0-9_-]+)\])?:\s*(.*)$/i;

const PRIVATE_WORLD_BLOCK_UNIT = 5;
const DEFAULT_PLAYER_MOVE_SPEED = 4.317 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_SPRINT_SPEED = 5.612 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_ACCELERATION = 26;
const DEFAULT_PLAYER_JUMP_HEIGHT = 12.5 * PRIVATE_WORLD_BLOCK_UNIT;
const DEFAULT_PLAYER_JUMP_KEY = "space";
const DEFAULT_PLAYER_SPRINT_KEY = "shift";
const DEFAULT_DRAG_BUTTON = "mouse_left";

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
  "start_scene",
]);

const MODULE_KINDS = new Set([
  "playmode.wasd_jump",
  "camera.overworld_drag_pan",
  "behavior.face_mouse_orthogonal",
  "physics.world",
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
  if (normalizedParam === "gravity") {
    return parseDirectiveVectorValue(rawValue);
  }
  if (normalizedParam === "jump_enabled" || normalizedParam === "drag_enabled" || normalizedParam === "clamp_to_world") {
    return parseDirectiveBooleanValue(rawValue, true);
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

function buildImplicitPlayerControl(player = {}) {
  const playerId = String(player.id ?? "").trim();
  if (!playerId) {
    return null;
  }
  return {
    target_id: playerId,
    module_kind: "playmode.wasd_jump",
    enabled: player.movement_enabled !== false,
    params: {
      move_speed: DEFAULT_PLAYER_MOVE_SPEED,
      sprint_speed: DEFAULT_PLAYER_SPRINT_SPEED,
      acceleration: DEFAULT_PLAYER_ACCELERATION,
      jump_enabled: player.jump_enabled === true,
      jump_height: DEFAULT_PLAYER_JUMP_HEIGHT,
    },
    bindings: {
      jump_key: DEFAULT_PLAYER_JUMP_KEY,
      sprint_key: DEFAULT_PLAYER_SPRINT_KEY,
    },
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
      params: {
        drag_enabled: true,
        clamp_to_world: true,
      },
      bindings: {
        drag_button: DEFAULT_DRAG_BUTTON,
      },
    },
    face_mouse_orthogonal: {
      target_id: playerId,
      module_kind: "behavior.face_mouse_orthogonal",
      enabled: false,
      params: {
        enabled: false,
      },
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
      params: {
        gravity: sanitizeVector3(sceneDoc?.settings?.gravity, { x: 0, y: -9.8, z: 0 }, { min: -40, max: 40 }),
      },
      bindings: {},
    },
    player_controls: playerControls,
    camera_behaviors: cameraBehaviors,
    action_metadata: {
      input_tokens: [],
      key_triggers: [],
      directional_force_rule_ids: [],
    },
    modules: [],
  };
}

function parseScriptFunctionDirectives(entry = {}, index = 0, options = {}) {
  const aliasMap = options.entityAliases instanceof Map ? options.entityAliases : new Map();
  const normalizedEntry = normalizeScriptFunctionEntry(entry, index);
  const rawLines = String(normalizedEntry.body ?? "").replace(/\r\n/g, "\n").split("\n");
  const comments = [];
  const ruleLines = [];
  const directives = [];
  const errors = [];
  let moduleKind = "";
  let targetId = "";
  let targetScope = "";
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
      ruleLines.push({
        line: rawLine,
        lineNumber: lineIndex + 1,
      });
      continue;
    }
    const directiveTokens = tokenizeDslSegment(trimmed.slice(1));
    const directive = String(directiveTokens.shift() ?? "").trim().toLowerCase();
    const rest = directiveTokens.join(" ").trim();
    directives.push({
      directive,
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
      if (rest.toLowerCase() === "scene") {
        targetId = "scene";
        targetScope = "scene";
      } else {
        targetId = resolveEntityAlias(aliasMap, rest);
        targetScope = targetId ? "entity" : "";
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
      const parsedValue = parseDirectiveValue(param, valueText);
      if (parsedValue == null || parsedValue === "") {
        errors.push({ line: lineIndex + 1, message: `Directive \`@set ${param}\` requires a value.` });
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

  if (moduleKind === "physics.world") {
    if (!targetScope) {
      targetId = "scene";
      targetScope = "scene";
    } else if (targetScope !== "scene") {
      errors.push({ line: 1, message: "Module `physics.world` must target `scene`." });
    }
  } else if (moduleKind && targetScope !== "entity") {
    errors.push({ line: 1, message: `Module \`${moduleKind}\` requires an explicit player target.` });
  }

  return {
    ...normalizedEntry,
    module_kind: moduleKind,
    target_id: targetId || null,
    target_scope: targetScope || null,
    enabled,
    params,
    bindings,
    directives,
    comments,
    ruleLines,
    errors,
  };
}

function compileRuleLine(line = "", index = 0, options = {}) {
  const aliasMap = options.entityAliases instanceof Map ? options.entityAliases : new Map();
  const functionEntry = options.functionEntry ?? null;
  const [rawTrigger, rawAction] = String(line ?? "").split(/\s*->\s*/);
  if (!rawTrigger || !rawAction) {
    return {
      rule: null,
      errors: [{ line: index + 1, message: "Expected `trigger -> action`" }],
    };
  }
  const triggerTokens = tokenizeDslSegment(rawTrigger);
  const actionTokens = tokenizeDslSegment(rawAction);
  const trigger = String(triggerTokens.shift() ?? "").trim().toLowerCase();
  const action = String(actionTokens.shift() ?? "").trim().toLowerCase();
  if (!ALLOWED_RULE_TRIGGERS.has(trigger)) {
    return {
      rule: null,
      errors: [{ line: index + 1, message: `Unsupported trigger: ${trigger || "(empty)"}` }],
    };
  }
  if (!ALLOWED_RULE_ACTIONS.has(action)) {
    return {
      rule: null,
      errors: [{ line: index + 1, message: `Unsupported action: ${action || "(empty)"}` }],
    };
  }

  const rule = {
    id: `rule_dsl_${index + 1}`,
    trigger,
    action,
    source_id: null,
    target_id: null,
    key: null,
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
      rule.key = normalizePrivateInputToken(next);
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
    } else if (token === "value" && next) {
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
  const existing = scriptConfig.player_controls[playerId] ?? buildImplicitPlayerControl({ id: playerId, jump_enabled: false, movement_enabled: true });
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
  if (Object.hasOwn(functionEntry.params, "move_speed")) {
    next.params.move_speed = Math.max(0, finiteNumber(functionEntry.params.move_speed, next.params.move_speed));
  }
  if (Object.hasOwn(functionEntry.params, "sprint_speed")) {
    next.params.sprint_speed = Math.max(0, finiteNumber(functionEntry.params.sprint_speed, next.params.sprint_speed));
  }
  if (Object.hasOwn(functionEntry.params, "acceleration")) {
    next.params.acceleration = Math.max(0, finiteNumber(functionEntry.params.acceleration, next.params.acceleration));
  }
  if (Object.hasOwn(functionEntry.params, "jump_enabled")) {
    next.params.jump_enabled = functionEntry.params.jump_enabled === true;
  }
  if (Object.hasOwn(functionEntry.params, "jump_height")) {
    next.params.jump_height = Math.max(0, finiteNumber(functionEntry.params.jump_height, next.params.jump_height));
  }
  if (functionEntry.bindings.jump_key) {
    next.bindings.jump_key = functionEntry.bindings.jump_key;
  }
  if (functionEntry.bindings.sprint_key) {
    next.bindings.sprint_key = functionEntry.bindings.sprint_key;
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
    if (Object.hasOwn(functionEntry.params, "drag_enabled")) {
      next.params.drag_enabled = functionEntry.params.drag_enabled === true;
    }
    if (Object.hasOwn(functionEntry.params, "clamp_to_world")) {
      next.params.clamp_to_world = functionEntry.params.clamp_to_world !== false;
    }
    if (functionEntry.bindings.drag_button) {
      next.bindings.drag_button = functionEntry.bindings.drag_button;
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
    behaviors.face_mouse_orthogonal = {
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
  if (functionEntry.params.gravity) {
    next.params.gravity = sanitizeVector3(functionEntry.params.gravity, next.params.gravity, { min: -40, max: 40 });
  }
  scriptConfig.world_physics = next;
}

function collectActionMetadata(rules = [], scriptConfig = null) {
  const inputTokens = new Set();
  const keyTriggers = [];
  const directionalForceRuleIds = [];
  for (const rule of rules) {
    if (rule?.trigger === "key_press" && rule?.key) {
      const normalizedKey = normalizePrivateInputToken(rule.key);
      if (normalizedKey) {
        inputTokens.add(normalizedKey);
      }
      keyTriggers.push({
        rule_id: rule.id,
        function_id: rule.function_id ?? null,
        key: normalizedKey,
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
      if (entry?.bindings?.jump_key) {
        inputTokens.add(normalizePrivateInputToken(entry.bindings.jump_key));
      }
      if (entry?.bindings?.sprint_key) {
        inputTokens.add(normalizePrivateInputToken(entry.bindings.sprint_key));
      }
    }
  }
  if (scriptConfig?.camera_behaviors) {
    for (const behaviors of Object.values(scriptConfig.camera_behaviors)) {
      if (behaviors?.overworld_drag_pan?.bindings?.drag_button) {
        inputTokens.add(normalizePrivateInputToken(behaviors.overworld_drag_pan.bindings.drag_button));
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
      enabled: entry.enabled,
      params: cloneJson(entry.params),
      bindings: cloneJson(entry.bindings),
      rule_count: entry.ruleLines.length,
    }));
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
