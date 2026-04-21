import test from "node:test";
import assert from "node:assert/strict";
import {
  isLivePrivateWorldInstanceStatus,
  resolvePrivateWorldMiniatureRenderState,
} from "../../social/private-world-miniatures.js";

test("private-world miniature render state enforces exact far/mid/near visuals", () => {
  assert.equal(isLivePrivateWorldInstanceStatus("active"), true);
  assert.equal(isLivePrivateWorldInstanceStatus("started"), true);
  assert.equal(isLivePrivateWorldInstanceStatus("ended"), false);

  assert.deepEqual(
    resolvePrivateWorldMiniatureRenderState({
      serverLodBand: "near",
      distanceBand: "far",
    }),
    {
      effectiveBand: "far",
      showDome: true,
      showBasePlate: false,
      showLabel: false,
      showSilhouette: false,
      showDetail: false,
      showPlayerDots: false,
      domeOpacity: 0.24,
    },
  );

  assert.deepEqual(
    resolvePrivateWorldMiniatureRenderState({
      serverLodBand: "mid",
      distanceBand: "near",
    }),
    {
      effectiveBand: "mid",
      showDome: true,
      showBasePlate: false,
      showLabel: false,
      showSilhouette: true,
      showDetail: false,
      showPlayerDots: false,
      domeOpacity: 0.18,
    },
  );

  assert.deepEqual(
    resolvePrivateWorldMiniatureRenderState({
      serverLodBand: "near",
      distanceBand: "near",
    }),
    {
      effectiveBand: "near",
      showDome: true,
      showBasePlate: false,
      showLabel: false,
      showSilhouette: false,
      showDetail: true,
      showPlayerDots: true,
      domeOpacity: 0.12,
    },
  );
});
