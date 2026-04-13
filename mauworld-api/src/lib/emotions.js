function normalizeEmotionSlug(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const POST_EMOTION_CATALOG = [
  { slug: "joy", label: "Joy", group: "plutchik_primary" },
  { slug: "trust", label: "Trust", group: "plutchik_primary" },
  { slug: "fear", label: "Fear", group: "plutchik_primary" },
  { slug: "surprise", label: "Surprise", group: "plutchik_primary" },
  { slug: "sadness", label: "Sadness", group: "plutchik_primary" },
  { slug: "disgust", label: "Disgust", group: "plutchik_primary" },
  { slug: "anger", label: "Anger", group: "plutchik_primary" },
  { slug: "anticipation", label: "Anticipation", group: "plutchik_primary" },
  { slug: "serenity", label: "Serenity", group: "plutchik_secondary" },
  { slug: "ecstasy", label: "Ecstasy", group: "plutchik_secondary" },
  { slug: "acceptance", label: "Acceptance", group: "plutchik_secondary" },
  { slug: "admiration", label: "Admiration", group: "plutchik_secondary" },
  { slug: "apprehension", label: "Apprehension", group: "plutchik_secondary" },
  { slug: "terror", label: "Terror", group: "plutchik_secondary" },
  { slug: "distraction", label: "Distraction", group: "plutchik_secondary" },
  { slug: "amazement", label: "Amazement", group: "plutchik_secondary" },
  { slug: "pensiveness", label: "Pensiveness", group: "plutchik_secondary" },
  { slug: "grief", label: "Grief", group: "plutchik_secondary" },
  { slug: "boredom", label: "Boredom", group: "plutchik_secondary" },
  { slug: "loathing", label: "Loathing", group: "plutchik_secondary" },
  { slug: "annoyance", label: "Annoyance", group: "plutchik_secondary" },
  { slug: "rage", label: "Rage", group: "plutchik_secondary" },
  { slug: "interest", label: "Interest", group: "plutchik_secondary" },
  { slug: "vigilance", label: "Vigilance", group: "plutchik_secondary" },
  { slug: "useful", label: "Useful", group: "functional" },
  { slug: "actionable", label: "Actionable", group: "functional" },
  { slug: "clarifying", label: "Clarifying", group: "functional" },
  { slug: "inspiring", label: "Inspiring", group: "functional" },
  { slug: "comforting", label: "Comforting", group: "functional" },
  { slug: "funny", label: "Funny", group: "functional" },
  { slug: "beautiful", label: "Beautiful", group: "functional" },
  { slug: "suspicious", label: "Suspicious", group: "functional" },
  { slug: "malicious", label: "Malicious", group: "functional" },
  { slug: "confusing", label: "Confusing", group: "functional" },
  { slug: "low_value", label: "Low Value", group: "functional" },
];

const EMOTION_BY_SLUG = new Map(POST_EMOTION_CATALOG.map((emotion) => [emotion.slug, emotion]));

const EMOTION_ALIASES = new Map([
  ["helpful", "useful"],
  ["practical", "actionable"],
  ["clear", "clarifying"],
  ["clarity", "clarifying"],
  ["uplifting", "inspiring"],
  ["warm", "comforting"],
  ["humorous", "funny"],
  ["humor", "funny"],
  ["pretty", "beautiful"],
  ["dangerous", "malicious"],
  ["harmful", "malicious"],
  ["sketchy", "suspicious"],
  ["confused", "confusing"],
  ["boring", "low_value"],
  ["lowvalue", "low_value"],
]);

function normalizeIntensity(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function extractEmotionInput(value) {
  if (typeof value === "string") {
    return {
      slug: value,
      intensity: null,
    };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      slug:
        value.slug ??
        value.emotion ??
        value.label ??
        value.name ??
        "",
      intensity: value.intensity ?? null,
    };
  }
  return {
    slug: "",
    intensity: null,
  };
}

export function normalizePostEmotionInputs(inputs) {
  const normalized = new Map();
  const invalid = [];

  for (const entry of Array.isArray(inputs) ? inputs : []) {
    const input = extractEmotionInput(entry);
    const slug = EMOTION_ALIASES.get(normalizeEmotionSlug(input.slug)) ?? normalizeEmotionSlug(input.slug);
    const emotion = EMOTION_BY_SLUG.get(slug);
    if (!emotion) {
      if (String(input.slug ?? "").trim()) {
        invalid.push(String(input.slug).trim());
      }
      continue;
    }
    normalized.set(emotion.slug, {
      emotion_slug: emotion.slug,
      emotion_label: emotion.label,
      emotion_group: emotion.group,
      intensity: normalizeIntensity(input.intensity),
    });
  }

  return {
    emotions: Array.from(normalized.values()),
    invalid,
  };
}

export function listAllowedPostEmotionSlugs() {
  return POST_EMOTION_CATALOG.map((emotion) => emotion.slug);
}
