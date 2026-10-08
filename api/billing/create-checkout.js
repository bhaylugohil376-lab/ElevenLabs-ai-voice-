import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    const {
      data: { user },
      error: authError
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired session"
      });
    }

    let body = req.body || {};

    if (typeof body === "string") {
      body = JSON.parse(body || "{}");
    }

    const interval =
      body.interval === "year"
        ? "year"
        : "month";

    if (!process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID) {
      return res.status(500).json({
        success: false,
        error:
          "Stripe monthly price is not configured"
      });
    }

    if (
      interval === "year" &&
      !process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID
    ) {
      return res.status(500).json({
        success: false,
        error:
          "Stripe yearly price is not configured"
      });
    }

    const priceId =
      interval === "year"
        ? process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID
        : process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;

    const { data: profile } =
      await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

    let customer;

    const { data: existingSubscription } =
      await supabaseAdmin
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (existingSubscription?.stripe_customer_id) {
      customer = await stripe.customers.retrieve(
        existingSubscription.stripe_customer_id
      );
    }

    if (!customer || customer.deleted) {
      customer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name || undefined,
        metadata: {
          user_id: user.id
        }
      });

      await supabaseAdmin
        .from("subscriptions")
        .upsert(
          {
            user_id: user.id,
            stripe_customer_id: customer.id
          },
          {
            onConflict: "user_id"
          }
        );
    }

    const origin =
      req.headers.origin ||
      process.env.APP_URL ||
      "https://your-domain.com";

    const session =
      await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url:
          `${origin}/pricing.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:
          `${origin}/pricing.html?canceled=true`,
        customer_email:
          customer.email || user.email,
        allow_promotion_codes: true,
        metadata: {
          user_id: user.id,
          plan: "premium",
          interval
        },
        subscription_data: {
          metadata: {
            user_id: user.id,
            plan: "premium",
            interval
          }
        }
      });

    await supabaseAdmin
      .from("payments")
      .insert({
        user_id: user.id,
        stripe_customer_id: customer.id,
        stripe_checkout_session_id: session.id,
        plan: "premium",
        interval,
        status: "pending",
        amount: interval === "year"
          ? 19200
          : 2000,
        currency: "usd"
      });

    return res.status(200).json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error(
      "Create checkout error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to create checkout session"
    });
  }
}
