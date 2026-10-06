# Pelacak kartu izin tinggal (在留カード, Zairyū Kādo): desain

Status: **DESAIN (T-004)**. Belum ada kode, skema, atau migrasi. Tujuan dokumen ini: Ipal bisa menanyakan hal yang tepat ke staf TSK **sebelum** tabel dibuat
(daftar pertanyaan ada di bagian 9 dan disalin ke `docs/STATUS.md`). Bahan: `CLAUDE.md` ("Keputusan untuk langkah 7"), tabel `placements`, catatan kegiatan (7A),
penanggung jawab pekerja (T-010), dan dashboard yang bisa diatur.

Istilah mengikuti `docs/glossary.md` (istilah baru ditambahkan di sana). Semua yang berlabel **usulan** menunggu jawaban TSK; yang berlabel **tetap** sudah diputuskan
(`CLAUDE.md` atau jawaban staf TSK sebelumnya).

---

## 1. Ruang lingkup

| Termasuk (tugas implementasi) | Di luar (tugas terpisah) |
|---|---|
| Riwayat kartu per pekerja: tanggal habis, status tinggal, proses perpanjangan, tanggal ajukan ke imigrasi (nyūkan), tanggal terima kartu baru | Notifikasi email / LINE (hanya dalam aplikasi dulu) |
| Pengingat bertahap (fungsi murni) dan tampilan: KPI, daftar "perlu tindakan", bagian di detail pekerja | Tampilan **LPK** (status visa + tanggal tiba): lihat bagian 3.3 |
| Penerima pengingat: penanggung jawab pekerja (担当, T-010) + salinan Admin TSK | My Number (tetap: hanya bila terbukti sah dan dibutuhkan; dicek ke gyōsei shoshi) |
| Pekerja AKTIF saja (penempatan ACTIVE) | Checklist keberangkatan/kedatangan, bagian "管理・報告" lembar 定期面談 |

Pekerja = kandidat dengan penempatan (`placements`) ACTIVE (keputusan DEPARTED membuatnya otomatis). Kartu milik **pekerja** (`candidates`), bukan milik penempatan:
kartu tetap sama bila pekerja pindah perusahaan di tengah masa berlaku.

---

## 2. Data

### 2.1 Tabel usulan `residence_cards` (satu baris = satu kartu; riwayat = baris berurutan)

Perpanjangan berulang = **baris baru**, bukan menimpa. Baris lama tetap sebagai riwayat.

| Kolom | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `id` | uuid PK | ya | |
| `organization_id` | uuid → organizations | ya | org TSK pemilik (RLS), tetap setelah dibuat |
| `candidate_id` | uuid → candidates (**RESTRICT**) | ya | pekerja; tetap setelah dibuat. RESTRICT seperti tabel catatan kegiatan (menghapus kandidat yang punya kartu ditolak; ringkasan `candidate_delete_summary().blocked` ikut) |
| `previous_card_id` | uuid → residence_cards | tidak | kartu yang digantikan; diisi saat dibuat, terkunci sesudahnya (pola `continues_record_id`, T-007) |
| `residence_status` | text + CHECK | ya | 在留資格. Usulan nilai: `ssw1` (特定技能1号), `ssw2` (特定技能2号), `other` (+ `residence_status_other`). Daftar final = pertanyaan 4 |
| `residence_status_other` | text ≤ 100 | bila `other` | |
| `expiry_date` | date | ya | 在留期限 (tanggal kalender Jepang, tanpa jam; berlaku **sampai akhir hari itu**) |
| `renewal_status` | text + CHECK | ya, bawaan `not_started` | `not_started` (belum mulai) · `preparing` (persiapan berkas) · `applied` (sudah diajukan ke 入管) · `received` (kartu baru diterima). Daftar final = pertanyaan 5 |
| `applied_on` | date | bila `applied`/`received` | tanggal pengajuan ke 入管. CHECK: `applied_on <= received_on` |
| `received_on` | date | bila `received` | tanggal menerima kartu baru. CHECK: `received_on is not null <=> renewal_status = 'received'`; tidak boleh di masa depan (trigger, tanggal Tokyo) |
| `note` | text ≤ 2000 | tidak | catatan internal. Dilarang berisi nomor kartu atau data medis (teks bantuan di form) |
| `status` | text `active`/`void` | ya | pembatalan = `void` + `void_reason` (final), TANPA DELETE (pola catatan kegiatan) |
| `void_reason`, `voided_at`, `voided_by` | | bila void | |
| `version_no`, `updated_at`, `updated_by`, `created_at`, `created_by` | | ya | `created_by` diisi trigger dari `app.user_id` (tidak bisa dipalsukan) |

Aturan data (CHECK + trigger penjaga, bukan hanya aplikasi):
- **Satu kartu aktif "terkini" per pekerja** = baris `active` dengan `expiry_date` terbesar (seri: `created_at` terbaru). Hanya kartu terkini yang menghasilkan pengingat.
- Kartu baru (`previous_card_id` terisi) harus untuk pekerja yang sama, org yang sama, kartu asal `active` dan berstatus `received`, dan `expiry_date` baru > `expiry_date` lama.
- Aksi **"Terima kartu baru"** adalah SATU transaksi: baris lama jadi `received` (+ `received_on`) **dan** baris baru dibuat dengan tanggal habis baru. Dengan begitu tidak pernah ada
  celah "kartu diterima tetapi kartu baru belum dicatat". Bila staf hanya tahu kartu sudah diterima tetapi belum membaca tanggal barunya, tanggal baru **wajib** diisi (tidak ada jalan pintas).
- Riwayat edit: pakai pola yang sudah ada (`activity_versioned_before_update` + `activity_write_revision`, `activity_revisions`; CHECK `entity_type` diperluas dengan `residence_card`).
  Tanpa tabel riwayat baru.

### 2.2 Penanggung jawab (担当): TIDAK disimpan di tabel kartu (usulan)

Kebutuhan awal menyebut kolom 担当. **Rekomendasi: jangan membuat kolom**, turunkan dari penanggung jawab efektif T-010 (`effectiveResponsible`: per pekerja > per perusahaan > tidak ada).
Alasan: satu sumber kebenaran (pekerja pindah perusahaan atau 担当 diganti = pengingat ikut otomatis), tanpa dua daftar yang bisa berbeda, dan beban kerja per staf (batas 50) tetap konsisten.
Kekurangan: staf yang mengurus perpanjangan tidak bisa berbeda dari 担当 pekerja. Bila TSK memang butuh itu, tambahkan kolom `handler_id` opsional (bukan sekarang): pertanyaan 1.

### 2.3 Nomor kartu dan foto kartu: pro/kontra dan rekomendasi

| | Pro | Kontra |
|---|---|---|
| **Nomor kartu** (12 karakter) | Mempermudah cek keabsahan kartu di situs imigrasi; mungkin dibutuhkan pengisian aplikasi online | Data pribadi sensitif; pengingat TIDAK membutuhkannya; dampak kebocoran tinggi (dipakai untuk pemalsuan/pemantauan); wajib enkripsi + audit akses seperti My Number |
| **Foto/pindaian kartu** | Bukti fisik, memudahkan pengisian berkas | Memuat foto wajah, alamat, nomor; harus memakai pola dokumen terenkripsi, batas akses, kebijakan retensi; "hapus" tidak mungkin pada catatan 5 tahun |

**Rekomendasi (bawaan, tetap sampai terbukti perlu): TIDAK menyimpan nomor kartu maupun foto kartu.** Dokumen kandidat yang sudah ada (paspor dll., `candidate_documents`) tidak diubah.
Bila kelak terbukti sah dan perlu: kolom dienkripsi, opsional, hanya Admin TSK, setiap akses tercatat di audit, tidak masuk daftar/ekspor/PDF/log (sama dengan aturan My Number di `CLAUDE.md`),
dan dicek ke gyōsei shoshi dulu (pertanyaan 6).

---

## 3. Hak akses

### 3.1 RLS (pola `activity_member()` / `client_owner`)

| Peran | Baca | Tulis |
|---|---|---|
| TSK_ADMIN, TSK_STAFF org pemilik | semua kartu org-nya | INSERT/UPDATE (usulan: **semua staf TSK**, seperti wawancara berkala; alternatif 担当 + Admin = pertanyaan 7). `void`: pembuat atau TSK_ADMIN |
| LPK_ADMIN, LPK_SENSEI, super admin (jalur aplikasi), peran `null`, TSK lain | **0 baris** | ditolak |

- `ENABLE` + `FORCE ROW LEVEL SECURITY`; `GRANT SELECT, INSERT, UPDATE` saja ke `hashi_app` (**tanpa DELETE**; tidak ada GRANT otomatis, seperti aturan "Tabel baru").
- Trigger penjaga: `organization_id`/`candidate_id`/`previous_card_id` terkunci; pekerja harus kandidat yang terlihat TSK dan punya (atau pernah punya) penempatan di org itu (`assertWorkers` di sisi aplikasi
  + trigger di DB); `created_by` dari sesi; hanya kolom yang boleh diubah (status proses, tanggal, catatan, void); `received` final kecuali `void`.
- UI: menu "Kartu" dan rute `/records/cards` hanya untuk TSK (staf lain 404, menu tidak ada di DOM). LPK/sensei/super admin: 404.
- `verify-rls`: bagian baru (pola S/V): tulis oleh staf TSK, UPDATE tanpa `WHERE` hanya org sendiri, CHECK/trigger (status, tanggal, kartu baru), TSK lain/LPK/sensei/super admin/null membaca 0 baris, tanpa DELETE, dan `information_schema` (tabel ber-`candidate_id` wajib masuk bagian I).

### 3.2 Audit (tanpa isi)

`residence_card.create`, `residence_card.update`, `residence_card.receive` ("Terima kartu baru"), `residence_card.void`, di log org TSK saja. Entri baru di `ACTIONS` (`audit-describe.ts`, kalimat id + ja) dan `verify:audit-coverage`.
Nilai yang boleh dicatat (`AUDIT_VALUE_FIELDS.residence_card`): `residenceStatus` (kode), `renewalStatus`, `status`, `period` bila perlu (bulan tanggal habis). **Tidak** dicatat: tanggal (habis/ajukan/terima), catatan,
nama pekerja, nomor kartu. Kunci struktural `fields` memuat NAMA kolom yang berubah. Tanda baca/lihat tidak diaudit.

### 3.3 LPK: batas saja (tugas terpisah)

LPK perlu melihat **status visa dan tanggal tiba** setelah pekerja berangkat, dan **hanya dua hal itu** (bukan klien, job order, penempatan, ataupun tanggal habis kartu).
Karena itu **tabel `residence_cards` tidak boleh dibuka ke LPK** (tanpa policy baca LPK; jangan "melonggarkan" RLS). Jalur yang benar nanti: fungsi `SECURITY DEFINER` sempit (pola `candidate_delete_summary()`,
`tsk_has_edit_decision`) yang mengembalikan HANYA dua nilai untuk kandidat milik LPK sesi dengan kemitraan AKTIF dan penempatan, dengan `COALESCE` pada pemeriksaan peran (NULL dalam `NOT` melewati IF).
"Tanggal tiba" belum punya kolom (bukan bagian tabel ini); "status visa" belum didefinisikan (pertanyaan 9). Tugas itu menunggu jawaban TSK dan tidak termasuk rencana di bawah.

---

## 4. Pengingat

### 4.1 Aturan (tetap, dari spreadsheet TSK)

- Persiapan dimulai **4 bulan** sebelum habis; pengajuan bisa dimulai **3 bulan** sebelum habis; pengingat **H-30, H-14, H-7**, dan **sesudah lewat**; **berhenti saat tanggal terima kartu baru diisi**.
- Penerima: 担当 pekerja, salinan ke Admin TSK sebagai cadangan (belum dikonfirmasi TSK: pertanyaan 1).
- Tahap **dihitung saat ditampilkan**, tidak disimpan dan tidak memerlukan cron/pekerja latar. (Bila kelak ada email/LINE: tabel log pengiriman per (kartu, tahap) supaya sekali kirim; bukan sekarang.)

### 4.2 Fungsi murni (usulan: `src/db/zairyu.ts`, tanpa DB/React/zona waktu di dalamnya)

```ts
type CardStage = "none" | "prepare" | "can_apply" | "h30" | "h14" | "h7" | "expired" | "done";
cardStage(input: { expiryDate: string; receivedOn: string | null; today: string }): { stage: CardStage; daysLeft: number }
```

`today` = tanggal hari ini menurut zona organisasi (`organizations.timezone`, lewat `ymdIn(now, tz)`; TSK = Asia/Tokyo), dihitung PEMANGGIL, bukan fungsinya. `daysLeft = expiryDate - today` (hari kalender, bisa negatif).

| Syarat (urut dari atas, yang pertama cocok) | Tahap | Arti untuk staf |
|---|---|---|
| `receivedOn` terisi | `done` | selesai; tidak ada pengingat (kartu baru = baris baru) |
| `daysLeft < 0` | `expired` | sudah lewat; paling mendesak |
| `daysLeft <= 7` (0 s.d. 7; **hari terakhir masih berlaku**) | `h7` | |
| `daysLeft <= 14` | `h14` | |
| `daysLeft <= 30` | `h30` | |
| `today >= expiryDate − 3 bulan` | `can_apply` | boleh mengajukan perpanjangan |
| `today >= expiryDate − 4 bulan` | `prepare` | mulai menyiapkan berkas |
| selain itu | `none` | belum ada tindakan |

Pengurangan bulan = hari yang sama di bulan tujuan; bila tidak ada, **hari terakhir bulan itu** (31 Mei − 3 bulan = 28 Februari). Hanya kartu terkini dari pekerja ber-penempatan ACTIVE dan `status = active` yang dinilai.
Tahap tidak turun; urutan "naik" hanya karena waktu berjalan (tidak ada "mundur" kecuali kartu diganti `receivedOn`/baris baru).

### 4.3 Contoh kasus tepi (menjadi tes unit nanti)

| # | Kasus | Masukan | Hasil |
|---|---|---|---|
| 1 | Sudah lewat saat data dimasukkan | habis 2026-09-30, today 2026-10-06 | `expired`, daysLeft −6 (langsung teratas daftar; tidak ada "tahap yang terlewat" yang dikejar) |
| 2 | Pertama kali dimasukkan sudah dekat | habis 2026-10-14, today 2026-10-06 | `h14` (daysLeft 8); tahap `prepare`/`can_apply`/`h30` tidak diulang |
| 3 | Kartu diterima sebelum habis | habis 2027-03-31, `receivedOn` 2027-02-10, today 2027-03-01 | `done`; baris kartu baru (tanggal habis baru) membawa pengingat berikutnya |
| 4 | Hari terakhir | habis 2026-10-14, today 2026-10-14 | `h7` (daysLeft 0, masih berlaku); today 2026-10-15 → `expired` |
| 5 | Batas H-30 / H-14 / H-7 | habis 2027-05-31: today 2027-05-01 → `h30`; 05-17 → `h14`; 05-24 → `h7`; 04-30 → `can_apply` | batas inklusif |
| 6 | Akhir bulan (3 bln) | habis 2027-05-31 | `can_apply` mulai **2027-02-28**; `prepare` mulai **2027-01-31** |
| 7 | Akhir bulan (4 bln, hari ke-31) | habis 2027-03-31 | `prepare` mulai **2026-11-30** (bukan 12-01); `can_apply` mulai 2026-12-31 |
| 8 | Februari kabisat | habis 2028-02-29 | `prepare` 2027-10-29; `can_apply` 2027-11-29; `h30` 2028-01-30 |
| 9 | **Zona Tokyo vs Jakarta** | habis 2026-10-14; instan 2026-10-06 16:00 UTC = 10-07 01:00 Tokyo = 10-06 23:00 Jakarta | Tokyo: today 10-07 → `h7`. Jakarta: 10-06 → `h14`. **Pakai zona TSK** (tanggal kartu adalah tanggal Jepang); LPK bukan penerima pengingat |
| 10 | Pekerja berhenti | penempatan ENDED | tidak dinilai (tidak masuk KPI/daftar); kartu tetap tersimpan sebagai riwayat |
| 11 | Sudah diajukan tetapi belum diterima | `renewal_status = applied`, tanpa `receivedOn` | tahap tetap menurut tanggal (aturan TSK: berhenti hanya saat diterima); lencana "sudah diajukan" di daftar. Pertanyaan 2 menanyakan apakah pengingat perlu diturunkan |
| 12 | Tanggal terima di masa depan / sebelum tanggal ajukan | | ditolak (validasi + trigger) |

---

## 5. Tampilan (dalam aplikasi saja)

1. **KPI dashboard** (katalog widget tunggal `dashboard-catalog.ts`; satu fungsi hitung, dipakai KPI dan daftar supaya angka = daftar, seperti `viewCandidateIds`):
   - `kpi-card-urgent` "Kartu perlu tindakan segera": tahap `h30`, `h14`, `h7`, `expired` (+ `done` tidak dihitung). TSK_STAFF: milik 担当-nya; TSK_ADMIN: semua (salinan cadangan).
   - `kpi-card-prepare` "Kartu mulai disiapkan": tahap `prepare` + `can_apply`.
   - `kpi-card-missing` (hanya TSK_ADMIN): pekerja aktif **tanpa data kartu** (penting saat awal pemakaian; lihat 8, T-C).
2. **Daftar "perlu tindakan"** `/records/cards` (tab baru di Catatan kegiatan): urut tanggal habis terdekat, kolom pekerja, perusahaan, tanggal habis, sisa hari, tahap (lencana ikon + teks + warna + penjelasan `statusHelp`), status proses, 担当. Filter: tahap, "milikku", perusahaan, pekerja tanpa data. Kartu → kembali ke detail pekerja.
3. **Detail pekerja** (`/records/workers/<id>`): bagian "在留カード" (kartu terkini + tahap + tombol ubah status/tanggal ajukan + "Terima kartu baru" + riwayat kartu + riwayat edit).
4. Tidak ada email/LINE. Pengingat muncul di KPI, daftar, dan bagian detail. Teks UI id/ja lengkap (id tanpa huruf Jepang telanjang; istilah + romaji), target sentuh 44px, tabel → kartu di ponsel.

---

## 6. Rencana pemecahan (3 tugas implementasi + 1 opsional)

**T-A · Skema, aturan, dan jaga data** (tanpa UI)
- Migrasi `residence_cards` (+ migrasi SQL manual: GRANT, RLS, trigger penjaga, perluasan CHECK `activity_revisions.entity_type`), `src/db/zairyu.ts` (`cardStage`, `addMonths`, pemilihan kartu terkini), `ACTIONS` audit + `AUDIT_VALUE_FIELDS`, bagian baru `verify-rls`, bagian tabel di `verify:audit-coverage`.
- Selesai bila: tes unit mencakup SEMUA 12 kasus di 4.3 (isi angka, bukan hanya "tidak error"); `verify-rls` hijau (peran, UPDATE tanpa WHERE, tanpa DELETE, CHECK/trigger, kandidat tak terlihat ditolak); tabel ber-`candidate_id` lulus uji cascade/RESTRICT;
  tidak ada perubahan UI; `docs/zairyu-card.md` dimutakhirkan.

**T-B · Bagian di detail pekerja**
- Form kartu pertama, ubah status/tanggal ajukan, "Terima kartu baru" (SATU transaksi), void dengan alasan, riwayat kartu + riwayat edit, server action (zod + `ActionError` + audit), teks id/ja.
- Selesai bila: semua alur disimpan/diedit/dibatalkan; "Terima kartu baru" menghasilkan baris baru dan menghentikan pengingat lama; audit tanpa isi (dites); LPK/sensei 404; e2e (alur lengkap, ponsel 390px, bahasa); typecheck, build 0 peringatan, test:unit, test:rls, e2e, CI hijau.

**T-C · Daftar, KPI, dan data demo**
- `/records/cards`, widget `kpi-card-*` (satu fungsi untuk angka dan daftar), `seed:records` additive + `verify:seed` (campuran semua tahap + satu pekerja tanpa kartu), penerima = 担当 + Admin.
- Selesai bila: angka KPI = jumlah baris daftar (dites); filter tahap/milikku bekerja; staf tidak melihat milik orang lain di "milikku" tetapi Admin melihat salinan; menu per peran (LPK tidak ada di DOM); e2e + CI hijau.

**T-D (opsional, menunggu jawaban) · Isi awal data**
- Cara memasukkan kartu pekerja yang sudah bekerja (isi cepat per baris di daftar "tanpa data", atau tempel dari spreadsheet), bergantung pertanyaan 8.

Terpisah dan **tidak** dijadwalkan di sini: tampilan LPK (3.3), notifikasi email/LINE.

---

## 7. Risiko dan keputusan yang perlu dijaga

- Pengingat salah waktu = pelanggaran izin tinggal bagi pekerja: fungsi tahap WAJIB dites dengan semua kasus 4.3, dan zona waktu dihitung di satu tempat (`ymdIn` dengan zona organisasi).
- Pengingat tanpa data kartu tidak ada: karena itu KPI "tanpa data" (`kpi-card-missing`) dan T-D penting sebelum dipakai sungguhan.
- Data kartu = data pribadi: tidak masuk daftar/ekspor/log kandidat umum; cadangan di luar server tetap WAJIB berjalan sebelum data nyata masuk (`docs/backup.md`).

## 8. Perubahan glosarium

Ditambahkan ke `docs/glossary.md`: 在留資格, 在留期間, 在留期限, 在留期間更新許可申請, 特例期間, 担当 (penanggung jawab pekerja).

## 9. Pertanyaan untuk staf TSK (bernomor; bisa langsung diteruskan)

1. **Penerima pengingat.** Apakah benar: 担当 (staf penanggung jawab) pekerja menerima pengingat, dengan salinan ke Admin TSK? Salinan ke SEMUA Admin atau satu orang? Bila pekerja belum punya 担当, apakah cukup ke Admin?
   Dan apakah orang yang mengurus perpanjangan selalu 担当 yang sama, atau kadang orang lain (kalau lain, kita perlu kolom "pengurus perpanjangan" terpisah)?
2. **Setelah diajukan ke imigrasi** (status 申請中): pengingat H-30/H-14/H-7 tetap berjalan sampai kartu baru diterima (sesuai spreadsheet), atau sesudah diajukan cukup ditampilkan "menunggu hasil" tanpa menaikkan urgensi?
   Apakah masa 特例期間 (masa tinggal tambahan sampai hasil keluar) perlu ditampilkan?
3. **Jadwal.** Konfirmasi: persiapan 4 bulan, pengajuan bisa 3 bulan sebelum habis, H-30, H-14, H-7, dan "sesudah lewat". Untuk "sesudah lewat": tampil terus sampai kartu baru diterima, atau ada batasnya? Hari terakhir (tanggal habis) masih dihitung berlaku — benar?
4. **在留資格.** Jenis apa saja yang perlu dicatat: hanya 特定技能1号? Ada 特定技能2号, 技能実習, 特定活動, lainnya? Perlu juga 在留期間 (4か月 / 6か月 / 1年 dst.) selain tanggal habis?
5. **Langkah proses perpanjangan.** Apakah empat status cukup: belum mulai → persiapan berkas → sudah diajukan → kartu baru diterima? Perlu langkah lain, misalnya "berkas lengkap", "ada permintaan dokumen tambahan (追加資料)", "ditolak"?
6. **Nomor kartu dan foto kartu.** Apakah staf perlu menyimpannya di Hashi? Untuk apa (pengisian aplikasi online, pencocokan)? Rekomendasi kami: tidak disimpan. Bila perlu, apakah sudah dikonfirmasi gyōsei shoshi bahwa penyimpanan itu sah?
7. **Siapa boleh mengubah** data kartu: semua staf TSK, atau hanya 担当 pekerja itu dan Admin?
8. **Isi awal data.** Berapa pekerja aktif saat ini yang perlu dimasukkan? Lebih nyaman diisi satu per satu di aplikasi, atau ditempel dari spreadsheet (kolom: nama, tanggal habis, status proses)?
9. **LPK: "status visa" dan "tanggal tiba".** Nilai apa yang dimaksud "status visa" (mis. belum diajukan / sedang diproses / terbit / sudah tiba)? Dari mana tanggal tiba diketahui dan siapa yang mengisinya? Tampilan LPK adalah tugas terpisah.
10. **Tanggal terima kartu baru** = tanggal kartu fisik diambil/diterima pekerja atau staf? Dan siapa yang mencatatnya?
11. **Zona waktu.** Perhitungan H-30/H-14/H-7 memakai tanggal Jepang (Tokyo). Setuju?
12. **Notifikasi di luar aplikasi** (email/LINE): perlu di tahap berikutnya? Bila ya, kepada siapa dan di jam berapa?
