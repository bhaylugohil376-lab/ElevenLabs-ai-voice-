import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

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

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({
      success: false,
      error: "Stripe webhook secret is not configured"
    });
  }

  try {
    const rawBody = await getRawBody(req);

    const signature =
      req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        success: false,
        error: "Missing Stripe signature"
      });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error(
        "Stripe signature verification failed:",
        error.message
      );

      return res.status(400).json({
        success: false,
        error: "Invalid Stripe webhook signature"
      });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const userId =
          session.metadata?.user_id;

        if (!userId) {
          console.warn(
            "Webhook: user_id missing from checkout metadata"
          );
          break;
        }

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;

        let subscription = null;

        if (subscriptionId) {
          subscription =
            await stripe.subscriptions.retrieve(
              subscriptionId
            );
        }

        await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              plan: "premium",
              status: subscription?.status || "active",
              stripe_customer_id:
                typeof session.customer === "string"
                  ? session.customer
                  : session.customer?.id || null,
              stripe_subscription_id:
                subscriptionId,
              current_period_start:
                subscription?.current_period_start
                  ? new Date(
                      subscription.current_period_start * 1000
                    ).toISOString()
                  : null,
              current_period_end:
                subscription?.current_period_end
                  ? new Date(
                      subscription.current_period_end * 1000
                    ).toISOString()
                  : null
            },
            {
              onConflict: "user_id"
            }
          );

        await supabaseAdmin
          .from("payments")
          .update({
            status: "completed",
            stripe_subscription_id:
              subscriptionId
          })
          .eq(
            "stripe_checkout_session_id",
            session.id
          );

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription =
          event.data.object;

        const userId =
          subscription.metadata?.user_id;

        if (!userId) {
          break;
        }

        await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              plan:
                subscription.status === "active" ||
                subscription.status === "trialing"
                  ? "premium"
                  : "free",
              status: subscription.status,
              stripe_customer_id:
                typeof subscription.customer === "string"
                  ? subscription.customer
                  : subscription.customer?.id || null,
              stripe_subscription_id:
                subscription.id,
              current_period_start:
                subscription.current_period_start
                  ? new Date(
                      subscription.current_period_start * 1000
                    ).toISOString()
                  : null,
              current_period_end:
                subscription.current_period_end
                  ? new Date(
                      subscription.current_period_end * 1000
                    ).toISOString()
                  : null
            },
            {
              onConflict: "user_id"
            }
          );

        break;
      }

      case "customer.subscription.deleted": {
        const subscription =
          event.data.object;

        const userId =
          subscription.metadata?.user_id;

        if (!userId) {
          break;
        }

        await supabaseAdmin
          .from("subscriptions")
          .update({
            plan: "free",
            status: "canceled"
          })
          .eq("user_id", userId);

        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (subscriptionId) {
          await supabaseAdmin
            .from("payments")
            .update({
              status: "paid"
            })
            .eq(
              "stripe_subscription_id",
              subscriptionId
            );
        }

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (subscriptionId) {
          await supabaseAdmin
            .from("payments")
            .update({
              status: "failed"
            })
            .eq(
              "stripe_subscription_id",
              subscriptionId
            );
        }

        break;
      }

      default:
        console.log(
          `Unhandled Stripe event: ${event.type}`
        );
    }

    return res.status(200).json({
      success: true,
      received: true
    });
  } catch (error) {
    console.error(
      "Stripe webhook error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Webhook processing failed"
    });
  }
}
