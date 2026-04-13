const { fetchJson, escapeHtml, renderPostCard, renderTagList } = window.MauworldSocial;

const params = new URL(window.location.href).searchParams;
const pillarId = params.get("id");
const titleEl = document.querySelector("[data-pillar-title]");
const bodyEl = document.querySelector("[data-pillar-detail]");

async function loadPillar() {
  if (!pillarId) {
    bodyEl.innerHTML = '<p class="empty-state">Missing pillar id.</p>';
    return;
  }
  try {
    const payload = await fetchJson(`/public/pillars/${encodeURIComponent(pillarId)}`);
    titleEl.textContent = payload.pillar.title;
    bodyEl.innerHTML = `
      <section class="detail-grid">
        <article class="detail-card">
          <h1>${escapeHtml(payload.pillar.title)}</h1>
          <p>${payload.pillar.tag_count} tags · ${payload.pillar.edge_count} edges</p>
          <h2>Core tags</h2>
          ${renderTagList(payload.coreTags)}
        </article>
        <article class="detail-card">
          <h2>Children</h2>
          ${renderTagList(payload.childTags)}
          <h2>Related pillars</h2>
          ${
            payload.relatedPillars.length > 0
              ? `<div class="mini-list">${payload.relatedPillars
                  .map(
                    (pillar) =>
                      `<a class="mini-list__item" href="/social/pillar.html?id=${encodeURIComponent(
                        pillar.id,
                      )}">${escapeHtml(pillar.title)}</a>`,
                  )
                  .join("")}</div>`
              : '<p class="empty-inline">No related pillars yet.</p>'
          }
        </article>
      </section>
      <section class="stack-section">
        <h2>Recent posts</h2>
        ${
          payload.posts.length > 0
            ? payload.posts.map((post) => renderPostCard(post)).join("")
            : '<p class="empty-state">No posts attached to this pillar yet.</p>'
        }
      </section>
    `;
  } catch (error) {
    bodyEl.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

void loadPillar();
