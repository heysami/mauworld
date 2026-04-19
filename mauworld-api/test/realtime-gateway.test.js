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

test("public game share starts, opens, and relays player actions to the host", async () => {
  const gateway = createGateway();
  gateway.store = {
    async getWorldGame() {
      return {
        game: {
          id: "game_123",
          owner_profile_id: "profile_viewer_host",
          title: "Chess",
          prompt: "make chess",
          source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
          manifest: {
            title: "Chess",
            multiplayer_mode: "turn-based",
            min_players: 2,
            max_players: 2,
            allow_viewers: true,
            aspect_ratio: 1.6,
            preview: { mode: "sdk", fps: 4, width: 480, height: 270 },
            seats: ["White", "Black"],
          },
        },
      };
    },
  };
  const host = createClient({ viewerSessionId: "viewer_host" });
  const guest = createClient({ viewerSessionId: "viewer_guest" });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(guest.viewerSessionId, guest);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(guest.viewerSessionId);

  await gateway.handleGameStartShare(host, { gameId: "game_123" });

  const sessionMessage = guest.socket.sent.find((message) => message.type === "game:session");
  assert.equal(sessionMessage?.session?.game?.title, "Chess");

  await gateway.handleGameOpen(guest, { sessionId: sessionMessage.session.session_id });
  const openMessage = guest.socket.sent.find((message) => message.type === "game:open");
  assert.equal(openMessage?.game?.title, "Chess");

  await gateway.handleGameSeatClaim(guest, { sessionId: sessionMessage.session.session_id, seatId: "white" });
  await gateway.handleGameAction(guest, {
    sessionId: sessionMessage.session.session_id,
    action: { type: "move", from: "e2", to: "e4" },
  });
  const actionMessage = host.socket.sent.find((message) => message.type === "game:action");
  assert.deepEqual(actionMessage?.action, { type: "move", from: "e2", to: "e4" });

  await gateway.dispose();
});

test("public game previews subscribe nearby viewers without rebroadcasting preview blobs in game sessions", async () => {
  const gateway = createGateway();
  gateway.store = {
    async getWorldGame() {
      return {
        game: {
          id: "game_preview",
          owner_profile_id: "profile_viewer_host",
          title: "Preview Game",
          prompt: "make preview game",
          source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
          manifest: {
            title: "Preview Game",
            multiplayer_mode: "turn-based",
            min_players: 2,
            max_players: 2,
            allow_viewers: true,
            aspect_ratio: 1.6,
            preview: { mode: "sdk", fps: 4, width: 480, height: 270 },
          },
        },
      };
    },
  };
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const nearby = createClient({
    viewerSessionId: "viewer_nearby",
    position: { x: 16, y: 0, z: 0 },
  });
  const far = createClient({
    viewerSessionId: "viewer_far",
    position: { x: 320, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(nearby.viewerSessionId, nearby);
  gateway.clients.set(far.viewerSessionId, far);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(nearby.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(far.viewerSessionId);

  await gateway.handleGameStartShare(host, { gameId: "game_preview" });

  const session = gateway.getHostedGameSession(host.viewerSessionId, host.worldSnapshotId);
  const sessionId = session?.id ?? session?.session_id;
  assert.equal(Boolean(session), true);
  assert.equal(session.preview_subscribers.has(host.viewerSessionId), true);
  assert.equal(session.preview_subscribers.has(nearby.viewerSessionId), true);
  assert.equal(session.preview_subscribers.has(far.viewerSessionId), false);
  assert.equal(
    nearby.socket.sent.some((message) => message.type === "game:subscribe" && message.sessionId === sessionId),
    true,
  );
  assert.equal(
    far.socket.sent.some((message) => message.type === "game:subscribe" && message.sessionId === sessionId),
    false,
  );

  await gateway.handleGamePreview(host, {
    sessionId,
    preview: {
      data_url: "data:image/png;base64,AAAA",
      width: 480,
      height: 270,
    },
  });

  assert.equal(
    host.socket.sent.some((message) => message.type === "game:preview" && message.sessionId === sessionId),
    true,
  );
  assert.equal(
    nearby.socket.sent.some((message) => message.type === "game:preview" && message.sessionId === sessionId),
    true,
  );
  assert.equal(
    far.socket.sent.some((message) => message.type === "game:preview" && message.sessionId === sessionId),
    false,
  );
  assert.equal(
    [...host.socket.sent, ...nearby.socket.sent, ...far.socket.sent]
      .filter((message) => message.type === "game:session")
      .every((message) => !("latest_preview" in (message.session ?? {}))),
    true,
  );

  await gateway.dispose();
});

test("public game share inside an existing nearby game anchor returns join-required", async () => {
  const gateway = createGateway();
  gateway.store = {
    async getWorldGame() {
      return {
        game: {
          id: "game_request",
          owner_profile_id: "profile_viewer_requester",
          title: "Checkers",
          prompt: "make checkers",
          source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
          manifest: {
            title: "Checkers",
            multiplayer_mode: "turn-based",
            min_players: 2,
            max_players: 2,
            allow_viewers: true,
            aspect_ratio: 1.6,
          },
        },
      };
    },
  };
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const requester = createClient({
    viewerSessionId: "viewer_requester",
    position: { x: 28, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(requester.viewerSessionId, requester);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(requester.viewerSessionId);

  const anchorSession = gateway.gameShares.createSession({
    scope: "public",
    bindingKey: host.worldSnapshotId,
    hostViewerSessionId: host.viewerSessionId,
    hostDisplayName: "Host",
    groupRole: "origin",
    listedLive: true,
    movementLocked: true,
    game: {
      id: "game_anchor",
      owner_profile_id: "profile_viewer_host",
      title: "Chess",
      prompt: "make chess",
      source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
      manifest: {
        title: "Chess",
        multiplayer_mode: "turn-based",
        min_players: 2,
        max_players: 2,
        allow_viewers: true,
        aspect_ratio: 1.6,
      },
    },
  });

  await gateway.handleGameStartShare(requester, { gameId: "game_request" });

  assert.equal(
    requester.socket.sent.some((message) =>
      message.type === "share:join-required"
      && message.shareKind === "game"
      && message.anchorSessionId === anchorSession.session_id),
    true,
  );
  assert.equal(gateway.getHostedGameSession(requester.viewerSessionId, requester.worldSnapshotId), null);

  await gateway.dispose();
});

test("approved public nearby game join creates an unlisted member game share", async () => {
  const gateway = createGateway();
  gateway.store = {
    async getWorldGame() {
      return {
        game: {
          id: "game_member",
          owner_profile_id: "profile_viewer_requester",
          title: "Tic-Tac-Toe",
          prompt: "make tic tac toe",
          source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
          manifest: {
            title: "Tic-Tac-Toe",
            multiplayer_mode: "turn-based",
            min_players: 2,
            max_players: 2,
            allow_viewers: true,
            aspect_ratio: 1.6,
          },
        },
      };
    },
  };
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });
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

  const anchorSession = gateway.gameShares.createSession({
    scope: "public",
    bindingKey: host.worldSnapshotId,
    hostViewerSessionId: host.viewerSessionId,
    hostDisplayName: "Host",
    groupRole: "origin",
    listedLive: true,
    movementLocked: true,
    game: {
      id: "game_anchor",
      owner_profile_id: "profile_viewer_host",
      title: "Chess",
      prompt: "make chess",
      source_html: "<!DOCTYPE html><html><body><script>window.MauworldGame.register({ mount() { return {}; } });</script></body></html>",
      manifest: {
        title: "Chess",
        multiplayer_mode: "turn-based",
        min_players: 2,
        max_players: 2,
        allow_viewers: true,
        aspect_ratio: 1.6,
      },
    },
  });
  gateway.grantApprovedShareJoin(anchorSession.session_id, requester.viewerSessionId, "game");

  await gateway.handleGameStartShare(requester, {
    gameId: "game_member",
    anchorSessionId: anchorSession.session_id,
  });

  const memberSession = gateway.getHostedGameSession(requester.viewerSessionId, requester.worldSnapshotId);
  assert.equal(memberSession?.group_role, "member");
  assert.equal(memberSession?.listed_live, false);
  assert.equal(memberSession?.movement_locked, false);
  assert.equal(memberSession?.anchor_session_id, anchorSession.session_id);

  await gateway.dispose();
});

test("public origin can kick a nearby game contributor", async () => {
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

  const anchorSession = {
    id: "game_anchor",
    session_id: "game_anchor",
    host_viewer_session_id: host.viewerSessionId,
    world_snapshot_id: host.worldSnapshotId,
    binding_key: host.worldSnapshotId,
    group_role: "origin",
    listed_live: true,
  };
  const memberSession = {
    id: "game_member",
    session_id: "game_member",
    host_viewer_session_id: requester.viewerSessionId,
    world_snapshot_id: host.worldSnapshotId,
    binding_key: host.worldSnapshotId,
    group_role: "member",
    anchor_session_id: anchorSession.session_id,
  };
  gateway.gameShares.getSession = (sessionId) => {
    if (sessionId === anchorSession.session_id) {
      return anchorSession;
    }
    if (sessionId === memberSession.session_id) {
      return memberSession;
    }
    return null;
  };
  gateway.gameShares.stopSessionTree = (sessionId) => sessionId === memberSession.session_id ? [memberSession] : [];
  const stoppedSessionIds = [];
  gateway.broadcastGameStop = (session) => {
    stoppedSessionIds.push(session.session_id);
  };

  await gateway.handleShareMemberKick(host, {
    anchorSessionId: anchorSession.session_id,
    memberSessionId: memberSession.session_id,
  });

  assert.deepEqual(stoppedSessionIds, [memberSession.session_id]);
  assert.equal(
    requester.socket.sent.some((message) =>
      message.type === "share:kicked" && message.memberSessionId === memberSession.session_id),
    true,
  );

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

test("public origin can kick a nearby share contributor", async () => {
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

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
  };
  const memberSession = {
    id: "member_session",
    sessionId: "member_session",
    hostSessionId: requester.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "member",
    anchorSessionId: anchorSession.sessionId,
  };
  gateway.browserManager.getSession = (sessionId) => {
    if (sessionId === anchorSession.id) {
      return anchorSession;
    }
    if (sessionId === memberSession.id) {
      return memberSession;
    }
    return null;
  };
  const stoppedSessionIds = [];
  gateway.browserManager.stopSession = async (sessionId) => {
    stoppedSessionIds.push(sessionId);
  };

  await gateway.handleShareMemberKick(host, {
    anchorSessionId: anchorSession.sessionId,
    memberSessionId: memberSession.sessionId,
  });

  assert.deepEqual(stoppedSessionIds, [memberSession.sessionId]);
  assert.equal(
    requester.socket.sent.some((message) =>
      message.type === "share:kicked" && message.memberSessionId === memberSession.sessionId),
    true,
  );

  await gateway.dispose();
});

test("public pending nearby join requests can be cancelled", async () => {
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

  await gateway.dispose();
});

test("public persistent voice offer suppresses anchor listeners until approval", async () => {
  const gateway = createGateway();
  const anchorHost = createClient({
    viewerSessionId: "viewer_anchor",
    position: { x: 0, y: 0, z: 0 },
  });
  const anchorListener = createClient({
    viewerSessionId: "viewer_listener",
    position: { x: 20, y: 0, z: 0 },
  });
  const voiceHost = createClient({
    viewerSessionId: "viewer_voice",
    position: { x: 170, y: 0, z: 0 },
  });
  const outsider = createClient({
    viewerSessionId: "viewer_outsider",
    position: { x: 320, y: 0, z: 0 },
  });
  for (const client of [anchorHost, anchorListener, voiceHost, outsider]) {
    gateway.clients.set(client.viewerSessionId, client);
    gateway.getWorldMemberIds(anchorHost.worldSnapshotId).add(client.viewerSessionId);
  }
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: anchorHost.viewerSessionId,
    worldSnapshotId: anchorHost.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([anchorHost.viewerSessionId]),
  };
  const voiceSession = {
    id: "voice_session",
    sessionId: "voice_session",
    hostSessionId: voiceHost.viewerSessionId,
    worldSnapshotId: anchorHost.worldSnapshotId,
    sessionMode: "display-share",
    sessionSlot: "persistent-voice",
    groupRole: "origin",
    listedLive: false,
    movementLocked: false,
    groupJoined: false,
    anchorSessionId: "",
    anchorHostSessionId: "",
    subscribers: new Set([voiceHost.viewerSessionId]),
  };
  gateway.browserManager.listSessionsForWorld = () => [anchorSession, voiceSession];
  gateway.browserManager.getSession = (sessionId) => {
    if (sessionId === anchorSession.id) {
      return anchorSession;
    }
    if (sessionId === voiceSession.id) {
      return voiceSession;
    }
    return null;
  };

  await gateway.rebalanceBrowserSessions(anchorHost.worldSnapshotId);

  assert.equal(
    voiceHost.socket.sent.some((message) =>
      message.type === "voice:join-offer" && message.anchorSessionId === anchorSession.id),
    true,
  );
  assert.deepEqual(
    [...voiceSession.subscribers].sort(),
    [outsider.viewerSessionId, voiceHost.viewerSessionId].sort(),
  );
  assert.equal(voiceSession.subscribers.has(anchorHost.viewerSessionId), false);
  assert.equal(voiceSession.subscribers.has(anchorListener.viewerSessionId), false);

  await gateway.dispose();
});

test("public persistent voice stays unlisted and does not block a nearby origin share", async () => {
  const gateway = createGateway();
  const voiceHost = createClient({
    viewerSessionId: "viewer_voice",
    position: { x: 0, y: 0, z: 0 },
  });
  const nearbyHost = createClient({
    viewerSessionId: "viewer_nearby",
    position: { x: 24, y: 0, z: 0 },
  });
  gateway.clients.set(voiceHost.viewerSessionId, voiceHost);
  gateway.clients.set(nearbyHost.viewerSessionId, nearbyHost);
  gateway.getWorldMemberIds(voiceHost.worldSnapshotId).add(voiceHost.viewerSessionId);
  gateway.getWorldMemberIds(voiceHost.worldSnapshotId).add(nearbyHost.viewerSessionId);
  gateway.getInteractionSettings = async () => ({
    browserRadius: 180,
    interactionMaxRecipients: 20,
  });

  let voiceSession = null;
  let voiceStartInput = null;
  let nearbyStartInput = null;
  gateway.browserManager.getSessionByHost = (hostSessionId, options = {}) => {
    if (hostSessionId === voiceHost.viewerSessionId && options.sessionSlot === "persistent-voice") {
      return voiceSession;
    }
    return null;
  };
  gateway.browserManager.listSessionsForWorld = () => (voiceSession ? [voiceSession] : []);
  gateway.browserManager.getSession = (sessionId) =>
    voiceSession && sessionId === voiceSession.id ? voiceSession : null;
  gateway.browserManager.startSession = async (input) => {
    if (input.sessionSlot === "persistent-voice") {
      voiceStartInput = { ...input };
      voiceSession = {
        sessionId: "voice_session",
        id: "voice_session",
        subscribers: new Set([voiceHost.viewerSessionId]),
        ...input,
      };
      return voiceSession;
    }
    nearbyStartInput = { ...input };
    return {
      sessionId: "origin_session",
      id: "origin_session",
      subscribers: new Set([nearbyHost.viewerSessionId]),
      ...input,
    };
  };
  gateway.broadcastBrowserSession = async () => {};

  await gateway.handleVoiceStart(voiceHost, {});

  assert.equal(voiceStartInput?.groupRole, "origin");
  assert.equal(voiceStartInput?.sessionSlot, "persistent-voice");
  assert.equal(voiceStartInput?.shareKind, "audio");
  assert.equal(voiceStartInput?.listedLive, false);
  assert.equal(voiceStartInput?.movementLocked, false);

  await gateway.handleBrowserStart(nearbyHost, {
    mode: "display-share",
    title: "Nearby live",
    shareKind: "audio",
    hasVideo: false,
    hasAudio: true,
  });

  assert.equal(nearbyStartInput?.groupRole, "origin");
  assert.equal(nearbyStartInput?.listedLive, true);
  assert.equal(nearbyStartInput?.movementLocked, true);
  assert.equal(
    nearbyHost.socket.sent.some((message) => message.type === "share:join-required"),
    false,
  );

  await gateway.dispose();
});

test("public member shares stop outside the anchor radius while persistent voice stays standalone", async () => {
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
    sessionSlot: "persistent-voice",
    groupRole: "origin",
    listedLive: false,
    movementLocked: false,
    groupJoined: false,
    anchorSessionId: "",
    anchorHostSessionId: "",
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

  assert.equal(voiceSession.groupRole, "origin");
  assert.equal(voiceSession.anchorSessionId, "");
  assert.equal(
    voiceHost.socket.sent.some((message) => message.type === "voice:join-resolved"),
    false,
  );

  await gateway.dispose();
});

test("approved public persistent voice join grants a member audio share without mutating the voice session", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const voiceHost = createClient({
    viewerSessionId: "viewer_voice",
    position: { x: 24, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(voiceHost.viewerSessionId, voiceHost);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(voiceHost.viewerSessionId);
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
    subscribers: new Set([host.viewerSessionId, voiceHost.viewerSessionId]),
  };
  const voiceSession = {
    id: "voice_session",
    sessionId: "voice_session",
    hostSessionId: voiceHost.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    sessionSlot: "persistent-voice",
    groupRole: "origin",
    listedLive: false,
    movementLocked: false,
    groupJoined: false,
    anchorSessionId: "",
    anchorHostSessionId: "",
    subscribers: new Set([voiceHost.viewerSessionId]),
  };
  gateway.browserManager.getSession = (sessionId) => {
    if (sessionId === anchorSession.id) {
      return anchorSession;
    }
    if (sessionId === voiceSession.id) {
      return voiceSession;
    }
    return null;
  };
  gateway.browserManager.getSessionByHost = (hostSessionId, options = {}) => {
    if (hostSessionId === voiceHost.viewerSessionId && options.sessionSlot === "persistent-voice") {
      return voiceSession;
    }
    return null;
  };
  gateway.voiceJoinOffers.set(voiceSession.id, {
    anchorSessionId: anchorSession.id,
    state: "pending-origin",
  });
  let broadcasted = false;
  gateway.broadcastBrowserSession = async () => {
    broadcasted = true;
  };

  await gateway.handleVoiceJoinDecision(host, {
    anchorSessionId: anchorSession.id,
    requesterSessionId: voiceHost.viewerSessionId,
    approved: true,
  });

  assert.equal(gateway.hasApprovedShareJoin(anchorSession.id, voiceHost.viewerSessionId), true);
  assert.equal(voiceSession.groupRole, "origin");
  assert.equal(voiceSession.anchorSessionId, "");
  assert.equal(broadcasted, false);
  assert.equal(
    voiceHost.socket.sent.some((message) =>
      message.type === "voice:join-resolved" && message.approved === true),
    true,
  );

  await gateway.dispose();
});

test("public persistent voice acceptance notifies the anchor host", async () => {
  const gateway = createGateway();
  const host = createClient({
    viewerSessionId: "viewer_host",
    position: { x: 0, y: 0, z: 0 },
  });
  const voiceHost = createClient({
    viewerSessionId: "viewer_voice",
    position: { x: 24, y: 0, z: 0 },
  });
  gateway.clients.set(host.viewerSessionId, host);
  gateway.clients.set(voiceHost.viewerSessionId, voiceHost);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(host.viewerSessionId);
  gateway.getWorldMemberIds(host.worldSnapshotId).add(voiceHost.viewerSessionId);

  const anchorSession = {
    id: "anchor_session",
    sessionId: "anchor_session",
    hostSessionId: host.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    groupRole: "origin",
    listedLive: true,
    subscribers: new Set([host.viewerSessionId, voiceHost.viewerSessionId]),
  };
  const voiceSession = {
    id: "voice_session",
    sessionId: "voice_session",
    hostSessionId: voiceHost.viewerSessionId,
    worldSnapshotId: host.worldSnapshotId,
    sessionMode: "display-share",
    sessionSlot: "persistent-voice",
    groupRole: "origin",
    listedLive: false,
    movementLocked: false,
    groupJoined: false,
    anchorSessionId: "",
    anchorHostSessionId: "",
    subscribers: new Set([voiceHost.viewerSessionId]),
  };
  gateway.browserManager.getSession = (sessionId) => {
    if (sessionId === anchorSession.id) {
      return anchorSession;
    }
    if (sessionId === voiceSession.id) {
      return voiceSession;
    }
    return null;
  };
  gateway.browserManager.getSessionByHost = (hostSessionId, options = {}) => {
    if (hostSessionId === voiceHost.viewerSessionId && options.sessionSlot === "persistent-voice") {
      return voiceSession;
    }
    return null;
  };
  gateway.voiceJoinOffers.set(voiceSession.id, {
    anchorSessionId: anchorSession.id,
    state: "offered",
  });

  await gateway.handleVoiceJoinOfferResponse(voiceHost, {
    anchorSessionId: anchorSession.id,
    accepted: true,
  });

  assert.equal(
    host.socket.sent.some((message) =>
      message.type === "voice:join-request" && message.requesterSessionId === voiceHost.viewerSessionId),
    true,
  );
  assert.equal(
    voiceHost.socket.sent.some((message) =>
      message.type === "voice:join-requested" && message.anchorSessionId === anchorSession.id),
    true,
  );

  await gateway.dispose();
});
