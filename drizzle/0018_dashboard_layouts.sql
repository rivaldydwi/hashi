CREATE TABLE "user_dashboard_layouts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Tata letak dashboard: milik sendiri. Hanya pemilik baris (user_id = app.user_id DAN org_id = app.org_id sesi) yang boleh
-- membaca/menulis/menghapus; tidak ada akses lintas pengguna, bahkan untuk admin organisasi. Super admin memakai jalur aplikasi
-- (organisasi platform + user id sendiri), jadi tidak butuh pengecualian. Peran tidak dipakai (preferensi tampilan, bukan data kandidat).
ALTER TABLE user_dashboard_layouts ADD CONSTRAINT user_dashboard_layouts_layout_check
  CHECK (jsonb_typeof(layout) = 'object' AND length(layout::text) <= 4000);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_dashboard_layouts TO hashi_app;
--> statement-breakpoint
ALTER TABLE user_dashboard_layouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_dashboard_layouts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_dashboard_layouts_own_read ON user_dashboard_layouts FOR SELECT
  USING (user_id = app_current_user() AND org_id = app_current_org());
--> statement-breakpoint
CREATE POLICY user_dashboard_layouts_own_insert ON user_dashboard_layouts FOR INSERT
  WITH CHECK (user_id = app_current_user() AND org_id = app_current_org());
--> statement-breakpoint
CREATE POLICY user_dashboard_layouts_own_update ON user_dashboard_layouts FOR UPDATE
  USING (user_id = app_current_user() AND org_id = app_current_org())
  WITH CHECK (user_id = app_current_user() AND org_id = app_current_org());
--> statement-breakpoint
CREATE POLICY user_dashboard_layouts_own_delete ON user_dashboard_layouts FOR DELETE
  USING (user_id = app_current_user() AND org_id = app_current_org());
