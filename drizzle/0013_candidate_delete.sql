-- Hapus kandidat permanen (hanya LPK_ADMIN pemilik; policy DELETE `candidates_lpk_admin_delete` di 0005 sudah demikian).
--
-- 1. Semua tabel ber-candidate_id memakai FK ON DELETE CASCADE (dicek di tes). `audit_logs.candidate_id` TIDAK punya FK,
--    jadi riwayat audit bertahan setelah kandidat dihapus.
-- 2. Penjaga: kandidat dengan keputusan TSK DOCUMENT_PROCESS atau DEPARTED (sedang diproses / sudah berangkat) tidak boleh
--    dihapus oleh siapa pun lewat DELETE langsung (daftar IN eksplisit, bukan perbandingan urutan enum). Pengecualian:
--    hapus berantai dari organisasi (trigger berjalan di dalam trigger RI, pg_trigger_depth() > 1). TRUNCATE (db:seed --reset)
--    tidak memicu trigger baris, jadi reset tidak terhalang.
-- 3. Ringkasan jumlah data yang ikut terhapus untuk dialog konfirmasi (LPK tidak bisa membaca catatan/penilaian TSK yang
--    TSK_ONLY lewat RLS, jadi jumlahnya dihitung fungsi sempit ini; hanya angka, tidak pernah isi).

CREATE OR REPLACE FUNCTION candidates_block_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD; -- hapus berantai (mis. organisasi dihapus)
  END IF;
  IF EXISTS (
    SELECT 1 FROM candidate_selections s
    WHERE s.candidate_id = OLD.id AND s.decision IN ('DOCUMENT_PROCESS', 'DEPARTED')
  ) THEN
    RAISE EXCEPTION 'kandidat sedang diproses atau sudah berangkat: tidak bisa dihapus' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidates_block_delete
  BEFORE DELETE ON candidates
  FOR EACH ROW EXECUTE FUNCTION candidates_block_delete();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION candidate_delete_summary(cid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
  -- hanya LPK_ADMIN dari organisasi pemilik kandidat; selain itu tidak ada informasi apa pun
  -- COALESCE: app_current_role() bisa NULL (peran tidak dikenal); tanpa itu NOT NULL = NULL dan pemeriksaan terlewati
  IF NOT COALESCE(
    app_current_role() = 'LPK_ADMIN'
    AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = cid AND c.organization_id = app_current_org()),
    false
  ) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'documents', (SELECT count(*) FROM candidate_documents WHERE candidate_id = cid),
    'assessmentsLpk', (SELECT count(*) FROM candidate_assessments WHERE candidate_id = cid AND kind = 'LPK_MONTHLY'),
    'assessmentsTsk', (SELECT count(*) FROM candidate_assessments WHERE candidate_id = cid AND kind <> 'LPK_MONTHLY'),
    'notes', (SELECT count(*) FROM candidate_notes WHERE candidate_id = cid),
    'selections', (SELECT count(*) FROM candidate_selections WHERE candidate_id = cid),
    'privateRows', (SELECT count(*) FROM candidate_private WHERE candidate_id = cid),
    'family', (SELECT count(*) FROM candidate_family_members WHERE candidate_id = cid),
    'educations', (SELECT count(*) FROM candidate_educations WHERE candidate_id = cid),
    'works', (SELECT count(*) FROM candidate_work_histories WHERE candidate_id = cid),
    'certificates', (SELECT count(*) FROM candidate_certificates WHERE candidate_id = cid),
    'blocked', EXISTS (SELECT 1 FROM candidate_selections WHERE candidate_id = cid AND decision IN ('DOCUMENT_PROCESS', 'DEPARTED'))
  );
END
$$;
