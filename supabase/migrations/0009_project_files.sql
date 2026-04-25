-- Project files — uploads attached to a project (inspection PDFs,
-- spreadsheets, photos, owner-finance term sheets).
--
-- Storage layer: actual file bytes live in Supabase Storage under
-- the `project-files` bucket; this table tracks metadata + ownership
-- + extracted text for AI context.
--
-- v1 scope (this migration):
--   - Schema only. Bucket creation + RLS policies on storage are
--     done via Supabase Dashboard (one-time operator setup).
--   - extracted_text column ready but populated lazily by a future
--     server-side worker (PDF → pdfplumber, DOCX → python-docx,
--     spreadsheets → pandas, images → Claude Vision alt-text).
--   - No project_file_chunks / pgvector yet — that's v2 once a
--     project's combined file text exceeds ~50K tokens.
--
-- Row hard-cap: ~10 MB per file (enforced at upload time, not in
-- schema). Bucket-level quota: 1GB free tier on Supabase, plenty for
-- a single user with a few projects.

create table if not exists public.project_files (
  id              uuid         not null default gen_random_uuid() primary key,
  project_id      uuid         not null references public.projects(id) on delete cascade,
  user_id         uuid         not null references auth.users(id) on delete cascade,
  filename        text         not null,
  size_bytes      bigint       not null check (size_bytes >= 0),
  content_type    text,
  storage_path    text         not null,
  -- Plain-text extraction populated by a server worker. NULL means
  -- "not yet processed" (frontend can render a "Processing…" state).
  extracted_text  text,
  text_hash       text,
  created_at      timestamptz  not null default now()
);

create index if not exists project_files_project_idx
  on public.project_files (project_id, created_at desc);
create index if not exists project_files_user_idx
  on public.project_files (user_id, created_at desc);

alter table public.project_files enable row level security;

create policy "users read own project files"
  on public.project_files for select
  using (auth.uid() = user_id);

create policy "users insert own project files"
  on public.project_files for insert
  with check (auth.uid() = user_id);

create policy "users delete own project files"
  on public.project_files for delete
  using (auth.uid() = user_id);

-- Update only allowed for the worker (service role). End users
-- shouldn't edit extracted_text directly.
