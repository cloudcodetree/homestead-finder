# Supabase operator runbook — end to end

Single source of truth for the operator setup. Replaces the
fragmented instructions in `PROJECT_FILES_SETUP.md` and
`STRIPE_SETUP.md`. Run these in order; they're idempotent so
re-running anything is safe.

Total time: ~30 min if you have the Supabase + Stripe accounts
already created.

---

## What's already in the repo

- 10 SQL migrations (`supabase/migrations/0001…0010.sql`) covering
  saved_listings, saved_searches, ranking_weights, hidden_listings,
  user_preferences, projects, listing_ratings, subscriptions,
  project_files, and Storage RLS for project-files.
- The Stripe webhook function (`supabase/functions/stripe-webhook/index.ts`).
- A deploy script (`scripts/deploy-stripe-webhook.sh`).

What you have to do is wire those into your Supabase project.

---

## 1. Apply the SQL migrations (one-time, ~5 min)

If you've been running migrations via the Supabase Dashboard's SQL
editor (which is how migrations 0001–0009 likely landed), do the
same with the new one:

1. Supabase Dashboard → **SQL Editor** → **New query**
2. Paste the contents of `supabase/migrations/0010_storage_project_files.sql`
3. Run

The script is idempotent (drops policies before recreating), so
running it twice is fine.

> Optional but cleaner long-term: install the supabase CLI
> (`brew install supabase/tap/supabase`), `supabase login`,
> `supabase link --project-ref <ref>`, then
> `supabase db push` runs every pending migration in `supabase/migrations/`
> against your remote project automatically.

---

## 2. Create the Storage bucket (one-time, ~2 min)

The bucket itself can't be created via SQL — it's a Supabase
Dashboard click. The RLS policies from step 1 are already waiting
for it.

1. Supabase Dashboard → **Storage** → **New bucket**
2. Name: `project-files` (exactly — the migration's policies
   reference this string)
3. **Public bucket: NO** — files are user-owned.
4. **File size limit: 10 MB** — matches the `MAX_FILE_BYTES`
   constant on the frontend.
5. Allowed MIME types: leave open (or restrict to
   `application/pdf,image/*,application/vnd.openxmlformats-officedocument.*`).
6. Save.

**Verify:** in the app, open any project → Files tab → upload a
small PDF. The row should appear; downloading should return a
60-second signed URL. Object should be visible in
`Storage → project-files → {your-user-id}/…`.

---

## 3. Deploy the Stripe webhook Edge Function (one-time, ~10 min)

Without this, payments succeed but your app doesn't know. Two
parts: the deploy, then the Stripe-side subscription.

### 3a. Install the supabase CLI

```bash
brew install supabase/tap/supabase
supabase login                # opens browser
supabase link --project-ref <PROJECT_REF>
```

`PROJECT_REF` is the ID in your Supabase dashboard URL — looks
like `xyzzyqwerty1234`. Settings → General → Reference ID.

### 3b. Gather six secrets

| Variable | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → "Secret key" (starts `sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → click the endpoint after step 3d → "Signing secret" (starts `whsec_…`) |
| `STRIPE_PRICE_MONTHLY` | Stripe → Product catalog → Monthly product → the `price_…` ID |
| `STRIPE_PRICE_ANNUAL` | Stripe → Product catalog → Annual product → the `price_…` ID |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API → **API keys 2.0** → secret key (`sb_secret_…`). The legacy `service_role` JWT works as a fallback for projects still on JWT-based keys, but new projects should use the scoped secret keys. |

Treat `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`SUPABASE_SERVICE_ROLE_KEY` like database passwords — anyone with
them can move money or read every user's data.

### 3c. Run the deploy script

```bash
export STRIPE_SECRET_KEY=sk_live_...
export STRIPE_WEBHOOK_SECRET=whsec_...     # leave blank for now if you haven't run 3d yet
export STRIPE_PRICE_MONTHLY=price_...
export STRIPE_PRICE_ANNUAL=price_...
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

./scripts/deploy-stripe-webhook.sh
```

Output ends with the function URL — copy it. Looks like:

```
https://<ref>.supabase.co/functions/v1/stripe-webhook
```

> If you don't have `STRIPE_WEBHOOK_SECRET` yet (Stripe only gives
> it to you AFTER you create the endpoint), set it to a placeholder
> for the first deploy, then re-run this script after step 3d
> with the real value. The function will reject signatures with
> the placeholder, so the rerun matters.

### 3d. Subscribe Stripe to the webhook URL

1. Stripe Dashboard → **Developers → Webhooks → + Add endpoint**
2. **Endpoint URL** → paste the function URL from 3c
3. **Events to send** → add these four:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. **Add endpoint**
5. On the resulting page, **Reveal signing secret** → copy it
6. Re-run `./scripts/deploy-stripe-webhook.sh` with the real
   `STRIPE_WEBHOOK_SECRET`

### 3e. Test the webhook

Stripe Dashboard → Webhooks → click your endpoint → **Send test webhook**
→ choose `customer.subscription.created`. Within seconds:

- The endpoint logs should show a `200` response
- Supabase → Edge Functions → `stripe-webhook` → Logs should show "OK"

If you get `400 Bad signature`, the `STRIPE_WEBHOOK_SECRET` you
deployed doesn't match the one Stripe is signing with — re-export
and re-run the script.

---

## 4. Wire user_id into Stripe Customers (~5 min)

The webhook can't write to your users table without knowing which
user is which Stripe customer. Two paths:

**Path A (Payment Links — simplest, what you've already set up).**
Edit each Payment Link → **More options** → set
`client_reference_id` to a templated value the app can stamp at
click time. Today the app sends the user UUID via the URL param
the Payment Link supports.

In `frontend/src/components/UpgradeModal.tsx` (search for the
`<a href={monthlyHref || '#'}` line), change the link target so it
appends `?client_reference_id={userId}`:

```tsx
const stripeUrl = (base: string, user: User | null) =>
  user ? `${base}?client_reference_id=${user.id}` : base;
```

The `customer.subscription.created` webhook will then receive a
`client_reference_id` field — the function uses it to look up the
user, then writes that user's id to the customer's metadata so
subsequent events (renewal, cancel) can find them too.

**Path B (Checkout Session API — used by paid tier of Stripe SDK).**
Set `metadata.user_id` when creating the session. We don't use
this path today.

---

## 5. (Optional) Cron the file-extraction worker

`scraper/project_files_extract.py` populates `extracted_text` on
uploaded files. Without it, the in-project AI chat tab works but
doesn't see file contents. Pick one:

**Local cron (simplest if you scrape locally):**
```cron
*/15 * * * * cd ~/Development/homestead-finder/scraper && /usr/bin/python3 -m project_files_extract >> ~/.hf-extract.log 2>&1
```

**GitHub Actions (defer until launch):** copy the pattern from
`.github/workflows/scrape.yml` into a new `extract.yml`. Needs
`SUPABASE_SERVICE_ROLE_KEY` in repo secrets.

---

## Verifying everything works end-to-end

1. Sign in as a fresh test user
2. Save 5 listings → 6th save opens the upgrade modal
3. Click Monthly → Stripe Checkout opens
4. Pay with `4242 4242 4242 4242`, any future expiry, any CVC
5. Redirected back to `/?checkout=success`
6. Within ~3 seconds, the avatar menu's "Upgrade" item should
   change to "Manage subscription" — that's the webhook firing
7. Click "Manage subscription" → Stripe Customer Portal opens
8. Cancel → return to app → 6th save attempt is blocked again
   on the next refresh (subscription state propagates via the
   `customer.subscription.deleted` event)

If step 6 doesn't happen within ~10 seconds, the webhook isn't
delivering. Stripe → Webhooks → your endpoint → "Webhook attempts"
will show the last 30 deliveries with response codes — debug from
there.

---

## What still requires manual clicks (not automatable)

- Creating the Storage bucket (Supabase Dashboard click)
- Stripe account verification for live mode (Stripe identity check)
- Creating the Stripe webhook endpoint (Stripe Dashboard click)
- Pasting `whsec_…` after Stripe reveals it (it's only shown once
  via the Reveal button; can't be retrieved via API)

Everything else lives in the repo and can be replayed.
