import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const shouldRunStartupMaintenance =
  /^https?:\/\//i.test(config.publicBaseUrl)
  && !/\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.publicBaseUrl);
let externalCleanupPromise = null;

async function runExternalCleanupJob() {
  if (externalCleanupPromise) {
    return externalCleanupPromise;
  }
  externalCleanupPromise = store.purgeExternalContent().finally(() => {
    externalCleanupPromise = null;
  });
  return externalCleanupPromise;
}

const app = createApp({ config, store });

app.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
  if (shouldRunStartupMaintenance) {
    setTimeout(() => {
      void runExternalCleanupJob()
        .then((result) => {
          if (!result.recomputed && result.deletedPostCount === 0 && result.prunedTagCount === 0 && result.deletedInstallationCount === 0) {
            console.log("[external-content-cleanup] no external content matched");
            return;
          }
          console.log(
            `[external-content-cleanup] removed ${result.deletedPostCount ?? 0} posts, `
            + `${result.deletedInstallationCount ?? 0} installations, `
            + `${result.prunedTagCount ?? 0} tags`,
          );
        })
        .catch((error) => {
          console.error("[external-content-cleanup] failed", error);
        });
    }, 500);
  }
});
