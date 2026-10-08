ALTER TABLE "placements" ADD COLUMN "arrived_on" date;--> statement-breakpoint
-- ================= Tanggal tiba + status visa untuk LPK (T-024) =================

-- ----- Penjaga penempatan: arrived_on hanya boleh DIUBAH oleh TSK_ADMIN atau 担当 efektif pekerja (staf TSK lain tetap boleh mengubah kolom lain seperti sebelumnya),
-- dan tidak boleh di masa depan menurut tanggal Tokyo. Jalur sistem (bypass) bebas (seed, migrasi).
CREATE OR REPLACE FUNCTION placements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.job_order_id IS DISTINCT FROM OLD.job_order_id THEN
    RAISE EXCEPTION 'kandidat, TSK, lokasi, dan job order penempatan tidak bisa diganti' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.arrived_on IS DISTINCT FROM OLD.arrived_on AND NOT app_bypass_rls() THEN
    IF NOT COALESCE(activity_is_admin() OR card_editor(NEW.candidate_id), false) THEN
      RAISE EXCEPTION 'tanggal tiba hanya bisa diubah oleh Admin TSK atau penanggung jawab pekerja' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.arrived_on > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
      RAISE EXCEPTION 'tanggal tiba tidak boleh di masa depan (tanggal Tokyo)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- ----- Status visa dari kartu: SATU definisi (dicerminkan src/db/zairyu.ts `visaState`; dites setara di verify-rls).
-- renewing = sudah diajukan / menunggu hasil (applied, additional_docs; termasuk 特例期間); selain itu valid bila tanggal habis belum lewat, kalau tidak expired.
CREATE OR REPLACE FUNCTION card_visa_state(p_expiry date, p_status text, p_today date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_status IN ('applied', 'additional_docs') THEN 'renewing' WHEN p_expiry >= p_today THEN 'valid' ELSE 'expired' END
$$;
--> statement-breakpoint

-- ----- Fungsi SEMPIT untuk LPK (pola candidate_delete_summary): hanya LPK_ADMIN PEMILIK kandidat, kandidat dibagikan ke TSK, ada penempatan di TSK dengan kemitraan AKTIF.
-- Mengembalikan TEPAT tiga kunci: arrived_on, visa_state (none | valid | renewing | expired), valid_until. Selain itu NULL (sensei, TSK, LPK lain, kemitraan nonaktif, tidak dibagikan, belum berangkat).
-- TIDAK mengembalikan nomor kartu, catatan, status proses rinci, nama TSK/klien/lokasi, job order, atau tanggal lain. COALESCE pada pemeriksaan peran: NULL dalam NOT melewati IF.
CREATE OR REPLACE FUNCTION lpk_worker_status(cid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
DECLARE
  c candidates%ROWTYPE;
  pl placements%ROWTYPE;
  cr residence_cards%ROWTYPE;
  has_card boolean;
  today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF NOT COALESCE(app_current_role() = 'LPK_ADMIN', false) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM candidates WHERE id = cid AND organization_id = app_current_org();
  IF NOT FOUND OR NOT c.shared_with_tsk THEN
    RETURN NULL;
  END IF;
  SELECT p.* INTO pl FROM placements p
   WHERE p.candidate_id = cid
     AND EXISTS (SELECT 1 FROM partnerships ps WHERE ps.lpk_id = c.organization_id AND ps.tsk_id = p.org_id AND ps.active)
   ORDER BY (p.status = 'ACTIVE') DESC, p.start_date DESC, p.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT r.* INTO cr FROM residence_cards r
   WHERE r.candidate_id = cid AND r.organization_id = pl.org_id AND r.status = 'active'
   ORDER BY r.expiry_date DESC, r.created_at DESC
   LIMIT 1;
  has_card := FOUND;
  RETURN jsonb_build_object(
    'arrived_on', pl.arrived_on,
    'visa_state', CASE WHEN has_card THEN card_visa_state(cr.expiry_date, cr.renewal_status, today) ELSE 'none' END,
    'valid_until', CASE WHEN has_card THEN cr.expiry_date ELSE NULL END
  );
END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION lpk_worker_status(uuid) TO hashi_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION card_visa_state(date, text, date) TO hashi_app;
