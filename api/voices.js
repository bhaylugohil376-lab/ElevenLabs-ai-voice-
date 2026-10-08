import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

function sendJson(res, status, data) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  return res.status(status).json(data);
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getUser(req) {
  const token = getBearerToken(req);

  if (!token) return null;

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

function normalizeVoice(voice) {
  const labels = voice.labels || {};

  const voiceId =
    voice.voice_id ||
    voice.id ||
    voice.provider_voice_id;

  return {
    id: voiceId,
    voice_id: voiceId,
    provider_voice_id: voiceId,

    name:
      voice.name ||
      "AI Voice",

    gender:
      labels.gender ||
      voice.gender ||
      "unknown",

    language:
      labels.language ||
      voice.language_code ||
      voice.language ||
      "en",

    category:
      voice.category ||
      labels.category ||
      "general",

    description:
      voice.description ||
      labels.description ||
      "Natural AI voice.",

    preview_url:
      voice.preview_url ||
      voice.previewUrl ||
      null,

    provider: "elevenlabs",

    labels
  };
}

function matchesFilters(
  voice,
  search,
  gender,
  language,
  category
) {
  const text = [
    voice.name,
    voice.description,
    voice.language,
    voice.gender,
    voice.category,
    JSON.stringify(voice.labels || {})
  ]
    .join(" ")
    .toLowerCase();

  if (
    search &&
    !text.includes(search.toLowerCase())
  ) {
    return false;
  }

  if (
    gender &&
    String(voice.gender).toLowerCase() !==
      gender.toLowerCase()
  ) {
    return false;
  }

  if (
    language &&
    !String(voice.language)
      .toLowerCase()
      .includes(language.toLowerCase())
  ) {
    return false;
  }

  if (
    category &&
    String(voice.category).toLowerCase() !==
      category.toLowerCase()
  ) {
    return false;
  }

  return true;
}

async function getFavorites(user, voiceIds) {
  if (!user || !voiceIds.length) {
    return new Set();
  }

  const { data, error } =
    await supabaseAdmin
      .from("favorite_voices")
      .select("voice_id")
      .eq("user_id", user.id)
      .in("voice_id", voiceIds);

  if (error) {
    console.error(
      "Favorites lookup error:",
      error
    );

    return new Set();
  }

  return new Set(
    (data || []).map(
      item => item.voice_id
    )
  );
}

async function getDatabaseVoices({
  search,
  gender,
  language,
  category,
  limit,
  offset
}) {
  let query = supabaseAdmin
    .from("voices")
    .select(
      `
        id,
        name,
        gender,
        language,
        category,
        description,
        preview_url,
        provider,
        provider_voice_id,
        is_public,
        created_at
      `,
      { count: "exact" }
    )
    .eq("is_public", true)
    .order("created_at", {
      ascending: false
    })
    .range(
      offset,
      offset + limit - 1
    );

  if (search) {
    const cleaned =
      search
        .replace(/[%_]/g, "")
        .trim();

    if (cleaned) {
      query = query.or(
        `name.ilike.%${cleaned}%,description.ilike.%${cleaned}%`
      );
    }
  }

  if (gender) {
    query = query.ilike(
      "gender",
      gender
    );
  }

  if (language) {
    query = query.ilike(
      "language",
      `%${language}%`
    );
  }

  if (category) {
    query = query.ilike(
      "category",
      category
    );
  }

  const {
    data,
    count,
    error
  } = await query;

  if (error) {
    throw error;
  }

  return {
    voices: data || [],
    total: count || 0
  };
}

async function getElevenLabsVoices() {
  const apiKey =
    process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not configured."
    );
  }

  const response = await fetch(
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json"
      }
    }
  );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.detail?.message ||
        data?.detail ||
        "ElevenLabs voice service failed."
    );
  }

  return Array.isArray(data.voices)
    ? data.voices
    : [];
}

async function syncVoices(voices) {
  if (!voices.length) return;

  const rows = voices
    .map(normalizeVoice)
    .filter(
      voice =>
        voice.provider_voice_id
    )
    .map(voice => ({
      name: voice.name,
      gender: voice.gender,
      language: voice.language,
      category: voice.category,
      description: voice.description,
      preview_url: voice.preview_url,
      provider: "elevenlabs",
      provider_voice_id:
        voice.provider_voice_id,
      is_public: true
    }));

  if (!rows.length) return;

  const { error } =
    await supabaseAdmin
      .from("voices")
      .upsert(
        rows,
        {
          onConflict:
            "provider_voice_id"
        }
      );

  if (error) {
    console.error(
      "Voice sync warning:",
      error
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, {
      ok: true
    });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const user =
      await getUser(req);

    const url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    const search =
      url.searchParams
        .get("search")
        ?.trim() || "";

    const gender =
      url.searchParams
        .get("gender")
        ?.trim() || "";

    const language =
      url.searchParams
        .get("language")
        ?.trim() || "";

    const category =
      url.searchParams
        .get("category")
        ?.trim() || "";

    const page = Math.max(
      parseInt(
        url.searchParams.get("page") ||
          "1",
        10
      ) || 1,
      1
    );

    const requestedLimit =
      parseInt(
        url.searchParams.get(
          "page_size"
        ) ||
          url.searchParams.get(
            "limit"
          ) ||
          "50",
        10
      ) || 50;

    const limit = Math.min(
      Math.max(
        requestedLimit,
        1
      ),
      100
    );

    const offset =
      (page - 1) * limit;

    /*
     * 1. Read from Supabase first.
     */
    let result =
      await getDatabaseVoices({
        search,
        gender,
        language,
        category,
        limit,
        offset
      });

    /*
     * 2. If DB is empty, get real
     * ElevenLabs voices and sync them.
     */
    if (
      result.total === 0 &&
      offset === 0
    ) {
      const providerVoices =
        await getElevenLabsVoices();

      await syncVoices(
        providerVoices
      );

      const normalized =
        providerVoices
          .map(normalizeVoice)
          .filter(voice =>
            matchesFilters(
              voice,
              search,
              gender,
              language,
              category
            )
          );

      const pageVoices =
        normalized.slice(
          0,
          limit
        );

      const favoriteSet =
        await getFavorites(
          user,
          pageVoices.map(
            voice =>
              voice.voice_id
          )
        );

      const voices =
        pageVoices.map(
          voice => ({
            ...voice,
            isFavorite:
              favoriteSet.has(
                voice.voice_id
              )
          })
        );

      return sendJson(
        res,
        200,
        {
          ok: true,
          voices,
          count: voices.length,
          total: normalized.length,
          page,
          page_size: limit,
          has_more:
            normalized.length >
            page * limit,
          source:
            "elevenlabs"
        }
      );
    }

    /*
     * 3. Normalize DB voices.
     */
    const normalized =
      result.voices.map(
        normalizeVoice
      );

    const favoriteSet =
      await getFavorites(
        user,
        normalized.map(
          voice =>
            voice.voice_id
        )
      );

    const voices =
      normalized.map(
        voice => ({
          ...voice,
          isFavorite:
            favoriteSet.has(
              voice.voice_id
            )
        })
      );

    return sendJson(
      res,
      200,
      {
        ok: true,
        voices,
        count: voices.length,
        total: result.total,
        page,
        page_size: limit,
        has_more:
          offset + voices.length <
          result.total,
        source:
          "supabase"
      }
    );
  } catch (error) {
    console.error(
      "Voice API error:",
      error
    );

    return sendJson(
      res,
      500,
      {
        ok: false,
        voices: [],
        count: 0,
        error:
          error?.message ||
          "Unable to load voice library."
      }
    );
  }
}
