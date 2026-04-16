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
    async getPublicAuthConfig() {
      return {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      };
    },
    async verifyUserAccessToken() {
      return {
        user: { id: "auth_123" },
        profile: {
          id: "profile_123",
          username: "maker",
          display_name: "Maker",
        },
      };
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
    async streamCurrentWorld(input = {}) {
      return {
        worldSnapshotId: "world_123",
        organizationVersionId: "org_123",
        cellRange: { cellXMin: -1, cellXMax: 1, cellZMin: -1, cellZMax: 1 },
        requestedViewerSessionId: input.viewerSessionId ?? "",
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
    async exportPrivateWorld() {
      return {
        package: {
          format: "mauworld.private-world.v1",
          world: {
            name: "Lantern Hall",
          },
        },
      };
    },
    async queuePrivateWorldInput(_profile, payload) {
      return {
        accepted: true,
        player_entity_id: payload.key === "w" ? "player_one" : "player_two",
      };
    },
    async occupyPrivateWorldParticipant(_input) {
      return {
        occupied: true,
        player_entity_id: "player_one",
      };
    },
    async releasePrivateWorldParticipant() {
      return {
        released: true,
      };
    },
    async heartbeatPrivateWorldEntityLock() {
      return {
        lock: {
          scene_id: "scene_123",
          entity_key: "scene-json:scene_123",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
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

test("public auth config endpoint exposes client bootstrap settings", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app).get("/api/public/auth/config");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.supabaseUrl, "https://example.supabase.co");
  assert.equal(response.body.supabaseAnonKey, "anon-key");
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

test("public world stream forwards viewerSessionId for server-side miniature routing", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .get("/api/public/world/current/stream")
    .query({
      cell_x_min: -1,
      cell_x_max: 1,
      cell_z_min: -1,
      cell_z_max: 1,
      viewerSessionId: "viewer_123",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.requestedViewerSessionId, "viewer_123");
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

test("private world export endpoint returns a forkable package attachment", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .get("/api/private/worlds/mw_origin123/export")
    .query({ creatorUsername: "maker" })
    .set("Authorization", "Bearer token");

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.package.format, "mauworld.private-world.v1");
  assert.match(String(response.headers["content-disposition"] || ""), /mw_origin123\.mauworld\.json/i);
});

test("private world runtime input endpoint accepts player controls", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/private/worlds/mw_origin123/input")
    .set("Authorization", "Bearer token")
    .send({
      creatorUsername: "maker",
      key: "w",
      state: "down",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.player_entity_id, "player_one");
});

test("private world occupy endpoint claims a player slot explicitly", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/private/worlds/mw_origin123/participants/occupy")
    .set("Authorization", "Bearer token")
    .send({
      creatorUsername: "maker",
      playerEntityId: "player_one",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.occupied, true);
  assert.equal(response.body.player_entity_id, "player_one");
});

test("private world release endpoint returns the user to viewer mode", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/private/worlds/mw_origin123/participants/release")
    .set("Authorization", "Bearer token")
    .send({
      creatorUsername: "maker",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.released, true);
});

test("private world lock heartbeat endpoint renews a held lock", async () => {
  const app = createApp({
    config: { adminSecret: "admin", cronSecret: "cron" },
    store: createStubStore(),
  });

  const response = await request(app)
    .post("/api/private/worlds/mw_origin123/locks/heartbeat")
    .set("Authorization", "Bearer token")
    .send({
      creatorUsername: "maker",
      sceneId: "scene_123",
      entityKey: "scene-json:scene_123",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.lock.scene_id, "scene_123");
});
