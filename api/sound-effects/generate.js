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

    const prompt = String(
      body.prompt ||
      body.description ||
      body.text ||
      ""
    ).trim();

    const duration = Number(
      body.duration || 5
    );

    if (!prompt) {
      return sendJson(res, 400, {
        ok: false,
        error: "Sound-effect prompt is required"
      });
    }

    if (
      !Number.isFinite(duration) ||
      duration < 0.5 ||
      duration > 60
    ) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Duration must be between 0.5 and 60 seconds"
      });
    }

    /*
     * Server-side Free plan limit:
     * 5 AI operations per day.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "sound_effect_generation"
        }
      );

    if (usageError) {
      console.error(
        "Usage RPC error:",
        usageError
      );

      return sendJson(res, 500, {
        ok: false,
        error:
          "Unable to verify AI usage limit"
      });
    }

    const usage = Array.isArray(usageResult)
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
     * Provider is configurable.
     *
     * Never expose this API key to the browser.
     */
    const providerUrl =
      process.env.SOUND_EFFECTS_API_URL;

    const providerKey =
      process.env.SOUND_EFFECTS_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "Sound-effects provider is not configured on the server."
      });
    }

    const jobId = crypto.randomUUID();

    /*
     * Create database record before provider request.
     */
    const { error: insertError } =
      await supabaseAdmin
        .from("sound_effect_generations")
        .insert({
          id: jobId,
          user_id: user.id,
          prompt,
          duration,
          status: "processing"
        });

    if (insertError) {
      console.error(
        "Sound-effects DB insert error:",
        insertError
      );

      return sendJson(res, 500, {
        ok: false,
        error:
          "Unable to create sound-effect job"
      });
    }

    /*
     * Generic provider interface.
     */
    const providerResponse =
      await fetch(providerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${providerKey}`
        },
        body: JSON.stringify({
          prompt,
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
        "Sound-effects provider error:",
        providerData
      );

      await supabaseAdmin
        .from("sound_effect_generations")
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
            "Sound-effect generation failed"
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

    const status = audioUrl
      ? "completed"
      : "processing";

    await supabaseAdmin
      .from("sound_effect_generations")
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
          ? "Sound effect generated successfully"
          : "Sound-effect job started",
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
      "Sound-effects API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
