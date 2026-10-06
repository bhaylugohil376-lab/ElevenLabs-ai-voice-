import formidable from "formidable";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import ffmpegPath from "ffmpeg-static";

export const config = {
  api: {
    bodyParser: false,
  },
};

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      args,
      {
        maxBuffer: 1024 * 1024 * 10,
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("FFmpeg:", stderr);
          reject(error);
          return;
        }

        resolve({
          stdout,
          stderr,
        });
      }
    );
  });
}

function getFirst(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

async function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 500 * 1024 * 1024,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        fields,
        files,
      });
    });
  });
}

async function getVoiceId(apiKey, voiceType) {
  /*
    Frontend sends:
    male
    female
    energetic
    calm

    We dynamically find an available ElevenLabs voice.
  */

  const response = await fetch(
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    {
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      "Unable to load ElevenLabs voices."
    );
  }

  const data = await response.json();

  const voices = Array.isArray(data.voices)
    ? data.voices
    : [];

  if (!voices.length) {
    throw new Error(
      "No ElevenLabs voices are available."
    );
  }

  const wantedGender =
    voiceType === "female" || voiceType === "calm"
      ? "female"
      : "male";

  let matching =
    voices.filter((voice) => {
      const gender =
        String(
          voice?.labels?.gender ||
          voice?.gender ||
          ""
        ).toLowerCase();

      return gender === wantedGender;
    });

  if (!matching.length) {
    matching = voices;
  }

  /*
    For energetic/calm, prefer a voice whose labels
    or description mention the requested style.
  */

  if (
    voiceType === "energetic" ||
    voiceType === "calm"
  ) {
    const styleMatch =
      matching.find((voice) => {
        const text =
          JSON.stringify(voice)
            .toLowerCase();

        return text.includes(voiceType);
      });

    if (styleMatch?.voice_id) {
      return styleMatch.voice_id;
    }
  }

  return matching[0].voice_id;
}

async function extractAudio(videoPath, audioPath) {
  await runFFmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);
}

async function transcribeAudio(apiKey, audioPath) {
  const audioBuffer =
    fs.readFileSync(audioPath);

  const blob = new Blob(
    [audioBuffer],
    {
      type: "audio/wav",
    }
  );

  const form = new FormData();

  form.append(
    "file",
    blob,
    "voiceai-audio.wav"
  );

  form.append(
    "model_id",
    "scribe_v1"
  );

  const response = await fetch(
    "https://api.elevenlabs.io/v1/speech-to-text",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: form,
    }
  );

  if (!response.ok) {
    let message =
      "Speech transcription failed.";

    try {
      const error =
        await response.json();

      message =
        error?.detail?.message ||
        error?.detail ||
        message;
    } catch {}

    throw new Error(message);
  }

  const data =
    await response.json();

  const text =
    data?.text ||
    data?.transcript ||
    "";

  if (!text.trim()) {
    throw new Error(
      "No speech was detected in the video."
    );
  }

  return text.trim();
}

async function generateVoice(
  apiKey,
  voiceId,
  text,
  language,
  style,
  outputPath
) {
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
  }

  const body = {
    text,
    model_id: "eleven_multilingual_v2",

    voice_settings: {
      stability,
      similarity_boost: similarityBoost,
      style: styleAmount,
      use_speaker_boost: true,
    },

    speed: 1,
  };

  if (language) {
    body.language_code =
      language;
  }

  const response =
    await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}`,
      {
        method: "POST",

        headers: {
          "xi-api-key": apiKey,
          "Content-Type":
            "application/json",
          Accept: "audio/mpeg",
        },

        body: JSON.stringify(body),
      }
    );

  if (!response.ok) {
    let message =
      "AI voice generation failed.";

    try {
      const error =
        await response.json();

      message =
        error?.detail?.message ||
        error?.detail ||
        message;
    } catch {}

    throw new Error(message);
  }

  const audioBuffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  fs.writeFileSync(
    outputPath,
    audioBuffer
  );
}

async function createFinalVideo(
  videoPath,
  aiAudioPath,
  outputPath
) {
  /*
    Replace original audio with AI audio.
    Video stream is copied without re-encoding.
  */

  await runFFmpeg([
    "-y",

    "-i",
    videoPath,

    "-i",
    aiAudioPath,

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

    outputPath,
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed.",
    });
  }

  const apiKey =
    process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error:
        "ELEVENLABS_API_KEY is not configured.",
    });
  }

  const tempDir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "voiceai-video-"
      )
    );

  let videoPath = null;
  let originalAudioPath = null;
  let aiAudioPath = null;
  let outputPath = null;

  try {
    const {
      fields,
      files,
    } = await parseForm(req);

    const videoFile =
      getFirst(files.video);

    if (!videoFile) {
      return res.status(400).json({
        success: false,
        error:
          "Video file is required.",
      });
    }

    videoPath =
      videoFile.filepath;

    originalAudioPath =
      path.join(
        tempDir,
        "original.wav"
      );

    aiAudioPath =
      path.join(
        tempDir,
        "ai-voice.mp3"
      );

    outputPath =
      path.join(
        tempDir,
        "voiceai-output.mp4"
      );

    const voiceType =
      String(
        getFirst(fields.voice) ||
          "male"
      ).toLowerCase();

    const language =
      String(
        getFirst(fields.language) ||
          ""
      ).toLowerCase();

    const style =
      String(
        getFirst(fields.style) ||
          "natural"
      ).toLowerCase();

    const strength =
      Number(
        getFirst(fields.strength) ||
          80
      );

    /*
      1. Extract original video's speech audio.
    */

    await extractAudio(
      videoPath,
      originalAudioPath
    );

    /*
      2. Convert original speech to text.
    */

    const transcript =
      await transcribeAudio(
        apiKey,
        originalAudioPath
      );

    /*
      3. Find an available AI voice.
    */

    const voiceId =
      await getVoiceId(
        apiKey,
        voiceType
      );

    /*
      4. Generate new AI voice.
    */

    await generateVoice(
      apiKey,
      voiceId,
      transcript,
      language,
      style,
      aiAudioPath
    );

    /*
      5. Replace original audio
         with AI-generated voice.
    */

    await createFinalVideo(
      videoPath,
      aiAudioPath,
      outputPath
    );

    /*
      Return the generated MP4 directly.
    */

    const outputBuffer =
      fs.readFileSync(
        outputPath
      );

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voiceai-converted-video.mp4"'
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).send(
      outputBuffer
    );

  } catch (error) {
    console.error(
      "Video Voice Transfer Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Video voice transfer failed.",
    });

  } finally {

    /*
      Clean temporary files.
    */

    try {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {}
  }
}
