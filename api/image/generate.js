import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getToken(req) {
  const auth = req.headers.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.substring(7).trim();
}

function sendJson(res, status, data) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  return res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const token = getToken(req);

    if (!token) {
      return sendJson(res, 401, {
        ok: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return sendJson(res, 401, {
        ok: false,
        error: "Invalid or expired session"
      });
    }

    const body = req.body || {};

    const prompt =
      String(
        body.prompt ||
        body.description ||
        ""
      ).trim();

    const size =
      body.size ||
      "1024x1024";

    const quality =
      body.quality ||
      "standard";

    if (!prompt) {
      return sendJson(res, 400, {
        ok: false,
        error: "Prompt is required"
      });
    }

    /*
     * Image generation consumes one AI use.
     */
    const { data: usageResult, error: usageError } =
      await supabaseAdmin.rpc(
        "check_and_use_ai",
        {
          p_user_id: user.id,
          p_action: "image_generation"
        }
      );

    if (usageError) {
      console.error(
        "Usage RPC error:",
        usageError
      );

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to verify AI usage limit"
      });
    }

    const usage =
      Array.isArray(usageResult)
        ? usageResult[0]
        : usageResult;

    if (!usage?.allowed) {
      return sendJson(res, 429, {
        ok: false,
        error:
          usage?.reason ||
          "Daily AI usage limit reached",
        usage
      });
    }

    /*
     * OpenAI image generation is used when configured.
     *
     * Keep the API key server-side only.
     */
    const openAIKey =
      process.env.OPENAI_API_KEY;

    if (!openAIKey) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "OpenAI image API is not configured on the server."
      });
    }

    const imageResponse =
      await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${openAIKey}`
          },
          body: JSON.stringify({
            model:
              body.model ||
              "gpt-image-1",
            prompt,
            size,
            quality
          })
        }
      );

    const imageData =
      await imageResponse.json().catch(
        () => ({})
      );

    if (!imageResponse.ok) {
      console.error(
        "OpenAI image error:",
        imageData
      );

      return sendJson(
        res,
        imageResponse.status || 500,
        {
          ok: false,
          error:
            imageData?.error?.message ||
            "Image generation failed"
        }
      );
    }

    const generated =
      imageData?.data?.[0];

    if (!generated) {
      return sendJson(res, 502, {
        ok: false,
        error:
          "Image provider returned no image"
      });
    }

    /*
     * Depending on provider response, the image may be
     * returned as a URL or base64 data.
     */
    const imageUrl =
      generated.url ||
      null;

    const base64Image =
      generated.b64_json ||
      null;

    /*
     * Save generation metadata.
     *
     * We do not put a huge base64 image directly into the
     * database. Storage upload can be added separately.
     */
    const { data: savedGeneration, error: saveError } =
      await supabaseAdmin
        .from("image_generations")
        .insert({
          user_id: user.id,
          prompt,
          status: "completed",
          image_url: imageUrl
        })
        .select()
        .single();

    if (saveError) {
      console.error(
        "Image generation DB error:",
        saveError
      );

      return sendJson(res, 200, {
        ok: true,
        message:
          "Image generated successfully, but database save failed",
        image: {
          url: imageUrl,
          base64: base64Image
        },
        usage
      });
    }

    return sendJson(res, 200, {
      ok: true,
      message: "Image generated successfully",
      generation: {
        id: savedGeneration.id,
        status: savedGeneration.status,
        url: imageUrl,
        base64: base64Image
      },
      usage
    });
  } catch (error) {
    console.error(
      "Image generation API error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
