let htmlToImageModulePromise = null;
const textureCache = new Map();
let hiddenRenderHost = null;
const SCREEN_IF_BLOCK_RE = /{{#if\s+([a-zA-Z0-9_.-]+)}}([\s\S]*?){{\/if}}/g;
const SCREEN_EQ_BLOCK_RE = /{{#eq\s+([a-zA-Z0-9_.-]+)\s+("[^"]*"|'[^']*'|[^\s}]+)}}([\s\S]*?){{\/eq}}/g;
const SCREEN_VALUE_RE = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

function getHtmlToImageModule() {
  if (!htmlToImageModulePromise) {
    htmlToImageModulePromise = import("https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm");
  }
  return htmlToImageModulePromise;
}

function ensureRenderHost() {
  if (hiddenRenderHost) {
    return hiddenRenderHost;
  }
  hiddenRenderHost = document.createElement("div");
  hiddenRenderHost.setAttribute("aria-hidden", "true");
  hiddenRenderHost.style.position = "fixed";
  hiddenRenderHost.style.left = "-100000px";
  hiddenRenderHost.style.top = "0";
  hiddenRenderHost.style.width = "0";
  hiddenRenderHost.style.height = "0";
  hiddenRenderHost.style.overflow = "hidden";
  hiddenRenderHost.style.pointerEvents = "none";
  hiddenRenderHost.style.opacity = "0";
  document.body.append(hiddenRenderHost);
  return hiddenRenderHost;
}

function escapeScreenTemplateValue(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getScreenTemplateValue(path = "", context = {}) {
  const keys = String(path ?? "")
    .split(".")
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  if (!keys.length) {
    return "";
  }
  let cursor = context;
  for (const key of keys) {
    if (cursor == null || typeof cursor !== "object") {
      return "";
    }
    cursor = cursor[key];
  }
  return cursor ?? "";
}

function parseScreenTemplateLiteral(token = "") {
  const normalized = String(token ?? "").trim();
  if (!normalized) {
    return "";
  }
  if ((normalized.startsWith("\"") && normalized.endsWith("\"")) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1);
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  if (normalized === "null") {
    return null;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/i.test(normalized)) {
    return numeric;
  }
  return normalized;
}

function buildScreenTemplateContext(screen = {}) {
  const state = screen?.state && typeof screen.state === "object" && !Array.isArray(screen.state)
    ? screen.state
    : {};
  const assets = screen?.assets && typeof screen.assets === "object" && !Array.isArray(screen.assets)
    ? screen.assets
    : {};
  return {
    screen: {
      ...screen,
      state,
      assets,
    },
    state,
    assets,
    ...state,
  };
}

export function collectScreenTemplateBindings(source = "") {
  const bindings = new Set();
  const normalized = String(source ?? "");
  for (const pattern of [SCREEN_EQ_BLOCK_RE, SCREEN_IF_BLOCK_RE, SCREEN_VALUE_RE]) {
    pattern.lastIndex = 0;
  }
  for (const match of normalized.matchAll(SCREEN_EQ_BLOCK_RE)) {
    if (match?.[1]) {
      bindings.add(String(match[1]).trim());
    }
  }
  for (const match of normalized.matchAll(SCREEN_IF_BLOCK_RE)) {
    if (match?.[1]) {
      bindings.add(String(match[1]).trim());
    }
  }
  for (const match of normalized.matchAll(SCREEN_VALUE_RE)) {
    if (match?.[1]) {
      bindings.add(String(match[1]).trim());
    }
  }
  return [...bindings];
}

function resolveScreenTemplate(source = "", context = {}) {
  let resolved = String(source ?? "");
  let previous = "";
  while (resolved !== previous) {
    previous = resolved;
    resolved = resolved.replace(SCREEN_EQ_BLOCK_RE, (_match, path, expectedToken, body) => {
      const actual = getScreenTemplateValue(path, context);
      const expected = parseScreenTemplateLiteral(expectedToken);
      return actual === expected ? body : "";
    });
    resolved = resolved.replace(SCREEN_IF_BLOCK_RE, (_match, path, body) => (
      getScreenTemplateValue(path, context) ? body : ""
    ));
  }
  return resolved.replace(SCREEN_VALUE_RE, (_match, path) => {
    const value = getScreenTemplateValue(path, context);
    if (value == null) {
      return "";
    }
    if (typeof value === "object") {
      return escapeScreenTemplateValue(JSON.stringify(value));
    }
    return escapeScreenTemplateValue(value);
  });
}

export function resolveScreenHtmlSource(screen = {}) {
  return resolveScreenTemplate(String(screen?.html ?? ""), buildScreenTemplateContext(screen));
}

function extractRenderableHtml(source) {
  const raw = String(source ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    const styles = [...parsed.head.querySelectorAll("style")].map((node) => node.outerHTML).join("");
    const bodyHtml = parsed.body?.innerHTML?.trim() || raw;
    return `${styles}${bodyHtml}`;
  } catch {
    return raw;
  }
}

function buildCacheKey(screen = {}, options = {}) {
  const width = Number(options.width ?? 1024) || 1024;
  const height = Number(options.height ?? 576) || 576;
  return `${screen.id || "screen"}:${width}x${height}:${screen.material?.color || ""}:${resolveScreenHtmlSource(screen)}`;
}

function buildRenderNode(screen = {}, options = {}) {
  const width = Number(options.width ?? 1024) || 1024;
  const height = Number(options.height ?? 576) || 576;
  const root = document.createElement("div");
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.background = screen.material?.color || "#ffffff";
  root.style.color = "#14213d";
  root.style.overflow = "hidden";
  root.style.boxSizing = "border-box";
  root.style.fontFamily = "Manrope, Arial, sans-serif";
  root.style.display = "block";
  root.innerHTML = extractRenderableHtml(resolveScreenHtmlSource(screen));
  return root;
}

export async function renderScreenHtmlTexture(THREE, screen = {}, options = {}) {
  const html = String(screen.html ?? "").trim();
  if (!html) {
    return null;
  }
  const enableCache = options.cache !== false;
  const cacheKey = buildCacheKey(screen, options);
  if (enableCache) {
    const cached = textureCache.get(cacheKey);
    if (cached) {
      return cached instanceof Promise ? await cached : cached;
    }
  }

  const pending = (async () => {
    const { toCanvas } = await getHtmlToImageModule();
    const host = ensureRenderHost();
    const node = buildRenderNode(screen, options);
    host.append(node);
    try {
      const canvas = await toCanvas(node, {
        cacheBust: false,
        pixelRatio: 1,
        backgroundColor: null,
        canvasWidth: Number(options.width ?? 1024) || 1024,
        canvasHeight: Number(options.height ?? 576) || 576,
      });
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      if (enableCache) {
        textureCache.set(cacheKey, texture);
      } else {
        texture.userData.privateWorldOwnedPreviewTexture = true;
      }
      return texture;
    } finally {
      node.remove();
    }
  })();

  if (enableCache) {
    textureCache.set(cacheKey, pending);
  }
  return await pending;
}

export function clearScreenHtmlTextureCache() {
  for (const value of textureCache.values()) {
    if (value && !(value instanceof Promise)) {
      value.dispose?.();
    }
  }
  textureCache.clear();
}
