import { WebSocket, WebSocketServer } from "ws";
import { BrowserSessionManager } from "./browser-session-manager.js";
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
import { checkChatRateLimit, sanitizeChatText, selectNearestRecipients } from "./realtime-state.js";

const PRIVATE_WORLD_REALTIME_PATH = "/api/ws/private/worlds";
const PRIVATE_WORLD_CHAT_MAX_CHARS = 160;
const PRIVATE_WORLD_CHAT_TTL_SECONDS = 8;
const PRIVATE_WORLD_CHAT_DETAIL_RADIUS = 180;
const PRIVATE_WORLD_BROWSER_RADIUS = 96;
const PRIVATE_WORLD_MAX_RECIPIENTS = 20;
const PRIVATE_WORLD_PARTICIPANT_HEARTBEAT_MS = 5_000;

function buildBaseUrl(publicBaseUrl) {
  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return publicBaseUrl;
  }
  return "http://localhost";
}

function parseJson(buffer) {
  try {
    return JSON.parse(String(buffer ?? ""));
  } catch (_error) {
    return null;
  }
}

function sendJson(client, payload) {
  if (!client?.socket || client.socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  client.socket.send(JSON.stringify(payload));
  return true;
}

function buildPrivateBrowserWorldKey(worldId, creatorUsername) {
  return `private:${String(worldId ?? "").trim()}:${String(creatorUsername ?? "").trim().toLowerCase()}`;
}

function positionFromPrivateClient(client) {
  if (client?.position) {
    return client.position;
  }
  if (!client?.presence) {
    return null;
  }
  return {
    x: Number(client.presence.position_x ?? 0) || 0,
    y: Number(client.presence.position_y ?? 0) || 0,
    z: Number(client.presence.position_z ?? 0) || 0,
  };
}

export class PrivateWorldGateway {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.store = options.store;
    this.clients = new Set();
    this.pendingShareJoinRequests = new Map();
    this.approvedShareJoins = new Map();
    this.voiceJoinOffers = new Map();
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
      this.broadcastBrowserSession(session);
    });
    this.browserManager.on("stop", (payload) => {
      void this.broadcastBrowserStop(payload);
    });
    this.browserManager.on("error", (payload) => {
      this.notifyBrowserError(payload);
    });
    this.unsubscribe = this.store?.subscribePrivateWorldEvents?.((event) => {
      void this.broadcastStoreEvent(event);
    }) ?? null;
  }

  install(server) {
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", buildBaseUrl(this.config.publicBaseUrl));
      if (requestUrl.pathname !== PRIVATE_WORLD_REALTIME_PATH) {
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (websocket) => {
        void this.handleConnection(websocket, requestUrl);
      });
    });
  }

  async handleConnection(socket, requestUrl) {
    const worldId = String(requestUrl.searchParams.get("worldId") ?? "").trim();
    const creatorUsername = String(requestUrl.searchParams.get("creatorUsername") ?? "").trim();
    const accessToken = String(requestUrl.searchParams.get("accessToken") ?? "").trim();
    const guestSessionId = String(requestUrl.searchParams.get("guestSessionId") ?? "").trim();
    if (!worldId || !creatorUsername) {
      socket.close(1008, "worldId and creatorUsername are required");
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

    try {
      const detail = await this.store.getPrivateWorldDetail({
        worldId,
        creatorUsername,
        profile: auth?.profile ?? null,
        allowGuest: !auth,
        includeContent: Boolean(auth?.profile),
      });
      const client = {
        socket,
        worldId,
        creatorUsername,
        browserWorldKey: buildPrivateBrowserWorldKey(worldId, creatorUsername),
        profile: auth?.profile ?? null,
        guestSessionId: guestSessionId || null,
        viewerSessionId: auth?.profile?.id ? `profile:${auth.profile.id}` : (guestSessionId || `guest:${Math.random().toString(36).slice(2, 10)}`),
        displayName: auth?.profile?.display_name || auth?.profile?.username || "guest viewer",
        presence: null,
        position: null,
        chatRateLimitState: {},
        browserModes: new Map(),
        messageQueue: Promise.resolve(),
        lastParticipantHeartbeatAt: 0,
      };
      this.clients.add(client);
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
        type: "world:snapshot",
        world: detail.world,
      });
      this.sendExistingPresence(client);
      await this.rebalanceBrowserSessions(client.browserWorldKey);
      this.sendExistingBrowserSessions(client);
    } catch (error) {
      socket.close(1008, error.message || "not allowed");
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
    if (type === "ping") {
      sendJson(client, {
        type: "pong",
        at: new Date().toISOString(),
      });
      return;
    }
    if (type === "world:refresh") {
      await this.refreshClient(client);
      return;
    }
    if (type === "chat:send") {
      this.handleChatSend(client, message);
      return;
    }
    if (type === "presence:update") {
      this.handlePresenceUpdate(client, message);
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
    if (type === "voice:join-decision") {
      await this.handleVoiceJoinDecision(client, message);
      return;
    }
    if (type === "browser:input") {
      await this.handleBrowserInput(client, message);
    }
  }

  getWorldClients(worldId, creatorUsername) {
    const normalizedCreator = String(creatorUsername ?? "").trim().toLowerCase();
    return [...this.clients].filter(
      (client) => client.worldId === worldId && client.creatorUsername.toLowerCase() === normalizedCreator,
    );
  }

  getBrowserWorldClients(browserWorldKey) {
    return [...this.clients].filter((client) => client.browserWorldKey === browserWorldKey);
  }

  findBrowserClient(browserWorldKey, viewerSessionId) {
    const target = String(viewerSessionId ?? "").trim();
    if (!target) {
      return null;
    }
    return this.getBrowserWorldClients(browserWorldKey).find((client) => client.viewerSessionId === target) ?? null;
  }

  getHostedDisplaySession(viewerSessionId) {
    return this.browserManager.getSessionByHost(viewerSessionId, { sessionSlot: "display-share" });
  }

  getHostedPersistentVoiceSession(viewerSessionId) {
    return this.browserManager.getSessionByHost(viewerSessionId, { sessionSlot: "persistent-voice" });
  }

  async stopHostedSessions(viewerSessionId) {
    for (const session of this.browserManager.listSessionsForHost(viewerSessionId)) {
      await this.browserManager.stopSession(session.id ?? session.sessionId);
    }
  }

  getSessionHostClient(sessionLike) {
    const hostSessionId = typeof sessionLike === "string"
      ? String(sessionLike ?? "").trim()
      : String(sessionLike?.hostSessionId ?? "").trim();
    const browserWorldKey = typeof sessionLike === "string"
      ? ""
      : String(sessionLike?.worldSnapshotId ?? "").trim();
    if (!hostSessionId) {
      return null;
    }
    if (browserWorldKey) {
      return this.findBrowserClient(browserWorldKey, hostSessionId);
    }
    return [...this.clients].find((entry) => entry.viewerSessionId === hostSessionId) ?? null;
  }

  getSessionHostPosition(sessionLike) {
    return positionFromPrivateClient(this.getSessionHostClient(sessionLike));
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

  getNearestOriginSessionForClient(client, browserWorldKey, excludeHostSessionId = client?.viewerSessionId) {
    return findNearestOriginSession({
      requesterPosition: positionFromPrivateClient(client),
      sessions: this.browserManager.listSessionsForWorld(browserWorldKey),
      resolveSessionPosition: (session) => this.getSessionHostPosition(session),
      radius: PRIVATE_WORLD_BROWSER_RADIUS,
      excludeHostSessionId,
    });
  }

  isClientWithinAnchorRadius(client, anchorSession) {
    return isWithinRadius(
      positionFromPrivateClient(client),
      this.getSessionHostPosition(anchorSession),
      PRIVATE_WORLD_BROWSER_RADIUS,
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

  sessionHasCapacity(session) {
    const maxViewers = Math.max(1, Number(session?.maxViewers) || PRIVATE_WORLD_MAX_RECIPIENTS);
    const viewerCount = session?.subscribers instanceof Set
      ? Math.max(0, session.subscribers.size - 1)
      : Math.max(0, Number(session?.viewerCount) || 0);
    return viewerCount < maxViewers;
  }

  buildSessionContextPayload(sessionLike) {
    const session = this.buildBrowserSessionPayload(sessionLike);
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

  getSessionAudienceRecipients(session, worldClients) {
    const hostClient = this.getSessionHostClient(session);
    if (!hostClient) {
      return new Set([String(session?.hostSessionId ?? "").trim()].filter(Boolean));
    }
    const anchorSession = isMemberSession(session) || isJoinedPersistentVoiceSession(session)
      ? this.getOriginSession(session)
      : null;
    const senderPosition = anchorSession ? this.getSessionHostPosition(anchorSession) : positionFromPrivateClient(hostClient);
    const recipients = new Set(
      selectNearestRecipients({
        senderSessionId: hostClient.viewerSessionId,
        senderPosition,
        candidates: worldClients.map((entry) => ({
          viewerSessionId: entry.viewerSessionId,
          position: positionFromPrivateClient(entry),
        })),
        radius: PRIVATE_WORLD_BROWSER_RADIUS,
        maxRecipients: PRIVATE_WORLD_MAX_RECIPIENTS,
      }),
    );
    recipients.add(hostClient.viewerSessionId);
    return recipients;
  }

  getClientDisplayName(client) {
    return String(client?.displayName ?? client?.profile?.display_name ?? client?.profile?.username ?? "viewer").trim() || "viewer";
  }

  broadcastToWorld(worldId, creatorUsername, payload) {
    for (const client of this.getWorldClients(worldId, creatorUsername)) {
      sendJson(client, payload);
    }
  }

  broadcastToBrowserWorld(browserWorldKey, payload) {
    for (const client of this.getBrowserWorldClients(browserWorldKey)) {
      sendJson(client, payload);
    }
  }

  buildBrowserSessionPayload(sessionLike) {
    if (!sessionLike) {
      return null;
    }
    const sessionId = String(sessionLike.sessionId ?? sessionLike.id ?? "").trim();
    const rawSession = sessionId ? this.browserManager.getSession(sessionId) ?? sessionLike : sessionLike;
    const session = typeof this.browserManager.toClientSession === "function"
      ? this.browserManager.toClientSession(rawSession)
      : { ...rawSession };
    const subscribers = rawSession.subscribers instanceof Set ? rawSession.subscribers : new Set();
    return {
      ...session,
      sessionId: sessionId || session.sessionId,
      viewerCount: Math.max(0, [...subscribers].filter((viewerSessionId) => viewerSessionId !== session.hostSessionId).length),
      maxViewers: Math.max(1, Number(rawSession.maxViewers) || 20),
    };
  }

  sendExistingBrowserSessions(client) {
    for (const rawSession of this.browserManager.listSessionsForWorld(client.browserWorldKey)) {
      const session = this.buildBrowserSessionPayload(rawSession);
      if (!session) {
        continue;
      }
      sendJson(client, {
        type: "browser:session",
        session,
      });
      const deliveryMode = rawSession.subscribers?.has(client.viewerSessionId) ? "full" : "placeholder";
      client.browserModes.set(session.sessionId, deliveryMode);
      sendJson(client, {
        type: deliveryMode === "full" ? "browser:subscribe" : "browser:unsubscribe",
        sessionId: session.sessionId,
        hostSessionId: session.hostSessionId,
        viewerCount: session.viewerCount,
        maxViewers: session.maxViewers,
      });
    }
  }

  handleChatSend(client, message) {
    if (!client?.profile) {
      sendJson(client, {
        type: "chat:error",
        message: "Guests cannot chat in private worlds.",
      });
      return;
    }
    const text = sanitizeChatText(message.text, PRIVATE_WORLD_CHAT_MAX_CHARS);
    if (!text) {
      return;
    }
    const rateLimit = checkChatRateLimit(client.chatRateLimitState ?? {}, {
      now: Date.now(),
      text,
    });
    client.chatRateLimitState = rateLimit.state ?? client.chatRateLimitState ?? {};
    if (!rateLimit.allowed) {
      sendJson(client, {
        type: "chat:error",
        message: rateLimit.reason || "Chat rate limit reached.",
      });
      return;
    }
    const worldClients = this.getWorldClients(client.worldId, client.creatorUsername);
    const fullRecipients = new Set(
      selectNearestRecipients({
        senderSessionId: client.viewerSessionId,
        senderPosition: positionFromPrivateClient(client),
        candidates: worldClients.map((entry) => ({
          viewerSessionId: entry.viewerSessionId,
          position: positionFromPrivateClient(entry),
        })),
        radius: PRIVATE_WORLD_CHAT_DETAIL_RADIUS,
        maxRecipients: PRIVATE_WORLD_MAX_RECIPIENTS,
      }),
    );
    fullRecipients.add(client.viewerSessionId);
    const expiresAt = new Date(Date.now() + PRIVATE_WORLD_CHAT_TTL_SECONDS * 1000).toISOString();

    for (const entry of worldClients) {
      sendJson(entry, {
        type: "chat:event",
        actorSessionId: client.viewerSessionId,
        displayName: client.displayName,
        mode: fullRecipients.has(entry.viewerSessionId) ? "full" : "placeholder",
        text: fullRecipients.has(entry.viewerSessionId) ? text : "...",
        createdAt: new Date().toISOString(),
        expiresAt,
      });
    }
  }

  async handleShareJoinRequest(client, message) {
    if (!client?.profile) {
      return;
    }
    const requestedAnchorSessionId = String(message.anchorSessionId ?? "").trim();
    const anchorSession = requestedAnchorSessionId
      ? this.browserManager.getSession(requestedAnchorSessionId)
      : this.getNearestOriginSessionForClient(client, client.browserWorldKey);
    if (
      !anchorSession
      || !isListedLiveSession(anchorSession)
      || anchorSession.hostSessionId === client.viewerSessionId
      || !this.isClientWithinAnchorRadius(client, anchorSession)
    ) {
      sendJson(client, {
        type: "share:join-resolved",
        approved: false,
        anchorSessionId: requestedAnchorSessionId,
        message: "No nearby share is available to join.",
      });
      return;
    }
    if (!this.sessionHasCapacity(anchorSession)) {
      sendJson(client, {
        type: "share:join-resolved",
        approved: false,
        anchorSessionId: anchorSession.id,
        message: "That nearby share is full right now.",
      });
      return;
    }
    const key = this.getShareJoinKey(anchorSession.id, client.viewerSessionId);
    this.pendingShareJoinRequests.set(key, {
      anchorSessionId: anchorSession.id,
      requesterSessionId: client.viewerSessionId,
      shareKind: String(message.shareKind ?? "screen").trim().toLowerCase(),
      requestedAt: Date.now(),
      browserWorldKey: client.browserWorldKey,
    });
    const anchorClient = this.findBrowserClient(client.browserWorldKey, anchorSession.hostSessionId);
    if (anchorClient) {
      sendJson(anchorClient, {
        type: "share:join-request",
        anchorSessionId: anchorSession.id,
        requesterSessionId: client.viewerSessionId,
        requesterDisplayName: this.getClientDisplayName(client),
        shareKind: String(message.shareKind ?? "screen").trim().toLowerCase(),
        anchorSession: this.buildSessionContextPayload(anchorSession),
      });
    }
    sendJson(client, {
      type: "share:join-requested",
      anchorSessionId: anchorSession.id,
      anchorHostSessionId: anchorSession.hostSessionId,
    });
  }

  async handleShareJoinCancel(client, message) {
    if (!client?.profile) {
      return;
    }
    const anchorSessionId = String(message.anchorSessionId ?? "").trim();
    if (!anchorSessionId) {
      return;
    }
    const key = this.getShareJoinKey(anchorSessionId, client.viewerSessionId);
    const hadPendingRequest = this.pendingShareJoinRequests.delete(key);
    this.clearApprovedShareJoin(anchorSessionId, client.viewerSessionId);
    const anchorSession = this.browserManager.getSession(anchorSessionId);
    const anchorHostSessionId = String(anchorSession?.hostSessionId ?? "").trim();
    if (hadPendingRequest && anchorHostSessionId) {
      const anchorClient = this.findBrowserClient(client.browserWorldKey, anchorHostSessionId);
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
    const anchorSession = this.browserManager.getSession(anchorSessionId);
    if (!anchorSession || anchorSession.hostSessionId !== client.viewerSessionId || !isListedLiveSession(anchorSession)) {
      return;
    }
    const requesterClient = this.findBrowserClient(client.browserWorldKey, requesterSessionId);
    if (!requesterClient) {
      return;
    }
    const approved = message.approved === true
      && this.isClientWithinAnchorRadius(requesterClient, anchorSession)
      && this.sessionHasCapacity(anchorSession);
    if (approved) {
      this.grantApprovedShareJoin(anchorSessionId, requesterSessionId, request.shareKind);
    } else {
      this.clearApprovedShareJoin(anchorSessionId, requesterSessionId);
    }
    sendJson(requesterClient, {
      type: "share:join-resolved",
      approved,
      anchorSessionId,
      anchorHostSessionId: anchorSession.hostSessionId,
      anchorSession: this.buildSessionContextPayload(anchorSession),
      message: approved ? "Join approved." : "Join request declined.",
    });
  }

  clearVoiceJoinOffer(sessionId) {
    this.voiceJoinOffers.delete(String(sessionId ?? "").trim());
  }

  async handleVoiceStart(client) {
    if (!client?.profile) {
      sendJson(client, {
        type: "voice:error",
        message: "Guests cannot use persistent voice chat in private worlds.",
      });
      return;
    }
    try {
      const session = await this.browserManager.startSession({
        hostSessionId: client.viewerSessionId,
        worldSnapshotId: client.browserWorldKey,
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
    const anchorClient = this.findBrowserClient(client.browserWorldKey, anchorSession.hostSessionId);
    if (!anchorClient) {
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
    const requesterClient = this.findBrowserClient(client.browserWorldKey, requesterSessionId);
    const voiceSession = this.getHostedPersistentVoiceSession(requesterSessionId);
    if (!requesterClient || !voiceSession) {
      return;
    }
    const offer = this.voiceJoinOffers.get(voiceSession.id ?? voiceSession.sessionId);
    if (!offer || offer.anchorSessionId !== anchorSessionId) {
      return;
    }
    const approved = message.approved === true
      && this.isClientWithinAnchorRadius(requesterClient, anchorSession)
      && this.sessionHasCapacity(anchorSession);
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

  buildPresencePayload(client) {
    if (!client?.profile || !client?.presence) {
      return null;
    }
    return {
      viewerSessionId: client.viewerSessionId,
      viewer_session_id: client.viewerSessionId,
      actor_type: "viewer",
      actor: {
        display_name: client.displayName,
      },
      movement_state: {
        displayName: client.displayName,
      },
      position_x: client.presence.position_x,
      position_y: client.presence.position_y,
      position_z: client.presence.position_z,
      heading_y: client.presence.heading_y,
    };
  }

  sendExistingPresence(client) {
    const presence = this.getWorldClients(client.worldId, client.creatorUsername)
      .map((entry) => this.buildPresencePayload(entry))
      .filter(Boolean);
    sendJson(client, {
      type: "presence:snapshot",
      presence,
    });
  }

  async handlePresenceUpdate(client, message) {
    const positionX = Number(message.position_x);
    const positionY = Number(message.position_y);
    const positionZ = Number(message.position_z);
    const headingY = Number(message.heading_y);
    if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(positionZ)) {
      return;
    }
    client.presence = {
      position_x: positionX,
      position_y: positionY,
      position_z: positionZ,
      heading_y: Number.isFinite(headingY) ? headingY : 0,
    };
    client.position = {
      x: positionX,
      y: positionY,
      z: positionZ,
    };
    if (client.profile) {
      const presence = this.buildPresencePayload(client);
      if (presence) {
        this.broadcastToWorld(client.worldId, client.creatorUsername, {
          type: "presence:update",
          presence,
        });
      }
    }
    const now = Date.now();
    if (
      typeof this.store?.touchPrivateWorldParticipant === "function"
      && now - Number(client.lastParticipantHeartbeatAt ?? 0) >= PRIVATE_WORLD_PARTICIPANT_HEARTBEAT_MS
    ) {
      client.lastParticipantHeartbeatAt = now;
      try {
        await this.store.touchPrivateWorldParticipant({
          worldId: client.worldId,
          creatorUsername: client.creatorUsername,
          profile: client.profile ?? null,
          guestSessionId: client.guestSessionId ?? "",
        });
      } catch (_error) {
        // Presence updates should stay realtime-first even if the DB heartbeat write fails.
      }
    }
    await this.rebalanceBrowserSessions(client.browserWorldKey);
  }

  async handleBrowserStart(client, message) {
    if (!client?.profile) {
      sendJson(client, {
        type: "browser:error",
        message: "Guests cannot share in private worlds.",
      });
      return;
    }
    try {
      const sessionMode = String(message.mode ?? "").trim() === "display-share" ? "display-share" : "remote-browser";
      const existingDisplaySession = this.getHostedDisplaySession(client.viewerSessionId);
      let groupRole = "origin";
      let anchorSession = null;
      if (sessionMode === "display-share") {
        if (existingDisplaySession && isMemberSession(existingDisplaySession)) {
          const existingAnchorSession = this.getOriginSession(existingDisplaySession);
          if (existingAnchorSession && this.isClientWithinAnchorRadius(client, existingAnchorSession)) {
            anchorSession = existingAnchorSession;
            groupRole = "member";
          }
        }
        if (!anchorSession) {
          const requestedAnchorSessionId = String(message.anchorSessionId ?? "").trim();
          anchorSession = requestedAnchorSessionId
            ? this.browserManager.getSession(requestedAnchorSessionId)
            : this.getNearestOriginSessionForClient(client, client.browserWorldKey);
          if (anchorSession && !isOriginSession(anchorSession)) {
            anchorSession = this.getOriginSession(anchorSession);
          }
          if (anchorSession && !isListedLiveSession(anchorSession)) {
            anchorSession = null;
          }
        }
        if (anchorSession && this.isClientWithinAnchorRadius(client, anchorSession)) {
          const alreadyJoinedAnchor =
            existingDisplaySession
            && isMemberSession(existingDisplaySession)
            && getAnchorSessionId(existingDisplaySession) === anchorSession.id;
          if (!alreadyJoinedAnchor && !this.hasApprovedShareJoin(anchorSession.id, client.viewerSessionId)) {
            sendJson(client, {
              type: "share:join-required",
              anchorSessionId: anchorSession.id,
              anchorHostSessionId: anchorSession.hostSessionId,
              anchorSession: this.buildSessionContextPayload(anchorSession),
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
        worldSnapshotId: client.browserWorldKey,
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
      await this.broadcastBrowserSession(session);
    } catch (error) {
      sendJson(client, {
        type: "browser:error",
        message: error.message || "Could not start live share.",
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
        message: error.message || "Could not send browser input.",
      });
    }
  }

  async refreshClient(client) {
    try {
      const detail = await this.store.getPrivateWorldDetail({
        worldId: client.worldId,
        creatorUsername: client.creatorUsername,
        profile: client.profile,
        allowGuest: !client.profile,
        includeContent: Boolean(client.profile),
      });
      sendJson(client, {
        type: "world:snapshot",
        world: detail.world,
      });
    } catch (error) {
      sendJson(client, {
        type: "world:error",
        message: error.message || "Could not refresh world snapshot",
      });
    }
  }

  async broadcastBrowserSession(sessionPayload, options = {}) {
    const session = this.buildBrowserSessionPayload(sessionPayload);
    const browserWorldKey = String(session?.worldSnapshotId ?? sessionPayload?.worldSnapshotId ?? "").trim();
    if (!session || !browserWorldKey) {
      return;
    }
    this.broadcastToBrowserWorld(browserWorldKey, {
      type: "browser:session",
      session,
    });
    if (options.rebalance !== false) {
      await this.rebalanceBrowserSessions(browserWorldKey);
    }
  }

  broadcastBrowserFrame(frame) {
    const session = this.browserManager.getSession(frame.sessionId);
    if (!session) {
      return;
    }
    const recipients = session.subscribers instanceof Set
      ? session.subscribers
      : new Set(this.getBrowserWorldClients(session.worldSnapshotId).map((entry) => entry.viewerSessionId));
    for (const viewerSessionId of recipients) {
      const client = [...this.clients].find((entry) => entry.viewerSessionId === viewerSessionId && entry.browserWorldKey === session.worldSnapshotId);
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

  notifyBrowserError(payload) {
    const session = payload.sessionId ? this.browserManager.getSession(payload.sessionId) : null;
    const hostSessionId = payload.hostSessionId || session?.hostSessionId || "";
    const client = [...this.clients].find((entry) => entry.viewerSessionId === hostSessionId);
    if (!client) {
      return;
    }
    sendJson(client, {
      type: "browser:error",
      sessionId: payload.sessionId,
      message: payload.message,
    });
  }

  async updatePersistentVoiceOffers(browserWorldKey) {
    const sessions = this.browserManager.listSessionsForWorld(browserWorldKey);
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
      const stillInOfferedRange = offeredAnchor ? this.isClientWithinAnchorRadius(hostClient, offeredAnchor) : false;

      if (isJoinedPersistentVoiceSession(session)) {
        const anchorSession = this.getOriginSession(session);
        if (anchorSession && this.isClientWithinAnchorRadius(hostClient, anchorSession)) {
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
        await this.broadcastBrowserSession(session, { rebalance: false });
      }

      if (offer && !stillInOfferedRange) {
        this.clearVoiceJoinOffer(sessionId);
      }

      const nearestOrigin = this.getNearestOriginSessionForClient(hostClient, browserWorldKey);
      if (!nearestOrigin || !this.sessionHasCapacity(nearestOrigin)) {
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
        anchorSession: this.buildSessionContextPayload(nearestOrigin),
      });
    }
  }

  async rebalanceBrowserSessions(browserWorldKey) {
    const worldClients = this.getBrowserWorldClients(browserWorldKey);
    for (const session of this.browserManager.listSessionsForWorld(browserWorldKey)) {
      const hostClient = this.getSessionHostClient(session);
      if (!hostClient) {
        await this.browserManager.stopSession(session.id ?? session.sessionId);
        continue;
      }
      if (isMemberSession(session)) {
        const anchorSession = this.getOriginSession(session);
        if (!anchorSession || !this.isClientWithinAnchorRadius(hostClient, anchorSession)) {
          await this.browserManager.stopSession(session.id ?? session.sessionId);
          continue;
        }
      }
      const fullRecipients = this.getSessionAudienceRecipients(session, worldClients);
      const previousRecipients = new Set(session.subscribers ?? []);
      session.subscribers = fullRecipients;
      const recipientsChanged =
        previousRecipients.size !== fullRecipients.size
        || [...fullRecipients].some((viewerSessionId) => !previousRecipients.has(viewerSessionId));
      const nextViewerCount = Math.max(0, fullRecipients.size - 1);
      const nextMaxViewers = PRIVATE_WORLD_MAX_RECIPIENTS;
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
        const client = this.findBrowserClient(browserWorldKey, viewerSessionId);
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
        const client = this.findBrowserClient(browserWorldKey, viewerSessionId);
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
        await this.broadcastBrowserSession(session, { rebalance: false });
      }
    }
    await this.updatePersistentVoiceOffers(browserWorldKey);
  }

  async broadcastBrowserStop(payload) {
    const browserWorldKey = String(payload.worldSnapshotId ?? "").trim();
    if (!browserWorldKey) {
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
      for (const session of this.browserManager.listSessionsForWorld(browserWorldKey)) {
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
    }
    if (isPersistentVoiceSession(payload)) {
      this.clearVoiceJoinOffer(payload.sessionId);
    }
    this.broadcastToBrowserWorld(browserWorldKey, {
      type: "browser:stop",
      sessionId: payload.sessionId,
      hostSessionId: payload.hostSessionId,
    });
    for (const client of this.getBrowserWorldClients(browserWorldKey)) {
      client.browserModes?.delete?.(payload.sessionId);
    }
    await this.rebalanceBrowserSessions(browserWorldKey).catch(() => null);
  }

  async handleDisconnect(client) {
    if (!this.clients.has(client)) {
      return;
    }
    this.clients.delete(client);
    const remainingHostedSessions = this.browserManager.listSessionsForHost(client.viewerSessionId);
    if (remainingHostedSessions.length > 0) {
      await this.stopHostedSessions(client.viewerSessionId);
    } else {
      await this.rebalanceBrowserSessions(client.browserWorldKey);
    }
    if (client.profile) {
      this.broadcastToWorld(client.worldId, client.creatorUsername, {
        type: "presence:remove",
        viewerSessionId: client.viewerSessionId,
      });
    }
    if (typeof this.store?.leavePrivateWorld === "function") {
      try {
        await this.store.leavePrivateWorld({
          worldId: client.worldId,
          creatorUsername: client.creatorUsername,
          profile: client.profile ?? null,
          guestSessionId: client.guestSessionId ?? "",
        });
      } catch (_error) {
        // Disconnect cleanup is best-effort so a network drop does not cascade into another failure.
      }
    }
  }

  async broadcastStoreEvent(event = {}) {
    const worldId = String(event.world_id ?? "").trim();
    const creatorUsername = String(event.creator_username ?? "").trim().toLowerCase();
    if (!worldId || !creatorUsername) {
      return;
    }
    for (const client of this.clients) {
      if (client.worldId !== worldId || client.creatorUsername.toLowerCase() !== creatorUsername) {
        continue;
      }
      if (event.type === "runtime:snapshot" || event.type === "scene:switched") {
        sendJson(client, {
          type: "world:runtime",
          snapshot: event.snapshot ?? null,
          event,
        });
        continue;
      }
      sendJson(client, {
        type: "world:event",
        event,
      });
    }
  }

  async dispose() {
    this.unsubscribe?.();
    await this.browserManager.dispose();
    for (const client of this.clients) {
      client.socket.close(1001, "server shutdown");
    }
    this.clients.clear();
    this.wss?.close?.();
  }
}

export function installPrivateWorldGateway(options = {}) {
  const gateway = new PrivateWorldGateway(options);
  gateway.install(options.server);
  return gateway;
}
