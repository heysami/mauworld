function readRequired(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalNumber(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readOptionalList(name, fallback = []) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const publicBaseUrl = readRequired("MAUWORLD_PUBLIC_BASE_URL").replace(/\/+$/, "");
  const publicBaseHost = (() => {
    try {
      return new URL(publicBaseUrl).hostname;
    } catch (_error) {
      return "";
    }
  })();
  return {
    port: readOptionalNumber("PORT", 3000),
    supabaseUrl: readRequired("SUPABASE_URL"),
    supabaseServiceRoleKey: readRequired("SUPABASE_SERVICE_ROLE_KEY"),
    supabaseAnonKey: readRequired("SUPABASE_ANON_KEY"),
    publicBaseUrl,
    adminSecret: readRequired("MAUWORLD_AGENT_LINK_SECRET"),
    cronSecret: readRequired("MAUWORLD_INTERNAL_CRON_SECRET"),
    onboardingSecret: process.env.MAUWORLD_ONBOARDING_SECRET?.trim() || "",
    mediaBucket: process.env.MAUWORLD_MEDIA_BUCKET?.trim() || "mauworld-media",
    linkChallengeTtlMs: readOptionalNumber("MAUWORLD_LINK_CHALLENGE_TTL_MS", 10 * 60 * 1000),
    tagResolutionTtlMs: readOptionalNumber("MAUWORLD_TAG_RESOLUTION_TTL_MS", 10 * 60 * 1000),
    mediaFetchLimitBytes: readOptionalNumber("MAUWORLD_MEDIA_FETCH_LIMIT_BYTES", 8 * 1024 * 1024),
    sharedBrowserAllowedHosts: readOptionalList("MAUWORLD_SHARED_BROWSER_ALLOWED_HOSTS", publicBaseHost ? [publicBaseHost] : []),
    sharedBrowserViewportWidth: readOptionalNumber("MAUWORLD_SHARED_BROWSER_VIEWPORT_WIDTH", 1280),
    sharedBrowserViewportHeight: readOptionalNumber("MAUWORLD_SHARED_BROWSER_VIEWPORT_HEIGHT", 720),
    sharedBrowserFrameRate: readOptionalNumber("MAUWORLD_SHARED_BROWSER_FRAME_RATE", 4),
    sharedBrowserJpegQuality: readOptionalNumber("MAUWORLD_SHARED_BROWSER_JPEG_QUALITY", 58),
    liveKitUrl: process.env.MAUWORLD_LIVEKIT_URL?.trim() || "",
    liveKitApiKey: process.env.MAUWORLD_LIVEKIT_API_KEY?.trim() || "",
    liveKitApiSecret: process.env.MAUWORLD_LIVEKIT_API_SECRET?.trim() || "",
    liveKitRoomPrefix: process.env.MAUWORLD_LIVEKIT_ROOM_PREFIX?.trim() || "mauworld-browser",
  };
}
