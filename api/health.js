
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const checks = {
    supabase: Boolean(
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    stripe: Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET
    )
  };

  const configured = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;

  return res.status(200).json({
    success: true,
    status: "running",
    environment: process.env.VERCEL_ENV || "local",
    integrations: checks,
    configured,
    total,
    note: "Configuration presence only; external services have not been tested."
  });
}
