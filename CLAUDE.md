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

Keputusan penyimpanan file dokumen (langkah 3): **Docker named volume di disk**, bukan object storage.
MinIO dicoret — image community dihentikan (Okt 2025), `minio/minio` & `minio/mc` dihapus dari Docker Hub
(11 Sep 2026), repo diarsipkan. Cadangan bila suatu saat butuh S3 API: Garage atau SeaweedFS.
File disimpan dengan nama = `document_id` (bukan nama asli dari user); unduh lewat route handler yang dicek
RLS + dicatat di `audit_logs` (`document.download`), `Content-Disposition: attachment`. Batas 10 MB,
hanya PDF/JPG/PNG (dicek dari magic bytes, dan oleh CHECK di tabel `candidate_documents`).

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

- **Akses data tenant selalu lewat `withTenant(orgId, role, tx => …)` / `tenantQuery()`**. `withSystem()` hanya
  untuk login, super admin, worker terjadwal, seed. Aplikasi terhubung sebagai `hashi_app` (tanpa BYPASSRLS).
  `role` mengisi `app.role` untuk policy RLS; `null` = peran tidak dikenal (ditolak untuk data sensitif dan
  semua penulisan kandidat). Pakai `null` hanya untuk tabel yang tidak bergantung peran (mis. baris `users`).
- **Hak akses kandidat** (dijaga RLS + trigger, lihat `drizzle/0005_candidate_profile_rls.sql`):
  LPK_ADMIN baca+tulis semua; LPK_SENSEI hanya profil dasar (tanpa `candidate_private`, keluarga, dokumen).
  TSK mitra membaca kandidat di SEMUA tahap, tetapi hanya yang `data_consent_date IS NOT NULL` (tanpa itu hanya
  LPK pemilik yang melihat). TSK boleh mengubah kolom `stage` di tahap apa pun (lewat server action khusus
  `changeStage` yang hanya menyentuh stage + audit dari/ke/siapa); kolom lain, `candidate_private`, dan dokumen
  HANYA saat stage IN (`PASSED_CLIENT_INTERVIEW`, `DOCUMENT_PROCESS`, `DEPARTED`) — daftar IN eksplisit, JANGAN
  `stage >= …` (WITHDRAWN paling akhir di enum). Dijaga trigger BEFORE UPDATE (`candidates`, `candidate_private`)
  yang menilai stage baris LAMA. Form tambah kandidat mewajibkan tanggal persetujuan (aturan di aplikasi;
  database tidak lagi menolak READY tanpa persetujuan — kandidat itu hanya tak terlihat TSK).
  Seed sengaja menyisakan 1 kandidat tanpa persetujuan (`NO_CONSENT` di `scripts/seed.ts`), jadi TSK demo melihat 23 dari 24.
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
- Error di tengah transaksi membatalkan seluruh transaksi. Di tes RLS, bungkus perintah yang DIHARAPKAN gagal
  dengan `attempt()` (savepoint) dan jalankan tes yang menulis di dalam `sandbox()` (selalu di-rollback).
- Urutan eksekusi Postgres saat UPDATE: trigger BEFORE jalan lebih dulu, baru `WITH CHECK` RLS. Jadi pesan
  error bisa berasal dari trigger, bukan dari policy.
- Tes RLS yang meng-UPDATE ke nilai yang sama = bukan perubahan, jadi trigger penjaga tidak menolaknya. Pakai
  nilai baru di tiap percobaan (`uniq()` di `verify-rls.ts`).
- Trigger penjaga TSK bisa diuji tanpa policy: `actAsTriggerOnly()` (bypass RLS + `app.role` TSK).
- `test:e2e` menjalankan build standalone lewat `scripts/serve-standalone.mjs`; `npm run build` dulu.

## Alur kerja

1. Kerjakan satu langkah → `npm run typecheck && npm run test:rls && npm run build && npm run test:e2e`
2. Commit (Bahasa Indonesia) → `git push` → CI (GitHub Actions) harus hijau
3. Deploy di OptiPlex: `git pull && docker compose up -d --build`
