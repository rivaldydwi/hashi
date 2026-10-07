# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-016 · Terjemahan browser: label boleh, data jangan · `SIAP`

Temuan Ipal (2026-10-07): dengan terjemahan otomatis Chrome, "Kandidat" jadi **"Kandosat"**, "Konstruksi" jadi "Kon struksi", dan nama katakana diubah ke huruf Latin yang salah
("Djokovic Pratama" untuk Joko). Teks itu tidak ada di `messages/`; refresh mengembalikan teks asli.

**Keputusan Ipal + PM: terjemahan browser TIDAK diblokir total.** Staf TSK bisa orang Myanmar/Vietnam dsb. yang perlu menerjemahkan label yang tidak dimengerti.
Yang dilindungi hanya **data**, karena terjemahan data menyesatkan (orang/perusahaan yang salah).

Kerjakan:
- JANGAN pasang `translate="no"` di `<html>` atau meta `notranslate` untuk seluruh halaman.
- Satu komponen/utilitas bersama (mis. `<Data>` / kelas `notranslate` + atribut `translate="no"`) dipakai untuk: nama orang dan katakana, nama perusahaan/lokasi/PIC, alamat, telepon,
  email, kode (kandidat, kasus), isi catatan dan teks bebas yang ditulis pengguna. Terapkan minimal di: daftar + detail kandidat, grid 定期面談 dan daftar tahunan, catatan kegiatan, klien/job order,
  pengguna, riwayat aktivitas, header/akun di shell. Label, judul kolom, tombol, status, dan teks bantuan TETAP bisa diterjemahkan.
- Teks Jepang di halaman berbahasa Indonesia (katakana, istilah Jepang) diberi `lang="ja"`; `<html lang>` tetap mengikuti bahasa UI. Ini membantu browser menebak bahasa sumber dengan benar.
- Tanggal: tampil tetap dari formatter aplikasi (boleh diterjemahkan, tapi tidak wajib dilindungi).

**Kriteria selesai**
- [ ] Tes e2e: `html` TIDAK punya `translate="no"`; sel nama/katakana/perusahaan di daftar kandidat dan grid 定期面談 punya `translate="no"`; judul kolom tidak.
- [ ] Uji manual dengan Chrome "Terjemahkan" (id→en atau ja→en) di daftar kandidat dan grid: label diterjemahkan, nama/perusahaan tetap asli. Lampirkan tangkapan layar di PR.
- [ ] Aturan singkat di `CLAUDE.md` (data pengguna = `translate="no"`, label = boleh diterjemahkan) supaya halaman baru mengikuti.
- [ ] typecheck, build, e2e, CI hijau.

---

### T-017 · 在留カード (A): skema, aturan, `cardStage`, dokumen desain mengikuti jawaban TSK · `SIAP` (setelah T-016)

Dasar: desain `docs/zairyu-card.md` (T-004) + **jawaban staf TSK (Ghulam, 2026-10-07)**. Jawaban yang mengubah desain:

| No | Jawaban TSK | Akibat untuk desain |
|---|---|---|
| 1 | Pengingat ke 担当 **wajib**; salinan ke manajer/Admin | Sesuai §4.1: penerima = 担当 efektif (T-010) + semua TSK_ADMIN |
| 2 | Setelah diajukan (申請中) cukup tampil **結果待ち** | Tahap baru `waiting_result`: H-30/H-14/H-7 TIDAK lagi naik setelah status `applied`/`additional_docs` |
| 3 | 特例期間 ditampilkan **bila diperlukan** (tafsiran PM) | Bila `waiting_result` dan tanggal habis sudah lewat: tampil "特例期間 s.d. <habis + 2 bulan>". Bila lewat batas itu dan belum ada hasil, tahap `special_overdue` (perhatian) |
| 4 | Hanya **特定技能1号** + bidangnya (介護, 飲食 dll); **在留期間 dicatat** | `residence_status` tetap `ssw1` (kolom tetap ada untuk masa depan); bidang = FK `skill_fields` (bawaan dari `candidates.field_id`, bisa diubah); kolom `period_months` (pilihan di SATU konfigurasi, mis. 4/6/12/… bulan) |
| 5 | Status: belum mulai, persiapan, diajukan, **追加資料**, kartu baru diterima, **ditolak (不許可)** | `renewal_status`: `not_started`, `preparing`, `applied`, `additional_docs`, `received`, `rejected` |
| 6 | Nomor dan foto kartu **harus disimpan** | Tugas TERPISAH **T-020** (enkripsi + akses terbatas). T-017 TIDAK menyimpannya |
| 7 | Yang boleh mengubah: **担当 + Admin** | Tulis: 担当 efektif pekerja itu atau TSK_ADMIN, ditegakkan di RLS (fungsi `SECURITY DEFINER` sempit, misalnya `card_editor(candidate_id)`, logika sama dengan `effectiveResponsible`). Baca: semua staf TSK org itu |
| 8 | Isian mengikuti form PDF imigrasi (perorangan + grup) | Tugas **T-021** (isi awal/massal), DITAHAN sampai Ipal mengirim form PDF-nya |
| 9 | LPK hanya melihat yang dibuat TSK | Tetap seperti §3.3 (tugas terpisah, belum dijadwalkan) |
| 10 | Kartu diambil **staf** lalu diserahkan ke pekerja; opsi **pekerja mengambil sendiri** | Kolom `received_by` (`staff`/`worker`) + `handed_over_on` (tanggal diserahkan ke pekerja, opsional, hanya bila `staff`) |
| 11 | Tanggal Jepang | Sesuai §4.2 (zona organisasi TSK) |
| 12 | Email hanya untuk pengingat daftar/perbarui kartu (ke staf, Admin, pekerja); progres cukup di Hashi | Email = tugas terpisah, menunggu keputusan Ipal (layanan email berbiaya + email pekerja = data pribadi). T-017 s.d. T-019 hanya dalam aplikasi |

Kerjakan (sesuai rencana T-A di `docs/zairyu-card.md` §6, dengan perubahan di atas):
- Migrasi `residence_cards` + SQL manual (GRANT tanpa DELETE, ENABLE/FORCE RLS, policy baca semua staf TSK, tulis 担当/Admin, trigger penjaga, perluasan `activity_revisions.entity_type`).
- `src/db/zairyu.ts`: `cardStage` dengan tahap baru: `waiting_result`, `special_overdue`, `rejected` (perhatian, menghentikan pengingat biasa), serta `additional_docs` sebagai tanda pada `waiting_result`. Plus `addMonths`, pemilihan kartu terkini, konfigurasi `PERIOD_OPTIONS`.
- Perbarui `docs/zairyu-card.md`: jawaban §9 dicatat, tabel tahap dan kasus tepi §4.3 disesuaikan (tambah kasus: diajukan lalu lewat tanggal habis = 特例期間; lewat +2 bulan = `special_overdue`; 追加資料; 不許可; diambil pekerja sendiri).
- `ACTIONS` audit + `AUDIT_VALUE_FIELDS.residence_card` (kode status/tahap, `received_by`; tanpa tanggal, nomor, catatan, nama).
- `verify-rls`: bagian baru (staf bukan 担当 tidak bisa menulis, 担当 dan Admin bisa, UPDATE tanpa WHERE, tanpa DELETE, LPK/sensei/super admin/null 0 baris, cascade/RESTRICT `candidate_id`).

**Kriteria selesai**
- [ ] Tes unit `cardStage` mencakup SEMUA kasus di §4.3 yang diperbarui (angka, bukan hanya "tidak error").
- [ ] `verify-rls` hijau dengan aturan tulis 担当 + Admin (termasuk pergantian 担当: 担当 lama tidak bisa menulis lagi).
- [ ] Tidak ada UI baru; typecheck, build, test:rls, unit, `verify:audit-coverage`, CI hijau.

---

### T-018 · 在留カード (B): bagian di detail pekerja · `SIAP` (setelah T-017)

Sesuai rencana T-B (`docs/zairyu-card.md` §6) dengan jawaban TSK di T-017:
- Form kartu pertama: bidang (bawaan dari kandidat), 在留期間, tanggal habis.
- Ubah status proses (enam status). 追加資料 dan 不許可 masing-masing punya tanggal + catatan singkat.
- "Terima kartu baru" dalam SATU transaksi: `received_by` staf/pekerja, `handed_over_on` bila staf, tanggal habis baru.
- Void dengan alasan; riwayat kartu + riwayat edit.
- Tombol ubah hanya tampil untuk 担当/Admin. Staf lain melihat baca-saja, dengan penjelasan siapa yang boleh mengubah.

**Kriteria selesai**
- [ ] e2e: alur lengkap (buat, persiapan, diajukan, 結果待ち tampil, 追加資料, terima kartu baru oleh staf lalu diserahkan); staf bukan 担当 tidak melihat tombol ubah dan server menolak; LPK/sensei 404; ponsel 390 px; id + ja.
- [ ] Audit tanpa isi (dites). Tangkapan layar di PR. typecheck, build, test:rls, e2e, CI hijau.

---

### T-019 · 在留カード (C): daftar, KPI, data demo · `SIAP` (setelah T-018)

Sesuai rencana T-C:
- `/records/cards` dengan filter tahap, "milikku", perusahaan, dan "tanpa data".
- KPI `kpi-card-urgent` (H-30/H-14/H-7/lewat/`special_overdue`/`rejected`/`additional_docs`), `kpi-card-prepare`, `kpi-card-missing` (Admin), dengan nada/ikon sesuai T-012.
- `kpi-card-waiting` (結果待ち, info) boleh ditambah.
- Seed + `verify:seed` mencakup semua tahap.
- Menu "Segera hadir: 在留カード" diganti menu sungguhan.

**Kriteria selesai**
- [ ] Angka KPI = jumlah baris daftar (dites); staf melihat miliknya di "milikku", Admin melihat semua.
- [ ] Tangkapan layar daftar + dashboard (id + ja); e2e + CI hijau.

---

### T-013 · Lacak peringatan `pg` "client.query() ... already executing" · `SIAP` (setelah T-019)

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

### T-014 · Langkah 8 siap pilot: 200 siswa dummy + cek kecepatan · `SIAP` (setelah T-013)

Tujuan: membuktikan aplikasi tetap cepat dan benar dengan volume pilot, sebelum data nyata. **Hanya `db-dev`/`_test` dan (dengan izin Ipal) demo; produksi tidak disentuh.**

Kerjakan:
- `npm run seed:pilot` (skrip baru di `scripts/`, hanya impor `src/db/`; ADDITIVE, deterministik, ditolak `db-guard` di luar `_dev`/`_test`/`_demo`): +200 kandidat lengkap
  (sebaran status LPK, keputusan TSK, penilaian bulanan beberapa bulan, dokumen dummy kecil), sebagian berangkat jadi pekerja aktif dengan catatan kegiatan + wawancara berkala,
  dan **satu staf TSK dengan ≥ 45 pekerja** supaya peringatan beban T-010 terlihat. Jalankan dua kali = tidak menggandakan (idempoten).
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
- **T-020 · 在留カード: nomor + foto kartu** (jawaban TSK no. 6: harus disimpan). **DITAHAN: BUTUH IPAL** untuk kunci enkripsi.
  - Nomor dienkripsi di level aplikasi (kunci di `.env`, dicadangkan terpisah seperti kunci cadangan). Foto depan/belakang lewat pola dokumen (`sharp`, buang EXIF).
  - Baca/lihat hanya 担当 + Admin, setiap akses diaudit. Tidak masuk daftar, ekspor, PDF, maupun log.
- **T-021 · 在留カード: isi awal/massal mengikuti form imigrasi** (perorangan + grup, jawaban no. 8). DITAHAN sampai Ipal mengirim form PDF imigrasinya.
- **Email pengingat 在留カード** (jawaban no. 12: ke staf, Admin, pekerja; hanya pengingat daftar/perbarui). DITAHAN: BUTUH IPAL (layanan email berbiaya; email pekerja = data pribadi).
- Tampilan LPK: status visa + tanggal tiba (jawaban no. 9: hanya yang dibuat TSK). Setelah T-019.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- Langkah 9: demo ke TSK.

## Selesai

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
