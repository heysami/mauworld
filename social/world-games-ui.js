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
        };

        function clone(value) {
          return value == null ? null : JSON.parse(JSON.stringify(value));
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

        async function rasterizeNode(target) {
          if (!target) {
            return null;
          }
          if (target instanceof HTMLCanvasElement) {
            return {
              data_url: target.toDataURL("image/webp", 0.86),
              width: target.width || Math.round(target.clientWidth || 0),
              height: target.height || Math.round(target.clientHeight || 0),
            };
          }
          if (target instanceof HTMLImageElement) {
            const width = Math.max(1, target.naturalWidth || Math.round(target.clientWidth || 0));
            const height = Math.max(1, target.naturalHeight || Math.round(target.clientHeight || 0));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) {
              return null;
            }
            context.drawImage(target, 0, 0, width, height);
            return {
              data_url: canvas.toDataURL("image/webp", 0.86),
              width,
              height,
            };
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
          const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          try {
            const image = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = reject;
              img.src = url;
            });
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) {
              return null;
            }
            context.drawImage(image, 0, 0, width, height);
            return {
              data_url: canvas.toDataURL("image/webp", 0.86),
              width,
              height,
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        }

        function buildApi() {
          return {
            get root() {
              return ensureRoot();
            },
            get session() {
              return clone(state.session);
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
              post("claim-seat", { seatId: String(seatId ?? "") });
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
                const preview = await rasterizeNode(target || ensureRoot());
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
        }

        function handleHostMessage(payload = {}) {
          const type = String(payload.type || "").trim();
          if (type === "session") {
            state.session = clone(payload.session);
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
          ensureRoot();
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
  if (/<body[\s>]/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, '<body$1><div id="mauworld-game-root"></div>');
  } else {
    html = html.replace(/<\/html>/i, '<body><div id="mauworld-game-root"></div></body></html>');
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
        <div>
          <span class="mw-game-modal__eyebrow">Saved games</span>
          <h2>Game Library</h2>
        </div>
        <button type="button" class="mw-game-modal__close" data-game-library-close aria-label="Close game library">Close</button>
      </div>
      <div class="mw-game-library">
        <section class="mw-game-library__column mw-game-library__column--list">
          <div class="mw-game-library__toolbar">
            <strong>Your HTML games</strong>
            <button type="button" class="is-muted" data-game-library-refresh>Refresh</button>
          </div>
          <div class="mw-game-library__status" data-game-library-status></div>
          <div class="mw-game-library__list" data-game-library-list></div>
        </section>
        <section class="mw-game-library__column mw-game-library__column--detail">
          <div class="mw-game-library__detail" data-game-library-detail></div>
          <form class="mw-game-generator" data-game-generator-form>
            <div class="mw-game-generator__header">
              <strong>Generate a new game</strong>
              <span>Single-file HTML only</span>
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

  function renderList() {
    if (!elements.list) {
      return;
    }
    if (state.games.length === 0) {
      elements.list.innerHTML = '<p class="mw-game-library__empty">No saved games yet.</p>';
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
          <strong>Pick a saved game</strong>
          <span>Generate a new one below, or refresh if you already made it in another window.</span>
        </div>
      `;
      return;
    }
    elements.detail.innerHTML = `
      <div class="mw-game-library__detail-head">
        <span class="mw-game-library__badge">Selected</span>
        <h3>${escapeHtml(getGameTitle(game))}</h3>
        <p>${escapeHtml(getGameDescription(game) || "No description yet.")}</p>
      </div>
      <div class="mw-game-library__detail-meta">
        <span>${escapeHtml(getMultiplayerModeLabel(game.manifest))}</span>
        <span>${escapeHtml(getPlayerCountLabel(game.manifest))}</span>
        <span>${game.manifest?.allow_viewers === false ? "Players only" : "Viewers allowed"}</span>
      </div>
      <div class="mw-game-library__detail-actions">
        <button type="button" data-game-library-share>Share This Game</button>
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
    elements.seats.innerHTML = `
      <div class="mw-game-shell__seat-header">
        <strong>Seats</strong>
        <span>${escapeHtml(getPlayerCountLabel(session.game?.manifest ?? state.game?.manifest ?? {}))}</span>
      </div>
      ${seats.map((seat) => {
        const isClaimedByViewer = context.claimedSeatId === seat.seat_id;
        const open = !seat.viewer_session_id;
        const label = open
          ? "Claim"
          : isClaimedByViewer
            ? "Release"
            : "Taken";
        return `
          <div class="mw-game-shell__seat ${open ? "is-open" : ""}">
            <div>
              <strong>${escapeHtml(seat.label || seat.seat_id)}</strong>
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
        session?.started
          ? "The match is live."
          : (context.claimedSeatId ? (context.ready ? "You are ready." : "Claimed seat. Mark ready when you are set.") : "Claim an open seat, or stay as a viewer.")
      );
    }
    if (elements.ready) {
      const showReady = Boolean(context.claimedSeatId && !context.isHost);
      elements.ready.hidden = !showReady;
      elements.ready.textContent = context.ready ? "Unready" : "Ready";
    }
    if (elements.start) {
      elements.start.hidden = !context.isHost;
      elements.start.disabled = Boolean(state.loading);
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
    if (!state.open || event.source !== elements.frame?.contentWindow) {
      return;
    }
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
      close();
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

  return {
    requestOpen,
    openPayload,
    updateSession,
    updateState,
    deliverAction,
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
