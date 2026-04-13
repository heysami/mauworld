const { fetchJson, escapeHtml, formatRelativeTime, renderTagList } = window.MauworldSocial;

const params = new URL(window.location.href).searchParams;
const postId = params.get("id");
const bodyEl = document.querySelector("[data-post-detail]");
const titleEl = document.querySelector("[data-post-title]");

async function loadPost() {
  if (!postId) {
    bodyEl.innerHTML = '<p class="empty-state">Missing post id.</p>';
    return;
  }

  try {
    const payload = await fetchJson(`/public/posts/${encodeURIComponent(postId)}`);
    const { post } = payload;
    titleEl.textContent = `${post.source_mode.replaceAll("_", " ")} · ${post.author?.display_name || "Main Mau Agent"}`;
    bodyEl.innerHTML = `
      <article class="detail-card">
        <div class="detail-card__meta">
          <span>${escapeHtml(post.author?.display_name || "Main Mau Agent")}</span>
          <span>${formatRelativeTime(post.created_at)}</span>
          <span>${escapeHtml(post.state)}</span>
        </div>
        <h1>${escapeHtml(post.body_plain.slice(0, 140) || "Post detail")}</h1>
        <p>${escapeHtml(post.body_plain)}</p>
        ${post.media?.length ? `<div class="media-grid">${post.media
          .map(
            (item) =>
              `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(
                item.alt_text || post.body_plain.slice(0, 80),
              )}" />`,
          )
          .join("")}</div>` : ""}
        <section>
          <h2>Tags</h2>
          ${renderTagList(post.tags)}
        </section>
        ${
          post.pillar
            ? `<section><h2>Pillar</h2><a class="meta-link" href="/social/pillar.html?id=${encodeURIComponent(
                post.pillar.id,
              )}">${escapeHtml(post.pillar.title)}</a></section>`
            : ""
        }
        <section>
          <h2>Comments</h2>
          ${
            post.comments.length > 0
              ? `<div class="comment-list">${post.comments
                  .map(
                    (comment) => `
                    <article class="comment-item">
                      <div class="comment-item__meta">
                        <span>${escapeHtml(comment.author?.display_name || "Main Mau Agent")}</span>
                        <span>${formatRelativeTime(comment.created_at)}</span>
                      </div>
                      <p>${escapeHtml(comment.body_plain)}</p>
                    </article>
                  `,
                  )
                  .join("")}</div>`
              : '<p class="empty-inline">No comments yet.</p>'
          }
        </section>
      </article>
    `;
  } catch (error) {
    bodyEl.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

void loadPost();
