-- Projects — Claude-Code-style workspaces for organizing research.
--
-- A project is a renameable container where a user collects the
-- saved searches, pinned listings, notes, and files related to one
-- property-hunt objective ("2026 Ozark scouting", "Retirement
-- backup", "Investment shortlist"). Items move between projects,
-- files inside projects feed AI queries as context.
--
-- This migration lays down the core three tables. project_files
-- (Supabase Storage + extracted text for AI context) ships in a
-- later migration once the base workflow is proven.
--
-- Design principles:
--   * projects own items; deleting a project cascades to its items.
--   * project_items is polymorphic — one join table for saved
--     searches, listings, notes, file refs — so moving an item
--     between projects is a single UPDATE. Adding new item_types
--     doesn't need a new join table.
--   * Status is a free-form text with a check constraint so we can
--     add new statuses ('contacted', 'visited', etc.) without a
--     migration.
--   * sort_order is a bigint for future drag-drop reordering without
--     a renumbering batch job.

-- ── projects ──────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  description text,
  status      text        not null default 'scouting'
              check (status in ('scouting', 'shortlisted', 'offered',
                                'closed', 'archived')),
  sort_order  bigint      not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_idx
  on public.projects (user_id, sort_order, updated_at desc);

alter table public.projects enable row level security;

create policy "users read own projects"
  on public.projects for select using (auth.uid() = user_id);
create policy "users insert own projects"
  on public.projects for insert with check (auth.uid() = user_id);
create policy "users update own projects"
  on public.projects for update using (auth.uid() = user_id);
create policy "users delete own projects"
  on public.projects for delete using (auth.uid() = user_id);

create or replace function public.touch_projects_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_projects_updated_at();

-- ── project_items (polymorphic join) ──────────────────────────────
-- item_type drives interpretation of item_id:
--   'saved_search' → references saved_searches.id (uuid)
--   'listing'      → references a property id in listings.json (text)
--   'note'         → references project_notes.id (uuid) — to be added
--   'file'         → references project_files.id (uuid) — to be added
-- We don't create FK constraints because listing_id points to a json
-- row, not a SQL table. RLS + check constraint enforce validity
-- instead.
create table if not exists public.project_items (
  id          uuid        not null default gen_random_uuid() primary key,
  project_id  uuid        not null references public.projects(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  item_type   text        not null
              check (item_type in ('saved_search', 'listing', 'note', 'file')),
  item_id     text        not null,
  sort_order  bigint      not null default 0,
  notes       text,
  added_at    timestamptz not null default now()
);

create unique index if not exists project_items_unique_idx
  on public.project_items (project_id, item_type, item_id);
create index if not exists project_items_user_idx
  on public.project_items (user_id, project_id, sort_order);

alter table public.project_items enable row level security;

create policy "users read own project items"
  on public.project_items for select using (auth.uid() = user_id);
create policy "users insert own project items"
  on public.project_items for insert with check (auth.uid() = user_id);
create policy "users update own project items"
  on public.project_items for update using (auth.uid() = user_id);
create policy "users delete own project items"
  on public.project_items for delete using (auth.uid() = user_id);

-- ── project_notes ─────────────────────────────────────────────────
-- Freeform markdown notes attached to a project. v1 is a single
-- textarea per project; v2 might allow multiple notes which is why
-- we model this as a separate table rather than a column on projects.
create table if not exists public.project_notes (
  id          uuid        not null default gen_random_uuid() primary key,
  project_id  uuid        not null references public.projects(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  body_md     text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists project_notes_project_idx
  on public.project_notes (project_id, updated_at desc);

alter table public.project_notes enable row level security;

create policy "users read own project notes"
  on public.project_notes for select using (auth.uid() = user_id);
create policy "users insert own project notes"
  on public.project_notes for insert with check (auth.uid() = user_id);
create policy "users update own project notes"
  on public.project_notes for update using (auth.uid() = user_id);
create policy "users delete own project notes"
  on public.project_notes for delete using (auth.uid() = user_id);

create or replace function public.touch_project_notes_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists project_notes_touch on public.project_notes;
create trigger project_notes_touch
  before update on public.project_notes
  for each row execute function public.touch_project_notes_updated_at();
