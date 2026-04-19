import { HttpError } from "./http.js";
import {
  buildWorldGameSearchText,
  generateWorldGameFromAi,
  serializeWorldGame,
  validateWorldGameRecord,
} from "./world-games.js";

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

function clampLimit(value, fallback = 20, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(numeric));
}

export function installWorldGamesStore(MauworldStore) {
  MauworldStore.prototype.listWorldGames = async function listWorldGames(profile, input = {}) {
    const rows = await must(
      this.serviceClient
        .from("world_games")
        .select("*")
        .eq("owner_profile_id", profile.id)
        .order("updated_at", { ascending: false })
        .limit(clampLimit(input.limit, 40, 100)),
      "Could not load saved games",
    );
    return {
      games: rows.map((row) => serializeWorldGame(row)),
    };
  };

  MauworldStore.prototype.getWorldGame = async function getWorldGame(profile, input = {}) {
    const gameId = String(input.gameId ?? input.id ?? "").trim();
    if (!gameId) {
      throw new HttpError(400, "Invalid gameId");
    }
    const query = this.serviceClient.from("world_games").select("*").eq("id", gameId);
    if (profile?.id && input.allowAny !== true) {
      query.eq("owner_profile_id", profile.id);
    }
    const row = await maybeSingle(query.maybeSingle(), "Could not load saved game");
    if (!row) {
      throw new HttpError(404, "Game not found");
    }
    return {
      game: serializeWorldGame(row),
    };
  };

  MauworldStore.prototype.copyWorldGame = async function copyWorldGame(profile, input = {}) {
    const source = input.game
      ? validateWorldGameRecord(input.game, { promptRequired: false })
      : (await this.getWorldGame(null, {
        gameId: input.gameId,
        allowAny: true,
      })).game;
    const nextRecord = validateWorldGameRecord({
      title: input.title ?? source.title,
      prompt: source.prompt ?? "",
      source_html: source.source_html,
      manifest: source.manifest,
      ai_provider: source.ai_provider,
      ai_model: source.ai_model,
      source_game_id: input.sourceGameId ?? source.source_game_id ?? source.id ?? null,
    }, { promptRequired: false });
    const inserted = await must(
      this.serviceClient
        .from("world_games")
        .insert({
          owner_profile_id: profile.id,
          source_game_id: nextRecord.source_game_id,
          title: nextRecord.title,
          prompt: nextRecord.prompt,
          source_html: nextRecord.source_html,
          manifest: nextRecord.manifest,
          search_text: buildWorldGameSearchText([
            nextRecord.title,
            nextRecord.prompt,
            nextRecord.manifest?.description,
            nextRecord.manifest?.multiplayer_mode,
          ]),
          ai_provider: nextRecord.ai_provider,
          ai_model: nextRecord.ai_model,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .select("*")
        .single(),
      "Could not copy saved game",
    );
    return {
      game: serializeWorldGame(inserted),
    };
  };

  MauworldStore.prototype.generateWorldGame = async function generateWorldGame(profile, input = {}) {
    const generated = await generateWorldGameFromAi({
      prompt: input.prompt,
      objective: input.objective,
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
    });
    const inserted = await must(
      this.serviceClient
        .from("world_games")
        .insert({
          owner_profile_id: profile.id,
          source_game_id: null,
          title: generated.title,
          prompt: generated.prompt,
          source_html: generated.source_html,
          manifest: generated.manifest,
          search_text: buildWorldGameSearchText([
            generated.title,
            generated.prompt,
            generated.manifest?.description,
            generated.manifest?.multiplayer_mode,
          ]),
          ai_provider: generated.ai_provider,
          ai_model: generated.ai_model,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .select("*")
        .single(),
      "Could not save generated game",
    );
    return {
      game: serializeWorldGame(inserted),
      generation: {
        provider: generated.provider,
        model: generated.model,
      },
    };
  };
}
