import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/create-app.js";

function createStubStore() {
  return {
    async health() {
      return { status: "ok" };
    },
    async verifyAgentAccessToken() {
      return {
        installation: { id: "inst_123" },
        user: { id: "user_123" },
      };
    },
    async createBootstrapLinkCode() {
      return { code: "mau_bootstrap_123" };
    },
    async createPost(_installation, payload) {
      return {
        post: {
          id: "post_123",
          emotions: payload.emotions,
          thought_passes: payload.thoughtPasses ?? [],
        },
        worldQueueStatus: "queued",
        estimatedSceneDelayMs: 5000,
      };
    },
    async searchPosts() {
      return {
        posts: [],
        facets: { tags: [], pillars: [] },
        sort: "latest",
        organization: { current: null, next: null },
      };
    },
    async getCurrentWorldMeta() {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        status: "ready",
        bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 },
        renderer: {},
        queueLag: { pendingCount: 0, processingCount: 0, estimatedDelayMs: 0 },
      };
    },
    async streamCurrentWorld() {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        cellRange: { cellXMin: -1, cellXMax: 1, cellZMin: -1, cellZMax: 1 },
        pillars: [],
        tags: [],
        postInstances: [],
        presence: [],
      };
    },
    async searchWorld() {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        sort: "latest",
        hits: [],
      };
    },
    async getWorldPostInstances() {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        post: null,
        instances: [],
      };
    },
    async upsertViewerPresence() {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        session: {
          id: "presence_123",
          actor_type: "viewer",
          viewer_session_id: "viewer_123",
        },
      };
    },
    async processWorldIngestQueue() {
      return {
        processedCount: 0,
        refreshedTagCount: 0,
        queue: { pendingCount: 0, processingCount: 0, estimatedDelayMs: 0 },
      };
    },
    async listPillars() {
      return {
        pillars: [],
        organization: { current: null, next: null },
      };
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
  assert.equal(typeof response.body.organization, "object");
});

test("bootstrap link endpoint requires onboarding secret", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron", onboardingSecret: "bootstrap" },
    store: createStubStore(),
  });

  const response = await request(app).post("/api/agent/link/bootstrap").send({});
  assert.equal(response.status, 403);
});

test("bootstrap link endpoint returns a one-time code", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron", onboardingSecret: "bootstrap" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/agent/link/bootstrap")
    .set("X-Mauworld-Onboarding-Secret", "bootstrap")
    .send({});

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.code, "mau_bootstrap_123");
});

test("agent post endpoint requires emotions", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/agent/posts")
    .set("Authorization", "Bearer token")
    .send({
      heartbeatId: "hb_123",
      resolutionId: "res_123",
      sourceMode: "learning",
      bodyMd: "A useful thing",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("agent post endpoint includes world queue metadata", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/agent/posts")
    .set("Authorization", "Bearer token")
    .send({
      heartbeatId: "hb_123",
      resolutionId: "res_123",
      sourceMode: "learning",
      bodyMd: "A useful thing",
      emotions: [],
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.post.id, "post_123");
  assert.equal(response.body.worldQueueStatus, "queued");
  assert.equal(response.body.estimatedSceneDelayMs, 5000);
});

test("agent post endpoint forwards optional thought passes", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/agent/posts")
    .set("Authorization", "Bearer token")
    .send({
      heartbeatId: "hb_123",
      resolutionId: "res_123",
      sourceMode: "learning",
      bodyMd: "Final useful thing",
      emotions: [],
      thoughtPasses: [
        { stage: "draft", bodyMd: "First draft" },
        { stage: "revision", bodyMd: "Second draft" },
        { stage: "revision", bodyMd: "Third draft" },
      ],
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.post.thought_passes.length, 3);
  assert.equal(response.body.post.thought_passes[0].bodyMd, "First draft");
});

test("public world meta endpoint exposes the current snapshot contract", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app).get("/api/public/world/current/meta");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.worldSnapshotId, "world_123");
});

test("public world presence endpoint upserts viewer sessions", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/public/world/current/presence")
    .send({
      viewerSessionId: "viewer_123",
      position_x: 12,
      position_y: 4,
      position_z: -8,
      heading_y: 1.25,
      movement_state: { moving: true },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.worldSnapshotId, "world_123");
  assert.equal(response.body.session.id, "presence_123");
});

test("browser media token endpoint reports disabled when LiveKit is not configured", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/public/world/current/browser-media-token")
    .send({
      viewerSessionId: "viewer_123",
      worldSnapshotId: "world_123",
      canPublish: true,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.token, "");
});

test("public moltbook import endpoint is unavailable without an import job", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app).post("/api/public/moltbook/import").send({});
  assert.equal(response.status, 404);
});

test("public moltbook import endpoint swallows background job rejection", async () => {
  const originalCommit = process.env.RENDER_GIT_COMMIT;
  process.env.RENDER_GIT_COMMIT = "abcdef1234567";
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    errors.push(args.join(" "));
  };

  try {
    const app = createApp({
      config: { adminSecret: "admin", cronSecret: "cron" },
      store: createStubStore(),
      runMoltbookImportJob: async () => {
        throw new Error("boom");
      },
      getMoltbookImportJobStatus: () => ({
        running: false,
        state: "idle",
      }),
    });

    const response = await request(app)
      .post("/api/public/moltbook/import")
      .set("x-mauworld-import-key", "abcdef1")
      .send({});

    assert.equal(response.status, 202);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors.some((entry) => entry.includes("[curated-corpus-sync] failed")), true);
  } finally {
    console.error = originalConsoleError;
    if (originalCommit === undefined) {
      delete process.env.RENDER_GIT_COMMIT;
    } else {
      process.env.RENDER_GIT_COMMIT = originalCommit;
    }
  }
});
