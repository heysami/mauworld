import { createApp } from "./create-app.js";
import { loadConfig } from "./config.js";
import { MauworldStore } from "./lib/supabase-store.js";

const config = loadConfig();
const store = new MauworldStore(config);
const app = createApp({ config, store });

app.listen(config.port, () => {
  console.log(`mauworld-api listening on :${config.port}`);
});
