# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (keputusan Ipal soal cadangan).

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

### T-003 · Cadangan lokal terjadwal · `SIAP` (setelah T-005)

**Keputusan Ipal (2026-10-06):** untuk sekarang cadangan **lokal saja** (belum ada tujuan luar-server, akun, maupun biaya). Ipal **mengizinkan** memasang
jadwal di host untuk Hashi. Salinan luar-server ditunda sampai proyek siap dipakai sungguhan; itu tetap syarat sebelum data nyata (lihat Cadangan di bawah).

Kerjakan:
- **Kunci:** buat `HASHI_BACKUP_PASSPHRASE` acak (`openssl rand -hex 24`) di berkas di luar repo, mis. `~/.config/hashi/backup.env`, mode 600, folder 700.
  Jangan pernah mencetak nilainya ke log, STATUS, PR, atau terminal yang tersimpan. Di STATUS cukup tulis LOKASI berkasnya (Ipal disarankan menyalinnya sendiri
  ke tempat lain; tulis caranya, bukan kuncinya).
- **Jadwal:** harian pukul 02:00 waktu Mini PC, menjalankan `scripts/backup.sh` dengan `HASHI_BACKUP_KEEP=14`. Pilih systemd **user** timer (`Persistent=true`,
  supaya jadwal yang terlewat karena PC mati tetap jalan saat menyala) atau cron; tulis alasannya. Hanya entri milik Hashi; jangan ubah jadwal/layanan lain.
  Unit/skrip pembungkus disimpan di repo (mis. `scripts/systemd/hashi-backup.{service,timer}` + cara pasang), jadi bisa dipasang ulang.
- **Log dan kegagalan:** keluaran tiap putaran ke `~/hashi-backups/backup.log` (berputar/terbatas ukurannya), dan gagal harus kelihatan: mis. berkas
  `~/hashi-backups/LAST_FAILED` berisi waktu + pesan singkat, dihapus saat berhasil. (Pemberitahuan ke luar ditunda.)
- **Retensi dump manual lama** (`pre-*-*.dump`): JANGAN dihapus di tugas ini.
- `docs/backup.md`: perbarui status (jadwal lokal aktif; luar-server ditunda atas keputusan Ipal, risikonya: disk rusak = cadangan ikut hilang), cara pasang/
  copot jadwal, dan perbaiki §4b langkah 3 (`decrypt` adalah fungsi skrip; tulis perintah `gpg` lengkap atau buat `scripts/decrypt.sh`).

**Kriteria selesai**
- [ ] Timer/cron terpasang; dipicu sekali secara manual (mis. `systemctl --user start hashi-backup.service`) dan menghasilkan set cadangan baru + log.
- [ ] Set hasil jadwal itu dipulihkan ke db-dev dengan `scripts/restore.sh` (hitungan cocok dengan produksi), lalu database/folder uji dibuang.
- [ ] Kegagalan disimulasikan (mis. kunci kosong di salinan berkas env sementara) → `LAST_FAILED` muncul, log menjelaskan; lalu kembali normal.
- [ ] Tidak ada kunci di repo/log/PR; `git ls-files` tanpa `.gpg`/`.dump`/`backup.env`.
- [ ] STATUS mencatat: jenis jadwal, waktu putaran berikutnya, lokasi berkas kunci, dan cara Ipal menyalin kuncinya.
- [ ] CI hijau.

---

### T-004 · Pelacak zairyū kādo (在留カード): desain · `SIAP` (setelah T-003)

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
