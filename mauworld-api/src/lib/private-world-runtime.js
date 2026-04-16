import { HttpError } from "./http.js";
import { normalizeSceneDoc } from "./private-worlds.js";

const DEFAULT_TICK_MS = 50;
const DEFAULT_BROADCAST_MS = 250;
const PLAYER_MOVE_SPEED = 11.5;
const PLAYER_SPRINT_SPEED = 17.5;
const PLAYER_ACCELERATION = 26;
const PLAYER_JUMP_VELOCITY = 7.8;
const PLAYER_DRAG = 5.5;
const DYNAMIC_DRAG = 1.8;
const MAX_DELTA_SECONDS = 0.08;

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

function vec3(input = {}, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: mustFinite(input.x, fallback.x),
    y: mustFinite(input.y, fallback.y),
    z: mustFinite(input.z, fallback.z),
  };
}

function addVector(target, delta, scale = 1) {
  target.x += delta.x * scale;
  target.y += delta.y * scale;
  target.z += delta.z * scale;
  return target;
}

function multiplyVector(source, scale) {
  return {
    x: source.x * scale,
    y: source.y * scale,
    z: source.z * scale,
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

function applyDrag(value, drag, deltaSeconds) {
  const damping = Math.max(0, 1 - drag * deltaSeconds);
  return value * damping;
}

function buildAabb(position, halfExtents) {
  return {
    minX: position.x - halfExtents.x,
    maxX: position.x + halfExtents.x,
    minY: position.y - halfExtents.y,
    maxY: position.y + halfExtents.y,
    minZ: position.z - halfExtents.z,
    maxZ: position.z + halfExtents.z,
  };
}

function getOverlap(aabb, solid) {
  const overlapX = Math.min(aabb.maxX, solid.maxX) - Math.max(aabb.minX, solid.minX);
  const overlapY = Math.min(aabb.maxY, solid.maxY) - Math.max(aabb.minY, solid.minY);
  const overlapZ = Math.min(aabb.maxZ, solid.maxZ) - Math.max(aabb.minZ, solid.minZ);
  if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) {
    return null;
  }
  return {
    x: overlapX,
    y: overlapY,
    z: overlapZ,
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
      x: 0.38 * scale,
      y: 0.95 * scale,
      z: 0.38 * scale,
    };
  }
  return {
    x: Math.max(0.16, mustFinite(body.scale?.x, 1) / 2),
    y: Math.max(0.16, mustFinite(body.scale?.y, 1) / 2),
    z: Math.max(0.16, mustFinite(body.scale?.z, 1) / 2),
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

function parseRuleSceneTarget(rule = {}) {
  const payloadSceneId = String(rule.payload?.scene_id ?? rule.payload?.sceneId ?? "").trim();
  if (payloadSceneId) {
    return payloadSceneId;
  }
  return String(rule.target_id ?? "").trim() || null;
}

function seedSceneRuntime(sceneRow, { sceneStarted = false, status = "active", runtimeState = {}, tick = 0, elapsedMs = 0 } = {}) {
  const sceneDoc = normalizeSceneDoc(sceneRow?.scene_doc ?? {});
  const staticSolids = (sceneDoc.voxels ?? []).map((entry) => {
    const half = {
      x: Math.max(0.1, mustFinite(entry.scale?.x, 1) / 2),
      y: Math.max(0.1, mustFinite(entry.scale?.y, 1) / 2),
      z: Math.max(0.1, mustFinite(entry.scale?.z, 1) / 2),
    };
    const position = vec3(entry.position);
    return {
      id: entry.id,
      position,
      halfExtents: half,
      ...buildAabb(position, half),
    };
  });
  const players = (sceneDoc.players ?? []).map((entry) => ({
    kind: "player",
    id: entry.id,
    label: entry.label,
    scale: mustFinite(entry.scale, 1),
    camera_mode: entry.camera_mode,
    body_mode: entry.body_mode,
    occupiable: entry.occupiable !== false,
    initialPosition: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    position: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: vec3(entry.rotation),
    velocity: { x: 0, y: 0, z: 0 },
    onGround: false,
    occupied_by_profile_id: null,
    occupied_by_username: null,
    occupied_by_display_name: null,
    ready: false,
    pressedKeys: new Set(),
    visibility: true,
    material_override: null,
  }));
  const dynamicObjects = (sceneDoc.primitives ?? []).map((entry) => ({
    kind: "dynamic_object",
    id: entry.id,
    shape: entry.shape,
    scale: cloneJson(entry.scale),
    position: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    initialPosition: vec3(entry.position, { x: 0, y: 1, z: 0 }),
    rotation: vec3(entry.rotation),
    velocity: { x: 0, y: 0, z: 0 },
    angular_velocity: { x: 0, y: 0, z: 0 },
    rigid_mode: entry.rigid_mode,
    physics: cloneJson(entry.physics ?? {}),
    visibility: true,
    material_override: null,
  }));
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
  return {
    sceneRowId: sceneRow?.id ?? null,
    sceneName: sceneRow?.name ?? "Scene",
    sceneUpdatedAt: sceneRow?.updated_at ?? sceneRow?.created_at ?? null,
    sceneDoc,
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
      keyRuleFrames: new Set(),
      zoneStateByZoneId: new Map(),
    },
    particleState,
    textState,
    recentEvents: [],
    commandQueue: [],
  };
}

function syncParticipantOccupancy(simulation, participants = []) {
  const occupiedByEntityId = new Map(
    participants
      .filter((entry) => entry.join_role === "player" && entry.player_entity_id)
      .map((entry) => [entry.player_entity_id, entry]),
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

function applyAxisCollisions(body, staticSolids, axis) {
  const half = getBodyHalfExtents(body);
  const aabb = buildAabb(body.position, half);
  let collided = false;
  for (const solid of staticSolids) {
    const overlap = getOverlap(aabb, solid);
    if (!overlap) {
      continue;
    }
    collided = true;
    if (axis === "x") {
      body.position.x += body.position.x >= solid.position.x ? overlap.x : -overlap.x;
      body.velocity.x = 0;
    } else if (axis === "y") {
      body.position.y += body.position.y >= solid.position.y ? overlap.y : -overlap.y;
      if (body.position.y >= solid.position.y && body.velocity.y <= 0) {
        body.onGround = true;
      }
      body.velocity.y = body.velocity.y > 0 ? 0 : Math.max(0, -body.velocity.y * mustFinite(body.physics?.restitution, 0.12));
    } else if (axis === "z") {
      body.position.z += body.position.z >= solid.position.z ? overlap.z : -overlap.z;
      body.velocity.z = 0;
    }
  }
  return collided;
}

function resolveWorldFloor(body) {
  const half = getBodyHalfExtents(body);
  if (body.position.y - half.y < 0) {
    body.position.y = half.y;
    if (body.velocity.y <= 0) {
      body.onGround = true;
    }
    body.velocity.y = body.velocity.y > 0 ? body.velocity.y : Math.max(0, -body.velocity.y * mustFinite(body.physics?.restitution, 0.12));
  }
}

function simulateBody(body, simulation, deltaSeconds) {
  const gravityScale = mustFinite(body.physics?.gravity_scale, body.kind === "player" ? 1 : 1);
  const drag = body.kind === "player"
    ? PLAYER_DRAG + mustFinite(body.physics?.friction, 0.72)
    : DYNAMIC_DRAG + mustFinite(body.physics?.friction, 0.72);
  body.onGround = false;

  if (body.kind !== "player" || body.body_mode !== "ghost") {
    body.velocity.x += simulation.gravity.x * gravityScale * deltaSeconds;
    body.velocity.y += simulation.gravity.y * gravityScale * deltaSeconds;
    body.velocity.z += simulation.gravity.z * gravityScale * deltaSeconds;
  }

  body.position.x += body.velocity.x * deltaSeconds;
  applyAxisCollisions(body, simulation.staticSolids, "x");

  body.position.y += body.velocity.y * deltaSeconds;
  applyAxisCollisions(body, simulation.staticSolids, "y");
  resolveWorldFloor(body);

  body.position.z += body.velocity.z * deltaSeconds;
  applyAxisCollisions(body, simulation.staticSolids, "z");

  body.velocity.x = applyDrag(body.velocity.x, drag, deltaSeconds);
  body.velocity.z = applyDrag(body.velocity.z, drag, deltaSeconds);
  if (body.onGround) {
    body.velocity.y = Math.max(-0.01, body.velocity.y);
  }
}

function applyPlayerInput(player, inputEdges = [], deltaSeconds) {
  const pressed = player.pressedKeys;
  const left = pressed.has("a") || pressed.has("arrowleft");
  const right = pressed.has("d") || pressed.has("arrowright");
  const forward = pressed.has("w") || pressed.has("arrowup");
  const backward = pressed.has("s") || pressed.has("arrowdown");
  const sprint = pressed.has("shift");
  const jumpEdge = inputEdges.some((entry) => entry.key === "space" && entry.state === "down");

  const desired = normalizePlanarVector(
    Number(right) - Number(left),
    Number(backward) - Number(forward),
  );
  const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_MOVE_SPEED;
  player.velocity.x += desired.x * PLAYER_ACCELERATION * deltaSeconds;
  player.velocity.z += desired.z * PLAYER_ACCELERATION * deltaSeconds;

  const planarSpeed = vectorLength2(player.velocity.x, player.velocity.z);
  if (planarSpeed > speed) {
    const normalized = normalizePlanarVector(player.velocity.x, player.velocity.z);
    player.velocity.x = normalized.x * speed;
    player.velocity.z = normalized.z * speed;
  }

  if (jumpEdge && player.onGround) {
    player.velocity.y = PLAYER_JUMP_VELOCITY;
    player.onGround = false;
  }
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
      addVector(target.velocity, force);
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
      target.position = nextPosition;
      target.velocity = { x: 0, y: 0, z: 0 };
      pushRuntimeEvent(simulation, {
        type: "teleport",
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
  const matchingRules = (simulation.sceneDoc.rules ?? []).filter((rule) => rule.trigger === trigger && predicate(rule));
  for (const rule of matchingRules) {
    executeRuleAction(simulation, rule, context);
  }
}

export function stepPrivateWorldSimulation(simulation, options = {}) {
  const deltaSeconds = clampNumber(mustFinite(options.deltaMs, DEFAULT_TICK_MS) / 1000, 0.001, MAX_DELTA_SECONDS);
  const inputEdgesByPlayerId = new Map();
  const pendingInputs = Array.isArray(options.pendingInputs) ? options.pendingInputs : [];
  for (const input of pendingInputs) {
    const player = simulation.players.find((entry) => entry.id === input.playerId);
    if (!player || !player.occupied_by_profile_id) {
      continue;
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

  if (!simulation.sceneStarted) {
    if (allPlayersReady) {
      executeMatchingRules(
        simulation,
        "all_players_ready",
        (rule) => !simulation.ruleState.firedRuleIds.has(rule.id),
        { oneShot: true },
      );
    }
    simulation.tick += 1;
    return simulation;
  }

  simulation.elapsedMs += deltaSeconds * 1000;
  simulation.tick += 1;

  for (const player of occupiedPlayers) {
    const inputEdges = inputEdgesByPlayerId.get(player.id) ?? [];
    applyPlayerInput(player, inputEdges, deltaSeconds);
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

  for (const player of occupiedPlayers) {
    if (player.body_mode === "ghost") {
      continue;
    }
    player.physics = {
      gravity_scale: 1,
      friction: 0.72,
      restitution: 0.12,
    };
    simulateBody(player, simulation, deltaSeconds);
  }

  for (const object of simulation.dynamicObjects) {
    if (object.rigid_mode !== "rigid") {
      continue;
    }
    simulateBody(object, simulation, deltaSeconds);
  }

  for (const zone of simulation.triggerZones) {
    const previous = new Set(zone.currentOccupants);
    const next = new Set();
    for (const player of occupiedPlayers) {
      if (isPointInsideZone(player.position, zone)) {
        next.add(player.id);
      }
    }
    for (const playerId of next) {
      if (!previous.has(playerId)) {
        executeMatchingRules(simulation, "zone_enter", (rule) => !rule.source_id || rule.source_id === zone.id);
      }
    }
    for (const playerId of previous) {
      if (!next.has(playerId)) {
        executeMatchingRules(simulation, "zone_exit", (rule) => !rule.source_id || rule.source_id === zone.id);
      }
    }
    zone.currentOccupants = next;
  }

  for (const rule of simulation.sceneDoc.rules ?? []) {
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
    for (const rule of simulation.sceneDoc.rules ?? []) {
      if (rule.trigger !== "all_players_ready" || simulation.ruleState.firedRuleIds.has(rule.id)) {
        continue;
      }
      executeRuleAction(simulation, rule, { oneShot: true });
    }
  }

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
    status: runtime.status,
    scene_started: runtime.sceneStarted === true,
    tick: runtime.tick,
    elapsed_ms: Number(runtime.elapsedMs.toFixed(0)),
    started_at: runtime.startedAt ?? null,
    players: runtime.players.map((entry) => ({
      id: entry.id,
      label: entry.label,
      position: cloneJson(entry.position),
      rotation: cloneJson(entry.rotation),
      velocity: cloneJson(entry.velocity),
      camera_mode: entry.camera_mode,
      body_mode: entry.body_mode,
      occupied_by_username: entry.occupied_by_username,
      occupied_by_display_name: entry.occupied_by_display_name,
      ready: entry.ready === true,
      on_ground: entry.onGround === true,
      visible: entry.visibility !== false,
      material_override: cloneJson(entry.material_override),
    })),
    dynamic_objects: runtime.dynamicObjects.map((entry) => ({
      id: entry.id,
      shape: entry.shape,
      position: cloneJson(entry.position),
      rotation: cloneJson(entry.rotation),
      velocity: cloneJson(entry.velocity),
      rigid_mode: entry.rigid_mode,
      visible: entry.visibility !== false,
      material_override: cloneJson(entry.material_override),
    })),
    trigger_zones: runtime.triggerZones.map((entry) => ({
      id: entry.id,
      label: entry.label,
      occupant_player_ids: [...entry.currentOccupants],
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

  async syncWorldByReference({ worldId, creatorUsername } = {}) {
    const context = await loadRuntimeWorldContext(this.store, worldId, creatorUsername);
    if (!context?.world) {
      return null;
    }
    const key = this.getWorldRefKey(worldId, creatorUsername);
    if (!context.instance) {
      const staleInstanceId = this.keysByWorldRef.get(key);
      if (staleInstanceId) {
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
      if (
        simulation.runtime.sceneRowId !== activeScene.id
        || simulation.runtime.sceneUpdatedAt !== (activeScene.updated_at ?? activeScene.created_at ?? null)
      ) {
        simulation.runtime = seedSceneRuntime(activeScene, {
          sceneStarted: context.instance.status === "started" || runtimeState.scene_started === true,
          status: context.instance.status,
          runtimeState,
          tick: mustFinite(runtimeState.tick, 0),
          elapsedMs: mustFinite(runtimeState.scene_elapsed_ms, 0),
        });
      } else {
        simulation.runtime.status = context.instance.status;
        simulation.runtime.sceneStarted = context.instance.status === "started" || runtimeState.scene_started === true;
      }
      syncParticipantOccupancy(simulation.runtime, context.participants);
    }

    this.keysByWorldRef.set(key, context.instance.id);
    return buildPrivateWorldRuntimeSnapshot(simulation);
  }

  async queueInputByReference({ worldId, creatorUsername, profile, key, state } = {}) {
    const snapshot = await this.syncWorldByReference({ worldId, creatorUsername });
    if (!snapshot) {
      throw new HttpError(404, "Private world runtime is not active");
    }
    const keyRef = this.getWorldRefKey(worldId, creatorUsername);
    const instanceId = this.keysByWorldRef.get(keyRef);
    const simulation = instanceId ? this.instancesById.get(instanceId) : null;
    if (!simulation) {
      throw new HttpError(404, "Private world runtime is not active");
    }
    const occupiedPlayer = simulation.runtime.players.find((entry) => entry.occupied_by_profile_id === profile.id);
    if (!occupiedPlayer) {
      throw new HttpError(403, "Only occupied player slots can send runtime input");
    }
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    if (!normalizedKey) {
      throw new HttpError(400, "Runtime input key is required");
    }
    simulation.pendingInputs.push({
      playerId: occupiedPlayer.id,
      key: normalizedKey,
      state: state === "up" ? "up" : "down",
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
      if (now - simulation.lastBroadcastAt >= this.broadcastMs) {
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
