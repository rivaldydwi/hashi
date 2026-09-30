-- ============================================================================
-- Hashi — Langkah 3 (revisi): hak akses dengan status LPK + keputusan TSK
--
-- Menggantikan aturan TSK dari 0005 (yang berbasis candidates.stage).
--
-- LPK_ADMIN   : baca+tulis semua data kandidat LPK-nya, di semua status. Satu-satunya yang
--               mengisi candidates.stage (STUDYING / READY / WITHDRAWN). Membaca catatan TSK
--               hanya yang visibility = SHARED_WITH_LPK dari TSK dengan kemitraan aktif.
-- LPK_SENSEI  : hanya profil dasar. Boleh MEMBACA keputusan TSK; TIDAK pernah membaca catatan TSK.
-- TSK_ADMIN / TSK_STAFF (kemitraan aktif, kandidat punya data_consent_date):
--   * BACA semua kandidat itu di semua status + data sensitif + dokumen.
--   * TULIS keputusan (candidate_selections) dan catatan (candidate_notes)
--     HANYA milik tsk_org_id-nya sendiri. Status LPK tidak ikut berubah.
--   * EDIT isi data (candidates, candidate_private, dan tabel anak: INSERT/UPDATE)
--     HANYA jika keputusan TSK-nya atas kandidat itu IN (PASSED_CLIENT_INTERVIEW,
--     DOCUMENT_PROCESS, DEPARTED) dan LPK belum menandainya WITHDRAWN.
--     Daftar IN eksplisit, bukan perbandingan urutan enum.
--   * TIDAK bisa menghapus baris apa pun, dan tidak bisa mengubah stage / data_consent_date
--     (satu trigger kecil di bawah: RLS tidak bisa membandingkan nilai lama dan baru).
--
-- Hati-hati rekursi: policy candidates memakai tsk_has_edit_decision() (SECURITY DEFINER)
-- untuk membaca candidate_selections. Tanpa itu, candidates -> candidate_selections ->
-- candidates membuat Postgres menolak dengan "infinite recursion detected in policy".
-- ============================================================================
CREATE OR REPLACE FUNCTION app_role_is_tsk() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF'), false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_role_is_lpk() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_current_role() IN ('LPK_ADMIN', 'LPK_SENSEI'), false)
$$;
--> statement-breakpoint
-- Keputusan TSK yang membuka hak edit isi data. JANGAN diganti dengan perbandingan urutan enum.
CREATE OR REPLACE FUNCTION tsk_editable_decision(d selection_decision) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT d IN ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED')
$$;
--> statement-breakpoint
-- Apakah TSK di sesi ini punya keputusan yang membuka hak edit atas kandidat ini?
-- SECURITY DEFINER (memutus rekursi RLS), tetapi HANYA membaca baris milik organisasi sesi:
-- tsk_org_id = app_current_org().
CREATE OR REPLACE FUNCTION tsk_has_edit_decision(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM candidate_selections s
    WHERE s.candidate_id = cid
      AND s.tsk_org_id = app_current_org()
      AND tsk_editable_decision(s.decision)
  )
$$;
--> statement-breakpoint
-- Kandidat boleh DIUBAH isinya oleh sesi ini?
--   LPK_ADMIN pemilik: kapan pun. TSK mitra aktif: lihat aturan di atas.
CREATE OR REPLACE FUNCTION candidate_editable(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM candidates c
    WHERE c.id = cid
      AND (
        app_bypass_rls()
        OR (c.organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
        OR (
          app_role_is_tsk()
          AND c.stage <> 'WITHDRAWN'
          AND c.data_consent_date IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM partnerships p
            WHERE p.active AND p.lpk_id = c.organization_id AND p.tsk_id = app_current_org()
          )
          AND tsk_has_edit_decision(c.id)
        )
      )
  )
$$;
--> statement-breakpoint
-- Kandidat boleh DIHAPUS (baris anak) oleh sesi ini? Hanya LPK_ADMIN pemilik.
CREATE OR REPLACE FUNCTION candidate_owner_admin(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM candidates c
    WHERE c.id = cid
      AND (
        app_bypass_rls()
        OR (c.organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
      )
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- candidates: TSK boleh UPDATE hanya bila punya keputusan yang membuka hak edit
-- ---------------------------------------------------------------------------
CREATE POLICY candidates_tsk_update ON candidates FOR UPDATE
  USING (
    app_role_is_tsk()
    AND stage <> 'WITHDRAWN'
    AND data_consent_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
    AND tsk_has_edit_decision(candidates.id)
  )
  WITH CHECK (
    app_role_is_tsk()
    AND stage <> 'WITHDRAWN'
    AND data_consent_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
    AND tsk_has_edit_decision(candidates.id)
  );
--> statement-breakpoint
-- Status LPK dan persetujuan data adalah milik LPK. RLS tidak bisa membandingkan nilai lama vs
-- baru, jadi satu trigger kecil menolak TSK yang mengubah kedua kolom itu.
CREATE OR REPLACE FUNCTION enforce_tsk_cannot_change_lpk_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_role_is_tsk()
     AND (NEW.stage IS DISTINCT FROM OLD.stage
          OR NEW.data_consent_date IS DISTINCT FROM OLD.data_consent_date) THEN
    RAISE EXCEPTION 'status kandidat di LPK dan tanggal persetujuan data hanya bisa diubah oleh LPK'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_lpk_fields_guard
  BEFORE UPDATE OF stage, data_consent_date ON candidates
  FOR EACH ROW EXECUTE FUNCTION enforce_tsk_cannot_change_lpk_fields();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tabel anak (candidate_private, dokumen, keluarga, pendidikan, kerja, sertifikat):
-- INSERT/UPDATE mengikuti candidate_editable(); DELETE hanya LPK_ADMIN pemilik.
-- ---------------------------------------------------------------------------
DROP POLICY candidate_educations_delete ON candidate_educations;
--> statement-breakpoint
CREATE POLICY candidate_educations_delete ON candidate_educations FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint
DROP POLICY candidate_work_histories_delete ON candidate_work_histories;
--> statement-breakpoint
CREATE POLICY candidate_work_histories_delete ON candidate_work_histories FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint
DROP POLICY candidate_certificates_delete ON candidate_certificates;
--> statement-breakpoint
CREATE POLICY candidate_certificates_delete ON candidate_certificates FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint
DROP POLICY candidate_private_delete ON candidate_private;
--> statement-breakpoint
CREATE POLICY candidate_private_delete ON candidate_private FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint
DROP POLICY candidate_family_members_delete ON candidate_family_members;
--> statement-breakpoint
CREATE POLICY candidate_family_members_delete ON candidate_family_members FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint
DROP POLICY candidate_documents_delete ON candidate_documents;
--> statement-breakpoint
CREATE POLICY candidate_documents_delete ON candidate_documents FOR DELETE
  USING (candidate_owner_admin(candidate_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- candidate_selections: keputusan TSK. Tidak ada DELETE (keputusan direset dengan NONE).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON candidate_selections TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_selections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_selections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- TSK: baris milik organisasinya sendiri, hanya untuk kandidat yang terlihat olehnya
-- (kemitraan aktif + data_consent_date; candidate_visible mewarisi policy candidates).
-- LPK: keputusan semua TSK atas kandidatnya (candidate_visible = kandidat miliknya).
CREATE POLICY candidate_selections_read ON candidate_selections FOR SELECT
  USING (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
    OR (app_role_is_lpk() AND candidate_visible(candidate_id))
  );
--> statement-breakpoint

CREATE POLICY candidate_selections_insert ON candidate_selections FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  );
--> statement-breakpoint

CREATE POLICY candidate_selections_update ON candidate_selections FOR UPDATE
  USING (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  )
  WITH CHECK (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  );
--> statement-breakpoint

-- Pasangan (kandidat, TSK) tidak boleh dipindah ke kandidat/TSK lain.
CREATE OR REPLACE FUNCTION prevent_selection_key_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.tsk_org_id IS DISTINCT FROM OLD.tsk_org_id THEN
    RAISE EXCEPTION 'keputusan tidak bisa dipindahkan ke kandidat atau TSK lain'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER candidate_selections_keys_immutable
  BEFORE UPDATE OF candidate_id, tsk_org_id ON candidate_selections
  FOR EACH ROW EXECUTE FUNCTION prevent_selection_key_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- candidate_notes: catatan TSK atas kandidat (面談メモ). Tidak ada DELETE untuk siapa pun.
--   Baca : TSK (semua peran TSK di organisasi yang sama) -> catatan milik TSK-nya, untuk kandidat
--          yang terlihat (kemitraan aktif + persetujuan data).
--          LPK_ADMIN pemilik kandidat -> hanya SHARED_WITH_LPK dari TSK yang kemitraannya AKTIF
--          (kemitraan dinonaktifkan = catatan ikut hilang). LPK_SENSEI: tidak pernah.
--   Tulis: hanya TSK dengan tsk_org_id yang sama, untuk kandidat yang terlihat. LPK tidak bisa
--          menulis, mengubah, atau menghapus. Mengubah isi dan visibility: TSK organisasi yang sama.
--   Perubahan visibility dicatat aplikasi di audit_logs (dari, ke, siapa).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON candidate_notes TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY candidate_notes_read ON candidate_notes FOR SELECT
  USING (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
    OR (
      app_current_role() = 'LPK_ADMIN'
      AND visibility = 'SHARED_WITH_LPK'
      AND candidate_visible(candidate_id)
      AND EXISTS (
        SELECT 1 FROM partnerships p
        WHERE p.active AND p.lpk_id = app_current_org() AND p.tsk_id = candidate_notes.tsk_org_id
      )
    )
  );
--> statement-breakpoint
CREATE POLICY candidate_notes_insert ON candidate_notes FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  );
--> statement-breakpoint
CREATE POLICY candidate_notes_update ON candidate_notes FOR UPDATE
  USING (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  )
  WITH CHECK (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
  );
--> statement-breakpoint
-- Catatan tidak boleh dipindah ke kandidat/TSK lain, dan pembuatnya tidak boleh diganti.
CREATE OR REPLACE FUNCTION prevent_note_key_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.tsk_org_id IS DISTINCT FROM OLD.tsk_org_id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'kandidat, TSK, dan penulis catatan tidak bisa diubah'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_notes_keys_immutable
  BEFORE UPDATE OF candidate_id, tsk_org_id, author_id ON candidate_notes
  FOR EACH ROW EXECUTE FUNCTION prevent_note_key_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_logs: siapa pelaku (actor_org_id) dan log tentang kandidat.
--   Baca : organisasi tempat log disimpan (LPK pemilik kandidat melihat semua perubahan
--          kandidatnya, termasuk oleh TSK) ATAU organisasi pelaku (TSK melihat aksinya sendiri).
--   Tulis: hanya atas nama organisasi sendiri (actor_org_id = organisasi sesi). Log disimpan di
--          organisasi lain hanya jika itu LPK pemilik kandidat yang terlihat oleh pelaku.
-- ---------------------------------------------------------------------------
DROP POLICY audit_logs_read ON audit_logs;
--> statement-breakpoint

CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (
    app_bypass_rls()
    OR organization_id = app_current_org()
    OR actor_org_id = app_current_org()
  );
--> statement-breakpoint

DROP POLICY audit_logs_insert ON audit_logs;
--> statement-breakpoint

CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (
      actor_org_id = app_current_org()
      AND (
        organization_id = app_current_org()
        OR (
          candidate_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM candidates c
            WHERE c.id = audit_logs.candidate_id AND c.organization_id = audit_logs.organization_id
          )
        )
      )
    )
  );
