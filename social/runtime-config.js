(function initMauworldRuntimeConfig() {
  function normalizeApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function isLocalApiBase(value) {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value);
  }

  function deriveApiBaseFromLocation() {
    const { origin, hostname, protocol } = window.location;
    if (!hostname) {
      return "";
    }

    if (hostname === "mauworld-api.onrender.com") {
      return `${origin}/api`;
    }

    if (hostname === "mauworld.onrender.com") {
      return `${protocol}//mauworld-api.onrender.com/api`;
    }

    return "";
  }

  const query = new URL(window.location.href).searchParams;
  const queryApiBase = normalizeApiBase(query.get("apiBase"));
  const runtimeApiBase = normalizeApiBase(window.__MAUWORLD_RUNTIME__?.apiBase);
  const storedApiBaseRaw = normalizeApiBase(window.localStorage.getItem("mauworldApiBase"));
  const metaApiBaseRaw = normalizeApiBase(
    document.querySelector('meta[name="mauworld-api-base"]')?.content,
  );
  const metaApiBase = metaApiBaseRaw.toLowerCase() === "auto" ? "" : metaApiBaseRaw;
  const storedApiBase =
    !storedApiBaseRaw
      ? ""
      : !isLocalApiBase(storedApiBaseRaw) || isLocalApiBase(window.location.origin)
        ? storedApiBaseRaw
        : "";
  const derivedApiBase = deriveApiBaseFromLocation();
  const renderDefaultApiBase = "https://mauworld-api.onrender.com/api";
  const fallbackApiBase = "/api";
  const isLocalOrigin = isLocalApiBase(window.location.origin);
  const preferredHostedApiBase =
    derivedApiBase
    || renderDefaultApiBase
    || fallbackApiBase;
  const apiBase =
    queryApiBase
    || runtimeApiBase
    || metaApiBase
    || (isLocalOrigin ? storedApiBase : "")
    || preferredHostedApiBase
    || storedApiBase
    || fallbackApiBase;

  if (queryApiBase) {
    window.localStorage.setItem("mauworldApiBase", apiBase);
  } else if (!isLocalOrigin && storedApiBase && storedApiBase !== apiBase) {
    window.localStorage.removeItem("mauworldApiBase");
  }

  window.__MAUWORLD__ = {
    apiBase,
  };
})();
