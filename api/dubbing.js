import { createClient } from "@supabase/supabase-js";

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
    const token = getToken(req);

    if (!token) {
      return sendJson(res, 401, {
        ok: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return sendJson(res, 401, {
        ok: false,
        error: "Invalid or expired session"
      });
    }

    const body = req.body || {};

    const sourceUrl =
      body.sourceUrl ||
      body.source_url ||
      body.videoUrl ||
      body.video_url ||
      null;

    const targetLanguage =
      body.targetLanguage ||
      body.target_language ||
      body.language ||
      null;

    const sourceLanguage =
      body.sourceLanguage ||
      body.source_language ||
      null;

    const voiceId =
      body.voiceId ||
      body.voice_id ||
      null;

    if (!sourceUrl) {
      return sendJson(res, 400, {
        ok: false,
        error: "sourceUrl is required"
      });
    }

    if (!targetLanguage) {
      return sendJson(res, 400, {
        ok: false,
        error: "targetLanguage is required"
      });
    }

    /*
     * Dubbing consumes one AI use for Free users.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "dubbing"
        }
      );

    if (usageError) {
      console.error(
        "Usage RPC error:",
        usageError
      );

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

    const elevenLabsKey =
      process.env.ELEVENLABS_API_KEY;

    if (!elevenLabsKey) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "ElevenLabs API is not configured on the server."
      });
    }

    /*
     * Create a local dubbing job first.
     */
    const jobId = crypto.randomUUID();

    const { error: insertError } =
      await supabaseAdmin
        .from("dubbing_jobs")
        .insert({
          id: jobId,
          user_id: user.id,
          source_url: sourceUrl,
          source_language: sourceLanguage,
          target_language: targetLanguage,
          voice_id: voiceId,
          status: "processing"
        });

    if (insertError) {
      console.error(
        "Dubbing DB insert error:",
        insertError
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to create dubbing job"
      });
    }

    /*
     * ElevenLabs dubbing API.
     *
     * The media URL is sent to ElevenLabs, which performs
     * transcription, translation, voice generation and
     * synchronization.
     */
    const formData = new FormData();

    formData.append(
      "source_url",
      sourceUrl
    );

    formData.append(
      "target_lang",
      String(targetLanguage)
    );

    if (sourceLanguage) {
      formData.append(
        "source_lang",
        String(sourceLanguage)
      );
    }

    if (voiceId) {
      formData.append(
        "voice_id",
        String(voiceId)
      );
    }

    const dubbingResponse =
      await fetch(
        "https://api.elevenlabs.io/v1/dubbing",
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsKey
          },
          body: formData
        }
      );

    const dubbingData =
      await dubbingResponse.json().catch(
        () => ({})
      );

    if (!dubbingResponse.ok) {
      console.error(
        "ElevenLabs dubbing error:",
        dubbingData
      );

      await supabaseAdmin
        .from("dubbing_jobs")
        .update({
          status: "failed"
        })
        .eq("id", jobId)
        .eq("user_id", user.id);

      return sendJson(
        res,
        dubbingResponse.status || 500,
        {
          ok: false,
          error:
            dubbingData?.detail?.message ||
            dubbingData?.detail ||
            "Dubbing failed"
        }
      );
    }

    const providerDubbingId =
      dubbingData?.dubbing_id ||
      dubbingData?.id;

    /*
     * ElevenLabs may process dubbing asynchronously.
     */
    const finalStatus =
      providerDubbingId
        ? "processing"
        : "completed";

    const { error: updateError } =
      await supabaseAdmin
        .from("dubbing_jobs")
        .update({
          provider_job_id:
            providerDubbingId || null,
          status: finalStatus
        })
        .eq("id", jobId)
        .eq("user_id", user.id);

    if (updateError) {
      console.error(
        "Dubbing DB update error:",
        updateError
      );
    }

    return sendJson(res, 200, {
      ok: true,
      message:
        "Dubbing job created successfully",
      job: {
        id: jobId,
        providerJobId:
          providerDubbingId || null,
        status: finalStatus
      },
      result: dubbingData,
      usage
    });
  } catch (error) {
    console.error(
      "Dubbing API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
