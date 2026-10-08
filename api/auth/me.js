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

export default async function handler(req, res) {
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
      success: false,
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
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session"
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        created_at: user.created_at,
        last_sign_in_at:
          user.last_sign_in_at || null,
        user_metadata:
          user.user_metadata || {}
      }
    });
  } catch (error) {
    console.error("Auth/me error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}
