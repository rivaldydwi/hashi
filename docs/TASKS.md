# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-013 · Lacak peringatan `pg` "client.query() ... already executing" · `SIAP`

Log e2e menampilkan peringatan pg ini (`docs/HISTORY.md` §4). Di pg@9 perilaku ini akan jadi **error**, jadi ini bom waktu: biasanya dua query dijalankan bersamaan
di SATU klien/transaksi (mis. `Promise.all` di dalam `withTenant(tx => …)`).

Kerjakan:
- Temukan sumbernya: jalankan e2e/halaman dengan `NODE_OPTIONS=--trace-warnings` (atau `process.on("warning")` sementara) sampai dapat stack trace; catat berkas + fungsi.
- Perbaiki di akarnya (query berurutan di dalam transaksi yang sama, atau pisah transaksi bila memang boleh paralel); cari pola serupa di seluruh `src/` (`Promise.all` di dalam `withTenant`/`tx`), bukan hanya satu tempat.
- Tambah penjaga supaya tidak muncul lagi: mis. tes/skrip yang menjalankan halaman-halaman utama dan GAGAL bila peringatan itu muncul (atau `process.on("warning")` di `serve-standalone.mjs` saat e2e yang menulis ke log lalu dicek di akhir).
- Peringatan "destination stream closed early" ikut diperiksa: jelaskan penyebabnya; perbaiki hanya bila memang bug.

**Kriteria selesai**
- [ ] STATUS menyebut sumber peringatan (berkas/fungsi) dan pola yang diperbaiki di mana saja.
- [ ] Log `test:e2e` lengkap tanpa peringatan "already executing" (kutip potongan log / hitungan 0 di PR) + penjaga otomatis yang gagal bila muncul lagi.
- [ ] Tidak ada perubahan perilaku (typecheck, build 0 peringatan, test:rls, e2e, CI hijau).

---

### T-023 · Terjemahan peramban: teks bebas BOLEH diterjemahkan, yang dikunci hanya identitas · `SIAP` (setelah T-013, sebelum T-020)

Masukan Ipal (2026-10-07, tangkapan layar detail kandidat dengan Chrome "Terjemahkan" id→ja): catatan LPK berbahasa Indonesia (motivasi, PR diri, hobi, keahlian, catatan riwayat Jepang, dst.)
**tidak ikut diterjemahkan**. Staf TSK orang Jepang/Myanmar/Vietnam justru perlu membaca isi itu. **Keputusan Ipal: teks bebas harus bisa diterjemahkan.** Ini mengoreksi aturan T-016,
yang dulu ikut mengunci "isi catatan dan teks bebas".

Aturan baru (satu tempat, berlaku di seluruh aplikasi):
- **TETAP `translate="no"` (identitas, jangan diubah mesin):** nama orang + katakana, nama organisasi/LPK/perusahaan/lokasi/PIC, alamat, telepon, email, kode (kandidat, kasus), nomor dokumen,
  nama merek "Hashi" (termasuk "Hashi · <commit>" di sidebar). Judul/nama job order juga tetap.
- **BOLEH diterjemahkan (hapus `translate="no"`):** semua teks bebas/kalimat. Contohnya kolom panjang profil kandidat (motivasi, PR diri, hobi, keahlian khusus, catatan riwayat Jepang, alasan, dst.),
  catatan TSK, catatan/tindak lanjut penilaian, isi catatan kegiatan/notulen/kronologi/tindak lanjut/laporan harian, catatan kuartal 定期面談, catatan kartu 在留カード, isian teks form 5-5, dan alasan pembatalan.
  Nilai pilihan (status, jenis kelamin, ya/tidak, bidang) sudah label, jadi boleh diterjemahkan.
- **Jangan memasang `lang`** pada teks bebas: bahasanya bisa Indonesia atau Jepang, jadi biarkan peramban menebak.
- Tentukan dari **definisi kolom**, bukan per halaman. Misalnya di `sections.ts`, tiap field punya sifat `data: "identity" | "prose"` (atau turunan dari jenis kolom). Ringkasan baris berulang
  (`DetailSections` → `section.summary`) dipecah per nilai sesuai sifat kolomnya, bukan satu `translate="no"` untuk seluruh baris.
- Perbarui aturan di `CLAUDE.md` (butir "Terjemahan peramban") dan `docs/glossary.md`/README bila ada.

**Kriteria selesai**
- [ ] e2e `translate-data.spec.ts` diperluas: nama/katakana/perusahaan/alamat/telepon/kode tetap `translate="no"`, sedangkan kolom teks bebas (minimal: motivasi kandidat, catatan TSK,
  isi catatan kegiatan, catatan kuartal) TIDAK berada di dalam `[translate="no"]`; merek "Hashi" `translate="no"`.
- [ ] Tes unit: setiap field di `sections.ts` punya sifat yang jelas (identity/prose), tidak ada yang terlewat.
- [ ] Uji manual Chrome "Terjemahkan" (id→ja dan ja→en) oleh Ipal setelah deploy; engineer melampirkan daftar kolom identity vs prose di PR untuk dicek.
- [ ] typecheck, build, e2e, CI hijau.

---

### T-020 · 在留カード: nomor + foto kartu (terenkripsi) · `SIAP` (setelah T-023)

Jawaban TSK no. 6: nomor dan foto kartu **harus disimpan**. Data paling sensitif di Hashi, jadi aturannya ketat.

Kerjakan:
- **Kunci baru `CARD_DATA_KEY`** (32 byte acak, base64). Ini kunci BARU, berbeda dari `AUTH_SECRET` dan dari kunci cadangan.
  - Pengembangan/CI/e2e: kunci uji sendiri (boleh dibuat bebas, jangan di-commit).
  - **Produksi**: kunci dibuat engineer di `.env` server saat deploy, lalu **berhenti dan tulis `BUTUH IPAL:` di STATUS/PR** supaya Ipal menyalinnya ke tempat aman (seperti kunci cadangan).
    Jangan memasukkan data nyata sebelum Ipal mengonfirmasi salinannya. Kunci tidak boleh muncul di log, keluaran skrip, atau git.
  - Aplikasi menolak jalan dengan jelas bila kunci tidak ada (tanpa diam-diam menyimpan polos). Rancang `key_id` supaya kunci bisa diganti nanti.
- **Nomor kartu**: kolom terenkripsi di level aplikasi (AES-256-GCM, nonce acak per nilai) di `residence_cards` (atau tabel anak 1:1), validasi format 12 karakter (2 huruf + 8 angka + 2 huruf).
  Tidak pernah tampil di daftar, KPI, ekspor, PDF, audit, maupun log. Di detail: tersamar (`AB********CD`), tombol "Tampilkan" hanya untuk 担当 + Admin, dan setiap tampil **diaudit** (`residence_card.number_view`, tanpa nilai).
- **Foto kartu depan/belakang**: pola dokumen yang ada (`sniffType`, JPG/PNG/PDF, `sharp` buang EXIF), berkas **terenkripsi di disk** dengan kunci yang sama. Unduh/lihat hanya 担当 + Admin lewat route handler
  (RLS + audit `residence_card.photo_view`), `attachment` + `nosniff`. Ikut terhapus/void bersama kartu sesuai aturan T-017 (tanpa DELETE fisik data audit).
- Catatan yang mirip nomor kartu tetap ditolak (T-018). Cadangan (`scripts/backup.sh`) ikut membawa berkas terenkripsi. Dokumentasikan di `docs/backup.md` bahwa **tanpa `CARD_DATA_KEY` data ini tidak bisa dipulihkan**.
- `docs/zairyu-card.md` §2.3 diperbarui: keputusan berubah karena jawaban TSK.

**Kriteria selesai**
- [ ] Tes unit enkripsi (bolak-balik, nonce berbeda, kunci salah = gagal, data rusak = gagal). `verify-rls`: staf bukan 担当 tidak bisa membaca kolom/berkas, LPK/sensei 0 baris.
- [ ] e2e: simpan nomor + foto, tersamar di detail, "Tampilkan" mencatat audit tanpa nilai, staf lain tidak melihat tombol (dan server menolak), nomor tidak ada di HTML daftar/KPI.
- [ ] Bukti di PR: isi kolom di database = sandi acak, bukan nomor; berkas di disk bukan JPG terbaca.
- [ ] Deploy produksi dengan `--backup` + langkah kunci `BUTUH IPAL` di atas.

---

### T-022 · Email pengingat 在留カード (ke staf + Admin) · `SIAP` (setelah T-020)

Jawaban TSK no. 12: email hanya untuk **pengingat mendaftarkan/memperbarui kartu**; progres setelah diajukan cukup di Hashi (imigrasi sudah mengirim email sendiri).

Kerjakan:
- Penerima = `cardRecipients` (担当 efektif + semua TSK_ADMIN), email dari tabel `users`. **Pekerja belum** (butuh kolom email pekerja + persetujuan; tugas terpisah).
- Pemicu = tahap masuk `prepare`, `can_apply`, `h30`, `h14`, `h7`, `expired`, `special_overdue`, `rejected`, serta 追加資料. **Sekali per (kartu, tahap)**: tabel log pengiriman (unik kartu + tahap), tanpa isi email.
  Satu email ringkasan per penerima per hari (bukan satu email per kartu). Isi email bahasa Jepang + Indonesia sesuai `users.locale`, berisi nama pekerja + tahap + tautan ke Hashi. Tidak memuat nomor kartu, catatan, atau data lain.
- Penjadwal: service baru **di dalam project compose `hashi`** (misalnya `worker`) yang berjalan tiap hari jam 08:00 Asia/Tokyo memakai `withSystem` (bukan cron sistem, bukan systemd: menyentuh cron sistem = `BUTUH IPAL`).
- Pengiriman lewat SMTP dari env (`SMTP_URL`, `MAIL_FROM`). **Tanpa `SMTP_URL` = mode kering**: email tidak terkirim, hanya dicatat "akan dikirim" di log aplikasi (tanpa alamat lengkap). Pengembangan/e2e memakai **Mailpit** di `compose.dev.yaml`.
- **Produksi tetap mode kering** sampai Ipal menyiapkan akun SMTP (`BUTUH IPAL`: akun layanan pihak luar/berbiaya). Usulkan 2–3 pilihan layanan gratis/murah di STATUS.
- Audit: `residence_card.reminder_sent` (tahap, jumlah penerima; tanpa alamat).

**Kriteria selesai**
- [ ] Tes unit: pemilihan kartu/tahap yang dikirim hari ini, tidak terkirim dua kali, ringkasan per penerima.
- [ ] e2e/integrasi dengan Mailpit: email sampai ke 担当 + Admin, bahasa sesuai `locale`, tanpa nomor kartu; dijalankan dua kali = tidak ada email ganda.
- [ ] Produksi berjalan dalam mode kering (bukti log), plus daftar pilihan layanan SMTP untuk Ipal.

---

### T-014 · Langkah 8 siap pilot: 200 siswa dummy + cek kecepatan · `SIAP` (setelah T-022)

Tujuan: membuktikan aplikasi tetap cepat dan benar dengan volume pilot, sebelum data nyata. **Hanya `db-dev`/`_test` dan (dengan izin Ipal) demo; produksi tidak disentuh.**

Kerjakan:
- `npm run seed:pilot` (skrip baru di `scripts/`, hanya impor `src/db/`; ADDITIVE, deterministik, ditolak `db-guard` di luar `_dev`/`_test`/`_demo`): +200 kandidat lengkap
  (sebaran status LPK, keputusan TSK, penilaian bulanan beberapa bulan, dokumen dummy kecil), sebagian berangkat jadi pekerja aktif dengan catatan kegiatan + wawancara berkala,
  dan **satu staf TSK dengan ≥ 45 pekerja** supaya peringatan beban T-010 terlihat. Pekerja aktif pilot juga punya **sebaran semua tahap 在留カード** (none, prepare, can_apply, H-30/14/7, lewat, 結果待ち, 追加資料, 特例期間, special_overdue, 不許可, tanpa data; keputusan PM T-019), dan waktu `loadCardRows`/`/records/cards` ikut diukur. Jalankan dua kali = tidak menggandakan (idempoten).
- `verify:seed` diperluas (mode pilot) atau pemeriksaan sendiri: jumlah, kelengkapan, dan angka KPI = daftar tetap berlaku pada volume ini.
- Ukur waktu server (bukan perasaan) untuk: `/candidates` (tanpa dan dengan filter penilaian), detail kandidat, dashboard LPK_ADMIN dan TSK_ADMIN, `/records/interviews`, `/records/responsible`,
  `/activity`. Catat median + terburuk dari ≥ 5 kali per halaman di STATUS. Batas: **≤ 1 detik** di OptiPlex untuk tiap halaman; yang lebih lambat diperbaiki (indeks, N+1, query berkorelasi).
  Sertakan `EXPLAIN ANALYZE` untuk query yang diperbaiki.
- `docs/pilot-checklist.md`: daftar periksa sebelum data nyata (cadangan luar-server berjalan + uji restore, `SHOW_DEMO_ACCOUNTS=false`, kata sandi akun bukan bawaan, akun demo dimatikan,
  data dummy tidak ada di produksi, 行政書士 untuk syarat gender/My Number, pengecekan form 5-5 oleh staf TSK, dst.), setiap butir dengan cara memeriksanya. Hanya dokumen; jangan ubah `.env`.

**Kriteria selesai**
- [ ] `seed:pilot` idempoten + ditolak di database produksi (tes/bukti di PR); CI menjalankannya di `hashi_test` lalu `verify:seed`.
- [ ] Tabel waktu per halaman di STATUS (sebelum/sesudah bila ada perbaikan), semua ≤ 1 detik.
- [ ] Tangkapan layar `/records/responsible` dengan staf ≥ 45 (kuning) dan daftar kandidat 200+.
- [ ] `docs/pilot-checklist.md` ada; typecheck, build, test:rls, e2e, CI hijau.

---

### T-015 · `scripts/deploy.sh`: log build ke berkas · `SIAP` (setelah T-014)

Usulan engineer (T-007): output build Docker yang panjang menenggelamkan hasil penting. Log lengkap ke berkas (mis. `~/hashi-backups/deploy-<waktu>.log`, simpan 20 terakhir),
terminal hanya ringkasan per langkah (pull, cadangan, build, migrasi, health + commit). Gagal = tampilkan 40 baris terakhir log + path berkasnya, kode keluar ≠ 0. Perilaku lain tidak berubah.

**Kriteria selesai**
- [ ] Contoh output sukses dan gagal (mis. simulasi build gagal di branch uji, BUKAN di produksi) di PR; `shellcheck` bersih.
- [ ] Deploy produksi berikutnya memakai skrip baru dan hasilnya (commit + health) tercatat di STATUS.

---

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- **Cadangan luar-server** (ditunda atas keputusan Ipal; WAJIB sebelum data nyata/pilot): pilihan di `docs/backup.md` §5.
- 在留カード: koreksi tanggal kartu yang sudah `received` oleh Admin (usulan engineer T-017), hanya bila TSK memintanya setelah dipakai.
- Email pengingat 在留カード **ke pekerja** (butuh kolom email pekerja + persetujuan; setelah T-022).
- **T-021 · 在留カード: isi awal/massal mengikuti form imigrasi** (perorangan + grup, jawaban no. 8). DITAHAN sampai Ipal mengirim form PDF imigrasinya.
- Tampilan LPK: status visa + tanggal tiba (jawaban no. 9: hanya yang dibuat TSK). Setelah T-019.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- Langkah 9: demo ke TSK.

## Selesai

- **T-019** 在留カード (C) (PR #17): `/records/cards` + menu sungguhan, KPI urgent/prepare/waiting/missing dari SATU sumber (`loadCardRows`/`filterCardRows`/`cardKpiCounts`, `isActionNeeded` termasuk 追加資料), staf = miliknya, Admin = semua; seed 3 keadaan + `verify:seed` KPI = daftar; 13 pekerja uji e2e untuk semua tahap. KPI TSK_ADMIN kini 3 baris di 1280 px (diterima PM; tes T-012 disesuaikan ke ≤ 3).
- **T-018** 在留カード (B) (PR #16): bagian kartu di `/records/workers/<id>` (kartu pertama, enam status, 追加資料/不許可 bertanggal lewat migrasi 0026, terima kartu baru atomik, serah, void, riwayat), tombol hanya untuk 担当/Admin (server + RLS), catatan mirip nomor kartu ditolak, 10 e2e.
- **T-017** 在留カード (A) (PR #15): migrasi 0025 `residence_cards` (rantai kartu, terima + pengganti atomik lewat constraint trigger tertunda, kartu diterima final), tulis 担当 efektif + Admin (`card_editor`, = `effectiveResponsible`), baca semua staf TSK, tanpa DELETE; `cardStage` dengan 結果待ち/特例期間/不許可; verify-rls bagian X; 21 tes unit. Tanpa UI.
- **T-016** Terjemahan peramban: label boleh, data jangan (PR #14): `<Data>`/`translate="no"` pada nama, katakana (`lang="ja"`), perusahaan, alamat, telepon, email, kode, isi catatan; `<html>` tidak diblokir; e2e `translate-data.spec.ts`. Uji manual Chrome "Terjemahkan" dilakukan Ipal setelah deploy (fitur itu tidak ada di Chromium server).
- **T-012** Kartu KPI ringkas dan bervariasi (PR #13): tinggi sekitar 96 px, grid otomatis menurut lebar, nada + ikon per KPI di katalog, `kpiLook` (KPI tindakan tenang/"Beres" bila 0), token warna AA, keterangan id/ja disederhanakan; tes unit + e2e tata letak.
- **T-011** Tabel lebar rapi dalam bahasa Jepang (PR #12): header `:lang(ja)` tidak patah, utilitas `cjk-phrase` (word-break auto-phrase / keep-all) + `min-w-*` lewat `gridTh/gridTd/gridTdText/gridTdShort`, diterapkan ke grid 定期面談, daftar tahunan, kandidat, job order, pengguna, organisasi; e2e `table-ja.spec.ts` menjaga tinggi header/baris.
- **T-004** Desain pelacak 在留カード (PR #11): `docs/zairyu-card.md` (tabel `residence_cards` berbaris per kartu, 担当 diturunkan dari T-010, nomor/foto kartu TIDAK disimpan, RLS hanya TSK, `cardStage` fungsi murni + 12 kasus tepi, tampilan, rencana T-A..T-D, 12 pertanyaan TSK). Tanpa kode.
- **T-009** Form 定期面談報告書 参考様式第5－5号 (PR #10): kolom form55 di `periodic_interviews` (migration 0024), konfigurasi tunggal `src/db/form55.ts` (teks butir resmi, isian kurung ⑤(2)), bagian 4 hanya bila ⑥ = 有, 作成年月日 bawaan = tanggal simpan terakhir (zona TSK), PDF per wawancara + gabungan setahun, halaman tahunan per pekerja (wawancara karena kejadian dipisah). 面談実施者 = 対応者 (keputusan PM). Status DRAFT sampai dicek staf TSK; deploy produksi setelah merge.
- **T-010** Penanggung jawab pekerja (PR #9): `responsible_assignments` (migration 0023, per perusahaan atau per penempatan, append-only, tulis hanya TSK_ADMIN),
  beban per staf `WORKLOAD` (50, kuning ≥ 45, merah > 50, berlaku 2027-04-01, tidak memblokir), `/records/responsible`, 2 KPI TSK_ADMIN. Seed ≥ 45 ditunda ke langkah 8
  (dibuktikan di e2e). Deploy T-008: produksi `5f9c613`.
- **T-008** 定期面談 per kuartal (PR #8): `quarterState` (done/open/missed/na/notDue/notRequired; kuning 14 hari terakhir), KPI = kuartal `open`, `missed` = bolong di grid
  dan daftar laporan tahunan `/records/interviews/annual`; pekerja ENDED ikut grid, laporan, dan pemilih form. Deploy T-007: produksi `31008ad`.
- **T-007** Riwayat catatan per pekerja (PR #7): `/records/workers/<id>` (①②③④ dalam satu garis waktu + tindak lanjut terbuka), tombol "Lanjutkan"
  (`continues_record_id`, migration 0022, penjaga database), `verify-rls` bagian U, 7 e2e baru; deploy T-006 lewat skrip: produksi `32ea832`.
- **T-006** Skrip deploy (PR #6): `scripts/deploy.sh` (main + bersih + pull --ff-only + build dengan `GIT_SHA` + tunggu health = commit; `--backup`, `--check`),
  `.claude/settings.local.json` di `.gitignore`, peringatan timer cadangan memakai working tree. Deploy pertama lewat skrip dicatat di STATUS T-007.
- **T-003** Cadangan lokal terjadwal (PR #5): systemd user timer 02:00 JST (`Persistent=true`), `backup-run.sh` (log + `LAST_FAILED`), `decrypt.sh`, uji pulih
  dari set hasil jadwal cocok dengan produksi. Deploy T-005 tercatat: produksi `6a03395`. **Keputusan Ipal (2026-10-06):** kunci cadangan sudah disalin Ipal ke penyimpanan pribadi di luar server; linger TIDAK diaktifkan (Mini PC selalu menyala dan login). Jangan ditanyakan lagi.
- **T-005** Commit yang berjalan terbaca (PR #4): label image + env `GIT_SHA`, `/api/health` memuat `commit`, label "Hashi · <sha>" di sidebar, dicek di CI.
- **T-002** Cadangan terenkripsi lokal (PR #3): `docs/backup.md`, `scripts/backup.sh`, `scripts/restore.sh`; uji restore ke db-dev cocok dengan produksi
  dan aplikasi bisa membuka dokumen hasil restore. Belum ada jadwal dan salinan luar-server (T-003).
- **T-001** Laporan kondisi Mini PC (PR #2). Hasil penting: produksi sehat dan kodenya setara `main`; **belum ada cadangan otomatis maupun cadangan
  `docs-data`** (prioritas T-002); `/loop` jalan di VS Code. Pengukuran volume lewat container `alpine` sementara (baca-saja) diterima,
  tapi lain kali pakai `docker exec` ke container `hashi` yang sudah ada.

---

## Cara engineer berjalan otomatis (catatan untuk Ipal)

Engineer hanya bekerja saat sesinya hidup. Supaya Ipal tidak perlu mengetik apa-apa setiap ada tugas, buka sesi Claude Code di VS Code
di folder repo ini sekali, lalu ketik:

```
/loop 1h Jalankan satu putaran siklus engineer sesuai CLAUDE.md bagian "Peran dan aturan kerja".
```

VS Code dan Mini PC harus tetap menyala. PM memeriksa repo secara berkala dari sisi cloud.
