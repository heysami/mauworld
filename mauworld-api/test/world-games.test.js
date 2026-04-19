import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorldGameManifest,
  sanitizeWorldGameHtml,
  validateWorldGameRecord,
} from "../src/lib/world-games.js";

test("normalizeWorldGameManifest applies Mauworld multiplayer defaults", () => {
  const manifest = normalizeWorldGameManifest({
    title: "Chess",
    multiplayer_mode: "turn-based",
    min_players: 2,
    max_players: 2,
  });

  assert.equal(manifest.title, "Chess");
  assert.equal(manifest.allow_viewers, true);
  assert.equal(manifest.preview.mode, "sdk");
  assert.equal(Array.isArray(manifest.seats), true);
  assert.equal(manifest.seats.length, 2);
});

test("sanitizeWorldGameHtml accepts a registered single-file game", () => {
  const html = sanitizeWorldGameHtml(`
    <!DOCTYPE html>
    <html>
      <body>
        <script>
          window.MauworldGame.register({
            manifest: { title: "Chess" },
            mount(api) {
              api.root.textContent = "ready";
              return {};
            },
          });
        </script>
      </body>
    </html>
  `);

  assert.match(html, /MauworldGame\.register/);
});

test("sanitizeWorldGameHtml rejects direct network calls", () => {
  assert.throws(
    () => sanitizeWorldGameHtml(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            fetch("https://example.com");
            window.MauworldGame.register({ mount() { return {}; } });
          </script>
        </body>
      </html>
    `),
    /Direct network APIs are not allowed/,
  );
});

test("validateWorldGameRecord keeps provider metadata without requiring stored keys", () => {
  const record = validateWorldGameRecord({
    title: "Mini Chess",
    prompt: "make chess",
    ai_provider: "openai",
    ai_model: "gpt-5.4-mini",
    source_html: `
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            window.MauworldGame.register({
              manifest: { title: "Mini Chess" },
              mount() { return {}; },
            });
          </script>
        </body>
      </html>
    `,
    manifest: {
      title: "Mini Chess",
      multiplayer_mode: "turn-based",
      min_players: 2,
      max_players: 2,
    },
  });

  assert.equal(record.ai_provider, "openai");
  assert.equal(record.ai_model, "gpt-5.4-mini");
  assert.equal(record.manifest.title, "Mini Chess");
});
