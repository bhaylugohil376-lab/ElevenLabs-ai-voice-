export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const API_KEY = process.env.ELEVENLABS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "ELEVENLABS_API_KEY is missing"
    });
  }

  try {
    const {
      search = "",
      gender = "",
      language = "",
      category = "",
      age = "",
      page_size = "100",
      page_token = ""
    } = req.query;

    const params = new URLSearchParams();

    // ElevenLabs V2 Voices API
    params.set(
      "page_size",
      Math.min(Number(page_size) || 100, 100).toString()
    );

    if (search.trim()) {
      params.set("search", search.trim());
    }

    if (gender.trim()) {
      params.set("gender", gender.trim());
    }

    if (language.trim()) {
      params.set("language", language.trim());
    }

    if (category.trim()) {
      params.set("category", category.trim());
    }

    if (age.trim()) {
      params.set("age", age.trim());
    }

    if (page_token.trim()) {
      params.set("page_token", page_token.trim());
    }

    const url =
      `https://api.elevenlabs.io/v2/voices?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "xi-api-key": API_KEY,
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.detail?.message ||
        data?.detail ||
        data?.message ||
        "Unable to load ElevenLabs voices";

      return res.status(response.status).json({
        error: message
      });
    }

    const voices = Array.isArray(data.voices)
      ? data.voices
      : [];

    /*
     * Return only the information required
     * by the VoiceAI frontend.
     */
    const safeVoices = voices.map((voice) => ({
      voice_id: voice.voice_id || "",
      name: voice.name || "Unnamed Voice",

      category: voice.category || "",
      description: voice.description || "",

      labels: voice.labels || {},

      preview_url:
        voice.preview_url ||
        voice.previewUrl ||
        null,

      available_for_tiers:
        voice.available_for_tiers || [],

      settings:
        voice.settings || null,

      high_quality_base_model_ids:
        voice.high_quality_base_model_ids || [],

      verified_languages:
        voice.verified_languages || [],

      samples:
        Array.isArray(voice.samples)
          ? voice.samples.map((sample) => ({
              sample_id: sample.sample_id || "",
              file_name: sample.file_name || "",
              mime_type: sample.mime_type || "",
              size_bytes: sample.size_bytes || 0,
              hash: sample.hash || "",
              duration_secs:
                sample.duration_secs || 0,
              remove_background_noise:
                sample.remove_background_noise || false
            }))
          : []
    }));

    return res.status(200).json({
      voices: safeVoices,

      has_more:
        Boolean(data.has_more),

      next_page_token:
        data.next_page_token || null,

      total_count:
        data.total_count || safeVoices.length
    });

  } catch (error) {
    console.error(
      "ElevenLabs voices error:",
      error
    );

    return res.status(500).json({
      error: "Voice server error"
    });
  }
}
