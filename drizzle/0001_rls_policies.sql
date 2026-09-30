-- ============================================================================
-- Hashi — Row-Level Security
--
-- Aplikasi terhubung sebagai role `hashi_app` (tanpa BYPASSRLS).
-- Setiap request membuka transaksi dan mengisi dua variabel sesi:
--   app.org_id      -> UUID organisasi user yang login
--   app.bypass_rls  -> 'on' hanya untuk operasi sistem (login, super admin)
-- Lihat src/db/index.ts (withTenant / withSystem).
--
-- ATURAN UNTUK TABEL BARU: tidak ada GRANT otomatis. Setiap tabel baru wajib
-- di-GRANT ke hashi_app, di-ENABLE + FORCE RLS, dan diberi policy di migration.
-- Tanpa itu, aplikasi tidak bisa membaca tabelnya (gagal dengan aman).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hashi_app') THEN
    -- Password di-set oleh docker/postgres/init. Blok ini hanya jaga-jaga.
    CREATE ROLE hashi_app LOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO hashi_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, partnerships, users, candidates TO hashi_app;
--> statement-breakpoint
-- Audit log hanya boleh ditambah, tidak boleh diubah/dihapus oleh aplikasi.
GRANT SELECT, INSERT ON audit_logs TO hashi_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO hashi_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Fungsi helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on'
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Aktifkan RLS (FORCE: berlaku juga untuk pemilik tabel non-superuser)
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE partnerships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partnerships: kedua pihak bisa melihat kemitraannya; ubah hanya oleh sistem
-- ---------------------------------------------------------------------------
CREATE POLICY partnerships_read ON partnerships FOR SELECT
  USING (app_bypass_rls() OR lpk_id = app_current_org() OR tsk_id = app_current_org());
--> statement-breakpoint
CREATE POLICY partnerships_system_write ON partnerships FOR ALL
  USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- organizations: organisasi sendiri + mitranya; ubah hanya oleh sistem
-- ---------------------------------------------------------------------------
CREATE POLICY organizations_read ON organizations FOR SELECT
  USING (
    app_bypass_rls()
    OR id = app_current_org()
    OR EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active
        AND (
          (p.lpk_id = organizations.id AND p.tsk_id = app_current_org())
          OR (p.tsk_id = organizations.id AND p.lpk_id = app_current_org())
        )
    )
  );
--> statement-breakpoint
CREATE POLICY organizations_system_write ON organizations FOR ALL
  USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- users: hanya pengguna di organisasi sendiri
-- ---------------------------------------------------------------------------
CREATE POLICY users_own_org ON users FOR ALL
  USING (app_bypass_rls() OR organization_id = app_current_org())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_org());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- candidates:
--   1. LPK pemilik: akses penuh ke kandidatnya sendiri
--   2. TSK mitra: hanya BACA, dan hanya kandidat yang sudah lewat tahap STUDYING
-- ---------------------------------------------------------------------------
CREATE POLICY candidates_own_org ON candidates FOR ALL
  USING (app_bypass_rls() OR organization_id = app_current_org())
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_org());
--> statement-breakpoint
CREATE POLICY candidates_partner_read ON candidates FOR SELECT
  USING (
    stage <> 'STUDYING'
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.active
        AND p.lpk_id = candidates.organization_id
        AND p.tsk_id = app_current_org()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_logs: baca & tulis hanya untuk organisasi sendiri (append-only via GRANT)
-- ---------------------------------------------------------------------------
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT
  USING (app_bypass_rls() OR organization_id = app_current_org());
--> statement-breakpoint
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (app_bypass_rls() OR organization_id = app_current_org());
