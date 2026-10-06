ALTER TABLE "activity_records" ADD COLUMN "continues_record_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_continues_record_id_activity_records_id_fk" FOREIGN KEY ("continues_record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_records_continues_idx" ON "activity_records" USING btree ("continues_record_id");--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_not_self_check" CHECK ("activity_records"."continues_record_id" is null or "activity_records"."continues_record_id" <> "activity_records"."id");--> statement-breakpoint

-- ----- "Lanjutkan catatan" (T-007): penjaga continues_record_id
-- 1) terkunci setelah dibuat (kolom identitas pada trigger versi); trigger diganti dengan nama yang sama sehingga urutan eksekusi tidak berubah
DROP TRIGGER activity_records_b_version ON activity_records;
--> statement-breakpoint
CREATE TRIGGER activity_records_b_version BEFORE UPDATE ON activity_records FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('kind,continues_record_id');
--> statement-breakpoint
-- 2) saat dibuat: catatan asal harus ada (terbaca oleh sesi; RLS menyembunyikan organisasi lain), satu organisasi, dan masih aktif
CREATE OR REPLACE FUNCTION activity_records_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activity_assert_staff(NEW.organization_id, NEW.author_id);
  IF NEW.continues_record_id IS NOT NULL THEN
    PERFORM 1 FROM activity_records p WHERE p.id = NEW.continues_record_id AND p.organization_id = NEW.organization_id AND p.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catatan yang dilanjutkan tidak ada, bukan milik organisasi ini, atau sudah dibatalkan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 3) pekerja baru ditambahkan SESUDAH baris catatan (dalam transaksi yang sama), jadi syarat "menyebut pekerja yang sama" diperiksa saat COMMIT
CREATE OR REPLACE FUNCTION activity_records_continue_subjects_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM activity_record_subjects c JOIN activity_record_subjects p ON p.candidate_id = c.candidate_id AND p.record_id = NEW.continues_record_id WHERE c.record_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'catatan lanjutan harus menyebut setidaknya satu pekerja yang sama dengan catatan asal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER activity_records_continue_subjects AFTER INSERT ON activity_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.continues_record_id IS NOT NULL) EXECUTE FUNCTION activity_records_continue_subjects_check();
