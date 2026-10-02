ALTER TABLE "audit_logs" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_org_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "timezone" text DEFAULT 'Asia/Jakarta' NOT NULL;--> statement-breakpoint

-- Zona waktu organisasi: TSK di Jepang, selebihnya Jakarta (bawaan kolom). Bentuk dicek sederhana (nama IANA); aplikasi memvalidasi lagi dengan Intl.
UPDATE organizations SET timezone = 'Asia/Tokyo' WHERE type = 'TSK';
--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_timezone_check CHECK (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$');
--> statement-breakpoint

-- Isi potret pelaku untuk entri lama (sebelum kolom ada), dari data saat ini. Nama orang hanya untuk entri satu organisasi (bukan lintas organisasi).
UPDATE audit_logs a SET
  actor_role = u.role::text,
  actor_org_name = o.name,
  actor_name = CASE WHEN a.actor_org_id IS NOT DISTINCT FROM a.organization_id THEN u.name ELSE NULL END
FROM users u JOIN organizations o ON o.id = u.organization_id
WHERE a.actor_user_id = u.id;
--> statement-breakpoint

-- Entri audit IMMUTABLE: tidak bisa diubah atau dihapus oleh siapa pun (termasuk OWNER). TRUNCATE (db:seed --reset) sengaja tidak dipicu.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs bersifat append-only: entri tidak boleh diubah atau dihapus' USING ERRCODE = 'check_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint

-- Membaca riwayat aktivitas: hanya LPK_ADMIN dan TSK_ADMIN (sensei dan staf TSK tidak). Cakupan tetap: log yang disimpan di organisasi sesi
-- (LPK pemilik melihat perubahan kandidatnya, termasuk oleh TSK) ATAU yang pelakunya organisasi sesi (TSK melihat aksinya sendiri).
-- COALESCE: peran NULL harus jatuh ke FALSE.
DROP POLICY audit_logs_read ON audit_logs;
--> statement-breakpoint
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (
    app_bypass_rls()
    OR (
      COALESCE(app_current_role() IN ('LPK_ADMIN', 'TSK_ADMIN'), false)
      AND (organization_id = app_current_org() OR actor_org_id = app_current_org())
    )
  );
