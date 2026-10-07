# Laporan engineer

Ditulis oleh **engineer** (Claude Code di Mini PC). PM membaca berkas ini saat me-review PR. **Entri terbaru di paling atas.**
Tidak boleh memuat secret, kata sandi, URL berkata sandi, isi `.env`, atau data pribadi kandidat.

## Format entri

```markdown
## YYYY-MM-DD · T-XXX · <judul singkat>

**PR:** #<nomor> (branch `eng/T-XXX-…`)
**Status:** siap direview | revisi ke-N | butuh Ipal | antrean kosong

**Yang dikerjakan**
- …

**Verifikasi** (perintah → hasil apa adanya; yang tidak dijalankan ditulis beserta alasannya)
- `npm run typecheck` → lulus
- …

**Kondisi server** (bila disentuh/di-deploy): commit produksi, health check.

**Kendala / catatan**
- …

**Pertanyaan** (awali `BUTUH IPAL:` bila harus diputuskan Ipal)
- …

**Usulan berikutnya** (bukan tugas; PM yang memutuskan masuk TASKS atau tidak)
- …
```

---

<!-- Entri baru di bawah garis ini, terbaru di atas. -->

## 2026-10-06 · T-004 · Desain pelacak 在留カード + hasil deploy T-009

**PR:** #11 (branch `eng/T-004-desain-zairyu-card`)
**Status:** siap direview (dokumen saja, tanpa kode/skema/migrasi)

**Hasil deploy T-009 lewat `scripts/deploy.sh --backup`** (PR #10 di-merge `28e525b`, setelah `PM: DISETUJUI` dan CI hijau di head `2398b55`)
- Cadangan terenkripsi dulu: `hashi-20261006-213318-*` (database 651 entri, 146 berkas dokumen; `LAST_FAILED` tidak ada). Migration 0024 terterap otomatis: keempat kolom baru (`method`, `responder_role`, `responder_title`, `form55`) ada di `periodic_interviews` produksi.
- Keluaran akhir skrip: `✓ deploy selesai. Commit berjalan: 28e525b (label image: 28e525b); health: {"status":"ok","commit":"28e525b"}`. Demo tidak disentuh (Up, healthy). Label form 5-5 tetap DRAFT sampai staf TSK mengecek (PM yang menyampaikan).

**Yang dikerjakan**
- `docs/zairyu-card.md`: ruang lingkup; data (tabel usulan `residence_cards`, riwayat = baris baru, "Terima kartu baru" = satu transaksi, penanggung jawab diturunkan dari T-010 bukan kolom); nomor/foto kartu pro-kontra (rekomendasi: TIDAK disimpan);
  hak akses (RLS hanya TSK, tanpa DELETE, audit tanpa isi, batas tampilan LPK lewat fungsi SECURITY DEFINER sempit, bukan membuka tabel); pengingat sebagai fungsi murni `cardStage` (tabel tahap + 12 kasus tepi: sudah lewat, akhir bulan, Februari kabisat, Tokyo vs Jakarta, dst.);
  tampilan (KPI, daftar `/records/cards`, bagian di detail pekerja); rencana pemecahan T-A (skema+aturan), T-B (UI detail), T-C (daftar+KPI+seed), T-D opsional (isi awal data), masing-masing dengan kriteria selesai; 12 pertanyaan bernomor untuk staf TSK.
- `docs/glossary.md`: 在留資格, 在留期間, 在留期限, 在留期間更新許可申請, 特例期間, 担当.
- Tanggal contoh (batas bulan, kabisat, zona) dihitung dengan skrip sementara, bukan ditebak.

**Verifikasi**
- Tidak ada perubahan kode, skema, atau migrasi (`git diff --stat main` hanya `docs/zairyu-card.md`, `docs/glossary.md`, `docs/STATUS.md`); tes tidak dijalankan ulang karena tidak ada kode yang berubah (CI tetap berjalan di PR).

**Kondisi server:** produksi `28e525b` (T-009). Tidak ada deploy untuk T-004.

**Pertanyaan**
- BUTUH IPAL: tolong teruskan ke staf TSK (rincian dan alasan tiap butir di `docs/zairyu-card.md` bagian 9):
  1. Penerima pengingat: 担当 pekerja + salinan Admin TSK (semua Admin atau satu?); bila belum ada 担当 cukup ke Admin? Apakah pengurus perpanjangan selalu 担当 yang sama?
  2. Setelah diajukan ke imigrasi (申請中): pengingat tetap berjalan sampai kartu baru diterima, atau cukup "menunggu hasil"? Perlu menampilkan 特例期間?
  3. Konfirmasi jadwal (4 bulan / 3 bulan / H-30 / H-14 / H-7 / sesudah lewat); "sesudah lewat" tampil sampai kapan? Hari terakhir (tanggal habis) masih berlaku?
  4. 在留資格 apa saja yang dicatat (hanya 特定技能1号 atau juga 2号/技能実習/特定活動/lainnya)? Perlu 在留期間 selain tanggal habis?
  5. Apakah empat status proses cukup (belum mulai → persiapan → sudah diajukan → kartu baru diterima)? Perlu "berkas lengkap", "dokumen tambahan (追加資料)", "ditolak"?
  6. Nomor kartu dan foto kartu perlu disimpan? Untuk apa? (rekomendasi: tidak; bila perlu, cek gyōsei shoshi dulu)
  7. Siapa boleh mengubah data kartu: semua staf TSK atau hanya 担当 + Admin?
  8. Berapa pekerja aktif yang harus diisi di awal, dan cara paling nyaman: satu per satu atau tempel dari spreadsheet?
  9. LPK: apa arti "status visa" (nilai apa saja), dari mana tanggal tiba, siapa yang mengisinya? (tugas terpisah)
  10. "Tanggal terima kartu baru" = tanggal kartu fisik diterima pekerja atau staf? Siapa yang mencatat?
  11. H-30/H-14/H-7 dihitung menurut tanggal Jepang (Tokyo): setuju?
  12. Perlu notifikasi di luar aplikasi (email/LINE) di tahap berikutnya? Kepada siapa dan jam berapa?

**Usulan berikutnya** (bukan tugas; PM yang memutuskan)
- Setelah jawaban TSK: T-A sampai T-C dari bagian 6 dokumen menjadi tugas implementasi; T-D bergantung pertanyaan 8.

## 2026-10-06 · T-009 · revisi ke-1: teks form 5-5 sama dengan form resmi

**PR:** #10 (branch `eng/T-009-form-5-5`)
**Status:** revisi ke-1, siap direview ulang

**Yang diubah (sesuai `PM: REVISI`; tanpa migrasi, hanya `src/db/form55.ts`, `labels.ja.ts`, `src/lib/pdf/form55.ts`, form, seed, tes, docs)**
- 18 kalimat butir ①〜⑤ diganti teks resmi (bentuk pernyataan "〜こと。"); judul kelompok jadi "…に関する事項" / "その他の事項". ⑤(2) punya isian kurung terpisah (`otherLabel`, tersimpan di jsonb `form55`, default "" untuk data lama; dicetak `その他（<isian>）`; kolom isian di form).
- Tabel butir di PDF: kolom 面談事項 / 面談内容 / 問題の有無 (`□有 □無`, terpilih ■) / 問題の内容. ⑥ dicetak `■有り（下記4に詳細を記載） □なし`.
- Bagian 1-2 memakai label resmi (①特定技能外国人の氏名, ②特定技能所属機関の氏名又は名称, ③面談日, ④方式, ①対応者の氏名, ②対応者の役職, 役職名 kolom tersendiri). Bagian 4 sesuai form dengan kotak pilihan (ア/イ(ア)/イ(イ)/ウ); "所属機関（受入れ企業）" diganti "特定技能所属機関"; terjemahan Indonesia hanya di form isian, tidak di PDF.
- 作成年月日: kosong = tanggal form terakhir disimpan menurut zona TSK (dari `updated_at`, dihitung saat cetak), BUKAN tanggal wawancara; bisa diisi eksplisit. Seed demo kini memakai bawaan itu.
- Header PDF: `参考様式第5－5号` di kiri atas; nama organisasi kecil di kanan; footer "作成日時" tetap.
- 面談実施者 = 対応者 (keputusan PM): tetap satu kolom.
- Perbaikan kecil di `PdfBuilder.table`: baris pertama setelah pindah halaman tercetak tebal (font header tidak dikembalikan); kini Regular. Berlaku juga untuk PDF lain, tanpa perubahan tata letak.

**Verifikasi** (db-dev `hashi_dev`; produksi tidak disentuh)
- `npm run typecheck` → lulus; `npm run build` → 0 peringatan; `npm run test:i18n` → konsisten (1481 kunci)
- `npm run test:unit` → 71 lulus (`form55.test.ts` diperbarui: kalimat resmi butir ①〜⑤, label bagian 1/2/4, kotak pilihan, `その他（通勤手段）`, 作成年月日 eksplisit vs tanggal simpan, header, data lama tanpa `otherLabel`, tidak ada "所属機関（受入れ企業）")
- `db:seed -- --reset` + `npm run test:rls` → lulus; `npm run verify:seed` → lulus; `E2E_PORT=3120 npm run test:e2e` → 184 lulus (e2e form55 kini juga mengisi dan memuat ulang `otherLabel`)
- Tangkapan layar baru dari image runner lokal (kontainer/image sementara sudah dihapus): `docs/screenshots/T-009/form55-pdf-1.png`, `form55-pdf-2.png`, `annual-page.png`.

**Kondisi server:** produksi tetap `ac8037a`; T-009 belum di-deploy (menunggu `PM: DISETUJUI`; ada migrasi 0024 → `--backup`).

**Kendala / catatan**
- Label tetap DRAFT sampai staf TSK mengecek (PM yang menyampaikan ke Ipal); jangan dikirim ke imigrasi.

**Pertanyaan:** tidak ada yang baru.

## 2026-10-06 · T-009 · Form 定期面談報告書 (参考様式第5-5号) + halaman tahunan per pekerja + hasil deploy T-010

**PR:** #10 (branch `eng/T-009-form-5-5`)
**Status:** siap direview

**Hasil deploy T-010 lewat `scripts/deploy.sh --backup`** (PR #9 di-merge `ac8037a`, setelah `PM: DISETUJUI` dan CI hijau di `10100f9`)
- Cadangan terenkripsi dulu: `hashi-20261006-193317-*` (database 634 entri, 146 berkas dokumen, 736 KB; `LAST_FAILED` tidak ada). Migration 0023 terterap otomatis (tabel `responsible_assignments` ada di produksi).
- Keluaran akhir skrip: `✓ deploy selesai. Commit berjalan: ac8037a (label image: ac8037a); health: {"status":"ok","commit":"ac8037a"}`. Demo tidak disentuh.

**Yang dikerjakan**
- Migration 0024: kolom `method`, `responder_role`, `responder_title`, `form55` (jsonb) di `periodic_interviews`, dengan CHECK (nilai method/role, form55 <= 20000 karakter). Data lama tidak diubah (form kosong = belum diisi). Tanpa migrasi data.
- `src/db/form55.ts`: SATU berkas butir TETAP (18 butir: ① 3, ② 6, ③ 5, ④ 2, ⑤ 2; kode `work.1` dst.; label Jepang untuk PDF + Indonesia untuk form) dan validator zod (`parseForm55`: butir bermasalah wajib isi; bagian 4 hanya bila ⑥ = 有 dan wajib 発生日 + 内容, selain itu dibuang).
- Form isian `Form55Fields` di halaman sel wawancara (id/ja; bagian 4 hanya muncul bila ⑥ = 有; satu tombol simpan dengan wawancara). 対応者 bawaan = penanggung jawab efektif pekerja (T-010, `responsibleOfWorker`), bisa diganti per wawancara (staf + jabatan + 役職名). "Tidak berlaku"/"Belum dilaksanakan" tidak menyimpan isi form. Riwayat versi jalan (snapshot trigger memuat form lama; riwayat menampilkan ringkasan).
- PDF form 5-5 (`src/lib/pdf/form55.ts`; rute `/records/export/form55/<pekerja>/<bulan>` dan `/records/export/form55-year/<pekerja>?fy=`): bagian 1-4, ⑥/⑦, 作成年月日, 面談実施者の氏名; gabungan setahun = satu form per wawancara yang dilaksanakan, urut bulan.
- Halaman tahunan per pekerja `/records/workers/<id>/annual?fy=`: tabel 定期面談 + status form + PDF per baris + PDF gabungan, dan bagian TERPISAH berlabel "Wawancara karena kejadian" (catatan ② yang menyebut pekerja). Ditautkan dari daftar tahunan, sel wawancara.
- Audit: hanya `period`, `form55=filled`, `nonconformity=yes|no`, `method`; ekspor `activity_export` dengan `exportKind` form55 / form55_nonconformity / form55_year. Tanpa isi teks/nama.
- Seed demo: wawancara terlaksana berisi form (satu dari empat sengaja kosong; "issue" memuat 基準不適合 + penanganan). Docs: `docs/catatan-kegiatan.md`, `docs/glossary.md`, CLAUDE.md; tautan form resmi hanya sebagai rujukan (berkas kosong tidak di-commit).

**Verifikasi** (semua terhadap db-dev `hashi_dev`; produksi tidak disentuh)
- `npm run typecheck` → lulus; `npm run build` → 0 peringatan
- `npm run test:unit` → 69 lulus (termasuk `form55.test.ts`: validator, dan isi teks PDF: semua 18 butir, bagian 4 hanya bila 有, form kosong, gabungan setahun)
- `npm run test:i18n` → konsisten; `npm run verify:audit-coverage` → lulus
- `db:seed -- --reset` + `npm run test:rls` → semua lulus (bagian baru W: simpan + riwayat memuat form lama, CHECK method/role/ukuran juga lewat UPDATE tanpa WHERE, TSK lain/LPK/sensei/super admin/peran null membaca 0 baris dan form tak berubah); `npm run verify:seed` → lulus (pemeriksaan form 5-5 baru)
- `E2E_PORT=3120 npm run test:e2e` → 184 lulus (8 baru di `form55.spec.ts`: isi lengkap + dimuat ulang, bagian 4 bersyarat, edit/versi/riwayat/audit tanpa isi, tidak disimpan untuk "Belum dilaksanakan", kedua PDF + audit ekspor, halaman tahunan + wawancara kejadian terpisah, ponsel 390px tanpa scroll horizontal, 対応者 bawaan, LPK/sensei 404)
- Cek manual di image produksi lokal: `docker build --target runner` (tag sementara `hashi-t009-check`, kontainer sementara port 3125 ke db-dev; keduanya sudah dihapus, kontainer lain tidak disentuh). Rute PDF 200 `application/pdf` di image; dirender dengan `pdftoppm` dan tangkapan layar form + halaman tahunan: `docs/screenshots/T-009/` (data dummy seed saja).

**Kondisi server:** produksi `ac8037a` (T-010). T-009 BELUM di-deploy (menunggu `PM: DISETUJUI`; ada migrasi 0024 → deploy dengan `--backup`).

**Kendala / catatan**
- Label butir 18 butir disusun dari rincian di TASKS (staf TSK), bukan salinan form resmi; PDF memuat kalimat itu apa adanya. Dipakai sebagai DRAFT.
- Satu kolom nama dipakai untuk 対応者 (③ "氏名" bagian 2) dan 面談実施者の氏名 di penutup; form hanya memiliki satu staf per wawancara.
- Audit mencatat bulan periode (`period`), kuartal diturunkan darinya; tidak ada kolom kuartal terpisah.
- Wawancara yang dibatalkan (void) tidak ikut halaman tahunan maupun PDF gabungan.

**Pertanyaan**
- BUTUH IPAL: tolong minta staf TSK mencocokkan kalimat 18 butir (`src/db/form55.ts`) dan tata letak PDF (`docs/screenshots/T-009/`) dengan form 5-5 resmi terbaru; selisih diubah di satu berkas itu (tanpa migrasi). Sampai dikonfirmasi, jangan dikirim ke imigrasi.
- BUTUH IPAL: apakah 面談実施者 (penutup) boleh selalu sama dengan 対応者, atau perlu kolom tersendiri?

**Usulan berikutnya** (bukan tugas)
- Bila kelak perlu, tanda "sudah dilaporkan ke imigrasi" per tahun fiskal; saat ini belum diperlukan.

## 2026-10-06 · T-010 · Penanggung jawab pekerja (担当/責任者) + batas 50 pekerja per staf + hasil deploy T-008

**PR:** #9 (branch `eng/T-010-penanggung-jawab`)
**Status:** siap direview (deploy T-010 ke produksi dilakukan setelah merge, lewat `scripts/deploy.sh`; migration 0023 berjalan otomatis)

**Hasil deploy T-008 lewat `scripts/deploy.sh --backup`** (PR #8 di-merge `5f9c613`, setelah `PM: DISETUJUI` revisi dan CI hijau di `1f95991`)
- Cadangan terenkripsi dulu: `hashi-20261006-184948-*` (database 634 entri, 146 berkas dokumen, 736 KB; `LAST_FAILED` tidak ada). Lalu `GIT_SHA=5f9c613 docker compose -p hashi up -d --build`. Tidak ada migrasi baru.
- Keluaran akhir skrip: `✓ deploy selesai. Commit berjalan: 5f9c613 (label image: 5f9c613); health: {"status":"ok","commit":"5f9c613"}`, exit 0. Demo tidak disentuh (Up, healthy).

**Yang dikerjakan (T-010)**
- **Migration 0023** `responsible_assignments`: penetapan per **perusahaan** (bawaan) atau per **penempatan** (menimpa), `staff_id` null = dikosongkan ("ikut perusahaan" untuk pekerja), `effective_from`. **Append-only** (GRANT hanya SELECT/INSERT). Trigger: staf = staf TSK organisasi yang sama (`activity_assert_staff`), target milik organisasi yang sama, `created_by` selalu pengguna sesi. CHECK tepat satu cakupan. RLS: baca = staf TSK organisasi sama; **tulis = TSK_ADMIN** (keputusan saya: beban/hukum, sejalan KPI untuk Admin TSK; staf biasa membaca saja). LPK/sensei/super admin/TSK lain: 0 baris.
- **Fungsi murni** `src/db/responsibility.ts` + konfigurasi tunggal `src/db/workload-config.ts` (`WORKLOAD`: max 50, peringatan 45, berlaku 2027-04-01). Penanggung jawab efektif = per pekerja (bila terisi) > perusahaan > tidak ada; beban per staf = penempatan **ACTIVE** saja (ENDED tidak dihitung), dihitung per orang lintas klien (30 + 20 = 50).
- **Halaman** `/records/responsible` (tab baru "Penanggung jawab"): beban per staf (kuning >= 45 termasuk 50 = batas tercapai, merah > 50, teks menyebut aturan April 2027 dan **tidak memblokir** penyimpanan), "belum ada penanggung jawab", form per perusahaan/per pekerja (Admin TSK), riwayat perubahan, filter `?staff=`, `?mine=1` (pekerja saya), `?view=over|unassigned`.
  Tampil juga di detail pekerja sisi TSK, halaman riwayat pekerja (T-007), dan grid 定期面談 (kolom + filter "pekerja saya").
- **KPI dashboard TSK_ADMIN**: "Staf melebihi batas pekerja" dan "Pekerja tanpa penanggung jawab"; satu fungsi `responsibilityOverview` dengan halaman daftar (e2e: KPI = jumlah baris `?view=over` dan item `?view=unassigned`). TSK_STAFF tidak memiliki KPI itu.
- **Audit** `responsible.set`: hanya id baris + cakupan (`scope`); e2e memastikan tidak ada nama/email staf di log. Label id + ja; `docs/catatan-kegiatan.md` dan `CLAUDE.md` diperbarui.

**Verifikasi** (perintah → hasil apa adanya)
- `npm run typecheck`, `test:i18n` (1409 kunci), `test:unit` (tes baru `responsibility`: konstanta, penetapan berlaku/terjadwal/seri, efektif per pekerja menimpa perusahaan dan dikosongkan kembali ke perusahaan, ambang 44/45/50/51, beban ACTIVE saja dan ganti per pekerja memindahkan hitungan), `verify:audit-coverage`, `npm run build` (0 peringatan) → lulus.
- `db:seed -- --reset` lalu `npm run test:rls` → lulus, termasuk bagian V baru (admin menulis; staf membaca tetapi tidak menulis; append-only: UPDATE/DELETE ditolak; staf lintas organisasi/LPK ditolak; target organisasi lain ditolak; cakupan ganda/kosong; `created_by` dipaksa; TSK lain, LPK_ADMIN, sensei, super admin, dan peran null membaca 0 baris dan tidak bisa menulis).
- `npm run verify:seed` → lulus (cek baru: aktif 3 = beban 2 + tanpa penanggung jawab 1; ada penetapan perusahaan dan pekerja; KPI = daftar).
- `E2E_PORT=3120 npm run test:e2e` → **176 lulus**. Baru `responsible` (5 tes, bisa diulang; data uji dan penetapan dibersihkan di `afterAll`): tetapkan per pekerja lalu kembalikan ke perusahaan (angka beban berpindah dan kembali; riwayat; audit tanpa nama), tetapkan per perusahaan (yang mewarisi pindah, hitungan tepat), batas **45 kuning / 50 kuning (batas tercapai) / 51 merah**
  dengan 51 pekerja uji + 7 pekerja ENDED yang tidak dihitung, KPI Admin = baris `?view=over`, simpan TIDAK diblokir (52); "belum ada penanggung jawab" = KPI; staf non-admin tanpa form; "pekerja saya"; tampil di detail kandidat/grid/riwayat; LPK/sensei 404; ponsel tanpa scroll horizontal.

**Kondisi server:** belum ada yang di-deploy untuk T-010 (menunggu merge). Produksi `5f9c613` healthy.

**Kendala / catatan (penyimpangan dari kriteria, mohon diputuskan PM)**
- **Seed "satu staf >= 45" TIDAK dipenuhi.** Itu butuh >= 45 pekerja aktif, sedangkan seed demo hanya punya 36 kandidat; menambah kandidat berbagi ke TSK menggeser banyak angka tetap di tes (21 terlihat, filter per tahap/keputusan, dsb.). Sebagai gantinya seed memuat penetapan per perusahaan/per pekerja dan satu pekerja tanpa penanggung jawab (diperiksa `verify:seed`),
  dan skenario 45/50/51 dibuktikan di e2e dengan data uji sementara. Usul: seed pilot 200 siswa (langkah 8) otomatis memunculkannya; atau tugas kecil terpisah `seed:workload` (opsional, tambahan, 46 pekerja dummy) bila PM ingin demo visual.
- Tulis hanya TSK_ADMIN (lihat atas); bila PM ingin staf biasa boleh mengganti penanggung jawab pekerja yang ia pegang, itu perubahan policy kecil.
- "Daerah" belum dimodelkan terpisah (cukup kelompokkan lewat perusahaan, sesuai tugas); belum ada kebutuhan yang memaksanya.
- Satu bug kecil saya sendiri: tabel beban sempat membuat halaman melebar di ponsel (elemen `sr-only` di tabel); diperbaiki dengan wadah `relative` seperti grid wawancara.

**Pertanyaan**
- Tidak ada yang butuh Ipal.

**Usulan berikutnya** (bukan tugas)
- `seed:workload` opsional (lihat atas) dan, setelah T-004, kirim pengingat 在留カード ke penanggung jawab efektif (+ salinan Admin) memakai `effectiveResponsible`.

---

## 2026-10-06 · T-008 · 定期面談 per kuartal + pekerja yang sudah berhenti + hasil deploy T-007

**PR:** #8 (branch `eng/T-008-mendan-kuartal`)
**Status:** revisi ke-1 (siap direview ulang; deploy T-008 ke produksi dilakukan setelah merge, lewat `scripts/deploy.sh`)

**Revisi ke-1 (komentar `PM: REVISI`: kuartal berjalan tidak boleh langsung merah)**
- `quarterState` memecah "Belum" menjadi **`open`** (kuartal BERJALAN, hari pertama sampai hari terakhir, belum ada wawancara selesai: netral, teks "Belum, tenggat <akhir kuartal>", kuning tegas pada 14 hari terakhir; angka 14 = konstanta tunggal `QUARTER_URGENT_DAYS`, helper `daysToQuarterDeadline`/`quarterUrgent`) dan **`missed`** (kuartal SUDAH LEWAT tanpa wawancara selesai: merah, "Terlewat"). Tanpa migrasi.
- **KPI** "定期面談 kuartal ini belum dilakukan" = jumlah kuartal **`open`** di FY berjalan (`openInterviewQuarters`, menggantikan `pendingInterviewQuarters`; satu fungsi dengan grid dan `?view=pending`). Kuartal `missed` (FY berjalan dan FY lalu) tampil di grid dan daftar tahunan sebagai "bolong" dan TIDAK masuk KPI; daftar tahunan juga menampilkan jumlah kuartal berjalan yang masih bisa dikejar.
- Filter status grid: Selesai / Belum (kuartal berjalan) / Terlewat / Tidak berlaku. Label id + ja (termasuk label KPI), `docs/catatan-kegiatan.md` diperbarui.
- Seed: pekerja aktif belum diwawancara di kuartal berjalan (`open`) dan pekerja berhenti punya satu kuartal `missed`; `verify:seed`: >= 1 open dan >= 1 missed, KPI = jumlah open di grid (pada seed: open 3, missed 1).
- Tes: unit (10 tes): hari pertama kuartal berjalan = `open`, hari terakhir = `open`, sehari setelah berakhir = `missed`, wawancara di hari terakhir menyelamatkan kuartal, dan batas 14 hari terakhir; e2e: open netral dengan tenggat dan masuk KPI, missed merah dan tidak masuk KPI, mengisi kuartal terlewat tidak mengubah KPI. Hasil ulang: typecheck, test:i18n, test:unit, verify:audit-coverage, test:rls (setelah reseed dev), verify:seed, build (0 peringatan), **e2e 171 lulus**.
- Satu salah langkah saya: tes baru sempat gagal karena urutan (tes yang mengisi kuartal terlewat jalan lebih dulu) dan karena akun `tsk.admin` berbahasa Jepang; keduanya diperbaiki di tes, bukan di kode.

**Hasil deploy T-007 lewat `scripts/deploy.sh --backup`** (PR #7 di-merge `31008ad`)
- Cadangan terenkripsi dulu: `hashi-20261006-173317-*` (database 630 entri, 146 berkas dokumen, 732 KB; `LAST_FAILED` tidak ada). Lalu `GIT_SHA=31008ad docker compose -p hashi up -d --build`; migration 0022 berjalan otomatis (kolom `activity_records.continues_record_id` ada di produksi: dicek lewat `information_schema`).
- Keluaran akhir skrip: `✓ deploy selesai. Commit berjalan: 31008ad (label image: 31008ad); health: {"status":"ok","commit":"31008ad"}`, exit 0. Demo tidak disentuh (Up, healthy).

**Yang dikerjakan (T-008)**
- **Aturan kuartal** (fungsi murni di `src/db/records-core.ts`): `fiscalQuarterRange`, `workedInQuarter` (bekerja >= 1 hari di kuartal; ACTIVE dan ENDED, banyak penempatan), `workedInFiscalYear`, `quarterState` (Selesai / open / missed / Tidak berlaku / kuartal depan tidak ditagih / tidak wajib; lihat revisi ke-1), `monthMark` (penanda bulan: bulan tanpa wawancara netral, bukan merah; di luar masa kerja/bulan depan tidak ditagih). Tanggal wawancara = `interview_date`, atau awal bulan periode bila kosong.
- **Kueri** (`src/db/records-queries.ts`): `allWorkers` (ACTIVE + ENDED, satu baris per pekerja, aktif dulu), `quartersOfFiscalYear` (SATU sumber untuk grid, KPI, dan daftar tahunan), `pendingInterviewQuarters` (KPI = jumlah kuartal Belum di FY berjalan; menggantikan `pendingInterviewCells`).
- **Grid** `/records/interviews`: baris = pekerja yang bekerja di FY itu (ACTIVE dan ENDED, penanda "berhenti <tanggal>"), status utama per kuartal, bulan tetap tampil, aturan kuartal ditulis di halaman, filter status/`?view=pending` pada status kuartal.
- **Daftar persiapan laporan tahunan** `/records/interviews/annual?fy=`: pekerja wajib dilaporkan (termasuk yang berhenti di tengah tahun), masa kerja, status + jumlah wawancara per kuartal, kuartal bolong, ringkasan. Tautan dari grid.
- **Pekerja berhenti di form**: pemilih pekerja ①/② dan "Lanjutkan" memuat ENDED di bawah yang aktif dengan penanda "berhenti <tanggal>"; server (`assertWorkers`), halaman sel wawancara, ekspor PDF 定期面談, dan filter daftar memakai `allWorkers`.
- **Seed**: satu penempatan ENDED di tengah FY (tanpa keputusan DEPARTED agar hitungan keputusan di daftar kandidat tidak bergeser), wawancara hanya di kuartal pertama, jadi kuartal berikutnya Belum. `verify:seed`: KPI = grid, pekerja berhenti ikut FY-nya dan tidak FY sesudahnya.
- Label id + ja (`test:i18n` 1353 kunci); `docs/catatan-kegiatan.md` bagian "Wawancara berkala" ditulis ulang (aturan kuartal, sumber staf TSK); `CLAUDE.md` butir terkait.

**Verifikasi** (perintah → hasil apa adanya)
- `npm run typecheck`, `test:i18n`, `test:unit` (tes baru `interview-quarters`: 9 tes: kuartal Apr-Mar dan akhir bulan, mulai di tengah kuartal, mulai Februari, berhenti di tengah kuartal/inklusif 1 Jan vs 31 Des, kuartal depan, banyak wawancara/未実施/batas kuartal, 対象外, banyak penempatan, penanda bulan), `verify:audit-coverage` → lulus. `npm run build` → 0 peringatan.
- `db:seed -- --reset` lalu `npm run test:rls` → lulus (tidak ada perubahan skema/RLS di tugas ini). `npm run verify:seed` → lulus (KPI 4 = grid 4; 1 pekerja berhenti, FY 2026).
- `E2E_PORT=3120 npm run test:e2e` → **170 lulus**. Baru: `interview-quarters` (5 tes: pekerja ENDED muncul di grid FY-nya dengan penanda, bulan sesudah berhenti tidak ditagih dan tanpa tautan, kuartal pertama Selesai dan berikutnya Belum, tidak muncul di FY sesudahnya; daftar tahunan + ringkasan = isi tabel; pemilih form memuat ENDED di bawah yang aktif, catatan susulan dan "Lanjutkan" berhasil; mengisi kuartal bolong menutup bolong dan KPI turun 1 (wawancara uji dihapus lewat pemilik DB di `afterAll`, tes bisa diulang); LPK/sensei 404 dan ponsel tanpa scroll horizontal). `records-views` disesuaikan ke aturan kuartal (status kuartal, bulan netral, KPI = kuartal Belum).

**Kondisi server:** belum ada yang di-deploy untuk T-008 (menunggu merge). Produksi `31008ad` healthy. Tidak ada migrasi baru.

**Kendala / catatan**
- ~~KPI hanya tahun fiskal berjalan~~ (diselesaikan revisi ke-1: KPI = kuartal open; kuartal terlewat hanya bahan laporan).
- **Unik (pekerja, bulan) tetap berlaku**: satu bulan hanya bisa punya satu wawancara aktif (yang dibatalkan boleh diisi ulang). Kuartal terpenuhi oleh bulan mana pun di dalamnya, jadi aturan "minimal sekali per kuartal" tidak terhalang; hanya "lebih dari satu dalam satu bulan" yang belum bisa. Dibiarkan sesuai arahan tugas.
- ~~Kuartal berjalan langsung Belum~~ (diperbaiki revisi ke-1: sekarang `open`, bukan merah).
- Data demo di demo/produksi belum memuat pekerja berhenti. `seed:records --force` akan menambahkannya (penempatan ENDED + satu wawancara; tidak mengubah data lain) bila Ipal mengizinkan.
- Kuartal yang hanya memuat baris 対象外 ditampilkan "Tidak berlaku" dan tidak ditagih (keputusan saya; bila wawancara tetap diwajibkan untuk 対象外 bulanan, beri tahu).

**Pertanyaan**
- Tidak ada yang butuh Ipal untuk tugas ini.

**Usulan berikutnya** (bukan tugas)
- Tanda "sudah dilaporkan ke imigrasi" per FY (bisa dipakai T-009) agar KPI bisa memasukkan FY lalu yang belum dilaporkan.
- `scripts/deploy.sh`: log build ke berkas (sudah ada di cadangan tugas PM).

---

## 2026-10-06 · T-007 · Riwayat catatan per pekerja ("Lanjutkan") + hasil deploy lewat `scripts/deploy.sh`

**PR:** #7 (branch `eng/T-007-riwayat-pekerja`)
**Status:** siap direview (deploy T-007 ke produksi dilakukan setelah merge, lewat `scripts/deploy.sh`)

**Hasil deploy T-006 lewat `scripts/deploy.sh --backup`** (kriteria T-006; PR #6 di-merge `32ea832`)
- `scripts/deploy.sh --backup` dari `main` bersih → cadangan terenkripsi dulu (set `hashi-20261006-161934-*`, `LAST_FAILED` tidak ada), lalu `GIT_SHA=32ea832 docker compose -p hashi up -d --build` tanpa `--remove-orphans`.
- Keluaran akhir skrip: `✓ deploy selesai. Commit berjalan: 32ea832 (label image: 32ea832); health: {"status":"ok","commit":"32ea832"}`, exit 0. `main` = `32ea832`. Demo (`hashi-demo-*`) tidak disentuh (Up, healthy).
- Catatan: keluaran `docker compose up --build` (log build) membanjiri terminal; usulan di bawah.

**Yang dikerjakan (T-007)**
- **Migration 0022** (`activity_records.continues_record_id`, FK + indeks + CHECK bukan diri sendiri) + penjaga di database: terkunci setelah dibuat (trigger versi), asal harus ada/terlihat/organisasi sama/AKTIF (BEFORE INSERT), dan menyebut setidaknya satu pekerja yang sama (constraint trigger TERTUNDA, diperiksa saat commit karena pekerja ditambahkan setelah baris catatan).
- **Halaman riwayat** `/records/workers/<candidateId>`: ① + ② yang menyebut pekerja, baris kronologi ③ dari kasus yang melibatkannya, dan wawancara berkala ④, dalam satu garis waktu (terbaru di atas, `?order=asc` membalik, 30 entri per halaman, yang dibatalkan dicoret) + tindak lanjut yang masih terbuka di atasnya. Catatan multi-pekerja muncul di tiap pekerja.
- **"Lanjutkan"** di detail catatan → form baru dengan pekerja/lokasi/kasus terisi dan ditandai "Diisi otomatis, periksa" (`autoFilled`), panel baca-saja 3 catatan terakhir + tindak lanjut terbuka (di samping form pada layar lebar, di atas pada ponsel). Detail catatan menampilkan "Lanjutan dari …" / "Dilanjutkan oleh …"; asal yang dibatalkan tidak bisa dilanjutkan, rantai yang ada tetap terlihat.
- Tautan ke riwayat dari detail catatan (per pekerja), detail kandidat sisi TSK, dan grid 定期面談.
- Audit: `activity_record.create` memuat `continued: true` (tanpa id/isi); `verify:audit-coverage` lulus. Label id + ja (`test:i18n`: 1334 kunci). Seed: `d13` melanjutkan `d10`; `verify:seed` memeriksa rantai valid (juga lewat `seed:records --force` bila nanti dibutuhkan di produksi/demo: catatan baru, tidak mengubah yang ada).
- **Bonus T-006:** `scripts/deploy.sh` tidak lagi jatuh ke port 3100 bila `APP_PORT` tidak ada (env/.env): gagal dengan pesan jelas sebelum menyentuh apa pun.
- Dokumentasi: `docs/catatan-kegiatan.md` (bagian baru), `CLAUDE.md` (butir Catatan kegiatan TSK).

**Verifikasi** (perintah → hasil apa adanya)
- `npm run typecheck` → lulus. `npm run test:i18n` → lulus. `npm run test:unit` → lulus. `npm run verify:audit-coverage` → lulus. `npm run build` → 0 peringatan.
- `db:seed -- --reset` (db-dev) lalu `npm run test:rls` → **lulus**, termasuk bagian U baru: lanjutan sah tersimpan; pekerja berbeda ditolak saat commit; asal dibatalkan/tidak ada/menunjuk diri sendiri ditolak; `continues_record_id` tak bisa diubah/dikosongkan (kolom lain tetap bisa diedit); TSK lain dan LPK tidak bisa menautkan; LPK_ADMIN, sensei, super admin, TSK lain, dan peran null membaca 0 baris.
- `npm run verify:seed` → lulus (cek baru: 1 dari 1 rantai valid).
- `E2E_PORT=3120 npm run test:e2e` → **165 lulus** (7 tes baru `records-continue`: asal A → "Lanjutkan" → form terisi + penanda otomatis + panel → simpan → saling menunjuk (dan baris DB: asal, pekerja, lokasi, kasus cocok); riwayat memuat kedua catatan + tindak lanjut + label Lanjutan + urutan dibalik + tautan dari detail kandidat dan grid; ③ dan ④ ikut, yang dibatalkan dicoret; paginasi 30/halaman dan ponsel 390 px tanpa scroll horizontal (juga form lanjutan + panel); LPK/sensei 404 untuk riwayat, "Lanjutkan", dan detail; asal dibatalkan tidak bisa dilanjutkan; audit `continued` tanpa isi; POST dengan asal tak sah ditolak server tanpa membuat catatan).
- `deploy.sh` tanpa `APP_PORT` (repo uji sementara) → exit 1 "APP_PORT tidak ditemukan…"; dengan `APP_PORT=3110 --check` → exit 0.

**Kondisi server:** belum ada yang di-deploy untuk T-007 (menunggu merge). Produksi `32ea832` healthy. Migration 0022 akan berjalan otomatis lewat service `migrate` saat deploy; tidak merusak data (kolom nullable baru + trigger).

**Kendala / catatan**
- Pekerja yang sudah TIDAK aktif (mis. penempatan berakhir) tidak muncul di pemilih pekerja form, sehingga catatan yang pekerjanya sudah tidak aktif tidak bisa dilanjutkan (halaman "Lanjutkan" = 404 bila tak ada pekerja aktif). Masuk lingkup T-008 (pekerja yang sudah berhenti).
- Syarat "pekerja sama" hanya diperiksa saat catatan lanjutan DIBUAT; mengedit pekerja catatan lanjutan sesudahnya tidak memeriksanya lagi (rantai tetap valid saat dibuat). Bila PM ingin ketat, perlu trigger tambahan pada `activity_record_subjects`.
- e2e menambah catatan uji (termasuk 32 catatan untuk paginasi) di db-dev; `test:rls` perlu `db:seed -- --reset` dulu (sudah tercatat di HISTORY).

**Pertanyaan**
- Tidak ada yang butuh Ipal.

**Usulan berikutnya** (bukan tugas)
- `scripts/deploy.sh`: keluarkan log build ke berkas (`~/hashi-backups/deploy.log`) dan cetak hanya ringkasan.
- Setelah T-007 di-deploy, jalankan `seed:records --force` di demo (izin Ipal) supaya demo punya contoh rantai lanjutan (d13).

---

## 2026-10-06 · T-006 · Skrip deploy + `.gitignore` izin lokal

**PR:** #6 (branch `eng/T-006-deploy-skrip`)
**Status:** siap direview (deploy lewat skrip ini dilakukan SETELAH merge; outputnya dicatat di entri berikutnya)

**Yang dikerjakan**
- `scripts/deploy.sh` (hanya produksi, project compose `hashi`): menolak bila bukan `main` atau working tree kotor (termasuk berkas baru), `git pull --ff-only`, `GIT_SHA=<sha pendek> docker compose -p hashi up -d --build` (tanpa `--remove-orphans`),
  menunggu `http://127.0.0.1:$APP_PORT/api/health` sampai `commit` = sha itu (bawaan 120 dtk, `--timeout N`; gagal ≠ 0 dengan pesan + `docker compose ps`), lalu mencetak commit berjalan + label image + isi health.
  Opsi: `--backup` (jalankan `scripts/backup.sh` dulu, kunci dari env atau `~/.config/hashi/backup.env`; cadangan gagal → deploy dibatalkan sebelum menyentuh container) dan `--check` (hanya memeriksa syarat dan mencetak rencana). Demo dan db-dev tidak disentuh.
- `.gitignore`: `.claude/settings.local.json`.
- `docs/backup.md` §3: peringatan bahwa timer menjalankan skrip dari working tree repo (branch fitur pukul 02:00 = versi branch yang jalan).
- README (bagian update), `CLAUDE.md` (siklus langkah 7, "Produksi di OptiPlex", "Alur kerja" langkah 3), `docs/HISTORY.md`: perintah deploy produksi menjadi `scripts/deploy.sh`.
  Instruksi instalasi pertama dan reseed produksi demo di README tetap memakai `GIT_SHA=… docker compose up -d --build` langsung (skrip mensyaratkan `main` bersih + pull, bukan untuk instalasi awal).

**Verifikasi** (perintah → hasil apa adanya)
- `bash -n scripts/deploy.sh` → ok; `--help` mencetak pemakaian.
- Uji tolak, dengan sidik container (`StartedAt`+`Id` `hashi-app-1`/`hashi-db-1`) sama sebelum dan sesudah:
  - di branch `eng/T-006-deploy-skrip` → "harus di branch main", exit 1;
  - klon sementara di `main` dengan berkas baru → "working tree tidak bersih" + daftar berkas, exit 1;
  - `--bogus` dan `--timeout abc` → ditolak, exit 1;
  - klon bersih di `main` + `--check` (`APP_PORT=3110`) → exit 0, mencetak "commit akan di-deploy" dan "commit berjalan sekarang: 6a03395" dari health produksi, container tidak tersentuh.
  Pada percobaan pertama `--check` gagal karena `main` klon uji tak punya upstream; pesan galat `git pull` saya perjelas (tidak lagi menuduh "riwayat menyimpang").
- `git check-ignore -v .claude/settings.local.json` → `.gitignore:22` (diabaikan). `.git/info/exclude` lokal yang saya tambahkan sebelumnya jadi redundan (aman dibiarkan).
- Jalur sukses penuh (`up -d --build` + menunggu health) BELUM dijalankan: skrip belum ada di `main`, sedangkan skrip menolak branch selain `main`. Dijalankan setelah merge (kriteria "deploy lewat skrip"), dan hasilnya dicatat.
- CI: lihat status PR (tidak ada perubahan kode aplikasi).

**Kondisi server:** tidak ada yang di-deploy atau diubah. Produksi masih `6a03395`.

**Kendala / catatan**
- Setelah merge, `main` berisi 3 commit dokumen/skrip di atas `6a03395` (T-003, T-006, TASKS): deploy skrip akan membangun image dengan commit baru walau kode aplikasi sama.
- Klon uji sementara di folder scratchpad sudah dihapus.

**Pertanyaan**
- Dua BUTUH IPAL dari T-003 (salinan kunci cadangan, linger) masih menunggu jawaban Ipal; tidak ada yang baru.

**Usulan berikutnya** (bukan tugas)
- Setelah deploy lewat skrip, deploy demo (izin Ipal) supaya demo juga memuat `commit` di health.

---

## 2026-10-06 · T-003 · Cadangan lokal terjadwal (+ hasil deploy T-005)

**PR:** #5 (branch `eng/T-003-backup-terjadwal`)
**Status:** siap direview

**Hasil deploy T-005** (PR #4 di-merge `6a03395`, lalu deploy produksi sesuai arahan PM)
- Sebelum deploy: dump manual `~/hashi-backups/pre-t005-prod-<waktu>.dump` + `.sha256` (630 entri terbaca). Tanpa migrasi baru.
- `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` → `hashi-app-1` healthy.
- `curl -fsS http://127.0.0.1:3110/api/health` → `{"status":"ok","commit":"6a03395"}`; `docker image inspect hashi-app` label `org.opencontainers.image.revision` = `6a03395` (= `git rev-parse --short HEAD` di `main`).
- Demo TIDAK disentuh (`hashi-demo-*` tetap Up 3 jam, health `{"status":"ok"}` tanpa `commit` = masih image lama; ikut deploy berikutnya yang diizinkan Ipal).

**Yang dikerjakan (T-003)**
- **Jadwal: systemd USER timer** `hashi-backup.timer`, harian 02:00 JST, `Persistent=true`. Alasan: mengejar putaran yang terlewat saat PC mati (cron biasa tidak), unit tersimpan di repo (`scripts/systemd/`) dan bisa dipasang ulang, log juga masuk journal.
  Dipasang dengan `scripts/systemd/install.sh install` (idempoten; `status` dan `uninstall` tersedia). Hanya dua unit milik Hashi + berkas kunci; layanan/jadwal lain tidak disentuh.
- `scripts/backup-run.sh` (pembungkus): menjalankan `backup.sh` dengan `HASHI_BACKUP_KEEP=14`, log ke `~/hashi-backups/backup.log` (diputar ke `.log.1` bila > 1 MB), `LAST_FAILED` (waktu, kode, pesan) saat gagal dan dihapus saat berhasil.
- `scripts/decrypt.sh` (stdout saja) dan `docs/backup.md` §4b langkah 3-4 ditulis ulang dengan perintah lengkap (catatan PM soal `decrypt`).
- `docs/backup.md`: status (jadwal lokal aktif; luar-server ditunda, risiko disk rusak = cadangan hilang), cara pasang/copot/cek, batasan linger, retensi, §6 diperbarui.
- Kunci dibuat acak oleh `install.sh` langsung ke berkas (tidak pernah dicetak). Dump manual lama tidak dihapus.

**Verifikasi** (perintah → hasil apa adanya)
- `scripts/systemd/install.sh install` → timer aktif; `systemctl --user list-timers hashi-backup.timer` → **putaran berikutnya Rabu 2026-10-07 02:00 JST**.
- Dipicu manual `systemctl --user start hashi-backup.service` → exit 0, Result=success, set baru `hashi-20261006-133454-*` (database 630 entri, 146 berkas dokumen, 732 KB), log `BERHASIL`, tidak ada `LAST_FAILED`.
- Set hasil jadwal itu dipulihkan ke db-dev dengan `scripts/restore.sh` → **cocok dengan produksi**: 5 organisasi, 36 kandidat, 144 dokumen, 16 catatan kegiatan, 150 entri audit; 146 berkas dokumen. Database `hashi_restore_dev` dan folder uji dibuang.
  (Satu salah langkah saya: glob `hashi-*.sha256` sempat mengenai dump manual lama `hashi-prod-backup-…sql`; `restore.sh` menolaknya "berkas tidak ada", tidak ada yang berubah; diulang dengan pola nama yang tepat.)
- Simulasi gagal: `HASHI_BACKUP_PASSPHRASE= scripts/backup-run.sh` → exit 1, `LAST_FAILED` berisi waktu + kode 1 + pesan "HASHI_BACKUP_PASSPHRASE belum di-set", log `GAGAL`, tidak ada set parsial. Lalu `systemctl --user start hashi-backup.service` → berhasil, `LAST_FAILED` terhapus.
- Rotasi log diuji di folder sementara: log 1,2 MB → `backup.log.1` + log baru.
- `scripts/decrypt.sh`: db dimulai `PGDMP`, docs 146 berkas; kunci salah → exit 2.
- Repo: `git ls-files | grep -E '\.(gpg|dump)$|backup\.env'` → 0 baris; kunci tidak ada di repo/log/PR/STATUS.
- CI: lihat status PR (tidak ada perubahan kode aplikasi).

**Kondisi server:** produksi `6a03395` healthy (lihat atas). Perubahan di host: dua unit user systemd + symlink `timers.target.wants`, `~/.config/hashi/backup.env` (600, folder 700), `~/hashi-backups/backup.log` + set cadangan baru (2 set utuh: satu dari uji manual, satu dari uji pemulihan kegagalan).

**Info untuk Ipal**
- **Jenis jadwal:** systemd user timer; **putaran berikutnya: Rabu 2026-10-07 02:00 JST**, lalu tiap hari.
- **Lokasi kunci:** `/home/ipal/.config/hashi/backup.env` (berisi `HASHI_BACKUP_PASSPHRASE` dan `HASHI_BACKUP_KEEP`).
- **Cara menyalin kunci:** di terminal Ipal sendiri jalankan `cat ~/.config/hashi/backup.env`, salin baris `HASHI_BACKUP_PASSPHRASE=…` ke pengelola kata sandi, lalu cek bisa dibaca kembali dari sana. Jangan ditempel ke chat/tiket/repo.

**Kendala / catatan**
- `Linger=no` untuk `ipal`: timer user hanya hidup selama sesi login aktif (sesi desktop di Mini PC ini aktif). Bila direstart tanpa login, tidak ada cadangan sampai login (lalu `Persistent` mengejar).
- Pengaman Claude Code sempat menolak `rm` bervariabel di dalam skrip (T-002); semua `rm` di skrip baru memakai `${VAR:?}`.

**Pertanyaan**
- BUTUH IPAL: aktifkan `sudo loginctl enable-linger ipal` agar timer jalan tanpa login? Efek sampingnya: SEMUA layanan user (mis. `openclaw-gateway`) ikut hidup tanpa login. Belum dilakukan. Alternatif: tetap seperti sekarang (cadangan jalan selama ada sesi login).
- BUTUH IPAL: sudah menyalin kunci ke pengelola kata sandi? (Tidak bisa saya pastikan dari server.)

**Usulan berikutnya** (bukan tugas)
- Pemberitahuan bila `LAST_FAILED` ada (mis. tampil di dashboard super admin atau notifikasi), dan uji pemulihan bulanan terjadwal ke db-dev.

---

## 2026-10-06 · T-005 · Commit yang berjalan bisa dibaca langsung

**PR:** #4 (branch `eng/T-005-commit-terbaca`)
**Status:** siap direview (deploy produksi dilakukan SETELAH merge; hasilnya dicatat di bawah setelah itu)

**Yang dikerjakan**
- `Dockerfile`: `ARG GIT_SHA=unknown` (di akhir stage supaya cache layer tetap) → `LABEL org.opencontainers.image.revision` di stage `runner` DAN `tools`; stage `runner` juga `ENV GIT_SHA`.
- `compose.yaml`: `build.args.GIT_SHA: ${GIT_SHA:-unknown}` untuk `app` dan `migrate`. `scripts/demo-lib.sh` `dc()` mengisi `GIT_SHA` otomatis dari `git rev-parse --short HEAD` (jadi `dc up` demo ikut tanpa perubahan perintah).
- `/api/health` → `{"status":"ok","commit":"<sha pendek>"}` (`src/lib/build-info.ts`: hanya sha heksadesimal 7-40 karakter yang dipercaya, selain itu `unknown`; tidak ada info lain). Respons galat (503) tidak berubah.
- Label versi: `common.version` diganti dari "Hashi v0.2" menjadi "Hashi · {commit}" (id dan ja). **Catatan:** kunci lama itu TIDAK dirender di mana pun (kunci mati), jadi tidak ada "footer" yang diganti; saya menampilkannya sebagai teks kecil di bagian bawah sidebar (`data-testid="build-version"`, di bawah menu akun).
- Perintah deploy di README, `CLAUDE.md`, `docs/HISTORY.md` menjadi `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`.
- CI (job `docker`): build `runner` dan `tools` dengan `GIT_SHA=${GITHUB_SHA::7}`, lalu periksa label = sha, env `GIT_SHA` di container = sha, dan build TANPA build-arg tetap berhasil dengan label dan env `unknown`.

**Verifikasi** (perintah → hasil apa adanya)
- `npm run typecheck` → lulus. `npm run test:i18n` → lulus (1299 kunci). `npm run test:unit` → lulus (tes baru `build-info`). `npm run build` → 0 peringatan.
- `E2E_PORT=3120 npx playwright test health ui-polish dashboard` → 20 lulus (tes baru: `/api/health` memuat tepat kunci `status` dan `commit`; sidebar menampilkan "Hashi · unknown|sha", bukan "v0.2"). e2e penuh tidak dijalankan lokal (hanya yang tersentuh); CI menjalankannya.
- Lokal: `docker build --target runner --build-arg GIT_SHA=c634f2b` → label `c634f2b`, env `c634f2b`. Tanpa arg → `unknown` dan `unknown` (build tidak gagal). Image uji itu sudah saya hapus (milik saya, `hashi-t005-test`).

**Kondisi server:** belum ada yang di-deploy (menunggu merge). Demo TIDAK disentuh (izin Ipal diperlukan); demo akan ikut sha saat deploy berikutnya yang memang direncanakan.

**Kendala / catatan**
- Tanpa `GIT_SHA` di perintah deploy, hasilnya `unknown` (disengaja, tidak gagal). Mudah lupa: usulan menjadikan deploy satu skrip (`scripts/deploy.sh` yang mengisi sha dan memeriksa `/api/health`).
- `.claude/settings.local.json` (izin `gh pr merge`) kini dikecualikan lewat `.git/info/exclude` lokal karena `.gitignore` repo tidak memuatnya (PM mengira diabaikan secara bawaan). Usulan: tambahkan `.claude/settings.local.json` ke `.gitignore` lewat PR kecil.

**Pertanyaan**
- Tidak ada yang butuh Ipal.

**Usulan berikutnya** (bukan tugas)
- `scripts/deploy.sh` (sha otomatis + health check + cetak commit yang berjalan).
- Tambah `.claude/settings.local.json` ke `.gitignore`.

---

## 2026-10-06 · T-002 · Cadangan di luar server: desain + skrip lokal

**PR:** #3 (branch `eng/T-002-backup-desain`)
**Status:** siap direview

**Yang dikerjakan**
- `docs/backup.md`: apa yang dicadangkan, frekuensi, retensi, enkripsi, restore langkah demi langkah (uji ke db-dev, dan runbook produksi manual), 3 pilihan tujuan luar-server + perkiraan biaya, rekomendasi.
- `scripts/backup.sh`: `pg_dump -Fc` produksi + tar volume `hashi_docs-data` (container sementara `alpine` yang sudah ada, `--pull=never --network none --read-only`, volume `:ro`) → `gpg` simetris AES256, SEMUA lewat pipa (tidak ada data tanpa enkripsi di disk);
  checksum SHA-256, manifest tanpa data pribadi, pembacaan ulang cadangan setelah ditulis, hanya menyentuh `hashi-db-1` dan `hashi_docs-data` (nama lain ditolak), retensi opsional yang hanya menghapus set bernama `hashi-<tanggal>-<jam>-*`.
- `scripts/restore.sh`: memulihkan KE db-dev saja (database wajib berakhiran `_dev`/`_test`, `hashi`/`hashi_demo`/`hashi_dev` ditolak), memeriksa checksum + kunci sebelum membuat apa pun, membersihkan sisa bila gagal.
- `.env.example`: nama `HASHI_BACKUP_PASSPHRASE`, `HASHI_BACKUP_DIR`, `HASHI_BACKUP_KEEP` (tanpa nilai); `.gitignore`: `*.gpg`, `*.dump`; README bagian backup merujuk ke `docs/backup.md`.
- Belum memasang cron/timer dan tidak mengirim apa pun ke luar server (T-003).

**Verifikasi** (perintah → hasil apa adanya; kunci uji = `openssl rand -hex 24` sekali pakai di folder sementara di luar repo, tidak disimpan di repo)
- `scripts/backup.sh` tanpa kunci → gagal, kode 1, pesan jelas. Kunci pendek → gagal. `HASHI_DB_CONTAINER=hashi-demo-db-1` → ditolak.
- `scripts/backup.sh` (produksi) → berhasil: database 630 entri `pg_restore --list`, 146 berkas dokumen, 732 KB total, berkas mode 600 di folder mode 700; ciphertext tidak memuat penanda `PGDMP`.
- Retensi: dua set tambahan dengan `HASHI_BACKUP_KEEP=2` + berkas `pre-manual-dump.dump` → hanya set tertua dihapus, berkas manual utuh.
- `scripts/restore.sh` ke nama `hashi`, `hashi_demo`, `hashi_dev` → ditolak. Kunci salah → gagal sebelum membuat database (db tersisa 0). Berkas diubah (checksum) → gagal.
  Pada percobaan pertama kunci salah sempat meninggalkan database kosong; diperbaiki dengan pemeriksaan header dump + pembersihan otomatis, lalu diuji ulang (db tersisa 0).
- Restore benar ke `hashi_restore_dev` (db-dev): 1,7 detik; hitungan sama dengan produksi: 5 organisasi, 36 kandidat, 144 dokumen, 16 catatan kegiatan; 146 berkas dokumen.
- Aplikasi (build standalone, port 3121) terhadap database dan dokumen hasil restore: login `tsk.admin` berhasil, halaman kandidat 200, unduh dokumen 200 `application/pdf` (magic `%PDF`), baris `document.download` tercatat di audit database restore.
  Sesudahnya app 3121 dimatikan, database `hashi_restore_dev` dan folder uji dihapus (semua milik uji ini; produksi, demo, `hashi_dev` tidak disentuh).
- Berkas cadangan di repo: `git ls-files | grep -E '\.(dump|gpg)$'` → kosong; `git check-ignore` mengonfirmasi `*.gpg` diabaikan. Pindai: kunci uji tidak ada di berkas repo.
- CI: lihat status PR (tidak ada perubahan kode aplikasi).

**Kondisi server:** tidak ada yang di-deploy. Produksi dibaca (pg_dump, volume `:ro`); satu-satunya perubahan di Mini PC adalah database/folder uji yang sudah dibuang. Cadangan uji ada di folder sementara di luar repo dan `~/hashi-backups` TIDAK diisi/diubah.

**Kendala / catatan**
- Pengaman Claude Code sempat menolak `rm` dengan variabel tak terlindungi di dalam skrip; ditulis ulang memakai `${VAR:?}` (lebih aman juga untuk skrip aslinya).
- Berkas dokumen di volume dimiliki uid 1000; `restore.sh` (db-dev) memakai `--no-same-owner`. Untuk produksi, langkah `chown -R 1000:1000` ada di `docs/backup.md` §4b.
- Harga di `docs/backup.md` §5 ditulis dari ingatan, ditandai belum diverifikasi.
- Merge PR #2 sempat ditolak pengaman otomatis ("merge tanpa review", karena PM dan engineer satu akun GitHub); Ipal lalu memilih memberi izin permanen `gh pr merge` untuk PR `[T-…]` yang sudah `PM: DISETUJUI` + CI hijau, dengan `.claude/settings.json` lokal (BELUM di-commit, bukan bagian PR ini; PM/Ipal yang menentukan perlu tidaknya masuk repo).

**Pertanyaan**
- BUTUH IPAL: pilih tujuan luar-server (A restic→B2 yang direkomendasikan, B rclone/penyimpanan lain, atau C disk eksternal) beserta akun, cara pembayaran, dan **tempat menyimpan `HASHI_BACKUP_PASSPHRASE`** di luar server. Tanpa ini T-003 tidak bisa jalan.
- BUTUH IPAL: setuju memasang `restic`/`rclone` dan jadwal (cron/systemd timer) di host untuk T-003?

**Usulan berikutnya** (bukan tugas)
- Peringatan bila cadangan gagal/terlambat (mis. ping ke layanan pemantau) dan uji pemulihan terjadwal bulanan ke db-dev.
- Cadangan `.env` terpisah (tanpa isi di repo) di pengelola kata sandi.

---

## 2026-10-06 · T-001 · Laporan kondisi Mini PC

**PR:** #2 (branch `eng/T-001-laporan-kondisi`)
**Status:** siap direview

**Yang dikerjakan**
- Hanya membaca kondisi server; tidak ada perubahan kode atau konfigurasi server. PR ini hanya mengubah `docs/STATUS.md`.

**Verifikasi** (perintah → hasil apa adanya)
- **Produksi:** `docker compose ps` → `hashi-app-1` (image `hashi-app`, port host 3110 → 3100) dan `hashi-db-1` (`postgres:16-alpine`) Up, healthy.
  `curl -fsS http://127.0.0.1:3110/api/health` → `{"status":"ok"}`.
- **Commit yang berjalan di produksi:** image `hashi-app` TIDAK menyimpan label commit (labelnya hanya label compose), jadi commit hanya bisa disimpulkan dari waktu build:
  `docker image inspect hashi-app --format '{{.Created}}'` → 2026-10-06 10:31 JST; commit terakhir yang mengubah kode, `c65cb2e`, dibuat 10:18 JST dan di-deploy setelah CI hijau.
  Jadi produksi = `c65cb2e`. `main` sekarang `b6b0d0a`; selisihnya hanya dokumen (`CLAUDE.md`, `README.md`, `docs/HISTORY.md`, `docs/STATUS.md`, `docs/TASKS.md`), tidak ada kode: **kode produksi setara dengan `main`**.
  (Image `hashi-migrate` bertanggal 10:14: layer tidak berubah karena hanya `src/db` yang masuk image itu.)
- **Demo:** `hashi-demo-app-1` dan `hashi-demo-db-1` Up, healthy; `curl -fsS http://127.0.0.1:3111/api/health` → `{"status":"ok"}`.
- **db-dev:** `hashi-db-dev-1` Up (2 jam), healthy, hanya di `127.0.0.1:5433`. `.env` lokal menunjuk database `hashi_dev` (DATABASE_URL dan MIGRATE_DATABASE_URL; hanya nama database yang dibaca).
- **Versi:** node v25.9.0, npm 11.12.1, Docker 29.8.2, Docker Compose v5.6.0. `gh auth status` → berhasil (akun `rivaldydwi`).
- **Playwright:** Chromium terpasang (`~/.cache/ms-playwright`: chromium-1243, chromium_headless_shell-1243, ffmpeg-1011), jadi `test:e2e` bisa dijalankan (terakhir lulus 156/156 pada 2026-10-06).
- **Disk:** `/` (nvme0n1p2, juga tempat Docker) 233G, terpakai 89G (41%), sisa 132G.
- **Volume `docs-data` produksi** (`hashi_docs-data`): 752K.
- **Cadangan otomatis:** tidak ada. `crontab -l`, `systemctl list-timers --all`, dan `/etc/cron.d` tidak memuat apa pun terkait Hashi. Yang ada hanya cadangan manual `pg_dump -Fc` + `.sha256` sebelum tiap rilis di `~/hashi-backups/` (21 berkas); terbaru `pre-6-prod-20261006-101417.dump` dan `pre-6-demo-20261006-101417.dump` (2026-10-06). **Tidak ada cadangan volume `docs-data`** dan tidak ada salinan di luar server.
- **`/loop` di Claude Code VS Code:** bisa. `/loop 1h …` berhasil membuat jadwal (job cron sesi, tiap jam menit :07, kedaluwarsa otomatis 7 hari, hilang bila sesi/VS Code ditutup). Catatan: `/loop` dengan interval ≥ 60 menit selalu menawarkan jadwal cloud dulu; untuk siklus ini dipilih "hanya sesi ini" karena engineer butuh akses Mini PC.

**Kondisi server:** tidak ada yang diubah atau di-deploy. Produksi di `c65cb2e`, healthy.

**Kendala / catatan**
- Untuk mengukur ukuran volume saya menjalankan satu container sementara (`docker run --rm -v hashi_docs-data:/d:ro alpine du -sh /d`): volume dipasang baca-saja, image `alpine` sudah ada di host (tidak ada yang diunduh), container langsung terhapus. Itu container di luar project compose `hashi` walau hanya sesaat; kalau PM menganggap itu melanggar "Batasan server", beri tahu dan saya hindari lain kali (alternatif: `docker exec hashi-app-1 du -sh <STORAGE_DIR>`).
- Versi Hashi di footer UI masih "Hashi v0.2" (`common.version`), tidak mengikuti tahap pengerjaan.

**Pertanyaan**
- Tidak ada yang butuh Ipal untuk tugas ini.

**Usulan berikutnya** (bukan tugas)
- Tambah label commit pada image saat build (mis. build-arg `GIT_SHA` ke `LABEL org.opencontainers.image.revision`) dan tampilkan di `/api/health`, supaya "commit apa yang berjalan" bisa dibaca langsung, bukan ditebak dari waktu build.
- Cadangan `docs-data` belum pernah dibuat sama sekali; T-002 sebaiknya mencakup volume itu sejak awal (sudah tercantum).
