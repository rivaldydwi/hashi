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
| `tsk.admin@hashi.test` | Admin TSK (bahasa Jepang) | 16 kandidat dari 2 LPK mitra, hanya yang sudah siap seleksi |
| `tsk.staff@hashi.test` | Staf TSK | Sama seperti admin TSK |
| `lpk1.admin@hashi.test` | Admin LPK Bandung | 12 kandidat miliknya |
| `lpk1.sensei@hashi.test` | Sensei LPK Bandung | 12 kandidat miliknya |
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

Keduanya membuka transaksi dan mengisi `app.org_id` / `app.bypass_rls`, lalu policy di
`drizzle/0001_rls_policies.sql` yang memutuskan baris mana yang terlihat. Query di luar
keduanya tidak melihat data apa pun (gagal dengan aman).

Selain RLS, beberapa aturan dijaga langsung oleh trigger database (`drizzle/0003_user_role_guards.sql`),
jadi bug di aplikasi pun tidak bisa melanggarnya:

- Peran harus sesuai jenis organisasi (LPK: admin/sensei, TSK: admin/staf, Platform: super admin).
  Mencegah admin LPK "menaikkan" seseorang menjadi super admin.
- Kemitraan harus antara satu LPK dan satu TSK
- Jenis organisasi tidak bisa diubah setelah dibuat
- Email selalu huruf kecil

## Pengujian

| Perintah | Menguji | Butuh |
| --- | --- | --- |
| `npm run test:rls` | 25 aturan database: isolasi data, peran, kemitraan, audit log | database + seed |
| `npm run test:e2e` | 15 skenario lewat browser: login, hak akses, alur admin lengkap | database + seed + `npm run build` |

Keduanya jalan otomatis di GitHub Actions setiap push. `test:rls` aman dijalankan di OptiPlex (semua
perubahan di-rollback). `test:e2e` **menambah data uji** (organisasi "LPK E2E ..."), jadi jalankan di
database development saja, atau reset data demo sesudahnya.

Aturan yang diuji otomatis oleh `npm run test:rls` antara lain:

- LPK hanya melihat dan mengubah kandidatnya sendiri
- TSK hanya **membaca** kandidat LPK mitra yang sudah lewat tahap *Belajar*
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
