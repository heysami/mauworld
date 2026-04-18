import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserMediaToken, isLiveKitConfigured } from "./livekit-media.js";

const LIVEKIT_CLIENT_UMD_PATH = fileURLToPath(
  new URL("../../node_modules/livekit-client/dist/livekit-client.umd.js", import.meta.url),
);
const PAGE_AUDIO_RELAY_PATH = fileURLToPath(new URL("./browser-page-audio-relay.js", import.meta.url));
const PLAYWRIGHT_CLI_PATH = fileURLToPath(new URL("../../node_modules/playwright/cli.js", import.meta.url));
const NAVIGATION_OPTIONS = {
  waitUntil: "commit",
  timeout: 30000,
};
const INTERACTION_CAPTURE_MIN_GAP_MS = 80;

function normalizeAllowedHosts(hosts = []) {
  const normalized = Array.from(hosts ?? [])
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return {
    allowAll: normalized.includes("*"),
    hosts: new Set(normalized.filter((value) => value !== "*")),
  };
}

function buildSessionId() {
  return `browser_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeSessionMode(rawMode) {
  return String(rawMode ?? "").trim() === "display-share" ? "display-share" : "remote-browser";
}

function normalizeGroupRole(rawRole, sessionMode = "remote-browser") {
  const value = String(rawRole ?? "").trim().toLowerCase();
  if (value === "member" || value === "persistent-voice" || value === "origin") {
    return value;
  }
  return sessionMode === "display-share" ? "origin" : "origin";
}

function normalizeSessionSlot(rawSlot, sessionMode = "remote-browser", groupRole = "origin") {
  const value = String(rawSlot ?? "").trim().toLowerCase();
  if (value) {
    return value;
  }
  if (groupRole === "persistent-voice") {
    return "persistent-voice";
  }
  return sessionMode === "display-share" ? "display-share" : "remote-browser";
}

function normalizeShareKind(rawKind, sessionMode = "remote-browser") {
  const value = String(rawKind ?? "").trim().toLowerCase();
  if (sessionMode === "display-share") {
    if (value === "camera" || value === "audio" || value === "screen") {
      return value;
    }
    return "screen";
  }
  return "browser";
}

function sanitizeSessionTitle(rawTitle, fallback = "Shared screen") {
  const cleaned = String(rawTitle ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

function getDefaultDisplayShareTitle(shareKind, displaySurface = "") {
  if (shareKind === "camera") {
    return "Live video";
  }
  if (shareKind === "audio") {
    return "Live voice";
  }
  if (displaySurface === "browser") {
    return "Shared tab";
  }
  if (displaySurface === "window") {
    return "Shared window";
  }
  return "Shared screen";
}

function normalizeAspectRatio(rawAspectRatio, fallback) {
  const value = Number(rawAspectRatio);
  if (Number.isFinite(value) && value >= 0.3 && value <= 6) {
    return value;
  }
  return fallback;
}

function normalizeTargetUrl(rawUrl, allowedHosts) {
  const fallback = "https://mauworld.onrender.com/social/world.html";
  const next = String(rawUrl ?? "").trim() || fallback;
  const url = new URL(next);
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error("Shared browser only supports http and https URLs.");
  }
  if (!allowedHosts.allowAll && allowedHosts.hosts.size > 0 && !allowedHosts.hosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Shared browser is restricted to the allowlist. Host "${url.hostname}" is not allowed.`);
  }
  return url.toString();
}

async function loadPlaywrightModule() {
  try {
    return await import("playwright");
  } catch (error) {
    const wrapped = new Error(
      "Shared browser support requires the optional playwright dependency. Install it in mauworld-api to enable remote browsing.",
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function isMissingExecutableError(error) {
  return /Executable doesn't exist/i.test(String(error?.message ?? ""));
}

function installLocalPlaywrightBrowser() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PLAYWRIGHT_CLI_PATH, "install", "chromium", "--only-shell"],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: "0",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || `Playwright install exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

function applySessionGroupMetadata(session, input = {}) {
  const sessionMode = normalizeSessionMode(input.mode ?? session.sessionMode);
  const groupRole = normalizeGroupRole(input.groupRole ?? session.groupRole, sessionMode);
  const sessionSlot = normalizeSessionSlot(input.sessionSlot ?? session.sessionSlot, sessionMode, groupRole);
  const listedLive = input.listedLive == null ? groupRole === "origin" : input.listedLive === true;
  const movementLocked = input.movementLocked == null ? groupRole === "origin" : input.movementLocked === true;
  const groupJoined = input.groupJoined === true;
  const anchorSessionId = String(
    input.anchorSessionId
    ?? (groupRole === "origin" ? session.id : session.anchorSessionId ?? ""),
  ).trim();
  const anchorHostSessionId = String(
    input.anchorHostSessionId
    ?? (groupRole === "origin" ? session.hostSessionId : session.anchorHostSessionId ?? ""),
  ).trim();

  session.sessionMode = sessionMode;
  session.groupRole = groupRole;
  session.sessionSlot = sessionSlot;
  session.listedLive = listedLive;
  session.movementLocked = movementLocked;
  session.groupJoined = groupJoined;
  session.anchorSessionId = groupRole === "origin" ? session.id : anchorSessionId;
  session.anchorHostSessionId = groupRole === "origin" ? session.hostSessionId : anchorHostSessionId;
}

export class BrowserSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.allowedHosts = normalizeAllowedHosts(options.allowedHosts);
    this.viewport = {
      width: Math.max(320, Math.floor(Number(options.viewport?.width) || 1280)),
      height: Math.max(180, Math.floor(Number(options.viewport?.height) || 720)),
    };
    this.frameIntervalMs = Math.max(100, Math.floor(1000 / Math.max(1, Number(options.frameRate) || 4)));
    this.jpegQuality = Math.max(20, Math.min(90, Math.floor(Number(options.jpegQuality) || 58)));
    this.liveKitConfig = options.liveKitConfig ?? {};
    this.liveKitEnabled = isLiveKitConfigured(this.liveKitConfig);
    this.defaultFrameTransport = this.liveKitEnabled ? "livekit-canvas" : "jpeg-sequence";
    this.sessions = new Map();
    this.browserByKind = new Map();
    this.browserInstallPromise = null;
  }

  listSessionsForWorld(worldSnapshotId) {
    return [...this.sessions.values()].filter((session) => session.worldSnapshotId === worldSnapshotId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessionsForHost(hostSessionId, options = {}) {
    const normalizedHostSessionId = String(hostSessionId ?? "").trim();
    if (!normalizedHostSessionId) {
      return [];
    }
    const sessionSlot = String(options.sessionSlot ?? "").trim().toLowerCase();
    return [...this.sessions.values()].filter((session) =>
      session.hostSessionId === normalizedHostSessionId
      && (!sessionSlot || String(session.sessionSlot ?? "").trim().toLowerCase() === sessionSlot));
  }

  getSessionByHost(hostSessionId, options = {}) {
    return this.listSessionsForHost(hostSessionId, options)[0] ?? null;
  }

  async ensureBrowser(kind = "chromium") {
    if (this.browserByKind.has(kind)) {
      return this.browserByKind.get(kind);
    }
    const playwright = await loadPlaywrightModule();
    const launcher = playwright[kind];
    if (!launcher) {
      throw new Error(`Playwright browser kind "${kind}" is not available.`);
    }
    const launchOptions = {
      headless: true,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
      ],
    };
    let browser;
    try {
      browser = await launcher.launch(launchOptions);
    } catch (error) {
      if (!isMissingExecutableError(error)) {
        throw error;
      }
      if (!this.browserInstallPromise) {
        this.browserInstallPromise = installLocalPlaywrightBrowser().finally(() => {
          this.browserInstallPromise = null;
        });
      }
      await this.browserInstallPromise;
      browser = await launcher.launch(launchOptions);
    }
    this.browserByKind.set(kind, browser);
    return browser;
  }

  toClientSession(session) {
    const aspectRatio = normalizeAspectRatio(session.aspectRatio, this.viewport.width / Math.max(1, this.viewport.height));
    return {
      sessionId: session.id,
      hostSessionId: session.hostSessionId,
      worldSnapshotId: session.worldSnapshotId,
      title: session.title,
      url: session.url,
      status: session.status,
      startedAt: session.startedAt,
      viewport: { ...this.viewport },
      aspectRatio,
      frameTransport: session.frameTransport || this.defaultFrameTransport,
      sessionMode: session.sessionMode || "remote-browser",
      shareKind: session.shareKind || (session.sessionMode === "display-share" ? "screen" : "browser"),
      hasVideo: session.hasVideo !== false,
      hasAudio: session.hasAudio === true,
      viewerCount: Math.max(0, Number(session.viewerCount) || 0),
      maxViewers: Math.max(0, Number(session.maxViewers) || 0),
      sessionSlot: session.sessionSlot || normalizeSessionSlot("", session.sessionMode, session.groupRole),
      groupRole: normalizeGroupRole(session.groupRole, session.sessionMode),
      listedLive: session.listedLive !== false,
      movementLocked: session.movementLocked === true,
      groupJoined: session.groupJoined === true,
      anchorSessionId: String(session.anchorSessionId ?? "").trim(),
      anchorHostSessionId: String(session.anchorHostSessionId ?? "").trim(),
    };
  }

  async enablePageAudioRelay(session) {
    if (!this.liveKitEnabled || !session.page) {
      return false;
    }
    try {
      const tokenPayload = await createBrowserMediaToken(this.liveKitConfig, {
        viewerSessionId: session.id,
        worldSnapshotId: session.worldSnapshotId,
        canPublish: true,
        identity: `browser-audio-worker-${session.id}`,
      });
      if (!tokenPayload.enabled) {
        return false;
      }

      await session.page.addScriptTag({ path: LIVEKIT_CLIENT_UMD_PATH }).catch(() => null);
      await session.page.addScriptTag({ path: PAGE_AUDIO_RELAY_PATH }).catch(() => null);
      const relayState = await session.page.evaluate(async (payload) => {
        if (!window.MauworldBrowserAudioRelay?.start) {
          return { ok: false, error: "Browser audio relay script was not installed." };
        }
        return window.MauworldBrowserAudioRelay.start(payload);
      }, {
        sessionId: session.id,
        serverUrl: tokenPayload.serverUrl,
        token: tokenPayload.token,
      });
      if (!relayState?.ok) {
        throw new Error(relayState?.error || "Shared browser audio relay failed.");
      }
      session.audioRelayReady = true;
      session.hasAudio = true;
      session.frameTransport = this.defaultFrameTransport;
      this.emit("session", this.toClientSession(session));
      return true;
    } catch (error) {
      session.audioRelayReady = false;
      session.hasAudio = false;
      this.emit("error", {
        sessionId: session.id,
        hostSessionId: session.hostSessionId,
        message: error.message,
      });
      return false;
    }
  }

  bindSessionPageEvents(session) {
    const page = session.page;
    page.on("close", () => {
      void this.stopSession(session.id, { silentClose: true });
    });
    page.on("pageerror", (error) => {
      this.emit("error", {
        sessionId: session.id,
        hostSessionId: session.hostSessionId,
        message: error.message,
      });
    });
    page.on("framenavigated", async (frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }
      session.url = page.url();
      session.title = await page.title().catch(() => session.title);
      session.audioRelayReady = false;
      this.emit("session", this.toClientSession(session));
      void this.enablePageAudioRelay(session);
    });
  }

  async startSession(input = {}) {
    const hostSessionId = String(input.hostSessionId ?? "").trim();
    const worldSnapshotId = String(input.worldSnapshotId ?? "").trim();
    if (!hostSessionId || !worldSnapshotId) {
      throw new Error("Shared browser sessions require a hostSessionId and worldSnapshotId.");
    }

    const sessionMode = normalizeSessionMode(input.mode);
    const shareKind = normalizeShareKind(input.shareKind, sessionMode);
    const groupRole = normalizeGroupRole(input.groupRole, sessionMode);
    const sessionSlot = normalizeSessionSlot(input.sessionSlot, sessionMode, groupRole);
    const existing = this.getSessionByHost(hostSessionId, { sessionSlot });
    if (existing && existing.sessionMode !== sessionMode) {
      await this.stopSession(existing.id);
    }

    if (sessionMode === "display-share") {
      if (!this.liveKitEnabled) {
        throw new Error("Native tab sharing requires LiveKit to be configured.");
      }
      const aspectRatio = normalizeAspectRatio(input.aspectRatio, this.viewport.width / Math.max(1, this.viewport.height));
      const displaySurface = String(input.displaySurface ?? "").trim().toLowerCase();
      const defaultTitle = getDefaultDisplayShareTitle(shareKind, displaySurface);
      const hasVideo = input.hasVideo !== false && shareKind !== "audio";
      const hasAudio = input.hasAudio === true;
      if (existing && existing.sessionMode === "display-share") {
        existing.url = "";
        existing.title = sanitizeSessionTitle(input.title, defaultTitle);
        existing.status = "ready";
        existing.frameTransport = "livekit-display";
        existing.aspectRatio = aspectRatio;
        existing.shareKind = shareKind;
        existing.hasVideo = hasVideo;
        existing.hasAudio = hasAudio;
        applySessionGroupMetadata(existing, {
          ...input,
          mode: sessionMode,
          groupRole,
          sessionSlot,
        });
        this.emit("session", this.toClientSession(existing));
        return this.toClientSession(existing);
      }

      const session = {
        id: buildSessionId(),
        hostSessionId,
        worldSnapshotId,
        context: null,
        page: null,
        url: "",
        title: sanitizeSessionTitle(input.title, defaultTitle),
        status: "ready",
        startedAt: new Date().toISOString(),
        frameTimer: null,
        frameCounter: 0,
        lastFrameDataUrl: "",
        lastFrameAt: 0,
        captureInFlight: false,
        captureAfterInputTimer: null,
        frameTransport: "livekit-display",
        audioRelayReady: true,
        sessionMode: "display-share",
        aspectRatio,
        shareKind,
        hasVideo,
        hasAudio,
        sessionSlot,
        groupRole,
        listedLive: groupRole === "origin",
        movementLocked: groupRole === "origin",
        groupJoined: input.groupJoined === true,
        anchorSessionId: "",
        anchorHostSessionId: "",
      };
      applySessionGroupMetadata(session, {
        ...input,
        mode: sessionMode,
        groupRole,
        sessionSlot,
      });
      this.sessions.set(session.id, session);
      this.emit("session", this.toClientSession(session));
      return this.toClientSession(session);
    }

    const targetUrl = normalizeTargetUrl(input.url, this.allowedHosts);
    if (existing) {
      existing.sessionMode = "remote-browser";
      existing.aspectRatio = this.viewport.width / Math.max(1, this.viewport.height);
      existing.shareKind = "browser";
      existing.hasVideo = true;
      existing.hasAudio = Boolean(existing.audioRelayReady);
      applySessionGroupMetadata(existing, {
        ...input,
        mode: sessionMode,
        groupRole,
        sessionSlot,
      });
      await existing.page.goto(targetUrl, NAVIGATION_OPTIONS);
      existing.url = existing.page.url();
      existing.title = await existing.page.title().catch(() => existing.title);
      existing.status = "ready";
      await this.enablePageAudioRelay(existing);
      this.emit("session", this.toClientSession(existing));
      return this.toClientSession(existing);
    }

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { ...this.viewport },
      screen: { ...this.viewport },
      ignoreHTTPSErrors: true,
      bypassCSP: this.liveKitEnabled,
    });
    const page = await context.newPage();
    const session = {
      id: buildSessionId(),
      hostSessionId,
      worldSnapshotId,
      context,
      page,
      url: targetUrl,
      title: targetUrl,
      status: "starting",
      startedAt: new Date().toISOString(),
      frameTimer: null,
      frameCounter: 0,
      lastFrameDataUrl: "",
      lastFrameAt: 0,
      captureInFlight: false,
      captureAfterInputTimer: null,
      frameTransport: this.defaultFrameTransport,
      audioRelayReady: false,
      sessionMode: "remote-browser",
      aspectRatio: this.viewport.width / Math.max(1, this.viewport.height),
      shareKind: "browser",
      hasVideo: true,
      hasAudio: false,
      sessionSlot,
      groupRole,
      listedLive: groupRole === "origin",
      movementLocked: groupRole === "origin",
      groupJoined: input.groupJoined === true,
      anchorSessionId: "",
      anchorHostSessionId: "",
    };
    applySessionGroupMetadata(session, {
      ...input,
      mode: sessionMode,
      groupRole,
      sessionSlot,
    });
    this.sessions.set(session.id, session);
    this.bindSessionPageEvents(session);

    try {
      await page.goto(targetUrl, NAVIGATION_OPTIONS);
      session.url = page.url();
      session.title = await page.title().catch(() => session.title);
      session.status = "ready";
      await this.enablePageAudioRelay(session);
      this.emit("session", this.toClientSession(session));
      this.startFramePump(session);
      return this.toClientSession(session);
    } catch (error) {
      this.sessions.delete(session.id);
      await context.close().catch(() => null);
      throw error;
    }
  }

  startFramePump(session) {
    if (session.frameTimer) {
      clearInterval(session.frameTimer);
    }
    void this.captureSessionFrame(session, { force: true });
    session.frameTimer = setInterval(() => {
      void this.captureSessionFrame(session, { force: true });
    }, this.frameIntervalMs);
  }

  async captureSessionFrame(session, options = {}) {
    if (session.captureInFlight || !this.sessions.has(session.id) || !session.page) {
      return false;
    }
    const now = Date.now();
    if (!options.force && now - session.lastFrameAt < INTERACTION_CAPTURE_MIN_GAP_MS) {
      return false;
    }
    session.captureInFlight = true;
    try {
      const buffer = await session.page.screenshot({
        type: "jpeg",
        quality: this.jpegQuality,
        caret: "hide",
        scale: "device",
      });
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      session.frameCounter += 1;
      session.lastFrameDataUrl = dataUrl;
      session.lastFrameAt = Date.now();
      this.emit("frame", {
        sessionId: session.id,
        hostSessionId: session.hostSessionId,
        worldSnapshotId: session.worldSnapshotId,
        frameId: session.frameCounter,
        dataUrl,
        width: this.viewport.width,
        height: this.viewport.height,
        title: session.title,
        url: session.url,
      });
      return true;
    } catch (error) {
      this.emit("error", {
        sessionId: session.id,
        hostSessionId: session.hostSessionId,
        message: error.message,
      });
      return false;
    } finally {
      session.captureInFlight = false;
    }
  }

  queueInteractionCapture(session) {
    if (!session || !this.sessions.has(session.id)) {
      return;
    }
    if (session.captureAfterInputTimer) {
      return;
    }
    const elapsedMs = Date.now() - (session.lastFrameAt || 0);
    const delayMs = session.captureInFlight ? 32 : Math.max(0, INTERACTION_CAPTURE_MIN_GAP_MS - elapsedMs);
    session.captureAfterInputTimer = setTimeout(() => {
      session.captureAfterInputTimer = null;
      void this.captureSessionFrame(session);
    }, delayMs);
  }

  async handleInput(sessionId, input = {}) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Shared browser session not found.");
    }
    const kind = String(input.kind ?? "").trim();
    if (!kind) {
      return this.toClientSession(session);
    }
    if (session.sessionMode === "display-share") {
      throw new Error("Shared tabs and windows are controlled directly in the shared app.");
    }
    await session.page.bringToFront().catch(() => null);

    if (kind === "navigate") {
      const targetUrl = normalizeTargetUrl(input.url, this.allowedHosts);
      await session.page.goto(targetUrl, NAVIGATION_OPTIONS);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "back") {
      await session.page.goBack(NAVIGATION_OPTIONS).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "forward") {
      await session.page.goForward(NAVIGATION_OPTIONS).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "reload") {
      await session.page.reload(NAVIGATION_OPTIONS).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "pointer") {
      const x = Math.max(0, Math.min(this.viewport.width, Number(input.x) || 0));
      const y = Math.max(0, Math.min(this.viewport.height, Number(input.y) || 0));
      const action = String(input.action ?? "move");
      const button = String(input.button ?? "left");
      await session.page.mouse.move(x, y);
      if (action === "down") {
        await session.page.mouse.down({ button });
      } else if (action === "up") {
        await session.page.mouse.up({ button });
      } else if (action === "click") {
        await session.page.mouse.click(x, y, { button, clickCount: Math.max(1, Math.floor(Number(input.clickCount) || 1)) });
      }
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "wheel") {
      await session.page.mouse.wheel(Number(input.deltaX) || 0, Number(input.deltaY) || 0);
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    if (kind === "key") {
      const action = String(input.action ?? "press");
      const value = String(input.value ?? "");
      if (!value) {
        return this.toClientSession(session);
      }
      if (action === "type") {
        await session.page.keyboard.type(value);
      } else if (action === "down") {
        await session.page.keyboard.down(value);
      } else if (action === "up") {
        await session.page.keyboard.up(value);
      } else {
        await session.page.keyboard.press(value);
      }
      this.queueInteractionCapture(session);
      return this.toClientSession(session);
    }

    return this.toClientSession(session);
  }

  async stopSession(sessionId, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    if (session.frameTimer) {
      clearInterval(session.frameTimer);
      session.frameTimer = null;
    }
    if (session.captureAfterInputTimer) {
      clearTimeout(session.captureAfterInputTimer);
      session.captureAfterInputTimer = null;
    }
    try {
      await session.page?.evaluate(() => window.MauworldBrowserAudioRelay?.stop?.()).catch(() => null);
      await session.context?.close().catch(() => null);
    } catch (_error) {
      // Best effort.
    }
    if (!options.silentClose) {
      this.emit("stop", {
        sessionId: session.id,
        hostSessionId: session.hostSessionId,
        worldSnapshotId: session.worldSnapshotId,
        groupRole: session.groupRole,
        sessionSlot: session.sessionSlot,
        anchorSessionId: session.anchorSessionId,
        anchorHostSessionId: session.anchorHostSessionId,
        listedLive: session.listedLive !== false,
        groupJoined: session.groupJoined === true,
      });
    }
  }

  async dispose() {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.stopSession(sessionId);
    }
    for (const browser of this.browserByKind.values()) {
      await browser.close().catch(() => null);
    }
    this.browserByKind.clear();
  }
}
