# Hashi — panduan untuk Claude Code

Hashi (橋) = SaaS profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Pemilik: Ipal. Jelaskan dengan Bahasa Indonesia santai tapi solid; komentar kode & pesan commit juga Bahasa Indonesia.

- Kebutuhan: https://claude.ai/code/artifact/78f405ee-32e2-48da-844b-41bbbd6bc458
- Spesifikasi MVP: https://claude.ai/code/artifact/ccb56ab1-128a-402b-9c37-b4f78ac52e28

## Status (urutan pengerjaan dari spesifikasi MVP)

1. ✅ Fondasi: login, i18n ID/JP, multi-tenant RLS, Docker, CI
2. ✅ Kelola organisasi, pengguna, kemitraan (v0.2)
3. ✅ **Profil kandidat**: daftar, tambah, halaman detail, keputusan & catatan TSK, persetujuan data, dokumen, audit
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
npm run test:rls       # 90+ aturan database; HANYA terhadap db-dev/test (bergantung isi seed), bukan produksi
npm run test:i18n      # kunci id == ja, dan setiap kolom di sections.ts punya label
npm run test:e2e       # tes browser; MENAMBAH data uji -> jalankan di database dev saja
```

Production di OptiPlex: `docker compose up -d --build` (migration otomatis lewat service `migrate`).
Port 3100 dipakai aplikasi lain di OptiPlex → Hashi memakai `APP_PORT=3110`.

### Database development (jangan mengotori data demo production)

Postgres dev adalah service TERPISAH `db-dev` (container, volume, dan port 127.0.0.1:5433 sendiri), jadi deploy
produksi (`docker compose up -d --build`) tidak memutus atau menyentuhnya, dan sebaliknya.

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev     # hanya menjalankan db-dev
# .env untuk npm run dev / test (database HARUS berakhiran _dev atau _test):
# DATABASE_URL=postgresql://hashi_app:<DB_APP_PASSWORD>@127.0.0.1:5433/hashi_dev
# MIGRATE_DATABASE_URL=postgresql://hashi_owner:<DB_OWNER_PASSWORD>@127.0.0.1:5433/hashi_dev
npm run db:migrate && npm run db:seed
npx playwright install --with-deps chromium   # sekali, untuk test:e2e
```

**Pengaman** (`scripts/db-guard.ts`): `test:e2e`, `test:rls`, dan `db:seed -- --reset` menolak jalan bila nama database di
`DATABASE_URL` / `MIGRATE_DATABASE_URL` tidak berakhiran `_dev` / `_test`. Disengaja? `ALLOW_DESTRUCTIVE_DB=1`.
CI memakai database `hashi_test`. Jangan pernah mengarahkan `.env` ke database `hashi` (produksi).

### Menjalankan test:rls dari OptiPlex (image tools, terhadap db-dev)

`test:rls` mengandalkan isi seed, jadi jangan diarahkan ke database produksi `hashi` (hasilnya gagal/menyesatkan;
jangan `docker compose run --rm migrate npm run test:rls` polos, karena service `migrate` menunjuk produksi).

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev
docker compose build migrate                     # bangun image tools dari kode terbaru (run polos memakai image LAMA)
set -a; . ./.env; set +a                         # .env berisi URL dev: 127.0.0.1:5433/hashi_dev
for c in "npm run db:migrate" "npm run db:seed -- --reset" "npm run test:rls"; do
  docker run --rm --network host -e MIGRATE_DATABASE_URL -e DATABASE_URL hashi-migrate $c || break
done
```

Verifikasi PRODUKSI: cukup CI hijau (`gh run watch`) dan `curl http://127.0.0.1:3110/api/health`; tidak ada
tes basis data yang dijalankan di sana.

## Batasan server

OptiPlex bukan server khusus Hashi — ada layanan lain yang jalan di sana:
Actual Budget, OpenClaw, monitoring, dan micro-habit.

- Jangan hentikan, ubah, atau hapus container, volume, atau network di luar project compose `hashi`.
- Jangan jalankan `docker system prune` atau `docker volume rm` tanpa izin Ipal.

## Aturan arsitektur (WAJIB)

- **Akses data tenant selalu lewat `withTenant({ orgId, role, userId }, tx => …)` / `tenantQuery()`**. `withSystem()` hanya
  untuk login, super admin, worker terjadwal, seed. Aplikasi terhubung sebagai `hashi_app` (tanpa BYPASSRLS).
  `role` dan `userId` mengisi `app.role` / `app.user_id` untuk policy RLS; `null` = peran tidak dikenal (ditolak untuk data sensitif dan
  semua penulisan kandidat). Pakai `null` hanya untuk tabel yang tidak bergantung peran (mis. baris `users`).
- **Hak akses kandidat** (RLS + trigger, lihat `drizzle/0005…` dan `drizzle/0007_candidate_selections_rls.sql`):
  status LPK dan keputusan TSK DIPISAH. `candidates.stage` (STUDYING/READY/WITHDRAWN) hanya diisi LPK_ADMIN.
  Keputusan TSK ada di `candidate_selections` (unik per kandidat × TSK; NONE, SHORTLISTED, …, DEPARTED, REJECTED),
  Tiap TSK hanya melihat/menulis baris `tsk_org_id`-nya sendiri; LPK boleh membaca keputusan dan tidak boleh menulis.
  Catatan TSK ada di `candidate_notes` (bukan kolom di candidate_selections): `visibility` TSK_ONLY (default) atau
  SHARED_WITH_LPK. Semua peran TSK satu organisasi membaca/mengubah catatan organisasinya; LPK_ADMIN pemilik hanya
  membaca yang SHARED_WITH_LPK dari TSK dengan kemitraan AKTIF; LPK_SENSEI tidak pernah membaca; tidak ada DELETE
  untuk siapa pun; LPK tidak bisa menulis. Mengubah isi/visibility: hanya PENULIS (`author_id = app.user_id`)
  atau TSK_ADMIN di TSK yang sama; `author_id` wajib = user yang login saat membuat catatan.
  Audit catatan WAJIB lewat `noteAuditEntry()` (`src/db/audit-entries.ts`): hanya id catatan + visibility
  dari/ke, TIDAK PERNAH isi catatan (log kandidat disimpan di LPK pemilik, jadi LPK membacanya).
  LPK_ADMIN baca+tulis semua; LPK_SENSEI hanya profil dasar (tanpa `candidate_private`, keluarga, dokumen).
  TSK mitra membaca kandidat di SEMUA status, hanya yang `shared_with_tsk = true` (gerbang tunggal, dipegang LPK_ADMIN;
  lihat `drizzle/0010_share_with_tsk.sql`). `data_consent_date` hanya catatan tanggal formulir (opsional), BUKAN gerbang.
  Keputusan/catatan TSK tidak dihapus saat berbagi dimatikan, hanya tidak terlihat; catatan TSK yang dibagikan ke LPK
  ikut tidak terlihat oleh LPK (pola kemitraan nonaktif). `shared_with_tsk_at/_by` diisi trigger. TSK mengedit isi data
  (`candidates`, `candidate_private`, tabel anak: INSERT/UPDATE; DELETE hanya `candidate_documents`) HANYA jika keputusan MILIKNYA IN
  (`PASSED_CLIENT_INTERVIEW`, `DOCUMENT_PROCESS`, `DEPARTED`) dan `stage <> 'WITHDRAWN'` — daftar IN eksplisit,
  JANGAN `>=` pada enum. TSK tidak bisa mengubah `stage`, `data_consent_date`, maupun `shared_with_tsk*` (trigger kecil, karena
  RLS tak bisa membandingkan nilai lama vs baru). Mengaktifkan berbagi WAJIB dengan konfirmasi "siswa sudah setuju"
  (aplikasi); bawaan kandidat baru: tidak dibagikan. Seed (`NOT_SHARED` di `scripts/seed.ts`) menahan 3 kandidat LPK mitra,
  jadi TSK demo melihat 21 dari 24. Tabel baru ber-`candidate_id` WAJIB ditambahkan ke bagian I `verify-rls.ts` (dites otomatis).
- **Audit log**: `audit(tx, {organizationId, actorOrgId, candidateId, …})`. Perubahan kandidat disimpan di
  `organizationId` = LPK PEMILIK kandidat (supaya LPK ikut melihat aksi TSK), `actorOrgId` = organisasi pelaku,
  `candidateId` wajib diisi (policy insert memeriksanya). Untuk log biasa `actorOrgId` otomatis = `organizationId`.
- **Dokumen** (`src/features/documents/`): file di volume `docs-data` (`STORAGE_DIR`), `<org>/<kandidat>/<id>.<ext>`;
  jenis dari magic bytes (`sniffType`), bukan ekstensi/Content-Type; path selalu dibangun dari UUID divalidasi
  (`documentPath`); unduh lewat route handler `candidates/[id]/documents/[docId]` (login + RLS, `document.download`
  di audit, `attachment` + `nosniff`). Unggah/hapus: LPK_ADMIN, atau TSK bila syarat edit terpenuhi (RLS
  `candidate_editable`, migration 0009). Sensei tidak pernah (403 di route; bagian tidak dirender). Backup:
  database + volume `docs-data` (perintah di README).
- **Tabel baru** = migration Drizzle + migration SQL manual (`npx drizzle-kit generate --custom --name …`) berisi
  `GRANT … TO hashi_app`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy. Tambah pemeriksaan di
  `scripts/verify-rls.ts`. Tidak ada GRANT otomatis — sengaja, supaya gagal dengan aman.
- Aturan penting dijaga juga oleh trigger DB (lihat `drizzle/0003_user_role_guards.sql`), bukan hanya di app.
- Cek user login lewat `requireUser()` / `requireRole()` (`src/lib/session.ts`): dibaca dari DB setiap request.
- Server action: validasi dengan zod, kembalikan `FormState` dengan `key` = kunci pesan lengkap
  (mis. `"users.errors.emailTaken"`), tangani error lewat `ActionError`. Catat perubahan dengan `audit()`
  dalam transaksi yang sama. Jangan pernah mengembalikan/mencatat hash kata sandi.
- **Script di `scripts/` hanya boleh mengimpor dari `src/db/`** (dan paket npm). Image Docker stage `tools`
  (dipakai `docker run … hashi-migrate npm run test:rls|db:seed` terhadap db-dev, lihat di atas) hanya menyalin `src/db`, bukan seluruh `src`.
  Jangan impor dari `src/features`, `src/lib`, atau modul Next.js. Fungsi murni yang dibutuhkan script taruh di
  `src/db/` (mis. `audit-entries.ts`) dengan `import type` saja ke modul lain. Job `docker` di CI menjalankan
  `test:rls` dari image tools untuk menangkap pelanggaran ini. (`verify-i18n.ts` hanya jalan lokal/CI, bukan di image.)
- Struktur fitur: `src/features/<fitur>/{actions,queries,Komponen}.ts(x)`; halaman di `src/app/(app)/…`.
- **Halaman detail kandidat** dirancang berbasis definisi: `src/features/candidates/sections.ts` mendaftar bagian
  dan kolomnya (`SINGLE_SECTIONS`, `LIST_SECTIONS`); skema zod, form, tampilan, dan `test:i18n` diturunkan darinya.
  Menambah/menghapus kolom = 1 migration kecil + 1 baris di `sections.ts` + label di `detail.sections.<bagian>`
  (id dan ja). Nama kolom = nama properti tabel Drizzle. Sensei hanya mendapat bagian `level: "basic"`; bagian lain
  TIDAK dibaca dan TIDAK dirender (bukan disembunyikan CSS). Audit perubahan data hanya mencatat NAMA kolom.
- **Form tambah kandidat** (`/candidates/new`, hanya LPK_ADMIN) menampilkan SEMUA bagian di satu halaman dan juga
  diturunkan dari `sections.ts` (tidak ada definisi kolom ganda; label dari `detail.sections.*`). Wajib hanya kolom
  `required` di bagian satu-baris (nama, jenis kelamin, tanggal lahir, bidang); baris berulang yang kosong diabaikan.
  Nama input: kolom bagian satu-baris apa adanya (nama kolom antar-bagian harus unik; dicek saat modul dimuat),
  baris berulang `<bagian>.<nomorBaris>.<kolom>`. Action `addCandidate` memvalidasi per bagian (zod dari definisi),
  mengembalikan `fieldErrors` ({bagian | bagian.baris: [kolom]}), lalu menyimpan kandidat + data sensitif + baris
  + formulir + audit dalam SATU transaksi (file ditulis paling akhir; gagal = semua dibatalkan, pesan `saveFailed`).
  Audit `candidate.create` hanya memuat NAMA kolom terisi dan jumlah baris. Form dikirim lewat `onSubmit` manual
  (`startTransition(() => formAction(data))`), BUKAN atribut `action`: React mengosongkan form uncontrolled setelah
  form-action selesai, sehingga isian hilang saat error. Aturan urutan tanggal/tahun ada di `orderedDates` per bagian.
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
- Tes RLS wajib juga menjalankan UPDATE TANPA `WHERE` (lihat bagian H di `verify-rls.ts`): dengan `WHERE id = …`
  policy SELECT ikut berlaku dan menutupi policy UPDATE yang terlalu longgar.
- Trigger penjaga TSK bisa diuji tanpa policy: `actAsTriggerOnly()` (bypass RLS + `app.role` TSK).
- Policy yang saling merujuk tabel (candidates ↔ candidate_selections) memicu "infinite recursion detected in
  policy". Diputus dengan fungsi `SECURITY DEFINER` sempit (`tsk_has_edit_decision`, hanya membaca baris milik
  organisasi sesi). Selalu jalankan `test:rls` setelah mengubah policy.
- drizzle-kit TIDAK bisa mengubah enum yang nilainya dikurangi (akan meng-cast dan gagal/membuang data). Tulis
  migration manual dengan pemetaan data (contoh: `drizzle/0006_candidate_selections.sql`).
- Port 3100 dipakai aplikasi lain: jalankan e2e dengan `E2E_PORT=3120 npm run test:e2e`.
- Audit log append-only: tes e2e yang memeriksa audit harus dibatasi ke baris sejak tes dimulai (`created_at >= …`).
- Label statis ada di katalog terjemahan yang dikirim ke browser semua peran; yang harus tidak bocor ke sensei
  adalah DATA dan bagian sensitif (tes: `candidate-detail.spec.ts`).
- File `"use server"` hanya boleh mengekspor fungsi async (konstanta/tipe di modul lain, mis. `documents/fields.ts`);
  helper bersama action ada di `candidates/guards.ts`, bukan di file `"use server"` (akan jadi endpoint).
- Akses filesystem dinamis (path dari env) memicu peringatan tracing seluruh project di build standalone:
  beri `/* turbopackIgnore: true */` (lihat `storageRoot`). Build harus 0 peringatan.
- e2e menyimpan dokumen di `.e2e-docs/` (gitignored, dihapus di akhir); dev di `docs-data/` (gitignored).
- `test:e2e` menjalankan build standalone lewat `scripts/serve-standalone.mjs`; `npm run build` dulu.

## Alur kerja

1. Kerjakan satu langkah → `npm run typecheck && npm run test:rls && npm run build && npm run test:e2e`
2. Commit (Bahasa Indonesia) → `git push` → CI (GitHub Actions) harus hijau
3. Deploy di OptiPlex: `git pull && docker compose up -d --build`
