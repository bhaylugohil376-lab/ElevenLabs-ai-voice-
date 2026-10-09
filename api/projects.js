
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError
} from "./_lib/response.js";

const ALLOWED_TYPES = new Set([
  "tts",
  "voice_clone",
  "voice_changer",
  "dubbing",
  "music",
  "sound_effects",
  "captions",
  "image",
  "studio",
  "other"
]);

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;

  const result = value.trim();

  if (!result || result.length > maxLength) return null;

  return result;
}

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendError(res, 405, "Method not allowed.");
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Project list error:", error.message);
        return sendError(res, 500, "Could not load your projects.");
      }

      return res.status(200).json({
        success: true,
        projects: data || []
      });
    }

    const body = parseJsonBody(req);

    if (!body) {
      return sendError(res, 400, "Send a valid JSON request.");
    }

    if (req.method === "POST") {
      const title = cleanString(body.title, MAX_TITLE_LENGTH);

      if (!title) {
        return sendError(
          res,
          400,
          "Project title is required (maximum 120 characters)."
        );
      }

      const description =
        body.description === undefined
          ? ""
          : typeof body.description === "string"
            ? body.description.trim()
            : null;

      if (
        description === null ||
        description.length > MAX_DESCRIPTION_LENGTH
      ) {
        return sendError(res, 400, "Invalid project description.");
      }

      const type = body.type || "other";

      if (typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
        return sendError(res, 400, "Invalid project type.");
      }

      const { data, error } = await supabaseAdmin
        .from("projects")
        .insert({
          user_id: user.id,
          title,
          description,
          type
        })
        .select("*")
        .single();

      if (error) {
        console.error("Project create error:", error.message);
        return sendError(res, 500, "Could not create the project.");
      }

      return res.status(201).json({
        success: true,
        project: data
      });
    }

    const projectId =
      typeof body.id === "string" ? body.id.trim() : "";

    if (
      !projectId ||
      projectId.length > 100 ||
      !/^[a-zA-Z0-9_-]+$/.test(projectId)
    ) {
      return sendError(res, 400, "A valid project id is required.");
    }

    // All modifications are scoped to the authenticated owner.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError) {
      console.error("Project lookup error:", lookupError.message);
      return sendError(res, 500, "Could not verify project ownership.");
    }

    if (!existing) {
      return sendError(res, 404, "Project not found.");
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Project delete error:", error.message);
        return sendError(res, 500, "Could not delete the project.");
      }

      return res.status(200).json({
        success: true,
        deleted: true,
        id: projectId
      });
    }

    const updates = {};

    if (body.title !== undefined) {
      const title = cleanString(body.title, MAX_TITLE_LENGTH);

      if (!title) {
        return sendError(res, 400, "Invalid project title.");
      }

      updates.title = title;
    }

    if (body.description !== undefined) {
      if (
        typeof body.description !== "string" ||
        body.description.trim().length > MAX_DESCRIPTION_LENGTH
      ) {
        return sendError(res, 400, "Invalid project description.");
      }

      updates.description = body.description.trim();
    }

    if (body.type !== undefined) {
      if (
        typeof body.type !== "string" ||
        !ALLOWED_TYPES.has(body.type)
      ) {
        return sendError(res, 400, "Invalid project type.");
      }

      updates.type = body.type;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 400, "No valid project fields to update.");
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("projects")
      .update(updates)
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      console.error("Project update error:", error.message);
      return sendError(res, 500, "Could not update the project.");
    }

    return res.status(200).json({
      success: true,
      project: data
    });
  } catch (error) {
    console.error("Projects API error:", error.message);
    return sendError(res, 500, "Project operation failed.");
  }
}
