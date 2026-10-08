// api/billing/webhook.js

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({
      error: "Missing Stripe signature"
    });
  }

  let event;

  try {
    /*
     * IMPORTANT:
     * req.body must be the RAW Stripe request body.
     * Do not JSON.parse() it before signature verification.
     */
    const rawBody = req.body;

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error(
      "Stripe webhook signature error:",
      error.message
    );

    return res.status(400).send(
      `Webhook Error: ${error.message}`
    );
  }

  try {
    switch (event.type) {
      /*
       * Checkout completed successfully.
       */
      case "checkout.session.completed": {
        const session = event.data.object;

        const userId =
          session.metadata?.supabase_user_id ||
          session.client_reference_id;

        if (!userId) {
          console.error(
            "No Supabase user ID in checkout session."
          );
          break;
        }

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;

        let subscriptionData = null;

        if (subscriptionId) {
          subscriptionData =
            await stripe.subscriptions.retrieve(
              subscriptionId
            );
        }

        const interval =
          session.metadata?.billing_interval ||
          subscriptionData?.items?.data?.[0]?.price?.recurring
            ?.interval ||
          "month";

        const amount =
          session.amount_total ||
          0;

        /*
         * Activate Premium.
         */
        const { error: subscriptionError } =
          await supabaseAdmin
            .from("subscriptions")
            .upsert(
              {
                user_id: userId,
                plan: "premium",
                status:
                  subscriptionData?.status ||
                  "active",
                stripe_customer_id:
                  typeof session.customer === "string"
                    ? session.customer
                    : session.customer?.id || null,
                stripe_subscription_id:
                  subscriptionId,
                amount,
                currency:
                  session.currency || "usd",
                interval
              },
              {
                onConflict: "user_id"
              }
            );

        if (subscriptionError) {
          throw subscriptionError;
        }

        /*
         * Mark payment successful.
         */
        await supabaseAdmin
          .from("payments")
          .update({
            status: "paid",
            stripe_subscription_id:
              subscriptionId
          })
          .eq(
            "stripe_checkout_session_id",
            session.id
          );

        console.log(
          `Premium activated for user ${userId}`
        );

        break;
      }

      /*
       * Subscription becomes active.
       */
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;

        const userId =
          subscription.metadata?.supabase_user_id;

        if (!userId) break;

        const status = subscription.status;

        const activeStatuses = [
          "active",
          "trialing"
        ];

        const isPremium =
          activeStatuses.includes(status);

        await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              plan: isPremium ? "premium" : "free",
              status,
              stripe_customer_id:
                typeof subscription.customer === "string"
                  ? subscription.customer
                  : subscription.customer?.id || null,
              stripe_subscription_id:
                subscription.id,
              amount:
                subscription.items?.data?.[0]?.price
                  ?.unit_amount || 0,
              currency:
                subscription.items?.data?.[0]?.price
                  ?.currency || "usd",
              interval:
                subscription.items?.data?.[0]?.price
                  ?.recurring?.interval || "month"
            },
            {
              onConflict: "user_id"
            }
          );

        break;
      }

      /*
       * Subscription cancelled.
       */
      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        const userId =
          subscription.metadata?.supabase_user_id;

        if (!userId) break;

        await supabaseAdmin
          .from("subscriptions")
          .update({
            plan: "free",
            status: "cancelled"
          })
          .eq("user_id", userId);

        console.log(
          `Premium cancelled for user ${userId}`
        );

        break;
      }

      /*
       * Invoice successfully paid.
       */
      case "invoice.paid": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (!subscriptionId) break;

        await supabaseAdmin
          .from("payments")
          .update({
            status: "paid"
          })
          .eq(
            "stripe_subscription_id",
            subscriptionId
          );

        break;
      }

      /*
       * Failed subscription payment.
       */
      case "invoice.payment_failed": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (!subscriptionId) break;

        await supabaseAdmin
          .from("payments")
          .update({
            status: "failed"
          })
          .eq(
            "stripe_subscription_id",
            subscriptionId
          );

        break;
      }

      default:
        console.log(
          `Unhandled Stripe event: ${event.type}`
        );
    }

    return res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error(
      "Stripe webhook processing error:",
      error
    );

    return res.status(500).json({
      error: "Webhook processing failed"
    });
  }
};
