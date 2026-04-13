(function initMauworldRuntimeConfig() {
  const query = new URL(window.location.href).searchParams;
  const queryApiBase = query.get("apiBase");
  const storedApiBase = window.localStorage.getItem("mauworldApiBase");
  const metaApiBase = document.querySelector('meta[name="mauworld-api-base"]')?.content?.trim();
  const fallbackApiBase = "/api";
  const apiBase = (queryApiBase || metaApiBase || storedApiBase || fallbackApiBase).replace(/\/+$/, "");

  if (queryApiBase) {
    window.localStorage.setItem("mauworldApiBase", apiBase);
  }

  window.__MAUWORLD__ = {
    apiBase,
  };
})();
