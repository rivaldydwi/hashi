# Daftar periksa sebelum data nyata masuk (langkah 8, T-014)

Tujuan: tidak ada data pribadi nyata (siswa LPK, pekerja, kartu izin tinggal) masuk ke Hashi sebelum semua butir di bawah **Wajib** terpenuhi. Dokumen ini hanya daftar periksa: tidak mengubah `.env` atau data.
Setiap butir punya **cara memeriksa** (perintah baca-saja bila ada) dan **siapa**. Centang di salinan lokal saat dikerjakan; catat hasilnya di `docs/STATUS.md` (engineer) atau komentar PR.

Keterangan: **E** = engineer, **I** = Ipal, **P** = PM, **T** = staf TSK, **G** = 行政書士 (pihak luar).
Perintah memakai project compose `hashi` (produksi) dan hanya MEMBACA. Jangan menjalankan `seed`/`test:*` di produksi.

## A. Cadangan dan pemulihan (Wajib)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| A1 | Cadangan lokal terjadwal berjalan dan terbaru (< 24 jam) | `ls -t ~/hashi-backups \| head -4` (manifest + `-db.dump.gpg` + `-docs.tar.gpg` + `.sha256`); timer: `systemctl --user list-timers \| grep hashi` (`docs/backup.md` bagian 3) | E |
| A2 | **Cadangan di luar server berjalan** (disk lain / cloud) dan salinannya bisa dibaca | Lihat `docs/backup.md` bagian 5; periksa berkas terbaru ada di tujuan luar dan checksum cocok (`sha256sum -c`) | I + E |
| A3 | **Uji pemulihan sukses** ke db-dev (bukan produksi) dari cadangan terbaru, termasuk `docs-data` | `docs/backup.md` bagian 4a; bukti: jumlah baris + satu dokumen terbuka | E |
| A4 | Kata sandi cadangan (`HASHI_BACKUP_PASSPHRASE`) tersimpan di pengelola kata sandi, TERPISAH dari server | Ipal membuka salinan di pengelola kata sandi dan mencocokkan 4 karakter pertama (jangan menempel penuh ke chat) | I |
| A5 | **`CARD_DATA_KEY` tersalin di luar server** dan Ipal mengonfirmasi (tanpa kunci, nomor/foto kartu tidak bisa dipulihkan) | `docs/backup.md` bagian 7; Ipal menulis konfirmasi di komentar PR/STATUS (nilai kunci TIDAK ditulis) | I |
| A6 | Rencana pemulihan produksi dipahami (siapa, langkah, izin Ipal) | `docs/backup.md` bagian 4b dibaca ulang; simulasi di db-dev dicatat | E + I |

## B. Akun dan akses (Wajib)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| B1 | `SHOW_DEMO_ACCOUNTS=false` di produksi | `docker compose -p hashi exec app printenv SHOW_DEMO_ACCOUNTS` (harus `false`); halaman login tidak menampilkan akun demo | E |
| B2 | Tidak ada akun demo (`*@hashi.test`) di produksi | `docker compose -p hashi exec -T db psql -U hashi_owner -d hashi -tAc "select count(*) from users where email like '%@hashi.test'"` → `0` | E |
| B3 | Kata sandi semua akun nyata BUKAN bawaan (`hashi-demo-2026`, kata sandi sementara pembuatan akun) dan `must_change_password` sudah dijalankan | `select email, must_change_password from users` (tidak ada yang `true` untuk akun aktif lama); akun baru wajib ganti saat masuk pertama | E + T |
| B4 | Super admin: hanya satu atau dua orang tepercaya, kata sandi kuat | `select email, role from users where role = 'SUPER_ADMIN'` | I |
| B5 | Peran tiap staf benar (Admin hanya yang berhak; Admin TSK ≥ 2 orang agar ada cadangan untuk 担当) | halaman Pengguna; cocokkan dengan daftar staf TSK/LPK | T + I |
| B6 | Produksi TIDAK terbuka ke internet (hanya Tailscale/jaringan internal); demo hanya data dummy | `ss -ltnp \| grep 3110` (bind 127.0.0.1 atau alamat Tailscale); tidak ada Funnel untuk produksi (`tailscale funnel status`) | E + I |

## C. Data dummy tidak ada di produksi (Wajib)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| C1 | Tidak ada organisasi dummy (`TSK Demo Tokyo`, `LPK Demo ...`, `LPK Non-Mitra Medan`, `Hashi Platform` bila bukan platform nyata) | `select name from organizations` | E |
| C2 | Tidak ada kandidat/pekerja pilot atau seed | `select count(*) from candidates` sama dengan jumlah data nyata yang dimasukkan sengaja (awal = 0); `seed:pilot` dan `db:seed` TIDAK pernah dijalankan di produksi (db-guard menolak; lihat `scripts/db-guard.ts`) | E |
| C3 | Volume `docs-data` produksi tidak berisi berkas dummy | `docker run --rm -v hashi_docs-data:/d:ro alpine sh -c 'find /d -type f \| wc -l'` sesuai jumlah dokumen nyata | E |
| C4 | `.env` produksi tidak memuat `SEED_PASSWORD` yang dipakai demo dan URL database mengarah ke `hashi` | Ipal/engineer membaca `.env` secara lokal (jangan tempel nilai ke chat/log/git) | I |

## D. Hukum dan data pribadi (Wajib; menunggu pihak luar)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| D1 | **行政書士 mengonfirmasi** syarat gender pada dokumen yang dibagikan ke klien (lembar klien mode `share`) | Jawaban tertulis G; catat di `docs/lembar-klien.md` | G + I |
| D2 | **My Number**: keputusan disimpan atau TIDAK (bila disimpan: enkripsi, hanya Admin, audit; lihat CLAUDE.md "Keputusan untuk langkah 7") | Keputusan tertulis; bila "tidak disimpan", pastikan tidak ada kolomnya | G + I |
| D3 | Dasar persetujuan siswa untuk berbagi data ke TSK (`shared_with_tsk`) dan penyimpanan nomor/foto kartu: formulir persetujuan siswa disepakati LPK | Contoh formulir + kebijakan privasi (UU PDP Indonesia, APPI Jepang) ditinjau G/penasihat hukum | I + G |
| D4 | **Retensi**: catatan kegiatan 5 tahun tidak bisa dihapus lewat aplikasi; kebijakan hapus/anonimkan setelah masa simpan dan permintaan subjek data diputuskan. Termasuk retensi nomor/foto kartu yang sudah `received` | Keputusan tertulis (cadangan TASKS: retensi kartu `received`) | I + G |
| D5 | Catatan penilaian/kesehatan tidak memuat data medis (aturan teks bantuan di form); `medicalNote` dikunci dari terjemahan peramban | Pelatihan singkat staf + `tests/e2e/translate-data.spec.ts` hijau di CI | T + E |

## E. Isi formulir dan format (Wajib sebelum dipakai sungguhan)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| E1 | **Form 5-5**: kalimat butir (status DRAFT) dicek staf TSK terhadap form resmi terbaru | Staf TSK membuka PDF contoh (`/records/export/form55/...`) dan membandingkan; catat koreksi (`src/db/form55.ts`) | T |
| E2 | **Lembar klien PDF** (format DRAFT) dikoreksi staf TSK | PDF contoh dari `/sheet/company/<id>` dan `/sheet/job-order/<id>` ditinjau | T |
| E3 | **Data perpanjangan online** (butir 1-14; label dan templat alasan) dicek staf TSK, dan keputusan loket vs online | Halaman `/records/workers/<id>/renewal` ditinjau; konfirmasi apakah loket masih dipakai (PDF 手数料納付書 hanya untuk loket) | T + P |
| E4 | **Jadwal pengingat kartu** (persiapan 4 bulan, 3 bulan, H-30/14/7, 特例期間) sesuai kebiasaan TSK | `docs/zairyu-card.md`; konfirmasi tertulis staf TSK | T |
| E5 | Daftar bidang kerja (`skill_fields`) dan opsi 在留期間 (4/6/12 bulan) benar | Halaman super admin `/admin/skill-fields`; `PERIOD_OPTIONS` di `src/db/zairyu.ts` | T + E |

## F. Email pengingat (Wajib bila pengingat email ingin dipakai)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| F1 | Layanan SMTP dipilih, domain pengirim diverifikasi (SPF/DKIM) | Pilihan di STATUS T-022; uji kirim ke satu alamat | I |
| F2 | `SMTP_URL`, `MAIL_FROM`, `APP_URL` terisi HANYA di `.env` server (panduan: `docs/email.md`); service `worker` dimulai ulang | `docker compose -p hashi logs worker --tail=5` menampilkan `mode=kirim` (bukan `KERING`) | E |
| F0 | **Buat SMTP key Brevo BARU dan hapus yang lama** sebelum launch (key lama pernah dibagikan di chat, anggap bocor); `.env` server mode 600 | Brevo → SMTP keys: key lama tidak ada; `stat -c %a .env` = `600`; kirim uji `--test-to` berhasil dengan key baru (`docs/email.md` bagian 4) | I + E |
| F1b | Pengirim memakai **domain sendiri** dengan SPF + DKIM (+ DMARC); pengirim Gmail hanya untuk demo | Brevo → Senders/Domains: status terverifikasi; kirim uji ke Gmail, Outlook, dan alamat TSK: masuk kotak masuk, bukan spam | I |
| F1c | Ada akun staf TSK NYATA (pengaman penerima melewati alamat contoh/demo, jadi tanpa akun nyata tidak ada email keluar) | `docker compose -p hashi exec -T worker node --import tsx scripts/reminder-worker.ts --check` → "akan dikirimi" > 0 | I + E |
| F3 | Email uji ke 担当 + Admin diterima dengan bahasa benar dan tanpa nomor kartu | Satu pekerja uji, jalankan satu putaran; hapus data uji sesudahnya | E + T |

## G. Operasional (Wajib)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| G1 | Health dan commit sesuai `main`; semua service sehat | `curl -s http://127.0.0.1:3110/api/health`; `docker compose -p hashi ps` | E |
| G2 | Ruang disk cukup untuk `docs-data` (proyeksi ±3 GB tahun pertama) dan cadangan | `df -h /` dan `docker system df` (hanya melihat) | E |
| G3 | Waktu server dan zona benar (jam 08:00 Asia/Tokyo untuk worker) | `date`; log worker menampilkan "putaran berikutnya ... 08:00 Asia/Tokyo" | E |
| G4 | Layanan lain di OptiPlex tidak terganggu (Actual Budget, OpenClaw, monitoring, micro-habit) | Periksa layanan masing-masing sesudah deploy | E |
| G5 | Prosedur deploy dan kembali ke versi lama dipahami | `scripts/deploy.sh --backup`; kembali: checkout commit sebelumnya + deploy (atau pulihkan cadangan dengan izin Ipal) | E |

## H. Kinerja dengan volume pilot (Wajib; bukti di STATUS T-014)

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| H1 | Dengan 200+ kandidat dan 70+ pekerja, tiap halaman utama selesai ≤ 1 detik di OptiPlex | Di db-dev: `npm run db:seed -- --reset && npm run seed:pilot && npm run verify:pilot`, lalu `npm run build && E2E_PORT=3120 npm run perf:pages` (tabel median + terburuk) | E |
| H2 | Angka KPI = daftar tetap benar pada volume pilot | `npm run verify:pilot` (kartu KPI kandidat dan kartu izin tinggal) | E |
| H3 | Peringatan beban staf terlihat (staf ≥ 45 pekerja = kuning) | Halaman `/records/responsible` setelah `seed:pilot` | T |
| H4 | Ulangi pengukuran bila jumlah data nyata melewati pilot (mis. > 500 kandidat) | `npm run perf:pages` terhadap salinan data (db-dev) | E |

## I. Persiapan hari pertama

| # | Butir | Cara memeriksa | Siapa |
|---|---|---|---|
| I1 | Akun staf nyata dibuat (peran benar, bahasa benar, kata sandi sementara disampaikan aman) | Halaman Pengguna | I + T |
| I2 | Pelatihan singkat: berbagi data hanya dengan persetujuan siswa; jangan menulis nomor kartu atau data medis di catatan; cara memakai Salin; cara menghubungi bila ada masalah | Daftar hadir/catatan pelatihan | T + I |
| I3 | Siapa yang dihubungi bila ada masalah (engineer/PM/Ipal) dan jam responsnya disepakati | Catatan singkat | I |
| I4 | Mulai dengan data kecil (1 LPK, ≤ 10 siswa) lalu perluas bertahap | Jadwal peluncuran | I + T |
