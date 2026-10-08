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
    "GET, PATCH, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "PATCH") {
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

    if (req.method === "GET") {
      const {
        data: profile,
        error: profileError
      } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error(
          "Profile fetch error:",
          profileError
        );

        return res.status(500).json({
          success: false,
          error: "Unable to load profile"
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          user_metadata:
            user.user_metadata || {}
        },
        profile: profile || null
      });
    }

    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error: "Invalid JSON body"
        });
      }
    }

    const updates = {};

    if (
      typeof body.full_name === "string"
    ) {
      updates.full_name =
        body.full_name.trim().slice(0, 100);
    }

    if (
      typeof body.username === "string"
    ) {
      updates.username =
        body.username.trim().slice(0, 50);
    }

    if (
      typeof body.avatar_url === "string"
    ) {
      updates.avatar_url =
        body.avatar_url.trim().slice(0, 1000);
    }

    if (
      typeof body.bio === "string"
    ) {
      updates.bio =
        body.bio.trim().slice(0, 500);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid profile fields provided"
      });
    }

    const {
      data: profile,
      error: updateError
    } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("*")
      .single();

    if (updateError) {
      console.error(
        "Profile update error:",
        updateError
      );

      return res.status(500).json({
        success: false,
        error: "Unable to update profile"
      });
    }

    return res.status(200).json({
      success: true,
      profile
    });
  } catch (error) {
    console.error(
      "Profile API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}
