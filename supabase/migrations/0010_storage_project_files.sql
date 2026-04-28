-- Storage RLS policies for the `project-files` bucket.
--
-- The bucket itself can't be created via SQL — Supabase requires
-- it via the Dashboard or the Management API (operator step). These
-- policies become active the moment the bucket exists; running this
-- migration before the bucket is fine, the policies just sit idle
-- until objects start showing up.
--
-- Path scheme enforced by these policies: the first folder segment
-- of every object key MUST be the owning user's UUID. The frontend
-- uploader (frontend/src/lib/api.ts) already writes paths in this
-- shape — `{user_id}/{project_id}/{timestamp}-{filename}` — so the
-- policy is non-disruptive.
--
-- Read/insert/delete are allowed for the owner. Updates are
-- intentionally NOT permitted by users — only the service-role
-- worker that populates `project_files.extracted_text` should
-- modify objects.

-- Idempotent: drop-if-exists then create. Re-running this migration
-- is safe and is in fact the expected fix-up path when the policy
-- bodies need to evolve.

drop policy if exists "users read own project files in storage"
  on storage.objects;
drop policy if exists "users upload to own folder in project files"
  on storage.objects;
drop policy if exists "users delete own project files in storage"
  on storage.objects;

create policy "users read own project files in storage"
  on storage.objects for select
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users upload to own folder in project files"
  on storage.objects for insert
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete own project files in storage"
  on storage.objects for delete
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
