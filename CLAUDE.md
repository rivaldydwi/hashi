# Hashi — panduan untuk Claude Code

Hashi (橋) = SaaS profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Pemilik: Ipal. Jelaskan dengan Bahasa Indonesia santai tapi solid; komentar kode & pesan commit juga Bahasa Indonesia.

- Kebutuhan: https://claude.ai/code/artifact/78f405ee-32e2-48da-844b-41bbbd6bc458
- Spesifikasi MVP: https://claude.ai/code/artifact/ccb56ab1-128a-402b-9c37-b4f78ac52e28

## Status (urutan pengerjaan dari spesifikasi MVP)

1. ✅ Fondasi: login, i18n ID/JP, multi-tenant RLS, Docker, CI
2. ✅ Kelola organisasi, pengguna, kemitraan (v0.2)
3. ⏭ **Profil kandidat**: form lengkap + unggah dokumen + halaman detail + log perubahan
4. Penilaian bulanan · 5. Seleksi (job order, shortlist) · 6. Lembar client PDF (bahasa Jepang)
7. Pengingat dokumen kedaluwarsa · 8. Siap pilot (dummy 200 siswa) · 9. Demo ke TSK

Keputusan terbuka untuk langkah 3: penyimpanan file dokumen (MinIO / alternatif S3-compatible) —
cek dulu status image Docker MinIO community sebelum memilih.

## Perintah

```bash
npm run dev            # http://localhost:3100 (butuh DATABASE_URL & MIGRATE_DATABASE_URL di .env)
npm run typecheck
npm run build
npm run db:generate    # setelah mengubah src/db/schema.ts
npm run db:migrate     # role OWNER
npm run db:seed        # data demo; `-- --reset` untuk mengisi ulang
npm run test:rls       # 25+ aturan database (aman, di-rollback)
npm run test:e2e       # tes browser; MENAMBAH data uji -> jalankan di database dev saja
```

Production di OptiPlex: `docker compose up -d --build` (migration otomatis lewat service `migrate`).
Port 3100 dipakai aplikasi lain di OptiPlex → Hashi memakai `APP_PORT=3110`.

### Database development (jangan mengotori data demo production)

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db     # buka Postgres di 127.0.0.1:5433
docker compose exec db psql -U hashi_owner -d postgres -c "CREATE DATABASE hashi_dev"
# .env untuk npm run dev / test:
# DATABASE_URL=postgresql://hashi_app:<DB_APP_PASSWORD>@127.0.0.1:5433/hashi_dev
# MIGRATE_DATABASE_URL=postgresql://hashi_owner:<DB_OWNER_PASSWORD>@127.0.0.1:5433/hashi_dev
npm run db:migrate && npm run db:seed
npx playwright install --with-deps chromium   # sekali, untuk test:e2e
```

## Batasan server

OptiPlex bukan server khusus Hashi — ada layanan lain yang jalan di sana:
Actual Budget, OpenClaw, monitoring, dan micro-habit.

- Jangan hentikan, ubah, atau hapus container, volume, atau network di luar project compose `hashi`.
- Jangan jalankan `docker system prune` atau `docker volume rm` tanpa izin Ipal.

## Aturan arsitektur (WAJIB)

- **Akses data tenant selalu lewat `withTenant(orgId, tx => …)` / `tenantQuery()`**. `withSystem()` hanya
  untuk login, super admin, worker terjadwal, seed. Aplikasi terhubung sebagai `hashi_app` (tanpa BYPASSRLS).
- **Tabel baru** = migration Drizzle + migration SQL manual (`npx drizzle-kit generate --custom --name …`) berisi
  `GRANT … TO hashi_app`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy. Tambah pemeriksaan di
  `scripts/verify-rls.ts`. Tidak ada GRANT otomatis — sengaja, supaya gagal dengan aman.
- Aturan penting dijaga juga oleh trigger DB (lihat `drizzle/0003_user_role_guards.sql`), bukan hanya di app.
- Cek user login lewat `requireUser()` / `requireRole()` (`src/lib/session.ts`): dibaca dari DB setiap request.
- Server action: validasi dengan zod, kembalikan `FormState` dengan `key` = kunci pesan lengkap
  (mis. `"users.errors.emailTaken"`), tangani error lewat `ActionError`. Catat perubahan dengan `audit()`
  dalam transaksi yang sama. Jangan pernah mengembalikan/mencatat hash kata sandi.
- Struktur fitur: `src/features/<fitur>/{actions,queries,Komponen}.ts(x)`; halaman di `src/app/(app)/…`.
- **i18n**: setiap teks UI ada di `messages/id.json` DAN `messages/ja.json` dengan kunci identik.
  Istilah Jepang: TSK = 登録支援機関, 面談, 入管.
- Peran per jenis organisasi ada di `src/lib/permissions.ts` (sama dengan trigger DB).

## Jebakan yang sudah pernah terjadi

- Drizzle menulis kolom tabel utama tanpa nama tabel (`"id"`) di dalam `sql\`…\``. Jangan pakai subquery
  berkorelasi di `select({...})`; pakai GROUP BY terpisah (lihat `src/db/queries.ts`).
- Tes yang hanya menghitung baris tidak cukup — cek angka/isinya juga.
- `test:e2e` menjalankan build standalone lewat `scripts/serve-standalone.mjs`; `npm run build` dulu.

## Alur kerja

1. Kerjakan satu langkah → `npm run typecheck && npm run test:rls && npm run build && npm run test:e2e`
2. Commit (Bahasa Indonesia) → `git push` → CI (GitHub Actions) harus hijau
3. Deploy di OptiPlex: `git pull && docker compose up -d --build`
