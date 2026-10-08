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

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
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
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const agentId = String(
      body.agentId ||
      body.agent_id ||
      ""
    ).trim();

    const message = String(
      body.message || ""
    ).trim();

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: "Agent ID is required"
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Message is too long"
      });
    }

    const {
      data: agent,
      error: agentError
    } = await supabaseAdmin
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (agentError) {
      console.error("Agent lookup error:", agentError);

      return res.status(500).json({
        success: false,
        error: "Unable to load agent"
      });
    }

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: "Agent not found"
      });
    }

    const {
      data: usageResult,
      error: usageError
    } = await supabaseAdmin.rpc(
      "check_and_use_ai",
      {
        p_user_id: user.id
      }
    );

    if (usageError) {
      console.error("Usage check error:", usageError);

      return res.status(500).json({
        success: false,
        error: "Unable to verify AI usage"
      });
    }

    const usage = Array.isArray(usageResult)
      ? usageResult[0]
      : usageResult;

    if (!usage?.allowed) {
      return res.status(429).json({
        success: false,
        error:
          usage?.reason ||
          "Daily AI usage limit reached",
        usage: usage?.usage,
        limit: usage?.limit,
        remaining: usage?.remaining
      });
    }

    const elevenLabsAgentId =
      agent.agent_id ||
      agent.elevenlabs_agent_id ||
      agentId;

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "ElevenLabs API key is not configured"
      });
    }

    const elevenLabsResponse = await fetch(
      "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=" +
        encodeURIComponent(elevenLabsAgentId),
      {
        method: "GET",
        headers: {
          "xi-api-key":
            process.env.ELEVENLABS_API_KEY
        }
      }
    );

    if (!elevenLabsResponse.ok) {
      const errorText =
        await elevenLabsResponse.text();

      console.error(
        "ElevenLabs signed URL error:",
        errorText
      );

      return res.status(502).json({
        success: false,
        error:
          "Unable to connect to ElevenLabs agent"
      });
    }

    const signedData =
      await elevenLabsResponse.json();

    const signedUrl =
      signedData.signed_url ||
      signedData.signedUrl ||
      signedData.url ||
      null;

    if (!signedUrl) {
      return res.status(502).json({
        success: false,
        error:
          "ElevenLabs did not return a signed URL"
      });
    }

    const { error: logError } =
      await supabaseAdmin
        .from("agent_conversations")
        .insert({
          user_id: user.id,
          agent_id: agent.id,
          message,
          role: "user",
          metadata: {
            type: "agent_test"
          }
        });

    if (logError) {
      console.warn(
        "Conversation logging skipped:",
        logError.message
      );
    }

    return res.status(200).json({
      success: true,
      signedUrl,
      agentId: agent.id,
      usage: {
        used: usage?.usage,
        limit: usage?.limit,
        remaining: usage?.remaining
      }
    });
  } catch (error) {
    console.error("Agent test error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Agent test failed"
    });
  }
}
