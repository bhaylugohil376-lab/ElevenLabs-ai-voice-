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
    const response = await fetch(
      "https://api.elevenlabs.io/v1/voices",
      {
        method: "GET",
        headers: {
          "xi-api-key": API_KEY,
          "Accept": "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.detail?.message ||
          "Unable to load voices"
      });
    }

    return res.status(200).json({
      voices: data.voices || []
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Voice server error"
    });
  }
}
