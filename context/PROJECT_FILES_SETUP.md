# Project Files — Storage Setup

One-time operator action to enable the Files tab on `/project/:id`.
Migration `0009_project_files.sql` is already applied; this hooks up
the matching Supabase Storage bucket so users can actually upload.

## 1. Create the bucket

Supabase Dashboard → **Storage** → **New bucket**.

- Name: `project-files`
- Public bucket: **NO** (private — files are user-owned)
- File size limit: 10 MB (matches the `MAX_FILE_BYTES` constant in `frontend/src/lib/api.ts`)
- Allowed MIME types: leave open or restrict to your preference (PDF / image / docx / xlsx are the practical set)

## 2. Add Storage RLS policies

Storage uses its own RLS table (`storage.objects`). Run this in the SQL Editor:

```sql
-- Read your own files
create policy "users read own project files in storage"
  on storage.objects for select
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Insert files into your own folder only
create policy "users upload to own folder in project files"
  on storage.objects for insert
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete your own files
create policy "users delete own project files in storage"
  on storage.objects for delete
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

The path scheme the frontend uses is `{user_id}/{project_id}/{timestamp}-{filename}` so the first folder segment is always the owning user's UUID. The RLS policy uses `storage.foldername(name)[1]` (Postgres array, 1-indexed) to enforce that.

## 3. Test

In the app:

1. Open any project (`/project/{id}`).
2. Click the **Files** tab.
3. **+ Upload file** → pick a small PDF or image.
4. The file appears in the list with size + type. Click **Download** to get a 60-second signed URL.
5. Verify in Supabase: `select * from project_files` shows the row, and the Storage browser shows the blob under `project-files/{your-user-id}/{project-id}/`.
6. Click **Delete** — both the row AND the blob disappear.

## 4. What's NOT done yet (next increment)

- **Text extraction** for AI context. The `extracted_text` column is in the schema and the frontend reads it (renders nothing yet), but no worker populates it. Two implementation paths:

  - **Server-side worker** (Python): on each `project_files` insert, a Postgres trigger or scheduled job invokes a script that downloads the blob, runs `pdfplumber` (PDFs) / `python-docx` (DOCX) / `pandas` (xlsx) / Claude Vision (images), and writes the result back to `extracted_text`. Service role key required.

  - **Client-side extraction** for plain text + small files only. Browser can `await file.text()` for `text/*` content types. Faster, no server needed, but doesn't handle the formats users actually upload (PDF, DOCX).

- **AI-context integration**. Once `extracted_text` is populated, the AskClaude prompt assembly inside a project context concatenates the project's files into the system prompt. See vision item #3 in `context/BACKLOG.md`.
