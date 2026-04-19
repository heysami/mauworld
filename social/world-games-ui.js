const { mauworldApiUrl } = window.MauworldSocial;

function clipText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function readStorage(key, fallback = "") {
  try {
    const value = window.localStorage.getItem(key);
    return typeof value === "string" ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (!key) {
      return;
    }
    if (value == null || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(value));
  } catch (_error) {
    // Ignore storage failures in privacy-restricted browsers.
  }
}

function onceAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function apiRequest(path, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const headers = {
    ...(options.headers ?? {}),
  };
  const accessToken = String(options.getAccessToken?.() ?? "").trim();
  if (accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (options.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(mauworldApiUrl(path), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function normalizeSeatList(session = {}) {
  return Array.isArray(session?.seats) ? session.seats : [];
}

function findViewerSeat(session = {}, viewerSessionId = "") {
  const target = String(viewerSessionId ?? "").trim();
  if (!target) {
    return null;
  }
  return normalizeSeatList(session)
    .find((seat) => String(seat?.viewer_session_id ?? "").trim() === target) ?? null;
}

function getPlayerCountLabel(manifest = {}) {
  const minPlayers = Math.max(1, Number(manifest?.min_players) || 1);
  const maxPlayers = Math.max(minPlayers, Number(manifest?.max_players) || minPlayers);
  if (minPlayers === maxPlayers) {
    return `${minPlayers} player${minPlayers === 1 ? "" : "s"}`;
  }
  return `${minPlayers}-${maxPlayers} players`;
}

function getMultiplayerModeLabel(manifest = {}) {
  const mode = String(manifest?.multiplayer_mode ?? "").trim().toLowerCase();
  if (mode === "single") {
    return "Single player";
  }
  if (mode === "realtime") {
    return "Realtime";
  }
  return "Turn based";
}

function getGameDescription(game = {}) {
  return clipText(
    game?.manifest?.description
    ?? game?.description
    ?? game?.prompt
    ?? "",
    280,
  );
}

function getGameTitle(game = {}, fallback = "Untitled Game") {
  return clipText(game?.title ?? game?.manifest?.title ?? fallback, 96) || fallback;
}

function getLegacyClaimSeatAliases(game = {}) {
  const source = String(game?.source_html ?? "").trim();
  if (!source) {
    return [];
  }
  const aliases = [];
  const seen = new Set();
  const directClaimPattern = /(?:api\.)?claimSeat\((['"])([^'"\\]{1,32})\1\)/g;
  const helperSeatPattern = /seatButton\((['"])([^'"\\]{1,32})\1\s*,\s*(['"])([^'"\\]{1,32})\3/g;

  function addAlias(candidate) {
    const alias = clipText(candidate ?? "", 32);
    if (!alias) {
      return;
    }
    const normalized = alias.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    aliases.push(alias);
  }

  for (const match of source.matchAll(directClaimPattern)) {
    addAlias(match[2]);
  }
  for (const match of source.matchAll(helperSeatPattern)) {
    addAlias(match[2] || match[4]);
  }
  return aliases;
}

function buildShellBridgeScript() {
  return `
    <script>
      (() => {
        const CHANNEL_IN = "mauworld-game-host";
        const CHANNEL_OUT = "mauworld-game-shell";
        const state = {
          descriptor: null,
          hooks: {},
          root: null,
          session: null,
          authoritativeState: null,
          mounted: false,
          previewLoopStarted: false,
          previewTimer: null,
          previewPending: false,
        };

        function clone(value) {
          if (value == null) {
            return null;
          }
          if (typeof structuredClone === "function") {
            return structuredClone(value);
          }
          return JSON.parse(JSON.stringify(value));
        }

        function post(type, payload = {}) {
          parent.postMessage({ channel: CHANNEL_OUT, type, ...payload }, "*");
        }

        function ensureRoot() {
          if (state.root && state.root.isConnected) {
            return state.root;
          }
          let root = document.getElementById("mauworld-game-root");
          if (!root) {
            root = document.createElement("div");
            root.id = "mauworld-game-root";
            if (document.body.firstChild) {
              document.body.insertBefore(root, document.body.firstChild);
            } else {
              document.body.append(root);
            }
          }
          root.style.display = "block";
          root.style.width = "100%";
          root.style.minHeight = "100vh";
          state.root = root;
          return root;
        }

        function clampNumber(value, fallback, min, max) {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) {
            return fallback;
          }
          return Math.max(min, Math.min(max, numeric));
        }

        function getPreviewTargetSize(width, height) {
          const safeWidth = Math.max(1, Math.round(width || 0));
          const safeHeight = Math.max(1, Math.round(height || 0));
          const previewConfig = state.descriptor && state.descriptor.manifest && state.descriptor.manifest.preview
            ? state.descriptor.manifest.preview
            : {};
          const aspectRatio = safeWidth / Math.max(1, safeHeight);
          const maxWidth = Math.round(clampNumber(previewConfig.width, 480, 160, 960));
          const fallbackHeight = Math.max(90, Math.round(maxWidth / Math.max(0.1, aspectRatio)));
          const maxHeight = Math.round(clampNumber(previewConfig.height, fallbackHeight, 90, 720));
          const scale = Math.min(
            1,
            maxWidth / Math.max(1, safeWidth),
            maxHeight / Math.max(1, safeHeight),
          );
          return {
            width: Math.max(1, Math.round(safeWidth * scale)),
            height: Math.max(1, Math.round(safeHeight * scale)),
          };
        }

        function renderPreviewSource(source, width, height) {
          const safeWidth = Math.max(0, Math.round(width || 0));
          const safeHeight = Math.max(0, Math.round(height || 0));
          if (!safeWidth || !safeHeight) {
            return null;
          }
          const targetSize = getPreviewTargetSize(safeWidth, safeHeight);
          const canvas = document.createElement("canvas");
          canvas.width = targetSize.width;
          canvas.height = targetSize.height;
          const context = canvas.getContext("2d");
          if (!context) {
            return null;
          }
          context.drawImage(source, 0, 0, targetSize.width, targetSize.height);
          return {
            data_url: canvas.toDataURL("image/webp", 0.78),
            width: targetSize.width,
            height: targetSize.height,
          };
        }

        function isVisiblePreviewCandidate(element) {
          if (!element || !element.isConnected) {
            return false;
          }
          const style = window.getComputedStyle(element);
          if (
            style.display === "none"
            || style.visibility === "hidden"
            || Number(style.opacity || 1) <= 0.02
          ) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          const width = Math.max(
            0,
            Math.round(rect.width || element.clientWidth || element.width || element.videoWidth || 0),
          );
          const height = Math.max(
            0,
            Math.round(rect.height || element.clientHeight || element.height || element.videoHeight || 0),
          );
          return width >= 32 && height >= 32;
        }

        function getPreviewCandidateScore(element) {
          const rect = element.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.round(rect.width || element.clientWidth || element.width || element.videoWidth || 0),
          );
          const height = Math.max(
            1,
            Math.round(rect.height || element.clientHeight || element.height || element.videoHeight || 0),
          );
          const tagName = String(element.tagName || "").toLowerCase();
          let bonus = 0;
          if (element.hasAttribute("data-mauworld-preview")) {
            bonus += 5_000_000;
          } else if (tagName === "canvas") {
            bonus += 4_000_000;
          } else if (tagName === "svg") {
            bonus += 3_000_000;
          } else if (tagName === "img") {
            bonus += 2_000_000;
          } else if (tagName === "video") {
            bonus += 1_000_000;
          }
          return bonus + width * height;
        }

        function findPreviewTargetIn(root) {
          if (!root || typeof root.querySelectorAll !== "function") {
            return null;
          }
          const candidates = [...root.querySelectorAll("[data-mauworld-preview], canvas, svg, img, video")]
            .filter((element) => isVisiblePreviewCandidate(element));
          candidates.sort((left, right) => getPreviewCandidateScore(right) - getPreviewCandidateScore(left));
          return candidates[0] || null;
        }

        function getHookPreviewTarget() {
          try {
            if (typeof state.hooks.getPreviewTarget === "function") {
              return state.hooks.getPreviewTarget() || null;
            }
          } catch (_error) {
            // Hook-based preview targeting is best-effort.
          }
          try {
            if (typeof state.descriptor.getPreviewTarget === "function") {
              return state.descriptor.getPreviewTarget() || null;
            }
          } catch (_error) {
            // Descriptor-based preview targeting is best-effort.
          }
          return null;
        }

        function getPreviewTarget(target = null) {
          if (
            target instanceof HTMLCanvasElement
            || target instanceof HTMLImageElement
            || target instanceof HTMLVideoElement
            || target instanceof HTMLElement
          ) {
            return target;
          }
          const hookTarget = getHookPreviewTarget();
          if (hookTarget && isVisiblePreviewCandidate(hookTarget)) {
            return hookTarget;
          }
          const root = ensureRoot();
          const rootTarget = findPreviewTargetIn(root);
          if (rootTarget) {
            return rootTarget;
          }
          const bodyTarget = findPreviewTargetIn(document.body);
          if (bodyTarget) {
            return bodyTarget;
          }
          if (root.firstElementChild && isVisiblePreviewCandidate(root.firstElementChild)) {
            return root.firstElementChild;
          }
          return document.body || root;
        }

        async function rasterizeNode(target) {
          if (!target) {
            return null;
          }
          if (target instanceof HTMLCanvasElement) {
            return renderPreviewSource(
              target,
              target.width || Math.round(target.clientWidth || 0),
              target.height || Math.round(target.clientHeight || 0),
            );
          }
          if (target instanceof HTMLImageElement) {
            const width = Math.max(1, target.naturalWidth || Math.round(target.clientWidth || 0));
            const height = Math.max(1, target.naturalHeight || Math.round(target.clientHeight || 0));
            return renderPreviewSource(target, width, height);
          }
          if (target instanceof HTMLVideoElement) {
            const width = Math.max(1, target.videoWidth || Math.round(target.clientWidth || 0));
            const height = Math.max(1, target.videoHeight || Math.round(target.clientHeight || 0));
            return renderPreviewSource(target, width, height);
          }
          if (typeof SVGElement !== "undefined" && target instanceof SVGElement) {
            const rect = target.getBoundingClientRect();
            const width = Math.max(1, Math.round(rect.width || target.clientWidth || 0));
            const height = Math.max(1, Math.round(rect.height || target.clientHeight || 0));
            const serialized = new XMLSerializer().serializeToString(target.cloneNode(true));
            const svgMarkup = /^<svg[\s>]/i.test(serialized)
              ? serialized
              : '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' + serialized + '</svg>';
            const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            try {
              const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = url;
              });
              return renderPreviewSource(image, width, height);
            } finally {
              URL.revokeObjectURL(url);
            }
          }
          const node = target instanceof HTMLElement ? target : ensureRoot();
          const rect = node.getBoundingClientRect();
          const width = Math.max(1, Math.round(rect.width || node.offsetWidth || 0));
          const height = Math.max(1, Math.round(rect.height || node.offsetHeight || 0));
          if (!width || !height) {
            return null;
          }
          const styles = [...document.querySelectorAll("style")]
            .map((element) => element.textContent || "")
            .join("\\n");
          const serialized = new XMLSerializer().serializeToString(node.cloneNode(true));
          const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">',
            '<foreignObject width="100%" height="100%">',
            '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + width + 'px;height:' + height + 'px;">',
            '<style>html,body{margin:0;padding:0;}#mauworld-game-root{width:100%;height:100%;}' + styles + '</style>',
            serialized,
            '</div>',
            '</foreignObject>',
            '</svg>',
          ].join("");
          const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
          });
          return renderPreviewSource(image, width, height);
        }

        function getPreviewIntervalMs() {
          const previewConfig = state.descriptor && state.descriptor.manifest && state.descriptor.manifest.preview
            ? state.descriptor.manifest.preview
            : {};
          const fps = clampNumber(previewConfig.fps, 2, 1, 4);
          return Math.max(250, Math.round(1000 / fps));
        }

        function buildCompatibleSeatCollection(seats) {
          const normalizedSeats = Array.isArray(seats)
            ? seats.map((seat) => (seat && typeof seat === "object" ? { ...seat } : seat))
            : [];
          const legacyAliases = ["X", "O"];
          for (let index = 0; index < normalizedSeats.length; index += 1) {
            const seat = normalizedSeats[index];
            if (!seat || typeof seat !== "object") {
              continue;
            }
            const seatId = String(seat.seat_id || "").trim();
            if (seatId && !Object.prototype.hasOwnProperty.call(normalizedSeats, seatId)) {
              normalizedSeats[seatId] = seat;
            }
            const alias = legacyAliases[index];
            if (alias && !seat.legacy_seat_id) {
              seat.legacy_seat_id = alias;
            }
            if (alias && !Object.prototype.hasOwnProperty.call(normalizedSeats, alias)) {
              normalizedSeats[alias] = seat.viewer_session_id ? { ...seat, legacy_seat_id: alias } : null;
            }
          }
          return normalizedSeats;
        }

        function resolveLegacySeatId(seats, claimedSeatId) {
          const normalizedClaimedSeatId = String(claimedSeatId || "").trim();
          if (!normalizedClaimedSeatId || !Array.isArray(seats)) {
            return null;
          }
          const seatIndex = seats.findIndex((seat) => String(seat && seat.seat_id || "").trim() === normalizedClaimedSeatId);
          if (seatIndex === 0) {
            return "X";
          }
          if (seatIndex === 1) {
            return "O";
          }
          return null;
        }

        function normalizeSessionForGame(session) {
          if (!session || typeof session !== "object") {
            return null;
          }
          const normalized = clone(session) || {};
          const rawSeats = Array.isArray(normalized.seats) ? normalized.seats : [];
          const claimedSeatId = String(
            normalized.claimed_seat_id
            || normalized.claimedSeatId
            || normalized.mySeatId
            || ""
          ).trim();
          const legacySeatId = resolveLegacySeatId(rawSeats, claimedSeatId);
          const claimedSeat = claimedSeatId
            ? rawSeats.find((seat) => String(seat && seat.seat_id || "").trim() === claimedSeatId) || null
            : null;
          const role = String(normalized.role || "").trim().toLowerCase();
          normalized.seats = buildCompatibleSeatCollection(rawSeats);
          normalized.claimed_seat_id = claimedSeatId || null;
          normalized.claimedSeatId = claimedSeatId || null;
          normalized.mySeatId = legacySeatId || claimedSeatId || null;
          normalized.role = role || (normalized.isHost ? "host" : (claimedSeatId ? "player" : "viewer"));
          normalized.isHost = normalized.isHost === true || normalized.role === "host";
          normalized.ready = normalized.ready === true || (claimedSeat ? claimedSeat.ready === true : false);
          return normalized;
        }

        function mapRequestedSeatId(session, seatId) {
          const requestedSeatId = String(seatId || "").trim();
          if (!requestedSeatId) {
            return "";
          }
          const normalizedRequestedSeatId = requestedSeatId.toLowerCase();
          const seats = Array.isArray(session && session.seats) ? session.seats : [];
          for (const seat of seats) {
            if (!seat || typeof seat !== "object") {
              continue;
            }
            const actualSeatId = String(seat.seat_id || "").trim();
            const legacySeatId = String(seat.legacy_seat_id || "").trim();
            if (
              (actualSeatId && actualSeatId.toLowerCase() === normalizedRequestedSeatId)
              || (legacySeatId && legacySeatId.toLowerCase() === normalizedRequestedSeatId)
            ) {
              return actualSeatId || requestedSeatId;
            }
          }
          const aliasSeat = session && session.seats && typeof session.seats === "object"
            ? (
              session.seats[requestedSeatId]
              || session.seats[requestedSeatId.toUpperCase()]
              || session.seats[requestedSeatId.toLowerCase()]
            )
            : null;
          if (aliasSeat && typeof aliasSeat === "object" && aliasSeat.seat_id) {
            return String(aliasSeat.seat_id);
          }
          return requestedSeatId;
        }

        async function publishAutomaticPreview() {
          if (
            state.previewPending
            || !state.mounted
            || !state.session
            || state.session.role !== "host"
          ) {
            return;
          }
          state.previewPending = true;
          try {
            const preview = await rasterizeNode(getPreviewTarget());
            if (preview && preview.data_url) {
              post("preview", { preview });
            }
          } catch (_error) {
            // Preview frames are best-effort.
          } finally {
            state.previewPending = false;
          }
        }

        function stopPreviewLoop() {
          state.previewLoopStarted = false;
          if (state.previewTimer) {
            window.clearTimeout(state.previewTimer);
            state.previewTimer = null;
          }
          state.previewPending = false;
        }

        function startPreviewLoop() {
          if (state.previewLoopStarted) {
            return;
          }
          state.previewLoopStarted = true;
          const tick = async () => {
            if (!state.previewLoopStarted) {
              return;
            }
            await publishAutomaticPreview();
            state.previewTimer = window.setTimeout(tick, getPreviewIntervalMs());
          };
          state.previewTimer = window.setTimeout(tick, 350);
        }

        function buildApi() {
          return {
            get root() {
              return ensureRoot();
            },
            get session() {
              return clone(normalizeSessionForGame(state.session));
            },
            getState() {
              return clone(state.authoritativeState);
            },
            setState(nextState) {
              post("set-state", { state: clone(nextState) });
            },
            sendAction(action) {
              post("action", { action: clone(action) });
            },
            claimSeat(seatId) {
              post("claim-seat", { seatId: mapRequestedSeatId(state.session, seatId) });
            },
            releaseSeat() {
              post("release-seat");
            },
            setReady(ready) {
              post("ready", { ready: ready === true });
            },
            startMatch() {
              post("start-match");
            },
            async publishPreview(target = null) {
              try {
                const preview = await rasterizeNode(getPreviewTarget(target));
                if (preview?.data_url) {
                  post("preview", { preview });
                }
              } catch (_error) {
                // Preview frames are best-effort.
              }
            },
          };
        }

        async function mountIfReady() {
          if (state.mounted || !state.descriptor || typeof state.descriptor.mount !== "function") {
            return;
          }
          state.mounted = true;
          const api = buildApi();
          const hooks = await Promise.resolve(state.descriptor.mount(api));
          state.hooks = hooks && typeof hooks === "object" ? hooks : {};
          post("registered", { manifest: clone(state.descriptor.manifest || null) });
          if (typeof state.hooks.onSession === "function") {
            state.hooks.onSession(clone(state.session));
          }
          if (typeof state.hooks.onState === "function") {
            state.hooks.onState(clone(state.authoritativeState));
          }
          post("sdk-ready");
          startPreviewLoop();
        }

        function handleHostMessage(payload = {}) {
          const type = String(payload.type || "").trim();
          if (type === "session") {
            state.session = normalizeSessionForGame(payload.session);
            if (typeof state.hooks.onSession === "function") {
              state.hooks.onSession(clone(state.session));
            }
            return;
          }
          if (type === "state") {
            state.authoritativeState = clone(payload.state);
            if (typeof state.hooks.onState === "function") {
              state.hooks.onState(clone(state.authoritativeState));
            }
            return;
          }
          if (type === "action") {
            if (typeof state.hooks.onAction === "function") {
              state.hooks.onAction(clone(payload.action), clone(payload.meta));
            }
            return;
          }
          if (type === "destroy") {
            stopPreviewLoop();
            if (typeof state.hooks.destroy === "function") {
              state.hooks.destroy();
            }
          }
        }

        window.MauworldGame = {
          register(descriptor) {
            state.descriptor = descriptor && typeof descriptor === "object" ? descriptor : {};
            if (document.readyState !== "loading") {
              void mountIfReady();
            }
          },
        };

        window.addEventListener("message", (event) => {
          const payload = event.data;
          if (!payload || payload.channel !== CHANNEL_IN) {
            return;
          }
          handleHostMessage(payload);
        });

        document.addEventListener("DOMContentLoaded", () => {
          void mountIfReady();
        });
      })();
    </script>
  `;
}

function injectShellBridge(sourceHtml = "") {
  const bridgeScript = buildShellBridgeScript();
  const bridgeStyle = `
    <style data-mauworld-game-bridge>
      html, body {
        margin: 0;
        padding: 0;
      }

      #mauworld-game-root {
        width: 100%;
        min-height: 100vh;
      }
    </style>
  `;
  const normalized = String(sourceHtml ?? "").trim();
  if (!normalized) {
    return [
      "<!DOCTYPE html>",
      "<html>",
      "<head>",
      '<meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      bridgeStyle,
      bridgeScript,
      "</head>",
      '<body><div id="mauworld-game-root"></div></body>',
      "</html>",
    ].join("");
  }
  let html = normalized;
  if (/<head[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${bridgeStyle}${bridgeScript}`);
  } else if (/<html[\s>]/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, `<html$1><head>${bridgeStyle}${bridgeScript}</head>`);
  } else {
    html = [
      "<!DOCTYPE html>",
      "<html>",
      "<head>",
      bridgeStyle,
      bridgeScript,
      "</head>",
      `<body>${html}</body>`,
      "</html>",
    ].join("");
  }
  if (!/<body[\s>]/i.test(html)) {
    html = html.replace(/<\/html>/i, "<body></body></html>");
  }
  return html;
}

export function createWorldGamesApi(options = {}) {
  return {
    async listGames(limit = 60) {
      return apiRequest(`/games?limit=${encodeURIComponent(String(limit))}`, {
        getAccessToken: options.getAccessToken,
      });
    },
    async getGame(gameId) {
      return apiRequest(`/games/${encodeURIComponent(String(gameId ?? "").trim())}`, {
        getAccessToken: options.getAccessToken,
      });
    },
    async generateGame(input = {}) {
      return apiRequest("/games/generate", {
        method: "POST",
        getAccessToken: options.getAccessToken,
        body: {
          prompt: String(input.prompt ?? "").trim(),
          apiKey: String(input.apiKey ?? "").trim(),
          model: String(input.model ?? "").trim() || undefined,
          provider: String(input.provider ?? "openai").trim(),
        },
      });
    },
    async copyGame(gameId, title = "") {
      return apiRequest(`/games/${encodeURIComponent(String(gameId ?? "").trim())}/copy`, {
        method: "POST",
        getAccessToken: options.getAccessToken,
        body: title ? { title } : {},
      });
    },
  };
}

export function createWorldGameLibrary(options = {}) {
  const storagePrefix = clipText(options.storagePrefix ?? "mauworld-world-games", 64) || "mauworld-world-games";
  const api = options.api;
  const state = {
    open: false,
    loading: false,
    generating: false,
    status: "",
    games: [],
    selectedGameId: "",
    prompt: "",
    apiKey: readStorage(`${storagePrefix}:api-key`, ""),
    model: readStorage(`${storagePrefix}:model`, "gpt-5.4-mini"),
  };

  const overlay = document.createElement("div");
  overlay.className = "mw-game-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mw-game-modal__backdrop" data-game-library-close></div>
    <div class="mw-game-modal__dialog" role="dialog" aria-modal="true" aria-label="Saved Mauworld games">
      <div class="mw-game-modal__header">
        <div class="mw-game-modal__heading">
          <span class="mw-game-modal__eyebrow">Saved games</span>
          <h2>Game library</h2>
          <p>Generate, save, and share nearby from one place.</p>
        </div>
        <button type="button" class="mw-game-modal__close" data-game-library-close aria-label="Close game library">Close</button>
      </div>
      <div class="mw-game-library">
        <section class="mw-game-library__column mw-game-library__column--list">
          <div class="mw-game-library__toolbar">
            <div class="mw-game-library__toolbar-copy">
              <strong>Your games</strong>
              <span>Single-file HTML apps</span>
            </div>
            <button type="button" class="is-muted" data-game-library-refresh>Refresh</button>
          </div>
          <div class="mw-game-library__status" data-game-library-status></div>
          <div class="mw-game-library__list" data-game-library-list></div>
        </section>
        <section class="mw-game-library__column mw-game-library__column--detail">
          <div class="mw-game-library__detail" data-game-library-detail></div>
          <form class="mw-game-generator" data-game-generator-form>
            <div class="mw-game-generator__header">
              <div class="mw-game-generator__copy">
                <strong>Generate a new game</strong>
                <span>Your AI key is used for this request only.</span>
              </div>
            </div>
            <label>
              <span>Prompt</span>
              <textarea data-game-generator-prompt rows="6" placeholder="Build a simple two-player chess game for Mauworld."></textarea>
            </label>
            <div class="mw-game-generator__grid">
              <label>
                <span>AI key</span>
                <input type="password" data-game-generator-key autocomplete="off" placeholder="sk-..." />
              </label>
              <label>
                <span>Model</span>
                <input type="text" data-game-generator-model autocomplete="off" placeholder="gpt-5.4-mini" />
              </label>
            </div>
            <div class="mw-game-generator__actions">
              <button type="submit" data-game-generator-submit>Generate</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const elements = {
    overlay,
    status: overlay.querySelector("[data-game-library-status]"),
    list: overlay.querySelector("[data-game-library-list]"),
    detail: overlay.querySelector("[data-game-library-detail]"),
    form: overlay.querySelector("[data-game-generator-form]"),
    prompt: overlay.querySelector("[data-game-generator-prompt]"),
    apiKey: overlay.querySelector("[data-game-generator-key]"),
    model: overlay.querySelector("[data-game-generator-model]"),
    submit: overlay.querySelector("[data-game-generator-submit]"),
    refresh: overlay.querySelector("[data-game-library-refresh]"),
  };

  elements.prompt.value = state.prompt;
  elements.apiKey.value = state.apiKey;
  elements.model.value = state.model;

  function getSelectedGame() {
    return state.games.find((game) => String(game?.id ?? "") === state.selectedGameId) ?? null;
  }

  function getStatusTone() {
    if (!state.status) {
      return "";
    }
    if (state.loading || state.generating) {
      return "working";
    }
    if (/(fail|error|could not|couldn't|denied|invalid|unsupported|forbidden|unauthor)/i.test(state.status)) {
      return "error";
    }
    return "info";
  }

  function renderList() {
    if (!elements.list) {
      return;
    }
    if (state.games.length === 0) {
      elements.list.innerHTML = `
        <div class="mw-game-library__empty">
          <strong>No saved games yet</strong>
          <p>Generate one below and it will be ready to share nearby.</p>
        </div>
      `;
      return;
    }
    elements.list.innerHTML = state.games.map((game) => {
      const selected = state.selectedGameId === game.id;
      return `
        <button
          type="button"
          class="mw-game-library__item ${selected ? "is-active" : ""}"
          data-game-library-id="${escapeHtml(game.id)}"
        >
          <strong>${escapeHtml(getGameTitle(game))}</strong>
          <span>${escapeHtml(getGameDescription(game) || getMultiplayerModeLabel(game.manifest))}</span>
          <span class="mw-game-library__meta">${escapeHtml(getMultiplayerModeLabel(game.manifest))} · ${escapeHtml(getPlayerCountLabel(game.manifest))}</span>
        </button>
      `;
    }).join("");
    for (const button of elements.list.querySelectorAll("[data-game-library-id]")) {
      button.addEventListener("click", () => {
        state.selectedGameId = button.getAttribute("data-game-library-id") || "";
        options.onSelect?.(getSelectedGame());
        render();
      });
    }
  }

  function renderDetail() {
    const game = getSelectedGame();
    if (!elements.detail) {
      return;
    }
    if (!game) {
      elements.detail.innerHTML = `
        <div class="mw-game-library__empty">
          <strong>Select a saved game</strong>
          <p>Or generate a new one below and share it nearby.</p>
        </div>
      `;
      return;
    }
    elements.detail.innerHTML = `
      <div class="mw-game-library__detail-head">
        <div class="mw-game-library__detail-copy">
          <span class="mw-game-library__badge">Ready to share</span>
          <h3>${escapeHtml(getGameTitle(game))}</h3>
          <p>${escapeHtml(getGameDescription(game) || "No description yet.")}</p>
        </div>
        <div class="mw-game-library__detail-actions">
          <button type="button" data-game-library-share>Share Nearby</button>
        </div>
      </div>
      <div class="mw-game-library__detail-meta">
        <span>${escapeHtml(getMultiplayerModeLabel(game.manifest))}</span>
        <span>${escapeHtml(getPlayerCountLabel(game.manifest))}</span>
        <span>${game.manifest?.allow_viewers === false ? "Players only" : "Viewers allowed"}</span>
      </div>
    `;
    elements.detail.querySelector("[data-game-library-share]")?.addEventListener("click", () => {
      const selectedGame = getSelectedGame();
      if (!selectedGame) {
        return;
      }
      options.onShare?.(selectedGame);
    });
  }

  function renderStatus() {
    if (!elements.status) {
      return;
    }
    elements.status.textContent = state.status || "";
    if (state.status) {
      elements.status.dataset.state = getStatusTone();
    } else {
      delete elements.status.dataset.state;
    }
  }

  function renderForm() {
    if (!elements.submit) {
      return;
    }
    elements.submit.disabled = state.generating === true;
    elements.submit.textContent = state.generating ? "Generating..." : "Generate";
    if (elements.refresh) {
      elements.refresh.disabled = state.loading === true || state.generating === true;
    }
  }

  function render() {
    overlay.hidden = !state.open;
    document.body.classList.toggle("has-mw-game-modal", state.open);
    renderStatus();
    renderList();
    renderDetail();
    renderForm();
  }

  async function refresh(optionsInput = {}) {
    if (!api) {
      return [];
    }
    state.loading = true;
    state.status = "Loading saved games...";
    render();
    try {
      const payload = await api.listGames(optionsInput.limit ?? 60);
      state.games = Array.isArray(payload?.games) ? payload.games : [];
      const preferredId = String(optionsInput.selectGameId ?? state.selectedGameId ?? "").trim();
      const hasPreferred = state.games.some((game) => game.id === preferredId);
      state.selectedGameId = hasPreferred
        ? preferredId
        : (state.games[0]?.id ?? "");
      state.status = state.games.length === 0 ? "Generate your first game to share it nearby." : "";
      options.onSelect?.(getSelectedGame());
      return state.games;
    } catch (error) {
      state.status = error?.message || "Could not load saved games.";
      throw error;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function open(config = {}) {
    state.open = true;
    state.status = "";
    if (config.prompt) {
      state.prompt = String(config.prompt);
      elements.prompt.value = state.prompt;
    }
    if (config.selectGameId) {
      state.selectedGameId = String(config.selectGameId);
    }
    render();
    await onceAnimationFrame();
    if (!state.games.length || config.forceRefresh === true || config.selectGameId) {
      await refresh({ selectGameId: config.selectGameId });
    }
  }

  function close() {
    state.open = false;
    render();
  }

  async function handleGenerate(event) {
    event?.preventDefault?.();
    if (!api) {
      return;
    }
    const prompt = clipText(elements.prompt?.value ?? "", 4000);
    const apiKey = String(elements.apiKey?.value ?? "").trim();
    const model = clipText(elements.model?.value ?? "", 80) || "gpt-5.4-mini";
    if (!prompt) {
      state.status = "Add a prompt before generating a game.";
      render();
      return;
    }
    if (!apiKey) {
      state.status = "Enter your AI key. It stays in this browser only.";
      render();
      return;
    }
    state.generating = true;
    state.status = "Generating a new Mauworld game...";
    state.prompt = prompt;
    state.apiKey = apiKey;
    state.model = model;
    writeStorage(`${storagePrefix}:api-key`, apiKey);
    writeStorage(`${storagePrefix}:model`, model);
    render();
    try {
      const payload = await api.generateGame({
        prompt,
        apiKey,
        model,
        provider: "openai",
      });
      if (payload?.game) {
        state.selectedGameId = payload.game.id;
      }
      await refresh({ selectGameId: payload?.game?.id ?? state.selectedGameId });
      state.status = payload?.game ? `"${getGameTitle(payload.game)}" is ready.` : "Game generated.";
      options.onGenerated?.(payload?.game ?? null);
      options.onSelect?.(getSelectedGame());
      render();
    } catch (error) {
      state.status = error?.message || "Could not generate a game.";
      render();
    } finally {
      state.generating = false;
      render();
    }
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.hasAttribute("data-game-library-close")) {
      close();
    }
  });
  elements.refresh?.addEventListener("click", () => {
    void refresh({ selectGameId: state.selectedGameId });
  });
  elements.form?.addEventListener("submit", (event) => {
    void handleGenerate(event);
  });

  render();

  return {
    open,
    close,
    refresh,
    getGames() {
      return state.games.slice();
    },
    getSelectedGame,
    setSelectedGameId(gameId = "") {
      state.selectedGameId = String(gameId ?? "").trim();
      options.onSelect?.(getSelectedGame());
      render();
    },
    notifyCopied(game) {
      if (!game) {
        return;
      }
      state.games = [game, ...state.games.filter((entry) => entry.id !== game.id)];
      state.selectedGameId = game.id;
      state.status = `"${getGameTitle(game)}" was added to your library.`;
      options.onSelect?.(getSelectedGame());
      render();
    },
  };
}

export function createWorldGameShell(options = {}) {
  const state = {
    open: false,
    loading: false,
    status: "",
    session: null,
    game: null,
    authoritativeState: null,
    iframeReady: false,
    lastPreviewSentAt: 0,
    shellPayload: null,
  };

  const overlay = document.createElement("div");
  overlay.className = "mw-game-shell";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mw-game-shell__backdrop" data-game-shell-close></div>
    <div class="mw-game-shell__dialog" role="dialog" aria-modal="true" aria-label="Mauworld game window">
      <div class="mw-game-shell__header">
        <div class="mw-game-shell__heading">
          <span class="mw-game-shell__eyebrow">Nearby game</span>
          <h2 data-game-shell-title>Loading game</h2>
          <p data-game-shell-subtitle></p>
        </div>
        <div class="mw-game-shell__actions">
          <button type="button" class="is-muted" data-game-shell-copy hidden>Copy Game</button>
          <button type="button" class="is-muted" data-game-shell-close>Close</button>
        </div>
      </div>
      <div class="mw-game-shell__body">
        <section class="mw-game-shell__stage">
          <div class="mw-game-shell__loading" data-game-shell-loading>Opening game...</div>
          <iframe
            class="mw-game-shell__frame"
            data-game-shell-frame
            sandbox="allow-scripts"
            title="Mauworld game"
          ></iframe>
        </section>
        <aside class="mw-game-shell__sidebar">
          <div class="mw-game-shell__summary">
            <span class="mw-game-shell__badge" data-game-shell-badge>Viewer</span>
            <strong data-game-shell-role>Watching this session</strong>
            <p data-game-shell-status></p>
          </div>
          <div class="mw-game-shell__controls">
            <button type="button" data-game-shell-ready hidden>Ready</button>
            <button type="button" data-game-shell-start hidden>Start Match</button>
          </div>
          <div class="mw-game-shell__seats" data-game-shell-seats></div>
        </aside>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const elements = {
    overlay,
    frame: overlay.querySelector("[data-game-shell-frame]"),
    title: overlay.querySelector("[data-game-shell-title]"),
    subtitle: overlay.querySelector("[data-game-shell-subtitle]"),
    loading: overlay.querySelector("[data-game-shell-loading]"),
    badge: overlay.querySelector("[data-game-shell-badge]"),
    role: overlay.querySelector("[data-game-shell-role]"),
    status: overlay.querySelector("[data-game-shell-status]"),
    ready: overlay.querySelector("[data-game-shell-ready]"),
    start: overlay.querySelector("[data-game-shell-start]"),
    seats: overlay.querySelector("[data-game-shell-seats]"),
    copy: overlay.querySelector("[data-game-shell-copy]"),
  };

  function getViewerSessionId() {
    return clipText(options.getViewerSessionId?.() ?? "", 160);
  }

  function computeRole(session = state.session) {
    const viewerSessionId = getViewerSessionId();
    if (!session || !viewerSessionId) {
      return {
        role: "viewer",
        claimedSeatId: null,
        isHost: false,
        ready: false,
      };
    }
    const isHost = String(session.host_viewer_session_id ?? "").trim() === viewerSessionId;
    const seat = findViewerSeat(session, viewerSessionId);
    return {
      role: isHost ? "host" : (seat ? "player" : "viewer"),
      claimedSeatId: seat?.seat_id ?? null,
      isHost,
      ready: seat ? seat.ready === true : false,
    };
  }

  function getSessionTitle() {
    return getGameTitle(state.game ?? state.session?.game ?? {}, "Nearby Game");
  }

  function getAuthoritativeStarted(session = state.session) {
    const authoritativeState = state.authoritativeState;
    if (
      authoritativeState
      && typeof authoritativeState === "object"
      && !Array.isArray(authoritativeState)
      && Object.prototype.hasOwnProperty.call(authoritativeState, "started")
    ) {
      return authoritativeState.started === true;
    }
    return session?.started === true;
  }

  function sendToFrame(type, payload = {}) {
    if (!elements.frame?.contentWindow) {
      return;
    }
    elements.frame.contentWindow.postMessage({
      channel: "mauworld-game-host",
      type,
      ...payload,
    }, "*");
  }

  function syncFrameSession() {
    if (!state.iframeReady || !state.session) {
      return;
    }
    const context = computeRole();
    sendToFrame("session", {
      session: {
        ...cloneJson(state.session),
        role: context.role,
        claimed_seat_id: context.claimedSeatId,
        viewer_session_id: getViewerSessionId(),
      },
    });
    sendToFrame("state", {
      state: cloneJson(state.authoritativeState),
    });
  }

  function renderSeats() {
    if (!elements.seats) {
      return;
    }
    const session = state.session;
    if (!session) {
      elements.seats.innerHTML = "";
      return;
    }
    const context = computeRole(session);
    const seats = normalizeSeatList(session);
    const legacyAliases = getLegacyClaimSeatAliases(state.game ?? session.game ?? {});
    const seatCountLabel = seats.length > 0
      ? `${seats.length} player${seats.length === 1 ? "" : "s"}`
      : getPlayerCountLabel(session.game?.manifest ?? state.game?.manifest ?? {});
    elements.seats.innerHTML = `
      <div class="mw-game-shell__seat-header">
        <strong>Seats</strong>
        <span>${escapeHtml(seatCountLabel)}</span>
      </div>
      ${seats.map((seat, index) => {
        const isClaimedByViewer = context.claimedSeatId === seat.seat_id;
        const open = !seat.viewer_session_id;
        const seatAlias = legacyAliases[index] ? ` (${legacyAliases[index]})` : "";
        const label = open
          ? "Claim"
          : isClaimedByViewer
            ? "Release"
            : "Taken";
        return `
          <div class="mw-game-shell__seat ${open ? "is-open" : ""}">
            <div>
              <strong>${escapeHtml(`${seat.label || seat.seat_id}${seatAlias}`)}</strong>
              <span>${escapeHtml(seat.display_name || (open ? "Open seat" : "Player"))}</span>
            </div>
            <div class="mw-game-shell__seat-actions">
              ${seat.ready ? '<span class="mw-game-shell__seat-ready">Ready</span>' : ""}
              <button
                type="button"
                data-game-shell-seat="${escapeHtml(seat.seat_id)}"
                ${(!open && !isClaimedByViewer) ? "disabled" : ""}
              >${label}</button>
            </div>
          </div>
        `;
      }).join("")}
    `;
    for (const button of elements.seats.querySelectorAll("[data-game-shell-seat]")) {
      button.addEventListener("click", () => {
        const seatId = button.getAttribute("data-game-shell-seat") || "";
        const contextNext = computeRole();
        if (contextNext.claimedSeatId === seatId) {
          options.onReleaseSeat?.(state.session?.session_id ?? "");
          return;
        }
        options.onClaimSeat?.(state.session?.session_id ?? "", seatId);
      });
    }
  }

  function renderSummary() {
    const session = state.session;
    const context = computeRole(session);
    const matchStarted = getAuthoritativeStarted(session);
    const ownerProfileId = String(state.session?.game?.owner_profile_id ?? state.game?.owner_profile_id ?? "").trim();
    const viewerProfileId = String(options.getProfileId?.() ?? "").trim();
    const canCopy = Boolean(session?.session_id && viewerProfileId && ownerProfileId && viewerProfileId !== ownerProfileId);
    const roleLabel = context.role === "host"
      ? "Host"
      : context.role === "player"
        ? "Player"
        : "Viewer";
    const subtitle = state.loading
      ? "Connecting to the live session..."
      : `${getMultiplayerModeLabel(state.game?.manifest ?? session?.game?.manifest ?? {})} · ${getPlayerCountLabel(state.game?.manifest ?? session?.game?.manifest ?? {})}`;
    if (elements.title) {
      elements.title.textContent = getSessionTitle();
    }
    if (elements.subtitle) {
      elements.subtitle.textContent = subtitle;
    }
    if (elements.badge) {
      elements.badge.textContent = roleLabel;
      elements.badge.dataset.role = context.role;
    }
    if (elements.role) {
      elements.role.textContent = context.role === "host"
        ? "You control the authoritative state."
        : context.role === "player"
          ? "You are seated in this match."
          : "You are watching as a viewer.";
    }
    if (elements.status) {
      elements.status.textContent = state.status || (
        matchStarted
          ? "The match is live."
          : (context.isHost
            ? "Use the game window to start the match."
            : (context.claimedSeatId
              ? (context.ready ? "You are ready." : "Claimed seat. Mark ready when you are set.")
              : "Claim an open seat, or stay as a viewer."))
      );
    }
    if (elements.ready) {
      const showReady = Boolean(context.claimedSeatId && !matchStarted);
      elements.ready.hidden = !showReady;
      elements.ready.disabled = Boolean(state.loading);
      elements.ready.textContent = context.ready ? "Unready" : "Ready";
    }
    if (elements.start) {
      elements.start.hidden = true;
      elements.start.disabled = true;
    }
    if (elements.copy) {
      elements.copy.hidden = !canCopy;
      elements.copy.disabled = Boolean(state.loading);
    }
    if (elements.loading) {
      elements.loading.hidden = state.loading !== true;
    }
    renderSeats();
  }

  function render() {
    overlay.hidden = !state.open;
    document.body.classList.toggle("has-mw-game-shell", state.open);
    renderSummary();
  }

  function loadIframe() {
    if (!state.game?.source_html || !elements.frame) {
      return;
    }
    state.iframeReady = false;
    elements.frame.srcdoc = injectShellBridge(state.game.source_html);
  }

  function requestOpen(session = {}) {
    const sessionId = String(session?.session_id ?? "").trim();
    if (!sessionId) {
      return;
    }
    if (
      state.session
      && String(state.session.session_id ?? "").trim() === sessionId
      && state.game
    ) {
      state.open = true;
      render();
      return;
    }
    state.open = true;
    state.loading = true;
    state.status = "";
    state.session = cloneJson(session);
    state.game = {
      id: session?.game?.id,
      owner_profile_id: session?.game?.owner_profile_id ?? null,
      source_game_id: session?.game?.source_game_id ?? null,
      title: getGameTitle(session?.game),
      manifest: cloneJson(session?.game?.manifest ?? {}),
      source_html: "",
    };
    render();
    options.onOpenSession?.(sessionId);
  }

  function openPayload(payload = {}) {
    state.open = true;
    state.loading = false;
    state.status = "";
    state.session = cloneJson(payload.session ?? null);
    state.game = cloneJson(payload.game ?? null);
    state.authoritativeState = cloneJson(payload.authoritative_state ?? null);
    state.shellPayload = cloneJson(payload);
    render();
    loadIframe();
  }

  function updateSession(session = null) {
    if (!session || !state.session || String(session.session_id ?? "") !== String(state.session.session_id ?? "")) {
      return;
    }
    state.session = cloneJson(session);
    render();
    syncFrameSession();
  }

  function updateState(sessionId, nextState) {
    if (!state.session || String(state.session.session_id ?? "") !== String(sessionId ?? "")) {
      return;
    }
    state.authoritativeState = cloneJson(nextState);
    syncFrameSession();
  }

  function deliverAction(sessionId, action, actor) {
    if (!state.session || String(state.session.session_id ?? "") !== String(sessionId ?? "")) {
      return;
    }
    if (!state.iframeReady) {
      return;
    }
    sendToFrame("action", {
      action: cloneJson(action),
      meta: cloneJson(actor),
    });
  }

  function close() {
    if (state.iframeReady) {
      sendToFrame("destroy");
    }
    state.open = false;
    state.loading = false;
    state.status = "";
    state.session = null;
    state.game = null;
    state.authoritativeState = null;
    state.iframeReady = false;
    state.shellPayload = null;
    if (elements.frame) {
      elements.frame.removeAttribute("srcdoc");
    }
    render();
  }

  function handleShellMessage(event) {
    const payload = event.data;
    if (!payload || payload.channel !== "mauworld-game-shell") {
      return;
    }
    const sessionId = String(state.session?.session_id ?? "").trim();
    if (!sessionId) {
      return;
    }
    if (payload.type === "sdk-ready") {
      state.iframeReady = true;
      syncFrameSession();
      return;
    }
    if (payload.type === "registered") {
      state.iframeReady = true;
      syncFrameSession();
      return;
    }
    if (payload.type === "claim-seat") {
      options.onClaimSeat?.(sessionId, payload.seatId);
      return;
    }
    if (payload.type === "release-seat") {
      options.onReleaseSeat?.(sessionId);
      return;
    }
    if (payload.type === "ready") {
      options.onReady?.(sessionId, payload.ready === true);
      return;
    }
    if (payload.type === "start-match") {
      options.onStartMatch?.(sessionId);
      return;
    }
    if (payload.type === "action") {
      options.onAction?.(sessionId, cloneJson(payload.action));
      return;
    }
    if (payload.type === "set-state") {
      options.onState?.(sessionId, cloneJson(payload.state));
      return;
    }
    if (payload.type === "preview") {
      const now = performance.now();
      if (now - state.lastPreviewSentAt < 220) {
        return;
      }
      state.lastPreviewSentAt = now;
      options.onPreview?.(sessionId, cloneJson(payload.preview));
    }
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.hasAttribute("data-game-shell-close")) {
      hide();
    }
  });
  elements.ready?.addEventListener("click", () => {
    const context = computeRole();
    if (!context.claimedSeatId) {
      return;
    }
    options.onReady?.(state.session?.session_id ?? "", !context.ready);
  });
  elements.start?.addEventListener("click", () => {
    options.onStartMatch?.(state.session?.session_id ?? "");
  });
  elements.copy?.addEventListener("click", () => {
    options.onCopy?.(state.session?.session_id ?? "");
  });
  elements.frame?.addEventListener("load", () => {
    state.iframeReady = false;
  });
  window.addEventListener("message", handleShellMessage);

  render();

  function hide() {
    state.open = false;
    render();
  }

  return {
    requestOpen,
    openPayload,
    updateSession,
    updateState,
    deliverAction,
    hide,
    close,
    isOpen(sessionId = "") {
      if (!state.open) {
        return false;
      }
      if (!sessionId) {
        return true;
      }
      return String(state.session?.session_id ?? "") === String(sessionId ?? "");
    },
    getSessionId() {
      return String(state.session?.session_id ?? "").trim();
    },
    setStatus(message = "") {
      state.status = clipText(message, 240);
      render();
    },
  };
}
