import { WebSocket, WebSocketServer } from "ws";
import { BrowserSessionManager } from "./browser-session-manager.js";
import { GameShareManager } from "./game-share-manager.js";
import {
  findNearestOriginSession,
  getAnchorSessionId,
  isJoinedPersistentVoiceSession,
  isListedLiveSession,
  isMemberSession,
  isOriginSession,
  isPersistentVoiceSession,
  isWithinRadius,
} from "./browser-share-groups.js";
import { isLiveKitConfigured } from "./livekit-media.js";
import {
  buildViewerPresencePayload,
  checkChatRateLimit,
  getCellCoordinate,
  getCellKey,
  normalizeInteractionSettings,
  sanitizeChatText,
  selectNearestRecipients,
} from "./realtime-state.js";

const REALTIME_PATH = "/api/ws/public/world/current";

function parseJson(buffer) {
  try {
    return JSON.parse(String(buffer ?? ""));
  } catch (_error) {
    return null;
  }
}

function buildBaseUrl(publicBaseUrl) {
  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return publicBaseUrl;
  }
  return "http://localhost";
}

function nowIso() {
  return new Date().toISOString();
}

function clipText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function positionFromMessage(message = {}) {
  return {
    x: Number(message.position_x ?? 0) || 0,
    y: Number(message.position_y ?? 0) || 0,
    z: Number(message.position_z ?? 0) || 0,
  };
}

function sendJson(client, payload) {
  if (!client?.socket || client.socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  client.socket.send(JSON.stringify(payload));
  return true;
}

export class RealtimeGateway {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.store = options.store;
    this.clients = new Map();
    this.worldMembers = new Map();
    this.worldCells = new Map();
    this.pendingShareJoinRequests = new Map();
    this.approvedShareJoins = new Map();
    this.voiceJoinOffers = new Map();
    this.interactionSettings = {
      expiresAt: 0,
      value: normalizeInteractionSettings(),
    };
    this.browserManager = new BrowserSessionManager({
      allowedHosts: options.config?.sharedBrowserAllowedHosts,
      viewport: {
        width: options.config?.sharedBrowserViewportWidth,
        height: options.config?.sharedBrowserViewportHeight,
      },
      frameRate: options.config?.sharedBrowserFrameRate,
      jpegQuality: options.config?.sharedBrowserJpegQuality,
      liveKitConfig: options.config,
    });
    this.browserManager.on("frame", (frame) => {
      this.broadcastBrowserFrame(frame);
    });
    this.browserManager.on("session", (session) => {
      void this.broadcastBrowserSession(session);
    });
    this.browserManager.on("stop", (payload) => {
      void this.broadcastBrowserStop(payload);
    });
    this.browserManager.on("error", (payload) => {
      this.notifyBrowserError(payload);
    });
    this.gameShares = options.gameShares ?? new GameShareManager({ scope: "public" });
    this.healthInterval = setInterval(() => {
      this.pingClients();
    }, 30000);
  }

  async getInteractionSettings(force = false) {
    if (!force && this.interactionSettings.expiresAt > Date.now()) {
      return this.interactionSettings.value;
    }
    if (typeof this.store?.getSettings !== "function") {
      return this.interactionSettings.value;
    }
    const settings = await this.store.getSettings().catch(() => null);
    const value = normalizeInteractionSettings(settings ?? {});
    this.interactionSettings = {
      value,
      expiresAt: Date.now() + 15000,
    };
    return value;
  }

  install(server) {
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", buildBaseUrl(this.config.publicBaseUrl));
      if (requestUrl.pathname !== REALTIME_PATH) {
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (websocket) => {
        void this.handleConnection(websocket, requestUrl);
      });
    });
  }

  async handleConnection(socket, requestUrl) {
    const viewerSessionId = String(requestUrl.searchParams.get("viewerSessionId") ?? "").trim();
    const accessToken = String(requestUrl.searchParams.get("accessToken") ?? "").trim();
    if (!viewerSessionId) {
      socket.close(1008, "viewerSessionId is required");
      return;
    }

    let auth = null;
    if (accessToken) {
      try {
        auth = await this.store.verifyUserAccessToken(accessToken);
      } catch (_error) {
        socket.close(1008, "invalid access token");
        return;
      }
    }

    const existing = this.clients.get(viewerSessionId);
    if (existing?.socket && existing.socket.readyState === WebSocket.OPEN) {
      existing.socket.close(1012, "superseded");
    }

    const client = {
      viewerSessionId,
      socket,
      worldSnapshotId: "",
      joinedWorldSnapshotId: "",
      position: { x: 0, y: 0, z: 0 },
      headingY: 0,
      movementState: {},
      lastPresenceAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      rateLimit: {},
      isAlive: true,
      cellKey: "",
      browserModes: new Map(),
      messageQueue: Promise.resolve(),
      profile: auth?.profile ?? null,
      authUser: auth?.user ?? null,
      isGuest: !auth?.profile,
    };
    this.clients.set(viewerSessionId, client);

    socket.on("pong", () => {
      client.isAlive = true;
    });
    socket.on("message", (buffer) => {
      this.queueClientMessage(client, parseJson(buffer));
    });
    socket.on("close", () => {
      void this.handleDisconnect(client);
    });
    socket.on("error", () => {
      void this.handleDisconnect(client);
    });

    sendJson(client, {
      type: "session:ready",
      viewerSessionId,
      connectedAt: nowIso(),
      authenticated: Boolean(auth?.profile),
    });
  }

  pingClients() {
    for (const client of this.clients.values()) {
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
    }
  }

  queueClientMessage(client, message) {
    const run = async () => {
      await this.handleMessage(client, message);
    };
    client.messageQueue = (client.messageQueue ?? Promise.resolve()).then(run, run);
  }

  async handleMessage(client, message) {
    if (!message || typeof message !== "object") {
      return;
    }
    const type = String(message.type ?? "").trim();
    if (type === "presence:update") {
      await this.handlePresenceUpdate(client, message);
      return;
    }
    if (type === "chat:send") {
      await this.handleChatSend(client, message);
      return;
    }
    if (type === "browser:start") {
      await this.handleBrowserStart(client, message);
      return;
    }
    if (type === "browser:stop") {
      await this.handleBrowserStop(client, message);
      return;
    }
    if (type === "share:join-request") {
      await this.handleShareJoinRequest(client, message);
      return;
    }
    if (type === "share:join-cancel") {
      await this.handleShareJoinCancel(client, message);
      return;
    }
    if (type === "share:join-decision") {
      await this.handleShareJoinDecision(client, message);
      return;
    }
    if (type === "voice:start") {
      await this.handleVoiceStart(client, message);
      return;
    }
    if (type === "voice:stop") {
      await this.handleVoiceStop(client, message);
      return;
    }
    if (type === "voice:join-offer-response") {
      await this.handleVoiceJoinOfferResponse(client, message);
      return;
    }
    if (type === "voice:join-cancel") {
      await this.handleVoiceJoinCancel(client, message);
      return;
    }
    if (type === "voice:join-decision") {
      await this.handleVoiceJoinDecision(client, message);
      return;
    }
    if (type === "browser:input") {
      await this.handleBrowserInput(client, message);
      return;
    }
    if (type === "game:start-share") {
      await this.handleGameStartShare(client, message);
      return;
    }
    if (type === "game:stop-share") {
      await this.handleGameStopShare(client, message);
      return;
    }
    if (type === "game:open") {
      await this.handleGameOpen(client, message);
      return;
    }
    if (type === "game:seat-claim") {
      await this.handleGameSeatClaim(client, message);
      return;
    }
    if (type === "game:seat-release") {
      await this.handleGameSeatRelease(client, message);
      return;
    }
    if (type === "game:ready") {
      await this.handleGameReady(client, message);
      return;
    }
    if (type === "game:start-match") {
      await this.handleGameStartMatch(client, message);
      return;
    }
    if (type === "game:action") {
      await this.handleGameAction(client, message);
      return;
    }
    if (type === "game:state") {
      await this.handleGameState(client, message);
      return;
    }
    if (type === "game:preview") {
      await this.handleGamePreview(client, message);
      return;
    }
    if (type === "game:copy") {
      await this.handleGameCopy(client, message);
    }
  }

  getWorldMemberIds(worldSnapshotId) {
    if (!this.worldMembers.has(worldSnapshotId)) {
      this.worldMembers.set(worldSnapshotId, new Set());
    }
    return this.worldMembers.get(worldSnapshotId);
  }

  getWorldCellMap(worldSnapshotId) {
    if (!this.worldCells.has(worldSnapshotId)) {
      this.worldCells.set(worldSnapshotId, new Map());
    }
    return this.worldCells.get(worldSnapshotId);
  }

  updateClientCell(client, interactionSettings) {
    const worldSnapshotId = client.worldSnapshotId;
    if (!worldSnapshotId) {
      return;
    }
    const cellX = getCellCoordinate(client.position.x, interactionSettings.worldCellSize);
    const cellZ = getCellCoordinate(client.position.z, interactionSettings.worldCellSize);
    client.cellX = cellX;
    client.cellZ = cellZ;
    const nextKey = getCellKey(cellX, cellZ);
    if (client.cellKey === nextKey) {
      return;
    }
    if (client.cellKey) {
      const cells = this.getWorldCellMap(worldSnapshotId);
      const previous = cells.get(client.cellKey);
      previous?.delete(client.viewerSessionId);
      if (previous?.size === 0) {
        cells.delete(client.cellKey);
      }
    }
    client.cellKey = nextKey;
    const cells = this.getWorldCellMap(worldSnapshotId);
    if (!cells.has(nextKey)) {
      cells.set(nextKey, new Set());
    }
    cells.get(nextKey).add(client.viewerSessionId);
  }

  moveClientWorldMembership(client, nextWorldSnapshotId) {
    const previousWorld = client.worldSnapshotId;
    if (previousWorld && previousWorld !== nextWorldSnapshotId) {
      this.getWorldMemberIds(previousWorld).delete(client.viewerSessionId);
      const previousCells = this.getWorldCellMap(previousWorld);
      if (client.cellKey) {
        previousCells.get(client.cellKey)?.delete(client.viewerSessionId);
      }
      client.cellKey = "";
      if (!client.isGuest) {
        this.broadcastToWorld(previousWorld, {
          type: "presence:remove",
          viewerSessionId: client.viewerSessionId,
        }, new Set([client.viewerSessionId]));
      }
      void this.stopHostedSessions(client.viewerSessionId);
      const hostedGameSession = this.getHostedGameSession(client.viewerSessionId, previousWorld);
      if (hostedGameSession) {
        for (const stoppedGameSession of this.gameShares.stopSessionTree(hostedGameSession.id)) {
          this.broadcastGameStop(stoppedGameSession);
        }
      }
    }
    client.worldSnapshotId = nextWorldSnapshotId;
    if (nextWorldSnapshotId) {
      this.getWorldMemberIds(nextWorldSnapshotId).add(client.viewerSessionId);
    }
  }

  getWorldClients(worldSnapshotId) {
    return [...this.getWorldMemberIds(worldSnapshotId)]
      .map((viewerSessionId) => this.clients.get(viewerSessionId))
      .filter(Boolean);
  }

  buildPresencePayload(client) {
    if (!client || client.isGuest) {
      return null;
    }
    return buildViewerPresencePayload(client);
  }

  getHostedDisplaySession(viewerSessionId) {
    return this.browserManager.getSessionByHost(viewerSessionId, { sessionSlot: "display-share" });
  }

  getHostedPersistentVoiceSession(viewerSessionId) {
    return this.browserManager.getSessionByHost(viewerSessionId, { sessionSlot: "persistent-voice" });
  }

  getHostedGameSession(viewerSessionId, worldSnapshotId = "") {
    return this.gameShares.getSessionByHost(worldSnapshotId, viewerSessionId);
  }

  async stopHostedSessions(viewerSessionId) {
    const sessions = this.browserManager.listSessionsForHost(viewerSessionId);
    for (const session of sessions) {
      await this.browserManager.stopSession(session.id ?? session.sessionId);
    }
  }

  getSessionHostClient(sessionLike) {
    const hostSessionId = typeof sessionLike === "string"
      ? String(sessionLike ?? "").trim()
      : String(sessionLike?.hostSessionId ?? "").trim();
    return hostSessionId ? this.clients.get(hostSessionId) ?? null : null;
  }

  getSessionHostPosition(sessionLike) {
    return this.getSessionHostClient(sessionLike)?.position ?? null;
  }

  getOriginSession(sessionLike) {
    if (!sessionLike) {
      return null;
    }
    if (isOriginSession(sessionLike)) {
      return sessionLike;
    }
    const anchorSessionId = getAnchorSessionId(sessionLike);
    return anchorSessionId ? this.browserManager.getSession(anchorSessionId) ?? null : null;
  }

  getGameSessionHostClient(sessionLike) {
    const hostSessionId = typeof sessionLike === "string"
      ? String(sessionLike ?? "").trim()
      : String(
        sessionLike?.host_viewer_session_id
        ?? sessionLike?.hostViewerSessionId
        ?? sessionLike?.hostSessionId
        ?? "",
      ).trim();
    return hostSessionId ? this.clients.get(hostSessionId) ?? null : null;
  }

  getGameSessionHostPosition(sessionLike) {
    return this.getGameSessionHostClient(sessionLike)?.position ?? null;
  }

  getGameOriginSession(sessionLike) {
    return this.gameShares.getOriginSession(sessionLike);
  }

  getNearestOriginGameSessionForClient(client, interactionSettings, options = {}) {
    if (!client?.worldSnapshotId) {
      return null;
    }
    return findNearestOriginSession({
      requesterPosition: client.position,
      sessions: this.gameShares.listSessionsForBinding(client.worldSnapshotId).map((session) => this.gameShares.toSessionSummary(session)),
      resolveSessionPosition: (session) => this.getGameSessionHostPosition(session),
      radius: interactionSettings?.browserRadius,
      excludeHostSessionId: options.excludeHostSessionId ?? client.viewerSessionId,
    });
  }

  isClientWithinGameAnchorRadius(client, anchorSession, interactionSettings) {
    if (!client || !anchorSession) {
      return false;
    }
    return isWithinRadius(
      client.position,
      this.getGameSessionHostPosition(anchorSession),
      interactionSettings?.browserRadius,
    );
  }

  getNearestOriginSessionForClient(client, interactionSettings, options = {}) {
    if (!client?.worldSnapshotId) {
      return null;
    }
    return findNearestOriginSession({
      requesterPosition: client.position,
      sessions: this.browserManager.listSessionsForWorld(client.worldSnapshotId),
      resolveSessionPosition: (session) => this.getSessionHostPosition(session),
      radius: interactionSettings?.browserRadius,
      excludeHostSessionId: options.excludeHostSessionId ?? client.viewerSessionId,
    });
  }

  isClientWithinAnchorRadius(client, anchorSession, interactionSettings) {
    if (!client || !anchorSession) {
      return false;
    }
    return isWithinRadius(
      client.position,
      this.getSessionHostPosition(anchorSession),
      interactionSettings?.browserRadius,
    );
  }

  getShareJoinKey(anchorSessionId, requesterSessionId) {
    return `${String(anchorSessionId ?? "").trim()}:${String(requesterSessionId ?? "").trim()}`;
  }

  pruneShareJoinApprovals() {
    const now = Date.now();
    for (const [key, entry] of this.approvedShareJoins.entries()) {
      if (Number(entry.expiresAt ?? 0) <= now) {
        this.approvedShareJoins.delete(key);
      }
    }
  }

  grantApprovedShareJoin(anchorSessionId, requesterSessionId, shareKind = "") {
    this.approvedShareJoins.set(this.getShareJoinKey(anchorSessionId, requesterSessionId), {
      anchorSessionId: String(anchorSessionId ?? "").trim(),
      requesterSessionId: String(requesterSessionId ?? "").trim(),
      shareKind: String(shareKind ?? "").trim().toLowerCase(),
      expiresAt: Date.now() + 60_000,
    });
  }

  hasApprovedShareJoin(anchorSessionId, requesterSessionId) {
    this.pruneShareJoinApprovals();
    return this.approvedShareJoins.has(this.getShareJoinKey(anchorSessionId, requesterSessionId));
  }

  clearApprovedShareJoin(anchorSessionId, requesterSessionId) {
    this.approvedShareJoins.delete(this.getShareJoinKey(anchorSessionId, requesterSessionId));
  }

  sessionHasCapacity(session, interactionSettings) {
    const maxViewers = Math.max(
      1,
      Number(session?.maxViewers)
      || Number(interactionSettings?.interactionMaxRecipients)
      || 20,
    );
    const viewerCount = session?.subscribers instanceof Set
      ? Math.max(0, session.subscribers.size - 1)
      : Math.max(0, Number(session?.viewerCount) || 0);
    return viewerCount < maxViewers;
  }

  gameSessionHasJoinCapacity(_session, _interactionSettings) {
    return true;
  }

  buildSessionContextPayload(sessionLike, interactionSettings = null) {
    const session = this.buildBrowserSessionPayload(sessionLike, interactionSettings);
    if (!session) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      hostSessionId: session.hostSessionId,
      anchorSessionId: session.anchorSessionId,
      anchorHostSessionId: session.anchorHostSessionId,
      title: session.title,
      shareKind: session.shareKind,
      viewerCount: session.viewerCount,
      maxViewers: session.maxViewers,
      listedLive: session.listedLive !== false,
      groupRole: session.groupRole,
    };
  }

  buildGameSessionContextPayload(sessionLike) {
    const session = this.gameShares.toSessionSummary(sessionLike);
    if (!session) {
      return null;
    }
    return {
      sessionId: session.session_id,
      hostSessionId: session.host_viewer_session_id,
      anchorSessionId: session.anchor_session_id || session.session_id,
      anchorHostSessionId: session.anchor_host_session_id || session.host_viewer_session_id,
      title: session.game?.title || "Nearby game",
      shareKind: "game",
      viewerCount: session.viewer_count,
      maxViewers: session.max_viewers,
      listedLive: session.listed_live !== false,
      groupRole: session.group_role || "origin",
    };
  }

  resolveShareJoinAnchor(client, interactionSettings, options = {}) {
    const requestedAnchorSessionId = String(options.anchorSessionId ?? "").trim();
    const shareKind = String(options.shareKind ?? "").trim().toLowerCase();
    const requestedGameSession = requestedAnchorSessionId
      ? this.gameShares.getSession(requestedAnchorSessionId)
      : null;
    if (shareKind === "game" || requestedGameSession) {
      let anchorSession = requestedGameSession
        ?? this.getNearestOriginGameSessionForClient(client, interactionSettings);
      if (anchorSession && anchorSession.group_role === "member") {
        anchorSession = this.getGameOriginSession(anchorSession);
      }
      if (anchorSession && anchorSession.listed_live === false) {
        anchorSession = null;
      }
      return anchorSession
        ? {
          anchorSession,
          anchorType: "game",
        }
        : null;
    }
    const anchorSession = requestedAnchorSessionId
      ? this.browserManager.getSession(requestedAnchorSessionId)
      : this.getNearestOriginSessionForClient(client, interactionSettings);
    const resolvedAnchor = anchorSession && !isOriginSession(anchorSession)
      ? this.getOriginSession(anchorSession)
      : anchorSession;
    if (!resolvedAnchor || !isListedLiveSession(resolvedAnchor)) {
      return null;
    }
    return {
      anchorSession: resolvedAnchor,
      anchorType: "browser",
    };
  }

  selectBrowserRecipients(hostClient, candidates, interactionSettings, anchorPosition = null) {
    const senderPosition = anchorPosition ?? hostClient?.position ?? null;
    const maxRecipients = Math.max(1, interactionSettings?.interactionMaxRecipients ?? 20);
    const signedInCandidates = candidates.filter((entry) => !entry?.isGuest);
    const guestCandidates = candidates.filter((entry) => entry?.isGuest);
    const recipients = new Set(
      selectNearestRecipients({
        senderSessionId: hostClient.viewerSessionId,
        senderPosition,
        candidates: signedInCandidates,
        radius: interactionSettings?.browserRadius,
        maxRecipients,
      }),
    );
    const remaining = Math.max(0, maxRecipients - recipients.size);
    if (remaining > 0 && guestCandidates.length > 0) {
      for (const viewerSessionId of selectNearestRecipients({
        senderSessionId: hostClient.viewerSessionId,
        senderPosition,
        candidates: guestCandidates,
        radius: interactionSettings?.browserRadius,
        maxRecipients: remaining,
      })) {
        recipients.add(viewerSessionId);
      }
    }
    recipients.add(hostClient.viewerSessionId);
    return recipients;
  }

  countPublicRecipients(recipients, hostSessionId) {
    return Math.max(
      0,
      [...recipients].filter((viewerSessionId) =>
        viewerSessionId !== hostSessionId
        && this.clients.get(viewerSessionId)?.isGuest !== true).length,
    );
  }

  getSessionAudienceRecipients(session, worldClients, interactionSettings) {
    const hostClient = this.getSessionHostClient(session);
    if (!hostClient) {
      return new Set([String(session?.hostSessionId ?? "").trim()].filter(Boolean));
    }
    const anchorSession = isMemberSession(session) || isJoinedPersistentVoiceSession(session)
      ? this.getOriginSession(session)
      : null;
    const anchorPosition = anchorSession ? this.getSessionHostPosition(anchorSession) : hostClient.position;
    return this.selectBrowserRecipients(hostClient, worldClients, interactionSettings, anchorPosition);
  }

  getGameSessionAudienceRecipients(session, worldClients, interactionSettings) {
    const hostClient = this.getGameSessionHostClient(session);
    if (!hostClient) {
      return new Set([String(session?.host_viewer_session_id ?? "").trim()].filter(Boolean));
    }
    const anchorSession = String(session?.group_role ?? "").trim().toLowerCase() === "member"
      ? this.getGameOriginSession(session)
      : null;
    const anchorPosition = anchorSession
      ? this.getGameSessionHostPosition(anchorSession)
      : hostClient.position;
    return this.selectBrowserRecipients(hostClient, worldClients, interactionSettings, anchorPosition);
  }

  buildGameSubscriptionPayload(sessionLike, subscribed) {
    const session = this.gameShares.toSessionSummary(sessionLike);
    if (!session) {
      return null;
    }
    return {
      type: subscribed ? "game:subscribe" : "game:unsubscribe",
      sessionId: session.session_id,
      hostViewerSessionId: session.host_viewer_session_id,
      transport: this.browserManager.liveKitEnabled ? "livekit" : "snapshot",
    };
  }

  buildGameSessionBroadcastPayload(sessionLike, options = {}) {
    const session = this.gameShares.toSessionSummary(sessionLike);
    if (!session) {
      return null;
    }
    if (options.includePreview !== true) {
      delete session.latest_preview;
    }
    return session;
  }

  broadcastToWorld(worldSnapshotId, payload, excludeSessionIds = new Set()) {
    for (const member of this.getWorldClients(worldSnapshotId)) {
      if (excludeSessionIds.has(member.viewerSessionId)) {
        continue;
      }
      sendJson(member, payload);
    }
  }

  buildBrowserSessionPayload(sessionLike, interactionSettings = null) {
    if (!sessionLike) {
      return null;
    }
    const sessionId = String(sessionLike.sessionId ?? sessionLike.id ?? "").trim();
    const rawSession = sessionId ? this.browserManager.getSession(sessionId) ?? sessionLike : sessionLike;
    const session = typeof this.browserManager.toClientSession === "function"
      ? this.browserManager.toClientSession(rawSession)
      : { ...rawSession };
    const hostSessionId = String(session.hostSessionId ?? rawSession.hostSessionId ?? "").trim();
    const subscribers = rawSession.subscribers instanceof Set ? rawSession.subscribers : null;
    const countedSubscribers = subscribers
      ? [...subscribers].filter((viewerSessionId) =>
        viewerSessionId !== hostSessionId
        && this.clients.get(viewerSessionId)?.isGuest !== true)
      : null;
    const viewerCount = countedSubscribers
      ? Math.max(0, countedSubscribers.length)
      : Number.isFinite(Number(rawSession.viewerCount))
        ? Math.max(0, Math.floor(Number(rawSession.viewerCount)))
        : 0;
    const maxViewers = Number.isFinite(Number(rawSession.maxViewers)) && Number(rawSession.maxViewers) > 0
      ? Math.max(1, Math.floor(Number(rawSession.maxViewers)))
      : Math.max(
        1,
        Math.floor(Number(
          interactionSettings?.interactionMaxRecipients
          ?? this.interactionSettings.value?.interactionMaxRecipients
          ?? 20,
        ) || 20),
      );
    return {
      ...session,
      sessionId: sessionId || session.sessionId,
      viewerCount,
      maxViewers,
    };
  }

  async handlePresenceUpdate(client, message) {
    const interactionSettings = await this.getInteractionSettings();
    const worldSnapshotId = String(message.worldSnapshotId ?? message.world_snapshot_id ?? "").trim();
    if (!worldSnapshotId) {
      return;
    }

    const worldChanged = client.worldSnapshotId !== worldSnapshotId;
    this.moveClientWorldMembership(client, worldSnapshotId);
    client.position = positionFromMessage(message);
    client.headingY = Number(message.heading_y ?? 0) || 0;
    client.movementState =
      typeof message.movement_state === "object" && message.movement_state
        ? message.movement_state
        : {};
    client.lastPresenceAt = Date.now();
    client.lastHeartbeatAt = Date.now();
    this.updateClientCell(client, interactionSettings);

    const presence = this.buildPresencePayload(client);
    if (worldChanged || client.joinedWorldSnapshotId !== worldSnapshotId) {
      client.joinedWorldSnapshotId = worldSnapshotId;
      sendJson(client, {
        type: "presence:snapshot",
        worldSnapshotId,
        presence: this.getWorldClients(worldSnapshotId)
          .filter((entry) => entry.viewerSessionId !== client.viewerSessionId)
          .map((entry) => this.buildPresencePayload(entry))
          .filter(Boolean),
      });
      const browserSessions = this.browserManager.listSessionsForWorld(worldSnapshotId);
      for (const rawSession of browserSessions) {
        const session = this.buildBrowserSessionPayload(rawSession, interactionSettings) ?? rawSession;
        const sessionId = session.sessionId ?? rawSession.sessionId ?? rawSession.id;
        sendJson(client, {
          type: "browser:session",
          session,
        });
        const deliveryMode = rawSession.subscribers?.has(client.viewerSessionId) ? "full" : "placeholder";
        client.browserModes.set(sessionId, deliveryMode);
        sendJson(client, {
          type: deliveryMode === "full" ? "browser:subscribe" : "browser:unsubscribe",
          sessionId,
          hostSessionId: session.hostSessionId,
          viewerCount: session.viewerCount,
          maxViewers: session.maxViewers,
        });
      }
      this.sendExistingGameSessions(client);
    }

    if (presence) {
      this.broadcastToWorld(worldSnapshotId, {
        type: "presence:update",
        worldSnapshotId,
        presence,
      }, new Set([client.viewerSessionId]));
    }
    await this.rebalanceBrowserSessions(worldSnapshotId);
    await this.rebalanceGameSessions(worldSnapshotId, interactionSettings);
  }

  async handleChatSend(client, message) {
    if (!client.worldSnapshotId) {
      return;
    }
    if (client.isGuest) {
      sendJson(client, {
        type: "chat:error",
        message: "Sign in to chat nearby.",
      });
      return;
    }
    const interactionSettings = await this.getInteractionSettings();
    const text = sanitizeChatText(message.text, interactionSettings.chatMaxChars);
    if (!text) {
      return;
    }
    const rateLimit = checkChatRateLimit(client.rateLimit, {
      now: Date.now(),
      text,
    });
    client.rateLimit = rateLimit.state ?? client.rateLimit;
    if (!rateLimit.allowed) {
      sendJson(client, {
        type: "chat:error",
        message: rateLimit.reason,
      });
      return;
    }

    const worldClients = this.getWorldClients(client.worldSnapshotId);
    const fullRecipients = new Set(
      selectNearestRecipients({
        senderSessionId: client.viewerSessionId,
        senderPosition: client.position,
        candidates: worldClients,
        radius: interactionSettings.chatDetailRadius,
        maxRecipients: interactionSettings.interactionMaxRecipients,
      }),
    );
    fullRecipients.add(client.viewerSessionId);
    const expiresAt = new Date(Date.now() + interactionSettings.chatTtlSeconds * 1000).toISOString();

    for (const entry of worldClients) {
      sendJson(entry, {
        type: "chat:event",
        worldSnapshotId: client.worldSnapshotId,
        actorSessionId: client.viewerSessionId,
        mode: fullRecipients.has(entry.viewerSessionId) ? "full" : "placeholder",
        text: fullRecipients.has(entry.viewerSessionId) ? text : "...",
        expiresAt,
      });
    }
  }

  getClientDisplayName(client) {
    const presence = this.buildPresencePayload(client);
    return String(
      presence?.actor?.display_name
      ?? client?.profile?.display_name
      ?? client?.profile?.username
      ?? `visitor ${String(client?.viewerSessionId ?? "").slice(-4)}`,
    ).trim();
  }

  sendGameError(client, error) {
    sendJson(client, {
      type: "game:error",
      message: clipText(error?.message ?? "Unable to update game share.", 160) || "Unable to update game share.",
    });
  }

  broadcastGameSession(sessionLike, options = {}) {
    const session = this.buildGameSessionBroadcastPayload(sessionLike, options);
    if (!session?.binding_key) {
      return;
    }
    this.broadcastToWorld(session.binding_key, {
      type: "game:session",
      session,
    });
  }

  broadcastGamePreview(sessionLike) {
    const session = this.gameShares.toSessionSummary(sessionLike);
    if (!session?.binding_key || !session.latest_preview) {
      return;
    }
    const rawSession = this.gameShares.getSession(session.session_id);
    const recipients = rawSession?.preview_subscribers instanceof Set && rawSession.preview_subscribers.size > 0
      ? rawSession.preview_subscribers
      : new Set([session.host_viewer_session_id].filter(Boolean));
    for (const viewerSessionId of recipients) {
      const client = this.clients.get(viewerSessionId);
      if (!client || client.worldSnapshotId !== session.binding_key) {
        continue;
      }
      sendJson(client, {
        type: "game:preview",
        sessionId: session.session_id,
        preview: session.latest_preview,
      });
    }
  }

  broadcastGameStop(sessionLike) {
    const session = this.gameShares.toSessionSummary(sessionLike);
    if (!session?.binding_key) {
      return;
    }
    if (session.group_role === "origin" && session.listed_live !== false) {
      for (const key of [...this.pendingShareJoinRequests.keys()]) {
        if (key.startsWith(`${session.session_id}:`)) {
          this.pendingShareJoinRequests.delete(key);
        }
      }
      for (const key of [...this.approvedShareJoins.keys()]) {
        if (key.startsWith(`${session.session_id}:`)) {
          this.approvedShareJoins.delete(key);
        }
      }
    }
    this.broadcastToWorld(session.binding_key, {
      type: "game:stop-share",
      sessionId: session.session_id,
      hostViewerSessionId: session.host_viewer_session_id,
    });
  }

  sendExistingGameSessions(client) {
    if (!client?.worldSnapshotId) {
      return;
    }
    for (const rawSession of this.gameShares.listSessionsForBinding(client.worldSnapshotId)) {
      const session = this.buildGameSessionBroadcastPayload(rawSession);
      if (!session) {
        continue;
      }
      sendJson(client, {
        type: "game:session",
        session,
      });
      const subscriptionPayload = this.buildGameSubscriptionPayload(rawSession, true);
      const recipients = rawSession?.preview_subscribers instanceof Set && rawSession.preview_subscribers.size > 0
        ? rawSession.preview_subscribers
        : new Set([String(rawSession?.host_viewer_session_id ?? "").trim()].filter(Boolean));
      if (subscriptionPayload && recipients.has(client.viewerSessionId)) {
        sendJson(client, subscriptionPayload);
      }
      const preview = this.gameShares.toSessionSummary(rawSession)?.latest_preview ?? null;
      if (preview && recipients.has(client.viewerSessionId)) {
        sendJson(client, {
          type: "game:preview",
          sessionId: session.session_id,
          preview,
        });
      }
    }
  }

  async handleGameStartShare(client, message) {
    if (!client?.profile) {
      this.sendGameError(client, { message: "Sign in to share games nearby." });
      return;
    }
    if (!client.worldSnapshotId) {
      this.sendGameError(client, { message: "Join a world before sharing a game." });
      return;
    }
    try {
      const interactionSettings = await this.getInteractionSettings();
      let groupRole = "origin";
      let anchorSession = null;
      const existingGameSession = this.getHostedGameSession(client.viewerSessionId, client.worldSnapshotId);
      if (existingGameSession?.group_role === "member") {
        const existingAnchorSession = this.getGameOriginSession(existingGameSession);
        if (existingAnchorSession && this.isClientWithinGameAnchorRadius(client, existingAnchorSession, interactionSettings)) {
          anchorSession = existingAnchorSession;
          groupRole = "member";
        }
      }
      if (!anchorSession) {
        const requestedAnchorSessionId = String(message.anchorSessionId ?? "").trim();
        anchorSession = requestedAnchorSessionId
          ? this.gameShares.getSession(requestedAnchorSessionId)
          : this.getNearestOriginGameSessionForClient(client, interactionSettings);
        if (anchorSession?.group_role === "member") {
          anchorSession = this.getGameOriginSession(anchorSession);
        }
        if (anchorSession && anchorSession.listed_live === false) {
          anchorSession = null;
        }
      }
      if (anchorSession && this.isClientWithinGameAnchorRadius(client, anchorSession, interactionSettings)) {
        const alreadyJoinedAnchor =
          existingGameSession?.group_role === "member"
          && String(existingGameSession.anchor_session_id ?? existingGameSession.anchorSessionId ?? "").trim() === String(anchorSession.id ?? anchorSession.session_id ?? "").trim();
        if (!alreadyJoinedAnchor && !this.hasApprovedShareJoin(anchorSession.id ?? anchorSession.session_id, client.viewerSessionId)) {
          sendJson(client, {
            type: "share:join-required",
            shareKind: "game",
            anchorSessionId: anchorSession.id ?? anchorSession.session_id,
            anchorHostSessionId: anchorSession.host_viewer_session_id ?? anchorSession.hostViewerSessionId,
            anchorSession: this.buildGameSessionContextPayload(anchorSession),
            message: "Ask the original sharer to join this nearby share.",
          });
          return;
        }
        groupRole = "member";
      } else {
        anchorSession = null;
      }
      const payload = await this.store.getWorldGame(client.profile, {
        gameId: String(message.gameId ?? "").trim(),
      });
      const session = this.gameShares.createSession({
        scope: "public",
        bindingKey: client.worldSnapshotId,
        hostViewerSessionId: client.viewerSessionId,
        hostDisplayName: this.getClientDisplayName(client),
        groupRole,
        listedLive: groupRole === "origin",
        movementLocked: groupRole === "origin",
        anchorSessionId: anchorSession?.id ?? anchorSession?.session_id ?? "",
        anchorHostSessionId: anchorSession?.host_viewer_session_id ?? anchorSession?.hostViewerSessionId ?? "",
        maxViewers: interactionSettings?.interactionMaxRecipients,
        game: payload.game,
      });
      if (groupRole === "member" && anchorSession) {
        this.clearApprovedShareJoin(anchorSession.id ?? anchorSession.session_id, client.viewerSessionId);
      }
      this.broadcastGameSession(session);
      await this.rebalanceGameSessions(client.worldSnapshotId, interactionSettings);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameStopShare(client, message) {
    try {
      const requestedSessionId = String(message.sessionId ?? "").trim();
      const session = requestedSessionId
        ? this.gameShares.getSession(requestedSessionId)
        : this.getHostedGameSession(client.viewerSessionId, client.worldSnapshotId);
      if (!session) {
        return;
      }
      if (session.host_viewer_session_id !== client.viewerSessionId) {
        throw new Error("Only the host can stop this game share");
      }
      for (const stopped of this.gameShares.stopSessionTree(session.id ?? session.session_id)) {
        this.broadcastGameStop(stopped);
      }
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameOpen(client, message) {
    try {
      const payload = this.gameShares.buildOpenPayload(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
      );
      if (!payload || payload.session.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      sendJson(client, {
        type: "game:open",
        ...payload,
      });
      this.broadcastGameSession(payload.session);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameSeatClaim(client, message) {
    try {
      const summary = this.gameShares.claimSeat(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        this.getClientDisplayName(client),
        message.seatId,
      );
      if (summary.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastGameSession(summary);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameSeatRelease(client, message) {
    try {
      const summary = this.gameShares.releaseSeat(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        String(message.seatId ?? message.seat_id ?? "").trim(),
      );
      if (summary.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastGameSession(summary);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameReady(client, message) {
    try {
      const summary = this.gameShares.setReady(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        message.ready === true,
      );
      if (summary.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastGameSession(summary);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameStartMatch(client, message) {
    try {
      const summary = this.gameShares.startMatch(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
      );
      if (summary.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastGameSession(summary);
      const session = this.gameShares.getSession(summary.session_id);
      this.broadcastToWorld(summary.binding_key, {
        type: "game:state",
        sessionId: summary.session_id,
        state: session?.authoritative_state ?? null,
      });
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameAction(client, message) {
    try {
      const payload = this.gameShares.acceptPlayerAction(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        message.action ?? null,
      );
      if (payload.session.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      const hostClient = this.clients.get(payload.session.host_viewer_session_id);
      if (!hostClient) {
        throw new Error("Game host is offline");
      }
      sendJson(hostClient, {
        type: "game:action",
        sessionId: payload.session.session_id,
        action: payload.action,
        actor: payload.actor,
      });
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameState(client, message) {
    try {
      const payload = this.gameShares.applyHostState(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        message.state ?? null,
        { started: message.started === true },
      );
      if (payload.session.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastToWorld(payload.session.binding_key, {
        type: "game:state",
        sessionId: payload.session.session_id,
        state: payload.state,
      });
      this.broadcastGameSession(payload.session);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGamePreview(client, message) {
    try {
      const summary = this.gameShares.updatePreview(
        String(message.sessionId ?? "").trim(),
        client.viewerSessionId,
        message.preview ?? {},
      );
      if (summary.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      this.broadcastGamePreview(summary);
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleGameCopy(client, message) {
    if (!client?.profile) {
      this.sendGameError(client, { message: "Sign in to copy shared games." });
      return;
    }
    try {
      const session = this.gameShares.getSession(String(message.sessionId ?? "").trim());
      if (!session || session.binding_key !== client.worldSnapshotId) {
        throw new Error("Game session not found");
      }
      const sourceGameId = session.game.source_game_id ?? session.game.id;
      const payload = await this.store.copyWorldGame(client.profile, {
        sourceGameId,
        title: message.title,
        game: {
          ...session.game,
          source_game_id: sourceGameId,
        },
      });
      sendJson(client, {
        type: "game:copy",
        game: payload.game,
      });
    } catch (error) {
      this.sendGameError(client, error);
    }
  }

  async handleShareJoinRequest(client, message) {
    if (!client.worldSnapshotId || client.isGuest) {
      return;
    }
    const interactionSettings = await this.getInteractionSettings();
    const requestedAnchorSessionId = String(message.anchorSessionId ?? "").trim();
    const shareKind = String(message.shareKind ?? "screen").trim().toLowerCase();
    const resolvedAnchor = this.resolveShareJoinAnchor(client, interactionSettings, {
      anchorSessionId: requestedAnchorSessionId,
      shareKind,
    });
    const anchorSession = resolvedAnchor?.anchorSession ?? null;
    const isGameAnchor = resolvedAnchor?.anchorType === "game";
    if (
      !anchorSession
      || (isGameAnchor ? anchorSession.listed_live === false : !isListedLiveSession(anchorSession))
      || String(isGameAnchor ? anchorSession.host_viewer_session_id : anchorSession.hostSessionId).trim() === client.viewerSessionId
      || !(isGameAnchor
        ? this.isClientWithinGameAnchorRadius(client, anchorSession, interactionSettings)
        : this.isClientWithinAnchorRadius(client, anchorSession, interactionSettings))
    ) {
      sendJson(client, {
        type: "share:join-resolved",
        approved: false,
        anchorSessionId: requestedAnchorSessionId,
        message: "No nearby share is available to join.",
      });
      return;
    }
    if (!(isGameAnchor ? this.gameSessionHasJoinCapacity(anchorSession, interactionSettings) : this.sessionHasCapacity(anchorSession, interactionSettings))) {
      sendJson(client, {
        type: "share:join-resolved",
        approved: false,
        anchorSessionId: anchorSession.id ?? anchorSession.session_id,
        message: "That nearby share is full right now.",
      });
      return;
    }
    const normalizedAnchorSessionId = String(anchorSession.id ?? anchorSession.session_id ?? "").trim();
    const key = this.getShareJoinKey(normalizedAnchorSessionId, client.viewerSessionId);
    this.pendingShareJoinRequests.set(key, {
      anchorSessionId: normalizedAnchorSessionId,
      requesterSessionId: client.viewerSessionId,
      shareKind,
      requestedAt: Date.now(),
      worldSnapshotId: client.worldSnapshotId,
    });
    const anchorClient = isGameAnchor
      ? this.getGameSessionHostClient(anchorSession)
      : this.clients.get(anchorSession.hostSessionId);
    if (anchorClient) {
      sendJson(anchorClient, {
        type: "share:join-request",
        anchorSessionId: normalizedAnchorSessionId,
        requesterSessionId: client.viewerSessionId,
        requesterDisplayName: this.getClientDisplayName(client),
        shareKind,
        anchorSession: isGameAnchor
          ? this.buildGameSessionContextPayload(anchorSession)
          : this.buildSessionContextPayload(anchorSession, interactionSettings),
      });
    }
    sendJson(client, {
      type: "share:join-requested",
      anchorSessionId: normalizedAnchorSessionId,
      anchorHostSessionId: isGameAnchor
        ? anchorSession.host_viewer_session_id
        : anchorSession.hostSessionId,
    });
  }

  async handleShareJoinCancel(client, message) {
    if (!client.worldSnapshotId || client.isGuest) {
      return;
    }
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    if (!anchorSessionId) {
      return;
    }
    const key = this.getShareJoinKey(anchorSessionId, client.viewerSessionId);
    const hadPendingRequest = this.pendingShareJoinRequests.delete(key);
    this.clearApprovedShareJoin(anchorSessionId, client.viewerSessionId);
    const anchorSession = this.browserManager.getSession(anchorSessionId) ?? this.gameShares.getSession(anchorSessionId);
    const anchorHostSessionId = String(
      anchorSession?.hostSessionId
      ?? anchorSession?.host_viewer_session_id
      ?? "",
    ).trim();
    if (hadPendingRequest && anchorHostSessionId) {
      const anchorClient = this.clients.get(anchorHostSessionId);
      if (anchorClient) {
        sendJson(anchorClient, {
          type: "share:join-cancelled",
          anchorSessionId,
          requesterSessionId: client.viewerSessionId,
        });
      }
    }
    sendJson(client, {
      type: "share:join-cancelled",
      anchorSessionId,
      anchorHostSessionId,
      requesterSessionId: client.viewerSessionId,
      message: "Nearby share request cancelled.",
    });
  }

  async handleShareJoinDecision(client, message) {
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    const requesterSessionId = String(message.requesterSessionId ?? "").trim();
    if (!anchorSessionId || !requesterSessionId) {
      return;
    }
    const key = this.getShareJoinKey(anchorSessionId, requesterSessionId);
    const request = this.pendingShareJoinRequests.get(key);
    if (!request) {
      return;
    }
    this.pendingShareJoinRequests.delete(key);
    const anchorSession = this.browserManager.getSession(anchorSessionId) ?? this.gameShares.getSession(anchorSessionId);
    const isGameAnchor = Boolean(anchorSession && "host_viewer_session_id" in anchorSession);
    const anchorHostSessionId = String(
      anchorSession?.hostSessionId
      ?? anchorSession?.host_viewer_session_id
      ?? "",
    ).trim();
    if (
      !anchorSession
      || anchorHostSessionId !== client.viewerSessionId
      || (isGameAnchor ? anchorSession.listed_live === false : !isListedLiveSession(anchorSession))
    ) {
      return;
    }
    const requesterClient = this.clients.get(requesterSessionId);
    if (!requesterClient) {
      return;
    }
    const interactionSettings = await this.getInteractionSettings();
    const approved = message.approved === true
      && (isGameAnchor
        ? this.isClientWithinGameAnchorRadius(requesterClient, anchorSession, interactionSettings)
        : this.isClientWithinAnchorRadius(requesterClient, anchorSession, interactionSettings))
      && (isGameAnchor
        ? this.gameSessionHasJoinCapacity(anchorSession, interactionSettings)
        : this.sessionHasCapacity(anchorSession, interactionSettings));
    if (approved) {
      this.grantApprovedShareJoin(anchorSessionId, requesterSessionId, request.shareKind);
    } else {
      this.clearApprovedShareJoin(anchorSessionId, requesterSessionId);
    }
    sendJson(requesterClient, {
      type: "share:join-resolved",
      approved,
      anchorSessionId,
      anchorHostSessionId,
      anchorSession: isGameAnchor
        ? this.buildGameSessionContextPayload(anchorSession)
        : this.buildSessionContextPayload(anchorSession, interactionSettings),
      message: approved ? "Join approved." : "Join request declined.",
    });
  }

  clearVoiceJoinOffer(sessionId) {
    this.voiceJoinOffers.delete(String(sessionId ?? "").trim());
  }

  cancelVoiceJoinOffer(sessionLike, {
    message = "Returned to standalone voice chat.",
    notifyRequester = true,
    notifyAnchor = true,
  } = {}) {
    const sessionId = String(sessionLike?.id ?? sessionLike?.sessionId ?? "").trim();
    if (!sessionId) {
      return false;
    }
    const offer = this.voiceJoinOffers.get(sessionId);
    if (!offer) {
      return false;
    }
    const anchorSessionId = String(offer.anchorSessionId ?? "").trim();
    const requesterSessionId = String(sessionLike?.hostSessionId ?? "").trim();
    const anchorSession = anchorSessionId ? this.browserManager.getSession(anchorSessionId) : null;
    const anchorHostSessionId = String(anchorSession?.hostSessionId ?? "").trim();
    this.clearApprovedShareJoin(anchorSessionId, requesterSessionId);
    this.clearVoiceJoinOffer(sessionId);
    if (notifyAnchor && anchorHostSessionId) {
      const anchorClient = this.clients.get(anchorHostSessionId);
      if (anchorClient) {
        sendJson(anchorClient, {
          type: "voice:join-cancelled",
          anchorSessionId,
          requesterSessionId,
        });
      }
    }
    if (notifyRequester && requesterSessionId) {
      const requesterClient = this.clients.get(requesterSessionId);
      if (requesterClient) {
        sendJson(requesterClient, {
          type: "voice:join-cancelled",
          anchorSessionId,
          anchorHostSessionId,
          requesterSessionId,
          message,
        });
      }
    }
    return true;
  }

  async handleVoiceStart(client, message) {
    if (!client.worldSnapshotId) {
      return;
    }
    if (client.isGuest) {
      sendJson(client, {
        type: "voice:error",
        message: "Sign in to use persistent voice chat.",
      });
      return;
    }
    try {
      const session = await this.browserManager.startSession({
        hostSessionId: client.viewerSessionId,
        worldSnapshotId: client.worldSnapshotId,
        mode: "display-share",
        title: "",
        shareKind: "audio",
        hasVideo: false,
        hasAudio: true,
        aspectRatio: 1.2,
        groupRole: "origin",
        sessionSlot: "persistent-voice",
        listedLive: false,
        movementLocked: false,
        groupJoined: false,
      });
      const internal = this.browserManager.getSession(session.sessionId);
      if (internal) {
        internal.subscribers = internal.subscribers ?? new Set();
        internal.groupJoined = false;
        internal.anchorSessionId = "";
        internal.anchorHostSessionId = "";
      }
      this.clearVoiceJoinOffer(session.sessionId);
      await this.broadcastBrowserSession(session);
    } catch (error) {
      sendJson(client, {
        type: "voice:error",
        message: error.message || "Could not start persistent voice chat.",
      });
    }
  }

  async handleVoiceStop(client, message) {
    const requestedSessionId = String(message.sessionId ?? "").trim();
    const session = requestedSessionId
      ? this.browserManager.getSession(requestedSessionId)
      : this.getHostedPersistentVoiceSession(client.viewerSessionId);
    if (!session || session.hostSessionId !== client.viewerSessionId) {
      return;
    }
    this.cancelVoiceJoinOffer(session, {
      message: "Persistent voice chat stopped.",
      notifyRequester: false,
    });
    this.clearVoiceJoinOffer(session.id ?? session.sessionId);
    await this.browserManager.stopSession(session.id ?? session.sessionId);
  }

  async handleVoiceJoinOfferResponse(client, message) {
    const voiceSession = this.getHostedPersistentVoiceSession(client.viewerSessionId);
    if (!voiceSession) {
      return;
    }
    const offer = this.voiceJoinOffers.get(voiceSession.id ?? voiceSession.sessionId);
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    if (!offer || offer.anchorSessionId !== anchorSessionId) {
      return;
    }
    if (message.accepted !== true) {
      offer.state = "declined";
      sendJson(client, {
        type: "voice:join-resolved",
        approved: false,
        anchorSessionId,
        message: "Stayed in standalone voice chat.",
      });
      return;
    }
    const anchorSession = this.browserManager.getSession(anchorSessionId);
    if (!anchorSession || !isListedLiveSession(anchorSession)) {
      this.clearVoiceJoinOffer(voiceSession.id ?? voiceSession.sessionId);
      sendJson(client, {
        type: "voice:join-resolved",
        approved: false,
        anchorSessionId,
        message: "That nearby live session is no longer available.",
      });
      return;
    }
    const anchorClient = this.clients.get(anchorSession.hostSessionId);
    if (!anchorClient) {
      this.clearVoiceJoinOffer(voiceSession.id ?? voiceSession.sessionId);
      sendJson(client, {
        type: "voice:join-resolved",
        approved: false,
        anchorSessionId,
        message: "That nearby live session is no longer available.",
      });
      return;
    }
    offer.state = "pending-origin";
    sendJson(anchorClient, {
      type: "voice:join-request",
      anchorSessionId,
      requesterSessionId: client.viewerSessionId,
      requesterDisplayName: this.getClientDisplayName(client),
      sessionId: voiceSession.id ?? voiceSession.sessionId,
    });
    sendJson(client, {
      type: "voice:join-requested",
      anchorSessionId,
      anchorHostSessionId: anchorSession.hostSessionId,
      anchorSession: this.buildSessionContextPayload(anchorSession),
    });
  }

  async handleVoiceJoinCancel(client, message) {
    if (!client.worldSnapshotId || client.isGuest) {
      return;
    }
    const voiceSession = this.getHostedPersistentVoiceSession(client.viewerSessionId);
    if (!voiceSession) {
      return;
    }
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    if (!anchorSessionId) {
      return;
    }
    const offer = this.voiceJoinOffers.get(voiceSession.id ?? voiceSession.sessionId);
    if (!offer || offer.anchorSessionId !== anchorSessionId || offer.state === "joined") {
      return;
    }
    this.cancelVoiceJoinOffer(voiceSession, {
      message: "Stayed in standalone voice chat.",
      notifyAnchor: offer.state === "pending-origin",
    });
  }

  async handleVoiceJoinDecision(client, message) {
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    const requesterSessionId = String(message.requesterSessionId ?? "").trim();
    if (!anchorSessionId || !requesterSessionId) {
      return;
    }
    const anchorSession = this.browserManager.getSession(anchorSessionId);
    if (!anchorSession || !isListedLiveSession(anchorSession) || anchorSession.hostSessionId !== client.viewerSessionId) {
      return;
    }
    const requesterClient = this.clients.get(requesterSessionId);
    const voiceSession = this.getHostedPersistentVoiceSession(requesterSessionId);
    if (!requesterClient || !voiceSession) {
      return;
    }
    const offer = this.voiceJoinOffers.get(voiceSession.id ?? voiceSession.sessionId);
    if (!offer || offer.anchorSessionId !== anchorSessionId) {
      return;
    }
    const interactionSettings = await this.getInteractionSettings();
    const approved = message.approved === true
      && this.isClientWithinAnchorRadius(requesterClient, anchorSession, interactionSettings)
      && this.sessionHasCapacity(anchorSession, interactionSettings);
    offer.state = approved ? "joined" : "denied";
    if (approved) {
      this.grantApprovedShareJoin(anchorSessionId, requesterSessionId, "audio");
    } else {
      this.clearApprovedShareJoin(anchorSessionId, requesterSessionId);
    }
    sendJson(requesterClient, {
      type: "voice:join-resolved",
      approved,
      anchorSessionId,
      anchorHostSessionId: anchorSession.hostSessionId,
      message: approved ? "Voice joined the nearby live group." : "Voice join request declined.",
    });
  }

  async handleBrowserStart(client, message) {
    if (!client.worldSnapshotId) {
      return;
    }
    if (client.isGuest) {
      sendJson(client, {
        type: "browser:error",
        message: "Sign in to share nearby.",
      });
      return;
    }
    try {
      const interactionSettings = await this.getInteractionSettings();
      const sessionMode = String(message.mode ?? "").trim() === "display-share" ? "display-share" : "remote-browser";
      const existingDisplaySession = this.getHostedDisplaySession(client.viewerSessionId);
      let groupRole = "origin";
      let anchorSession = null;
      if (sessionMode === "display-share") {
        if (existingDisplaySession && isMemberSession(existingDisplaySession)) {
          const existingAnchorSession = this.getOriginSession(existingDisplaySession);
          if (existingAnchorSession && this.isClientWithinAnchorRadius(client, existingAnchorSession, interactionSettings)) {
            anchorSession = existingAnchorSession;
            groupRole = "member";
          }
        }
        if (!anchorSession) {
          const requestedAnchorSessionId = String(message.anchorSessionId ?? "").trim();
          anchorSession = requestedAnchorSessionId
            ? this.browserManager.getSession(requestedAnchorSessionId)
            : this.getNearestOriginSessionForClient(client, interactionSettings);
          if (anchorSession && !isOriginSession(anchorSession)) {
            anchorSession = this.getOriginSession(anchorSession);
          }
          if (anchorSession && !isListedLiveSession(anchorSession)) {
            anchorSession = null;
          }
        }
        if (anchorSession && this.isClientWithinAnchorRadius(client, anchorSession, interactionSettings)) {
          const alreadyJoinedAnchor =
            existingDisplaySession
            && isMemberSession(existingDisplaySession)
            && getAnchorSessionId(existingDisplaySession) === anchorSession.id;
          if (!alreadyJoinedAnchor && !this.hasApprovedShareJoin(anchorSession.id, client.viewerSessionId)) {
            sendJson(client, {
              type: "share:join-required",
              anchorSessionId: anchorSession.id,
              anchorHostSessionId: anchorSession.hostSessionId,
              anchorSession: this.buildSessionContextPayload(anchorSession, interactionSettings),
              message: "Ask the original sharer to join this nearby share.",
            });
            return;
          }
          groupRole = "member";
        } else {
          anchorSession = null;
        }
      }
      const session = await this.browserManager.startSession({
        hostSessionId: client.viewerSessionId,
        worldSnapshotId: client.worldSnapshotId,
        url: message.url,
        mode: sessionMode,
        title: groupRole === "member" ? "" : message.title,
        shareKind: message.shareKind,
        hasVideo: message.hasVideo,
        hasAudio: message.hasAudio,
        aspectRatio: message.aspectRatio,
        displaySurface: message.displaySurface,
        groupRole,
        sessionSlot: sessionMode === "display-share" ? "display-share" : "remote-browser",
        listedLive: groupRole === "origin",
        movementLocked: groupRole === "origin",
        anchorSessionId: anchorSession?.id ?? "",
        anchorHostSessionId: anchorSession?.hostSessionId ?? "",
      });
      const internal = this.browserManager.getSession(session.sessionId);
      if (internal) {
        internal.subscribers = internal.subscribers ?? new Set();
      }
      if (groupRole === "member" && anchorSession) {
        this.clearApprovedShareJoin(anchorSession.id, client.viewerSessionId);
      }
      await this.broadcastBrowserSession(session, { interactionSettings });
    } catch (error) {
      sendJson(client, {
        type: "browser:error",
        message: error.message,
      });
    }
  }

  async handleBrowserStop(client, message) {
    const requestedSessionId = String(message.sessionId ?? "").trim();
    const session = requestedSessionId
      ? this.browserManager.getSession(requestedSessionId)
      : this.getHostedDisplaySession(client.viewerSessionId);
    if (!session || session.hostSessionId !== client.viewerSessionId) {
      return;
    }
    await this.browserManager.stopSession(session.id ?? session.sessionId);
  }

  async handleBrowserInput(client, message) {
    const sessionId = String(message.sessionId ?? "").trim();
    const session = this.browserManager.getSession(sessionId);
    if (!session || session.hostSessionId !== client.viewerSessionId) {
      return;
    }
    try {
      await this.browserManager.handleInput(sessionId, message.input ?? {});
    } catch (error) {
      sendJson(client, {
        type: "browser:error",
        message: error.message,
      });
    }
  }

  async broadcastBrowserSession(sessionPayload, options = {}) {
    const interactionSettings = options.interactionSettings ?? await this.getInteractionSettings();
    const session = this.buildBrowserSessionPayload(sessionPayload, interactionSettings);
    const worldSnapshotId = String(session?.worldSnapshotId ?? sessionPayload.worldSnapshotId ?? "").trim();
    if (!worldSnapshotId) {
      return;
    }
    this.broadcastToWorld(worldSnapshotId, {
      type: "browser:session",
      session,
    });
    if (options.rebalance !== false) {
      await this.rebalanceBrowserSessions(worldSnapshotId, interactionSettings);
    }
  }

  broadcastBrowserFrame(frame) {
    const session = this.browserManager.getSession(frame.sessionId);
    if (!session) {
      return;
    }
    const recipients = String(session.frameTransport ?? "").startsWith("livekit")
      ? new Set([session.hostSessionId])
      : session.subscribers ?? new Set([session.hostSessionId]);
    for (const viewerSessionId of recipients) {
      const client = this.clients.get(viewerSessionId);
      if (!client) {
        continue;
      }
      sendJson(client, {
        type: "browser:frame",
        sessionId: frame.sessionId,
        hostSessionId: frame.hostSessionId,
        frameId: frame.frameId,
        dataUrl: frame.dataUrl,
        width: frame.width,
        height: frame.height,
        title: frame.title,
        url: frame.url,
      });
    }
  }

  async broadcastBrowserStop(payload) {
    const worldSnapshotId = String(payload.worldSnapshotId ?? "").trim();
    if (!worldSnapshotId) {
      return;
    }
    if (isListedLiveSession(payload)) {
      for (const key of [...this.pendingShareJoinRequests.keys()]) {
        if (key.startsWith(`${payload.sessionId}:`)) {
          this.pendingShareJoinRequests.delete(key);
        }
      }
      for (const key of [...this.approvedShareJoins.keys()]) {
        if (key.startsWith(`${payload.sessionId}:`)) {
          this.approvedShareJoins.delete(key);
        }
      }
      for (const session of this.browserManager.listSessionsForWorld(worldSnapshotId)) {
        if (getAnchorSessionId(session) !== payload.sessionId) {
          continue;
        }
        if (isMemberSession(session)) {
          await this.browserManager.stopSession(session.id ?? session.sessionId);
          continue;
        }
        if (isJoinedPersistentVoiceSession(session)) {
          session.groupJoined = false;
          session.anchorSessionId = "";
          session.anchorHostSessionId = "";
          this.clearVoiceJoinOffer(session.id ?? session.sessionId);
          const voiceClient = this.getSessionHostClient(session);
          if (voiceClient) {
            sendJson(voiceClient, {
              type: "voice:join-resolved",
              approved: false,
              anchorSessionId: payload.sessionId,
              message: "Returned to standalone voice chat.",
            });
          }
          await this.broadcastBrowserSession(session, { rebalance: false });
        }
      }
      for (const session of this.browserManager.listSessionsForWorld(worldSnapshotId)) {
        const offer = this.voiceJoinOffers.get(session.id ?? session.sessionId) ?? null;
        if (!offer || offer.anchorSessionId !== payload.sessionId || isJoinedPersistentVoiceSession(session)) {
          continue;
        }
        this.cancelVoiceJoinOffer(session, {
          message: "That nearby live session is no longer available.",
          notifyAnchor: false,
        });
      }
    }
    if (isPersistentVoiceSession(payload)) {
      this.cancelVoiceJoinOffer(payload, {
        message: "Persistent voice chat stopped.",
        notifyRequester: false,
      });
      this.clearVoiceJoinOffer(payload.sessionId);
    }
    for (const client of this.getWorldClients(worldSnapshotId)) {
      client.browserModes.delete(payload.sessionId);
    }
    this.broadcastToWorld(worldSnapshotId, {
      type: "browser:stop",
      sessionId: payload.sessionId,
      hostSessionId: payload.hostSessionId,
    });
    await this.rebalanceBrowserSessions(worldSnapshotId).catch(() => null);
  }

  notifyBrowserError(payload) {
    const session = payload.sessionId ? this.browserManager.getSession(payload.sessionId) : null;
    const client = payload.hostSessionId ? this.clients.get(payload.hostSessionId) : session ? this.clients.get(session.hostSessionId) : null;
    if (!client) {
      return;
    }
    sendJson(client, {
      type: "browser:error",
      sessionId: payload.sessionId,
      message: payload.message,
    });
  }

  async updatePersistentVoiceOffers(worldSnapshotId, interactionSettings = null) {
    const resolvedInteractionSettings = interactionSettings ?? await this.getInteractionSettings();
    const sessions = this.browserManager.listSessionsForWorld(worldSnapshotId);
    for (const session of sessions) {
      if (!isPersistentVoiceSession(session)) {
        continue;
      }
      const sessionId = session.id ?? session.sessionId;
      const hostClient = this.getSessionHostClient(session);
      if (!hostClient) {
        continue;
      }
      const offer = this.voiceJoinOffers.get(sessionId) ?? null;
      const offeredAnchor = offer?.anchorSessionId ? this.browserManager.getSession(offer.anchorSessionId) : null;
      const stillInOfferedRange = offeredAnchor
        ? this.isClientWithinAnchorRadius(hostClient, offeredAnchor, resolvedInteractionSettings)
        : false;

      if (isJoinedPersistentVoiceSession(session)) {
        const anchorSession = this.getOriginSession(session);
        if (anchorSession && this.isClientWithinAnchorRadius(hostClient, anchorSession, resolvedInteractionSettings)) {
          continue;
        }
        session.groupJoined = false;
        session.anchorSessionId = "";
        session.anchorHostSessionId = "";
        this.clearVoiceJoinOffer(sessionId);
        sendJson(hostClient, {
          type: "voice:join-resolved",
          approved: false,
          anchorSessionId: offeredAnchor?.id ?? "",
          message: "Returned to standalone voice chat.",
        });
        await this.broadcastBrowserSession(session, {
          rebalance: false,
          interactionSettings: resolvedInteractionSettings,
        });
      }

      if (offer && !stillInOfferedRange) {
        this.cancelVoiceJoinOffer(session, {
          message: "Returned to standalone voice chat.",
          notifyAnchor: offer.state === "pending-origin",
        });
      }

      const nearestOrigin = findNearestOriginSession({
        requesterPosition: hostClient.position,
        sessions,
        resolveSessionPosition: (entry) => this.getSessionHostPosition(entry),
        radius: resolvedInteractionSettings.browserRadius,
        excludeHostSessionId: hostClient.viewerSessionId,
      });
      if (!nearestOrigin || !this.sessionHasCapacity(nearestOrigin, resolvedInteractionSettings)) {
        continue;
      }
      const currentOffer = this.voiceJoinOffers.get(sessionId);
      if (currentOffer?.anchorSessionId === nearestOrigin.id) {
        continue;
      }
      this.voiceJoinOffers.set(sessionId, {
        anchorSessionId: nearestOrigin.id,
        state: "offered",
      });
      sendJson(hostClient, {
        type: "voice:join-offer",
        sessionId,
        anchorSessionId: nearestOrigin.id,
        anchorHostSessionId: nearestOrigin.hostSessionId,
        anchorSession: this.buildSessionContextPayload(nearestOrigin, resolvedInteractionSettings),
      });
    }
  }

  async rebalanceBrowserSessions(worldSnapshotId, interactionSettings = null) {
    const resolvedInteractionSettings = interactionSettings ?? await this.getInteractionSettings();
    const sessions = this.browserManager.listSessionsForWorld(worldSnapshotId);
    const worldClients = this.getWorldClients(worldSnapshotId);

    for (const session of sessions) {
      const hostClient = this.getSessionHostClient(session);
      if (!hostClient) {
        await this.browserManager.stopSession(session.id ?? session.sessionId);
        continue;
      }
      if (isMemberSession(session)) {
        const anchorSession = this.getOriginSession(session);
        if (!anchorSession || !this.isClientWithinAnchorRadius(hostClient, anchorSession, resolvedInteractionSettings)) {
          await this.browserManager.stopSession(session.id ?? session.sessionId);
          continue;
        }
      }
      const fullRecipients = this.getSessionAudienceRecipients(session, worldClients, resolvedInteractionSettings);
      const previousRecipients = new Set(session.subscribers ?? []);
      session.subscribers = fullRecipients;
      const recipientsChanged =
        previousRecipients.size !== fullRecipients.size
        || [...fullRecipients].some((viewerSessionId) => !previousRecipients.has(viewerSessionId));
      const nextViewerCount = this.countPublicRecipients(fullRecipients, hostClient.viewerSessionId);
      const nextMaxViewers = Math.max(1, resolvedInteractionSettings.interactionMaxRecipients);
      const countsChanged =
        Number(session.viewerCount ?? -1) !== nextViewerCount
        || Number(session.maxViewers ?? -1) !== nextMaxViewers;
      session.viewerCount = nextViewerCount;
      session.maxViewers = nextMaxViewers;
      const sessionId = session.id ?? session.sessionId;

      for (const viewerSessionId of fullRecipients) {
        if (previousRecipients.has(viewerSessionId)) {
          continue;
        }
        const client = this.clients.get(viewerSessionId);
        if (!client) {
          continue;
        }
        client.browserModes.set(sessionId, "full");
        sendJson(client, {
          type: "browser:subscribe",
          sessionId,
          hostSessionId: session.hostSessionId,
          viewerCount: session.viewerCount,
          maxViewers: session.maxViewers,
        });
      }

      for (const viewerSessionId of previousRecipients) {
        if (fullRecipients.has(viewerSessionId)) {
          continue;
        }
        const client = this.clients.get(viewerSessionId);
        if (!client) {
          continue;
        }
        client.browserModes.set(sessionId, "placeholder");
        sendJson(client, {
          type: "browser:unsubscribe",
          sessionId,
          hostSessionId: session.hostSessionId,
          viewerCount: session.viewerCount,
          maxViewers: session.maxViewers,
        });
      }

      for (const client of worldClients) {
        if (fullRecipients.has(client.viewerSessionId)) {
          client.browserModes.set(sessionId, "full");
          continue;
        }
        if (client.browserModes.get(sessionId) !== "placeholder") {
          client.browserModes.set(sessionId, "placeholder");
          sendJson(client, {
            type: "browser:unsubscribe",
            sessionId,
            hostSessionId: session.hostSessionId,
            viewerCount: session.viewerCount,
            maxViewers: session.maxViewers,
          });
        }
      }

      if (recipientsChanged || countsChanged) {
        await this.broadcastBrowserSession(session, {
          rebalance: false,
          interactionSettings: resolvedInteractionSettings,
        });
      }
    }
    await this.updatePersistentVoiceOffers(worldSnapshotId, resolvedInteractionSettings);
  }

  async rebalanceGameSessions(worldSnapshotId, interactionSettings = null) {
    const resolvedInteractionSettings = interactionSettings ?? await this.getInteractionSettings();
    const worldClients = this.getWorldClients(worldSnapshotId);
    for (const session of this.gameShares.listSessionsForBinding(worldSnapshotId)) {
      const hostClient = this.getGameSessionHostClient(session);
      if (!hostClient) {
        for (const stopped of this.gameShares.stopSessionTree(session.id ?? session.session_id)) {
          this.broadcastGameStop(stopped);
        }
        continue;
      }
      if (session.group_role === "member") {
        const anchorSession = this.getGameOriginSession(session);
        if (!anchorSession || !this.isClientWithinGameAnchorRadius(hostClient, anchorSession, resolvedInteractionSettings)) {
          for (const stopped of this.gameShares.stopSessionTree(session.id ?? session.session_id)) {
            this.broadcastGameStop(stopped);
          }
          continue;
        }
      }
      const fullRecipients = this.getGameSessionAudienceRecipients(session, worldClients, resolvedInteractionSettings);
      const previousRecipients = new Set(session.preview_subscribers ?? []);
      session.preview_subscribers = fullRecipients;
      const subscribePayload = this.buildGameSubscriptionPayload(session, true);
      const unsubscribePayload = this.buildGameSubscriptionPayload(session, false);
      for (const viewerSessionId of fullRecipients) {
        if (previousRecipients.has(viewerSessionId)) {
          continue;
        }
        const client = this.clients.get(viewerSessionId);
        if (!client) {
          continue;
        }
        if (subscribePayload) {
          sendJson(client, subscribePayload);
        }
        if (session.latest_preview) {
          sendJson(client, {
            type: "game:preview",
            sessionId: String(session.id ?? session.session_id ?? "").trim(),
            preview: session.latest_preview,
          });
        }
      }
      for (const viewerSessionId of previousRecipients) {
        if (fullRecipients.has(viewerSessionId)) {
          continue;
        }
        const client = this.clients.get(viewerSessionId);
        if (!client || !unsubscribePayload) {
          continue;
        }
        sendJson(client, unsubscribePayload);
      }
    }
  }

  async handleDisconnect(client) {
    if (!this.clients.has(client.viewerSessionId)) {
      return;
    }
    this.clients.delete(client.viewerSessionId);
    const worldSnapshotId = client.worldSnapshotId;
    if (worldSnapshotId) {
      this.getWorldMemberIds(worldSnapshotId).delete(client.viewerSessionId);
      if (client.cellKey) {
        this.getWorldCellMap(worldSnapshotId).get(client.cellKey)?.delete(client.viewerSessionId);
      }
      if (!client.isGuest) {
        this.broadcastToWorld(worldSnapshotId, {
          type: "presence:remove",
          viewerSessionId: client.viewerSessionId,
        });
      }
    }
    await this.stopHostedSessions(client.viewerSessionId);
    const gameCleanup = this.gameShares.removeViewerSession(client.viewerSessionId);
    for (const session of gameCleanup.updated) {
      this.broadcastGameSession(session);
    }
    for (const session of gameCleanup.stopped) {
      this.broadcastGameStop(session);
    }
    if (worldSnapshotId) {
      await this.rebalanceBrowserSessions(worldSnapshotId);
      await this.rebalanceGameSessions(worldSnapshotId);
    }
  }

  async dispose() {
    clearInterval(this.healthInterval);
    await this.browserManager.dispose();
    for (const client of this.clients.values()) {
      client.socket.close(1001, "server shutdown");
    }
    this.clients.clear();
  }
}

export function installRealtimeGateway(options = {}) {
  const gateway = new RealtimeGateway(options);
  gateway.install(options.server);
  return gateway;
}
