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

  getSessionByHost(hostSessionId) {
    return [...this.sessions.values()].find((session) => session.hostSessionId === hostSessionId) ?? null;
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
    return {
      sessionId: session.id,
      hostSessionId: session.hostSessionId,
      worldSnapshotId: session.worldSnapshotId,
      title: session.title,
      url: session.url,
      status: session.status,
      startedAt: session.startedAt,
      viewport: { ...this.viewport },
      aspectRatio: this.viewport.width / Math.max(1, this.viewport.height),
      frameTransport: session.frameTransport || this.defaultFrameTransport,
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
      session.frameTransport = this.defaultFrameTransport;
      return true;
    } catch (error) {
      session.audioRelayReady = false;
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

    const existing = this.getSessionByHost(hostSessionId);
    const targetUrl = normalizeTargetUrl(input.url, this.allowedHosts);
    if (existing) {
      await existing.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
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
      frameTransport: this.defaultFrameTransport,
      audioRelayReady: false,
    };
    this.sessions.set(session.id, session);
    this.bindSessionPageEvents(session);

    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
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
    const capture = async () => {
      if (session.captureInFlight || !this.sessions.has(session.id) || !session.page) {
        return;
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
      } catch (error) {
        this.emit("error", {
          sessionId: session.id,
          hostSessionId: session.hostSessionId,
          message: error.message,
        });
      } finally {
        session.captureInFlight = false;
      }
    };

    void capture();
    session.frameTimer = setInterval(() => {
      void capture();
    }, this.frameIntervalMs);
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

    if (kind === "navigate") {
      const targetUrl = normalizeTargetUrl(input.url, this.allowedHosts);
      await session.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      return this.toClientSession(session);
    }

    if (kind === "back") {
      await session.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      return this.toClientSession(session);
    }

    if (kind === "forward") {
      await session.page.goForward({ waitUntil: "domcontentloaded" }).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
      return this.toClientSession(session);
    }

    if (kind === "reload") {
      await session.page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => session.title);
      this.emit("session", this.toClientSession(session));
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
      return this.toClientSession(session);
    }

    if (kind === "wheel") {
      await session.page.mouse.wheel(Number(input.deltaX) || 0, Number(input.deltaY) || 0);
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
