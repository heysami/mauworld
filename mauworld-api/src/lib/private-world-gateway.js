import { WebSocket, WebSocketServer } from "ws";
import { BrowserSessionManager } from "./browser-session-manager.js";
import { checkChatRateLimit, sanitizeChatText, selectNearestRecipients } from "./realtime-state.js";

const PRIVATE_WORLD_REALTIME_PATH = "/api/ws/private/worlds";
const PRIVATE_WORLD_CHAT_MAX_CHARS = 160;
const PRIVATE_WORLD_CHAT_TTL_SECONDS = 8;
const PRIVATE_WORLD_CHAT_DETAIL_RADIUS = 180;
const PRIVATE_WORLD_BROWSER_RADIUS = 96;
const PRIVATE_WORLD_MAX_RECIPIENTS = 20;

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
      this.broadcastBrowserStop(payload);
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

  async rebalanceBrowserSessions(browserWorldKey) {
    const worldClients = this.getBrowserWorldClients(browserWorldKey);
    for (const session of this.browserManager.listSessionsForWorld(browserWorldKey)) {
      const hostClient = this.findBrowserClient(browserWorldKey, session.hostSessionId);
      if (!hostClient) {
        await this.browserManager.stopSession(session.id ?? session.sessionId);
        continue;
      }
      const fullRecipients = new Set(
        selectNearestRecipients({
          senderSessionId: hostClient.viewerSessionId,
          senderPosition: positionFromPrivateClient(hostClient),
          candidates: worldClients.map((entry) => ({
            viewerSessionId: entry.viewerSessionId,
            position: positionFromPrivateClient(entry),
          })),
          radius: PRIVATE_WORLD_BROWSER_RADIUS,
          maxRecipients: PRIVATE_WORLD_MAX_RECIPIENTS,
        }),
      );
      fullRecipients.add(hostClient.viewerSessionId);
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

      for (const viewerSessionId of fullRecipients) {
        if (previousRecipients.has(viewerSessionId)) {
          continue;
        }
        const client = this.findBrowserClient(browserWorldKey, viewerSessionId);
        if (!client) {
          continue;
        }
        client.browserModes.set(session.id ?? session.sessionId, "full");
        sendJson(client, {
          type: "browser:subscribe",
          sessionId: session.id ?? session.sessionId,
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
        client.browserModes.set(session.id ?? session.sessionId, "placeholder");
        sendJson(client, {
          type: "browser:unsubscribe",
          sessionId: session.id ?? session.sessionId,
          hostSessionId: session.hostSessionId,
          viewerCount: session.viewerCount,
          maxViewers: session.maxViewers,
        });
      }

      for (const client of worldClients) {
        if (fullRecipients.has(client.viewerSessionId)) {
          client.browserModes.set(session.id ?? session.sessionId, "full");
          continue;
        }
        if (client.browserModes.get(session.id ?? session.sessionId) !== "placeholder") {
          client.browserModes.set(session.id ?? session.sessionId, "placeholder");
          sendJson(client, {
            type: "browser:unsubscribe",
            sessionId: session.id ?? session.sessionId,
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
      const session = await this.browserManager.startSession({
        hostSessionId: client.viewerSessionId,
        worldSnapshotId: client.browserWorldKey,
        mode: message.mode,
        title: message.title,
        shareKind: message.shareKind,
        hasVideo: message.hasVideo,
        hasAudio: message.hasAudio,
        aspectRatio: message.aspectRatio,
        displaySurface: message.displaySurface,
      });
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
      : this.browserManager.getSessionByHost(client.viewerSessionId);
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

  broadcastBrowserStop(payload) {
    const browserWorldKey = String(payload.worldSnapshotId ?? "").trim();
    if (!browserWorldKey) {
      return;
    }
    this.broadcastToBrowserWorld(browserWorldKey, {
      type: "browser:stop",
      sessionId: payload.sessionId,
      hostSessionId: payload.hostSessionId,
    });
    for (const client of this.getBrowserWorldClients(browserWorldKey)) {
      client.browserModes?.delete?.(payload.sessionId);
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

  async handleDisconnect(client) {
    if (!this.clients.has(client)) {
      return;
    }
    this.clients.delete(client);
    const browserSession = this.browserManager.getSessionByHost(client.viewerSessionId);
    if (browserSession) {
      await this.browserManager.stopSession(browserSession.id ?? browserSession.sessionId);
    } else {
      await this.rebalanceBrowserSessions(client.browserWorldKey);
    }
    if (client.profile) {
      this.broadcastToWorld(client.worldId, client.creatorUsername, {
        type: "presence:remove",
        viewerSessionId: client.viewerSessionId,
      });
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
