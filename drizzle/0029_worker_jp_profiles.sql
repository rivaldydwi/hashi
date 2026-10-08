CREATE TABLE "worker_jp_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"address_jp" text,
	"phone_jp" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "worker_jp_profiles_address_check" CHECK ("worker_jp_profiles"."address_jp" is null or length("worker_jp_profiles"."address_jp") <= 300),
	CONSTRAINT "worker_jp_profiles_phone_check" CHECK ("worker_jp_profiles"."phone_jp" is null or length("worker_jp_profiles"."phone_jp") <= 40)
);
--> statement-breakpoint
ALTER TABLE "worker_jp_profiles" ADD CONSTRAINT "worker_jp_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jp_profiles" ADD CONSTRAINT "worker_jp_profiles_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jp_profiles" ADD CONSTRAINT "worker_jp_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jp_profiles" ADD CONSTRAINT "worker_jp_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_jp_profiles_candidate_key" ON "worker_jp_profiles" USING btree ("candidate_id");--> statement-breakpoint
-- ================= Data Jepang pekerja (T-021): penjaga, hak tulis 担当 + Admin, RLS, tanpa DELETE =================

-- ----- Penjaga: organisasi sesi; pekerja harus punya (atau pernah punya) penempatan di organisasi ini; pembuat/pengubah dari sesi; kandidat/organisasi terkunci
CREATE OR REPLACE FUNCTION worker_jp_profiles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM placements p WHERE p.candidate_id = NEW.candidate_id AND p.org_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'pekerja tidak punya penempatan di organisasi ini' USING ERRCODE = 'check_violation';
    END IF;
    IF app_current_user() IS NOT NULL THEN NEW.created_by := app_current_user(); END IF;
  ELSE
    IF NEW.candidate_id <> OLD.candidate_id OR NEW.organization_id <> OLD.organization_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'pekerja, organisasi, dan pembuat data Jepang tidak bisa diubah' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    IF app_current_user() IS NOT NULL THEN NEW.updated_by := app_current_user(); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER worker_jp_profiles_a_guard BEFORE INSERT OR UPDATE ON worker_jp_profiles FOR EACH ROW EXECUTE FUNCTION worker_jp_profiles_guard();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON worker_jp_profiles TO hashi_app;
--> statement-breakpoint
ALTER TABLE worker_jp_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE worker_jp_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY worker_jp_profiles_read ON worker_jp_profiles FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY worker_jp_profiles_insert ON worker_jp_profiles FOR INSERT WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)) AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY worker_jp_profiles_update ON worker_jp_profiles FOR UPDATE USING (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id))) WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)));
--> statement-breakpoint

-- ----- Hapus kandidat: data Jepang ikut memblokir lewat FK RESTRICT (pekerja TSK tidak bisa dihapus dari LPK)
