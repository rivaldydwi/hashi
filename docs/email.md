# Email pengingat 在留カード: pengaturan SMTP (Brevo) dan pemeriksaan (T-022, T-025)

Hashi mengirim **satu email ringkasan per penerima per hari** (08:00 Asia/Tokyo) berisi pekerja yang kartu izin tinggalnya perlu diurus. Penerima = 担当 pekerja + semua Admin TSK aktif.
Rancangan dan aturan pemicu: `docs/zairyu-card.md` §10. Dokumen ini = cara mengaktifkan pengiriman di produksi dan memeriksanya.

## 1. Keadaan bawaan: MODE KERING

Tanpa `SMTP_URL`, service `worker` tidak mengirim apa pun (hanya log `mode=KERING` dan `dry-run`). Produksi sekarang begini. Mengaktifkan = mengisi tiga variabel di `.env` server (bagian 3).

## 2. Pengaman penerima (selalu aktif di produksi)

Worker TIDAK mengirim ke:
- alamat berdomain contoh/cadangan: `*@hashi.test` (akun demo), `example.com/.org/.net`, `*.test`, `*.invalid`, `*.example`, `*.localhost`, `localhost`, dan alamat yang bentuknya tidak sah;
- pengguna nonaktif.

Yang dilewati dihitung `dilewati=N` di log putaran (tanpa alamat) dan TIDAK dicatat sebagai terkirim. Selama produksi hanya berisi akun demo, mengaktifkan SMTP aman: tidak ada email yang keluar ke alamat palsu, dan pekerja demo tidak memicu email nyata.
Hanya untuk pengembangan: env `REMINDER_ALLOW_TEST_RECIPIENTS=1` (tidak ada di `compose.yaml`, jadi tidak aktif di produksi) dan opsi tes `allowTestRecipients`.

Pemeriksaan kesiapan (angka saja, tanpa alamat): `docker compose -p hashi exec -T worker node --import tsx scripts/reminder-worker.ts --check` menampilkan jumlah pengguna TSK aktif, berapa yang akan dilewati pengaman, dan jumlah akun demo.
**Selama semua penerima adalah akun demo, pengingat nyata belum akan terkirim ke siapa pun**: buat akun staf nyata (halaman Pengguna) dulu.

## 3. Mengaktifkan di produksi (Ipal; engineer tidak melihat SMTP key kecuali Ipal memberikannya langsung di sesi engineer)

1. **Brevo** (gratis cukup untuk demo/pilot): daftar, lalu
   - buat **SMTP key** (SMTP & API → SMTP → "Generate a new SMTP key"; salin SEKALI, nilainya tidak bisa dilihat lagi);
   - verifikasi **alamat pengirim** (Senders, domains & dedicated IPs → Senders). Bisa satu alamat Gmail untuk tahap demo (lihat peringatan di bagian 5), atau domain sendiri (disarankan: SPF + DKIM + DMARC).
2. Isi `.env` di server (mode 600; jangan tempel nilainya ke chat/log/git):
   ```
   SMTP_URL=smtp://<login-smtp-brevo>:<smtp-key>@smtp-relay.brevo.com:587
   MAIL_FROM=Hashi <alamat-pengirim-terverifikasi>
   APP_URL=<alamat Hashi yang dibuka staf, mis. alamat Tailscale produksi>
   ```
   - `<login-smtp-brevo>` = "SMTP login" di halaman SMTP Brevo (biasanya berbentuk `xxxx@smtp-brevo.com`); karakter khusus di login/key di-URL-encode (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `+` → `%2B`, `%` → `%25`).
   - `APP_URL` = alamat Hashi yang dibuka staf (selama demo: alamat Tailscale produksi, hanya bisa dibuka dari tailnet). Jangan menuliskan alamat sebenarnya di repo ini (repo PUBLIK); isi hanya di `.env` server.
3. Terapkan: `docker compose -p hashi up -d worker` (membuat ulang service dengan `.env` baru; tidak menyentuh container lain).
4. **Kirim uji** ke alamatmu sendiri (mengirim SATU email berisi data palsu; tidak membaca kartu; tidak menulis log pengiriman/audit):
   `docker compose -p hashi exec -T worker node --import tsx scripts/reminder-worker.ts --test-to alamat-kamu@contoh.id`
   Hasil `email uji TERKIRIM` = SMTP bekerja. Periksa kotak masuk DAN folder spam.
5. Pastikan log: `docker compose -p hashi logs worker --tail=5` menampilkan `mode=kirim (SMTP_URL terisi)`.

## 4. Mencabut / mengganti SMTP key

- Brevo → SMTP & API → SMTP keys → hapus key lama → buat baru → perbarui `SMTP_URL` → `docker compose -p hashi up -d worker` → kirim uji lagi.
- **Key yang pernah ditempel ke chat/log/berkas lain dianggap bocor: hapus dan buat baru sebelum launch.**
- Tanpa `SMTP_URL` worker kembali ke mode kering (kosongkan baris itu lalu `up -d worker`).

## 5. Batasan tahap demo dan sebelum launch

- Pengirim berupa alamat Gmail (domain gratis): Brevo memperingatkan DMARC/DKIM tidak sesuai, sehingga email **bisa masuk spam atau ditolak** penerima. Cukup untuk uji demo.
- **Sebelum launch**: pakai domain sendiri dengan SPF + DKIM (+ DMARC) yang diverifikasi di Brevo, ganti `MAIL_FROM`, lalu uji `--test-to` ke beberapa penyedia (Gmail, Outlook, alamat TSK).
- Email hanya berisi nama pekerja, tahap, sisa hari, dan tautan; tidak pernah nomor kartu atau catatan. Tautan hanya bisa dibuka dari jaringan yang bisa menjangkau `APP_URL` (Tailscale).
- Kuota paket gratis terbatas per hari; kebutuhan Hashi sangat kecil (beberapa email ringkasan per hari).

## 6. Pemecahan masalah

| Gejala di log worker | Arti / tindakan |
|---|---|
| `mode=KERING` | `SMTP_URL` kosong atau container belum dibuat ulang: `docker compose -p hashi up -d worker` |
| `GAGAL kirim ke 1 penerima ... Error` / `email uji GAGAL: ... EAUTH` | login atau SMTP key salah (cek URL-encode); `ECONNREFUSED`/`ETIMEDOUT`: port 587 diblokir atau host salah |
| `dilewati=N` dan `penerima=0` | semua penerima berdomain contoh/demo: buat akun staf nyata |
| email uji tidak sampai, log `TERKIRIM` | cek folder spam; alamat pengirim belum terverifikasi di Brevo; kebijakan DMARC penyedia penerima (bagian 5) |
