import test from "node:test";
import assert from "node:assert/strict";
import { PrivateWorldGateway } from "../src/lib/private-world-gateway.js";

function createFakeSocket() {
  const sent = [];
  return {
    sent,
    readyState: 1,
    on() {},
    send(payload) {
      sent.push(JSON.parse(payload));
    },
    close() {},
  };
}

function createClient(overrides = {}) {
  const socket = createFakeSocket();
  return {
    socket,
    worldId: "world_test",
    creatorUsername: "creator",
    browserWorldKey: "private:world_test:creator",
    viewerSessionId: overrides.viewerSessionId ?? "viewer_test",
    displayName: overrides.displayName ?? "viewer",
    profile: overrides.profile ?? { id: `profile_${overrides.viewerSessionId ?? "viewer_test"}` },
    guestSessionId: overrides.guestSessionId ?? null,
    presence: overrides.position
      ? {
        position_x: overrides.position.x,
        position_y: overrides.position.y,
        position_z: overrides.position.z,
        heading_y: 0,
      }
      : null,
    position: overrides.position ?? null,
    chatRateLimitState: {},
    browserModes: new Map(),
  };
}

function createGateway(storeOverrides = {}) {
  const gateway = new PrivateWorldGateway({
    config: {},
    store: {
      subscribePrivateWorldEvents() {
        return () => {};
      },
      async touchPrivateWorldParticipant() {
        return { touched: true };
      },
      async leavePrivateWorld() {
        return { removed: true };
      },
      ...storeOverrides,
    },
  });
  gateway.browserManager.dispose = async () => {};
  gateway.browserManager.toClientSession = (session) => ({
    ...session,
    sessionId: session.sessionId ?? session.id,
  });
  gateway.browserManager.getSessionByHost = () => null;
  gateway.browserManager.stopSession = async () => {};
  return gateway;
}

test("private world chat uses full text nearby and placeholders at distance", () => {
  const gateway = createGateway();
  const sender = createClient({
    viewerSessionId: "profile:sender",
    displayName: "sender",
    position: { x: 0, y: 0, z: 0 },
  });
  const nearby = createClient({
    viewerSessionId: "profile:nearby",
    displayName: "nearby",
    position: { x: 12, y: 0, z: 0 },
  });
  const far = createClient({
    viewerSessionId: "profile:far",
    displayName: "far",
    position: { x: 400, y: 0, z: 0 },
  });
  gateway.clients.add(sender);
  gateway.clients.add(nearby);
  gateway.clients.add(far);

  gateway.handleChatSend(sender, { text: "hello there" });

  assert.equal(sender.socket.sent.at(-1)?.type, "chat:event");
  assert.equal(sender.socket.sent.at(-1)?.mode, "full");
  assert.equal(sender.socket.sent.at(-1)?.text, "hello there");
  assert.equal(nearby.socket.sent.at(-1)?.type, "chat:event");
  assert.equal(nearby.socket.sent.at(-1)?.mode, "full");
  assert.equal(nearby.socket.sent.at(-1)?.text, "hello there");
  assert.equal(far.socket.sent.at(-1)?.type, "chat:event");
  assert.equal(far.socket.sent.at(-1)?.mode, "placeholder");
  assert.equal(far.socket.sent.at(-1)?.text, "...");
});

test("private world browser audience rebalances to nearby subscribers only", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  const nearby = createClient({
    viewerSessionId: "profile:nearby",
    displayName: "nearby",
    position: { x: 10, y: 0, z: 0 },
  });
  const far = createClient({
    viewerSessionId: "profile:far",
    displayName: "far",
    position: { x: 260, y: 0, z: 0 },
  });
  gateway.clients.add(host);
  gateway.clients.add(nearby);
  gateway.clients.add(far);

  const session = {
    id: "browser_session_1",
    sessionId: "browser_session_1",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    subscribers: new Set([host.viewerSessionId, far.viewerSessionId]),
    viewerCount: 1,
    maxViewers: 20,
    status: "ready",
  };
  gateway.browserManager.listSessionsForWorld = () => [session];
  gateway.browserManager.getSession = () => session;

  await gateway.rebalanceBrowserSessions(host.browserWorldKey);

  assert.equal(session.subscribers.has(host.viewerSessionId), true);
  assert.equal(session.subscribers.has(nearby.viewerSessionId), true);
  assert.equal(session.subscribers.has(far.viewerSessionId), false);
  assert.equal(
    nearby.socket.sent.some((message) => message.type === "browser:subscribe" && message.sessionId === session.sessionId),
    true,
  );
  assert.equal(
    far.socket.sent.some((message) => message.type === "browser:unsubscribe" && message.sessionId === session.sessionId),
    true,
  );
});

test("private world presence updates refresh participant heartbeat in the store", async () => {
  const touches = [];
  const gateway = createGateway({
    async touchPrivateWorldParticipant(payload) {
      touches.push(payload);
      return { touched: true };
    },
  });
  const client = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  gateway.clients.add(client);

  await gateway.handlePresenceUpdate(client, {
    position_x: 4,
    position_y: 1,
    position_z: -2,
    heading_y: 0.4,
  });

  assert.equal(touches.length, 1);
  assert.equal(touches[0].worldId, "world_test");
  assert.equal(touches[0].creatorUsername, "creator");
  assert.equal(touches[0].profile.id, client.profile.id);
});

test("private world disconnect cleans up the participant in the store", async () => {
  const leaves = [];
  const gateway = createGateway({
    async leavePrivateWorld(payload) {
      leaves.push(payload);
      return { removed: true };
    },
  });
  const client = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  gateway.clients.add(client);

  await gateway.handleDisconnect(client);

  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].worldId, "world_test");
  assert.equal(leaves[0].creatorUsername, "creator");
  assert.equal(leaves[0].profile.id, client.profile.id);
});
