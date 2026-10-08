// api/contact.js

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
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

  if (error || !user) {
    return null;
  }

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
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();

    if (!name) {
      return res.status(400).json({
        error: "Name is required"
      });
    }

    if (!email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        error: "Invalid email address"
      });
    }

    if (!message) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        error: "Message is too long"
      });
    }

    const user = await getUser(req);

    const insertData = {
      name,
      email,
      subject: subject || "General enquiry",
      message,
      user_id: user ? user.id : null,
      status: "new"
    };

    const { data, error } = await supabaseAdmin
      .from("contact_messages")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Contact insert error:", error);

      return res.status(500).json({
        error: "Unable to send message",
        details: error.message
      });
    }

    return res.status(200).json({
      success: true,
      message: "Your message has been sent successfully.",
      contact: {
        id: data.id
      }
    });
  } catch (error) {
    console.error("Contact API error:", error);

    return res.status(500).json({
      error: "Contact request failed"
    });
  }
};
