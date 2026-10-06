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

## Laporan harian
Laporan = pembungkus (author, tanggal). `shared_at` diisi saat staf menekan "Kirim ke leader"; penerima bawaan semua TSK_ADMIN (tanpa pengirim) ditambah pilihan staf lain. ① yang dibuat atau diedit
sesudah `shared_at` diberi penanda; "Kirim ulang" memperbarui `shared_at`. Penerima yang sudah membaca melihat "Diperbarui sejak kamu baca" bila laporan dikirim ulang atau ada ① baru/diedit sesudah waktu baca.
Definisi "belum dibaca" ada SATU tempat (`unreadReportIds`, `unreadRecordIds` di `src/db/records-queries.ts`): dipakai KPI dashboard, lencana sidebar, dan daftar.

## Wawancara berkala
Tahun fiskal April-Maret (`src/db/records-core.ts`). Sel grid: **Selesai** (ada wawancara berstatus selain 未実施), **Belum** (bulan berjalan atau lewat tanpa wawancara, atau berstatus 未実施), **Tidak berlaku**
(`applicable = false`, alasan di catatan), atau kosong (bulan depan atau sebelum pekerja mulai bekerja: tidak ditagih). Kolom identitas (bidang, tanggal mulai, perusahaan, alamat, telepon, PIC) ditarik dari
data yang sudah ada, tidak disimpan ganda. KPI dashboard "Wawancara berkala belum dilakukan" = jumlah sel Belum (`pendingInterviewCells`), sama dengan grid `?view=pending`.

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
