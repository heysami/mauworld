import test from "node:test";
import assert from "node:assert/strict";
import { parseMultipartFormData } from "../src/lib/multipart.js";

test("parseMultipartFormData reads fields, repeated fields, and files", () => {
  const boundary = "----mauworld-boundary";
  const body = Buffer.from(
    `--${boundary}\r
Content-Disposition: form-data; name="kind"\r
\r
resource\r
--${boundary}\r
Content-Disposition: form-data; name="resourceKind"\r
\r
animation\r
--${boundary}\r
Content-Disposition: form-data; name="tag"\r
\r
featured\r
--${boundary}\r
Content-Disposition: form-data; name="tag"\r
\r
looping\r
--${boundary}\r
Content-Disposition: form-data; name="media"; filename="preview.png"\r
Content-Type: image/png\r
\r
PNGDATA\r
--${boundary}--\r
`,
    "latin1",
  );

  const parsed = parseMultipartFormData(body, `multipart/form-data; boundary=${boundary}`);

  assert.equal(parsed.fields.kind, "resource");
  assert.equal(parsed.fields.resourceKind, "animation");
  assert.deepEqual(parsed.fields.tag, ["featured", "looping"]);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].fieldName, "media");
  assert.equal(parsed.files[0].filename, "preview.png");
  assert.equal(parsed.files[0].contentType, "image/png");
  assert.deepEqual(parsed.files[0].buffer, Buffer.from("PNGDATA", "latin1"));
});

test("parseMultipartFormData rejects missing multipart boundaries", () => {
  assert.throws(
    () => parseMultipartFormData(Buffer.from(""), "multipart/form-data"),
    /Multipart boundary is missing/,
  );
});
