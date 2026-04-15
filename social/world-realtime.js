const { mauworldApiUrl } = window.MauworldSocial;

function buildRealtimeUrl(viewerSessionId) {
  const url = new URL(
    mauworldApiUrl("/ws/public/world/current", {
      viewerSessionId,
    }),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function createBackoffDelay(previousDelayMs) {
  if (!previousDelayMs) {
    return 1000;
  }
  return Math.min(12000, Math.round(previousDelayMs * 1.7));
}

export function createWorldRealtimeClient(options = {}) {
  const client = {
    socket: null,
    stopped: false,
    reconnectTimer: 0,
    reconnectDelayMs: 0,
    lastPresenceSentAt: 0,
  };

  function notifyStatus(connected) {
    options.onStatus?.({ connected });
  }

  function clearReconnect() {
    if (client.reconnectTimer) {
      window.clearTimeout(client.reconnectTimer);
      client.reconnectTimer = 0;
    }
  }

  function send(type, payload = {}) {
    if (!client.socket || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    client.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  function scheduleReconnect() {
    if (client.stopped || client.reconnectTimer) {
      return;
    }
    client.reconnectDelayMs = createBackoffDelay(client.reconnectDelayMs);
    client.reconnectTimer = window.setTimeout(() => {
      client.reconnectTimer = 0;
      connect();
    }, client.reconnectDelayMs);
  }

  function handleMessage(event) {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (_error) {
      return;
    }
    if (!payload?.type) {
      return;
    }
    options.onMessage?.(payload);
  }

  function connect() {
    clearReconnect();
    const viewerSessionId = String(options.viewerSessionId ?? "").trim();
    if (!viewerSessionId) {
      return;
    }
    try {
      client.socket = new WebSocket(buildRealtimeUrl(viewerSessionId));
    } catch (error) {
      options.onError?.(error);
      scheduleReconnect();
      return;
    }

    client.socket.addEventListener("open", () => {
      client.reconnectDelayMs = 0;
      notifyStatus(true);
      flushPresence(true);
    });
    client.socket.addEventListener("message", handleMessage);
    client.socket.addEventListener("close", () => {
      notifyStatus(false);
      client.socket = null;
      scheduleReconnect();
    });
    client.socket.addEventListener("error", (error) => {
      options.onError?.(error);
    });
  }

  function flushPresence(force = false) {
    const payload = options.getPresencePayload?.();
    if (!payload) {
      return false;
    }
    const now = performance.now();
    const isMoving = Boolean(payload.isMoving);
    const minimumGapMs = isMoving ? 200 : 1000;
    if (!force && now - client.lastPresenceSentAt < minimumGapMs) {
      return false;
    }
    client.lastPresenceSentAt = now;
    return send("presence:update", payload);
  }

  return {
    start() {
      client.stopped = false;
      connect();
    },
    stop() {
      client.stopped = true;
      clearReconnect();
      if (client.socket) {
        client.socket.close();
      }
      client.socket = null;
      notifyStatus(false);
    },
    tick() {
      flushPresence(false);
    },
    sendPresenceNow() {
      flushPresence(true);
    },
    sendChat(text) {
      return send("chat:send", { text });
    },
    startBrowser(input = {}) {
      const payload =
        typeof input === "string"
          ? { url: input }
          : typeof input === "object" && input
            ? input
            : {};
      return send("browser:start", payload);
    },
    stopBrowser(sessionId) {
      return send("browser:stop", { sessionId });
    },
    sendBrowserInput(sessionId, input) {
      return send("browser:input", { sessionId, input });
    },
    isConnected() {
      return Boolean(client.socket && client.socket.readyState === WebSocket.OPEN);
    },
  };
}
