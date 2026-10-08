// api/image/generate.js

import { createClient } from "@supabase/supabase-js";

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

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
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
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return send(res, 500, {
        error:
          "OPENAI_API_KEY is not configured."
      });
    }

    const body = req.body || {};

    const prompt =
      clean(body.prompt || body.text);

    const size =
      clean(body.size, "1024x1024");

    const quality =
      clean(body.quality, "auto");

    const style =
      clean(body.style, "natural");

    if (!prompt) {
      return send(res, 400, {
        error: "Image prompt is required."
      });
    }

    if (prompt.length > 4000) {
      return send(res, 400, {
        error:
          "Prompt must be 4000 characters or less."
      });
    }

    const allowedSizes = [
      "1024x1024",
      "1536x1024",
      "1024x1536"
    ];

    const finalSize =
      allowedSizes.includes(size)
        ? size
        : "1024x1024";

    const allowedQuality = [
      "auto",
      "low",
      "medium",
      "high"
    ];

    const finalQuality =
      allowedQuality.includes(quality)
        ? quality
        : "auto";

    /*
     * Server-side AI usage protection.
     *
     * Free    = 5 generations/day
     * Premium = app-level unlimited
     * Admin   = app-level unlimited
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

    const enhancedPrompt =
      style && style !== "natural"
        ? `${prompt}. Visual style: ${style}.`
        : prompt;

    /*
     * OpenAI image generation.
     * API key remains server-side.
     */
    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model:
            process.env.OPENAI_IMAGE_MODEL ||
            "gpt-image-1",
          prompt: enhancedPrompt,
          size: finalSize,
          quality: finalQuality
        })
      }
    );

    const providerData =
      await response.json();

    if (!response.ok) {
      console.error(
        "OpenAI image error:",
        providerData
      );

      return send(
        res,
        response.status,
        {
          error:
            providerData?.error?.message ||
            "Image generation failed.",
          provider: "openai"
        }
      );
    }

    const image =
      providerData?.data?.[0];

    if (!image) {
      return send(res, 502, {
        error:
          "Image provider returned no image."
      });
    }

    /*
     * OpenAI can return either a temporary URL
     * or base64 image data depending on API behavior.
     */
    let imageUrl =
      image.url || null;

    if (
      !imageUrl &&
      image.b64_json
    ) {
      imageUrl =
        `data:image/png;base64,${image.b64_json}`;
    }

    if (!imageUrl) {
      return send(res, 502, {
        error:
          "Generated image URL/data was not returned."
      });
    }

    /*
     * Save generation metadata in Supabase.
     */
    const {
      data: saved,
      error: saveError
    } = await supabaseAdmin
      .from("image_generations")
      .insert({
        user_id: user.id,
        prompt,
        size: finalSize,
        quality: finalQuality,
        image_url: imageUrl,
        status: "completed"
      })
      .select()
      .single();

    if (saveError) {
      console.error(
        "Image DB save error:",
        saveError
      );

      /*
       * Image was successfully generated,
       * so don't hide it because DB logging failed.
       */
      return send(res, 200, {
        success: true,
        imageUrl,
        saved: false,
        warning:
          "Image generated, but database logging failed.",
        usage
      });
    }

    return send(res, 200, {
      success: true,
      imageUrl,
      generation: saved,
      usage
    });

  } catch (error) {
    console.error(
      "Image generation API error:",
      error
    );

    return send(res, 500, {
      error:
        error?.message ||
        "Internal server error."
    });
  }
}
