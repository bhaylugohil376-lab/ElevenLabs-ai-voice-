// api/music/generate.js

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function send(res, status, data) {
  return res.status(status).json(data);
}

async function getUser(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.slice(7).trim();

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
    await supabaseAdmin.rpc("check_and_use_ai");

  if (error) {
    throw new Error(
      `Usage check failed: ${error.message}`
    );
  }

  return data;
}

export default async function handler(req, res) {
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
      process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return send(res, 500, {
        error:
          "ELEVENLABS_API_KEY is not configured."
      });
    }

    const body = req.body || {};

    const prompt = String(
      body.prompt || ""
    ).trim();

    const genre = String(
      body.genre || "cinematic"
    ).trim();

    const duration = Number(
      body.duration || 30
    );

    const projectName = String(
      body.projectName ||
      "Untitled Music"
    ).trim();

    if (!prompt) {
      return send(res, 400, {
        error: "Music prompt is required."
      });
    }

    if (prompt.length > 2000) {
      return send(res, 400, {
        error:
          "Music prompt must be 2000 characters or less."
      });
    }

    const safeDuration =
      Math.min(
        Math.max(duration, 5),
        300
      );

    /*
     * Free = 5 AI generations/day.
     * Premium/Admin = app-level unlimited.
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

    /*
     * ElevenLabs Music generation.
     */
    const musicPrompt =
      `${prompt}. Genre: ${genre}.`;

    const response = await fetch(
      "https://api.elevenlabs.io/v1/music",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          prompt: musicPrompt,
          music_length_ms:
            safeDuration * 1000
        })
      }
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "ElevenLabs music error:",
        errorText
      );

      return send(
        res,
        response.status,
        {
          error:
            "Music generation failed.",
          provider: "elevenlabs"
        }
      );
    }

    const audioBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (!audioBuffer.length) {
      return send(res, 502, {
        error:
          "Music provider returned empty audio."
      });
    }

    /*
     * Save generation metadata.
     */
    const {
      data: saved,
      error: saveError
    } = await supabaseAdmin
      .from("music_generations")
      .insert({
        user_id: user.id,
        project_name: projectName,
        prompt,
        genre,
        duration: safeDuration,
        status: "completed"
      })
      .select()
      .single();

    if (saveError) {
      console.error(
        "Music DB save error:",
        saveError
      );
    }

    /*
     * Return audio directly.
     */
    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voiceai-music.mp3"'
    );

    res.setHeader(
      "Content-Length",
      audioBuffer.length
    );

    /*
     * Custom headers let music.html
     * read generation metadata if needed.
     */
    res.setHeader(
      "X-VoiceAI-Usage",
      JSON.stringify(usage)
    );

    return res.end(audioBuffer);

  } catch (error) {
    console.error(
      "Music API error:",
      error
    );

    return send(res, 500, {
      error:
        error?.message ||
        "Internal server error."
    });
  }
}
