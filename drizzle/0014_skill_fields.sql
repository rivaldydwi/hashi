CREATE TABLE "skill_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_id" text NOT NULL,
	"name_ja" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_fields_code_check" CHECK ("skill_fields"."code" ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "field_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_fields_code_key" ON "skill_fields" USING btree ("code");--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_field_id_skill_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."skill_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidates_field_idx" ON "candidates" USING btree ("field_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Bidang kerja sebagai tabel master (langkah 5). Sebelumnya bidang kandidat berupa teks bebas (candidates.field).
-- Daftar awal = 6 bidang yang dipakai data demo; nilai teks lain yang sudah ada di data ikut dimasukkan (kode `legacy-...`),
-- jadi tidak ada nilai yang hilang. Kolom teks lama dihapus di migration berikutnya (0015) setelah data dipindah.
-- ---------------------------------------------------------------------------
INSERT INTO skill_fields (code, name_id, name_ja, sort_order) VALUES
  ('food', 'Pengolahan makanan & minuman', '飲食料品製造業', 10),
  ('restaurant', 'Jasa makanan (restoran)', '外食業', 20),
  ('kaigo', 'Perawatan lansia (kaigo)', '介護', 30),
  ('manufacture', 'Manufaktur industri', '工業製品製造業', 40),
  ('construction', 'Konstruksi', '建設', 50),
  ('agri', 'Pertanian', '農業', 60);
--> statement-breakpoint
INSERT INTO skill_fields (code, name_id, name_ja, sort_order)
SELECT 'legacy-' || substr(md5(f), 1, 8), f, f, 1000 + row_number() OVER (ORDER BY f)
FROM (
  SELECT DISTINCT btrim(field) AS f FROM candidates
  WHERE field IS NOT NULL AND btrim(field) <> '' AND btrim(field) NOT IN (SELECT name_id FROM skill_fields)
) x;
--> statement-breakpoint
UPDATE candidates c SET field_id = s.id FROM skill_fields s WHERE btrim(c.field) = s.name_id;
--> statement-breakpoint

-- Kode stabil: tidak boleh diubah
CREATE OR REPLACE FUNCTION skill_fields_code_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'kode bidang kerja tidak bisa diubah' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER skill_fields_code_immutable
  BEFORE UPDATE ON skill_fields
  FOR EACH ROW EXECUTE FUNCTION skill_fields_code_immutable();
--> statement-breakpoint

-- Hak akses: semua peran yang punya konteks organisasi boleh MEMBACA (dipakai di form, filter, label). Menulis (menambah,
-- menonaktifkan, menghapus) hanya mode sistem (halaman super admin). Bidang yang sudah dipakai tidak bisa dihapus:
-- FK ON DELETE RESTRICT dari candidates (dan nanti klien, job order).
GRANT SELECT, INSERT, UPDATE, DELETE ON skill_fields TO hashi_app;
--> statement-breakpoint
ALTER TABLE skill_fields ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skill_fields FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_fields_read ON skill_fields FOR SELECT
  USING (app_bypass_rls() OR app_current_org() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY skill_fields_insert ON skill_fields FOR INSERT WITH CHECK (app_bypass_rls());
--> statement-breakpoint
CREATE POLICY skill_fields_update ON skill_fields FOR UPDATE USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
--> statement-breakpoint
CREATE POLICY skill_fields_delete ON skill_fields FOR DELETE USING (app_bypass_rls());
