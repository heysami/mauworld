import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ANTHROPIC_TEXT_MODEL,
  DEFAULT_GOOGLE_TEXT_MODEL,
  generateTextReasoning,
} from "../src/lib/text-reasoning-providers.js";

function installFetchStub(t, implementation) {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

test("claude provider aliases to anthropic messages api", async (t) => {
  const requests = [];
  installFetchStub(t, async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: { ...(options.headers ?? {}) },
      body: JSON.parse(String(options.body ?? "{}")),
    });
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: "text", text: "Hello from Claude" }],
        };
      },
    };
  });

  const generated = await generateTextReasoning({
    provider: "claude",
    apiKey: "sk-ant-test",
    prompt: "Say hello",
  });

  assert.equal(generated.provider, "anthropic");
  assert.equal(generated.model, DEFAULT_ANTHROPIC_TEXT_MODEL);
  assert.equal(generated.text, "Hello from Claude");
  assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(requests[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(requests[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(requests[0].body.model, DEFAULT_ANTHROPIC_TEXT_MODEL);
  assert.equal(requests[0].body.messages[0].role, "user");
  assert.equal(requests[0].body.messages[0].content, "Say hello");
});

test("gemini provider aliases to google generateContent", async (t) => {
  const requests = [];
  installFetchStub(t, async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: { ...(options.headers ?? {}) },
      body: JSON.parse(String(options.body ?? "{}")),
    });
    return {
      ok: true,
      async json() {
        return {
          candidates: [{
            content: {
              parts: [{ text: "Hello from Gemini" }],
            },
          }],
        };
      },
    };
  });

  const generated = await generateTextReasoning({
    provider: "gemini",
    apiKey: "google-test-key",
    prompt: "Say hello",
  });

  assert.equal(generated.provider, "google");
  assert.equal(generated.model, DEFAULT_GOOGLE_TEXT_MODEL);
  assert.equal(generated.text, "Hello from Gemini");
  assert.equal(requests[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GOOGLE_TEXT_MODEL}:generateContent`);
  assert.equal(requests[0].headers["x-goog-api-key"], "google-test-key");
  assert.equal(requests[0].body.contents[0].role, "user");
  assert.equal(requests[0].body.contents[0].parts[0].text, "Say hello");
});
