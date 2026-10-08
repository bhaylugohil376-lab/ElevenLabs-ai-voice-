import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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

  if (req.method !== "GET") {
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

    const today = new Date().toISOString().slice(0, 10);

    /*
     * Get today's usage record.
     */
    const { data: usage, error: usageError } =
      await supabaseAdmin
        .from("usage_daily")
        .select("*")
        .eq("user_id", user.id)
        .eq("usage_date", today)
        .maybeSingle();

    if (usageError) {
      console.error("Usage lookup error:", usageError);

      return sendJson(res, 500, {
        ok: false,
        error: "Unable to load usage"
      });
    }

    /*
     * Get the user's current plan using the existing
     * Supabase RPC.
     */
    const { data: planData, error: planError } =
      await supabaseAdmin.rpc("get_my_plan", {
        p_user_id: user.id
      });

    let plan = "free";

    if (!planError && planData) {
      if (typeof planData === "string") {
        plan = planData.toLowerCase();
      } else if (Array.isArray(planData) && planData.length > 0) {
        plan =
          String(
            planData[0]?.plan ||
            planData[0]?.name ||
            "free"
          ).toLowerCase();
      } else if (typeof planData === "object") {
        plan =
          String(
            planData.plan ||
            planData.name ||
            "free"
          ).toLowerCase();
      }
    }

    const used = Number(
      usage?.usage_count ??
      usage?.count ??
      usage?.ai_uses ??
      0
    );

    const isPremium =
      plan === "premium" ||
      plan === "pro" ||
      plan === "admin";

    const limit = isPremium ? null : 5;

    const remaining =
      limit === null
        ? null
        : Math.max(limit - used, 0);

    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        email: user.email || null
      },
      plan,
      usage: {
        date: today,
        used,
        limit,
        remaining,
        unlimited: isPremium
      }
    });
  } catch (error) {
    console.error("Usage API error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
}
