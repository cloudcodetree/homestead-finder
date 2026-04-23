-- Saved searches — named filter presets with email-alert cadence.
--
-- Each row captures a filter snapshot the user wants to be notified
-- about when NEW matching listings appear in a future scrape. The
-- alerts worker (scraper/alerts.py) reads this table nightly, runs
-- every active search against the current corpus, and emails the
-- user if any listings match that weren't in the last-notified set.
--
-- Schema choices:
--   - `id` is a uuid PK so we can reference one saved search from a
--     URL / email link without exposing user_id.
--   - `filters` stored as jsonb so the frontend can roundtrip the
--     whole Filters object it already owns — no column-per-filter to
--     maintain when we add new dimensions.
--   - `last_notified_at` resets when the user edits the search. The
--     alerts worker treats null as "never notified, include all
--     current matches" but clamps payloads to 25 results to avoid
--     overwhelming a freshly-enabled search.
--   - `last_notified_ids` is a jsonb array of listing ids we've
--     already emailed; alerts.py sends only new ids. Capped at 1000
--     entries per search (old ids drop off FIFO) so the column
--     doesn't grow unbounded.
--   - `notify_cadence` is text, not enum, so we can add "weekly",
--     "monthly" without another migration.

create table if not exists public.saved_searches (
  id                 uuid         not null default gen_random_uuid() primary key,
  user_id            uuid         not null references auth.users(id) on delete cascade,
  name               text         not null,
  filters            jsonb        not null,
  notify_cadence     text         not null default 'daily'
                     check (notify_cadence in ('none', 'daily', 'weekly')),
  last_notified_at   timestamptz,
  last_notified_ids  jsonb        not null default '[]'::jsonb,
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

create index if not exists saved_searches_user_idx
  on public.saved_searches (user_id, updated_at desc);

-- Worker needs a cross-user read for the nightly alert job. This
-- index lets it pull active (cadence != 'none') searches cheaply
-- without scanning the whole table.
create index if not exists saved_searches_active_idx
  on public.saved_searches (notify_cadence) where notify_cadence <> 'none';

alter table public.saved_searches enable row level security;

-- One user sees only their own searches.
create policy "users read own saved searches"
  on public.saved_searches for select
  using (auth.uid() = user_id);

create policy "users insert own saved searches"
  on public.saved_searches for insert
  with check (auth.uid() = user_id);

create policy "users update own saved searches"
  on public.saved_searches for update
  using (auth.uid() = user_id);

create policy "users delete own saved searches"
  on public.saved_searches for delete
  using (auth.uid() = user_id);

-- Keep updated_at honest.
create or replace function public.touch_saved_searches_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists saved_searches_touch on public.saved_searches;
create trigger saved_searches_touch
  before update on public.saved_searches
  for each row execute function public.touch_saved_searches_updated_at();
