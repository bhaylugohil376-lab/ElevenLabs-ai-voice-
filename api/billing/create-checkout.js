// api/billing/create-checkout.js

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const user = await getUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Please login before upgrading."
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const plan = String(body.plan || "premium").toLowerCase();
    const interval =
      String(body.interval || "month").toLowerCase();

    if (plan !== "premium") {
      return res.status(400).json({
        error: "Invalid plan."
      });
    }

    if (!["month", "year"].includes(interval)) {
      return res.status(400).json({
        error: "Invalid billing interval."
      });
    }

    /*
     * Price is controlled by the server.
     * Never trust the amount sent by the browser.
     */
    const amount =
      interval === "year"
        ? 19200
        : 2000;

    const currency = "usd";

    /*
     * Reuse an existing Stripe customer if available.
     */
    let customerId = null;

    const { data: existingSubscription } =
      await supabaseAdmin
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (existingSubscription?.stripe_customer_id) {
      customerId = existingSubscription.stripe_customer_id;
    }

    /*
     * Create Stripe customer when needed.
     */
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id
        }
      });

      customerId = customer.id;

      await supabaseAdmin
        .from("subscriptions")
        .upsert(
          {
            user_id: user.id,
            stripe_customer_id: customerId,
            plan: "free",
            status: "inactive"
          },
          {
            onConflict: "user_id"
          }
        );
    }

    const origin =
      process.env.PUBLIC_APP_URL ||
      `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",

      customer: customerId,

      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: "VoiceAI Premium",
              description:
                "Premium AI voice creation and advanced VoiceAI tools"
            },
            unit_amount: amount,
            recurring: {
              interval
            }
          },
          quantity: 1
        }
      ],

      success_url:
        `${origin}/profile.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${origin}/pricing.html?payment=cancelled`,

      client_reference_id: user.id,

      metadata: {
        supabase_user_id: user.id,
        plan: "premium",
        billing_interval: interval
      },

      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan: "premium",
          billing_interval: interval
        }
      }
    });

    /*
     * Store pending checkout information.
     */
    await supabaseAdmin
      .from("payments")
      .insert({
        user_id: user.id,
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        amount: amount,
        currency: currency,
        status: "pending",
        plan: "premium",
        interval: interval
      });

    return res.status(200).json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    return res.status(500).json({
      error: "Unable to create checkout session."
    });
  }
};
