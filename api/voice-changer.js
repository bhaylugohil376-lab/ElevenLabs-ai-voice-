
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/flac"
]);

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;

  let uploadedFile;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const form = formidable({
      maxFiles: 1,
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      multiples: false
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, fields, files) => {
        if (error) reject(error);
        else resolve([fields, files]);
      });
    });

    uploadedFile = Array.isArray(files.audio)
      ? files.audio[0]
      : files.audio;

    if (!uploadedFile) {
      return sendError(res, 400, "Upload an audio file in the 'audio' field.");
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const voiceValue = Array.isArray(fields.voice_id)
      ? fields.voice_id[0]
      : fields.voice_id;

    const targetVoiceId = typeof voiceValue === "string"
      ? voiceValue.trim()
      : "";

    if (!targetVoiceId || !/^[A-Za-z0-9_-]{5,100}$/.test(targetVoiceId)) {
      return sendError(res, 400, "Select a valid target voice.");
    }

    const usage = await checkAndUseAI(user, "voice_changer");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Voice Changer usage limit reached."
      );
    }

    const audioBuffer = await readFile(uploadedFile.filepath);

    if (!audioBuffer.length) {
      return sendError(res, 400, "The uploaded audio file is empty.");
    }

    const providerUrl = process.env.VOICE_CHANGER_API_URL;
    const providerKey = process.env.VOICE_CHANGER_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendError(
        res,
        503,
        "Voice conversion provider is not configured. Set VOICE_CHANGER_API_URL and VOICE_CHANGER_API_KEY."
      );
    }

    // Provider-specific upload fields and response formats differ.
    // Add the real provider adapter after selecting and verifying its API.
    return sendError(
      res,
      501,
      "Provider credentials are present, but the voice-conversion API adapter is not implemented yet."
    );
  } catch (error) {
    console.error("Voice Changer API error:", error.message);

    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Audio file must be 20 MB or smaller.");
    }

    return sendError(res, 500, "Voice conversion request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
