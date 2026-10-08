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

    const prompt =
      String(
        body.prompt ||
        body.description ||
        ""
      ).trim();

    const title =
      String(
        body.title ||
        "AI Music"
      ).trim();

    const duration =
      Number(body.duration || 30);

    if (!prompt) {
      return sendJson(res, 400, {
        ok: false,
        error: "Music prompt is required"
      });
    }

    if (
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 300
    ) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Duration must be between 1 and 300 seconds"
      });
    }

    /*
     * Music generation consumes one AI use.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "music_generation"
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

    /*
     * Music provider configuration.
     *
     * Keep provider API keys on the server.
     */
    const musicApiUrl =
      process.env.MUSIC_API_URL;

    const musicApiKey =
      process.env.MUSIC_API_KEY;

    if (!musicApiUrl || !musicApiKey) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "Music generation provider is not configured on the server."
      });
    }

    /*
     * Create a local job ID before calling the provider.
     */
    const jobId = crypto.randomUUID();

    const { error: insertError } =
      await supabaseAdmin
        .from("music_generations")
        .insert({
          id: jobId,
          user_id: user.id,
          prompt,
          title,
          duration,
          status: "processing"
        });

    if (insertError) {
      console.error(
        "Music DB insert error:",
        insertError
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to create music generation job"
      });
    }

    /*
     * Generic provider interface.
     *
     * MUSIC_API_URL and MUSIC_API_KEY are intentionally
     * configurable so we don't hard-code a provider whose
     * API may differ.
     */
    const providerResponse =
      await fetch(musicApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${musicApiKey}`
        },
        body: JSON.stringify({
          prompt,
          title,
          duration,
          user_id: user.id,
          job_id: jobId
        })
      });

    const providerData =
      await providerResponse.json().catch(
        () => ({})
      );

    if (!providerResponse.ok) {
      console.error(
        "Music provider error:",
        providerData
      );

      await supabaseAdmin
        .from("music_generations")
        .update({
          status: "failed"
        })
        .eq("id", jobId)
        .eq("user_id", user.id);

      return sendJson(
        res,
        providerResponse.status || 500,
        {
          ok: false,
          error:
            providerData?.error?.message ||
            providerData?.error ||
            "Music generation failed"
        }
      );
    }

    const audioUrl =
      providerData?.audio_url ||
      providerData?.audioUrl ||
      providerData?.url ||
      null;

    const providerJobId =
      providerData?.id ||
      providerData?.job_id ||
      providerData?.jobId ||
      null;

    const status =
      audioUrl
        ? "completed"
        : "processing";

    await supabaseAdmin
      .from("music_generations")
      .update({
        provider_job_id: providerJobId,
        audio_url: audioUrl,
        status
      })
      .eq("id", jobId)
      .eq("user_id", user.id);

    return sendJson(res, 200, {
      ok: true,
      message:
        status === "completed"
          ? "Music generated successfully"
          : "Music generation job started",
      job: {
        id: jobId,
        providerJobId,
        status,
        audioUrl
      },
      provider: providerData,
      usage
    });
  } catch (error) {
    console.error(
      "Music generation API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
