CREATE TABLE "residence_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"previous_card_id" uuid,
	"residence_status" text DEFAULT 'ssw1' NOT NULL,
	"skill_field_id" uuid NOT NULL,
	"period_months" integer,
	"expiry_date" date NOT NULL,
	"renewal_status" text DEFAULT 'not_started' NOT NULL,
	"applied_on" date,
	"received_on" date,
	"received_by" text,
	"handed_over_on" date,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "residence_cards_residence_status_check" CHECK ("residence_cards"."residence_status" in ('ssw1')),
	CONSTRAINT "residence_cards_period_check" CHECK ("residence_cards"."period_months" is null or "residence_cards"."period_months" between 1 and 60),
	CONSTRAINT "residence_cards_renewal_status_check" CHECK ("residence_cards"."renewal_status" in ('not_started','preparing','applied','additional_docs','received','rejected')),
	CONSTRAINT "residence_cards_applied_check" CHECK ("residence_cards"."renewal_status" in ('not_started','preparing') or "residence_cards"."applied_on" is not null),
	CONSTRAINT "residence_cards_received_check" CHECK (("residence_cards"."renewal_status" = 'received') = ("residence_cards"."received_on" is not null)),
	CONSTRAINT "residence_cards_received_by_check" CHECK (("residence_cards"."renewal_status" = 'received') = ("residence_cards"."received_by" is not null) and ("residence_cards"."received_by" is null or "residence_cards"."received_by" in ('staff','worker'))),
	CONSTRAINT "residence_cards_dates_check" CHECK ("residence_cards"."applied_on" is null or "residence_cards"."received_on" is null or "residence_cards"."applied_on" <= "residence_cards"."received_on"),
	CONSTRAINT "residence_cards_handover_check" CHECK ("residence_cards"."handed_over_on" is null or ("residence_cards"."received_by" = 'staff' and "residence_cards"."received_on" is not null and "residence_cards"."handed_over_on" >= "residence_cards"."received_on")),
	CONSTRAINT "residence_cards_note_check" CHECK ("residence_cards"."note" is null or length("residence_cards"."note") <= 2000),
	CONSTRAINT "residence_cards_status_check" CHECK ("residence_cards"."status" in ('active','void')),
	CONSTRAINT "residence_cards_void_check" CHECK ("residence_cards"."status" = 'active' or ("residence_cards"."void_reason" is not null and length(btrim("residence_cards"."void_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "activity_revisions" DROP CONSTRAINT "activity_revisions_type_check";--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_previous_card_id_residence_cards_id_fk" FOREIGN KEY ("previous_card_id") REFERENCES "public"."residence_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_skill_field_id_skill_fields_id_fk" FOREIGN KEY ("skill_field_id") REFERENCES "public"."skill_fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_cards" ADD CONSTRAINT "residence_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "residence_cards_candidate_idx" ON "residence_cards" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "residence_cards_org_expiry_idx" ON "residence_cards" USING btree ("organization_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "residence_cards_one_successor_key" ON "residence_cards" USING btree ("previous_card_id") WHERE "residence_cards"."previous_card_id" is not null and "residence_cards"."status" = 'active';--> statement-breakpoint
ALTER TABLE "activity_revisions" ADD CONSTRAINT "activity_revisions_type_check" CHECK ("activity_revisions"."entity_type" in ('record','timeline_event','case','periodic_interview','residence_card'));
--> statement-breakpoint
-- ================= Pelacak 在留カード (T-017): penjaga, hak tulis 担当 + Admin, RLS =================

-- ----- card_editor(cid): pengguna sesi = penanggung jawab EFEKTIF (担当) pekerja itu. Logika SAMA dengan effectiveResponsible (src/db/responsibility.ts):
-- penetapan per PENEMPATAN terbaru yang berlaku (effective_from <= hari ini menurut zona organisasi; seri: dibuat terakhir) bila terisi, kalau tidak (tidak ada / dikosongkan = "ikut perusahaan") penetapan per PERUSAHAAN.
-- Hanya penempatan AKTIF di organisasi sesi. SECURITY DEFINER sempit: hanya mengembalikan boolean, membaca baris organisasi sesi saja (pola tsk_has_edit_decision).
CREATE OR REPLACE FUNCTION card_editor(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
  WITH ctx AS (
    SELECT p.id AS pid, s.company_id AS coid,
           (now() AT TIME ZONE COALESCE((SELECT o.timezone FROM organizations o WHERE o.id = app_current_org()), 'Asia/Tokyo'))::date AS today
      FROM placements p JOIN client_sites s ON s.id = p.site_id
     WHERE p.candidate_id = cid AND p.status = 'ACTIVE' AND p.org_id = app_current_org()
  ),
  pa AS (
    SELECT a.staff_id FROM responsible_assignments a, ctx
     WHERE a.organization_id = app_current_org() AND a.placement_id = ctx.pid AND a.effective_from <= ctx.today
     ORDER BY a.effective_from DESC, a.created_at DESC LIMIT 1
  ),
  ca AS (
    SELECT a.staff_id FROM responsible_assignments a, ctx
     WHERE a.organization_id = app_current_org() AND a.company_id = ctx.coid AND a.effective_from <= ctx.today
     ORDER BY a.effective_from DESC, a.created_at DESC LIMIT 1
  )
  SELECT COALESCE(
    COALESCE((SELECT staff_id FROM pa), (SELECT staff_id FROM ca)) = app_current_user()
    AND app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF'),
    false)
$$;
--> statement-breakpoint

-- ----- Penjaga INSERT: pembuat = pengguna sesi; pekerja harus punya (atau pernah punya) penempatan di organisasi ini; kartu pengganti sah (pekerja/organisasi sama, asal aktif dan sudah diterima, tanggal habis lebih baru)
CREATE OR REPLACE FUNCTION residence_cards_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev residence_cards%ROWTYPE;
BEGIN
  IF app_current_user() IS NOT NULL THEN NEW.created_by := app_current_user(); END IF;
  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'kartu baru harus berstatus aktif' USING ERRCODE = 'check_violation';
  END IF;
  IF GREATEST(NEW.applied_on, NEW.received_on, NEW.handed_over_on) > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'tanggal pengajuan/diterima/diserahkan tidak boleh di masa depan (tanggal Tokyo)' USING ERRCODE = 'check_violation';
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
CREATE TRIGGER residence_cards_insert_guard BEFORE INSERT ON residence_cards FOR EACH ROW EXECUTE FUNCTION residence_cards_guard_insert();
--> statement-breakpoint

-- ----- Penjaga UPDATE (jalan sebelum penaikan versi): kartu yang sudah DITERIMA final kecuali tanggal serah, diterima-oleh, catatan, dan pembatalan;
-- kartu yang sudah punya pengganti aktif tidak bisa dibatalkan. Kolom identitas (organisasi, pekerja, kartu asal) dikunci oleh activity_versioned_before_update.
CREATE OR REPLACE FUNCTION residence_cards_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF GREATEST(NEW.applied_on, NEW.received_on, NEW.handed_over_on) > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'tanggal pengajuan/diterima/diserahkan tidak boleh di masa depan (tanggal Tokyo)' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.renewal_status = 'received' AND NEW.status = 'active' THEN
    IF NEW.renewal_status IS DISTINCT FROM OLD.renewal_status OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date OR NEW.applied_on IS DISTINCT FROM OLD.applied_on
       OR NEW.received_on IS DISTINCT FROM OLD.received_on OR NEW.skill_field_id IS DISTINCT FROM OLD.skill_field_id
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
--> statement-breakpoint
CREATE TRIGGER residence_cards_a_guard BEFORE UPDATE ON residence_cards FOR EACH ROW EXECUTE FUNCTION residence_cards_guard();
--> statement-breakpoint
CREATE TRIGGER residence_cards_b_version BEFORE UPDATE ON residence_cards FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('candidate_id,previous_card_id');
--> statement-breakpoint
CREATE TRIGGER residence_cards_c_revision AFTER UPDATE ON residence_cards FOR EACH ROW EXECUTE FUNCTION activity_write_revision('residence_card');
--> statement-breakpoint

-- ----- "Terima kartu baru" = SATU transaksi: kartu berstatus received WAJIB punya kartu pengganti aktif pada akhir transaksi (dicek TERTUNDA, saat commit).
-- Dengan begitu tidak pernah ada celah "kartu diterima tetapi kartu baru belum dicatat". Dilewati bila kartunya sudah void.
CREATE OR REPLACE FUNCTION residence_cards_require_successor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
  IF NEW.renewal_status = 'received' AND NEW.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM residence_cards r WHERE r.previous_card_id = NEW.id AND r.status = 'active') THEN
    RAISE EXCEPTION 'kartu yang diterima harus dicatat bersama kartu penggantinya (tanggal habis baru)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER residence_cards_successor_check AFTER INSERT OR UPDATE ON residence_cards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION residence_cards_require_successor();
--> statement-breakpoint

-- ----- GRANT + RLS: baca = staf TSK organisasi sama; tulis (INSERT/UPDATE) = TSK_ADMIN atau 担当 efektif pekerja; TANPA DELETE
GRANT SELECT, INSERT, UPDATE ON residence_cards TO hashi_app;
--> statement-breakpoint
ALTER TABLE residence_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE residence_cards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY residence_cards_read ON residence_cards FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY residence_cards_insert ON residence_cards FOR INSERT WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)) AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY residence_cards_update ON residence_cards FOR UPDATE USING (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id))) WITH CHECK (activity_member(organization_id) AND (activity_is_admin() OR card_editor(candidate_id)));
--> statement-breakpoint

-- ----- Hapus kandidat: tolak juga bila punya kartu (FK sudah RESTRICT; ini memberi pesan jelas dan angka "blocked" di dialog)
CREATE OR REPLACE FUNCTION candidates_block_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD; -- hapus berantai (mis. organisasi dihapus)
  END IF;
  IF EXISTS (
    SELECT 1 FROM candidate_selections s
    WHERE s.candidate_id = OLD.id AND s.decision IN ('DOCUMENT_PROCESS', 'DEPARTED')
  ) OR EXISTS (SELECT 1 FROM activity_record_subjects WHERE candidate_id = OLD.id)
    OR EXISTS (SELECT 1 FROM activity_case_subjects WHERE candidate_id = OLD.id)
    OR EXISTS (SELECT 1 FROM periodic_interviews WHERE candidate_id = OLD.id)
    OR EXISTS (SELECT 1 FROM periodic_interview_quarter_notes WHERE candidate_id = OLD.id)
    OR EXISTS (SELECT 1 FROM residence_cards WHERE candidate_id = OLD.id) THEN
    RAISE EXCEPTION 'kandidat sedang diproses, sudah berangkat, atau punya catatan di sisi TSK: tidak bisa dihapus' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION candidate_delete_summary(cid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
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
      OR EXISTS (SELECT 1 FROM activity_record_subjects WHERE candidate_id = cid)
      OR EXISTS (SELECT 1 FROM activity_case_subjects WHERE candidate_id = cid)
      OR EXISTS (SELECT 1 FROM periodic_interviews WHERE candidate_id = cid)
      OR EXISTS (SELECT 1 FROM periodic_interview_quarter_notes WHERE candidate_id = cid)
      OR EXISTS (SELECT 1 FROM residence_cards WHERE candidate_id = cid)
  );
END
$$;
