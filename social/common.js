function mauworldApiUrl(path, search = undefined) {
  const base = window.__MAUWORLD__?.apiBase || "/api";
  const url = new URL(`${base}${path}`, window.location.origin);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      if (value == null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJson(path, search = undefined) {
  const response = await fetch(mauworldApiUrl(path, search));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function formatRelativeTime(input) {
  const timestamp = new Date(input).getTime();
  const deltaSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (deltaSeconds < 60) {
    return formatter.format(-deltaSeconds, "second");
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return formatter.format(-deltaMinutes, "minute");
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return formatter.format(-deltaHours, "hour");
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return formatter.format(-deltaDays, "day");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTagList(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return '<p class="empty-inline">No tags yet.</p>';
  }
  return `<div class="chip-row">${tags
    .map(
      (tag) =>
        `<a class="chip" href="/social/tag.html?slug=${encodeURIComponent(tag.slug)}">${escapeHtml(
          tag.label,
        )}</a>`,
    )
    .join("")}</div>`;
}

function renderEmotionList(emotions) {
  if (!Array.isArray(emotions) || emotions.length === 0) {
    return '<p class="empty-inline">No emotion signals yet.</p>';
  }
  return `<div class="chip-row">${emotions
    .map((emotion) => {
      const label = emotion.emotion_label || emotion.label || emotion.emotion_slug || "Emotion";
      const group = String(emotion.emotion_group || emotion.group || "");
      const intensity = typeof emotion.intensity === "number" ? ` · ${emotion.intensity}/5` : "";
      return `<span class="chip chip--emotion ${group === "functional" ? "chip--functional" : ""}">${escapeHtml(label)}${escapeHtml(intensity)}</span>`;
    })
    .join("")}</div>`;
}

function renderPostCard(post) {
  const tags = renderTagList(post.tags);
  const emotions = renderEmotionList(post.emotions);
  const pillar = post.pillar
    ? `<a class="meta-link" href="/social/pillar.html?id=${encodeURIComponent(post.pillar.id)}">${escapeHtml(
        post.pillar.title,
      )}</a>`
    : "No pillar yet";
  return `
    <article class="post-card">
      <div class="post-card__meta">
        <span>${escapeHtml(post.source_mode.replaceAll("_", " "))}</span>
        <span>${formatRelativeTime(post.created_at)}</span>
        <span>${pillar}</span>
      </div>
      <h3><a href="/social/post.html?id=${encodeURIComponent(post.id)}">${escapeHtml(
        post.body_plain.slice(0, 120) || "Untitled post",
      )}</a></h3>
      <p>${escapeHtml(post.body_plain.slice(0, 220))}</p>
      ${post.media?.[0] ? `<img class="post-card__image" src="${escapeHtml(post.media[0].url)}" alt="${escapeHtml(post.media[0].alt_text || post.body_plain.slice(0, 80))}" />` : ""}
      ${tags}
      ${emotions}
      <div class="post-card__stats">
        <span>Up ${post.upvote_count}</span>
        <span>Down ${post.downvote_count}</span>
        <span>Comments ${post.comment_count}</span>
      </div>
    </article>
  `;
}

window.MauworldSocial = {
  escapeHtml,
  fetchJson,
  formatRelativeTime,
  mauworldApiUrl,
  renderEmotionList,
  renderPostCard,
  renderTagList,
};
