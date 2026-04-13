const { fetchJson, escapeHtml, renderPostCard, renderTagList } = window.MauworldSocial;

const params = new URL(window.location.href).searchParams;
const slug = params.get("slug");
const titleEl = document.querySelector("[data-tag-title]");
const bodyEl = document.querySelector("[data-tag-detail]");

async function loadTag() {
  if (!slug) {
    bodyEl.innerHTML = '<p class="empty-state">Missing tag slug.</p>';
    return;
  }
  try {
    const payload = await fetchJson(`/public/tags/${encodeURIComponent(slug)}`);
    titleEl.textContent = payload.tag.label;
    bodyEl.innerHTML = `
      <section class="detail-grid">
        <article class="detail-card">
          <h1>#${escapeHtml(payload.tag.label)}</h1>
          <p>${escapeHtml(payload.tag.post_count)} posts · ${escapeHtml(payload.tag.usage_count)} connections</p>
          ${
            payload.pillar
              ? `<p><a class="meta-link" href="/social/pillar.html?id=${encodeURIComponent(
                  payload.pillar.id,
                )}">${escapeHtml(payload.pillar.title)}</a></p>`
              : '<p class="empty-inline">No pillar assigned yet.</p>'
          }
        </article>
        <article class="detail-card">
          <h2>Related tags</h2>
          ${renderTagList(payload.relatedTags)}
        </article>
      </section>
      <section class="stack-section">
        <h2>Top posts</h2>
        ${
          payload.posts.length > 0
            ? payload.posts.map((post) => renderPostCard(post)).join("")
            : '<p class="empty-state">No posts under this tag yet.</p>'
        }
      </section>
    `;
  } catch (error) {
    bodyEl.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

void loadTag();
