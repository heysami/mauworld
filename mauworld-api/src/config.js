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

function withPublicBaseHost(hosts = [], publicBaseHost = "") {
  const values = new Set(
    [...hosts, publicBaseHost]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  return [...values];
}

const DEFAULT_SHARED_BROWSER_ALLOWED_HOSTS = [
  "wikipedia.org",
  "www.wikipedia.org",
  "en.wikipedia.org",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
  "studio.youtube.com",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "fb.watch",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "linkedin.com",
  "www.linkedin.com",
  "threads.net",
  "www.threads.net",
  "snapchat.com",
  "www.snapchat.com",
  "story.snapchat.com",
  "pinterest.com",
  "www.pinterest.com",
  "discord.com",
  "www.discord.com",
  "tumblr.com",
  "www.tumblr.com",
  "whatsapp.com",
  "www.whatsapp.com",
  "web.whatsapp.com",
  "telegram.org",
  "web.telegram.org",
  "t.me",
  "messenger.com",
  "www.messenger.com",
  "twitch.tv",
  "www.twitch.tv",
  "clips.twitch.tv",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com",
  "bilibili.com",
  "www.bilibili.com",
  "weibo.com",
  "www.weibo.com",
  "netflix.com",
  "www.netflix.com",
  "hulu.com",
  "www.hulu.com",
  "disneyplus.com",
  "www.disneyplus.com",
  "primevideo.com",
  "www.primevideo.com",
  "max.com",
  "www.max.com",
  "hbomax.com",
  "www.hbomax.com",
  "peacocktv.com",
  "www.peacocktv.com",
  "paramountplus.com",
  "www.paramountplus.com",
  "crunchyroll.com",
  "www.crunchyroll.com",
  "rumble.com",
  "www.rumble.com",
];

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
    sharedBrowserAllowedHosts: readOptionalList(
      "MAUWORLD_SHARED_BROWSER_ALLOWED_HOSTS",
      withPublicBaseHost(DEFAULT_SHARED_BROWSER_ALLOWED_HOSTS, publicBaseHost),
    ),
    sharedBrowserViewportWidth: readOptionalNumber("MAUWORLD_SHARED_BROWSER_VIEWPORT_WIDTH", 960),
    sharedBrowserViewportHeight: readOptionalNumber("MAUWORLD_SHARED_BROWSER_VIEWPORT_HEIGHT", 540),
    sharedBrowserFrameRate: readOptionalNumber("MAUWORLD_SHARED_BROWSER_FRAME_RATE", 10),
    sharedBrowserJpegQuality: readOptionalNumber("MAUWORLD_SHARED_BROWSER_JPEG_QUALITY", 46),
    liveKitUrl: process.env.MAUWORLD_LIVEKIT_URL?.trim() || "",
    liveKitApiKey: process.env.MAUWORLD_LIVEKIT_API_KEY?.trim() || "",
    liveKitApiSecret: process.env.MAUWORLD_LIVEKIT_API_SECRET?.trim() || "",
    liveKitRoomPrefix: process.env.MAUWORLD_LIVEKIT_ROOM_PREFIX?.trim() || "mauworld-browser",
  };
}
