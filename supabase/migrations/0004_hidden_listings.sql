-- Hidden listings — per-user "not interested" marks.
--
-- Mirror of saved_listings (same shape, same PK strategy, same RLS
-- policies). Serves two purposes:
--
--   1. UX: users can dismiss listings they're not interested in so
--      their feed stays signal-dense. Hidden rows disappear from
--      the default list view; a toggle un-hides them.
--   2. ML: explicit negative signal for rank_fit.py. The personalization
--      worker previously sampled random unsaved listings as negatives,
--      which was noisy (user might love them, just hasn't seen them).
--      Real hides are clean negatives and sharpen the fitted model.
--
-- A listing can be in BOTH saved_listings AND hidden_listings for
-- the same user — we let the frontend decide precedence (saved wins).
-- Keeping them separate tables avoids a state-machine column that'd
-- need flipping on every toggle.

create table if not exists public.hidden_listings (
  user_id    uuid         not null references auth.users(id) on delete cascade,
  listing_id text         not null,
  hidden_at  timestamptz  not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists hidden_listings_user_idx
  on public.hidden_listings (user_id, hidden_at desc);

alter table public.hidden_listings enable row level security;

create policy "users read own hidden listings"
  on public.hidden_listings for select
  using (auth.uid() = user_id);

create policy "users insert own hidden listings"
  on public.hidden_listings for insert
  with check (auth.uid() = user_id);

create policy "users delete own hidden listings"
  on public.hidden_listings for delete
  using (auth.uid() = user_id);
