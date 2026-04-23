import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const {
  escapeHtml,
  formatRelativeTime,
  mauworldApiUrl,
} = window.MauworldSocial;

const elements = {
  authBadge: document.querySelector("[data-library-auth-badge]"),
  authText: document.querySelector("[data-library-auth-text]"),
  authToggle: document.querySelector("[data-library-auth-toggle]"),
  signout: document.querySelector("[data-library-signout]"),
  authForm: document.querySelector("[data-library-auth-form]"),
  profileForm: document.querySelector("[data-library-profile-form]"),
  openPublishButtons: [...document.querySelectorAll("[data-library-open-publish]")],
  passwordInput: document.querySelector("[data-library-password-input]"),
  passwordToggle: document.querySelector("[data-library-password-toggle]"),
  search: document.querySelector("[data-library-search]"),
  sort: document.querySelector("[data-library-sort]"),
  refresh: document.querySelector("[data-library-refresh]"),
  tabButtons: [...document.querySelectorAll("[data-library-tab]")],
  resourceFilterBar: document.querySelector("[data-library-resource-filters]"),
  resourceFilterButtons: [...document.querySelectorAll("[data-library-resource-kind]")],
  status: document.querySelector("[data-library-status]"),
  results: document.querySelector("[data-library-results]"),
  detailShell: document.querySelector("[data-library-detail]"),
  detailContent: document.querySelector("[data-library-detail-content]"),
  closeDetailButtons: [...document.querySelectorAll("[data-library-close-detail]")],
  publishShell: document.querySelector("[data-library-publish-shell]"),
  publishForm: document.querySelector("[data-library-publish-form]"),
  publishStatus: document.querySelector("[data-library-publish-status]"),
  closePublishButtons: [...document.querySelectorAll("[data-library-close-publish]")],
  publishKindButtons: [...document.querySelectorAll("[data-publish-kind]")],
  publishSourceLabel: document.querySelector("[data-publish-source-label]"),
  publishSource: document.querySelector("[data-publish-source]"),
  publishResourceKindField: document.querySelector("[data-publish-resource-kind-field]"),
  publishResourceKind: document.querySelector("[data-publish-resource-kind]"),
  publishMedia: document.querySelector("[data-publish-media]"),
  publishMediaPreview: document.querySelector("[data-publish-media-preview]"),
  publishDeliveryButtons: [...document.querySelectorAll("[data-publish-delivery]")],
  publishTitle: document.querySelector("[data-publish-title]"),
  publishDescription: document.querySelector("[data-publish-description]"),
  publishContactField: document.querySelector("[data-publish-contact-field]"),
  publishContact: document.querySelector("[data-publish-contact]"),
  publishPreview: document.querySelector("[data-publish-preview]"),
};

const state = {
  supabase: null,
  authReady: false,
  session: null,
  profile: null,
  authFormOpen: false,
  loading: false,
  listings: [],
  tab: "all",
  resourceKind: "",
  query: "",
  sort: "newest",
  detail: {
    open: false,
    mode: "",
    id: "",
    payload: null,
    loading: false,
  },
  publishOpen: false,
  publishLoading: false,
  publish: {
    kind: "world_package",
    sourceId: "",
    resourceKind: "texture",
    deliveryMode: "download",
    title: "",
    description: "",
    contactInstructions: "",
    titleDirty: false,
    descriptionDirty: false,
    mediaEntries: [],
  },
  sources: {
    worlds: [],
    games: [],
    assets: [],
  },
  sourceListings: [],
  searchTimer: 0,
  prefillHandled: false,
};

function setBrowserStatus(message = "") {
  if (elements.status) {
    elements.status.textContent = message;
  }
}

function setPublishStatus(message = "") {
  if (elements.publishStatus) {
    elements.publishStatus.textContent = message;
  }
}

function apiHeaders(extra = {}) {
  const headers = {
    ...extra,
  };
  if (state.session?.access_token) {
    headers.Authorization = `Bearer ${state.session.access_token}`;
  }
  return headers;
}

async function apiFetch(path, {
  method = "GET",
  body = undefined,
  search = undefined,
  useAuth = true,
} = {}) {
  const url = new URL(mauworldApiUrl(path));
  if (search && typeof search === "object") {
    for (const [key, value] of Object.entries(search)) {
      if (value == null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  const headers = useAuth ? apiHeaders() : {};
  const options = {
    method,
    headers,
  };
  if (body instanceof FormData) {
    if (options.headers && "Content-Type" in options.headers) {
      delete options.headers["Content-Type"];
    }
    options.body = body;
  } else if (body !== undefined) {
    options.headers = {
      ...headers,
      "Content-Type": "application/json",
    };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url.toString(), options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function setAuthState({
  badge = "Guest mode",
  text = "Sign in to publish and review public listings.",
  authFormOpen = false,
} = {}) {
  if (elements.authBadge) {
    elements.authBadge.textContent = badge;
  }
  if (elements.authText) {
    elements.authText.textContent = text;
  }
  state.authFormOpen = authFormOpen;
  if (elements.authForm) {
    elements.authForm.hidden = !authFormOpen || Boolean(state.session);
  }
  if (elements.profileForm) {
    elements.profileForm.hidden = !(authFormOpen && state.session && state.profile);
  }
  if (elements.signout) {
    elements.signout.hidden = !state.session;
  }
  if (elements.authToggle) {
    elements.authToggle.textContent = state.session
      ? (authFormOpen ? "Hide Account" : "Account Settings")
      : (authFormOpen ? "Hide Sign In" : "Sign In");
    elements.authToggle.setAttribute("aria-expanded", authFormOpen ? "true" : "false");
  }
  if (elements.profileForm && state.profile) {
    elements.profileForm.elements.username.value = state.profile.username || "";
    elements.profileForm.elements.displayName.value = state.profile.display_name || "";
  }
}

function getKindLabel(kind = "", resourceKind = "") {
  if (kind === "world_package") {
    return "World Package";
  }
  if (kind === "game") {
    return "Game";
  }
  if (kind === "resource") {
    if (resourceKind === "model") {
      return "3D Model";
    }
    if (resourceKind === "video") {
      return "Video";
    }
    if (resourceKind === "sound") {
      return "Sound";
    }
    if (resourceKind === "animation") {
      return "Animation";
    }
    return "Texture";
  }
  return "Listing";
}

function getActionLabel(listing = {}) {
  return listing.delivery_mode === "contact" ? "Contact Creator" : "Download";
}

function getListingPrimaryMedia(listing = {}) {
  return Array.isArray(listing.media) && listing.media.length > 0 ? listing.media[0] : null;
}

function renderCardMedia(media = null, fallbackLabel = "Preview") {
  if (!media?.url) {
    return `<div class="library-card__media-fallback">${escapeHtml(fallbackLabel)}</div>`;
  }
  if (String(media.content_type ?? "").startsWith("video/")) {
    return `<video src="${escapeHtml(media.url)}" muted playsinline preload="metadata"></video>`;
  }
  return `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.filename || fallbackLabel)}" loading="lazy" />`;
}

function renderListingCard(listing = {}) {
  const media = getListingPrimaryMedia(listing);
  return `
    <article class="library-card" data-library-open-listing="${escapeHtml(listing.id)}">
      <div class="library-card__media">
        ${renderCardMedia(media, getKindLabel(listing.kind, listing.resource_kind))}
      </div>
      <div class="library-card__eyebrow">
        <span class="library-pill">${escapeHtml(getKindLabel(listing.kind, listing.resource_kind))}</span>
        <span class="library-pill">${escapeHtml(getActionLabel(listing))}</span>
      </div>
      <div>
        <h3>${escapeHtml(listing.title || "Untitled listing")}</h3>
        <p class="library-card__description">${escapeHtml(listing.description || "No description yet.")}</p>
      </div>
      <div class="library-card__owner">
        <span>@${escapeHtml(listing.owner?.username || "unknown")}</span>
        <span>•</span>
        <button
          type="button"
          class="library-inline-button"
          data-library-open-creator="${escapeHtml(listing.owner?.username || "")}"
        >View Creator</button>
      </div>
      <div class="library-card__stats">
        <span>${escapeHtml((Number(listing.rating_average ?? 0) || 0).toFixed(1))}★</span>
        <span>${Math.max(0, Number(listing.review_count ?? 0) || 0)} review${Number(listing.review_count ?? 0) === 1 ? "" : "s"}</span>
        <span>${escapeHtml(formatRelativeTime(listing.published_at))}</span>
      </div>
      <div class="library-card__actions">
        <button type="button" class="is-primary" data-library-open-listing="${escapeHtml(listing.id)}">Open</button>
        ${listing.download?.available
          ? `<a class="is-primary" href="${escapeHtml(listing.download.href)}">Download</a>`
          : `<button type="button" class="is-primary" data-library-open-listing="${escapeHtml(listing.id)}">Contact</button>`}
      </div>
    </article>
  `;
}

function groupCreatorCards(listings = []) {
  const grouped = new Map();
  for (const listing of Array.isArray(listings) ? listings : []) {
    const username = String(listing.owner?.username ?? "").trim();
    if (!username) {
      continue;
    }
    if (!grouped.has(username)) {
      grouped.set(username, {
        owner: listing.owner,
        listings: [],
      });
    }
    grouped.get(username).listings.push(listing);
  }
  const groups = [...grouped.values()].map((group) => ({
    ...group,
    latestListing: [...group.listings].sort(
      (left, right) => new Date(right.published_at ?? 0).getTime() - new Date(left.published_at ?? 0).getTime(),
    )[0] ?? null,
  }));
  return groups.sort((left, right) => {
    if (state.sort === "top-rated") {
      return (Number(right.owner?.profile_rating_average ?? 0) || 0) - (Number(left.owner?.profile_rating_average ?? 0) || 0)
        || (Number(right.owner?.active_listing_count ?? 0) || 0) - (Number(left.owner?.active_listing_count ?? 0) || 0);
    }
    return new Date(right.latestListing?.published_at ?? 0).getTime() - new Date(left.latestListing?.published_at ?? 0).getTime();
  });
}

function renderCreatorCard(group = {}) {
  const media = getListingPrimaryMedia(group.latestListing);
  return `
    <article class="library-card">
      <div class="library-card__media">
        ${renderCardMedia(media, "Creator")}
      </div>
      <div class="library-card__eyebrow">
        <span class="library-pill">Creator</span>
        <span class="library-pill">${Math.max(0, Number(group.owner?.active_listing_count ?? group.listings?.length ?? 0))} active listing${Math.max(0, Number(group.owner?.active_listing_count ?? group.listings?.length ?? 0)) === 1 ? "" : "s"}</span>
      </div>
      <div>
        <h3>${escapeHtml(group.owner?.display_name || `@${group.owner?.username || "unknown"}`)}</h3>
        <p class="library-card__description">@${escapeHtml(group.owner?.username || "unknown")}</p>
      </div>
      <div class="library-card__stats">
        <span>${escapeHtml((Number(group.owner?.profile_rating_average ?? 0) || 0).toFixed(1))}★ creator rating</span>
        <span>${Math.max(0, Number(group.owner?.profile_review_count ?? 0) || 0)} direct review${Number(group.owner?.profile_review_count ?? 0) === 1 ? "" : "s"}</span>
      </div>
      <div class="library-card__actions">
        <button type="button" class="is-primary" data-library-open-creator="${escapeHtml(group.owner?.username || "")}">Open Creator</button>
      </div>
    </article>
  `;
}

function renderResults() {
  if (!elements.results) {
    return;
  }
  if (state.loading) {
    elements.results.innerHTML = `
      <div class="library-empty">Loading the public library...</div>
      <div class="library-empty">Fetching creators and packages...</div>
    `;
    return;
  }
  if (!state.listings.length) {
    elements.results.innerHTML = `
      <div class="library-empty">No public listings match the current filters.</div>
    `;
    return;
  }
  if (state.tab === "creators") {
    const creators = groupCreatorCards(state.listings);
    if (!creators.length) {
      elements.results.innerHTML = `<div class="library-empty">No creators match the current search.</div>`;
      return;
    }
    elements.results.innerHTML = creators.map((creator) => renderCreatorCard(creator)).join("");
    return;
  }
  elements.results.innerHTML = state.listings.map((listing) => renderListingCard(listing)).join("");
}

function updateFilterButtons() {
  for (const button of elements.tabButtons) {
    const active = button.getAttribute("data-library-tab") === state.tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const showResourceFilters = state.tab === "all" || state.tab === "resource";
  if (elements.resourceFilterBar) {
    elements.resourceFilterBar.hidden = !showResourceFilters;
  }
  for (const button of elements.resourceFilterButtons) {
    const value = button.getAttribute("data-library-resource-kind") || "";
    const active = value === state.resourceKind;
    button.classList.toggle("is-active", active);
  }
  if (elements.sort) {
    elements.sort.value = state.sort;
  }
  if (elements.search && elements.search.value !== state.query) {
    elements.search.value = state.query;
  }
}

async function loadListings() {
  state.loading = true;
  updateFilterButtons();
  renderResults();
  const search = {
    q: state.query || "",
    sort: state.sort,
  };
  if (state.tab === "world_package" || state.tab === "game" || state.tab === "resource") {
    search.kind = state.tab;
  }
  if ((state.tab === "all" || state.tab === "resource") && state.resourceKind) {
    search.resourceKind = state.resourceKind;
  }
  if (state.tab === "creators") {
    delete search.kind;
    delete search.resourceKind;
  }
  try {
    const payload = await apiFetch("/public/library/listings", {
      search,
      useAuth: Boolean(state.session),
    });
    state.listings = payload.listings ?? [];
    const creatorGroups = state.tab === "creators" ? groupCreatorCards(state.listings) : [];
    setBrowserStatus(
      state.tab === "creators"
        ? `${creatorGroups.length} creator${creatorGroups.length === 1 ? "" : "s"} shown.`
        : `${state.listings.length} listing${state.listings.length === 1 ? "" : "s"} shown.`,
    );
  } catch (error) {
    state.listings = [];
    setBrowserStatus(error.message || "Could not load the public library.");
  } finally {
    state.loading = false;
    renderResults();
  }
}

async function loadProfile() {
  const payload = await apiFetch("/private/profile");
  state.profile = payload.profile ?? null;
  if (state.profile && elements.profileForm) {
    elements.profileForm.elements.username.value = state.profile.username || "";
    elements.profileForm.elements.displayName.value = state.profile.display_name || "";
  }
}

function normalizeOwnedWorlds(worlds = []) {
  const ownUsername = String(state.profile?.username ?? "").trim().toLowerCase();
  return (Array.isArray(worlds) ? worlds : []).filter((world) =>
    String(world?.creator?.username ?? "").trim().toLowerCase() === ownUsername);
}

async function loadSources() {
  if (!state.session) {
    state.sources = { worlds: [], games: [], assets: [] };
    state.sourceListings = [];
    renderPublishForm();
    return;
  }
  try {
    const [worldsPayload, gamesPayload, assetsPayload, ownListingsPayload] = await Promise.all([
      apiFetch("/private/worlds"),
      apiFetch("/games"),
      apiFetch("/private/assets"),
      apiFetch("/library/listings"),
    ]);
    state.sources.worlds = normalizeOwnedWorlds(worldsPayload.worlds ?? []);
    state.sources.games = gamesPayload.games ?? [];
    state.sources.assets = assetsPayload.assets ?? [];
    state.sourceListings = ownListingsPayload.listings ?? [];
  } catch (_error) {
    state.sources = { worlds: [], games: [], assets: [] };
    state.sourceListings = [];
  }
  renderPublishForm();
}

function getAssetPublishKinds(asset = {}) {
  const assetType = String(asset.asset_type ?? "").trim().toLowerCase();
  if (assetType === "sound") {
    return ["sound"];
  }
  if (assetType === "texture") {
    const mediaKind = String(asset.context?.media_kind ?? "").trim().toLowerCase();
    return [mediaKind === "video_texture" ? "video" : "texture"];
  }
  if (assetType === "model") {
    return ["model", "animation"];
  }
  return [];
}

function getPublishSourceOptions() {
  if (state.publish.kind === "world_package") {
    return state.sources.worlds.map((world) => ({
      value: world.world_id,
      label: `${world.name || "Untitled world"} · ${world.world_type || "world"}`,
      description: world.about || "",
      defaults: {
        title: world.name || "Private world package",
        description: world.about || "",
      },
    }));
  }
  if (state.publish.kind === "game") {
    return state.sources.games.map((game) => ({
      value: game.id,
      label: `${game.title || "Untitled game"} · ${game.manifest?.multiplayer_mode || "game"}`,
      description: game.manifest?.description || game.prompt || "",
      defaults: {
        title: game.title || "Game package",
        description: game.manifest?.description || game.prompt || "",
      },
    }));
  }
  return state.sources.assets.map((asset) => ({
    value: asset.id,
    label: `${asset.name || asset.id || "Untitled asset"} · ${getAssetPublishKinds(asset).map(getKindLabel.bind(null, "resource")).join(" / ")}`,
    description: asset.world_context_summary || asset.intended_use || "",
    asset,
    defaults: {
      title: asset.name || "Resource",
      description: asset.world_context_summary || asset.intended_use || "",
    },
  }));
}

function getSelectedSourceOption() {
  return getPublishSourceOptions().find((option) => option.value === state.publish.sourceId) ?? null;
}

function syncPublishDefaults(force = false) {
  const option = getSelectedSourceOption();
  if (!option) {
    return;
  }
  if (!state.publish.titleDirty || force || !state.publish.title) {
    state.publish.title = option.defaults?.title || "";
  }
  if (!state.publish.descriptionDirty || force || !state.publish.description) {
    state.publish.description = option.defaults?.description || "";
  }
}

function syncPublishResourceKindOptions() {
  const selectedOption = getSelectedSourceOption();
  if (!elements.publishResourceKind) {
    return;
  }
  if (state.publish.kind !== "resource") {
    elements.publishResourceKind.innerHTML = `
      <option value="texture">Texture</option>
      <option value="animation">Animation</option>
      <option value="video">Video</option>
      <option value="sound">Sound</option>
      <option value="model">3D Model</option>
    `;
    return;
  }
  const allowedKinds = getAssetPublishKinds(selectedOption?.asset ?? {});
  const fallbackKinds = allowedKinds.length ? allowedKinds : ["texture"];
  if (!fallbackKinds.includes(state.publish.resourceKind)) {
    state.publish.resourceKind = fallbackKinds[0];
  }
  elements.publishResourceKind.innerHTML = fallbackKinds.map((kind) => `
    <option value="${escapeHtml(kind)}">${escapeHtml(getKindLabel("resource", kind))}</option>
  `).join("");
  elements.publishResourceKind.value = state.publish.resourceKind;
}

function revokeMediaPreviewUrls() {
  for (const entry of state.publish.mediaEntries) {
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
}

function renderPublishForm() {
  const options = getPublishSourceOptions();
  if (elements.publishSourceLabel) {
    elements.publishSourceLabel.textContent = state.publish.kind === "world_package"
      ? "Private world"
      : state.publish.kind === "game"
        ? "Saved game"
        : "Private asset";
  }
  if (elements.publishSource) {
    if (!state.session) {
      state.publish.sourceId = "";
      elements.publishSource.innerHTML = `<option value="">Sign in to load your sources</option>`;
      elements.publishSource.disabled = true;
    } else if (!options.length) {
      state.publish.sourceId = "";
      elements.publishSource.innerHTML = `<option value="">No compatible sources yet</option>`;
      elements.publishSource.disabled = true;
    } else {
      elements.publishSource.disabled = false;
      if (!options.some((option) => option.value === state.publish.sourceId)) {
        state.publish.sourceId = options[0].value;
        syncPublishDefaults(true);
      }
      elements.publishSource.innerHTML = options.map((option) => `
        <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
      `).join("");
      elements.publishSource.value = state.publish.sourceId;
    }
  }
  if (elements.publishResourceKindField) {
    elements.publishResourceKindField.hidden = state.publish.kind !== "resource";
  }
  syncPublishResourceKindOptions();
  if (elements.publishContactField) {
    elements.publishContactField.hidden = state.publish.deliveryMode !== "contact";
  }
  for (const button of elements.publishKindButtons) {
    button.classList.toggle("is-active", button.getAttribute("data-publish-kind") === state.publish.kind);
  }
  for (const button of elements.publishDeliveryButtons) {
    button.classList.toggle("is-active", button.getAttribute("data-publish-delivery") === state.publish.deliveryMode);
  }
  if (elements.publishTitle) {
    elements.publishTitle.value = state.publish.title;
  }
  if (elements.publishDescription) {
    elements.publishDescription.value = state.publish.description;
  }
  if (elements.publishContact) {
    elements.publishContact.value = state.publish.contactInstructions;
  }
  if (elements.publishMediaPreview) {
    elements.publishMediaPreview.innerHTML = state.publish.mediaEntries.length
      ? state.publish.mediaEntries.map((entry) => `
          <div class="library-upload-preview__item">
            ${entry.file.type.startsWith("video/")
              ? `<video src="${escapeHtml(entry.url)}" muted playsinline preload="metadata"></video>`
              : `<img src="${escapeHtml(entry.url)}" alt="${escapeHtml(entry.file.name)}" />`}
          </div>
        `).join("")
      : '<div class="library-empty">Your uploaded previews will appear here.</div>';
  }
  renderPublishPreview();
}

function renderPublishPreview() {
  if (!elements.publishPreview) {
    return;
  }
  const option = getSelectedSourceOption();
  const previewThumbs = state.publish.mediaEntries.length
    ? state.publish.mediaEntries.map((entry) => `
        <div>
          ${entry.file.type.startsWith("video/")
            ? `<video src="${escapeHtml(entry.url)}" muted playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(entry.url)}" alt="${escapeHtml(entry.file.name)}" />`}
        </div>
      `).join("")
    : '<div class="library-empty">Upload at least one preview file.</div>';
  elements.publishPreview.innerHTML = `
    <div class="library-preview-card__grid">
      <div>
        <h3>${escapeHtml(state.publish.title || option?.defaults?.title || "Untitled listing")}</h3>
        <p class="library-preview-card__meta">${escapeHtml(state.publish.description || option?.defaults?.description || "No description yet.")}</p>
        <div class="library-card__eyebrow">
          <span class="library-pill">${escapeHtml(getKindLabel(state.publish.kind, state.publish.resourceKind))}</span>
          <span class="library-pill">${escapeHtml(state.publish.deliveryMode === "contact" ? "Contact Creator" : "Download")}</span>
        </div>
        <p class="library-preview-card__meta">${escapeHtml(option?.label || "Choose a source to continue.")}</p>
        ${state.publish.deliveryMode === "contact" && state.publish.contactInstructions
          ? `<p class="library-preview-card__meta">${escapeHtml(state.publish.contactInstructions)}</p>`
          : ""}
      </div>
      <div class="library-preview-card__thumbs">
        ${previewThumbs}
      </div>
    </div>
  `;
}

function setPublishOpen(open) {
  state.publishOpen = open === true;
  if (elements.publishShell) {
    elements.publishShell.hidden = !state.publishOpen;
  }
  if (state.publishOpen) {
    renderPublishForm();
  }
}

function setDetailOpen(open) {
  state.detail.open = open === true;
  if (elements.detailShell) {
    elements.detailShell.hidden = !state.detail.open;
  }
  if (!state.detail.open) {
    state.detail.payload = null;
    state.detail.id = "";
    state.detail.mode = "";
  }
}

function buildReviewListMarkup(reviews = []) {
  if (!Array.isArray(reviews) || !reviews.length) {
    return `<div class="library-empty">No reviews yet.</div>`;
  }
  return `<div class="library-review-list">${reviews.map((review) => `
    <article class="library-review">
      <strong>${escapeHtml(review.author?.display_name || `@${review.author?.username || "unknown"}`)}</strong>
      <p class="library-review__meta">${escapeHtml((Number(review.rating ?? 0) || 0).toFixed(1))}★ • ${escapeHtml(formatRelativeTime(review.updated_at || review.created_at))}</p>
      <p>${escapeHtml(review.comment || "")}</p>
    </article>
  `).join("")}</div>`;
}

function renderListingDetail(listing = {}) {
  const gallery = Array.isArray(listing.media) && listing.media.length
    ? listing.media.map((media) => `
        <div class="library-gallery__item">
          ${String(media.content_type ?? "").startsWith("video/")
            ? `<video src="${escapeHtml(media.url)}" controls playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.filename || listing.title || "Preview")}" />`}
        </div>
      `).join("")
    : '<div class="library-empty">No preview media was uploaded for this listing.</div>';
  const reviewForm = !state.session
    ? `<div class="library-empty">Sign in to leave a review.</div>`
    : listing.permissions?.can_review
      ? `
        <form class="library-review-form" data-library-listing-review-form="${escapeHtml(listing.id)}">
          <label>
            <span>Rating</span>
            <select name="rating">
              ${[5, 4, 3, 2, 1].map((value) => `
                <option value="${value}" ${Number(listing.viewer_review?.rating ?? 5) === value ? "selected" : ""}>${value} stars</option>
              `).join("")}
            </select>
          </label>
          <label>
            <span>Comment</span>
            <textarea name="comment" maxlength="1200" placeholder="Tell people what worked, what did not, and why.">${escapeHtml(listing.viewer_review?.comment || "")}</textarea>
          </label>
          <div class="library-detail-actions">
            <button type="submit" class="library-inline-button is-primary">Save Review</button>
            ${listing.viewer_review ? `<button type="button" class="library-inline-button" data-library-delete-listing-review="${escapeHtml(listing.id)}">Delete Review</button>` : ""}
          </div>
        </form>
      `
      : `<div class="library-empty">You cannot review your own listing.</div>`;
  const ownerForm = listing.permissions?.can_edit
    ? `
      <section class="library-drawer__section">
        <h3>Manage Listing</h3>
        <form class="library-owner-form" data-library-owner-form="${escapeHtml(listing.id)}">
          <label>
            <span>Title</span>
            <input type="text" name="title" maxlength="120" value="${escapeHtml(listing.title || "")}" />
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" maxlength="4000">${escapeHtml(listing.description || "")}</textarea>
          </label>
          <label>
            <span>Delivery mode</span>
            <select name="deliveryMode">
              <option value="download" ${listing.delivery_mode === "download" ? "selected" : ""}>Download</option>
              <option value="contact" ${listing.delivery_mode === "contact" ? "selected" : ""}>Contact Creator</option>
            </select>
          </label>
          ${listing.kind === "resource"
            ? `
              <label>
                <span>Resource type</span>
                <select name="resourceKind">
                  ${["texture", "animation", "video", "sound", "model"].map((kind) => `
                    <option value="${escapeHtml(kind)}" ${listing.resource_kind === kind ? "selected" : ""}>${escapeHtml(getKindLabel("resource", kind))}</option>
                  `).join("")}
                </select>
              </label>
            `
            : ""}
          <label data-library-owner-contact-wrapper ${listing.delivery_mode === "contact" ? "" : "hidden"}>
            <span>Contact instructions</span>
            <textarea name="contactInstructions" maxlength="2000">${escapeHtml(listing.contact_instructions || "")}</textarea>
          </label>
          <label>
            <span>
              <input type="checkbox" name="republishSnapshot" value="true" />
              Republish snapshot from the current source
            </span>
          </label>
          <div class="library-detail-actions">
            <button type="submit" class="library-inline-button is-primary">Save Changes</button>
            <button type="button" class="library-inline-button" data-library-archive-listing="${escapeHtml(listing.id)}">Archive Listing</button>
          </div>
        </form>
      </section>
    `
    : "";
  return `
    <div class="library-drawer__head">
      <div>
        <p class="section-kicker">${escapeHtml(getKindLabel(listing.kind, listing.resource_kind))}</p>
        <h2>${escapeHtml(listing.title || "Untitled listing")}</h2>
      </div>
      <button type="button" class="library-drawer__close" data-library-close-detail>Close</button>
    </div>
    <section class="library-drawer__section">
      <div class="library-gallery">${gallery}</div>
    </section>
    <section class="library-drawer__section">
      <div class="library-card__eyebrow">
        <span class="library-pill">${escapeHtml(getActionLabel(listing))}</span>
        <span class="library-pill">${escapeHtml(formatRelativeTime(listing.published_at))}</span>
      </div>
      <p>${escapeHtml(listing.description || "No description yet.")}</p>
      <div class="library-detail-actions">
        ${listing.download?.available
          ? `<a class="library-inline-button is-primary" href="${escapeHtml(listing.download.href)}">Download</a>`
          : `<button type="button" class="library-inline-button is-primary" data-library-show-contact="true">Contact Creator</button>`}
        <button type="button" class="library-inline-button" data-library-open-creator="${escapeHtml(listing.owner?.username || "")}">View Creator</button>
      </div>
      ${listing.delivery_mode === "contact"
        ? `<div class="library-empty" data-library-contact-card>${escapeHtml(listing.contact_instructions || "No contact instructions yet.")}</div>`
        : ""}
    </section>
    <section class="library-drawer__section">
      <h3>Creator</h3>
      <p>@${escapeHtml(listing.owner?.username || "unknown")} • ${escapeHtml(listing.owner?.display_name || listing.owner?.username || "Unknown")}</p>
      <p>${escapeHtml((Number(listing.owner?.profile_rating_average ?? 0) || 0).toFixed(1))}★ creator rating • ${Math.max(0, Number(listing.owner?.profile_review_count ?? 0) || 0)} direct review${Number(listing.owner?.profile_review_count ?? 0) === 1 ? "" : "s"}</p>
    </section>
    <section class="library-drawer__section">
      <h3>Listing Ratings</h3>
      <div class="library-detail-rating">
        <span>${escapeHtml((Number(listing.rating_average ?? 0) || 0).toFixed(1))}★ average</span>
        <span>${Math.max(0, Number(listing.review_count ?? 0) || 0)} review${Number(listing.review_count ?? 0) === 1 ? "" : "s"}</span>
      </div>
      ${buildReviewListMarkup(listing.reviews)}
      ${reviewForm}
    </section>
    ${ownerForm}
  `;
}

function renderCreatorDetail(payload = {}) {
  const profile = payload.profile ?? {};
  const reviewForm = !state.session
    ? `<div class="library-empty">Sign in to review this creator.</div>`
    : profile.permissions?.can_review
      ? `
        <form class="library-review-form" data-library-profile-review-form="${escapeHtml(profile.username || "")}">
          <label>
            <span>Rating</span>
            <select name="rating">
              ${[5, 4, 3, 2, 1].map((value) => `
                <option value="${value}" ${Number(payload.viewer_review?.rating ?? 5) === value ? "selected" : ""}>${value} stars</option>
              `).join("")}
            </select>
          </label>
          <label>
            <span>Comment</span>
            <textarea name="comment" maxlength="1200" placeholder="Describe what it is like to work with this creator.">${escapeHtml(payload.viewer_review?.comment || "")}</textarea>
          </label>
          <div class="library-detail-actions">
            <button type="submit" class="library-inline-button is-primary">Save Review</button>
            ${payload.viewer_review ? `<button type="button" class="library-inline-button" data-library-delete-profile-review="${escapeHtml(profile.username || "")}">Delete Review</button>` : ""}
          </div>
        </form>
      `
      : `<div class="library-empty">You cannot review your own creator profile.</div>`;
  return `
    <div class="library-drawer__head">
      <div>
        <p class="section-kicker">Creator</p>
        <h2>${escapeHtml(profile.display_name || `@${profile.username || "unknown"}`)}</h2>
      </div>
      <button type="button" class="library-drawer__close" data-library-close-detail>Close</button>
    </div>
    <section class="library-drawer__section">
      <div class="library-card__eyebrow">
        <span class="library-pill">@${escapeHtml(profile.username || "unknown")}</span>
        <span class="library-pill">${Math.max(0, Number(profile.active_listing_count ?? 0) || 0)} active listing${Number(profile.active_listing_count ?? 0) === 1 ? "" : "s"}</span>
      </div>
      <div class="library-detail-rating">
        <span>${escapeHtml((Number(profile.profile_rating_average ?? 0) || 0).toFixed(1))}★ direct creator rating</span>
        <span>${Math.max(0, Number(profile.profile_review_count ?? 0) || 0)} direct review${Number(profile.profile_review_count ?? 0) === 1 ? "" : "s"}</span>
      </div>
    </section>
    <section class="library-drawer__section">
      <h3>Published Listings</h3>
      <div class="library-listing-list">
        ${(payload.listings ?? []).length
          ? (payload.listings ?? []).map((listing) => `
              <article class="library-card">
                <div class="library-card__media">
                  ${renderCardMedia(getListingPrimaryMedia(listing), getKindLabel(listing.kind, listing.resource_kind))}
                </div>
                <div>
                  <h4>${escapeHtml(listing.title || "Untitled listing")}</h4>
                  <p class="library-card__description">${escapeHtml(listing.description || "No description yet.")}</p>
                </div>
                <div class="library-card__actions">
                  <button type="button" class="is-primary" data-library-open-listing="${escapeHtml(listing.id)}">Open Listing</button>
                </div>
              </article>
            `).join("")
          : '<div class="library-empty">No active public listings yet.</div>'}
      </div>
    </section>
    <section class="library-drawer__section">
      <h3>Direct Creator Reviews</h3>
      ${buildReviewListMarkup(payload.reviews)}
      ${reviewForm}
    </section>
  `;
}

function renderDetail() {
  if (!elements.detailContent) {
    return;
  }
  if (state.detail.loading) {
    elements.detailContent.innerHTML = `<div class="library-empty">Loading detail...</div>`;
    return;
  }
  if (!state.detail.payload) {
    elements.detailContent.innerHTML = `<div class="library-empty">Nothing selected.</div>`;
    return;
  }
  if (state.detail.payload?.error) {
    elements.detailContent.innerHTML = `<div class="library-empty">${escapeHtml(state.detail.payload.error || "Could not load this detail.")}</div>`;
    return;
  }
  elements.detailContent.innerHTML = state.detail.mode === "creator"
    ? renderCreatorDetail(state.detail.payload)
    : renderListingDetail(state.detail.payload.listing ?? {});
}

async function openListingDetail(listingId) {
  state.detail.loading = true;
  state.detail.mode = "listing";
  state.detail.id = listingId;
  state.detail.payload = null;
  setDetailOpen(true);
  renderDetail();
  try {
    state.detail.payload = await apiFetch(`/public/library/listings/${encodeURIComponent(listingId)}`, {
      useAuth: Boolean(state.session),
    });
  } catch (error) {
    state.detail.payload = {
      listing: null,
      error: error.message,
    };
  } finally {
    state.detail.loading = false;
    renderDetail();
  }
}

async function openCreatorDetail(username) {
  state.detail.loading = true;
  state.detail.mode = "creator";
  state.detail.id = username;
  state.detail.payload = null;
  setDetailOpen(true);
  renderDetail();
  try {
    state.detail.payload = await apiFetch(`/public/library/profiles/${encodeURIComponent(username)}`, {
      useAuth: Boolean(state.session),
    });
  } catch (error) {
    state.detail.payload = {
      error: error.message,
    };
  } finally {
    state.detail.loading = false;
    renderDetail();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.supabase) {
    return;
  }
  const formData = new FormData(elements.authForm);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const submitterAction = event.submitter?.getAttribute("data-auth-action") || "signin";
  try {
    if (submitterAction === "signin") {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }
      setBrowserStatus("Signed in.");
    }
  } catch (error) {
    setBrowserStatus(error.message || "Could not sign in.");
  } finally {
    setPasswordVisibility(false);
  }
}

async function signUp() {
  if (!state.supabase || !elements.authForm) {
    return;
  }
  const formData = new FormData(elements.authForm);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const { error } = await state.supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
  setBrowserStatus("Account created. If email confirmation is enabled, confirm it before signing in.");
  setPasswordVisibility(false);
}

async function signOut() {
  if (!state.supabase) {
    return;
  }
  const { error } = await state.supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const formData = new FormData(elements.profileForm);
  const payload = await apiFetch("/private/profile", {
    method: "PATCH",
    body: {
      username: formData.get("username"),
      displayName: formData.get("displayName"),
    },
  });
  state.profile = payload.profile ?? null;
  setBrowserStatus("Profile saved.");
  setAuthState({
    badge: state.profile?.username ? `Signed in as @${state.profile.username}` : "Signed in",
    text: "You can publish and review public library listings from this page.",
    authFormOpen: false,
  });
  await loadSources();
  renderPublishForm();
}

async function syncSession(session = null) {
  state.session = session;
  if (!session?.access_token) {
    state.profile = null;
    state.sourceListings = [];
    state.sources = { worlds: [], games: [], assets: [] };
    setAuthState({
      badge: "Guest mode",
      text: "Browse public listings now. Sign in if you want to publish or review.",
      authFormOpen: state.authFormOpen,
    });
    await loadListings();
    return;
  }
  try {
    await loadProfile();
    await loadSources();
    setAuthState({
      badge: state.profile?.username ? `Signed in as @${state.profile.username}` : "Signed in",
      text: "You can publish and review public library listings from this page.",
      authFormOpen: false,
    });
    await loadListings();
    maybeHandlePrefill();
  } catch (error) {
    setBrowserStatus(error.message || "Could not load your Mauworld profile.");
  }
}

async function initAuth() {
  try {
    const payload = await apiFetch("/public/auth/config", { useAuth: false });
    state.supabase = createClient(payload.supabaseUrl, payload.supabaseAnonKey);
    const { data } = await state.supabase.auth.getSession();
    state.authReady = true;
    await syncSession(data.session ?? null);
    state.supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });
  } catch (error) {
    state.authReady = true;
    setAuthState({
      badge: "Status unavailable",
      text: "Could not initialize Mauworld sign-in. Public browsing is still available.",
      authFormOpen: false,
    });
    setBrowserStatus(error.message || "Could not initialize sign-in.");
    await loadListings();
  }
}

function resetPublishDraft() {
  revokeMediaPreviewUrls();
  state.publish = {
    kind: "world_package",
    sourceId: "",
    resourceKind: "texture",
    deliveryMode: "download",
    title: "",
    description: "",
    contactInstructions: "",
    titleDirty: false,
    descriptionDirty: false,
    mediaEntries: [],
  };
  if (elements.publishMedia) {
    elements.publishMedia.value = "";
  }
  setPublishStatus("");
  renderPublishForm();
}

function maybeHandlePrefill() {
  if (state.prefillHandled) {
    return;
  }
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const publishKind = params.get("publish");
  if (!publishKind) {
    state.prefillHandled = true;
    return;
  }
  if (!state.session) {
    setBrowserStatus("Sign in first, then you can continue with the prefilled publish flow.");
    state.authFormOpen = true;
    setAuthState({
      badge: "Sign in needed",
      text: "Sign in to continue the prefilled publish flow.",
      authFormOpen: true,
    });
    return;
  }
  resetPublishDraft();
  if (publishKind === "world_package" || publishKind === "game" || publishKind === "resource") {
    state.publish.kind = publishKind;
  }
  if (publishKind === "world_package") {
    state.publish.sourceId = params.get("sourceWorldId") || "";
  } else if (publishKind === "game") {
    state.publish.sourceId = params.get("sourceGameId") || "";
  } else if (publishKind === "resource") {
    state.publish.sourceId = params.get("sourceAssetId") || "";
    state.publish.resourceKind = params.get("resourceKind") || state.publish.resourceKind;
  }
  syncPublishDefaults(true);
  renderPublishForm();
  setPublishOpen(true);
  state.prefillHandled = true;
}

async function publishListing(event) {
  event.preventDefault();
  if (!state.session) {
    setPublishStatus("Sign in first.");
    setAuthState({
      badge: "Sign in needed",
      text: "Sign in to publish to the public library.",
      authFormOpen: true,
    });
    return;
  }
  if (!state.publish.sourceId) {
    setPublishStatus("Choose an existing source first.");
    return;
  }
  if (!state.publish.mediaEntries.length) {
    setPublishStatus("Upload at least one preview image or video.");
    return;
  }
  if (state.publish.deliveryMode === "contact" && !state.publish.contactInstructions.trim()) {
    setPublishStatus("Add contact instructions for contact-only listings.");
    return;
  }
  state.publishLoading = true;
  setPublishStatus("Publishing listing...");
  try {
    const formData = new FormData();
    formData.set("kind", state.publish.kind);
    formData.set("title", state.publish.title);
    formData.set("description", state.publish.description);
    formData.set("deliveryMode", state.publish.deliveryMode);
    if (state.publish.kind === "world_package") {
      formData.set("sourceWorldId", state.publish.sourceId);
    } else if (state.publish.kind === "game") {
      formData.set("sourceGameId", state.publish.sourceId);
    } else {
      formData.set("sourceAssetId", state.publish.sourceId);
      formData.set("resourceKind", state.publish.resourceKind);
    }
    if (state.publish.deliveryMode === "contact") {
      formData.set("contactInstructions", state.publish.contactInstructions);
    }
    for (const entry of state.publish.mediaEntries) {
      formData.append("media", entry.file, entry.file.name);
    }
    const payload = await apiFetch("/library/listings", {
      method: "POST",
      body: formData,
    });
    setPublishStatus("Published.");
    setPublishOpen(false);
    resetPublishDraft();
    await loadSources();
    await loadListings();
    if (payload?.listing?.id) {
      await openListingDetail(payload.listing.id);
    }
  } catch (error) {
    setPublishStatus(error.message || "Could not publish that listing.");
  } finally {
    state.publishLoading = false;
  }
}

async function saveListingReview(event, listingId) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    state.detail.payload = await apiFetch(`/library/listings/${encodeURIComponent(listingId)}/review`, {
      method: "PUT",
      body: {
        rating: formData.get("rating"),
        comment: formData.get("comment"),
      },
    });
    renderDetail();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not save that review.");
  }
}

async function deleteListingReview(listingId) {
  try {
    state.detail.payload = await apiFetch(`/library/listings/${encodeURIComponent(listingId)}/review`, {
      method: "DELETE",
    });
    renderDetail();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not delete that review.");
  }
}

async function saveProfileReview(event, username) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    state.detail.payload = await apiFetch(`/library/profiles/${encodeURIComponent(username)}/review`, {
      method: "PUT",
      body: {
        rating: formData.get("rating"),
        comment: formData.get("comment"),
      },
    });
    renderDetail();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not save that creator review.");
  }
}

async function deleteProfileReview(username) {
  try {
    state.detail.payload = await apiFetch(`/library/profiles/${encodeURIComponent(username)}/review`, {
      method: "DELETE",
    });
    renderDetail();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not delete that creator review.");
  }
}

async function saveOwnerListing(event, listingId) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    state.detail.payload = await apiFetch(`/library/listings/${encodeURIComponent(listingId)}`, {
      method: "PATCH",
      body: {
        title: formData.get("title"),
        description: formData.get("description"),
        deliveryMode: formData.get("deliveryMode"),
        contactInstructions: formData.get("contactInstructions"),
        resourceKind: formData.get("resourceKind"),
        republishSnapshot: formData.get("republishSnapshot") === "true",
      },
    });
    renderDetail();
    await loadSources();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not save that listing.");
  }
}

async function archiveListing(listingId) {
  try {
    await apiFetch(`/library/listings/${encodeURIComponent(listingId)}`, {
      method: "DELETE",
    });
    setDetailOpen(false);
    await loadSources();
    await loadListings();
  } catch (error) {
    setBrowserStatus(error.message || "Could not archive that listing.");
  }
}

function handleResultsClick(event) {
  const openListing = event.target.closest("[data-library-open-listing]");
  if (openListing) {
    event.preventDefault();
    void openListingDetail(openListing.getAttribute("data-library-open-listing"));
    return;
  }
  const openCreator = event.target.closest("[data-library-open-creator]");
  if (openCreator) {
    event.preventDefault();
    void openCreatorDetail(openCreator.getAttribute("data-library-open-creator"));
  }
}

function handleDetailClick(event) {
  if (event.target.closest("[data-library-close-detail]")) {
    event.preventDefault();
    setDetailOpen(false);
    return;
  }
  const openCreator = event.target.closest("[data-library-open-creator]");
  if (openCreator) {
    event.preventDefault();
    void openCreatorDetail(openCreator.getAttribute("data-library-open-creator"));
    return;
  }
  const openListing = event.target.closest("[data-library-open-listing]");
  if (openListing) {
    event.preventDefault();
    void openListingDetail(openListing.getAttribute("data-library-open-listing"));
    return;
  }
  const deleteListingReviewButton = event.target.closest("[data-library-delete-listing-review]");
  if (deleteListingReviewButton) {
    event.preventDefault();
    void deleteListingReview(deleteListingReviewButton.getAttribute("data-library-delete-listing-review"));
    return;
  }
  const deleteProfileReviewButton = event.target.closest("[data-library-delete-profile-review]");
  if (deleteProfileReviewButton) {
    event.preventDefault();
    void deleteProfileReview(deleteProfileReviewButton.getAttribute("data-library-delete-profile-review"));
    return;
  }
  const archiveButton = event.target.closest("[data-library-archive-listing]");
  if (archiveButton) {
    event.preventDefault();
    void archiveListing(archiveButton.getAttribute("data-library-archive-listing"));
    return;
  }
  if (event.target.closest("[data-library-show-contact]")) {
    const card = elements.detailContent?.querySelector("[data-library-contact-card]");
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function handleDetailSubmit(event) {
  const listingReviewForm = event.target.closest("[data-library-listing-review-form]");
  if (listingReviewForm) {
    void saveListingReview(event, listingReviewForm.getAttribute("data-library-listing-review-form"));
    return;
  }
  const profileReviewForm = event.target.closest("[data-library-profile-review-form]");
  if (profileReviewForm) {
    void saveProfileReview(event, profileReviewForm.getAttribute("data-library-profile-review-form"));
    return;
  }
  const ownerForm = event.target.closest("[data-library-owner-form]");
  if (ownerForm) {
    void saveOwnerListing(event, ownerForm.getAttribute("data-library-owner-form"));
  }
}

function handleOwnerFormChange(event) {
  const ownerForm = event.target.closest("[data-library-owner-form]");
  if (!ownerForm) {
    return;
  }
  const select = ownerForm.querySelector('select[name="deliveryMode"]');
  const wrapper = ownerForm.querySelector("[data-library-owner-contact-wrapper]");
  if (wrapper) {
    wrapper.hidden = select?.value !== "contact";
  }
}

function openPublish() {
  if (!state.session) {
    setAuthState({
      badge: "Sign in needed",
      text: "Sign in to publish to the public library.",
      authFormOpen: true,
    });
    setBrowserStatus("Sign in first, then publish from this page.");
    return;
  }
  setPublishOpen(true);
}

function handlePublishKind(kind) {
  if (!kind || kind === state.publish.kind) {
    return;
  }
  state.publish.kind = kind;
  state.publish.sourceId = "";
  state.publish.resourceKind = "texture";
  state.publish.title = "";
  state.publish.description = "";
  state.publish.titleDirty = false;
  state.publish.descriptionDirty = false;
  syncPublishDefaults(true);
  renderPublishForm();
}

function handlePublishSourceChange() {
  state.publish.sourceId = String(elements.publishSource?.value ?? "");
  state.publish.titleDirty = false;
  state.publish.descriptionDirty = false;
  syncPublishDefaults(true);
  renderPublishForm();
}

function handlePublishMediaChange() {
  revokeMediaPreviewUrls();
  state.publish.mediaEntries = Array.from(elements.publishMedia?.files ?? []).map((file) => ({
    file,
    url: URL.createObjectURL(file),
  }));
  renderPublishForm();
}

function setPasswordVisibility(isVisible) {
  if (!elements.passwordInput || !elements.passwordToggle) {
    return;
  }
  elements.passwordInput.type = isVisible ? "text" : "password";
  elements.passwordToggle.textContent = isVisible ? "Hide" : "Show";
  elements.passwordToggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
  elements.passwordToggle.setAttribute("aria-pressed", isVisible ? "true" : "false");
}

function bindEvents() {
  elements.authToggle?.addEventListener("click", () => {
    setAuthState({
      badge: state.session && state.profile?.username
        ? `Signed in as @${state.profile.username}`
        : "Guest mode",
      text: state.session
        ? "Manage the creator identity shown on your public listings and reviews."
        : "Sign in to publish and review public listings.",
      authFormOpen: !state.authFormOpen,
    });
  });
  elements.signout?.addEventListener("click", async () => {
    try {
      await signOut();
      setBrowserStatus("Signed out.");
    } catch (error) {
      setBrowserStatus(error.message || "Could not sign out.");
    }
  });
  elements.authForm?.addEventListener("submit", handleAuthSubmit);
  elements.authForm?.querySelector('[data-auth-action="signup"]')?.addEventListener("click", async () => {
    try {
      await signUp();
    } catch (error) {
      setBrowserStatus(error.message || "Could not create that account.");
    }
  });
  elements.profileForm?.addEventListener("submit", saveProfile);
  elements.passwordToggle?.addEventListener("click", () => {
    setPasswordVisibility(elements.passwordInput?.type !== "text");
  });
  for (const button of elements.openPublishButtons) {
    button.addEventListener("click", () => openPublish());
  }
  elements.refresh?.addEventListener("click", () => {
    void loadListings();
  });
  elements.search?.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.query = String(elements.search?.value ?? "").trim();
    state.searchTimer = window.setTimeout(() => {
      void loadListings();
    }, 180);
  });
  elements.sort?.addEventListener("change", () => {
    state.sort = String(elements.sort?.value ?? "newest");
    void loadListings();
  });
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => {
      state.tab = button.getAttribute("data-library-tab") || "all";
      if (state.tab === "creators") {
        state.resourceKind = "";
      }
      updateFilterButtons();
      void loadListings();
    });
  }
  for (const button of elements.resourceFilterButtons) {
    button.addEventListener("click", () => {
      state.resourceKind = button.getAttribute("data-library-resource-kind") || "";
      updateFilterButtons();
      void loadListings();
    });
  }
  elements.results?.addEventListener("click", handleResultsClick);
  for (const button of elements.closeDetailButtons) {
    button.addEventListener("click", () => setDetailOpen(false));
  }
  for (const button of elements.closePublishButtons) {
    button.addEventListener("click", () => setPublishOpen(false));
  }
  elements.detailContent?.addEventListener("click", handleDetailClick);
  elements.detailContent?.addEventListener("submit", handleDetailSubmit);
  elements.detailContent?.addEventListener("change", handleOwnerFormChange);
  elements.publishForm?.addEventListener("submit", publishListing);
  for (const button of elements.publishKindButtons) {
    button.addEventListener("click", () => handlePublishKind(button.getAttribute("data-publish-kind") || "world_package"));
  }
  elements.publishSource?.addEventListener("change", handlePublishSourceChange);
  elements.publishResourceKind?.addEventListener("change", () => {
    state.publish.resourceKind = String(elements.publishResourceKind?.value ?? "texture");
    renderPublishForm();
  });
  elements.publishMedia?.addEventListener("change", handlePublishMediaChange);
  for (const button of elements.publishDeliveryButtons) {
    button.addEventListener("click", () => {
      state.publish.deliveryMode = button.getAttribute("data-publish-delivery") || "download";
      renderPublishForm();
    });
  }
  elements.publishTitle?.addEventListener("input", () => {
    state.publish.title = String(elements.publishTitle?.value ?? "");
    state.publish.titleDirty = true;
    renderPublishPreview();
  });
  elements.publishDescription?.addEventListener("input", () => {
    state.publish.description = String(elements.publishDescription?.value ?? "");
    state.publish.descriptionDirty = true;
    renderPublishPreview();
  });
  elements.publishContact?.addEventListener("input", () => {
    state.publish.contactInstructions = String(elements.publishContact?.value ?? "");
    renderPublishPreview();
  });
}

function initFromUrl() {
  const params = new URL(window.location.href).searchParams;
  const tab = params.get("tab");
  if (tab && ["all", "world_package", "game", "resource", "creators"].includes(tab)) {
    state.tab = tab;
  }
  const q = params.get("q");
  if (q) {
    state.query = q;
  }
  const sort = params.get("sort");
  if (sort === "top-rated") {
    state.sort = sort;
  }
  const resourceKind = params.get("resourceKind");
  if (resourceKind) {
    state.resourceKind = resourceKind;
  }
  updateFilterButtons();
}

bindEvents();
initFromUrl();
renderPublishForm();
void initAuth();
