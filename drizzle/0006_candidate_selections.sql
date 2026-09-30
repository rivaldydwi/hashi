-- ============================================================================
-- Hashi — Langkah 3 (revisi): status LPK dan keputusan TSK dipisah
--
--   candidates.stage         : status di LPK, hanya STUDYING / READY / WITHDRAWN (diisi LPK_ADMIN)
--   candidate_selections     : keputusan satu TSK atas satu kandidat (SHORTLISTED ... DEPARTED, REJECTED)
--   candidate_notes          : catatan TSK (visibility TSK_ONLY / SHARED_WITH_LPK)
--   audit_logs               : + actor_org_id (organisasi pelaku), + candidate_id
--
-- Pemetaan data lama (aman dijalankan di database yang sudah berisi data):
--   STUDYING / READY / WITHDRAWN      -> tetap
--   SHORTLISTED ... DEPARTED (6 nilai) -> candidates.stage = READY, DAN satu baris
--                                        candidate_selections untuk SETIAP TSK yang bermitra
--                                        (aktif maupun tidak) dengan LPK kandidat, decision = nilai lama.
--   Kandidat bernilai lama tsb yang LPK-nya belum punya mitra TSK tidak punya baris keputusan
--   (tidak ada TSK yang bisa dikaitkan); status LPK-nya tetap menjadi READY.
--
-- Aturan RLS baru ada di 0007_candidate_selections_rls.sql.
-- ============================================================================
-- Lepas penjaga lama yang bergantung pada tipe candidate_stage. Diganti oleh 0007.
DROP TRIGGER IF EXISTS candidates_tsk_edit_guard ON candidates;
--> statement-breakpoint
DROP TRIGGER IF EXISTS candidate_private_tsk_edit_guard ON candidate_private;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_tsk_edit_stage_candidates();
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_tsk_edit_stage_private();
--> statement-breakpoint
DROP POLICY IF EXISTS candidates_tsk_update ON candidates;
--> statement-breakpoint
DROP FUNCTION IF EXISTS tsk_editable_stage(candidate_stage);
--> statement-breakpoint
CREATE TYPE "public"."note_visibility" AS ENUM('TSK_ONLY', 'SHARED_WITH_LPK');--> statement-breakpoint
CREATE TYPE "public"."selection_decision" AS ENUM('NONE', 'SHORTLISTED', 'PASSED_TSK_INTERVIEW', 'SUBMITTED_TO_CLIENT', 'PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "candidate_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"tsk_org_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"visibility" "note_visibility" DEFAULT 'TSK_ONLY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"tsk_org_id" uuid NOT NULL,
	"decision" "selection_decision" DEFAULT 'NONE' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Pindahkan status lama (di atas READY) menjadi keputusan TSK SEBELUM tipe kolom diganti.
INSERT INTO candidate_selections (candidate_id, tsk_org_id, decision, decided_at)
SELECT c.id, p.tsk_id, c.stage::text::selection_decision, c.updated_at
FROM candidates c
JOIN partnerships p ON p.lpk_id = c.organization_id
WHERE c.stage::text IN ('SHORTLISTED', 'PASSED_TSK_INTERVIEW', 'SUBMITTED_TO_CLIENT',
                        'PASSED_CLIENT_INTERVIEW', 'DOCUMENT_PROCESS', 'DEPARTED');
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "stage" DROP DEFAULT;
--> statement-breakpoint
ALTER TYPE "public"."candidate_stage" RENAME TO "candidate_stage_old";
--> statement-breakpoint
CREATE TYPE "public"."candidate_stage" AS ENUM('STUDYING', 'READY', 'WITHDRAWN');
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "stage" SET DATA TYPE "public"."candidate_stage"
  USING (CASE "stage"::text WHEN 'STUDYING' THEN 'STUDYING' WHEN 'WITHDRAWN' THEN 'WITHDRAWN' ELSE 'READY' END)::"public"."candidate_stage";
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "stage" SET DEFAULT 'STUDYING';
--> statement-breakpoint
DROP TYPE "public"."candidate_stage_old";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_org_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
-- Log lama: organization_id memang organisasi pelaku (log kandidat baru memakai LPK pemilik).
UPDATE "audit_logs" SET "actor_org_id" = "organization_id" WHERE "actor_org_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_tsk_org_id_organizations_id_fk" FOREIGN KEY ("tsk_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_selections" ADD CONSTRAINT "candidate_selections_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_selections" ADD CONSTRAINT "candidate_selections_tsk_org_id_organizations_id_fk" FOREIGN KEY ("tsk_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_selections" ADD CONSTRAINT "candidate_selections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_notes_candidate_tsk_idx" ON "candidate_notes" USING btree ("candidate_id","tsk_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_selections_candidate_tsk_key" ON "candidate_selections" USING btree ("candidate_id","tsk_org_id");--> statement-breakpoint
CREATE INDEX "candidate_selections_tsk_idx" ON "candidate_selections" USING btree ("tsk_org_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_org_created_idx" ON "audit_logs" USING btree ("actor_org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_candidate_created_idx" ON "audit_logs" USING btree ("candidate_id","created_at");
