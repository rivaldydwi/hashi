CREATE TYPE "public"."job_order_status" AS ENUM('OPEN', 'FILLED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."job_program" AS ENUM('SSW', 'TITP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."placement_status" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TABLE "job_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"title" text NOT NULL,
	"positions" smallint DEFAULT 1 NOT NULL,
	"program" "job_program" DEFAULT 'SSW' NOT NULL,
	"description" text,
	"salary_note" text,
	"monthly_salary" integer,
	"work_place" text,
	"min_jlpt" text,
	"jft_required" boolean DEFAULT false NOT NULL,
	"gender_requirement" "gender",
	"target_start_date" date,
	"application_deadline" date,
	"status" "job_order_status" DEFAULT 'OPEN' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_orders_positions_check" CHECK ("job_orders"."positions" between 1 and 1000),
	CONSTRAINT "job_orders_salary_check" CHECK ("job_orders"."monthly_salary" is null or "job_orders"."monthly_salary" >= 0),
	CONSTRAINT "job_orders_min_jlpt_check" CHECK ("job_orders"."min_jlpt" is null or "job_orders"."min_jlpt" in ('N5', 'N4', 'N3', 'N2', 'N1'))
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"job_order_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "placement_status" DEFAULT 'ACTIVE' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_dates_check" CHECK ("placements"."end_date" is null or "placements"."end_date" >= "placements"."start_date"),
	CONSTRAINT "placements_ended_check" CHECK ("placements"."status" = 'ACTIVE' or "placements"."end_date" is not null)
);
--> statement-breakpoint
DROP INDEX "candidate_selections_candidate_tsk_key";--> statement-breakpoint
ALTER TABLE "candidate_selections" ADD COLUMN "job_order_id" uuid;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_site_id_client_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."client_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_field_id_skill_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."skill_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_site_id_client_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."client_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_orders_org_status_idx" ON "job_orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "job_orders_site_idx" ON "job_orders" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "job_orders_field_idx" ON "job_orders" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_one_active_key" ON "placements" USING btree ("candidate_id") WHERE "placements"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "placements_org_idx" ON "placements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "placements_site_idx" ON "placements" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "candidate_selections" ADD CONSTRAINT "candidate_selections_job_order_id_job_orders_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- NULLS NOT DISTINCT: hanya satu keputusan UMUM (tanpa job order) per kandidat x TSK, dan satu per job order
CREATE UNIQUE INDEX "candidate_selections_candidate_tsk_jo_key" ON "candidate_selections" USING btree ("candidate_id","tsk_org_id","job_order_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX "candidate_selections_job_order_idx" ON "candidate_selections" USING btree ("job_order_id");
--> statement-breakpoint

-- ============================================================================
-- Job order (求人), seleksi per job order, penempatan (配属). Aturan:
--   * job_orders / placements milik TSK (org_id). LPK (semua peran), super admin lewat jalur aplikasi, dan TSK lain: tidak bisa
--     membaca/menulis. TSK_ADMIN dan TSK_STAFF membaca, menambah, mengubah; hapus job order hanya TSK_ADMIN dan hanya yang belum
--     dirujuk seleksi/penempatan (FK RESTRICT). Penempatan TIDAK bisa dihapus siapa pun (hanya cascade saat kandidat dihapus).
--   * candidate_selections.job_order_id: satu baris per (kandidat, TSK, job order), plus satu baris umum (NULL). Keputusan
--     PASSED_CLIENT_INTERVIEW / DOCUMENT_PROCESS / DEPARTED WAJIB punya job order (CHECK; daftar IN eksplisit, bukan `>=`).
--     Job order harus milik TSK yang sama dengan baris seleksinya (trigger), dan tidak bisa dipindah.
--   * Keputusan DEPARTED membuat baris penempatan ACTIVE otomatis (trigger); satu kandidat hanya satu penempatan ACTIVE.
--   * Job order OPEN menjadi FILLED otomatis bila jumlah kandidat terpilih (PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED)
--     mencapai jumlah posisi; dibuka lagi secara manual oleh staf (tidak dibalik otomatis).
-- ============================================================================
ALTER TABLE candidate_selections ADD CONSTRAINT candidate_selections_job_order_required
  CHECK (decision NOT IN ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED') OR job_order_id IS NOT NULL) NOT VALID;
--> statement-breakpoint
-- Data lama (sebelum job order ada) yang melanggar aturan baru dibiarkan sampai disentuh: constraint baru divalidasi hanya bila bersih.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM candidate_selections WHERE decision IN ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED') AND job_order_id IS NULL) THEN
    ALTER TABLE candidate_selections VALIDATE CONSTRAINT candidate_selections_job_order_required;
  END IF;
END
$$;
--> statement-breakpoint

-- Job order harus milik TSK yang sama dengan baris seleksinya; (kandidat, TSK, job order) tidak bisa dipindah
CREATE OR REPLACE FUNCTION prevent_selection_key_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.tsk_org_id IS DISTINCT FROM OLD.tsk_org_id
     OR NEW.job_order_id IS DISTINCT FROM OLD.job_order_id THEN
    RAISE EXCEPTION 'keputusan tidak bisa dipindahkan ke kandidat, TSK, atau job order lain'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER candidate_selections_keys_immutable ON candidate_selections;
--> statement-breakpoint
CREATE TRIGGER candidate_selections_keys_immutable
  BEFORE UPDATE OF candidate_id, tsk_org_id, job_order_id ON candidate_selections
  FOR EACH ROW EXECUTE FUNCTION prevent_selection_key_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION candidate_selections_job_order_org() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  jo_org uuid;
BEGIN
  IF NEW.job_order_id IS NOT NULL THEN
    SELECT org_id INTO jo_org FROM job_orders WHERE id = NEW.job_order_id;
    IF jo_org IS DISTINCT FROM NEW.tsk_org_id THEN
      RAISE EXCEPTION 'job order harus milik TSK yang sama dengan keputusan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_selections_job_order_org
  BEFORE INSERT OR UPDATE ON candidate_selections
  FOR EACH ROW EXECUTE FUNCTION candidate_selections_job_order_org();
--> statement-breakpoint

-- Keputusan paling maju per (kandidat, TSK). Peringkat ditulis EKSPLISIT (bukan urutan enum): REJECTED hanya menang bila tidak ada yang lain.
CREATE OR REPLACE FUNCTION selection_decision_rank(d selection_decision) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE d
    WHEN 'NONE' THEN 0
    WHEN 'REJECTED' THEN 1
    WHEN 'SHORTLISTED' THEN 2
    WHEN 'PASSED_TSK_INTERVIEW' THEN 3
    WHEN 'SUBMITTED_TO_CLIENT' THEN 4
    WHEN 'PASSED_CLIENT_INTERVIEW' THEN 5
    WHEN 'DOCUMENT_PROCESS' THEN 6
    WHEN 'DEPARTED' THEN 7
  END
$$;
--> statement-breakpoint
-- security_invoker: RLS candidate_selections berlaku untuk pemanggil (TSK = miliknya; LPK = kandidat miliknya). Tidak memuat job_order_id.
CREATE VIEW candidate_headline_decision WITH (security_invoker = true) AS
  SELECT DISTINCT ON (candidate_id, tsk_org_id) candidate_id, tsk_org_id, decision, decided_at
  FROM candidate_selections
  ORDER BY candidate_id, tsk_org_id, selection_decision_rank(decision) DESC, decided_at DESC;
--> statement-breakpoint
GRANT SELECT ON candidate_headline_decision TO hashi_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- job_orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION job_orders_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  site_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'organisasi pemilik job order tidak bisa diganti' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      RAISE EXCEPTION 'lokasi kerja job order tidak bisa diganti' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT org_id INTO site_org FROM client_sites WHERE id = NEW.site_id;
  IF site_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'lokasi kerja harus milik TSK yang sama dengan job order' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.field_id IS DISTINCT FROM OLD.field_id THEN
    IF NOT EXISTS (SELECT 1 FROM client_site_fields WHERE site_id = NEW.site_id AND field_id = NEW.field_id) THEN
      RAISE EXCEPTION 'bidang job order harus termasuk bidang yang diterima lokasi' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER job_orders_guard BEFORE INSERT OR UPDATE ON job_orders FOR EACH ROW EXECUTE FUNCTION job_orders_guard();
--> statement-breakpoint

-- OPEN -> FILLED otomatis bila jumlah kandidat terpilih >= jumlah posisi (hanya arah ini; dibuka lagi manual)
CREATE OR REPLACE FUNCTION job_order_sync_status(jo uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
  UPDATE job_orders j SET status = 'FILLED'
  WHERE j.id = jo AND j.status = 'OPEN'
    AND (SELECT count(DISTINCT s.candidate_id) FROM candidate_selections s
         WHERE s.job_order_id = jo AND s.decision IN ('PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED')) >= j.positions
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION candidate_selections_fill_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_order_id IS NOT NULL THEN
    PERFORM job_order_sync_status(NEW.job_order_id);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_selections_fill
  AFTER INSERT OR UPDATE OF decision ON candidate_selections
  FOR EACH ROW EXECUTE FUNCTION candidate_selections_fill_trigger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION job_orders_positions_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM job_order_sync_status(NEW.id);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER job_orders_positions_sync
  AFTER UPDATE OF positions ON job_orders
  FOR EACH ROW EXECUTE FUNCTION job_orders_positions_trigger();
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON job_orders TO hashi_app;
--> statement-breakpoint
ALTER TABLE job_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_orders_read ON job_orders FOR SELECT USING (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY job_orders_insert ON job_orders FOR INSERT WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY job_orders_update ON job_orders FOR UPDATE USING (client_owner(org_id)) WITH CHECK (client_owner(org_id));
--> statement-breakpoint
CREATE POLICY job_orders_delete ON job_orders FOR DELETE USING (client_owner_admin(org_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- placements (penempatan). Dibuat HANYA oleh trigger saat keputusan menjadi DEPARTED (SECURITY DEFINER + bypass).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION placements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.job_order_id IS DISTINCT FROM OLD.job_order_id THEN
    RAISE EXCEPTION 'kandidat, TSK, lokasi, dan job order penempatan tidak bisa diganti' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER placements_guard BEFORE UPDATE ON placements FOR EACH ROW EXECUTE FUNCTION placements_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION placement_on_departed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
DECLARE
  jo job_orders%ROWTYPE;
BEGIN
  IF NEW.decision <> 'DEPARTED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.decision = 'DEPARTED' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO jo FROM job_orders WHERE id = NEW.job_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keputusan Berangkat memerlukan job order' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM placements WHERE candidate_id = NEW.candidate_id AND status = 'ACTIVE') THEN
    IF EXISTS (SELECT 1 FROM placements WHERE candidate_id = NEW.candidate_id AND status = 'ACTIVE' AND job_order_id = NEW.job_order_id) THEN
      RETURN NEW; -- sudah ada penempatan aktif untuk job order ini
    END IF;
    RAISE EXCEPTION 'kandidat sudah punya penempatan aktif' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO placements (candidate_id, org_id, site_id, job_order_id, start_date)
  VALUES (NEW.candidate_id, NEW.tsk_org_id, jo.site_id, NEW.job_order_id, COALESCE(jo.target_start_date, current_date));
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_selections_placement
  AFTER INSERT OR UPDATE OF decision ON candidate_selections
  FOR EACH ROW EXECUTE FUNCTION placement_on_departed();
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON placements TO hashi_app;
--> statement-breakpoint
ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE placements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY placements_read ON placements FOR SELECT
  USING (app_bypass_rls() OR (app_role_is_tsk() AND org_id = app_current_org() AND candidate_visible(candidate_id)));
--> statement-breakpoint
CREATE POLICY placements_insert ON placements FOR INSERT WITH CHECK (app_bypass_rls());
--> statement-breakpoint
CREATE POLICY placements_update ON placements FOR UPDATE
  USING (app_bypass_rls() OR (app_role_is_tsk() AND org_id = app_current_org() AND candidate_visible(candidate_id)))
  WITH CHECK (app_bypass_rls() OR (app_role_is_tsk() AND org_id = app_current_org() AND candidate_visible(candidate_id)));
--> statement-breakpoint

-- Ringkasan hapus kandidat: ikut menghitung penempatan
CREATE OR REPLACE FUNCTION candidate_delete_summary(cid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
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
    'placements', (SELECT count(*) FROM placements WHERE candidate_id = cid),
    'privateRows', (SELECT count(*) FROM candidate_private WHERE candidate_id = cid),
    'family', (SELECT count(*) FROM candidate_family_members WHERE candidate_id = cid),
    'educations', (SELECT count(*) FROM candidate_educations WHERE candidate_id = cid),
    'works', (SELECT count(*) FROM candidate_work_histories WHERE candidate_id = cid),
    'certificates', (SELECT count(*) FROM candidate_certificates WHERE candidate_id = cid),
    'blocked', EXISTS (SELECT 1 FROM candidate_selections WHERE candidate_id = cid AND decision IN ('DOCUMENT_PROCESS', 'DEPARTED'))
  );
END
$$;
