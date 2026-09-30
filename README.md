# Hashi 橋

Sistem profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Satu profil kandidat, dipakai bersama oleh LPK dan TSK mitranya, tanpa ketik ulang.

> Status: **v0.2** — fondasi (login, dua bahasa, isolasi data RLS) + **kelola organisasi, pengguna, dan kemitraan**.
> Modul profil kandidat, penilaian, dan seleksi menyusul.

## Fitur saat ini

| Siapa | Bisa apa |
| --- | --- |
| **Super admin** | Menambah LPK/TSK beserta admin pertamanya, mengubah data organisasi, mengelola pengguna di organisasi mana pun, membuat dan menonaktifkan kemitraan LPK–TSK |
| **Admin LPK / TSK** | Menambah staf (sensei / staf TSK), mengubah nama, peran, bahasa, membuat kata sandi sementara baru, menonaktifkan / mengaktifkan kembali |
| **Semua pengguna** | Login, ganti bahasa, ganti kata sandi di *Akun saya* |

Cara kerja akun baru:

1. Admin menambah pengguna → sistem membuat **kata sandi sementara** (tampil sekali, contoh `k7Qm-3xPa-9Tzw`)
2. Admin memberikannya ke pengguna lewat jalur aman
3. Saat login pertama, pengguna **wajib** membuat kata sandi sendiri sebelum bisa memakai aplikasi

Pengaman bawaan: admin tidak bisa menonaktifkan / mengubah peran dirinya sendiri, organisasi selalu punya
minimal satu admin aktif, reset kata sandi langsung mengeluarkan pengguna dari semua sesi, dan pengguna
nonaktif langsung tidak bisa masuk (dicek setiap request, tidak menunggu sesi habis). Semua perubahan
tercatat di audit log.

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

# 4. Pastikan isolasi data bekerja (harus "Semua pemeriksaan RLS lulus.")
docker compose run --rm migrate npm run test:rls
```

Buka `http://<IP-OptiPlex-atau-Tailscale>:3100`.

### Akun demo

Password semua akun: `hashi-demo-2026` (bisa diganti lewat `SEED_PASSWORD` di `.env` sebelum seed).

| Email | Peran | Yang terlihat |
| --- | --- | --- |
| `tsk.admin@hashi.test` | Admin TSK (bahasa Jepang) | 23 kandidat dari 2 LPK mitra, semua status. 1 kandidat LPK Bandung sengaja belum punya persetujuan berbagi data, jadi tidak terlihat. Sudah ada 10 keputusan demo (shortlist s/d lulus interview client) |
| `tsk.staff@hashi.test` | Staf TSK | Sama seperti admin TSK |
| `lpk1.admin@hashi.test` | Admin LPK Bandung | 12 kandidat miliknya (termasuk yang belum ada persetujuan), bisa mengedit semuanya; melihat keputusan TSK tanpa catatannya |
| `lpk1.sensei@hashi.test` | Sensei LPK Bandung | 12 kandidat miliknya, hanya profil dasar (tanpa data sensitif dan dokumen), hanya baca |
| `lpk2.admin@hashi.test` | Admin LPK Surabaya | 12 kandidat miliknya |
| `lpk3.admin@hashi.test` | Admin LPK Medan (bukan mitra) | 12 kandidat miliknya, tidak terlihat oleh TSK |
| `admin@hashi.test` | Super admin | Ringkasan jumlah per organisasi, tanpa data pribadi |

## Update ke versi terbaru

```bash
cd ~/hashi
git pull                      # atau: git am file.patch
docker compose up -d --build  # migration baru otomatis dijalankan container `migrate`
docker compose run --rm migrate npm run test:rls
```

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
| **Admin LPK** | Semua data kandidat LPK-nya, termasuk data sensitif (`candidate_private`), keluarga, dokumen, **keputusan semua TSK mitra**, dan catatan TSK yang **dibagikan** | Semua data, di semua status. Satu-satunya yang mengubah status LPK dan tanggal persetujuan |
| **Sensei** | Profil dasar saja (daftar, pendidikan, kerja, sertifikat) + keputusan TSK. Tanpa data sensitif, keluarga, dokumen | Tidak ada |
| **Admin / staf TSK** (mitra aktif) | Semua kandidat LPK mitra di **semua status** (termasuk Belajar dan Mundur) beserta data sensitif dan dokumen, **hanya jika kandidat punya tanggal persetujuan berbagi data** | (1) Keputusan + catatan (`Hanya TSK` atau `Bagikan ke LPK`) **milik organisasinya sendiri**, tanpa mengubah status LPK. (2) Edit isi data (kandidat, data sensitif, dokumen/keluarga/pendidikan/kerja/sertifikat: tambah & ubah) **hanya jika keputusannya** `PASSED_CLIENT_INTERVIEW`, `DOCUMENT_PROCESS`, atau `DEPARTED` **dan** LPK belum menandai kandidat *Mundur*. Tidak pernah bisa menghapus data |

Kandidat tanpa tanggal persetujuan hanya terlihat oleh LPK pemiliknya. Hak edit TSK dijaga policy RLS
(`EXISTS` ke keputusan milik TSK itu sendiri) dengan daftar keputusan yang ditulis eksplisit (`IN (…)`), bukan
`>=` pada urutan enum. Satu trigger kecil melarang TSK mengubah `stage` dan tanggal persetujuan, karena RLS tidak
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

Keduanya jalan otomatis di GitHub Actions setiap push. `test:rls` aman dijalankan di OptiPlex (semua
perubahan di-rollback). `test:e2e` **menambah data uji** (organisasi "LPK E2E ..."), jadi jalankan di
database development saja, atau reset data demo sesudahnya.

Aturan yang diuji otomatis oleh `npm run test:rls` antara lain:

- LPK hanya melihat dan mengubah kandidatnya sendiri
- TSK membaca kandidat LPK mitra di semua status, tetapi hanya yang sudah punya persetujuan berbagi data
- Status LPK hanya diubah Admin LPK; TSK menulis keputusannya sendiri dan tidak bisa membaca/mengubah keputusan TSK lain
- TSK mengedit isi data hanya jika keputusannya PASSED_CLIENT_INTERVIEW / DOCUMENT_PROCESS / DEPARTED dan kandidat belum Mundur
- LPK membaca keputusan TSK, dan hanya catatan TSK yang dibagikan (Admin LPK saja); tidak bisa menulis keputusan maupun catatan
- Sensei tidak bisa membaca data sensitif maupun dokumen, dan tidak bisa mengedit kandidat
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
drizzle/                 migration SQL (0001 = RLS policy, ditulis manual)
docker/postgres/init/    script pembuatan role hashi_app
messages/                teks antarmuka: id.json, ja.json
scripts/                 migrate, seed, verify-rls
src/auth.ts              konfigurasi login
src/db/                  schema + withTenant/withSystem
src/features/            logika per fitur: users, organizations, account (actions + komponen)
src/lib/                 sesi, hak akses, kata sandi, audit log
src/app/(app)/           halaman setelah login (users, admin, account)
src/app/login/           halaman login
tests/e2e/               tes browser (Playwright)
```

## Catatan keputusan

- **Drizzle, bukan Prisma**: tanpa binary engine (image lebih kecil, build lebih cepat di OptiPlex),
  dan RLS lebih mudah dikelola karena migration berupa SQL biasa.
- **Rate limit login** (5 kali salah per 15 menit per email) disimpan di memori. Cukup untuk satu server.
- **Sebelum ada data siswa asli**: set `SHOW_DEMO_ACCOUNTS=false`, siapkan backup otomatis ke luar rumah,
  dan formulir persetujuan data pribadi. Lihat dokumen spesifikasi MVP.
