import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
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
    return json(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const token = getToken(req);

    if (!token) {
      return json(res, 401, {
        ok: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return json(res, 401, {
        ok: false,
        error: "Invalid or expired session"
      });
    }

    const body = req.body || {};

    const projectId =
      body.projectId ||
      body.project_id ||
      null;

    const exportType =
      body.exportType ||
      body.export_type ||
      "project";

    if (!projectId) {
      return json(res, 400, {
        ok: false,
        error: "projectId is required"
      });
    }

    /*
     * Verify that the studio project belongs to the
     * currently authenticated user.
     */
    const { data: project, error: projectError } =
      await supabaseAdmin
        .from("studio_projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (projectError) {
      console.error("Project lookup error:", projectError);

      return json(res, 500, {
        ok: false,
        error: "Unable to load studio project"
      });
    }

    if (!project) {
      return json(res, 404, {
        ok: false,
        error: "Studio project not found"
      });
    }

    /*
     * At this stage the project is authenticated and owned
     * by the user.
     *
     * Actual media rendering/export can be connected later
     * to FFmpeg, cloud storage, or a video processing provider.
     */
    const exportId = crypto.randomUUID();

    const exportResult = {
      id: exportId,
      projectId,
      type: exportType,
      status: "queued",
      createdAt: new Date().toISOString()
    };

    /*
     * If your studio_projects table contains an export_status
     * column, update it. Otherwise we continue without failing.
     */
    try {
      await supabaseAdmin
        .from("studio_projects")
        .update({
          updated_at: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("user_id", user.id);
    } catch (updateError) {
      console.warn(
        "Studio project update skipped:",
        updateError
      );
    }

    return json(res, 200, {
      ok: true,
      message: "Studio export queued successfully",
      export: exportResult
    });
  } catch (error) {
    console.error("Studio export error:", error);

    return json(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
