// api/auth/profile.js

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
    "GET, PATCH, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!["GET", "PATCH"].includes(req.method)) {
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

    // GET PROFILE
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Profile fetch error:", error);

        return res.status(500).json({
          error: "Unable to load profile"
        });
      }

      return res.status(200).json({
        success: true,
        profile: data || {
          id: user.id,
          full_name: "",
          plan: "free"
        }
      });
    }

    // PATCH PROFILE
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const fullName =
      typeof body.full_name === "string"
        ? body.full_name.trim()
        : undefined;

    const avatarUrl =
      typeof body.avatar_url === "string"
        ? body.avatar_url.trim()
        : undefined;

    if (
      fullName !== undefined &&
      fullName.length > 100
    ) {
      return res.status(400).json({
        error: "Name must be 100 characters or less"
      });
    }

    if (
      avatarUrl !== undefined &&
      avatarUrl.length > 1000
    ) {
      return res.status(400).json({
        error: "Avatar URL is too long"
      });
    }

    const updates = {};

    if (fullName !== undefined) {
      updates.full_name = fullName;
    }

    if (avatarUrl !== undefined) {
      updates.avatar_url = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: "No profile changes supplied"
      });
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Profile update error:", error);

      return res.status(500).json({
        error: "Unable to update profile",
        details: error.message
      });
    }

    /*
     * Keep Supabase Auth metadata synchronized
     * with the profile name.
     */
    if (fullName !== undefined) {
      await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        {
          user_metadata: {
            ...user.user_metadata,
            full_name: fullName
          }
        }
      );
    }

    return res.status(200).json({
      success: true,
      profile: data
    });
  } catch (error) {
    console.error("Profile API error:", error);

    return res.status(500).json({
      error: "Profile request failed"
    });
  }
};
