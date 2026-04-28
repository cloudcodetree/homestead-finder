#!/usr/bin/env bash
# Deploy the Stripe webhook Edge Function and set its secrets.
#
# Prereqs (do these once, before running this script):
#   1. brew install supabase/tap/supabase   (or per-platform install)
#   2. supabase login                       (opens browser)
#   3. supabase link --project-ref <ref>    (find ref in Supabase dashboard URL)
#
# After those: paste your secrets into the env-vars block below
# (or export them in your shell first), then run this script.
#
# Idempotent — running twice just re-deploys the function and
# re-sets the secrets to whatever's in your env.

set -euo pipefail

cd "$(dirname "$0")/.."

# Auto-source .env.deploy if present. Keeps secrets out of the
# shell history + out of frontend/.env.local. The file is gitignored
# (see .gitignore) and there's a checked-in .env.deploy.example with
# the schema. Skipped when the operator has already exported the
# values manually.
if [[ -f .env.deploy ]]; then
  echo "Sourcing .env.deploy…"
  set -a
  # shellcheck disable=SC1091
  source .env.deploy
  set +a
fi

# --- secrets -----------------------------------------------------------
# Only Stripe-side secrets are set here. The Supabase platform
# auto-injects SUPABASE_URL, SUPABASE_ANON_KEY, and
# SUPABASE_SERVICE_ROLE_KEY into every Edge Function's environment
# at runtime — the CLI rejects manual `secrets set` for those names
# (it errors with "Env name cannot start with SUPABASE_, skipping").
# So we don't try.
#
# Get these from:
#   STRIPE_SECRET_KEY        Stripe Dashboard → Developers → API keys
#   STRIPE_WEBHOOK_SECRET    Stripe Dashboard → Developers → Webhooks → click the endpoint → Reveal signing secret
#   STRIPE_PRICE_MONTHLY     Stripe Dashboard → Product catalog → Monthly product → price_xxx
#   STRIPE_PRICE_ANNUAL      Stripe Dashboard → Product catalog → Annual product → price_xxx
#
# Refuse to run if any are missing; safer than silently deploying a
# broken function.
: "${STRIPE_SECRET_KEY:?missing — see header}"
: "${STRIPE_WEBHOOK_SECRET:?missing — see header}"
: "${STRIPE_PRICE_MONTHLY:?missing — see header}"
: "${STRIPE_PRICE_ANNUAL:?missing — see header}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not on PATH. Install: brew install supabase/tap/supabase"
  exit 1
fi

echo "Setting Edge Function secrets…"
supabase secrets set \
  STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
  STRIPE_PRICE_MONTHLY="$STRIPE_PRICE_MONTHLY" \
  STRIPE_PRICE_ANNUAL="$STRIPE_PRICE_ANNUAL"

echo "Deploying stripe-webhook function…"
# --no-verify-jwt because Stripe webhooks don't carry a JWT; we
# verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET inside.
supabase functions deploy stripe-webhook --no-verify-jwt

# Echo the endpoint URL so the operator can paste it into Stripe's
# webhook UI. Pull the project ref from the linked supabase config
# so we don't depend on an env var.
PROJECT_REF=$(supabase projects list --output json 2>/dev/null \
  | grep -o '"linked":true.*"reference_id":"[^"]*"' \
  | sed -E 's/.*"reference_id":"([^"]*)".*/\1/' \
  | head -n1)

echo
if [[ -n "${PROJECT_REF:-}" ]]; then
  echo "✓ Function deployed. Endpoint URL:"
  echo "  https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook"
else
  echo "✓ Function deployed."
  echo "  Endpoint URL: https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook"
fi
echo
echo "Now: in the Stripe Dashboard → Developers → Webhooks → Add endpoint,"
echo "paste that URL and subscribe to:"
echo "  - customer.subscription.created"
echo "  - customer.subscription.updated"
echo "  - customer.subscription.deleted"
echo "  - invoice.paid"
echo
echo "Then test from the Stripe dashboard: 'Send test webhook' should return 200."
