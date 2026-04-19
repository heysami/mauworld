import test from "node:test";
import assert from "node:assert/strict";
import { GameShareManager } from "../src/lib/game-share-manager.js";

function createSavedGame() {
  return {
    id: "game_chess",
    owner_profile_id: "profile_host",
    title: "Chess",
    prompt: "generate chess",
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
      description: "A tiny chess board",
      multiplayer_mode: "turn-based",
      min_players: 2,
      max_players: 2,
      allow_viewers: true,
      aspect_ratio: 1.6,
      preview: { mode: "sdk", fps: 4, width: 480, height: 270 },
      seats: ["White", "Black"],
    },
  };
}

test("game share manager claims seats first-come and enforces ready before start", () => {
  const manager = new GameShareManager({ scope: "public" });
  const session = manager.createSession({
    bindingKey: "world_current",
    hostViewerSessionId: "viewer_host",
    hostDisplayName: "Host",
    game: createSavedGame(),
  });

  const claimed = manager.claimSeat(session.session_id, "viewer_guest", "Guest", "white");
  assert.equal(claimed.seats.find((seat) => seat.seat_id === "white")?.viewer_session_id, "viewer_guest");
  assert.throws(
    () => manager.claimSeat(session.session_id, "viewer_other", "Other", "white"),
    /already taken/,
  );

  const hostSeat = manager.claimSeat(session.session_id, "viewer_host", "Host", "black");
  assert.equal(hostSeat.seats.find((seat) => seat.seat_id === "black")?.viewer_session_id, "viewer_host");

  assert.throws(
    () => manager.startMatch(session.session_id, "viewer_host"),
    /Every seated player must be ready/,
  );

  const ready = manager.setReady(session.session_id, "viewer_guest", true);
  assert.equal(ready.seats.find((seat) => seat.seat_id === "white")?.ready, true);
  manager.setReady(session.session_id, "viewer_host", true);

  const started = manager.startMatch(session.session_id, "viewer_host");
  assert.equal(started.started, true);
});

test("game share manager relays authoritative state and cleans up host sessions", () => {
  const manager = new GameShareManager({ scope: "private" });
  const session = manager.createSession({
    bindingKey: "private:world:maker",
    hostViewerSessionId: "viewer_host",
    hostDisplayName: "Host",
    game: createSavedGame(),
  });

  const statePayload = manager.applyHostState(session.session_id, "viewer_host", {
    turn: "white",
    board: ["r", "n"],
  }, { started: true });
  assert.equal(statePayload.session.started, true);
  assert.deepEqual(statePayload.state, { turn: "white", board: ["r", "n"] });

  const preview = manager.updatePreview(session.session_id, "viewer_host", {
    data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9nK7wAAAAASUVORK5CYII=",
    width: 320,
    height: 180,
  });
  assert.equal(preview.latest_preview?.width, 320);

  const removed = manager.removeViewerSession("viewer_host");
  assert.equal(removed.stopped.length, 1);
  assert.equal(manager.getSession(session.session_id), null);
});

test("game share manager lets hosts release any occupied seat", () => {
  const manager = new GameShareManager({ scope: "public" });
  const session = manager.createSession({
    bindingKey: "world_current",
    hostViewerSessionId: "viewer_host",
    hostDisplayName: "Host",
    game: createSavedGame(),
  });

  manager.claimSeat(session.session_id, "viewer_guest", "Guest", "white");
  manager.setReady(session.session_id, "viewer_guest", true);

  const selfReleased = manager.releaseSeat(session.session_id, "viewer_guest", "white");
  assert.equal(selfReleased.seats.find((seat) => seat.seat_id === "white")?.viewer_session_id, null);

  manager.claimSeat(session.session_id, "viewer_guest", "Guest", "white");
  manager.setReady(session.session_id, "viewer_guest", true);
  manager.claimSeat(session.session_id, "viewer_host", "Host", "black");

  assert.throws(
    () => manager.releaseSeat(session.session_id, "viewer_guest", "black"),
    /Only the host can release other player seats/,
  );

  const released = manager.releaseSeat(session.session_id, "viewer_host", "white");
  const whiteSeat = released.seats.find((seat) => seat.seat_id === "white");
  assert.equal(whiteSeat?.viewer_session_id, null);
  assert.equal(whiteSeat?.ready, false);
});

test("game share manager normalizes multiplayer manifests into joinable seat counts", () => {
  const manager = new GameShareManager({ scope: "public" });
  const baseGame = createSavedGame();
  const session = manager.createSession({
    bindingKey: "world_current",
    hostViewerSessionId: "viewer_host",
    hostDisplayName: "Host",
    game: {
      ...baseGame,
      manifest: {
        ...baseGame.manifest,
        multiplayer_mode: "turn-based",
        min_players: 1,
        max_players: 1,
      },
    },
  });

  assert.equal(session.seats.length, 2);

  manager.claimSeat(session.session_id, "viewer_host", "Host", "white");
  manager.setReady(session.session_id, "viewer_host", true);

  assert.throws(
    () => manager.startMatch(session.session_id, "viewer_host"),
    /At least 2 players must be seated/,
  );
});
