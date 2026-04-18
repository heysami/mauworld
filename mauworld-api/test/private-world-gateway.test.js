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

test("private nearby share starts as an origin when no anchor is nearby", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  gateway.clients.add(host);

  let capturedStart = null;
  gateway.browserManager.listSessionsForWorld = () => [];
  gateway.browserManager.startSession = async (input) => {
    capturedStart = { ...input };
    return {
      sessionId: "origin_session",
      id: "origin_session",
      subscribers: new Set([host.viewerSessionId]),
      ...input,
    };
  };
  gateway.browserManager.getSession = (sessionId) => sessionId === "origin_session"
    ? { sessionId: "origin_session", id: "origin_session", subscribers: new Set([host.viewerSessionId]), ...capturedStart }
    : null;
  gateway.broadcastBrowserSession = async () => {};

  await gateway.handleBrowserStart(host, {
    mode: "display-share",
    title: "Host live",
    shareKind: "screen",
    hasVideo: true,
    hasAudio: true,
  });

  assert.equal(capturedStart?.groupRole, "origin");
  assert.equal(capturedStart?.movementLocked, true);
  assert.equal(capturedStart?.listedLive, true);
});

test("private nearby share inside an existing anchor returns join-required", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "profile:requester",
    displayName: "requester",
    position: { x: 32, y: 0, z: 0 },
  });
  gateway.clients.add(host);
  gateway.clients.add(requester);

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  gateway.browserManager.listSessionsForWorld = () => [anchorSession];
  gateway.browserManager.getSession = (sessionId) => sessionId === anchorSession.id ? anchorSession : null;
  let started = false;
  gateway.browserManager.startSession = async () => {
    started = true;
    return null;
  };

  await gateway.handleBrowserStart(requester, {
    mode: "display-share",
    shareKind: "camera",
  });

  assert.equal(started, false);
  assert.equal(
    requester.socket.sent.some((message) =>
      message.type === "share:join-required" && message.anchorSessionId === anchorSession.id),
    true,
  );
});

test("approved private nearby join creates a member share linked to the anchor", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "profile:requester",
    displayName: "requester",
    position: { x: 36, y: 0, z: 0 },
  });
  gateway.clients.add(host);
  gateway.clients.add(requester);

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  gateway.browserManager.listSessionsForWorld = () => [anchorSession];
  gateway.browserManager.getSession = (sessionId) => sessionId === anchorSession.id ? anchorSession : null;
  gateway.grantApprovedShareJoin(anchorSession.id, requester.viewerSessionId, "screen");

  let capturedStart = null;
  gateway.browserManager.startSession = async (input) => {
    capturedStart = { ...input };
    return {
      sessionId: "member_session",
      id: "member_session",
      subscribers: new Set([requester.viewerSessionId]),
      ...input,
    };
  };
  gateway.broadcastBrowserSession = async () => {};

  await gateway.handleBrowserStart(requester, {
    mode: "display-share",
    anchorSessionId: anchorSession.id,
    title: "Should be ignored",
    shareKind: "screen",
    hasVideo: true,
    hasAudio: true,
  });

  assert.equal(capturedStart?.groupRole, "member");
  assert.equal(capturedStart?.anchorSessionId, anchorSession.id);
  assert.equal(capturedStart?.anchorHostSessionId, host.viewerSessionId);
  assert.equal(capturedStart?.listedLive, false);
  assert.equal(capturedStart?.movementLocked, false);
  assert.equal(capturedStart?.title, "");
});

test("private pending nearby join requests can be cancelled", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "profile:requester",
    displayName: "requester",
    position: { x: 36, y: 0, z: 0 },
  });
  gateway.clients.add(host);
  gateway.clients.add(requester);

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  gateway.browserManager.listSessionsForWorld = () => [anchorSession];
  gateway.browserManager.getSession = (sessionId) => sessionId === anchorSession.id ? anchorSession : null;

  await gateway.handleShareJoinRequest(requester, {
    anchorSessionId: anchorSession.id,
    shareKind: "screen",
  });
  gateway.grantApprovedShareJoin(anchorSession.id, requester.viewerSessionId, "screen");

  assert.equal(gateway.pendingShareJoinRequests.size, 1);
  assert.equal(gateway.hasApprovedShareJoin(anchorSession.id, requester.viewerSessionId), true);

  await gateway.handleShareJoinCancel(requester, {
    anchorSessionId: anchorSession.id,
  });

  assert.equal(gateway.pendingShareJoinRequests.size, 0);
  assert.equal(gateway.hasApprovedShareJoin(anchorSession.id, requester.viewerSessionId), false);
  assert.equal(
    requester.socket.sent.some((message) =>
      message.type === "share:join-cancelled" && message.anchorSessionId === anchorSession.id),
    true,
  );
  assert.equal(
    host.socket.sent.some((message) =>
      message.type === "share:join-cancelled" && message.requesterSessionId === requester.viewerSessionId),
    true,
  );
});

test("private member shares stop outside the anchor radius and persistent voice detaches on exit", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "profile:host",
    displayName: "host",
    position: { x: 0, y: 0, z: 0 },
  });
  const memberHost = createClient({
    viewerSessionId: "profile:member",
    displayName: "member",
    position: { x: 260, y: 0, z: 0 },
  });
  const voiceHost = createClient({
    viewerSessionId: "profile:voice",
    displayName: "voice",
    position: { x: 280, y: 0, z: 0 },
  });
  gateway.clients.add(host);
  gateway.clients.add(memberHost);
  gateway.clients.add(voiceHost);

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  const memberSession = {
    id: "member_session",
    sessionId: "member_session",
    hostSessionId: memberHost.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "member",
    anchorSessionId: anchorSession.id,
    anchorHostSessionId: host.viewerSessionId,
    subscribers: new Set([memberHost.viewerSessionId]),
  };
  const voiceSession = {
    id: "voice_session",
    sessionId: "voice_session",
    hostSessionId: voiceHost.viewerSessionId,
    worldSnapshotId: host.browserWorldKey,
    sessionMode: "display-share",
    groupRole: "persistent-voice",
    groupJoined: true,
    anchorSessionId: anchorSession.id,
    anchorHostSessionId: host.viewerSessionId,
    subscribers: new Set([voiceHost.viewerSessionId]),
  };
  const sessions = [anchorSession, memberSession, voiceSession];
  gateway.browserManager.listSessionsForWorld = () => sessions;
  gateway.browserManager.getSession = (sessionId) => sessions.find((session) => session.id === sessionId) ?? null;
  const stoppedSessionIds = [];
  gateway.browserManager.stopSession = async (sessionId) => {
    stoppedSessionIds.push(sessionId);
  };
  gateway.broadcastBrowserSession = async () => {};

  await gateway.rebalanceBrowserSessions(host.browserWorldKey);

  assert.deepEqual(stoppedSessionIds, ["member_session"]);

  await gateway.updatePersistentVoiceOffers(host.browserWorldKey);

  assert.equal(voiceSession.groupJoined, false);
  assert.equal(voiceSession.anchorSessionId, "");
  assert.equal(
    voiceHost.socket.sent.some((message) =>
      message.type === "voice:join-resolved" && /standalone voice chat/i.test(String(message.message ?? ""))),
    true,
  );
});
