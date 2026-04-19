import crypto from "node:crypto";
import { HttpError } from "./http.js";

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function clipText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSeatId(value = "") {
  return clipText(value, 64).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function buildSeatEntries(game = {}) {
  const manifest = game.manifest ?? {};
  const maxPlayers = clampInteger(manifest.max_players, 2, 1, 12);
  const labels = Array.isArray(manifest.seats) ? manifest.seats : [];
  const seats = [];
  for (let index = 0; index < maxPlayers; index += 1) {
    const label = clipText(labels[index] ?? `Player ${index + 1}`, 40) || `Player ${index + 1}`;
    seats.push({
      seat_id: normalizeSeatId(label) || `player-${index + 1}`,
      label,
      viewer_session_id: "",
      display_name: "",
      claimed_at: null,
    });
  }
  return seats;
}

function findSeatByViewerSessionId(session, viewerSessionId) {
  return session.seats.find((seat) => seat.viewer_session_id === viewerSessionId) ?? null;
}

function getGameSessionId(session = {}) {
  return String(session.session_id ?? session.sessionId ?? session.id ?? "").trim();
}

function getGameSessionRole(session = {}) {
  const value = String(session.group_role ?? session.groupRole ?? "").trim().toLowerCase();
  return value === "member" ? "member" : "origin";
}

function isOriginGameSession(session = {}) {
  return getGameSessionRole(session) === "origin";
}

function isMemberGameSession(session = {}) {
  return getGameSessionRole(session) === "member";
}

function getGameAnchorSessionId(session = {}) {
  if (isOriginGameSession(session)) {
    return getGameSessionId(session);
  }
  return String(session.anchor_session_id ?? session.anchorSessionId ?? "").trim();
}

function getGameAnchorHostSessionId(session = {}) {
  if (isOriginGameSession(session)) {
    return String(session.host_viewer_session_id ?? session.hostViewerSessionId ?? session.hostSessionId ?? "").trim();
  }
  return String(session.anchor_host_session_id ?? session.anchorHostSessionId ?? "").trim();
}

function sanitizeGameSnapshot(game = {}) {
  const manifest = cloneJson(game.manifest ?? {});
  return {
    id: String(game.id ?? "").trim() || `game_${crypto.randomBytes(4).toString("hex")}`,
    owner_profile_id: String(game.owner_profile_id ?? "").trim() || null,
    source_game_id: String(game.source_game_id ?? "").trim() || null,
    title: clipText(game.title ?? manifest.title ?? "Untitled Game", 96) || "Untitled Game",
    prompt: clipText(game.prompt ?? "", 4000),
    manifest,
    source_html: String(game.source_html ?? "").trim(),
  };
}

function buildSeatSummaries(session) {
  return session.seats.map((seat) => ({
    seat_id: seat.seat_id,
    label: seat.label,
    viewer_session_id: seat.viewer_session_id || null,
    display_name: seat.display_name || null,
    claimed_at: seat.claimed_at || null,
    ready: seat.viewer_session_id ? session.ready_by_viewer_session_id.get(seat.viewer_session_id) === true : false,
  }));
}

function normalizeGameSessionSummary(sessionLike = {}) {
  const sessionId = getGameSessionId(sessionLike);
  const hostViewerSessionId = String(
    sessionLike.host_viewer_session_id
    ?? sessionLike.hostViewerSessionId
    ?? sessionLike.hostSessionId
    ?? "",
  ).trim();
  const game = sanitizeGameSnapshot(sessionLike.game ?? {});
  const groupRole = getGameSessionRole(sessionLike);
  const listedLive = sessionLike.listed_live !== false && sessionLike.listedLive !== false;
  const movementLocked = sessionLike.movement_locked === true || sessionLike.movementLocked === true;
  const viewerCount = Number.isFinite(Number(sessionLike.viewer_count ?? sessionLike.viewerCount))
    ? Math.max(0, Math.floor(Number(sessionLike.viewer_count ?? sessionLike.viewerCount)))
    : sessionLike.opened_viewer_session_ids instanceof Set
      ? Math.max(0, sessionLike.opened_viewer_session_ids.size)
      : 0;
  const maxViewers = Number.isFinite(Number(sessionLike.max_viewers ?? sessionLike.maxViewers))
    ? Math.max(1, Math.floor(Number(sessionLike.max_viewers ?? sessionLike.maxViewers)))
    : 20;
  const anchorSessionId = getGameAnchorSessionId(sessionLike);
  const anchorHostSessionId = getGameAnchorHostSessionId(sessionLike);
  const rawSeats = Array.isArray(sessionLike.seats) ? sessionLike.seats : [];
  const seats = rawSeats.length > 0
    ? rawSeats.map((seat) => ({
      seat_id: seat.seat_id,
      label: seat.label,
      viewer_session_id: seat.viewer_session_id || null,
      display_name: seat.display_name || null,
      claimed_at: seat.claimed_at || null,
      ready: typeof seat.ready === "boolean"
        ? seat.ready
        : (seat.viewer_session_id
          ? sessionLike.ready_by_viewer_session_id?.get?.(seat.viewer_session_id) === true
          : false),
    }))
    : buildSeatSummaries(sessionLike);
  const latestPreview = sessionLike.latest_preview ?? sessionLike.latestPreview ?? null;
  return {
    session_id: sessionId,
    sessionId,
    scope: String(sessionLike.scope ?? "").trim() || "world",
    binding_key: String(sessionLike.binding_key ?? sessionLike.bindingKey ?? "").trim(),
    bindingKey: String(sessionLike.binding_key ?? sessionLike.bindingKey ?? "").trim(),
    host_viewer_session_id: hostViewerSessionId,
    hostViewerSessionId,
    hostSessionId: hostViewerSessionId,
    host_display_name: String(sessionLike.host_display_name ?? sessionLike.hostDisplayName ?? "").trim(),
    title: game.title,
    share_kind: "game",
    shareKind: "game",
    group_role: groupRole,
    groupRole,
    listed_live: listedLive,
    listedLive,
    movement_locked: movementLocked,
    movementLocked,
    anchor_session_id: anchorSessionId,
    anchorSessionId,
    anchor_host_session_id: anchorHostSessionId,
    anchorHostSessionId,
    game: {
      id: game.id,
      owner_profile_id: game.owner_profile_id,
      source_game_id: game.source_game_id,
      title: game.title,
      manifest: cloneJson(game.manifest),
    },
    seats,
    started: sessionLike.started === true,
    viewer_count: viewerCount,
    viewerCount,
    max_viewers: maxViewers,
    maxViewers,
    latest_preview: latestPreview
      ? {
        data_url: latestPreview.data_url,
        width: latestPreview.width,
        height: latestPreview.height,
        updated_at: latestPreview.updated_at,
      }
      : null,
    created_at: sessionLike.created_at ?? sessionLike.createdAt ?? null,
    updated_at: sessionLike.updated_at ?? sessionLike.updatedAt ?? null,
  };
}

export class GameShareManager {
  constructor(options = {}) {
    this.scope = String(options.scope ?? "").trim() || "world";
    this.sessions = new Map();
    this.bindingSessions = new Map();
  }

  createSession(input = {}) {
    const bindingKey = String(input.bindingKey ?? "").trim();
    const hostViewerSessionId = String(input.hostViewerSessionId ?? "").trim();
    if (!bindingKey || !hostViewerSessionId) {
      throw new HttpError(400, "Game shares require a bindingKey and host viewer session.");
    }
    const existing = this.getSessionByHost(bindingKey, hostViewerSessionId);
    if (existing) {
      this.stopSession(existing.id);
    }
    const game = sanitizeGameSnapshot(input.game ?? {});
    if (!game.source_html) {
      throw new HttpError(400, "Game share is missing source HTML.");
    }
    const createdAt = nowIso();
    const session = {
      id: `game_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      scope: String(input.scope ?? this.scope).trim() || this.scope,
      binding_key: bindingKey,
      host_viewer_session_id: hostViewerSessionId,
      host_display_name: clipText(input.hostDisplayName ?? "Host", 48) || "Host",
      share_kind: "game",
      group_role: getGameSessionRole(input),
      listed_live: input.listedLive !== false,
      movement_locked: input.movementLocked === true,
      anchor_session_id: String(input.anchorSessionId ?? "").trim(),
      anchor_host_session_id: String(input.anchorHostSessionId ?? "").trim(),
      game,
      seats: buildSeatEntries(game),
      ready_by_viewer_session_id: new Map(),
      started: false,
      authoritative_state: null,
      latest_preview: null,
      opened_viewer_session_ids: new Set([hostViewerSessionId]),
      max_viewers: clampInteger(input.maxViewers, 20, 1, 99),
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.sessions.set(session.id, session);
    if (!this.bindingSessions.has(bindingKey)) {
      this.bindingSessions.set(bindingKey, new Set());
    }
    this.bindingSessions.get(bindingKey).add(session.id);
    return this.toSessionSummary(session);
  }

  getSession(sessionId) {
    return this.sessions.get(String(sessionId ?? "").trim()) ?? null;
  }

  getSessionByHost(bindingKey, hostViewerSessionId) {
    const resolvedBindingKey = String(bindingKey ?? "").trim();
    const resolvedHostViewerSessionId = String(hostViewerSessionId ?? "").trim();
    if (!resolvedBindingKey || !resolvedHostViewerSessionId) {
      return null;
    }
    return this.listSessionsForBinding(resolvedBindingKey)
      .find((session) => session.host_viewer_session_id === resolvedHostViewerSessionId) ?? null;
  }

  listSessionsForBinding(bindingKey) {
    const ids = this.bindingSessions.get(String(bindingKey ?? "").trim()) ?? new Set();
    return [...ids].map((sessionId) => this.sessions.get(sessionId)).filter(Boolean);
  }

  toSessionSummary(sessionOrId) {
    const session = typeof sessionOrId === "string" ? this.getSession(sessionOrId) : sessionOrId;
    if (!session) {
      return null;
    }
    if ("opened_viewer_session_ids" in session) {
      return normalizeGameSessionSummary({
        ...session,
        seats: buildSeatSummaries(session),
        viewer_count: session.opened_viewer_session_ids.size,
      });
    }
    return normalizeGameSessionSummary(session);
  }

  getOriginSession(sessionLike) {
    const session = typeof sessionLike === "string" ? this.getSession(sessionLike) : sessionLike;
    if (!session) {
      return null;
    }
    if (isOriginGameSession(session)) {
      return session;
    }
    const anchorSessionId = getGameAnchorSessionId(session);
    return anchorSessionId ? this.getSession(anchorSessionId) : null;
  }

  buildOpenPayload(sessionId, viewerSessionId) {
    const session = this.getSession(sessionId);
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!session || !resolvedViewerSessionId) {
      return null;
    }
    session.opened_viewer_session_ids.add(resolvedViewerSessionId);
    session.updated_at = nowIso();
    const claimedSeat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
    return {
      session: this.toSessionSummary(session),
      game: {
        id: session.game.id,
        title: session.game.title,
        manifest: cloneJson(session.game.manifest),
        source_html: session.game.source_html,
      },
      role: session.host_viewer_session_id === resolvedViewerSessionId
        ? "host"
        : claimedSeat
          ? "player"
          : "viewer",
      claimed_seat_id: claimedSeat?.seat_id ?? null,
      authoritative_state: cloneJson(session.authoritative_state),
    };
  }

  claimSeat(sessionId, viewerSessionId, displayName, seatId = "") {
    const session = this.getSession(sessionId);
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!session || !resolvedViewerSessionId) {
      throw new HttpError(404, "Game session not found");
    }
    if (session.started) {
      throw new HttpError(409, "This game has already started");
    }
    const normalizedSeatId = normalizeSeatId(seatId);
    let seat = normalizedSeatId
      ? session.seats.find((entry) => entry.seat_id === normalizedSeatId) ?? null
      : null;
    if (!seat) {
      seat = session.seats.find((entry) => !entry.viewer_session_id) ?? null;
    }
    if (!seat) {
      throw new HttpError(409, "No open player seats remain");
    }
    if (seat.viewer_session_id && seat.viewer_session_id !== resolvedViewerSessionId) {
      throw new HttpError(409, "That player seat is already taken");
    }
    const existingSeat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
    if (existingSeat && existingSeat.seat_id !== seat.seat_id) {
      existingSeat.viewer_session_id = "";
      existingSeat.display_name = "";
      existingSeat.claimed_at = null;
    }
    seat.viewer_session_id = resolvedViewerSessionId;
    seat.display_name = clipText(displayName ?? "Player", 48) || "Player";
    seat.claimed_at = nowIso();
    session.ready_by_viewer_session_id.set(resolvedViewerSessionId, false);
    session.opened_viewer_session_ids.add(resolvedViewerSessionId);
    session.updated_at = nowIso();
    return this.toSessionSummary(session);
  }

  releaseSeat(sessionId, viewerSessionId) {
    const session = this.getSession(sessionId);
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!session || !resolvedViewerSessionId) {
      throw new HttpError(404, "Game session not found");
    }
    const seat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
    if (!seat) {
      return this.toSessionSummary(session);
    }
    seat.viewer_session_id = "";
    seat.display_name = "";
    seat.claimed_at = null;
    session.ready_by_viewer_session_id.delete(resolvedViewerSessionId);
    session.updated_at = nowIso();
    return this.toSessionSummary(session);
  }

  setReady(sessionId, viewerSessionId, ready) {
    const session = this.getSession(sessionId);
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!session || !resolvedViewerSessionId) {
      throw new HttpError(404, "Game session not found");
    }
    const seat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
    if (!seat) {
      throw new HttpError(409, "Claim a player seat before setting ready");
    }
    session.ready_by_viewer_session_id.set(resolvedViewerSessionId, ready === true);
    session.updated_at = nowIso();
    return this.toSessionSummary(session);
  }

  startMatch(sessionId, hostViewerSessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, "Game session not found");
    }
    if (session.host_viewer_session_id !== String(hostViewerSessionId ?? "").trim()) {
      throw new HttpError(403, "Only the host can start this game");
    }
    const claimedSeats = session.seats.filter((seat) => seat.viewer_session_id);
    const minPlayers = clampInteger(session.game.manifest?.min_players, 1, 1, 12);
    if (claimedSeats.length < minPlayers) {
      throw new HttpError(409, `At least ${minPlayers} player${minPlayers === 1 ? "" : "s"} must be seated`);
    }
    const unready = claimedSeats.find((seat) => session.ready_by_viewer_session_id.get(seat.viewer_session_id) !== true);
    if (unready) {
      throw new HttpError(409, "Every seated player must be ready");
    }
    session.started = true;
    session.updated_at = nowIso();
    return this.toSessionSummary(session);
  }

  applyHostState(sessionId, hostViewerSessionId, nextState, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, "Game session not found");
    }
    if (session.host_viewer_session_id !== String(hostViewerSessionId ?? "").trim()) {
      throw new HttpError(403, "Only the host can publish game state");
    }
    session.authoritative_state = cloneJson(nextState);
    if (options.started === true) {
      session.started = true;
    }
    session.updated_at = nowIso();
    return {
      session: this.toSessionSummary(session),
      state: cloneJson(session.authoritative_state),
    };
  }

  acceptPlayerAction(sessionId, viewerSessionId, action) {
    const session = this.getSession(sessionId);
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!session || !resolvedViewerSessionId) {
      throw new HttpError(404, "Game session not found");
    }
    const isHost = session.host_viewer_session_id === resolvedViewerSessionId;
    const seat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
    if (!isHost && !seat) {
      throw new HttpError(403, "Only the host or seated players can send actions");
    }
    session.updated_at = nowIso();
    return {
      session: this.toSessionSummary(session),
      action: cloneJson(action),
      actor: {
        viewer_session_id: resolvedViewerSessionId,
        seat_id: seat?.seat_id ?? null,
        is_host: isHost,
      },
    };
  }

  updatePreview(sessionId, hostViewerSessionId, preview = {}) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, "Game session not found");
    }
    if (session.host_viewer_session_id !== String(hostViewerSessionId ?? "").trim()) {
      throw new HttpError(403, "Only the host can publish game previews");
    }
    const dataUrl = String(preview.data_url ?? preview.dataUrl ?? "").trim();
    if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) {
      throw new HttpError(400, "Game previews must be PNG, JPEG, or WebP data URLs");
    }
    if (dataUrl.length > 450_000) {
      throw new HttpError(400, "Game preview is too large");
    }
    session.latest_preview = {
      data_url: dataUrl,
      width: clampInteger(preview.width, 480, 1, 4096),
      height: clampInteger(preview.height, 270, 1, 4096),
      updated_at: nowIso(),
    };
    session.updated_at = nowIso();
    return this.toSessionSummary(session);
  }

  stopSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    this.sessions.delete(session.id);
    const ids = this.bindingSessions.get(session.binding_key);
    ids?.delete(session.id);
    if (ids?.size === 0) {
      this.bindingSessions.delete(session.binding_key);
    }
    return this.toSessionSummary(session);
  }

  stopSessionTree(sessionId) {
    const queue = [String(sessionId ?? "").trim()].filter(Boolean);
    const stopped = [];
    while (queue.length > 0) {
      const nextId = queue.shift();
      const session = this.getSession(nextId);
      if (!session) {
        continue;
      }
      if (isOriginGameSession(session)) {
        for (const candidate of this.listSessionsForBinding(session.binding_key)) {
          if (!isMemberGameSession(candidate)) {
            continue;
          }
          if (getGameAnchorSessionId(candidate) === session.id) {
            queue.push(candidate.id);
          }
        }
      }
      const stoppedSession = this.stopSession(session.id);
      if (stoppedSession) {
        stopped.push(stoppedSession);
      }
    }
    return stopped;
  }

  removeViewerSession(viewerSessionId) {
    const resolvedViewerSessionId = String(viewerSessionId ?? "").trim();
    if (!resolvedViewerSessionId) {
      return {
        stopped: [],
        updated: [],
      };
    }
    const stopped = [];
    const updated = [];
    for (const session of [...this.sessions.values()]) {
      if (session.host_viewer_session_id === resolvedViewerSessionId) {
        stopped.push(...this.stopSessionTree(session.id));
        continue;
      }
      session.opened_viewer_session_ids.delete(resolvedViewerSessionId);
      const seat = findSeatByViewerSessionId(session, resolvedViewerSessionId);
      if (!seat) {
        continue;
      }
      seat.viewer_session_id = "";
      seat.display_name = "";
      seat.claimed_at = null;
      session.ready_by_viewer_session_id.delete(resolvedViewerSessionId);
      session.updated_at = nowIso();
      updated.push(this.toSessionSummary(session));
    }
    return {
      stopped,
      updated,
    };
  }
}
