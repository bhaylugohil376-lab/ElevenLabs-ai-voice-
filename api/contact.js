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

export default async function handler(req, res) {
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
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({
          success: false,
          error: "Invalid JSON body"
        });
      }
    }

    const name = String(
      body.name || ""
    ).trim();

    const email = String(
      body.email || ""
    ).trim().toLowerCase();

    const subject = String(
      body.subject || ""
    ).trim();

    const message = String(
      body.message || ""
    ).trim();

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error:
          "Name, email and message are required"
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        success: false,
        error: "Name is too long"
      });
    }

    if (email.length > 254) {
      return res.status(400).json({
        success: false,
        error: "Email is too long"
      });
    }

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email address"
      });
    }

    if (subject.length > 200) {
      return res.status(400).json({
        success: false,
        error: "Subject is too long"
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Message is too long"
      });
    }

    const {
      data: contactMessage,
      error
    } = await supabaseAdmin
      .from("contact_messages")
      .insert({
        name,
        email,
        subject: subject || null,
        message
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error(
        "Contact message error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Unable to save contact message"
      });
    }

    return res.status(201).json({
      success: true,
      message:
        "Your message has been submitted successfully.",
      data: contactMessage
    });
  } catch (error) {
    console.error(
      "Contact API error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}
