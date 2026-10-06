CREATE TABLE "responsible_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid,
	"placement_id" uuid,
	"staff_id" uuid,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "responsible_assignments_scope_check" CHECK (num_nonnulls("responsible_assignments"."company_id", "responsible_assignments"."placement_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "responsible_assignments" ADD CONSTRAINT "responsible_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_assignments" ADD CONSTRAINT "responsible_assignments_company_id_client_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."client_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_assignments" ADD CONSTRAINT "responsible_assignments_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_assignments" ADD CONSTRAINT "responsible_assignments_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_assignments" ADD CONSTRAINT "responsible_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "responsible_assignments_company_idx" ON "responsible_assignments" USING btree ("company_id","effective_from");--> statement-breakpoint
CREATE INDEX "responsible_assignments_placement_idx" ON "responsible_assignments" USING btree ("placement_id","effective_from");--> statement-breakpoint
CREATE INDEX "responsible_assignments_staff_idx" ON "responsible_assignments" USING btree ("staff_id");--> statement-breakpoint

-- ----- Penjaga: organisasi sama dengan perusahaan/penempatan, staf = staf TSK organisasi yang sama, pembuat = pengguna sesi (tidak bisa dipalsukan)
CREATE OR REPLACE FUNCTION responsible_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM client_companies c WHERE c.id = NEW.company_id AND c.org_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'perusahaan klien bukan milik organisasi ini' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM placements p WHERE p.id = NEW.placement_id AND p.org_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'penempatan bukan milik organisasi ini' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  PERFORM activity_assert_staff(NEW.organization_id, NEW.staff_id);
  IF app_current_user() IS NOT NULL THEN NEW.created_by := app_current_user(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER responsible_assignments_guard_insert BEFORE INSERT ON responsible_assignments FOR EACH ROW EXECUTE FUNCTION responsible_assignments_guard();
--> statement-breakpoint

-- ----- GRANT + RLS: baca = staf TSK organisasi sama; tulis = TSK_ADMIN organisasi sama; TANPA UPDATE/DELETE (riwayat append-only)
GRANT SELECT, INSERT ON responsible_assignments TO hashi_app;
--> statement-breakpoint
ALTER TABLE responsible_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE responsible_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY responsible_assignments_read ON responsible_assignments FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY responsible_assignments_insert ON responsible_assignments FOR INSERT WITH CHECK (activity_member(organization_id) AND activity_is_admin() AND created_by = app_current_user());
