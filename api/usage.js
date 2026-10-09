
import { supabaseAdmin } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import {
  requireMethod,
  sendError
} from "./_lib/response.js";

const FREE_LIMIT = 5;
const WINDOW_HOURS = 24;

const AI_ACTIONS = [
  "tts",
  "assistant",
  "image",
  "stt",
  "dubbing",
  "voice_clone",
  "voice_design",
  "voice_changer",
  "voice_isolator",
  "captions",
  "music",
  "sound_effects"
];

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
      console.error("Plan lookup failed:", profileError.message);
      return sendError(res, 500, "Could not load your plan.");
    }

    const plan = String(profile?.plan || "free").toLowerCase();
    const premium = plan === "premium";

    if (premium) {
      const tools = Object.fromEntries(
        AI_ACTIONS.map(action => [
          action,
          {
            limit: null,
            used: 0,
            remaining: null,
            unlimited: true
          }
        ])
      );

      return res.status(200).json({
        success: true,
        plan: "premium",
        premium: true,
        window_hours: WINDOW_HOURS,
        tools
      });
    }

    const since = new Date(
      Date.now() - WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data: logs, error: logsError } = await supabaseAdmin
      .from("usage_logs")
      .select("action, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .in("action", AI_ACTIONS);

    if (logsError) {
      console.error("Usage log lookup failed:", logsError.message);
      return sendError(res, 500, "Could not load usage details.");
    }

    const counts = Object.fromEntries(
      AI_ACTIONS.map(action => [action, 0])
    );

    for (const log of logs || []) {
      if (Object.prototype.hasOwnProperty.call(counts, log.action)) {
        counts[log.action] += 1;
      }
    }

    const tools = Object.fromEntries(
      AI_ACTIONS.map(action => {
        const used = counts[action];

        return [
          action,
          {
            limit: FREE_LIMIT,
            used,
            remaining: Math.max(0, FREE_LIMIT - used),
            unlimited: false
          }
        ];
      })
    );

    return res.status(200).json({
      success: true,
      plan: "free",
      premium: false,
      limit_per_tool: FREE_LIMIT,
      window_hours: WINDOW_HOURS,
      tools
    });
  } catch (error) {
    console.error("Usage API error:", error.message);
    return sendError(res, 500, "Could not retrieve usage summary.");
  }
}
