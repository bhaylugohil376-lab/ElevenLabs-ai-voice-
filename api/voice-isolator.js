
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { requireUser } from "./_lib/auth.js";
import { checkAndUseAI } from "./_lib/usage.js";
import { requireMethod, sendError } from "./_lib/response.js";

export const config = {
  api: { bodyParser: false }
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
      return sendError(res, 400, "Upload an audio file using the 'audio' field.");
    }

    if (!ALLOWED_TYPES.has(uploadedFile.mimetype || "")) {
      return sendError(res, 400, "Unsupported audio format.");
    }

    const modeValue = Array.isArray(fields.mode)
      ? fields.mode[0]
      : fields.mode;

    const mode = typeof modeValue === "string" ? modeValue.trim() : "";

    const allowedModes = new Set([
      "isolate_vocals",
      "remove_vocals",
      "reduce_noise"
    ]);

    if (!allowedModes.has(mode)) {
      return sendError(
        res,
        400,
        "Choose isolate_vocals, remove_vocals, or reduce_noise."
      );
    }

    const usage = await checkAndUseAI(user, "voice_isolator");

    if (!usage.allowed) {
      return sendError(
        res,
        usage.status || 429,
        usage.error || "Voice Isolator usage limit reached."
      );
    }

    const audioBuffer = await readFile(uploadedFile.filepath);

    if (!audioBuffer.length) {
      return sendError(res, 400, "The uploaded audio file is empty.");
    }

    const providerUrl = process.env.VOICE_ISOLATOR_API_URL;
    const providerKey = process.env.VOICE_ISOLATOR_API_KEY;

    if (!providerUrl || !providerKey) {
      return sendError(
        res,
        503,
        "Voice Isolator provider is not configured."
      );
    }

    // Implement the provider-specific multipart request after
    // verifying the provider's endpoint, fields, and output format.
    return sendError(
      res,
      501,
      "Provider credentials are present, but the isolation adapter is not implemented yet."
    );
  } catch (error) {
    console.error("Voice Isolator API error:", error.message);

    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "Audio file must be 25 MB or smaller.");
    }

    return sendError(res, 500, "Voice isolation request failed.");
  } finally {
    if (uploadedFile?.filepath) {
      await unlink(uploadedFile.filepath).catch(() => {});
    }
  }
}
