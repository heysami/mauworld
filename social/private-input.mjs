export function normalizePrivateInputKey(event = {}) {
  const rawKey = typeof event?.key === "string" ? event.key : "";
  const normalizedKey = rawKey.toLowerCase();
  if (rawKey === " " || normalizedKey === "space" || normalizedKey === "spacebar") {
    return "space";
  }
  const normalizedCode = String(event?.code ?? "").trim().toLowerCase();
  if (normalizedCode === "space") {
    return "space";
  }
  return normalizedKey.trim();
}
