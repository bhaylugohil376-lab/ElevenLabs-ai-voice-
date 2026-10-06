// =====================================================
// VOICEAI — REAL ELEVENLABS TEXT-TO-SPEECH
// Vercel Serverless Function
// =====================================================

export default async function handler(req, res) {

  // ---------------------------------------------------
  // POST only
  // ---------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  // ---------------------------------------------------
  // API KEY
  // ---------------------------------------------------

  const API_KEY =
    process.env.ELEVENLABS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      error: "ELEVENLABS_API_KEY is not configured."
    });
  }

  try {

    // -------------------------------------------------
    // REQUEST BODY
    // -------------------------------------------------

    const body = req.body || {};

    const text =
      typeof body.text === "string"
        ? body.text.trim()
        : "";

    // Support all names used by frontend
    const voiceId =
      body.voice_id ||
      body.voice ||
      body.voiceId ||
      "";

    const modelId =
      body.model_id ||
      body.modelId ||
      "eleven_multilingual_v2";

    const language =
      body.language ||
      "";

    const speed =
      Number(body.speed) || 1;

    const style =
      body.style ||
      "natural";

    // -------------------------------------------------
    // VALIDATION
    // -------------------------------------------------

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required."
      });
    }

    if (!voiceId) {
      return res.status(400).json({
        success: false,
        error: "Voice ID is required."
      });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Maximum 5000 characters allowed."
      });
    }

    // Keep speed in a safe range
    const safeSpeed =
      Math.min(
        1.2,
        Math.max(
          0.7,
          speed
        )
      );

    // -------------------------------------------------
    // STYLE SETTINGS
    // -------------------------------------------------

    let stability = 0.5;
    let similarityBoost = 0.75;
    let styleAmount = 0.2;

    switch (style) {

      case "professional":
        stability = 0.65;
        similarityBoost = 0.8;
        styleAmount = 0.15;
        break;

      case "advertisement":
        stability = 0.4;
        similarityBoost = 0.8;
        styleAmount = 0.45;
        break;

      case "energetic":
        stability = 0.35;
        similarityBoost = 0.8;
        styleAmount = 0.55;
        break;

      case "calm":
        stability = 0.75;
        similarityBoost = 0.8;
        styleAmount = 0.1;
        break;

      default:
        stability = 0.5;
        similarityBoost = 0.75;
        styleAmount = 0.2;
    }

    // -------------------------------------------------
    // ELEVENLABS REQUEST
    // -------------------------------------------------

    const elevenLabsUrl =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}`;

    const response =
      await fetch(
        elevenLabsUrl,
        {
          method: "POST",

          headers: {
            "xi-api-key": API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
          },

          body: JSON.stringify({

            text,

            model_id:
              modelId,

            language_code:
              language || undefined,

            voice_settings: {

              stability,

              similarity_boost:
                similarityBoost,

              style:
                styleAmount,

              use_speaker_boost:
                true
            },

            // ElevenLabs speed generally
            // works around 0.7–1.2.
            speed:
              safeSpeed
          })
        }
      );

    // -------------------------------------------------
    // ELEVENLABS ERROR
    // -------------------------------------------------

    if (!response.ok) {

      let errorMessage =
        "ElevenLabs request failed.";

      try {

        const errorData =
          await response.json();

        errorMessage =
          errorData?.detail?.message ||
          errorData?.detail?.status ||
          errorData?.detail ||
          errorMessage;

      } catch {
        // Response wasn't JSON.
      }

      console.error(
        "ElevenLabs error:",
        errorMessage
      );

      return res.status(
        response.status
      ).json({

        success: false,

        error:
          errorMessage

      });
    }

    // -------------------------------------------------
    // AUDIO BUFFER
    // -------------------------------------------------

    const audioBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (!audioBuffer.length) {
      return res.status(502).json({
        success: false,
        error: "ElevenLabs returned empty audio."
      });
    }

    // -------------------------------------------------
    // RETURN MP3
    // -------------------------------------------------

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voiceai-generated.mp3"'
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    return res.status(200).send(
      audioBuffer
    );

  } catch (error) {

    console.error(
      "VoiceAI TTS error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Voice generation failed. Please try again."
    });
  }
}
