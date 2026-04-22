import { HttpError } from "./http.js";

function getBoundary(contentType = "") {
  const match = String(contentType ?? "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return String(match?.[1] ?? match?.[2] ?? "").trim();
}

function parseContentDisposition(headerValue = "") {
  const params = {};
  for (const segment of String(headerValue ?? "").split(";").slice(1)) {
    const [rawKey, ...rawValueParts] = segment.split("=");
    const key = String(rawKey ?? "").trim().toLowerCase();
    const joinedValue = rawValueParts.join("=");
    if (!key) {
      continue;
    }
    params[key] = String(joinedValue ?? "")
      .trim()
      .replace(/^"|"$/g, "");
  }
  return params;
}

export function parseMultipartFormData(buffer, contentType = "") {
  const boundary = getBoundary(contentType);
  if (!boundary) {
    throw new HttpError(400, "Multipart boundary is missing");
  }
  const normalizedBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const raw = normalizedBuffer.toString("latin1");
  const delimiter = `--${boundary}`;
  const chunks = raw.split(delimiter);
  const fields = {};
  const files = [];

  for (const chunk of chunks) {
    let part = String(chunk ?? "");
    if (!part || part === "--" || part === "--\r\n") {
      continue;
    }
    if (part.startsWith("\r\n")) {
      part = part.slice(2);
    }
    if (part.endsWith("\r\n")) {
      part = part.slice(0, -2);
    }
    if (part.endsWith("--")) {
      part = part.slice(0, -2);
    }
    if (!part.trim()) {
      continue;
    }
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      continue;
    }
    const headerBlock = part.slice(0, headerEnd);
    const bodyBlock = part.slice(headerEnd + 4);
    const headers = {};
    for (const line of headerBlock.split("\r\n")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      if (key) {
        headers[key] = value;
      }
    }
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    const fieldName = String(disposition.name ?? "").trim();
    if (!fieldName) {
      continue;
    }
    const filename = String(disposition.filename ?? "").trim();
    const bodyBuffer = Buffer.from(bodyBlock, "latin1");
    if (filename) {
      files.push({
        fieldName,
        filename,
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: bodyBuffer,
      });
      continue;
    }
    const value = bodyBuffer.toString("utf8");
    if (fieldName in fields) {
      if (Array.isArray(fields[fieldName])) {
        fields[fieldName].push(value);
      } else {
        fields[fieldName] = [fields[fieldName], value];
      }
    } else {
      fields[fieldName] = value;
    }
  }

  return {
    fields,
    files,
  };
}
