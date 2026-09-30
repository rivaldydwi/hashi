-- ============================================================================
-- Hashi — Langkah 3: hak akses profil kandidat (RLS berbasis peran)
--
-- Variabel sesi baru: app.role (peran user yang login; diisi withTenant()).
-- Peran kosong/tidak dikenal = tidak boleh membaca data sensitif dan tidak boleh menulis.
--
-- Ringkasan aturan:
--   LPK_ADMIN   : baca + tulis semua data kandidat LPK-nya (termasuk sensitif & dokumen)
--   LPK_SENSEI  : hanya baca profil dasar (candidates, pendidikan, kerja, sertifikat).
--                 TIDAK bisa membaca candidate_private, keluarga, dokumen; tidak bisa menulis.
--   TSK_ADMIN / TSK_STAFF (kemitraan aktif):
--                 BACA semua kandidat LPK mitra di SEMUA tahap (termasuk STUDYING dan WITHDRAWN),
--                 beserta data sensitif & dokumen, dengan syarat data_consent_date IS NOT NULL.
--                 Tanpa persetujuan, kandidat hanya terlihat oleh LPK pemiliknya.
--                 UBAH TAHAP (kolom stage) kandidat yang terlihat: di tahap apa pun.
--                 EDIT isi data (kolom lain, candidate_private, dokumen, dst): HANYA saat stage
--                 IN (PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED). Daftar IN eksplisit,
--                 bukan perbandingan urutan enum (WITHDRAWN paling akhir di enum). Dijaga trigger
--                 BEFORE UPDATE (candidates, candidate_private) + policy RLS (tabel anak).
--   Tabel sensitif: candidate_private, candidate_family_members (memuat kontak keluarga),
--                 candidate_documents.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;
--> statement-breakpoint
-- Peran yang boleh membaca data sensitif kandidat (sensei sengaja tidak termasuk).
CREATE OR REPLACE FUNCTION app_role_reads_sensitive() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_current_role() IN ('LPK_ADMIN', 'TSK_ADMIN', 'TSK_STAFF'), false)
$$;
--> statement-breakpoint
-- Tahapan di mana TSK mitra boleh mengedit. JANGAN diganti dengan stage >= ...:
-- urutan enum candidate_stage menaruh WITHDRAWN di paling akhir.
CREATE OR REPLACE FUNCTION tsk_editable_stage(s candidate_stage) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IN ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED')
$$;
--> statement-breakpoint
-- Kandidat ini terlihat oleh sesi sekarang? (mewarisi seluruh policy SELECT di candidates:
-- LPK pemilik, atau TSK mitra aktif untuk kandidat yang bukan STUDYING)
CREATE OR REPLACE FUNCTION candidate_visible(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM candidates c WHERE c.id = cid)
$$;
--> statement-breakpoint
-- Kandidat ini boleh diubah oleh sesi sekarang?
--   LPK_ADMIN pemilik: kapan pun. TSK mitra aktif: hanya pada tahapan tsk_editable_stage,
--   dan hanya kandidat dengan persetujuan berbagi data.
CREATE OR REPLACE FUNCTION candidate_editable(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM candidates c
    WHERE c.id = cid
      AND (
        app_bypass_rls()
        OR (c.organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
        OR (
          app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF')
          AND tsk_editable_stage(c.stage)
          AND c.data_consent_date IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM partnerships p
            WHERE p.active AND p.lpk_id = c.organization_id AND p.tsk_id = app_current_org()
          )
        )
      )
  )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- candidates: baca (LPK pemilik; TSK mitra jika ada persetujuan), tulis (LPK_ADMIN pemilik;
-- TSK mitra untuk kandidat yang terlihat, dibatasi trigger di bawah)
-- ---------------------------------------------------------------------------
DROP POLICY candidates_own_org ON candidates;
--> statement-breakpoint
-- Menggantikan policy 0001: TSK melihat semua tahap, tetapi hanya kandidat yang sudah
-- memberi persetujuan berbagi data.
DROP POLICY candidates_partner_read ON candidates;
--> statement-breakpoint
CREATE POLICY candidates_partner_read ON candidates FOR SELECT
  USING (
    data_consent_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active
        AND p.lpk_id = candidates.organization_id
        AND p.tsk_id = app_current_org()
    )
  );
--> statement-breakpoint
CREATE POLICY candidates_own_read ON candidates FOR SELECT
  USING (app_bypass_rls() OR organization_id = app_current_org());
--> statement-breakpoint
CREATE POLICY candidates_lpk_admin_insert ON candidates FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
  );
--> statement-breakpoint
CREATE POLICY candidates_lpk_admin_update ON candidates FOR UPDATE
  USING (
    app_bypass_rls()
    OR (organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
  )
  WITH CHECK (
    app_bypass_rls()
    OR (organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
  );
--> statement-breakpoint
CREATE POLICY candidates_lpk_admin_delete ON candidates FOR DELETE
  USING (
    app_bypass_rls()
    OR (organization_id = app_current_org() AND app_current_role() = 'LPK_ADMIN')
  );
--> statement-breakpoint
-- TSK boleh meng-UPDATE kandidat yang terlihat olehnya (mitra aktif + ada persetujuan), tahap apa pun,
-- supaya bisa mengubah stage. Kolom lain dibatasi trigger candidates_tsk_edit_guard di bawah:
-- di luar tsk_editable_stage hanya stage (dan updated_at) yang boleh berubah.
-- WITH CHECK sama dengan USING, jadi TSK juga tidak bisa menghapus data_consent_date
-- (yang akan menyembunyikan kandidat dari dirinya sendiri).
CREATE POLICY candidates_tsk_update ON candidates FOR UPDATE
  USING (
    app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF')
    AND data_consent_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
  )
  WITH CHECK (
    app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF')
    AND data_consent_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active AND p.lpk_id = candidates.organization_id AND p.tsk_id = app_current_org()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Trigger penjaga (jaring pengaman di luar RLS)
-- ---------------------------------------------------------------------------
-- Kandidat tidak boleh dipindah ke LPK lain (mencegah TSK memindah antar-LPK mitra).
CREATE OR REPLACE FUNCTION prevent_candidate_org_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'kandidat tidak bisa dipindahkan ke organisasi lain'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_org_immutable
  BEFORE UPDATE OF organization_id ON candidates
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_org_change();
--> statement-breakpoint
-- TSK di luar tahap yang boleh diedit: hanya kolom stage (dan updated_at) yang boleh berubah.
-- Yang dinilai adalah stage BARIS LAMA: mengubah stage + kolom lain sekaligus tetap ditolak.
-- Membandingkan seluruh baris (to_jsonb) supaya kolom baru di masa depan otomatis terlindungi.
CREATE OR REPLACE FUNCTION enforce_tsk_edit_stage_candidates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF')
     AND NOT tsk_editable_stage(OLD.stage)
     AND (to_jsonb(NEW) - 'stage' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'stage' - 'updated_at') THEN
    RAISE EXCEPTION 'TSK hanya boleh mengubah tahap kandidat yang berstatus % (bukan data lainnya)', OLD.stage
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_tsk_edit_guard
  BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION enforce_tsk_edit_stage_candidates();
--> statement-breakpoint
-- Sama untuk data sensitif: tahap yang dinilai adalah tahap kandidat induknya.
-- SECURITY DEFINER supaya tahap induk selalu terbaca; kandidat yang tidak ditemukan dianggap
-- tidak boleh diedit.
CREATE OR REPLACE FUNCTION enforce_tsk_edit_stage_private() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_stage candidate_stage;
BEGIN
  IF app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF')
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    SELECT stage INTO parent_stage FROM candidates WHERE id = OLD.candidate_id;
    IF parent_stage IS NULL OR NOT tsk_editable_stage(parent_stage) THEN
      RAISE EXCEPTION 'TSK tidak boleh mengubah data sensitif kandidat yang berstatus %', COALESCE(parent_stage::text, '?')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_private_tsk_edit_guard
  BEFORE UPDATE ON candidate_private
  FOR EACH ROW EXECUTE FUNCTION enforce_tsk_edit_stage_private();
--> statement-breakpoint
-- Baris anak tidak boleh dipindah ke kandidat lain.
CREATE OR REPLACE FUNCTION prevent_candidate_id_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id THEN
    RAISE EXCEPTION 'data tidak bisa dipindahkan ke kandidat lain'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tabel anak: GRANT, RLS, policy. Kolom kunci ke kandidat: candidate_id.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_educations TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_educations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_educations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_educations_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_educations
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_educations_read ON candidate_educations FOR SELECT
  USING (app_bypass_rls() OR candidate_visible(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_educations_insert ON candidate_educations FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_educations_update ON candidate_educations FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_educations_delete ON candidate_educations FOR DELETE
  USING (candidate_editable(candidate_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_work_histories TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_work_histories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_work_histories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_work_histories_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_work_histories
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_work_histories_read ON candidate_work_histories FOR SELECT
  USING (app_bypass_rls() OR candidate_visible(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_work_histories_insert ON candidate_work_histories FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_work_histories_update ON candidate_work_histories FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_work_histories_delete ON candidate_work_histories FOR DELETE
  USING (candidate_editable(candidate_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_certificates TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_certificates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_certificates_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_certificates
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_certificates_read ON candidate_certificates FOR SELECT
  USING (app_bypass_rls() OR candidate_visible(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_certificates_insert ON candidate_certificates FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_certificates_update ON candidate_certificates FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_certificates_delete ON candidate_certificates FOR DELETE
  USING (candidate_editable(candidate_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_private TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_private ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_private FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_private_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_private
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_private_read ON candidate_private FOR SELECT
  USING (app_bypass_rls() OR (app_role_reads_sensitive() AND candidate_visible(candidate_id)));
--> statement-breakpoint
CREATE POLICY candidate_private_insert ON candidate_private FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_private_update ON candidate_private FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_private_delete ON candidate_private FOR DELETE
  USING (candidate_editable(candidate_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_family_members TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_family_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_family_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_family_members_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_family_members
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_family_members_read ON candidate_family_members FOR SELECT
  USING (app_bypass_rls() OR (app_role_reads_sensitive() AND candidate_visible(candidate_id)));
--> statement-breakpoint
CREATE POLICY candidate_family_members_insert ON candidate_family_members FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_family_members_update ON candidate_family_members FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_family_members_delete ON candidate_family_members FOR DELETE
  USING (candidate_editable(candidate_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate_documents TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER candidate_documents_candidate_immutable
  BEFORE UPDATE OF candidate_id ON candidate_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_candidate_id_change();
--> statement-breakpoint
CREATE POLICY candidate_documents_read ON candidate_documents FOR SELECT
  USING (app_bypass_rls() OR (app_role_reads_sensitive() AND candidate_visible(candidate_id)));
--> statement-breakpoint
CREATE POLICY candidate_documents_insert ON candidate_documents FOR INSERT
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_documents_update ON candidate_documents FOR UPDATE
  USING (candidate_editable(candidate_id))
  WITH CHECK (candidate_editable(candidate_id));
--> statement-breakpoint
CREATE POLICY candidate_documents_delete ON candidate_documents FOR DELETE
  USING (candidate_editable(candidate_id));
