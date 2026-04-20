import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAuthoritativeMotionSample,
  computeLocalInteractionVelocity,
  resolveContinuousMotionStateAgainstBlockers,
  stepContinuousMotionState,
} from "./private-runtime-motion.mjs";

test("continuous motion advances toward authority without snapping", () => {
  const state = applyAuthoritativeMotionSample(null, {
    renderPosition: { x: 0, y: 0, z: 0 },
    renderVelocity: { x: 0, y: 0, z: 0 },
    position: { x: 10, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    receivedAtMs: 0,
  });

  stepContinuousMotionState(state, {
    deltaSeconds: 1 / 60,
    nowMs: 16,
  });

  assert.ok(state.renderPosition.x > 0);
  assert.ok(state.renderPosition.x < 10);
});

test("continuous motion bends toward new authority instead of teleporting", () => {
  const state = applyAuthoritativeMotionSample(null, {
    renderPosition: { x: 0, y: 0, z: 0 },
    renderVelocity: { x: 0, y: 0, z: 0 },
    position: { x: 12, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    receivedAtMs: 0,
  });

  for (let step = 0; step < 12; step += 1) {
    stepContinuousMotionState(state, {
      deltaSeconds: 1 / 60,
      nowMs: (step + 1) * 16,
    });
  }
  const beforeRetarget = { ...state.renderPosition };

  applyAuthoritativeMotionSample(state, {
    renderPosition: state.renderPosition,
    renderVelocity: state.renderVelocity,
    position: { x: 4, y: 0, z: 6 },
    velocity: { x: 0.5, y: 0, z: 2 },
    receivedAtMs: 220,
  });
  stepContinuousMotionState(state, {
    deltaSeconds: 1 / 60,
    nowMs: 236,
  });

  assert.ok(Math.abs(state.renderPosition.x - beforeRetarget.x) < 1);
  assert.ok(state.renderPosition.z > beforeRetarget.z);
});

test("local interaction velocity nudges contacted objects along the player path", () => {
  const interactionVelocity = computeLocalInteractionVelocity({
    playerPosition: { x: 0, y: 5, z: 0 },
    playerVelocity: { x: 0, y: 0, z: -18 },
    playerHalfExtents: { x: 1.5, y: 4.5, z: 1.5 },
    objectPosition: { x: 0, y: 5, z: -2.2 },
    objectHalfExtents: { x: 1, y: 1, z: 1 },
    authoritativeVelocity: { x: 0, y: 0, z: 0 },
  });

  assert.ok(interactionVelocity);
  assert.ok(interactionVelocity.z < -1);
});

test("continuous motion collision clamps locally pushed objects against blockers", () => {
  const state = applyAuthoritativeMotionSample(null, {
    renderPosition: { x: 0, y: 1, z: 0 },
    renderVelocity: { x: 7, y: 0, z: 0 },
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    receivedAtMs: 0,
  });
  state.renderPosition = { x: 5, y: 1, z: 0 };
  state.localInteractionVelocity = { x: 6, y: 0, z: 0 };

  const collision = resolveContinuousMotionStateAgainstBlockers(state, {
    startPosition: { x: 0, y: 1, z: 0 },
    collisionSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 4 },
      },
    ],
  });

  assert.equal(collision?.blockedAxes?.x, true);
  assert.ok(state.renderPosition.x < 1.6);
  assert.equal(state.renderVelocity.x, 0);
  assert.equal(state.localInteractionVelocity.x, 0);
});
