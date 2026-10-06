# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06.

---

## Antrean

### T-001 · Laporan kondisi Mini PC (uji coba alur kerja) · `SIAP`

Tujuan: menguji siklus PM ↔ engineer dari ujung ke ujung, dan memberi PM fakta yang hanya bisa dilihat dari server.
Tidak ada perubahan kode. Jangan mengubah apa pun di server; hanya membaca.

Isi entri pertama `docs/STATUS.md` dengan:
- Commit yang sedang berjalan di produksi (`docker compose ps`, image/commit yang dipakai; cara mengetahuinya juga ditulis) dan apakah sama dengan `main`.
- Hasil `curl -fsS http://127.0.0.1:3110/api/health` (produksi) dan port 3111 (demo), atau keterangan bila demo tidak berjalan.
- Apakah `db-dev` berjalan, dan apakah `.env` lokal menunjuk ke `_dev` (sebut NAMA database saja, jangan URL/kata sandi).
- Versi `node`, `npm`, `docker`, `docker compose`, dan apakah `gh auth status` berhasil (cukup ya/tidak + nama akun).
- Apakah Playwright Chromium sudah terpasang (bisa `test:e2e` atau tidak).
- Sisa disk (`df -h` untuk partisi Docker) dan ukuran volume `docs-data` produksi.
- Apakah ada cadangan yang sudah berjalan sekarang (cron/timer apa pun yang terkait Hashi), dan isi `~/hashi-backups/` (nama + tanggal berkas terbaru saja).
- Apakah Claude Code di VS Code bisa menjalankan `/loop` (lihat "Cara engineer berjalan otomatis" di bawah) — ya/tidak + pesan bila gagal.

**Kriteria selesai**
- [ ] PR `[T-001] Laporan kondisi Mini PC` hanya mengubah `docs/STATUS.md`.
- [ ] Semua butir di atas terjawab; yang tidak bisa dicek ditulis "tidak bisa dicek: <alasan>".
- [ ] Tidak ada secret, URL berkata sandi, atau isi `.env` di PR.

---

### T-002 · Cadangan di luar server: desain + skrip lokal · `SIAP`

Latar: catatan kegiatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi; cadangan luar-server **wajib** sebelum data nyata masuk.
Tugas ini HANYA desain + skrip yang menulis cadangan terenkripsi ke disk lokal + uji restore ke db-dev. Pengiriman ke luar server
(layanan/akun/biaya) diputuskan Ipal setelah melihat usulan ini (lihat T-003).

Kerjakan:
- `docs/backup.md`: apa yang dicadangkan (database `hashi` lewat `pg_dump -Fc`, volume `docs-data`; database dan volume demo TIDAK perlu),
  frekuensi, retensi, enkripsi, cara restore langkah demi langkah, dan **2-3 pilihan tujuan luar-server** (mis. restic/rclone ke penyimpanan
  awan, disk eksternal di lokasi lain) dengan perkiraan biaya bulanan untuk ukuran data sekarang. Rekomendasikan satu.
- `scripts/backup.sh` (dan bila perlu `scripts/restore.sh`): hanya menyentuh project compose `hashi`; tidak memakai `docker system prune` /
  `volume rm`; kunci/kata sandi enkripsi dibaca dari variabel lingkungan (nama variabelnya ditambahkan ke `.env.example` TANPA nilai); gagal
  dengan kode keluar bukan 0 dan pesan jelas; menulis checksum.
- Uji restore: cadangan produksi di-restore ke **db-dev** (database berakhiran `_dev`) + folder dokumen sementara; aplikasi dev bisa login dan
  membuka satu dokumen kandidat. Tulis langkah dan hasilnya di STATUS.
- **Belum** memasang cron/systemd timer (itu menyentuh host; masuk T-003 setelah Ipal setuju).

**Kriteria selesai**
- [ ] `docs/backup.md` lengkap dengan rekomendasi tujuan luar-server + perkiraan biaya.
- [ ] Skrip berjalan di Mini PC, menghasilkan berkas terenkripsi + checksum; berkas cadangan TIDAK ada di repo (cek `.gitignore`).
- [ ] Uji restore ke db-dev berhasil dan didokumentasikan (perintah + hasil).
- [ ] README bagian backup merujuk ke `docs/backup.md`.
- [ ] CI hijau.

---

### T-003 · Cadangan luar-server: pasang jadwal dan tujuan · `DITAHAN`

Menunggu Ipal memilih tujuan dari usulan T-002 (akun, biaya, kunci enkripsi disimpan di mana). Rincian dan kriteria ditulis PM setelah itu.

---

### T-004 · Pelacak zairyū kādo (在留カード): desain · `DITAHAN`

Menunggu T-002 selesai. Bentuknya: dokumen desain dulu (`docs/zairyu-card.md`), BELUM kode: tabel + RLS (hanya TSK), kolom yang disimpan (tanggal
habis, status perpanjangan, tanggal pengajuan ke 入管, tanggal terima kartu baru; nomor kartu perlu tidaknya dipertanyakan), penanggung jawab (担当)
per pekerja, jadwal pengingat dari `CLAUDE.md` (persiapan H-4 bulan, pengajuan mulai H-3 bulan, H-30/H-14/H-7, lewat; berhenti saat kartu baru
diterima), tampilan dashboard, dan daftar pertanyaan untuk staf TSK. Rincian ditulis PM saat dibuka.

---

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- Pelacak 在留カード: implementasi (setelah desain T-004 disetujui).
- Langkah 8 siap pilot: seed 200 siswa dummy, cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

- (belum ada)

---

## Cara engineer berjalan otomatis (catatan untuk Ipal)

Engineer hanya bekerja saat sesinya hidup. Supaya Ipal tidak perlu mengetik apa-apa setiap ada tugas, buka sesi Claude Code di VS Code
di folder repo ini sekali, lalu ketik:

```
/loop 30m Jalankan satu putaran siklus engineer sesuai CLAUDE.md bagian "Peran dan aturan kerja".
```

VS Code dan Mini PC harus tetap menyala. PM memeriksa repo secara berkala dari sisi cloud.
