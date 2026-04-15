import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeGateway } from "../src/lib/realtime-gateway.js";

function createFakeSocket() {
  const handlers = new Map();
  return {
    handlers,
    readyState: 1,
    on(event, handler) {
      handlers.set(event, handler);
    },
    send() {},
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
