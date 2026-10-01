-- ============================================================================
-- Hashi — berbagi ke TSK menjadi opsi yang dipegang LPK (menggantikan data_consent_date sebagai gerbang)
--
-- candidates.shared_with_tsk (default false) adalah SATU-SATUNYA gerbang visibilitas bagi TSK:
--   TSK melihat/mengedit kandidat hanya bila  shared_with_tsk = true  DAN  kemitraan aktif.
-- data_consent_date tetap ada tetapi OPSIONAL: hanya catatan tanggal tanda tangan formulir.
-- Hanya LPK_ADMIN yang mengubah kolom shared_with_tsk* (TSK diblokir trigger; sensei tidak punya
-- policy UPDATE). shared_with_tsk_at / _by diisi trigger candidates_share_stamp.
--
-- Objek yang tadinya memakai data_consent_date dan DIGANTI di sini (dicek tuntas oleh verify-rls,
-- yang gagal bila masih ada policy/fungsi/trigger yang menyebut data_consent_date):
--   candidates_partner_read, candidates_tsk_update, candidate_editable(),
--   enforce_tsk_cannot_change_lpk_fields() + trigger candidates_lpk_fields_guard.
-- Tabel anak (candidate_private, keluarga, pendidikan, kerja, sertifikat, dokumen), candidate_selections,
-- candidate_notes (sisi TSK), dan audit_logs mewarisi lewat candidate_visible() / policy candidates,
-- jadi otomatis ikut. candidate_notes_read sisi LPK ditambah syarat shared_with_tsk (pola kemitraan
-- nonaktif: catatan TSK ikut tidak terlihat oleh LPK).
-- Keputusan dan catatan TSK TIDAK dihapus saat opsi dimatikan; hanya tidak terlihat sampai diaktifkan lagi.
-- ============================================================================
ALTER TABLE "candidates" ADD COLUMN "shared_with_tsk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "shared_with_tsk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "shared_with_tsk_by" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_shared_with_tsk_by_users_id_fk" FOREIGN KEY ("shared_with_tsk_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

-- Data lama: kandidat yang tadinya terlihat oleh TSK (tanggal persetujuan terisi) tetap terlihat.
UPDATE candidates SET shared_with_tsk = true, shared_with_tsk_at = now() WHERE data_consent_date IS NOT NULL;
--> statement-breakpoint

-- TSK membaca kandidat LPK mitra yang DIBAGIKAN (semua status)
DROP POLICY candidates_partner_read ON candidates;
--> statement-breakpoint
CREATE POLICY candidates_partner_read ON candidates FOR SELECT
  USING (
    shared_with_tsk
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active
        AND p.lpk_id = candidates.organization_id
        AND p.tsk_id = app_current_org()
    )
  );
--> statement-breakpoint

-- TSK meng-UPDATE hanya kandidat yang dibagikan dan keputusannya membuka hak edit
DROP POLICY candidates_tsk_update ON candidates;
--> statement-breakpoint
CREATE POLICY candidates_tsk_update ON candidates FOR UPDATE
  USING (
    app_role_is_tsk()
    AND stage <> 'WITHDRAWN'
    AND shared_with_tsk
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
    AND tsk_has_edit_decision(candidates.id)
  )
  WITH CHECK (
    app_role_is_tsk()
    AND stage <> 'WITHDRAWN'
    AND shared_with_tsk
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
    AND tsk_has_edit_decision(candidates.id)
  );
--> statement-breakpoint

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
          AND c.shared_with_tsk
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

-- Penjaga: TSK tidak boleh mengubah status LPK, tanggal persetujuan, maupun opsi berbagi
CREATE OR REPLACE FUNCTION enforce_tsk_cannot_change_lpk_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_role_is_tsk()
     AND (NEW.stage IS DISTINCT FROM OLD.stage
          OR NEW.data_consent_date IS DISTINCT FROM OLD.data_consent_date
          OR NEW.shared_with_tsk IS DISTINCT FROM OLD.shared_with_tsk
          OR NEW.shared_with_tsk_at IS DISTINCT FROM OLD.shared_with_tsk_at
          OR NEW.shared_with_tsk_by IS DISTINCT FROM OLD.shared_with_tsk_by) THEN
    RAISE EXCEPTION 'status kandidat di LPK, tanggal persetujuan, dan opsi berbagi ke TSK hanya bisa diubah oleh LPK'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER candidates_lpk_fields_guard ON candidates;
--> statement-breakpoint
CREATE TRIGGER candidates_lpk_fields_guard
  BEFORE UPDATE OF stage, data_consent_date, shared_with_tsk, shared_with_tsk_at, shared_with_tsk_by ON candidates
  FOR EACH ROW EXECUTE FUNCTION enforce_tsk_cannot_change_lpk_fields();
--> statement-breakpoint

-- Cap waktu dan pelaku saat berbagi diaktifkan; dikosongkan saat dimatikan. Pelaku = app.user_id (tidak bisa dipalsukan dari form).
CREATE OR REPLACE FUNCTION stamp_candidate_sharing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shared_with_tsk THEN
    IF TG_OP = 'INSERT' OR OLD.shared_with_tsk IS DISTINCT FROM true THEN
      NEW.shared_with_tsk_at := now();
      NEW.shared_with_tsk_by := app_current_user();
    END IF;
  ELSE
    NEW.shared_with_tsk_at := NULL;
    NEW.shared_with_tsk_by := NULL;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_share_stamp
  BEFORE INSERT OR UPDATE OF shared_with_tsk ON candidates
  FOR EACH ROW EXECUTE FUNCTION stamp_candidate_sharing();
--> statement-breakpoint

-- Catatan TSK: sisi LPK hanya melihat yang dibagikan, dari TSK dengan kemitraan AKTIF, dan hanya selama
-- kandidatnya dibagikan ke TSK (mengikuti pola kemitraan nonaktif). Sisi TSK lewat candidate_visible().
DROP POLICY candidate_notes_read ON candidate_notes;
--> statement-breakpoint
CREATE POLICY candidate_notes_read ON candidate_notes FOR SELECT
  USING (
    app_bypass_rls()
    OR (app_role_is_tsk() AND tsk_org_id = app_current_org() AND candidate_visible(candidate_id))
    OR (
      app_current_role() = 'LPK_ADMIN'
      AND visibility = 'SHARED_WITH_LPK'
      AND candidate_visible(candidate_id)
      AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_notes.candidate_id AND c.shared_with_tsk)
      AND EXISTS (
        SELECT 1 FROM partnerships p
        WHERE p.active AND p.lpk_id = app_current_org() AND p.tsk_id = candidate_notes.tsk_org_id
      )
    )
  );
