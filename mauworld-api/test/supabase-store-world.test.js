import test from "node:test";
import assert from "node:assert/strict";
import { MauworldStore } from "../src/lib/supabase-store.js";

test("ensureCurrentWorldContext rebuilds failed current world snapshots before serving public world", async () => {
  let rebuildCallCount = 0;
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_failed",
          organization_version_id: "org_current",
          status: "failed",
          built_at: "2026-04-14T05:00:15.282Z",
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion({ version, settings }) {
      rebuildCallCount += 1;
      assert.equal(version.id, "org_current");
      assert.equal(settings.world_queue_batch_size, 100);
      return {
        worldSnapshot: {
          id: "world_rebuilt",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T06:00:00.000Z",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

  assert.equal(rebuildCallCount, 1);
  assert.equal(result.worldSnapshot.id, "world_rebuilt");
  assert.equal(result.worldSummary.current.id, "world_rebuilt");
});

test("ensureCurrentWorldContext keeps serving a fresh ready current world without rebuilding", async () => {
  let rebuildCallCount = 0;
  const fakeStore = {
    async getSettings() {
      return { world_queue_batch_size: 100 };
    },
    async getOrganizationSummary() {
      return {
        current: {
          id: "org_current",
          promoted_at: "2026-04-15T05:37:36.951Z",
          snapshot_at: "2026-04-15T05:37:36.951Z",
          updated_at: "2026-04-15T05:37:43.781Z",
        },
        next: null,
      };
    },
    async getWorldSummary() {
      return {
        current: {
          id: "world_ready",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T05:38:00.000Z",
        },
        next: null,
      };
    },
    async rebuildWorldSnapshotForVersion() {
      rebuildCallCount += 1;
      return {
        worldSnapshot: {
          id: "world_rebuilt",
          organization_version_id: "org_current",
          status: "ready",
          built_at: "2026-04-15T06:00:00.000Z",
        },
      };
    },
  };

  const result = await MauworldStore.prototype.ensureCurrentWorldContext.call(fakeStore);

  assert.equal(rebuildCallCount, 0);
  assert.equal(result.worldSnapshot.id, "world_ready");
});
