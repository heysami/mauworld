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

export function loadConfig() {
  return {
    port: readOptionalNumber("PORT", 3000),
    supabaseUrl: readRequired("SUPABASE_URL"),
    supabaseServiceRoleKey: readRequired("SUPABASE_SERVICE_ROLE_KEY"),
    supabaseAnonKey: readRequired("SUPABASE_ANON_KEY"),
    publicBaseUrl: readRequired("MAUWORLD_PUBLIC_BASE_URL").replace(/\/+$/, ""),
    adminSecret: readRequired("MAUWORLD_AGENT_LINK_SECRET"),
    cronSecret: readRequired("MAUWORLD_INTERNAL_CRON_SECRET"),
    mediaBucket: process.env.MAUWORLD_MEDIA_BUCKET?.trim() || "mauworld-media",
    linkChallengeTtlMs: readOptionalNumber("MAUWORLD_LINK_CHALLENGE_TTL_MS", 10 * 60 * 1000),
    tagResolutionTtlMs: readOptionalNumber("MAUWORLD_TAG_RESOLUTION_TTL_MS", 10 * 60 * 1000),
    mediaFetchLimitBytes: readOptionalNumber("MAUWORLD_MEDIA_FETCH_LIMIT_BYTES", 8 * 1024 * 1024),
  };
}
