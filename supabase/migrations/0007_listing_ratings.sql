-- Per-user 5-point rating per listing.
--
-- Distinct from saved_listings (bookmark) and hidden_listings
-- (banish). Rating is preference-tuning signal that doesn't commit
-- to action: a user can LOVE a listing that's out of budget, or
-- DISLIKE one without wanting it banished.
--
-- Rating ∈ {-2, -1, 0, 1, 2}:
--    2 = 🔥 Love     (training weight +1.0)
--    1 = 👍 Like     (training weight +0.5)
--    0 = 😐 Meh / cleared (treated as no signal)
--   -1 = 👎 Dislike  (training weight -0.5)
--   -2 = 🚫 Hate     (training weight -1.0)
--
-- We store cleared-to-Meh as a deleted row rather than rating=0 to
-- keep the table compact. The frontend treats absent == Meh.
--
-- Stacks with save/hide for the personalization model:
--   saved + Loved   = +2.0 strongest positive
--   hidden + Hated  = -2.0 strongest negative

create table if not exists public.listing_ratings (
  user_id      uuid         not null references auth.users(id) on delete cascade,
  listing_id   text         not null,
  rating       smallint     not null check (rating in (-2, -1, 1, 2)),
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists listing_ratings_user_idx
  on public.listing_ratings (user_id, updated_at desc);

alter table public.listing_ratings enable row level security;

create policy "users read own ratings"
  on public.listing_ratings for select
  using (auth.uid() = user_id);

create policy "users insert own ratings"
  on public.listing_ratings for insert
  with check (auth.uid() = user_id);

create policy "users update own ratings"
  on public.listing_ratings for update
  using (auth.uid() = user_id);

create policy "users delete own ratings"
  on public.listing_ratings for delete
  using (auth.uid() = user_id);

create or replace function public.touch_listing_ratings_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists listing_ratings_touch on public.listing_ratings;
create trigger listing_ratings_touch
  before update on public.listing_ratings
  for each row execute function public.touch_listing_ratings_updated_at();
