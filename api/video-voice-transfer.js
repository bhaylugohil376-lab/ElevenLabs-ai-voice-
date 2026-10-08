import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getToken(req) {
  const auth = req.headers.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.substring(7).trim();
}

function sendJson(res, status, data) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  return res.status(status).json(data);
}

async function getUser(req) {
  const token = getToken(req);

  if (!token) return null;

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return sendJson(res, 401, {
        ok: false,
        error: "Authentication required"
      });
    }

    const {
      videoUrl,
      video_url,
      audioUrl,
      audio_url,
      voiceId,
      voice_id
    } = req.body || {};

    const sourceVideo =
      videoUrl || video_url || null;

    const sourceAudio =
      audioUrl || audio_url || null;

    const selectedVoice =
      voiceId || voice_id || null;

    if (!sourceVideo) {
      return sendJson(res, 400, {
        ok: false,
        error: "videoUrl is required"
      });
    }

    if (!sourceAudio && !selectedVoice) {
      return sendJson(res, 400, {
        ok: false,
        error: "audioUrl or voiceId is required"
      });
    }

    /*
     * IMPORTANT:
     * The actual video/audio processing should happen through
     * your configured media-processing provider or FFmpeg.
     *
     * We first enforce the same server-side 5/day AI limit.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc("check_and_use_ai", {
        p_user_id: user.id,
        p_action: "video_voice_transfer"
      });

    if (usageError) {
      console.error("Usage RPC error:", usageError);

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to verify AI usage limit"
      });
    }

    const usage =
      Array.isArray(usageResult)
        ? usageResult[0]
        : usageResult;

    if (!usage?.allowed) {
      return sendJson(res, 429, {
        ok: false,
        error:
          usage?.reason ||
          "Daily AI usage limit reached",
        usage
      });
    }

    /*
     * Generate a job ID.
     */
    const jobId = crypto.randomUUID();

    /*
     * Store the job in Supabase.
     *
     * The insert is attempted only if the table exists.
     */
    const { error: insertError } =
      await supabaseAdmin
        .from("voice_change_jobs")
        .insert({
          id: jobId,
          user_id: user.id,
          source_url: sourceVideo,
          voice_id: selectedVoice,
          status: "queued"
        });

    if (insertError) {
      console.error(
        "Voice transfer job insert error:",
        insertError
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to create voice transfer job"
      });
    }

    /*
     * If FFmpeg is configured in the deployment environment,
     * the actual processing worker can consume this queued job.
     *
     * We intentionally do not fake a completed media URL.
     */
    return sendJson(res, 200, {
      ok: true,
      message: "Video voice transfer job queued",
      job: {
        id: jobId,
        status: "queued"
      },
      usage
    });
  } catch (error) {
    console.error(
      "Video voice transfer error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
