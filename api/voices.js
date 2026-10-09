
import { requireUser } from "./_lib/auth.js";
import { requireMethod, sendError } from "./_lib/response.js";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return sendError(res, 503, "Voice provider is not configured.");
    }

    const search = typeof req.query?.search === "string"
      ? req.query.search.trim().slice(0, 100).toLowerCase()
      : "";

    const category = typeof req.query?.category === "string"
      ? req.query.category.trim().toLowerCase()
      : "";

    const pageSize = Math.min(
      Math.max(Number.parseInt(req.query?.page_size || "100", 10) || 100, 1),
      100
    );

    const providerResponse = await fetch(
      `${ELEVENLABS_API_URL}/voices?page_size=${pageSize}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          "Accept": "application/json"
        }
      }
    );

    if (!providerResponse.ok) {
      const providerMessage = await providerResponse.text();
      console.error(
        "ElevenLabs voices failed:",
        providerResponse.status,
        providerMessage.slice(0, 300)
      );

      return sendError(res, 502, "Could not load voices from the provider.");
    }

    const payload = await providerResponse.json();

    let voices = (payload.voices || []).map((voice) => ({
      voice_id: voice.voice_id,
      name: voice.name,
      category: voice.category || "general",
      description: voice.description || "",
      labels: voice.labels || {},
      preview_url: voice.preview_url || null,
      available_for_tiers: voice.available_for_tiers || [],
      high_quality_base_model_ids: voice.high_quality_base_model_ids || []
    }));

    if (search) {
      voices = voices.filter((voice) =>
        [
          voice.name,
          voice.description,
          voice.category,
          ...Object.values(voice.labels)
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)
      );
    }

    if (category && category !== "all") {
      voices = voices.filter(
        (voice) => String(voice.category).toLowerCase() === category
      );
    }

    res.setHeader("Cache-Control", "private, max-age=60");

    return res.status(200).json({
      success: true,
      voices,
      count: voices.length,
      has_more: Boolean(payload.has_more),
      next_page_token: payload.next_page_token || null
    });
  } catch (error) {
    console.error("Voices API error:", error.message);
    return sendError(res, 500, "An unexpected error occurred while loading voices.");
  }
}
