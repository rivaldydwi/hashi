# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (masukan staf TSK: T-007 s/d T-010).

---

## Antrean

### T-006 · Skrip deploy + `.gitignore` izin lokal · `SIAP`

Dari usulan T-005: perintah deploy mudah lupa `GIT_SHA`, dan `.claude/settings.local.json` belum diabaikan git.

Kerjakan:
- `scripts/deploy.sh`: hanya produksi (project compose `hashi`): menolak jalan bila working tree kotor atau bukan di `main`, `git pull --ff-only`,
  `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` (tanpa `--remove-orphans`), menunggu `/api/health` sampai `commit` = sha itu
  (batas waktu, gagal dengan kode ≠ 0 dan pesan jelas), lalu mencetak commit yang berjalan. Opsional `--backup`: jalankan `scripts/backup.sh` dulu.
- `.gitignore`: tambah `.claude/settings.local.json`.
- Catatan dari review T-003: timer cadangan menjalankan skrip dari working tree repo, jadi bila engineer sedang di branch fitur pukul 02:00, versi skrip
  branch itulah yang jalan. Cukup tulis peringatan ini di `docs/backup.md` §3 (tidak perlu mengubah mekanisme sekarang).
- README, `CLAUDE.md` (siklus engineer langkah 7 dan "Alur kerja"), `docs/HISTORY.md`: perintah deploy produksi menjadi `scripts/deploy.sh`.

**Kriteria selesai**
- [ ] Deploy produksi lewat `scripts/deploy.sh` berhasil dan mencetak commit yang sama dengan `main`; STATUS mencatat output-nya.
- [ ] Uji tolak: working tree kotor → menolak tanpa menyentuh container.
- [ ] `git check-ignore .claude/settings.local.json` → diabaikan.
- [ ] CI hijau.

---

### T-007 · Riwayat catatan per pekerja ("lanjutkan catatan") · `SIAP` (setelah T-006)

**Masukan staf TSK (Ghulam, via Ipal 2026-10-06):** catatan 業務記録/議事録 sering berlanjut ("minggu ini sampai A, minggu depan lanjut B"); staf ingin melihat
catatan sebelumnya seperti riwayat email. **Keputusan: SATU rangkaian per pekerja** (fokusnya perkara di pekerja itu), jadi tidak perlu tabel "thread" baru.

Kerjakan:
- **Halaman riwayat pekerja** (mis. `/records/workers/[candidateId]`, hanya TSK seperti rute `/records/*` lain): semua catatan ① dan ② yang menyebut pekerja itu,
  plus baris kronologi kasus (③) dan wawancara berkala (④) miliknya, urut waktu (terbaru di atas, bisa dibalik), dengan label jenis. Catatan void tetap tampil dicoret.
  Di atasnya: **tindak lanjut yang masih terbuka** untuk pekerja itu. Paginasi bila panjang.
- **Tombol "Lanjutkan"** di halaman catatan: membuka form catatan baru dengan pekerja, lokasi (配属先), dan kasus yang sama sudah terisi (ditandai `autoFilled`),
  dan di samping/atas form menampilkan ringkasan 3 catatan terakhir pekerja itu + tindak lanjut terbuka (baca saja). Simpan `continues_record_id` (opsional,
  FK ke `activity_records`, orang tua harus organisasi sama dan menyebut pekerja yang sama: trigger) supaya halaman catatan bisa menunjuk "lanjutan dari …" / "dilanjutkan oleh …".
- Tautan ke halaman riwayat dari: detail catatan (per pekerja yang disebut), detail kandidat sisi TSK, grid 定期面談.
- Catatan dengan beberapa pekerja muncul di riwayat setiap pekerja itu.

**Kriteria selesai**
- [ ] Migration kolom `continues_record_id` + trigger penjaga + bagian di `verify-rls` (LPK/sensei/TSK lain tidak bisa membaca/menautkan).
- [ ] e2e: buat catatan → "Lanjutkan" → form terisi pekerja/lokasi/kasus + ringkasan tampil → simpan → kedua catatan saling menunjuk; halaman riwayat memuat keduanya
  dan tindak lanjut terbuka. LPK dan sensei: rute 404.
- [ ] Audit: aksi baru (bila ada) di `ACTIONS` + `verify:audit-coverage`; tanpa isi catatan.
- [ ] Label id + ja (`test:i18n`), tampilan ponsel rapi; `seed:records`/`verify:seed` memuat minimal satu rangkaian lanjutan.
- [ ] typecheck, test:rls, build, e2e, CI hijau.

---

### T-008 · 定期面談 sesuai aturan kuartal + pekerja yang sudah berhenti · `SIAP` (setelah T-007)

**Aturan dari staf TSK (2026-10-06):**
- 定期面談 wajib **minimal sekali per kuartal tahun fiskal** (Apr-Jun, Jul-Sep, Okt-Des, Jan-Mar), dimulai sejak pekerja **mulai bekerja di perusahaan**. Boleh lebih sering.
- Laporan tahunan ke imigrasi per tahun fiskal (April-Maret), diserahkan setelah tahun fiskal berakhir. **Semua pekerja yang sempat bekerja di tahun fiskal itu wajib
  dilaporkan, termasuk yang berhenti di tengah tahun** (contoh: mulai Mei 2026, berhenti Jan 2027 → tetap masuk laporan FY2026). Mulai Feb 2026 → masuk FY2025.

Masalah sekarang: (1) grid menagih **tiap bulan** (bulan tanpa wawancara = "Belum"), jadi dashboard penuh tanda merah palsu; (2) grid hanya memuat penempatan ACTIVE,
jadi pekerja yang berhenti di tengah tahun hilang dari grid, padahal wajib dilaporkan.

Kerjakan:
- **Tagihan per kuartal:** kuartal "wajib" bila pekerja bekerja minimal satu hari di kuartal itu (`placements.start_date` .. `end_date`, juga ENDED). Kuartal **Selesai**
  bila ada ≥1 wawancara (status selain 未実施) bertanggal di kuartal itu; **Belum** bila kuartal sudah berjalan/lewat tanpa wawancara; kuartal depan tidak ditagih.
  Fungsi murni baru (mis. `quarterState`) + tes unit kasus tepi (mulai di tengah kuartal, berhenti di tengah kuartal, mulai Feb → hanya Q4 FY sebelumnya, pindah tahun fiskal).
  KPI dashboard "定期面談 belum dilakukan" dan `?view=pending` memakai fungsi yang SAMA (jumlah = kuartal Belum).
- **Grid:** tetap tampilkan bulan (wawancara boleh bulanan), tetapi status utama per kuartal. Baris = semua pekerja yang bekerja di FY itu (ACTIVE dan ENDED), pekerja yang berhenti
  diberi penanda "berhenti <tanggal>" dan bulan sesudah berhenti tidak ditagih.
- **Daftar laporan tahunan** per FY: pekerja yang wajib dilaporkan + jumlah wawancara per kuartal + kuartal yang bolong (untuk persiapan laporan imigrasi). Belum perlu
  membuat formulir laporan tahunan imigrasi itu sendiri.
- Data lama: wawancara per-bulan yang ada tetap sah; tidak ada data yang dihapus. Bila unique (pekerja, bulan) menghalangi lebih dari satu wawancara per bulan, biarkan dulu (catat di STATUS).

**Kriteria selesai**
- [ ] Tes unit `quarterState` (kasus tepi di atas) lulus; KPI = jumlah di daftar `?view=pending` (diperiksa `verify:seed` atau e2e).
- [ ] Pekerja ENDED di tengah FY muncul di grid FY itu dan di daftar laporan; tidak muncul di FY sesudah berhenti.
- [ ] Seed demo memuat minimal satu pekerja ENDED di tengah FY dan satu kuartal Belum.
- [ ] `docs/catatan-kegiatan.md` bagian "Wawancara berkala" diperbarui (aturan kuartal, sumber: staf TSK).
- [ ] typecheck, test:unit, test:rls, build, e2e, CI hijau.

---

### T-010 · Penanggung jawab pekerja (担当/責任者) + batas 50 pekerja per staf · `SIAP` (setelah T-008)

**Dari staf TSK (2026-10-06):** di divisi 支援部, tiap staf menjadi penanggung jawab (責任者) untuk **satu daerah atau satu/beberapa perusahaan klien**.
Mulai **April 2027** (aturan pemerintah Jepang, menurut TSK) **satu staf TSK maksimal mendukung 50 pekerja**. Penanggung jawab juga dibutuhkan untuk pengingat 在留カード (T-004)
dan sebagai bawaan kolom 対応者 di form 5-5 (T-009).

Kerjakan:
- **Data:** penanggung jawab ditetapkan **per perusahaan klien** (bawaan untuk semua pekerjanya), bisa **diganti per pekerja** (penempatan). Penanggung jawab efektif pekerja =
  pilihan per pekerja bila ada, kalau tidak dari perusahaannya. Riwayat perubahan tercatat (audit + tanggal mulai berlaku), tanpa menghapus. Hanya staf TSK organisasi sama (trigger).
  "Daerah" belum dimodelkan terpisah: cukup kelompokkan lewat perusahaan; catat di STATUS bila ternyata perlu.
- **Beban kerja:** halaman/daftar staf dengan jumlah pekerja yang didukung (penempatan ACTIVE dengan penanggung jawab efektif = staf itu). Peringatan **≥ 45** (kuning) dan
  **> 50** (merah) + KPI dashboard TSK_ADMIN "staf melebihi batas". Jangan memblokir penyimpanan (keputusan hukum; cukup peringatan jelas yang menyebut aturan April 2027).
  Batas 50 dan tanggal berlaku ditaruh di SATU konstanta konfigurasi.
- **Penggunaan:** tampil di detail pekerja sisi TSK, grid 定期面談, halaman riwayat pekerja (T-007); filter "pekerja saya".
- Pekerja tanpa penanggung jawab efektif = daftar "belum ada penanggung jawab" (KPI juga).

**Kriteria selesai**
- [ ] Migration + RLS (hanya TSK organisasi sama; LPK/sensei tidak melihat) + bagian di `verify-rls`.
- [ ] Tes unit fungsi murni "penanggung jawab efektif" dan hitungan beban (pekerja ENDED tidak dihitung; ganti per pekerja menimpa perusahaan).
- [ ] KPI = jumlah di daftar (fungsi yang sama); seed demo memuat satu staf ≥ 45 dan pekerja tanpa penanggung jawab; `verify:seed` memeriksa.
- [ ] Audit perubahan penanggung jawab (id saja, tanpa nama); label id/ja; e2e alur tetapkan per perusahaan → ganti per pekerja → angka beban berubah.
- [ ] typecheck, test:unit, test:rls, build, e2e, CI hijau.
- Definisi batas **sudah dikonfirmasi staf TSK (2026-10-06):** dihitung **per orang staf TSK yang menjadi penanggung jawab**, total semua pekerja yang dia pegang di seluruh
  Jepang dan semua klien (bukan per klien, bukan per daerah). Contoh: 30 pekerja di klien A + 20 di klien B = 50 (batas tercapai).

---

### T-009 · Form 定期面談報告書 (参考様式第5-5号) + halaman tahunan per pekerja · `SIAP` (setelah T-010)

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

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- **Cadangan luar-server** (ditunda atas keputusan Ipal; WAJIB sebelum data nyata/pilot): pilihan di `docs/backup.md` §5.
- Pelacak 在留カード: implementasi (setelah desain T-004 disetujui).
- Langkah 8 siap pilot: seed 200 siswa dummy, cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

- **T-003** Cadangan lokal terjadwal (PR #5): systemd user timer 02:00 JST (`Persistent=true`), `backup-run.sh` (log + `LAST_FAILED`), `decrypt.sh`, uji pulih
  dari set hasil jadwal cocok dengan produksi. Deploy T-005 tercatat: produksi `6a03395`. Linger belum aktif (menunggu Ipal).
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
