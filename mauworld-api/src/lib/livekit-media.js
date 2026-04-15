function sanitizeRoomPart(value, fallback = "world") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function buildIdentity(viewerSessionId, canPublish) {
  const mode = canPublish ? "host" : "viewer";
  return `${mode}-${sanitizeRoomPart(viewerSessionId, "anon")}`;
}

export function isLiveKitConfigured(config = {}) {
  return Boolean(
    String(config.liveKitUrl ?? "").trim()
    && String(config.liveKitApiKey ?? "").trim()
    && String(config.liveKitApiSecret ?? "").trim(),
  );
}

export function buildBrowserRoomName(config = {}, worldSnapshotId = "") {
  const prefix = sanitizeRoomPart(config.liveKitRoomPrefix ?? "mauworld-browser", "mauworld-browser");
  return `${prefix}-${sanitizeRoomPart(worldSnapshotId, "current")}`;
}

async function loadLiveKitSdk() {
  return import("livekit-server-sdk");
}

export async function createBrowserMediaToken(config = {}, options = {}) {
  if (!isLiveKitConfigured(config)) {
    return {
      enabled: false,
      serverUrl: "",
      roomName: "",
      token: "",
      identity: "",
    };
  }

  const viewerSessionId = String(options.viewerSessionId ?? "").trim();
  const worldSnapshotId = String(options.worldSnapshotId ?? "").trim();
  if (!viewerSessionId || !worldSnapshotId) {
    throw new Error("viewerSessionId and worldSnapshotId are required for browser media.");
  }

  const canPublish = options.canPublish === true;
  const roomName = buildBrowserRoomName(config, worldSnapshotId);
  const identity = String(options.identity ?? "").trim() || buildIdentity(viewerSessionId, canPublish);
  const { AccessToken } = await loadLiveKitSdk();
  const token = new AccessToken(config.liveKitApiKey, config.liveKitApiSecret, {
    identity,
    name: identity,
    ttl: "15m",
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish,
  });

  return {
    enabled: true,
    serverUrl: config.liveKitUrl,
    roomName,
    identity,
    token: await token.toJwt(),
  };
}
