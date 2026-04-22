import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorldGameExportPackage,
  normalizeWorldGamePackage,
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

test("normalizeWorldGameManifest preserves semantic multiplayer seat labels", () => {
  const manifest = normalizeWorldGameManifest({
    title: "Neon Tic-Tac-Toe",
    multiplayer_mode: "turn-based",
    min_players: 2,
    max_players: 2,
    seats: ["X", "O"],
  });

  assert.deepEqual(manifest.seats, ["X", "O"]);
});

test("normalizeWorldGameManifest accepts alternate seat label keys", () => {
  const manifest = normalizeWorldGameManifest({
    title: "Chess",
    multiplayer_mode: "turn-based",
    min_players: 2,
    max_players: 2,
    player_roles: ["White", "Black"],
  });

  assert.deepEqual(manifest.seats, ["White", "Black"]);
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

test("normalizeWorldGamePackage keeps data-url assets editable outside the html", () => {
  const gamePackage = normalizeWorldGamePackage({
    assets: {
      board_icon: {
        mime_type: "image/svg+xml",
        file_name: "board-icon.svg",
        text: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
      },
    },
  });

  assert.equal(gamePackage.format, "mauworld.world-game.package.v1");
  assert.equal(gamePackage.assets.board_icon.kind, "image");
  assert.match(gamePackage.assets.board_icon.data_url, /^data:image\/svg\+xml/);
});

test("validateWorldGameRecord preserves package assets alongside the html template", () => {
  const record = validateWorldGameRecord({
    title: "Packaged Chess",
    prompt: "make chess",
    source_html: `
      <!DOCTYPE html>
      <html>
        <body>
          <img src="{{assets.board_icon}}" alt="board" />
          <script>
            window.MauworldGame.register({
              manifest: { title: "Packaged Chess" },
              mount() { return {}; },
            });
          </script>
        </body>
      </html>
    `,
    manifest: {
      title: "Packaged Chess",
      multiplayer_mode: "turn-based",
      min_players: 2,
      max_players: 2,
    },
    package: {
      assets: {
        board_icon: {
          mime_type: "image/svg+xml",
          file_name: "board-icon.svg",
          text: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
        },
      },
    },
  });

  assert.equal(record.package.assets.board_icon.id, "board_icon");
  assert.equal(record.manifest.package.assets.board_icon.id, "board_icon");
});

test("buildWorldGameExportPackage emits an importable package document", () => {
  const exported = buildWorldGameExportPackage({
    title: "Chess",
    prompt: "make chess",
    source_html: `
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            window.MauworldGame.register({
              manifest: { title: "Chess" },
              mount() { return {}; },
            });
          </script>
        </body>
      </html>
    `,
    manifest: {
      title: "Chess",
      multiplayer_mode: "turn-based",
      min_players: 2,
      max_players: 2,
    },
    package: {
      assets: {},
    },
  });

  assert.equal(exported.format, "mauworld.world-game.v1");
  assert.equal(exported.package.format, "mauworld.world-game.package.v1");
});
