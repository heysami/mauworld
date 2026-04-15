const DEFAULT_WORLD_CELL_SIZE = 64;
const DEFAULT_CHAT_MAX_CHARS = 160;
const DEFAULT_CHAT_TTL_SECONDS = 8;
const DEFAULT_CHAT_DETAIL_RADIUS = 180;
const DEFAULT_BROWSER_RADIUS = 96;
const DEFAULT_INTERACTION_MAX_RECIPIENTS = 20;
const DEFAULT_VIEWER_NAME = "visitor";
const DEFAULT_VIEWER_NAME_MAX_CHARS = 40;

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

export function normalizeInteractionSettings(input = {}) {
  return {
    worldCellSize: clampInteger(input.world_cell_size, DEFAULT_WORLD_CELL_SIZE, 16, 1024),
    chatMaxChars: clampInteger(input.world_chat_max_chars, DEFAULT_CHAT_MAX_CHARS, 1, 500),
    chatTtlSeconds: clampInteger(input.world_chat_ttl_seconds, DEFAULT_CHAT_TTL_SECONDS, 1, 60),
    chatDetailRadius: clampInteger(input.world_chat_detail_radius, DEFAULT_CHAT_DETAIL_RADIUS, 16, 4096),
    browserRadius: clampInteger(input.world_browser_radius, DEFAULT_BROWSER_RADIUS, 16, 4096),
    interactionMaxRecipients: clampInteger(
      input.world_interaction_max_recipients,
      DEFAULT_INTERACTION_MAX_RECIPIENTS,
      1,
      200,
    ),
  };
}

export function sanitizeChatText(input, maxChars = DEFAULT_CHAT_MAX_CHARS) {
  const normalized = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, Math.max(1, maxChars));
}

export function isEmojiOnlyChatText(input) {
  const compact = String(input ?? "")
    .trim()
    .replace(/\s+/gu, "");
  if (!compact) {
    return false;
  }
  return /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+$/u.test(compact);
}

export function sanitizeViewerDisplayName(input, fallback = DEFAULT_VIEWER_NAME, maxChars = DEFAULT_VIEWER_NAME_MAX_CHARS) {
  const normalized = String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, maxChars));
  return normalized || String(fallback ?? "").trim() || DEFAULT_VIEWER_NAME;
}

export function getActorSessionId(entry = {}) {
  return String(entry.viewer_session_id ?? entry.viewerSessionId ?? entry.installation_id ?? entry.installationId ?? entry.id ?? "")
    .trim();
}

export function buildViewerPresencePayload(client) {
  const viewerSessionId = String(client?.viewerSessionId ?? "").trim();
  const fallbackDisplayName = viewerSessionId ? `visitor ${viewerSessionId.slice(-4)}` : DEFAULT_VIEWER_NAME;
  const displayName = sanitizeViewerDisplayName(
    client?.movementState?.displayName ?? client?.movementState?.display_name,
    fallbackDisplayName,
  );
  return {
    id: viewerSessionId,
    actor_type: "viewer",
    viewer_session_id: viewerSessionId,
    cell_x: Number(client?.cellX),
    cell_z: Number(client?.cellZ),
    position_x: Number(client?.position?.x ?? 0) || 0,
    position_y: Number(client?.position?.y ?? 0) || 0,
    position_z: Number(client?.position?.z ?? 0) || 0,
    heading_y: Number(client?.headingY ?? 0) || 0,
    movement_state: client?.movementState ?? {},
    actor: {
      id: viewerSessionId,
      display_name: displayName,
      platform: "viewer",
      host_name: null,
    },
    updated_at: new Date(client?.lastPresenceAt ?? Date.now()).toISOString(),
  };
}

export function getCellCoordinate(value, cellSize = DEFAULT_WORLD_CELL_SIZE) {
  const divisor = Math.max(1, Number(cellSize) || DEFAULT_WORLD_CELL_SIZE);
  return Math.floor((Number(value) || 0) / divisor);
}

export function getCellKey(cellX, cellZ) {
  return `${cellX}:${cellZ}`;
}

export function getPositionDistanceSquared(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = (Number(left.x) || 0) - (Number(right.x) || 0);
  const dy = (Number(left.y) || 0) - (Number(right.y) || 0);
  const dz = (Number(left.z) || 0) - (Number(right.z) || 0);
  return dx * dx + dy * dy + dz * dz;
}

export function selectNearestRecipients(input = {}) {
  const radius = Math.max(1, Number(input.radius) || 0);
  const maxRecipients = Math.max(1, Math.floor(Number(input.maxRecipients) || 1));
  const senderSessionId = String(input.senderSessionId ?? "").trim();
  const senderPosition = input.senderPosition ?? null;
  const candidateEntries = Array.isArray(input.candidates)
    ? input.candidates
    : Array.from(input.candidates ?? []);

  const ranked = candidateEntries
    .map((entry) => {
      const viewerSessionId = String(entry?.viewerSessionId ?? entry?.id ?? "").trim();
      return {
        viewerSessionId,
        entry,
        distanceSquared: getPositionDistanceSquared(senderPosition, entry?.position),
      };
    })
    .filter((entry) => entry.viewerSessionId && entry.viewerSessionId !== senderSessionId)
    .filter((entry) => Number.isFinite(entry.distanceSquared))
    .filter((entry) => entry.distanceSquared <= radius * radius)
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared
        || left.viewerSessionId.localeCompare(right.viewerSessionId),
    );

  return ranked.slice(0, maxRecipients).map((entry) => entry.viewerSessionId);
}

function pruneWindow(timestamps, now, windowMs) {
  while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
    timestamps.shift();
  }
}

export function checkChatRateLimit(state = {}, input = {}) {
  const now = Number(input?.now ?? input) || Date.now();
  const emojiOnly = isEmojiOnlyChatText(input?.text ?? "");
  const rapidWindow = state.rapidWindow ?? [];
  const textWindow = state.textWindow ?? [];
  const minuteWindow = state.minuteWindow ?? [];
  state.rapidWindow = rapidWindow;
  state.textWindow = textWindow;
  state.minuteWindow = minuteWindow;

  pruneWindow(rapidWindow, now, 500);
  pruneWindow(textWindow, now, 1000);
  pruneWindow(minuteWindow, now, 60000);

  if (rapidWindow.length >= 1) {
    return {
      allowed: false,
      reason: emojiOnly
        ? "Quick reactions are limited to one every 0.5 seconds."
        : "Chat is limited to one message every 0.5 seconds.",
    };
  }
  if (!emojiOnly && textWindow.length >= 1) {
    return {
      allowed: false,
      reason: "Text chat is limited to one message every 1 second.",
    };
  }
  if (minuteWindow.length >= 40) {
    return {
      allowed: false,
      reason: "Chat minute limit reached. Please slow down.",
    };
  }

  rapidWindow.push(now);
  if (!emojiOnly) {
    textWindow.push(now);
  }
  minuteWindow.push(now);
  return {
    allowed: true,
    state: {
      rapidWindow,
      textWindow,
      minuteWindow,
    },
  };
}
