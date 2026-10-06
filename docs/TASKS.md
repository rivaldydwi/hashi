# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-009 · Form 定期面談報告書 (参考様式第5-5号) + halaman tahunan per pekerja · `SIAP`

**Dari staf TSK:** tiap 定期面談 dilaporkan dengan form resmi imigrasi **参考様式第5-5号「定期面談報告書（1号特定技能外国人用）」**. Form ini diisi/dicetak saat
akan melapor; terpisah dari catatan harian pekerja. Ada juga "form khusus per pekerja" berisi semua 面談 dia selama 1 tahun fiskal.
Form kosongnya resmi dan publik (situs 出入国在留管理庁); unduh versi terbaru sebagai acuan tata letak (jangan commit bila lisensinya tidak jelas; cukup tautan di docs).

Isi form 5-5 (yang harus bisa dicatat per wawancara, di samping kolom yang sudah ada):
1. 面談対象者: ① nama pekerja, ② nama/sebutan 特定技能所属機関 (perusahaan penerima), ③ 面談日, ④ 方式: 対面 / オンライン.
2. 面談対応者: ① nama, ② jabatan: 支援責任者 / 支援担当者 + 役職名 (teks).
3. 面談結果: tiap butir **問題の有無 (有/無)** + **問題の内容** (teks bila 有):
   - ①業務内容: (1) tidak bekerja di luar isi kontrak, (2) tidak bekerja di bawah pemberi kerja lain, (3) bekerja dengan memperhatikan K3
   - ②待遇: (1) gaji diterima setiap bulan sesuai kontrak, (2) jam kerja sesuai kontrak, (3) libur/cuti diberikan (termasuk cuti pulang sementara),
     (4) tempat tinggal layak, (5) biaya makan/tinggal sesuai kesepakatan, (6) dukungan sesuai 支援計画 diterima
   - ③保護: (1) tidak ada kekerasan/ancaman/pengurungan, (2) tidak ada uang jaminan/kontrak denda, (3) tidak ada pengelolaan harta tidak wajar (buku tabungan dll.),
     (4) paspor dan 在留カード dipegang sendiri, (5) kebebasan pribadi tidak dibatasi
   - ④生活: (1) tidak ada masalah kehidupan sehari-hari, (2) tidak ada masalah kesehatan
   - ⑤その他: (1) tidak ada pekerja ilegal, (2) lainnya (teks bebas)
   - ⑥基準不適合等の有無: 有 / なし; ⑦その他特筆事項 (teks)
4. 基準不適合等への対応 (hanya bila ⑥ = 有): ① tanggal terjadi, ② isi, ③ hasil penanganan: ア ke pekerja (dirujuk ke instansi mana / tidak ada penanganan + alasan),
   イ ke perusahaan: (ア) pemberitahuan ke penanggung jawab (sudah: tanggal + pihak / belum + alasan), (イ) arahan ke 出入国在留管理庁 (sudah / belum),
   ウ ke instansi terkait (sudah lapor: tanggal + instansi / belum + alasan).
- Penutup: 作成年月日, 面談実施者の氏名.

Kerjakan:
- Skema: kolom/tabel tambahan untuk isi form di atas (butir checklist sebaiknya terstruktur, mis. jsonb tervalidasi zod dengan daftar kode butir TETAP di satu berkas
  konfigurasi, seperti `client-sheet.config.ts`), bukan teks bebas. Data lama tetap sah (form kosong = belum diisi).
- Form isian di halaman wawancara (bahasa UI id/ja; label butir dari konfigurasi, Jepang + terjemahan Indonesia). Bagian 4 hanya muncul bila ⑥ = 有.
- **PDF form 5-5 per wawancara** (pdfkit, tata letak mengikuti form resmi, label Jepang) + **halaman tahunan per pekerja** (FY): semua 定期面談 + daftar 面談 karena
  kejadian (② 議事録・面談記録 yang menyebut pekerja itu, terpisah dan berlabel) + tombol PDF gabungan setahun (semua form 5-5 pekerja itu).
- Audit `periodic_interview.*` / `activity_export`: jenis, kuartal, ada/tidaknya 基準不適合; TANPA isi teks atau nama.

- Deploy T-010 lewat `scripts/deploy.sh` dan catat output-nya di STATUS T-009.

**Kriteria selesai**
- [ ] Semua butir form 5-5 bisa diisi, disimpan, diedit (riwayat versi tetap jalan), dan muncul di PDF pada posisi yang sesuai; PDF diuji unit (isi teks) dan dicek manual
  di image produksi lokal (lampirkan tangkapan layar ke PR).
- [ ] Halaman tahunan per pekerja + PDF gabungan; LPK/sensei 404; `verify-rls` bagian baru.
- [ ] `docs/catatan-kegiatan.md` dan glosarium diperbarui; label id/ja lengkap.
- [ ] typecheck, test:unit, test:rls, build, e2e, CI hijau.
- [ ] Pertanyaan terbuka dicatat di STATUS sebagai `BUTUH IPAL` (lihat di bawah).

**Jawaban staf TSK (2026-10-06):** wawancara dengan atasan/監督者 **tidak** memakai form 5-6; cukup dicatat sebagai ② 議事録 (tidak ada pekerjaan tambahan).
支援責任者/支援担当者: kolom 対応者 diisi bawaan dari penanggung jawab pekerja (T-010), bisa diganti per wawancara (staf + pilihan jabatan + 役職名).

---

### T-004 · Pelacak zairyū kādo (在留カード): desain · `SIAP` (setelah T-009)

Hanya dokumen desain `docs/zairyu-card.md`, **belum ada kode atau migrasi**. Tujuannya supaya Ipal bisa menanyakan hal yang tepat ke staf TSK
sebelum skema dibuat. Bahan: `CLAUDE.md` bagian "Keputusan untuk langkah 7", model `placements`, catatan kegiatan (7A), dashboard.

Isi dokumen:
- **Data:** tabel usulan (kolom, tipe, wajib/opsional), relasi ke `candidates`/`placements`, riwayat kartu (perpanjangan berulang = baris baru, bukan menimpa).
  Kolom: tanggal habis, jenis status tinggal (在留資格), status proses perpanjangan, tanggal pengajuan ke 入管, tanggal terima kartu baru, penanggung jawab (担当).
  Nomor kartu dan foto kartu: tulis pro/kontra + rekomendasi (bawaan: TIDAK disimpan sampai terbukti perlu).
- **Hak akses:** RLS hanya TSK (pola `activity_member()` / `client_owner`), siapa boleh mengubah, tidak ada DELETE, audit tanpa isi; LPK tidak melihat apa pun
  (status visa + tanggal tiba untuk LPK adalah tugas terpisah, sebutkan batasnya saja).
- **Pengingat:** tabel tahap per tanggal (H-4 bulan persiapan, H-3 bulan bisa mengajukan, H-30, H-14, H-7, lewat; berhenti saat kartu baru diterima) sebagai
  fungsi murni (input: tanggal habis, tanggal terima, hari ini menurut zona organisasi; output: tahap). Sertakan contoh kasus tepi (tanggal sudah lewat saat
  data dimasukkan, kartu diterima sebelum habis, akhir bulan, zona Tokyo vs Jakarta).
- **Tampilan:** KPI dashboard + daftar "perlu tindakan" + bagian di detail pekerja; tidak ada email/LINE dulu (dalam aplikasi saja).
- **Rencana pemecahan** jadi 2-4 tugas implementasi kecil, masing-masing dengan kriteria selesai.
- **Pertanyaan untuk staf TSK** (bernomor, bisa langsung diteruskan Ipal), termasuk penerima pengingat (担当 + salinan Admin TSK) yang belum dikonfirmasi.

**Kriteria selesai**
- [ ] `docs/zairyu-card.md` memuat semua bagian di atas; istilah sesuai `docs/glossary.md` (tambahkan istilah baru ke glosarium).
- [ ] Tidak ada perubahan kode, skema, atau migrasi.
- [ ] Daftar pertanyaan TSK juga disalin ke STATUS dengan label `BUTUH IPAL` (untuk diteruskan ke TSK).

---

### T-011 · Tabel lebar rapi dalam bahasa Jepang · `SIAP` (setelah T-004)

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
- Pelacak 在留カード: implementasi (setelah desain T-004 disetujui).
- Langkah 8 siap pilot: seed 200 siswa dummy (sekaligus memunculkan satu staf ≥ 45 pekerja untuk tampilan beban T-010), cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- `scripts/deploy.sh`: log build ke berkas (mis. `~/hashi-backups/deploy.log`), terminal hanya ringkasan (usulan engineer, T-007).
- Catatan lanjutan: syarat "pekerja sama" hanya diperiksa saat dibuat; bila nanti perlu ketat, trigger di `activity_record_subjects` (temuan T-007, belum perlu).
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

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
