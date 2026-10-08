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

    const audioUrl =
      body.audioUrl ||
      body.audio_url ||
      body.url ||
      null;

    const language =
      body.language ||
      null;

    if (!audioUrl) {
      return sendJson(res, 400, {
        ok: false,
        error: "audioUrl is required"
      });
    }

    /*
     * STT is an AI operation.
     * Free users: maximum 5 AI uses/day.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "speech_to_text"
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
     * Download the audio from the supplied URL.
     */
    const audioResponse =
      await fetch(audioUrl);

    if (!audioResponse.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: "Unable to download audio"
      });
    }

    const contentType =
      audioResponse.headers.get(
        "content-type"
      ) || "audio/mpeg";

    const audioBuffer =
      Buffer.from(
        await audioResponse.arrayBuffer()
      );

    /*
     * Basic size protection.
     */
    const maxSize =
      25 * 1024 * 1024;

    if (audioBuffer.length > maxSize) {
      return sendJson(res, 413, {
        ok: false,
        error:
          "Audio file is too large. Maximum size is 25 MB."
      });
    }

    const formData = new FormData();

    formData.append(
      "file",
      new Blob(
        [audioBuffer],
        { type: contentType }
      ),
      "audio-input.mp3"
    );

    if (language) {
      formData.append(
        "language_code",
        String(language).slice(0, 20)
      );
    }

    /*
     * ElevenLabs Speech-to-Text.
     */
    const sttResponse =
      await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsKey
          },
          body: formData
        }
      );

    const sttData =
      await sttResponse.json().catch(
        () => ({})
      );

    if (!sttResponse.ok) {
      console.error(
        "ElevenLabs STT error:",
        sttData
      );

      return sendJson(
        res,
        sttResponse.status || 500,
        {
          ok: false,
          error:
            sttData?.detail?.message ||
            sttData?.detail ||
            "Speech-to-text failed"
        }
      );
    }

    const text =
      sttData?.text ||
      sttData?.transcript ||
      "";

    /*
     * Save STT result.
     */
    const { data: savedJob, error: saveError } =
      await supabaseAdmin
        .from("stt_jobs")
        .insert({
          user_id: user.id,
          source_url: audioUrl,
          language: language,
          transcript: text,
          status: "completed"
        })
        .select()
        .single();

    if (saveError) {
      console.error(
        "STT database error:",
        saveError
      );

      /*
       * Provider succeeded, so return the transcript
       * instead of falsely reporting failure.
       */
      return sendJson(res, 200, {
        ok: true,
        transcript: text,
        result: sttData,
        usage,
        warning:
          "Transcript generated, but database save failed."
      });
    }

    return sendJson(res, 200, {
      ok: true,
      transcript: text,
      job: {
        id: savedJob.id,
        status: savedJob.status
      },
      result: sttData,
      usage
    });
  } catch (error) {
    console.error(
      "STT API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
