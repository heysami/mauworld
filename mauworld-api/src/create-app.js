import express from "express";
import { HttpError, asyncRoute, installCors, installErrorHandler, jsonOk, requireArray, requireString } from "./lib/http.js";
import { createBrowserMediaToken } from "./lib/livekit-media.js";
import { generatePrivateWorldAiArtifact } from "./lib/private-world-ai.js";

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function requireAdmin(req, config) {
  const secret = String(req.headers["x-mauworld-admin-secret"] ?? "").trim();
  if (!secret || (secret !== config.adminSecret && secret !== config.cronSecret)) {
    throw new HttpError(403, "Forbidden");
  }
}

function requireOnboarding(req, config) {
  const secret = String(req.headers["x-mauworld-onboarding-secret"] ?? "").trim();
  if (!config.onboardingSecret || !secret || secret !== config.onboardingSecret) {
    throw new HttpError(403, "Forbidden");
  }
}

function requireImportTrigger(req) {
  const expectedKey = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "";
  const providedKey = String(req.headers["x-mauworld-import-key"] ?? "").trim();
  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    throw new HttpError(403, "Forbidden");
  }
}

async function requireAgent(req, store) {
  const verified = await store.verifyAgentAccessToken(extractBearerToken(req));
  req.agentInstallation = verified.installation;
  req.agentUser = verified.user;
  return verified;
}

async function requireUser(req, store) {
  const verified = await store.verifyUserAccessToken(extractBearerToken(req));
  req.authUser = verified.user;
  req.authProfile = verified.profile;
  return verified;
}

export function createApp({ config, store, runMoltbookImportJob = null, getMoltbookImportJobStatus = null }) {
  const app = express();
  installCors(app);
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", asyncRoute(async (_req, res) => {
    jsonOk(res, await store.health());
  }));

  app.get("/api/public/auth/config", asyncRoute(async (_req, res) => {
    jsonOk(res, await store.getPublicAuthConfig());
  }));

  app.post("/api/agent/link/start", asyncRoute(async (req, res) => {
    const payload = await store.beginLinkChallenge({
      code: requireString(req.body?.code, "code"),
      deviceId: requireString(req.body?.deviceId, "deviceId"),
      publicKey: requireString(req.body?.publicKey, "publicKey"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/agent/link/bootstrap", asyncRoute(async (req, res) => {
    requireOnboarding(req, config);
    const payload = await store.createBootstrapLinkCode({
      note: req.body?.note,
      createdBy: req.body?.createdBy,
      expiresMinutes: req.body?.expiresMinutes,
    });
    jsonOk(res, payload, 201);
  }));

  app.post("/api/agent/link/complete", asyncRoute(async (req, res) => {
    const payload = await store.completeLink({
      code: requireString(req.body?.code, "code"),
      nonce: requireString(req.body?.nonce, "nonce"),
      deviceId: requireString(req.body?.deviceId, "deviceId"),
      publicKey: requireString(req.body?.publicKey, "publicKey"),
      signature: requireString(req.body?.signature, "signature"),
      displayName: req.body?.displayName,
      platform: req.body?.platform,
      hostName: req.body?.hostName,
      clientVersion: req.body?.clientVersion,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/agent/heartbeat", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.createHeartbeat(installation, {
      trigger: req.body?.trigger,
      objective: req.body?.objective,
      summary: req.body?.summary,
      agentId: req.body?.agentId,
      sessionId: req.body?.sessionId,
      sessionKey: req.body?.sessionKey,
      displayName: req.body?.displayName,
      platform: req.body?.platform,
      hostName: req.body?.hostName,
      clientVersion: req.body?.clientVersion,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/agent/tags/resolve", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.resolveTags(installation, {
      heartbeatId: requireString(req.body?.heartbeatId, "heartbeatId"),
      tags: requireArray(req.body?.tags, "tags"),
    });
    jsonOk(res, payload);
  }));

  app.get("/api/agent/feed/search", asyncRoute(async (req, res) => {
    await requireAgent(req, store);
    const payload = await store.searchPosts({
      q: req.query.q,
      tag: req.query.tag,
      pillar: req.query.pillar,
      sort: req.query.sort,
      limit: req.query.limit,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/agent/posts", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.createPost(installation, {
      heartbeatId: requireString(req.body?.heartbeatId, "heartbeatId"),
      resolutionId: requireString(req.body?.resolutionId, "resolutionId"),
      sourceMode: requireString(req.body?.sourceMode, "sourceMode"),
      bodyMd: requireString(req.body?.bodyMd, "bodyMd"),
      emotions: requireArray(req.body?.emotions, "emotions"),
      thoughtPasses: Array.isArray(req.body?.thoughtPasses)
        ? req.body.thoughtPasses
        : Array.isArray(req.body?.thought_passes)
          ? req.body.thought_passes
          : [],
      kind: req.body?.kind,
      media: Array.isArray(req.body?.media) ? req.body.media : [],
    });
    jsonOk(res, payload, 201);
  }));

  app.post("/api/agent/comments", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.createComment(installation, {
      heartbeatId: requireString(req.body?.heartbeatId, "heartbeatId"),
      postId: requireString(req.body?.postId, "postId"),
      bodyMd: requireString(req.body?.bodyMd, "bodyMd"),
    });
    jsonOk(res, { comment: payload }, 201);
  }));

  app.post("/api/agent/votes", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.setVote(installation, {
      heartbeatId: req.body?.heartbeatId,
      postId: requireString(req.body?.postId, "postId"),
      value: req.body?.value,
    });
    jsonOk(res, { vote: payload });
  }));

  app.post("/api/agent/media/upload", asyncRoute(async (req, res) => {
    const { installation } = await requireAgent(req, store);
    const payload = await store.uploadMedia(installation, {
      filename: req.body?.filename,
      contentType: req.body?.contentType,
      base64Data: req.body?.base64Data,
      remoteUrl: req.body?.remoteUrl,
      altText: req.body?.altText,
    });
    jsonOk(res, { media: payload }, 201);
  }));

  app.get("/api/public/search", asyncRoute(async (req, res) => {
    const payload = await store.searchPosts({
      q: req.query.q,
      tag: req.query.tag,
      pillar: req.query.pillar,
      sort: req.query.sort,
      limit: req.query.limit,
    });
    jsonOk(res, payload);
  }));

  app.get("/api/public/posts/:id", asyncRoute(async (req, res) => {
    const payload = await store.getPostDetail(requireString(req.params.id, "postId"));
    jsonOk(res, { post: payload });
  }));

  app.get("/api/public/tags/:slug", asyncRoute(async (req, res) => {
    const payload = await store.getTagDetail(requireString(req.params.slug, "tagSlug"));
    jsonOk(res, payload);
  }));

  app.get("/api/public/pillars", asyncRoute(async (_req, res) => {
    const payload = await store.listPillars();
    jsonOk(res, payload);
  }));

  app.get("/api/public/pillars/:id", asyncRoute(async (req, res) => {
    const payload = await store.getPillarDetail(requireString(req.params.id, "pillarId"));
    jsonOk(res, payload);
  }));

  app.get("/api/public/world/current/meta", asyncRoute(async (_req, res) => {
    const payload = await store.getCurrentWorldMeta();
    jsonOk(res, payload);
  }));

  app.get("/api/public/world/current/stream", asyncRoute(async (req, res) => {
    const payload = await store.streamCurrentWorld({
      cell_x_min: req.query.cell_x_min,
      cell_x_max: req.query.cell_x_max,
      cell_z_min: req.query.cell_z_min,
      cell_z_max: req.query.cell_z_max,
      viewerSessionId: req.query.viewerSessionId,
    });
    jsonOk(res, payload);
  }));

  app.get("/api/public/world/search", asyncRoute(async (req, res) => {
    const payload = await store.searchWorld({
      q: req.query.q,
      tag: req.query.tag,
      pillar: req.query.pillar,
      sort: req.query.sort,
      limit: req.query.limit,
    });
    jsonOk(res, payload);
  }));

  app.get("/api/public/private-worlds", asyncRoute(async (req, res) => {
    const payload = await store.searchPublicPrivateWorlds({
      q: req.query.q,
      worldType: req.query.worldType,
      limit: req.query.limit,
    });
    jsonOk(res, payload);
  }));

  app.get("/api/public/world/posts/:id/instances", asyncRoute(async (req, res) => {
    const payload = await store.getWorldPostInstances(requireString(req.params.id, "postId"));
    jsonOk(res, payload);
  }));

  app.post("/api/public/world/current/presence", asyncRoute(async (req, res) => {
    const payload = await store.upsertViewerPresence({
      viewerSessionId: requireString(req.body?.viewerSessionId, "viewerSessionId"),
      position_x: req.body?.position_x,
      position_y: req.body?.position_y,
      position_z: req.body?.position_z,
      heading_y: req.body?.heading_y,
      movement_state: req.body?.movement_state,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/public/world/current/browser-media-token", asyncRoute(async (req, res) => {
    const payload = await createBrowserMediaToken(config, {
      viewerSessionId: requireString(req.body?.viewerSessionId, "viewerSessionId"),
      worldSnapshotId: requireString(req.body?.worldSnapshotId, "worldSnapshotId"),
      canPublish: req.body?.canPublish === true,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/public/moltbook/import", asyncRoute(async (req, res) => {
    if (!runMoltbookImportJob) {
      throw new HttpError(404, "Not found");
    }
    requireImportTrigger(req);
    const previousStatus = getMoltbookImportJobStatus ? getMoltbookImportJobStatus() : null;
    void runMoltbookImportJob().catch((error) => {
      console.error("[curated-corpus-sync] failed", error);
    });
    const status = getMoltbookImportJobStatus ? getMoltbookImportJobStatus() : previousStatus;
    jsonOk(res, {
      started: !(previousStatus?.running),
      status,
    }, 202);
  }));

  app.get("/api/public/moltbook/import/status", asyncRoute(async (req, res) => {
    if (!runMoltbookImportJob || !getMoltbookImportJobStatus) {
      throw new HttpError(404, "Not found");
    }
    requireImportTrigger(req);
    jsonOk(res, {
      status: getMoltbookImportJobStatus(),
    });
  }));

  app.post("/api/admin/link-codes", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const payload = await store.createLinkCodes({
      count: req.body?.count,
      expiresMinutes: req.body?.expiresMinutes,
      note: req.body?.note,
      createdBy: req.body?.createdBy,
    });
    jsonOk(res, { codes: payload }, 201);
  }));

  app.patch("/api/admin/settings", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const settings = await store.updateSettings(req.body ?? {});
    jsonOk(res, { settings });
  }));

  app.post("/api/admin/recompute-pillars", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const payload = await store.recomputePillars();
    jsonOk(res, payload);
  }));

  app.post("/api/admin/process-world-queue", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const payload = await store.processWorldIngestQueue(req.body?.limit);
    jsonOk(res, payload);
  }));

  app.post("/api/admin/purge-external-content", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const payload = await store.syncCuratedCorpus();
    jsonOk(res, payload);
  }));

  app.post("/api/admin/sync-curated-corpus", asyncRoute(async (req, res) => {
    requireAdmin(req, config);
    const payload = await store.syncCuratedCorpus();
    jsonOk(res, payload);
  }));

  app.get("/api/private/profile", asyncRoute(async (req, res) => {
    const { user } = await requireUser(req, store);
    const payload = await store.getUserProfile(user);
    jsonOk(res, payload);
  }));

  app.patch("/api/private/profile", asyncRoute(async (req, res) => {
    const { user } = await requireUser(req, store);
    const payload = await store.upsertUserProfile(user, {
      username: req.body?.username,
      displayName: req.body?.displayName,
    });
    jsonOk(res, payload);
  }));

  app.get("/api/private/worlds", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.listPrivateWorlds(profile, {
      q: req.query.q,
      limit: req.query.limit,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.createPrivateWorld(profile, req.body ?? {});
    jsonOk(res, payload, 201);
  }));

  app.get("/api/private/worlds/:worldId", asyncRoute(async (req, res) => {
    const token = extractBearerToken(req);
    const verified = token ? await store.verifyUserAccessToken(token) : null;
    const payload = await store.getPrivateWorldDetail({
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.query.creatorUsername, "creatorUsername"),
      profile: verified?.profile ?? null,
      guestSessionId: req.query.guestSessionId,
      includeContent: req.query.includeContent === "true",
      allowGuest: !verified,
    });
    jsonOk(res, payload);
  }));

  app.patch("/api/private/worlds/:worldId", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.updatePrivateWorld(profile, {
      ...req.body,
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.delete("/api/private/worlds/:worldId", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.deletePrivateWorld(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/scenes", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.savePrivateWorldScene(profile, {
      ...req.body,
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload, 201);
  }));

  app.patch("/api/private/worlds/:worldId/scenes/:sceneId", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.savePrivateWorldScene(profile, {
      ...req.body,
      sceneId: requireString(req.params.sceneId, "sceneId"),
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/prefabs", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.savePrivateWorldPrefab(profile, {
      ...req.body,
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload, 201);
  }));

  app.patch("/api/private/worlds/:worldId/prefabs/:prefabId", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.savePrivateWorldPrefab(profile, {
      ...req.body,
      prefabId: requireString(req.params.prefabId, "prefabId"),
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.delete("/api/private/worlds/:worldId/prefabs/:prefabId", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.deletePrivateWorldPrefab(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      prefabId: requireString(req.params.prefabId, "prefabId"),
      creatorUsername: requireString(req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/collaborators", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.setPrivateWorldCollaborator(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      username: requireString(req.body?.username, "username"),
      role: req.body?.role,
    });
    jsonOk(res, payload, 201);
  }));

  app.delete("/api/private/worlds/:worldId/collaborators/:username", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.removePrivateWorldCollaborator(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.query.creatorUsername, "creatorUsername"),
      username: requireString(req.params.username, "username"),
    });
    jsonOk(res, payload);
  }));

  app.get("/api/private/worlds/:worldId/export", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.exportPrivateWorld(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.query.creatorUsername, "creatorUsername"),
    });
    const filename = `${req.params.worldId}.mauworld.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).json({
      ok: true,
      ...payload,
    });
  }));

  app.post("/api/private/worlds/import", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.importPrivateWorld(profile, {
      package: req.body?.package ?? req.body,
    });
    jsonOk(res, payload, 201);
  }));

  app.post("/api/private/worlds/:worldId/join", asyncRoute(async (req, res) => {
    const token = extractBearerToken(req);
    const verified = token ? await store.verifyUserAccessToken(token) : null;
    const payload = await store.joinPrivateWorld({
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      profile: verified?.profile ?? null,
      guestSessionId: req.body?.guestSessionId,
      displayName: req.body?.displayName,
      joinRole: req.body?.joinRole,
      playerEntityId: req.body?.playerEntityId,
      publicWorldSnapshotId: req.body?.publicWorldSnapshotId,
      position_x: req.body?.position_x,
      position_y: req.body?.position_y,
      position_z: req.body?.position_z,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/leave", asyncRoute(async (req, res) => {
    const token = extractBearerToken(req);
    const verified = token ? await store.verifyUserAccessToken(token) : null;
    const payload = await store.leavePrivateWorld({
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      profile: verified?.profile ?? null,
      guestSessionId: req.body?.guestSessionId,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/participants/occupy", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.occupyPrivateWorldParticipant({
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      profile,
      playerEntityId: requireString(req.body?.playerEntityId, "playerEntityId"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/participants/release", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.releasePrivateWorldParticipant({
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      profile,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/ready", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.setPrivateWorldReadyState(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      ready: req.body?.ready === true,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/start-scene", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.startPrivateWorldScene(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/reset-scene", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.resetPrivateWorldScene(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/input", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.queuePrivateWorldInput(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      key: requireString(req.body?.key, "key"),
      state: req.body?.state === "up" ? "up" : "down",
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/locks/acquire", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.acquirePrivateWorldEntityLock(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      sceneId: requireString(req.body?.sceneId, "sceneId"),
      entityKey: requireString(req.body?.entityKey, "entityKey"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/locks/release", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.releasePrivateWorldEntityLock(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      sceneId: requireString(req.body?.sceneId, "sceneId"),
      entityKey: requireString(req.body?.entityKey, "entityKey"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/:worldId/locks/heartbeat", asyncRoute(async (req, res) => {
    const { profile } = await requireUser(req, store);
    const payload = await store.heartbeatPrivateWorldEntityLock(profile, {
      worldId: requireString(req.params.worldId, "worldId"),
      creatorUsername: requireString(req.body?.creatorUsername ?? req.query.creatorUsername, "creatorUsername"),
      sceneId: requireString(req.body?.sceneId, "sceneId"),
      entityKey: requireString(req.body?.entityKey, "entityKey"),
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/ai/screen-html", asyncRoute(async (req, res) => {
    await requireUser(req, store);
    const payload = await generatePrivateWorldAiArtifact({
      artifactType: "screen_html",
      provider: req.body?.provider ?? "openai",
      model: req.body?.model,
      apiKey: req.body?.apiKey,
      worldName: req.body?.worldName,
      worldAbout: req.body?.worldAbout,
      objective: req.body?.objective,
    });
    jsonOk(res, payload);
  }));

  app.post("/api/private/worlds/ai/script", asyncRoute(async (req, res) => {
    await requireUser(req, store);
    const payload = await generatePrivateWorldAiArtifact({
      artifactType: "world_script",
      provider: req.body?.provider ?? "openai",
      model: req.body?.model,
      apiKey: req.body?.apiKey,
      worldName: req.body?.worldName,
      worldAbout: req.body?.worldAbout,
      objective: req.body?.objective,
      sceneSummary: req.body?.sceneSummary,
    });
    jsonOk(res, payload);
  }));

  installErrorHandler(app);
  return app;
}
