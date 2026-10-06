# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (setelah review T-002).

---

## Antrean

### T-005 · Commit yang berjalan bisa dibaca langsung · `SIAP`

Dari usulan T-001: saat ini commit produksi hanya bisa ditebak dari waktu build image.

Kerjakan:
- Build image menerima build-arg `GIT_SHA` (bawaan `unknown`) dan menulisnya ke `LABEL org.opencontainers.image.revision` serta env aplikasi.
  `compose.yaml` meneruskannya (mis. `GIT_SHA: ${GIT_SHA:-unknown}`); perintah deploy di README/CLAUDE.md menjadi
  `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` (berlaku juga untuk `dc up` demo di `scripts/demo-lib.sh`).
- `/api/health` mengembalikan `{"status":"ok","commit":"<sha pendek>"}`. Tidak ada informasi lain (tanpa versi paket, env, atau nama host).
- Footer UI: ganti `common.version` "Hashi v0.2" menjadi versi yang tidak basi (mis. "Hashi" + sha pendek), id dan ja.
- Job `docker` di CI: build dengan `GIT_SHA` dan periksa label image berisi sha tersebut.

**Kriteria selesai**
- [ ] `docker image inspect` menunjukkan label revision = commit yang dibangun; `/api/health` memuat `commit`.
- [ ] Tanpa `GIT_SHA`, build tetap berhasil (`unknown`), tidak gagal.
- [ ] Deploy dilakukan setelah merge, dan STATUS mencatat output `/api/health` produksi beserta commit-nya.
- [ ] typecheck, test:i18n, build, CI hijau.

---

### T-003 · Cadangan luar-server: pasang jadwal dan tujuan · `DITAHAN`

Menunggu Ipal: pilihan tujuan (A restic → B2 direkomendasikan di `docs/backup.md` §5), akun + pembayaran, tempat menyimpan `HASHI_BACKUP_PASSPHRASE`
(dan kunci restic) di luar server, serta izin memasang alat + jadwal di host. Rincian ditulis PM setelah itu. Sudah pasti masuk lingkup:
- jadwal harian `backup.sh` (`HASHI_BACKUP_KEEP=14`) + pengiriman ke luar server + retensi 30/12/5;
- peringatan bila cadangan gagal/terlambat;
- uji pulih penuh dari salinan luar-server memakai kunci dari pengelola kata sandi;
- perbaiki `docs/backup.md` §4b langkah 3: `decrypt` adalah fungsi di dalam skrip, bukan perintah; tulis perintah `gpg` lengkapnya (atau sediakan `scripts/decrypt.sh`).

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
