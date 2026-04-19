const { mauworldApiUrl } = window.MauworldSocial;

function buildRealtimeUrl(viewerSessionId, accessToken = "") {
  const url = new URL(
    mauworldApiUrl("/ws/public/world/current", {
      viewerSessionId,
      accessToken,
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
    const accessToken = String(
      typeof options.getAccessToken === "function"
        ? options.getAccessToken()
        : (options.accessToken ?? ""),
    ).trim();
    try {
      client.socket = new WebSocket(buildRealtimeUrl(viewerSessionId, accessToken));
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
    requestShareJoin(anchorSessionId, shareKind) {
      return send("share:join-request", { anchorSessionId, shareKind });
    },
    cancelShareJoin(anchorSessionId) {
      return send("share:join-cancel", { anchorSessionId });
    },
    decideShareJoin(anchorSessionId, requesterSessionId, approved) {
      return send("share:join-decision", { anchorSessionId, requesterSessionId, approved });
    },
    kickShareMember(anchorSessionId, memberSessionId) {
      return send("share:member-kick", { anchorSessionId, memberSessionId });
    },
    startVoice(input = {}) {
      const payload =
        typeof input === "object" && input
          ? input
          : {};
      return send("voice:start", payload);
    },
    stopVoice(sessionId) {
      return send("voice:stop", { sessionId });
    },
    respondVoiceJoinOffer(anchorSessionId, accepted) {
      return send("voice:join-offer-response", { anchorSessionId, accepted });
    },
    cancelVoiceJoin(anchorSessionId) {
      return send("voice:join-cancel", { anchorSessionId });
    },
    decideVoiceJoin(anchorSessionId, requesterSessionId, approved) {
      return send("voice:join-decision", { anchorSessionId, requesterSessionId, approved });
    },
    sendBrowserInput(sessionId, input) {
      return send("browser:input", { sessionId, input });
    },
    startGameShare(gameId, anchorSessionId = "") {
      return send("game:start-share", { gameId, anchorSessionId });
    },
    stopGameShare(sessionId) {
      return send("game:stop-share", { sessionId });
    },
    openGame(sessionId) {
      return send("game:open", { sessionId });
    },
    claimGameSeat(sessionId, seatId) {
      return send("game:seat-claim", { sessionId, seatId });
    },
    releaseGameSeat(sessionId, seatId = "") {
      return send("game:seat-release", {
        sessionId,
        seatId: String(seatId ?? "").trim(),
      });
    },
    setGameReady(sessionId, ready) {
      return send("game:ready", { sessionId, ready: ready === true });
    },
    startGameMatch(sessionId) {
      return send("game:start-match", { sessionId });
    },
    sendGameAction(sessionId, action) {
      return send("game:action", { sessionId, action });
    },
    sendGameState(sessionId, state, started = false) {
      return send("game:state", { sessionId, state, started: started === true });
    },
    sendGamePreview(sessionId, preview) {
      return send("game:preview", { sessionId, preview });
    },
    copyGame(sessionId, title = "") {
      return send("game:copy", { sessionId, title });
    },
    isConnected() {
      return Boolean(client.socket && client.socket.readyState === WebSocket.OPEN);
    },
  };
}
