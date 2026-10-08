// api/usage.js

const { createClient } = require("@supabase/supabase-js");

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

  if (!token) return null;

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const user = await getUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    /*
     * Get current plan from the database.
     */
    const { data: planData, error: planError } =
      await supabaseAdmin.rpc("get_my_plan", {
        p_user_id: user.id
      });

    if (planError) {
      console.error("Plan lookup error:", planError);
    }

    let plan = "free";

    if (typeof planData === "string") {
      plan = planData.toLowerCase();
    } else if (planData?.plan) {
      plan = String(planData.plan).toLowerCase();
    }

    /*
     * Also check the user's profile plan.
     */
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.plan) {
      const profilePlan =
        String(profile.plan).toLowerCase();

      if (profilePlan === "admin") {
        plan = "admin";
      } else if (
        profilePlan === "premium" &&
        plan !== "admin"
      ) {
        plan = "premium";
      }
    }

    /*
     * Premium/Admin are unlimited at application level.
     */
    if (plan === "premium" || plan === "admin") {
      return res.status(200).json({
        success: true,
        plan,
        usage: 0,
        limit: null,
        remaining: null,
        unlimited: true
      });
    }

    /*
     * Free users have 5 AI uses per day.
     */
    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const { data: usageRow, error: usageError } =
      await supabaseAdmin
        .from("usage_daily")
        .select("*")
        .eq("user_id", user.id)
        .eq("usage_date", today)
        .maybeSingle();

    if (usageError) {
      console.error(
        "Usage lookup error:",
        usageError
      );

      return res.status(500).json({
        error: "Unable to read usage"
      });
    }

    const usage = Number(
      usageRow?.usage_count ??
      usageRow?.count ??
      usageRow?.uses ??
      0
    );

    const limit = 5;
    const remaining = Math.max(
      0,
      limit - usage
    );

    return res.status(200).json({
      success: true,
      plan: "free",
      usage,
      limit,
      remaining,
      unlimited: false,
      date: today
    });
  } catch (error) {
    console.error("Usage API error:", error);

    return res.status(500).json({
      error: "Unable to load usage"
    });
  }
};
