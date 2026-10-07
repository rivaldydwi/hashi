ALTER TABLE "residence_cards" ADD COLUMN "additional_docs_on" date;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD COLUMN "rejected_on" date;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_additional_check" CHECK ("residence_cards"."renewal_status" <> 'additional_docs' or "residence_cards"."additional_docs_on" is not null);--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_rejected_check" CHECK ("residence_cards"."renewal_status" <> 'rejected' or "residence_cards"."rejected_on" is not null);--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_status_dates_check" CHECK (("residence_cards"."additional_docs_on" is null or "residence_cards"."applied_on" is null or "residence_cards"."additional_docs_on" >= "residence_cards"."applied_on") and ("residence_cards"."rejected_on" is null or "residence_cards"."applied_on" is null or "residence_cards"."rejected_on" >= "residence_cards"."applied_on"));
--> statement-breakpoint
-- ----- Penjaga ikut memeriksa dua tanggal baru (tidak di masa depan menurut tanggal Tokyo; terkunci pada kartu yang sudah diterima)
CREATE OR REPLACE FUNCTION residence_cards_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev residence_cards%ROWTYPE;
BEGIN
  IF app_current_user() IS NOT NULL THEN NEW.created_by := app_current_user(); END IF;
  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'kartu baru harus berstatus aktif' USING ERRCODE = 'check_violation';
  END IF;
  IF GREATEST(NEW.applied_on, NEW.received_on, NEW.handed_over_on, NEW.additional_docs_on, NEW.rejected_on) > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'tanggal pengajuan/dokumen tambahan/ditolak/diterima/diserahkan tidak boleh di masa depan (tanggal Tokyo)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM placements p WHERE p.candidate_id = NEW.candidate_id AND p.org_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'pekerja tidak punya penempatan di organisasi ini' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.previous_card_id IS NOT NULL THEN
    SELECT * INTO prev FROM residence_cards WHERE id = NEW.previous_card_id;
    IF NOT FOUND OR prev.organization_id <> NEW.organization_id OR prev.candidate_id <> NEW.candidate_id
       OR prev.status <> 'active' OR prev.renewal_status <> 'received' THEN
      RAISE EXCEPTION 'kartu yang digantikan tidak ada, bukan milik pekerja/organisasi ini, atau belum diterima' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expiry_date <= prev.expiry_date THEN
      RAISE EXCEPTION 'tanggal habis kartu baru harus lebih akhir daripada kartu yang digantikan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION residence_cards_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF GREATEST(NEW.applied_on, NEW.received_on, NEW.handed_over_on, NEW.additional_docs_on, NEW.rejected_on) > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'tanggal pengajuan/dokumen tambahan/ditolak/diterima/diserahkan tidak boleh di masa depan (tanggal Tokyo)' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.renewal_status = 'received' AND NEW.status = 'active' THEN
    IF NEW.renewal_status IS DISTINCT FROM OLD.renewal_status OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date OR NEW.applied_on IS DISTINCT FROM OLD.applied_on
       OR NEW.received_on IS DISTINCT FROM OLD.received_on OR NEW.additional_docs_on IS DISTINCT FROM OLD.additional_docs_on OR NEW.rejected_on IS DISTINCT FROM OLD.rejected_on OR NEW.skill_field_id IS DISTINCT FROM OLD.skill_field_id
       OR NEW.period_months IS DISTINCT FROM OLD.period_months OR NEW.residence_status IS DISTINCT FROM OLD.residence_status THEN
      RAISE EXCEPTION 'kartu yang sudah diterima tidak bisa diubah (hanya tanggal serah, diterima oleh, catatan, atau dibatalkan)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'void' AND OLD.status = 'active' AND EXISTS (SELECT 1 FROM residence_cards r WHERE r.previous_card_id = OLD.id AND r.status = 'active') THEN
    RAISE EXCEPTION 'kartu yang sudah punya kartu pengganti tidak bisa dibatalkan' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'void' AND OLD.status = 'active' AND OLD.previous_card_id IS NOT NULL THEN
    RAISE EXCEPTION 'kartu pengganti dari kartu yang sudah diterima tidak bisa dibatalkan (ubah datanya)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
