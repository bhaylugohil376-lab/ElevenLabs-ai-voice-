
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  sendError,
  sendSuccess
} from "./_lib/response.js";

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (!requireMethod(req, res, ["GET", "DELETE"])) {
      return;
    }

    if (req.method === "GET") {
      const limit = Math.min(
        Math.max(Number.parseInt(req.query?.limit, 10) || 20, 1),
        100
      );

      let query = supabaseAdmin
        .from("generations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      const type = req.query?.type;

      if (type) {
        const allowedTypes = [
          "tts",
          "voice_clone",
          "voice_changer",
          "dubbing",
          "music",
          "sound_effects",
          "captions",
          "image",
          "studio"
        ];

        if (!allowedTypes.includes(type)) {
          return sendError(res, 400, "Invalid generation type.");
        }

        query = query.eq("type", type);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Generation history error:", error.message);
        return sendError(res, 500, "Could not load generation history.");
      }

      return sendSuccess(res, {
        generations: data || [],
        count: data?.length || 0
      });
    }

    const id = req.body?.id;

    if (
      typeof id !== "string" ||
      id.length < 1 ||
      id.length > 100
    ) {
      return sendError(res, 400, "A valid generation id is required.");
    }

    const { data, error } = await supabaseAdmin
      .from("generations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      console.error("Delete generation error:", error.message);
      return sendError(res, 500, "Could not delete generation.");
    }

    if (!data?.length) {
      return sendError(res, 404, "Generation not found.");
    }

    return sendSuccess(res, {
      message: "Generation deleted.",
      id: data[0].id
    });
  } catch (error) {
    console.error("Generations API error:", error);
    return sendError(res, 500, "Unexpected server error.");
  }
}
