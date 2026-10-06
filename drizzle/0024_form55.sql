ALTER TABLE "periodic_interviews" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD COLUMN "responder_role" text;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD COLUMN "responder_title" text;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD COLUMN "form55" jsonb;--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_method_check" CHECK ("periodic_interviews"."method" is null or "periodic_interviews"."method" in ('in_person','online'));--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_responder_role_check" CHECK ("periodic_interviews"."responder_role" is null or "periodic_interviews"."responder_role" in ('support_manager','support_staff'));--> statement-breakpoint
ALTER TABLE "periodic_interviews" ADD CONSTRAINT "periodic_interviews_form55_size_check" CHECK ("periodic_interviews"."form55" is null or length("periodic_interviews"."form55"::text) <= 20000);