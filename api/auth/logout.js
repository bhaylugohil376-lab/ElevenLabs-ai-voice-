// api/auth/logout.js

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
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session"
      });
    }

    /*
     * Supabase browser sessions are normally cleared
     * by supabaseClient.auth.signOut() on the frontend.
     *
     * This backend endpoint additionally provides a
     * protected logout route for API clients.
     */
    const { error } =
      await supabaseAdmin.auth.admin.signOut(
        user.id,
        "global"
      );

    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        success: false,
        error: "Unable to logout"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Logout API error:", error);

    return res.status(500).json({
      success: false,
      error: "Logout failed"
    });
  }
};
