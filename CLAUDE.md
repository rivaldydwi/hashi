# Hashi — panduan untuk Claude Code

Hashi (橋) = SaaS profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Pemilik: Ipal. Jelaskan dengan Bahasa Indonesia santai tapi solid; komentar kode & pesan commit juga Bahasa Indonesia.

- Kebutuhan: https://claude.ai/code/artifact/78f405ee-32e2-48da-844b-41bbbd6bc458
- Spesifikasi MVP: https://claude.ai/code/artifact/ccb56ab1-128a-402b-9c37-b4f78ac52e28

## Peran dan aturan kerja (BACA PALING DULU)

Hashi dikerjakan oleh dua sesi Claude yang berkomunikasi **lewat repo ini**, bukan lewat copy-paste oleh Ipal.

| Siapa | Di mana | Tugasnya |
|---|---|---|
| **Ipal** | pemilik | Memutuskan hal bisnis/hukum/biaya, menjawab pertanyaan berlabel `BUTUH IPAL`. Tidak perlu memindahkan teks antar-sesi. |
| **PM** | sesi cloud claude.ai/code | Menulis dan mengurutkan `docs/TASKS.md`, me-review PR, menyetujui atau meminta revisi, menyampaikan pertanyaan ke Ipal. Tidak menulis kode fitur. |
| **Engineer** | Claude Code di VS Code, Mini PC (OptiPlex, server bersama) | Mengerjakan tugas dari `docs/TASKS.md`, menulis `docs/STATUS.md`, membuka PR, merge setelah disetujui PM, deploy. |

Kamu berjalan di Mini PC/VS Code → kamu **engineer**. Kamu sesi cloud di claude.ai/code → kamu **PM**.

**Saluran komunikasi (hanya tiga):**
- `docs/TASKS.md`: antrean tugas + kriteria selesai. **Hanya PM yang mengubah.**
- `docs/STATUS.md`: laporan engineer, entri terbaru di atas. **Hanya engineer yang mengubah.**
- Pull request + komentar PR: diskusi per tugas dan review.

**Siklus engineer (satu tugas = satu branch = satu PR):**
1. `git status` dulu: ada perubahan belum di-commit, atau branch bukan `main`/`eng/*` → jangan sentuh apa pun, cukup lapor (mungkin Ipal sedang bekerja).
   Lalu `git checkout main && git pull --ff-only`. Baca entri teratas `docs/STATUS.md`, lalu `docs/TASKS.md`.
   Cek CI `main` (`gh run list -L3`): merah = prioritas di atas tugas apa pun (perbaiki di branch `eng/fix-<slug>`, PR seperti biasa, lapor).
2. Kalau ada PR milikmu yang masih terbuka: baca komentar PM terbaru dan tangani dulu (lihat langkah 7). Tugas baru baru diambil setelah PR lama selesai.
3. Ambil tugas `SIAP` paling atas. Buat branch `eng/<ID>-<slug>` dari `main` (contoh `eng/T-002-backup-desain`).
4. Kerjakan. Jalankan verifikasi yang relevan (lihat "Alur kerja" di bawah dan kriteria selesai tugasnya). Tulis hasilnya apa adanya; tes yang gagal tetap dilaporkan.
5. Tambah entri di `docs/STATUS.md` (format ada di berkas itu), commit di branch yang sama.
6. `git push -u origin <branch>`, lalu buka PR ke `main` dengan judul `[<ID>] <ringkas>` (`gh pr create`). Isi PR: apa yang berubah, hasil verifikasi, kriteria selesai sebagai checklist, pertanyaan.
7. Tunggu review. PM menjawab lewat komentar PR yang diawali penanda:
   - `PM: REVISI`: perbaiki di branch yang sama, push, lalu komentar `ENGINEER: siap direview ulang`.
   - `PM: DISETUJUI`: kalau CI hijau, `gh pr merge <no> --merge --delete-branch`. Lalu deploy bila tugasnya meminta (`scripts/deploy.sh`: menolak bila bukan `main` atau working tree kotor, pull, build dengan `GIT_SHA`, menunggu `/api/health` memuat commit baru; `--backup` bila perlu cadangan dulu) dan lanjut ke langkah 1.
   (PM dan engineer memakai akun GitHub yang sama, jadi tombol "Approve" GitHub tidak bisa dipakai; penandanya adalah komentar.)
8. Kalau tidak ada tugas `SIAP`, jangan mengarang tugas sendiri: tulis di STATUS bahwa antrean kosong, lalu berhenti.

**Siklus PM:** review setiap PR `[T-…]` terhadap kriteria selesainya (baca diff, cek CI). Perubahan `docs/TASKS.md` (tandai SELESAI,
tambah tugas berikutnya) di-commit PM ke branch PR yang sedang direview sebelum menulis `PM: DISETUJUI`, jadi ikut ter-merge. Di luar review,
PM boleh push commit yang HANYA mengubah `docs/TASKS.md` langsung ke `main`. Pertanyaan yang butuh Ipal disampaikan PM ke Ipal di chat.

**`BUTUH IPAL`: berhenti dan tanya (tulis di STATUS + komentar PR berawalan `BUTUH IPAL:`), jangan putuskan sendiri:**
- secret, kata sandi, isi `.env`, akun layanan pihak luar, atau apa pun yang berbiaya;
- reseed / menghapus / mengubah data di database produksi `hashi`, atau restore produksi;
- menyentuh container, volume, network, cron, atau paket sistem di luar project compose `hashi` (lihat "Batasan server");
- membuka layanan ke internet, mengubah Tailscale/Funnel;
- keputusan yang menunggu pihak luar (TSK, 行政書士) atau berimplikasi hukum/data pribadi.

**Larangan tetap (PM dan engineer):**
- Jangan pernah commit secret, `.env`, `.env.demo`, dump database, isi `docs-data/`, atau cadangan. Cek `git status` / `git diff --cached` sebelum commit.
- Jangan push langsung ke `main` (kecuali PM untuk `docs/TASKS.md` saja). Jangan force-push, rebase, atau amend commit yang sudah di-push.
- Jangan melewati, menonaktifkan, atau melemahkan tes supaya hijau. Jangan merge PR yang CI-nya merah.
- `test:rls` / `verify:seed` / `test:e2e` / migrasi percobaan / reseed HANYA terhadap `db-dev` (`_dev`/`_test`). Deploy produksi hanya bila tugasnya meminta;
  demo (`hashi-demo`: `dc up`, `demo-*.sh`, `seed:*`) dan Funnel hanya dengan izin Ipal. Jangan hapus data, berkas, atau branch yang bukan buatanmu.
- Satu PR = satu tugas; perubahan di luar lingkup tugas → usulkan di STATUS, jangan diselipkan.
- Jangan menulis nama/ID model AI di commit, PR, atau kode.

## Status (urutan pengerjaan dari spesifikasi MVP)

1. ✅ Fondasi: login, i18n ID/JP, multi-tenant RLS, Docker, CI
2. ✅ Kelola organisasi, pengguna, kemitraan (v0.2)
3. ✅ **Profil kandidat**: daftar, tambah, halaman detail, keputusan & catatan TSK, persetujuan data, dokumen, audit
4. ✅ **Penilaian kandidat**: skema + RLS + tes (A) · UI LPK (B) · UI TSK (C)
5. ✅ **Klien (配属先) dan job order**: bidang kerja master, klien/lokasi/PIC milik TSK, job order, seleksi per job order, penempatan (fondasi langkah 7)
6. ✅ **Lembar klien PDF** (profil klien + lembar job order, bahasa Jepang; format DRAFT menunggu koreksi TSK): lihat `docs/lembar-klien.md`
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

Production di OptiPlex: `scripts/deploy.sh` (setara `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` + pull + cek health/commit; migration otomatis lewat service `migrate`).
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

### Instance demo (pihak luar)

`scripts/demo-up.sh | demo-reset.sh | demo-down.sh`: project Compose `hashi-demo` + `.env.demo` (gitignored), database `hashi_demo`,
port 3111, volume sendiri; detail di README ("Demo untuk pihak luar"). Perintah compose untuk demo SELALU lewat `dc()` di
`scripts/demo-lib.sh` (`-p hashi-demo --env-file .env.demo`). `db-guard` menerima `_demo` selain `_dev`/`_test`. Compose memakai
`${DB_NAME:-hashi}`, jadi produksi tidak berubah (config identik). Produksi tidak boleh dibuka ke internet; demo hanya data dummy.

### Seed demo lengkap

`scripts/seed.ts` memakai `src/db/demo-data.ts` (PRNG ber-seed tetap, id deterministik) dan `src/db/demo-files.ts` (PDF/PNG dummy,
tata letak storage sama dengan unggahan asli). Semua kandidat lengkap; `npm run verify:seed` (baca-saja, dijalankan CI setelah seed)
menjaganya dan memakai fungsi query yang SAMA dengan halaman (`src/db/candidate-list.ts`, dipakai ulang oleh `features/*/queries.ts`).
Service `migrate` memasang volume `docs-data` + `STORAGE_DIR` supaya seed menulis berkasnya; `--reset` menghapus folder UUID lama.
Tes yang mengubah data kandidat WAJIB memakai kandidat uji sendiri (`createScratchCandidate` di `tests/e2e/helpers.ts`), bukan kandidat seed.
`verify-rls.ts`: `sandbox()` berjalan lewat koneksi OWNER untuk mengosongkan turunan kandidat lalu `SET LOCAL ROLE hashi_app`.

## Langkah 7: yang SUDAH terbangun dan yang tersisa

- ✅ **7A Catatan kegiatan** (業務記録, 議事録・面談記録, 時系列, 定期面談, tugas tindak lanjut, laporan harian, foto, PDF): lihat `docs/catatan-kegiatan.md` dan butir "Catatan kegiatan" di aturan arsitektur.
- ⏭ Tersisa: pelacak 在留カード dan pengingatnya, checklist keberangkatan/kedatangan, bagian "管理・報告" lembar 定期面談 (dokumen, permohonan, tanggal pengajuan 入管), profil pekerja lengkap,
  status visa/tanggal tiba untuk LPK, notifikasi email/LINE.
- **Cadangan di luar server WAJIB berjalan sebelum data nyata masuk** (catatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi).

## Keputusan untuk langkah 7 (catatan kebutuhan; 7A sudah diimplementasikan, sisanya BELUM)

Fondasi datanya sudah ada (`placements`, klien/lokasi, job order). Kebutuhan dari staf TSK untuk modul pekerja aktif:

- **LPK perlu melihat status visa dan tanggal tiba** pekerja setelah berangkat: tampilan baca-saja yang sangat terbatas, hanya dua hal itu (bukan klien, bukan job order, bukan penempatan).
- **Penerima reminder 在留カード**: tiap pekerja punya satu staf penanggung jawab (担当); reminder dikirim ke dia dengan salinan ke Admin TSK sebagai cadangan.
  Belum dikonfirmasi ke staf TSK.
- **My Number**: hanya disimpan jika terbukti memang dibutuhkan dan sah. Kalau disimpan: kolom dienkripsi, opsional, hanya terlihat oleh Admin TSK, setiap akses tercatat di
  audit, tidak masuk daftar, ekspor, PDF, atau log. Perlu dicek ke 行政書士 sebelum dipakai di data sungguhan.
- **Jadwal reminder 在留カード** (dari spreadsheet TSK): mulai persiapan 4 bulan sebelum habis, pengajuan bisa dimulai 3 bulan sebelum habis, reminder H-30, H-14, H-7 dan setelah
  lewat, berhenti saat tanggal terima kartu baru diisi.
- Spreadsheet harian TSK (sheet 基本情報) menyimpan per pekerja: 配属先法人名, 配属先企業名, 就労開始日, 配属先企業住所, 配属先企業電話番号, 配属先企業担当者, 配属先企業担当者電話番号. Semuanya
  sudah punya tempat di model (perusahaan, lokasi, PIC, penempatan.start_date).

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
- **Penilaian** (`candidate_assessments`, migration 0011): `kind` LPK_MONTHLY (面談 bulanan, satu per kandidat per bulan:
  indeks unik parsial `candidate_assessments_lpk_month_key`), TSK_INTERVIEW, TSK_VISIT. BACA: LPK_ADMIN + sensei membaca
  LPK_MONTHLY kandidat LPK-nya; HANYA LPK_ADMIN yang juga membaca penilaian TSK yang `SHARED_WITH_LPK` (TSK dengan kemitraan
  aktif dan kandidat `shared_with_tsk`); sensei tidak pernah membaca penilaian TSK; TSK membaca semua LPK_MONTHLY kandidat
  yang dibagikan + penilaian TSK milik organisasinya saja. TULIS: LPK_MONTHLY oleh LPK_ADMIN/sensei (diubah penilainya atau
  LPK_ADMIN); TSK TIDAK PERNAH menulis/mengubah LPK_MONTHLY (riwayat); TSK_VISIT kapan saja; TSK_INTERVIEW hanya bila keputusan
  TSK itu IN (PASSED_TSK_INTERVIEW, SUBMITTED_TO_CLIENT, PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED) (`tsk_interview_decision`,
  JANGAN `>=`); penilaian TSK diubah penilainya atau TSK_ADMIN. Tidak ada DELETE. Trigger mengisi `period`, `assessor_id`
  (dari `app.user_id`, tidak bisa dipalsukan), menolak tanggal di masa depan (batas = tanggal Tokyo), dan mengunci
  candidate_id/org_id/kind/assessor_id. Audit WAJIB lewat `assessmentAuditEntry()` (`src/db/audit-entries.ts`): jenis, periode, NAMA
  kolom, visibility dari/ke; tanpa isi `note`/`follow_up`. "Bulan berjalan" memakai `APP_TIMEZONE` di `src/db/time.ts`.
  **UI LPK** (`src/features/assessments/`): `fields.ts` (`ASSESSMENT_FIELDS`, rata-rata, tren), `AssessmentsSection` (bagian "Penilaian"
  di detail, hanya LPK_ADMIN + sensei, hanya LPK_MONTHLY; tabel di md+, kartu di ponsel), `AssessmentForm`, `actions.ts`
  (`saveAssessment`), `queries.ts` (`listMonthly`, `pendingCandidates`, `assessmentStats`, `jlptBest`, `matchAssessmentFilters`).
  Batas tanggal form = `todayInAppTz()` (Jakarta, lebih ketat dari batas Tokyo di trigger, jadi form tidak pernah ditolak trigger;
  dibuktikan di `verify-rls.ts`). Halaman `/assessments/pending` + kartu di beranda memakai `currentPeriod()`. Filter /candidates
  (avg, attendance, jlpt) dari 3 penilaian LPK terbaru: statistik dihitung di query terpisah (window function, bukan subquery
  berkorelasi), dipasang sebagai daftar id; kandidat tanpa data itu tidak lolos filter. Label aspek: "Kebugaran" (bukan kesehatan);
  catatan penilaian dilarang berisi data medis (teks bantuan di form).
  **UI TSK** (`TskAssessmentsSection`, `TskAssessmentForm`, `tsk-actions.ts` `saveTskAssessment`, `listTsk`): TSK melihat penilaian
  bulanan LPK BACA SAJA (`AssessmentsSection readOnly`, tanpa form), form kunjungan (TSK_VISIT) selalu ada, form interview
  (TSK_INTERVIEW) NONAKTIF + penjelasan sampai keputusan TSK itu IN `TSK_INTERVIEW_DECISIONS` (`candidates/permissions.ts`, cermin
  `tsk_interview_decision` di DB; daftar eksplisit, bukan `>=`; server juga memeriksa dan RLS tetap penjaga akhir). Pilihan
  visibility "Hanya TSK" (bawaan) / "Bagikan ke LPK"; ubah: penilainya atau TSK_ADMIN (tombol ubah hanya bila boleh). Batas tanggal form TSK
  = hari ini di Tokyo (`todayInTskTz`, sama dengan trigger). LPK_ADMIN melihat "Penilaian dari TSK" (baca saja, hanya yang dibagikan
  oleh kemitraan aktif; komponen mengembalikan null bila kosong); sensei: tidak dirender dan datanya tidak dibaca (tes cek DOM + HTML).
  Audit: jenis, periode, nama kolom, visibility dari/ke; tanpa isi catatan.
- **Bidang kerja** (`skill_fields`, migration 0014): tabel master (kode stabil + nama id/ja + aktif + urutan), BUKAN enum/teks bebas. Dipakai
  `candidates.field_id`, `client_site_fields`, `job_orders.field_id` (semua FK RESTRICT: yang dipakai tidak bisa dihapus). Baca: semua peran berkonteks;
  tulis: hanya mode sistem (halaman super admin `/admin/skill-fields`). Form memakai FieldKind `skillField` (opsi dari `SkillFieldsProvider` di layout, label
  mengikuti bahasa UI; bidang nonaktif hanya muncul bila sedang dipakai); server menolak bidang nonaktif untuk pilihan baru (`assertSkillFieldUsable`).
- **Klien dan job order** (migration 0016-0017; `src/features/clients`, `src/features/job-orders`, `src/db/job-matching.ts`): semua tabel baru punya `org_id` TSK,
  policy `client_owner(org_id)` (peran TSK di org sesi) / `client_owner_admin` (hapus: TSK_ADMIN). LPK, sensei, super admin (jalur aplikasi), peran null, TSK lain:
  TIDAK bisa SELECT/INSERT/UPDATE/DELETE (UI: menu tidak ada, `notFound()` 404). Trigger menjaga rantai `org_id` (lokasi = perusahaannya, dst.), `org_id` tetap, job order
  harus sebidang dengan bidang yang diterima lokasinya, lokasi job order tetap. Hapus perusahaan/lokasi/job order yang dirujuk = FK RESTRICT (pesan `inUse`).
  `candidate_selections` kini satu baris per (kandidat, TSK, job order) dengan satu baris umum (`job_order_id` NULL; unique index NULLS NOT DISTINCT). CHECK
  `candidate_selections_job_order_required`: PASSED_CLIENT_INTERVIEW / DOCUMENT_PROCESS / DEPARTED wajib job order (daftar eksplisit; di aplikasi
  `JOB_ORDER_REQUIRED_DECISIONS`). "Keputusan" sebuah kandidat untuk daftar/hak edit/izin interview = keputusan PALING MAJU (view `candidate_headline_decision`,
  peringkat eksplisit `selection_decision_rank`, security_invoker, tanpa job order): dipakai `candidate-list`, `getCandidateForAction`, dan seluruh sisi LPK. LPK TIDAK PERNAH
  membaca `job_order_id`/klien (query LPK hanya lewat view; HTML dites). Audit data TSK lewat `auditTsk()` (log org TSK; nama kolom + id saja; id job order TIDAK masuk log LPK).
  Keputusan DEPARTED membuat `placements` ACTIVE otomatis (trigger SECURITY DEFINER; unique parsial satu ACTIVE per kandidat; DEPARTED kedua saat ada ACTIVE ditolak);
  `placements` ber-`candidate_id` (cascade saat kandidat dihapus, tercakup bagian I `verify-rls`), tidak bisa dihapus siapa pun, identitas tidak bisa diganti. Job order OPEN
  menjadi FILLED otomatis saat terpilih >= posisi (`job_order_sync_status`; hanya arah itu, dibuka manual tidak dibalik sampai seleksi berubah). "Ajukan" (`proposeCandidate`) =
  SUBMITTED_TO_CLIENT untuk job order itu (tidak menurunkan yang lebih maju; hanya job order OPEN; kandidat Mundur / sudah ditempatkan ditolak). Tes: `verify-rls` bagian M-O
  (`sandbox()` + helper `decide()`/`newJobOrder()`), e2e `clients`, `job-orders`, `skill-fields`; tes yang butuh keputusan lanjut memakai `createScratchJobOrder`.
- **UI v1: shell + dashboard** (`src/components/shell/`, `src/features/dashboard/`, `src/db/dashboard-*.ts`): token desain di `globals.css` (`@theme`; akar 16px, teks dasar 14px di body,
  supaya `h-11` = 44px untuk target sentuh). Menu per peran disusun di `(app)/layout.tsx` (menu yang tak boleh TIDAK ada di DOM). Angka kartu KPI = jumlah id dari
  `viewCandidateIds` (`src/db/dashboard-queries.ts`) dan daftar `/candidates?view=…` memakai fungsi yang SAMA (`parseFilters` + `onlyIds`), jadi angka dan daftar tidak pernah
  berbeda; filter baru = tambah ke `FILTER_VIEWS_*` + `viewCandidateIds` + `candidates.viewLabel.*` + pemeriksaan di `verify-seed` (tidak boleh kosong/semua). Kelengkapan profil:
  `candidateCompleteness` (`src/db/completeness.ts`, turunan `candidate-sections.ts`). Seed sengaja punya kandidat tak lengkap (`INTENTIONALLY_INCOMPLETE` di `demo-data.ts`).
- **Dashboard yang bisa diatur** (migration 0018, `user_dashboard_layouts`): katalog widget TUNGGAL di `src/db/dashboard-catalog.ts` (id, jenis kpi/widget, peran, ukuran);
  validator/penyelesai murni di `src/db/dashboard-layout.ts` (`resolveLayout` tidak pernah gagal: id asing/duplikat dibuang, widget baru ditambahkan di akhir; `parseLayoutInput`
  ketat untuk simpan). Tersimpan jsonb `{v:1, items:[{id,size?,hidden?}]}`, RLS MILIK SENDIRI (`user_id = app_current_user() AND org_id = app_current_org()`; tak ada akses
  lintas pengguna, bahkan admin) + CHECK objek <= 4000 karakter. Preferensi tampilan: SENGAJA tidak diaudit. Widget tersembunyi tidak di-query (`loadDashboard(user, ids)`).
  Mode atur = `/?atur=1` (`LayoutEditor`, simpan otomatis lewat `saveDashboardLayout`/`resetDashboardLayout`; tombol biasa, bukan seret-lepas). Widget baru = 1 entri katalog +
  1 `case` di `Widgets.tsx` + loader di `data.ts` + label di `dashboard.*` (id dan ja).
  **Kartu KPI** (T-012): komponen tunggal `Kpi` (`Widgets.tsx`), grid otomatis menurut lebar (`kpiGridClass`: 2 kolom di ponsel, 5-6 di desktop), ±90-106 px tinggi. Setiap KPI di katalog WAJIB punya `tone` (neutral / info / attention) dan `icon` (nama di `Icon.tsx`, dites unit);
  tampilan akhir = `kpiLook(tone, nilai)` (`src/db/dashboard-kpi.ts`): KPI tindakan (attention) menyala HANYA bila nilainya > 0, bila 0 tenang (ikon centang + "beres"). Warna dari token `@theme` (`attn-*`, `info-*`, `ok-*`); warna bukan satu-satunya pembeda (ikon + teks + `sr-only`). Keterangan KPI singkat tanpa istilah internal.
- **Kamus istilah & i18n id** (`docs/glossary.md`): teks Indonesia TIDAK boleh memuat huruf Jepang telanjang (`test:i18n` menolak; izin hanya `languages.ja` di `ALLOW_CJK_IN_ID`):
  tulis istilah Indonesia/Inggris + cara baca romaji. Status LPK/TSK memakai `StatusBadge` (ikon + teks + warna + `statusHelp.<kode>` sebagai penjelasan; `StageBadge`/`DecisionBadge` hanya
  pembungkus) dan `StatusLegend`; status baru WAJIB punya `statusHelp` (dicek `test:i18n`). Daftar kandidat: chip filter (`ActiveFilterChips`), `EmptyState`, tabel -> kartu di ponsel
  (CSS `data-label`, tanpa menggandakan DOM). Form panjang: nav bagian menempel, kelengkapan langsung (`candidateCompleteness` di klien), `beforeunload` saat ada perubahan, DILARANG draf di
  localStorage/sessionStorage/IndexedDB (dijaga `tests/unit/no-draft-storage.test.ts`), nilai awal otomatis ditandai lewat `autoFilled` ("Diisi otomatis, periksa"). Umpan balik: `SubmitButton`
  (spinner + `aria-busy`), `ToastProvider`/`useToast` (aria-live), `(app)/loading.tsx` (skeleton), `(app)/error.tsx` (batas galat; tanpa isi galat teknis), aksi berbahaya = `btnDanger`.
- **Tabel di bahasa Jepang** (T-011; `globals.css` + `gridTh/gridTd/gridTdText/gridTdShort` di `components/styles.ts`): teks Jepang tanpa spasi bisa dipotong per HURUF di kolom sempit. Aturan satu tempat: `thead th`/`th[scope=col]` tidak pernah patah (hanya `:lang(ja)`), sel teks pendek (nama, perusahaan, alamat) memakai utilitas `cjk-phrase` (pecah di batas frasa, `word-break: auto-phrase`, cadangan `keep-all`) SELALU dengan `min-w-*`, nilai pendek `whitespace-nowrap`. Tabel baru dengan data Jepang: pakai kelas itu, jangan tambalan per halaman; Indonesia tidak berubah. Dijaga `tests/e2e/table-ja.spec.ts` (tinggi header/baris).
- **Terjemahan peramban** (T-016, dikoreksi T-023): terjemahan otomatis (Chrome "Terjemahkan") TIDAK diblokir (JANGAN `translate="no"` / meta `notranslate` di `<html>`, `<body>`, atau seluruh halaman: staf TSK non-Jepang/Indonesia perlu menerjemahkan label DAN isi tulisan). Yang dikunci HANYA IDENTITAS: nama orang + katakana, nama organisasi/LPK/perusahaan/lokasi/PIC, alamat, telepon, email, kode (kandidat, kasus), nomor dokumen, merek "Hashi" (termasuk "Hashi · commit"), judul job order, tanggal/angka. TEKS BEBAS (motivasi, PR diri, catatan TSK, catatan penilaian, isi catatan kegiatan/notulen/kronologi/tindak lanjut, catatan kuartal, catatan kartu, isian form 5-5, alasan batal) dan nilai pilihan BOLEH diterjemahkan: JANGAN dibungkus `translate="no"` dan JANGAN diberi `lang` (biar peramban menebak bahasa sumber; textarea input boleh ber-`lang`). Kolom profil kandidat ditentukan DEFINISI KOLOM, bukan per halaman: tiap field text/textarea/email di `candidate-sections.ts` wajib `data: "identity" | "prose"` (`fieldNature()`, dites `tests/unit/field-nature.test.ts`); PENGECUALIAN `health.medicalNote` = identity (data kesehatan sensitif; "Terjemahkan" Chrome mengirim teks ke server Google; keputusan Ipal), `health.visionNote` tetap prose (syarat job order buta warna); `DetailSections` memakainya, dan ringkasan baris berulang dibungkus per nilai (bukan satu `translate="no"` untuk seluruh baris). Pakai `<Data>` (`components/Data.tsx`: `translate="no"` + kelas `notranslate`) atau atribut `translate="no"` langsung pada elemen yang sudah ada (td, a, h1); `PageHeader` punya `titleIsData`/`introIsData`; pesan yang menyisipkan nama memakai tag `<n>{name}</n>` + `t.rich(key, { name, n: dataTag })` supaya kata "Oleh" tetap bisa diterjemahkan. `Multiline` (isi catatan) bisa diterjemahkan; `identity` hanya untuk isian berisi nama ("lapor ke"). Label, judul kolom, tombol, status, teks bantuan, menu: JANGAN ditandai. `<html lang>` tetap mengikuti bahasa UI. Dijaga `tests/e2e/translate-data.spec.ts`. Halaman baru yang menampilkan data wajib mengikuti aturan ini.
- **Pelacak 在留カード (kartu izin tinggal; T-017, migration 0025; desain `docs/zairyu-card.md`)**: tabel `residence_cards` (satu baris = satu kartu; perpanjangan = baris baru lewat `previous_card_id`), HANYA TSK (RLS `activity_member`); menulis = TSK_ADMIN atau 担当 efektif pekerja (`card_editor`, SQL, SAMA dengan `effectiveResponsible`; dites setara di `verify-rls` bagian X); tanpa DELETE (void + alasan); kartu `received` final dan wajib punya kartu pengganti (constraint trigger tertunda: "Terima kartu baru" = satu transaksi). Tahap pengingat = `cardStage()` (`src/db/zairyu.ts`, murni; `today` dari zona TSK) dengan `waiting_result`/`special_overdue`/`rejected`; penerima `cardRecipients` (担当 + semua Admin). Nomor dan foto kartu TIDAK disimpan di tabel ini (T-020). UI bagian di detail pekerja (T-018): `src/features/cards/` (`CardSection` di `/records/workers/<id>`, form `CardForms`, server action `actions.ts`, validasi murni `input.ts`, migration 0026 untuk `additional_docs_on`/`rejected_on`); daftar `/records/cards` + KPI `kpi-card-*` + menu (T-019): angka dan daftar SATU sumber (`loadCardRows` di `src/db/zairyu-queries.ts` + `matchesView`/`isActionNeeded` di `zairyu.ts`; "perlu tindakan" = tahap perhatian + menunggu hasil dengan 追加資料); LPK tidak pernah membaca tabelnya (tampilan LPK lewat fungsi sempit, tugas terpisah). Audit `residence_card.*` (kode status/tahap, tanpa tanggal/catatan/nama).
- **Riwayat aktivitas** (migration 0019; `src/db/audit-*.ts`, `src/features/audit/`, `/activity`): satu jalan tulis, `audit()` (`src/lib/audit.ts`): menyaring `before/after` lewat
  `sanitizeAuditPayload` (`AUDIT_VALUE_FIELDS` per entitas = satu-satunya nilai yang boleh tercatat: pilihan/status/kode/bahasa dan empat skor penilaian 1-5 HANYA untuk LPK_MONTHLY (skor TSK_ONLY tidak boleh bocor ke LPK; note/follow_up tidak pernah), tidak pernah nama orang, email, isi catatan, nama kandidat; kunci
  struktural `fields/section/rows/...` selalu boleh) dan menyimpan POTRET pelaku (`actor_name/role/org_name`; nama orang KOSONG untuk entri lintas organisasi, jadi LPK hanya melihat nama
  organisasi TSK). Entri IMMUTABLE (trigger `audit_logs_immutable` menolak UPDATE/DELETE, termasuk OWNER; TRUNCATE untuk `--reset` tidak dipicu). Baca: hanya LPK_ADMIN/TSK_ADMIN
  (`COALESCE` pada peran), cakupan = log tersimpan di organisasi sesi ATAU pelakunya organisasi sesi. Aksi baru = tambah ke `ACTIONS` (`audit-describe.ts`, kalimat id + ja, dites) dan
  jalankan `npm run verify:audit-coverage` (statis: server action yang menulis tanpa audit gagal kecuali ada di `EXEMPT` dengan alasan). `describeAudit(entry, locale, labels)` dipakai halaman,
  bagian riwayat di detail kandidat, widget `activity`, dan ekspor CSV (`/activity/export`, BOM + anti-rumus, mencatat `audit.export`; tanpa nama kandidat, hanya kode 8 karakter). Zona waktu
  tampilan = `organizations.timezone` (`safeTimezone`); batas filter tanggal juga menurut zona itu. Seed: `src/db/demo-audit.ts` (~30 entri per organisasi; `verify:seed` memeriksa).
- **Merek & login**: aset, varian, dan aturan pakai di `docs/brand.md` (`BrandLogo`, `npm run build:brand`). Login: `src/app/login/page.tsx` + `LoginForm` (dua kolom desktop; `callbackUrl` hanya jalur relatif lewat `safeCallbackPath`; error seragam; bahasa lewat cookie sebelum login). Widget "Aktivitas terbaru" tidak memuat `auth.login` (disaring di query `recentAudit`).
- **Catatan kegiatan TSK** (migration 0020; `src/features/records/`, `src/db/records-*.ts`, `src/lib/pdf/`; rute `/records/*`): HANYA TSK_ADMIN/TSK_STAFF (`activity_member()` di RLS; LPK/sensei/super admin: menu tidak ada, rute 404). Semua staf TSK membaca SEMUA catatan;
  tanda baca dan laporan harian hanya atas nama sendiri; mengubah catatan/kasus/kronologi: penulis atau TSK_ADMIN; wawancara berkala: semua staf. TIDAK ADA hapus (tanpa GRANT DELETE): salah = `void` + alasan, final; lampiran = `removed_at`.
  `activity_records.continues_record_id` ("Lanjutkan", T-007): terkunci setelah dibuat, asal aktif + organisasi sama (BEFORE INSERT) dan pekerja sama (constraint trigger TERTUNDA: dicek saat commit); riwayat per pekerja di `/records/workers/<id>` (`docs/catatan-kegiatan.md`).
  Penanggung jawab pekerja (T-010, migration 0023): tabel `responsible_assignments` APPEND-ONLY per perusahaan/penempatan; efektif = `effectiveResponsible` (`src/db/responsibility.ts`); batas 50/staf di SATU konstanta `WORKLOAD` (`workload-config.ts`), hanya peringatan; KPI = `responsibilityOverview`; tulis hanya TSK_ADMIN.
  Edit menaikkan `version_no` dan menulis `activity_revisions` lewat TRIGGER (append-only, juga untuk OWNER); aplikasi mengubah baris induk DULU baru himpunan terkait (pekerja/hadirin) supaya snapshot memuat himpunan lama. FK ke `candidates` RESTRICT
  (hapus kandidat ditolak trigger `candidates_block_delete` + `candidate_delete_summary().blocked`). "Belum dibaca" punya SATU definisi (`unreadRecordIds`/`unreadReportIds`) untuk KPI, lencana, dan daftar; wawancara berkala per KUARTAL tahun fiskal (T-008): `quarterState`/`monthMark` (`records-core.ts`) + `quartersOfFiscalYear`/`pendingInterviewQuarters` (satu sumber untuk grid, KPI, dan daftar tahunan `/records/interviews/annual`); pekerja ENDED ikut grid/laporan FY-nya (`allWorkers`; aturan di `docs/catatan-kegiatan.md`).
  Audit di log org TSK saja (`activity_*`, `periodic_interview.*`, `activity_export`): jenis/status/kategori/bulan, TIDAK PERNAH isi, nama pekerja, atau nama berkas; tanda baca tidak diaudit. Action yang mengalihkan halaman dari `ActionForm redirectTo` TIDAK boleh memanggil `revalidatePath`
  (form terlepas sebelum pengalihan). PDF: `src/lib/pdf` (pdfkit di-BUNDLE, bukan external: nft kehilangan `@noble/*` di image), label di `labels.ja.ts`, versi klien tanpa nama staf/kode kasus dan wajib `confirm=1`. Foto: `sharp` (rotasi EXIF lalu buang semua metadata), HEIC ditolak. Fitur baru
  = tabel + RLS + bagian S di `verify-rls` + `ACTIONS` audit + `verify:audit-coverage` + `seed:records`/`verify:seed`. **Form 5-5 (T-009, migration 0024)**: kolom `method`/`responder_role`/`responder_title`/`form55` (jsonb tervalidasi) di `periodic_interviews`; butir TETAP di `src/db/form55.ts` (kode `work.1`…; 18 butir; kalimat = teks resmi form, status DRAFT sampai dicek staf TSK; `otherLabel` = isian kurung ⑤(2); `createdOn` kosong = tanggal simpan terakhir), validator `parseForm55` (butir bermasalah wajib isi, bagian 4 hanya bila ⑥ = 有), form `Form55Fields`, PDF `src/lib/pdf/form55.ts` (`/records/export/form55/…`, `form55-year/…`), halaman `/records/workers/<id>/annual`; audit hanya `form55=filled` + `nonconformity`; `docs/catatan-kegiatan.md`.
- **Lembar klien PDF** (langkah 6, migration 0021; `src/lib/pdf/client-sheet*.ts`, `src/features/client-sheet/`, rute `/sheet/company/[id]` dan `/sheet/job-order/[id]`; `docs/lembar-klien.md`): FORMAT DRAFT, semua label/urutan bagian/kolom di
  SATU berkas `client-sheet.config.ts` (pasangan `[Jepang, Indonesia]`). Alur: loader (`queries.ts`, lewat RLS TSK) -> model murni `buildCompanySheet`/`buildJobOrderSheet` (`client-sheet-model.ts`: bagian kosong dilewati, mode `share` membuang
  telepon PIC, catatan internal, syarat gender, nama staf SECARA STRUKTUR, bukan disembunyikan) -> `renderSheetPdf` (pdfkit) DAN pratinjau `SheetPreview` dari model yang sama. Mode `share` WAJIB `confirm=1` (400 tanpa itu). Hanya TSK (`staffOrResponse`: LPK/sensei/super admin 404).
  Audit `client_sheet_export` (jenis, mode, bahasa label, halaman; tanpa nama/isi); `job_order.housing` boleh tercatat sebagai nilai, teks bebas/gaji tidak. Kolom lama dipakai ulang (`description` = 業務内容, `monthly_salary` = 基本給, `salary_note`, `work_place`, `note` = internal);
  tabel PIC = `client_site_contacts` (tanpa email). Menambah isian lembar = kolom + zod di `fields.ts` + label form (`clients.forms.*`/`jobOrders.forms.*`) + baris di model + `COMPLETENESS` + `sheet.missing.*`. Data demo: `src/db/demo-client-sheet.ts` (`seed:client-sheet` additive, 1 perusahaan + 1 job order OPEN sengaja kosong).
  Tes: `tests/unit/client-sheet.test.ts`, e2e `client-sheet.spec.ts`, `verify-rls` bagian T, `verify:seed` 2e. Kebijakan syarat gender di dokumen dibagikan perlu dikonfirmasi ke 行政書士 sebelum data nyata.
- **Hapus kandidat permanen** (`candidates/delete-actions.ts`, `DeleteCandidate.tsx`, migration 0013): HANYA LPK_ADMIN pemilik, ditegakkan
  di UI (komponen tidak dirender untuk peran lain), server action (peran + organisasi + ketik nama/kode persis), RLS (`candidates_lpk_admin_delete`),
  dan trigger `candidates_block_delete` (BEFORE DELETE: menolak bila ada keputusan TSK DOCUMENT_PROCESS atau DEPARTED dari TSK mana pun, daftar
  eksplisit, berlaku juga bagi sistem; dilewati bila `pg_trigger_depth() > 1`, yaitu hapus berantai dari organisasi; TRUNCATE tidak memicunya,
  jadi `db:seed --reset` aman). Cascade lewat FK `ON DELETE CASCADE` di SEMUA tabel ber-`candidate_id` (dites lewat `information_schema`: tabel
  baru ber-candidate_id yang tidak cascade akan gagal di `test:rls`); `audit_logs` TANPA FK sehingga riwayat bertahan. Urutan: audit + DELETE dalam
  satu transaksi, berkas disk dihapus SETELAH commit (gagal -> log + audit `candidate.delete_files_failed`). Audit `candidate.delete`: id, kode
  (8 karakter id), jumlah baris; JANGAN nama/isi. `candidate_delete_summary()` (SECURITY DEFINER, `COALESCE` pada pemeriksaan peran: NULL dalam
  `NOT` melewati IF) memberi angka untuk dialog, null selain LPK_ADMIN pemilik. E2E hanya boleh menghapus kandidat buatannya sendiri.
- **Bahasa pengguna**: `users.languages` (enum `language` id/ja/en, array, CHECK `language_array_ok`: >=1, tanpa NULL/duplikat) = bahasa yang DIKUASAI;
  `users.locale` (id/ja) = bahasa TAMPILAN, hanya diubah tombol bahasa (`setLocale`) dan TIDAK ditampilkan di daftar/form pengguna.
  Pengguna baru: `locale` awal dari `languages` (id jika ada, lalu ja, lalu id). Audit user: `languages` (id/ja/en) tercatat sebagai nilai dari/ke (ada di `AUDIT_VALUE_FIELDS.user`, bersama role/active); nama dan email tidak.
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
- **JANGAN `Promise.all` pada `tx`** (kueri bersamaan di SATU koneksi pg = peringatan "client.query() ... already executing"; di pg@9 menjadi error). Pakai `inSeries(() => kueri1, () => kueri2)` dari `src/db/serial.ts`.
  `Promise.all` hanya untuk pekerjaan yang TIDAK berbagi koneksi (mis. `getLocale()`, atau `tenantQuery(...)` terpisah). Dijaga `tests/unit/no-tx-promise-all.test.ts` (pemindai sumber) dan `scripts/guard-pg-concurrency.cjs` (dipasang `serve-standalone.mjs`: server e2e/CI mati kode 97 bila terjadi).
- **`npm run dev` / `next dev` menulis blok "nextjs-agent-rules" ke `CLAUDE.md`** saat dijalankan. Jangan di-commit: `git checkout -- CLAUDE.md` setelah memakai dev server (dev server juga perlu `localhost`, bukan `127.0.0.1`, atau hidrasi diblokir).
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
2. Commit (Bahasa Indonesia) di branch tugas → `git push` → PR → CI (GitHub Actions) harus hijau → review PM (lihat "Peran dan aturan kerja")
3. Setelah `PM: DISETUJUI` dan merge, deploy di OptiPlex: `scripts/deploy.sh` (catat output `commit` di STATUS)
