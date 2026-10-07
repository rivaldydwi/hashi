# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-012 · Variasi kartu KPI di dashboard · `SIAP`

Masukan Ipal (2026-10-06): kartu KPI dashboard (`Kpi` di `src/features/dashboard/Widgets.tsx`) terlihat sama semua (putih, angka besar hitam), jadi sulit dipindai.

Kerjakan:
- Tambah **nada (tone)** per KPI di katalog (`src/db/dashboard-catalog.ts`), mis. `neutral` / `info` / `attention`, dan **ikon** per KPI (gaya ikon yang sudah dipakai di app, mis. di `StatusBadge`).
- Nada **mengikuti makna dan nilai**: KPI "perlu tindakan" (未実施の定期面談, 未完了のフォローアップ, 未読の記録, 判断待ち, beban staf merah, dsb.) memakai warna perhatian HANYA bila nilainya > 0;
  bila 0, tampil tenang (mis. teks "beres" / ikon centang). KPI informasi (配属中, 募集中の求人, kandidat baru dibagikan) memakai aksen netral/info.
- Warna dari token di `globals.css` (`@theme`), tambah token baru bila perlu; kontras teks minimal WCAG AA; warna tidak boleh satu-satunya pembeda (ada ikon/teks).
- Tetap satu komponen `Kpi`; tata letak, ukuran, dan mode atur (`/?atur=1`) tidak berubah. Berlaku untuk semua peran (LPK dan TSK).

**Kriteria selesai**
- [ ] Setiap KPI di katalog punya nada + ikon (diperiksa tes unit: tidak ada KPI tanpa nada/ikon).
- [ ] KPI tindakan bernilai 0 tampil tenang, bernilai > 0 tampil perhatian (tes e2e atau unit pada fungsi pemilih nada).
- [ ] Tangkapan layar dashboard LPK_ADMIN dan TSK_ADMIN (ja dan id, desktop + ponsel) di PR.
- [ ] `typecheck`, `build`, `test:e2e` hijau.

---

### T-016 · Cegah terjemahan otomatis browser merusak teks · `SIAP` (setelah T-012)

Temuan Ipal (2026-10-07): di bahasa Indonesia, menu "Kandidat" tampil sebagai **"Kandosat"**, "Konstruksi" jadi "Kon struksi", tombol bahasa "Jepang" jadi "Japanese", tanggal jadi
"7 October", dan nama katakana diubah ke huruf Latin yang salah ("Djokovic Pratama"). Teks ini **tidak ada** di `messages/`, jadi penyebabnya fitur terjemahan otomatis browser (Chrome/Google
Translate), yang terpicu karena halaman memuat banyak huruf Jepang (katakana nama). Akibatnya pengguna bisa salah baca **data**, misalnya nama dan bidang kerja, bukan hanya label.

Kerjakan:
- `src/app/layout.tsx`: `<html translate="no">` + `<meta name="google" content="notranslate">` (semua halaman, termasuk login). `lang` tetap mengikuti bahasa UI.
- Teks Jepang di dalam halaman bahasa Indonesia (nama katakana, istilah Jepang) sudah ditandai `lang="ja"` di tempat yang relevan. Cek daftar kandidat, detail, dan catatan kegiatan, supaya pembaca
  layar dan font benar.

**Kriteria selesai**
- [ ] Tes e2e: `html` punya `translate="no"` dan meta `notranslate` ada (halaman login + satu halaman dalam aplikasi).
- [ ] Kalimat singkat di `docs/glossary.md` atau README: aplikasi sengaja menolak terjemahan otomatis; bahasa diganti lewat tombol bahasa.
- [ ] typecheck, build, e2e, CI hijau.

---

### T-013 · Lacak peringatan `pg` "client.query() ... already executing" · `SIAP` (setelah T-012)

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
- Pelacak 在留カード: implementasi = T-A (skema + `cardStage` + RLS), T-B (bagian di detail pekerja), T-C (daftar, KPI, seed), T-D opsional (isi awal), persis seperti `docs/zairyu-card.md` §6. **DITAHAN** sampai TSK menjawab pertanyaan §9 no. 1, 2, 4, 5, 7 (memengaruhi skema); PM memindahkannya ke antrean setelah jawaban masuk.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- Langkah 9: demo ke TSK.

## Selesai

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
