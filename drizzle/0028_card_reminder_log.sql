CREATE TABLE "card_reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_reminder_log_stage_check" CHECK ("card_reminder_log"."stage" in ('prepare','can_apply','h30','h14','h7','expired','special_overdue','rejected','additional_docs'))
);
--> statement-breakpoint
ALTER TABLE "residence_card_secrets" DROP CONSTRAINT "residence_card_secrets_enc_check";--> statement-breakpoint
ALTER TABLE "card_reminder_log" ADD CONSTRAINT "card_reminder_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reminder_log" ADD CONSTRAINT "card_reminder_log_card_id_residence_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."residence_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_reminder_log" ADD CONSTRAINT "card_reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_reminder_log_once_key" ON "card_reminder_log" USING btree ("card_id","stage","user_id");--> statement-breakpoint
CREATE INDEX "card_reminder_log_org_idx" ON "card_reminder_log" USING btree ("organization_id","sent_on");--> statement-breakpoint
ALTER TABLE "residence_card_secrets" ADD CONSTRAINT "residence_card_secrets_enc_check" CHECK ("residence_card_secrets"."number_enc" like 'hcd1:%');--> statement-breakpoint
-- ================= Log pengiriman pengingat 在留カード (T-022): hanya jalur sistem =================
-- Dibaca/ditulis worker pengingat lewat withSystem (app.bypass_rls = 'on'). Peran aplikasi biasa (TSK/LPK/sensei/super admin/null) tidak punya policy, jadi 0 baris dan tulis ditolak.
GRANT SELECT, INSERT ON card_reminder_log TO hashi_app;
--> statement-breakpoint
ALTER TABLE card_reminder_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_reminder_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_reminder_log_system ON card_reminder_log FOR ALL USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
