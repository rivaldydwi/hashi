ALTER TABLE "client_companies" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "client_companies" ADD COLUMN "employee_count" integer;--> statement-breakpoint
ALTER TABLE "client_companies" ADD COLUMN "foreign_worker_experience" text;--> statement-breakpoint
ALTER TABLE "client_companies" ADD COLUMN "public_intro" text;--> statement-breakpoint
ALTER TABLE "client_sites" ADD COLUMN "access_note" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "work_hours" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "days_off" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "housing" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "housing_note" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "commute_note" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "benefits_note" text;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_employee_count_check" CHECK ("client_companies"."employee_count" is null or "client_companies"."employee_count" >= 0);--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_housing_check" CHECK ("job_orders"."housing" is null or "job_orders"."housing" in ('provided', 'allowance', 'none', 'unspecified'));