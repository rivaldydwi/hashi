CREATE TYPE "public"."certificate_type" AS ENUM('JFT_BASIC', 'JLPT', 'SKILL_TEST');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('PHOTO', 'KTP', 'FAMILY_CARD', 'BIRTH_CERTIFICATE', 'DIPLOMA', 'GUARDIAN_CONSENT', 'PASSPORT_RECOMMENDATION', 'PASSPORT', 'SKCK', 'MEDICAL_CHECKUP', 'TRAINING_CERTIFICATE', 'IPKOL_REGISTRATION', 'SISKOP2MI_REGISTRATION', 'EMPLOYMENT_CONTRACT', 'BPJS', 'OPP_CERTIFICATE', 'MIGRANT_WORKER_CARD', 'VISA', 'DATA_CONSENT_FORM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."dominant_hand" AS ENUM('RIGHT', 'LEFT', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."family_relation" AS ENUM('FATHER', 'MOTHER', 'SPOUSE', 'CHILD', 'SIBLING', 'GUARDIAN', 'RELATIVE_IN_JAPAN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');--> statement-breakpoint
CREATE TABLE "candidate_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"type" "certificate_type" NOT NULL,
	"level_or_field" text,
	"score" integer,
	"certificate_number" text,
	"issued_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"issued_date" date,
	"expiry_date" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_documents_mime_check" CHECK ("candidate_documents"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "candidate_documents_size_check" CHECK ("candidate_documents"."size_bytes" between 1 and 10485760)
);
--> statement-breakpoint
CREATE TABLE "candidate_educations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"school_name" text NOT NULL,
	"major" text,
	"start_year" smallint,
	"end_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"relation" "family_relation" NOT NULL,
	"name" text NOT NULL,
	"occupation" text,
	"phone" text,
	"address" text,
	"lives_in_japan" boolean DEFAULT false NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_private" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"national_id" text,
	"family_card_number" text,
	"passport_number" text,
	"passport_issued_date" date,
	"passport_expiry_date" date,
	"address" text,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"vision_note" text,
	"color_blind" boolean DEFAULT false NOT NULL,
	"medical_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_work_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"position" text,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "birth_place" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "marital_status" "marital_status";--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "data_consent_date" date;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "height_cm" smallint;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "weight_kg" smallint;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "dominant_hand" "dominant_hand";--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "ever_in_japan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "japan_history_note" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "visa_rejected_before" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "motivation" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "self_pr" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "hobby" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "special_skill" text;--> statement-breakpoint
ALTER TABLE "candidate_certificates" ADD CONSTRAINT "candidate_certificates_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_educations" ADD CONSTRAINT "candidate_educations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_family_members" ADD CONSTRAINT "candidate_family_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_private" ADD CONSTRAINT "candidate_private_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_work_histories" ADD CONSTRAINT "candidate_work_histories_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_certificates_candidate_idx" ON "candidate_certificates" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_documents_candidate_idx" ON "candidate_documents" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_documents_expiry_idx" ON "candidate_documents" USING btree ("expiry_date") WHERE "candidate_documents"."expiry_date" is not null;--> statement-breakpoint
CREATE INDEX "candidate_educations_candidate_idx" ON "candidate_educations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_family_members_candidate_idx" ON "candidate_family_members" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_work_histories_candidate_idx" ON "candidate_work_histories" USING btree ("candidate_id");