import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const shouldRunStartupMaintenance =
  /^https?:\/\//i.test(config.publicBaseUrl)
  && !/\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.publicBaseUrl);
let externalCleanupPromise = null;

async function runCuratedCorpusJob() {
  if (externalCleanupPromise) {
    return externalCleanupPromise;
  }
  externalCleanupPromise = store.syncCuratedCorpus().finally(() => {
    externalCleanupPromise = null;
  });
  return externalCleanupPromise;
}

const app = createApp({ config, store, runMoltbookImportJob: runCuratedCorpusJob });

app.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
  if (shouldRunStartupMaintenance) {
    setTimeout(() => {
      void runCuratedCorpusJob()
        .then((result) => {
          if (result.skipped && (result.importedCount ?? 0) === 0 && (result.scrubbedPostCount ?? 0) === 0) {
            console.log("[curated-corpus-sync] already up to date");
            return;
          }
          console.log(
            `[curated-corpus-sync] scrubbed ${result.scrubbedPostCount ?? 0} posts, `
            + `${result.scrubbedInstallationCount ?? 0} installations, `
            + `pruned ${result.prunedTagCount ?? 0} tags, `
            + `imported ${result.importedCount ?? 0} posts`,
          );
        })
        .catch((error) => {
          console.error("[curated-corpus-sync] failed", error);
        });
    }, 500);
  }
});
