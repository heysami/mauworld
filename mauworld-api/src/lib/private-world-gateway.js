import { WebSocket, WebSocketServer } from "ws";

const PRIVATE_WORLD_REALTIME_PATH = "/api/ws/private/worlds";

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

export class PrivateWorldGateway {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.store = options.store;
    this.clients = new Set();
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
        profile: auth?.profile ?? null,
        guestSessionId: guestSessionId || null,
      };
      this.clients.add(client);
      socket.on("message", (buffer) => {
        this.handleMessage(client, parseJson(buffer));
      });
      socket.on("close", () => {
        this.clients.delete(client);
      });
      socket.on("error", () => {
        this.clients.delete(client);
      });

      sendJson(client, {
        type: "world:snapshot",
        world: detail.world,
      });
    } catch (error) {
      socket.close(1008, error.message || "not allowed");
    }
  }

  handleMessage(client, message) {
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
      void this.refreshClient(client);
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
      sendJson(client, {
        type: "world:event",
        event,
      });
    }
  }

  async dispose() {
    this.unsubscribe?.();
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
