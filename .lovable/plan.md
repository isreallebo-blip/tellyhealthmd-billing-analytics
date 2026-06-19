## What you'll get

A working upload → review → approve loop where every file is archived immutably, every parsed row links back to its source, low-confidence fields are flagged, you can edit inline, hit **Re-parse** without re-uploading, and **Approve** to promote the data into the live `claims_raw` dashboard. XLSX / XLS / CSV only in this slice.

## User-facing changes

1. **Upload page** — drag-and-drop multi-file, instant Queued status, no synchronous wait. Files go straight to storage, parsing runs in background.
2. **Files list** (`/files`) — every upload, status (Queued → Parsing → Needs Review → Approved / Failed), row counts, who uploaded, link to original download.
3. **Review screen** (`/files/$id`) — side-by-side: left = original file preview (sheet/row viewer for XLSX/CSV), right = parsed rows table. Low-confidence cells highlighted amber, validation failures red. Inline edit any cell. Buttons: **Re-parse**, **Approve**, **Reject**.
4. **Approve** writes the (corrected) rows into `claims_raw` so the existing dashboard keeps working untouched. Re-approve replaces prior version.

## Backend changes

**New storage bucket** `source-files` (private). Originals stored at `{user_id}/{file_id}/{filename}`, never overwritten.

**New tables**
- `source_files` — file_id, user_id, company, filename, mime, size_bytes, storage_path, sha256, status, row_count, error, uploaded_at, approved_at, approved_by. Immutable original reference.
- `parsed_rows` — id, source_file_id, row_index, data (jsonb of mapped fields), confidence (jsonb per-field 0-1 scores), validation_errors (jsonb), source_location (sheet/row), edited (bool), edited_by, version. Staging area before approval.
- `field_definitions` — field_key, label, data_type, validation_regex, synonyms (text[]), active. Seeded with the current claims_raw columns (acct, dos, cpt, pri_ins, prov_name, revenue, etc.) so parsing keeps mapping today's spreadsheet layouts. *Used by registry-driven mapping; no admin UI in this slice — admin can insert rows directly.*
- `parsed_row_edits` — audit log: row_id, field, old, new, edited_by, edited_at.

All tables: RLS scoped to `auth.uid()` + company access via existing `user_has_company_access`; admin override via `has_role`. GRANTs in same migration.

**Edge function `process-upload` rewritten**
- Accepts `{ source_file_id }` only (file already in storage).
- Streams XLSX/CSV from storage in chunks (no full in-memory load).
- Header detection: scans first 10 rows, picks row with most non-empty cells matching any synonym.
- Maps columns → field_definitions via exact match → synonym match → fuzzy (Levenshtein ≤ 2). Stores confidence per column.
- Per-row validation per field_definition rule. Invalid → flagged, not dropped.
- Writes to `parsed_rows`, sets `source_files.status = needs_review`.
- Idempotent: re-parse deletes prior `parsed_rows` for that source_file_id and re-runs.

**New edge function `approve-file`** — copies parsed_rows.data into `claims_raw` (with `source_file_id` FK column added), sets status approved. Re-approve = delete prior claims_raw rows for that file_id, re-insert.

## Technical details

- `claims_raw` gets a nullable `source_file_id uuid` column + index. Existing rows stay (source_file_id null). Dashboard queries unchanged.
- Upload flow: client uploads directly to storage via signed URL → inserts `source_files` row → invokes `process-upload` with the id. This removes the current "send entire parsed JSON to edge function" path that's been 5xx-ing.
- Streaming: use `xlsx`'s stream API and `csv-parse` streaming mode in Deno. Process in 500-row batches with `insert` chunks.
- Confidence: column mapping confidence = 1.0 exact, 0.8 synonym, 0.6 fuzzy. Field validation confidence = 1.0 valid, 0.0 invalid. Cell highlight if confidence < 0.7.
- Realtime: `source_files` added to `supabase_realtime` so the files list updates as parsing progresses. No polling.
- Async: parsing kicked off with `EdgeRuntime.waitUntil` (with the existing fallback). Files >50k rows handled the same way — it just takes longer; status reflects progress.

## Out of scope for this slice (next milestones)

- DOCX / PDF / TXT parsing + OCR
- NER/LLM entity extraction for unstructured text
- Per-source mapping templates
- Dedup detection across files
- Admin UI for field_definitions
- Async export jobs
- Full HIPAA audit log on every view

These are tracked from the roadmap; I'll tackle them in follow-up turns so each slice ships in a reviewable, testable state.

## Migration order

1. Create storage bucket + RLS.
2. Migration: tables, grants, RLS, seed field_definitions, add `source_file_id` to claims_raw, enable realtime.
3. Rewrite `process-upload` + new `approve-file`.
4. Rewrite `/upload` route to use direct-to-storage + new flow.
5. New `/files` and `/files/$id` routes.

Approve and I'll execute in that order.