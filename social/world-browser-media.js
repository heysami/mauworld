const LIVEKIT_CLIENT_MODULE_URL = "https://cdn.jsdelivr.net/npm/livekit-client@2/+esm";

function getPublicationTrackName(publication) {
  return String(publication?.trackName ?? publication?.name ?? "").trim();
}

function getTrackName(sessionId) {
  return `browser:${sessionId}`;
}

function getAudioTrackName(sessionId) {
  return `browser-audio:${sessionId}`;
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

function normalizePlayError(error) {
  return String(error?.name || error?.message || "").trim();
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function getAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function isAppleMobileWebKit() {
  const userAgent = String(navigator?.userAgent || "");
  const platform = String(navigator?.platform || "");
  const maxTouchPoints = Number(navigator?.maxTouchPoints) || 0;
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function detachTrackElement(entry, options = {}) {
  if (!entry) {
    return;
  }
  const removeElement = options.removeElement !== false;
  if (entry.element && entry.track?.detach) {
    try {
      entry.track.detach(entry.element);
    } catch (_error) {
      entry.track?.detach?.().forEach((node) => {
        if (removeElement || node !== entry.element) {
          node.remove();
        }
      });
    }
  } else {
    entry.track?.detach?.().forEach((node) => node.remove());
  }
  if (!entry.element) {
    return;
  }
  entry.element.pause?.();
  entry.element.removeAttribute?.("src");
  entry.element.srcObject = null;
  if (removeElement) {
    entry.element.remove?.();
  }
}

export function createBrowserMediaController(options = {}) {
  const audioContainer = document.createElement("div");
  audioContainer.setAttribute("aria-hidden", "true");
  audioContainer.style.position = "fixed";
  audioContainer.style.left = "-9999px";
  audioContainer.style.top = "-9999px";
  audioContainer.style.width = "1px";
  audioContainer.style.height = "1px";
  audioContainer.style.opacity = "0";
  audioContainer.style.pointerEvents = "none";
  audioContainer.style.overflow = "hidden";
  const videoContainer = document.createElement("div");
  videoContainer.setAttribute("aria-hidden", "true");
  videoContainer.style.position = "fixed";
  videoContainer.style.left = "-9999px";
  videoContainer.style.top = "-9999px";
  videoContainer.style.width = "1px";
  videoContainer.style.height = "1px";
  videoContainer.style.opacity = "0";
  videoContainer.style.pointerEvents = "none";
  videoContainer.style.overflow = "hidden";
  document.body.append(audioContainer);
  document.body.append(videoContainer);

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
    audioPlaybackState: new Map(),
    audioVolumes: new Map(),
    audioElements: new Map(),
    audioContext: null,
    audioGraphs: new Map(),
    useAudioGraph: isAppleMobileWebKit() && Boolean(getAudioContextConstructor()),
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

  function getOrCreateAudioElement(sessionId) {
    const key = String(sessionId ?? "").trim();
    if (!key) {
      return null;
    }
    const existing = state.audioElements.get(key);
    if (existing) {
      return existing;
    }
    const element = document.createElement("audio");
    element.autoplay = true;
    element.playsInline = true;
    element.preload = "auto";
    element.setAttribute("autoplay", "");
    element.setAttribute("playsinline", "true");
    audioContainer.append(element);
    state.audioElements.set(key, element);
    return element;
  }

  function ensureAudioContext() {
    if (!state.useAudioGraph) {
      return null;
    }
    if (state.audioContext) {
      return state.audioContext;
    }
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      state.useAudioGraph = false;
      return null;
    }
    state.audioContext = new AudioContextCtor();
    return state.audioContext;
  }

  async function resumeAudioContext() {
    const context = ensureAudioContext();
    if (!context) {
      return null;
    }
    if (context.state === "running") {
      return context;
    }
    try {
      await context.resume();
    } catch (_error) {
      return null;
    }
    return context.state === "running" ? context : null;
  }

  function ensureAudioGraph(entry) {
    if (!state.useAudioGraph || entry?.kind !== "audio" || !entry.element) {
      return null;
    }
    const existing = state.audioGraphs.get(entry.sessionId);
    if (existing) {
      return existing;
    }
    const context = state.audioContext;
    if (!context || context.state !== "running") {
      return null;
    }
    let source = null;
    try {
      source = context.createMediaElementSource(entry.element);
    } catch (_error) {
      return state.audioGraphs.get(entry.sessionId) ?? null;
    }
    const gain = context.createGain();
    gain.gain.value = clampUnit(state.audioVolumes.get(entry.sessionId) ?? 1);
    source.connect(gain);
    gain.connect(context.destination);
    const graph = { context, source, gain };
    state.audioGraphs.set(entry.sessionId, graph);
    return graph;
  }

  function applyAudioOutputState(entry) {
    if (!entry?.element || entry.kind !== "audio") {
      return;
    }
    const volume = clampUnit(state.audioVolumes.get(entry.sessionId) ?? 1);
    const shouldMute = volume <= 0.001;
    const graph = ensureAudioGraph(entry);
    if (graph) {
      entry.element.muted = false;
      entry.element.defaultMuted = false;
      entry.element.volume = 1;
      graph.gain.gain.value = volume;
      return;
    }
    entry.element.muted = shouldMute ? true : false;
    entry.element.defaultMuted = shouldMute ? true : false;
    entry.element.volume = volume;
  }

  function disposeAudioSession(sessionId) {
    const key = String(sessionId ?? "").trim();
    if (!key) {
      return;
    }
    const graph = state.audioGraphs.get(key);
    if (graph) {
      graph.source.disconnect();
      graph.gain.disconnect();
      state.audioGraphs.delete(key);
    }
    const element = state.audioElements.get(key);
    if (element) {
      element.pause?.();
      element.removeAttribute?.("src");
      element.srcObject = null;
      element.remove?.();
      state.audioElements.delete(key);
    }
    state.audioPlaybackState.delete(key);
    state.audioVolumes.delete(key);
  }

  function notifyRemoteAudioState(sessionId) {
    const key = String(sessionId ?? "").trim();
    if (!key) {
      return;
    }
    const playback = state.audioPlaybackState.get(key) ?? {};
    options.onRemoteAudioState?.({
      sessionId: key,
      available: state.remoteTracks.has(getTrackKey(key, "audio")),
      blocked: playback.blocked === true,
      error: playback.error || "",
    });
  }

  async function playRemoteTrackEntry(entry) {
    if (!entry?.element) {
      return false;
    }
    entry.element.autoplay = true;
    entry.element.playsInline = true;
    if (entry.kind === "audio") {
      applyAudioOutputState(entry);
    } else {
      entry.element.muted = true;
      entry.element.defaultMuted = true;
    }
    try {
      await entry.element.play?.();
      if (entry.kind === "audio") {
        applyAudioOutputState(entry);
        state.audioPlaybackState.set(entry.sessionId, {
          blocked: false,
          error: "",
        });
        notifyRemoteAudioState(entry.sessionId);
      }
      return true;
    } catch (error) {
      if (entry.kind === "audio") {
        state.audioPlaybackState.set(entry.sessionId, {
          blocked: true,
          error: normalizePlayError(error),
        });
        notifyRemoteAudioState(entry.sessionId);
      }
      return false;
    }
  }

  function clearRemoteTrack(sessionId, kind, notify = true) {
    const key = getTrackKey(sessionId, kind);
    const existing = state.remoteTracks.get(key);
    if (!existing) {
      return;
    }
    const preserveAudioElement = kind === "audio";
    detachTrackElement(existing, { removeElement: !preserveAudioElement });
    state.remoteTracks.delete(key);
    if (kind === "video" && notify) {
      options.onRemoteTrackRemoved?.({ sessionId });
    } else if (kind === "audio") {
      notifyRemoteAudioState(sessionId);
    }
  }

  function bindRoomEvents(room, liveKit) {
    room.on(liveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const parsed = parsePublication(publication, track);
      if (!parsed.sessionId) {
        return;
      }

      clearRemoteTrack(parsed.sessionId, parsed.kind, false);
      let element = null;
      if (parsed.kind === "audio") {
        element = getOrCreateAudioElement(parsed.sessionId);
        try {
          track.attach(element);
        } catch (_error) {
          element = track.attach();
          state.audioElements.set(parsed.sessionId, element);
        }
      } else {
        element = track.attach();
      }
      element.autoplay = true;
      element.playsInline = true;
      if (parsed.kind === "audio") {
        element.muted = false;
        audioContainer.append(element);
      } else {
        element.muted = true;
        videoContainer.append(element);
      }

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
      void playRemoteTrackEntry(entry);
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
      if (!parsed.sessionId) {
        return;
      }
      const desired = state.pendingSubscriptions.get(parsed.sessionId);
      if (desired === false) {
        publication.setSubscribed?.(false);
        return;
      }
      if (desired === true) {
        publication.setSubscribed?.(true);
      }
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

  async function unpublishStoredSession(sessionId, options = {}) {
    const key = String(sessionId ?? "").trim();
    const published = state.publishedSessions.get(key);
    if (!published) {
      return false;
    }
    for (const publishedTrack of published.tracks ?? []) {
      try {
        state.room?.localParticipant?.unpublishTrack?.(publishedTrack.track);
      } catch (_error) {
        // Best effort.
      }
      if (options.stopTracks !== false) {
        publishedTrack.track?.stop?.();
      }
    }
    if (options.stopTracks !== false) {
      published.stream?.getTracks?.().forEach((track) => track.stop());
    }
    state.publishedSessions.delete(key);
    return true;
  }

  async function disconnectRoom() {
    for (const sessionId of [...state.publishedSessions.keys()]) {
      await unpublishStoredSession(sessionId);
    }
    state.publishedSessions.clear();

    for (const entry of [...state.remoteTracks.values()]) {
      clearRemoteTrack(entry.sessionId, entry.kind, entry.kind === "video");
    }
    state.remoteTracks.clear();
    for (const sessionId of [...state.audioElements.keys()]) {
      disposeAudioSession(sessionId);
    }

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
    const roomKey = `${viewerSessionId}:${worldSnapshotId}`;
    const nextKey = `${roomKey}:${canPublish ? "publish" : "subscribe"}`;
    const currentRoomMatches =
      state.room
      && state.viewerSessionId === viewerSessionId
      && state.worldSnapshotId === worldSnapshotId;
    if (currentRoomMatches && (state.canPublish || !canPublish)) {
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
        adaptiveStream: false,
        dynacast: true,
      });
      bindRoomEvents(room, liveKit);
      await room.connect(tokenPayload.serverUrl, tokenPayload.token, {
        autoSubscribe: true,
      });
      state.room = room;
      state.enabled = true;
      state.connectionKey = roomKey;
      state.worldSnapshotId = worldSnapshotId;
      state.viewerSessionId = viewerSessionId;
      state.canPublish = canPublish;
      notifyStatus({
        connected: true,
        transport: "livekit",
        roomName: tokenPayload.roomName,
      });
      for (const [sessionId, subscribed] of state.pendingSubscriptions.entries()) {
        applySubscription(sessionId, subscribed === true);
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

  async function publishTracks(params = {}) {
    const sessionId = String(params.sessionId ?? "").trim();
    const stream = params.stream ?? null;
    const trackEntries = Array.isArray(params.trackEntries) ? params.trackEntries.filter(Boolean) : [];
    if (!sessionId || trackEntries.length === 0) {
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
    await unpublishStoredSession(sessionId);
    const liveKit = await ensureLiveKit();
    const publishedTracks = [];
    try {
      for (const entry of trackEntries) {
        const publication = await state.room.localParticipant.publishTrack(entry.track, {
          name: entry.name,
          source: entry.kind === "audio"
            ? (liveKit.Track.Source.ScreenShareAudio ?? liveKit.Track.Source.Microphone)
            : liveKit.Track.Source.ScreenShare,
        });
        publishedTracks.push({
          kind: entry.kind,
          track: entry.track,
          publication,
        });
      }
    } catch (error) {
      for (const publishedTrack of publishedTracks) {
        try {
          state.room?.localParticipant?.unpublishTrack?.(publishedTrack.track);
        } catch (_error) {
          // Best effort.
        }
      }
      throw error;
    }
    state.publishedSessions.set(sessionId, {
      sessionId,
      stream,
      tracks: publishedTracks,
    });
    return true;
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
        if (shouldSubscribe && parsed.kind === "video") {
          publication.setEnabled?.(true);
          publication.setVideoQuality?.(state.liveKit?.VideoQuality?.HIGH);
        }
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
      const stream = canvas.captureStream(fps);
      const track = stream.getVideoTracks?.()[0];
      if (!track) {
        return false;
      }
      track.contentHint = "detail";
      return publishTracks({
        sessionId,
        stream,
        trackEntries: [{
          kind: "video",
          track,
          name: getTrackName(sessionId),
        }],
        viewerSessionId: params.viewerSessionId,
        worldSnapshotId: params.worldSnapshotId,
      });
    },

    async publishStream(params = {}) {
      const sessionId = String(params.sessionId ?? "").trim();
      const stream = params.stream ?? null;
      if (!sessionId || !stream) {
        return false;
      }
      const videoTrack = stream.getVideoTracks?.()[0] ?? null;
      const audioTrack = stream.getAudioTracks?.()[0] ?? null;
      if (!videoTrack && !audioTrack) {
        return false;
      }
      const trackEntries = [];
      if (videoTrack) {
        videoTrack.contentHint = "detail";
        trackEntries.push({
          kind: "video",
          track: videoTrack,
          name: getTrackName(sessionId),
        });
      }
      if (audioTrack) {
        trackEntries.push({
          kind: "audio",
          track: audioTrack,
          name: getAudioTrackName(sessionId),
        });
      }
      return publishTracks({
        sessionId,
        stream,
        trackEntries,
        viewerSessionId: params.viewerSessionId,
        worldSnapshotId: params.worldSnapshotId,
      });
    },

    async unpublishSession(sessionId) {
      return unpublishStoredSession(sessionId);
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

    async resumePlayback(params = {}) {
      const sessionId = String(params.sessionId ?? "").trim();
      const kinds = new Set(
        Array.isArray(params.kinds) && params.kinds.length > 0
          ? params.kinds.map((kind) => String(kind ?? "").trim().toLowerCase()).filter(Boolean)
          : ["audio", "video"],
      );
      if (kinds.has("audio")) {
        await resumeAudioContext();
      }
      const entries = [...state.remoteTracks.values()].filter((entry) => {
        if (sessionId && entry.sessionId !== sessionId) {
          return false;
        }
        return kinds.has(entry.kind);
      });
      if (entries.length === 0) {
        return Boolean(state.audioContext?.state === "running");
      }
      const results = await Promise.all(entries.map((entry) => playRemoteTrackEntry(entry)));
      return results.some(Boolean);
    },

    setRemoteAudioVolume(params = {}) {
      const sessionId = String(params.sessionId ?? "").trim();
      if (!sessionId) {
        return false;
      }
      state.audioVolumes.set(sessionId, clampUnit(params.volume));
      const entry = state.remoteTracks.get(getTrackKey(sessionId, "audio"));
      if (entry) {
        applyAudioOutputState(entry);
      }
      return true;
    },

    removeSession(sessionId) {
      const key = String(sessionId ?? "").trim();
      if (!key) {
        return false;
      }
      clearRemoteTrack(key, "video");
      clearRemoteTrack(key, "audio", false);
      state.pendingSubscriptions.delete(key);
      disposeAudioSession(key);
      return true;
    },

    async disconnect() {
      await disconnectRoom();
      if (state.audioContext && state.audioContext.state !== "closed") {
        state.audioContext.close().catch(() => null);
      }
      state.audioContext = null;
      notifyStatus({ connected: false });
    },

    isEnabled() {
      return state.enabled === true;
    },
  };
}
