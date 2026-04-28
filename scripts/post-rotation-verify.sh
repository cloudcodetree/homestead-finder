#!/usr/bin/env bash
# Verify that a leaked key is actually dead after rotation, and
# that the new keys work. Run this once after rolling secrets in
# the Stripe + Supabase dashboards.
#
# Usage:
#   OLD_STRIPE=sk_live_xxxx OLD_SUPABASE=eyJxxxx ./scripts/post-rotation-verify.sh
#
# Reads NEW values from .env.deploy (or the current shell env if
# .env.deploy isn't present).

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env.deploy ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.deploy
  set +a
fi

fail=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }

# --- 1. Old Stripe key should now 401 ---------------------------------
if [[ -n "${OLD_STRIPE:-}" ]]; then
  echo "Checking that the OLD Stripe key is dead…"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${OLD_STRIPE}:" https://api.stripe.com/v1/account || echo 000)
  if [[ "$status" == "401" ]]; then
    ok "old Stripe key returns 401 (rotation took effect)"
  else
    bad "old Stripe key returned HTTP $status — expected 401. Re-roll the key."
  fi
fi

# --- 2. New Stripe key should 200 -------------------------------------
if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "Checking that the NEW Stripe key works…"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${STRIPE_SECRET_KEY}:" https://api.stripe.com/v1/account || echo 000)
  if [[ "$status" == "200" ]]; then
    ok "new Stripe key returns 200"
  else
    bad "new Stripe key returned HTTP $status — paste likely incomplete."
  fi
fi

# --- 3. Old Supabase key should 401 -----------------------------------
# Works for either legacy service_role JWT or new sb_secret_… — the
# REST endpoint rejects both with 401 once revoked.
if [[ -n "${OLD_SUPABASE:-}" && -n "${SUPABASE_URL:-}" ]]; then
  echo "Checking that the OLD Supabase key is dead…"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: ${OLD_SUPABASE}" \
    -H "Authorization: Bearer ${OLD_SUPABASE}" \
    "${SUPABASE_URL}/rest/v1/" || echo 000)
  if [[ "$status" == "401" ]]; then
    ok "old Supabase key returns 401 (rotation took effect)"
  else
    bad "old Supabase key returned HTTP $status — expected 401."
  fi
fi

# --- 4. New Supabase key should 200 -----------------------------------
# Prefer the new `SUPABASE_SECRET_KEY` (sb_secret_…); fall back to the
# legacy service_role JWT only if API Keys 2.0 isn't set up yet.
NEW_SUPABASE_KEY="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
if [[ -n "${NEW_SUPABASE_KEY}" && -n "${SUPABASE_URL:-}" ]]; then
  echo "Checking that the NEW Supabase key works…"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: ${NEW_SUPABASE_KEY}" \
    -H "Authorization: Bearer ${NEW_SUPABASE_KEY}" \
    "${SUPABASE_URL}/rest/v1/" || echo 000)
  if [[ "$status" == "200" ]]; then
    ok "new Supabase key returns 200"
  else
    bad "new Supabase key returned HTTP $status — paste likely incomplete."
  fi
fi

# --- 5. .env.local should NOT contain server-only secrets -------------
if [[ -f frontend/.env.local ]]; then
  echo "Checking frontend/.env.local for stray server secrets…"
  if grep -qE '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PRICE_|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)' frontend/.env.local; then
    bad "frontend/.env.local contains server-only secrets — move them to .env.deploy."
  else
    ok "frontend/.env.local contains only VITE_* values"
  fi
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "✓ rotation verified clean."
  exit 0
fi
echo "✗ rotation NOT clean — fix the items above before continuing."
exit 1
