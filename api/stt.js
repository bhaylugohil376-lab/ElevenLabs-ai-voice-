// api/stt.js

import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";

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
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token =
    authorization.slice(7).trim();

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
      maxFileSize: 100 * 1024 * 1024
    });

    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

function first(value) {
  return Array.isArray(value)
    ? value[0]
    : value;
}

function getFile(files) {
  return (
    files.audio ||
    files.file ||
    files.media ||
    files.video ||
    null
  );
}

function getExtension(file) {
  const name =
    file?.originalFilename || "";

  const match =
    name.match(/(\.[a-zA-Z0-9]+)$/);

  return match
    ? match[1].toLowerCase()
    : ".mp3";
}

function mimeType(file) {
  return (
    file?.mimetype ||
    "audio/mpeg"
  );
}

function buildTextResponse(text, format) {
  if (format === "json") {
    return {
      text,
      segments: []
    };
  }

  if (format === "srt") {
    return (
      "1\n" +
      "00:00:00,000 --> 00:00:10,000\n" +
      text
    );
  }

  if (format === "vtt") {
    return (
      "WEBVTT\n\n" +
      "00:00:00.000 --> 00:00:10.000\n" +
      text
    );
  }

  return text;
}

export default async function handler(req, res) {
  let uploadedPath = null;

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");

      return send(res, 405, {
        error: "Method not allowed."
      });
    }

    const user = await getUser(req);

    if (!user) {
      return send(res, 401, {
        error: "Authentication required."
      });
    }

    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return send(res, 500, {
        error:
          "OPENAI_API_KEY is not configured."
      });
    }

    const {
      fields,
      files
    } = await parseForm(req);

    const mediaFile =
      getFile(files);

    if (!mediaFile) {
      return send(res, 400, {
        error:
          "Audio or video file is required."
      });
    }

    uploadedPath =
      mediaFile.filepath ||
      mediaFile.path;

    if (!uploadedPath) {
      return send(res, 400, {
        error:
          "Uploaded file could not be read."
      });
    }

    const language =
      String(
        first(fields.language) ||
        ""
      ).trim();

    const format =
      String(
        first(fields.format) ||
        "txt"
      ).trim().toLowerCase();

    const projectName =
      String(
        first(fields.projectName) ||
        "Untitled Transcription"
      ).trim();

    const allowedFormats = [
      "txt",
      "srt",
      "vtt",
      "json"
    ];

    const finalFormat =
      allowedFormats.includes(format)
        ? format
        : "txt";

    /*
     * Free = 5 AI uses/day.
     * Premium/Admin = application-level unlimited.
     */
    const usage = await checkUsage();

    if (!usage?.allowed) {
      return send(res, 429, {
        error:
          usage?.reason ||
          "Daily AI usage limit reached.",
        usage
      });
    }

    const buffer =
      await fs.promises.readFile(
        uploadedPath
      );

    const blob = new Blob(
      [buffer],
      {
        type: mimeType(mediaFile)
      }
    );

    /*
     * OpenAI transcription endpoint.
     */
    const formData = new FormData();

    formData.append(
      "file",
      blob,
      mediaFile.originalFilename ||
        `audio${getExtension(mediaFile)}`
    );

    formData.append(
      "model",
      process.env.OPENAI_STT_MODEL ||
        "gpt-4o-mini-transcribe"
    );

    /*
     * Only send language when user selected one.
     */
    if (language) {
      const languageCode =
        language
          .split("-")[0]
          .toLowerCase();

      formData.append(
        "language",
        languageCode
      );
    }

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${apiKey}`
        },
        body: formData
      }
    );

    const providerData =
      await response.json();

    if (!response.ok) {
      console.error(
        "OpenAI STT error:",
        providerData
      );

      return send(
        res,
        response.status,
        {
          error:
            providerData?.error?.message ||
            "Speech-to-text failed.",
          provider: "openai"
        }
      );
    }

    const text =
      String(
        providerData?.text ||
        providerData?.transcript ||
        ""
      ).trim();

    if (!text) {
      return send(res, 502, {
        error:
          "No transcript was returned."
      });
    }

    /*
     * Save job in Supabase.
     */
    const {
      data: savedJob,
      error: saveError
    } = await supabaseAdmin
      .from("stt_jobs")
      .insert({
        user_id: user.id,
        project_name: projectName,
        language:
          language || null,
        status: "completed",
        transcript: text
      })
      .select()
      .single();

    if (saveError) {
      console.error(
        "STT DB save error:",
        saveError
      );

      return send(res, 200, {
        success: true,
        text,
        content:
          buildTextResponse(
            text,
            finalFormat
          ),
        format: finalFormat,
        saved: false,
        warning:
          "Transcript generated, but database logging failed.",
        usage
      });
    }

    return send(res, 200, {
      success: true,
      text,
      content:
        buildTextResponse(
          text,
          finalFormat
        ),
      format: finalFormat,
      job: savedJob,
      usage
    });

  } catch (error) {
    console.error(
      "STT API error:",
      error
    );

    return send(res, 500, {
      error:
        error?.message ||
        "Internal server error."
    });

  } finally {
    if (
      uploadedPath &&
      fs.existsSync(uploadedPath)
    ) {
      try {
        await fs.promises.unlink(
          uploadedPath
        );
      } catch {
        // Ignore temporary-file cleanup errors.
      }
    }
  }
}
