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

function createGateway() {
  const gateway = new RealtimeGateway({ config: {} });
  gateway.browserManager.dispose = async () => {};
  gateway.browserManager.toClientSession = (session) => ({
    ...session,
    sessionId: session.sessionId ?? session.id,
  });
  return gateway;
}

function createClient(overrides = {}) {
  const socket = createFakeSocket();
  return {
    socket,
    viewerSessionId: overrides.viewerSessionId ?? "viewer_test",
    worldSnapshotId: overrides.worldSnapshotId ?? "world_current",
    position: overrides.position ?? { x: 0, y: 0, z: 0 },
    headingY: 0,
    movementState: {},
    lastPresenceAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    rateLimit: {},
    isAlive: true,
    cellKey: "",
    browserModes: new Map(),
    profile: overrides.profile ?? { id: `profile_${overrides.viewerSessionId ?? "viewer_test"}` },
    authUser: overrides.authUser ?? { id: `user_${overrides.viewerSessionId ?? "viewer_test"}` },
    isGuest: overrides.isGuest ?? false,
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

test("presence snapshot normalizes browser session payloads for late joiners", async () => {
  const gateway = new RealtimeGateway({ config: {} });
  const socket = createFakeSocket();
  const requestUrl = new URL("http://localhost/api/ws/public/world/current?viewerSessionId=viewer_late");

  gateway.browserManager.listSessionsForWorld = () => [{
    id: "browser_session_2",
    hostSessionId: "viewer_host",
    worldSnapshotId: "world_current",
    status: "ready",
    startedAt: new Date().toISOString(),
    frameTransport: "livekit-display",
    sessionMode: "display-share",
    title: "Shared tab",
    url: "",
    aspectRatio: 16 / 9,
    subscribers: new Set(["viewer_host"]),
  }];
  gateway.rebalanceBrowserSessions = async () => {};

  gateway.handleConnection(socket, requestUrl);
  await gateway.handleMessage(gateway.clients.get("viewer_late"), {
    type: "presence:update",
    worldSnapshotId: "world_current",
    position_x: 1,
    position_y: 0,
    position_z: 1,
  });

  const browserSessionMessage = socket.sent.find((message) => message.type === "browser:session");
  assert.equal(browserSessionMessage?.session?.sessionId, "browser_session_2");
  assert.equal(browserSessionMessage?.session?.hostSessionId, "viewer_host");
  assert.equal(browserSessionMessage?.session?.sessionMode, "display-share");

  await gateway.dispose();
});

test("public nearby share starts as an origin when no anchor is nearby", async () => {
  const gateway = createGateway();
  const host = createClient({ viewerSessionId: "viewer_host" });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  let capturedStart = null;
  gateway.browserManager.getSessionByHost = () => null;
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
  assert.equal(capturedStart?.anchorSessionId, "");

  await gateway.dispose();
});

test("public nearby share inside an existing anchor returns join-required", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "viewer_requester",
    position: { x: 24, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(requester.viewerSessionId, requester);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(requester.viewerSessionId);
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  gateway.browserManager.getSessionByHost = () => null;
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

  await gateway.dispose();
});

test("approved public nearby join creates a member share linked to the anchor", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "viewer_requester",
    position: { x: 32, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(requester.viewerSessionId, requester);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(requester.viewerSessionId);
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  gateway.browserManager.getSessionByHost = () => null;
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

  await gateway.dispose();
});

test("public member shares stop outside the anchor radius and persistent voice detaches on exit", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const memberHost = createClient({
    viewerSessionId: "viewer_member",
    position: { x: 260, y: 0, z: 0 },
  });
  const voiceHost = createClient({
    viewerSessionId: "viewer_voice",
    position: { x: 280, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(memberHost.viewerSessionId, memberHost);
  gateway.clients.set(voiceHost.viewerSessionId, voiceHost);
  for (const client of [host, memberHost, voiceHost]) {
    gateway.getWorldMemberIds(host.worldSnapshotId).add(client.viewerSessionId);
  }

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId]),
  };
  const memberSession = {
    id: "member_session",
    sessionId: "member_session",
    hostSessionId: memberHost.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
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
    worldSnapshotId: host.worldSnapshotId,
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

  await gateway.rebalanceBrowserSessions(host.worldSnapshotId, {
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  assert.deepEqual(stoppedSessionIds, ["member_session"]);

  await gateway.updatePersistentVoiceOffers(host.worldSnapshotId, {
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  assert.equal(voiceSession.groupJoined, false);
  assert.equal(voiceSession.anchorSessionId, "");
  assert.equal(
    voiceHost.socket.sent.some((message) =>
      message.type === "voice:join-resolved" && /standalone voice chat/i.test(String(message.message ?? ""))),
    true,
  );

  await gateway.dispose();
});
