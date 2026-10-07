# Hashi: riwayat project

Dokumen ini ringkasan untuk orang (atau sesi baru) yang perlu paham Hashi dengan cepat. Aturan kerja yang mengikat ada di [`CLAUDE.md`](../CLAUDE.md);
detail per fitur ada di `docs/` dan di komentar kode. **Tidak ada password, token, atau isi `.env` di sini**; hanya nama variabel.

Terakhir diperbarui: 2026-10-06 (setelah langkah 6, commit `c65cb2e`).

## 1. Ringkasan project

**Hashi (橋)** adalah SaaS profil dan seleksi kandidat untuk **LPK** (lembaga pelatihan kerja, Indonesia) dan **TSK / 登録支援機関** (lembaga pendukung terdaftar, Jepang).
LPK mengelola profil dan penilaian siswa, lalu membagikannya ke TSK mitra; TSK menyeleksi, mengajukan ke klien (配属先), dan setelah pekerja berangkat mencatat kegiatan pendampingannya.
Pemilik: Ipal. Bahasa UI: Indonesia dan Jepang (`id` / `ja`); komentar kode dan commit berbahasa Indonesia.

**Stack:** Next.js 16 (App Router, build `standalone`) + TypeScript, Postgres 16 dengan **Row Level Security** (multi-tenant), Drizzle ORM + migrasi SQL, next-intl, Tailwind 4,
Auth.js (login kredensial), zod, pdfkit (PDF, font Noto Sans JP), sharp (foto), Playwright (e2e), Docker Compose, GitHub Actions (CI).

**Struktur folder utama**

| Folder | Isi |
|---|---|
| `src/app/` | halaman dan route handler (`(app)/` untuk area login; `login/`; `api/health`) |
| `src/features/<fitur>/` | `actions.ts` (server action), `queries.ts`, komponen: candidates, assessments, clients, job-orders, client-sheet, records, documents, dashboard, audit, users, organizations, skill-fields, account |
| `src/db/` | `schema.ts` (Drizzle), akses tenant (`withTenant`/`withSystem`), query bersama, data demo (`demo-*.ts`), katalog dashboard, audit (`audit-*.ts`). Satu-satunya folder yang boleh diimpor oleh `scripts/` |
| `src/lib/` | sesi, audit (`audit()`), izin peran, modul PDF (`lib/pdf/`), zona waktu |
| `src/components/` | shell, token desain, komponen bersama |
| `messages/` | `id.json` dan `ja.json` (kunci harus identik; dicek `test:i18n`) |
| `drizzle/` | migrasi 0000-0021 (SQL; RLS, trigger, GRANT ditulis manual) |
| `scripts/` | migrate, seed, `verify-*` (RLS, seed, i18n, cakupan audit), skrip demo (`demo-*.sh`) |
| `tests/` | `unit/` (node:test) dan `e2e/` (Playwright) |
| `docs/` | `catatan-kegiatan.md`, `lembar-klien.md`, `glossary.md`, `brand.md`, dokumen ini |
| `assets/fonts/` | Noto Sans JP (OFL) untuk PDF |

## 2. Yang sudah selesai

Urutan mengikuti spesifikasi MVP.

1. **Fondasi:** login, i18n id/ja, multi-tenant RLS, Docker, CI.
2. **Organisasi, pengguna, kemitraan** (v0.2).
3. **Profil kandidat:** daftar, tambah, detail berbasis definisi (`sections.ts`), keputusan dan catatan TSK, berbagi ke TSK, dokumen (PDF/JPG/PNG), hapus permanen, audit.
4. **Penilaian kandidat:** bulanan LPK, wawancara dan kunjungan TSK; UI LPK dan TSK.
5. **Klien (配属先) dan job order:** bidang kerja master, perusahaan/lokasi/PIC milik TSK, job order, seleksi per job order, penempatan otomatis saat DEPARTED.
6. **Lembar klien PDF** (migrasi 0021): profil klien dan lembar job order, mode internal / untuk dibagikan, label Jepang atau Jepang + Indonesia. Format DRAFT. Lihat `docs/lembar-klien.md`.
7. **7A Catatan kegiatan TSK** (migrasi 0020): 業務記録, 議事録・面談記録, 時系列 (PDF internal dan klien), 定期面談, tugas tindak lanjut, laporan harian, foto, riwayat edit, PDF. Lihat `docs/catatan-kegiatan.md`.
- **UI v1 dan v1.1:** shell, dashboard yang bisa diatur (migrasi 0018), kamus istilah, lencana status, riwayat aktivitas immutable (migrasi 0019, `/activity`), merek (logo, ikon, manifest), login dua kolom.
- **Operasional:** instance demo terpisah (`hashi-demo`, port 3111, Funnel), seed demo lengkap (`db:seed`) plus skrip tambahan tanpa reseed (`seed:records`, `seed:client-sheet`), `verify:seed`, `verify:audit-coverage`.

**Fix penting yang pernah terjadi:** pdfkit harus di-bundle (bukan external) karena `@noble/*` hilang di image produksi; `candidate_delete_summary` sempat kehilangan `placements`;
form yang redirect tidak boleh memanggil `revalidatePath`; filter KPI dan daftar kandidat dipaksa memakai fungsi yang sama; daftar lengkap jebakan ada di `CLAUDE.md`.

## 3. Keputusan teknis penting dan alasannya

- **RLS di database, bukan hanya di aplikasi.** Aplikasi konek sebagai `hashi_app` (tanpa BYPASSRLS); data tenant selalu lewat `withTenant({orgId, role, userId})`. Alasan: data pribadi calon pekerja lintas lembaga; kebocoran karena bug aplikasi harus tetap ditolak database. Dites 100+ aturan di `verify-rls.ts`.
- **Status LPK dan keputusan TSK dipisah** (`candidates.stage` vs `candidate_selections`); "keputusan" kandidat = yang paling maju (view `candidate_headline_decision`), daftar eksplisit, tidak pernah `>=` pada enum. Alasan: enum bisa bertambah, perbandingan urutan diam-diam salah.
- **Berbagi ke TSK lewat satu gerbang** (`shared_with_tsk`, dipegang LPK_ADMIN) dengan konfirmasi "siswa sudah setuju".
- **LPK tidak pernah melihat data klien/job order/catatan kegiatan** (menu tidak ada, rute 404, RLS menolak). Alasan: hubungan bisnis TSK-klien bukan urusan LPK.
- **Tidak ada DELETE untuk catatan kegiatan:** salah = `void` + alasan, riwayat edit append-only lewat trigger (berlaku juga untuk OWNER). Alasan: catatan disimpan sampai 5 tahun dan bisa jadi bukti.
- **Audit satu pintu** (`audit()` + `sanitizeAuditPayload`): hanya NAMA kolom dan nilai berbentuk pilihan/status; tidak pernah isi catatan, nama orang, atau gaji. Entri immutable; `verify:audit-coverage` memastikan server action yang menulis data tercatat.
- **File dokumen di Docker volume** (`docs-data`), bukan object storage. MinIO dicoret (image community dihentikan); cadangan bila perlu S3: Garage atau SeaweedFS. File bernama UUID, unduh lewat route handler yang dicek RLS dan dicatat audit.
- **PDF dengan pdfkit (murni JS), bukan browser headless:** ringan dan jalan di image produksi. Label PDF TIDAK lewat `messages` (dokumen ke luar harus selalu berbahasa Jepang). Pratinjau dan PDF dibuat dari model yang sama.
- **Mode "untuk dibagikan" membuang data secara struktur** (telepon PIC, catatan internal, syarat gender, nama staf), bukan menyembunyikannya; server menolak tanpa `confirm=1`.
- **Seed demo deterministik** (PRNG ber-seed, id dari label) supaya skrip tambahan bisa mengisi baris yang sama di database yang sudah ada **tanpa reseed**.
- **Database dev terpisah** (`db-dev`, port 5433) dan `db-guard`: tes destruktif menolak jalan kecuali nama database berakhiran `_dev`/`_test`/`_demo`. Alasan: pernah ada risiko mengotori data demo/produksi.
- **`scripts/` hanya boleh impor dari `src/db/`:** image `tools` hanya menyalin `src/db`; CI menjalankan `test:rls` dari image itu untuk menangkap pelanggaran.
- **Teks Indonesia tanpa kanji telanjang** (padanan Indonesia + romaji; `test:i18n` menolak), dan semua istilah dirujuk ke `docs/glossary.md`.
- **Tidak ada draf di localStorage/sessionStorage/IndexedDB** (dijaga tes); form panjang memakai peringatan `beforeunload`.
- **Server bersama:** OptiPlex menjalankan layanan lain; Hashi tidak boleh menyentuh container/volume/network di luar project compose `hashi`, tanpa `--remove-orphans`, tanpa `docker system prune`/`volume rm`.

## 4. Yang masih menggantung / bug yang diketahui

**Belum dikerjakan (langkah 7 sisanya dan seterusnya)**
- Pelacak 在留カード dan pengingatnya (jadwal sudah dicatat di `CLAUDE.md`; penerima reminder belum dikonfirmasi ke staf TSK).
- Checklist keberangkatan/kedatangan; bagian "管理・報告" di lembar 定期面談; profil pekerja lengkap; status visa dan tanggal tiba untuk LPK (tampilan baca-saja terbatas); notifikasi email/LINE.
- My Number: hanya disimpan bila terbukti dibutuhkan dan sah; perlu dicek ke 行政書士 dulu.
- Langkah 8 (siap pilot, dummy 200 siswa) dan 9 (demo ke TSK).

**Perlu keputusan / konfirmasi pihak luar**
- Format lembar klien masih DRAFT sampai TSK mengoreksi.
- Kebijakan syarat gender pada dokumen yang dibagikan perlu dikonfirmasi ke 行政書士 atau penasihat hukum TSK.
- **Cadangan di luar server belum ada.** Catatan kegiatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi; cadangan luar-server (database + volume `docs-data`) WAJIB berjalan sebelum data nyata masuk.

**Batasan dan keanehan yang diketahui**
- Foto HEIC ditolak (libvips bawaan sharp tanpa HEVC): minta JPEG/PNG/WebP, atau atur kamera iPhone ke "Paling kompatibel".
- `test:rls` bergantung isi seed: jalankan `db:seed -- --reset` di dev dulu; setelah e2e, bagian S bisa gagal "duplicate key" sampai di-reseed. Jangan arahkan ke database produksi.
- e2e menambah data uji dan hanya boleh di database dev; PDF diuji manual di image produksi lokal, CI hanya mengecek font dan sharp di image.
- ~~Peringatan `pg` "client.query() ... already executing"~~ **diperbaiki di T-013**: sumbernya `Promise.all` di atas SATU transaksi (`tx`); kini kueri berurutan lewat `inSeries` (`src/db/serial.ts`), dijaga pemindai sumber (`tests/unit/no-tx-promise-all.test.ts`) dan penjaga e2e (`scripts/guard-pg-concurrency.cjs`). "destination stream closed early" (Next) = klien memutus respons yang sedang di-stream saat tes berpindah halaman; bukan bug aplikasi, tidak diubah.
- Data demo: `salary_note` job order sudah memuat nominal gaji, jadi di lembar muncul dua kali (isi data, bukan bug).
- Lembar job order versi internal dengan teks sangat panjang bisa melewati satu halaman (data contoh muat satu halaman).
- Produksi tidak boleh dibuka ke internet; hanya instance demo (data dummy) yang lewat Tailscale Funnel.

## 5. Cara menjalankan di Mini PC (OptiPlex)

Server ini dipakai bersama layanan lain (Actual Budget, OpenClaw, monitoring, micro-habit): port 3100 sudah dipakai, jadi Hashi memakai `APP_PORT=3110`.

**Variabel `.env`** (salin dari `.env.example`, isi sendiri; jangan di-commit): `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `AUTH_SECRET`, `APP_BIND` (bawaan 127.0.0.1), `APP_PORT`, `SHOW_DEMO_ACCOUNTS`, `SEED_PASSWORD`,
`DB_NAME` (bawaan `hashi`). Untuk `npm run ...` dari luar Docker juga `DATABASE_URL` (peran `hashi_app`) dan `MIGRATE_DATABASE_URL` (peran `hashi_owner`); **keduanya harus menunjuk database berakhiran `_dev`/`_test`, tidak pernah `hashi`**.

**Produksi**
```bash
git pull
scripts/deploy.sh                     # pull --ff-only + build dengan GIT_SHA + tunggu health memuat commit; migrasi otomatis lewat `migrate`; tanpa --remove-orphans
curl http://127.0.0.1:3110/api/health # {"status":"ok"}
```
Tidak ada tes basis data yang dijalankan di produksi; verifikasi cukup CI hijau + health check. Database baru TIDAK di-seed otomatis; reseed produksi hanya dengan izin eksplisit pemilik (`ALLOW_DESTRUCTIVE_DB=1`).
Data demo tambahan tanpa reseed: `docker compose run --rm migrate npm run seed:records` dan `... seed:client-sheet` (menolak jalan bila ada organisasi non-dummy; `docker compose build migrate` dulu bila kode berubah).

**Demo untuk pihak luar** (project `hashi-demo`, port 3111, database `hashi_demo`, env `.env.demo`): `scripts/demo-up.sh`, `demo-reset.sh` (mereseed), `demo-down.sh`. Untuk deploy kode tanpa reseed pakai `dc up -d --build` dari `scripts/demo-lib.sh`
(`-p hashi-demo --env-file .env.demo`), bukan `demo-up.sh`. Funnel Tailscale harus tetap menyala.

**Development**
```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev     # Postgres dev: 127.0.0.1:5433, database hashi_dev
npm ci && npm run db:migrate && npm run db:seed                     # sekali
npm run dev                                                          # http://localhost:3100 (bentrok dengan aplikasi lain di OptiPlex: pakai PORT lain)
```

**Verifikasi sebelum commit** (urutan di `CLAUDE.md`): `npm run typecheck`, `test:i18n`, `test:unit`, `db:seed -- --reset` lalu `test:rls`, `verify:seed`, `verify:audit-coverage`, `npm run build`, `E2E_PORT=3120 npm run test:e2e`
(e2e butuh build standalone dan `npx playwright install --with-deps chromium` sekali). Lalu commit (Bahasa Indonesia), `git push`, tunggu CI hijau (`gh run watch`).

**Cadangan manual** sebelum migrasi/deploy besar: `pg_dump -Fc` database + `.sha256` ke `~/hashi-backups/`, lalu `pg_restore --list` untuk memastikan terbaca.
