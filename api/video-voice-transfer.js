import formidable from "formidable";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export const config = {
  api: {
    bodyParser: false
  }
};

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

function getValue(value, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

async function parseForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) reject(error);
      else resolve({ fields, files });
    });
  });
}

async function elevenLabsTTS({
  text,
  voiceId,
  language
}) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        language_code: language || undefined,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS error: ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function getVoiceId(type) {
  const response = await fetch(
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unable to load ElevenLabs voices.");
  }

  const data = await response.json();
  const voices = Array.isArray(data.voices) ? data.voices : [];

  const wantedGender =
    String(type).toLowerCase() === "female"
      ? "female"
      : "male";

  const matching = voices.filter((voice) => {
    const labels = voice.labels || {};
    return String(labels.gender || "").toLowerCase() === wantedGender;
  });

  const selected = matching[0] || voices[0];

  if (!selected?.voice_id) {
    throw new Error("No suitable AI voice found.");
  }

  return selected.voice_id;
}

export default async function handler(req, res) {
  let tempDir = null;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "POST method required."
      });
    }

    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "ELEVENLABS_API_KEY is not configured."
      });
    }

    const { fields, files } = await parseForm(req);

    const uploadedVideo =
      files.video ||
      files.file ||
      files.videoFile;

    if (!uploadedVideo) {
      return res.status(400).json({
        success: false,
        error: "Video file is required."
      });
    }

    const videoFile = Array.isArray(uploadedVideo)
      ? uploadedVideo[0]
      : uploadedVideo;

    const language = getValue(fields.language, "en");
    const voiceType = getValue(fields.voiceType, "male");
    const projectName = getValue(
      fields.projectName,
      "VoiceAI Video"
    );

    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "voiceai-")
    );

    const inputVideo = videoFile.filepath;

    const originalAudio = path.join(
      tempDir,
      "original.wav"
    );

    const generatedAudio = path.join(
      tempDir,
      "ai-voice.mp3"
    );

    const outputVideo = path.join(
      tempDir,
      "voiceai-output.mp4"
    );

    /*
     * 1. Extract original video audio.
     */
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputVideo,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      originalAudio
    ]);

    /*
     * 2. Speech-to-Text.
     */
    const audioBuffer = fs.readFileSync(originalAudio);

    const sttForm = new FormData();

    sttForm.append(
      "file",
      new Blob([audioBuffer], {
        type: "audio/wav"
      }),
      "audio.wav"
    );

    sttForm.append(
      "model_id",
      "scribe_v1"
    );

    const sttResponse = await fetch(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY
        },
        body: sttForm
      }
    );

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();

      throw new Error(
        `Speech-to-Text error: ${errorText}`
      );
    }

    const sttData = await sttResponse.json();

    const transcript =
      sttData.text ||
      sttData.transcript ||
      "";

    if (!transcript.trim()) {
      throw new Error(
        "No speech was detected in the video."
      );
    }

    /*
     * 3. Select AI voice.
     */
    const voiceId = await getVoiceId(
      voiceType
    );

    /*
     * 4. Generate AI voice.
     */
    const aiAudio = await elevenLabsTTS({
      text: transcript,
      voiceId,
      language
    });

    fs.writeFileSync(
      generatedAudio,
      aiAudio
    );

    /*
     * 5. Replace original audio.
     *
     * Video stream stays unchanged.
     * AI-generated audio becomes the new soundtrack.
     */
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputVideo,
      "-i",
      generatedAudio,

      "-map",
      "0:v:0",
      "-map",
      "1:a:0",

      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",

      "-shortest",

      outputVideo
    ]);

    const result = fs.readFileSync(
      outputVideo
    );

    const safeName = projectName
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .slice(0, 60);

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName || "voiceai-video"}.mp4"`
    );

    res.setHeader(
      "Content-Length",
      result.length
    );

    return res.end(result);

  } catch (error) {
    console.error(
      "Video Voice Transfer Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Video voice transfer failed."
    });

  } finally {
    /*
     * Cleanup temporary files.
     */
    if (tempDir) {
      try {
        fs.rmSync(tempDir, {
          recursive: true,
          force: true
        });
      } catch (cleanupError) {
        console.error(
          "Cleanup error:",
          cleanupError
        );
      }
    }
  }
}
