import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function json(res, status, data) {
  cors(res);

  res.status(status).json(data);
}

function getBearerToken(req) {
  const header =
    req.headers.authorization ||
    req.headers.Authorization;

  if (!header) return null;

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}

async function getUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const {
    data,
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

async function consumeImageUsage(userId) {
  const { data, error } =
    await supabaseAdmin.rpc(
      "check_and_use_ai",
      {
        p_user_id: userId,
        p_action: "image"
      }
    );

  if (error) {
    console.error(
      "Usage RPC error:",
      error
    );

    throw new Error(
      "Unable to verify image usage."
    );
  }

  /*
   * Expected RPC result can be:
   *
   * {
   *   allowed: true,
   *   used: 1,
   *   limit: 5,
   *   unlimited: false
   * }
   *
   * or a boolean depending on the
   * current Supabase function.
   */

  if (Array.isArray(data)) {
    return data[0] || {};
  }

  return data || {};
}

function buildPrompt({
  prompt,
  style,
  aspectRatio,
  quality
}) {

  return `
Create an original high-quality image based on the following request.

USER PROMPT:
${prompt}

VISUAL STYLE:
${style || "Photorealistic"}

ASPECT RATIO:
${aspectRatio || "1:1"}

QUALITY:
${quality || "standard"}

Requirements:
- Follow the user's visual description accurately.
- Create an original image.
- Do not add unnecessary text or logos.
- Use professional composition.
- Preserve important objects and details from the prompt.
- Make the final image suitable for a professional creative project.
`.trim();
}

async function callGemini({
  prompt,
  aspectRatio,
  count
}) {

  const apiKey =
    process.env.GEMINI_API_KEY;

  const model =
    process.env.GEMINI_MODEL;

  const apiUrl =
    process.env.GEMINI_API_URL;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  if (!model) {
    throw new Error(
      "GEMINI_MODEL is not configured."
    );
  }

  if (!apiUrl) {
    throw new Error(
      "GEMINI_API_URL is not configured."
    );
  }

  /*
   * Important:
   *
   * GEMINI_API_URL must be the exact image-generation
   * endpoint enabled for the Gemini model configured
   * in GEMINI_MODEL.
   *
   * We intentionally do not hard-code a potentially
   * outdated model or endpoint here.
   */

  const endpoint =
    apiUrl.includes("{model}")
      ? apiUrl.replace(
          "{model}",
          encodeURIComponent(model)
        )
      : apiUrl;

  const results = [];

  for (let i = 0; i < count; i++) {

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],

      generationConfig: {
        responseModalities: [
          "IMAGE"
        ],

        imageConfig: {
          aspectRatio
        }
      }
    };

    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey
          },

          body: JSON.stringify(
            requestBody
          )
        }
      );

    const rawText =
      await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        raw: rawText
      };
    }

    if (!response.ok) {

      console.error(
        "Gemini API error:",
        response.status,
        data
      );

      const message =
        data?.error?.message ||
        data?.message ||
        "Gemini image generation failed.";

      throw new Error(message);
    }

    const image =
      extractImage(data);

    if (!image) {

      console.error(
        "Gemini response did not contain image:",
        JSON.stringify(data).slice(
          0,
          5000
        )
      );

      throw new Error(
        "Gemini did not return an image. Check GEMINI_MODEL and GEMINI_API_URL."
      );
    }

    results.push(image);
  }

  return results;
}

function extractImage(data) {

  /*
   * Gemini-style response:
   *
   * candidates[]
   *   content
   *     parts[]
   *       inlineData
   *         mimeType
   *         data
   *
   * Some API versions/providers may expose
   * inline_data instead, so both are supported.
   */

  const candidates =
    Array.isArray(data?.candidates)
      ? data.candidates
      : [];

  for (const candidate of candidates) {

    const parts =
      candidate?.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {

      const inlineData =
        part?.inlineData ||
        part?.inline_data;

      if (
        inlineData?.data &&
        inlineData?.mimeType
      ) {

        return {
          mime_type:
            inlineData.mimeType,

          base64:
            inlineData.data,

          data_url:
            `data:${inlineData.mimeType};base64,${inlineData.data}`
        };
      }
    }
  }

  /*
   * Generic fallback for providers that
   * return an image object directly.
   */

  if (
    data?.image?.base64
  ) {

    const mime =
      data.image.mime_type ||
      data.image.mimeType ||
      "image/png";

    return {
      mime_type: mime,

      base64:
        data.image.base64,

      data_url:
        `data:${mime};base64,${data.image.base64}`
    };
  }

  return null;
}

async function saveGeneration({
  userId,
  prompt,
  style,
  aspectRatio,
  quality,
  images
}) {

  /*
   * Save metadata to image_generations.
   *
   * If your existing table has additional required
   * columns, add them here according to that schema.
   */

  const { error } =
    await supabaseAdmin
      .from("image_generations")
      .insert({
        user_id: userId,
        prompt,
        style,
        aspect_ratio: aspectRatio,
        quality,
        status: "completed"
      });

  if (error) {

    /*
     * Image generation itself succeeded,
     * so don't make the user lose the generated
     * image because metadata saving failed.
     */

    console.error(
      "Image generation DB save error:",
      error
    );
  }
}

export default async function handler(
  req,
  res
) {

  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {

    return json(
      res,
      405,
      {
        error:
          "Method not allowed."
      }
    );

  }

  try {

    const user =
      await getUser(req);

    if (!user) {

      return json(
        res,
        401,
        {
          error:
            "Please login to generate images."
        }
      );

    }


    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});


    const prompt =
      String(
        body.prompt || ""
      ).trim();


    if (!prompt) {

      return json(
        res,
        400,
        {
          error:
            "Image prompt is required."
        }
      );

    }


    if (prompt.length > 4000) {

      return json(
        res,
        400,
        {
          error:
            "Prompt must be 4000 characters or less."
        }
      );

    }


    const style =
      String(
        body.style ||
        "Photorealistic"
      );


    const aspectRatio =
      String(
        body.aspect_ratio ||
        "1:1"
      );


    const quality =
      String(
        body.quality ||
        "standard"
      );


    let count =
      Number(body.count || 1);


    if (
      !Number.isFinite(count)
    ) {
      count = 1;
    }


    count =
      Math.max(
        1,
        Math.min(
          count,
          4
        )
      );


    const allowedRatios = [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ];


    if (
      !allowedRatios.includes(
        aspectRatio
      )
    ) {

      return json(
        res,
        400,
        {
          error:
            "Invalid aspect ratio."
        }
      );

    }


    /*
     * One generation request = one usage.
     *
     * The 5-use limit therefore remains independent
     * for action = image.
     */

    let usage;

    try {

      usage =
        await consumeImageUsage(
          user.id
        );

    } catch (usageError) {

      return json(
        res,
        500,
        {
          error:
            usageError.message
        }
      );

    }


    if (
      usage &&
      usage.allowed === false
    ) {

      return json(
        res,
        429,
        {
          error:
            "Daily limit reached. You have used all 5 free uses for this section. Please try again after 24 hours.",

          used:
            usage.used ?? 5,

          limit:
            usage.limit ?? 5
        }
      );

    }


    const finalPrompt =
      buildPrompt({
        prompt,
        style,
        aspectRatio,
        quality
      });


    const images =
      await callGemini({
        prompt:
          finalPrompt,

        aspectRatio,

        count
      });


    await saveGeneration({
      userId:
        user.id,

      prompt,

      style,

      aspectRatio,

      quality,

      images
    });


    return json(
      res,
      200,
      {
        success: true,

        provider:
          "gemini",

        model:
          process.env.GEMINI_MODEL,

        images,

        count:
          images.length,

        usage
      }
    );


  } catch (error) {

    console.error(
      "Image generation error:",
      error
    );

    return json(
      res,
      500,
      {
        error:
          error.message ||
          "Image generation failed."
      }
    );

  }

}
