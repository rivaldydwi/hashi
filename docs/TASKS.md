# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-014 · Langkah 8 siap pilot: 200 siswa dummy + cek kecepatan · `SIAP`

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
- Tampilan LPK: status visa + tanggal tiba (jawaban no. 9: hanya yang dibuat TSK). Setelah T-019.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- `next.config`: `agentRules: false` supaya `next dev` tidak menulis blok aturan ke `CLAUDE.md` (temuan engineer T-013).
- COE (在留資格認定証明書, termasuk form grup): ditunda atas keputusan Ipal (proses panjang).
- 在留カード lanjutan: halaman 特定技能 ("V") + 所属機関等作成用 untuk perpanjangan, menunggu contoh dari Ghulam.
- 在留カード: nomor/foto kartu LAMA setelah kartu baru diterima tetap tersimpan terenkripsi tapi tidak bisa dibuka di aplikasi (hanya kartu aktif). Perlu keputusan retensi (hapus otomatis setelah X bulan?) dengan TSK/行政書士 sebelum data nyata.
- 在留カード: PDF 手数料納付書 untuk jalur LOKET (収入印紙) hanya bila TSK masih mengajukan di loket; tunggu konfirmasi Ghulam. Opsional: teks bantuan estimasi biaya (naik per 2026-10-01) dari sumber resmi.
- Langkah 9: demo ke TSK.

## Selesai

- **T-021** Data perpanjangan 在留カード online siap salin (PR #22): halaman `/records/workers/<id>/renewal` butir 1-14 + Salin (和暦, romaji, butir kosong + tautan, peringatan paspor), nomor kartu hanya lewat "Tampilkan" ber-audit, tabel `worker_jp_profiles` (住居地 + telepon, milik TSK, migrasi 0029), audit `renewal_view`. PDF 手数料納付書 TIDAK dibuat: sejak 2026-10-01 biaya pengajuan online dibayar konbini/bank, bukan 収入印紙 (temuan engineer).
- **T-022** Email pengingat 在留カード (PR #21): `src/db/card-reminders.ts` (tahap pemicu + 追加資料, sekali per kartu×tahap×penerima lewat `card_reminder_log` hanya jalur sistem, satu ringkasan per penerima per hari, id/ja sesuai locale, tanpa nomor kartu), service `worker` di compose `hashi` (08:00 Tokyo), mode kering tanpa `SMTP_URL`, Mailpit di dev/CI, audit `residence_card.reminder_sent`. Produksi KERING sampai Ipal memilih SMTP.
- **T-020** 在留カード nomor + foto terenkripsi (PR #20): AES-256-GCM dengan AAD per kartu/foto + `key_id` (rotasi lewat `CARD_DATA_KEYS_OLD`), tabel terpisah `residence_card_secrets`/`residence_card_photos` (migrasi 0027, RLS baca+tulis hanya TSK_ADMIN + 担当), nomor tersamar + "Tampilkan" yang diaudit sebelum nilai kembali, foto terenkripsi di disk lewat route ber-audit, kartu batal = nomor/foto dibuang; aplikasi menolak start tanpa kunci; `ensure-card-key.sh`; `docs/backup.md` §7.
- **T-023** Terjemahan peramban dikoreksi (PR #19): sifat kolom `data: identity|prose` di `candidate-sections.ts` (+ `fieldNature`, tes unit), teks bebas boleh diterjemahkan, identitas/nama staf/merek dikunci; `medicalNote` dikunci (data kesehatan), `visionNote` boleh (keputusan Ipal: syarat buta warna). Uji manual Chrome oleh Ipal setelah deploy.
- **T-013** Peringatan pg "already executing" (PR #18): 116 kejadian dilacak ke `Promise.all` di atas `tx`, 16 tempat diganti `inSeries` (`src/db/serial.ts`); penjaga: server e2e mati kode 97 (`guard-pg-concurrency.cjs`) + pemindai sumber `no-tx-promise-all.test.ts`; log e2e 0 kejadian.
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
