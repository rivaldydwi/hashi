-- ============================================================================
-- Hashi — catatan TSK: siapa boleh mengubah
--
-- Variabel sesi baru: app.user_id (user yang login; diisi withTenant()).
-- Kosong/tidak dikenal = tidak dianggap penulis siapa pun.
--
-- Mengubah catatan (isi DAN visibility): hanya PENULISNYA (author_id = app.user_id) atau
-- TSK_ADMIN, di organisasi TSK yang sama. Staf TSK tidak bisa mengubah catatan rekannya.
-- Membuat catatan: author_id wajib = user yang login (penulis tidak bisa dipalsukan).
-- Membaca tetap: semua peran TSK di organisasi yang sama. Tidak ada DELETE untuk siapa pun.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
DROP POLICY candidate_notes_insert ON candidate_notes;
--> statement-breakpoint
CREATE POLICY candidate_notes_insert ON candidate_notes FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (
      app_role_is_tsk()
      AND tsk_org_id = app_current_org()
      AND author_id = app_current_user()
      AND candidate_visible(candidate_id)
    )
  );
--> statement-breakpoint
DROP POLICY candidate_notes_update ON candidate_notes;
--> statement-breakpoint
CREATE POLICY candidate_notes_update ON candidate_notes FOR UPDATE
  USING (
    app_bypass_rls()
    OR (
      app_role_is_tsk()
      AND tsk_org_id = app_current_org()
      AND candidate_visible(candidate_id)
      AND (author_id = app_current_user() OR app_current_role() = 'TSK_ADMIN')
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR (
      app_role_is_tsk()
      AND tsk_org_id = app_current_org()
      AND candidate_visible(candidate_id)
      AND (author_id = app_current_user() OR app_current_role() = 'TSK_ADMIN')
    )
  );
