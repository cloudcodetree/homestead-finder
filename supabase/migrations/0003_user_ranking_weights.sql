-- Per-user personalization weights for the "Recommended for you" sort.
--
-- rank_fit.py fits a logistic regression against each user's save
-- events (positive) vs a random sample of unsaved listings
-- (negatives). The fitted model lives in this table as a jsonb blob
-- with the feature→weight mapping. Frontend pulls the row once per
-- session and computes a personalization score locally when the user
-- selects the "Recommended" sort.
--
-- Schema is intentionally minimal:
--   * one row per user (PK on user_id)
--   * `weights` is jsonb so we can add/remove features without
--     migrations. Shape: `{bias: float, weight_key: float, ...}`.
--   * `num_examples` records how many training points we had so the
--     frontend can decide whether to trust the model (<10 → hide
--     the Recommended sort option).
--   * `fitted_at` lets the worker skip users whose model is already
--     fresh (within N hours of the last fit).
--
-- RLS: users can read their own row. Only the worker (service-role
-- key, bypasses RLS) writes.

create table if not exists public.user_ranking_weights (
  user_id       uuid         not null references auth.users(id) on delete cascade primary key,
  weights       jsonb        not null default '{}'::jsonb,
  num_examples  int          not null default 0,
  fitted_at     timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

alter table public.user_ranking_weights enable row level security;

create policy "users read own ranking weights"
  on public.user_ranking_weights for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for end users — the worker runs
-- with the service role key which bypasses RLS. This prevents clients
-- from spoofing their own weights.
