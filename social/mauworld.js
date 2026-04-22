import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const elements = {
  authInline: document.querySelector("[data-mauworld-auth-inline]"),
  authBadge: document.querySelector("[data-mauworld-auth-badge]"),
  authText: document.querySelector("[data-mauworld-auth-text]"),
  authLink: document.querySelector("[data-mauworld-auth-link]"),
  authLinkLabel: document.querySelector("[data-mauworld-auth-link-label]"),
};

let lastAuthRequestId = 0;

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

function renderAuthState({ state, badge, text, linkLabel }) {
  if (elements.authInline) {
    elements.authInline.dataset.authState = state;
  }
  if (elements.authBadge) {
    elements.authBadge.textContent = badge;
  }
  if (elements.authText) {
    elements.authText.textContent = text;
  }
  if (elements.authLinkLabel) {
    elements.authLinkLabel.textContent = linkLabel;
  }
  if (elements.authLink) {
    elements.authLink.setAttribute("aria-label", linkLabel);
  }
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
    renderAuthState({
      state: "signed-out",
      badge: "Guest mode",
      text: "You are not signed in. Public World works now. Sign in when you want private worlds and nearby sharing.",
      linkLabel: "Sign in for Private Worlds",
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
  renderAuthState({
    state: "signed-in",
    badge: "Signed in",
    text: username
      ? `Signed in as @${username}. Private Worlds and nearby sharing are ready.`
      : "Signed in. Private Worlds and nearby sharing are ready.",
    linkLabel: "Open Private Worlds",
  });
}

async function initAuthState() {
  renderAuthState({
    state: "checking",
    badge: "Checking account",
    text: "Looking for your Mauworld session. Public World works either way.",
    linkLabel: "Private Worlds",
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
    renderAuthState({
      state: "error",
      badge: "Status unavailable",
      text: "Could not confirm your login right now. Public World is still available.",
      linkLabel: "Private Worlds",
    });
  }
}

void initAuthState();
