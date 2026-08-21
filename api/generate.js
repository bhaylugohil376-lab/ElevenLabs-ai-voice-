// =====================================================
// VOICEFORGE AI
// REAL ELEVENLABS TEXT-TO-SPEECH BACKEND
// Vercel Serverless Function
// =====================================================

export default async function handler(req, res) {

  // ---------------------------------------------
  // Only POST requests
  // ---------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }


  // ---------------------------------------------
  // API KEY
  // ---------------------------------------------

  const API_KEY =
    process.env.ELEVENLABS_API_KEY;

  if (!API_KEY) {

    return res.status(500).json({
      success: false,
      error:
        "ELEVENLABS_API_KEY is not configured on the server."
    });
  }


  try {

    // ---------------------------------------------
    // READ REQUEST
    // ---------------------------------------------

    const {
      text,
      voiceId,
      modelId
    } = req.body || {};


    // ---------------------------------------------
    // VALIDATION
    // ---------------------------------------------

    if (!text || !text.trim()) {

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


    // ---------------------------------------------
    // LIMIT
    // ---------------------------------------------

    if (text.length > 5000) {

      return res.status(400).json({
        success: false,
        error:
          "Text is too long. Maximum 5000 characters."
      });
    }


    // ---------------------------------------------
    // ELEVENLABS MODEL
    // ---------------------------------------------

    const selectedModel =
      modelId ||
      "eleven_multilingual_v2";


    // ---------------------------------------------
    // ELEVENLABS API REQUEST
    // ---------------------------------------------

    const response =
      await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          voiceId
        )}`,
        {
          method: "POST",

          headers: {
            "xi-api-key": API_KEY,
            "Content-Type":
              "application/json",
            "Accept":
              "audio/mpeg"
          },

          body: JSON.stringify({

            text: text.trim(),

            model_id:
              selectedModel,

            voice_settings: {

              stability: 0.5,

              similarity_boost: 0.75,

              style: 0.2,

              use_speaker_boost: true

            }

          })

        }
      );


    // ---------------------------------------------
    // API ERROR
    // ---------------------------------------------

    if (!response.ok) {

      let errorMessage =
        "ElevenLabs request failed.";

      try {

        const errorData =
          await response.json();

        errorMessage =
          errorData?.detail?.message ||
          errorData?.detail ||
          errorMessage;

      } catch {
        // Ignore JSON parsing error
      }


      return res.status(
        response.status
      ).json({

        success: false,

        error:
          errorMessage

      });
    }


    // ---------------------------------------------
    // GET AUDIO
    // ---------------------------------------------

    const audioBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );


    // ---------------------------------------------
    // RETURN MP3
    // ---------------------------------------------

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voiceforge-ai.mp3"'
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res.status(200).send(
      audioBuffer
    );


  } catch (error) {

    console.error(
      "Voice generation error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        "Voice generation failed. Please try again."

    });

  }

}
