import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSessionManager } from "../src/lib/browser-session-manager.js";

test("shared browser allowlist supports wildcard allow-all", () => {
  const manager = new BrowserSessionManager({
    allowedHosts: ["*"],
  });

  assert.equal(manager.allowedHosts.allowAll, true);
  assert.equal(manager.allowedHosts.hosts.size, 0);
});

test("shared browser allowlist keeps exact hosts when wildcard is absent", () => {
  const manager = new BrowserSessionManager({
    allowedHosts: ["youtube.com", "www.youtube.com"],
  });

  assert.equal(manager.allowedHosts.allowAll, false);
  assert.equal(manager.allowedHosts.hosts.has("youtube.com"), true);
  assert.equal(manager.allowedHosts.hosts.has("www.youtube.com"), true);
});

test("shared browser starts sessions after navigation commit", async () => {
  const navigationCalls = [];
  let currentUrl = "about:blank";
  const fakePage = {
    on() {},
    async goto(url, options) {
      navigationCalls.push(options);
      currentUrl = url;
    },
    url() {
      return currentUrl;
    },
    async title() {
      return "Video";
    },
    async evaluate() {
      return null;
    },
  };
  const fakeContext = {
    async newPage() {
      return fakePage;
    },
    async close() {
      return null;
    },
  };
  const fakeBrowser = {
    async newContext() {
      return fakeContext;
    },
  };

  const manager = new BrowserSessionManager({
    allowedHosts: ["*"],
  });
  manager.ensureBrowser = async () => fakeBrowser;
  manager.startFramePump = () => {};

  const session = await manager.startSession({
    hostSessionId: "viewer_host",
    worldSnapshotId: "world_current",
    url: "https://www.youtube.com/watch?v=6gA_qoGmKzo",
  });

  assert.equal(session.status, "ready");
  assert.equal(navigationCalls.length, 1);
  assert.equal(navigationCalls[0].waitUntil, "commit");
  assert.equal(navigationCalls[0].timeout, 30000);
});

test("shared browser schedules an interaction capture after pointer input", async () => {
  const manager = new BrowserSessionManager({
    allowedHosts: ["*"],
  });
  const calls = [];
  const session = {
    id: "browser_test",
    hostSessionId: "viewer_host",
    worldSnapshotId: "world_current",
    lastFrameAt: 0,
    captureInFlight: false,
    captureAfterInputTimer: null,
    page: {
      async bringToFront() {},
      mouse: {
        async move(x, y) {
          calls.push(["move", x, y]);
        },
        async click(x, y) {
          calls.push(["click", x, y]);
        },
      },
    },
  };
  manager.sessions.set(session.id, session);

  let queued = 0;
  manager.queueInteractionCapture = () => {
    queued += 1;
  };

  await manager.handleInput(session.id, {
    kind: "pointer",
    action: "click",
    x: 24,
    y: 32,
    button: "left",
  });

  assert.deepEqual(calls, [
    ["move", 24, 32],
    ["click", 24, 32],
  ]);
  assert.equal(queued, 1);
});
