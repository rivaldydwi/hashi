# Catatan kegiatan (langkah 7A)

Fitur khusus **TSK_ADMIN dan TSK_STAFF** untuk mencatat pekerjaan harian, notulen pertemuan, kronologi kasus, dan wawancara berkala pekerja yang sedang
bekerja di Jepang. LPK, sensei, dan super admin tidak melihat apa pun (menu, rute 404, data, lampiran, ekspor, riwayat). Isi catatan ditulis dalam bahasa Jepang;
label PDF selalu bahasa Jepang (`src/lib/pdf/labels.ja.ts`).

| Format | Tabel utama | Rute |
|---|---|---|
| ① 業務記録 (Gyōmu Kiroku) catatan kerja harian | `activity_records` (`kind = daily_work`) | `/records` |
| ② 議事録・面談記録 (Gijiroku / Mendan Kiroku) notulen | `activity_records` (`kind = meeting`) | `/records/meetings` |
| ③ 時系列 (Jikeiretsu) kronologi kasus | `activity_cases` + `case_timeline_events` | `/records/cases` |
| ④ 定期面談 (Teiki Mendan) wawancara berkala | `periodic_interviews` + `periodic_interview_quarter_notes` | `/records/interviews` |
| Tindak lanjut (未対応・継続事項) | `activity_followups` | `/records/tasks` |

Pendukung: `activity_daily_reports` (+ `_recipients`) laporan harian ke leader, `activity_record_reads` tanda "sudah dibaca", `activity_attachments` foto,
`activity_revisions` riwayat edit, `activity_case_counters` penghitung kode kasus. Pekerja aktif = penempatan (`placements`) berstatus ACTIVE.

## Aturan akses (RLS, `drizzle/0020_activity_records.sql`)
- Semua staf TSK satu organisasi membaca SEMUA catatan (tanpa opsi "hanya admin"). Tanda "sudah dibaca" per orang; tanpa alur persetujuan.
- Menulis: atas nama sendiri (`created_by = app.user_id`). Tanda baca, `shared_at` laporan harian, dan tanda baca penerima hanya bisa ditulis orang yang bersangkutan.
- Mengubah catatan/kasus/baris kronologi: penulis (atau pembuat) dan TSK_ADMIN. Wawancara berkala: semua staf TSK. Status tugas: penanggung jawab, pembuat, atau TSK_ADMIN.
- Subjek (pekerja) harus kandidat yang terlihat TSK (lewat RLS kandidat). Penulis, penanggung jawab, dan penerima harus staf TSK organisasi yang sama.

## Edit, pembatalan, riwayat
- **Tidak ada penghapusan** (tidak ada GRANT DELETE ke tabel utama). Kesalahan = `status = void` + alasan wajib; tetap terlihat (dicoret) dan ikut di PDF internal. Void bersifat final.
  Lampiran "dihapus" = `removed_at` (berkas tetap di disk, tidak bisa dipulihkan lewat aplikasi).
- Tiap edit menaikkan `version_no` dan menulis baris `activity_revisions` (snapshot nilai SEBELUM) lewat trigger `AFTER UPDATE`. Riwayat append-only: UPDATE/DELETE ditolak untuk
  semua peran termasuk OWNER; aplikasi hanya punya SELECT. Himpunan terkait catatan (pekerja, hadirin) ikut di snapshot: aplikasi mengubah baris catatan DULU, baru himpunan terkait.
- Pembaca yang `version_no_read` < versi sekarang melihat "Diperbarui sejak kamu baca".
- Kunci asing ke `candidates` RESTRICT. Hapus kandidat oleh LPK_ADMIN ditolak bila ada catatan (trigger `candidates_block_delete` dan `candidate_delete_summary().blocked`).

## Riwayat per pekerja dan "Lanjutkan" (T-007)
- **Satu rangkaian per pekerja** (keputusan: fokusnya perkara di pekerja itu; tidak ada tabel "thread"). Halaman `/records/workers/<candidateId>` (hanya staf TSK; LPK/sensei 404; pekerja yang tidak terlihat = 404) menampilkan dalam SATU garis waktu: catatan ① dan ② yang menyebut pekerja,
  baris kronologi ③ dari kasus yang melibatkannya, dan wawancara berkala ④ miliknya. Terbaru di atas (bisa dibalik `?order=asc`), 30 entri per halaman, yang dibatalkan tetap tampil dicoret. Di atasnya: tindak lanjut yang masih terbuka (dari catatan, kasus, atau wawancara pekerja itu).
  Catatan dengan beberapa pekerja muncul di riwayat tiap pekerja. Kueri: `workerTimeline`, `openTasksOfWorker` di `src/features/records/queries.ts`.
- **Tombol "Lanjutkan"** di detail catatan -> `/records/new?kind=<jenis>&continue=<id>`: pekerja, lokasi (配属先), dan kasus terisi dari catatan asal (ditandai "Diisi otomatis, periksa"), dan panel baca-saja menampilkan 3 catatan terakhir pekerja + tindak lanjut terbuka.
  Disimpan sebagai `activity_records.continues_record_id` (migration 0022): asal harus ada dan terlihat (organisasi sama), AKTIF, dan menyebut setidaknya satu pekerja yang sama (trigger tertunda, diperiksa saat COMMIT karena pekerja ditambahkan setelah baris catatan);
  terkunci setelah dibuat (tidak bisa diubah/dikosongkan, juga oleh pembuatnya). Detail catatan menampilkan "Lanjutan dari …" dan "Dilanjutkan oleh …". Catatan asal yang dibatalkan tidak bisa dilanjutkan, tetapi rantai yang sudah ada tetap terlihat (dengan penanda dibatalkan).
- Tautan ke riwayat: detail catatan (per pekerja), detail kandidat sisi TSK, grid 定期面談. Audit: `activity_record.create` memuat `continued: true` (tanpa id/isi). Seed: `d13` melanjutkan `d10`; `verify:seed` memeriksa rantai valid; RLS bagian U; e2e `records-continue`.

## Penanggung jawab pekerja dan beban kerja (T-010)
- **Aturan (sumber: staf TSK, 2026-10-06):** di divisi 支援部 tiap staf menjadi penanggung jawab (担当/責任者) untuk satu daerah atau satu/beberapa perusahaan klien. Mulai **April 2027** satu staf TSK maksimal mendukung **50 pekerja**, dihitung **per orang staf**
  (total semua pekerja yang ia pegang di seluruh Jepang dan semua klien; bukan per klien/daerah; 30 di klien A + 20 di klien B = 50). Penanggung jawab juga dipakai pengingat 在留カード (T-004) dan bawaan 対応者 form 5-5 (T-009).
- **Data** (migration 0023, tabel `responsible_assignments`): ditetapkan **per perusahaan klien** (bawaan semua pekerjanya) dan bisa **diganti per pekerja** (per penempatan, menimpa perusahaan; dikosongkan = "ikut perusahaan"). Riwayat **append-only** (tanpa UPDATE/DELETE) dengan tanggal mulai berlaku;
  yang berlaku = penetapan terbaru dengan tanggal mulai <= hari ini. Staf harus staf TSK organisasi yang sama dan target milik organisasi yang sama (trigger); `created_by` selalu pengguna sesi. RLS: baca = staf TSK organisasi sama; tulis = TSK_ADMIN; LPK/sensei/super admin/TSK lain tidak melihat.
  "Daerah" belum dimodelkan terpisah: kelompokkan lewat perusahaan.
- **Fungsi murni** (`src/db/responsibility.ts`, tes `tests/unit/responsibility.test.ts`): `currentAssignment`, `effectiveResponsible` (per pekerja > perusahaan > tidak ada), `workloadLevel`, `workloadByStaff` (hanya penempatan **ACTIVE**; ENDED tidak dihitung; staf tanpa pekerja tetap 0), `unassignedWorkers`. Batas ada di SATU konstanta `WORKLOAD` (`src/db/workload-config.ts`: max 50, peringatan mulai 45, berlaku 2027-04-01).
- **Halaman** `/records/responsible` (tab "Penanggung jawab"): beban per staf dengan peringatan jelas (kuning >= 45 termasuk 50 = batas tercapai, merah > 50, menyebut aturan April 2027; **TIDAK memblokir** penyimpanan), daftar "belum ada penanggung jawab", form per perusahaan dan per pekerja (hanya Admin TSK), riwayat perubahan,
  filter `?staff=`, `?mine=1` ("pekerja saya"), `?view=over|unassigned`. Tampil juga di detail pekerja sisi TSK, halaman riwayat pekerja, dan grid 定期面談 (kolom + filter "pekerja saya").
- **KPI dashboard (TSK_ADMIN):** "Staf melebihi batas pekerja" (= jumlah baris `?view=over`) dan "Pekerja tanpa penanggung jawab" (= daftar `?view=unassigned`); satu fungsi `responsibilityOverview`. Audit `responsible.set`: hanya id baris + cakupan (company/placement), tanpa nama staf/pekerja/perusahaan.
- Seed: penetapan per perusahaan (bergantian staf 1 dan 2), satu penetapan per pekerja, dan satu perusahaan sengaja tanpa penanggung jawab (pekerja tanpa penanggung jawab). Seed TIDAK memuat staf >= 45 pekerja: itu butuh >= 45 kandidat aktif sedangkan seed demo hanya punya 36 kandidat dan menambahnya menggeser banyak angka tetap di tes;
  skenario 45/50/51 diuji e2e dengan data uji sementara (dibersihkan). Seed pilot 200 siswa (langkah 8) akan memunculkannya secara alami.

## Laporan harian
Laporan = pembungkus (author, tanggal). `shared_at` diisi saat staf menekan "Kirim ke leader"; penerima bawaan semua TSK_ADMIN (tanpa pengirim) ditambah pilihan staf lain. ① yang dibuat atau diedit
sesudah `shared_at` diberi penanda; "Kirim ulang" memperbarui `shared_at`. Penerima yang sudah membaca melihat "Diperbarui sejak kamu baca" bila laporan dikirim ulang atau ada ① baru/diedit sesudah waktu baca.
Definisi "belum dibaca" ada SATU tempat (`unreadReportIds`, `unreadRecordIds` di `src/db/records-queries.ts`): dipakai KPI dashboard, lencana sidebar, dan daftar.

## Wawancara berkala
**Aturan (sumber: staf TSK, 2026-10-06):** 定期面談 wajib **minimal sekali per kuartal tahun fiskal** (Apr-Jun, Jul-Sep, Okt-Des, Jan-Mar), dimulai sejak pekerja **mulai bekerja di perusahaan**; boleh lebih sering.
Laporan tahunan ke imigrasi dibuat per tahun fiskal (April-Maret), diserahkan setelah tahun fiskal berakhir, dan **semua pekerja yang sempat bekerja di tahun fiskal itu wajib dilaporkan, termasuk yang berhenti di tengah tahun**
(mulai Mei 2026, berhenti Jan 2027 -> tetap masuk laporan FY2026; mulai Feb 2026 -> masuk FY2025).

**Implementasi** (fungsi murni di `src/db/records-core.ts`, kueri di `src/db/records-queries.ts`, tes `tests/unit/interview-quarters.test.ts`):
- Masa kerja = penempatan `placements` ACTIVE maupun ENDED (`start_date` .. `end_date`, inklusif; beberapa penempatan bila pernah berhenti lalu bekerja lagi). Kuartal **wajib** bila pekerja bekerja minimal satu hari di kuartal itu.
- `quarterState`: **Selesai** (`done`: ada >= 1 wawancara berlaku, status selain 未実施, bertanggal di kuartal itu; tanggal = tanggal wawancara, atau awal bulan periode bila kosong), **Belum, tenggat <akhir kuartal>** (`open`: kuartal BERJALAN, hari pertama sampai hari terakhir, belum ada wawancara selesai;
  masih bisa dikejar, tampil netral dan kuning tegas pada 14 hari terakhir, konstanta tunggal `QUARTER_URGENT_DAYS`), **Terlewat** (`missed`: kuartal sudah lewat tanpa wawancara selesai; merah, tidak bisa diperbaiki), **Tidak berlaku** (`na`: hanya ada baris 対象外 di kuartal itu, tidak ditagih),
  kuartal depan tidak ditagih (`notDue`), kuartal di luar masa kerja tidak wajib (`notRequired`). Revisi PM (2026-10-06): tenggat = akhir kuartal, jadi kuartal berjalan TIDAK langsung merah (sebelumnya semua pekerja merah tiap tanggal 1 April/Juli/Oktober/Januari).
- **Grid** (`/records/interviews`): baris = semua pekerja yang bekerja di tahun fiskal itu (ACTIVE dan ENDED; yang berhenti diberi penanda "berhenti <tanggal>"). **Status utama per kuartal**; kolom bulan tetap ada karena wawancara boleh bulanan (Selesai / Tidak berlaku / "Belum diisi" netral, BUKAN tanda merah; bulan di luar masa kerja atau bulan depan tidak ditagih).
  Filter status/`?view=pending` bekerja pada status kuartal.
- **KPI dashboard** "Wawancara berkala kuartal ini belum dilakukan" = jumlah kuartal **open** pada tahun fiskal berjalan (`openInterviewQuarters`, satu fungsi dengan grid: `quartersOfFiscalYear`) = pekerja yang masih perlu diwawancara sebelum tenggat; sama dengan `?view=pending` di grid.
  Kuartal **missed** (FY berjalan maupun FY lalu) TIDAK masuk KPI: sudah tidak bisa diperbaiki, tampil di grid dan daftar tahunan sebagai "bolong" sebagai bahan laporan (jadi tanda "sudah dilaporkan" belum diperlukan).
- **Daftar persiapan laporan tahunan** (`/records/interviews/annual?fy=`): pekerja yang wajib dilaporkan, masa kerja, status + jumlah wawancara per kuartal, kuartal bolong (= `missed`), dan kuartal berjalan yang masih bisa dikejar (`open`). Formulir laporannya (form 5-5) ada per wawancara dan per pekerja (lihat bagian berikut).
- **Pekerja yang sudah berhenti di form catatan**: pemilih pekerja ①/② dan "Lanjutkan" memuat penempatan ENDED di bawah yang aktif dengan penanda "berhenti <tanggal>", jadi catatan/wawancara susulan tetap bisa dibuat. Halaman sel wawancara dan ekspor PDF 定期面談 juga membuka pekerja yang sudah berhenti.
- Data lama tidak diubah: wawancara per bulan tetap sah; unik (pekerja, bulan) tetap berlaku, jadi saat ini satu bulan hanya bisa punya satu wawancara aktif (kuartal bisa diisi oleh bulan mana pun di dalamnya).
- Seed: satu penempatan ENDED di tengah tahun fiskal (tanpa keputusan DEPARTED, hanya data demo) dengan wawancara di kuartal pertama sehingga kuartal berikutnya Belum; `verify:seed` memeriksa KPI = grid dan pekerja berhenti ikut FY-nya, tidak FY sesudahnya.
Kolom identitas grid (bidang, tanggal mulai, perusahaan, alamat, telepon, PIC) ditarik dari data yang sudah ada, tidak disimpan ganda.

## Form 5-5 (参考様式第5-5号) dan halaman tahunan per pekerja (T-009)
Tiap 定期面談 dilaporkan ke imigrasi dengan 参考様式第5-5号「定期面談報告書（1号特定技能外国人用）」. Form kosong resmi dan publik di situs 出入国在留管理庁 (cari "参考様式第5-5号"); berkasnya TIDAK di-commit
(lisensi tidak jelas), cukup rujukan ini. Wawancara dengan atasan/監督者 tidak memakai form 5-6: cukup dicatat sebagai ② 議事録 (jawaban staf TSK, 2026-10-06).
- **Penyimpanan** (migration 0024, kolom di `periodic_interviews`): `method` (対面 `in_person` / オンライン `online`), `responder_role` (支援責任者 `support_manager` / 支援担当者 `support_staff`), `responder_title` (役職名), `form55` (jsonb, <= 20000 karakter).
  Nama 対応者 = kolom `staff_id` yang sudah ada (bawaan form: penanggung jawab efektif pekerja dari T-010 bila masih staf aktif, selain itu pengguna yang login; boleh diganti per wawancara). Form kosong (semua NULL) = belum diisi; data lama tetap sah dan tetap bisa dicetak.
- **Butir TETAP di satu berkas**: `src/db/form55.ts` (`FORM55_GROUPS`: ① 業務内容 3 butir, ② 待遇 6, ③ 保護 5, ④ 生活 2, ⑤ その他 2 = 18; kode `work.1` dst., label Jepang untuk PDF + Indonesia untuk form) dan validator zod (`parseForm55`). Jangan mengganti nomor kode: data lama merujuknya.
  Kalimat butir = TEKS RESMI form (diberikan PM, 2026-10-06; revisi PR #10), status tetap DRAFT sampai dicek staf TSK; bila form berubah, ubah di berkas itu saja (tanpa migrasi). ⑤(2) "その他（　）" punya isian kurung terpisah (`otherLabel`, dicetak `その他（<isian>）`).
  Bentuk jsonb: `{v:1, items:{<kode>:{a:"ok"|"problem", text}}, nonconformity: true|false|null (⑥), special (⑦), response: {...}|null (bagian 4), otherLabel, createdOn}`. Butir "problem" wajib berisi; bagian 4 (発生日, 内容, 本人/所属機関/関係機関への対応) hanya disimpan bila ⑥ = 有 (発生日 + 内容 wajib), selain itu dibuang.
  Butir yang belum dijawab tidak ada di peta (draf boleh).
- **Form isian** di halaman sel wawancara (`Form55Fields`, form yang sama dengan wawancara: satu tombol simpan). "Tidak berlaku" atau "Belum dilaksanakan" tidak menyimpan isi form. Riwayat versi tetap jalan (snapshot trigger memuat form lama; riwayat menampilkan ringkasan jumlah butir/masalah/ketidaksesuaian).
- **作成年月日**: `createdOn` kosong = tanggal form TERAKHIR DISIMPAN (`updated_at` menurut zona TSK, dihitung saat dicetak), bukan tanggal wawancara; bisa diisi eksplisit di form bila laporan dibuat belakangan. 面談実施者 = 対応者 (satu kolom; keputusan PM).
- **PDF**: `/records/export/form55/<pekerja>/<YYYY-MM-01>` (satu form) dan `/records/export/form55-year/<pekerja>?fy=` (gabungan setahun: semua wawancara yang dilaksanakan, satu form per halaman, urut bulan; yang form-nya kosong tercetak kosong). `src/lib/pdf/form55.ts`, label di `labels.ja.ts`, tes isi teks `tests/unit/form55.test.ts`. Header: `参考様式第5－5号` kiri atas, nama organisasi kecil di kanan. Hanya staf TSK (LPK/sensei 404).
- **Halaman tahunan per pekerja** `/records/workers/<id>/annual?fy=`: tabel 定期面談 setahun (status form, jumlah butir, masalah, ketidaksesuaian, PDF per baris), tombol PDF gabungan, dan bagian TERPISAH "Wawancara karena kejadian" (catatan ② yang menyebut pekerja ini; tidak memakai form 5-5). Ditautkan dari daftar tahunan, sel wawancara, dan riwayat.
- **Audit**: `periodic_interview.*` mencatat `period` (bulan, jadi kuartalnya), `form55: "filled"` dan `nonconformity: yes|no`, `method`; tidak pernah isi teks atau nama. Ekspor PDF: `activity_export` dengan `exportKind` `form55` / `form55_nonconformity` / `form55_year`, tanpa nama.
- Tes: unit `form55.test.ts`; `verify-rls` bagian W; `verify:seed` (form terisi, 基準不適合, form kosong); e2e `form55.spec.ts`.

## Ekspor PDF
`src/lib/pdf/` (pdfkit, murni JavaScript: tanpa browser headless; font Noto Sans JP OFL di `assets/fonts` disematkan sebagai subset). Empat jenis: catatan tunggal, laporan harian, 時系列 (internal / untuk klien), 定期面談.
Versi klien: hanya baris aktif yang ikut ekspor, TANPA nama staf penyusun dan kode kasus internal (nama berkas juga tanpa kode), kolom 備考 bisa dimatikan, dan WAJIB centang konfirmasi di halaman pratinjau (server menolak tanpa `confirm=1`).
Setiap ekspor dicatat di audit (`activity_export`: jenis, jumlah baris, versi klien; tanpa isi). pdfkit sengaja di-bundle Next.js (bukan `serverExternalPackages`) karena dependensi bersarangnya hilang di image produksi.
Label PDF 定期面談 memakai nama kolom lembar Excel (`配属先企業住所`, `配属先企業担当者`).

## Foto
JPG/PNG/WebP, maks 10 MB, maks 10 per catatan; tipe dari isi berkas; rotasi EXIF diterapkan lalu SEMUA metadata (EXIF, GPS, ICC) dibuang (`sharp`). **HEIC ditolak** (libvips bawaan sharp tanpa HEVC): iPhone mengirim JPEG
bila `accept` hanya menyebut JPEG/PNG/WebP, atau atur kamera ke "Paling kompatibel". Penyimpanan privat `STORAGE_DIR/activity/<org>/<id>.<ext>`; unduh lewat `/records/attachments/[id]` (login + RLS, `attachment` + nosniff).
Unduhan langsung dicatat di audit; miniatur di halaman (`Sec-Fetch-Dest: image`) tidak dicatat per gambar.

## Audit
`activity_record.*`, `activity_case.*`, `case_timeline_event.*`, `activity_followup.*`, `activity_attachment.*`, `activity_daily_report.share`, `periodic_interview.*`, `activity_export`. Disimpan di log organisasi TSK (LPK tidak membacanya).
Hanya jenis/status/kategori/bulan (lihat `AUDIT_VALUE_FIELDS`); tidak pernah isi teks, nama pekerja, atau nama berkas. Tanda "sudah dibaca" tidak diaudit. Filter "Catatan kegiatan" ada di `/activity`.

## Lama simpan dan cadangan
Minimal 1 tahun, target 5 tahun (sesuai masa kerja pekerja). Aplikasi tidak menghapus catatan. **Karena itu cadangan di luar server (database + volume `docs-data`, termasuk folder `activity/`) WAJIB berjalan
sebelum data nyata masuk**: kehilangan disk OptiPlex berarti kehilangan seluruh riwayat kerja. Perintah cadangan ada di README.

## Data demo
`npm run seed:records` MENAMBAH data fitur di atas database yang sudah ada (tanpa reseed; idempoten: menolak bila tabel fitur sudah berisi kecuali `--force`; menolak bila ada organisasi non-dummy). Yang disentuh selain tabel fitur
dilaporkan: 1 pengguna dummy `tsk.staff2@hashi.test` bila staf TSK < 3, dan 1 keputusan DEPARTED (+ penempatan otomatis) bila pekerja aktif < 3. `db:seed` memanggil logika yang sama untuk lingkungan baru (`src/db/demo-records.ts`).
Di container: `docker compose run --rm migrate npm run seed:records` (produksi) atau `dc run --rm migrate npm run seed:records` (demo, lewat `scripts/demo-lib.sh`). `verify:seed` memeriksa hasilnya.
