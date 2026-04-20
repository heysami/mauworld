import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePlayerGroundSupport,
  resolvePlayerMovementAgainstBlockers,
} from "./private-player-collision.mjs";

test("blocks forward movement into a nearby wall", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 0, y: 1, z: 0 },
    desiredPosition: { x: 5, y: 1, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 4 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, true);
  assert.equal(result.blockedAxes.z, false);
  assert.ok(result.position.x < 1.6);
  assert.ok(result.position.x > 1.3);
});

test("slides along the free axis when only one axis is blocked", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 0, y: 1, z: 0 },
    desiredPosition: { x: 5, y: 1, z: 4 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 2 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, true);
  assert.equal(result.position.z, 4);
});

test("ignores blockers when there is no vertical overlap", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 0, y: 1, z: 0 },
    desiredPosition: { x: 5, y: 1, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 6, z: 0 },
        size: { x: 2, y: 2, z: 2 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, false);
  assert.equal(result.position.x, 5);
});

test("uses a rotated blocker's broader axis-aligned footprint", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 0, y: 1, z: 0 },
    desiredPosition: { x: 3.4, y: 1, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 0.6 },
        rotation: { x: 0, y: Math.PI / 4, z: 0 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, true);
  assert.ok(result.position.x < 2.2);
});

test("pushes a body back out when it starts slightly embedded in a wall", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 1.7, y: 1, z: 0 },
    desiredPosition: { x: 1.7, y: 1, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 4 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, true);
  assert.ok(result.position.x < 1.6);
});

test("keeps the body on its original side when moving while slightly embedded", () => {
  const result = resolvePlayerMovementAgainstBlockers({
    startPosition: { x: 1.7, y: 1, z: 0 },
    desiredPosition: { x: 2.4, y: 1, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 3, y: 1, z: 0 },
        size: { x: 2, y: 2, z: 4 },
      },
    ],
  });

  assert.equal(result.blockedAxes.x, true);
  assert.ok(result.position.x < 1.6);
});

test("finds ground support directly beneath the player", () => {
  const result = resolvePlayerGroundSupport({
    startPosition: { x: 0, y: 2, z: 0 },
    desiredPosition: { x: 0, y: 2, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 0, y: 0.5, z: 0 },
        size: { x: 4, y: 1, z: 4 },
      },
    ],
  });

  assert.equal(result.hasSupport, true);
  assert.equal(result.surfaceY, 1);
  assert.equal(result.groundY, 2);
});

test("finds swept ground support when a platform rises into the player", () => {
  const result = resolvePlayerGroundSupport({
    startPosition: { x: 0, y: 2, z: 0 },
    desiredPosition: { x: 0, y: 2.18, z: 0 },
    playerSize: { x: 1, y: 2, z: 1 },
    blockers: [
      {
        position: { x: 0, y: 0.59, z: 0 },
        size: { x: 4, y: 1.18, z: 4 },
      },
    ],
    verticalTolerance: 0.24,
  });

  assert.equal(result.hasSupport, true);
  assert.ok(Math.abs(result.groundY - 2.18) < 0.0001);
});
