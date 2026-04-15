const LIVEKIT_CLIENT_MODULE_URL = "https://cdn.jsdelivr.net/npm/livekit-client@2/+esm";

function getPublicationTrackName(publication) {
  return String(publication?.trackName ?? publication?.name ?? "").trim();
}

function getTrackName(sessionId) {
  return `browser:${sessionId}`;
}

function parsePublication(publication, track = null) {
  const trackName = getPublicationTrackName(publication);
  if (trackName.startsWith("browser-audio:")) {
    return {
      sessionId: trackName.slice("browser-audio:".length).trim(),
      kind: "audio",
    };
  }
  if (!trackName.startsWith("browser:")) {
    return { sessionId: "", kind: "" };
  }
  const parts = trackName.split(":");
  if (parts.length === 2) {
    return {
      sessionId: parts[1].trim(),
      kind: track?.kind === "audio" ? "audio" : "video",
    };
  }
  return {
    sessionId: parts[1]?.trim() || "",
    kind: parts[2]?.trim() || (track?.kind === "audio" ? "audio" : "video"),
  };
}

function getTrackKey(sessionId, kind) {
  return `${sessionId}:${kind}`;
}

async function loadLiveKitClient() {
  return import(LIVEKIT_CLIENT_MODULE_URL);
}

function detachTrackElement(entry) {
  if (!entry) {
    return;
  }
  entry.track?.detach?.().forEach((node) => node.remove());
  entry.element?.remove?.();
}

export function createBrowserMediaController(options = {}) {
  const audioContainer = document.createElement("div");
  audioContainer.hidden = true;
  document.body.append(audioContainer);

  const state = {
    liveKit: null,
    liveKitPromise: null,
    room: null,
    connectPromise: null,
    connectionKey: "",
    pendingConnectionKey: "",
    worldSnapshotId: "",
    viewerSessionId: "",
    canPublish: false,
    enabled: null,
    publishedSessions: new Map(),
    remoteTracks: new Map(),
    pendingSubscriptions: new Map(),
  };

  function notifyStatus(patch = {}) {
    options.onStatus?.({
      enabled: state.enabled,
      connected: Boolean(state.room),
      worldSnapshotId: state.worldSnapshotId,
      canPublish: state.canPublish,
      ...patch,
    });
  }

  async function ensureLiveKit() {
    if (state.liveKit) {
      return state.liveKit;
    }
    if (!state.liveKitPromise) {
      state.liveKitPromise = loadLiveKitClient().then((module) => {
        state.liveKit = module;
        return module;
      });
    }
    return state.liveKitPromise;
  }

  function clearRemoteTrack(sessionId, kind, notify = true) {
    const key = getTrackKey(sessionId, kind);
    const existing = state.remoteTracks.get(key);
    if (!existing) {
      return;
    }
    detachTrackElement(existing);
    state.remoteTracks.delete(key);
    if (kind === "video" && notify) {
      options.onRemoteTrackRemoved?.({ sessionId });
    }
  }

  function bindRoomEvents(room, liveKit) {
    room.on(liveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const parsed = parsePublication(publication, track);
      if (!parsed.sessionId) {
        return;
      }

      const element = track.attach();
      element.autoplay = true;
      element.playsInline = true;
      if (parsed.kind === "audio") {
        element.muted = false;
        audioContainer.append(element);
        void element.play?.().catch(() => null);
      } else {
        element.muted = true;
      }

      clearRemoteTrack(parsed.sessionId, parsed.kind, false);
      const entry = {
        key: getTrackKey(parsed.sessionId, parsed.kind),
        sessionId: parsed.sessionId,
        kind: parsed.kind,
        track,
        publication,
        participant,
        element,
      };
      state.remoteTracks.set(entry.key, entry);
      if (parsed.kind === "video") {
        options.onRemoteTrack?.(entry);
      }
    });

    room.on(liveKit.RoomEvent.TrackUnsubscribed, (track, publication) => {
      const parsed = parsePublication(publication, track);
      if (!parsed.sessionId) {
        return;
      }
      clearRemoteTrack(parsed.sessionId, parsed.kind, true);
    });

    room.on(liveKit.RoomEvent.TrackPublished, (publication) => {
      const parsed = parsePublication(publication);
      if (!parsed.sessionId || state.pendingSubscriptions.get(parsed.sessionId) !== true) {
        return;
      }
      publication.setSubscribed?.(true);
    });

    room.on(liveKit.RoomEvent.Disconnected, () => {
      for (const entry of state.remoteTracks.values()) {
        clearRemoteTrack(entry.sessionId, entry.kind, entry.kind === "video");
      }
      state.remoteTracks.clear();
      state.room = null;
      state.connectionKey = "";
      notifyStatus({ connected: false });
    });
  }

  async function disconnectRoom() {
    for (const published of state.publishedSessions.values()) {
      try {
        state.room?.localParticipant?.unpublishTrack?.(published.track);
      } catch (_error) {
        // Best effort.
      }
      published.track?.stop?.();
      published.stream?.getTracks?.().forEach((track) => track.stop());
    }
    state.publishedSessions.clear();

    for (const entry of [...state.remoteTracks.values()]) {
      clearRemoteTrack(entry.sessionId, entry.kind, entry.kind === "video");
    }
    state.remoteTracks.clear();

    if (state.room) {
      state.room.disconnect();
      state.room = null;
    }
    state.connectionKey = "";
  }

  async function ensureRoom(params = {}) {
    const viewerSessionId = String(params.viewerSessionId ?? "").trim();
    const worldSnapshotId = String(params.worldSnapshotId ?? "").trim();
    const canPublish = params.canPublish === true;
    if (!viewerSessionId || !worldSnapshotId) {
      return false;
    }
    const nextKey = `${viewerSessionId}:${worldSnapshotId}:${canPublish ? "publish" : "subscribe"}`;
    if (state.room && state.connectionKey === nextKey) {
      return true;
    }
    if (state.connectPromise && state.pendingConnectionKey === nextKey) {
      return state.connectPromise;
    }

    state.pendingConnectionKey = nextKey;
    state.connectPromise = (async () => {
      if (state.room) {
        await disconnectRoom();
      }
      const tokenPayload = await options.fetchToken?.({
        viewerSessionId,
        worldSnapshotId,
        canPublish,
      });
      if (!tokenPayload?.enabled) {
        state.enabled = false;
        notifyStatus({ connected: false, transport: "jpeg-sequence" });
        return false;
      }
      const liveKit = await ensureLiveKit();
      const room = new liveKit.Room({
        adaptiveStream: true,
        dynacast: true,
      });
      bindRoomEvents(room, liveKit);
      await room.connect(tokenPayload.serverUrl, tokenPayload.token, {
        autoSubscribe: false,
      });
      state.room = room;
      state.enabled = true;
      state.connectionKey = nextKey;
      state.worldSnapshotId = worldSnapshotId;
      state.viewerSessionId = viewerSessionId;
      state.canPublish = canPublish;
      notifyStatus({
        connected: true,
        transport: "livekit",
        roomName: tokenPayload.roomName,
      });
      for (const [sessionId, subscribed] of state.pendingSubscriptions.entries()) {
        if (!subscribed) {
          continue;
        }
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            const parsed = parsePublication(publication);
            if (parsed.sessionId === sessionId) {
              publication.setSubscribed?.(true);
            }
          }
        }
      }
      return true;
    })().catch((error) => {
      state.enabled = false;
      notifyStatus({
        connected: false,
        transport: "jpeg-sequence",
        error: error?.message || "Live browser media failed.",
      });
      return false;
    }).finally(() => {
      state.connectPromise = null;
      state.pendingConnectionKey = "";
    });

    return state.connectPromise;
  }

  function applySubscription(sessionId, shouldSubscribe) {
    if (!state.room) {
      return;
    }
    for (const participant of state.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const parsed = parsePublication(publication);
        if (parsed.sessionId !== sessionId) {
          continue;
        }
        publication.setSubscribed?.(shouldSubscribe);
      }
    }
    if (!shouldSubscribe) {
      clearRemoteTrack(sessionId, "video");
      clearRemoteTrack(sessionId, "audio", false);
    }
  }

  return {
    async connect(params = {}) {
      return ensureRoom(params);
    },

    async publishCanvas(params = {}) {
      const sessionId = String(params.sessionId ?? "").trim();
      const canvas = params.canvas ?? null;
      const fps = Math.max(8, Math.min(30, Math.floor(Number(params.fps) || 24)));
      if (!sessionId || !canvas) {
        return false;
      }
      const connected = await ensureRoom({
        viewerSessionId: params.viewerSessionId,
        worldSnapshotId: params.worldSnapshotId,
        canPublish: true,
      });
      if (!connected || !state.room) {
        return false;
      }
      if (state.publishedSessions.has(sessionId)) {
        return true;
      }
      const liveKit = await ensureLiveKit();
      const stream = canvas.captureStream(fps);
      const track = stream.getVideoTracks?.()[0];
      if (!track) {
        return false;
      }
      track.contentHint = "detail";
      const publication = await state.room.localParticipant.publishTrack(track, {
        name: getTrackName(sessionId),
        source: liveKit.Track.Source.ScreenShare,
      });
      state.publishedSessions.set(sessionId, {
        sessionId,
        stream,
        track,
        publication,
      });
      return true;
    },

    async unpublishSession(sessionId) {
      const key = String(sessionId ?? "").trim();
      const published = state.publishedSessions.get(key);
      if (!published) {
        return false;
      }
      try {
        state.room?.localParticipant?.unpublishTrack?.(published.track);
      } catch (_error) {
        // Best effort.
      }
      published.track?.stop?.();
      published.stream?.getTracks?.().forEach((track) => track.stop());
      state.publishedSessions.delete(key);
      return true;
    },

    async setSubscribed(params = {}) {
      const sessionId = String(params.sessionId ?? "").trim();
      const subscribed = params.subscribed === true;
      if (!sessionId) {
        return false;
      }
      state.pendingSubscriptions.set(sessionId, subscribed);
      if (!subscribed) {
        applySubscription(sessionId, false);
        return true;
      }
      const connected = await ensureRoom({
        viewerSessionId: params.viewerSessionId,
        worldSnapshotId: params.worldSnapshotId,
        canPublish: params.canPublish === true,
      });
      if (!connected) {
        return false;
      }
      applySubscription(sessionId, true);
      return true;
    },

    async disconnect() {
      await disconnectRoom();
      notifyStatus({ connected: false });
    },

    isEnabled() {
      return state.enabled === true;
    },
  };
}
