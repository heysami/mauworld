import test from "node:test";
import assert from "node:assert/strict";
import {
  computeActorProxyDistance,
  computeActorProxyHysteresis,
  computeActorStreamPaddingCells,
  computePillarProxyDistance,
  computePillarProxyHysteresis,
  computePillarStreamPaddingCells,
  computeTagProxyDistance,
  computeTagProxyHysteresis,
  computeTagStreamPaddingCells,
  expandWorldCellRange,
} from "../src/lib/supabase-store.js";

test("pillar streaming expands beyond the active cell window for far LOD proxies", () => {
  const settings = {
    world_cell_size: 64,
    world_lod_near_distance: 180,
    world_billboard_distance: 420,
  };

  assert.equal(computePillarStreamPaddingCells(settings), 37);
  assert.deepEqual(
    expandWorldCellRange(
      {
        cellXMin: -6,
        cellXMax: 6,
        cellZMin: -6,
        cellZMax: 6,
      },
      computePillarStreamPaddingCells(settings),
    ),
    {
      cellXMin: -43,
      cellXMax: 43,
      cellZMin: -43,
      cellZMax: 43,
    },
  );
});

test("pillar proxy LOD stays detailed much farther out while keeping a modest hysteresis band", () => {
  const settings = {
    world_cell_size: 64,
    world_lod_near_distance: 180,
    world_billboard_distance: 420,
  };

  const proxyDistance = computePillarProxyDistance(settings);
  const proxyHysteresis = computePillarProxyHysteresis(settings);

  assert.equal(proxyDistance, 2180);
  assert.ok(proxyDistance >= settings.world_lod_near_distance * 10);
  assert.ok(proxyHysteresis >= 0.1);
  assert.ok(proxyHysteresis <= 0.22);
});

test("tag LOD keeps nearby tags detailed while streaming a wider halo", () => {
  const settings = {
    world_cell_size: 64,
    world_lod_near_distance: 180,
    world_billboard_distance: 420,
  };

  const proxyDistance = computeTagProxyDistance(settings);
  const proxyHysteresis = computeTagProxyHysteresis(settings);

  assert.equal(computeTagStreamPaddingCells(settings), 5);
  assert.ok(proxyDistance < computePillarProxyDistance(settings));
  assert.ok(proxyDistance > 120);
  assert.ok(proxyHysteresis >= 0.09);
  assert.ok(proxyHysteresis <= 0.2);
});

test("actor LOD keeps mascot proxies available slightly beyond the active cell window", () => {
  const settings = {
    world_cell_size: 64,
    world_lod_near_distance: 180,
    world_billboard_distance: 420,
  };

  const proxyDistance = computeActorProxyDistance(settings);
  const proxyHysteresis = computeActorProxyHysteresis(settings);

  assert.equal(computeActorStreamPaddingCells(settings), 4);
  assert.ok(proxyDistance < computeTagProxyDistance(settings));
  assert.ok(proxyDistance > 100);
  assert.ok(proxyHysteresis >= 0.08);
  assert.ok(proxyHysteresis <= 0.18);
});
