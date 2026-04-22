-- Saved listings — per-user bookmarks of Property ids.
--
-- Schema deliberately minimal for the MVP:
--   - (user_id, listing_id) is the primary key → one bookmark per
--     user per listing, natural idempotency on re-save.
--   - `listing_id` is text (not FK) because the canonical listing
--     store is still the committed listings.json file — parcels can
--     appear / disappear day to day, and we don't want a FK constraint
--     to fire cascade deletes just because yesterday's scrape dropped
--     a row. Orphaned bookmarks are fine; UI shows them as "Listing
--     no longer in current corpus" if the ID isn't in the loaded data.
--   - `note` is reserved for a future "private notes" feature; keep
--     nullable so we don't need another migration when we add it.
--
-- Row-Level Security policies enforce per-user isolation: every read
-- and write has `auth.uid() = user_id` as the only permission gate.
-- Without these policies the anon key would be able to list every
-- user's bookmarks, which is exactly the opposite of what we want.

create table if not exists public.saved_listings (
  user_id    uuid         not null references auth.users(id) on delete cascade,
  listing_id text         not null,
  note       text,
  saved_at   timestamptz  not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists saved_listings_user_idx
  on public.saved_listings (user_id, saved_at desc);

alter table public.saved_listings enable row level security;

-- Explicit policies per operation — Supabase best practice is one
-- policy per (select/insert/update/delete) so you can loosen / tighten
-- each independently without touching the others.

drop policy if exists "saved_listings: read own"   on public.saved_listings;
drop policy if exists "saved_listings: insert own" on public.saved_listings;
drop policy if exists "saved_listings: update own" on public.saved_listings;
drop policy if exists "saved_listings: delete own" on public.saved_listings;

create policy "saved_listings: read own"
  on public.saved_listings for select
  using (auth.uid() = user_id);

create policy "saved_listings: insert own"
  on public.saved_listings for insert
  with check (auth.uid() = user_id);

create policy "saved_listings: update own"
  on public.saved_listings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "saved_listings: delete own"
  on public.saved_listings for delete
  using (auth.uid() = user_id);
