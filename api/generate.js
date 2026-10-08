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

    const text = String(
      body.text ||
      body.input ||
      body.script ||
      ""
    ).trim();

    const voiceId =
      body.voiceId ||
      body.voice_id ||
      null;

    const modelId =
      body.modelId ||
      body.model_id ||
      "eleven_multilingual_v2";

    const outputFormat =
      body.outputFormat ||
      body.output_format ||
      "mp3_44100_128";

    if (!text) {
      return sendJson(res, 400, {
        ok: false,
        error: "Text is required"
      });
    }

    if (text.length > 10000) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Text is too long. Maximum 10,000 characters."
      });
    }

    if (!voiceId) {
      return sendJson(res, 400, {
        ok: false,
        error: "voiceId is required"
      });
    }

    /*
     * Server-side Free plan limit.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "text_to_speech"
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
     * Verify that the requested voice exists in our
     * public VoiceAI library OR belongs to the user.
     *
     * This prevents arbitrary provider voice IDs from
     * being submitted through the public endpoint.
     */
    const { data: libraryVoice } =
      await supabaseAdmin
        .from("voices")
        .select(
          "id, provider_voice_id, is_public"
        )
        .eq("provider_voice_id", voiceId)
        .eq("is_public", true)
        .maybeSingle();

    const { data: clonedVoice } =
      await supabaseAdmin
        .from("voice_clones")
        .select(
          "id, provider_voice_id, user_id, status"
        )
        .eq("provider_voice_id", voiceId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (!libraryVoice && !clonedVoice) {
      return sendJson(res, 404, {
        ok: false,
        error: "Voice not found or not available to you"
      });
    }

    if (
      clonedVoice &&
      clonedVoice.status &&
      clonedVoice.status !== "ready"
    ) {
      return sendJson(res, 409, {
        ok: false,
        error: "Selected cloned voice is not ready"
      });
    }

    /*
     * Generate speech through ElevenLabs.
     */
    const providerResponse =
      await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          voiceId
        )}?output_format=${encodeURIComponent(
          outputFormat
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenLabsKey,
            Accept: "audio/mpeg"
          },
          body: JSON.stringify({
            text,
            model_id: modelId
          })
        }
      );

    if (!providerResponse.ok) {
      const providerError =
        await providerResponse
          .json()
          .catch(() => ({}));

      console.error(
        "ElevenLabs TTS error:",
        providerError
      );

      return sendJson(
        res,
        providerResponse.status || 500,
        {
          ok: false,
          error:
            providerError?.detail?.message ||
            providerError?.detail ||
            "Text-to-speech generation failed"
        }
      );
    }

    /*
     * Convert provider audio to base64 for the frontend.
     *
     * For production with long audio, this should be moved
     * to Supabase Storage instead of returning base64.
     */
    const audioBuffer =
      Buffer.from(
        await providerResponse.arrayBuffer()
      );

    const audioBase64 =
      audioBuffer.toString("base64");

    const audioMime =
      providerResponse.headers.get(
        "content-type"
      ) || "audio/mpeg";

    /*
     * Save generation metadata.
     */
    const { data: savedGeneration, error: saveError } =
      await supabaseAdmin
        .from("tts_generations")
        .insert({
          user_id: user.id,
          voice_id: voiceId,
          text,
          model_id: modelId,
          status: "completed"
        })
        .select()
        .single();

    if (saveError) {
      console.error(
        "TTS database error:",
        saveError
      );

      return sendJson(res, 200, {
        ok: true,
        message:
          "Speech generated successfully, but database save failed",
        audio: {
          base64: audioBase64,
          mimeType: audioMime
        },
        usage
      });
    }

    return sendJson(res, 200, {
      ok: true,
      message: "Speech generated successfully",
      generation: {
        id: savedGeneration.id,
        status: savedGeneration.status
      },
      audio: {
        base64: audioBase64,
        mimeType: audioMime
      },
      usage
    });
  } catch (error) {
    console.error(
      "Generate/TTS API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
