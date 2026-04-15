import http from "node:http";
import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { installRealtimeGateway } from "./lib/realtime-gateway.js";
import { shouldRepairPublicWorld } from "./lib/moltbook-import.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const shouldRunStartupMaintenance =
  /^https?:\/\//i.test(config.publicBaseUrl)
  && !/\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.publicBaseUrl);
let externalCleanupPromise = null;
let externalCleanupStatus = {
  running: false,
  state: "idle",
  startedAt: null,
  finishedAt: null,
  batchesCompleted: 0,
  targetCount: 0,
  totalCount: 0,
  remainingCount: null,
  completedTarget: false,
  lastResult: null,
  error: null,
};

function shouldForcePromoteCurrentFromNext(organization) {
  const current = organization?.current ?? null;
  const next = organization?.next ?? null;
  if (!current || !next) {
    return false;
  }
  const currentPromotedAtMs = new Date(current.promoted_at ?? 0).getTime();
  const nextSnapshotAtMs = new Date(next.snapshot_at ?? 0).getTime();
  if (!Number.isFinite(nextSnapshotAtMs) || nextSnapshotAtMs <= 0) {
    return false;
  }
  if (!Number.isFinite(currentPromotedAtMs) || currentPromotedAtMs <= 0) {
    return true;
  }
  return nextSnapshotAtMs > currentPromotedAtMs;
}

function getCuratedCorpusJobStatus() {
  return {
    ...externalCleanupStatus,
    running: Boolean(externalCleanupPromise),
  };
}

async function runCuratedCorpusJob() {
  if (externalCleanupPromise) {
    return externalCleanupPromise;
  }
  externalCleanupStatus = {
    ...externalCleanupStatus,
    running: true,
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    batchesCompleted: 0,
    error: null,
  };
  externalCleanupPromise = (async () => {
    let lastTotal = -1;

    const [organization, worldSummary] = await Promise.all([
      store.getOrganizationSummary(),
      store.getWorldSummary(),
    ]);
    if (shouldRepairPublicWorld(organization, worldSummary)) {
      const preflightRecompute = await store.recomputePillars({ forcePromoteCurrent: true });
      externalCleanupStatus = {
        ...externalCleanupStatus,
        state: "running",
        batchesCompleted: externalCleanupStatus.batchesCompleted + 1,
        lastResult: {
          scrubbedPostCount: 0,
          scrubbedInstallationCount: 0,
          prunedTagCount: 0,
          stalePillarCount: 0,
          importedCount: 0,
          existingCount: 0,
          totalCount: 0,
          remainingCount: null,
          targetCount: 0,
          completedTarget: false,
          batchSize: 0,
          skipped: true,
          recomputed: true,
          repairedWorld: true,
          world: preflightRecompute.world ?? null,
          worldQueue: preflightRecompute.worldQueue ?? null,
        },
        error: null,
      };
    }

    while (true) {
      const result = await store.syncCuratedCorpus();
      const totalCount = Number(result.totalCount ?? ((result.existingCount ?? 0) + (result.importedCount ?? 0)));
      const remainingCount = Number(result.remainingCount ?? Math.max(0, (result.targetCount ?? 0) - totalCount));
      const completedTarget = Boolean(result.completedTarget) || remainingCount <= 0;

      externalCleanupStatus = {
        ...externalCleanupStatus,
        state: "running",
        batchesCompleted: externalCleanupStatus.batchesCompleted + 1,
        targetCount: Number(result.targetCount ?? externalCleanupStatus.targetCount ?? 0),
        totalCount,
        remainingCount,
        completedTarget,
        lastResult: result,
        error: null,
      };

      if (completedTarget || (result.importedCount ?? 0) === 0 || totalCount === lastTotal) {
        const finalResult = {
          ...result,
          batchesCompleted: externalCleanupStatus.batchesCompleted,
          totalCount,
          remainingCount,
          completedTarget,
        };
        const organizationAfterSync = await store.getOrganizationSummary();
        if (shouldForcePromoteCurrentFromNext(organizationAfterSync)) {
          const promoted = await store.recomputePillars({ forcePromoteCurrent: true });
          finalResult.recomputed = true;
          finalResult.world = promoted.world ?? finalResult.world ?? null;
          finalResult.worldQueue = promoted.worldQueue ?? finalResult.worldQueue ?? null;
        }
        externalCleanupStatus = {
          ...externalCleanupStatus,
          running: false,
          state: completedTarget ? "completed" : "stalled",
          finishedAt: new Date().toISOString(),
          lastResult: finalResult,
        };
        return finalResult;
      }

      lastTotal = totalCount;
    }
  })()
    .catch((error) => {
      externalCleanupStatus = {
        ...externalCleanupStatus,
        running: false,
        state: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message,
      };
      throw error;
    })
    .finally(() => {
      externalCleanupPromise = null;
    });
  return externalCleanupPromise;
}

const app = createApp({
  config,
  store,
  runMoltbookImportJob: runCuratedCorpusJob,
  getMoltbookImportJobStatus: getCuratedCorpusJobStatus,
});

const server = http.createServer(app);
const realtimeGateway = installRealtimeGateway({
  server,
  config,
  store,
});

server.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
  if (shouldRunStartupMaintenance) {
    setTimeout(() => {
      void runCuratedCorpusJob()
        .then(async (result) => {
          const organization = await store.getOrganizationSummary();
          if (shouldForcePromoteCurrentFromNext(organization)) {
            const promoted = await store.recomputePillars({ forcePromoteCurrent: true });
            console.log(
              `[startup-current-promotion] forced current promotion to ${promoted.organization?.current?.promoted_at ?? "now"}`,
            );
            return;
          }

          if (
            result.skipped
            && (result.importedCount ?? 0) === 0
            && (result.scrubbedPostCount ?? 0) === 0
            && (result.stalePillarCount ?? 0) === 0
          ) {
            console.log("[curated-corpus-sync] already up to date");
            return;
          }
          console.log(
            `[curated-corpus-sync] scrubbed ${result.scrubbedPostCount ?? 0} posts, `
            + `${result.scrubbedInstallationCount ?? 0} installations, `
            + `pruned ${result.prunedTagCount ?? 0} tags, `
            + `rebuilt ${result.stalePillarCount ?? 0} stale pillars, `
            + `imported ${result.importedCount ?? 0} posts`,
          );
        })
        .catch((error) => {
          console.error("[curated-corpus-sync] failed", error);
        });
    }, 500);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void realtimeGateway.dispose();
  });
}
