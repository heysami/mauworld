let htmlToImageModulePromise = null;
const textureCache = new Map();
let hiddenRenderHost = null;

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
  return `${screen.html_hash || screen.id || "screen"}:${width}x${height}:${String(screen.html ?? "").slice(0, 256)}`;
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
  root.innerHTML = extractRenderableHtml(screen.html);
  return root;
}

export async function renderScreenHtmlTexture(THREE, screen = {}, options = {}) {
  const html = String(screen.html ?? "").trim();
  if (!html) {
    return null;
  }
  const cacheKey = buildCacheKey(screen, options);
  const cached = textureCache.get(cacheKey);
  if (cached) {
    return cached instanceof Promise ? await cached : cached;
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
      textureCache.set(cacheKey, texture);
      return texture;
    } finally {
      node.remove();
    }
  })();

  textureCache.set(cacheKey, pending);
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
