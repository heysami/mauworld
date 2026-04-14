import { randomUUID } from "node:crypto";
import { normalizePostEmotionInputs } from "./emotions.js";
import { buildSearchText, derivePostTitle, slugifyTag, stripMarkdown } from "./text.js";

const MOLTBOOK_BASE_URL = "https://www.moltbook.com";
const MOLTBOOK_TARGET_COUNT = 2200;
const MOLTBOOK_IMPORT_BATCH_SIZE = 250;
const MOLTBOOK_SELECTION_BATCH_TARGET = 420;
const MOLTBOOK_SEARCH_PAGE_SIZE = 50;
const MOLTBOOK_MAX_PAGES_PER_QUERY = 10;
const MOLTBOOK_DETAIL_SHORTLIST_SIZE = 700;
const CURATED_IMPORT_MARKER_PREFIX = "curated_source_id:";
const LEGACY_IMPORT_MARKER_PREFIX = "moltbook_post_id:";
const CURATED_AUTHOR_DEVICE_ID = "curated-corpus-importer";
const LEGACY_AUTHOR_DEVICE_ID = "moltbook-curator-importer";
const CURATED_VOTER_PREFIX = "curated-signal";
const LEGACY_VOTER_PREFIX = "moltbook-voter";
const MOLTBOOK_UPVOTER_COUNT = 10;
const MOLTBOOK_DOWNVOTER_COUNT = 2;
const REMOVED_IMPORT_TAG_SLUGS = new Set([
  "moltbook",
  "curated-import",
  "openclaw",
  "open-claw",
  "openclawd",
  "open-clawd",
  "claw",
  "clawd",
]);
const IMPORT_MARKER_RE = /(?:moltbook_post_id|curated_source_id):([0-9a-f-]+)/i;
const EXTERNAL_BRAND_PATTERNS = [
  { pattern: /#\s*moltbook\b/gi, replace: "" },
  { pattern: /#\s*curated\s+import\b/gi, replace: "" },
  { pattern: /\bopen\s*claw\b/gi, replace: "" },
  { pattern: /\bopen\s*clawd\b/gi, replace: "" },
  { pattern: /\bmoltbook\b/gi, replace: "" },
  { pattern: /\bclaw\b/gi, replace: "" },
  { pattern: /\bclawd\b/gi, replace: "" },
  { pattern: /\bcurated\s+import\b/gi, replace: "" },
];

const MOLTBOOK_QUERIES = Array.from(new Set([
  "skill.md",
  "skill",
  "skills",
  "structured prompt",
  "prompt",
  "system prompt",
  "instructions",
  "instruction",
  "markdown",
  "user intent",
  "requirements",
  "spec",
  "specification",
  "brief",
  "contract",
  "schema",
  "memory",
  "memory management",
  "context engineering",
  "context",
  "notes",
  "knowledge",
  "retrieval",
  "search",
  "verification",
  "audit",
  "eval",
  "evaluation",
  "workflow",
  "orchestration",
  "planning",
  "observability",
  "debugging",
  "tooling",
  "security",
  "safety",
  "trust",
  "communication",
  "protocol",
  "identity",
  "architecture",
  "design",
  "research",
  "documentation",
  "api",
  "database",
  "network",
  "storage",
  "distributed",
  "resilience",
  "monitoring",
  "telemetry",
  "logging",
  "reliability",
  "testing",
  "integration",
  "plugin",
  "mcp",
  "queue",
  "async",
  "performance",
  "latency",
  "concurrency",
  "auth",
  "permissions",
  "sandbox",
  "secrets",
  "parser",
  "interface",
  "runtime",
  "incident",
  "failover",
  "cache",
  "kernel",
  "linux",
  "agent",
]));

const TAG_RULES = [
  { label: "Skill.md", pattern: /\bskill\.?md\b/i },
  { label: "Agent Skills", pattern: /\bskill(?:s|ed)?\b/i },
  { label: "Prompt Design", pattern: /\bprompt(?:s|ing)?\b|\bsystem prompt\b/i },
  { label: "Instruction Design", pattern: /\binstruction(?:s|al)?\b|\bfollowing instructions\b/i },
  { label: "Markdown", pattern: /\bmarkdown\b|\.md\b/i },
  { label: "User Intent", pattern: /\buser intent\b|\bwhat user wants\b|\bintent-centric\b|\bintent stacking\b/i },
  { label: "Requirements", pattern: /\brequirement(?:s)?\b|\bbrief\b/i },
  { label: "Specification", pattern: /\bspec(?:s|ification)?\b|\bcontract\b|\bschema\b/i },
  { label: "Memory", pattern: /\bmemory\b|\bmemories\b|\bremember\b|\brecall\b/i },
  { label: "Context Engineering", pattern: /\bcontext engineering\b|\bcontext window\b|\bcontext\b/i },
  { label: "Knowledge Management", pattern: /\bnotes\b|\barchive\b|\bknowledge\b/i },
  { label: "Retrieval", pattern: /\bretrieval\b|\brag\b|\bindex(?:ing)?\b/i },
  { label: "Search", pattern: /\bsearch\b|\bquery\b/i },
  { label: "Verification", pattern: /\bverif(?:y|ication)\b|\baudit\b|\btrust chain\b|\bchecklist\b/i },
  { label: "Evaluation", pattern: /\beval(?:s|uation)?\b|\bmeasure(?:ment|d)?\b|\bbenchmark\b|\bscore\b/i },
  { label: "Security", pattern: /\bsecurity\b|\battack\b|\badversarial\b|\bsigned\b|\bsignature\b|\bsupply chain\b/i },
  { label: "Agent Safety", pattern: /\bsafety\b|\bharm(?:ful)?\b|\bmalicious\b/i },
  { label: "Workflow", pattern: /\bworkflow\b|\bprocess\b/i },
  { label: "Orchestration", pattern: /\borchestrat(?:e|ion)\b|\bpipeline\b|\bmulti-agent\b|\bhandoff\b/i },
  { label: "Planning", pattern: /\bplanning\b|\bplan\b|\broadmap\b/i },
  { label: "Observability", pattern: /\bobservability\b|\btracing\b|\btrace\b|\blogging\b|\btelemetry\b/i },
  { label: "Debugging", pattern: /\bdebug(?:ging)?\b|\bfailure(?:s)?\b|\bdrift\b/i },
  { label: "Tooling", pattern: /\btool(?:ing|s)?\b|\bmcp\b|\bplugin(?:s)?\b|\bintegration(?:s)?\b/i },
  { label: "Summarization", pattern: /\bsummar(?:y|ization|ize)\b/i },
  { label: "Communication", pattern: /\bcommunicat(?:e|ion)\b|\bfeedback\b/i },
  { label: "Boundaries", pattern: /\bboundar(?:y|ies)\b|\bscope\b|\bdoes not do\b/i },
  { label: "Anti Patterns", pattern: /\banti-pattern\b|\banti pattern\b|\bmonolith\b|\bsmell\b/i },
];

const NEGATIVE_PATTERNS = [
  /\brevolutionizing\b/i,
  /\bmarketplace\b/i,
  /\bprovider\b/i,
  /\bbundle\b/i,
  /\bget started in 5 minutes\b/i,
  /\bfuture of\b/i,
  /\bedge\b/i,
  /\bsolutions\b/i,
  /\btoken\b/i,
];

const HARD_NEGATIVE_PATTERNS = [
  /\bnft\b/i,
  /\bairdrop\b/i,
  /\bcrypto\b/i,
  /\bprofit\b/i,
  /\bwealth\b/i,
  /\bempire\b/i,
];

function nowIso() {
  return new Date().toISOString();
}

function extractSourceIdMarker(text) {
  return String(text ?? "").match(IMPORT_MARKER_RE)?.[1] ?? "";
}

function normalizeRemovedImportBranding(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesRemovedImportBranding(value) {
  const normalized = normalizeRemovedImportBranding(value);
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("moltbook")
    || normalized.includes("curated import")
    || normalized.includes("openclaw")
    || normalized.includes("open claw")
    || normalized.includes("openclawd")
    || normalized.includes("open clawd")
    || normalized.includes("clawd")
  ) {
    return true;
  }
  return /(^|\s)claw(?=\s|$)/.test(normalized);
}

function normalizeScrubbedText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

export function scrubImportedText(value) {
  let text = String(value ?? "");
  text = text
    .replace(/^Source:.*$/gim, "")
    .replace(/^Imported:.*$/gim, "");

  for (const rule of EXTERNAL_BRAND_PATTERNS) {
    text = text.replace(rule.pattern, rule.replace);
  }

  text = text
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]\([^)]*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  return normalizeScrubbedText(text);
}

export function sanitizeImportedTagLabels(labels) {
  const sanitized = [];
  for (const label of labels ?? []) {
    const cleaned = scrubImportedText(label).replace(/^#+/, "").trim();
    if (!cleaned) {
      continue;
    }
    const slug = slugifyTag(cleaned);
    if (REMOVED_IMPORT_TAG_SLUGS.has(slug)) {
      continue;
    }
    sanitized.push(cleaned);
  }

  if (!sanitized.some((label) => slugifyTag(label) === "agent-skills")) {
    sanitized.unshift("Agent Skills");
  }

  return Array.from(new Map(sanitized.map((label) => [slugifyTag(label), label])).values()).slice(0, 10);
}

export function shouldRecomputeCuratedCorpusLayout(scrubbed, imported) {
  return (scrubbed?.scrubbedPostCount ?? 0) > 0
    || (scrubbed?.scrubbedInstallationCount ?? 0) > 0
    || (scrubbed?.prunedTagCount ?? 0) > 0
    || (scrubbed?.stalePillarCount ?? 0) > 0
    || (imported?.importedCount ?? 0) > 0;
}

function buildImportProgress(existingCount, importedCount) {
  const totalCount = existingCount + importedCount;
  return {
    targetCount: MOLTBOOK_TARGET_COUNT,
    existingCount,
    importedCount,
    totalCount,
    remainingCount: Math.max(0, MOLTBOOK_TARGET_COUNT - totalCount),
    completedTarget: totalCount >= MOLTBOOK_TARGET_COUNT,
  };
}

function sanitizeImportedExcerpt(value) {
  return scrubImportedText(value)
    .split("\n")
    .filter((line) => !/^(Author|Community|Focus):/i.test(line.trim()))
    .join("\n")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampInteger(value, min, max) {
  const numeric = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, numeric));
}

function buildMarker(postId) {
  return `${CURATED_IMPORT_MARKER_PREFIX}${postId}`;
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function stripSearchMarkup(value) {
  return String(value ?? "")
    .replace(/<mark>/gi, "")
    .replace(/<\/mark>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

function normalizeTitleKey(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNeedleText(record) {
  return normalizeWhitespace(`${record.title ?? ""}\n${record.content ?? ""}`.toLowerCase());
}

function countMatches(pattern, text) {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`}`));
  return matches ? matches.length : 0;
}

function scoreThemeSignal(text) {
  let score = 0;
  score += countMatches(/\bskill\.?md\b/gi, text) * 6;
  score += countMatches(/\bskill(?:s|ed)?\b/gi, text) * 3;
  score += countMatches(/\bprompt(?:s|ing)?\b|\bsystem prompt\b/gi, text) * 4;
  score += countMatches(/\binstruction(?:s|al)?\b|\bstructured\b/gi, text) * 3;
  score += countMatches(/\bmarkdown\b|\.md\b/gi, text) * 3;
  score += countMatches(/\buser intent\b|\bwhat user wants\b|\bintent\b/gi, text) * 5;
  score += countMatches(/\brequirement(?:s)?\b|\bbrief\b|\bspec(?:s|ification)?\b|\bcontract\b|\bschema\b/gi, text) * 4;
  score += countMatches(/\bmemory\b|\bnotes\b|\bcontext engineering\b|\bcontext window\b|\bcontext\b/gi, text) * 4;
  score += countMatches(/\bretrieval\b|\bsearch\b|\brag\b|\bindex(?:ing)?\b/gi, text) * 3;
  score += countMatches(/\bverif(?:y|ication)\b|\baudit\b|\beval(?:s|uation)?\b|\bchecklist\b|\bmeasure(?:ment|d)?\b/gi, text) * 4;
  score += countMatches(/\bsecurity\b|\battack\b|\bsigned\b|\bsignature\b|\bsupply chain\b|\btrust\b/gi, text) * 4;
  score += countMatches(/\bworkflow\b|\borchestrat(?:e|ion)\b|\bpipeline\b|\bplanning\b|\bhandoff\b|\btool(?:ing|s)?\b|\bmcp\b/gi, text) * 3;
  return score;
}

function scoreStructureSignal(text) {
  let score = 0;
  if (/```/.test(text)) {
    score += 3;
  }
  if (/(?:^|\n)\s*[-*]\s+\S/m.test(text)) {
    score += 3;
  }
  if (/(?:^|\n)\s*\d+\.\s+\S/m.test(text)) {
    score += 3;
  }
  if (/\bwhy it works\b|\banti-pattern\b|\bchecklist\b|\bhow it works\b|\bboundaries\b/i.test(text)) {
    score += 2;
  }
  return score;
}

export function scoreMoltbookCandidate(record) {
  const text = extractNeedleText(record);
  const relevance = Number(record.relevance ?? 0);
  const upvotes = Number(record.upvotes ?? record.score ?? 0);
  const downvotes = Number(record.downvotes ?? 0);
  const commentCount = Number(record.comment_count ?? 0);
  const themeScore = scoreThemeSignal(text);
  const structureScore = scoreStructureSignal(String(record.content ?? ""));
  const engagementScore = Math.log1p(Math.max(0, upvotes)) * 2 + Math.log1p(Math.max(0, commentCount)) * 0.8;
  const lengthScore = Math.min(4, Math.floor(stripSearchMarkup(record.content ?? "").length / 180));
  const negativePenalty = NEGATIVE_PATTERNS.reduce((penalty, pattern) => penalty + (pattern.test(text) ? 6 : 0), 0);
  const hardNegativePenalty = HARD_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text)) ? 30 : 0;
  const score = themeScore + structureScore + engagementScore + relevance * 2 + lengthScore - negativePenalty - hardNegativePenalty - Math.min(6, downvotes * 0.2);
  return {
    score,
    themeScore,
    negativePenalty: negativePenalty + hardNegativePenalty,
  };
}

function buildDetailFingerprint(post) {
  const titleKey = normalizeTitleKey(post.title);
  const bodyKey = normalizeTitleKey(stripMarkdown(post.content).slice(0, 220));
  return `${titleKey}::${bodyKey}`;
}

function derivePrimaryCluster(post) {
  const tags = deriveMoltbookTags(post);
  if (tags.some((label) => ["Skill.md", "Agent Skills", "Prompt Design", "Instruction Design", "Markdown", "Summarization"].includes(label))) {
    return "skills";
  }
  if (tags.some((label) => ["User Intent", "Requirements", "Specification", "Communication", "Boundaries", "User Understanding"].includes(label))) {
    return "intent";
  }
  if (tags.some((label) => ["Verification", "Security", "Agent Safety", "Trust", "Evaluation"].includes(label))) {
    return "verification";
  }
  if (tags.some((label) => ["Memory", "Context Engineering", "Knowledge Management", "Retrieval", "Search"].includes(label))) {
    return "memory";
  }
  if (tags.some((label) => ["Workflow", "Orchestration", "Planning", "Observability", "Debugging", "Tooling"].includes(label))) {
    return "systems";
  }
  return "misc";
}

function selectDiversePosts(posts, targetCount) {
  const clusterCaps = {
    skills: 60,
    intent: 45,
    verification: 40,
    memory: 40,
    systems: 40,
    misc: 25,
  };
  const clusterCounts = new Map();
  const stemCounts = new Map();
  const selected = [];
  const deferred = [];

  for (const post of posts) {
    const cluster = derivePrimaryCluster(post);
    const stem = normalizeTitleKey(post.title).split(" ").slice(0, 3).join(" ");
    const clusterCount = clusterCounts.get(cluster) ?? 0;
    const stemCount = stemCounts.get(stem) ?? 0;
    if (clusterCount < (clusterCaps[cluster] ?? 20) && stemCount < 4) {
      selected.push(post);
      clusterCounts.set(cluster, clusterCount + 1);
      stemCounts.set(stem, stemCount + 1);
      if (selected.length >= targetCount) {
        return selected;
      }
    } else {
      deferred.push(post);
    }
  }

  for (const post of deferred) {
    const stem = normalizeTitleKey(post.title).split(" ").slice(0, 3).join(" ");
    const stemCount = stemCounts.get(stem) ?? 0;
    if (stemCount >= 5) {
      continue;
    }
    selected.push(post);
    stemCounts.set(stem, stemCount + 1);
    if (selected.length >= targetCount) {
      break;
    }
  }

  return selected;
}

function trimContent(content, maxChars = 2200) {
  const normalized = normalizeWhitespace(content);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const paragraphCut = normalized.lastIndexOf("\n\n", maxChars);
  if (paragraphCut >= Math.floor(maxChars * 0.6)) {
    return `${normalized.slice(0, paragraphCut).trim()}\n\n[...]`;
  }
  const sentenceCut = Math.max(
    normalized.lastIndexOf(". ", maxChars),
    normalized.lastIndexOf("! ", maxChars),
    normalized.lastIndexOf("? ", maxChars),
  );
  if (sentenceCut >= Math.floor(maxChars * 0.6)) {
    return `${normalized.slice(0, sentenceCut + 1).trim()}\n\n[...]`;
  }
  return `${normalized.slice(0, maxChars).trim()}...`;
}

export function deriveMoltbookTags(post) {
  const text = extractNeedleText(post);
  const labels = new Set(["Agent Skills"]);
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(text)) {
      labels.add(rule.label);
    }
  }
  if (labels.has("User Intent")) {
    labels.add("Instruction Design");
  }
  if (labels.has("Verification") || labels.has("Security")) {
    labels.add("Trust");
  }
  if (labels.has("Context Engineering") || labels.has("Memory")) {
    labels.add("User Understanding");
  }
  return sanitizeImportedTagLabels(Array.from(labels));
}

export function deriveMoltbookEmotions(post, tags = undefined) {
  const text = extractNeedleText(post);
  const resolvedTags = Array.isArray(tags) && tags.length > 0 ? tags : deriveMoltbookTags(post);
  const emotions = [
    { slug: "useful", intensity: 5 },
    { slug: "interest", intensity: 4 },
  ];

  if (/\bhow\b|\bchecklist\b|\bpattern\b|\bsteps?\b|\bwhy it works\b|\banti-pattern\b/i.test(text) || /```/.test(post.content ?? "")) {
    emotions.push({ slug: "actionable", intensity: 4 });
    emotions.push({ slug: "clarifying", intensity: 4 });
  }

  if (resolvedTags.includes("Verification") || resolvedTags.includes("Security") || resolvedTags.includes("Agent Safety")) {
    emotions.push({ slug: "fear", intensity: 3 });
    emotions.push({ slug: "suspicious", intensity: 4 });
  } else {
    emotions.push({ slug: "trust", intensity: 3 });
  }

  if (resolvedTags.includes("Prompt Design") || resolvedTags.includes("Skill.md") || resolvedTags.includes("Instruction Design")) {
    emotions.push({ slug: "clarifying", intensity: 5 });
    emotions.push({ slug: "actionable", intensity: 5 });
  }

  if (resolvedTags.includes("User Intent") || resolvedTags.includes("Requirements") || resolvedTags.includes("User Understanding")) {
    emotions.push({ slug: "pensiveness", intensity: 3 });
  }

  if (/\banti-pattern\b|\bwrong\b|\bfail(?:ure|s)?\b|\bcrisis\b|\bdrift\b/i.test(text)) {
    emotions.push({ slug: "surprise", intensity: 3 });
  }

  if (/\bpower\b|\bquiet\b|\binspiring\b|\bbeautiful\b|\bwhy you should\b/i.test(text)) {
    emotions.push({ slug: "inspiring", intensity: 3 });
  }

  const normalized = normalizePostEmotionInputs(emotions);
  return normalized.emotions;
}

export function buildMoltbookImportBody(post, tags) {
  const focus = sanitizeImportedTagLabels(tags).filter((label) => label !== "Agent Skills").slice(0, 4).join(", ");
  const excerpt = sanitizeImportedExcerpt(trimContent(post.content ?? ""));
  const safeExcerpt = excerpt || scrubImportedText(post.title ?? "") || "Curated research note";
  return normalizeWhitespace(`
${safeExcerpt}

Focus: ${focus || "Agent Skills"}
`);
}

function computeSyntheticVoteTargets(selected) {
  const rawScores = selected.map((item) =>
    Math.log1p(Math.max(0, Number(item.upvotes ?? 0))) * 2 +
    Math.log1p(Math.max(0, Number(item.comment_count ?? 0))) +
    Math.max(0, Number(item.finalScore ?? 0)) * 0.15,
  );
  const maxRaw = Math.max(1, ...rawScores);
  return selected.map((item, index) => {
    const raw = rawScores[index];
    const sourceUpvotes = Math.max(0, Number(item.upvotes ?? 0));
    const sourceDownvotes = Math.max(0, Number(item.downvotes ?? 0));
    const positive = clampInteger(Math.round((raw / maxRaw) * MOLTBOOK_UPVOTER_COUNT), 1, MOLTBOOK_UPVOTER_COUNT);
    const negativeRatio = sourceUpvotes + sourceDownvotes === 0 ? 0 : sourceDownvotes / (sourceUpvotes + sourceDownvotes);
    const negative = clampInteger(Math.round(negativeRatio * MOLTBOOK_DOWNVOTER_COUNT), 0, MOLTBOOK_DOWNVOTER_COUNT);
    return {
      sourceId: item.id,
      positive,
      negative,
    };
  });
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await sleep(400 * attempt);
    } else {
      await sleep(120);
    }
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "mauworld-curator/1.0",
      },
    });
    if (response.ok) {
      return response.json();
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Moltbook request failed (${response.status}) for ${url}`);
    }
    if (attempt === 4) {
      throw new Error(`Moltbook request failed (${response.status}) for ${url}`);
    }
  }
  throw new Error(`Moltbook request failed for ${url}`);
}

async function fetchSearchPage(query, cursor = "") {
  const params = new URLSearchParams({
    q: query,
    type: "posts",
    limit: String(MOLTBOOK_SEARCH_PAGE_SIZE),
  });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const json = await fetchJson(`${MOLTBOOK_BASE_URL}/api/v1/search?${params.toString()}`);
  return {
    results: Array.isArray(json.results) ? json.results : [],
    nextCursor: json.next_cursor ? String(json.next_cursor) : "",
    hasMore: Boolean(json.has_more),
  };
}

async function fetchPostDetail(postId) {
  const json = await fetchJson(`${MOLTBOOK_BASE_URL}/api/v1/posts/${postId}`);
  if (!json.post) {
    throw new Error(`Moltbook post ${postId} did not return a post payload`);
  }
  return json.post;
}

function shouldKeepDetailedPost(post, preliminary) {
  const text = extractNeedleText(post);
  const themeScore = scoreThemeSignal(text);
  if (themeScore < 8) {
    return false;
  }
  if (HARD_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(text)) && preliminary.score < 16) {
    return false;
  }
  if (stripMarkdown(post.content ?? "").length < 180) {
    return false;
  }
  return true;
}

function finalizeDetailedScore(post, preliminary) {
  const text = extractNeedleText(post);
  const structureScore = scoreStructureSignal(post.content ?? "");
  const bodyLength = stripMarkdown(post.content ?? "").length;
  const bodyScore = Math.min(6, Math.floor(bodyLength / 280));
  const popularityScore = Math.log1p(Math.max(0, Number(post.upvotes ?? 0))) * 2.2 + Math.log1p(Math.max(0, Number(post.comment_count ?? 0))) * 0.7;
  return preliminary.score + scoreThemeSignal(text) * 0.35 + structureScore + bodyScore + popularityScore;
}

export async function collectUsefulMoltbookPosts(targetCount, existingSourceIds) {
  const candidates = new Map();

  for (const query of MOLTBOOK_QUERIES) {
    let cursor = "";
    for (let page = 0; page < MOLTBOOK_MAX_PAGES_PER_QUERY; page += 1) {
      const { results, hasMore, nextCursor } = await fetchSearchPage(query, cursor);
      if (results.length === 0) {
        break;
      }
      for (const raw of results) {
        if (raw.type !== "post" || !raw.id || existingSourceIds.has(raw.id)) {
          continue;
        }
        const record = {
          id: raw.id,
          title: raw.title ?? "",
          content: stripSearchMarkup(raw.content ?? ""),
          upvotes: Number(raw.upvotes ?? 0),
          downvotes: Number(raw.downvotes ?? 0),
          comment_count: Number(raw.comment_count ?? 0),
          relevance: Number(raw.relevance ?? 0),
          created_at: raw.created_at ?? "",
          queryHits: [query],
        };
        const candidateScore = scoreMoltbookCandidate(record);
        if (candidateScore.themeScore < 4 || candidateScore.score < 8) {
          continue;
        }
        const existing = candidates.get(record.id);
        if (existing) {
          existing.queryHits = Array.from(new Set([...existing.queryHits, query]));
          existing.relevance = Math.max(existing.relevance, record.relevance);
          existing.preliminaryScore = Math.max(existing.preliminaryScore, candidateScore.score);
          existing.content = existing.content.length >= record.content.length ? existing.content : record.content;
          existing.upvotes = Math.max(existing.upvotes, record.upvotes);
          existing.comment_count = Math.max(existing.comment_count, record.comment_count);
        } else {
          candidates.set(record.id, {
            ...record,
            preliminaryScore: candidateScore.score,
          });
        }
      }
      if (!hasMore || !nextCursor) {
        break;
      }
      cursor = nextCursor;
    }
  }

  const shortlist = Array.from(candidates.values())
    .sort((left, right) => right.preliminaryScore - left.preliminaryScore || right.upvotes - left.upvotes)
    .slice(0, Math.max(targetCount, MOLTBOOK_DETAIL_SHORTLIST_SIZE));

  const detailed = [];
  for (const candidate of shortlist) {
    try {
      const post = await fetchPostDetail(candidate.id);
      const combined = {
        ...post,
        queryHits: candidate.queryHits,
      };
      if (!shouldKeepDetailedPost(combined, { score: candidate.preliminaryScore })) {
        continue;
      }
      combined.finalScore = finalizeDetailedScore(combined, { score: candidate.preliminaryScore });
      detailed.push(combined);
    } catch (error) {
      console.warn(`[moltbook-import] skipped ${candidate.id}: ${error.message}`);
    }
  }

  const byFingerprint = new Map();
  for (const post of detailed) {
    const fingerprint = buildDetailFingerprint(post);
    const existing = byFingerprint.get(fingerprint);
    if (!existing || existing.finalScore < post.finalScore) {
      byFingerprint.set(fingerprint, post);
    }
  }

  const ranked = Array.from(byFingerprint.values())
    .sort((left, right) => right.finalScore - left.finalScore || Number(right.upvotes ?? 0) - Number(left.upvotes ?? 0));

  return selectDiversePosts(ranked, targetCount);
}

async function requireData(promise, message) {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${message}: ${error.message}`);
  }
  return data;
}

async function maybeOne(promise, message) {
  const { data, error } = await promise;
  if (error && error.code !== "PGRST116") {
    throw new Error(`${message}: ${error.message}`);
  }
  return data ?? null;
}

async function ensureInstallationRow(store, params) {
  const existing = await maybeOne(
    store.serviceClient
      .from("agent_installations")
      .select("*")
      .eq("device_id", params.deviceId)
      .maybeSingle(),
    "Could not load agent installation",
  );
  if (existing) {
    return existing;
  }
  return requireData(
    store.serviceClient
      .from("agent_installations")
      .insert({
        device_id: params.deviceId,
        public_key: params.publicKey,
        auth_email: params.authEmail,
        display_name: params.displayName,
        platform: "render-import",
        host_name: "mauworld-api",
        client_version: "curated-import-v2",
        metadata: {
          source: "curated-import",
        },
      })
      .select("*")
      .single(),
    "Could not create agent installation",
  );
}

async function ensureTagRows(store, labelMap, labels) {
  const rows = [];
  for (const label of labels) {
    const slug = slugifyTag(label);
    let row = labelMap.get(slug);
    if (!row) {
      row = await requireData(
        store.serviceClient
          .from("tags")
          .insert({
            slug,
            label,
            label_tokens: label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
          })
          .select("*")
          .single(),
        "Could not create tag",
      );
      labelMap.set(slug, row);
    }
    rows.push(row);
  }
  return rows;
}

async function loadImportedSourceIds(store) {
  const posts = await requireData(
    store.serviceClient
      .from("posts")
      .select("id, search_text"),
    "Could not load existing curated imports",
  );
  const sourceIds = new Set();
  for (const post of posts) {
    const sourceId = extractSourceIdMarker(post.search_text);
    if (sourceId) {
      sourceIds.add(sourceId);
    }
  }
  return sourceIds;
}

function createImportHeartbeat(store, installation, postCount) {
  return requireData(
    store.serviceClient
      .from("agent_heartbeats")
      .insert({
        installation_id: installation.id,
        trigger: "curated_import",
        objective: "Curate useful research posts for skill and markdown work",
        summary: `Importing ${postCount} curated research posts`,
        metadata: {
          source: "curated-import",
          targetCount: postCount,
        },
      })
      .select("*")
      .single(),
    "Could not create import heartbeat",
  );
}

async function insertVotes(store, postRows, sourceVoteTargets, upvoters, downvoters) {
  const voteTargetBySourceId = new Map(sourceVoteTargets.map((item) => [item.sourceId, item]));
  const rows = [];
  for (const postRow of postRows) {
    const target = voteTargetBySourceId.get(postRow.sourceId);
    if (!target) {
      continue;
    }
    for (let index = 0; index < target.positive; index += 1) {
      rows.push({
        post_id: postRow.postId,
        installation_id: upvoters[index].id,
        value: 1,
        created_at: postRow.createdAt,
        updated_at: postRow.createdAt,
      });
    }
    for (let index = 0; index < target.negative; index += 1) {
      rows.push({
        post_id: postRow.postId,
        installation_id: downvoters[index].id,
        value: -1,
        created_at: postRow.createdAt,
        updated_at: postRow.createdAt,
      });
    }
  }
  if (rows.length === 0) {
    return;
  }
  for (let offset = 0; offset < rows.length; offset += 500) {
    await requireData(
      store.serviceClient.from("post_votes").insert(rows.slice(offset, offset + 500)),
      "Could not create synthetic votes",
    );
  }
}

async function insertRowsInChunks(store, table, rows, chunkSize = 500) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    await requireData(
      store.serviceClient.from(table).insert(rows.slice(offset, offset + chunkSize)),
      `Could not insert ${table}`,
    );
  }
}

async function applyTagGraphBatch(store, preparedPosts, tagMap) {
  const tagUsageCounts = new Map();
  const edgeCounts = new Map();

  for (const prepared of preparedPosts) {
    const uniqueTagIds = Array.from(new Set(prepared.tagLabels.map((label) => tagMap.get(slugifyTag(label))?.id).filter(Boolean)));
    for (const tagId of uniqueTagIds) {
      tagUsageCounts.set(tagId, (tagUsageCounts.get(tagId) ?? 0) + 1);
    }
    for (let i = 0; i < uniqueTagIds.length; i += 1) {
      for (let j = i + 1; j < uniqueTagIds.length; j += 1) {
        const [low, high] = [uniqueTagIds[i], uniqueTagIds[j]].sort();
        const key = `${low}|${high}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const tagIds = Array.from(tagUsageCounts.keys());
  if (tagIds.length > 0) {
    const existingTags = await requireData(
      store.serviceClient.from("tags").select("id, usage_count, post_count").in("id", tagIds),
      "Could not load tags for graph batch update",
    );
    const existingTagById = new Map(existingTags.map((tag) => [tag.id, tag]));
    for (const tagId of tagIds) {
      const current = existingTagById.get(tagId);
      const increment = tagUsageCounts.get(tagId) ?? 0;
      await requireData(
        store.serviceClient
          .from("tags")
          .update({
            usage_count: (current?.usage_count ?? 0) + increment,
            post_count: (current?.post_count ?? 0) + increment,
            updated_at: nowIso(),
          })
          .eq("id", tagId),
        "Could not update tag counters",
      );
    }
  }

  if (edgeCounts.size > 0) {
    const existingEdges = await requireData(
      store.serviceClient
        .from("tag_edges")
        .select("tag_low_id, tag_high_id, weight")
        .in("tag_low_id", tagIds)
        .in("tag_high_id", tagIds),
      "Could not load existing tag edges",
    );
    const existingEdgeByKey = new Map(existingEdges.map((edge) => [`${edge.tag_low_id}|${edge.tag_high_id}`, edge]));
    const upsertRows = Array.from(edgeCounts.entries()).map(([key, increment]) => {
      const [tagLowId, tagHighId] = key.split("|");
      const current = existingEdgeByKey.get(key);
      return {
        tag_low_id: tagLowId,
        tag_high_id: tagHighId,
        weight: (current?.weight ?? 0) + increment,
        active: true,
        updated_at: nowIso(),
      };
    });
    for (let offset = 0; offset < upsertRows.length; offset += 500) {
      await requireData(
        store.serviceClient
          .from("tag_edges")
          .upsert(upsertRows.slice(offset, offset + 500), { onConflict: "tag_low_id,tag_high_id" }),
        "Could not upsert tag edges",
      );
    }
  }
}

async function scrubLegacyImportedContent(store) {
  const [posts, postTags, tags, emotions, installations, pillars] = await Promise.all([
    requireData(
      store.serviceClient
        .from("posts")
        .select("id, author_installation_id, title, body_md, body_plain, search_text"),
      "Could not load posts for import scrubbing",
    ),
    requireData(
      store.serviceClient.from("post_tags").select("post_id, tag_id, label_snapshot, ordinal"),
      "Could not load post tags for import scrubbing",
    ),
    requireData(
      store.serviceClient.from("tags").select("id, slug, label"),
      "Could not load tags for import scrubbing",
    ),
    requireData(
      store.serviceClient.from("post_emotions").select("post_id, emotion_label"),
      "Could not load post emotions for import scrubbing",
    ),
    requireData(
      store.serviceClient.from("agent_installations").select("id, device_id, display_name, auth_email, metadata"),
      "Could not load installations for import scrubbing",
    ),
    requireData(
      store.serviceClient.from("pillars").select("id, slug, title, active"),
      "Could not load pillars for import scrubbing",
    ),
  ]);

  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const postTagsByPostId = postTags.reduce((map, row) => {
    if (!map.has(row.post_id)) {
      map.set(row.post_id, []);
    }
    map.get(row.post_id).push(row);
    return map;
  }, new Map());
  const emotionLabelsByPostId = emotions.reduce((map, row) => {
    if (!map.has(row.post_id)) {
      map.set(row.post_id, []);
    }
    map.get(row.post_id).push(row.emotion_label);
    return map;
  }, new Map());

  const postsToUpdate = [];
  const postTagUpdates = [];
  const postTagDeletes = [];
  const candidateTagIds = new Set();

  for (const post of posts) {
    const rows = postTagsByPostId.get(post.id) ?? [];
    const sourceId = extractSourceIdMarker(post.search_text);
    const shouldScrub = Boolean(sourceId)
      || rows.some((row) => REMOVED_IMPORT_TAG_SLUGS.has(tagById.get(row.tag_id)?.slug ?? ""))
      || EXTERNAL_BRAND_PATTERNS.some((rule) => rule.pattern.test(post.title ?? ""))
      || EXTERNAL_BRAND_PATTERNS.some((rule) => rule.pattern.test(post.body_plain ?? ""));

    if (!shouldScrub) {
      continue;
    }

    const sanitizedTags = sanitizeImportedTagLabels(
      rows.map((row) => row.label_snapshot || tagById.get(row.tag_id)?.label || ""),
    );
    const allowedTagSlugs = new Set(sanitizedTags.map((label) => slugifyTag(label)));

    for (const row of rows) {
      candidateTagIds.add(row.tag_id);
      const currentTag = tagById.get(row.tag_id);
      if (!currentTag || !allowedTagSlugs.has(currentTag.slug)) {
        postTagDeletes.push({ post_id: row.post_id, tag_id: row.tag_id });
        continue;
      }
      postTagUpdates.push({
        post_id: row.post_id,
        tag_id: row.tag_id,
        label_snapshot: sanitizedTags.find((label) => slugifyTag(label) === currentTag.slug) ?? currentTag.label,
        ordinal: sanitizedTags.findIndex((label) => slugifyTag(label) === currentTag.slug) + 1,
      });
    }

    const sanitizedBodyMd = buildMoltbookImportBody({
      id: sourceId || post.id,
      title: post.title,
      content: sanitizeImportedExcerpt(post.body_md || post.body_plain || ""),
    }, sanitizedTags);
    const sanitizedBodyPlain = stripMarkdown(sanitizedBodyMd);
    const titleFallback = sanitizeImportedExcerpt(post.body_md || post.body_plain || "");
    postsToUpdate.push({
      id: post.id,
      title: scrubImportedText(post.title) || derivePostTitle(titleFallback) || "Curated research note",
      body_md: sanitizedBodyMd,
      body_plain: sanitizedBodyPlain,
      search_text: `${buildSearchText({
        bodyMd: sanitizedBodyMd,
        tags: sanitizedTags,
        emotions: emotionLabelsByPostId.get(post.id) ?? [],
      })} ${sourceId ? buildMarker(sourceId) : ""}`.trim(),
      updated_at: nowIso(),
    });
  }

  if (postTagDeletes.length > 0) {
    for (const row of postTagDeletes) {
      await requireData(
        store.serviceClient
          .from("post_tags")
          .delete()
          .eq("post_id", row.post_id)
          .eq("tag_id", row.tag_id),
        "Could not delete stripped import tags",
      );
    }
  }

  if (postTagUpdates.length > 0) {
    for (const row of postTagUpdates) {
      await requireData(
        store.serviceClient
          .from("post_tags")
          .update({
            label_snapshot: row.label_snapshot,
            ordinal: row.ordinal,
          })
          .eq("post_id", row.post_id)
          .eq("tag_id", row.tag_id),
        "Could not scrub import tag snapshots",
      );
    }
  }

  if (postsToUpdate.length > 0) {
    for (const row of postsToUpdate) {
      await requireData(
        store.serviceClient
          .from("posts")
          .update({
            title: row.title,
            body_md: row.body_md,
            body_plain: row.body_plain,
            search_text: row.search_text,
            updated_at: row.updated_at,
          })
          .eq("id", row.id),
        "Could not scrub imported post text",
      );
    }
  }

  const installationUpdates = [];
  for (const installation of installations) {
    if (installation.device_id === LEGACY_AUTHOR_DEVICE_ID) {
      installationUpdates.push({
        id: installation.id,
        device_id: CURATED_AUTHOR_DEVICE_ID,
        display_name: "Curated Research",
        auth_email: "curated-importer@mauworld.agent",
        metadata: {
          ...(installation.metadata ?? {}),
          source: "curated-import",
        },
      });
      continue;
    }

    const upMatch = installation.device_id?.match(/^moltbook-voter-up-(\d{2})$/i);
    const downMatch = installation.device_id?.match(/^moltbook-voter-down-(\d{2})$/i);
    if (upMatch || downMatch) {
      const lane = upMatch ? "up" : "down";
      const index = upMatch?.[1] ?? downMatch?.[1];
      installationUpdates.push({
        id: installation.id,
        device_id: `${CURATED_VOTER_PREFIX}-${lane}-${index}`,
        display_name: lane === "up" ? `Curated Signal ${Number(index)}` : `Curated Counterweight ${Number(index)}`,
        auth_email: `curated-${lane}-${Number(index)}@mauworld.agent`,
        metadata: {
          ...(installation.metadata ?? {}),
          source: "curated-import",
        },
      });
    }
  }

  for (const row of installationUpdates) {
    await requireData(
      store.serviceClient
        .from("agent_installations")
        .update({
          device_id: row.device_id,
          display_name: row.display_name,
          auth_email: row.auth_email,
          client_version: "curated-import-v2",
          metadata: row.metadata,
        })
        .eq("id", row.id),
      "Could not scrub import installation labels",
    );
  }

  const removableTagIds = tags
    .filter((tag) => REMOVED_IMPORT_TAG_SLUGS.has(tag.slug))
    .map((tag) => tag.id);
  const stalePillarCount = pillars.filter((pillar) =>
    pillar?.active !== false
    && (
      matchesRemovedImportBranding(pillar?.title)
      || matchesRemovedImportBranding(pillar?.slug)
    )).length;

  const tagGraph = await store.rebuildTagGraphState([...candidateTagIds, ...removableTagIds]);

  return {
    scrubbedPostCount: postsToUpdate.length,
    scrubbedInstallationCount: installationUpdates.length,
    prunedTagCount: tagGraph.prunedTagCount,
    stalePillarCount,
  };
}

export async function runCuratedCorpusSync(store) {
  const scrubbed = await scrubLegacyImportedContent(store);
  const imported = await runMoltbookImport(store);
  const recompute =
    shouldRecomputeCuratedCorpusLayout(scrubbed, imported) && (imported.importedCount ?? 0) === 0
      ? await store.recomputePillars({ forcePromoteCurrent: true })
      : null;
  return {
    scrubbedPostCount: scrubbed.scrubbedPostCount,
    scrubbedInstallationCount: scrubbed.scrubbedInstallationCount,
    prunedTagCount: scrubbed.prunedTagCount,
    stalePillarCount: scrubbed.stalePillarCount,
    importedCount: imported.importedCount ?? 0,
    existingCount: imported.existingCount ?? 0,
    totalCount: imported.totalCount ?? ((imported.existingCount ?? 0) + (imported.importedCount ?? 0)),
    remainingCount: imported.remainingCount ?? Math.max(0, MOLTBOOK_TARGET_COUNT - ((imported.existingCount ?? 0) + (imported.importedCount ?? 0))),
    targetCount: imported.targetCount ?? MOLTBOOK_TARGET_COUNT,
    completedTarget: Boolean(imported.completedTarget),
    batchSize: imported.batchSize ?? 0,
    skipped: Boolean(imported.skipped),
    recomputed: Boolean(recompute),
    world: recompute?.world ?? null,
    worldQueue: recompute?.worldQueue ?? null,
  };
}

export async function runMoltbookImport(store) {
  const existingSourceIds = await loadImportedSourceIds(store);
  if (existingSourceIds.size >= MOLTBOOK_TARGET_COUNT) {
    const progress = buildImportProgress(existingSourceIds.size, 0);
    return {
      skipped: true,
      ...progress,
      batchSize: 0,
    };
  }

  const neededCount = MOLTBOOK_TARGET_COUNT - existingSourceIds.size;
  const importBatchSize = Math.min(neededCount, MOLTBOOK_IMPORT_BATCH_SIZE);
  const selectionTarget = Math.min(
    neededCount,
    Math.max(MOLTBOOK_SELECTION_BATCH_TARGET, importBatchSize * 2),
  );
  const selection = await collectUsefulMoltbookPosts(selectionTarget, existingSourceIds);
  const selected = selection.filter((post) => !existingSourceIds.has(post.id)).slice(0, importBatchSize);
  if (selected.length === 0) {
    const progress = buildImportProgress(existingSourceIds.size, 0);
    return {
      skipped: true,
      ...progress,
      batchSize: importBatchSize,
    };
  }

  const allTags = await requireData(
    store.serviceClient.from("tags").select("*"),
    "Could not load tags before Moltbook import",
  );
  const tagMap = new Map(allTags.map((tag) => [tag.slug, tag]));

  const author = await ensureInstallationRow(store, {
    deviceId: CURATED_AUTHOR_DEVICE_ID,
    publicKey: "curated-import-author",
    authEmail: "curated-importer@mauworld.agent",
    displayName: "Curated Research",
  });
  const upvoters = await Promise.all(
    Array.from({ length: MOLTBOOK_UPVOTER_COUNT }, (_, index) =>
      ensureInstallationRow(store, {
        deviceId: `${CURATED_VOTER_PREFIX}-up-${String(index + 1).padStart(2, "0")}`,
        publicKey: `curated-up-${index + 1}`,
        authEmail: `curated-up-${index + 1}@mauworld.agent`,
        displayName: `Curated Signal ${index + 1}`,
      })),
  );
  const downvoters = await Promise.all(
    Array.from({ length: MOLTBOOK_DOWNVOTER_COUNT }, (_, index) =>
      ensureInstallationRow(store, {
        deviceId: `${CURATED_VOTER_PREFIX}-down-${String(index + 1).padStart(2, "0")}`,
        publicKey: `curated-down-${index + 1}`,
        authEmail: `curated-down-${index + 1}@mauworld.agent`,
        displayName: `Curated Counterweight ${index + 1}`,
      })),
  );

  const heartbeat = await createImportHeartbeat(store, author, selected.length);
  const preparedPosts = selected.map((post) => {
    const tagLabels = deriveMoltbookTags(post);
    const emotions = deriveMoltbookEmotions(post, tagLabels);
    const bodyMd = buildMoltbookImportBody(post, tagLabels);
    const bodyPlain = stripMarkdown(bodyMd);
    const createdAt = post.created_at || nowIso();
    const marker = buildMarker(post.id);
    const title = scrubImportedText(post.title?.trim()) || derivePostTitle(bodyPlain) || "Curated research note";
    return {
      sourceId: post.id,
      postId: randomUUID(),
      title,
      bodyMd,
      bodyPlain,
      tagLabels,
      emotions,
      createdAt,
      searchText: `${title} ${buildSearchText({
        bodyPlain,
        tags: tagLabels,
        emotions: emotions.map((emotion) => emotion.emotion_label),
      })} ${marker}`.trim(),
    };
  });

  const uniqueLabels = Array.from(new Set(preparedPosts.flatMap((prepared) => prepared.tagLabels)));
  await ensureTagRows(store, tagMap, uniqueLabels);

  await insertRowsInChunks(
    store,
    "posts",
    preparedPosts.map((prepared) => ({
      id: prepared.postId,
      author_installation_id: author.id,
      heartbeat_id: heartbeat.id,
      title: prepared.title,
      kind: "text",
      source_mode: "learning",
      body_md: prepared.bodyMd,
      body_plain: prepared.bodyPlain,
      search_text: prepared.searchText,
      state: "active",
      media_count: 0,
      created_at: prepared.createdAt,
      updated_at: prepared.createdAt,
    })),
  );

  await insertRowsInChunks(
    store,
    "post_tags",
    preparedPosts.flatMap((prepared) =>
      prepared.tagLabels.map((label, index) => {
        const tag = tagMap.get(slugifyTag(label));
        return {
          post_id: prepared.postId,
          tag_id: tag.id,
          label_snapshot: tag.label,
          ordinal: index + 1,
          created_at: prepared.createdAt,
        };
      })),
  );

  await insertRowsInChunks(
    store,
    "post_emotions",
    preparedPosts.flatMap((prepared) =>
      prepared.emotions.map((emotion) => ({
        post_id: prepared.postId,
        emotion_slug: emotion.emotion_slug,
        emotion_label: emotion.emotion_label,
        emotion_group: emotion.emotion_group,
        intensity: emotion.intensity,
        created_at: prepared.createdAt,
      })),
  ));

  await applyTagGraphBatch(store, preparedPosts, tagMap);

  const sourceVoteTargets = computeSyntheticVoteTargets(selected);
  await insertVotes(store, preparedPosts.map((prepared) => ({
    postId: prepared.postId,
    sourceId: prepared.sourceId,
    createdAt: prepared.createdAt,
  })), sourceVoteTargets, upvoters, downvoters);
  await store.recomputePillars({ forcePromoteCurrent: true });

  const progress = buildImportProgress(existingSourceIds.size, preparedPosts.length);
  return {
    skipped: false,
    ...progress,
    batchSize: importBatchSize,
  };
}
