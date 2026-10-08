// api/studio/export.js

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}

async function getUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const {
      projectId,
      projectName,
      name,
      script,
      text,
      voice,
      voiceId,
      voice_id,
      language,
      style,
      speed,
      audioUrl,
      audio_url,
      metadata
    } = body;

    const finalName =
      String(projectName || name || "Untitled Project").trim();

    if (!finalName) {
      return res.status(400).json({
        error: "Project name is required"
      });
    }

    /*
     * If an existing project ID was supplied,
     * update that project.
     */
    if (projectId) {
      const { data: existingProject, error: findError } =
        await supabaseAdmin
          .from("studio_projects")
          .select("*")
          .eq("id", projectId)
          .eq("user_id", user.id)
          .maybeSingle();

      if (findError) {
        console.error("Project lookup error:", findError);

        return res.status(500).json({
          error: "Unable to find project"
        });
      }

      if (!existingProject) {
        return res.status(404).json({
          error: "Project not found"
        });
      }

      const updateData = {
        project_name: finalName,
        script: script || text || "",
        voice: voice || null,
        voice_id: voiceId || voice_id || null,
        language: language || null,
        style: style || null,
        speed: speed || 1,
        audio_url: audioUrl || audio_url || null,
        metadata: metadata || {}
      };

      const { data, error } = await supabaseAdmin
        .from("studio_projects")
        .update(updateData)
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Project update error:", error);

        return res.status(500).json({
          error: "Unable to update project",
          details: error.message
        });
      }

      return res.status(200).json({
        success: true,
        project: data
      });
    }

    /*
     * Create a new studio project.
     */
    const insertData = {
      user_id: user.id,
      project_name: finalName,
      script: script || text || "",
      voice: voice || null,
      voice_id: voiceId || voice_id || null,
      language: language || null,
      style: style || null,
      speed: speed || 1,
      audio_url: audioUrl || audio_url || null,
      metadata: metadata || {}
    };

    const { data, error } = await supabaseAdmin
      .from("studio_projects")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Project creation error:", error);

      return res.status(500).json({
        error: "Unable to save studio project",
        details: error.message
      });
    }

    return res.status(200).json({
      success: true,
      project: data
    });
  } catch (error) {
    console.error("Studio export error:", error);

    return res.status(500).json({
      error: "Studio project save failed",
      details: error.message
    });
  }
};
