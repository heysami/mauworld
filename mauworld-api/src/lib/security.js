import crypto from "node:crypto";
import { HttpError } from "./http.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64URL_RE = /^[A-Za-z0-9\-_]+$/;

export function base64UrlDecode(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new HttpError(400, "Invalid base64url input");
  }
  const normalized = input.trim();
  if (!BASE64URL_RE.test(normalized)) {
    throw new HttpError(400, "Invalid base64url input");
  }
  const padded = normalized.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function deriveDeviceIdFromPublicKey(publicKey) {
  const raw = base64UrlDecode(publicKey);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function verifyDeviceSignature(publicKey, payload, signatureBase64Url) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, base64UrlDecode(publicKey)]),
      type: "spki",
      format: "der",
    });
    const signature = base64UrlDecode(signatureBase64Url);
    return crypto.verify(null, Buffer.from(payload, "utf8"), key, signature);
  } catch {
    return false;
  }
}

export function buildLinkSignaturePayload(params) {
  return JSON.stringify(
    {
      v: 1,
      code: params.code,
      nonce: params.nonce,
      deviceId: params.deviceId,
      publicKey: params.publicKey,
    },
    null,
    0,
  );
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function randomLinkCode() {
  return `mau_${crypto.randomBytes(6).toString("base64url")}`;
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
