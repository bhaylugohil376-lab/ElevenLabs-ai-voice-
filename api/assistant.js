import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
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

function send(res, status, data) {
  cors(res);
  return res.status(status).json(data);
}

function getToken(req) {
  const header =
    req.headers.authorization ||
    req.headers.Authorization;

  if (!header) return null;

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.substring(7).trim();
}

async function authenticate(req) {
  const token = getToken(req);

  if (!token) return null;

  const {
    data,
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

async function consumeUsage(userId) {
  const { data, error } =
    await supabaseAdmin.rpc(
      "check_and_use_ai",
      {
        p_user_id: userId,
        p_action: "assistant"
      }
    );

  if (error) {
    console.error(
      "Assistant usage error:",
      error
    );

    throw new Error(
      "Unable to verify assistant usage."
    );
  }

  if (Array.isArray(data)) {
    return data[0] || {};
  }

  return data || {};
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(item =>
      item &&
      (
        item.role === "user" ||
        item.role === "model"
      ) &&
      typeof item.text === "string"
    )
    .slice(-20)
    .map(item => ({
      role: item.role,
      text: item.text.substring(0, 12000)
    }));
}

async function callGemini({
  message,
  history,
  model
}) {

  const apiKey =
    process.env.GEMINI_API_KEY;

  const configuredModel =
    model ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const baseUrl =
    process.env.GEMINI_API_URL;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  /*
   * GEMINI_API_URL should normally be:
   *
   * https://generativelanguage.googleapis.com/v1beta
   *
   * or another compatible Gemini API base URL.
   */

  const apiBase =
    baseUrl ||
    "https://generativelanguage.googleapis.com/v1beta";

  const endpoint =
    `${apiBase.replace(/\/$/, "")}/models/${encodeURIComponent(configuredModel)}:generateContent`;

  const contents = [];

  for (const item of history) {

    contents.push({
      role: item.role,
      parts: [
        {
          text: item.text
        }
      ]
    });

  }

  contents.push({
    role: "user",
    parts: [
      {
        text: message
      }
    ]
  });

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

        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text:
                  "You are VoiceAI Assistant, a professional AI assistant for creators. Help users with voice generation, scripts, advertisements, narration, dubbing, captions, audio, video and creative workflows. Give clear, useful and concise answers."
              }
            ]
          },

          contents,

          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = {
      raw
    };
  }

  if (!response.ok) {

    console.error(
      "Gemini Assistant error:",
      response.status,
      data
    );

    throw new Error(
      data?.error?.message ||
      "Gemini Assistant request failed."
    );
  }

  const text =
    extractText(data);

  if (!text) {

    throw new Error(
      "Gemini returned an empty response."
    );
  }

  return {
    text,
    model: configuredModel
  };
}

function extractText(data) {

  const candidates =
    data?.candidates;

  if (!Array.isArray(candidates)) {
    return "";
  }

  const parts =
    candidates[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map(part =>
      typeof part?.text === "string"
        ? part.text
        : ""
    )
    .join("")
    .trim();
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
    return send(
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
      await authenticate(req);

    if (!user) {
      return send(
        res,
        401,
        {
          error:
            "Please login to use Gemini Assistant."
        }
      );
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const message =
      String(
        body.message || ""
      ).trim();

    if (!message) {
      return send(
        res,
        400,
        {
          error:
            "Message is required."
        }
      );
    }

    if (message.length > 12000) {
      return send(
        res,
        400,
        {
          error:
            "Message is too long."
        }
      );
    }

    const history =
      normalizeHistory(
        body.history
      );

    const requestedModel =
      typeof body.model === "string"
        ? body.model.trim()
        : "";

    const usage =
      await consumeUsage(
        user.id
      );

    if (
      usage &&
      usage.allowed === false
    ) {

      return send(
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

    const result =
      await callGemini({
        message,
        history,
        model:
          requestedModel
      });

    return send(
      res,
      200,
      {
        success: true,

        reply:
          result.text,

        model:
          result.model,

        usage
      }
    );

  } catch (error) {

    console.error(
      "Assistant backend error:",
      error
    );

    return send(
      res,
      500,
      {
        error:
          error.message ||
          "Assistant request failed."
      }
    );
  }
}
