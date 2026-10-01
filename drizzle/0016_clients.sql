CREATE TABLE "client_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_alt" text,
	"corporate_number" text,
	"hq_address" text,
	"phone" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_companies_corporate_number_check" CHECK ("client_companies"."corporate_number" is null or "client_companies"."corporate_number" ~ '^[0-9]{13}$')
);
--> statement-breakpoint
CREATE TABLE "client_site_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"role_title" text,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_site_fields" (
	"site_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	CONSTRAINT "client_site_fields_site_id_field_id_pk" PRIMARY KEY("site_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "client_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_site_contacts" ADD CONSTRAINT "client_site_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_site_contacts" ADD CONSTRAINT "client_site_contacts_site_id_client_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."client_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_site_fields" ADD CONSTRAINT "client_site_fields_site_id_client_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."client_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_site_fields" ADD CONSTRAINT "client_site_fields_field_id_skill_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."skill_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_site_fields" ADD CONSTRAINT "client_site_fields_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_company_id_client_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."client_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_companies_org_name_idx" ON "client_companies" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "client_site_contacts_site_idx" ON "client_site_contacts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "client_site_fields_field_idx" ON "client_site_fields" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "client_sites_company_idx" ON "client_sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "client_sites_org_idx" ON "client_sites" USING btree ("org_id");--> statement-breakpoint

-- ============================================================================
-- Klien (配属先) milik TSK. Hak akses:
--   * Hanya organisasi TSK pemilik (org_id = organisasi sesi) dan hanya peran TSK_ADMIN / TSK_STAFF.
--     LPK (semua peran), sensei, super admin lewat jalur aplikasi, dan TSK lain: TIDAK bisa SELECT/INSERT/UPDATE/DELETE.
--   * Baca, tambah, ubah, nonaktifkan: TSK_ADMIN dan TSK_STAFF. Hapus permanen perusahaan, lokasi, dan PIC: hanya TSK_ADMIN.
--     (Mengubah daftar bidang yang diterima lokasi = baris client_site_fields; boleh keduanya.)
--   * Perusahaan/lokasi yang punya job order atau penempatan tidak bisa dihapus: FK ON DELETE RESTRICT (ditambah 0018).
--   * org_id konsisten sepanjang rantai (lokasi = perusahaannya, PIC/bidang = lokasinya) dan tidak bisa diubah (trigger).
-- ============================================================================
CREATE OR REPLACE FUNCTION client_rows_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_org uuid;
  org_kind org_type;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'organisasi pemilik data klien tidak bisa diganti' USING ERRCODE = 'check_violation';
    END IF;
    -- Kolom yang tidak ada di tabel tertentu tidak boleh diacu di luar cabangnya (PL/pgSQL tidak menjamin hubung-singkat AND)
    IF TG_TABLE_NAME = 'client_sites' THEN
      IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        RAISE EXCEPTION 'lokasi tidak bisa dipindah ke perusahaan lain' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF TG_TABLE_NAME = 'client_site_contacts' THEN
      IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
        RAISE EXCEPTION 'PIC tidak bisa dipindah ke lokasi lain' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'client_companies' THEN
    SELECT type INTO org_kind FROM organizations WHERE id = NEW.org_id;
    IF org_kind IS DISTINCT FROM 'TSK' THEN
      RAISE EXCEPTION 'data klien hanya boleh dimiliki organisasi TSK' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'client_sites' THEN
    SELECT org_id INTO parent_org FROM client_companies WHERE id = NEW.company_id;
    IF parent_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'lokasi harus milik organisasi yang sama dengan perusahaannya' USING ERRCODE = 'check_violation';
    END IF;
  ELSE -- client_site_contacts, client_site_fields
    SELECT org_id INTO parent_org FROM client_sites WHERE id = NEW.site_id;
    IF parent_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'PIC / bidang harus milik organisasi yang sama dengan lokasinya' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_TABLE_NAME <> 'client_site_fields' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER client_companies_guard BEFORE INSERT OR UPDATE ON client_companies FOR EACH ROW EXECUTE FUNCTION client_rows_guard();
--> statement-breakpoint
CREATE TRIGGER client_sites_guard BEFORE INSERT OR UPDATE ON client_sites FOR EACH ROW EXECUTE FUNCTION client_rows_guard();
--> statement-breakpoint
CREATE TRIGGER client_site_contacts_guard BEFORE INSERT OR UPDATE ON client_site_contacts FOR EACH ROW EXECUTE FUNCTION client_rows_guard();
--> statement-breakpoint
CREATE TRIGGER client_site_fields_guard BEFORE INSERT OR UPDATE ON client_site_fields FOR EACH ROW EXECUTE FUNCTION client_rows_guard();
--> statement-breakpoint

-- Pemilik data klien: peran TSK di organisasi sesi
CREATE OR REPLACE FUNCTION client_owner(row_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_bypass_rls() OR (app_role_is_tsk() AND row_org = app_current_org())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION client_owner_admin(row_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_bypass_rls() OR (app_current_role() = 'TSK_ADMIN' AND row_org = app_current_org())
$$;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON client_companies, client_sites, client_site_contacts, client_site_fields TO hashi_app;
--> statement-breakpoint
ALTER TABLE client_companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_sites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_sites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_site_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_site_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_site_fields ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_site_fields FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY client_companies_read ON client_companies FOR SELECT USING (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_companies_insert ON client_companies FOR INSERT WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_companies_update ON client_companies FOR UPDATE USING (client_owner(org_id)) WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_companies_delete ON client_companies FOR DELETE USING (client_owner_admin(org_id));
--> statement-breakpoint

CREATE POLICY client_sites_read ON client_sites FOR SELECT USING (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_sites_insert ON client_sites FOR INSERT WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_sites_update ON client_sites FOR UPDATE USING (client_owner(org_id)) WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_sites_delete ON client_sites FOR DELETE USING (client_owner_admin(org_id));
--> statement-breakpoint

CREATE POLICY client_site_contacts_read ON client_site_contacts FOR SELECT USING (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_site_contacts_insert ON client_site_contacts FOR INSERT WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_site_contacts_update ON client_site_contacts FOR UPDATE USING (client_owner(org_id)) WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_site_contacts_delete ON client_site_contacts FOR DELETE USING (client_owner_admin(org_id));
--> statement-breakpoint

CREATE POLICY client_site_fields_read ON client_site_fields FOR SELECT USING (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_site_fields_insert ON client_site_fields FOR INSERT WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY client_site_fields_update ON client_site_fields FOR UPDATE USING (client_owner(org_id)) WITH CHECK (client_owner(org_id));
--> statement-breakpoint
-- Baris penghubung bidang dihapus saat daftar bidang lokasi diubah: boleh TSK_ADMIN dan TSK_STAFF (bukan hapus klien)
CREATE POLICY client_site_fields_delete ON client_site_fields FOR DELETE USING (client_owner(org_id));
