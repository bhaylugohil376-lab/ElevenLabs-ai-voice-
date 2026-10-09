
import { supabaseAdmin } from "./supabase.js";

const FREE_LIMIT = 5;
const WINDOW_HOURS = 24;

// Each tool must use a distinct action name:
// "tts", "assistant", "image", "stt", "voice_clone", etc.
export async function checkAndUseAI(user, action) {
  if (!user?.id) {
    return { allowed: false, status: 401, error: "Authentication required." };
  }

  if (
    typeof action !== "string" ||
    !/^[a-z][a-z0-9_]{1,49}$/.test(action)
  ) {
    return { allowed: false, status: 400, error: "Invalid AI action." };
  }

  // Load the user's plan from their server-side profile.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Plan lookup failed:", profileError.message);
    return { allowed: false, status: 500, error: "Could not verify subscription." };
  }

  const plan = String(profile?.plan || "free").toLowerCase();

  if (plan === "premium") {
    return {
      allowed: true,
      premium: true,
      remaining: null
    };
  }

  // Atomic enforcement should be performed by a database RPC.
  const { data, error } = await supabaseAdmin.rpc("check_and_use_ai", {
    p_user_id: user.id,
    p_action: action,
    p_limit: FREE_LIMIT,
    p_window_hours: WINDOW_HOURS
  });

  if (error) {
    console.error("Usage RPC failed:", error.message);
    return {
      allowed: false,
      status: 500,
      error: "Usage check is not configured correctly."
    };
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result || result.allowed !== true) {
    return {
      allowed: false,
      status: 429,
      error: "Free limit reached for this tool. Try again after the usage window resets, or upgrade to Premium."
    };
  }

  return {
    allowed: true,
    premium: false,
    remaining: result.remaining ?? null
  };
}
