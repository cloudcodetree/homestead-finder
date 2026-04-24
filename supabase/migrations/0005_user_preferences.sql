-- Per-user shopping preferences — explicit profile captured during
-- onboarding. Distinct from user_ranking_weights (which is a fitted
-- model from save/hide events) — preferences are what the user TELLS
-- us they want; weights are what we LEARN they want. Cold-start
-- ranking blends preferences as a prior until enough event data
-- accrues to take over.
--
-- Schema is jsonb-heavy on purpose: the preferences shape will evolve
-- rapidly as we learn what users actually fill in. Additive fields
-- inside the jsonb don't need migrations.
--
-- RLS: users see/write their own row only. One row per user (upsert).

create table if not exists public.user_preferences (
  user_id       uuid         not null references auth.users(id) on delete cascade primary key,
  preferences   jsonb        not null default '{}'::jsonb,
  completed_at  timestamptz,
  updated_at    timestamptz  not null default now()
);

alter table public.user_preferences enable row level security;

create policy "users read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "users insert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "users update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

-- Keep updated_at honest
create or replace function public.touch_user_preferences_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_preferences_touch on public.user_preferences;
create trigger user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.touch_user_preferences_updated_at();
