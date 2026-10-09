
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return sendError(res, 503, "Text-to-Speech provider is not configured.");
    }

    const body = req.body && typeof req.body === "object"
      ? req.body
      : {};

    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voiceId = typeof body.voice_id === "string"
      ? body.voice_id.trim()
      : "";

    if (!text) {
      return sendError(res, 400, "Please enter text to convert.");
    }

    if (text.length > 5000) {
      return sendError(res, 400, "Text must be 5000 characters or fewer.");
    }

    if (!voiceId || !/^[A-Za-z0-9_-]{5,100}$/.test(voiceId)) {
      return sendError(res, 400, "Please select a valid voice.");
    }

    const usage = await checkAndUseAI(user, "tts");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Usage limit reached."
      );
    }

    const modelId =
      typeof body.model_id === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(body.model_id)
        ? body.model_id
        : "eleven_multilingual_v2";

    const outputFormat =
      typeof body.output_format === "string" &&
      ["mp3_44100_128", "mp3_22050_32", "pcm_16000"].includes(body.output_format)
        ? body.output_format
        : "mp3_44100_128";

    const providerResponse = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: modelId
        })
      }
    );

    if (!providerResponse.ok) {
      const providerMessage = await providerResponse.text();
      console.error(
        "ElevenLabs TTS failed:",
        providerResponse.status,
        providerMessage.slice(0, 500)
      );

      if (providerResponse.status === 401 || providerResponse.status === 403) {
        return sendError(res, 502, "The voice provider rejected the server API key or permissions.");
      }

      if (providerResponse.status === 429) {
        return sendError(res, 429, "The voice provider rate limit or quota was reached.");
      }

      return sendError(res, 502, "Audio generation failed. Please try again.");
    }

    const audioBuffer = Buffer.from(await providerResponse.arrayBuffer());

    if (!audioBuffer.length) {
      return sendError(res, 502, "The voice provider returned empty audio.");
    }

    res.setHeader(
      "Content-Type",
      outputFormat.startsWith("pcm_") ? "audio/pcm" : "audio/mpeg"
    );
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Usage-Remaining", usage.remaining == null ? "unlimited" : String(usage.remaining));

    return res.status(200).send(audioBuffer);
  } catch (error) {
    console.error("TTS API error:", error.message);
    return sendError(res, 500, "An unexpected error occurred during audio generation.");
  }
}
