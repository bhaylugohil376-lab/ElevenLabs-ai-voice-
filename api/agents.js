import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function send(res, status, data) {
  return res.status(status).setHeader("Content-Type", "application/json").setHeader(
    "Access-Control-Allow-Origin",
    "*"
  ).json(data);
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim();
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase server environment variables are missing");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return send(res, 405, {
      error: "Method not allowed"
    });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const token = getBearerToken(req);

    if (!token) {
      return send(res, 401, {
        error: "Authorization token required"
      });
    }

    const {
      data: { user },
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return send(res, 401, {
        error: "Invalid or expired session"
      });
    }

    /*
     * GET
     * Return user's agents.
     */
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Agents fetch error:", error);

        return send(res, 500, {
          error: "Failed to load agents"
        });
      }

      return send(res, 200, {
        agents: data || []
      });
    }

    /*
     * POST
     * Create a new conversational AI agent.
     */
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const systemPrompt = String(
      body.systemPrompt ||
      body.system_prompt ||
      ""
    ).trim();

    const voiceId = String(
      body.voiceId ||
      body.voice_id ||
      ""
    ).trim();

    const language = String(body.language || "en").trim();

    if (!name) {
      return send(res, 400, {
        error: "Agent name is required"
      });
    }

    if (name.length > 100) {
      return send(res, 400, {
        error: "Agent name is too long"
      });
    }

    /*
     * Free plan usage check.
     * Creating/testing AI agents consumes one AI usage.
     */
    const { data: usage, error: usageError } =
      await supabaseAdmin.rpc("check_and_use_ai", {
        p_user_id: user.id,
        p_action: "agent_create"
      });

    if (usageError) {
      console.error("Usage RPC error:", usageError);

      return send(res, 500, {
        error: "Unable to check AI usage"
      });
    }

    if (!usage?.allowed) {
      return send(res, 429, {
        error: "Daily AI usage limit reached",
        reason: usage?.reason || "limit_reached",
        usage
      });
    }

    /*
     * ElevenLabs Agent creation is intentionally kept server-side.
     *
     * If ELEVENLABS_API_KEY is available, create the provider-side
     * conversational agent.
     */
    let providerAgentId = null;
    let providerStatus = "local";

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;

    if (elevenLabsKey) {
      const providerPayload = {
        name,
        conversation_config: {
          agent: {
            prompt: {
              prompt:
                systemPrompt ||
                "You are a helpful, professional AI voice assistant."
            },
            language
          }
        }
      };

      if (voiceId) {
        providerPayload.conversation_config.agent.first_message =
          "Hello! How can I help you today?";

        providerPayload.conversation_config.tts = {
          voice_id: voiceId
        };
      }

      const providerResponse = await fetch(
        "https://api.elevenlabs.io/v1/convai/agents/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenLabsKey
          },
          body: JSON.stringify(providerPayload)
        }
      );

      const providerText = await providerResponse.text();

      let providerData = {};

      try {
        providerData = providerText
          ? JSON.parse(providerText)
          : {};
      } catch {
        providerData = {
          raw: providerText
        };
      }

      if (!providerResponse.ok) {
        console.error(
          "ElevenLabs agent creation failed:",
          providerResponse.status,
          providerData
        );

        return send(res, 502, {
          error: "AI provider failed to create the agent",
          provider_status: providerResponse.status,
          provider_response: providerData
        });
      }

      providerAgentId =
        providerData.agent_id ||
        providerData.agentId ||
        providerData.id ||
        null;

      providerStatus = "created";
    }

    /*
     * Save agent in Supabase.
     */
    const insertData = {
      user_id: user.id,
      name,
      description: description || null,
      system_prompt: systemPrompt || null,
      voice_id: voiceId || null,
      language,
      status: providerAgentId ? "active" : "draft"
    };

    /*
     * provider_agent_id may not exist in older schemas.
     * Try with it first, then fall back without it.
     */
    let { data: agent, error: insertError } = await supabaseAdmin
      .from("agents")
      .insert({
        ...insertData,
        provider_agent_id: providerAgentId
      })
      .select("*")
      .single();

    if (insertError) {
      console.warn(
        "Agent insert with provider_agent_id failed:",
        insertError.message
      );

      const fallback = await supabaseAdmin
        .from("agents")
        .insert(insertData)
        .select("*")
        .single();

      agent = fallback.data;
      insertError = fallback.error;
    }

    if (insertError) {
      console.error("Agent database insert error:", insertError);

      return send(res, 500, {
        error: "Failed to save agent"
      });
    }

    return send(res, 201, {
      success: true,
      agent,
      provider: {
        status: providerStatus,
        agentId: providerAgentId
      },
      usage
    });
  } catch (error) {
    console.error("Agents API error:", error);

    return send(res, 500, {
      error: "Internal server error"
    });
  }
}
