import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sendJson(res, status, data) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  return res.status(status).json(data);
}

function getToken(req) {
  const auth = req.headers.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.substring(7).trim();
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    /*
     * Authentication is optional for browsing the public
     * voice library.
     */
    const token = getToken(req);

    let user = null;

    if (token) {
      const {
        data: { user: authenticatedUser }
      } = await supabaseAdmin.auth.getUser(token);

      user = authenticatedUser || null;
    }

    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    const search =
      url.searchParams.get("search")?.trim() || "";

    const gender =
      url.searchParams.get("gender")?.trim() || "";

    const language =
      url.searchParams.get("language")?.trim() || "";

    const category =
      url.searchParams.get("category")?.trim() || "";

    const limitParam =
      Number(url.searchParams.get("limit") || 50);

    const limit = Math.min(
      Math.max(limitParam, 1),
      100
    );

    /*
     * Load public voices from Supabase.
     */
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
        `
      )
      .eq("is_public", true)
      .limit(limit);

    if (search) {
      const safeSearch =
        search.replace(/[%_]/g, "");

      query = query.or(
        `name.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`
      );
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
        language
      );
    }

    if (category) {
      query = query.ilike(
        "category",
        category
      );
    }

    query = query.order(
      "created_at",
      { ascending: false }
    );

    const {
      data: voices,
      error: voicesError
    } = await query;

    if (voicesError) {
      console.error(
        "Voice library error:",
        voicesError
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to load voice library"
      });
    }

    /*
     * Add user's favorites when authenticated.
     */
    let favoriteIds = new Set();

    if (user && voices?.length) {
      const voiceIds = voices.map(
        (voice) => voice.id
      );

      const {
        data: favorites,
        error: favoriteError
      } = await supabaseAdmin
        .from("favorite_voices")
        .select("voice_id")
        .eq("user_id", user.id)
        .in("voice_id", voiceIds);

      if (!favoriteError && favorites) {
        favoriteIds = new Set(
          favorites.map(
            (item) => item.voice_id
          )
        );
      }
    }

    const result =
      (voices || []).map((voice) => ({
        ...voice,
        isFavorite: favoriteIds.has(
          voice.id
        )
      }));

    /*
     * If the database does not yet contain public voices,
     * provide an empty library instead of fake provider data.
     */
    return sendJson(res, 200, {
      ok: true,
      count: result.length,
      voices: result
    });
  } catch (error) {
    console.error(
      "Voices API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
