# Stripe Setup — Operator Runbook

One-time setup to wire Stripe → Supabase → frontend gating. Takes ~30 min.

---

## 1. Create the Stripe products

Stripe Dashboard → **Products** → **Add product**.

**Product 1: Homestead Finder Monthly**
- Name: `Homestead Finder — Monthly`
- Pricing: `$19.00 USD` recurring monthly
- Save the **Price ID** (starts with `price_`) — call it `STRIPE_PRICE_MONTHLY`

**Product 2: Homestead Finder Annual**
- Name: `Homestead Finder — Annual`
- Pricing: `$190.00 USD` recurring yearly
- Save the **Price ID** — call it `STRIPE_PRICE_ANNUAL`

---

## 2. Create Payment Links

Stripe Dashboard → **Payment Links** → **New**.

Two links, one per price. Important config for both:
- **After payment**: redirect to your domain with `?checkout=success`
  - Dev: `http://localhost:5173/?checkout=success`
  - Prod: `https://homesteadfinder.com/?checkout=success` (or wherever)
- **Collect customer info**: enable `client_reference_id` so we can pass the Supabase user_id at click time

Save the two Payment Link URLs — they look like `https://buy.stripe.com/xxx`.

> **Note:** the simplest way to attach `user_id` to the Stripe Customer
> is to append `?client_reference_id={USER_ID}` to the Payment Link URL
> at click-time. The frontend needs to grab the user's id from Supabase
> auth and inject it. Update `lib/billing.ts:STRIPE_PAYMENT_LINKS` if
> you need to template this — initial implementation hardcodes the
> base URL and lets Stripe handle anonymous checkout, with the
> webhook looking up `client_reference_id` on the resulting Customer.

---

## 3. Configure frontend

Add to `frontend/.env.local`:

```
VITE_STRIPE_LINK_MONTHLY=https://buy.stripe.com/xxx_monthly
VITE_STRIPE_LINK_ANNUAL=https://buy.stripe.com/xxx_annual
```

Redeploy the frontend (or restart `npm run dev`) so Vite re-bakes the env.

---

## 4. Deploy the webhook function

Install Supabase CLI: `brew install supabase/tap/supabase`

```bash
cd /Users/chris.harper/Development/homestead-finder
supabase login
supabase link --project-ref kgptqlblrspjqvlntzut
supabase functions deploy stripe-webhook --no-verify-jwt
```

Set the secrets the function reads:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx     # filled in step 5
supabase secrets set STRIPE_PRICE_MONTHLY=price_xxx_monthly
supabase secrets set STRIPE_PRICE_ANNUAL=price_xxx_annual
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY come pre-set by the platform
```

---

## 5. Configure the Stripe webhook

Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**.

- URL: `https://kgptqlblrspjqvlntzut.supabase.co/functions/v1/stripe-webhook`
- Events to subscribe:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
- After creating, copy the **Signing secret** (starts with `whsec_`) — paste into the Supabase secret from step 4 (`STRIPE_WEBHOOK_SECRET`).

---

## 6. Test end-to-end

1. Sign in to the app as a test user.
2. Click any feature that prompts the upgrade modal (try saving a 6th listing).
3. Click the Annual plan tile → land on Stripe Checkout.
4. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any CVC.
5. Complete checkout → redirect back to app with `?checkout=success`.
6. Within ~5 seconds, the app should re-fetch subscription state and remove free-tier limits.
7. Verify in Supabase: `select * from user_subscriptions where user_id = ...` shows `status='active'`.

---

## 7. Customer Portal (subscription management)

Stripe Dashboard → **Settings** → **Billing** → **Customer Portal** → enable.

Configure what users can do (cancel, update payment method, see invoices). Stripe gives you a public Customer Portal URL — drop it into `frontend/.env.local`:

```
VITE_STRIPE_CUSTOMER_PORTAL=https://billing.stripe.com/p/login/xxx
```

The "Manage subscription" entry in the account menu navigates to this URL when set.

---

## Troubleshooting

- **Webhook returns 400** — the signing secret is wrong. Re-copy from Stripe Dashboard → Webhooks → endpoint → Reveal.
- **Webhook returns 200 but user_subscriptions doesn't update** — the Customer object doesn't have `user_id` in metadata. Either pass it via `client_reference_id` on the Payment Link, or update the Customer's metadata after first payment.
- **User stuck on free tier after payment** — refresh the app. The frontend listens for `?checkout=success` to re-fetch; if the redirect URL is wrong, the refresh never fires.

---

## Production checklist

- [ ] Live Stripe key (`sk_live_*`) in `STRIPE_SECRET_KEY`, NOT test mode
- [ ] Live webhook endpoint configured against the live key
- [ ] Live Payment Links (Stripe shows a "Test mode" toggle when creating)
- [ ] `VITE_STRIPE_LINK_*` env vars updated for production deploy
- [ ] Customer Portal enabled
- [ ] Tax handling reviewed (Stripe Tax automatically? regional rules?)
- [ ] Invoice email branding configured in Stripe
