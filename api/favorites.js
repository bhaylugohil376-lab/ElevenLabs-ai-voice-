
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

function validVoiceId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (!requireMethod(req, res, ["GET", "POST", "DELETE"])) {
      return;
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("favorite_voices")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("Fetch favorites failed:", error.message);
        return sendError(res, 500, "Could not load favourite voices.");
      }

      return sendSuccess(res, {
        favorites: data || [],
        count: data?.length || 0
      });
    }

    const body = parseJsonBody(req);

    if (!body || !validVoiceId(body.voice_id)) {
      return sendError(res, 400, "A valid voice_id is required.");
    }

    const voiceId = body.voice_id;

    if (req.method === "POST") {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("favorite_voices")
        .select("user_id,voice_id")
        .eq("user_id", user.id)
        .eq("voice_id", voiceId)
        .maybeSingle();

      if (lookupError) {
        console.error("Favorite lookup failed:", lookupError.message);
        return sendError(res, 500, "Could not check favourite voice.");
      }

      if (existing) {
        return sendSuccess(res, {
          message: "Voice is already in favourites.",
          favorite: existing
        });
      }

      const { data, error } = await supabaseAdmin
        .from("favorite_voices")
        .insert({
          user_id: user.id,
          voice_id: voiceId
        })
        .select()
        .single();

      if (error) {
        console.error("Add favorite failed:", error.message);
        return sendError(res, 500, "Could not add favourite voice.");
      }

      return sendSuccess(res, {
        message: "Voice added to favourites.",
        favorite: data
      });
    }

    const { data, error } = await supabaseAdmin
      .from("favorite_voices")
      .delete()
      .eq("user_id", user.id)
      .eq("voice_id", voiceId)
      .select("voice_id");

    if (error) {
      console.error("Remove favorite failed:", error.message);
      return sendError(res, 500, "Could not remove favourite voice.");
    }

    return sendSuccess(res, {
      message: data?.length
        ? "Voice removed from favourites."
        : "Voice was not in favourites.",
      removed: data?.length || 0
    });
  } catch (error) {
    console.error("Favorites API error:", error);
    return sendError(res, 500, "An unexpected server error occurred.");
  }
}
