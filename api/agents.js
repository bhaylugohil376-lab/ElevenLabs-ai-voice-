// api/agents.js

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function json(res, status, data) {
  res.status(status).json(data);
}

async function getUser(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.replace("Bearer ", "").trim();

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

async function checkAiUsage(userId) {
  const { data, error } = await supabaseAdmin.rpc(
    "check_and_use_ai"
  );

  if (error) {
    throw new Error(
      `AI usage check failed: ${error.message}`
    );
  }

  return data;
}

async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, plan")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export default async function handler(req, res) {
  try {
    const user = await getUser(req);

    if (!user) {
      return json(res, 401, {
        error: "Authentication required."
      });
    }

    const profile = await getProfile(user.id);

    const plan = String(
      profile?.plan || "free"
    ).toLowerCase();

    /*
     * GET
     * Load current user's agents
     */
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select(`
          id,
          name,
          type,
          voice_id,
          language,
          system_prompt,
          welcome_message,
          status,
          created_at,
          updated_at
        `)
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false
        });

      if (error) {
        return json(res, 500, {
          error: error.message
        });
      }

      return json(res, 200, {
        success: true,
        agents: data || []
      });
    }

    /*
     * POST
     * Create new AI voice agent
     */
    if (req.method === "POST") {
      const body = req.body || {};

      const name = String(
        body.name || ""
      ).trim();

      const type = String(
        body.type || "support"
      ).trim().toLowerCase();

      const voiceId = String(
        body.voice_id ||
        body.voice ||
        ""
      ).trim();

      const language = String(
        body.language || "en"
      ).trim();

      const systemPrompt = String(
        body.system_prompt ||
        body.systemPrompt ||
        ""
      ).trim();

      const welcomeMessage = String(
        body.welcome_message ||
        body.welcomeMessage ||
        ""
      ).trim();

      if (!name) {
        return json(res, 400, {
          error: "Agent name is required."
        });
      }

      if (!voiceId) {
        return json(res, 400, {
          error: "Voice is required."
        });
      }

      if (!systemPrompt) {
        return json(res, 400, {
          error: "System prompt is required."
        });
      }

      const allowedTypes = [
        "support",
        "sales",
        "booking"
      ];

      if (!allowedTypes.includes(type)) {
        return json(res, 400, {
          error: "Invalid agent type."
        });
      }

      /*
       * Server-side 5/day AI usage protection.
       *
       * Premium/Admin are allowed by the SQL function.
       * Free users are limited to 5/day.
       */
      const usage = await checkAiUsage(user.id);

      if (!usage?.allowed) {
        return json(res, 429, {
          error:
            usage?.reason ||
            "Daily AI usage limit reached.",
          usage
        });
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
          user_id: user.id,
          name,
          type,
          voice_id: voiceId,
          language,
          system_prompt: systemPrompt,
          welcome_message:
            welcomeMessage ||
            "Hello! How can I help you today?",
          status: "active"
        })
        .select(`
          id,
          name,
          type,
          voice_id,
          language,
          system_prompt,
          welcome_message,
          status,
          created_at,
          updated_at
        `)
        .single();

      if (error) {
        return json(res, 500, {
          error: error.message
        });
      }

      return json(res, 201, {
        success: true,
        agent: data,
        usage: {
          plan,
          ...usage
        }
      });
    }

    /*
     * DELETE
     * Delete only current user's own agent
     */
    if (req.method === "DELETE") {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      const agentId =
        url.searchParams.get("id");

      if (!agentId) {
        return json(res, 400, {
          error: "Agent ID is required."
        });
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .delete()
        .eq("id", agentId)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (error) {
        return json(res, 500, {
          error: error.message
        });
      }

      if (!data) {
        return json(res, 404, {
          error: "Agent not found."
        });
      }

      return json(res, 200, {
        success: true,
        deleted: true,
        id: agentId
      });
    }

    /*
     * PATCH
     * Update current user's agent
     */
    if (req.method === "PATCH") {
      const body = req.body || {};

      const agentId = String(
        body.id || ""
      ).trim();

      if (!agentId) {
        return json(res, 400, {
          error: "Agent ID is required."
        });
      }

      const updates = {};

      if (body.name !== undefined) {
        updates.name =
          String(body.name).trim();
      }

      if (body.type !== undefined) {
        updates.type =
          String(body.type)
            .trim()
            .toLowerCase();
      }

      if (
        body.voice_id !== undefined ||
        body.voice !== undefined
      ) {
        updates.voice_id = String(
          body.voice_id ||
          body.voice
        ).trim();
      }

      if (body.language !== undefined) {
        updates.language =
          String(body.language).trim();
      }

      if (
        body.system_prompt !== undefined ||
        body.systemPrompt !== undefined
      ) {
        updates.system_prompt =
          String(
            body.system_prompt ||
            body.systemPrompt
          ).trim();
      }

      if (
        body.welcome_message !== undefined ||
        body.welcomeMessage !== undefined
      ) {
        updates.welcome_message =
          String(
            body.welcome_message ||
            body.welcomeMessage
          ).trim();
      }

      if (body.status !== undefined) {
        updates.status =
          String(body.status).trim();
      }

      if (Object.keys(updates).length === 0) {
        return json(res, 400, {
          error: "No changes supplied."
        });
      }

      const { data, error } = await supabaseAdmin
        .from("agents")
        .update(updates)
        .eq("id", agentId)
        .eq("user_id", user.id)
        .select(`
          id,
          name,
          type,
          voice_id,
          language,
          system_prompt,
          welcome_message,
          status,
          created_at,
          updated_at
        `)
        .maybeSingle();

      if (error) {
        return json(res, 500, {
          error: error.message
        });
      }

      if (!data) {
        return json(res, 404, {
          error: "Agent not found."
        });
      }

      return json(res, 200, {
        success: true,
        agent: data
      });
    }

    res.setHeader(
      "Allow",
      "GET, POST, PATCH, DELETE"
    );

    return json(res, 405, {
      error: "Method not allowed."
    });

  } catch (error) {
    console.error(
      "Agents API error:",
      error
    );

    return json(res, 500, {
      error:
        error?.message ||
        "Internal server error."
    });
  }
}
