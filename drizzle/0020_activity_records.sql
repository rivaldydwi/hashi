CREATE TABLE "activity_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"record_id" uuid,
	"interview_id" uuid,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_name" text NOT NULL,
	"caption" text,
	"include_in_pdf" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "activity_attachments_parent_check" CHECK (num_nonnulls("activity_attachments"."record_id", "activity_attachments"."interview_id") = 1),
	CONSTRAINT "activity_attachments_mime_check" CHECK ("activity_attachments"."mime" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "activity_attachments_size_check" CHECK ("activity_attachments"."size_bytes" > 0 and "activity_attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "activity_case_subjects" (
	"case_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "activity_case_subjects_case_id_candidate_id_pk" PRIMARY KEY("case_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "activity_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "activity_cases_category_check" CHECK ("activity_cases"."category" in ('trouble','resignation','workplace_change','hospital','residence','life_consultation','other')),
	CONSTRAINT "activity_cases_status_check" CHECK ("activity_cases"."status" in ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE "activity_daily_report_recipients" (
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"read_shared_at" timestamp with time zone,
	CONSTRAINT "activity_daily_report_recipients_report_id_user_id_pk" PRIMARY KEY("report_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "activity_daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"shared_at" timestamp with time zone,
	"shared_by" uuid
);
--> statement-breakpoint
CREATE TABLE "activity_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"record_id" uuid,
	"case_id" uuid,
	"interview_id" uuid,
	"description" text NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	CONSTRAINT "activity_followups_status_check" CHECK ("activity_followups"."status" in ('open','done','cancelled')),
	CONSTRAINT "activity_followups_parent_check" CHECK (num_nonnulls("activity_followups"."record_id", "activity_followups"."case_id", "activity_followups"."interview_id") >= 1),
	CONSTRAINT "activity_followups_desc_check" CHECK (length(btrim("activity_followups"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "activity_record_handlers" (
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "activity_record_handlers_record_id_user_id_pk" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "activity_record_reads" (
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_no_read" integer NOT NULL,
	CONSTRAINT "activity_record_reads_record_id_user_id_pk" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "activity_record_recipients" (
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "activity_record_recipients_record_id_user_id_pk" PRIMARY KEY("record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "activity_record_subjects" (
	"record_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "activity_record_subjects_record_id_candidate_id_pk" PRIMARY KEY("record_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "activity_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"record_date" date NOT NULL,
	"author_id" uuid NOT NULL,
	"case_id" uuid,
	"client_site_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"work_type" text,
	"work_type_other" text,
	"action_taken" text,
	"result" text,
	"pending" text,
	"next_action" text,
	"report_to_text" text,
	"note" text,
	"subject" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"method" text,
	"counterparty" text,
	"client_company_id" uuid,
	"sections" jsonb,
	CONSTRAINT "activity_records_kind_check" CHECK ("activity_records"."kind" in ('daily_work','meeting')),
	CONSTRAINT "activity_records_status_check" CHECK ("activity_records"."status" in ('active','void')),
	CONSTRAINT "activity_records_void_check" CHECK ("activity_records"."status" = 'active' or ("activity_records"."void_reason" is not null and length(btrim("activity_records"."void_reason")) > 0)),
	CONSTRAINT "activity_records_work_type_check" CHECK ("activity_records"."work_type" is null or "activity_records"."work_type" in ('interview','consultation','residence_card','hospital_visit','other')),
	CONSTRAINT "activity_records_method_check" CHECK ("activity_records"."method" is null or "activity_records"."method" in ('phone','online','visit','in_person')),
	CONSTRAINT "activity_records_counterparty_check" CHECK ("activity_records"."counterparty" is null or "activity_records"."counterparty" in ('client','worker','other')),
	CONSTRAINT "activity_records_daily_only_check" CHECK ("activity_records"."kind" = 'daily_work' or ("activity_records"."work_type" is null and "activity_records"."work_type_other" is null and "activity_records"."action_taken" is null and "activity_records"."result" is null and "activity_records"."pending" is null and "activity_records"."next_action" is null and "activity_records"."report_to_text" is null and "activity_records"."note" is null)),
	CONSTRAINT "activity_records_meeting_only_check" CHECK ("activity_records"."kind" = 'meeting' or ("activity_records"."subject" is null and "activity_records"."started_at" is null and "activity_records"."ended_at" is null and "activity_records"."method" is null and "activity_records"."counterparty" is null and "activity_records"."client_company_id" is null and "activity_records"."sections" is null)),
	CONSTRAINT "activity_records_meeting_required_check" CHECK ("activity_records"."kind" <> 'meeting' or ("activity_records"."subject" is not null and "activity_records"."started_at" is not null)),
	CONSTRAINT "activity_records_times_check" CHECK ("activity_records"."ended_at" is null or "activity_records"."started_at" is null or "activity_records"."ended_at" >= "activity_records"."started_at")
);
--> statement-breakpoint
CREATE TABLE "activity_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"edited_by" uuid,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_revisions_type_check" CHECK ("activity_revisions"."entity_type" in ('record','timeline_event','case','periodic_interview'))
);
--> statement-breakpoint
CREATE TABLE "case_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"time_known" boolean DEFAULT false NOT NULL,
	"event" text NOT NULL,
	"subject_statement" text,
	"company_response" text,
	"note" text,
	"source_record_id" uuid,
	"include_in_client_export" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "case_timeline_events_status_check" CHECK ("case_timeline_events"."status" in ('active','void')),
	CONSTRAINT "case_timeline_events_void_check" CHECK ("case_timeline_events"."status" = 'active' or ("case_timeline_events"."void_reason" is not null and length(btrim("case_timeline_events"."void_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "periodic_interview_quarter_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"quarter" smallint NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periodic_quarter_check" CHECK ("periodic_interview_quarter_notes"."quarter" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "periodic_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"applicable" boolean DEFAULT true NOT NULL,
	"interview_date" date,
	"result_status" text,
	"reason" text,
	"content" text,
	"staff_id" uuid,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"version_no" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "periodic_interviews_result_check" CHECK ("periodic_interviews"."result_status" is null or "periodic_interviews"."result_status" in ('no_issue','follow_up','issue','not_done')),
	CONSTRAINT "periodic_interviews_reason_check" CHECK ("periodic_interviews"."reason" is null or "periodic_interviews"."reason" in ('agency','support','worker')),
	CONSTRAINT "periodic_interviews_status_check" CHECK ("periodic_interviews"."status" in ('active','void')),
	CONSTRAINT "periodic_interviews_void_check" CHECK ("periodic_interviews"."status" = 'active' or ("periodic_interviews"."void_reason" is not null and length(btrim("periodic_interviews"."void_reason")) > 0)),
	CONSTRAINT "periodic_interviews_month_check" CHECK (extract(day from "periodic_interviews"."period_month") = 1)
);
--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_interview_id_periodic_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."periodic_interviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_case_subjects" ADD CONSTRAINT "activity_case_subjects_case_id_activity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."activity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_case_subjects" ADD CONSTRAINT "activity_case_subjects_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_case_subjects" ADD CONSTRAINT "activity_case_subjects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_cases" ADD CONSTRAINT "activity_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_cases" ADD CONSTRAINT "activity_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_cases" ADD CONSTRAINT "activity_cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_cases" ADD CONSTRAINT "activity_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_report_recipients" ADD CONSTRAINT "activity_daily_report_recipients_report_id_activity_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."activity_daily_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_report_recipients" ADD CONSTRAINT "activity_daily_report_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_report_recipients" ADD CONSTRAINT "activity_daily_report_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_reports" ADD CONSTRAINT "activity_daily_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_reports" ADD CONSTRAINT "activity_daily_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_reports" ADD CONSTRAINT "activity_daily_reports_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_daily_reports" ADD CONSTRAINT "activity_daily_reports_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_case_id_activity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."activity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_interview_id_periodic_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."periodic_interviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_followups" ADD CONSTRAINT "activity_followups_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_handlers" ADD CONSTRAINT "activity_record_handlers_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_handlers" ADD CONSTRAINT "activity_record_handlers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_handlers" ADD CONSTRAINT "activity_record_handlers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_reads" ADD CONSTRAINT "activity_record_reads_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_reads" ADD CONSTRAINT "activity_record_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_reads" ADD CONSTRAINT "activity_record_reads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_recipients" ADD CONSTRAINT "activity_record_recipients_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_recipients" ADD CONSTRAINT "activity_record_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_recipients" ADD CONSTRAINT "activity_record_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_subjects" ADD CONSTRAINT "activity_record_subjects_record_id_activity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_subjects" ADD CONSTRAINT "activity_record_subjects_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_record_subjects" ADD CONSTRAINT "activity_record_subjects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_case_id_activity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."activity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_client_site_id_client_sites_id_fk" FOREIGN KEY ("client_site_id") REFERENCES "public"."client_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_client_company_id_client_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."client_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_revisions" ADD CONSTRAINT "activity_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_revisions" ADD CONSTRAINT "activity_revisions_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_case_id_activity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."activity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_source_record_id_activity_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."activity_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline_events" ADD CONSTRAINT "case_timeline_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interview_quarter_notes" ADD CONSTRAINT "periodic_interview_quarter_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interview_quarter_notes" ADD CONSTRAINT "periodic_interview_quarter_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interview_quarter_notes" ADD CONSTRAINT "periodic_interview_quarter_notes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_attachments_record_idx" ON "activity_attachments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "activity_attachments_interview_idx" ON "activity_attachments" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "activity_case_subjects_candidate_idx" ON "activity_case_subjects" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_cases_code_key" ON "activity_cases" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "activity_cases_org_status_idx" ON "activity_cases" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "activity_daily_report_recipients_user_idx" ON "activity_daily_report_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_daily_reports_author_date_key" ON "activity_daily_reports" USING btree ("author_id","report_date");--> statement-breakpoint
CREATE INDEX "activity_daily_reports_org_date_idx" ON "activity_daily_reports" USING btree ("organization_id","report_date");--> statement-breakpoint
CREATE INDEX "activity_followups_assignee_idx" ON "activity_followups" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "activity_followups_org_status_idx" ON "activity_followups" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "activity_record_recipients_user_idx" ON "activity_record_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_record_subjects_candidate_idx" ON "activity_record_subjects" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "activity_records_org_date_idx" ON "activity_records" USING btree ("organization_id","record_date");--> statement-breakpoint
CREATE INDEX "activity_records_author_date_idx" ON "activity_records" USING btree ("author_id","record_date");--> statement-breakpoint
CREATE INDEX "activity_records_case_idx" ON "activity_records" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "activity_revisions_entity_idx" ON "activity_revisions" USING btree ("entity_type","entity_id","version_no");--> statement-breakpoint
CREATE INDEX "case_timeline_events_case_idx" ON "case_timeline_events" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "periodic_quarter_notes_key" ON "periodic_interview_quarter_notes" USING btree ("candidate_id","fiscal_year","quarter");--> statement-breakpoint
CREATE UNIQUE INDEX "periodic_interviews_candidate_month_key" ON "periodic_interviews" USING btree ("candidate_id","period_month");--> statement-breakpoint
CREATE INDEX "periodic_interviews_org_month_idx" ON "periodic_interviews" USING btree ("organization_id","period_month");--> statement-breakpoint

-- ================= Catatan kegiatan TSK: RLS, trigger, penjaga =================
-- Anggota = TSK_ADMIN/TSK_STAFF di organisasi pemilik baris. LPK, sensei, super admin (jalur aplikasi), peran NULL, TSK lain: tanpa akses.
CREATE OR REPLACE FUNCTION activity_member(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(org = app_current_org() AND app_current_role() IN ('TSK_ADMIN', 'TSK_STAFF'), false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_current_role() = 'TSK_ADMIN', false)
$$;
--> statement-breakpoint
-- Pengguna harus staf TSK di organisasi yang sama (penulis, penanggung jawab tugas, penerima laporan, dst.)
CREATE OR REPLACE FUNCTION activity_assert_staff(org uuid, uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
BEGIN
  IF uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = uid AND organization_id = org AND role IN ('TSK_ADMIN', 'TSK_STAFF')) THEN
    RAISE EXCEPTION 'pengguna bukan staf TSK di organisasi ini' USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint
-- Catatan boleh diubah oleh penulis, pembuat, atau TSK_ADMIN, dan hanya selama belum dibatalkan.
CREATE OR REPLACE FUNCTION activity_record_editable(rid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM activity_records r WHERE r.id = rid AND r.status = 'active'
    AND activity_member(r.organization_id) AND (r.author_id = app_current_user() OR r.created_by = app_current_user() OR activity_is_admin()))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_case_editable(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM activity_cases c WHERE c.id = cid AND activity_member(c.organization_id) AND (c.created_by = app_current_user() OR activity_is_admin()))
$$;
--> statement-breakpoint

-- Penghitung kode kasus (K-<tahun>-<nomor> berurutan per organisasi per tahun). Hanya diakses fungsi trigger.
CREATE TABLE activity_case_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_no integer NOT NULL,
  PRIMARY KEY (organization_id, year)
);
--> statement-breakpoint
ALTER TABLE activity_case_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_case_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY activity_case_counters_system ON activity_case_counters USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_cases_before_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
DECLARE y integer; n integer; tz text;
BEGIN
  SELECT timezone INTO tz FROM organizations WHERE id = NEW.organization_id;
  y := extract(year FROM (NEW.opened_at AT TIME ZONE COALESCE(tz, 'Asia/Tokyo')));
  INSERT INTO activity_case_counters (organization_id, year, last_no) VALUES (NEW.organization_id, y, 1)
    ON CONFLICT (organization_id, year) DO UPDATE SET last_no = activity_case_counters.last_no + 1
    RETURNING last_no INTO n;
  NEW.code := 'K-' || y || '-' || lpad(n::text, 4, '0');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_cases_before_insert BEFORE INSERT ON activity_cases FOR EACH ROW EXECUTE FUNCTION activity_cases_before_insert();
--> statement-breakpoint

-- ----- Riwayat edit: ditulis trigger AFTER UPDATE, tidak bisa diubah/dihapus siapa pun (termasuk OWNER; TRUNCATE tidak dipicu)
CREATE OR REPLACE FUNCTION activity_revisions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_revisions bersifat append-only: riwayat tidak boleh diubah atau dihapus' USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_revisions_immutable BEFORE UPDATE OR DELETE ON activity_revisions FOR EACH ROW EXECUTE FUNCTION activity_revisions_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_write_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET app.bypass_rls = 'on' AS $$
DECLARE snap jsonb;
BEGIN
  snap := to_jsonb(OLD);
  IF TG_ARGV[0] = 'record' THEN
    -- himpunan terkait (pekerja, hadirin) pada saat SEBELUM edit: aplikasi mengubah baris catatan LEBIH DULU, baru himpunan terkait
    snap := snap || jsonb_build_object(
      'subject_ids', COALESCE((SELECT jsonb_agg(candidate_id ORDER BY candidate_id) FROM activity_record_subjects WHERE record_id = OLD.id), '[]'::jsonb),
      'handler_ids', COALESCE((SELECT jsonb_agg(user_id ORDER BY user_id) FROM activity_record_handlers WHERE record_id = OLD.id), '[]'::jsonb));
  END IF;
  INSERT INTO activity_revisions (organization_id, entity_type, entity_id, version_no, snapshot, edited_by)
  VALUES (OLD.organization_id, TG_ARGV[0], OLD.id, OLD.version_no, snap, app_current_user());
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE activity_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON activity_revisions TO hashi_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE activity_revisions_id_seq TO hashi_app;
--> statement-breakpoint
CREATE POLICY activity_revisions_read ON activity_revisions FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_revisions_insert_system ON activity_revisions FOR INSERT WITH CHECK (app_bypass_rls());
--> statement-breakpoint

-- ----- Penjaga ubah + versi (dipakai records, timeline, cases, periodic_interviews)
CREATE OR REPLACE FUNCTION activity_versioned_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j_old jsonb := to_jsonb(OLD); j_new jsonb := to_jsonb(NEW); k text;
BEGIN
  -- kolom identitas tidak boleh berubah
  FOREACH k IN ARRAY ARRAY['id', 'organization_id', 'created_by', 'created_at'] || (SELECT string_to_array(TG_ARGV[0], ',')) LOOP
    IF j_old -> k IS DISTINCT FROM j_new -> k THEN
      RAISE EXCEPTION 'kolom % tidak bisa diganti', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'activity_cases' THEN
    IF NEW.status = 'closed' AND OLD.status = 'open' THEN NEW.closed_at := now(); NEW.closed_by := app_current_user();
    ELSIF NEW.status = 'open' AND OLD.status = 'closed' THEN NEW.closed_at := NULL; NEW.closed_by := NULL; END IF;
  ELSE
    IF OLD.status = 'void' THEN
      RAISE EXCEPTION 'data yang dibatalkan tidak bisa diubah lagi' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'void' THEN NEW.voided_at := now(); NEW.voided_by := app_current_user(); END IF;
  END IF;
  NEW.version_no := OLD.version_no + 1;
  NEW.updated_at := now();
  NEW.updated_by := app_current_user();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_records_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id AND NOT activity_is_admin() THEN
    RAISE EXCEPTION 'penulis catatan hanya bisa diganti TSK_ADMIN' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM activity_assert_staff(NEW.organization_id, NEW.author_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_records_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activity_assert_staff(NEW.organization_id, NEW.author_id);
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER activity_records_a_guard BEFORE UPDATE ON activity_records FOR EACH ROW EXECUTE FUNCTION activity_records_guard();
--> statement-breakpoint
CREATE TRIGGER activity_records_b_version BEFORE UPDATE ON activity_records FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('kind');
--> statement-breakpoint
CREATE TRIGGER activity_records_c_revision AFTER UPDATE ON activity_records FOR EACH ROW EXECUTE FUNCTION activity_write_revision('record');
--> statement-breakpoint
CREATE TRIGGER activity_records_insert_guard BEFORE INSERT ON activity_records FOR EACH ROW EXECUTE FUNCTION activity_records_guard_insert();
--> statement-breakpoint
CREATE TRIGGER case_timeline_events_b_version BEFORE UPDATE ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('case_id');
--> statement-breakpoint
CREATE TRIGGER case_timeline_events_c_revision AFTER UPDATE ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION activity_write_revision('timeline_event');
--> statement-breakpoint
CREATE TRIGGER activity_cases_b_version BEFORE UPDATE ON activity_cases FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('code');
--> statement-breakpoint
CREATE TRIGGER activity_cases_c_revision AFTER UPDATE ON activity_cases FOR EACH ROW EXECUTE FUNCTION activity_write_revision('case');
--> statement-breakpoint
CREATE TRIGGER periodic_interviews_b_version BEFORE UPDATE ON periodic_interviews FOR EACH ROW EXECUTE FUNCTION activity_versioned_before_update('candidate_id,period_month');
--> statement-breakpoint
CREATE TRIGGER periodic_interviews_c_revision AFTER UPDATE ON periodic_interviews FOR EACH ROW EXECUTE FUNCTION activity_write_revision('periodic_interview');
--> statement-breakpoint

-- Satu wawancara aktif per (pekerja, bulan): yang dibatalkan tidak menghalangi isian ulang
DROP INDEX periodic_interviews_candidate_month_key;
--> statement-breakpoint
CREATE UNIQUE INDEX periodic_interviews_candidate_month_key ON periodic_interviews (candidate_id, period_month) WHERE status = 'active';
--> statement-breakpoint

-- ----- Penjaga tabel kecil
CREATE OR REPLACE FUNCTION activity_followups_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j_old jsonb := to_jsonb(OLD); j_new jsonb := to_jsonb(NEW); k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['id','organization_id','created_by','created_at','record_id','case_id','interview_id','description','assignee_id','due_date'] LOOP
    IF j_old -> k IS DISTINCT FROM j_new -> k THEN RAISE EXCEPTION 'hanya status tugas yang bisa diubah' USING ERRCODE = 'check_violation'; END IF;
  END LOOP;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'tugas yang sudah selesai atau dibatalkan tidak bisa diubah lagi' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> 'open' THEN NEW.done_at := now(); NEW.done_by := app_current_user(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_followups_guard BEFORE UPDATE ON activity_followups FOR EACH ROW EXECUTE FUNCTION activity_followups_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_followups_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activity_assert_staff(NEW.organization_id, NEW.assignee_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_followups_guard_insert BEFORE INSERT ON activity_followups FOR EACH ROW EXECUTE FUNCTION activity_followups_guard_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_attachments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j_old jsonb := to_jsonb(OLD); j_new jsonb := to_jsonb(NEW); k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['id','organization_id','created_by','created_at','record_id','interview_id','mime','size_bytes','original_name'] LOOP
    IF j_old -> k IS DISTINCT FROM j_new -> k THEN RAISE EXCEPTION 'hanya keterangan, sertakan-di-PDF, dan penandaan hapus yang bisa diubah' USING ERRCODE = 'check_violation'; END IF;
  END LOOP;
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removed_by IS DISTINCT FROM OLD.removed_by) THEN
    RAISE EXCEPTION 'lampiran yang sudah disembunyikan tidak bisa dipulihkan lewat aplikasi' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN NEW.removed_by := app_current_user(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_attachments_guard BEFORE UPDATE ON activity_attachments FOR EACH ROW EXECUTE FUNCTION activity_attachments_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_daily_reports_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.report_date IS DISTINCT FROM OLD.report_date OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'hanya waktu pengiriman laporan yang bisa diubah' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.shared_at IS DISTINCT FROM OLD.shared_at THEN NEW.shared_by := app_current_user(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_daily_reports_guard BEFORE UPDATE ON activity_daily_reports FOR EACH ROW EXECUTE FUNCTION activity_daily_reports_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_daily_recipients_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.report_id IS DISTINCT FROM OLD.report_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'hanya tanda baca yang bisa diubah' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_daily_recipients_guard BEFORE UPDATE ON activity_daily_report_recipients FOR EACH ROW EXECUTE FUNCTION activity_daily_recipients_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION activity_recipient_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM activity_assert_staff(NEW.organization_id, NEW.user_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER activity_record_recipients_user BEFORE INSERT ON activity_record_recipients FOR EACH ROW EXECUTE FUNCTION activity_recipient_user_guard();
--> statement-breakpoint
CREATE TRIGGER activity_record_handlers_user BEFORE INSERT ON activity_record_handlers FOR EACH ROW EXECUTE FUNCTION activity_recipient_user_guard();
--> statement-breakpoint
CREATE TRIGGER activity_daily_recipients_user BEFORE INSERT ON activity_daily_report_recipients FOR EACH ROW EXECUTE FUNCTION activity_recipient_user_guard();
--> statement-breakpoint

-- ----- GRANT + RLS + policy (semua tabel: FORCE RLS)
GRANT SELECT, INSERT, UPDATE ON activity_cases, activity_records, activity_daily_reports, activity_daily_report_recipients, periodic_interviews, periodic_interview_quarter_notes, case_timeline_events, activity_attachments, activity_followups, activity_record_reads TO hashi_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON activity_case_subjects, activity_record_subjects, activity_record_handlers, activity_record_recipients TO hashi_app;
--> statement-breakpoint
ALTER TABLE activity_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_cases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_case_subjects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_case_subjects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_subjects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_subjects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_handlers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_handlers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_recipients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_record_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_daily_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_daily_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_daily_report_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_daily_report_recipients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periodic_interviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periodic_interviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periodic_interview_quarter_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periodic_interview_quarter_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE case_timeline_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE case_timeline_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_followups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- cases
CREATE POLICY activity_cases_read ON activity_cases FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_cases_insert ON activity_cases FOR INSERT WITH CHECK (activity_member(organization_id) AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY activity_cases_update ON activity_cases FOR UPDATE
  USING (activity_member(organization_id) AND (created_by = app_current_user() OR activity_is_admin()))
  WITH CHECK (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_case_subjects_read ON activity_case_subjects FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_case_subjects_insert ON activity_case_subjects FOR INSERT
  WITH CHECK (activity_member(organization_id) AND activity_case_editable(case_id) AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_id));
--> statement-breakpoint
CREATE POLICY activity_case_subjects_delete ON activity_case_subjects FOR DELETE USING (activity_member(organization_id) AND activity_case_editable(case_id));
--> statement-breakpoint
-- records
CREATE POLICY activity_records_read ON activity_records FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_records_insert ON activity_records FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user() AND (author_id = app_current_user() OR activity_is_admin())
    AND (case_id IS NULL OR EXISTS (SELECT 1 FROM activity_cases c WHERE c.id = case_id)));
--> statement-breakpoint
CREATE POLICY activity_records_update ON activity_records FOR UPDATE
  USING (activity_member(organization_id) AND status = 'active' AND (author_id = app_current_user() OR created_by = app_current_user() OR activity_is_admin()))
  WITH CHECK (activity_member(organization_id) AND (case_id IS NULL OR EXISTS (SELECT 1 FROM activity_cases c WHERE c.id = case_id)));
--> statement-breakpoint
CREATE POLICY activity_record_subjects_read ON activity_record_subjects FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_record_subjects_insert ON activity_record_subjects FOR INSERT
  WITH CHECK (activity_member(organization_id) AND activity_record_editable(record_id) AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_id));
--> statement-breakpoint
CREATE POLICY activity_record_subjects_delete ON activity_record_subjects FOR DELETE USING (activity_member(organization_id) AND activity_record_editable(record_id));
--> statement-breakpoint
CREATE POLICY activity_record_handlers_read ON activity_record_handlers FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_record_handlers_insert ON activity_record_handlers FOR INSERT WITH CHECK (activity_member(organization_id) AND activity_record_editable(record_id));
--> statement-breakpoint
CREATE POLICY activity_record_handlers_delete ON activity_record_handlers FOR DELETE USING (activity_member(organization_id) AND activity_record_editable(record_id));
--> statement-breakpoint
CREATE POLICY activity_record_recipients_read ON activity_record_recipients FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_record_recipients_insert ON activity_record_recipients FOR INSERT WITH CHECK (activity_member(organization_id) AND activity_record_editable(record_id));
--> statement-breakpoint
CREATE POLICY activity_record_recipients_delete ON activity_record_recipients FOR DELETE USING (activity_member(organization_id) AND activity_record_editable(record_id));
--> statement-breakpoint
-- tanda baca: hanya user itu sendiri yang menulis (semua staf melihat siapa yang sudah membaca)
CREATE POLICY activity_record_reads_read ON activity_record_reads FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_record_reads_insert ON activity_record_reads FOR INSERT
  WITH CHECK (activity_member(organization_id) AND user_id = app_current_user() AND EXISTS (SELECT 1 FROM activity_records r WHERE r.id = record_id));
--> statement-breakpoint
CREATE POLICY activity_record_reads_update ON activity_record_reads FOR UPDATE
  USING (activity_member(organization_id) AND user_id = app_current_user()) WITH CHECK (activity_member(organization_id) AND user_id = app_current_user());
--> statement-breakpoint
-- laporan harian: dibuat dan dikirim hanya oleh penulisnya; penerima menulis tanda baca sendiri
CREATE POLICY activity_daily_reports_read ON activity_daily_reports FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_daily_reports_insert ON activity_daily_reports FOR INSERT
  WITH CHECK (activity_member(organization_id) AND author_id = app_current_user() AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY activity_daily_reports_update ON activity_daily_reports FOR UPDATE
  USING (activity_member(organization_id) AND author_id = app_current_user()) WITH CHECK (activity_member(organization_id) AND author_id = app_current_user());
--> statement-breakpoint
CREATE POLICY activity_daily_recipients_read ON activity_daily_report_recipients FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_daily_recipients_insert ON activity_daily_report_recipients FOR INSERT
  WITH CHECK (activity_member(organization_id) AND EXISTS (SELECT 1 FROM activity_daily_reports r WHERE r.id = report_id AND r.author_id = app_current_user()));
--> statement-breakpoint
CREATE POLICY activity_daily_recipients_update ON activity_daily_report_recipients FOR UPDATE
  USING (activity_member(organization_id) AND user_id = app_current_user()) WITH CHECK (activity_member(organization_id) AND user_id = app_current_user());
--> statement-breakpoint
-- wawancara berkala: semua staf TSK membaca dan mengisi/mengubah; riwayat otomatis (trigger)
CREATE POLICY periodic_interviews_read ON periodic_interviews FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY periodic_interviews_insert ON periodic_interviews FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user() AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_id));
--> statement-breakpoint
CREATE POLICY periodic_interviews_update ON periodic_interviews FOR UPDATE USING (activity_member(organization_id) AND status = 'active') WITH CHECK (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY periodic_quarter_notes_read ON periodic_interview_quarter_notes FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY periodic_quarter_notes_insert ON periodic_interview_quarter_notes FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user() AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = candidate_id));
--> statement-breakpoint
CREATE POLICY periodic_quarter_notes_update ON periodic_interview_quarter_notes FOR UPDATE USING (activity_member(organization_id)) WITH CHECK (activity_member(organization_id));
--> statement-breakpoint
-- kronologi
CREATE POLICY case_timeline_read ON case_timeline_events FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY case_timeline_insert ON case_timeline_events FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user() AND EXISTS (SELECT 1 FROM activity_cases c WHERE c.id = case_id));
--> statement-breakpoint
CREATE POLICY case_timeline_update ON case_timeline_events FOR UPDATE
  USING (activity_member(organization_id) AND status = 'active' AND (created_by = app_current_user() OR activity_is_admin())) WITH CHECK (activity_member(organization_id));
--> statement-breakpoint
-- lampiran (hanya metadata; berkas di penyimpanan privat)
CREATE POLICY activity_attachments_read ON activity_attachments FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_attachments_insert ON activity_attachments FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user()
    AND ((record_id IS NOT NULL AND EXISTS (SELECT 1 FROM activity_records r WHERE r.id = record_id)) OR (interview_id IS NOT NULL AND EXISTS (SELECT 1 FROM periodic_interviews p WHERE p.id = interview_id))));
--> statement-breakpoint
CREATE POLICY activity_attachments_update ON activity_attachments FOR UPDATE
  USING (activity_member(organization_id) AND (created_by = app_current_user() OR activity_is_admin())) WITH CHECK (activity_member(organization_id));
--> statement-breakpoint
-- tugas tindak lanjut: status diubah penanggung jawab, pembuat, atau TSK_ADMIN
CREATE POLICY activity_followups_read ON activity_followups FOR SELECT USING (activity_member(organization_id));
--> statement-breakpoint
CREATE POLICY activity_followups_insert ON activity_followups FOR INSERT
  WITH CHECK (activity_member(organization_id) AND created_by = app_current_user()
    AND (record_id IS NULL OR EXISTS (SELECT 1 FROM activity_records r WHERE r.id = record_id))
    AND (case_id IS NULL OR EXISTS (SELECT 1 FROM activity_cases c WHERE c.id = case_id))
    AND (interview_id IS NULL OR EXISTS (SELECT 1 FROM periodic_interviews p WHERE p.id = interview_id)));
--> statement-breakpoint
CREATE POLICY activity_followups_update ON activity_followups FOR UPDATE
  USING (activity_member(organization_id) AND (assignee_id = app_current_user() OR created_by = app_current_user() OR activity_is_admin()))
  WITH CHECK (activity_member(organization_id));
--> statement-breakpoint

-- ----- Hapus kandidat: tolak bila ada catatan kegiatan (FK sudah RESTRICT; ini memberi pesan yang jelas lewat alur yang ada)
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
    OR EXISTS (SELECT 1 FROM periodic_interview_quarter_notes WHERE candidate_id = OLD.id) THEN
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
  );
END
$$;
