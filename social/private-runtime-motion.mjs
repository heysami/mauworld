import { resolvePlayerMovementAgainstBlockers } from "./private-player-collision.mjs?v=20260421c";

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function cloneVec3(value = {}, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finiteNumber(value.x, fallback.x),
    y: finiteNumber(value.y, fallback.y),
    z: finiteNumber(value.z, fallback.z),
  };
}

function addVec3(left = {}, right = {}) {
  return {
    x: finiteNumber(left.x, 0) + finiteNumber(right.x, 0),
    y: finiteNumber(left.y, 0) + finiteNumber(right.y, 0),
    z: finiteNumber(left.z, 0) + finiteNumber(right.z, 0),
  };
}

function subVec3(left = {}, right = {}) {
  return {
    x: finiteNumber(left.x, 0) - finiteNumber(right.x, 0),
    y: finiteNumber(left.y, 0) - finiteNumber(right.y, 0),
    z: finiteNumber(left.z, 0) - finiteNumber(right.z, 0),
  };
}

function scaleVec3(value = {}, scalar = 0) {
  const factor = finiteNumber(scalar, 0);
  return {
    x: finiteNumber(value.x, 0) * factor,
    y: finiteNumber(value.y, 0) * factor,
    z: finiteNumber(value.z, 0) * factor,
  };
}

function lengthSq(value = {}) {
  const x = finiteNumber(value.x, 0);
  const y = finiteNumber(value.y, 0);
  const z = finiteNumber(value.z, 0);
  return (x * x) + (y * y) + (z * z);
}

function length(value = {}) {
  return Math.sqrt(lengthSq(value));
}

function clampVec3Magnitude(value = {}, maxLength = Infinity) {
  const limit = finiteNumber(maxLength, Infinity);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const magnitude = length(value);
  if (magnitude <= limit || magnitude <= 0.000001) {
    return cloneVec3(value);
  }
  const scale = limit / magnitude;
  return scaleVec3(value, scale);
}

function lerpNumber(from, to, alpha) {
  const mix = clampNumber(alpha, 0, 1);
  return finiteNumber(from, 0) + ((finiteNumber(to, 0) - finiteNumber(from, 0)) * mix);
}

function lerpVec3(from = {}, to = {}, alpha = 0) {
  return {
    x: lerpNumber(from.x, to.x, alpha),
    y: lerpNumber(from.y, to.y, alpha),
    z: lerpNumber(from.z, to.z, alpha),
  };
}

function expBlendAlpha(rate = 0, deltaSeconds = 0) {
  const safeRate = Math.max(0, finiteNumber(rate, 0));
  const safeDt = Math.max(0, finiteNumber(deltaSeconds, 0));
  if (safeRate <= 0 || safeDt <= 0) {
    return 0;
  }
  return 1 - Math.exp(-safeRate * safeDt);
}

export function applyAuthoritativeMotionSample(existingState = null, {
  renderPosition = null,
  renderVelocity = null,
  position = null,
  velocity = null,
  receivedAtMs = 0,
} = {}) {
  const state = existingState ?? {
    initialized: false,
    renderPosition: { x: 0, y: 0, z: 0 },
    renderVelocity: { x: 0, y: 0, z: 0 },
    authoritativePosition: { x: 0, y: 0, z: 0 },
    authoritativeVelocity: { x: 0, y: 0, z: 0 },
    authoritativeReceivedAtMs: 0,
    localInteractionUntilMs: 0,
    localInteractionVelocity: null,
  };
  const resolvedRenderPosition = cloneVec3(renderPosition ?? state.renderPosition, state.renderPosition);
  const resolvedRenderVelocity = cloneVec3(renderVelocity ?? state.renderVelocity, state.renderVelocity);
  const authoritativePosition = cloneVec3(position ?? state.authoritativePosition, state.authoritativePosition);
  const authoritativeVelocity = cloneVec3(velocity ?? state.authoritativeVelocity, state.authoritativeVelocity);
  state.authoritativePosition = authoritativePosition;
  state.authoritativeVelocity = authoritativeVelocity;
  state.authoritativeReceivedAtMs = Math.max(0, finiteNumber(receivedAtMs, state.authoritativeReceivedAtMs));
  if (!state.initialized) {
    state.renderPosition = resolvedRenderPosition;
    state.renderVelocity = resolvedRenderVelocity;
    state.initialized = true;
  }
  return state;
}

export function stepContinuousMotionState(state, {
  deltaSeconds = 0,
  nowMs = 0,
  correctionRate = 8.5,
  velocityBlendRate = 15,
  maxCorrectionSpeed = 26,
  maxPredictionSeconds = 0.2,
  interactionVelocity = null,
  interactionBlend = 0.74,
  sleeping = false,
  sleepBlendRate = 7,
} = {}) {
  if (!state?.initialized) {
    return state;
  }
  const dt = Math.max(0, finiteNumber(deltaSeconds, 0));
  if (dt <= 0) {
    return state;
  }
  const ageSeconds = clampNumber(
    (Math.max(0, finiteNumber(nowMs, 0)) - Math.max(0, finiteNumber(state.authoritativeReceivedAtMs, 0))) / 1000,
    0,
    Math.max(0, finiteNumber(maxPredictionSeconds, 0)),
  );
  const predictedAuthorityPosition = addVec3(
    state.authoritativePosition,
    scaleVec3(state.authoritativeVelocity, ageSeconds),
  );
  const offset = subVec3(predictedAuthorityPosition, state.renderPosition);
  const correctionVelocity = clampVec3Magnitude(
    scaleVec3(offset, Math.max(0, finiteNumber(correctionRate, 0))),
    Math.max(0, finiteNumber(maxCorrectionSpeed, 0)),
  );
  let desiredVelocity = addVec3(state.authoritativeVelocity, correctionVelocity);
  if (interactionVelocity) {
    desiredVelocity = lerpVec3(
      desiredVelocity,
      interactionVelocity,
      clampNumber(interactionBlend, 0, 1),
    );
  } else if (sleeping && lengthSq(state.authoritativeVelocity) <= 0.04) {
    desiredVelocity = lerpVec3(
      desiredVelocity,
      { x: 0, y: 0, z: 0 },
      expBlendAlpha(sleepBlendRate, dt),
    );
  }
  state.renderVelocity = lerpVec3(
    state.renderVelocity,
    desiredVelocity,
    expBlendAlpha(velocityBlendRate, dt),
  );
  state.renderPosition = addVec3(
    state.renderPosition,
    scaleVec3(state.renderVelocity, dt),
  );
  return state;
}

export function resolveContinuousMotionStateAgainstBlockers(state, {
  startPosition = null,
  collisionSize = null,
  blockers = [],
} = {}) {
  if (!state?.initialized || !startPosition || !collisionSize || !Array.isArray(blockers) || blockers.length === 0) {
    return null;
  }
  const collision = resolvePlayerMovementAgainstBlockers({
    startPosition: cloneVec3(startPosition),
    desiredPosition: cloneVec3(state.renderPosition),
    playerSize: cloneVec3(collisionSize),
    blockers,
  });
  state.renderPosition = cloneVec3(collision.position, state.renderPosition);
  if (collision.blockedAxes?.x) {
    state.renderVelocity.x = 0;
    if (state.localInteractionVelocity) {
      state.localInteractionVelocity.x = 0;
    }
  }
  if (collision.blockedAxes?.z) {
    state.renderVelocity.z = 0;
    if (state.localInteractionVelocity) {
      state.localInteractionVelocity.z = 0;
    }
  }
  return collision;
}

export function computeLocalInteractionVelocity({
  playerPosition = null,
  playerVelocity = null,
  playerHalfExtents = null,
  objectPosition = null,
  objectHalfExtents = null,
  authoritativeVelocity = null,
  padding = 1.4,
  verticalPadding = 1.2,
  minPlanarSpeed = 1,
  transfer = 0.82,
} = {}) {
  if (!playerPosition || !playerVelocity || !playerHalfExtents || !objectPosition || !objectHalfExtents) {
    return null;
  }
  const safePlayerVelocity = cloneVec3(playerVelocity);
  const planarSpeed = Math.hypot(safePlayerVelocity.x, safePlayerVelocity.z);
  if (planarSpeed < Math.max(0, finiteNumber(minPlanarSpeed, 0))) {
    return null;
  }
  const player = cloneVec3(playerPosition);
  const object = cloneVec3(objectPosition);
  const playerHalf = cloneVec3(playerHalfExtents);
  const objectHalf = cloneVec3(objectHalfExtents);
  if (
    Math.abs(player.y - object.y)
    > (playerHalf.y + objectHalf.y + Math.max(0, finiteNumber(verticalPadding, 0)))
  ) {
    return null;
  }
  const limitX = playerHalf.x + objectHalf.x + Math.max(0, finiteNumber(padding, 0));
  const limitZ = playerHalf.z + objectHalf.z + Math.max(0, finiteNumber(padding, 0));
  const deltaX = object.x - player.x;
  const deltaZ = object.z - player.z;
  const overlapX = limitX - Math.abs(deltaX);
  const overlapZ = limitZ - Math.abs(deltaZ);
  if (overlapX <= 0 || overlapZ <= 0) {
    return null;
  }
  const toObjectLength = Math.hypot(deltaX, deltaZ);
  const approach = toObjectLength > 0.0001
    ? ((safePlayerVelocity.x * deltaX) + (safePlayerVelocity.z * deltaZ)) / (planarSpeed * toObjectLength)
    : 1;
  if (approach < -0.2 && Math.min(overlapX, overlapZ) < Math.max(0.2, Math.max(0, finiteNumber(padding, 0)) * 0.75)) {
    return null;
  }
  const overlapStrength = clampNumber(
    Math.min(overlapX / Math.max(limitX, 0.0001), overlapZ / Math.max(limitZ, 0.0001)),
    0.18,
    1,
  );
  const baseVelocity = cloneVec3(authoritativeVelocity ?? {});
  return {
    x: baseVelocity.x + (safePlayerVelocity.x * Math.max(0, finiteNumber(transfer, 0)) * overlapStrength),
    y: baseVelocity.y,
    z: baseVelocity.z + (safePlayerVelocity.z * Math.max(0, finiteNumber(transfer, 0)) * overlapStrength),
  };
}
