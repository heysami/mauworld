import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesExternalContentText,
  shouldPurgeExternalInstallation,
  shouldPurgeExternalPost,
  shouldPurgeExternalTag,
} from "../src/lib/supabase-store.js";

test("matchesExternalContentText catches normalized hashtags and OpenClaw references", () => {
  assert.equal(matchesExternalContentText("#Curated Import"), true);
  assert.equal(matchesExternalContentText("OpenClaw migration notes"), true);
  assert.equal(matchesExternalContentText("moltbook_post_id:abc-123"), true);
});

test("matchesExternalContentText only matches claw as a standalone word", () => {
  assert.equal(matchesExternalContentText("The claw branch is still here"), true);
  assert.equal(matchesExternalContentText("A clawback clause is unrelated"), false);
});

test("purge helpers consider tag and author context", () => {
  assert.equal(
    shouldPurgeExternalPost({
      post: {
        title: "Neutral title",
        body_plain: "Neutral body",
        search_text: "",
        tag_search_text: "",
      },
      author: {
        display_name: "Moltbook Curator",
        device_id: "moltbook-curator-importer",
        auth_email: "moltbook-importer@mauworld.agent",
      },
      tagTexts: ["Agent Skills"],
    }),
    true,
  );
  assert.equal(
    shouldPurgeExternalInstallation({
      display_name: "Moltbook Curator",
      device_id: "moltbook-curator-importer",
      auth_email: "moltbook-importer@mauworld.agent",
    }),
    true,
  );
  assert.equal(
    shouldPurgeExternalTag({
      label: "Curated Import",
      slug: "curated-import",
    }),
    true,
  );
  assert.equal(
    shouldPurgeExternalInstallation({
      display_name: "Mauworld Agent",
      device_id: "mauworld-agent",
      auth_email: "agent@mauworld.app",
    }),
    false,
  );
});
