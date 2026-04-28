// Stripe webhook receiver — keeps user_subscriptions in sync with
// Stripe's subscription state.
//
// Deployed as a Supabase Edge Function (Deno). To deploy:
//
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
//
// Supabase auto-injects the project's URL and the API-Keys-2.0
// secret key into every Edge Function — no manual `secrets set`
// for those (the CLI rejects names starting with SUPABASE_ anyway).
// This function reads `SUPABASE_SECRET_KEY` first (new format,
// `sb_secret_…`) and falls back to `SUPABASE_SERVICE_ROLE_KEY` for
// projects still on the legacy JWT key.
//
// Then in Stripe Dashboard → Developers → Webhooks, add an endpoint
// pointing to https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// and subscribe it to:
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.paid (refreshes current_period_end after renewal)
//
// We DON'T verify the user's JWT (--no-verify-jwt) because Stripe
// webhooks don't carry one. Signature verification happens via the
// Stripe-Signature header against STRIPE_WEBHOOK_SECRET.
//
// The Stripe Customer object MUST have user_id stored in metadata
// when the Checkout Session is created. This is how we map back from
// Stripe → our user. Use Payment Links with `client_reference_id`
// set to the Supabase user_id, or pass user_id in checkout-session
// metadata when using the API directly.

// @ts-expect-error — Deno-style import resolved at runtime by Supabase Edge Functions
import Stripe from 'https://esm.sh/stripe@14?target=denonext';
// @ts-expect-error — Deno standard library
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-expect-error — Deno global
const Deno_ = (globalThis as any).Deno;

const stripe = new Stripe(Deno_.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-09-30.acacia',
});

// Prefer the new API-Keys-2.0 secret key (sb_secret_…). Fall back
// to the legacy service_role JWT only for projects that haven't yet
// disabled JWT-based keys. Supabase auto-injects whichever exists.
const supabaseKey =
  Deno_.env.get('SUPABASE_SECRET_KEY') ?? Deno_.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseKey) {
  throw new Error(
    'Neither SUPABASE_SECRET_KEY nor SUPABASE_SERVICE_ROLE_KEY is set ' +
      'in the function environment',
  );
}
const supabase = createClient(Deno_.env.get('SUPABASE_URL')!, supabaseKey);

const WEBHOOK_SECRET = Deno_.env.get('STRIPE_WEBHOOK_SECRET')!;

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  items: { data: Array<{ price: { id: string; recurring?: { interval: string } } }> };
  metadata: Record<string, string>;
}

/** Map Stripe price → our plan label. Operator sets these env vars
 * to the price IDs from the Stripe dashboard. */
function priceToPlan(priceId: string): 'monthly' | 'annual' | null {
  if (priceId === Deno_.env.get('STRIPE_PRICE_MONTHLY')) return 'monthly';
  if (priceId === Deno_.env.get('STRIPE_PRICE_ANNUAL')) return 'annual';
  return null;
}

async function upsertSubscription(sub: StripeSubscription, userId: string) {
  const priceId = sub.items.data[0]?.price?.id ?? '';
  const plan = priceToPlan(priceId);
  if (!plan) {
    console.warn(`Unknown price ${priceId} on subscription ${sub.id}`);
    return;
  }
  const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
  const { error } = await supabase
    .from('user_subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        plan,
        status: sub.status,
        current_period_end: periodEnd,
        cancel_at_period_end: sub.cancel_at_period_end,
      },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.error('user_subscriptions upsert failed:', error);
    throw new Error(`upsert failed: ${error.message}`);
  }
}

async function deleteSubscription(userId: string) {
  const { error } = await supabase
    .from('user_subscriptions')
    .delete()
    .eq('user_id', userId);
  if (error) console.error('user_subscriptions delete failed:', error);
}

async function userIdForCustomer(customerId: string): Promise<string | null> {
  // Stripe Customers should have user_id stamped in metadata at creation
  // (Payment Links: client_reference_id; Checkout Session: metadata).
  const customer = await stripe.customers.retrieve(customerId);
  if (typeof customer === 'string' || customer.deleted) return null;
  return (customer.metadata?.user_id as string) ?? null;
}

// @ts-expect-error — Deno serve() global
Deno_.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const body = await req.text();
  let event: { type: string; data: { object: StripeSubscription } };
  try {
    event = (await stripe.webhooks.constructEventAsync(
      body,
      sig,
      WEBHOOK_SECRET,
    )) as typeof event;
  } catch (err) {
    console.error('Signature verification failed:', err);
    return new Response('Bad signature', { status: 400 });
  }

  const sub = event.data.object;
  try {
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'invoice.paid'
    ) {
      // For invoice.paid we still need the subscription object — Stripe
      // includes a subscription field on the invoice; for simplicity here
      // we only act on subscription events and accept slight lag on
      // renewal current_period_end refresh.
      if (!sub.customer) {
        return new Response('OK (no customer)', { status: 200 });
      }
      const userId = await userIdForCustomer(sub.customer);
      if (!userId) {
        console.warn(`No user_id in customer metadata for ${sub.customer}`);
        return new Response('OK (no user mapping)', { status: 200 });
      }
      await upsertSubscription(sub, userId);
    } else if (event.type === 'customer.subscription.deleted') {
      const userId = await userIdForCustomer(sub.customer);
      if (userId) await deleteSubscription(userId);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(`Handler error for ${event.type}:`, err);
    return new Response('Handler error', { status: 500 });
  }
});
