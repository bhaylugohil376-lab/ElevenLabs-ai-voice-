// api/dubbing.js

import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false
  }
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function send(res, status, data) {
  return res.status(status).json(data);
}

async function getUser(req) {
  const auth =
    req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  const token =
    auth.slice(7).trim();

  if (!token) return null;

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

async function checkUsage() {
  const { data, error } =
    await supabaseAdmin.rpc(
      "check_and_use_ai"
    );

  if (error) {
    throw new Error(
      `Usage check failed: ${error.message}`
    );
  }

  return data;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize:
        200 * 1024 * 1024
    });

    form.parse(
      req,
      (error, fields, files) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          fields,
          files
        });
      }
    );
  });
}

function first(value) {
  return Array.isArray(value)
    ? value[0]
    : value;
}

function getMediaFile(files) {
  return (
    files.video ||
    files.audio ||
    files.file ||
    files.media ||
    null
  );
}

function getExtension(file) {
  const filename =
    file?.originalFilename || "";

  const match =
    filename.match(
      /(\.[a-zA-Z0-9]+)$/
    );

  return match
    ? match[1].toLowerCase()
    : ".mp4";
}

function safeTempFile(extension) {
  return path.join(
    os.tmpdir(),
    `voiceai-${crypto
      .randomBytes(12)
      .toString("hex")}${extension}`
  );
}

async function downloadToFile(
  url,
  destination
) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Unable to download provider output: ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  await fs.promises.writeFile(
    destination,
    buffer
  );
}

export default async function handler(
  req,
  res
) {
  const temporaryFiles = [];

  try {
    if (req.method !== "POST") {
      res.setHeader(
        "Allow",
        "POST"
      );

      return send(res, 405, {
        error:
          "Method not allowed."
      });
    }

    const user =
      await getUser(req);

    if (!user) {
      return send(res, 401, {
        error:
          "Authentication required."
      });
    }

    const elevenLabsKey =
      process.env.ELEVENLABS_API_KEY;

    if (!elevenLabsKey) {
      return send(res, 500, {
        error:
          "ELEVENLABS_API_KEY is not configured."
      });
    }

    const {
      fields,
      files
    } = await parseForm(req);

    const mediaFile =
      getMediaFile(files);

    if (!mediaFile) {
      return send(res, 400, {
        error:
          "Audio or video file is required."
      });
    }

    const inputPath =
      mediaFile.filepath ||
      mediaFile.path;

    if (!inputPath) {
      return send(res, 400, {
        error:
          "Uploaded media could not be read."
      });
    }

    const sourceLanguage =
      String(
        first(
          fields.sourceLanguage ||
          fields.source_language
        ) || ""
      ).trim();

    const targetLanguage =
      String(
        first(
          fields.targetLanguage ||
          fields.target_language
        ) || ""
      ).trim();

    const voiceId =
      String(
        first(
          fields.voiceId ||
          fields.voice_id ||
          fields.voice
        ) || ""
      ).trim();

    const style =
      String(
        first(fields.style) ||
        "natural"
      ).trim();

    const projectName =
      String(
        first(fields.projectName) ||
        "Untitled Dubbing Project"
      ).trim();

    if (!sourceLanguage) {
      return send(res, 400, {
        error:
          "Source language is required."
      });
    }

    if (!targetLanguage) {
      return send(res, 400, {
        error:
          "Target language is required."
      });
    }

    if (!voiceId) {
      return send(res, 400, {
        error:
          "Target voice is required."
      });
    }

    if (
      sourceLanguage ===
      targetLanguage
    ) {
      return send(res, 400, {
        error:
          "Source and target languages must be different."
      });
    }

    /*
     * Server-side 5/day protection.
     */
    const usage =
      await checkUsage();

    if (!usage?.allowed) {
      return send(res, 429, {
        error:
          usage?.reason ||
          "Daily AI usage limit reached.",
        usage
      });
    }

    /*
     * Read source media.
     */
    const sourceBuffer =
      await fs.promises.readFile(
        inputPath
      );

    /*
     * STEP 1:
     * Transcribe source audio using
     * ElevenLabs Speech-to-Text.
     */
    const transcriptionForm =
      new FormData();

    transcriptionForm.append(
      "file",
      new Blob(
        [sourceBuffer],
        {
          type:
            mediaFile.mimetype ||
            "audio/mpeg"
        }
      ),
      mediaFile.originalFilename ||
        `source${getExtension(
          mediaFile
        )}`
    );

    transcriptionForm.append(
      "model_id",
      "scribe_v2"
    );

    const transcriptionResponse =
      await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: {
            "xi-api-key":
              elevenLabsKey
          },
          body:
            transcriptionForm
        }
      );

    const transcriptionData =
      await transcriptionResponse.json();

    if (
      !transcriptionResponse.ok
    ) {
      console.error(
        "Dubbing STT error:",
        transcriptionData
      );

      return send(
        res,
        transcriptionResponse.status,
        {
          error:
            transcriptionData?.detail ||
            transcriptionData?.message ||
            "Source transcription failed."
        }
      );
    }

    const sourceText =
      String(
        transcriptionData?.text ||
        transcriptionData?.transcript ||
        ""
      ).trim();

    if (!sourceText) {
      return send(res, 502, {
        error:
          "No source speech was detected."
      });
    }

    /*
     * STEP 2:
     * Translate source text.
     *
     * Uses OpenAI because the user wants
     * multilingual dubbing.
     */
    const openAiKey =
      process.env.OPENAI_API_KEY;

    if (!openAiKey) {
      return send(res, 500, {
        error:
          "OPENAI_API_KEY is not configured."
      });
    }

    const translationResponse =
      await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model:
              process.env.OPENAI_TRANSLATION_MODEL ||
              "gpt-4o-mini",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "Translate the provided spoken script naturally for dubbing. Preserve meaning, names, numbers and intent. Do not add explanations."
              },
              {
                role: "user",
                content:
                  `Translate from ${sourceLanguage} to ${targetLanguage}. Style: ${style}.\n\n${sourceText}`
              }
            ]
          })
        }
      );

    const translationData =
      await translationResponse.json();

    if (
      !translationResponse.ok
    ) {
      console.error(
        "Dubbing translation error:",
        translationData
      );

      return send(
        res,
        translationResponse.status,
        {
          error:
            translationData?.error?.message ||
            "Translation failed."
        }
      );
    }

    const translatedText =
      String(
        translationData?.choices?.[0]
          ?.message?.content ||
        ""
      ).trim();

    if (!translatedText) {
      return send(res, 502, {
        error:
          "Translation returned empty text."
      });
    }

    /*
     * STEP 3:
     * Generate target-language speech.
     */
    const speechResponse =
      await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          voiceId
        )}`,
        {
          method: "POST",
          headers: {
            "xi-api-key":
              elevenLabsKey,
            "Content-Type":
              "application/json",
            Accept:
              "audio/mpeg"
          },
          body: JSON.stringify({
            text:
              translatedText,
            model_id:
              "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        }
      );

    if (!speechResponse.ok) {
      const errorText =
        await speechResponse.text();

      console.error(
        "Dubbing TTS error:",
        errorText
      );

      return send(
        res,
        speechResponse.status,
        {
          error:
            "Target voice generation failed."
        }
      );
    }

    const audioBuffer =
      Buffer.from(
        await speechResponse.arrayBuffer()
      );

    /*
     * STEP 4:
     * Store generated audio temporarily.
     */
    const audioPath =
      safeTempFile(".mp3");

    await fs.promises.writeFile(
      audioPath,
      audioBuffer
    );

    temporaryFiles.push(
      audioPath
    );

    /*
     * For audio-only uploads, return generated
     * dubbed audio directly.
     */
    const mime =
      mediaFile.mimetype || "";

    const isVideo =
      mime.startsWith("video/") ||
      [".mp4", ".mov", ".webm", ".mkv"]
        .includes(
          getExtension(mediaFile)
        );

    if (!isVideo) {
      const {
        data: savedAudio,
        error: saveError
      } = await supabaseAdmin
        .from("dubbing_jobs")
        .insert({
          user_id: user.id,
          project_name: projectName,
          source_language:
            sourceLanguage,
          target_language:
            targetLanguage,
          voice_id: voiceId,
          source_text: sourceText,
          translated_text:
            translatedText,
          status: "completed"
        })
        .select()
        .single();

      if (saveError) {
        console.error(
          "Dubbing DB error:",
          saveError
        );
      }

      return send(res, 200, {
        success: true,
        type: "audio",
        audioBase64:
          audioBuffer.toString(
            "base64"
          ),
        mimeType:
          "audio/mpeg",
        sourceText,
        translatedText,
        job:
          savedAudio || null,
        usage
      });
    }

    /*
     * Video muxing requires ffmpeg.
     *
     * If ffmpeg-static is installed, use it.
     */
    let ffmpegPath;

    try {
      const ffmpeg =
        await import(
          "ffmpeg-static"
        );

      ffmpegPath =
        ffmpeg.default || ffmpeg;
    } catch {
      return send(res, 501, {
        error:
          "Video dubbing requires ffmpeg-static. Install/configure ffmpeg for video output."
      });
    }

    const outputPath =
      safeTempFile(".mp4");

    temporaryFiles.push(
      outputPath
    );

    const { spawn } =
      await import("child_process");

    await new Promise(
      (resolve, reject) => {
        const process =
          spawn(ffmpegPath, [
            "-y",
            "-i",
            inputPath,
            "-i",
            audioPath,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            outputPath
          ]);

        let stderr = "";

        process.stderr.on(
          "data",
          chunk => {
            stderr +=
              chunk.toString();
          }
        );

        process.on(
          "error",
          reject
        );

        process.on(
          "close",
          code => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `FFmpeg failed: ${stderr.slice(
                    -2000
                  )}`
                )
              );
            }
          }
        );
      }
    );

    const outputBuffer =
      await fs.promises.readFile(
        outputPath
      );

    /*
     * Save database record.
     */
    const {
      data: savedJob,
      error: saveError
    } = await supabaseAdmin
      .from("dubbing_jobs")
      .insert({
        user_id: user.id,
        project_name: projectName,
        source_language:
          sourceLanguage,
        target_language:
          targetLanguage,
        voice_id: voiceId,
        source_text: sourceText,
        translated_text:
          translatedText,
        status: "completed"
      })
      .select()
      .single();

    if (saveError) {
      console.error(
        "Dubbing DB save error:",
        saveError
      );
    }

    /*
     * Return binary video.
     */
    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voiceai-dubbed.mp4"'
    );

    res.setHeader(
      "Content-Length",
      outputBuffer.length
    );

    return res.end(
      outputBuffer
    );

  } catch (error) {
    console.error(
      "Dubbing API error:",
      error
    );

    return send(res, 500, {
      error:
        error?.message ||
        "Dubbing failed."
    });

  } finally {
    /*
     * Clean temporary generated files.
     */
    for (
      const file of temporaryFiles
    ) {
      try {
        if (
          fs.existsSync(file)
        ) {
          await fs.promises.unlink(
            file
          );
        }
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
