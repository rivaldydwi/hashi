# Hashi 橋

Sistem profil & seleksi kandidat untuk **LPK** (Indonesia) dan **TSK / 登録支援機関** (Jepang).
Satu profil kandidat, dipakai bersama oleh LPK dan TSK mitranya, tanpa ketik ulang.

> Status: **Fondasi v0.1** — login, dua bahasa (ID/JP), multi-organisasi dengan isolasi data (RLS), data demo.
> Modul profil lengkap, penilaian, dan seleksi menyusul.

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

Aturan yang diuji otomatis oleh `npm run test:rls`:

- LPK hanya melihat dan mengubah kandidatnya sendiri
- TSK hanya **membaca** kandidat LPK mitra yang sudah lewat tahap *Belajar*
- LPK non-mitra tidak terlihat sama sekali oleh TSK
- Tidak ada yang bisa menulis data ke organisasi lain atau membuat kemitraan sendiri
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
src/app/(app)/           halaman setelah login
src/app/login/           halaman login
```

## Catatan keputusan

- **Drizzle, bukan Prisma**: tanpa binary engine (image lebih kecil, build lebih cepat di OptiPlex),
  dan RLS lebih mudah dikelola karena migration berupa SQL biasa.
- **Rate limit login** (5 kali salah per 15 menit per email) disimpan di memori. Cukup untuk satu server.
- **Sebelum ada data siswa asli**: set `SHOW_DEMO_ACCOUNTS=false`, siapkan backup otomatis ke luar rumah,
  dan formulir persetujuan data pribadi. Lihat dokumen spesifikasi MVP.
