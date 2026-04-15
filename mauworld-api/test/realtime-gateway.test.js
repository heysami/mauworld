import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeGateway } from "../src/lib/realtime-gateway.js";

function createFakeSocket() {
  const handlers = new Map();
  const sent = [];
  return {
    handlers,
    sent,
    readyState: 1,
    on(event, handler) {
      handlers.set(event, handler);
    },
    send(payload) {
      sent.push(JSON.parse(payload));
    },
    close() {},
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test("gateway queues client websocket messages in arrival order", async () => {
  const gateway = new RealtimeGateway({ config: {} });
  const socket = createFakeSocket();
  const requestUrl = new URL("http://localhost/api/ws/public/world/current?viewerSessionId=viewer_test");
  const observed = [];
  const releases = [];

  gateway.handleConnection(socket, requestUrl);
  gateway.handleMessage = async (_client, message) => {
    observed.push(`start:${message.type}`);
    await new Promise((resolve) => {
      releases.push(resolve);
    });
    observed.push(`end:${message.type}`);
  };

  socket.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "first" })));
  socket.handlers.get("message")?.(Buffer.from(JSON.stringify({ type: "second" })));
  await waitFor(() => observed.length === 1, "first message should start immediately");

  assert.deepEqual(observed, ["start:first"]);

  releases.shift()?.();
  await waitFor(() => observed.join(",") === "start:first,end:first,start:second", "second message should wait for first");

  assert.deepEqual(observed, ["start:first", "end:first", "start:second"]);

  releases.shift()?.();
  await waitFor(() => observed.join(",") === "start:first,end:first,start:second,end:second", "second message should finish after release");

  assert.deepEqual(observed, ["start:first", "end:first", "start:second", "end:second"]);
  await gateway.dispose();
});

test("presence snapshot replays current browser subscribe state for reconnecting viewers", async () => {
  const gateway = new RealtimeGateway({ config: {} });
  const socket = createFakeSocket();
  const requestUrl = new URL("http://localhost/api/ws/public/world/current?viewerSessionId=viewer_test");

  gateway.browserManager.listSessionsForWorld = () => [{
    id: "browser_session_1",
    sessionId: "browser_session_1",
    hostSessionId: "viewer_host",
    worldSnapshotId: "world_current",
    status: "ready",
    startedAt: new Date().toISOString(),
    frameTransport: "livekit-display",
    sessionMode: "display-share",
    subscribers: new Set(["viewer_test", "viewer_host"]),
  }];
  gateway.rebalanceBrowserSessions = async () => {};

  gateway.handleConnection(socket, requestUrl);
  await gateway.handleMessage(gateway.clients.get("viewer_test"), {
    type: "presence:update",
    worldSnapshotId: "world_current",
    position_x: 10,
    position_y: 0,
    position_z: 10,
  });

  assert.equal(
    socket.sent.some((message) => message.type === "browser:session" && message.session?.sessionId === "browser_session_1"),
    true,
  );
  assert.equal(
    socket.sent.some((message) => message.type === "browser:subscribe" && message.sessionId === "browser_session_1"),
    true,
  );

  await gateway.dispose();
});
