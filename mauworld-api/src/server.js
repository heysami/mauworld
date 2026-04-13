import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { runMoltbookImport } from "./lib/moltbook-import.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const shouldRunMoltbookImport =
  /^https?:\/\//i.test(config.publicBaseUrl)
  && !/\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.publicBaseUrl);
let moltbookImportPromise = null;

async function runMoltbookImportJob() {
  if (moltbookImportPromise) {
    return moltbookImportPromise;
  }
  moltbookImportPromise = runMoltbookImport(store).finally(() => {
    moltbookImportPromise = null;
  });
  return moltbookImportPromise;
}

const app = createApp({ config, store, runMoltbookImportJob });

app.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
  if (shouldRunMoltbookImport) {
    setTimeout(() => {
      void runMoltbookImportJob()
        .then((result) => {
          if (result.skipped) {
            console.log(`[moltbook-import] skipped (${result.existingCount ?? 0} existing imports)`);
            return;
          }
          console.log(`[moltbook-import] imported ${result.importedCount ?? 0} posts`);
        })
        .catch((error) => {
          console.error("[moltbook-import] failed", error);
        });
    }, 500);
  }
});
