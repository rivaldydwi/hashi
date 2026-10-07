# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-011 · Tabel lebar rapi dalam bahasa Jepang · `SIAP`

Masukan Ipal (2026-10-06, tangkapan layar `/records/interviews` dalam bahasa Jepang): kolom sempit membuat teks Jepang patah **per huruf** dan
menjadi menurun (header `特定技能分野` dan `配属先企業名` tersusun vertikal, nama perusahaan `さくらフーズ株式会社` satu huruf per baris), sehingga satu baris setinggi
setengah layar. Teks Jepang tidak punya spasi, jadi browser bebas memotong di mana saja.

Kerjakan:
- **Grid 定期面談** (`src/app/(app)/records/interviews/page.tsx`): lebar minimum per kolom (atau `table-layout` + `<colgroup>`), header dan nilai pendek
  (bidang, tanggal, telepon, bulan) tidak boleh patah (`whitespace-nowrap` / `break-keep`), kolom nama menempel di kiri saat digulir horizontal. Usulan yang boleh dipilih
  engineer: gabungkan data perusahaan (企業名, 住所, 電話, 担当者) menjadi satu sel "配属先" bertingkat supaya tabel tidak terlalu lebar; jelaskan pilihannya di PR.
- **Sisir tabel lain** yang punya masalah sama dalam bahasa Jepang (minimal: daftar kandidat, `/records/interviews/annual`, `/records/responsible`, daftar job order, klien,
  pengguna, riwayat aktivitas). Perbaiki dengan pola yang SAMA (utilitas/kelas bersama, bukan tambalan per halaman). Tampilan kartu di ponsel tetap berfungsi.
- Bahasa Indonesia tidak boleh jadi lebih buruk.

**Kriteria selesai**
- [ ] Di lebar 1280 px dan 1440 px, bahasa Jepang: tidak ada header atau nilai pendek yang patah per huruf; tinggi baris grid 定期面談 dengan data seed ≤ ~3 baris teks.
- [ ] Tangkapan layar sebelum/sesudah (ja, 1280 px) untuk grid 定期面談 dan setiap tabel lain yang diubah dilampirkan di PR; satu tangkapan id dan satu ponsel (390 px).
- [ ] Tes e2e: minimal satu cek bahwa sel header grid 定期面談 dalam ja tidak lebih tinggi dari ~2 baris (mis. `boundingBox().height`), supaya tidak mundur lagi.
- [ ] `typecheck`, `build` (0 peringatan), `test:e2e` hijau.

---

### T-012 · Variasi kartu KPI di dashboard · `SIAP` (setelah T-011)

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

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- **Cadangan luar-server** (ditunda atas keputusan Ipal; WAJIB sebelum data nyata/pilot): pilihan di `docs/backup.md` §5.
- Pelacak 在留カード: implementasi = T-A (skema + `cardStage` + RLS), T-B (bagian di detail pekerja), T-C (daftar, KPI, seed), T-D opsional (isi awal), persis seperti `docs/zairyu-card.md` §6. **DITAHAN** sampai TSK menjawab pertanyaan §9 no. 1, 2, 4, 5, 7 (memengaruhi skema); PM memindahkannya ke antrean setelah jawaban masuk.
- Langkah 8 siap pilot: seed 200 siswa dummy (sekaligus memunculkan satu staf ≥ 45 pekerja untuk tampilan beban T-010), cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- `scripts/deploy.sh`: log build ke berkas (mis. `~/hashi-backups/deploy.log`), terminal hanya ringkasan (usulan engineer, T-007).
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

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
