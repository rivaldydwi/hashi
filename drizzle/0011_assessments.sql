-- ============================================================================
-- Hashi — Langkah 4: penilaian kandidat (candidate_assessments)
--
-- kind: LPK_MONTHLY (面談 bulanan oleh LPK, riwayat), TSK_INTERVIEW (setelah interview TSK), TSK_VISIT (kunjungan ke LPK).
--
-- BACA
--   LPK_ADMIN, LPK_SENSEI : LPK_MONTHLY kandidat LPK-nya.
--   LPK_ADMIN saja        : + penilaian TSK yang SHARED_WITH_LPK, dari TSK dengan kemitraan AKTIF dan hanya selama
--                           kandidat dibagikan (shared_with_tsk). Sensei tidak pernah membaca penilaian TSK.
--   TSK (admin & staf)    : semua LPK_MONTHLY kandidat yang dibagikan kepadanya + penilaian TSK milik organisasinya
--                           sendiri. TSK lain tidak pernah membaca penilaian TSK itu.
-- TULIS (tidak ada DELETE untuk siapa pun)
--   LPK_MONTHLY : dibuat LPK_ADMIN/LPK_SENSEI untuk kandidat LPK-nya; diubah penilainya atau LPK_ADMIN.
--                 TSK TIDAK PERNAH bisa menulis/mengubahnya (riwayat), termasuk setelah PASSED_CLIENT_INTERVIEW.
--   TSK_VISIT   : TSK kapan saja untuk kandidat yang terlihat (dibagikan + kemitraan aktif).
--   TSK_INTERVIEW: hanya bila keputusan TSK itu IN (PASSED_TSK_INTERVIEW, SUBMITTED_TO_CLIENT,
--                 PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED). Daftar eksplisit, bukan >=.
--   Mengubah penilaian TSK: penilainya atau TSK_ADMIN di organisasi yang sama. LPK tidak bisa menulis penilaian TSK.
-- Semua hak mengikuti candidate_visible() (kemitraan aktif + shared_with_tsk untuk TSK), seperti tabel anak lain.
-- Trigger: period (awal bulan), assessor_id (dari app.user_id, tidak bisa dipalsukan), tanggal tidak di masa depan,
-- dan candidate_id / org_id / kind / assessor_id tidak bisa diganti.
-- ============================================================================
CREATE TYPE "public"."assessment_kind" AS ENUM('LPK_MONTHLY', 'TSK_INTERVIEW', 'TSK_VISIT');--> statement-breakpoint
CREATE TABLE "candidate_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"assessed_on" date NOT NULL,
	"period" date DEFAULT CURRENT_DATE NOT NULL,
	"assessor_id" uuid,
	"duration_minutes" smallint DEFAULT 30 NOT NULL,
	"score_japanese" smallint,
	"score_attitude" smallint,
	"score_fitness" smallint,
	"score_motivation" smallint,
	"attendance_pct" smallint,
	"test_name" text,
	"test_score" integer,
	"note" text,
	"follow_up" text,
	"visibility" "note_visibility" DEFAULT 'TSK_ONLY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_assessments_scores_check" CHECK (("candidate_assessments"."score_japanese" is null or "candidate_assessments"."score_japanese" between 1 and 5) and ("candidate_assessments"."score_attitude" is null or "candidate_assessments"."score_attitude" between 1 and 5) and ("candidate_assessments"."score_fitness" is null or "candidate_assessments"."score_fitness" between 1 and 5) and ("candidate_assessments"."score_motivation" is null or "candidate_assessments"."score_motivation" between 1 and 5)),
	CONSTRAINT "candidate_assessments_attendance_check" CHECK ("candidate_assessments"."attendance_pct" is null or "candidate_assessments"."attendance_pct" between 0 and 100),
	CONSTRAINT "candidate_assessments_duration_check" CHECK ("candidate_assessments"."duration_minutes" between 1 and 480),
	CONSTRAINT "candidate_assessments_test_score_check" CHECK ("candidate_assessments"."test_score" is null or "candidate_assessments"."test_score" >= 0),
	CONSTRAINT "candidate_assessments_visibility_check" CHECK ("candidate_assessments"."kind" <> 'LPK_MONTHLY' or "candidate_assessments"."visibility" = 'TSK_ONLY')
);
--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_assessor_id_users_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_assessments_candidate_idx" ON "candidate_assessments" USING btree ("candidate_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_assessments_lpk_month_key" ON "candidate_assessments" USING btree ("candidate_id","period") WHERE "candidate_assessments"."kind" = 'LPK_MONTHLY';

-- Pemilik kandidat = organisasi sesi (LPK yang menilai)
CREATE OR REPLACE FUNCTION candidate_owned_by_session_org(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM candidates c WHERE c.id = cid AND c.organization_id = app_current_org())
$$;
--> statement-breakpoint
-- Keputusan TSK yang membuka TSK_INTERVIEW. JANGAN diganti dengan perbandingan urutan enum.
CREATE OR REPLACE FUNCTION tsk_interview_decision(d selection_decision) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT d IN ('PASSED_TSK_INTERVIEW', 'SUBMITTED_TO_CLIENT', 'PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED')
$$;
--> statement-breakpoint
-- SECURITY DEFINER (memutus rekursi RLS) tetapi hanya membaca keputusan milik organisasi sesi.
CREATE OR REPLACE FUNCTION tsk_may_interview(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM candidate_selections s
    WHERE s.candidate_id = cid AND s.tsk_org_id = app_current_org() AND tsk_interview_decision(s.decision)
  )
$$;
--> statement-breakpoint

-- Trigger sebelum tulis: tanggal, period, penilai
CREATE OR REPLACE FUNCTION assessments_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Batas atas = tanggal di Tokyo (zona paling awal di antara LPK di Indonesia dan TSK di Jepang)
  IF NEW.assessed_on > (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION 'tanggal penilaian tidak boleh di masa depan' USING ERRCODE = 'check_violation';
  END IF;
  NEW.period := date_trunc('month', NEW.assessed_on)::date;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND NOT app_bypass_rls() THEN
    -- Penilai SELALU user yang login, apa pun yang dikirim dari form
    NEW.assessor_id := app_current_user();
    IF NEW.assessor_id IS NULL THEN
      RAISE EXCEPTION 'penilai tidak dikenal (app.user_id kosong)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_assessments_before_write
  BEFORE INSERT OR UPDATE ON candidate_assessments
  FOR EACH ROW EXECUTE FUNCTION assessments_before_write();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assessments_keys_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.assessor_id IS DISTINCT FROM OLD.assessor_id THEN
    RAISE EXCEPTION 'kandidat, organisasi, jenis, dan penilai tidak bisa diganti' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_assessments_keys_immutable
  BEFORE UPDATE OF candidate_id, org_id, kind, assessor_id ON candidate_assessments
  FOR EACH ROW EXECUTE FUNCTION assessments_keys_immutable();
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON candidate_assessments TO hashi_app;
--> statement-breakpoint
ALTER TABLE candidate_assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY candidate_assessments_read ON candidate_assessments FOR SELECT
  USING (
    app_bypass_rls()
    OR (app_role_is_lpk() AND kind = 'LPK_MONTHLY' AND candidate_visible(candidate_id))
    OR (
      app_current_role() = 'LPK_ADMIN'
      AND kind <> 'LPK_MONTHLY'
      AND visibility = 'SHARED_WITH_LPK'
      AND candidate_visible(candidate_id)
      AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_assessments.candidate_id AND c.shared_with_tsk)
      AND EXISTS (
        SELECT 1 FROM partnerships p
        WHERE p.active AND p.lpk_id = app_current_org() AND p.tsk_id = candidate_assessments.org_id
      )
    )
    OR (
      app_role_is_tsk()
      AND candidate_visible(candidate_id)
      AND (kind = 'LPK_MONTHLY' OR org_id = app_current_org())
    )
  );
--> statement-breakpoint
CREATE POLICY candidate_assessments_insert ON candidate_assessments FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR (
      kind = 'LPK_MONTHLY'
      AND app_current_role() IN ('LPK_ADMIN', 'LPK_SENSEI')
      AND org_id = app_current_org()
      AND candidate_owned_by_session_org(candidate_id)
    )
    OR (
      kind = 'TSK_VISIT'
      AND app_role_is_tsk()
      AND org_id = app_current_org()
      AND candidate_visible(candidate_id)
    )
    OR (
      kind = 'TSK_INTERVIEW'
      AND app_role_is_tsk()
      AND org_id = app_current_org()
      AND candidate_visible(candidate_id)
      AND tsk_may_interview(candidate_id)
    )
  );
--> statement-breakpoint
CREATE POLICY candidate_assessments_update ON candidate_assessments FOR UPDATE
  USING (
    app_bypass_rls()
    OR (
      kind = 'LPK_MONTHLY'
      AND org_id = app_current_org()
      AND candidate_owned_by_session_org(candidate_id)
      AND (app_current_role() = 'LPK_ADMIN' OR (app_current_role() = 'LPK_SENSEI' AND assessor_id = app_current_user()))
    )
    OR (
      kind <> 'LPK_MONTHLY'
      AND app_role_is_tsk()
      AND org_id = app_current_org()
      AND candidate_visible(candidate_id)
      AND (assessor_id = app_current_user() OR app_current_role() = 'TSK_ADMIN')
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR (
      kind = 'LPK_MONTHLY'
      AND org_id = app_current_org()
      AND candidate_owned_by_session_org(candidate_id)
      AND (app_current_role() = 'LPK_ADMIN' OR (app_current_role() = 'LPK_SENSEI' AND assessor_id = app_current_user()))
    )
    OR (
      kind <> 'LPK_MONTHLY'
      AND app_role_is_tsk()
      AND org_id = app_current_org()
      AND candidate_visible(candidate_id)
      AND (assessor_id = app_current_user() OR app_current_role() = 'TSK_ADMIN')
    )
  );
