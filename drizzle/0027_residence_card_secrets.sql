CREATE TABLE "residence_card_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"side" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "residence_card_photos_side_check" CHECK ("residence_card_photos"."side" in ('front','back')),
	CONSTRAINT "residence_card_photos_mime_check" CHECK ("residence_card_photos"."mime" in ('image/jpeg','image/png','application/pdf')),
	CONSTRAINT "residence_card_photos_size_check" CHECK ("residence_card_photos"."size_bytes" between 1 and 10485760),
	CONSTRAINT "residence_card_photos_removed_check" CHECK (("residence_card_photos"."removed_at" is null) = ("residence_card_photos"."removed_by" is null))
);
--> statement-breakpoint
CREATE TABLE "residence_card_secrets" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"number_enc" text NOT NULL,
	"number_masked" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "residence_card_secrets_enc_check" CHECK ("residence_card_secrets"."number_enc" like 'hcd1:%'),
	CONSTRAINT "residence_card_secrets_masked_check" CHECK ("residence_card_secrets"."number_masked" ~ '^[A-Z]{2}[*]{8}[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "residence_card_photos" ADD CONSTRAINT "residence_card_photos_card_id_residence_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."residence_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_photos" ADD CONSTRAINT "residence_card_photos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_photos" ADD CONSTRAINT "residence_card_photos_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_photos" ADD CONSTRAINT "residence_card_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_photos" ADD CONSTRAINT "residence_card_photos_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_card_id_residence_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."residence_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "residence_card_photos_card_idx" ON "residence_card_photos" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "residence_card_photos_one_active_key" ON "residence_card_photos" USING btree ("card_id","side") WHERE "residence_card_photos"."removed_at" is null;--> statement-breakpoint
-- ================= Nomor dan foto 在留カード (T-020): penjaga, RLS hanya TSK_ADMIN + 担当 efektif =================

-- ----- Penjaga anak kartu (rahasia/foto): organisasi + pekerja HARUS sama dengan kartunya, kartu harus aktif saat menulis; pembuat/pengubah diisi dari sesi.
-- SELECT pada residence_cards berjalan sebagai pengguna sesi (RLS biasa): kartu yang tak terlihat = ditolak.
CREATE OR REPLACE FUNCTION residence_card_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c residence_cards%ROWTYPE;
BEGIN
  SELECT * INTO c FROM residence_cards WHERE id = NEW.card_id;
  IF NOT FOUND OR c.organization_id <> NEW.organization_id OR c.candidate_id <> NEW.candidate_id THEN
    RAISE EXCEPTION 'kartu tidak ditemukan, atau organisasi/pekerja tidak sama dengan kartunya' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF c.status <> 'active' THEN
      RAISE EXCEPTION 'kartu sudah dibatalkan: nomor dan foto tidak bisa ditambahkan' USING ERRCODE = 'check_violation';
    END IF;
    IF app_current_user() IS NOT NULL THEN NEW.created_by := app_current_user(); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER residence_card_secrets_a_guard BEFORE INSERT ON residence_card_secrets FOR EACH ROW EXECUTE FUNCTION residence_card_child_guard();
--> statement-breakpoint
CREATE TRIGGER residence_card_photos_a_guard BEFORE INSERT ON residence_card_photos FOR EACH ROW EXECUTE FUNCTION residence_card_child_guard();
--> statement-breakpoint

-- ----- Nomor: ganti nilai hanya pada kartu aktif; kartu/organisasi/pekerja terkunci; updated_by/updated_at dari sesi
CREATE OR REPLACE FUNCTION residence_card_secrets_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF NEW.card_id <> OLD.card_id OR NEW.organization_id <> OLD.organization_id OR NEW.candidate_id <> OLD.candidate_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'kartu, organisasi, pekerja, dan pembuat nomor tidak bisa diubah' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO st FROM residence_cards WHERE id = NEW.card_id;
  IF st IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'kartu sudah dibatalkan: nomor tidak bisa diubah' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  IF app_current_user() IS NOT NULL THEN NEW.updated_by := app_current_user(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER residence_card_secrets_b_update BEFORE UPDATE ON residence_card_secrets FOR EACH ROW EXECUTE FUNCTION residence_card_secrets_guard_update();
--> statement-breakpoint

-- ----- Foto: satu-satunya perubahan yang boleh = DITANDAI DIHAPUS (removed_at/removed_by terisi dari kosong, oleh pengguna sesi); semua kolom lain terkunci
CREATE OR REPLACE FUNCTION residence_card_photos_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.card_id <> OLD.card_id OR NEW.organization_id <> OLD.organization_id OR NEW.candidate_id <> OLD.candidate_id OR NEW.side <> OLD.side
     OR NEW.mime <> OLD.mime OR NEW.size_bytes <> OLD.size_bytes OR NEW.key_id <> OLD.key_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'data foto kartu tidak bisa diubah (hanya bisa ditandai dihapus)' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'foto yang sudah dihapus tidak bisa diubah lagi' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.removed_at IS NOT NULL THEN
    NEW.removed_at := now();
    IF app_current_user() IS NOT NULL THEN NEW.removed_by := app_current_user(); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER residence_card_photos_b_update BEFORE UPDATE ON residence_card_photos FOR EACH ROW EXECUTE FUNCTION residence_card_photos_guard_update();
--> statement-breakpoint

-- ----- GRANT + RLS: baca DAN tulis = TSK_ADMIN atau 担当 efektif pekerja (staf TSK lain, LPK, sensei, super admin, peran null: 0 baris).
-- Nomor boleh DIHAPUS (saat kartu dibatalkan, atau dikoreksi); foto tidak ada DELETE (ditandai dihapus, berkas disk dibuang aplikasi).
GRANT SELECT, INSERT, UPDATE, DELETE ON residence_card_secrets TO hashi_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON residence_card_photos TO hashi_app;
--> statement-breakpoint
ALTER TABLE residence_card_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE residence_card_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE residence_card_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE residence_card_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY residence_card_secrets_all ON residence_card_secrets FOR ALL
  USING (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)))
  WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)));
--> statement-breakpoint
CREATE POLICY residence_card_photos_read ON residence_card_photos FOR SELECT
  USING (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)));
--> statement-breakpoint
CREATE POLICY residence_card_photos_insert ON residence_card_photos FOR INSERT
  WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)) AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY residence_card_photos_update ON residence_card_photos FOR UPDATE
  USING (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)))
  WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)));
--> statement-breakpoint

-- ----- Hapus kandidat: kartu sudah memblokir (FK RESTRICT + candidates_block_delete); anak kartu ikut RESTRICT lewat kartu.
