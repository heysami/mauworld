import { getPositionDistanceSquared } from "./realtime-state.js";

export function getSessionId(session = {}) {
  return String(session.sessionId ?? session.id ?? "").trim();
}

export function getSessionRole(session = {}) {
  const value = String(session.groupRole ?? "").trim().toLowerCase();
  if (value === "member" || value === "persistent-voice" || value === "origin") {
    return value;
  }
  return "origin";
}

export function isOriginSession(session = {}) {
  return getSessionRole(session) === "origin";
}

export function isMemberSession(session = {}) {
  return getSessionRole(session) === "member";
}

export function isPersistentVoiceSession(session = {}) {
  return getSessionRole(session) === "persistent-voice";
}

export function isJoinedPersistentVoiceSession(session = {}) {
  return isPersistentVoiceSession(session) && session.groupJoined === true && Boolean(getAnchorSessionId(session));
}

export function isListedLiveSession(session = {}) {
  return isOriginSession(session) && session.listedLive !== false;
}

export function getAnchorSessionId(session = {}) {
  if (isOriginSession(session)) {
    return getSessionId(session);
  }
  return String(session.anchorSessionId ?? "").trim();
}

export function getAnchorHostSessionId(session = {}) {
  if (isOriginSession(session)) {
    return String(session.hostSessionId ?? "").trim();
  }
  return String(session.anchorHostSessionId ?? "").trim();
}

export function isWithinRadius(left, right, radius) {
  const resolvedRadius = Math.max(1, Number(radius) || 0);
  return getPositionDistanceSquared(left, right) <= resolvedRadius * resolvedRadius;
}

export function rankOriginSessionsForPosition(input = {}) {
  const requesterPosition = input.requesterPosition ?? null;
  const radius = Math.max(1, Number(input.radius) || 0);
  const resolveSessionPosition = typeof input.resolveSessionPosition === "function"
    ? input.resolveSessionPosition
    : () => null;
  const excludeHostSessionId = String(input.excludeHostSessionId ?? "").trim();
  const sessions = Array.isArray(input.sessions) ? input.sessions : Array.from(input.sessions ?? []);

  return sessions
    .filter((session) => isOriginSession(session))
    .filter((session) => !excludeHostSessionId || String(session.hostSessionId ?? "").trim() !== excludeHostSessionId)
    .map((session) => ({
      session,
      position: resolveSessionPosition(session),
      distanceSquared: getPositionDistanceSquared(requesterPosition, resolveSessionPosition(session)),
    }))
    .filter((entry) => Number.isFinite(entry.distanceSquared) && entry.distanceSquared <= radius * radius)
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared
        || getSessionId(left.session).localeCompare(getSessionId(right.session)),
    );
}

export function findNearestOriginSession(input = {}) {
  return rankOriginSessionsForPosition(input)[0]?.session ?? null;
}
