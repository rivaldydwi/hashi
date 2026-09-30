-- ============================================================================
-- Hashi — aturan data pengguna & kemitraan yang dijaga langsung oleh database
--
-- Aplikasi sudah memvalidasi hal yang sama, tapi aturan di sini adalah jaring
-- pengaman: bug di aplikasi pun tidak bisa, misalnya, membuat admin LPK
-- menjadi SUPER_ADMIN (eskalasi hak akses).
-- ============================================================================

-- Peran harus sesuai jenis organisasi:
--   PLATFORM -> SUPER_ADMIN
--   LPK      -> LPK_ADMIN, LPK_SENSEI
--   TSK      -> TSK_ADMIN, TSK_STAFF
-- SECURITY DEFINER supaya pengecekan jenis organisasi tidak terhalang RLS.
CREATE OR REPLACE FUNCTION enforce_user_role_matches_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org_kind org_type;
BEGIN
  SELECT type INTO org_kind FROM organizations WHERE id = NEW.organization_id;
  IF org_kind IS NULL THEN
    RAISE EXCEPTION 'organisasi % tidak ditemukan', NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT (
    (org_kind = 'PLATFORM' AND NEW.role = 'SUPER_ADMIN')
    OR (org_kind = 'LPK' AND NEW.role IN ('LPK_ADMIN', 'LPK_SENSEI'))
    OR (org_kind = 'TSK' AND NEW.role IN ('TSK_ADMIN', 'TSK_STAFF'))
  ) THEN
    RAISE EXCEPTION 'peran % tidak diizinkan untuk organisasi jenis %', NEW.role, org_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER users_role_matches_org
  BEFORE INSERT OR UPDATE OF role, organization_id ON users
  FOR EACH ROW EXECUTE FUNCTION enforce_user_role_matches_org();
--> statement-breakpoint

-- Kemitraan harus LPK (lpk_id) dengan TSK (tsk_id), bukan kombinasi lain.
CREATE OR REPLACE FUNCTION enforce_partnership_types() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT type FROM organizations WHERE id = NEW.lpk_id) IS DISTINCT FROM 'LPK'
     OR (SELECT type FROM organizations WHERE id = NEW.tsk_id) IS DISTINCT FROM 'TSK' THEN
    RAISE EXCEPTION 'kemitraan harus antara LPK dan TSK'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER partnerships_types_check
  BEFORE INSERT OR UPDATE OF lpk_id, tsk_id ON partnerships
  FOR EACH ROW EXECUTE FUNCTION enforce_partnership_types();
--> statement-breakpoint

-- Jenis organisasi tidak boleh diubah setelah dibuat (peran pengguna bergantung padanya).
CREATE OR REPLACE FUNCTION prevent_org_type_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'jenis organisasi tidak bisa diubah'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organizations_type_immutable
  BEFORE UPDATE OF type ON organizations
  FOR EACH ROW EXECUTE FUNCTION prevent_org_type_change();
--> statement-breakpoint

-- Email selalu disimpan huruf kecil supaya tidak ada akun ganda "Budi@..." vs "budi@...".
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
