-- User subscription state — shadows Stripe.
--
-- Stripe is the source of truth for billing; this table is a
-- denormalized cache that the frontend reads without making a Stripe
-- API call on every page load. The Stripe webhook receiver
-- (supabase/functions/stripe-webhook) keeps this in sync as
-- subscriptions are created, updated, canceled.
--
-- Plan tiers:
--   'free'      — anonymous and signed-in-without-payment users
--   'monthly'   — $19/mo
--   'annual'    — $190/yr
-- Status mirrors Stripe's subscription.status field.
--
-- Free-tier users have NO row here (treated as plan='free').
-- Once they subscribe, a row is upserted on (user_id) by the webhook.

create table if not exists public.user_subscriptions (
  user_id              uuid         not null references auth.users(id) on delete cascade primary key,
  stripe_customer_id   text         not null,
  stripe_subscription_id text       not null,
  plan                 text         not null check (plan in ('monthly', 'annual')),
  status               text         not null
                       check (status in (
                         'active', 'trialing', 'past_due', 'canceled',
                         'incomplete', 'incomplete_expired', 'unpaid', 'paused'
                       )),
  current_period_end   timestamptz,
  cancel_at_period_end boolean      not null default false,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now()
);

create index if not exists user_subscriptions_status_idx
  on public.user_subscriptions (status, current_period_end);

alter table public.user_subscriptions enable row level security;

-- User can read their own subscription. Inserts/updates come from
-- the webhook (service role) only — RLS deliberately omits any
-- INSERT/UPDATE policy for end users.
create policy "users read own subscription"
  on public.user_subscriptions for select
  using (auth.uid() = user_id);

create or replace function public.touch_user_subscriptions_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists user_subscriptions_touch on public.user_subscriptions;
create trigger user_subscriptions_touch
  before update on public.user_subscriptions
  for each row execute function public.touch_user_subscriptions_updated_at();
