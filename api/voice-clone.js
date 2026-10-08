// api/voice-clone.js

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

function json(res, status, data) {
  return res.status(status).json(data);
}

async function getUser(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();

  if (!token) return null;

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 25 * 1024 * 1024
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

function value(field) {
  if (Array.isArray(field)) {
    return field[0];
  }

  return field || "";
}

function getUploadedFile(files) {
  return (
    files.audio ||
    files.file ||
    files.voice ||
    null
  );
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

export default async function handler(req, res) {
  let uploadedPath = null;

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");

      return json(res, 405, {
        error: "Method not allowed."
      });
    }

    const user = await getUser(req);

    if (!user) {
      return json(res, 401, {
        error: "Authentication required."
      });
    }

    const apiKey =
      process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return json(res, 500, {
        error:
          "ELEVENLABS_API_KEY is not configured."
      });
    }

    const {
      fields,
      files
    } = await parseForm(req);

    const audioFile =
      getUploadedFile(files);

    if (!audioFile) {
      return json(res, 400, {
        error: "Voice sample is required."
      });
    }

    uploadedPath =
      audioFile.filepath ||
      audioFile.path;

    if (!uploadedPath) {
      return json(res, 400, {
        error: "Uploaded file could not be read."
      });
    }

    const voiceName =
      String(
        value(
          fields.voiceName ||
          fields.name
        )
      ).trim();

    const language =
      String(
        value(fields.language)
      ).trim() || "en";

    const description =
      String(
        value(fields.description)
      ).trim();

    const consent =
      String(
        value(fields.consent)
      ).toLowerCase();

    if (!voiceName) {
      return json(res, 400, {
        error: "Voice name is required."
      });
    }

    if (
      consent !== "true" &&
      consent !== "yes" &&
      consent !== "1"
    ) {
      return json(res, 400, {
        error:
          "Explicit voice cloning consent is required."
      });
    }

    /*
     * Server-side daily AI limit.
     * Free = 5/day
     * Premium/Admin = application-level unlimited
     */
    const usage = await checkUsage();

    if (!usage?.allowed) {
      return json(res, 429, {
        error:
          usage?.reason ||
          "Daily AI usage limit reached.",
        usage
      });
    }

    /*
     * Send sample to ElevenLabs.
     */
    const form = new FormData();

    const buffer =
      await fs.promises.readFile(
        uploadedPath
      );

    const blob = new Blob(
      [buffer],
      {
        type:
          audioFile.mimetype ||
          "audio/mpeg"
      }
    );

    form.append(
      "files",
      blob,
      audioFile.originalFilename ||
        "voice-sample.mp3"
    );

    form.append(
      "name",
      voiceName
    );

    if (description) {
      form.append(
        "description",
        description
      );
    }

    const elevenResponse =
      await fetch(
        "https://api.elevenlabs.io/v1/voices/add",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey
          },
          body: form
        }
      );

    const contentType =
      elevenResponse.headers.get(
        "content-type"
      ) || "";

    let providerData;

    if (
      contentType.includes(
        "application/json"
      )
    ) {
      providerData =
        await elevenResponse.json();
    } else {
      providerData = {
        raw:
          await elevenResponse.text()
      };
    }

    if (!elevenResponse.ok) {
      console.error(
        "ElevenLabs clone error:",
        providerData
      );

      return json(
        res,
        elevenResponse.status,
        {
          error:
            providerData?.detail ||
            providerData?.message ||
            "Voice cloning failed.",
          provider: "elevenlabs"
        }
      );
    }

    const voiceId =
      providerData?.voice_id ||
      providerData?.voiceId;

    if (!voiceId) {
      return json(res, 502, {
        error:
          "ElevenLabs did not return a voice ID."
      });
    }

    /*
     * Save clone in Supabase.
     */
    const {
      data: clone,
      error: cloneError
    } = await supabaseAdmin
      .from("voice_clones")
      .insert({
        user_id: user.id,
        voice_id: voiceId,
        name: voiceName,
        language,
        description,
        status: "ready"
      })
      .select()
      .single();

    if (cloneError) {
      console.error(
        "Supabase clone save error:",
        cloneError
      );

      /*
       * Voice was already created at ElevenLabs,
       * so return the provider ID even if DB save fails.
       */
      return json(res, 201, {
        success: true,
        voiceId,
        cloneSaved: false,
        warning:
          "Voice created, but database record could not be saved.",
        usage
      });
    }

    return json(res, 201, {
      success: true,
      voiceId,
      clone,
      usage
    });

  } catch (error) {
    console.error(
      "Voice clone API error:",
      error
    );

    return json(res, 500, {
      error:
        error?.message ||
        "Voice cloning failed."
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
