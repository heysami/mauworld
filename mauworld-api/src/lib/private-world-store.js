import { HttpError } from "./http.js";
import {
  PRIVATE_WORLD_LIMITS,
  buildPrivateWorldExportPackage,
  buildPrivateWorldSearchText,
  compileSceneDoc,
  computeMiniatureDimensions,
  createDefaultSceneDoc,
  generatePrivateWorldId,
  normalizeSceneDoc,
  normalizeUsername,
  resolvePrivateWorldSize,
  sanitizeWorldText,
  validatePrivateWorldExportPackage,
} from "./private-worlds.js";

function nowIso() {
  return new Date().toISOString();
}

async function must(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error) {
    throw new HttpError(500, message, error.message);
  }
  return data;
}

async function maybeSingle(dataPromise, message) {
  const { data, error } = await dataPromise;
  if (error && error.code !== "PGRST116") {
    throw new HttpError(500, message, error.message);
  }
  return data ?? null;
}

function dedupe(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clampLimit(value, fallback = 20, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(numeric));
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getMiniatureLongestSide(entry = {}) {
  return Math.max(asNumber(entry.miniature_width, 0), asNumber(entry.miniature_length, 0), 1);
}

function getMiniatureCollisionRadius(entry = {}) {
  return Math.max(getMiniatureLongestSide(entry) / 2, 1);
}

function getMiniatureSafetyMargin(left = {}, right = {}) {
  return Math.max(2, 0.15 * Math.max(getMiniatureLongestSide(left), getMiniatureLongestSide(right)));
}

function buildMiniatureDistanceBands(entry = {}) {
  const longestSide = getMiniatureLongestSide(entry);
  const nearDistance = Math.max(54, Math.min(112, 46 + longestSide * 2.8));
  const midDistance = Math.max(118, Math.min(250, nearDistance * 2.2));
  return {
    nearDistance,
    midDistance,
  };
}

function resolveMiniatureLodBand(entry = {}, viewerPosition = null) {
  if (!viewerPosition) {
    return "far";
  }
  const { nearDistance, midDistance } = buildMiniatureDistanceBands(entry);
  const dx = asNumber(entry.anchor_position_x) - asNumber(viewerPosition.position_x);
  const dy = asNumber(entry.anchor_position_y) - asNumber(viewerPosition.position_y);
  const dz = asNumber(entry.anchor_position_z) - asNumber(viewerPosition.position_z);
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= nearDistance) {
    return "near";
  }
  if (distance <= midDistance) {
    return "mid";
  }
  return "far";
}

async function loadViewerPresenceForSnapshot(store, worldSnapshotId, viewerSessionId) {
  const snapshotId = String(worldSnapshotId ?? "").trim();
  const sessionId = String(viewerSessionId ?? "").trim();
  if (!snapshotId || !sessionId) {
    return null;
  }
  return await maybeSingle(
    store.serviceClient
      .from("live_presence_sessions")
      .select("*")
      .eq("world_snapshot_id", snapshotId)
      .eq("viewer_session_id", sessionId)
      .gt("expires_at", nowIso())
      .maybeSingle(),
    "Could not load viewer presence for miniature routing",
  );
}

async function findNearestPrivateWorldAnchor(store, currentWorld, requestedPosition = {}, miniature = {}, excludeWorldRowId = null) {
  const worldSnapshotId = String(currentWorld?.worldSnapshot?.id ?? "").trim();
  const cellSize = Math.max(16, Math.floor(asNumber(currentWorld?.settings?.world_cell_size, 64)));
  const requested = {
    x: asNumber(requestedPosition.x),
    y: asNumber(requestedPosition.y),
    z: asNumber(requestedPosition.z),
  };
  const activeInstances = await must(
    store.serviceClient
      .from("private_world_active_instances")
      .select("*")
      .eq("anchor_world_snapshot_id", worldSnapshotId),
    "Could not load active private world anchors",
  );
  const blockers = activeInstances.filter((entry) => entry.world_id !== excludeWorldRowId);
  const withinSearch = [];
  for (let ring = 0; ring <= 6; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
          continue;
        }
        withinSearch.push({
          x: Number((requested.x + dx * cellSize).toFixed(4)),
          y: requested.y,
          z: Number((requested.z + dz * cellSize).toFixed(4)),
        });
      }
    }
  }
  withinSearch.sort((left, right) => {
    const leftDistance = Math.hypot(left.x - requested.x, left.z - requested.z);
    const rightDistance = Math.hypot(right.x - requested.x, right.z - requested.z);
    return leftDistance - rightDistance;
  });

  for (const candidate of withinSearch) {
    const collides = blockers.some((entry) => {
      const margin = getMiniatureSafetyMargin(miniature, entry);
      const minDistance = getMiniatureCollisionRadius(miniature) + getMiniatureCollisionRadius(entry) + margin;
      return Math.hypot(candidate.x - asNumber(entry.anchor_position_x), candidate.z - asNumber(entry.anchor_position_z)) < minDistance;
    });
    if (!collides) {
      return {
        x: candidate.x,
        y: candidate.y,
        z: candidate.z,
        cellX: Math.floor(candidate.x / Math.max(1, cellSize)),
        cellZ: Math.floor(candidate.z / Math.max(1, cellSize)),
      };
    }
  }
  return null;
}

function buildDisplayName(user = {}, fallbackUsername = "user") {
  const metadataName = String(
    user.user_metadata?.display_name
    ?? user.user_metadata?.full_name
    ?? user.user_metadata?.name
    ?? "",
  ).trim();
  if (metadataName) {
    return metadataName.slice(0, 80);
  }
  const emailPrefix = String(user.email ?? "").split("@")[0].trim();
  return (emailPrefix || fallbackUsername || "user").slice(0, 80);
}

function sanitizeParticipantDisplayName(value, fallback = "viewer") {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function resolveCollaboratorRole(role) {
  return lower(role) === "editor" ? "editor" : "creator";
}

function resolveJoinRole(role) {
  const value = lower(role);
  if (value === "player") {
    return "player";
  }
  if (value === "editor") {
    return "editor";
  }
  if (value === "guest") {
    return "guest";
  }
  return "viewer";
}

function isExpired(timestamp) {
  return !timestamp || new Date(timestamp).getTime() <= Date.now();
}

function createPermissionSummary({ collaboratorRole = null, requesterProfileId = "" } = {}, world = {}) {
  const isCreator = collaboratorRole === "creator" || String(world.creator_profile_id ?? "") === String(requesterProfileId ?? "");
  const canEdit = collaboratorRole === "creator" || collaboratorRole === "editor";
  return {
    role: collaboratorRole,
    is_creator: isCreator,
    can_edit: canEdit,
    can_export: Boolean(requesterProfileId),
    can_join: Boolean(requesterProfileId),
  };
}

async function loadProfilesByIds(store, profileIds = []) {
  const ids = dedupe(profileIds);
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await must(
    store.serviceClient.from("user_profiles").select("*").in("id", ids),
    "Could not load user profiles",
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function findAvailableUsername(store, user, requestedUsername = "") {
  const explicit = requestedUsername ? normalizeUsername(requestedUsername) : "";
  const baseSeed = explicit
    || normalizeUsername(
      (String(user.email ?? "").split("@")[0] || String(user.id ?? "").slice(0, 8) || "user"),
    );
  for (let index = 0; index < 200; index += 1) {
    const candidate = index === 0 ? baseSeed : `${baseSeed}-${index + 1}`;
    const existing = await maybeSingle(
      store.serviceClient.from("user_profiles").select("id").eq("username", candidate).maybeSingle(),
      "Could not check user profile username",
    );
    if (!existing) {
      return candidate;
    }
  }
  throw new HttpError(409, "Could not allocate a unique username");
}

async function ensureUserProfile(store, user, input = {}) {
  const authUserId = String(user?.id ?? "").trim();
  if (!authUserId) {
    throw new HttpError(401, "Missing authenticated user");
  }

  const existing = await maybeSingle(
    store.serviceClient.from("user_profiles").select("*").eq("auth_user_id", authUserId).maybeSingle(),
    "Could not load user profile",
  );
  if (existing) {
    const updates = {};
    if (input.username && lower(input.username) !== lower(existing.username)) {
      updates.username = await findAvailableUsername(store, user, input.username);
    }
    if (typeof input.displayName === "string") {
      updates.display_name = sanitizeParticipantDisplayName(input.displayName, existing.display_name || existing.username);
    }
    if (Object.keys(updates).length > 0) {
      updates.search_text = [updates.username ?? existing.username, updates.display_name ?? existing.display_name].join(" ").trim();
      updates.updated_at = nowIso();
      return await must(
        store.serviceClient.from("user_profiles").update(updates).eq("id", existing.id).select("*").single(),
        "Could not update user profile",
      );
    }
    return existing;
  }

  const username = await findAvailableUsername(store, user, input.username);
  const profile = await must(
    store.serviceClient
      .from("user_profiles")
      .insert({
        auth_user_id: authUserId,
        username,
        display_name: sanitizeParticipantDisplayName(input.displayName, buildDisplayName(user, username)),
        search_text: `${username} ${buildDisplayName(user, username)}`.trim(),
      })
      .select("*")
      .single(),
    "Could not create user profile",
  );
  return profile;
}

async function loadWorldByExactReference(store, worldId, creatorUsername) {
  const world = await maybeSingle(
    store.serviceClient.from("private_worlds").select("*").eq("world_id", worldId).maybeSingle(),
    "Could not load private world",
  );
  if (!world) {
    throw new HttpError(404, "Private world not found");
  }
  const creator = await maybeSingle(
    store.serviceClient.from("user_profiles").select("*").eq("id", world.creator_profile_id).maybeSingle(),
    "Could not load private world creator",
  );
  if (!creator) {
    throw new HttpError(500, "Private world creator is missing");
  }
  if (creatorUsername && lower(creator.username) !== lower(creatorUsername)) {
    throw new HttpError(404, "Private world creator username did not match the world id");
  }
  return {
    world,
    creator,
  };
}

async function loadWorldCollaborators(store, worldRowId) {
  const rows = await must(
    store.serviceClient.from("private_world_collaborators").select("*").eq("world_id", worldRowId),
    "Could not load private world collaborators",
  );
  const profileMap = await loadProfilesByIds(store, rows.map((row) => row.profile_id));
  return rows.map((row) => ({
    ...row,
    profile: profileMap.get(row.profile_id) ?? null,
  }));
}

async function loadWorldScenes(store, worldRowId) {
  return await must(
    store.serviceClient.from("private_world_scenes").select("*").eq("world_id", worldRowId).order("created_at", { ascending: true }),
    "Could not load private world scenes",
  );
}

async function loadWorldPrefabs(store, worldRowId) {
  return await must(
    store.serviceClient.from("private_world_prefabs").select("*").eq("world_id", worldRowId).order("created_at", { ascending: true }),
    "Could not load private world prefabs",
  );
}

async function loadActiveInstancesForWorldIds(store, worldRowIds = []) {
  const ids = dedupe(worldRowIds);
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await must(
    store.serviceClient.from("private_world_active_instances").select("*").in("world_id", ids),
    "Could not load private world active instances",
  );
  return new Map(rows.map((row) => [row.world_id, row]));
}

async function loadParticipantCountsForInstanceIds(store, instanceIds = []) {
  const ids = dedupe(instanceIds);
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await must(
    store.serviceClient.from("private_world_participants").select("instance_id").in("instance_id", ids),
    "Could not load private world participant counts",
  );
  const counts = new Map();
  for (const row of rows) {
    const key = row.instance_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function loadActiveInstance(store, worldRowId) {
  return await maybeSingle(
    store.serviceClient.from("private_world_active_instances").select("*").eq("world_id", worldRowId).maybeSingle(),
    "Could not load private world active instance",
  );
}

async function recompileWorldScenes(store, world) {
  const prefabs = await loadWorldPrefabs(store, world.id);
  const scenes = await loadWorldScenes(store, world.id);
  for (const scene of scenes) {
    await must(
      store.serviceClient
        .from("private_world_scenes")
        .update({
          compiled_doc: compileSceneDoc(scene.scene_doc, world, { prefabs }),
          updated_at: nowIso(),
        })
        .eq("id", scene.id),
      "Could not recompile private world scenes",
    );
  }
  return {
    prefabs,
    scenes: await loadWorldScenes(store, world.id),
  };
}

async function loadInstanceParticipants(store, instanceId) {
  if (!instanceId) {
    return [];
  }
  const participants = await must(
    store.serviceClient.from("private_world_participants").select("*").eq("instance_id", instanceId),
    "Could not load private world participants",
  );
  const readyStates = await must(
    store.serviceClient.from("private_world_ready_states").select("*").eq("instance_id", instanceId),
    "Could not load private world ready states",
  );
  const readyByParticipantId = new Map(readyStates.map((row) => [row.participant_id, row]));
  const profileMap = await loadProfilesByIds(store, participants.map((row) => row.profile_id));
  return participants.map((row) => ({
    ...row,
    profile: row.profile_id ? profileMap.get(row.profile_id) ?? null : null,
    ready_state: readyByParticipantId.get(row.id) ?? null,
  }));
}

async function pruneExpiredEntityLocks(store, worldRowId, sceneId = null) {
  const locks = await must(
    store.serviceClient.from("private_world_entity_locks").select("*").eq("world_id", worldRowId),
    "Could not load private world locks",
  );
  const expired = locks.filter((row) => isExpired(row.expires_at) && (!sceneId || row.scene_id === sceneId));
  for (const row of expired) {
    await must(
      store.serviceClient
        .from("private_world_entity_locks")
        .delete()
        .eq("world_id", row.world_id)
        .eq("scene_id", row.scene_id)
        .eq("entity_key", row.entity_key),
      "Could not delete expired private world lock",
    );
  }
}

async function loadWorldLocks(store, worldRowId, sceneId = null) {
  await pruneExpiredEntityLocks(store, worldRowId, sceneId);
  let query = store.serviceClient.from("private_world_entity_locks").select("*").eq("world_id", worldRowId);
  if (sceneId) {
    query = query.eq("scene_id", sceneId);
  }
  const rows = await must(query, "Could not load private world locks");
  const profileMap = await loadProfilesByIds(store, rows.map((row) => row.profile_id));
  return rows.map((row) => ({
    ...row,
    profile: profileMap.get(row.profile_id) ?? null,
  }));
}

function serializeScene(scene) {
  return {
    id: scene.id,
    name: scene.name,
    version: scene.version,
    is_default: scene.is_default === true,
    scene_doc: cloneJson(scene.scene_doc),
    compiled_doc: cloneJson(scene.compiled_doc),
    created_at: scene.created_at,
    updated_at: scene.updated_at,
  };
}

function serializePrefab(prefab) {
  return {
    id: prefab.id,
    name: prefab.name,
    prefab_doc: cloneJson(prefab.prefab_doc),
    created_at: prefab.created_at,
    updated_at: prefab.updated_at,
  };
}

function serializeCollaborator(row) {
  return {
    role: row.role,
    created_at: row.created_at,
    profile: row.profile
      ? {
          id: row.profile.id,
          username: row.profile.username,
          display_name: row.profile.display_name,
        }
      : null,
  };
}

function serializeVisibleParticipant(row, { guestSessionId = "" } = {}) {
  const requesterGuestSessionId = String(guestSessionId ?? "").trim();
  const isLocalGuest = !row.profile_id && requesterGuestSessionId && row.guest_session_id === requesterGuestSessionId;
  if (row.visible_to_others === false && !isLocalGuest) {
    return null;
  }
  return {
    id: row.id,
    join_role: row.join_role,
    player_entity_id: row.player_entity_id ?? null,
    guest_session_id: isLocalGuest ? row.guest_session_id : null,
    ready: row.ready_state?.ready === true,
    profile: row.profile
      ? {
          id: row.profile.id,
          username: row.profile.username,
          display_name: row.profile.display_name,
        }
      : {
          username: null,
          display_name: row.display_name,
        },
  };
}

function emitPrivateWorldEvent(store, event) {
  for (const listener of store.__privateWorldSubscribers ?? []) {
    try {
      listener(event);
    } catch (error) {
      console.error("[private-world-event] listener failed", error);
    }
  }
}

async function syncRuntimeForWorld(store, world, creator) {
  if (!store.privateWorldRuntime?.syncWorldByReference || !world?.world_id || !creator?.username) {
    return null;
  }
  return await store.privateWorldRuntime.syncWorldByReference({
    worldId: world.world_id,
    creatorUsername: creator.username,
  });
}

async function buildWorldDetail(store, {
  world,
  creator,
  requesterProfile = null,
  guestSessionId = "",
  includeContent = false,
  allowGuest = false,
} = {}) {
  const collaborators = await loadWorldCollaborators(store, world.id);
  const collaboratorRole = requesterProfile
    ? collaborators.find((row) => row.profile_id === requesterProfile.id)?.role ?? null
    : null;
  const activeInstance = await loadActiveInstance(store, world.id);
  if (!requesterProfile && !allowGuest) {
    throw new HttpError(401, "Authentication required");
  }
  if (!requesterProfile && allowGuest && !activeInstance) {
    throw new HttpError(403, "Guest viewers can only join active private worlds");
  }

  const permissions = createPermissionSummary({
    collaboratorRole,
    requesterProfileId: requesterProfile?.id ?? "",
  }, world);
  const shouldLoadContent = permissions.can_edit || includeContent === true;
  const scenes = shouldLoadContent
    ? await loadWorldScenes(store, world.id)
    : [];
  const prefabs = shouldLoadContent
    ? await loadWorldPrefabs(store, world.id)
    : [];
  const sceneMap = new Map(scenes.map((row) => [row.id, row]));
  const activeParticipants = activeInstance
    ? await loadInstanceParticipants(store, activeInstance.id)
    : [];
  const locks = permissions.can_edit && scenes.length > 0
    ? await loadWorldLocks(store, world.id, scenes[0].id)
    : [];
  const runtimeSnapshot = activeInstance
    ? (
        store.privateWorldRuntime?.getSnapshotByWorldRef?.(world.world_id, creator.username)
        ?? await syncRuntimeForWorld(store, world, creator)
      )
    : null;
  const isImported = Boolean(
    world.imported_at
    || world.origin_world_id
    || world.origin_creator_username
    || world.origin_world_name,
  );

  return {
    world: {
      id: world.id,
      world_id: world.world_id,
      world_type: world.world_type,
      template_size: world.template_size,
      width: world.width,
      length: world.length,
      height: world.height,
      name: world.name,
      about: world.about,
      max_viewers: world.max_viewers,
      max_players: world.max_players,
      created_at: world.created_at,
      updated_at: world.updated_at,
      creator: {
        id: creator.id,
        username: creator.username,
        display_name: creator.display_name,
      },
      permissions,
      lineage: {
        is_imported: isImported,
        origin_world_id: isImported ? (world.origin_world_id ?? world.world_id) : null,
        origin_creator_username: isImported ? (world.origin_creator_username ?? creator.username) : null,
        origin_world_name: isImported ? (world.origin_world_name ?? world.name) : null,
        imported_at: isImported ? (world.imported_at ?? null) : null,
        imported_by_username: null,
      },
      collaborators: collaborators.map(serializeCollaborator),
      scenes: scenes.map(serializeScene),
      prefabs: prefabs.map(serializePrefab),
      active_instance: activeInstance
        ? {
            id: activeInstance.id,
            status: activeInstance.status,
            active_scene_id: activeInstance.active_scene_id,
            active_scene_name: sceneMap.get(activeInstance.active_scene_id)?.name ?? null,
            anchor_world_snapshot_id: activeInstance.anchor_world_snapshot_id,
            anchor_position: {
              x: activeInstance.anchor_position_x,
              y: activeInstance.anchor_position_y,
              z: activeInstance.anchor_position_z,
            },
            miniature: {
              width: activeInstance.miniature_width,
              length: activeInstance.miniature_length,
              height: activeInstance.miniature_height,
            },
            participants: activeParticipants
              .map((row) => serializeVisibleParticipant(row, { guestSessionId }))
              .filter(Boolean),
            viewer_count: activeParticipants.length,
            visible_participant_count: activeParticipants.filter((row) => row.visible_to_others !== false).length,
            runtime: runtimeSnapshot,
            locks: locks.map((row) => ({
              scene_id: row.scene_id,
              entity_key: row.entity_key,
              expires_at: row.expires_at,
              profile: row.profile
                ? {
                    username: row.profile.username,
                    display_name: row.profile.display_name,
                  }
                : null,
            })),
          }
        : null,
    },
  };
}

async function requireWorldEditor(store, profile, worldId, creatorUsername) {
  const { world, creator } = await loadWorldByExactReference(store, worldId, creatorUsername);
  const collaborators = await loadWorldCollaborators(store, world.id);
  const collaboratorRole = collaborators.find((row) => row.profile_id === profile.id)?.role ?? null;
  if (collaboratorRole !== "creator" && collaboratorRole !== "editor") {
    throw new HttpError(403, "You do not have edit access to this private world");
  }
  return {
    world,
    creator,
    collaboratorRole,
  };
}

async function requireWorldCreator(store, profile, worldId, creatorUsername) {
  const { world, creator, collaboratorRole } = await requireWorldEditor(store, profile, worldId, creatorUsername);
  if (collaboratorRole !== "creator") {
    throw new HttpError(403, "Only the creator can manage private world collaborators");
  }
  return {
    world,
    creator,
  };
}

async function loadImportedByUsername(store, world) {
  if (!world?.imported_by_profile_id) {
    return null;
  }
  const profile = await maybeSingle(
    store.serviceClient.from("user_profiles").select("*").eq("id", world.imported_by_profile_id).maybeSingle(),
    "Could not load imported-by profile",
  );
  return profile?.username ?? null;
}

function pickDefaultPlayerEntity(sceneDoc = {}, participants = []) {
  const candidateIds = (sceneDoc.players ?? [])
    .filter((entry) => entry.occupiable !== false)
    .map((entry) => entry.id);
  const occupied = new Set(participants.map((row) => row.player_entity_id).filter(Boolean));
  return candidateIds.find((id) => !occupied.has(id)) ?? null;
}

function findParticipantActor(participants = [], { profile = null, guestSessionId = "" } = {}) {
  if (profile?.id) {
    return participants.find((row) => row.profile_id === profile.id) ?? null;
  }
  const sessionId = String(guestSessionId ?? "").trim();
  if (!sessionId) {
    return null;
  }
  return participants.find((row) => row.guest_session_id === sessionId) ?? null;
}

export function installPrivateWorldStore(MauworldStore) {
  MauworldStore.prototype.subscribePrivateWorldEvents = function subscribePrivateWorldEvents(listener) {
    this.__privateWorldSubscribers = this.__privateWorldSubscribers ?? new Set();
    this.__privateWorldSubscribers.add(listener);
    return () => {
      this.__privateWorldSubscribers?.delete(listener);
    };
  };

  MauworldStore.prototype.publishPrivateWorldEvent = function publishPrivateWorldEvent(event) {
    emitPrivateWorldEvent(this, event);
  };

  MauworldStore.prototype.getPublicAuthConfig = async function getPublicAuthConfig() {
    return {
      supabaseUrl: this.config.supabaseUrl,
      supabaseAnonKey: this.config.supabaseAnonKey,
    };
  };

  MauworldStore.prototype.verifyUserAccessToken = async function verifyUserAccessToken(accessToken) {
    const token = String(accessToken ?? "").trim();
    if (!token) {
      throw new HttpError(401, "Missing bearer token");
    }
    const { data, error } = await this.serviceClient.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new HttpError(401, "Invalid bearer token");
    }
    const profile = await ensureUserProfile(this, data.user);
    return {
      user: data.user,
      profile,
    };
  };

  MauworldStore.prototype.upsertUserProfile = async function upsertUserProfile(user, input = {}) {
    const profile = await ensureUserProfile(this, user, input);
    return {
      profile,
    };
  };

  MauworldStore.prototype.getUserProfile = async function getUserProfile(user) {
    const profile = await ensureUserProfile(this, user);
    return {
      profile,
    };
  };

  MauworldStore.prototype.listPrivateWorlds = async function listPrivateWorlds(profile, input = {}) {
    const collaboratorRows = await must(
      this.serviceClient.from("private_world_collaborators").select("*").eq("profile_id", profile.id),
      "Could not load private world memberships",
    );
    const worldIds = dedupe(collaboratorRows.map((row) => row.world_id));
    const ownRows = await must(
      this.serviceClient.from("private_worlds").select("*").eq("creator_profile_id", profile.id),
      "Could not load owned private worlds",
    );
    const sharedRows = worldIds.length > 0
      ? await must(
          this.serviceClient.from("private_worlds").select("*").in("id", worldIds),
          "Could not load shared private worlds",
        )
      : [];
    const mergedRows = dedupe([...ownRows, ...sharedRows].map((row) => row.id)).map((id) =>
      [...ownRows, ...sharedRows].find((row) => row.id === id),
    );
    const creatorProfiles = await loadProfilesByIds(this, mergedRows.map((row) => row.creator_profile_id));
    const query = lower(input.q);
    const filtered = mergedRows
      .filter(Boolean)
      .filter((row) => !query || String(row.search_text ?? "").includes(query))
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .slice(0, clampLimit(input.limit, 30, 100));
    return {
      worlds: await Promise.all(filtered.map(async (row) => {
        const creator = creatorProfiles.get(row.creator_profile_id);
        const detail = await buildWorldDetail(this, {
          world: row,
          creator,
          requesterProfile: profile,
          includeContent: false,
        });
        detail.world.lineage.imported_by_username = await loadImportedByUsername(this, row);
        return detail.world;
      })),
    };
  };

  MauworldStore.prototype.searchPublicPrivateWorlds = async function searchPublicPrivateWorlds(input = {}) {
    const limit = clampLimit(input.limit, 18, 60);
    const query = lower(input.q);
    const worldType = lower(input.worldType);
    const activeRows = await must(
      this.serviceClient
        .from("private_world_active_instances")
        .select("*")
        .order("last_active_at", { ascending: false })
        .limit(limit * 4),
      "Could not load active private worlds",
    );
    if (activeRows.length === 0) {
      return {
        worlds: [],
      };
    }
    const worldRows = await must(
      this.serviceClient.from("private_worlds").select("*").in("id", activeRows.map((row) => row.world_id)),
      "Could not load searchable private worlds",
    );
    const worldById = new Map(worldRows.map((row) => [row.id, row]));
    const matchedRows = activeRows
      .map((activeInstance) => ({
        activeInstance,
        world: worldById.get(activeInstance.world_id) ?? null,
      }))
      .filter((entry) => entry.world)
      .filter((entry) => !worldType || entry.world.world_type === worldType)
      .filter((entry) => !query || String(entry.world.search_text ?? "").includes(query))
      .slice(0, limit);
    const creatorProfiles = await loadProfilesByIds(this, matchedRows.map((entry) => entry.world.creator_profile_id));
    const participantCounts = await loadParticipantCountsForInstanceIds(this, matchedRows.map((entry) => entry.activeInstance.id));
    return {
      worlds: matchedRows.map(({ world: row, activeInstance }) => {
        const creator = creatorProfiles.get(row.creator_profile_id) ?? null;
        const isImported = Boolean(
          row.imported_at
          || row.origin_world_id
          || row.origin_creator_username
          || row.origin_world_name,
        );
        return {
          world_id: row.world_id,
          name: row.name,
          about: row.about,
          world_type: row.world_type,
          template_size: row.template_size,
          width: row.width,
          length: row.length,
          height: row.height,
          updated_at: row.updated_at,
          creator: creator
            ? {
                username: creator.username,
                display_name: creator.display_name,
              }
            : {
                username: "unknown",
                display_name: "Unknown",
              },
          lineage: {
            is_imported: isImported,
            origin_world_id: isImported ? (row.origin_world_id ?? row.world_id) : null,
            origin_creator_username: isImported ? row.origin_creator_username : null,
            origin_world_name: isImported ? row.origin_world_name : null,
            imported_at: isImported ? (row.imported_at ?? null) : null,
          },
          active_instance: {
            status: activeInstance.status,
            viewer_count: participantCounts.get(activeInstance.id) ?? 0,
            active_scene_id: activeInstance.active_scene_id,
            anchor_world_snapshot_id: activeInstance.anchor_world_snapshot_id,
            anchor_position: {
              x: activeInstance.anchor_position_x,
              y: activeInstance.anchor_position_y,
              z: activeInstance.anchor_position_z,
            },
            miniature: {
              width: activeInstance.miniature_width,
              length: activeInstance.miniature_length,
              height: activeInstance.miniature_height,
            },
          },
        };
      }),
    };
  };

  MauworldStore.prototype.createPrivateWorld = async function createPrivateWorld(profile, input = {}) {
    const size = resolvePrivateWorldSize(input);
    const name = sanitizeWorldText(input.name ?? "Untitled private world", "world name", 96);
    const about = sanitizeWorldText(input.about ?? "No description provided", "world about", 240);
    const worldId = generatePrivateWorldId();
    const world = await must(
      this.serviceClient
        .from("private_worlds")
        .insert({
          world_id: worldId,
          creator_profile_id: profile.id,
          world_type: size.worldType,
          template_size: size.templateSize,
          width: size.width,
          length: size.length,
          height: size.height,
          name,
          about,
          search_text: buildPrivateWorldSearchText({
            name,
            about,
            creatorUsername: profile.username,
          }),
          max_viewers: clampLimit(input.max_viewers, PRIVATE_WORLD_LIMITS.maxViewers, 100),
          max_players: clampLimit(input.max_players, PRIVATE_WORLD_LIMITS.maxPlayers, PRIVATE_WORLD_LIMITS.maxPlayers),
        })
        .select("*")
        .single(),
      "Could not create private world",
    );

    await must(
      this.serviceClient
        .from("private_world_collaborators")
        .insert({
          world_id: world.id,
          profile_id: profile.id,
          role: "creator",
        }),
      "Could not create creator collaborator row",
    );

    const defaultSceneDoc = normalizeSceneDoc(input.defaultSceneDoc ?? createDefaultSceneDoc());
    const scene = await must(
      this.serviceClient
        .from("private_world_scenes")
        .insert({
          world_id: world.id,
          name: sanitizeWorldText(input.defaultSceneName ?? "Main Scene", "scene name", 80),
          scene_doc: defaultSceneDoc,
          compiled_doc: compileSceneDoc(defaultSceneDoc, world),
          version: 1,
          is_default: true,
        })
        .select("*")
        .single(),
      "Could not create default private world scene",
    );

    const updatedWorld = await must(
      this.serviceClient
        .from("private_worlds")
        .update({ default_scene_id: scene.id, updated_at: nowIso() })
        .eq("id", world.id)
        .select("*")
        .single(),
      "Could not update private world default scene",
    );

    emitPrivateWorldEvent(this, {
      type: "world:created",
      world_id: updatedWorld.world_id,
      creator_username: profile.username,
    });

    return await buildWorldDetail(this, {
      world: updatedWorld,
      creator: profile,
      requesterProfile: profile,
      includeContent: true,
    });
  };

  MauworldStore.prototype.getPrivateWorldDetail = async function getPrivateWorldDetail(input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const detail = await buildWorldDetail(this, {
      world,
      creator,
      requesterProfile: input.profile ?? null,
      guestSessionId: input.guestSessionId ?? "",
      includeContent: input.includeContent === true,
      allowGuest: input.allowGuest === true,
    });
    detail.world.lineage.imported_by_username = await loadImportedByUsername(this, world);
    return detail;
  };

  MauworldStore.prototype.deletePrivateWorld = async function deletePrivateWorld(profile, input = {}) {
    const { world, creator } = await requireWorldCreator(this, profile, input.worldId, input.creatorUsername);
    await must(
      this.serviceClient
        .from("private_worlds")
        .delete()
        .eq("id", world.id),
      "Could not delete private world",
    );
    this.privateWorldRuntime?.removeWorldByReference?.(world.world_id, creator.username);
    emitPrivateWorldEvent(this, {
      type: "world:deleted",
      world_id: world.world_id,
      creator_username: creator.username,
    });
    return {
      deleted: true,
      world_id: world.world_id,
    };
  };

  MauworldStore.prototype.updatePrivateWorld = async function updatePrivateWorld(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const size = resolvePrivateWorldSize({
      worldType: input.world_type ?? world.world_type,
      templateSize: input.template_size ?? world.template_size,
      width: input.width ?? world.width,
      length: input.length ?? world.length,
      height: input.height ?? world.height,
    });
    const nextName = input.name ? sanitizeWorldText(input.name, "world name", 96) : world.name;
    const nextAbout = input.about ? sanitizeWorldText(input.about, "world about", 240) : world.about;
    const updated = await must(
      this.serviceClient
        .from("private_worlds")
        .update({
          world_type: size.worldType,
          template_size: size.templateSize,
          width: size.width,
          length: size.length,
          height: size.height,
          name: nextName,
          about: nextAbout,
          max_viewers: input.max_viewers ? clampLimit(input.max_viewers, world.max_viewers, 100) : world.max_viewers,
          max_players: input.max_players ? clampLimit(input.max_players, world.max_players, PRIVATE_WORLD_LIMITS.maxPlayers) : world.max_players,
          search_text: buildPrivateWorldSearchText({
            name: nextName,
            about: nextAbout,
            creatorUsername: creator.username,
            originWorldId: world.origin_world_id,
            originCreatorUsername: world.origin_creator_username,
            originWorldName: world.origin_world_name,
          }),
          updated_at: nowIso(),
        })
        .eq("id", world.id)
        .select("*")
        .single(),
      "Could not update private world",
    );
    emitPrivateWorldEvent(this, {
      type: "world:updated",
      world_id: updated.world_id,
      creator_username: creator.username,
    });
    await syncRuntimeForWorld(this, updated, creator);
    return await buildWorldDetail(this, {
      world: updated,
      creator,
      requesterProfile: profile,
      includeContent: true,
    });
  };

  MauworldStore.prototype.savePrivateWorldScene = async function savePrivateWorldScene(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const existing = input.sceneId
      ? await maybeSingle(
          this.serviceClient
            .from("private_world_scenes")
            .select("*")
            .eq("id", input.sceneId)
            .eq("world_id", world.id)
            .maybeSingle(),
          "Could not load private world scene",
        )
      : null;
    const prefabs = await loadWorldPrefabs(this, world.id);
    const sceneDoc = normalizeSceneDoc(input.sceneDoc ?? input.scene_doc ?? createDefaultSceneDoc());
    const payload = {
      name: sanitizeWorldText(input.name ?? existing?.name ?? "Scene", "scene name", 80),
      scene_doc: sceneDoc,
      compiled_doc: compileSceneDoc(sceneDoc, world, { prefabs }),
      version: (existing?.version ?? 0) + 1,
      is_default: input.isDefault === true || existing?.is_default === true,
      updated_at: nowIso(),
    };

    const scene = existing
      ? await must(
          this.serviceClient
            .from("private_world_scenes")
            .update(payload)
            .eq("id", existing.id)
            .select("*")
            .single(),
          "Could not update private world scene",
        )
      : await must(
          this.serviceClient
            .from("private_world_scenes")
            .insert({
              world_id: world.id,
              ...payload,
              created_at: nowIso(),
            })
            .select("*")
            .single(),
          "Could not create private world scene",
        );

    if (payload.is_default) {
      await must(
        this.serviceClient
          .from("private_world_scenes")
          .update({ is_default: false })
          .eq("world_id", world.id),
        "Could not reset default scene flags",
      );
      await must(
        this.serviceClient
          .from("private_world_scenes")
          .update({ is_default: true })
          .eq("id", scene.id),
        "Could not mark default scene",
      );
      await must(
        this.serviceClient
          .from("private_worlds")
          .update({ default_scene_id: scene.id, updated_at: nowIso() })
          .eq("id", world.id),
        "Could not update default scene pointer",
      );
    }

    emitPrivateWorldEvent(this, {
      type: "scene:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      scene_id: scene.id,
    });
    await syncRuntimeForWorld(this, world, creator);

    return {
      scene: serializeScene(scene),
    };
  };

  MauworldStore.prototype.savePrivateWorldPrefab = async function savePrivateWorldPrefab(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const prefabDoc = normalizeSceneDoc(input.prefab_doc ?? input.prefabDoc ?? {});
    const name = sanitizeWorldText(input.name ?? "Prefab", "prefab name", 80);
    const existing = input.prefabId
      ? await maybeSingle(
          this.serviceClient
            .from("private_world_prefabs")
            .select("*")
            .eq("id", input.prefabId)
            .eq("world_id", world.id)
            .maybeSingle(),
          "Could not load private world prefab",
        )
      : null;
    const prefab = existing
      ? await must(
          this.serviceClient
            .from("private_world_prefabs")
            .update({
              name,
              prefab_doc: prefabDoc,
              updated_at: nowIso(),
            })
            .eq("id", existing.id)
            .select("*")
            .single(),
          "Could not update private world prefab",
        )
      : await must(
          this.serviceClient
            .from("private_world_prefabs")
            .insert({
              world_id: world.id,
              name,
              prefab_doc: prefabDoc,
              created_by_profile_id: profile.id,
            })
            .select("*")
            .single(),
          "Could not create private world prefab",
        );
    emitPrivateWorldEvent(this, {
      type: "prefab:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      prefab_id: prefab.id,
    });
    await recompileWorldScenes(this, world);
    await syncRuntimeForWorld(this, world, creator);
    return {
      prefab: serializePrefab(prefab),
    };
  };

  MauworldStore.prototype.deletePrivateWorldPrefab = async function deletePrivateWorldPrefab(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const prefab = await maybeSingle(
      this.serviceClient
        .from("private_world_prefabs")
        .select("*")
        .eq("id", input.prefabId)
        .eq("world_id", world.id)
        .maybeSingle(),
      "Could not load private world prefab",
    );
    if (!prefab) {
      throw new HttpError(404, "Private world prefab not found");
    }

    const scenes = await loadWorldScenes(this, world.id);
    const remainingPrefabs = (await loadWorldPrefabs(this, world.id)).filter((entry) => entry.id !== prefab.id);
    for (const scene of scenes) {
      const sceneDoc = normalizeSceneDoc(scene.scene_doc ?? {});
      const nextInstances = (sceneDoc.prefab_instances ?? []).filter((entry) => entry.prefab_id !== prefab.id);
      if (nextInstances.length === (sceneDoc.prefab_instances ?? []).length) {
        continue;
      }
      sceneDoc.prefab_instances = nextInstances;
      await must(
        this.serviceClient
          .from("private_world_scenes")
          .update({
            scene_doc: sceneDoc,
            compiled_doc: compileSceneDoc(sceneDoc, world, { prefabs: remainingPrefabs }),
            updated_at: nowIso(),
          })
          .eq("id", scene.id),
        "Could not remove prefab instances from private world scene",
      );
    }

    await must(
      this.serviceClient
        .from("private_world_prefabs")
        .delete()
        .eq("id", prefab.id)
        .eq("world_id", world.id),
      "Could not delete private world prefab",
    );

    emitPrivateWorldEvent(this, {
      type: "prefab:removed",
      world_id: world.world_id,
      creator_username: creator.username,
      prefab_id: prefab.id,
    });
    await recompileWorldScenes(this, world);
    await syncRuntimeForWorld(this, world, creator);
    return {
      removed: true,
      prefab_id: prefab.id,
    };
  };

  MauworldStore.prototype.setPrivateWorldCollaborator = async function setPrivateWorldCollaborator(profile, input = {}) {
    const { world, creator } = await requireWorldCreator(this, profile, input.worldId, input.creatorUsername);
    const username = normalizeUsername(input.username);
    const collaboratorProfile = await maybeSingle(
      this.serviceClient.from("user_profiles").select("*").eq("username", username).maybeSingle(),
      "Could not load collaborator profile",
    );
    if (!collaboratorProfile) {
      throw new HttpError(404, "Collaborator username not found");
    }
    if (collaboratorProfile.id === creator.id) {
      throw new HttpError(400, "Creator already has access");
    }
    const existing = await maybeSingle(
      this.serviceClient
        .from("private_world_collaborators")
        .select("*")
        .eq("world_id", world.id)
        .eq("profile_id", collaboratorProfile.id)
        .maybeSingle(),
      "Could not load collaborator row",
    );
    const row = existing
      ? await must(
          this.serviceClient
            .from("private_world_collaborators")
            .update({ role: resolveCollaboratorRole(input.role) })
            .eq("world_id", world.id)
            .eq("profile_id", collaboratorProfile.id)
            .select("*")
            .single(),
          "Could not update collaborator",
        )
      : await must(
          this.serviceClient
            .from("private_world_collaborators")
            .insert({
              world_id: world.id,
              profile_id: collaboratorProfile.id,
              role: resolveCollaboratorRole(input.role),
            })
            .select("*")
            .single(),
          "Could not create collaborator",
        );
    emitPrivateWorldEvent(this, {
      type: "collaborator:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      collaborator_username: collaboratorProfile.username,
    });
    return {
      collaborator: serializeCollaborator({
        ...row,
        profile: collaboratorProfile,
      }),
    };
  };

  MauworldStore.prototype.removePrivateWorldCollaborator = async function removePrivateWorldCollaborator(profile, input = {}) {
    const { world, creator } = await requireWorldCreator(this, profile, input.worldId, input.creatorUsername);
    const username = normalizeUsername(input.username);
    const collaboratorProfile = await maybeSingle(
      this.serviceClient.from("user_profiles").select("*").eq("username", username).maybeSingle(),
      "Could not load collaborator profile",
    );
    if (!collaboratorProfile) {
      throw new HttpError(404, "Collaborator username not found");
    }
    if (collaboratorProfile.id === creator.id) {
      throw new HttpError(400, "Creator access cannot be removed");
    }
    await must(
      this.serviceClient
        .from("private_world_collaborators")
        .delete()
        .eq("world_id", world.id)
        .eq("profile_id", collaboratorProfile.id),
      "Could not delete collaborator",
    );
    emitPrivateWorldEvent(this, {
      type: "collaborator:removed",
      world_id: world.world_id,
      creator_username: creator.username,
      collaborator_username: collaboratorProfile.username,
    });
    return {
      removed: true,
    };
  };

  MauworldStore.prototype.exportPrivateWorld = async function exportPrivateWorld(profile, input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const scenes = await loadWorldScenes(this, world.id);
    const prefabs = await loadWorldPrefabs(this, world.id);
    const defaultScene = scenes.find((row) => row.id === world.default_scene_id) ?? scenes.find((row) => row.is_default) ?? scenes[0] ?? null;
    return {
      package: buildPrivateWorldExportPackage({
        world,
        creator,
        exportedBy: profile,
        defaultSceneName: defaultScene?.name ?? null,
        prefabs: prefabs.map((row) => ({
          id: row.id,
          name: row.name,
          prefab_doc: cloneJson(row.prefab_doc),
        })),
        scenes: scenes.map((row) => ({
          name: row.name,
          scene_doc: cloneJson(row.scene_doc),
        })),
      }),
    };
  };

  MauworldStore.prototype.importPrivateWorld = async function importPrivateWorld(profile, input = {}) {
    const parsed = validatePrivateWorldExportPackage(input.package ?? input);
    const worldId = generatePrivateWorldId();
    const world = await must(
      this.serviceClient
        .from("private_worlds")
        .insert({
          world_id: worldId,
          creator_profile_id: profile.id,
          world_type: parsed.world.worldType,
          template_size: parsed.world.templateSize,
          width: parsed.world.width,
          length: parsed.world.length,
          height: parsed.world.height,
          name: parsed.world.name,
          about: parsed.world.about,
          max_viewers: parsed.world.max_viewers,
          max_players: parsed.world.max_players,
          origin_world_id: parsed.credits.origin_world_id ?? parsed.world.lineage.origin_world_id,
          origin_creator_username: parsed.credits.origin_creator_username ?? parsed.world.lineage.origin_creator_username,
          origin_world_name: parsed.credits.origin_world_name ?? parsed.world.lineage.origin_world_name,
          imported_at: nowIso(),
          imported_by_profile_id: profile.id,
          search_text: buildPrivateWorldSearchText({
            name: parsed.world.name,
            about: parsed.world.about,
            creatorUsername: profile.username,
            originWorldId: parsed.credits.origin_world_id ?? parsed.world.lineage.origin_world_id,
            originCreatorUsername: parsed.credits.origin_creator_username ?? parsed.world.lineage.origin_creator_username,
            originWorldName: parsed.credits.origin_world_name ?? parsed.world.lineage.origin_world_name,
          }),
        })
        .select("*")
        .single(),
      "Could not import private world",
    );

    await must(
      this.serviceClient
        .from("private_world_collaborators")
        .insert({
          world_id: world.id,
          profile_id: profile.id,
          role: "creator",
        }),
      "Could not create imported-world owner row",
    );

    const prefabIdMap = new Map();
    for (const prefabEntry of parsed.prefabs) {
      const createdPrefab = await must(
        this.serviceClient
          .from("private_world_prefabs")
          .insert({
            world_id: world.id,
            name: prefabEntry.name,
            prefab_doc: prefabEntry.prefab_doc,
            created_by_profile_id: profile.id,
          })
          .select("*")
          .single(),
          "Could not import private world prefab",
      );
      const insertedPrefab = Array.isArray(createdPrefab) ? createdPrefab[0] : createdPrefab;
      if (prefabEntry.id && insertedPrefab?.id) {
        prefabIdMap.set(prefabEntry.id, insertedPrefab.id);
      }
    }

    let defaultSceneId = null;
    const importedPrefabs = await loadWorldPrefabs(this, world.id);
    for (const [index, sceneEntry] of parsed.scenes.entries()) {
      const sceneDoc = cloneJson(sceneEntry.scene_doc);
      sceneDoc.prefab_instances = (sceneDoc.prefab_instances ?? []).map((entry) => ({
        ...entry,
        prefab_id: prefabIdMap.get(entry.prefab_id) ?? entry.prefab_id,
      }));
      const scene = await must(
        this.serviceClient
          .from("private_world_scenes")
          .insert({
            world_id: world.id,
            name: sceneEntry.name,
            scene_doc: sceneDoc,
            compiled_doc: compileSceneDoc(sceneDoc, world, { prefabs: importedPrefabs }),
            version: 1,
            is_default: sceneEntry.name === parsed.world.default_scene_name || index === 0,
          })
          .select("*")
          .single(),
          "Could not import private world scene",
        );
      if (!defaultSceneId && scene.is_default) {
        defaultSceneId = scene.id;
      }
    }

    const updatedWorld = await must(
      this.serviceClient
        .from("private_worlds")
        .update({ default_scene_id: defaultSceneId, updated_at: nowIso() })
        .eq("id", world.id)
        .select("*")
        .single(),
      "Could not update imported private world default scene",
    );
    emitPrivateWorldEvent(this, {
      type: "world:imported",
      world_id: updatedWorld.world_id,
      creator_username: profile.username,
      origin_world_id: updatedWorld.origin_world_id,
      origin_creator_username: updatedWorld.origin_creator_username,
    });
    return await buildWorldDetail(this, {
      world: updatedWorld,
      creator: profile,
      requesterProfile: profile,
      includeContent: true,
    });
  };

  MauworldStore.prototype.joinPrivateWorld = async function joinPrivateWorld(input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const requesterProfile = input.profile ?? null;
    const activeInstance = await loadActiveInstance(this, world.id);
    if (!requesterProfile && !activeInstance) {
      throw new HttpError(403, "Guests can only join active private worlds");
    }

    let instance = activeInstance;
    const worldDetail = await buildWorldDetail(this, {
      world,
      creator,
      requesterProfile,
      guestSessionId: input.guestSessionId ?? "",
      includeContent: requesterProfile ? false : false,
      allowGuest: !requesterProfile,
    });

    const requestedJoinRole = resolveJoinRole(input.joinRole);
    let participantRole = requestedJoinRole;
    if (!requesterProfile) {
      participantRole = "guest";
    } else if (participantRole === "editor" && worldDetail.world.permissions.can_edit !== true) {
      participantRole = "viewer";
    }

    if (!instance) {
      const currentWorld = await this.ensureCurrentWorldContext();
      const anchorSnapshotId = String(input.publicWorldSnapshotId ?? currentWorld.worldSnapshot.id).trim() || currentWorld.worldSnapshot.id;
      const miniature = computeMiniatureDimensions(world);
      const anchor = await findNearestPrivateWorldAnchor(this, currentWorld, {
        x: Number(input.position_x ?? 0) || 0,
        y: Number(input.position_y ?? 0) || 0,
        z: Number(input.position_z ?? 0) || 0,
      }, {
        miniature_width: miniature.width,
        miniature_length: miniature.length,
        miniature_height: miniature.height,
      }, world.id);
      if (!anchor) {
        throw new HttpError(409, "Could not find enough public-world space to anchor this private world");
      }
      instance = await must(
        this.serviceClient
          .from("private_world_active_instances")
          .insert({
            world_id: world.id,
            active_scene_id: world.default_scene_id,
            status: "active",
            anchor_world_snapshot_id: anchorSnapshotId,
            anchor_position_x: anchor.x,
            anchor_position_y: anchor.y,
            anchor_position_z: anchor.z,
            anchor_cell_x: anchor.cellX,
            anchor_cell_z: anchor.cellZ,
            miniature_width: miniature.width,
            miniature_length: miniature.length,
            miniature_height: miniature.height,
            runtime_state: {
              active_scene_id: world.default_scene_id,
              scene_started: false,
            },
            created_by_profile_id: requesterProfile.id,
          })
          .select("*")
          .single(),
        "Could not create private world instance",
      );
      emitPrivateWorldEvent(this, {
        type: "instance:started",
        world_id: world.world_id,
        creator_username: creator.username,
        instance_id: instance.id,
      });
    }

    const requestedGuestSessionId = String(input.guestSessionId ?? "").trim();
    const guestSessionId = !requesterProfile
      ? requestedGuestSessionId || `guest_${Date.now().toString(36)}`
      : null;
    const participants = await loadInstanceParticipants(this, instance.id);
    const existingParticipant = requesterProfile
      ? (
          participants.find((row) => row.profile_id === requesterProfile.id)
          ?? (requestedGuestSessionId ? participants.find((row) => row.guest_session_id === requestedGuestSessionId) : null)
        )
      : participants.find((row) => row.guest_session_id === guestSessionId);
    if (!existingParticipant && participants.length >= world.max_viewers) {
      throw new HttpError(409, "This private world is full");
    }
    const currentScene = world.default_scene_id
      ? await maybeSingle(
          this.serviceClient.from("private_world_scenes").select("*").eq("id", world.default_scene_id).maybeSingle(),
          "Could not load active scene",
        )
      : null;
    const playerEntityId = participantRole === "player"
      ? String(input.playerEntityId ?? "").trim() || pickDefaultPlayerEntity(currentScene?.scene_doc ?? {}, participants)
      : null;
    if (participantRole === "player" && !playerEntityId) {
      throw new HttpError(409, "No player slots are available");
    }

    const participantPayload = {
      join_role: participantRole,
      display_name: requesterProfile
        ? requesterProfile.display_name
        : sanitizeParticipantDisplayName(input.displayName, "guest viewer"),
      player_entity_id: playerEntityId,
      visible_to_others: requesterProfile ? true : false,
      last_seen_at: nowIso(),
      updated_at: nowIso(),
    };
    const participantUpdatePayload = requesterProfile
      ? {
          ...participantPayload,
          profile_id: requesterProfile.id,
          guest_session_id: null,
        }
      : participantPayload;
    const participant = existingParticipant
      ? await must(
          this.serviceClient
            .from("private_world_participants")
            .update(participantUpdatePayload)
            .eq("id", existingParticipant.id)
            .select("*")
            .single(),
          "Could not update private world participant",
        )
      : await must(
          this.serviceClient
            .from("private_world_participants")
            .insert({
              instance_id: instance.id,
              profile_id: requesterProfile?.id ?? null,
              guest_session_id: guestSessionId,
              ...participantPayload,
            })
            .select("*")
            .single(),
          "Could not create private world participant",
        );

    const existingReadyState = await maybeSingle(
      this.serviceClient
        .from("private_world_ready_states")
        .select("*")
        .eq("instance_id", instance.id)
        .eq("participant_id", participant.id)
        .maybeSingle(),
      "Could not load player ready state",
    );
    if (participant.join_role === "player") {
      if (existingReadyState) {
        await must(
          this.serviceClient
            .from("private_world_ready_states")
            .update({ ready: false, updated_at: nowIso() })
            .eq("instance_id", instance.id)
            .eq("participant_id", participant.id),
          "Could not reset player ready state",
        );
      } else {
        await must(
          this.serviceClient
            .from("private_world_ready_states")
            .insert({
              instance_id: instance.id,
              participant_id: participant.id,
              ready: false,
            }),
          "Could not create player ready state",
        );
      }
    } else if (existingReadyState) {
      await must(
        this.serviceClient
          .from("private_world_ready_states")
          .delete()
          .eq("instance_id", instance.id)
          .eq("participant_id", participant.id),
        "Could not clear player ready state",
      );
    }

    await must(
      this.serviceClient
        .from("private_world_active_instances")
        .update({ last_active_at: nowIso() })
        .eq("id", instance.id),
      "Could not update private world instance activity",
    );

    emitPrivateWorldEvent(this, {
      type: "participant:joined",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: instance.id,
    });
    await syncRuntimeForWorld(this, world, creator);

    const detail = await buildWorldDetail(this, {
      world,
      creator,
      requesterProfile,
      guestSessionId,
      includeContent: true,
      allowGuest: !requesterProfile,
    });
    return {
      guest_session_id: guestSessionId,
      participant_id: participant.id,
      world: detail.world,
    };
  };

  MauworldStore.prototype.leavePrivateWorld = async function leavePrivateWorld(input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      return { removed: true, active: false };
    }
    const participants = await loadInstanceParticipants(this, instance.id);
    const target = input.profile
      ? participants.find((row) => row.profile_id === input.profile.id)
      : participants.find((row) => row.guest_session_id === String(input.guestSessionId ?? "").trim());
    if (target) {
      await must(
        this.serviceClient.from("private_world_ready_states").delete().eq("participant_id", target.id),
        "Could not delete private world ready state",
      );
      await must(
        this.serviceClient.from("private_world_participants").delete().eq("id", target.id),
        "Could not delete private world participant",
      );
    }
    const remaining = await loadInstanceParticipants(this, instance.id);
    const authenticatedRemaining = remaining.filter((row) => Boolean(row.profile_id));
    if (authenticatedRemaining.length === 0) {
      await must(
        this.serviceClient.from("private_world_active_instances").delete().eq("id", instance.id),
        "Could not delete private world instance",
      );
      emitPrivateWorldEvent(this, {
        type: "instance:stopped",
        world_id: world.world_id,
        creator_username: creator.username,
        instance_id: instance.id,
      });
      await syncRuntimeForWorld(this, world, creator);
      return {
        removed: true,
        active: false,
      };
    }
    emitPrivateWorldEvent(this, {
      type: "participant:left",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: instance.id,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      removed: true,
      active: true,
    };
  };

  MauworldStore.prototype.occupyPrivateWorldParticipant = async function occupyPrivateWorldParticipant(input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const profile = input.profile ?? null;
    if (!profile) {
      throw new HttpError(401, "Authentication required to possess a player");
    }
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      throw new HttpError(404, "Private world is not active");
    }
    const participants = await loadInstanceParticipants(this, instance.id);
    const participant = findParticipantActor(participants, { profile });
    if (!participant) {
      throw new HttpError(403, "Join the private world before possessing a player");
    }
    const runtimeSnapshot = this.privateWorldRuntime?.getSnapshotByWorldRef?.(world.world_id, creator.username)
      ?? await syncRuntimeForWorld(this, world, creator);
    const requestedPlayerId = String(input.playerEntityId ?? "").trim();
    const playerEntry = runtimeSnapshot?.players?.find((entry) => entry.id === requestedPlayerId)
      ?? null;
    if (!playerEntry) {
      throw new HttpError(404, "Player entity not found in the active scene");
    }
    if (playerEntry.occupied_by_username && participant.player_entity_id !== requestedPlayerId) {
      throw new HttpError(409, "That player entity is already occupied");
    }

    const updatedParticipant = await must(
      this.serviceClient
        .from("private_world_participants")
        .update({
          join_role: "player",
          player_entity_id: requestedPlayerId,
          visible_to_others: true,
          updated_at: nowIso(),
          last_seen_at: nowIso(),
        })
        .eq("id", participant.id)
        .select("*")
        .single(),
      "Could not occupy private world player",
    );
    const existingReadyState = await maybeSingle(
      this.serviceClient
        .from("private_world_ready_states")
        .select("*")
        .eq("instance_id", instance.id)
        .eq("participant_id", participant.id)
        .maybeSingle(),
      "Could not load player ready state",
    );
    if (existingReadyState) {
      await must(
        this.serviceClient
          .from("private_world_ready_states")
          .update({ ready: false, updated_at: nowIso() })
          .eq("participant_id", participant.id),
        "Could not reset player ready state",
      );
    } else {
      await must(
        this.serviceClient
          .from("private_world_ready_states")
          .insert({
            instance_id: instance.id,
            participant_id: participant.id,
            ready: false,
          }),
        "Could not create player ready state",
      );
    }

    emitPrivateWorldEvent(this, {
      type: "participant:occupied",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: instance.id,
      participant_id: updatedParticipant.id,
      player_entity_id: requestedPlayerId,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      occupied: true,
      player_entity_id: requestedPlayerId,
    };
  };

  MauworldStore.prototype.releasePrivateWorldParticipant = async function releasePrivateWorldParticipant(input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const profile = input.profile ?? null;
    if (!profile) {
      throw new HttpError(401, "Authentication required to release a player");
    }
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      throw new HttpError(404, "Private world is not active");
    }
    const participants = await loadInstanceParticipants(this, instance.id);
    const participant = findParticipantActor(participants, { profile });
    if (!participant || participant.join_role !== "player") {
      throw new HttpError(409, "You are not currently possessing a player");
    }
    await must(
      this.serviceClient
        .from("private_world_participants")
        .update({
          join_role: "viewer",
          player_entity_id: null,
          updated_at: nowIso(),
          last_seen_at: nowIso(),
        })
        .eq("id", participant.id),
      "Could not release private world player",
    );
    await must(
      this.serviceClient
        .from("private_world_ready_states")
        .delete()
        .eq("participant_id", participant.id),
      "Could not clear player ready state",
    );
    emitPrivateWorldEvent(this, {
      type: "participant:released",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: instance.id,
      participant_id: participant.id,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      released: true,
    };
  };

  MauworldStore.prototype.setPrivateWorldReadyState = async function setPrivateWorldReadyState(profile, input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      throw new HttpError(404, "Private world is not active");
    }
    const participants = await loadInstanceParticipants(this, instance.id);
    const participant = participants.find((row) => row.profile_id === profile.id);
    if (!participant || participant.join_role !== "player") {
      throw new HttpError(403, "Only occupied player slots can ready up");
    }
    await must(
      this.serviceClient
        .from("private_world_ready_states")
        .update({ ready: input.ready === true, updated_at: nowIso() })
        .eq("participant_id", participant.id),
      "Could not update private world ready state",
    );
    emitPrivateWorldEvent(this, {
      type: "ready:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: instance.id,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      ready: input.ready === true,
    };
  };

  MauworldStore.prototype.startPrivateWorldScene = async function startPrivateWorldScene(profile, input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      throw new HttpError(404, "Private world is not active");
    }
    const requestedSceneId = String(input.sceneId ?? "").trim();
    let activeSceneId = String(instance.active_scene_id ?? world.default_scene_id ?? "").trim();
    if (requestedSceneId) {
      await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
      const scenes = await loadWorldScenes(this, world.id);
      const requestedScene = scenes.find((row) => row.id === requestedSceneId) ?? null;
      if (!requestedScene) {
        throw new HttpError(404, "Selected scene was not found in this world");
      }
      activeSceneId = requestedScene.id;
    }
    const participants = await loadInstanceParticipants(this, instance.id);
    const occupiedPlayers = participants.filter((row) => row.join_role === "player" && row.player_entity_id);
    if (occupiedPlayers.length > 0 && !occupiedPlayers.every((row) => row.ready_state?.ready === true)) {
      throw new HttpError(409, "All occupied player slots must be ready before starting the scene");
    }
    const runtimeState = cloneJson(instance.runtime_state ?? {});
    runtimeState.active_scene_id = activeSceneId;
    runtimeState.scene_started = true;
    runtimeState.started_at = nowIso();
    runtimeState.started_by_profile_id = profile.id;
    const updated = await must(
      this.serviceClient
        .from("private_world_active_instances")
        .update({
          active_scene_id: activeSceneId,
          status: "started",
          runtime_state: runtimeState,
          last_active_at: nowIso(),
        })
        .eq("id", instance.id)
        .select("*")
        .single(),
      "Could not start private world scene",
    );
    emitPrivateWorldEvent(this, {
      type: "scene:started",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: updated.id,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      instance: updated,
    };
  };

  MauworldStore.prototype.resetPrivateWorldScene = async function resetPrivateWorldScene(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const instance = await loadActiveInstance(this, world.id);
    if (!instance) {
      throw new HttpError(404, "Private world is not active");
    }
    await must(
      this.serviceClient
        .from("private_world_ready_states")
        .update({ ready: false, updated_at: nowIso() })
        .eq("instance_id", instance.id),
      "Could not reset private world ready states",
    );
    const runtimeState = cloneJson(instance.runtime_state ?? {});
    runtimeState.active_scene_id = world.default_scene_id;
    runtimeState.scene_started = false;
    runtimeState.started_at = null;
    runtimeState.started_by_profile_id = null;
    runtimeState.scene_elapsed_ms = 0;
    runtimeState.tick = 0;
    const updated = await must(
      this.serviceClient
        .from("private_world_active_instances")
        .update({
          active_scene_id: world.default_scene_id,
          status: "active",
          runtime_state: runtimeState,
          last_active_at: nowIso(),
        })
        .eq("id", instance.id)
        .select("*")
        .single(),
      "Could not reset private world scene",
    );
    emitPrivateWorldEvent(this, {
      type: "scene:reset",
      world_id: world.world_id,
      creator_username: creator.username,
      instance_id: updated.id,
    });
    await syncRuntimeForWorld(this, world, creator);
    return {
      instance: updated,
    };
  };

  MauworldStore.prototype.queuePrivateWorldInput = async function queuePrivateWorldInput(profile, input = {}) {
    const { world, creator } = await loadWorldByExactReference(this, input.worldId, input.creatorUsername);
    if (!this.privateWorldRuntime?.queueInputByReference) {
      throw new HttpError(503, "Private world runtime is unavailable");
    }
    const result = await this.privateWorldRuntime.queueInputByReference({
      worldId: world.world_id,
      creatorUsername: creator.username,
      profile,
      key: input.key,
      state: input.state,
    });
    return result;
  };

  MauworldStore.prototype.acquirePrivateWorldEntityLock = async function acquirePrivateWorldEntityLock(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const sceneId = String(input.sceneId ?? "").trim();
    const entityKey = String(input.entityKey ?? "").trim();
    if (!sceneId || !entityKey) {
      throw new HttpError(400, "sceneId and entityKey are required");
    }
    await pruneExpiredEntityLocks(this, world.id, sceneId);
    const existing = await maybeSingle(
      this.serviceClient
        .from("private_world_entity_locks")
        .select("*")
        .eq("world_id", world.id)
        .eq("scene_id", sceneId)
        .eq("entity_key", entityKey)
        .maybeSingle(),
      "Could not load entity lock",
    );
    if (existing && existing.profile_id !== profile.id && !isExpired(existing.expires_at)) {
      throw new HttpError(409, "That entity is currently being edited by someone else");
    }
    const expiresAt = new Date(Date.now() + PRIVATE_WORLD_LIMITS.lockTtlSeconds * 1000).toISOString();
    const lock = existing
      ? await must(
          this.serviceClient
            .from("private_world_entity_locks")
            .update({
              profile_id: profile.id,
              expires_at: expiresAt,
              updated_at: nowIso(),
            })
            .eq("world_id", world.id)
            .eq("scene_id", sceneId)
            .eq("entity_key", entityKey)
            .select("*")
            .single(),
          "Could not update entity lock",
        )
      : await must(
          this.serviceClient
            .from("private_world_entity_locks")
            .insert({
              world_id: world.id,
              scene_id: sceneId,
              entity_key: entityKey,
              profile_id: profile.id,
              expires_at: expiresAt,
            })
            .select("*")
            .single(),
          "Could not create entity lock",
        );
    emitPrivateWorldEvent(this, {
      type: "lock:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      scene_id: sceneId,
      entity_key: entityKey,
    });
    return {
      lock: {
        scene_id: lock.scene_id,
        entity_key: lock.entity_key,
        expires_at: lock.expires_at,
        profile: {
          username: profile.username,
          display_name: profile.display_name,
        },
      },
    };
  };

  MauworldStore.prototype.heartbeatPrivateWorldEntityLock = async function heartbeatPrivateWorldEntityLock(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const sceneId = String(input.sceneId ?? "").trim();
    const entityKey = String(input.entityKey ?? "").trim();
    const expiresAt = new Date(Date.now() + PRIVATE_WORLD_LIMITS.lockTtlSeconds * 1000).toISOString();
    const lock = await maybeSingle(
      this.serviceClient
        .from("private_world_entity_locks")
        .select("*")
        .eq("world_id", world.id)
        .eq("scene_id", sceneId)
        .eq("entity_key", entityKey)
        .eq("profile_id", profile.id)
        .maybeSingle(),
      "Could not load entity lock",
    );
    if (!lock) {
      throw new HttpError(404, "No active lock found for that entity");
    }
    const updated = await must(
      this.serviceClient
        .from("private_world_entity_locks")
        .update({
          expires_at: expiresAt,
          updated_at: nowIso(),
        })
        .eq("world_id", world.id)
        .eq("scene_id", sceneId)
        .eq("entity_key", entityKey)
        .eq("profile_id", profile.id)
        .select("*")
        .single(),
      "Could not extend entity lock",
    );
    emitPrivateWorldEvent(this, {
      type: "lock:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      scene_id: sceneId,
      entity_key: entityKey,
    });
    return {
      lock: {
        scene_id: updated.scene_id,
        entity_key: updated.entity_key,
        expires_at: updated.expires_at,
        profile: {
          username: profile.username,
          display_name: profile.display_name,
        },
      },
    };
  };

  MauworldStore.prototype.releasePrivateWorldEntityLock = async function releasePrivateWorldEntityLock(profile, input = {}) {
    const { world, creator } = await requireWorldEditor(this, profile, input.worldId, input.creatorUsername);
    const sceneId = String(input.sceneId ?? "").trim();
    const entityKey = String(input.entityKey ?? "").trim();
    await must(
      this.serviceClient
        .from("private_world_entity_locks")
        .delete()
        .eq("world_id", world.id)
        .eq("scene_id", sceneId)
        .eq("entity_key", entityKey)
        .eq("profile_id", profile.id),
      "Could not release entity lock",
    );
    emitPrivateWorldEvent(this, {
      type: "lock:updated",
      world_id: world.world_id,
      creator_username: creator.username,
      scene_id: sceneId,
      entity_key: entityKey,
    });
    return {
      released: true,
    };
  };

  MauworldStore.prototype.listPrivateWorldMiniaturesForSnapshot = async function listPrivateWorldMiniaturesForSnapshot(input = {}) {
    const worldSnapshotId = String(input.worldSnapshotId ?? "").trim();
    if (!worldSnapshotId) {
      return [];
    }
    const viewerPresence = await loadViewerPresenceForSnapshot(this, worldSnapshotId, input.viewerSessionId);
    const rows = await must(
      this.serviceClient
        .from("private_world_active_instances")
        .select("*")
        .eq("anchor_world_snapshot_id", worldSnapshotId)
        .gte("anchor_cell_x", input.cellXMin)
        .lte("anchor_cell_x", input.cellXMax)
        .gte("anchor_cell_z", input.cellZMin)
        .lte("anchor_cell_z", input.cellZMax),
        "Could not load private world miniatures",
    );
    if (rows.length === 0) {
      return [];
    }
    const worldsById = new Map(
      (await must(
        this.serviceClient.from("private_worlds").select("*").in("id", rows.map((row) => row.world_id)),
        "Could not load miniature worlds",
      )).map((row) => [row.id, row]),
    );
    const scenesById = new Map(
      (await must(
        this.serviceClient.from("private_world_scenes").select("*").in("id", rows.map((row) => row.active_scene_id)),
        "Could not load miniature scenes",
      )).map((row) => [row.id, row]),
    );
    const creatorProfiles = await loadProfilesByIds(this, [...new Set([...worldsById.values()].map((row) => row.creator_profile_id))]);
    const miniatures = [];
    for (const row of rows) {
      const world = worldsById.get(row.world_id);
      const scene = scenesById.get(row.active_scene_id);
      if (!world || !scene) {
        continue;
      }
      const creator = creatorProfiles.get(world.creator_profile_id);
      const participants = await loadInstanceParticipants(this, row.id);
      const runtimeSnapshot = creator
        ? (
            this.privateWorldRuntime?.getSnapshotByWorldRef?.(world.world_id, creator.username)
            ?? null
          )
        : null;
      const lodBand = resolveMiniatureLodBand(row, viewerPresence);
      const compiledMiniature = cloneJson(scene.compiled_doc?.miniature ?? {});
      const liveVisiblePlayers = participants
        .filter((entry) => entry.visible_to_others !== false && entry.player_entity_id)
        .map((entry) => ({
          player_entity_id: entry.player_entity_id,
          username: entry.profile?.username ?? null,
          position: cloneJson(
            runtimeSnapshot?.players?.find((candidate) => candidate.id === entry.player_entity_id)?.position
            ?? compiledMiniature.players?.find((candidate) => candidate.id === entry.player_entity_id)?.position
            ?? null,
          ),
        }))
        .filter((entry) => entry.position);
      const miniaturePayload = lodBand === "near"
        ? {
            static_voxels: (compiledMiniature.static_voxels ?? []).slice(0, 120),
            screens: (compiledMiniature.screens ?? []).slice(0, 16),
            players: [],
          }
        : lodBand === "mid"
          ? {
              static_voxels: (compiledMiniature.static_voxels ?? []).slice(0, 120).map((entry) => ({
                ...entry,
                material: {
                  ...(entry.material ?? {}),
                  color: "#8c94a1",
                },
              })),
              screens: [],
              players: [],
            }
          : {
              static_voxels: [],
              screens: [],
              players: [],
            };
      miniatures.push({
        id: row.id,
        world_id: world.world_id,
        name: world.name,
        about: world.about,
        world_type: world.world_type,
        creator_username: creator?.username ?? null,
        template_size: world.template_size,
        anchor_world_snapshot_id: row.anchor_world_snapshot_id,
        anchor_position_x: row.anchor_position_x,
        anchor_position_y: row.anchor_position_y,
        anchor_position_z: row.anchor_position_z,
        anchor_cell_x: row.anchor_cell_x,
        anchor_cell_z: row.anchor_cell_z,
        miniature_width: row.miniature_width,
        miniature_length: row.miniature_length,
        miniature_height: row.miniature_height,
        viewer_count: participants.length,
        lineage: {
          is_imported: Boolean(
            world.imported_at
            || world.origin_world_id
            || world.origin_creator_username
            || world.origin_world_name
          ),
          origin_world_id: world.origin_world_id ?? null,
          origin_creator_username: world.origin_creator_username ?? null,
          origin_world_name: world.origin_world_name ?? null,
          imported_at: world.imported_at ?? null,
        },
        lod_band: lodBand,
        compiled: {
          miniature: miniaturePayload,
          stats: cloneJson(scene.compiled_doc?.stats ?? {}),
        },
        visible_players: lodBand === "near" ? liveVisiblePlayers : [],
      });
    }
    return miniatures;
  };
}
