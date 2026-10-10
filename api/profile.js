
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError,
  sendSuccess
} from "./_lib/response.js";

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (!requireMethod(req, res, ["GET", "PATCH"])) {
      return;
    }

    if (req.method === "GET") {
      const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, username, avatar_url, created_at")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Profile fetch error:", error.message);
        return sendError(res, 500, "Could not load profile.");
      }

      return sendSuccess(res, {
        profile: {
          id: user.id,
          email: user.email || null,
          full_name: profile?.full_name || "",
          username: profile?.username || "",
          avatar_url: profile?.avatar_url || null,
          created_at: profile?.created_at || user.created_at
        }
      });
    }

    const body = parseJsonBody(req);

    if (!body || typeof body !== "object") {
      return sendError(res, 400, "Valid JSON body is required.");
    }

    const updates = {};

    if (Object.hasOwn(body, "full_name")) {
      if (
        typeof body.full_name !== "string" ||
        body.full_name.trim().length > 80
      ) {
        return sendError(res, 400, "Name must be 80 characters or fewer.");
      }

      updates.full_name = body.full_name.trim();
    }

    if (Object.hasOwn(body, "username")) {
      if (
        typeof body.username !== "string" ||
        !/^[a-zA-Z0-9_.]{3,30}$/.test(body.username.trim())
      ) {
        return sendError(
          res,
          400,
          "Username must be 3–30 characters: letters, numbers, dots or underscores."
        );
      }

      updates.username = body.username.trim();
    }

    if (Object.hasOwn(body, "avatar_url")) {
      if (body.avatar_url !== null && typeof body.avatar_url !== "string") {
        return sendError(res, 400, "Invalid avatar URL.");
      }

      if (
        typeof body.avatar_url === "string" &&
        (
          body.avatar_url.length > 2048 ||
          !/^https:\/\/\S+$/i.test(body.avatar_url)
        )
      ) {
        return sendError(res, 400, "Avatar must be a valid HTTPS URL.");
      }

      updates.avatar_url = body.avatar_url;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 400, "No valid profile fields provided.");
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, full_name, username, avatar_url, created_at")
      .maybeSingle();

    if (error) {
      console.error("Profile update error:", error.message);

      if (error.code === "23505") {
        return sendError(res, 409, "That username is already taken.");
      }

      return sendError(res, 500, "Could not update profile.");
    }

    if (!data) {
      return sendError(res, 404, "Profile record not found.");
    }

    return sendSuccess(res, {
      message: "Profile updated successfully.",
      profile: {
        ...data,
        email: user.email || null
      }
    });
  } catch (error) {
    console.error("Profile API error:", error);
    return sendError(res, 500, "Unexpected server error.");
  }
}
