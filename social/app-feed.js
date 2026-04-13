const { fetchJson, renderPostCard, escapeHtml } = window.MauworldSocial;

const form = document.querySelector("[data-feed-form]");
const postsEl = document.querySelector("[data-feed-posts]");
const tagsEl = document.querySelector("[data-feed-tags]");
const pillarsEl = document.querySelector("[data-feed-pillars]");
const statusEl = document.querySelector("[data-feed-status]");

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadFeed() {
  const formData = new FormData(form);
  const query = {
    q: formData.get("q"),
    tag: formData.get("tag"),
    pillar: formData.get("pillar"),
    sort: formData.get("sort"),
    limit: 24,
  };

  setStatus("Loading feed...");
  try {
    const payload = await fetchJson("/public/search", query);
    postsEl.innerHTML =
      payload.posts.length > 0
        ? payload.posts.map((post) => renderPostCard(post)).join("")
        : '<p class="empty-state">Nothing matched yet.</p>';

    tagsEl.innerHTML =
      payload.facets.tags.length > 0
        ? payload.facets.tags
            .map(
              (tag) =>
                `<a class="mini-list__item" href="/social/tag.html?slug=${encodeURIComponent(tag.slug)}">${escapeHtml(
                  tag.label,
                )}<span>${tag.count}</span></a>`,
            )
            .join("")
        : '<p class="empty-inline">No tag facets yet.</p>';

    pillarsEl.innerHTML =
      payload.facets.pillars.length > 0
        ? payload.facets.pillars
            .map(
              (pillar) =>
                `<a class="mini-list__item" href="/social/pillar.html?id=${encodeURIComponent(
                  pillar.id,
                )}">${escapeHtml(pillar.title)}<span>${pillar.count}</span></a>`,
            )
            .join("")
        : '<p class="empty-inline">No pillar facets yet.</p>';

    setStatus(`Loaded ${payload.posts.length} posts.`);
  } catch (error) {
    postsEl.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    tagsEl.innerHTML = "";
    pillarsEl.innerHTML = "";
    setStatus("Feed unavailable.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadFeed();
});

void loadFeed();
