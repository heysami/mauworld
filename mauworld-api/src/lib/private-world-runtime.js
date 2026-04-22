import * as RAPIER from "@dimforge/rapier3d-compat/rapier.es.js";
import { HttpError } from "./http.js";
import { buildSceneEntityAliasMap, normalizeSceneDoc, resolveEntityIdAlias } from "./private-worlds.js";
import { compilePrivateWorldScriptDsl as compileSharedPrivateWorldScriptDsl } from "../../../social/private-script-dsl.mjs";

await RAPIER.init({});

const DEFAULT_TICK_MS = 16;
const DEFAULT_BROADCAST_MS = 33;
const PRIVATE_WORLD_BLOCK_UNIT = 5;
const DEFAULT_PLAYER_ORTHOGONAL_DISTANCE = 28;
const PLAYER_DIMENSIONS = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
};
const PLAYER_MOVE_SPEED = 4.317 * PRIVATE_WORLD_BLOCK_UNIT;
const PLAYER_SPRINT_SPEED = 5.612 * PRIVATE_WORLD_BLOCK_UNIT;
const PLAYER_ACCELERATION = 26;
const PLAYER_JUMP_HEIGHT = 12.5 * PRIVATE_WORLD_BLOCK_UNIT;
const PLAYER_JUMP_VELOCITY = Math.sqrt(Math.abs(-9.8) * 2 * PLAYER_JUMP_HEIGHT);
const PLAYER_JUMP_BUFFER_MS = 160;
const PLAYER_LINEAR_DAMPING = 6.5;
const PLAYER_ANGULAR_DAMPING = 10;
const DYNAMIC_LINEAR_DAMPING = 1.8;
const DYNAMIC_ANGULAR_DAMPING = 3.6;
const DYNAMIC_INTERACTION_LEASE_MS = 220;
const DYNAMIC_INTERACTION_MAX_STATES = 12;
const DYNAMIC_INTERACTION_DISTANCE_BUFFER = PRIVATE_WORLD_BLOCK_UNIT * 1.35;
const CLIENT_REPLICATED_POSE_TTL_MS = 180;
const SCRIPTED_PLATFORM_MIN_DURATION_MS = 100;
const SCRIPTED_PLATFORM_MAX_DURATION_MS = 600000;
const SCRIPTED_PLATFORM_DEFAULT_DURATION_MS = 3000;
const PLATFORM_CARRY_DELTA_EPSILON = 0.0001;
const PLATFORM_CARRY_VERTICAL_TOLERANCE = 0.24;
const PLATFORM_CARRY_HORIZONTAL_BUFFER = 0.14;
const MAX_DELTA_SECONDS = 0.08;
const FLOOR_HALF_EXTENT = 4096;
const SCRIPT_RUNTIME_REF_KEY = "__pw_script_ref";

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function mustFinite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRuntimeScriptConfig(runtime = {}) {
  if (runtime?.scriptConfig) {
    return runtime.scriptConfig;
  }
  const entityAliases = buildSceneEntityAliasMap(runtime?.sourceSceneDoc ?? runtime?.sceneDoc ?? {}, runtime?.sceneDoc ?? {});
  for (const entry of [
    ...(runtime?.sceneDoc?.voxels ?? []),
    ...(runtime?.sceneDoc?.primitives ?? []),
    ...(runtime?.sceneDoc?.panels ?? []),
    ...(runtime?.sceneDoc?.models ?? []),
    ...(runtime?.sceneDoc?.screens ?? []),
    ...(runtime?.sceneDoc?.players ?? []),
    ...(runtime?.sceneDoc?.texts ?? []),
    ...(runtime?.sceneDoc?.trigger_zones ?? []),
    ...(runtime?.sceneDoc?.prefab_instances ?? []),
    ...(runtime?.sceneDoc?.particles ?? []),
  ]) {
    entityAliases.set(entry.id, entry.id);
  }
  const fallback = compileSharedPrivateWorldScriptDsl(runtime?.sceneDoc?.script_dsl ?? "", {
    sceneDoc: runtime?.sceneDoc ?? {},
    entityAliases,
  });
  return fallback.script_config ?? null;
}

function getPlayerControlConfig(runtime = {}, player = {}) {
  const playerId = String(player?.id ?? "").trim();
  if (!playerId) {
    return null;
  }
  return getRuntimeScriptConfig(runtime)?.player_controls?.[playerId] ?? null;
}

function getPlayerCameraBehaviorConfig(runtime = {}, player = {}) {
  const playerId = String(player?.id ?? "").trim();
  if (!playerId) {
    return null;
  }
  return getRuntimeScriptConfig(runtime)?.camera_behaviors?.[playerId] ?? null;
}

function getPlayerBindingToken(runtime = {}, player = {}, bindingName = "", fallback = "") {
  const normalizedBinding = String(bindingName ?? "").trim().toLowerCase();
  if (!normalizedBinding) {
    return String(fallback ?? "").trim().toLowerCase();
  }
  const controlBinding = getPlayerControlConfig(runtime, player)?.bindings?.[normalizedBinding];
  if (controlBinding) {
    return String(controlBinding).trim().toLowerCase();
  }
  const cameraBehaviors = getPlayerCameraBehaviorConfig(runtime, player);
  if (cameraBehaviors?.overworld_drag_pan?.bindings?.[normalizedBinding]) {
    return String(cameraBehaviors.overworld_drag_pan.bindings[normalizedBinding]).trim().toLowerCase();
  }
  if (cameraBehaviors?.face_mouse_orthogonal?.bindings?.[normalizedBinding]) {
    return String(cameraBehaviors.face_mouse_orthogonal.bindings[normalizedBinding]).trim().toLowerCase();
  }
  return String(fallback ?? "").trim().toLowerCase();
}

function getMovementBindingAliases(bindingName = "", resolvedToken = "") {
  const normalizedBinding = String(bindingName ?? "").trim().toLowerCase();
  const normalizedToken = String(resolvedToken ?? "").trim().toLowerCase();
  if (normalizedBinding === "move_forward_key" && normalizedToken === "w") {
    return ["arrowup"];
  }
  if (normalizedBinding === "move_back_key" && normalizedToken === "s") {
    return ["arrowdown"];
  }
  if (normalizedBinding === "move_left_key" && normalizedToken === "a") {
    return ["arrowleft"];
  }
  if (normalizedBinding === "move_right_key" && normalizedToken === "d") {
    return ["arrowright"];
  }
  return [];
}

function isBindingPressed(pressedKeys, bindingName = "", resolvedToken = "") {
  const pressed = pressedKeys instanceof Set ? pressedKeys : new Set();
  const normalizedToken = String(resolvedToken ?? "").trim().toLowerCase();
  if (normalizedToken && pressed.has(normalizedToken)) {
    return true;
  }
  for (const alias of getMovementBindingAliases(bindingName, normalizedToken)) {
    if (pressed.has(alias)) {
      return true;
    }
  }
  return false;
}

function getPlayerMoveSpeed(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.move_speed, PLAYER_MOVE_SPEED));
}

function getPlayerSprintSpeed(runtime = {}, player = {}) {
  return Math.max(getPlayerMoveSpeed(runtime, player), mustFinite(
    getPlayerControlConfig(runtime, player)?.params?.sprint_speed,
    PLAYER_SPRINT_SPEED,
  ));
}

function getPlayerAcceleration(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.acceleration, PLAYER_ACCELERATION));
}

function getPlayerDeceleration(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.deceleration, getPlayerAcceleration(runtime, player)));
}

function getPlayerAirControl(runtime = {}, player = {}) {
  return clampNumber(mustFinite(getPlayerControlConfig(runtime, player)?.params?.air_control, 0.72), 0, 1);
}

function getPlayerJumpHeight(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.jump_height, PLAYER_JUMP_HEIGHT));
}

function getPlayerGravityScale(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.gravity_scale, 1));
}

function getPlayerJumpBufferMs(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.jump_buffer_ms, PLAYER_JUMP_BUFFER_MS));
}

function getPlayerMaxFallSpeed(runtime = {}, player = {}) {
  return Math.max(0, mustFinite(getPlayerControlConfig(runtime, player)?.params?.max_fall_speed, Infinity));
}

function getPlayerJumpVelocity(runtime = {}, player = {}) {
  const gravityMagnitude = Math.abs(mustFinite(runtime?.gravity?.y, -9.8)) * getPlayerGravityScale(runtime, player);
  return Math.sqrt(Math.max(0, gravityMagnitude * 2 * getPlayerJumpHeight(runtime, player)));
}

function getPlayerMoveForwardBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "move_forward_key", "w") || "w";
}

function getPlayerMoveBackBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "move_back_key", "s") || "s";
}

function getPlayerMoveLeftBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "move_left_key", "a") || "a";
}

function getPlayerMoveRightBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "move_right_key", "d") || "d";
}

function getPlayerJumpBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "jump_key", "space") || "space";
}

function getPlayerSprintBinding(runtime = {}, player = {}) {
  return getPlayerBindingToken(runtime, player, "sprint_key", "shift") || "shift";
}

function getHeadingForwardVector(headingY = 0) {
  const resolvedHeadingY = mustFinite(headingY, 0);
  return {
    x: -Math.sin(resolvedHeadingY),
    z: -Math.cos(resolvedHeadingY),
  };
}

function normalizeAngle(angle) {
  let next = mustFinite(angle, 0);
  while (next > Math.PI) {
    next -= Math.PI * 2;
  }
  while (next < -Math.PI) {
    next += Math.PI * 2;
  }
  return next;
}

function vec3(input = {}, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: mustFinite(input.x, fallback.x),
    y: mustFinite(input.y, fallback.y),
    z: mustFinite(input.z, fallback.z),
  };
}

function vectorLength2(x, z) {
  return Math.hypot(x, z);
}

function normalizePlanarVector(x, z) {
  const length = vectorLength2(x, z);
  if (length <= 0.0001) {
    return { x: 0, z: 0 };
  }
  return {
    x: x / length,
    z: z / length,
  };
}

function isPointInsideZone(position, zone) {
  const half = zone.halfExtents;
  return (
    Math.abs(position.x - zone.position.x) <= half.x
    && Math.abs(position.y - zone.position.y) <= half.y
    && Math.abs(position.z - zone.position.z) <= half.z
  );
}

function getBodyHalfExtents(body) {
  if (body.kind === "player") {
    const scale = Math.max(0.25, mustFinite(body.scale, 1));
    return {
      x: (PLAYER_DIMENSIONS.width / 2) * scale,
      y: (PLAYER_DIMENSIONS.height / 2) * scale,
      z: (PLAYER_DIMENSIONS.width / 2) * scale,
    };
  }
  const bodyScale = body.collider_scale ?? body.scale;
  return {
    x: Math.max(0.16, mustFinite(bodyScale?.x, 1) / 2),
    y: Math.max(0.16, mustFinite(bodyScale?.y, 1) / 2),
    z: Math.max(0.16, mustFinite(bodyScale?.z, 1) / 2),
  };
}

function findTargetBody(simulation, targetId) {
  if (!targetId) {
    return null;
  }
  return simulation.players.find((entry) => entry.id === targetId)
    ?? simulation.dynamicObjects.find((entry) => entry.id === targetId)
    ?? null;
}

function findPrefabInstanceTarget(simulation, targetId) {
  if (!targetId) {
    return null;
  }
  return simulation.prefabInstances?.find((entry) => entry.id === targetId) ?? null;
}

function pushRuntimeEvent(simulation, event = {}) {
  simulation.recentEvents.unshift({
    at: nowIso(),
    ...cloneJson(event),
  });
  simulation.recentEvents = simulation.recentEvents.slice(0, 24);
}

function setRuntimeObjectPathValue(target = {}, path = "", value = null) {
  const keys = String(path ?? "")
    .split(".")
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!keys.length || !target || typeof target !== "object") {
    return false;
  }
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = cloneJson(value);
  return true;
}

function sanitizeRuntimeScreenStateValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return String(value).slice(0, 2000);
}

function clearDynamicObjectAuthority(entry) {
  if (!entry) {
    return;
  }
  entry.authority_owner_profile_id = null;
  entry.authority_owner_username = null;
  entry.authority_lease_until_ms = 0;
}

function isDynamicObjectAuthorityActive(entry, nowMs = Date.now()) {
  return Boolean(
    entry?.authority_owner_profile_id
    && Number(entry.authority_lease_until_ms ?? 0) > Number(nowMs ?? Date.now()),
  );
}

function releaseExpiredDynamicAuthorities(runtime, nowMs = Date.now()) {
  for (const entry of runtime?.dynamicObjects ?? []) {
    if (isDynamicObjectAuthorityActive(entry, nowMs)) {
      continue;
    }
    clearDynamicObjectAuthority(entry);
  }
}

function applyDynamicObjectPose(runtime, entry, {
  position = null,
  velocity = null,
  rotation = null,
  angularVelocity = null,
} = {}) {
  if (!runtime || !entry) {
    return null;
  }
  const body = runtime.physics?.objectBodies?.get(entry.id) ?? null;
  const currentPosition = body ? vec3(body.translation(), entry.position) : vec3(entry.position);
  const currentVelocity = body ? vec3(body.linvel(), entry.velocity) : vec3(entry.velocity);
  const currentRotation = body ? quaternionToEuler(body.rotation()) : vec3(entry.rotation);
  const currentAngularVelocity = body ? vec3(body.angvel(), entry.angular_velocity) : vec3(entry.angular_velocity);
  const nextPosition = position == null ? currentPosition : vec3(position, currentPosition);
  const nextVelocity = velocity == null ? currentVelocity : vec3(velocity, currentVelocity);
  const nextRotation = rotation == null ? currentRotation : vec3(rotation, currentRotation);
  const nextAngularVelocity = angularVelocity == null ? currentAngularVelocity : vec3(angularVelocity, currentAngularVelocity);
  entry.position = nextPosition;
  entry.velocity = nextVelocity;
  entry.rotation = nextRotation;
  entry.angular_velocity = nextAngularVelocity;
  entry.sleeping = false;
  if (body) {
    body.setTranslation(nextPosition, true);
    body.setLinvel(nextVelocity, true);
    body.setRotation(toRapierRotation(nextRotation), true);
    if (typeof body.setAngvel === "function") {
      body.setAngvel(nextAngularVelocity, true);
    }
    body.wakeUp?.();
  }
  return {
    position: cloneJson(nextPosition),
    velocity: cloneJson(nextVelocity),
    rotation: cloneJson(nextRotation),
    angular_velocity: cloneJson(nextAngularVelocity),
  };
}

function parseRuleSceneTarget(rule = {}) {
  const payloadSceneId = String(rule.payload?.scene_id ?? rule.payload?.sceneId ?? "").trim();
  if (payloadSceneId) {
    return payloadSceneId;
  }
  return String(rule.target_id ?? "").trim() || null;
}

function toRapierVector(input = {}) {
  return {
    x: mustFinite(input.x, 0),
    y: mustFinite(input.y, 0),
    z: mustFinite(input.z, 0),
  };
}

function eulerToQuaternion(input = {}) {
  const x = mustFinite(input.x, 0);
  const y = mustFinite(input.y, 0);
  const z = mustFinite(input.z, 0);
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function toRapierRotation(input = {}) {
  const quaternion = eulerToQuaternion(input);
  return new RAPIER.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

function quaternionToEuler(input = {}) {
  const x = mustFinite(input.x, 0);
  const y = mustFinite(input.y, 0);
  const z = mustFinite(input.z, 0);
  const w = mustFinite(input.w, 1);
  const sqx = x * x;
  const sqy = y * y;
  const sqz = z * z;
  const sqw = w * w;

  const rotationX = Math.atan2(2 * (x * w - y * z), (sqw - sqx - sqy + sqz));
  const rotationY = Math.asin(clampNumber(2 * (x * z + y * w), -1, 1));
  const rotationZ = Math.atan2(2 * (z * w - x * y), (sqw + sqx - sqy - sqz));

  return {
    x: Number(rotationX.toFixed(6)),
    y: Number(rotationY.toFixed(6)),
    z: Number(rotationZ.toFixed(6)),
  };
}

function buildSceneRules(sceneRow = {}, sceneDoc = {}) {
  const compiledRuntime = sceneRow?.compiled_doc?.runtime ?? {};
  if (Array.isArray(compiledRuntime.rules) && compiledRuntime.rules.length > 0) {
    return cloneJson(compiledRuntime.rules);
  }
  if (Array.isArray(compiledRuntime.dsl_rules) && compiledRuntime.dsl_rules.length > 0) {
    return cloneJson(compiledRuntime.dsl_rules);
  }
  return cloneJson(sceneDoc.rules ?? []);
}

function buildPrimitiveColliderDesc(entry = {}) {
  const half = getBodyHalfExtents({ kind: "dynamic_object", scale: entry.scale });
  if (entry.shape === "sphere") {
    return RAPIER.ColliderDesc.ball(Math.max(0.08, Math.max(half.x, half.y, half.z)));
  }
  if (entry.shape === "cylinder") {
    return RAPIER.ColliderDesc.cylinder(Math.max(0.08, half.y), Math.max(0.08, Math.max(half.x, half.z)));
  }
  if (entry.shape === "cone") {
    return RAPIER.ColliderDesc.cone(Math.max(0.08, half.y), Math.max(0.08, Math.max(half.x, half.z)));
  }
  if (entry.shape === "plane") {
    return RAPIER.ColliderDesc.cuboid(Math.max(0.1, half.x), 0.05, Math.max(0.1, half.z));
  }
  return RAPIER.ColliderDesc.cuboid(Math.max(0.1, half.x), Math.max(0.1, half.y), Math.max(0.1, half.z));
}

function buildPlayerColliderDesc(entry = {}) {
  const half = getBodyHalfExtents({ kind: "player", scale: entry.scale });
  const radius = Math.max(0.18, Math.min(half.x, half.z));
  const halfHeight = Math.max(0.1, half.y - radius);
  return RAPIER.ColliderDesc.capsule(halfHeight, radius);
}

function destroyPhysicsState(physics = null) {
  if (!physics) {
    return;
  }
  try {
    physics.eventQueue?.free?.();
  } catch (_error) {
    // ignore
  }
  try {
    physics.world?.free?.();
  } catch (_error) {
    // ignore
  }
}

function createPrimitiveBody(runtime, entry) {
  const gravityScale = entry.physics?.ignore_gravity === true
    ? 0
    : mustFinite(entry.physics?.gravity_scale, entry.rigid_mode === "ghost" ? 0 : 1);
  const friction = clampNumber(mustFinite(entry.physics?.friction, 0.7), 0, 5);
  const restitution = clampNumber(mustFinite(entry.physics?.restitution, 0.18), 0, 1.25);
  const mass = Math.max(0.05, mustFinite(entry.physics?.mass, 1));
  const desc = (entry.rigid_mode === "ghost" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
    .setTranslation(entry.position.x, entry.position.y, entry.position.z)
    .setRotation(toRapierRotation(entry.rotation))
    .setGravityScale(gravityScale)
    .setLinearDamping(DYNAMIC_LINEAR_DAMPING + friction)
    .setAngularDamping(DYNAMIC_ANGULAR_DAMPING)
    .setAdditionalMass(mass)
    .setCanSleep(true)
    .setCcdEnabled(true);
  const body = runtime.physics.world.createRigidBody(desc);
  const colliderDesc = buildPrimitiveColliderDesc(entry)
    .setFriction(friction)
    .setRestitution(restitution)
    .setMass(mass)
    .setSensor(entry.rigid_mode === "ghost");
  const collider = runtime.physics.world.createCollider(colliderDesc, body);
  runtime.physics.objectBodies.set(entry.id, body);
  runtime.physics.objectColliders.set(entry.id, collider);
  return { body, collider };
}

function createPlayerBody(runtime, entry) {
  const gravityScale = entry.body_mode === "ghost" ? 0 : 1;
  const desc = (entry.body_mode === "ghost" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed())
    .setTranslation(entry.position.x, entry.position.y, entry.position.z)
    .setRotation(toRapierRotation(entry.rotation))
    .setGravityScale(gravityScale)
    .setLinearDamping(PLAYER_LINEAR_DAMPING)
    .setAngularDamping(PLAYER_ANGULAR_DAMPING)
    .setCanSleep(false)
    .setCcdEnabled(true)
    .enabledRotations(false, true, false);
  const body = runtime.physics.world.createRigidBody(desc);
  const colliderDesc = buildPlayerColliderDesc(entry)
    .setFriction(0.8)
    .setRestitution(0.04)
    .setSensor(entry.body_mode === "ghost");
  const collider = runtime.physics.world.createCollider(colliderDesc, body);
  runtime.physics.playerBodies.set(entry.id, body);
  runtime.physics.playerColliders.set(entry.id, collider);
  return { body, collider };
}

function initializeRapierRuntime(runtime) {
  const world = new RAPIER.World(toRapierVector(runtime.gravity));
  const physics = {
    world,
    eventQueue: new RAPIER.EventQueue(true),
    playerBodies: new Map(),
    playerColliders: new Map(),
    objectBodies: new Map(),
    objectColliders: new Map(),
    voxelBodies: new Map(),
    voxelColliders: new Map(),
    staticVoxelColliders: new Map(),
  };
  runtime.physics = physics;

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(FLOOR_HALF_EXTENT, 0.05, FLOOR_HALF_EXTENT)
      .setTranslation(0, -0.05, 0)
      .setFriction(1)
      .setRestitution(0),
  );

  for (const voxel of runtime.sceneDoc.voxels ?? []) {
    const half = {
      x: Math.max(0.1, mustFinite(voxel.scale?.x, 1) / 2),
      y: Math.max(0.1, mustFinite(voxel.scale?.y, 1) / 2),
      z: Math.max(0.1, mustFinite(voxel.scale?.z, 1) / 2),
    };
    if (voxel.instance_id) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(voxel.position.x, voxel.position.y, voxel.position.z)
          .setGravityScale(0)
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setFriction(1)
          .setRestitution(0),
        body,
      );
      runtime.physics.voxelBodies.set(voxel.id, body);
      runtime.physics.voxelColliders.set(voxel.id, collider);
      continue;
    }
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(voxel.position.x, voxel.position.y, voxel.position.z)
        .setFriction(1)
        .setRestitution(0),
    );
    runtime.physics.staticVoxelColliders.set(voxel.id, collider);
  }

  for (const primitive of runtime.dynamicObjects) {
    createPrimitiveBody(runtime, primitive);
  }

  for (const player of runtime.players) {
    createPlayerBody(runtime, player);
  }
}

function syncEntryFromRapierBody(entry, body) {
  if (!body) {
    return;
  }
  entry.position = vec3(body.translation(), entry.position);
  entry.rotation = quaternionToEuler(body.rotation());
  entry.velocity = entry.kind === "player" && entry.body_mode === "ghost"
    ? vec3(entry.velocity, entry.velocity)
    : vec3(body.linvel(), entry.velocity);
  if (entry.angular_velocity !== undefined) {
    entry.angular_velocity = vec3(body.angvel(), entry.angular_velocity);
  }
  entry.sleeping = body.isSleeping?.() === true;
}

function collectPreStepBodyState(simulation) {
  const riders = new Map();
  for (const player of simulation.players ?? []) {
    riders.set(player.id, {
      id: player.id,
      kind: "player",
      position: cloneJson(player.position),
      halfExtents: getBodyHalfExtents(player),
    });
  }
  for (const entry of simulation.dynamicObjects ?? []) {
    riders.set(entry.id, {
      id: entry.id,
      kind: "dynamic_object",
      position: cloneJson(entry.position),
      halfExtents: getBodyHalfExtents(entry),
    });
  }
  const platforms = (simulation.dynamicObjects ?? [])
    .filter((entry) => entry.physics?.carry_riders === true)
    .map((entry) => ({
      id: entry.id,
      position: cloneJson(entry.position),
      halfExtents: getBodyHalfExtents(entry),
    }));
  return { riders, platforms };
}

function wasRiderStandingOnPlatform(riderState, platformState) {
  if (!riderState || !platformState || riderState.id === platformState.id) {
    return false;
  }
  const verticalGap = getRiderPlatformVerticalGap(riderState, platformState);
  const verticalTolerance = getPlatformCarryVerticalTolerance(riderState, platformState);
  if (verticalGap < -verticalTolerance || verticalGap > verticalTolerance) {
    return false;
  }
  const limitX = mustFinite(platformState.halfExtents?.x, 0) + mustFinite(riderState.halfExtents?.x, 0) + PLATFORM_CARRY_HORIZONTAL_BUFFER;
  const limitZ = mustFinite(platformState.halfExtents?.z, 0) + mustFinite(riderState.halfExtents?.z, 0) + PLATFORM_CARRY_HORIZONTAL_BUFFER;
  return (
    Math.abs(mustFinite(riderState.position?.x, 0) - mustFinite(platformState.position?.x, 0)) <= limitX
    && Math.abs(mustFinite(riderState.position?.z, 0) - mustFinite(platformState.position?.z, 0)) <= limitZ
  );
}

function getRiderPlatformVerticalGap(riderState, platformState) {
  const riderBottom = mustFinite(riderState.position?.y, 0) - mustFinite(riderState.halfExtents?.y, 0);
  const platformTop = mustFinite(platformState.position?.y, 0) + mustFinite(platformState.halfExtents?.y, 0);
  return riderBottom - platformTop;
}

function getPlatformCarryVerticalTolerance(riderState, platformState) {
  const riderHalfY = Math.max(0, mustFinite(riderState?.halfExtents?.y, 0));
  const platformHalfY = Math.max(0, mustFinite(platformState?.halfExtents?.y, 0));
  const scaledTolerance = Math.max(
    riderHalfY * 0.28,
    platformHalfY * 0.5,
  );
  return Math.max(
    PLATFORM_CARRY_VERTICAL_TOLERANCE,
    Math.min(PRIVATE_WORLD_BLOCK_UNIT * 0.25, scaledTolerance),
  );
}

function getPlayerDesiredPlanarMovement(runtime, player) {
  const pressed = player?.pressedKeys instanceof Set ? player.pressedKeys : new Set();
  const movementEnabled = isPlayerMovementEnabled(runtime, player);
  const left = isBindingPressed(pressed, "move_left_key", getPlayerMoveLeftBinding(runtime, player));
  const right = isBindingPressed(pressed, "move_right_key", getPlayerMoveRightBinding(runtime, player));
  const forward = isBindingPressed(pressed, "move_forward_key", getPlayerMoveForwardBinding(runtime, player));
  const backward = isBindingPressed(pressed, "move_back_key", getPlayerMoveBackBinding(runtime, player));
  const sprint = movementEnabled && isBindingPressed(pressed, "sprint_key", getPlayerSprintBinding(runtime, player));
  const desired = movementEnabled
    ? (player?.usesLookHeading === true
      ? getRelativePlayerMovement(runtime, player, pressed)
      : normalizePlanarVector(
        Number(right) - Number(left),
        Number(backward) - Number(forward),
      ))
    : { x: 0, z: 0 };
  return {
    desired,
    sprint,
  };
}

function getPlayerAllowedCarryRelativeDelta(runtime, player, deltaSeconds) {
  if (!player) {
    return { x: 0, y: 0, z: 0 };
  }
  const { desired, sprint } = getPlayerDesiredPlanarMovement(runtime, player);
  const speed = sprint ? getPlayerSprintSpeed(runtime, player) : getPlayerMoveSpeed(runtime, player);
  const safeDeltaSeconds = Math.max(0, mustFinite(deltaSeconds, 0));
  return {
    x: desired.x * speed * safeDeltaSeconds,
    y: 0,
    z: desired.z * speed * safeDeltaSeconds,
  };
}

function resolveCarryTargetRelativeDelta(currentRelativeDelta, allowedRelativeDelta) {
  const current = mustFinite(currentRelativeDelta, 0);
  const allowed = mustFinite(allowedRelativeDelta, 0);
  if (Math.abs(allowed) <= PLATFORM_CARRY_DELTA_EPSILON) {
    return 0;
  }
  if (Math.abs(current) <= PLATFORM_CARRY_DELTA_EPSILON) {
    return 0;
  }
  if (Math.sign(current) !== Math.sign(allowed)) {
    return allowed;
  }
  return Math.abs(current) > Math.abs(allowed) ? allowed : current;
}

function translatePlayerByDelta(runtime, player, delta) {
  if (!runtime || !player) {
    return;
  }
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  const currentPosition = body ? vec3(body.translation(), player.position) : vec3(player.position);
  const nextPosition = {
    x: currentPosition.x + mustFinite(delta?.x, 0),
    y: currentPosition.y + mustFinite(delta?.y, 0),
    z: currentPosition.z + mustFinite(delta?.z, 0),
  };
  player.position = nextPosition;
  player.sleeping = false;
  if (!body) {
    return;
  }
  if (player.body_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
    body.setNextKinematicTranslation(nextPosition);
  }
  body.setTranslation(nextPosition, true);
  body.wakeUp?.();
}

function translateDynamicObjectByDelta(runtime, entry, delta) {
  if (!runtime || !entry) {
    return;
  }
  const body = runtime.physics?.objectBodies?.get(entry.id) ?? null;
  const currentPosition = body ? vec3(body.translation(), entry.position) : vec3(entry.position);
  const nextPosition = {
    x: currentPosition.x + mustFinite(delta?.x, 0),
    y: currentPosition.y + mustFinite(delta?.y, 0),
    z: currentPosition.z + mustFinite(delta?.z, 0),
  };
  entry.position = nextPosition;
  entry.sleeping = false;
  if (!body) {
    return;
  }
  if (entry.rigid_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
    body.setNextKinematicTranslation(nextPosition);
  }
  body.setTranslation(nextPosition, true);
  body.wakeUp?.();
}

function applyDynamicObjectGroupMotion(runtime, entry, {
  delta = null,
  velocity = null,
  forceKinematic = false,
  zeroVelocity = false,
} = {}) {
  if (!runtime || !entry) {
    return null;
  }
  const currentPosition = vec3(entry.position);
  const resolvedDelta = vec3(delta, { x: 0, y: 0, z: 0 });
  const nextPosition = {
    x: currentPosition.x + resolvedDelta.x,
    y: currentPosition.y + resolvedDelta.y,
    z: currentPosition.z + resolvedDelta.z,
  };
  const nextVelocity = zeroVelocity
    ? { x: 0, y: 0, z: 0 }
    : vec3(velocity, entry.velocity);
  entry.position = nextPosition;
  entry.velocity = nextVelocity;
  entry.sleeping = false;
  const body = runtime.physics?.objectBodies?.get(entry.id) ?? null;
  if (!body) {
    return {
      position: cloneJson(nextPosition),
      velocity: cloneJson(nextVelocity),
    };
  }
  if (forceKinematic) {
    body.setBodyType?.(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale?.(0, true);
    if (typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(nextPosition);
    }
  }
  body.setTranslation(nextPosition, true);
  body.setLinvel?.(nextVelocity, true);
  body.wakeUp?.();
  return {
    position: cloneJson(nextPosition),
    velocity: cloneJson(nextVelocity),
  };
}

function translateRuntimeVoxelByDelta(runtime, voxelId = "", delta = null) {
  const resolvedVoxelId = String(voxelId ?? "").trim();
  if (!runtime || !resolvedVoxelId) {
    return null;
  }
  const voxel = (runtime.sceneDoc?.voxels ?? []).find((entry) => entry.id === resolvedVoxelId) ?? null;
  if (!voxel) {
    return null;
  }
  const resolvedDelta = vec3(delta, { x: 0, y: 0, z: 0 });
  const nextPosition = {
    x: mustFinite(voxel.position?.x, 0) + resolvedDelta.x,
    y: mustFinite(voxel.position?.y, 0) + resolvedDelta.y,
    z: mustFinite(voxel.position?.z, 0) + resolvedDelta.z,
  };
  voxel.position = nextPosition;
  const staticSolid = runtime.staticSolids?.find((entry) => entry.id === resolvedVoxelId) ?? null;
  if (staticSolid) {
    staticSolid.position = cloneJson(nextPosition);
  }
  const body = runtime.physics?.voxelBodies?.get(resolvedVoxelId) ?? null;
  if (body) {
    if (typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(nextPosition);
    }
    body.setTranslation(nextPosition, true);
    body.wakeUp?.();
    return cloneJson(nextPosition);
  }
  const collider = runtime.physics?.staticVoxelColliders?.get(resolvedVoxelId) ?? null;
  collider?.setTranslation?.(nextPosition);
  return cloneJson(nextPosition);
}

function translateRuntimeTriggerZoneByDelta(runtime, triggerZoneId = "", delta = null) {
  const resolvedZoneId = String(triggerZoneId ?? "").trim();
  if (!runtime || !resolvedZoneId) {
    return null;
  }
  const zone = runtime.triggerZones?.find((entry) => entry.id === resolvedZoneId) ?? null;
  if (!zone) {
    return null;
  }
  const resolvedDelta = vec3(delta, { x: 0, y: 0, z: 0 });
  zone.position = {
    x: mustFinite(zone.position?.x, 0) + resolvedDelta.x,
    y: mustFinite(zone.position?.y, 0) + resolvedDelta.y,
    z: mustFinite(zone.position?.z, 0) + resolvedDelta.z,
  };
  const sceneZone = (runtime.sceneDoc?.trigger_zones ?? []).find((entry) => entry.id === resolvedZoneId) ?? null;
  if (sceneZone) {
    sceneZone.position = cloneJson(zone.position);
  }
  return cloneJson(zone.position);
}

function applyPrefabInstancePose(runtime, prefabInstance, {
  position = null,
  velocity = null,
  zeroVelocity = false,
  forceKinematicDescendants = false,
} = {}) {
  if (!runtime || !prefabInstance) {
    return null;
  }
  const currentPosition = vec3(prefabInstance.position);
  const nextPosition = vec3(position, currentPosition);
  const delta = {
    x: nextPosition.x - currentPosition.x,
    y: nextPosition.y - currentPosition.y,
    z: nextPosition.z - currentPosition.z,
  };
  const nextVelocity = zeroVelocity
    ? { x: 0, y: 0, z: 0 }
    : vec3(velocity, prefabInstance.velocity);
  prefabInstance.position = nextPosition;
  prefabInstance.velocity = nextVelocity;
  const scenePrefabInstance = (runtime.sceneDoc?.prefab_instances ?? []).find((entry) => entry.id === prefabInstance.id) ?? null;
  if (scenePrefabInstance) {
    scenePrefabInstance.position = cloneJson(nextPosition);
  }
  for (const dynamicObjectId of prefabInstance.dynamic_object_ids ?? []) {
    const dynamicObject = runtime.dynamicObjects?.find((entry) => entry.id === dynamicObjectId) ?? null;
    if (!dynamicObject) {
      continue;
    }
    applyDynamicObjectGroupMotion(runtime, dynamicObject, {
      delta,
      velocity: nextVelocity,
      zeroVelocity,
      forceKinematic: forceKinematicDescendants,
    });
  }
  for (const voxelId of prefabInstance.voxel_ids ?? []) {
    translateRuntimeVoxelByDelta(runtime, voxelId, delta);
  }
  for (const triggerZoneId of prefabInstance.trigger_zone_ids ?? []) {
    translateRuntimeTriggerZoneByDelta(runtime, triggerZoneId, delta);
  }
  return {
    position: cloneJson(nextPosition),
    velocity: cloneJson(nextVelocity),
  };
}

function createScriptRuntimeEntityRef(kind = "", id = "") {
  return Object.freeze({
    [SCRIPT_RUNTIME_REF_KEY]: "entity",
    kind: String(kind ?? "").trim(),
    id: String(id ?? "").trim(),
  });
}

function createScriptRuntimeSceneRef() {
  return Object.freeze({
    [SCRIPT_RUNTIME_REF_KEY]: "scene",
    kind: "scene",
    id: "scene",
  });
}

function isScriptRuntimeEntityRef(value) {
  return value?.[SCRIPT_RUNTIME_REF_KEY] === "entity";
}

function isScriptRuntimeSceneRef(value) {
  return value?.[SCRIPT_RUNTIME_REF_KEY] === "scene";
}

function isScriptRuntimeRef(value) {
  return isScriptRuntimeEntityRef(value) || isScriptRuntimeSceneRef(value);
}

function cloneScriptRuntimeValue(value) {
  if (isScriptRuntimeRef(value) || value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneScriptRuntimeValue(entry));
  }
  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneScriptRuntimeValue(entry);
  }
  return clone;
}

function isScriptRuntimeVectorLike(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

function toScriptRuntimeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: mustFinite(value?.x, fallback.x),
    y: mustFinite(value?.y, fallback.y),
    z: mustFinite(value?.z, fallback.z),
  };
}

function scriptRuntimeVectorLength(value) {
  const vector = toScriptRuntimeVector(value);
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeScriptRuntimeEntityKind(kind = "") {
  const normalized = String(kind ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "players") {
    return "player";
  }
  if (normalized === "prefab" || normalized === "prefabinstance") {
    return "prefab_instance";
  }
  if (normalized === "trigger_zone" || normalized === "triggerzone") {
    return "trigger";
  }
  return normalized;
}

function listScriptRuntimeEntityRefs(simulation, kind = "") {
  const normalizedKind = normalizeScriptRuntimeEntityKind(kind);
  const refs = [];
  for (const player of simulation.players ?? []) {
    refs.push(createScriptRuntimeEntityRef("player", player.id));
  }
  for (const entry of simulation.dynamicObjects ?? []) {
    refs.push(createScriptRuntimeEntityRef(entry.entity_kind || "dynamic_object", entry.id));
  }
  for (const entry of simulation.prefabInstances ?? []) {
    refs.push(createScriptRuntimeEntityRef("prefab_instance", entry.id));
  }
  for (const entry of simulation.triggerZones ?? []) {
    refs.push(createScriptRuntimeEntityRef("trigger", entry.id));
  }
  for (const entry of simulation.sceneDoc?.voxels ?? []) {
    refs.push(createScriptRuntimeEntityRef("voxel", entry.id));
  }
  for (const entry of Object.values(simulation.screenState ?? {})) {
    refs.push(createScriptRuntimeEntityRef("screen", entry.id));
  }
  for (const entry of Object.values(simulation.textState ?? {})) {
    refs.push(createScriptRuntimeEntityRef("text", entry.id));
  }
  if (!normalizedKind) {
    return refs;
  }
  return refs.filter((entry) => entry.kind === normalizedKind);
}

function findScriptRuntimeEntityRef(simulation, id = "") {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) {
    return null;
  }
  return listScriptRuntimeEntityRefs(simulation).find((entry) => entry.id === normalizedId) ?? null;
}

function resolveScriptRuntimeEntityTarget(simulation, ref = null) {
  if (!isScriptRuntimeEntityRef(ref)) {
    return null;
  }
  if (ref.kind === "player") {
    return simulation.players?.find((entry) => entry.id === ref.id) ?? null;
  }
  if (ref.kind === "primitive" || ref.kind === "model" || ref.kind === "dynamic_object") {
    return simulation.dynamicObjects?.find((entry) => entry.id === ref.id) ?? null;
  }
  if (ref.kind === "prefab_instance") {
    return findPrefabInstanceTarget(simulation, ref.id);
  }
  if (ref.kind === "trigger") {
    return simulation.triggerZones?.find((entry) => entry.id === ref.id) ?? null;
  }
  if (ref.kind === "voxel") {
    return simulation.sceneDoc?.voxels?.find((entry) => entry.id === ref.id) ?? null;
  }
  if (ref.kind === "screen") {
    return simulation.screenState?.[ref.id] ?? null;
  }
  if (ref.kind === "text") {
    return simulation.textState?.[ref.id] ?? null;
  }
  return null;
}

function resolveScriptRuntimePositionLike(simulation, value) {
  if (isScriptRuntimeEntityRef(value)) {
    const target = resolveScriptRuntimeEntityTarget(simulation, value);
    if (target?.position) {
      return toScriptRuntimeVector(target.position);
    }
    return null;
  }
  if (isScriptRuntimeVectorLike(value)) {
    return toScriptRuntimeVector(value);
  }
  if (value && typeof value === "object" && isScriptRuntimeVectorLike(value.position)) {
    return toScriptRuntimeVector(value.position);
  }
  return null;
}

function readScriptRuntimeEntityProperty(simulation, ref, property = "") {
  const target = resolveScriptRuntimeEntityTarget(simulation, ref);
  if (!target) {
    return null;
  }
  const normalizedProperty = String(property ?? "").trim();
  if (!normalizedProperty) {
    return null;
  }
  if (normalizedProperty === "id") {
    return ref.id;
  }
  if (normalizedProperty === "kind") {
    return ref.kind;
  }
  if (normalizedProperty === "label") {
    return target.label ?? null;
  }
  if (normalizedProperty === "visible" || normalizedProperty === "visibility") {
    if (Object.hasOwn(target, "visibility")) {
      return target.visibility !== false;
    }
    if (Object.hasOwn(target, "visible")) {
      return target.visible !== false;
    }
  }
  if (normalizedProperty === "value" && ref.kind === "text") {
    return String(target.value ?? "");
  }
  if (normalizedProperty === "state" && ref.kind === "screen") {
    return cloneScriptRuntimeValue(target.state ?? {});
  }
  if (normalizedProperty === "assets" && ref.kind === "screen") {
    return cloneScriptRuntimeValue(target.assets ?? {});
  }
  if (normalizedProperty === "material_override") {
    return cloneScriptRuntimeValue(target.material_override ?? null);
  }
  if (normalizedProperty === "material") {
    return cloneScriptRuntimeValue(target.material ?? null);
  }
  if (normalizedProperty === "position" || normalizedProperty === "rotation" || normalizedProperty === "scale" || normalizedProperty === "velocity") {
    return target[normalizedProperty] != null ? cloneScriptRuntimeValue(target[normalizedProperty]) : null;
  }
  if (Object.hasOwn(target, normalizedProperty) && typeof target[normalizedProperty] !== "function") {
    return cloneScriptRuntimeValue(target[normalizedProperty]);
  }
  return null;
}

function readScriptRuntimeSceneProperty(simulation, property = "") {
  const normalizedProperty = String(property ?? "").trim();
  if (!normalizedProperty) {
    return null;
  }
  if (normalizedProperty === "id") {
    return "scene";
  }
  if (normalizedProperty === "kind") {
    return "scene";
  }
  if (normalizedProperty === "gravity") {
    return cloneScriptRuntimeValue(simulation.gravity);
  }
  if (normalizedProperty === "scene_started") {
    return simulation.sceneStarted === true;
  }
  if (normalizedProperty === "status") {
    return simulation.status ?? "active";
  }
  if (normalizedProperty === "elapsed_ms") {
    return mustFinite(simulation.elapsedMs, 0);
  }
  return null;
}

function readScriptRuntimeProperty(simulation, value, property = "") {
  if (isScriptRuntimeEntityRef(value)) {
    return readScriptRuntimeEntityProperty(simulation, value, property);
  }
  if (isScriptRuntimeSceneRef(value)) {
    return readScriptRuntimeSceneProperty(simulation, property);
  }
  if (Array.isArray(value) && property === "length") {
    return value.length;
  }
  if (typeof value === "string" && property === "length") {
    return value.length;
  }
  if (value && typeof value === "object" && Object.hasOwn(value, property)) {
    return cloneScriptRuntimeValue(value[property]);
  }
  return null;
}

function setScriptRuntimePlainObjectPath(target, path = [], value = null) {
  if (!target || typeof target !== "object" || isScriptRuntimeRef(target) || !Array.isArray(path) || !path.length) {
    return false;
  }
  let cursor = target;
  for (const key of path.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key]) || isScriptRuntimeRef(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = cloneScriptRuntimeValue(value);
  return true;
}

function applyScriptRuntimePlayerPosition(simulation, player, nextPosition) {
  const body = simulation.physics?.playerBodies?.get(player.id) ?? null;
  player.position = cloneJson(nextPosition);
  player.velocity = { x: 0, y: 0, z: 0 };
  player.sleeping = false;
  if (!body) {
    return true;
  }
  if (player.body_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
    body.setNextKinematicTranslation(nextPosition);
  }
  body.setTranslation(nextPosition, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.wakeUp?.();
  return true;
}

function applyScriptRuntimePlayerRotation(simulation, player, nextRotation) {
  const body = simulation.physics?.playerBodies?.get(player.id) ?? null;
  player.rotation = cloneJson(nextRotation);
  player.sleeping = false;
  if (!body) {
    return true;
  }
  body.setRotation(toRapierRotation(nextRotation), true);
  body.wakeUp?.();
  return true;
}

function applyScriptRuntimePlayerVelocity(simulation, player, nextVelocity) {
  const body = simulation.physics?.playerBodies?.get(player.id) ?? null;
  player.velocity = cloneJson(nextVelocity);
  player.sleeping = false;
  if (!body) {
    return true;
  }
  body.setLinvel(nextVelocity, true);
  body.wakeUp?.();
  return true;
}

function applyScriptRuntimeScreenPosition(simulation, screenId = "", nextPosition = null) {
  const screenState = simulation.screenState?.[screenId] ?? null;
  if (!screenState) {
    return false;
  }
  screenState.position = cloneJson(nextPosition);
  const sceneScreen = simulation.sceneDoc?.screens?.find((entry) => entry.id === screenId) ?? null;
  if (sceneScreen) {
    sceneScreen.position = cloneJson(nextPosition);
  }
  return true;
}

function setScriptRuntimeEntityPath(simulation, ref, path = [], value = null) {
  if (!Array.isArray(path) || !path.length) {
    throw new Error("Missing property path in script.runtime assignment.");
  }
  const property = path[0];
  const target = resolveScriptRuntimeEntityTarget(simulation, ref);
  if (!target) {
    throw new Error(`Script target \`${ref.id}\` is no longer available.`);
  }
  if (property === "position") {
    const current = toScriptRuntimeVector(target.position);
    if (path.length > 1 && !["x", "y", "z"].includes(path[1])) {
      throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
    }
    const next = path.length === 1
      ? toScriptRuntimeVector(value, current)
      : {
        ...current,
        [path[1]]: mustFinite(value, current[path[1]]),
      };
    if (ref.kind === "player") {
      return applyScriptRuntimePlayerPosition(simulation, target, next);
    }
    if (ref.kind === "primitive" || ref.kind === "model" || ref.kind === "dynamic_object") {
      applyDynamicObjectPose(simulation, target, {
        position: next,
        velocity: { x: 0, y: 0, z: 0 },
      });
      return true;
    }
    if (ref.kind === "prefab_instance") {
      applyPrefabInstancePose(simulation, target, {
        position: next,
        zeroVelocity: true,
      });
      return true;
    }
    if (ref.kind === "trigger") {
      target.position = cloneJson(next);
      const sceneZone = simulation.sceneDoc?.trigger_zones?.find((entry) => entry.id === ref.id) ?? null;
      if (sceneZone) {
        sceneZone.position = cloneJson(next);
      }
      return true;
    }
    if (ref.kind === "voxel") {
      const currentPosition = toScriptRuntimeVector(target.position);
      translateRuntimeVoxelByDelta(simulation, ref.id, {
        x: next.x - currentPosition.x,
        y: next.y - currentPosition.y,
        z: next.z - currentPosition.z,
      });
      return true;
    }
    if (ref.kind === "screen") {
      return applyScriptRuntimeScreenPosition(simulation, ref.id, next);
    }
    throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
  }
  if (property === "rotation") {
    const current = toScriptRuntimeVector(target.rotation);
    if (path.length > 1 && !["x", "y", "z"].includes(path[1])) {
      throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
    }
    const next = path.length === 1
      ? toScriptRuntimeVector(value, current)
      : {
        ...current,
        [path[1]]: mustFinite(value, current[path[1]]),
      };
    if (ref.kind === "player") {
      return applyScriptRuntimePlayerRotation(simulation, target, next);
    }
    if (ref.kind === "primitive" || ref.kind === "model" || ref.kind === "dynamic_object") {
      applyDynamicObjectPose(simulation, target, { rotation: next });
      return true;
    }
    throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
  }
  if (property === "velocity") {
    const current = toScriptRuntimeVector(target.velocity);
    if (path.length > 1 && !["x", "y", "z"].includes(path[1])) {
      throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
    }
    const next = path.length === 1
      ? toScriptRuntimeVector(value, current)
      : {
        ...current,
        [path[1]]: mustFinite(value, current[path[1]]),
      };
    if (ref.kind === "player") {
      return applyScriptRuntimePlayerVelocity(simulation, target, next);
    }
    if (ref.kind === "primitive" || ref.kind === "model" || ref.kind === "dynamic_object") {
      applyDynamicObjectPose(simulation, target, { velocity: next });
      return true;
    }
    throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
  }
  if ((property === "visible" || property === "visibility") && path.length === 1) {
    const nextVisible = value !== false;
    if (ref.kind === "prefab_instance") {
      target.visibility = nextVisible;
      for (const dynamicObjectId of target.dynamic_object_ids ?? []) {
        const dynamicObject = simulation.dynamicObjects?.find((entry) => entry.id === dynamicObjectId) ?? null;
        if (dynamicObject) {
          dynamicObject.visibility = nextVisible;
        }
      }
      return true;
    }
    if (Object.hasOwn(target, "visibility")) {
      target.visibility = nextVisible;
      return true;
    }
    if (Object.hasOwn(target, "visible")) {
      target.visible = nextVisible;
      return true;
    }
  }
  if (property === "value" && ref.kind === "text" && path.length === 1) {
    target.value = String(value ?? "").slice(0, 160);
    return true;
  }
  throw new Error(`Property path \`${path.join(".")}\` is not writable for ${ref.kind}.`);
}

function setScriptRuntimeScenePath(simulation, path = [], value = null) {
  if (!Array.isArray(path) || !path.length) {
    throw new Error("Missing scene property path in script.runtime assignment.");
  }
  if (path[0] !== "gravity") {
    throw new Error(`Scene property \`${path.join(".")}\` is not writable in script.runtime.`);
  }
  const current = toScriptRuntimeVector(simulation.gravity);
  if (path.length > 1 && !["x", "y", "z"].includes(path[1])) {
    throw new Error(`Scene property \`${path.join(".")}\` is not writable in script.runtime.`);
  }
  const next = path.length === 1
    ? toScriptRuntimeVector(value, current)
    : {
      ...current,
      [path[1]]: mustFinite(value, current[path[1]]),
    };
  simulation.gravity = cloneJson(next);
  if (simulation.physics?.world) {
    simulation.physics.world.gravity = toRapierVector(next);
  }
  return true;
}

function unwrapScriptRuntimeReferencePath(reference) {
  const path = [];
  let cursor = reference;
  while (cursor?.type === "member") {
    path.unshift(cursor.property);
    cursor = cursor.object;
  }
  return {
    root: cursor,
    path,
  };
}

function createScriptRuntimeEnvironment({
  constants = {},
  selfRef = null,
  sceneRef = createScriptRuntimeSceneRef(),
  dt = 0,
  time = 0,
  builtins = new Map(),
} = {}) {
  const bindings = new Map();
  const readonly = new Set(["self", "scene", "dt", "time"]);
  for (const [key, value] of Object.entries(constants ?? {})) {
    bindings.set(key, cloneScriptRuntimeValue(value));
    readonly.add(key);
  }
  bindings.set("self", selfRef);
  bindings.set("scene", sceneRef);
  bindings.set("dt", dt);
  bindings.set("time", time);
  return {
    define(name, value) {
      bindings.set(name, cloneScriptRuntimeValue(value));
      return bindings.get(name);
    },
    get(name) {
      if (bindings.has(name)) {
        return bindings.get(name);
      }
      if (builtins.has(name)) {
        return builtins.get(name);
      }
      return undefined;
    },
    has(name) {
      return bindings.has(name) || builtins.has(name);
    },
    set(name, value) {
      if (!bindings.has(name)) {
        return false;
      }
      if (readonly.has(name)) {
        throw new Error(`\`${name}\` is read-only in script.runtime.`);
      }
      bindings.set(name, cloneScriptRuntimeValue(value));
      return true;
    },
  };
}

function scriptRuntimeTruthy(value) {
  return Boolean(value);
}

function scriptRuntimeVectorsEqual(left, right) {
  const leftVector = toScriptRuntimeVector(left);
  const rightVector = toScriptRuntimeVector(right);
  return (
    Math.abs(leftVector.x - rightVector.x) <= 0.0001
    && Math.abs(leftVector.y - rightVector.y) <= 0.0001
    && Math.abs(leftVector.z - rightVector.z) <= 0.0001
  );
}

function applyScriptRuntimeBinaryOperator(operator = "", left, right) {
  if (operator === "==" || operator === "!=") {
    const equal = isScriptRuntimeRef(left) && isScriptRuntimeRef(right)
      ? left.kind === right.kind && left.id === right.id
      : isScriptRuntimeVectorLike(left) && isScriptRuntimeVectorLike(right)
        ? scriptRuntimeVectorsEqual(left, right)
        : left === right;
    return operator === "==" ? equal : !equal;
  }
  if (["<", ">", "<=", ">="].includes(operator)) {
    if (operator === "<") {
      return left < right;
    }
    if (operator === ">") {
      return left > right;
    }
    if (operator === "<=") {
      return left <= right;
    }
    return left >= right;
  }
  if (!isScriptRuntimeVectorLike(left) && !isScriptRuntimeVectorLike(right)) {
    if (operator === "+") {
      return typeof left === "string" || typeof right === "string"
        ? `${left ?? ""}${right ?? ""}`
        : mustFinite(left, 0) + mustFinite(right, 0);
    }
    if (operator === "-") {
      return mustFinite(left, 0) - mustFinite(right, 0);
    }
    if (operator === "*") {
      return mustFinite(left, 0) * mustFinite(right, 0);
    }
    if (operator === "/") {
      const denominator = mustFinite(right, 0);
      return Math.abs(denominator) <= 0.000001 ? 0 : mustFinite(left, 0) / denominator;
    }
  }
  const leftVector = isScriptRuntimeVectorLike(left) ? toScriptRuntimeVector(left) : null;
  const rightVector = isScriptRuntimeVectorLike(right) ? toScriptRuntimeVector(right) : null;
  const leftScalar = leftVector ? null : mustFinite(left, 0);
  const rightScalar = rightVector ? null : mustFinite(right, 0);
  if (operator === "+") {
    if (leftVector && rightVector) {
      return {
        x: leftVector.x + rightVector.x,
        y: leftVector.y + rightVector.y,
        z: leftVector.z + rightVector.z,
      };
    }
    if (leftVector) {
      return {
        x: leftVector.x + rightScalar,
        y: leftVector.y + rightScalar,
        z: leftVector.z + rightScalar,
      };
    }
    if (rightVector) {
      return {
        x: leftScalar + rightVector.x,
        y: leftScalar + rightVector.y,
        z: leftScalar + rightVector.z,
      };
    }
  }
  if (operator === "-") {
    if (leftVector && rightVector) {
      return {
        x: leftVector.x - rightVector.x,
        y: leftVector.y - rightVector.y,
        z: leftVector.z - rightVector.z,
      };
    }
    if (leftVector) {
      return {
        x: leftVector.x - rightScalar,
        y: leftVector.y - rightScalar,
        z: leftVector.z - rightScalar,
      };
    }
    if (rightVector) {
      return {
        x: leftScalar - rightVector.x,
        y: leftScalar - rightVector.y,
        z: leftScalar - rightVector.z,
      };
    }
  }
  if (operator === "*") {
    if (leftVector && rightVector) {
      return {
        x: leftVector.x * rightVector.x,
        y: leftVector.y * rightVector.y,
        z: leftVector.z * rightVector.z,
      };
    }
    if (leftVector) {
      return {
        x: leftVector.x * rightScalar,
        y: leftVector.y * rightScalar,
        z: leftVector.z * rightScalar,
      };
    }
    if (rightVector) {
      return {
        x: leftScalar * rightVector.x,
        y: leftScalar * rightVector.y,
        z: leftScalar * rightVector.z,
      };
    }
  }
  if (operator === "/") {
    if (leftVector && rightVector) {
      return {
        x: Math.abs(rightVector.x) <= 0.000001 ? 0 : leftVector.x / rightVector.x,
        y: Math.abs(rightVector.y) <= 0.000001 ? 0 : leftVector.y / rightVector.y,
        z: Math.abs(rightVector.z) <= 0.000001 ? 0 : leftVector.z / rightVector.z,
      };
    }
    if (leftVector) {
      const divisor = Math.abs(rightScalar) <= 0.000001 ? 1 : rightScalar;
      return {
        x: leftVector.x / divisor,
        y: leftVector.y / divisor,
        z: leftVector.z / divisor,
      };
    }
  }
  throw new Error(`Unsupported operator \`${operator}\` in script.runtime.`);
}

function createScriptRuntimeBuiltins(simulation, sceneRef = createScriptRuntimeSceneRef()) {
  return new Map([
    ["entity", (id) => findScriptRuntimeEntityRef(simulation, id)],
    ["entities", (kind = "") => listScriptRuntimeEntityRefs(simulation, kind)],
    ["players", () => listScriptRuntimeEntityRefs(simulation, "player")],
    ["nearest", (list, from) => {
      const origin = resolveScriptRuntimePositionLike(simulation, from);
      if (!origin || !Array.isArray(list)) {
        return null;
      }
      let best = null;
      let bestDistance = Infinity;
      for (const entry of list) {
        const position = resolveScriptRuntimePositionLike(simulation, entry);
        if (!position) {
          continue;
        }
        const distance = Math.hypot(
          position.x - origin.x,
          position.y - origin.y,
          position.z - origin.z,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entry;
        }
      }
      return best;
    }],
    ["sort_by_distance", (list, from) => {
      const origin = resolveScriptRuntimePositionLike(simulation, from);
      if (!origin || !Array.isArray(list)) {
        return [];
      }
      return [...list]
        .filter((entry) => resolveScriptRuntimePositionLike(simulation, entry))
        .sort((left, right) => {
          const leftPosition = resolveScriptRuntimePositionLike(simulation, left);
          const rightPosition = resolveScriptRuntimePositionLike(simulation, right);
          const leftDistance = Math.hypot(leftPosition.x - origin.x, leftPosition.y - origin.y, leftPosition.z - origin.z);
          const rightDistance = Math.hypot(rightPosition.x - origin.x, rightPosition.y - origin.y, rightPosition.z - origin.z);
          return leftDistance - rightDistance;
        });
    }],
    ["distance", (left, right) => {
      const leftPosition = resolveScriptRuntimePositionLike(simulation, left);
      const rightPosition = resolveScriptRuntimePositionLike(simulation, right);
      if (!leftPosition || !rightPosition) {
        return 0;
      }
      return Math.hypot(
        rightPosition.x - leftPosition.x,
        rightPosition.y - leftPosition.y,
        rightPosition.z - leftPosition.z,
      );
    }],
    ["normalize", (value) => {
      const vector = resolveScriptRuntimePositionLike(simulation, value) ?? (isScriptRuntimeVectorLike(value) ? toScriptRuntimeVector(value) : null);
      if (!vector) {
        return { x: 0, y: 0, z: 0 };
      }
      const length = scriptRuntimeVectorLength(vector);
      if (length <= 0.000001) {
        return { x: 0, y: 0, z: 0 };
      }
      return {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length,
      };
    }],
    ["length", (value) => {
      if (Array.isArray(value) || typeof value === "string") {
        return value.length;
      }
      if (isScriptRuntimeVectorLike(value)) {
        return scriptRuntimeVectorLength(value);
      }
      return Math.abs(mustFinite(value, 0));
    }],
    ["vec", (x = 0, y = 0, z = 0) => ({
      x: mustFinite(x, 0),
      y: mustFinite(y, 0),
      z: mustFinite(z, 0),
    })],
    ["clamp", (value = 0, min = 0, max = 0) => clampNumber(mustFinite(value, 0), mustFinite(min, 0), mustFinite(max, 0))],
    ["min", (...values) => Math.min(...values.map((entry) => mustFinite(entry, 0)))],
    ["max", (...values) => Math.max(...values.map((entry) => mustFinite(entry, 0)))],
    ["move_toward", (from, to, maxStep = 0, stopDistance = 0) => {
      const fromPosition = resolveScriptRuntimePositionLike(simulation, from);
      const toPosition = resolveScriptRuntimePositionLike(simulation, to);
      if (!fromPosition || !toPosition) {
        return { x: 0, y: 0, z: 0 };
      }
      const dx = toPosition.x - fromPosition.x;
      const dy = toPosition.y - fromPosition.y;
      const dz = toPosition.z - fromPosition.z;
      const distance = Math.hypot(dx, dy, dz);
      const safeStopDistance = Math.max(0, mustFinite(stopDistance, 0));
      const safeMaxStep = Math.max(0, mustFinite(maxStep, 0));
      if (distance <= safeStopDistance || safeMaxStep <= 0.000001) {
        return cloneJson(fromPosition);
      }
      const remaining = Math.max(0, distance - safeStopDistance);
      const step = Math.min(remaining, safeMaxStep);
      if (distance <= 0.000001) {
        return cloneJson(fromPosition);
      }
      return {
        x: fromPosition.x + (dx / distance) * step,
        y: fromPosition.y + (dy / distance) * step,
        z: fromPosition.z + (dz / distance) * step,
      };
    }],
    ["scene", sceneRef],
  ]);
}

function resolveScriptRuntimeReference(expression = null) {
  if (!expression) {
    return null;
  }
  if (expression.type === "Identifier") {
    return { type: "binding", name: expression.name };
  }
  if (expression.type === "MemberExpression") {
    const objectReference = resolveScriptRuntimeReference(expression.object);
    if (!objectReference) {
      return null;
    }
    return {
      type: "member",
      object: objectReference,
      property: expression.property?.name ?? "",
    };
  }
  return null;
}

function getScriptRuntimeReferenceValue(simulation, environment, reference) {
  if (!reference) {
    return undefined;
  }
  if (reference.type === "binding") {
    return environment.get(reference.name);
  }
  if (reference.type === "member") {
    return readScriptRuntimeProperty(
      simulation,
      getScriptRuntimeReferenceValue(simulation, environment, reference.object),
      reference.property,
    );
  }
  return undefined;
}

function setScriptRuntimeReferenceValue(simulation, environment, reference, value) {
  if (!reference) {
    throw new Error("Invalid script.runtime assignment target.");
  }
  if (reference.type === "binding") {
    const updated = environment.set(reference.name, value);
    if (!updated) {
      throw new Error(`Unknown script.runtime variable \`${reference.name}\`.`);
    }
    return value;
  }
  const { root, path } = unwrapScriptRuntimeReferencePath(reference);
  if (!root || !path.length) {
    throw new Error("Invalid script.runtime assignment target.");
  }
  const rootValue = getScriptRuntimeReferenceValue(simulation, environment, root);
  if (isScriptRuntimeEntityRef(rootValue)) {
    setScriptRuntimeEntityPath(simulation, rootValue, path, value);
    return value;
  }
  if (isScriptRuntimeSceneRef(rootValue)) {
    setScriptRuntimeScenePath(simulation, path, value);
    return value;
  }
  if (root.type !== "binding") {
    throw new Error("Script.runtime can only assign through variables, `self`, or `scene`.");
  }
  const nextRootValue = cloneScriptRuntimeValue(rootValue);
  if (!setScriptRuntimePlainObjectPath(nextRootValue, path, value)) {
    throw new Error(`Property path \`${path.join(".")}\` is not writable in script.runtime.`);
  }
  environment.set(root.name, nextRootValue);
  return value;
}

function evaluateScriptRuntimeExpression(simulation, environment, expression = null) {
  if (!expression) {
    return null;
  }
  if (expression.type === "Literal") {
    return cloneScriptRuntimeValue(expression.value);
  }
  if (expression.type === "Identifier") {
    if (!environment.has(expression.name)) {
      throw new Error(`Unknown script.runtime identifier \`${expression.name}\`.`);
    }
    return environment.get(expression.name);
  }
  if (expression.type === "MemberExpression") {
    const target = evaluateScriptRuntimeExpression(simulation, environment, expression.object);
    return readScriptRuntimeProperty(simulation, target, expression.property?.name ?? "");
  }
  if (expression.type === "CallExpression") {
    const callee = evaluateScriptRuntimeExpression(simulation, environment, expression.callee);
    if (typeof callee !== "function") {
      throw new Error("Tried to call a non-function in script.runtime.");
    }
    const args = (expression.arguments ?? []).map((entry) => evaluateScriptRuntimeExpression(simulation, environment, entry));
    return callee(...args);
  }
  if (expression.type === "UnaryExpression") {
    const argument = evaluateScriptRuntimeExpression(simulation, environment, expression.argument);
    if (expression.operator === "!") {
      return !scriptRuntimeTruthy(argument);
    }
    if (expression.operator === "-") {
      if (isScriptRuntimeVectorLike(argument)) {
        const vector = toScriptRuntimeVector(argument);
        return {
          x: -vector.x,
          y: -vector.y,
          z: -vector.z,
        };
      }
      return -mustFinite(argument, 0);
    }
  }
  if (expression.type === "LogicalExpression") {
    const left = evaluateScriptRuntimeExpression(simulation, environment, expression.left);
    if (expression.operator === "&&") {
      return scriptRuntimeTruthy(left)
        ? evaluateScriptRuntimeExpression(simulation, environment, expression.right)
        : left;
    }
    if (expression.operator === "||") {
      return scriptRuntimeTruthy(left)
        ? left
        : evaluateScriptRuntimeExpression(simulation, environment, expression.right);
    }
  }
  if (expression.type === "BinaryExpression") {
    const left = evaluateScriptRuntimeExpression(simulation, environment, expression.left);
    const right = evaluateScriptRuntimeExpression(simulation, environment, expression.right);
    return applyScriptRuntimeBinaryOperator(expression.operator, left, right);
  }
  throw new Error(`Unsupported script.runtime expression type \`${expression.type}\`.`);
}

function executeScriptRuntimeStatement(simulation, environment, statement = null) {
  if (!statement) {
    return { returned: false, value: null };
  }
  if (statement.type === "Program" || statement.type === "BlockStatement") {
    for (const entry of statement.body ?? []) {
      const result = executeScriptRuntimeStatement(simulation, environment, entry);
      if (result.returned) {
        return result;
      }
    }
    return { returned: false, value: null };
  }
  if (statement.type === "VariableDeclaration") {
    environment.define(
      statement.name,
      evaluateScriptRuntimeExpression(simulation, environment, statement.init),
    );
    return { returned: false, value: null };
  }
  if (statement.type === "AssignmentStatement") {
    const reference = resolveScriptRuntimeReference(statement.target);
    if (!reference) {
      throw new Error("Invalid script.runtime assignment target.");
    }
    const value = evaluateScriptRuntimeExpression(simulation, environment, statement.value);
    setScriptRuntimeReferenceValue(simulation, environment, reference, value);
    return { returned: false, value: null };
  }
  if (statement.type === "ExpressionStatement") {
    evaluateScriptRuntimeExpression(simulation, environment, statement.expression);
    return { returned: false, value: null };
  }
  if (statement.type === "IfStatement") {
    const testValue = evaluateScriptRuntimeExpression(simulation, environment, statement.test);
    if (scriptRuntimeTruthy(testValue)) {
      return executeScriptRuntimeStatement(simulation, environment, statement.consequent);
    }
    if (statement.alternate) {
      return executeScriptRuntimeStatement(simulation, environment, statement.alternate);
    }
    return { returned: false, value: null };
  }
  if (statement.type === "ReturnStatement") {
    return {
      returned: true,
      value: statement.argument ? evaluateScriptRuntimeExpression(simulation, environment, statement.argument) : null,
    };
  }
  throw new Error(`Unsupported script.runtime statement type \`${statement.type}\`.`);
}

function executeRuntimeScript(simulation, scriptEntry = {}, deltaSeconds = 0) {
  if (!scriptEntry?.program_ast || scriptEntry.enabled === false) {
    return;
  }
  const sceneRef = createScriptRuntimeSceneRef();
  const selfRef = scriptEntry.target_id === "scene"
    ? sceneRef
    : findScriptRuntimeEntityRef(simulation, scriptEntry.target_id);
  if (!selfRef) {
    throw new Error(`Script target \`${scriptEntry.target_id || "scene"}\` is no longer available.`);
  }
  const environment = createScriptRuntimeEnvironment({
    constants: scriptEntry.constants ?? {},
    selfRef,
    sceneRef,
    dt: Math.max(0, mustFinite(deltaSeconds, 0)),
    time: Math.max(0, mustFinite(simulation.elapsedMs, 0)) / 1000,
    builtins: createScriptRuntimeBuiltins(simulation, sceneRef),
  });
  executeScriptRuntimeStatement(simulation, environment, scriptEntry.program_ast);
}

function executeRuntimeScripts(simulation, deltaSeconds = 0) {
  const scripts = Array.isArray(simulation?.scriptConfig?.runtime_scripts)
    ? simulation.scriptConfig.runtime_scripts
    : [];
  if (!scripts.length) {
    return;
  }
  for (const scriptEntry of scripts) {
    try {
      executeRuntimeScript(simulation, scriptEntry, deltaSeconds);
      simulation.scriptRuntimeState?.lastErrorByFunctionId?.delete?.(scriptEntry.function_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown script.runtime execution error.";
      const previous = simulation.scriptRuntimeState?.lastErrorByFunctionId?.get?.(scriptEntry.function_id) ?? "";
      if (previous === message) {
        continue;
      }
      simulation.scriptRuntimeState?.lastErrorByFunctionId?.set?.(scriptEntry.function_id, message);
      pushRuntimeEvent(simulation, {
        type: "script_runtime_error",
        function_id: scriptEntry.function_id ?? null,
        function_name: scriptEntry.function_name ?? null,
        message,
      });
    }
  }
}

function normalizeScriptedPlatformLoopMode(value = "pingpong") {
  const normalized = String(value ?? "pingpong").trim().toLowerCase();
  if (normalized === "loop" || normalized === "repeat") {
    return "loop";
  }
  if (normalized === "once" || normalized === "one_way") {
    return "once";
  }
  return "pingpong";
}

function registerScriptedPlatformMotion(simulation, entry, payload = {}) {
  if (!simulation || !entry?.id) {
    return false;
  }
  const delta = vec3(payload.motion_delta ?? payload.delta ?? payload.offset, { x: 0, y: 0, z: 0 });
  if (
    Math.abs(delta.x) <= PLATFORM_CARRY_DELTA_EPSILON
    && Math.abs(delta.y) <= PLATFORM_CARRY_DELTA_EPSILON
    && Math.abs(delta.z) <= PLATFORM_CARRY_DELTA_EPSILON
  ) {
    return false;
  }
  simulation.scriptedPlatformMotions.set(entry.id, {
    targetId: entry.id,
    targetKind: entry.kind === "prefab_instance" ? "prefab_instance" : "dynamic_object",
    basePosition: cloneJson(entry.position),
    delta,
    durationMs: clampNumber(
      mustFinite(payload.duration_ms ?? payload.motion_duration_ms, SCRIPTED_PLATFORM_DEFAULT_DURATION_MS),
      SCRIPTED_PLATFORM_DEFAULT_DURATION_MS,
      SCRIPTED_PLATFORM_MIN_DURATION_MS,
      SCRIPTED_PLATFORM_MAX_DURATION_MS,
    ),
    loopMode: normalizeScriptedPlatformLoopMode(payload.loop_mode ?? payload.motion_loop ?? payload.loop),
    startedAtMs: mustFinite(simulation.currentStepStartElapsedMs, simulation.elapsedMs),
  });
  return true;
}

function resolveScriptedPlatformProgress(controller, elapsedMs) {
  const durationMs = Math.max(SCRIPTED_PLATFORM_MIN_DURATION_MS, mustFinite(controller?.durationMs, SCRIPTED_PLATFORM_DEFAULT_DURATION_MS));
  const rawProgress = Math.max(0, elapsedMs) / durationMs;
  if (controller?.loopMode === "loop") {
    return rawProgress % 1;
  }
  if (controller?.loopMode === "once") {
    return clampNumber(rawProgress, 0, 1);
  }
  const cycleProgress = rawProgress % 2;
  return cycleProgress <= 1 ? cycleProgress : 2 - cycleProgress;
}

function advanceScriptedPlatformMotions(simulation, deltaSeconds) {
  if (!simulation?.scriptedPlatformMotions?.size) {
    return;
  }
  for (const [targetId, controller] of simulation.scriptedPlatformMotions.entries()) {
    const progress = resolveScriptedPlatformProgress(
      controller,
      Math.max(0, mustFinite(simulation.elapsedMs, 0) - mustFinite(controller.startedAtMs, 0)),
    );
    const nextPosition = {
      x: mustFinite(controller.basePosition?.x, 0) + mustFinite(controller.delta?.x, 0) * progress,
      y: mustFinite(controller.basePosition?.y, 0) + mustFinite(controller.delta?.y, 0) * progress,
      z: mustFinite(controller.basePosition?.z, 0) + mustFinite(controller.delta?.z, 0) * progress,
    };
    if (controller.targetKind === "prefab_instance") {
      const entry = findPrefabInstanceTarget(simulation, targetId);
      if (!entry) {
        simulation.scriptedPlatformMotions.delete(targetId);
        continue;
      }
      const previousPosition = vec3(entry.position);
      const nextVelocity = deltaSeconds > 0
        ? {
          x: (nextPosition.x - previousPosition.x) / deltaSeconds,
          y: (nextPosition.y - previousPosition.y) / deltaSeconds,
          z: (nextPosition.z - previousPosition.z) / deltaSeconds,
        }
        : vec3(entry.velocity);
      applyPrefabInstancePose(simulation, entry, {
        position: nextPosition,
        velocity: nextVelocity,
        forceKinematicDescendants: true,
      });
      continue;
    }
    const entry = simulation.dynamicObjects.find((candidate) => candidate.id === targetId) ?? null;
    const body = simulation.physics?.objectBodies?.get(targetId) ?? null;
    if (!entry || !body) {
      simulation.scriptedPlatformMotions.delete(targetId);
      continue;
    }
    const previousPosition = vec3(entry.position);
    const nextVelocity = deltaSeconds > 0
      ? {
        x: (nextPosition.x - previousPosition.x) / deltaSeconds,
        y: (nextPosition.y - previousPosition.y) / deltaSeconds,
        z: (nextPosition.z - previousPosition.z) / deltaSeconds,
      }
      : vec3(entry.velocity);
    entry.position = nextPosition;
    entry.velocity = nextVelocity;
    entry.sleeping = false;
    body.setBodyType?.(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setGravityScale?.(0, true);
    body.setLinvel?.(nextVelocity, true);
    if (typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(nextPosition);
    }
    body.setTranslation(nextPosition, true);
    body.wakeUp?.();
  }
}

function carryPlatformRiders(simulation, preStepState, deltaSeconds = 0) {
  if (!simulation || !preStepState?.platforms?.length) {
    return;
  }
  const riderAssignments = new Map();
  for (const platformState of preStepState.platforms) {
    const platform = simulation.dynamicObjects.find((entry) => entry.id === platformState.id) ?? null;
    if (!platform) {
      continue;
    }
    const platformDelta = {
      x: mustFinite(platform.position?.x, 0) - mustFinite(platformState.position?.x, 0),
      y: mustFinite(platform.position?.y, 0) - mustFinite(platformState.position?.y, 0),
      z: mustFinite(platform.position?.z, 0) - mustFinite(platformState.position?.z, 0),
    };
    if (
      Math.abs(platformDelta.x) <= PLATFORM_CARRY_DELTA_EPSILON
      && Math.abs(platformDelta.y) <= PLATFORM_CARRY_DELTA_EPSILON
      && Math.abs(platformDelta.z) <= PLATFORM_CARRY_DELTA_EPSILON
    ) {
      continue;
    }
    for (const riderState of preStepState.riders.values()) {
      if (!wasRiderStandingOnPlatform(riderState, platformState)) {
        continue;
      }
      const previousAssignment = riderAssignments.get(riderState.id);
      const previousGap = previousAssignment?.verticalGap ?? Number.POSITIVE_INFINITY;
      const verticalGap = Math.abs(getRiderPlatformVerticalGap(riderState, platformState));
      if (verticalGap <= previousGap) {
        riderAssignments.set(riderState.id, {
          platformDelta,
          verticalGap,
        });
      }
    }
  }

  for (const [riderId, assignment] of riderAssignments.entries()) {
    const riderState = preStepState.riders.get(riderId);
    if (!riderState) {
      continue;
    }
    const rider = riderState.kind === "player"
      ? simulation.players.find((entry) => entry.id === riderId)
      : simulation.dynamicObjects.find((entry) => entry.id === riderId);
    if (!rider) {
      continue;
    }
    if (riderState.kind === "player" && isClientAuthoritativeRigidPlayer(rider)) {
      continue;
    }
    const currentPosition = vec3(rider.position);
    const baseTargetPosition = {
      x: mustFinite(riderState.position?.x, 0) + mustFinite(assignment.platformDelta?.x, 0),
      y: mustFinite(riderState.position?.y, 0) + mustFinite(assignment.platformDelta?.y, 0),
      z: mustFinite(riderState.position?.z, 0) + mustFinite(assignment.platformDelta?.z, 0),
    };
    const currentRelativeDelta = {
      x: currentPosition.x - baseTargetPosition.x,
      y: currentPosition.y - baseTargetPosition.y,
      z: currentPosition.z - baseTargetPosition.z,
    };
    const allowedRelativeDelta = riderState.kind === "player"
      ? getPlayerAllowedCarryRelativeDelta(simulation, rider, deltaSeconds)
      : { x: 0, y: 0, z: 0 };
    if (
      riderState.kind === "player"
      && rider.body_mode !== "ghost"
      && rider.onGround !== true
      && currentRelativeDelta.y > PLATFORM_CARRY_DELTA_EPSILON
    ) {
      allowedRelativeDelta.y = currentRelativeDelta.y;
    }
    const targetPosition = {
      x: baseTargetPosition.x + resolveCarryTargetRelativeDelta(currentRelativeDelta.x, allowedRelativeDelta.x),
      y: baseTargetPosition.y + resolveCarryTargetRelativeDelta(currentRelativeDelta.y, allowedRelativeDelta.y),
      z: baseTargetPosition.z + resolveCarryTargetRelativeDelta(currentRelativeDelta.z, allowedRelativeDelta.z),
    };
    const carryDelta = {
      x: targetPosition.x - currentPosition.x,
      y: targetPosition.y - currentPosition.y,
      z: targetPosition.z - currentPosition.z,
    };
    if (
      Math.abs(carryDelta.x) <= PLATFORM_CARRY_DELTA_EPSILON
      && Math.abs(carryDelta.y) <= PLATFORM_CARRY_DELTA_EPSILON
      && Math.abs(carryDelta.z) <= PLATFORM_CARRY_DELTA_EPSILON
    ) {
      continue;
    }
    if (riderState.kind === "player") {
      translatePlayerByDelta(simulation, rider, carryDelta);
      rider.onGround = rider.body_mode === "ghost" ? false : raycastPlayerGround(simulation, rider);
    } else {
      translateDynamicObjectByDelta(simulation, rider, carryDelta);
    }
  }
}

function findSupportingCarryPlatform(runtime, rider) {
  if (!runtime || !rider) {
    return null;
  }
  const riderBody = runtime.physics?.playerBodies?.get(rider.id) ?? null;
  const riderState = {
    id: rider.id,
    position: riderBody ? vec3(riderBody.translation(), rider.position) : vec3(rider.position),
    halfExtents: getBodyHalfExtents(rider),
  };
  let bestMatch = null;
  for (const entry of runtime.dynamicObjects ?? []) {
    if (entry?.physics?.carry_riders !== true) {
      continue;
    }
    const body = runtime.physics?.objectBodies?.get(entry.id) ?? null;
    const platformState = {
      id: entry.id,
      position: body ? vec3(body.translation(), entry.position) : vec3(entry.position),
      halfExtents: getBodyHalfExtents(entry),
    };
    if (!wasRiderStandingOnPlatform(riderState, platformState)) {
      continue;
    }
    const verticalGap = Math.abs(getRiderPlatformVerticalGap(riderState, platformState));
    if (!bestMatch || verticalGap < bestMatch.verticalGap) {
      bestMatch = {
        entry,
        platformState,
        verticalGap,
      };
    }
  }
  return bestMatch;
}

function clearClientReplicatedPose(player) {
  if (!player) {
    return;
  }
  player.client_replication_pose = null;
  player.client_replication_updated_at_ms = 0;
  player.last_client_replication_seq = 0;
}

function getFreshClientReplicatedPose(player, nowMs = Date.now()) {
  if (!player?.occupied_by_profile_id) {
    return null;
  }
  const pose = player.client_replication_pose;
  const updatedAt = Math.max(0, Number(player.client_replication_updated_at_ms ?? 0) || 0);
  if (!pose || updatedAt <= 0 || nowMs - updatedAt > CLIENT_REPLICATED_POSE_TTL_MS) {
    return null;
  }
  return pose;
}

function isClientAuthoritativeRigidPlayer(player, nowMs = Date.now()) {
  return Boolean(
    player?.occupied_by_profile_id
    && player?.body_mode !== "ghost"
    && player?.client_replication_pose,
  );
}

function applyOccupiedPlayerPose(runtime, player, input = {}) {
  if (!runtime || !player) {
    return null;
  }
  const motionSeq = Number(input.motionSeq ?? input.motion_seq);
  const rawPosition = input.position && typeof input.position === "object" ? input.position : {};
  const rawVelocity = input.velocity && typeof input.velocity === "object" ? input.velocity : {};
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  const collider = runtime.physics?.playerColliders?.get(player.id) ?? null;
  const currentBodyPosition = body ? vec3(body.translation(), player.position) : vec3(player.position);
  const currentBodyVelocity = body ? vec3(body.linvel(), player.velocity) : vec3(player.velocity);
  const forceClientPose = input.force_client_pose === true
    || input.forceClientPose === true
    || input.force_runtime_pose === true
    || input.forceRuntimePose === true
    || input.client_authoritative_pose === true;
  if (forceClientPose) {
    const previousReplicationSeq = Math.max(0, Number(player.last_client_replication_seq ?? 0) || 0);
    const existingPose = getFreshClientReplicatedPose(player) ?? {
      position: cloneJson(player.position),
      velocity: cloneJson(player.velocity),
      rotation: cloneJson(player.rotation),
    };
    if (Number.isFinite(motionSeq) && motionSeq < previousReplicationSeq) {
      return {
        player_entity_id: player.id,
        position: cloneJson(existingPose.position),
        velocity: cloneJson(existingPose.velocity),
        heading_y: mustFinite(existingPose.rotation?.y, player.rotation?.y ?? 0),
        motion_seq: previousReplicationSeq,
        ignored: true,
        mirrored_only: true,
      };
    }
    const resolvedHeadingY = Number(input.headingY ?? input.heading_y ?? rawPosition.heading_y ?? rawPosition.heading);
    const mirroredPosition = {
      x: mustFinite(rawPosition.x ?? input.position_x, currentBodyPosition.x),
      y: mustFinite(rawPosition.y ?? input.position_y, currentBodyPosition.y),
      z: mustFinite(rawPosition.z ?? input.position_z, currentBodyPosition.z),
    };
    const mirroredVelocity = {
      x: mustFinite(rawVelocity.x ?? input.velocity_x, currentBodyVelocity.x),
      y: mustFinite(rawVelocity.y ?? input.velocity_y, currentBodyVelocity.y),
      z: mustFinite(rawVelocity.z ?? input.velocity_z, currentBodyVelocity.z),
    };
    const mirroredRotation = cloneJson(player.rotation);
    if (Number.isFinite(resolvedHeadingY)) {
      mirroredRotation.y = Number(normalizeAngle(resolvedHeadingY).toFixed(6));
    }
    player.position = mirroredPosition;
    player.velocity = mirroredVelocity;
    player.rotation = mirroredRotation;
    player.sleeping = false;
    if (player.body_mode === "ghost" && Math.abs(mirroredVelocity.y) < 0.05) {
      player.groundPositionY = mirroredPosition.y;
    }
    if (player.body_mode === "ghost") {
      player.onGround = isGhostPlayerGrounded({
        ...player,
        position: mirroredPosition,
        velocity: mirroredVelocity,
      });
    }
    if (Number.isFinite(resolvedHeadingY)) {
      player.usesLookHeading = true;
    }
    player.client_replication_pose = {
      position: mirroredPosition,
      velocity: mirroredVelocity,
      rotation: mirroredRotation,
    };
    player.client_replication_updated_at_ms = Date.now();
    if (Number.isFinite(motionSeq)) {
      player.last_client_replication_seq = Math.max(previousReplicationSeq, motionSeq);
    }
    if (body) {
      if (player.body_mode !== "ghost") {
        body.setBodyType?.(RAPIER.RigidBodyType.KinematicPositionBased, true);
        body.setGravityScale?.(0, true);
        collider?.setSensor?.(true);
      }
      if (typeof body.setNextKinematicTranslation === "function") {
        body.setNextKinematicTranslation(mirroredPosition);
      }
      body.setTranslation(mirroredPosition, true);
      body.setLinvel(mirroredVelocity, true);
      body.setRotation(toRapierRotation(player.rotation), true);
      body.wakeUp?.();
    }
    return {
      player_entity_id: player.id,
      position: cloneJson(mirroredPosition),
      velocity: cloneJson(mirroredVelocity),
      heading_y: mustFinite(mirroredRotation?.y, 0),
      motion_seq: Number.isFinite(motionSeq) ? Math.max(previousReplicationSeq, motionSeq) : previousReplicationSeq,
      mirrored_only: true,
    };
  }
  const previousMotionSeq = Math.max(0, Number(player.last_client_motion_seq ?? 0) || 0);
  if (Number.isFinite(motionSeq) && motionSeq < previousMotionSeq) {
    return {
      player_entity_id: player.id,
      position: cloneJson(player.position),
      velocity: cloneJson(player.velocity),
      heading_y: mustFinite(player.rotation?.y, 0),
      motion_seq: previousMotionSeq,
      ignored: true,
    };
  }
  const preserveVertical = !forceClientPose && player.body_mode !== "ghost";
  const supportingCarryPlatform = preserveVertical ? findSupportingCarryPlatform(runtime, player) : null;
  const preservePlanar = !forceClientPose && Boolean(supportingCarryPlatform);
  const nextPosition = {
    x: preservePlanar
      ? currentBodyPosition.x
      : mustFinite(rawPosition.x ?? input.position_x, currentBodyPosition.x),
    y: preserveVertical
      ? currentBodyPosition.y
      : mustFinite(rawPosition.y ?? input.position_y, currentBodyPosition.y),
    z: preservePlanar
      ? currentBodyPosition.z
      : mustFinite(rawPosition.z ?? input.position_z, currentBodyPosition.z),
  };
  const nextVelocity = {
    x: preservePlanar
      ? currentBodyVelocity.x
      : mustFinite(rawVelocity.x ?? input.velocity_x, currentBodyVelocity.x),
    y: preserveVertical
      ? currentBodyVelocity.y
      : mustFinite(rawVelocity.y ?? input.velocity_y, currentBodyVelocity.y),
    z: preservePlanar
      ? currentBodyVelocity.z
      : mustFinite(rawVelocity.z ?? input.velocity_z, currentBodyVelocity.z),
  };
  const resolvedHeadingY = Number(input.headingY ?? input.heading_y ?? rawPosition.heading_y ?? rawPosition.heading);

  if (player.body_mode === "ghost" && Math.abs(nextVelocity.y) < 0.05) {
    player.groundPositionY = nextPosition.y;
  }

  player.position = nextPosition;
  player.velocity = nextVelocity;
  if (player.body_mode === "ghost") {
    player.onGround = isGhostPlayerGrounded({
      ...player,
      position: nextPosition,
      velocity: nextVelocity,
    });
  }
  if (Number.isFinite(resolvedHeadingY)) {
    setPlayerLookHeading(player, resolvedHeadingY);
    player.usesLookHeading = true;
  }
  if (Number.isFinite(motionSeq)) {
    player.last_client_motion_seq = Math.max(previousMotionSeq, motionSeq);
  }

  if (body) {
    if (player.body_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(nextPosition);
    }
    body.setTranslation(nextPosition, true);
    body.setLinvel(nextVelocity, true);
    body.setRotation(toRapierRotation(player.rotation), true);
    body.wakeUp?.();
  }

  return {
    player_entity_id: player.id,
    position: cloneJson(nextPosition),
    velocity: cloneJson(nextVelocity),
    heading_y: Number.isFinite(resolvedHeadingY)
      ? Number(normalizeAngle(resolvedHeadingY).toFixed(6))
      : mustFinite(player.rotation?.y, 0),
    motion_seq: Number.isFinite(motionSeq) ? Math.max(previousMotionSeq, motionSeq) : previousMotionSeq,
  };
}

function canPlayerInteractWithDynamicObject(player, entry) {
  if (!player || !entry) {
    return false;
  }
  const playerHalf = getBodyHalfExtents({
    kind: "player",
    scale: player.scale,
  });
  const objectHalf = getBodyHalfExtents(entry);
  const limitX = playerHalf.x + objectHalf.x + DYNAMIC_INTERACTION_DISTANCE_BUFFER;
  const limitY = playerHalf.y + objectHalf.y + DYNAMIC_INTERACTION_DISTANCE_BUFFER;
  const limitZ = playerHalf.z + objectHalf.z + DYNAMIC_INTERACTION_DISTANCE_BUFFER;
  return (
    Math.abs(mustFinite(player.position?.x, 0) - mustFinite(entry.position?.x, 0)) <= limitX
    && Math.abs(mustFinite(player.position?.y, 0) - mustFinite(entry.position?.y, 0)) <= limitY
    && Math.abs(mustFinite(player.position?.z, 0) - mustFinite(entry.position?.z, 0)) <= limitZ
  );
}

function resolveDynamicInteractionObjectId(runtime, value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const knownIds = (runtime?.dynamicObjects ?? []).map((entry) => entry.id).filter(Boolean);
  if (knownIds.includes(raw)) {
    return raw;
  }
  return resolveEntityIdAlias("primitive", raw, knownIds)
    ?? resolveEntityIdAlias("model", raw, knownIds)
    ?? raw;
}

function applyDynamicInteractionStates(runtime, occupiedPlayer, profile, interactionStates = []) {
  if (!runtime || !occupiedPlayer || !profile?.id) {
    return {
      accepted_object_ids: [],
      rejected_object_ids: [],
    };
  }
  const nowMs = Date.now();
  const accepted = [];
  const rejected = [];
  const limitedStates = Array.isArray(interactionStates)
    ? interactionStates.slice(0, DYNAMIC_INTERACTION_MAX_STATES)
    : [];
  for (const state of limitedStates) {
    const objectId = resolveDynamicInteractionObjectId(runtime, state?.object_id ?? state?.id ?? "");
    if (!objectId) {
      continue;
    }
    const entry = runtime.dynamicObjects.find((candidate) => candidate.id === objectId) ?? null;
    if (!entry || entry.rigid_mode === "ghost" || entry.physics?.carry_riders === true) {
      rejected.push(objectId);
      continue;
    }
    const previousSeq = Math.max(0, Number(entry.last_client_interaction_seq ?? 0) || 0);
    const interactionSeq = Number(state?.interaction_seq ?? state?.motion_seq ?? 0);
    if (Number.isFinite(interactionSeq) && interactionSeq < previousSeq) {
      rejected.push(objectId);
      continue;
    }
    const activeOwner = String(entry.authority_owner_profile_id ?? "").trim();
    if (activeOwner && activeOwner !== String(profile.id).trim() && isDynamicObjectAuthorityActive(entry, nowMs)) {
      rejected.push(objectId);
      continue;
    }
    if (!canPlayerInteractWithDynamicObject(occupiedPlayer, entry) && activeOwner !== String(profile.id).trim()) {
      rejected.push(objectId);
      continue;
    }
    entry.authority_owner_profile_id = String(profile.id).trim();
    entry.authority_owner_username = String(profile.username ?? profile.display_name ?? "").trim() || null;
    entry.authority_lease_until_ms = nowMs + DYNAMIC_INTERACTION_LEASE_MS;
    if (Number.isFinite(interactionSeq)) {
      entry.last_client_interaction_seq = Math.max(previousSeq, interactionSeq);
    }
    applyDynamicObjectPose(runtime, entry, {
      position: {
        x: state?.position?.x ?? state?.position_x,
        y: state?.position?.y ?? state?.position_y,
        z: state?.position?.z ?? state?.position_z,
      },
      velocity: {
        x: state?.velocity?.x ?? state?.velocity_x,
        y: state?.velocity?.y ?? state?.velocity_y,
        z: state?.velocity?.z ?? state?.velocity_z,
      },
      rotation: {
        x: state?.rotation?.x ?? state?.rotation_x,
        y: state?.rotation?.y ?? state?.rotation_y,
        z: state?.rotation?.z ?? state?.rotation_z,
      },
      angularVelocity: {
        x: state?.angular_velocity?.x ?? state?.angular_velocity_x,
        y: state?.angular_velocity?.y ?? state?.angular_velocity_y,
        z: state?.angular_velocity?.z ?? state?.angular_velocity_z,
      },
    });
    accepted.push(objectId);
  }
  return {
    accepted_object_ids: accepted,
    rejected_object_ids: rejected,
  };
}

function syncRapierOccupancy(simulation) {
  const physics = simulation.physics;
  if (!physics) {
    return;
  }
  for (const player of simulation.players) {
    const body = physics.playerBodies.get(player.id);
    const collider = physics.playerColliders.get(player.id);
    if (!body) {
      continue;
    }
    if (player.body_mode === "ghost") {
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      body.setGravityScale(0, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      collider?.setSensor?.(true);
      continue;
    }
    const clientAuthoritative = isClientAuthoritativeRigidPlayer(player);
    const nextType = clientAuthoritative
      ? RAPIER.RigidBodyType.KinematicPositionBased
      : (player.occupied_by_profile_id ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed);
    body.setBodyType(nextType, true);
    body.setGravityScale(clientAuthoritative ? 0 : 1, true);
    body.setEnabledRotations(false, true, false, true);
    collider?.setSensor?.(clientAuthoritative);
    if (!player.occupied_by_profile_id) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
    } else if (clientAuthoritative) {
      if (typeof body.setNextKinematicTranslation === "function") {
        body.setNextKinematicTranslation(player.position);
      }
      body.setTranslation(player.position, true);
      body.setLinvel(player.velocity, true);
      body.setRotation(toRapierRotation(player.rotation), true);
      body.wakeUp();
    } else {
      body.wakeUp();
    }
  }
}

function updatePlayerLookDirection(player, desired, fallbackVelocity = null) {
  const velocity = fallbackVelocity ?? player.velocity;
  const dirX = Math.abs(desired.x) > 0.001 ? desired.x : mustFinite(velocity?.x, 0);
  const dirZ = Math.abs(desired.z) > 0.001 ? desired.z : mustFinite(velocity?.z, 0);
  if (Math.abs(dirX) <= 0.001 && Math.abs(dirZ) <= 0.001) {
    return;
  }
  player.rotation.y = Number(Math.atan2(dirX, dirZ).toFixed(6));
}

function setPlayerLookHeading(player, headingY) {
  if (!player?.rotation || !Number.isFinite(Number(headingY))) {
    return false;
  }
  player.rotation.y = Number(normalizeAngle(headingY).toFixed(6));
  return true;
}

function getRelativePlayerMovement(runtime = {}, player, pressedKeys = player?.pressedKeys) {
  const pressed = pressedKeys instanceof Set ? pressedKeys : new Set();
  const left = isBindingPressed(pressed, "move_left_key", getPlayerMoveLeftBinding(runtime, player));
  const right = isBindingPressed(pressed, "move_right_key", getPlayerMoveRightBinding(runtime, player));
  const forward = isBindingPressed(pressed, "move_forward_key", getPlayerMoveForwardBinding(runtime, player));
  const backward = isBindingPressed(pressed, "move_back_key", getPlayerMoveBackBinding(runtime, player));
  const headingY = mustFinite(player?.rotation?.y, 0);
  const forwardAmount = Number(forward) - Number(backward);
  const strafeAmount = Number(right) - Number(left);
  const forwardVector = getHeadingForwardVector(headingY);
  const rightVector = {
    x: Math.cos(headingY),
    z: -Math.sin(headingY),
  };
  return normalizePlanarVector(
    forwardVector.x * forwardAmount + rightVector.x * strafeAmount,
    forwardVector.z * forwardAmount + rightVector.z * strafeAmount,
  );
}

function isPlayerMovementToggleCameraMode(cameraMode = "third_person") {
  const normalized = String(cameraMode ?? "third_person").trim().toLowerCase();
  return normalized === "third_person" || normalized === "first_person";
}

function isPlayerMovementEnabled(runtime = {}, player = {}) {
  const controlConfig = getPlayerControlConfig(runtime, player);
  if (controlConfig) {
    return controlConfig.enabled !== false;
  }
  if (!isPlayerMovementToggleCameraMode(player?.camera_mode)) {
    return true;
  }
  return player?.movement_enabled !== false;
}

function isPlayerJumpEnabled(runtime = {}, player = {}) {
  const controlConfig = getPlayerControlConfig(runtime, player);
  if (controlConfig && Object.hasOwn(controlConfig.params ?? {}, "jump_enabled")) {
    return controlConfig.params.jump_enabled === true;
  }
  return player?.jump_enabled === true;
}

function getGhostPlayerGroundY(player = {}) {
  return mustFinite(
    player.groundPositionY,
    player.initialPosition?.y ?? player.position?.y ?? 0,
  );
}

function isGhostPlayerGrounded(player = {}) {
  return (
    Math.abs(mustFinite(player.velocity?.y, 0)) < 0.05
    && Math.abs(mustFinite(player.position?.y, 0) - getGhostPlayerGroundY(player)) <= 0.08
  );
}

function raycastPlayerGround(runtime, player) {
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  const collider = runtime.physics?.playerColliders?.get(player.id) ?? null;
  if (!body || !collider) {
    return false;
  }
  const half = getBodyHalfExtents(player);
  const origin = body.translation();
  const ray = new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
  const hit = runtime.physics.world.castRay(ray, half.y + 0.16, true, undefined, undefined, collider, body);
  return Boolean(hit && hit.timeOfImpact <= half.y + 0.08);
}

function primeQueuedPlayerJump(runtime, player, nowMs = mustFinite(runtime?.elapsedMs, 0)) {
  if (!runtime || !player || !isPlayerJumpEnabled(runtime, player)) {
    return false;
  }
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  const jumpBufferMs = getPlayerJumpBufferMs(runtime, player);
  if (!body) {
    player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + jumpBufferMs);
    return false;
  }
  if (player.body_mode === "ghost") {
    player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + jumpBufferMs);
    player.onGround = isGhostPlayerGrounded(player);
    if (!player.onGround) {
      player.sleeping = false;
      body.wakeUp?.();
      return false;
    }
    player.velocity = {
      x: mustFinite(player.velocity?.x, 0),
      y: getPlayerJumpVelocity(runtime, player),
      z: mustFinite(player.velocity?.z, 0),
    };
    player.onGround = false;
    player.sleeping = false;
    player.jumpBufferedUntilMs = 0;
    body.setLinvel(player.velocity, true);
    body.wakeUp?.();
    return true;
  }
  player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + jumpBufferMs);
  player.onGround = raycastPlayerGround(runtime, player);
  if (!player.onGround) {
    player.sleeping = false;
    body.wakeUp?.();
    return false;
  }
  const currentVelocity = vec3(body.linvel(), player.velocity);
  const nextVelocity = {
    x: currentVelocity.x,
    y: getPlayerJumpVelocity(runtime, player),
    z: currentVelocity.z,
  };
  player.velocity = nextVelocity;
  player.onGround = false;
  player.sleeping = false;
  player.jumpBufferedUntilMs = 0;
  body.setLinvel(nextVelocity, true);
  body.wakeUp?.();
  return true;
}

function applyPlayerMovement(player, inputEdges = [], deltaSeconds, runtime) {
  const physics = runtime.physics;
  const body = physics?.playerBodies?.get(player.id) ?? null;
  if (!body) {
    return;
  }
  if (isClientAuthoritativeRigidPlayer(player)) {
    body.setRotation(toRapierRotation(player.rotation), true);
    return;
  }

  const pressed = player.pressedKeys;
  const movementEnabled = isPlayerMovementEnabled(runtime, player);
  const left = isBindingPressed(pressed, "move_left_key", getPlayerMoveLeftBinding(runtime, player));
  const right = isBindingPressed(pressed, "move_right_key", getPlayerMoveRightBinding(runtime, player));
  const forward = isBindingPressed(pressed, "move_forward_key", getPlayerMoveForwardBinding(runtime, player));
  const backward = isBindingPressed(pressed, "move_back_key", getPlayerMoveBackBinding(runtime, player));
  const sprint = movementEnabled && isBindingPressed(pressed, "sprint_key", getPlayerSprintBinding(runtime, player));
  const nowMs = mustFinite(runtime?.elapsedMs, 0);
  const jumpBinding = getPlayerJumpBinding(runtime, player);
  const jumpBufferMs = getPlayerJumpBufferMs(runtime, player);
  const jumpEdge = isPlayerJumpEnabled(runtime, player) && inputEdges.some((entry) => entry.key === jumpBinding && entry.state === "down");
  if (jumpEdge) {
    player.jumpBufferedUntilMs = nowMs + jumpBufferMs;
  } else if (mustFinite(player.jumpBufferedUntilMs, 0) < nowMs) {
    player.jumpBufferedUntilMs = 0;
  }
  const desired = movementEnabled
    ? (player.usesLookHeading === true
    ? getRelativePlayerMovement(runtime, player, pressed)
    : normalizePlanarVector(
      Number(right) - Number(left),
      Number(backward) - Number(forward),
    ))
    : { x: 0, z: 0 };
  if (player.usesLookHeading !== true) {
    updatePlayerLookDirection(player, desired);
  }

  if (player.body_mode === "ghost") {
    const speed = sprint ? getPlayerSprintSpeed(runtime, player) : getPlayerMoveSpeed(runtime, player);
    const gravity = Math.abs(mustFinite(runtime?.gravity?.y, -9.8)) * getPlayerGravityScale(runtime, player);
    const maxFallSpeed = getPlayerMaxFallSpeed(runtime, player);
    const groundY = getGhostPlayerGroundY(player);
    const currentVelocity = vec3(player.velocity);
    let nextVelocityY = currentVelocity.y;
    if (mustFinite(player.jumpBufferedUntilMs, 0) >= nowMs && player.onGround) {
      nextVelocityY = getPlayerJumpVelocity(runtime, player);
      player.onGround = false;
      player.jumpBufferedUntilMs = 0;
    } else {
      nextVelocityY -= gravity * deltaSeconds;
      if (Number.isFinite(maxFallSpeed)) {
        nextVelocityY = Math.max(-maxFallSpeed, nextVelocityY);
      }
    }
    let nextPositionY = player.position.y + nextVelocityY * deltaSeconds;
    if (nextPositionY <= groundY) {
      nextPositionY = groundY;
      nextVelocityY = 0;
      player.onGround = true;
      player.groundPositionY = groundY;
    } else {
      player.onGround = false;
    }
    const nextPosition = {
      x: player.position.x + desired.x * speed * deltaSeconds,
      y: nextPositionY,
      z: player.position.z + desired.z * speed * deltaSeconds,
    };
    player.velocity = {
      x: desired.x * speed,
      y: nextVelocityY,
      z: desired.z * speed,
    };
    body.setNextKinematicTranslation(nextPosition);
    body.setTranslation(nextPosition, true);
    body.setLinvel(player.velocity, true);
    body.setRotation(toRapierRotation(player.rotation), true);
    player.position = nextPosition;
    return;
  }

  const speed = sprint ? getPlayerSprintSpeed(runtime, player) : getPlayerMoveSpeed(runtime, player);
  const currentVelocity = vec3(body.linvel(), player.velocity);
  const targetVelocityX = desired.x * speed;
  const targetVelocityZ = desired.z * speed;
  const controlBlend = desired.x || desired.z
    ? getPlayerAcceleration(runtime, player)
    : getPlayerDeceleration(runtime, player);
  const airControl = player.onGround ? 1 : getPlayerAirControl(runtime, player);
  const blend = clampNumber(controlBlend * deltaSeconds * airControl, 0, 1);
  const nextVelocity = {
    x: currentVelocity.x + (targetVelocityX - currentVelocity.x) * blend,
    y: currentVelocity.y,
    z: currentVelocity.z + (targetVelocityZ - currentVelocity.z) * blend,
  };
  player.onGround = raycastPlayerGround(runtime, player);
  if (mustFinite(player.jumpBufferedUntilMs, 0) >= nowMs && player.onGround) {
    nextVelocity.y = getPlayerJumpVelocity(runtime, player);
    player.onGround = false;
    player.jumpBufferedUntilMs = 0;
  }
  body.setLinvel(nextVelocity, true);
  body.setRotation(toRapierRotation(player.rotation), true);
}

function refreshTriggerOccupancy(runtime) {
  const activeBodies = [
    ...runtime.players.filter((entry) => entry.occupied_by_profile_id),
    ...runtime.dynamicObjects.filter((entry) => entry.visibility !== false),
  ];

  for (const zone of runtime.triggerZones) {
    const previous = new Set(zone.currentOccupants);
    const next = new Set();

    for (const entry of activeBodies) {
      if (isPointInsideZone(entry.position, zone)) {
        next.add(entry.id);
      }
    }

    for (const entryId of next) {
      if (!previous.has(entryId)) {
        executeMatchingRules(runtime, "zone_enter", (rule) => !rule.source_id || rule.source_id === zone.id);
      }
    }
    for (const entryId of previous) {
      if (!next.has(entryId)) {
        executeMatchingRules(runtime, "zone_exit", (rule) => !rule.source_id || rule.source_id === zone.id);
      }
    }

    zone.currentOccupants = next;
  }
}

function seedSceneRuntime(sceneRow, { sceneStarted = false, status = "active", runtimeState = {}, tick = 0, elapsedMs = 0 } = {}) {
  const compiledResolvedSceneDoc = sceneRow?.compiled_doc?.runtime?.resolved_scene_doc ?? null;
  const resolvedSceneDoc = compiledResolvedSceneDoc ?? sceneRow?.scene_doc ?? {};
  const sceneDoc = normalizeSceneDoc(resolvedSceneDoc, {
    preserveNormalizedIds: compiledResolvedSceneDoc != null,
  });
  const entityAliases = buildSceneEntityAliasMap(sceneRow?.scene_doc ?? {}, normalizeSceneDoc(sceneRow?.scene_doc ?? {}));
  for (const entry of [
    ...(sceneDoc.voxels ?? []),
    ...(sceneDoc.primitives ?? []),
    ...(sceneDoc.panels ?? []),
    ...(sceneDoc.models ?? []),
    ...(sceneDoc.screens ?? []),
    ...(sceneDoc.players ?? []),
    ...(sceneDoc.texts ?? []),
    ...(sceneDoc.trigger_zones ?? []),
    ...(sceneDoc.prefab_instances ?? []),
    ...(sceneDoc.particles ?? []),
  ]) {
    entityAliases.set(entry.id, entry.id);
  }
  const compiledScriptConfig = sceneRow?.compiled_doc?.runtime?.script_config ?? null;
  const fallbackCompile = compiledScriptConfig
    ? null
    : compileSharedPrivateWorldScriptDsl(sceneDoc.script_dsl ?? "", {
      sceneDoc,
      entityAliases,
    });
  const scriptConfig = cloneJson(compiledScriptConfig ?? fallbackCompile?.script_config ?? null);
  const gravity = vec3(scriptConfig?.world_physics?.params?.gravity ?? sceneDoc.settings?.gravity, { x: 0, y: -9.8, z: 0 });
  const authoredPlayerIds = normalizeSceneDoc(sceneRow?.scene_doc ?? {}).players.map((entry) => entry.id);
  const staticSolids = (sceneDoc.voxels ?? []).map((entry) => ({
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    position: vec3(entry.position),
    halfExtents: {
      x: Math.max(0.1, mustFinite(entry.scale?.x, 1) / 2),
      y: Math.max(0.1, mustFinite(entry.scale?.y, 1) / 2),
      z: Math.max(0.1, mustFinite(entry.scale?.z, 1) / 2),
    },
  }));
  const players = (sceneDoc.players ?? []).map((entry) => {
    const scale = Math.max(0.25, mustFinite(entry.scale, PRIVATE_WORLD_BLOCK_UNIT));
    const initialPosition = vec3(entry.position, { x: 0, y: (PLAYER_DIMENSIONS.height * scale) / 2, z: 0 });
    const canonicalId = authoredPlayerIds.length > 0
      ? (resolveEntityIdAlias("player", entry.id, authoredPlayerIds) ?? entry.id)
      : entry.id;
    return {
      kind: "player",
      id: canonicalId,
      label: entry.label,
      scale,
      asset_id: entry.asset_id ?? null,
      material: cloneJson(entry.material ?? {}),
      camera_mode: entry.camera_mode,
      fixed_top_down_direction: String(entry.fixed_top_down_direction ?? "north").trim().toLowerCase() || "north",
      fixed_top_down_angle: mustFinite(entry.fixed_top_down_angle, 90),
      fixed_top_down_distance: mustFinite(entry.fixed_top_down_distance, DEFAULT_PLAYER_ORTHOGONAL_DISTANCE),
      fixed_top_down_width: mustFinite(entry.fixed_top_down_width, 0),
      fixed_top_down_height: mustFinite(entry.fixed_top_down_height, 0),
      movement_enabled: entry.movement_enabled !== false,
      jump_enabled: entry.jump_enabled === true,
      body_mode: entry.body_mode,
      occupiable: entry.occupiable !== false,
      initialPosition,
      initialRotation: vec3(entry.rotation),
      position: vec3(entry.position, initialPosition),
      rotation: vec3(entry.rotation),
      velocity: { x: 0, y: 0, z: 0 },
      angular_velocity: { x: 0, y: 0, z: 0 },
      groundPositionY: initialPosition.y,
      onGround: entry.body_mode === "ghost",
      sleeping: false,
      occupied_by_profile_id: null,
      occupied_by_username: null,
      occupied_by_display_name: null,
      ready: false,
      pressedKeys: new Set(),
      visibility: true,
      material_override: null,
      last_client_motion_seq: 0,
      jumpBufferedUntilMs: 0,
      client_replication_pose: null,
      client_replication_updated_at_ms: 0,
      last_client_replication_seq: 0,
    };
  });
  const dynamicObjects = (sceneDoc.primitives ?? []).map((entry) => ({
    kind: "dynamic_object",
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    entity_kind: "primitive",
    asset_id: entry.asset_id ?? null,
    shape: entry.shape,
    scale: cloneJson(entry.scale),
    collider_scale: cloneJson(entry.scale),
    position: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    initialPosition: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: vec3(entry.rotation),
    velocity: { x: 0, y: 0, z: 0 },
    angular_velocity: { x: 0, y: 0, z: 0 },
    sleeping: false,
    authority_owner_profile_id: null,
    authority_owner_username: null,
    authority_lease_until_ms: 0,
    last_client_interaction_seq: 0,
    rigid_mode: entry.rigid_mode,
    physics: cloneJson(entry.physics ?? {}),
    visibility: true,
    material_override: null,
    material: cloneJson(entry.material ?? {}),
  })).concat((sceneDoc.models ?? []).map((entry) => ({
    kind: "dynamic_object",
    instance_id: entry.instance_id ?? null,
    entity_kind: "model",
    id: entry.id,
    asset_id: entry.asset_id ?? null,
    shape: "box",
    scale: cloneJson(entry.scale),
    bounds: cloneJson(entry.bounds ?? { x: 1, y: 1, z: 1 }),
    collider_scale: {
      x: Math.max(0.1, mustFinite(entry.scale?.x, 1) * mustFinite(entry.bounds?.x, 1)),
      y: Math.max(0.1, mustFinite(entry.scale?.y, 1) * mustFinite(entry.bounds?.y, 1)),
      z: Math.max(0.1, mustFinite(entry.scale?.z, 1) * mustFinite(entry.bounds?.z, 1)),
    },
    position: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    initialPosition: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: vec3(entry.rotation),
    velocity: { x: 0, y: 0, z: 0 },
    angular_velocity: { x: 0, y: 0, z: 0 },
    sleeping: false,
    authority_owner_profile_id: null,
    authority_owner_username: null,
    authority_lease_until_ms: 0,
    last_client_interaction_seq: 0,
    rigid_mode: entry.rigid_mode,
    physics: cloneJson(entry.physics ?? {}),
    visibility: true,
    material_override: null,
    material: cloneJson(entry.material ?? {}),
  })));
  const triggerZones = (sceneDoc.trigger_zones ?? []).map((entry) => ({
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    label: entry.label,
    position: vec3(entry.position, { x: 0, y: 0.5, z: 0 }),
    halfExtents: {
      x: Math.max(0.1, mustFinite(entry.scale?.x, 2) / 2),
      y: Math.max(0.1, mustFinite(entry.scale?.y, 2) / 2),
      z: Math.max(0.1, mustFinite(entry.scale?.z, 2) / 2),
    },
    currentOccupants: new Set(),
  }));
  const particleState = Object.fromEntries((sceneDoc.particles ?? []).map((entry) => [entry.id, {
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    effect: entry.effect,
    target_id: entry.target_id,
    color: entry.color,
    enabled: entry.enabled !== false,
  }]));
  const screenState = Object.fromEntries((sceneDoc.screens ?? []).map((entry) => [entry.id, {
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    position: cloneJson(entry.position),
    rotation: cloneJson(entry.rotation),
    scale: cloneJson(entry.scale),
    material: cloneJson(entry.material),
    facing_mode: entry.facing_mode,
    html: entry.html,
    html_hash: entry.html_hash,
    state: cloneJson(entry.state ?? {}),
    assets: cloneJson(entry.assets ?? {}),
  }]));
  const textState = Object.fromEntries((sceneDoc.texts ?? []).map((entry) => [entry.id, {
    id: entry.id,
    instance_id: entry.instance_id ?? null,
    value: entry.value,
  }]));
  const prefabInstances = (sceneDoc.prefab_instances ?? []).map((entry) => ({
    kind: "prefab_instance",
    id: entry.id,
    label: entry.label,
    prefab_id: entry.prefab_id,
    position: vec3(entry.position),
    initialPosition: vec3(entry.position),
    rotation: vec3(entry.rotation),
    scale: cloneJson(entry.scale ?? { x: 1, y: 1, z: 1 }),
    velocity: { x: 0, y: 0, z: 0 },
    visibility: entry.overrides?.visible !== false,
    material_override: cloneJson(entry.overrides?.material ?? null),
    dynamic_object_ids: dynamicObjects
      .filter((candidate) => candidate.instance_id === entry.id)
      .map((candidate) => candidate.id),
    voxel_ids: staticSolids
      .filter((candidate) => candidate.instance_id === entry.id)
      .map((candidate) => candidate.id),
    trigger_zone_ids: triggerZones
      .filter((candidate) => candidate.instance_id === entry.id)
      .map((candidate) => candidate.id),
  }));
  const runtime = {
    sceneRowId: sceneRow?.id ?? null,
    sceneName: sceneRow?.name ?? "Scene",
    sceneVersion: mustFinite(sceneRow?.version, 0),
    sceneUpdatedAt: sceneRow?.updated_at ?? sceneRow?.created_at ?? null,
    sourceSceneDoc: sceneRow?.scene_doc ?? null,
    sceneDoc,
    scriptConfig,
    rules: buildSceneRules(sceneRow, sceneDoc),
    gravity,
    startOnReady: sceneDoc.settings?.start_on_ready !== false,
    sceneStarted,
    status,
    tick,
    elapsedMs,
    startedAt: runtimeState.started_at ?? null,
    startedByProfileId: runtimeState.started_by_profile_id ?? null,
    staticSolids,
    players,
    dynamicObjects,
    prefabInstances,
    triggerZones,
    ruleState: {
      firedRuleIds: new Set(),
      sceneStartFired: sceneStarted === true && elapsedMs > 0,
    },
    particleState,
    screenState,
    textState,
    recentEvents: [],
    commandQueue: [],
    scriptedPlatformMotions: new Map(),
    scriptRuntimeState: {
      lastErrorByFunctionId: new Map(),
    },
    physics: null,
  };
  initializeRapierRuntime(runtime);
  return runtime;
}

function syncParticipantOccupancy(simulation, participants = []) {
  const runtimePlayerIds = simulation.players.map((entry) => entry.id).filter(Boolean);
  const occupiedByEntityId = new Map(
    participants
      .filter((entry) => entry.join_role === "player" && entry.player_entity_id)
      .map((entry) => {
        const resolvedPlayerId = resolveEntityIdAlias("player", entry.player_entity_id, runtimePlayerIds);
        return resolvedPlayerId ? [resolvedPlayerId, entry] : null;
      })
      .filter(Boolean),
  );
  const occupiedProfileIds = new Set(
    participants
      .map((entry) => String(entry?.profile_id ?? "").trim())
      .filter(Boolean),
  );

  for (const player of simulation.players) {
    const previousOccupiedByProfileId = player.occupied_by_profile_id;
    const participant = occupiedByEntityId.get(player.id) ?? null;
    player.occupied_by_profile_id = participant?.profile_id ?? null;
    player.occupied_by_username = participant?.profile?.username ?? null;
    player.occupied_by_display_name = participant?.profile?.display_name ?? participant?.display_name ?? null;
    player.ready = participant?.ready_state?.ready === true;
    if (!player.occupied_by_profile_id || player.occupied_by_profile_id !== previousOccupiedByProfileId) {
      clearClientReplicatedPose(player);
    }
    if (!player.occupied_by_profile_id) {
      player.pressedKeys.clear();
      player.ready = false;
    }
  }

  for (const entry of simulation.dynamicObjects ?? []) {
    const ownerProfileId = String(entry.authority_owner_profile_id ?? "").trim();
    if (ownerProfileId && !occupiedProfileIds.has(ownerProfileId)) {
      clearDynamicObjectAuthority(entry);
    }
  }

  syncRapierOccupancy(simulation);
}

function preserveRebuiltOccupiedPlayerState(nextRuntime, previousRuntime = null) {
  if (!nextRuntime || !previousRuntime) {
    return;
  }
  const previousPlayersById = new Map(
    (previousRuntime.players ?? [])
      .filter((entry) => entry?.id)
      .map((entry) => [entry.id, entry]),
  );
  for (const player of nextRuntime.players ?? []) {
    const previousPlayer = previousPlayersById.get(player.id);
    if (!previousPlayer?.occupied_by_profile_id) {
      continue;
    }
    player.position = vec3(previousPlayer.position, player.position);
    player.rotation = vec3(previousPlayer.rotation, player.rotation);
    player.velocity = vec3(previousPlayer.velocity, player.velocity);
    player.angular_velocity = vec3(previousPlayer.angular_velocity, player.angular_velocity);
    player.groundPositionY = mustFinite(previousPlayer.groundPositionY, player.groundPositionY);
    player.onGround = previousPlayer.onGround === true;
    player.sleeping = previousPlayer.sleeping === true;
    player.usesLookHeading = previousPlayer.usesLookHeading === true;
    player.last_client_motion_seq = Math.max(0, Number(previousPlayer.last_client_motion_seq ?? 0) || 0);
    player.jumpBufferedUntilMs = Math.max(0, Number(previousPlayer.jumpBufferedUntilMs ?? 0) || 0);
    player.pressedKeys = previousPlayer.pressedKeys instanceof Set
      ? new Set(previousPlayer.pressedKeys)
      : new Set();
    player.occupied_by_profile_id = previousPlayer.occupied_by_profile_id ?? null;
    player.occupied_by_username = previousPlayer.occupied_by_username ?? null;
    player.occupied_by_display_name = previousPlayer.occupied_by_display_name ?? null;
    player.ready = previousPlayer.ready === true;
    player.client_replication_pose = cloneJson(previousPlayer.client_replication_pose);
    player.client_replication_updated_at_ms = Math.max(
      0,
      Number(previousPlayer.client_replication_updated_at_ms ?? 0) || 0,
    );
    player.last_client_replication_seq = Math.max(
      0,
      Number(previousPlayer.last_client_replication_seq ?? 0) || 0,
    );
    const body = nextRuntime.physics?.playerBodies?.get(player.id) ?? null;
    if (!body) {
      continue;
    }
    if (player.body_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
      body.setNextKinematicTranslation(player.position);
    }
    body.setTranslation(player.position, true);
    body.setLinvel(player.velocity, true);
    body.setRotation(toRapierRotation(player.rotation), true);
    if (player.sleeping === true) {
      body.sleep?.();
    } else {
      body.wakeUp?.();
    }
  }
}

export function createPrivateWorldSimulationState(input = {}) {
  const runtime = seedSceneRuntime(input.sceneRow, {
    sceneStarted: input.sceneStarted === true,
    status: input.status ?? "active",
    runtimeState: input.runtimeState ?? {},
    tick: mustFinite(input.tick, 0),
    elapsedMs: mustFinite(input.elapsedMs, 0),
  });
  const simulation = {
    worldId: String(input.worldId ?? "").trim(),
    creatorUsername: String(input.creatorUsername ?? "").trim().toLowerCase(),
    instanceId: String(input.instanceId ?? "").trim(),
    activeSceneId: String(input.activeSceneId ?? input.sceneRow?.id ?? "").trim(),
    runtime,
    scenesById: new Map(
      (Array.isArray(input.scenes) ? input.scenes : [])
        .filter((entry) => entry?.id)
        .map((entry) => [entry.id, entry]),
    ),
    recentEvents: runtime.recentEvents,
    lastTickAt: mustFinite(input.lastTickAt, Date.now()),
    lastBroadcastAt: 0,
    pendingInputs: [],
  };
  syncParticipantOccupancy(simulation.runtime, input.participants ?? []);
  return simulation;
}

export function shouldRebuildPrivateWorldRuntime(runtime, activeScene, {
  nextStatus = runtime?.status ?? "active",
  nextSceneStarted = runtime?.sceneStarted === true,
} = {}) {
  if (!runtime || !activeScene?.id) {
    return true;
  }
  const activeSceneUpdatedAt = activeScene.updated_at ?? activeScene.created_at ?? null;
  const activeSceneVersion = activeScene?.version == null ? null : mustFinite(activeScene.version, 0);
  const runtimeSceneVersion = runtime?.sceneVersion == null ? null : mustFinite(runtime.sceneVersion, 0);
  return (
    runtime.sceneRowId !== activeScene.id
    || (runtimeSceneVersion != null && activeSceneVersion != null && runtimeSceneVersion !== activeSceneVersion)
    || runtime.sceneUpdatedAt !== activeSceneUpdatedAt
    || (runtime.status === "started" && nextStatus !== "started")
    || (runtime.sceneStarted === true && nextSceneStarted !== true)
  );
}

function executeRuleAction(simulation, rule, context = {}) {
  const markRuleFired = () => {
    if (context.oneShot === true) {
      simulation.ruleState.firedRuleIds.add(rule.id);
    }
  };
  const targetId = String(rule.target_id ?? rule.payload?.target_id ?? rule.payload?.targetId ?? "").trim() || null;
  const prefabTarget = findPrefabInstanceTarget(simulation, targetId);
  if (rule.action === "apply_force") {
    const target = findTargetBody(simulation, targetId);
    if (target) {
      const force = vec3(rule.payload?.force, { x: 0, y: 0, z: 0 });
      if (rule.payload?.force_direction === "player_facing" && context.actorPlayer) {
        const magnitude = mustFinite(rule.payload?.force_magnitude, 0);
        const forward = getHeadingForwardVector(context.actorPlayer.rotation?.y);
        force.x += forward.x * magnitude;
        force.z += forward.z * magnitude;
      }
      const body = simulation.physics?.playerBodies?.get(target.id)
        ?? simulation.physics?.objectBodies?.get(target.id)
        ?? null;
      if (body && typeof body.applyImpulse === "function") {
        body.applyImpulse(force, true);
      }
      target.velocity = {
        x: mustFinite(target.velocity?.x, 0) + force.x,
        y: mustFinite(target.velocity?.y, 0) + force.y,
        z: mustFinite(target.velocity?.z, 0) + force.z,
      };
      pushRuntimeEvent(simulation, {
        type: "apply_force",
        rule_id: rule.id,
        target_id: target.id,
        source_player_id: String(context.actorPlayer?.id ?? "").trim() || undefined,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "teleport") {
    const target = findTargetBody(simulation, targetId);
    if (prefabTarget) {
      const nextPosition = vec3(rule.payload?.position, prefabTarget.position);
      applyPrefabInstancePose(simulation, prefabTarget, {
        position: nextPosition,
        zeroVelocity: true,
      });
      pushRuntimeEvent(simulation, {
        type: "teleport",
        rule_id: rule.id,
        target_id: prefabTarget.id,
      });
    } else if (target) {
      const nextPosition = vec3(rule.payload?.position, target.position);
      const body = simulation.physics?.playerBodies?.get(target.id)
        ?? simulation.physics?.objectBodies?.get(target.id)
        ?? null;
      target.position = nextPosition;
      target.velocity = { x: 0, y: 0, z: 0 };
      if (body) {
        body.setTranslation(nextPosition, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      pushRuntimeEvent(simulation, {
        type: "teleport",
        rule_id: rule.id,
        target_id: target.id,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "move_platform") {
    const target = prefabTarget ?? simulation.dynamicObjects.find((entry) => entry.id === targetId) ?? null;
    if (target && registerScriptedPlatformMotion(simulation, target, rule.payload)) {
      pushRuntimeEvent(simulation, {
        type: "move_platform",
        rule_id: rule.id,
        target_id: target.id,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "set_material") {
    const target = findTargetBody(simulation, targetId);
    if (prefabTarget) {
      const nextMaterial = cloneJson(rule.payload?.material ?? {});
      prefabTarget.material_override = nextMaterial;
      for (const dynamicObjectId of prefabTarget.dynamic_object_ids ?? []) {
        const dynamicObject = simulation.dynamicObjects.find((entry) => entry.id === dynamicObjectId) ?? null;
        if (dynamicObject) {
          dynamicObject.material_override = cloneJson(nextMaterial);
        }
      }
      pushRuntimeEvent(simulation, {
        type: "set_material",
        rule_id: rule.id,
        target_id: prefabTarget.id,
      });
    } else if (target) {
      target.material_override = cloneJson(rule.payload?.material ?? {});
      pushRuntimeEvent(simulation, {
        type: "set_material",
        rule_id: rule.id,
        target_id: target.id,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "set_visibility") {
    const target = findTargetBody(simulation, targetId);
    if (prefabTarget) {
      prefabTarget.visibility = rule.payload?.visible !== false;
      for (const dynamicObjectId of prefabTarget.dynamic_object_ids ?? []) {
        const dynamicObject = simulation.dynamicObjects.find((entry) => entry.id === dynamicObjectId) ?? null;
        if (dynamicObject) {
          dynamicObject.visibility = prefabTarget.visibility;
        }
      }
      pushRuntimeEvent(simulation, {
        type: "set_visibility",
        rule_id: rule.id,
        target_id: prefabTarget.id,
        visible: prefabTarget.visibility,
      });
    } else if (target) {
      target.visibility = rule.payload?.visible !== false;
      pushRuntimeEvent(simulation, {
        type: "set_visibility",
        rule_id: rule.id,
        target_id: target.id,
        visible: target.visibility,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "toggle_particles") {
    const targetParticleId = targetId || String(rule.payload?.particle_id ?? rule.payload?.particleId ?? "").trim() || null;
    if (targetParticleId && simulation.particleState[targetParticleId]) {
      const enabled = typeof rule.payload?.enabled === "boolean"
        ? rule.payload.enabled
        : !simulation.particleState[targetParticleId].enabled;
      simulation.particleState[targetParticleId].enabled = enabled;
      pushRuntimeEvent(simulation, {
        type: "toggle_particles",
        rule_id: rule.id,
        particle_id: targetParticleId,
        enabled,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "set_text") {
    const targetTextId = targetId || String(rule.payload?.text_id ?? rule.payload?.textId ?? "").trim() || null;
    if (targetTextId && simulation.textState[targetTextId]) {
      simulation.textState[targetTextId].value = String(rule.payload?.value ?? rule.payload?.text ?? "").slice(0, 160);
      pushRuntimeEvent(simulation, {
        type: "set_text",
        rule_id: rule.id,
        text_id: targetTextId,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "set_screen_state") {
    const targetScreenId = targetId || String(rule.payload?.screen_id ?? rule.payload?.screenId ?? "").trim() || null;
    const path = String(rule.payload?.path ?? rule.payload?.state_path ?? rule.payload?.statePath ?? "").trim();
    const targetScreen = targetScreenId ? simulation.screenState?.[targetScreenId] : null;
    if (targetScreen && path) {
      setRuntimeObjectPathValue(
        targetScreen.state,
        path,
        sanitizeRuntimeScreenStateValue(rule.payload?.value),
      );
      pushRuntimeEvent(simulation, {
        type: "set_screen_state",
        rule_id: rule.id,
        screen_id: targetScreenId,
        path,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "switch_scene") {
    const sceneId = parseRuleSceneTarget(rule);
    if (sceneId) {
      simulation.commandQueue.push({
        type: "switch_scene",
        sceneId,
        sourceRuleId: rule.id,
      });
      pushRuntimeEvent(simulation, {
        type: "switch_scene",
        rule_id: rule.id,
        scene_id: sceneId,
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "start_scene") {
    if (!simulation.sceneStarted) {
      simulation.sceneStarted = true;
      simulation.status = "started";
      simulation.startedAt = nowIso();
      simulation.commandQueue.push({
        type: "scene_started",
        sourceRuleId: rule.id,
      });
      pushRuntimeEvent(simulation, {
        type: "scene_started",
        rule_id: rule.id,
      });
    }
    markRuleFired();
    return;
  }

  markRuleFired();
}

function executeMatchingRules(simulation, trigger, predicate = () => true, context = {}) {
  const matchingRules = (simulation.rules ?? []).filter((rule) => rule.trigger === trigger && predicate(rule));
  for (const rule of matchingRules) {
    executeRuleAction(simulation, rule, context);
  }
}

function doesRuleKeyMatchInput(simulation, rule = {}, edgeKey = "", actorPlayer = null) {
  const normalizedEdgeKey = String(edgeKey ?? "").trim().toLowerCase();
  if (!rule?.key) {
    return true;
  }
  if (rule.key_binding_ref && actorPlayer) {
    return getPlayerBindingToken(simulation, actorPlayer, rule.key_binding_ref, "") === normalizedEdgeKey;
  }
  return String(rule.key).trim().toLowerCase() === normalizedEdgeKey;
}

export function stepPrivateWorldSimulation(simulation, options = {}) {
  const deltaSeconds = clampNumber(mustFinite(options.deltaMs, DEFAULT_TICK_MS) / 1000, 0.001, MAX_DELTA_SECONDS);
  const inputEdgesByPlayerId = new Map();
  const pendingInputs = Array.isArray(options.pendingInputs) ? options.pendingInputs : [];
  simulation.currentStepStartElapsedMs = simulation.elapsedMs;
  const preStepBodyState = collectPreStepBodyState(simulation);
  releaseExpiredDynamicAuthorities(simulation);
  for (const input of pendingInputs) {
    const player = simulation.players.find((entry) => entry.id === input.playerId);
    if (!player || !player.occupied_by_profile_id) {
      continue;
    }
    const headingY = Number(input.headingY ?? input.heading_y);
    if (Number.isFinite(headingY)) {
      setPlayerLookHeading(player, headingY);
      player.usesLookHeading = true;
    }
    const key = String(input.key ?? "").trim().toLowerCase();
    if (!key) {
      continue;
    }
    if (!inputEdgesByPlayerId.has(player.id)) {
      inputEdgesByPlayerId.set(player.id, []);
    }
    inputEdgesByPlayerId.get(player.id).push({
      key,
      state: input.state === "up" ? "up" : "down",
    });
    if (input.state === "up") {
      player.pressedKeys.delete(key);
    } else {
      player.pressedKeys.add(key);
    }
  }

  const occupiedPlayers = simulation.players.filter((entry) => entry.occupied_by_profile_id);
  const allPlayersReady = occupiedPlayers.length > 0 && occupiedPlayers.every((entry) => entry.ready === true);

  if (!simulation.sceneStarted && simulation.startOnReady && allPlayersReady) {
    simulation.sceneStarted = true;
    simulation.status = "started";
    simulation.startedAt = nowIso();
    simulation.commandQueue.push({ type: "scene_started", sourceRuleId: "auto:start_on_ready" });
    pushRuntimeEvent(simulation, {
      type: "scene_started",
      sourceRuleId: "auto:start_on_ready",
    });
  }
  simulation.tick += 1;
  simulation.elapsedMs += deltaSeconds * 1000;

  if (simulation.sceneStarted === true && simulation.ruleState.sceneStartFired !== true) {
    for (const rule of simulation.rules ?? []) {
      if (rule.trigger !== "scene_start" || simulation.ruleState.firedRuleIds.has(rule.id)) {
        continue;
      }
      executeRuleAction(simulation, rule, { oneShot: true });
    }
    simulation.ruleState.sceneStartFired = true;
  }

  syncRapierOccupancy(simulation);

  for (const player of occupiedPlayers) {
    const inputEdges = inputEdgesByPlayerId.get(player.id) ?? [];
    applyPlayerMovement(player, inputEdges, deltaSeconds, simulation);
    for (const edge of inputEdges) {
      if (edge.state !== "down") {
        continue;
      }
      executeMatchingRules(
        simulation,
        "key_press",
        (rule) => (
          doesRuleKeyMatchInput(simulation, rule, edge.key, player)
          && (!rule.source_id || rule.source_id === player.id)
        ),
        { actorPlayer: player },
      );
    }
  }

  if (simulation.physics?.world) {
    advanceScriptedPlatformMotions(simulation, deltaSeconds);
    simulation.physics.world.gravity = toRapierVector(simulation.gravity);
    simulation.physics.world.timestep = deltaSeconds;
    simulation.physics.world.step(simulation.physics.eventQueue);

    for (const player of simulation.players) {
      syncEntryFromRapierBody(player, simulation.physics.playerBodies.get(player.id));
      player.onGround = player.body_mode === "ghost"
        ? isGhostPlayerGrounded(player)
        : raycastPlayerGround(simulation, player);
    }

    for (const object of simulation.dynamicObjects) {
      syncEntryFromRapierBody(object, simulation.physics.objectBodies.get(object.id));
    }

    carryPlatformRiders(simulation, preStepBodyState, deltaSeconds);
  }

  executeRuntimeScripts(simulation, deltaSeconds);

  refreshTriggerOccupancy(simulation);

  for (const rule of simulation.rules ?? []) {
    if (rule.trigger !== "timer") {
      continue;
    }
    if (simulation.ruleState.firedRuleIds.has(rule.id)) {
      continue;
    }
    const delayMs = mustFinite(rule.delay_ms, 0);
    if (simulation.elapsedMs >= delayMs) {
      executeRuleAction(simulation, rule, { oneShot: true });
    }
  }

  if (allPlayersReady) {
    for (const rule of simulation.rules ?? []) {
      if (rule.trigger !== "all_players_ready" || simulation.ruleState.firedRuleIds.has(rule.id)) {
        continue;
      }
      executeRuleAction(simulation, rule, { oneShot: true });
    }
  }

  simulation.currentStepStartElapsedMs = simulation.elapsedMs;
  return simulation;
}

export function buildPrivateWorldRuntimeSnapshot(simulation) {
  if (!simulation) {
    return null;
  }
  const runtime = simulation.runtime ?? simulation;
  const publicDynamicObjects = runtime.dynamicObjects.filter((entry) => !entry.instance_id);
  const publicTriggerZones = runtime.triggerZones.filter((entry) => !entry.instance_id);
  const publicParticles = Object.values(runtime.particleState).filter((entry) => !entry.instance_id);
  const publicScreens = Object.values(runtime.screenState ?? {}).filter((entry) => !entry.instance_id);
  const publicTexts = Object.values(runtime.textState).filter((entry) => !entry.instance_id);
  return {
    instance_id: simulation.instanceId ?? null,
    active_scene_id: simulation.activeSceneId ?? null,
    scene_name: runtime.sceneName ?? null,
    scene_version: runtime.sceneVersion,
    scene_updated_at: runtime.sceneUpdatedAt ?? null,
    script_config: cloneJson(runtime.scriptConfig ?? null),
    status: runtime.status,
    scene_started: runtime.sceneStarted === true,
    tick: runtime.tick,
    elapsed_ms: Number(runtime.elapsedMs.toFixed(0)),
    started_at: runtime.startedAt ?? null,
    prefab_instances: runtime.prefabInstances.map((entry) => ({
      id: entry.id,
      label: entry.label,
      prefab_id: entry.prefab_id,
      position: cloneJson(entry.position),
      rotation: cloneJson(entry.rotation),
      scale: cloneJson(entry.scale),
      velocity: cloneJson(entry.velocity),
      visible: entry.visibility !== false,
      material_override: cloneJson(entry.material_override),
    })),
    players: runtime.players.map((entry) => {
      const replicatedPose = getFreshClientReplicatedPose(entry);
      return {
        id: entry.id,
        label: entry.label,
        scale: entry.scale,
        asset_id: entry.asset_id ?? null,
        position: cloneJson(replicatedPose?.position ?? entry.position),
        rotation: cloneJson(replicatedPose?.rotation ?? entry.rotation),
        velocity: cloneJson(replicatedPose?.velocity ?? entry.velocity),
        angular_velocity: cloneJson(entry.angular_velocity),
        camera_mode: entry.camera_mode,
        fixed_top_down_direction: String(entry.fixed_top_down_direction ?? "north").trim().toLowerCase() || "north",
        fixed_top_down_angle: mustFinite(entry.fixed_top_down_angle, 90),
        fixed_top_down_distance: mustFinite(entry.fixed_top_down_distance, DEFAULT_PLAYER_ORTHOGONAL_DISTANCE),
        fixed_top_down_width: mustFinite(entry.fixed_top_down_width, 0),
        fixed_top_down_height: mustFinite(entry.fixed_top_down_height, 0),
        movement_enabled: entry.movement_enabled !== false,
        jump_enabled: entry.jump_enabled === true,
        body_mode: entry.body_mode,
        occupiable: entry.occupiable !== false,
        occupied_by_profile_id: entry.occupied_by_profile_id,
        occupied_by_username: entry.occupied_by_username,
        occupied_by_display_name: entry.occupied_by_display_name,
        ready: entry.ready === true,
        on_ground: entry.onGround === true,
        sleeping: entry.sleeping === true,
        visible: entry.visibility !== false,
        material: cloneJson(entry.material),
        material_override: cloneJson(entry.material_override),
      };
    }),
    dynamic_objects: publicDynamicObjects.map((entry) => ({
      id: entry.id,
      entity_kind: entry.entity_kind ?? "primitive",
      asset_id: entry.asset_id ?? null,
      shape: entry.shape,
      scale: cloneJson(entry.scale),
      bounds: cloneJson(entry.bounds ?? null),
      collider_scale: cloneJson(entry.collider_scale ?? entry.scale),
      position: cloneJson(entry.position),
      rotation: cloneJson(entry.rotation),
      velocity: cloneJson(entry.velocity),
      angular_velocity: cloneJson(entry.angular_velocity),
      sleeping: entry.sleeping === true,
      authority_owner_profile_id: entry.authority_owner_profile_id,
      authority_owner_username: entry.authority_owner_username,
      authority_lease_until_ms: Number(entry.authority_lease_until_ms ?? 0) || 0,
      rigid_mode: entry.rigid_mode,
      carry_riders: entry.physics?.carry_riders === true,
      visible: entry.visibility !== false,
      material: cloneJson(entry.material),
      material_override: cloneJson(entry.material_override),
    })),
    trigger_zones: publicTriggerZones.map((entry) => ({
      id: entry.id,
      label: entry.label,
      occupant_ids: [...entry.currentOccupants],
    })),
    particles: publicParticles.map((entry) => cloneJson(entry)),
    screens: publicScreens.map((entry) => cloneJson(entry)),
    texts: publicTexts.map((entry) => cloneJson(entry)),
    recent_events: cloneJson(runtime.recentEvents),
  };
}

async function maybeSingle(promise, message) {
  const { data, error } = await promise;
  if (error && error.code !== "PGRST116") {
    throw new HttpError(500, message, error.message);
  }
  return data ?? null;
}

async function must(promise, message) {
  const { data, error } = await promise;
  if (error) {
    throw new HttpError(500, message, error.message);
  }
  return data;
}

async function loadRuntimeWorldContext(store, worldId, creatorUsername) {
  const world = await maybeSingle(
    store.serviceClient.from("private_worlds").select("*").eq("world_id", worldId).maybeSingle(),
    "Could not load private world runtime world",
  );
  if (!world) {
    return null;
  }
  const creator = await maybeSingle(
    store.serviceClient.from("user_profiles").select("*").eq("id", world.creator_profile_id).maybeSingle(),
    "Could not load private world runtime creator",
  );
  if (!creator || String(creator.username ?? "").toLowerCase() !== String(creatorUsername ?? "").toLowerCase()) {
    throw new HttpError(404, "Private world creator username did not match the world id");
  }
  const instance = await maybeSingle(
    store.serviceClient.from("private_world_active_instances").select("*").eq("world_id", world.id).maybeSingle(),
    "Could not load private world runtime instance",
  );
  if (!instance) {
    return {
      world,
      creator,
      instance: null,
      scenes: [],
      participants: [],
    };
  }
  const scenes = await must(
    store.serviceClient.from("private_world_scenes").select("*").eq("world_id", world.id).order("created_at", { ascending: true }),
    "Could not load private world runtime scenes",
  );
  const participants = await must(
    store.serviceClient.from("private_world_participants").select("*").eq("instance_id", instance.id),
    "Could not load private world runtime participants",
  );
  const readyStates = await must(
    store.serviceClient.from("private_world_ready_states").select("*").eq("instance_id", instance.id),
    "Could not load private world runtime ready states",
  );
  const readyByParticipantId = new Map(readyStates.map((entry) => [entry.participant_id, entry]));
  const profileIds = [...new Set(participants.map((entry) => entry.profile_id).filter(Boolean))];
  const profiles = profileIds.length > 0
    ? await must(
        store.serviceClient.from("user_profiles").select("*").in("id", profileIds),
        "Could not load private world runtime profiles",
      )
    : [];
  const profileById = new Map(profiles.map((entry) => [entry.id, entry]));
  return {
    world,
    creator,
    instance,
    scenes,
    participants: participants.map((entry) => ({
      ...entry,
      profile: entry.profile_id ? profileById.get(entry.profile_id) ?? null : null,
      ready_state: readyByParticipantId.get(entry.id) ?? null,
    })),
  };
}

export class PrivateWorldRuntime {
  constructor(options = {}) {
    this.store = options.store;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.broadcastMs = options.broadcastMs ?? DEFAULT_BROADCAST_MS;
    this.instancesById = new Map();
    this.keysByWorldRef = new Map();
    this.interval = null;
  }

  getWorldRefKey(worldId, creatorUsername) {
    return `${String(creatorUsername ?? "").trim().toLowerCase()}::${String(worldId ?? "").trim()}`;
  }

  start() {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      void this.tickAll();
    }, this.tickMs);
    this.interval.unref?.();
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const simulation of this.instancesById.values()) {
      destroyPhysicsState(simulation.runtime?.physics);
    }
    this.instancesById.clear();
    this.keysByWorldRef.clear();
  }

  getSnapshotByWorldRef(worldId, creatorUsername) {
    const key = this.getWorldRefKey(worldId, creatorUsername);
    const instanceId = this.keysByWorldRef.get(key);
    if (!instanceId) {
      return null;
    }
    const simulation = this.instancesById.get(instanceId);
    return buildPrivateWorldRuntimeSnapshot(simulation);
  }

  removeWorldByReference(worldId, creatorUsername) {
    const key = this.getWorldRefKey(worldId, creatorUsername);
    const instanceId = this.keysByWorldRef.get(key);
    if (!instanceId) {
      return false;
    }
    const simulation = this.instancesById.get(instanceId);
    destroyPhysicsState(simulation?.runtime?.physics);
    this.instancesById.delete(instanceId);
    this.keysByWorldRef.delete(key);
    return true;
  }

  async syncWorldByReference({ worldId, creatorUsername } = {}) {
    const context = await loadRuntimeWorldContext(this.store, worldId, creatorUsername);
    if (!context?.world) {
      return null;
    }
    const key = this.getWorldRefKey(worldId, creatorUsername);
    if (!context.instance) {
      const staleInstanceId = this.keysByWorldRef.get(key);
      if (staleInstanceId) {
        const staleSimulation = this.instancesById.get(staleInstanceId);
        destroyPhysicsState(staleSimulation?.runtime?.physics);
        this.instancesById.delete(staleInstanceId);
      }
      this.keysByWorldRef.delete(key);
      return null;
    }

    const activeScene = context.scenes.find((entry) => entry.id === context.instance.active_scene_id)
      ?? context.scenes.find((entry) => entry.id === context.world.default_scene_id)
      ?? context.scenes[0]
      ?? null;
    if (!activeScene) {
      return null;
    }

    const runtimeState = cloneJson(context.instance.runtime_state ?? {});
    let simulation = this.instancesById.get(context.instance.id);
    if (!simulation) {
      simulation = createPrivateWorldSimulationState({
        worldId: context.world.world_id,
        creatorUsername: context.creator.username,
        instanceId: context.instance.id,
        activeSceneId: activeScene.id,
        sceneRow: activeScene,
        scenes: context.scenes,
        participants: context.participants,
        sceneStarted: context.instance.status === "started" || runtimeState.scene_started === true,
        status: context.instance.status,
        runtimeState,
        tick: mustFinite(runtimeState.tick, 0),
        elapsedMs: mustFinite(runtimeState.scene_elapsed_ms, 0),
      });
      this.instancesById.set(context.instance.id, simulation);
    } else {
      simulation.activeSceneId = activeScene.id;
      simulation.scenesById = new Map(context.scenes.map((entry) => [entry.id, entry]));
      const nextSceneStarted = context.instance.status === "started" || runtimeState.scene_started === true;
      if (shouldRebuildPrivateWorldRuntime(simulation.runtime, activeScene, {
        nextStatus: context.instance.status,
        nextSceneStarted,
      })) {
        const previousRuntime = simulation.runtime;
        destroyPhysicsState(previousRuntime.physics);
        simulation.runtime = seedSceneRuntime(activeScene, {
          sceneStarted: nextSceneStarted,
          status: context.instance.status,
          runtimeState,
          tick: mustFinite(runtimeState.tick, 0),
          elapsedMs: mustFinite(runtimeState.scene_elapsed_ms, 0),
        });
        if (previousRuntime.sceneRowId === activeScene.id) {
          preserveRebuiltOccupiedPlayerState(simulation.runtime, previousRuntime);
        }
      } else {
        simulation.runtime.status = context.instance.status;
        simulation.runtime.sceneStarted = nextSceneStarted;
      }
      syncParticipantOccupancy(simulation.runtime, context.participants);
    }

    this.keysByWorldRef.set(key, context.instance.id);
    return buildPrivateWorldRuntimeSnapshot(simulation);
  }

  async resetOccupiedPlayerToInitialPoseByReference({
    worldId,
    creatorUsername,
    profile,
    playerEntityId = "",
  } = {}) {
    const keyRef = this.getWorldRefKey(worldId, creatorUsername);
    let instanceId = this.keysByWorldRef.get(keyRef);
    let simulation = instanceId ? this.instancesById.get(instanceId) : null;
    if (!simulation) {
      const snapshot = await this.syncWorldByReference({ worldId, creatorUsername });
      if (!snapshot) {
        return null;
      }
      instanceId = this.keysByWorldRef.get(keyRef);
      simulation = instanceId ? this.instancesById.get(instanceId) : null;
    }
    if (!simulation) {
      return null;
    }

    const runtimePlayerIds = simulation.runtime.players.map((entry) => entry.id).filter(Boolean);
    const resolvedPlayerEntityId = resolveEntityIdAlias("player", playerEntityId, runtimePlayerIds);
    const occupiedPlayer = simulation.runtime.players.find((entry) => entry.occupied_by_profile_id === profile?.id)
      ?? (resolvedPlayerEntityId
        ? simulation.runtime.players.find((entry) => entry.id === resolvedPlayerEntityId) ?? null
        : null);
    if (!occupiedPlayer) {
      return null;
    }

    const nextPosition = vec3(occupiedPlayer.initialPosition, occupiedPlayer.position);
    const nextRotation = vec3(occupiedPlayer.initialRotation, occupiedPlayer.rotation);

    clearClientReplicatedPose(occupiedPlayer);
    occupiedPlayer.position = nextPosition;
    occupiedPlayer.rotation = nextRotation;
    occupiedPlayer.velocity = { x: 0, y: 0, z: 0 };
    occupiedPlayer.groundPositionY = nextPosition.y;
    occupiedPlayer.onGround = occupiedPlayer.body_mode === "ghost";
    occupiedPlayer.pressedKeys.clear();
    occupiedPlayer.usesLookHeading = Number.isFinite(Number(nextRotation.y));

    const body = simulation.runtime.physics?.playerBodies?.get(occupiedPlayer.id) ?? null;
    if (body) {
      if (occupiedPlayer.body_mode === "ghost" && typeof body.setNextKinematicTranslation === "function") {
        body.setNextKinematicTranslation(nextPosition);
      }
      body.setTranslation(nextPosition, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation(toRapierRotation(nextRotation), true);
      body.wakeUp?.();
    }

    return {
      player_entity_id: occupiedPlayer.id,
      position: cloneJson(nextPosition),
      heading_y: Number(normalizeAngle(mustFinite(nextRotation?.y, 0)).toFixed(6)),
    };
  }

  async syncOccupiedPlayerPoseByReference({
    worldId,
    creatorUsername,
    profile,
    position = null,
    position_x = null,
    position_y = null,
    position_z = null,
    velocity = null,
    velocity_x = null,
    velocity_y = null,
    velocity_z = null,
    headingY = null,
    heading_y = null,
    motion_seq = null,
    force_client_pose = false,
  } = {}) {
    const keyRef = this.getWorldRefKey(worldId, creatorUsername);
    let instanceId = this.keysByWorldRef.get(keyRef);
    let simulation = instanceId ? this.instancesById.get(instanceId) : null;
    if (!simulation) {
      const snapshot = await this.syncWorldByReference({ worldId, creatorUsername });
      if (!snapshot) {
        return { synced: false };
      }
      instanceId = this.keysByWorldRef.get(keyRef);
      simulation = instanceId ? this.instancesById.get(instanceId) : null;
    }
    if (!simulation) {
      return { synced: false };
    }
    const occupiedPlayer = simulation.runtime.players.find((entry) => entry.occupied_by_profile_id === profile?.id) ?? null;
    if (!occupiedPlayer) {
      return { synced: false };
    }
    const useClientAuthoritativePose = force_client_pose === true || isClientAuthoritativeRigidPlayer(occupiedPlayer);
    const syncedPose = applyOccupiedPlayerPose(simulation.runtime, occupiedPlayer, {
      position,
      position_x,
      position_y,
      position_z,
      velocity,
      velocity_x,
      velocity_y,
      velocity_z,
      motion_seq,
      headingY,
      heading_y,
      force_client_pose: useClientAuthoritativePose,
    });
    return {
      synced: true,
      ...syncedPose,
    };
  }

  async syncDynamicInteractionsByReference({
    worldId,
    creatorUsername,
    profile,
    interactionStates = [],
  } = {}) {
    const keyRef = this.getWorldRefKey(worldId, creatorUsername);
    let instanceId = this.keysByWorldRef.get(keyRef);
    let simulation = instanceId ? this.instancesById.get(instanceId) : null;
    if (!simulation) {
      const snapshot = await this.syncWorldByReference({ worldId, creatorUsername });
      if (!snapshot) {
        return {
          synced: false,
          accepted_object_ids: [],
          rejected_object_ids: [],
        };
      }
      instanceId = this.keysByWorldRef.get(keyRef);
      simulation = instanceId ? this.instancesById.get(instanceId) : null;
    }
    if (!simulation) {
      return {
        synced: false,
        accepted_object_ids: [],
        rejected_object_ids: [],
      };
    }
    const occupiedPlayer = simulation.runtime.players.find((entry) => entry.occupied_by_profile_id === profile?.id) ?? null;
    if (!occupiedPlayer) {
      throw new HttpError(403, "Only occupied player slots can drive dynamic interactions");
    }
    const result = applyDynamicInteractionStates(simulation.runtime, occupiedPlayer, profile, interactionStates);
    return {
      synced: true,
      ...result,
    };
  }

  async queueInputByReference({
    worldId,
    creatorUsername,
    profile,
    key,
    state,
    headingY = null,
    heading_y = null,
    position = null,
    position_x = null,
    position_y = null,
    position_z = null,
    velocity = null,
    velocity_x = null,
    velocity_y = null,
    velocity_z = null,
    motion_seq = null,
    force_client_pose = false,
  } = {}) {
    const keyRef = this.getWorldRefKey(worldId, creatorUsername);
    let instanceId = this.keysByWorldRef.get(keyRef);
    let simulation = instanceId ? this.instancesById.get(instanceId) : null;
    if (!simulation) {
      const snapshot = await this.syncWorldByReference({ worldId, creatorUsername });
      if (!snapshot) {
        throw new HttpError(404, "Private world runtime is not active");
      }
      instanceId = this.keysByWorldRef.get(keyRef);
      simulation = instanceId ? this.instancesById.get(instanceId) : null;
    }
    if (!simulation) {
      throw new HttpError(404, "Private world runtime is not active");
    }
    const occupiedPlayer = simulation.runtime.players.find((entry) => entry.occupied_by_profile_id === profile.id);
    if (!occupiedPlayer) {
      throw new HttpError(403, "Only occupied player slots can send runtime input");
    }
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    const resolvedHeadingY = Number(headingY ?? heading_y);
    const useClientAuthoritativePose = force_client_pose === true || isClientAuthoritativeRigidPlayer(occupiedPlayer);
    const hasClientPose = [
      position_x,
      position_y,
      position_z,
      velocity_x,
      velocity_y,
      velocity_z,
      position?.x,
      position?.y,
      position?.z,
      velocity?.x,
      velocity?.y,
      velocity?.z,
    ].some((value) => Number.isFinite(Number(value)));
    if (hasClientPose) {
      applyOccupiedPlayerPose(simulation.runtime, occupiedPlayer, {
        position,
        position_x,
        position_y,
        position_z,
        velocity,
        velocity_x,
        velocity_y,
        velocity_z,
        motion_seq,
        headingY: Number.isFinite(resolvedHeadingY) ? resolvedHeadingY : null,
        force_client_pose: useClientAuthoritativePose,
      });
    }
    if (!normalizedKey && !Number.isFinite(resolvedHeadingY)) {
      throw new HttpError(400, "Runtime input key or heading is required");
    }
    if (!normalizedKey) {
      if (Number.isFinite(resolvedHeadingY)) {
        setPlayerLookHeading(occupiedPlayer, resolvedHeadingY);
        occupiedPlayer.usesLookHeading = true;
      }
      return {
        accepted: true,
        player_entity_id: occupiedPlayer.id,
      };
    }
    if (
      normalizedKey === getPlayerJumpBinding(simulation.runtime, occupiedPlayer)
      && state !== "up"
      && !occupiedPlayer.pressedKeys.has(getPlayerJumpBinding(simulation.runtime, occupiedPlayer))
      && useClientAuthoritativePose !== true
    ) {
      primeQueuedPlayerJump(simulation.runtime, occupiedPlayer);
    }
    simulation.pendingInputs.push({
      playerId: occupiedPlayer.id,
      key: normalizedKey,
      state: state === "up" ? "up" : "down",
      headingY: Number.isFinite(resolvedHeadingY) ? Number(normalizeAngle(resolvedHeadingY).toFixed(6)) : null,
      at: nowIso(),
    });
    return {
      accepted: true,
      player_entity_id: occupiedPlayer.id,
    };
  }

  async tickAll() {
    const now = Date.now();
    for (const simulation of this.instancesById.values()) {
      const deltaMs = clampNumber(now - simulation.lastTickAt, 1, this.tickMs * 2);
      simulation.lastTickAt = now;
      const runtime = simulation.runtime;
      const pendingInputs = simulation.pendingInputs.splice(0);
      stepPrivateWorldSimulation(runtime, {
        deltaMs,
        pendingInputs,
      });
      await this.drainCommands(simulation);
      const activeDynamicAuthority = runtime.dynamicObjects.some((entry) => isDynamicObjectAuthorityActive(entry, now));
      const nextBroadcastMs = activeDynamicAuthority ? this.tickMs : this.broadcastMs;
      if (now - simulation.lastBroadcastAt >= nextBroadcastMs) {
        simulation.lastBroadcastAt = now;
        this.store.publishPrivateWorldEvent?.({
          type: "runtime:snapshot",
          world_id: simulation.worldId,
          creator_username: simulation.creatorUsername,
          instance_id: simulation.instanceId,
          snapshot: buildPrivateWorldRuntimeSnapshot(simulation),
        });
      }
    }
  }

  async drainCommands(simulation) {
    const commands = simulation.runtime.commandQueue.splice(0);
    for (const command of commands) {
      if (command.type === "scene_started") {
        await this.persistRuntimeState(simulation, {
          status: "started",
          sceneStarted: true,
        });
        continue;
      }
      if (command.type === "switch_scene") {
        await this.switchScene(simulation, command.sceneId, command.sourceRuleId);
      }
    }
  }

  async persistRuntimeState(simulation, { status = simulation.runtime.status, sceneStarted = simulation.runtime.sceneStarted } = {}) {
    simulation.runtime.status = status;
    simulation.runtime.sceneStarted = sceneStarted;
    const runtimeState = {
      active_scene_id: simulation.activeSceneId,
      scene_started: simulation.runtime.sceneStarted === true,
      started_at: simulation.runtime.startedAt,
      started_by_profile_id: simulation.runtime.startedByProfileId,
      scene_elapsed_ms: Math.round(simulation.runtime.elapsedMs),
      tick: simulation.runtime.tick,
    };
    await must(
      this.store.serviceClient
        .from("private_world_active_instances")
        .update({
          active_scene_id: simulation.activeSceneId,
          status,
          runtime_state: runtimeState,
          last_active_at: nowIso(),
        })
        .eq("id", simulation.instanceId),
      "Could not persist private world runtime state",
    );
  }

  async switchScene(simulation, sceneId, sourceRuleId = null) {
    const nextScene = simulation.scenesById.get(sceneId) ?? null;
    if (!nextScene) {
      return;
    }
    const occupiedParticipants = simulation.runtime.players
      .filter((entry) => entry.occupied_by_profile_id)
      .map((entry) => ({
        profile_id: entry.occupied_by_profile_id,
        profile: entry.occupied_by_username
          ? {
              username: entry.occupied_by_username,
              display_name: entry.occupied_by_display_name,
            }
          : null,
        join_role: "player",
        player_entity_id: entry.id,
        ready_state: {
          ready: entry.ready === true,
        },
      }));
    destroyPhysicsState(simulation.runtime.physics);
    simulation.activeSceneId = sceneId;
    simulation.runtime = seedSceneRuntime(nextScene, {
      sceneStarted: true,
      status: "started",
      runtimeState: {
        started_at: simulation.runtime.startedAt ?? nowIso(),
        started_by_profile_id: simulation.runtime.startedByProfileId ?? null,
      },
    });
    syncParticipantOccupancy(simulation.runtime, occupiedParticipants);
    pushRuntimeEvent(simulation.runtime, {
      type: "scene_switched",
      scene_id: sceneId,
      source_rule_id: sourceRuleId,
    });
    await this.persistRuntimeState(simulation, {
      status: "started",
      sceneStarted: true,
    });
    this.store.publishPrivateWorldEvent?.({
      type: "scene:switched",
      world_id: simulation.worldId,
      creator_username: simulation.creatorUsername,
      instance_id: simulation.instanceId,
      scene_id: sceneId,
      snapshot: buildPrivateWorldRuntimeSnapshot(simulation),
    });
  }
}

export function installPrivateWorldRuntime(store, options = {}) {
  const runtime = new PrivateWorldRuntime({
    store,
    tickMs: options.tickMs,
    broadcastMs: options.broadcastMs,
  });
  runtime.start();
  store.privateWorldRuntime = runtime;
  return runtime;
}
