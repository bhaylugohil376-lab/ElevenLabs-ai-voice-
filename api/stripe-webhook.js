
import Stripe from "stripe";
import { buffer } from "node:stream/consumers";
import { supabaseAdmin } from "./_lib/supabase.js";
import { sendError } from "./_lib/response.js";

export const config = {
  api: {
    bodyParser: false
  }
};

function isPremiumStatus(status) {
  return status === "active" || status === "trialing";
}

async function syncSubscription(subscription, customerId = null) {
  const subscriptionId = subscription.id;

  let userId = subscription.metadata?.user_id || null;

  // If metadata is missing, find the existing subscription record.
  if (!userId) {
    const { data: existing, error } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (error) throw error;
    userId = existing?.user_id || null;
  }

  if (!userId) {
    throw new Error("Could not associate subscription with a user.");
  }

  const priceId =
    subscription.items?.data?.[0]?.price?.id || null;

  const premium = isPremiumStatus(subscription.status);

  const { error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id:
          customerId || String(subscription.customer || ""),
        stripe_subscription_id: subscriptionId,
        status: subscription.status,
        price_id: priceId,
        current_period_end: subscription.current_period_end
          ? new Date(
              subscription.current_period_end * 1000
            ).toISOString()
          : null,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "stripe_subscription_id"
      }
    );

  if (subscriptionError) throw subscriptionError;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      plan: premium ? "premium" : "free"
    })
    .eq("id", userId);

  if (profileError) throw profileError;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Method not allowed.");
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return sendError(res, 503, "Stripe webhook is not configured.");
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return sendError(res, 400, "Missing Stripe signature.");
  }

  const stripe = new Stripe(secretKey);

  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body)
        : await buffer(req);

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
    } catch {
      return sendError(res, 400, "Invalid webhook signature.");
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode !== "subscription" || !session.subscription) {
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(
          String(session.subscription)
        );

        // Use server-created checkout metadata, not frontend plan claims.
        if (
          session.metadata?.plan !== "premium" ||
          !session.metadata?.user_id
        ) {
          throw new Error("Checkout session metadata is missing.");
        }

        if (
          subscription.metadata?.user_id !== session.metadata.user_id
        ) {
          throw new Error("Subscription user metadata mismatch.");
        }

        await syncSubscription(
          subscription,
          String(session.customer || "")
        );

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(
          event.data.object,
          String(event.data.object.customer || "")
        );
        break;
      }

      default:
        // Acknowledge unrelated Stripe events.
        break;
    }

    return res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);

    // A non-2xx response allows Stripe to retry delivery.
    return sendError(res, 500, "Webhook processing failed.");
  }
}
