import * as RAPIER from "@dimforge/rapier3d-compat/rapier.es.js";
import { HttpError } from "./http.js";
import { normalizeSceneDoc, resolveEntityIdAlias } from "./private-worlds.js";

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
const SCRIPTED_PLATFORM_MIN_DURATION_MS = 100;
const SCRIPTED_PLATFORM_MAX_DURATION_MS = 600000;
const SCRIPTED_PLATFORM_DEFAULT_DURATION_MS = 3000;
const PLATFORM_CARRY_DELTA_EPSILON = 0.0001;
const PLATFORM_CARRY_VERTICAL_TOLERANCE = 0.24;
const PLATFORM_CARRY_HORIZONTAL_BUFFER = 0.14;
const MAX_DELTA_SECONDS = 0.08;
const FLOOR_HALF_EXTENT = 4096;

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

function pushRuntimeEvent(simulation, event = {}) {
  simulation.recentEvents.unshift({
    at: nowIso(),
    ...cloneJson(event),
  });
  simulation.recentEvents = simulation.recentEvents.slice(0, 24);
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
  const nextPosition = vec3(position, currentPosition);
  const nextVelocity = vec3(velocity, currentVelocity);
  const nextRotation = vec3(rotation, currentRotation);
  const nextAngularVelocity = vec3(angularVelocity, currentAngularVelocity);
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
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(voxel.position.x, voxel.position.y, voxel.position.z)
        .setFriction(1)
        .setRestitution(0),
    );
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
  if (verticalGap < -PLATFORM_CARRY_VERTICAL_TOLERANCE || verticalGap > PLATFORM_CARRY_VERTICAL_TOLERANCE) {
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

function getPlayerDesiredPlanarMovement(player) {
  const pressed = player?.pressedKeys instanceof Set ? player.pressedKeys : new Set();
  const movementEnabled = isPlayerMovementEnabled(player);
  const left = pressed.has("a") || pressed.has("arrowleft");
  const right = pressed.has("d") || pressed.has("arrowright");
  const forward = pressed.has("w") || pressed.has("arrowup");
  const backward = pressed.has("s") || pressed.has("arrowdown");
  const sprint = movementEnabled && pressed.has("shift");
  const desired = movementEnabled
    ? (player?.usesLookHeading === true
      ? getRelativePlayerMovement(player, pressed)
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

function getPlayerAllowedCarryRelativeDelta(player, deltaSeconds) {
  if (!player) {
    return { x: 0, y: 0, z: 0 };
  }
  const { desired, sprint } = getPlayerDesiredPlanarMovement(player);
  const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_MOVE_SPEED;
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
    const entry = simulation.dynamicObjects.find((candidate) => candidate.id === targetId) ?? null;
    const body = simulation.physics?.objectBodies?.get(targetId) ?? null;
    if (!entry || !body) {
      simulation.scriptedPlatformMotions.delete(targetId);
      continue;
    }
    const progress = resolveScriptedPlatformProgress(
      controller,
      Math.max(0, mustFinite(simulation.elapsedMs, 0) - mustFinite(controller.startedAtMs, 0)),
    );
    const nextPosition = {
      x: mustFinite(controller.basePosition?.x, 0) + mustFinite(controller.delta?.x, 0) * progress,
      y: mustFinite(controller.basePosition?.y, 0) + mustFinite(controller.delta?.y, 0) * progress,
      z: mustFinite(controller.basePosition?.z, 0) + mustFinite(controller.delta?.z, 0) * progress,
    };
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
      ? getPlayerAllowedCarryRelativeDelta(rider, deltaSeconds)
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

function applyOccupiedPlayerPose(runtime, player, input = {}) {
  if (!runtime || !player) {
    return null;
  }
  const motionSeq = Number(input.motionSeq ?? input.motion_seq);
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
  const rawPosition = input.position && typeof input.position === "object" ? input.position : {};
  const rawVelocity = input.velocity && typeof input.velocity === "object" ? input.velocity : {};
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  const currentBodyPosition = body ? vec3(body.translation(), player.position) : vec3(player.position);
  const currentBodyVelocity = body ? vec3(body.linvel(), player.velocity) : vec3(player.velocity);
  const forceClientPose = input.force_client_pose === true
    || input.forceClientPose === true
    || input.force_runtime_pose === true
    || input.forceRuntimePose === true
    || input.client_authoritative_pose === true;
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
    if (!body) {
      continue;
    }
    if (player.body_mode === "ghost") {
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      body.setGravityScale(0, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      continue;
    }
    const nextType = player.occupied_by_profile_id ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed;
    body.setBodyType(nextType, true);
    body.setGravityScale(1, true);
    body.setEnabledRotations(false, true, false, true);
    if (!player.occupied_by_profile_id) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
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

function getRelativePlayerMovement(player, pressedKeys = player?.pressedKeys) {
  const pressed = pressedKeys instanceof Set ? pressedKeys : new Set();
  const left = pressed.has("a") || pressed.has("arrowleft");
  const right = pressed.has("d") || pressed.has("arrowright");
  const forward = pressed.has("w") || pressed.has("arrowup");
  const backward = pressed.has("s") || pressed.has("arrowdown");
  const headingY = mustFinite(player?.rotation?.y, 0);
  const forwardAmount = Number(forward) - Number(backward);
  const strafeAmount = Number(right) - Number(left);
  const forwardVector = {
    x: -Math.sin(headingY),
    z: -Math.cos(headingY),
  };
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

function isPlayerMovementEnabled(player = {}) {
  if (!isPlayerMovementToggleCameraMode(player?.camera_mode)) {
    return true;
  }
  return player?.movement_enabled !== false;
}

function isPlayerJumpEnabled(player = {}) {
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
  if (!runtime || !player || !isPlayerJumpEnabled(player)) {
    return false;
  }
  const body = runtime.physics?.playerBodies?.get(player.id) ?? null;
  if (!body) {
    player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + PLAYER_JUMP_BUFFER_MS);
    return false;
  }
  if (player.body_mode === "ghost") {
    player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + PLAYER_JUMP_BUFFER_MS);
    player.onGround = isGhostPlayerGrounded(player);
    if (!player.onGround) {
      player.sleeping = false;
      body.wakeUp?.();
      return false;
    }
    player.velocity = {
      x: mustFinite(player.velocity?.x, 0),
      y: PLAYER_JUMP_VELOCITY,
      z: mustFinite(player.velocity?.z, 0),
    };
    player.onGround = false;
    player.sleeping = false;
    player.jumpBufferedUntilMs = 0;
    body.setLinvel(player.velocity, true);
    body.wakeUp?.();
    return true;
  }
  player.jumpBufferedUntilMs = Math.max(mustFinite(player.jumpBufferedUntilMs, 0), nowMs + PLAYER_JUMP_BUFFER_MS);
  player.onGround = raycastPlayerGround(runtime, player);
  if (!player.onGround) {
    player.sleeping = false;
    body.wakeUp?.();
    return false;
  }
  const currentVelocity = vec3(body.linvel(), player.velocity);
  const nextVelocity = {
    x: currentVelocity.x,
    y: PLAYER_JUMP_VELOCITY,
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

  const pressed = player.pressedKeys;
  const movementEnabled = isPlayerMovementEnabled(player);
  const left = pressed.has("a") || pressed.has("arrowleft");
  const right = pressed.has("d") || pressed.has("arrowright");
  const forward = pressed.has("w") || pressed.has("arrowup");
  const backward = pressed.has("s") || pressed.has("arrowdown");
  const sprint = movementEnabled && pressed.has("shift");
  const nowMs = mustFinite(runtime?.elapsedMs, 0);
  const jumpEdge = isPlayerJumpEnabled(player) && inputEdges.some((entry) => entry.key === "space" && entry.state === "down");
  if (jumpEdge) {
    player.jumpBufferedUntilMs = nowMs + PLAYER_JUMP_BUFFER_MS;
  } else if (mustFinite(player.jumpBufferedUntilMs, 0) < nowMs) {
    player.jumpBufferedUntilMs = 0;
  }
  const desired = movementEnabled
    ? (player.usesLookHeading === true
    ? getRelativePlayerMovement(player, pressed)
    : normalizePlanarVector(
      Number(right) - Number(left),
      Number(backward) - Number(forward),
    ))
    : { x: 0, z: 0 };
  if (player.usesLookHeading !== true) {
    updatePlayerLookDirection(player, desired);
  }

  if (player.body_mode === "ghost") {
    const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_MOVE_SPEED;
    const gravity = Math.abs(mustFinite(runtime?.gravity?.y, -9.8));
    const groundY = getGhostPlayerGroundY(player);
    const currentVelocity = vec3(player.velocity);
    let nextVelocityY = currentVelocity.y;
    if (mustFinite(player.jumpBufferedUntilMs, 0) >= nowMs && player.onGround) {
      nextVelocityY = PLAYER_JUMP_VELOCITY;
      player.onGround = false;
      player.jumpBufferedUntilMs = 0;
    } else {
      nextVelocityY -= gravity * deltaSeconds;
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

  const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_MOVE_SPEED;
  const currentVelocity = vec3(body.linvel(), player.velocity);
  const targetVelocityX = desired.x * speed;
  const targetVelocityZ = desired.z * speed;
  const blend = clampNumber(PLAYER_ACCELERATION * deltaSeconds, 0, 1);
  const nextVelocity = {
    x: currentVelocity.x + (targetVelocityX - currentVelocity.x) * blend,
    y: currentVelocity.y,
    z: currentVelocity.z + (targetVelocityZ - currentVelocity.z) * blend,
  };
  player.onGround = raycastPlayerGround(runtime, player);
  if (mustFinite(player.jumpBufferedUntilMs, 0) >= nowMs && player.onGround) {
    nextVelocity.y = PLAYER_JUMP_VELOCITY;
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
  const authoredPlayerIds = normalizeSceneDoc(sceneRow?.scene_doc ?? {}).players.map((entry) => entry.id);
  const staticSolids = (sceneDoc.voxels ?? []).map((entry) => ({
    id: entry.id,
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
    };
  });
  const dynamicObjects = (sceneDoc.primitives ?? []).map((entry) => ({
    kind: "dynamic_object",
    id: entry.id,
    entity_kind: "primitive",
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
    effect: entry.effect,
    target_id: entry.target_id,
    color: entry.color,
    enabled: entry.enabled !== false,
  }]));
  const textState = Object.fromEntries((sceneDoc.texts ?? []).map((entry) => [entry.id, {
    id: entry.id,
    value: entry.value,
  }]));
  const runtime = {
    sceneRowId: sceneRow?.id ?? null,
    sceneName: sceneRow?.name ?? "Scene",
    sceneVersion: mustFinite(sceneRow?.version, 0),
    sceneUpdatedAt: sceneRow?.updated_at ?? sceneRow?.created_at ?? null,
    sceneDoc,
    rules: buildSceneRules(sceneRow, sceneDoc),
    gravity: vec3(sceneDoc.settings?.gravity, { x: 0, y: -9.8, z: 0 }),
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
    triggerZones,
    ruleState: {
      firedRuleIds: new Set(),
      sceneStartFired: sceneStarted === true && elapsedMs > 0,
    },
    particleState,
    textState,
    recentEvents: [],
    commandQueue: [],
    scriptedPlatformMotions: new Map(),
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
    const participant = occupiedByEntityId.get(player.id) ?? null;
    player.occupied_by_profile_id = participant?.profile_id ?? null;
    player.occupied_by_username = participant?.profile?.username ?? null;
    player.occupied_by_display_name = participant?.profile?.display_name ?? participant?.display_name ?? null;
    player.ready = participant?.ready_state?.ready === true;
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
  if (rule.action === "apply_force") {
    const target = findTargetBody(simulation, targetId);
    if (target) {
      const force = vec3(rule.payload?.force, { x: 0, y: 0, z: 0 });
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
      });
    }
    markRuleFired();
    return;
  }

  if (rule.action === "teleport") {
    const target = findTargetBody(simulation, targetId);
    if (target) {
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
    const target = simulation.dynamicObjects.find((entry) => entry.id === targetId) ?? null;
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
    if (target) {
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
    if (target) {
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
          (!rule.key || String(rule.key).toLowerCase() === edge.key)
          && (!rule.source_id || rule.source_id === player.id)
        ),
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
  return {
    instance_id: simulation.instanceId ?? null,
    active_scene_id: simulation.activeSceneId ?? null,
    scene_name: runtime.sceneName ?? null,
    scene_version: runtime.sceneVersion,
    scene_updated_at: runtime.sceneUpdatedAt ?? null,
    status: runtime.status,
    scene_started: runtime.sceneStarted === true,
    tick: runtime.tick,
    elapsed_ms: Number(runtime.elapsedMs.toFixed(0)),
    started_at: runtime.startedAt ?? null,
    players: runtime.players.map((entry) => ({
      id: entry.id,
      label: entry.label,
      scale: entry.scale,
      position: cloneJson(entry.position),
      rotation: cloneJson(entry.rotation),
      velocity: cloneJson(entry.velocity),
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
      material_override: cloneJson(entry.material_override),
    })),
    dynamic_objects: runtime.dynamicObjects.map((entry) => ({
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
    trigger_zones: runtime.triggerZones.map((entry) => ({
      id: entry.id,
      label: entry.label,
      occupant_ids: [...entry.currentOccupants],
    })),
    particles: Object.values(runtime.particleState).map((entry) => cloneJson(entry)),
    texts: Object.values(runtime.textState).map((entry) => cloneJson(entry)),
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
      force_client_pose,
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
    if (normalizedKey === "space" && state !== "up" && !occupiedPlayer.pressedKeys.has("space")) {
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
