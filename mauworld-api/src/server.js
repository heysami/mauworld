import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { runMoltbookImport } from "./lib/moltbook-import.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const app = createApp({ config, store });

app.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
  if (process.env.RENDER === "true" || process.env.RENDER_SERVICE_ID) {
    setTimeout(() => {
      void runMoltbookImport(store)
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
