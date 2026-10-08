import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

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

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, data) {
  res.status(status).json(data);
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      user: null,
      token: null
    };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return {
      user: null,
      token
    };
  }

  return {
    user: data.user,
    token
  };
}

function normalizeOutputFormat(value) {
  const allowed = new Set([
    "mp3_44100_128",
    "mp3_44100_192",
    "mp3_22050_32",
    "mp3_22050_64",
    "pcm_16000",
    "pcm_22050",
    "pcm_24000",
    "pcm_44100",
    "ulaw_8000"
  ]);

  return allowed.has(value) ? value : "mp3_44100_128";
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      ok: false,
      error: "Supabase server configuration is missing."
    });
  }

  if (!ELEVENLABS_API_KEY) {
    return json(res, 500, {
      ok: false,
      error: "ElevenLabs API key is not configured."
    });
  }

  try {
    const { user } = await getUser(req);

    if (!user) {
      return json(res, 401, {
        ok: false,
        error: "Please login first."
      });
    }

    const body = req.body || {};

    const text = String(body.text || "").trim();

    const voiceId = String(
      body.voice_id ||
      body.voiceId ||
      body.voice ||
      ""
    ).trim();

    const modelId = String(
      body.model_id ||
      body.modelId ||
      "eleven_multilingual_v2"
    ).trim();

    const outputFormat = normalizeOutputFormat(
      body.output_format ||
      body.outputFormat ||
      "mp3_44100_128"
    );

    if (!text) {
      return json(res, 400, {
        ok: false,
        error: "Text is required."
      });
    }

    if (!voiceId) {
      return json(res, 400, {
        ok: false,
        error: "Voice ID is required."
      });
    }

    if (text.length > 5000) {
      return json(res, 400, {
        ok: false,
        error: "Text is too long. Maximum 5000 characters."
      });
    }

    /*
     * ---------------------------------------------------------
     * FREE PLAN LIMIT
     * ---------------------------------------------------------
     *
     * Action is independent:
     * tts = separate counter
     *
     * Free:
     * 5 uses per 24 hours for TTS.
     *
     * Premium/Admin:
     * unlimited app-level usage.
     */
    const { data: usageData, error: usageError } =
      await supabaseAdmin.rpc("check_and_use_ai", {
        p_user_id: user.id,
        p_action: "tts"
      });

    if (usageError) {
      console.error("Usage RPC error:", usageError);

      return json(res, 500, {
        ok: false,
        error: "Unable to verify usage limit."
      });
    }

    const usage = usageData || {};

    if (usage.allowed === false) {
      return json(res, 429, {
        ok: false,
        error:
          "Daily limit reached. You have used all 5 free uses for this section. Please try again after 24 hours.",
        reason: usage.reason || "daily_limit",
        usage: usage.usage ?? null,
        limit: usage.limit ?? 5,
        remaining: usage.remaining ?? 0
      });
    }

    /*
     * ---------------------------------------------------------
     * ELEVENLABS TTS
     * ---------------------------------------------------------
     */

    const providerUrl =
      `https://api.elevenlabs.io/v1/text-to-speech/` +
      `${encodeURIComponent(voiceId)}` +
      `?output_format=${encodeURIComponent(outputFormat)}`;

    const providerResponse = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: modelId
      })
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();

      console.error(
        "ElevenLabs TTS error:",
        providerResponse.status,
        errorText
      );

      return json(res, providerResponse.status, {
        ok: false,
        error: "Voice generation failed.",
        provider_status: providerResponse.status
      });
    }

    const audioBuffer = Buffer.from(
      await providerResponse.arrayBuffer()
    );

    if (!audioBuffer.length) {
      return json(res, 502, {
        ok: false,
        error: "Voice provider returned empty audio."
      });
    }

    /*
     * ---------------------------------------------------------
     * SAVE GENERATION
     * ---------------------------------------------------------
     */

    let generationId = null;

    const { data: generation, error: generationError } =
      await supabaseAdmin
        .from("tts_generations")
        .insert({
          user_id: user.id,
          voice_id: voiceId,
          text,
          model_id: modelId,
          output_format: outputFormat,
          status: "completed"
        })
        .select("id")
        .single();

    if (generationError) {
      console.error(
        "tts_generations insert error:",
        generationError
      );
    } else {
      generationId = generation?.id || null;
    }

    /*
     * ---------------------------------------------------------
     * RETURN AUDIO
     * ---------------------------------------------------------
     */

    const mimeType =
      outputFormat.startsWith("pcm_")
        ? "audio/L16"
        : outputFormat.startsWith("ulaw_")
          ? "audio/basic"
          : "audio/mpeg";

    const base64Audio = audioBuffer.toString("base64");

    return json(res, 200, {
      ok: true,

      audio: base64Audio,

      audio_base64: base64Audio,

      audio_url:
        `data:${mimeType};base64,${base64Audio}`,

      mime_type: mimeType,

      generation_id: generationId,

      voice_id: voiceId,

      model_id: modelId,

      output_format: outputFormat,

      usage: {
        allowed: true,
        used: usage.usage ?? null,
        limit: usage.limit ?? null,
        remaining: usage.remaining ?? null
      }
    });
  } catch (error) {
    console.error("TTS API error:", error);

    return json(res, 500, {
      ok: false,
      error: "Internal server error."
    });
  }
}
