import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const elements = {
  authCard: document.querySelector("[data-mauworld-auth-card]"),
  authBadge: document.querySelector("[data-mauworld-auth-badge]"),
  authTitle: document.querySelector("[data-mauworld-auth-title]"),
  authCopy: document.querySelector("[data-mauworld-auth-copy]"),
  authPublic: document.querySelector("[data-mauworld-auth-public]"),
  authShare: document.querySelector("[data-mauworld-auth-share]"),
  authVoice: document.querySelector("[data-mauworld-auth-voice]"),
  authPrivate: document.querySelector("[data-mauworld-auth-private]"),
  authMeta: document.querySelector("[data-mauworld-auth-meta]"),
  secondaryLabel: document.querySelector("[data-mauworld-secondary-label]"),
  secondaryLabelFooter: document.querySelector("[data-mauworld-secondary-label-footer]"),
};

let lastAuthRequestId = 0;
const revealSections = [...document.querySelectorAll("[data-mauworld-reveal]")];

function mauworldApiUrl(path) {
  const resolver = window.MauworldSocial?.mauworldApiUrl;
  if (typeof resolver === "function") {
    return resolver(path);
  }
  return new URL(`/api${String(path ?? "")}`, window.location.origin).toString();
}

async function fetchMauworldJson(path, options = {}) {
  const response = await fetch(mauworldApiUrl(path), {
    method: options.method ?? "GET",
    headers: {
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function setCapability(node, label, state) {
  if (!node) {
    return;
  }
  node.textContent = label;
  node.dataset.state = state;
}

function setPrivateWorldCta(label) {
  if (elements.secondaryLabel) {
    elements.secondaryLabel.textContent = label;
  }
  if (elements.secondaryLabelFooter) {
    elements.secondaryLabelFooter.textContent = label;
  }
}

function initRevealMotion() {
  if (!revealSections.length) {
    return;
  }
  for (const section of revealSections) {
    section.classList.add("is-visible");
  }
}

function renderAuthCard({
  state,
  badge,
  title,
  copy,
  meta,
  shareStatus,
  voiceStatus,
  privateStatus,
  privateLabel,
}) {
  if (elements.authCard) {
    elements.authCard.dataset.authState = state;
  }
  if (elements.authBadge) {
    elements.authBadge.textContent = badge;
  }
  if (elements.authTitle) {
    elements.authTitle.textContent = title;
  }
  if (elements.authCopy) {
    elements.authCopy.textContent = copy;
  }
  if (elements.authMeta) {
    elements.authMeta.textContent = meta;
  }
  setCapability(elements.authPublic, "Ready now", "ready");
  setCapability(elements.authShare, shareStatus.label, shareStatus.state);
  setCapability(elements.authVoice, voiceStatus.label, voiceStatus.state);
  setCapability(elements.authPrivate, privateStatus.label, privateStatus.state);
  setPrivateWorldCta(privateLabel);
}

async function loadProfile(accessToken) {
  return fetchMauworldJson("/private/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function syncSessionState(session = null) {
  const requestId = lastAuthRequestId + 1;
  lastAuthRequestId = requestId;

  if (!session?.access_token) {
    renderAuthCard({
      state: "signed-out",
      badge: "Guest mode",
      title: "You are not logged in yet",
      copy: "Public World still works in guest mode. Sign in when you want nearby sharing, persistent voice, and your own private worlds.",
      meta: "Guest chat, reactions, live browsing, and search are still available from Public World.",
      shareStatus: { label: "Sign in first", state: "locked" },
      voiceStatus: { label: "Sign in first", state: "locked" },
      privateStatus: { label: "Sign in first", state: "locked" },
      privateLabel: "Sign In for Private Worlds",
    });
    return;
  }

  let profile = null;
  try {
    profile = await loadProfile(session.access_token);
  } catch (error) {
    console.warn("Could not load Mauworld profile for overview page.", error);
  }

  if (requestId !== lastAuthRequestId) {
    return;
  }

  const username = String(profile?.username ?? "").trim();
  renderAuthCard({
    state: "signed-in",
    badge: "Signed in",
    title: username ? `Signed in as @${username}` : "Your Mauworld session is active",
    copy: "Your account is ready for Public World, nearby sharing, persistent voice, and private worlds.",
    meta: username
      ? `Signed-in identity detected through the same auth flow used by Mauworld itself.`
      : "Signed in now. If you still need a username, you can finish that inside Private Worlds.",
    shareStatus: { label: "Ready now", state: "ready" },
    voiceStatus: { label: "Ready now", state: "ready" },
    privateStatus: { label: "Ready now", state: "ready" },
    privateLabel: "Open Private Worlds",
  });
}

async function initAuthCard() {
  renderAuthCard({
    state: "checking",
    badge: "Checking account",
    title: "Looking for your Mauworld session",
    copy: "Public World still works even if you stay a guest.",
    meta: "We are checking the same auth setup used by the public and private world pages.",
    shareStatus: { label: "Checking", state: "checking" },
    voiceStatus: { label: "Checking", state: "checking" },
    privateStatus: { label: "Checking", state: "checking" },
    privateLabel: "Open Private Worlds",
  });

  try {
    const authConfig = await fetchMauworldJson("/public/auth/config");
    const supabase = createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    await syncSessionState(data.session);
    supabase.auth.onAuthStateChange((_event, session) => {
      void syncSessionState(session);
    });
  } catch (error) {
    console.error("Could not initialize Mauworld auth on the overview page.", error);
    renderAuthCard({
      state: "error",
      badge: "Account check unavailable",
      title: "Could not confirm your login status right now",
      copy: "Public World is still available. If the auth service comes back, the world pages will keep working from there.",
      meta: "This usually means the Mauworld API or auth provider was unreachable for a moment.",
      shareStatus: { label: "Try again later", state: "locked" },
      voiceStatus: { label: "Try again later", state: "locked" },
      privateStatus: { label: "Try again later", state: "locked" },
      privateLabel: "Open Private Worlds",
    });
  }
}

initRevealMotion();
void initAuthCard();
