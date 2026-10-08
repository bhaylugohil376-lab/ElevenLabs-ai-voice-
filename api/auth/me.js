// api/auth/me.js

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
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        authenticated: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        authenticated: false,
        error: "Invalid or expired session"
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error("Profile error:", profileError);
    }

    const { data: subscription } =
      await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    const isPremium =
      subscription &&
      ["active", "trialing"].includes(
        subscription.status
      ) &&
      subscription.plan === "premium";

    const isAdmin =
      profile?.plan === "admin" ||
      profile?.role === "admin";

    let plan = "free";

    if (isAdmin) {
      plan = "admin";
    } else if (isPremium) {
      plan = "premium";
    }

    return res.status(200).json({
      authenticated: true,

      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      },

      profile: profile || null,

      subscription: subscription || null,

      plan,

      usage: {
        dailyLimit:
          plan === "free" ? 5 : null,
        unlimited:
          plan === "premium" || plan === "admin"
      }
    });
  } catch (error) {
    console.error("Auth/me error:", error);

    return res.status(500).json({
      authenticated: false,
      error: "Unable to load account"
    });
  }
};
