# Hashi 橋

Sistem profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Satu profil kandidat, dipakai bersama oleh LPK dan TSK mitranya, tanpa ketik ulang.

> Status (Oktober 2026): langkah 1-6 spesifikasi MVP selesai dan langkah 7A (catatan kegiatan TSK) selesai.
> Sudah ada: fondasi (login, dua bahasa, isolasi data RLS), organisasi/pengguna/kemitraan, profil kandidat lengkap, penilaian LPK dan TSK,
> klien (配属先) + job order + penempatan, lembar klien PDF (format DRAFT), catatan kegiatan TSK, dashboard yang bisa diatur, dan riwayat aktivitas.
> Berikutnya: cadangan di luar server (wajib sebelum data nyata), pelacak 在留カード, lalu siap pilot. Antrean: [docs/TASKS.md](docs/TASKS.md);
> laporan terbaru: [docs/STATUS.md](docs/STATUS.md); riwayat dan keputusan teknis: [docs/HISTORY.md](docs/HISTORY.md).

## Fitur saat ini

| Siapa | Bisa apa |
| --- | --- |
| **Super admin** | Menambah LPK/TSK beserta admin pertamanya, mengubah data organisasi, mengelola pengguna di organisasi mana pun, membuat dan menonaktifkan kemitraan LPK–TSK |
| **Admin LPK / TSK** | Menambah staf (sensei / staf TSK), mengubah nama, peran, bahasa, membuat kata sandi sementara baru, menonaktifkan / mengaktifkan kembali |
| **Admin LPK** (kandidat) | Menambah kandidat lewat **satu form lengkap** (semua bagian dalam satu halaman, hanya nama, jenis kelamin, tanggal lahir, dan bidang yang wajib; bagian berulang bisa ditambah/dihapus barisnya; nyaman di ponsel; isian tidak hilang saat ada error), melengkapi atau mengubah data per bagian di halaman detail, mengunggah/menghapus dokumen, mengubah status di LPK, dan **mengatur berbagi ke TSK mitra** (bawaan: tidak dibagikan; mengaktifkan butuh konfirmasi "siswa sudah setuju"; mematikannya membuat TSK langsung tidak bisa melihat kandidatnya lagi) |
| **Sensei** | Melihat daftar dan data dasar kandidat saja (tanpa data sensitif dan dokumen) |
| **Admin / staf TSK** | Melihat kandidat LPK mitra yang **dibagikan** ke TSK, mengunduh dokumen, mengambil keputusan dan menulis catatan; mengedit data hanya setelah keputusan *Lulus interview client* atau sesudahnya |
| **Admin / staf TSK** (klien dan job order) | Mengelola **klien** (法人 → lokasi 事業所 → PIC, beserta bidang kerja yang diterima lokasi), membuat **job order** (求人) dan melihat **kandidat cocok** (bidang sama, syarat bahasa/gender ditandai hijau/merah, urut nilai terbaru), menekan **Ajukan**, memantau terisi/ditutup, dan mengisi **tanggal mulai kerja (就労開始日)** penempatan. Hapus permanen klien/lokasi/PIC/job order: hanya **Admin TSK** |
| **Super admin** (bidang kerja) | Mengelola master **bidang kerja** (`skill_fields`): menambah, mengubah nama, menonaktifkan; yang sudah dipakai tidak bisa dihapus |
| **Admin / staf TSK** (catatan kegiatan) | Catatan kerja harian, notulen dan catatan wawancara, kronologi kasus (PDF internal dan versi klien), wawancara berkala, tugas tindak lanjut, laporan harian, foto. Tidak bisa dihapus (salah = dibatalkan + alasan). Lihat [docs/catatan-kegiatan.md](docs/catatan-kegiatan.md) |
| **Admin / staf TSK** (lembar klien) | Ekspor PDF profil klien dan lembar job order berbahasa Jepang, mode internal atau untuk dibagikan. Lihat [docs/lembar-klien.md](docs/lembar-klien.md) |
| **Admin LPK / TSK** (riwayat) | Riwayat aktivitas organisasi di `/activity` (tidak bisa diubah/dihapus), ekspor CSV |
| **Semua pengguna** | Login, ganti bahasa, ganti kata sandi di *Akun saya* |
| **Semua pengguna** | Dashboard per peran yang bisa diatur (urutan, ukuran, sembunyikan widget) |

Cara kerja akun baru:

1. Admin menambah pengguna → sistem membuat **kata sandi sementara** (tampil sekali, contoh `k7Qm-3xPa-9Tzw`)
2. Admin memberikannya ke pengguna lewat jalur aman
3. Saat login pertama, pengguna **wajib** membuat kata sandi sendiri sebelum bisa memakai aplikasi

Pengaman bawaan: admin tidak bisa menonaktifkan / mengubah peran dirinya sendiri, organisasi selalu punya
minimal satu admin aktif, reset kata sandi langsung mengeluarkan pengguna dari semua sesi, dan pengguna
nonaktif langsung tidak bisa masuk (dicek setiap request, tidak menunggu sesi habis). Semua perubahan
tercatat di audit log.

## Merek

Logo, ikon, dan aturan pakainya ada di [docs/brand.md](docs/brand.md). Aset turunan dibangun dengan `npm run build:brand` dari `design/brand-source/`.

## Catatan kegiatan (langkah 7A)

Fitur khusus staf TSK: catatan kerja harian, notulen pertemuan, kronologi kasus (PDF untuk klien), wawancara berkala, tugas tindak lanjut, laporan harian ke leader, foto. Dokumentasi: [docs/catatan-kegiatan.md](docs/catatan-kegiatan.md).
Data demo tanpa reseed: `npm run seed:records`. **Catatan disimpan 5 tahun dan tidak bisa dihapus lewat aplikasi: cadangan di luar server wajib sebelum data nyata masuk.**

## Lembar klien (langkah 6)

Ekspor PDF berbahasa Jepang untuk klien dan job order (profil klien, lembar job order; mode internal / untuk dibagikan; label Jepang atau Jepang + Indonesia). Format masih DRAFT sampai dikonfirmasi TSK; semua label dan urutan bagian ada di
`src/lib/pdf/client-sheet.config.ts`. Dokumentasi: [docs/lembar-klien.md](docs/lembar-klien.md). Data demo tanpa reseed: `npm run seed:client-sheet`.

## Cara kerja tim

Ipal (pemilik) memutuskan; **PM** (sesi Claude di claude.ai/code) menulis tugas di [docs/TASKS.md](docs/TASKS.md) dan me-review PR;
**engineer** (Claude Code di VS Code, Mini PC) mengerjakan tugas di branch `eng/<ID>-…`, melapor di [docs/STATUS.md](docs/STATUS.md),
dan merge setelah PM menulis `PM: DISETUJUI` di PR. Aturan lengkap: `CLAUDE.md` bagian "Peran dan aturan kerja".

## Stack

| Bagian | Teknologi |
| --- | --- |
| Aplikasi | Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Isolasi data | PostgreSQL Row-Level Security (RLS) |
| Login | Auth.js v5 (email + kata sandi, sesi JWT 8 jam) |
| Bahasa | next-intl (Indonesia / 日本語) |
| Deploy | Docker Compose (OptiPlex) |

## Menjalankan di OptiPlex

Butuh: Docker + Docker Compose, git.

```bash
git clone git@github.com:rivaldydwi/hashi.git ~/hashi
cd ~/hashi

# 1. Buat file .env dan isi secret acak
cp .env.example .env
sed -i "s/^DB_OWNER_PASSWORD=.*/DB_OWNER_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^DB_APP_PASSWORD=.*/DB_APP_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/" .env

# 2. Build dan jalankan (migration otomatis jalan lebih dulu)
docker compose up -d --build

# 3. Isi data demo (sekali saja)
docker compose run --rm migrate npm run db:seed

# 4. Verifikasi produksi: cek kesehatan aplikasi (test:rls TIDAK dijalankan di produksi, lihat bagian Pengujian)
curl -fsS http://127.0.0.1:3110/api/health
```

Buka `http://<IP-OptiPlex-atau-Tailscale>:3100`.

### Isi data demo (seed lengkap)

`npm run db:seed` mengisi 36 kandidat (3 LPK × 12) **lengkap**, semuanya fiktif dan dibangkitkan dari PRNG ber-seed tetap
(`src/db/demo-data.ts`; id dan isi sama setiap reseed pada hari yang sama): profil dan motivasi, riwayat Jepang (sebagian pernah ke
Jepang, 2 pernah ditolak visa), kontak (email `.test`, telepon `0812-0000-xxxx`), identitas berawalan `DUMMY` (paspor: 2 sudah lewat,
4 kurang dari 6 bulan, sisanya > 2 tahun), kesehatan, keluarga 3-5 orang, pendidikan, riwayat kerja, sertifikat (JLPT N5-N2 sejalan
dengan lama belajar, JFT-Basic, ujian skill SSW untuk Siap seleksi), 3-6 penilaian bulanan LPK (sekitar 40% belum dinilai bulan ini),
dan 4 dokumen dummy per kandidat (paspor, ijazah, foto, medical check-up; PDF/PNG valid ditulis ke `STORAGE_DIR` dengan tata letak
unggahan asli). Sisi TSK: 15 keputusan (setiap nilai keputusan minimal 2 kandidat, 6 sisanya belum diputuskan), 11 catatan, kunjungan/interview TSK,
3 perusahaan klien dengan 5 lokasi (6 bidang, 1-2 PIC tiap lokasi), 6 job order (4 Terbuka, 1 Terisi otomatis, 1 Ditutup) yang dikaitkan ke keputusan
sebidang, dan 2 penempatan aktif (kandidat Berangkat). `--reset` ikut menghapus berkas dokumen lama (hanya folder berawalan UUID di dalam `STORAGE_DIR`).

`npm run verify:seed` (hanya membaca, aman di database mana pun) gagal bila ada kolom demo kosong, kandidat tanpa JLPT / <3 penilaian /
tanpa dokumen, nilai keputusan yang hilang, lokasi tanpa PIC, job order OPEN tanpa kandidat cocok, keputusan *Lulus interview client* dan sesudahnya tanpa job order, filter di `/candidates` (nilai ≥ 4, kehadiran ≥ 90, JLPT, bidang, keputusan) yang kosong
atau menghasilkan semua kandidat, atau berkas yatim di storage. Filter memakai fungsi yang sama dengan halaman
(`src/db/candidate-list.ts`). CI menjalankannya setelah seed. Catatan: filter "JLPT N5" berarti "N5 atau lebih tinggi", jadi
memang mengembalikan semua kandidat (cukup tidak kosong).

### Reseed per lingkungan

Reseed menghapus SEMUA data (dan berkas dokumen lama), jadi hanya untuk data dummy. Cek dulu (baca-saja) bahwa organisasi dan pengguna
di database itu hanya yang ada di seed; bila ada pengguna/organisasi lain, jangan reset.

```bash
# db-dev (dari host, memakai .env ke db-dev; berkas ditulis ke ./docs-data)
npm run db:migrate && npm run db:seed -- --reset && npm run verify:seed

# Instance demo (hashi-demo): migration otomatis lewat `up`, lalu reseed
scripts/demo-up.sh            # atau: docker compose -p hashi-demo --env-file .env.demo up -d --build && scripts/demo-reset.sh

# Produksi demo `hashi` (nama database bukan _dev/_test/_demo, jadi pengaman perlu ALLOW_DESTRUCTIVE_DB=1)
docker compose up -d --build                                                    # bangun image migrate terbaru + migration
docker compose run --rm -e ALLOW_DESTRUCTIVE_DB=1 migrate npm run db:seed -- --reset
docker compose run --rm migrate npm run verify:seed
```

Berkas dokumen seed ditulis ke volume `docs-data` (service `migrate` memasangnya). Menjalankan seed dari image tools untuk db-dev
(`docker run ... hashi-migrate`) menulis berkas ke dalam container: pasang `-v "$PWD/docs-data":/app/docs-data` bila ingin berkasnya tersimpan.

### Akun demo

Password semua akun: `hashi-demo-2026` (bisa diganti lewat `SEED_PASSWORD` di `.env` sebelum seed).

| Email | Peran | Yang terlihat |
| --- | --- | --- |
| `tsk.admin@hashi.test` | Admin TSK (bahasa Jepang) | 21 dari 24 kandidat 2 LPK mitra, semua status (3 sengaja belum dibagikan: 2 di Bandung, 1 di Surabaya). Sudah ada 15 keputusan demo yang mencakup semua nilai keputusan (shortlist s/d berangkat, ditolak) |
| `tsk.staff@hashi.test` | Staf TSK | Sama seperti admin TSK |
| `lpk1.admin@hashi.test` | Admin LPK Bandung | 12 kandidat miliknya (2 belum dibagikan ke TSK), bisa mengedit semuanya dan mengatur berbagi; melihat keputusan TSK tanpa catatannya |
| `lpk1.sensei@hashi.test` | Sensei LPK Bandung | 12 kandidat miliknya, hanya profil dasar (tanpa data sensitif dan dokumen), hanya baca |
| `lpk2.admin@hashi.test` | Admin LPK Surabaya | 12 kandidat miliknya |
| `lpk3.admin@hashi.test` | Admin LPK Medan (bukan mitra) | 12 kandidat miliknya, tidak terlihat oleh TSK |
| `admin@hashi.test` | Super admin | Ringkasan jumlah per organisasi, tanpa data pribadi |

## Demo untuk pihak luar

Untuk staf TSK yang mau mencoba Hashi lewat alamat publik, jalankan **instance demo terpisah**. Produksi (`hashi`) tidak disentuh:

| | Produksi | Demo |
| --- | --- | --- |
| Project Compose | `hashi` | `hashi-demo` (`-p hashi-demo`) |
| File env | `.env` | `.env.demo` (dibuat otomatis, **tidak masuk git**) |
| Database / dokumen | volume `hashi_db-data`, `hashi_docs-data` | volume `hashi-demo_db-data`, `hashi-demo_docs-data` (database `hashi_demo`) |
| Port aplikasi | 3110 | **3111** (hanya `127.0.0.1`; akses publik lewat proxy HTTPS / tunnel) |
| Batas memori | app 768 MB, db 512 MB | sama (memakai `compose.yaml` yang sama) |
| Kata sandi akun | sesuai `.env` | **acak** (`SEED_PASSWORD` di `.env.demo`), bukan `hashi-demo-2026`; `SHOW_DEMO_ACCOUNTS=false` (daftar akun tidak tampil di halaman login) |

```bash
scripts/demo-up.sh       # hidupkan: buat .env.demo (secret acak) bila belum ada, build + jalankan, seed --reset,
                         # lalu cetak email akun demo + kata sandinya (bagikan tsk.admin / tsk.staff untuk sisi TSK, dan lpk1.admin / lpk1.sensei untuk sisi LPK)
scripts/demo-reset.sh    # isi ulang data demo saja (database hashi_demo + berkas dokumen demo), kata sandi tetap
scripts/demo-down.sh     # matikan (data demo tetap ada); `--purge` menghapus volume demo sekalian
```

Skrip selalu memakai `-p hashi-demo --env-file .env.demo` dan menolak jalan bila `.env.demo` tidak aman (nama database
bukan `*_demo`, port 3100/3110, `SHOW_DEMO_ACCOUNTS` bukan `false`, atau kata sandi bawaan). Jangan menjalankan `docker compose`
polos untuk demo: tanpa `-p hashi-demo` yang tersentuh adalah produksi. Cek keduanya: `docker compose ls`, lalu
`docker compose ps` (produksi) dan `docker compose -p hashi-demo --env-file .env.demo ps` (demo).

**HTTPS**: arahkan proxy/tunnel (mis. Cloudflare Tunnel) ke `http://127.0.0.1:3111`. Aplikasi memakai `AUTH_TRUST_HOST=true`, sehingga
Auth.js membaca `X-Forwarded-Proto` / `X-Forwarded-Host` dari proxy dan memasang cookie sesi `__Secure-authjs.session-token`
(`Secure`, `HttpOnly`, `SameSite=Lax`). Pastikan proxy meneruskan header itu (Cloudflare Tunnel dan nginx dengan
`proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Host $host;` sudah cukup). Bila proxy tidak
meneruskannya, isi `AUTH_URL=https://alamat-demo` di `.env.demo` lalu `scripts/demo-up.sh` lagi.

> ⚠️ **Instance demo hanya boleh berisi data dummy.** Jangan pernah memasukkan data siswa asli, dan jangan memakai `.env.demo`
> untuk database produksi. **Produksi (`hashi`, port 3110) tidak boleh pernah dibuka ke internet**: hanya demo yang boleh
> diberi alamat publik. Akun `admin@hashi.test` (super admin) jangan dibagikan ke pihak luar. Setelah sesi demo selesai,
> matikan dengan `scripts/demo-down.sh` atau reset dengan `scripts/demo-reset.sh`.

## Update ke versi terbaru

```bash
cd ~/hashi
git pull                      # atau: git am file.patch
docker compose up -d --build  # migration baru otomatis dijalankan container `migrate`
docker compose ps             # app dan db harus (healthy)
curl -fsS http://127.0.0.1:3110/api/health
```

Verifikasi di produksi cukup lewat **CI hijau** (`gh run list`) dan cek `/api/health`. Jangan menjalankan
`test:rls` terhadap database produksi (lihat *Pengujian*).

## Perintah sehari-hari

```bash
docker compose ps                         # status
docker compose logs -f app                # log aplikasi
docker stats --no-stream                  # pemakaian RAM
git pull && docker compose up -d --build  # update ke versi terbaru
docker compose down                       # hentikan (data tetap aman di volume)

# Isi ulang data demo dari nol
docker compose run --rm migrate npm run db:seed -- --reset

# Backup cepat database ke file
docker compose exec -T db pg_dump -U hashi_owner -d hashi | gzip > hashi-$(date +%F).sql.gz
```

Batas RAM: app 768 MB, database 512 MB (container `migrate` hanya hidup beberapa detik).

## Dokumen kandidat dan backup

File dokumen (PDF/JPG/PNG, maks. 10 MB) disimpan di **Docker named volume `docs-data`**, dipasang di
`/app/docs-data` pada container `app`. Tata letak: `<org_id>/<candidate_id>/<document_id>.<pdf|jpg|png>`.
Nama file di disk selalu id dokumen (bukan nama dari user), jenis file dicek dari isinya, dan unduhan hanya lewat
aplikasi (dicek login + RLS, tercatat di audit log). Metadata dokumen ada di database, jadi **backup harus mencakup
database DAN volume `docs-data`** (salah satunya saja tidak cukup untuk memulihkan).

```bash
# Backup volume dokumen ke file .tgz di folder sekarang (nama volume = <nama-project>_docs-data)
docker run --rm -v hashi_docs-data:/data:ro -v "$PWD":/backup node:22-alpine \
  tar czf /backup/hashi-docs-$(date +%F).tgz -C /data .

# Restore ke volume (kosong atau yang akan ditimpa). Sesuaikan nama arsip.
docker run --rm -v hashi_docs-data:/data -v "$PWD":/backup:ro node:22-alpine \
  sh -c 'cd /data && tar xzf /backup/hashi-docs-YYYY-MM-DD.tgz && chown -R 1000:1000 /data'
```

Arsip dibuat oleh root di dalam container. Perintah ini sudah dicoba pada folder uji (arsip berisi struktur
`org/kandidat/file`; hasil restore identik dengan sumbernya, pemilik file 1000 = user `node` di image aplikasi).
Backup database ada di bagian *Perintah sehari-hari*.

## Keamanan data: cara kerja RLS

Aplikasi terhubung ke database sebagai role **`hashi_app`** yang tidak bisa melewati RLS.
Migration dan seed memakai role **`hashi_owner`**.

Setiap akses data dari aplikasi wajib lewat salah satu dari:

```ts
import { withTenant, withSystem } from "@/db";
import { tenantQuery } from "@/lib/session";

// Di server component / server action: otomatis pakai organisasi user yang login
const rows = await tenantQuery((tx) => tx.select().from(candidates));

// Operasi sistem saja (login, super admin, worker terjadwal)
await withSystem((tx) => ...);
```

Keduanya membuka transaksi dan mengisi `app.org_id`, `app.role`, `app.user_id` (dari `withTenant({ orgId, role, userId }, …)`),
dan `app.bypass_rls`, lalu policy di `drizzle/0001_rls_policies.sql` dan
`drizzle/0005_candidate_profile_rls.sql` yang memutuskan baris mana yang terlihat. Query di luar
keduanya tidak melihat data apa pun (gagal dengan aman). Peran `null` tidak boleh membaca data sensitif
maupun menulis data kandidat.

### Hak akses data kandidat

Ada dua hal yang sengaja dipisah: **status di LPK** (`candidates.stage`: Belajar / Siap seleksi / Mundur, hanya
diisi Admin LPK) dan **keputusan TSK** (tabel `candidate_selections`: shortlist, wawancara, dst., diisi TSK).
Keputusan TSK tidak mengubah status LPK, dan tiap TSK hanya melihat keputusannya sendiri.

| Peran | Baca | Tulis |
| --- | --- | --- |
| **Admin LPK** | Semua data kandidat LPK-nya, termasuk data sensitif (`candidate_private`), keluarga, dokumen, **keputusan semua TSK mitra**, dan catatan TSK yang **dibagikan** | Semua data, di semua status. Satu-satunya yang mengubah status LPK, opsi berbagi ke TSK, dan tanggal formulir, **dan satu-satunya yang boleh menghapus kandidat permanen** (lihat di bawah) |
| **Sensei** | Profil dasar saja (daftar, pendidikan, kerja, sertifikat) + keputusan TSK. Tanpa data sensitif, keluarga, dokumen | Tidak ada |
| **Admin / staf TSK** (mitra aktif) | Semua kandidat LPK mitra di **semua status** (termasuk Belajar dan Mundur) beserta data sensitif dan dokumen, **hanya jika kandidat dibagikan ke TSK** (`shared_with_tsk`) | (1) Keputusan + catatan (`Hanya TSK` atau `Bagikan ke LPK`) **milik organisasinya sendiri**, tanpa mengubah status LPK. (2) Edit isi data (kandidat, data sensitif, dokumen/keluarga/pendidikan/kerja/sertifikat: tambah & ubah) **hanya jika keputusannya** `PASSED_CLIENT_INTERVIEW`, `DOCUMENT_PROCESS`, atau `DEPARTED` **dan** LPK belum menandai kandidat *Mundur*. Menghapus: hanya **dokumen**, dan hanya bila boleh mengedit (baris data lain tidak pernah) |

**Klien, job order, dan penempatan** (langkah 5; semuanya milik organisasi TSK, kolom `org_id`):

| Data | Admin TSK | Staf TSK | LPK (semua peran), super admin (jalur aplikasi), TSK lain |
| --- | --- | --- | --- |
| Perusahaan `client_companies`, lokasi `client_sites`, PIC `client_site_contacts`, bidang diterima `client_site_fields` | baca, tambah, ubah, nonaktifkan, **hapus permanen** (bila tanpa job order/penempatan) | baca, tambah, ubah, nonaktifkan | **tidak melihat sama sekali** (halaman 404) |
| Job order `job_orders` | baca, tambah, ubah, buka/tutup, hapus (bila belum dirujuk seleksi/penempatan) | baca, tambah, ubah, buka/tutup | tidak melihat |
| Penempatan `placements` | baca, ubah tanggal/status/catatan | sama | tidak melihat; tidak ada yang bisa menghapus |
| Seleksi `candidate_selections` | keputusan umum atau per job order | sama | LPK hanya melihat keputusan paling maju per TSK (view `candidate_headline_decision`), **tanpa job order** |

Model data ringkas: `skill_fields` (master bidang kerja, dipakai kandidat, lokasi, dan job order) → `client_companies` 1:N `client_sites` (N:M
`skill_fields` lewat `client_site_fields`; 1:N `client_site_contacts`) → `job_orders` (lokasi + bidang yang diterima lokasi) → `candidate_selections`
(satu baris per kandidat × TSK × job order, ditambah satu baris umum tanpa job order) → `placements` (otomatis saat keputusan **Berangkat**; satu
kandidat hanya satu penempatan *ACTIVE*). Aturan database: keputusan *Lulus interview client*, *Proses dokumen*, dan *Berangkat* **wajib** punya
job order (CHECK); job order harus milik TSK yang sama dan bidangnya diterima lokasi (trigger); job order *Terbuka* menjadi *Terisi* otomatis saat
jumlah kandidat terpilih (tiga keputusan itu) mencapai jumlah posisi, dan dibuka lagi secara manual. Audit klien/job order/penempatan hanya memuat
jenis aksi, id, dan nama kolom (tanpa nama/telepon PIC, catatan, atau judul).

**Hapus kandidat permanen** (v0.3): hanya **Admin LPK pemilik** (UI, server action, RLS `DELETE`, semuanya). Berbeda dari *Nonaktifkan*
(status Mundur, riwayat tetap tersimpan), hapus permanen dipakai untuk data salah input atau database yang tidak dipakai lagi. Tombol
ada di bagian *Zona berbahaya* paling bawah halaman detail (tidak ada di DOM untuk sensei, TSK, maupun LPK lain). Dialog dalam halaman
menampilkan nama kandidat, peringatan "tidak bisa dibatalkan", jumlah data yang ikut terhapus (dokumen, penilaian LPK, penilaian TSK,
catatan TSK, keputusan TSK; peringatan khusus bila kandidat dibagikan dan punya data milik TSK), saran memakai Nonaktifkan, dan
kolom konfirmasi: ketik nama kandidat persis (atau kodenya, 8 karakter pertama id, bila lebih pendek dari nama).
**Diblokir** bila ada keputusan TSK `DOCUMENT_PROCESS` atau `DEPARTED` (sedang diproses / sudah berangkat): pesan mengarahkan ke
Nonaktifkan; ditegakkan juga oleh trigger database `candidates_block_delete` (daftar eksplisit; berlaku bagi siapa pun, termasuk
sistem). Semua data turunan ikut terhapus lewat FK `ON DELETE CASCADE` dalam satu transaksi; berkas dokumen dihapus **setelah**
commit (kegagalan tidak membatalkan hapus DB; dicatat di log dan audit `candidate.delete_files_failed` dengan `filesFailed`).
Audit `candidate.delete` hanya memuat id, kode, dan jumlah baris per jenis data, **tidak pernah nama atau isi**, dan bertahan setelah
kandidat hilang (`audit_logs` tanpa FK ke kandidat). Hapus organisasi (cascade) dan `db:seed -- --reset` (TRUNCATE) tidak terhalang
penjaga.

**Bahasa pengguna** (v0.3): kolom *Bahasa* di daftar pengguna adalah bahasa yang **dikuasai** (`users.languages`: Indonesia, Jepang,
Inggris; minimal satu, tanpa duplikat), dipilih lewat kotak centang di form tambah/ubah pengguna. Bahasa **tampilan** (`users.locale`,
hanya id/ja) diubah lewat tombol bahasa dan tidak lagi tampil di daftar. (Bug sebelumnya: tombol bahasa menulis `users.locale` milik
pengguna yang login, dan kolom Bahasa menampilkan nilai itu.)

**Penilaian kandidat** (面談 bulanan oleh LPK, plus penilaian TSK): LPK_ADMIN dan sensei menulis dan membaca penilaian
bulanan LPK (satu per kandidat per bulan; penilai selalu user yang login, tanggal tidak boleh di masa depan). TSK membaca
penilaian LPK kandidat yang dibagikan kepadanya tetapi **tidak pernah bisa mengubahnya** (riwayat). TSK membuat *kunjungan*
kapan saja dan *interview* hanya setelah keputusan *Lulus wawancara TSK* atau sesudahnya; penilaian TSK default-nya *Hanya
TSK* dan bisa dibagikan ke LPK (hanya Admin LPK yang melihatnya, sensei tidak). Tidak ada yang bisa menghapus penilaian.

Di aplikasi, penilaian bulanan ada di bagian *Penilaian* pada halaman detail kandidat (LPK_ADMIN dan sensei): form bulanan
(tanggal 面談, durasi, empat nilai 1-5 berlabel teks, kehadiran, tes, catatan, tindak lanjut), riwayat terbaru di atas dengan
rata-rata dan indikator naik/turun/tetap. Menu *Penilaian* dan kartu di beranda menunjukkan kandidat Belajar/Siap seleksi yang
**belum dinilai bulan ini**. "Bulan ini" dan "hari ini" mengikuti `APP_TIMEZONE` (`src/db/time.ts`, bawaan `Asia/Jakarta`).
Di /candidates ada filter rata-rata nilai minimal, kehadiran minimal (keduanya dari tiga penilaian bulanan terbaru), dan level
JLPT (dari sertifikat), serta kolom *Nilai terakhir*. Catatan penilaian tidak boleh berisi data medis.

Sisi TSK (halaman detail kandidat yang dibagikan): penilaian bulanan LPK tampil **baca saja**. Bagian *Penilaian TSK* punya form
*Kunjungan* (selalu tersedia) dan *Interview TSK* (nonaktif dengan penjelasan sampai keputusan TSK itu *Lulus wawancara TSK* atau
sesudahnya). Tiap penilaian TSK bisa *Hanya TSK* (bawaan) atau *Bagikan ke LPK*; yang dibagikan muncul bagi Admin LPK di bagian
*Penilaian dari TSK* (baca saja, disembunyikan bila kosong; sensei tidak pernah melihatnya). Mengubah: penilainya atau Admin TSK.
Batas tanggal form TSK adalah hari ini di Tokyo.

Kandidat yang belum dibagikan hanya terlihat oleh LPK pemiliknya, di semua tabel (data sensitif, keluarga, pendidikan,
kerja, sertifikat, dokumen, keputusan, catatan, penilaian, audit). Opsi berbagi ada di bagian *Status* halaman detail (dan di form
tambah kandidat); mematikannya **tidak menghapus** keputusan atau catatan TSK, hanya menyembunyikannya sampai
diaktifkan lagi, dan catatan TSK yang dibagikan ke LPK ikut tidak terlihat oleh LPK. Tanggal tanda tangan formulir
persetujuan hanya catatan opsional dan bukan gerbang. Hak edit TSK dijaga policy RLS
(`EXISTS` ke keputusan milik TSK itu sendiri) dengan daftar keputusan yang ditulis eksplisit (`IN (…)`), bukan
`>=` pada urutan enum. Satu trigger kecil melarang TSK mengubah `stage`, tanggal formulir, dan opsi berbagi, karena RLS tidak
bisa membandingkan nilai lama dengan baru.

**Catatan TSK** (`candidate_notes`, misalnya 面談メモ) default-nya *Hanya TSK*. TSK bisa membagikannya ke LPK
(*SHARED_WITH_LPK*), lalu menariknya kembali kapan saja. Semua peran TSK di organisasi yang sama membaca
catatan organisasinya, tetapi mengubah isi/visibility hanya boleh **penulisnya atau TSK_ADMIN** (staf tidak bisa mengubah catatan rekan).
Penulis diisi dari user yang login (`app.user_id`) dan tidak bisa dipalsukan. Admin LPK pemilik kandidat hanya membaca catatan yang dibagikan, dan hanya dari TSK
yang kemitraannya masih aktif (kemitraan dinonaktifkan = catatan ikut tidak terlihat). Sensei tidak pernah melihat
catatan TSK. Tidak ada yang bisa menghapus catatan; LPK tidak bisa menulis atau mengubahnya. Audit log perubahan catatan hanya memuat id
catatan dan visibility (dari, ke), **tidak pernah isi catatan**, karena log kandidat disimpan di LPK pemilik.

Audit log mencatat organisasi pelaku (`actor_org_id`). Perubahan atas kandidat disimpan di log **LPK pemilik**
(dengan `candidate_id`), jadi LPK ikut melihat perubahan yang dilakukan TSK; TSK melihat aksinya sendiri.

## Development (database terpisah)

Database dev adalah service `db-dev` sendiri (container + volume + port `127.0.0.1:5433`), terpisah dari database
produksi, jadi `docker compose up -d --build` di produksi tidak memutusnya.

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev
# .env: DATABASE_URL / MIGRATE_DATABASE_URL -> .../hashi_dev di 127.0.0.1:5433
npm run db:migrate && npm run db:seed
```

`npm run test:e2e` dan `npm run db:seed -- --reset` **menolak berjalan** kalau nama database tidak berakhiran
`_dev` atau `_test` (pengaman supaya tidak menulis data uji ke produksi). CI memakai database `hashi_test`.

## Pengujian

| Perintah | Menguji | Butuh |
| --- | --- | --- |
| `npm run test:rls` | 82 pemeriksaan database: isolasi data, peran, hak akses kandidat, keputusan & catatan TSK (per TSK), persetujuan data, kemitraan, audit log | database + seed |
| `npm run test:e2e` | 15 skenario lewat browser: login, hak akses, alur admin lengkap | database + seed + `npm run build` |

Keduanya jalan otomatis di GitHub Actions setiap push (database `hashi_test`).

**Jalankan hanya terhadap database dev/test, bukan produksi (`hashi`).** Walau `test:rls` me-rollback tulisannya,
sebagian pemeriksaannya bergantung pada isi seed (mis. 21 dari 24 kandidat terlihat oleh TSK demo, 3 belum
dibagikan), sehingga di database produksi yang isinya berbeda hasilnya gagal atau menyesatkan. `test:e2e`
**menambah dan mengubah data uji**; ia, `test:rls`, dan `db:seed -- --reset` menolak jalan bila nama database tidak berakhiran
`_dev`/`_test` (`scripts/db-guard.ts`).

Menjalankan `test:rls` dari OptiPlex terhadap `db-dev` lewat image `tools` (image yang sama dengan `migrate`):

```bash
# Dari OptiPlex, terhadap db-dev, lewat image tools (persis yang dipakai CI):
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev     # sekali, bila belum jalan
docker compose build migrate                                        # bangun image tools dari kode terbaru
set -a; . ./.env; set +a                                            # .env: DATABASE_URL/MIGRATE_DATABASE_URL -> 127.0.0.1:5433/hashi_dev
for c in "npm run db:migrate" "npm run db:seed -- --reset" "npm run test:rls"; do
  docker run --rm --network host -e MIGRATE_DATABASE_URL -e DATABASE_URL hashi-migrate $c || break
done                                                                # harus berakhir "Semua pemeriksaan RLS lulus."
```

Untuk verifikasi produksi tidak ada tes basis data: cukup **CI hijau** dan `curl http://127.0.0.1:3110/api/health`.

Aturan yang diuji otomatis oleh `npm run test:rls` antara lain:

- LPK hanya melihat dan mengubah kandidatnya sendiri
- TSK membaca kandidat LPK mitra di semua status, tetapi hanya yang dibagikan ke TSK oleh LPK
- Status LPK hanya diubah Admin LPK; TSK menulis keputusannya sendiri dan tidak bisa membaca/mengubah keputusan TSK lain
- TSK mengedit isi data hanya jika keputusannya PASSED_CLIENT_INTERVIEW / DOCUMENT_PROCESS / DEPARTED dan kandidat belum Mundur
- LPK membaca keputusan TSK, dan hanya catatan TSK yang dibagikan (Admin LPK saja); tidak bisa menulis keputusan maupun catatan
- Sensei tidak bisa membaca data sensitif maupun dokumen, dan tidak bisa mengedit kandidat
- Dokumen: TSK mengunggah/menghapus hanya bila boleh mengedit; `DELETE` tanpa `WHERE` diuji juga
- LPK non-mitra tidak terlihat sama sekali oleh TSK
- Tidak ada yang bisa menulis data ke organisasi lain atau membuat kemitraan sendiri
- Tidak ada yang bisa membuat peran yang tidak sesuai organisasinya
- Audit log tidak bisa dihapus oleh aplikasi

### Menambah tabel baru

1. Tambahkan tabel di `src/db/schema.ts`, lalu `npm run db:generate`
2. Buat migration SQL manual (`npx drizzle-kit generate --custom --name nama_tabel_rls`) berisi:
   `GRANT ... TO hashi_app`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, dan policy-nya
3. Tambahkan pemeriksaan di `scripts/verify-rls.ts`

Tanpa langkah 2, aplikasi tidak bisa membaca tabel baru. Itu disengaja.

## Development tanpa Docker

```bash
npm install
# isi DATABASE_URL dan MIGRATE_DATABASE_URL di .env (lihat .env.example)
npm run db:migrate && npm run db:seed
npm run dev   # http://localhost:3100
```

## Struktur folder

```
drizzle/                 migration SQL 0000-0021 (RLS, trigger, GRANT ditulis manual)
docker/postgres/init/    script pembuatan role hashi_app
messages/                teks antarmuka: id.json, ja.json (kunci identik)
scripts/                 migrate, seed (+ seed:records, seed:client-sheet), verify-* (rls, seed, i18n, audit), skrip demo
src/auth.ts              konfigurasi login
src/db/                  schema, withTenant/withSystem, query bersama, data demo, audit (satu-satunya yang boleh diimpor scripts/)
src/features/            logika per fitur: candidates, assessments, clients, job-orders, client-sheet, records, documents,
                         dashboard, audit, users, organizations, skill-fields, account
src/lib/                 sesi, hak akses, audit(), PDF (lib/pdf), zona waktu
src/components/          shell aplikasi dan komponen bersama
src/app/(app)/           halaman setelah login (candidates, assessments, clients, job-orders, records, sheet, activity, users, admin, account)
src/app/login/           halaman login
tests/unit/              tes unit (node:test)
tests/e2e/               tes browser (Playwright)
docs/                    TASKS (antrean), STATUS (laporan engineer), HISTORY, dokumentasi fitur, glosarium, merek
```

## Catatan keputusan

- **Drizzle, bukan Prisma**: tanpa binary engine (image lebih kecil, build lebih cepat di OptiPlex),
  dan RLS lebih mudah dikelola karena migration berupa SQL biasa.
- **Rate limit login** (5 kali salah per 15 menit per email) disimpan di memori. Cukup untuk satu server.
- **Sebelum ada data siswa asli**: set `SHOW_DEMO_ACCOUNTS=false`, siapkan backup otomatis ke luar rumah,
  dan formulir persetujuan data pribadi. Lihat dokumen spesifikasi MVP.
