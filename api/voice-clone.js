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

    const name =
      body.name ||
      body.voiceName ||
      body.voice_name ||
      "My Voice";

    const audioUrl =
      body.audioUrl ||
      body.audio_url ||
      null;

    const description =
      body.description ||
      "";

    /*
     * Voice cloning is an AI operation, so enforce the
     * server-side Free 5/day limit.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc("check_and_use_ai", {
        p_user_id: user.id,
        p_action: "voice_clone"
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

    if (!audioUrl) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "audioUrl is required. Upload the sample audio first."
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
     * Download the supplied audio sample.
     */
    const audioResponse =
      await fetch(audioUrl);

    if (!audioResponse.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: "Unable to download audio sample"
      });
    }

    const audioBuffer =
      Buffer.from(
        await audioResponse.arrayBuffer()
      );

    /*
     * ElevenLabs voice cloning endpoint.
     */
    const formData = new FormData();

    const audioBlob = new Blob(
      [audioBuffer],
      {
        type:
          audioResponse.headers.get(
            "content-type"
          ) || "audio/mpeg"
      }
    );

    formData.append(
      "files",
      audioBlob,
      "voice-sample.mp3"
    );

    formData.append(
      "name",
      String(name).slice(0, 100)
    );

    if (description) {
      formData.append(
        "description",
        String(description).slice(0, 500)
      );
    }

    const cloneResponse =
      await fetch(
        "https://api.elevenlabs.io/v1/voices/add",
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsKey
          },
          body: formData
        }
      );

    const cloneData =
      await cloneResponse.json().catch(
        () => ({})
      );

    if (!cloneResponse.ok) {
      console.error(
        "ElevenLabs clone error:",
        cloneData
      );

      return sendJson(
        res,
        cloneResponse.status >= 400
          ? cloneResponse.status
          : 500,
        {
          ok: false,
          error:
            cloneData?.detail?.message ||
            cloneData?.detail ||
            "Voice cloning failed"
        }
      );
    }

    const providerVoiceId =
      cloneData?.voice_id ||
      cloneData?.voiceId;

    if (!providerVoiceId) {
      return sendJson(res, 502, {
        ok: false,
        error:
          "Voice provider did not return a voice ID"
      });
    }

    /*
     * Save the cloned voice in Supabase.
     */
    const { data: savedVoice, error: saveError } =
      await supabaseAdmin
        .from("voice_clones")
        .insert({
          user_id: user.id,
          name: String(name).slice(0, 100),
          provider: "elevenlabs",
          provider_voice_id: providerVoiceId,
          source_url: audioUrl,
          status: "ready"
        })
        .select()
        .single();

    if (saveError) {
      console.error(
        "Voice clone DB error:",
        saveError
      );

      /*
       * Do not pretend the clone failed if the provider
       * succeeded. Return the provider ID so the user
       * doesn't lose the created voice.
       */
      return sendJson(res, 200, {
        ok: true,
        message:
          "Voice cloned successfully, but database save failed",
        voice: {
          id: providerVoiceId,
          provider: "elevenlabs",
          status: "ready"
        },
        usage,
        warning:
          "Please save this voice ID before retrying."
      });
    }

    return sendJson(res, 200, {
      ok: true,
      message: "Voice cloned successfully",
      voice: {
        id:
          savedVoice.id ||
          providerVoiceId,
        provider: "elevenlabs",
        providerVoiceId,
        name: savedVoice.name,
        status: savedVoice.status
      },
      usage
    });
  } catch (error) {
    console.error(
      "Voice clone API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
