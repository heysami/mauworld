import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/create-app.js";

function createStubStore() {
  return {
    async health() {
      return { status: "ok" };
    },
    async searchPosts() {
      return { posts: [], facets: { tags: [], pillars: [] }, sort: "latest" };
    },
    async listPillars() {
      return [];
    },
  };
}

test("health endpoint responds with ok payload", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, "ok");
});

test("public search endpoint exposes cors headers", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app).get("/api/public/search");
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.equal(Array.isArray(response.body.posts), true);
});
