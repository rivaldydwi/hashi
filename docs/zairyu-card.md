# Pelacak kartu izin tinggal (在留カード, Zairyū Kādo): desain

Status: **DESAIN (T-004), diperbarui di T-017 dan T-018**: skema, aturan hak tulis, audit, dan fungsi `cardStage` terimplementasi (migrasi 0025, `src/db/zairyu.ts`); **bagian di detail pekerja (T-018) terimplementasi** (migrasi 0026, `src/features/cards/`); daftar `/records/cards`, KPI dashboard, menu, dan data demo (T-019) terimplementasi. Bagian bertanda *(T-017)* mencatat jawaban staf TSK (Ghulam, 2026-10-07) dan apa yang berubah dari desain awal; bagian 9 memuat pertanyaan awal beserta jawabannya.

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

### 2.1 Tabel `residence_cards` (satu baris = satu kartu; riwayat = baris berurutan) *(T-017: terimplementasi, migrasi 0025)*

Perpanjangan berulang = **baris baru**, bukan menimpa. Baris lama tetap sebagai riwayat. Skema di `src/db/schema.ts` (`residenceCards`), aturan di migrasi `drizzle/0025_residence_cards.sql`.

| Kolom | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `id` | uuid PK | ya | |
| `organization_id` | uuid → organizations | ya | org TSK pemilik (RLS), tetap setelah dibuat |
| `candidate_id` | uuid → candidates (**RESTRICT**) | ya | pekerja; tetap setelah dibuat. RESTRICT (menghapus kandidat yang punya kartu ditolak; `candidates_block_delete` dan ringkasan `candidate_delete_summary().blocked` ikut) |
| `previous_card_id` | uuid → residence_cards | tidak | kartu yang digantikan; diisi saat dibuat, terkunci sesudahnya; paling banyak SATU pengganti aktif per kartu (indeks unik parsial) |
| `residence_status` | text + CHECK | ya, bawaan `ssw1` | 在留資格. Hanya `ssw1` (特定技能1号; jawaban TSK no. 4); kolom tetap ada untuk masa depan |
| `skill_field_id` | uuid → skill_fields (**RESTRICT**) | ya | bidang (介護, 飲食 dll). Bawaan UI = `candidates.field_id`, bisa diubah |
| `period_months` | integer 1-60 | tidak | 在留期間 dalam bulan; pilihan di SATU konfigurasi `PERIOD_OPTIONS` (`src/db/zairyu.ts`: 4, 6, 12) |
| `expiry_date` | date | ya | 在留期限 (tanggal kalender Jepang, tanpa jam; berlaku **sampai akhir hari itu**) |
| `renewal_status` | text + CHECK | ya, bawaan `not_started` | `not_started` (belum mulai) · `preparing` (persiapan berkas) · `applied` (申請中, sudah diajukan) · `additional_docs` (追加資料, diajukan dan diminta dokumen tambahan) · `received` (kartu baru diterima) · `rejected` (不許可, ditolak) |
| `additional_docs_on` | date | bila `additional_docs` | *(T-018, migrasi 0026)* tanggal imigrasi meminta dokumen tambahan (追加資料); tidak lebih awal dari `applied_on`, tidak di masa depan; terkunci pada kartu diterima |
| `rejected_on` | date | bila `rejected` | *(T-018, migrasi 0026)* tanggal permohonan ditolak (不許可); aturan sama |
| `applied_on` | date | bila status bukan `not_started`/`preparing` | tanggal pengajuan ke 入管. CHECK: `applied_on <= received_on`; tidak boleh di masa depan (trigger, tanggal Tokyo) |
| `received_on` | date | bila `received` | tanggal menerima kartu baru. CHECK: `(renewal_status = 'received') = (received_on is not null)`; tidak boleh di masa depan |
| `received_by` | `staff`/`worker` | bila `received` | kartu diambil **staf** lalu diserahkan ke pekerja, atau **pekerja mengambil sendiri** (jawaban no. 10). CHECK: terisi ⇔ `received` |
| `handed_over_on` | date | tidak | tanggal diserahkan ke pekerja; hanya bila `received_by = staff`, tidak lebih awal dari `received_on`, tidak di masa depan |
| `note` | text ≤ 2000 | tidak | catatan internal. Dilarang berisi nomor kartu atau data medis (teks bantuan di form) |
| `status` | text `active`/`void` | ya | pembatalan = `void` + `void_reason` (final), TANPA DELETE |
| `void_reason`, `voided_at`, `voided_by` | | bila void | |
| `version_no`, `updated_at`, `updated_by`, `created_at`, `created_by` | | ya | `created_by` diisi trigger dari `app.user_id` (tidak bisa dipalsukan) |

Aturan data (CHECK + trigger penjaga + RLS, bukan hanya aplikasi):
- **Satu kartu aktif "terkini" per pekerja** = baris `active` dengan `expiry_date` terbesar (seri: `created_at` terbaru): `currentCard()`. Hanya kartu terkini yang menghasilkan pengingat.
- INSERT: pekerja harus punya (atau pernah punya) penempatan di organisasi itu; kartu pengganti (`previous_card_id`) harus untuk pekerja/organisasi yang sama, asalnya `active` dan sudah `received`, dan `expiry_date` baru > lama.
- **"Terima kartu baru" = SATU transaksi**: baris lama jadi `received` **dan** baris baru (tanggal habis baru) dibuat. Ditegakkan DB lewat constraint trigger TERTUNDA: kartu `received` yang `active` WAJIB punya pengganti `active` saat commit.
- Kartu yang sudah `received` final: hanya `handed_over_on`, `received_by`, dan `note` yang bisa diubah. Kartu yang sudah punya pengganti, dan kartu pengganti dari kartu yang sudah diterima, **tidak bisa dibatalkan** (kartu pengganti masih bisa DIPERBAIKI datanya). Salah pada kartu yang diterima = perbaikan oleh admin database (jarang; dicatat di STATUS bila terjadi).
- `rejected` bukan akhir: staf bisa mengembalikan ke `preparing` bila mengajukan lagi (tahap `rejected` berhenti, pengingat berjalan lagi menurut tanggal).
- Riwayat edit: `activity_versioned_before_update('candidate_id,previous_card_id')` + `activity_write_revision('residence_card')` (`activity_revisions`; CHECK `entity_type` diperluas). Tanpa tabel riwayat baru.
- Nomor kartu dan foto kartu TIDAK disimpan di tabel ini (tugas terpisah T-020, lihat §2.3).

### 2.2 Penanggung jawab (担当): TIDAK disimpan di tabel kartu *(keputusan, T-017)*

Kebutuhan awal menyebut kolom 担当. **Rekomendasi: jangan membuat kolom**, turunkan dari penanggung jawab efektif T-010 (`effectiveResponsible`: per pekerja > per perusahaan > tidak ada).
Alasan: satu sumber kebenaran (pekerja pindah perusahaan atau 担当 diganti = pengingat ikut otomatis), tanpa dua daftar yang bisa berbeda, dan beban kerja per staf (batas 50) tetap konsisten.
Kekurangan: staf yang mengurus perpanjangan tidak bisa berbeda dari 担当 pekerja. Bila TSK memang butuh itu, tambahkan kolom `handler_id` opsional (bukan sekarang): pertanyaan 1.

### 2.3 Nomor kartu dan foto kartu: pro/kontra dan rekomendasi

| | Pro | Kontra |
|---|---|---|
| **Nomor kartu** (12 karakter) | Mempermudah cek keabsahan kartu di situs imigrasi; mungkin dibutuhkan pengisian aplikasi online | Data pribadi sensitif; pengingat TIDAK membutuhkannya; dampak kebocoran tinggi (dipakai untuk pemalsuan/pemantauan); wajib enkripsi + audit akses seperti My Number |
| **Foto/pindaian kartu** | Bukti fisik, memudahkan pengisian berkas | Memuat foto wajah, alamat, nomor; harus memakai pola dokumen terenkripsi, batas akses, kebijakan retensi; "hapus" tidak mungkin pada catatan 5 tahun |

**KEPUTUSAN (T-020, jawaban TSK no. 6): nomor kartu dan foto kartu HARUS disimpan.** (Rekomendasi awal di versi sebelumnya: tidak disimpan.) Karena itu keduanya disimpan dengan aturan ketat:
- **Tabel terpisah** `residence_card_secrets` (nomor, 1:1 per kartu) dan `residence_card_photos` (foto depan/belakang), bukan kolom di `residence_cards`: daftar, KPI, ekspor, PDF, dan snapshot riwayat edit tidak pernah memuatnya.
- **Enkripsi di level aplikasi**, AES-256-GCM, nonce acak per nilai, kunci `CARD_DATA_KEY` (BARU, bukan `AUTH_SECRET`, bukan kunci cadangan), `key_id` tercatat supaya kunci bisa diganti; AAD mengikat sandi pada kartu/fotonya. CHECK database menolak nomor polos. Nomor tersamar `AB********CD` disimpan terpisah untuk tampilan. Foto: jenis dari isi berkas (JPG/PNG/PDF, maks 10 MB), `sharp` membuang EXIF/GPS, berkas terenkripsi di `docs-data/cards/<org>/<id>.enc`.
- **Siapa yang berhak**: HANYA TSK_ADMIN dan 担当 efektif pekerja (`card_editor`), untuk baca DAN tulis, ditegakkan RLS (staf TSK lain, TSK lain, LPK, sensei, super admin: 0 baris; dites `verify-rls` bagian Y). UI: nomor tersamar + tombol "Tampilkan" (hilang otomatis 30 detik); foto diunduh lewat route handler (`attachment`, `nosniff`, tanpa cache).
- **Audit** (log org TSK, tanpa nilai): `residence_card.number_set|number_view|number_remove`, `photo_set|photo_view|photo_remove` (hanya sisi depan/belakang). Entri dicatat SEBELUM nilai/berkas dikembalikan; audit gagal = tidak ada tampilan.
- **Siklus hidup**: kartu dibatalkan (void) = nomor dihapus dan foto ditandai dihapus (berkas disk dibuang); kartu aktif (juga yang sudah diterima) boleh ganti nomor/foto. Foto tidak punya DELETE fisik di tabel (baris tetap sebagai jejak, berkas sandinya yang dibuang).
- **Kunci hilang = data tidak bisa dipulihkan**; aplikasi menolak start di produksi tanpa kunci. Lihat `docs/backup.md` bagian 7.
Bila kelak terbukti sah dan perlu: kolom dienkripsi, opsional, hanya Admin TSK, setiap akses tercatat di audit, tidak masuk daftar/ekspor/PDF/log (sama dengan aturan My Number di `CLAUDE.md`),
dan dicek ke gyōsei shoshi dulu (pertanyaan 6).

---

## 3. Hak akses

### 3.1 RLS (pola `activity_member()`; hak tulis lewat `card_editor`) *(T-017: terimplementasi)*

| Peran | Baca | Tulis |
|---|---|---|
| TSK_ADMIN org pemilik | semua kartu org-nya | INSERT/UPDATE semua pekerja org-nya |
| TSK_STAFF org pemilik | semua kartu org-nya | INSERT/UPDATE **hanya untuk pekerja yang ia 担当** (penanggung jawab EFEKTIF, T-010); selain itu ditolak RLS (jawaban TSK no. 7) |
| LPK_ADMIN, LPK_SENSEI, super admin (jalur aplikasi), peran `null`, TSK lain | **0 baris** | ditolak |

- `card_editor(candidate_id)` (SQL, `SECURITY DEFINER` sempit, hanya mengembalikan boolean): penetapan per PENEMPATAN terbaru yang berlaku (`effective_from` ≤ hari ini menurut zona organisasi; seri: dibuat terakhir) bila terisi, kalau tidak (tidak ada atau dikosongkan = "ikut perusahaan") penetapan per PERUSAHAAN. Hanya penempatan AKTIF di organisasi sesi.
  Logikanya SAMA dengan `effectiveResponsible` (TS); `verify-rls` membandingkan keduanya pada semua penempatan aktif seed. Pergantian 担当 berlaku seketika: 担当 lama tidak bisa menulis lagi.
- `void` dihitung sebagai penulisan (UPDATE), jadi mengikuti aturan yang sama (bukan "pembuat atau TSK_ADMIN" seperti rancangan awal).
- `ENABLE` + `FORCE ROW LEVEL SECURITY`; `GRANT SELECT, INSERT, UPDATE` saja ke `hashi_app` (**tanpa DELETE**).
- UI (T-018 dst.): menu "Kartu" dan rute `/records/cards` hanya untuk TSK (peran lain 404, menu tidak ada di DOM).
- `verify-rls` bagian X: tulis oleh 担当 dan Admin, staf lain ditolak (INSERT, UPDATE dengan/tanpa WHERE), pergantian 担当, perusahaan sebagai cadangan, kesetaraan SQL vs TS, tanpa DELETE, CHECK/trigger, atomik, final, riwayat, peran lain 0 baris; tabel ber-`candidate_id` masuk bagian I dan uji RESTRICT.

### 3.2 Audit (tanpa isi) *(T-017: aksi dan nilai terdaftar)*

`residence_card.create`, `residence_card.update`, `residence_card.receive` ("Terima kartu baru"), `residence_card.void`, di log org TSK saja. Sudah ada di `ACTIONS` (`audit-describe.ts`, kalimat id + ja, dites); server action pemanggilnya ada di T-018 dan WAJIB lolos `verify:audit-coverage`.
Nilai yang boleh dicatat (`AUDIT_VALUE_FIELDS.residence_card`): `residenceStatus` (kode), `renewalStatus`, `stage` (kode tahap), `receivedBy`, `status`. **Tidak** dicatat: tanggal (habis/ajukan/terima), catatan,
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

### 4.2 Fungsi murni *(T-017: `src/db/zairyu.ts`, tanpa DB/React/zona waktu di dalamnya)*

```ts
cardStage({ expiryDate, renewalStatus, receivedOn?, today }): { stage: CardStage; daysLeft: number; additionalDocs: boolean; specialUntil: string | null }
```

`today` = tanggal hari ini menurut zona organisasi (`organizations.timezone`, lewat `ymdIn(now, tz)`; TSK = Asia/Tokyo), dihitung PEMANGGIL. `daysLeft = expiryDate − today` (hari kalender, bisa negatif).

| Syarat (urut dari atas, yang pertama cocok) | Tahap | Arti untuk staf |
|---|---|---|
| `renewalStatus = received` (atau `receivedOn` terisi) | `done` | selesai; tidak ada pengingat (kartu baru = baris baru) |
| `renewalStatus = rejected` (不許可) | `rejected` | **perhatian**; menghentikan pengingat biasa |
| `applied` / `additional_docs` dan `today > expiry + 2 bulan` | `special_overdue` | **perhatian**: lewat batas 特例期間 dan belum ada hasil (`specialUntil` = batas itu) |
| `applied` / `additional_docs` (selain di atas) | `waiting_result` (結果待ち) | menunggu hasil; **tahap TIDAK naik lagi** (H-30/H-14/H-7 tidak berlaku); `additionalDocs = true` bila 追加資料; bila tanggal habis sudah lewat, `specialUntil` = habis + 2 bulan (特例期間 ditampilkan) |
| `daysLeft < 0` | `expired` | sudah lewat, belum diajukan; mendesak |
| `daysLeft <= 7` (0 s.d. 7; **hari terakhir masih berlaku**) | `h7` | |
| `daysLeft <= 14` | `h14` | |
| `daysLeft <= 30` | `h30` | |
| `today >= expiryDate − 3 bulan` | `can_apply` | boleh mengajukan perpanjangan |
| `today >= expiryDate − 4 bulan` | `prepare` | mulai menyiapkan berkas |
| selain itu | `none` | belum ada tindakan |

Pengurangan/penambahan bulan = hari yang sama di bulan tujuan; bila tidak ada, **hari terakhir bulan itu** (31 Mei − 3 bulan = 28 Februari; 31 Desember + 2 bulan = 28 Februari). Batas 特例期間 inklusif (hari ke-habis+2 bulan masih `waiting_result`).
Hanya kartu terkini dari pekerja ber-penempatan ACTIVE dan `status = active` yang dinilai. Status `not_started`/`preparing` memakai jadwal yang sama.
Pembantu lain di berkas yang sama: `addMonths`/`addDays`/`daysBetween`, `currentCard`, `cardRecipients` (担当 efektif + semua TSK_ADMIN, tanpa duplikat), `PERIOD_OPTIONS`, `RENEWAL_STATUSES`, `STAGE_URGENCY` (urutan daftar), `ATTENTION_STAGES` (h30, h14, h7, expired, rejected, special_overdue; `waiting_result` bukan tindakan).

### 4.3 Contoh kasus tepi (semuanya menjadi tes unit `tests/unit/zairyu.test.ts`, dengan angka)

| # | Kasus | Masukan | Hasil |
|---|---|---|---|
| 1 | Sudah lewat saat data dimasukkan | habis 2026-09-30, today 2026-10-06 | `expired`, daysLeft −6 (langsung teratas daftar; tidak ada "tahap yang terlewat" yang dikejar) |
| 2 | Pertama kali dimasukkan sudah dekat | habis 2026-10-14, today 2026-10-06 | `h14` (daysLeft 8); tahap `prepare`/`can_apply`/`h30` tidak diulang |
| 3 | Kartu diterima sebelum habis | habis 2027-03-31, `received`, `receivedOn` 2027-02-10, today 2027-03-01 | `done`; baris kartu baru (tanggal habis baru) membawa pengingat berikutnya |
| 4 | Hari terakhir | habis 2026-10-14, today 2026-10-14 | `h7` (daysLeft 0, masih berlaku); today 2026-10-15 → `expired` |
| 5 | Batas H-30 / H-14 / H-7 | habis 2027-05-31: today 2027-05-01 → `h30`; 05-17 → `h14`; 05-24 → `h7`; 04-30 → `can_apply` | batas inklusif |
| 6 | Akhir bulan (3 bln) | habis 2027-05-31 | `can_apply` mulai **2027-02-28**; `prepare` mulai **2027-01-31** |
| 7 | Akhir bulan (4 bln, hari ke-31) | habis 2027-03-31 | `prepare` mulai **2026-11-30** (bukan 12-01); `can_apply` mulai 2026-12-31 |
| 8 | Februari kabisat | habis 2028-02-29 | `prepare` 2027-10-29; `can_apply` 2027-11-29; `h30` 2028-01-30 |
| 9 | **Zona Tokyo vs Jakarta** | habis 2026-10-14; instan 2026-10-06 16:00 UTC = 10-07 01:00 Tokyo = 10-06 23:00 Jakarta | Tokyo: today 10-07 → `h7`. Jakarta: 10-06 → `h14`. **Pakai zona TSK** (tanggal kartu adalah tanggal Jepang); LPK bukan penerima pengingat |
| 10 | Pekerja berhenti | penempatan ENDED | tidak dinilai (di luar fungsi: pemanggil hanya memberi kartu pekerja berpenempatan ACTIVE) |
| 11 | **Sudah diajukan (revisi T-017)** | habis 2026-10-14, `applied`, today 2026-10-06 / 10-13 / 10-14 | `waiting_result` di semuanya (tahap tidak naik); sebelumnya (rancangan awal) naik ke H-14/H-7 |
| 12 | **Diajukan lalu lewat tanggal habis = 特例期間** | habis 2026-09-30, `applied`, today 2026-10-06 | `waiting_result`, daysLeft −6, `specialUntil` 2026-11-30; habis 2026-12-31 → `specialUntil` 2027-02-28 (clamp) |
| 13 | **Lewat batas 特例期間** | habis 2026-09-30, `applied`: today 2026-11-30 → `waiting_result`; 2026-12-01 → `special_overdue` | batas inklusif; `specialUntil` 2026-11-30 |
| 14 | **追加資料** | habis 2026-10-14, `additional_docs`, today 2026-10-06 | `waiting_result` + `additionalDocs = true`; tetap berlaku di 特例期間 dan `special_overdue` |
| 15 | **不許可** | `rejected`: habis 2027-12-31/today 2026-10-06, atau habis 2026-09-30/today 2027-06-01 | `rejected` di semuanya (perhatian, pengingat biasa berhenti) |
| 16 | **Diambil pekerja sendiri** | `received`, `received_by = worker` | `done` sama dengan diambil staf; `received_by` tidak memengaruhi tahap (hanya mencatat; `handed_over_on` hanya untuk `staff`) |
| 17 | Terima sesudah lewat 特例期間 | `received`, receivedOn 2026-12-20, today 2026-12-31 | `done` |

## 5. Tampilan (dalam aplikasi saja)

1. **KPI dashboard** (katalog widget tunggal `dashboard-catalog.ts`; satu fungsi hitung, dipakai KPI dan daftar supaya angka = daftar, seperti `viewCandidateIds`):
   - `kpi-card-urgent` "Kartu perlu tindakan segera": tahap `h30`, `h14`, `h7`, `expired` (+ `done` tidak dihitung). TSK_STAFF: milik 担当-nya; TSK_ADMIN: semua (salinan cadangan).
   - `kpi-card-prepare` "Kartu mulai disiapkan": tahap `prepare` + `can_apply`.
   - `kpi-card-missing` (hanya TSK_ADMIN): pekerja aktif **tanpa data kartu** (penting saat awal pemakaian; lihat 8, T-C).
2. **Daftar "perlu tindakan"** `/records/cards` (tab baru di Catatan kegiatan): urut tanggal habis terdekat, kolom pekerja, perusahaan, tanggal habis, sisa hari, tahap (lencana ikon + teks + warna + penjelasan `statusHelp`), status proses, 担当. Filter: tahap, "milikku", perusahaan, pekerja tanpa data. Kartu → kembali ke detail pekerja.
3. **Detail pekerja** (`/records/workers/<id>`): bagian "在留カード" (kartu terkini + tahap + tombol ubah status/tanggal ajukan + "Terima kartu baru" + riwayat kartu + riwayat edit).
4. Tidak ada email/LINE. Pengingat muncul di KPI, daftar, dan bagian detail. Teks UI id/ja lengkap (id tanpa huruf Jepang telanjang; istilah + romaji), target sentuh 44px, tabel → kartu di ponsel.

---

## 6. Rencana pemecahan *(diperbarui T-017)*

- **T-017 · A: skema, aturan, `cardStage`, audit, `verify-rls`: SELESAI (tanpa UI).** Migrasi 0025, `src/db/zairyu.ts`, entri audit `residence_card.*`, bagian X `verify-rls`, tes unit semua kasus §4.3.
- **T-018 · B: bagian di detail pekerja: SELESAI.** `/records/workers/<id>` memuat bagian "在留カード" (`src/features/cards/`): kartu pertama (bidang bawaan dari `candidates.field_id`, 在留期間 dari `PERIOD_OPTIONS`, tanggal habis), ubah status proses (tanggal pengajuan/追加資料/不許可 wajib sesuai status; catatan dengan pola nomor kartu ditolak), "Terima kartu baru" atomik (+ diterima oleh staf/pekerja, tanggal serah), catat penyerahan, batalkan dengan alasan, riwayat kartu + riwayat edit, tanda 追加資料 dan 特例期間. Ubah/terima/batalkan hanya tampil untuk 担当 efektif + Admin; staf lain baca-saja dengan penjelasan; server menolak (`cards.errors.notEditor`) bila hak hilang di tengah jalan. Validasi murni di `src/features/cards/input.ts` (dites unit); migrasi 0026 menambah `additional_docs_on` dan `rejected_on`.
- **T-019 · C: daftar, KPI, menu, data demo: SELESAI.** `/records/cards` (tab Catatan kegiatan + menu sidebar "Kartu izin tinggal", menggantikan "Segera hadir"): kelompok `urgent` / `prepare` / `waiting` / `missing` + semua, filter "milikku" (担当 efektif), perusahaan, tahap; urut paling mendesak (`compareCardItems`).
  KPI dashboard `kpi-card-urgent`, `kpi-card-prepare`, `kpi-card-waiting` (staf TSK) dan `kpi-card-missing` (hanya Admin). **Satu sumber angka**: `loadCardRows` (`src/db/zairyu-queries.ts`, pekerja AKTIF + kartu terkini + tahap + 担当) + `matchesView`/`countViews` (`src/db/zairyu.ts`); staf menghitung pekerja yang ia 担当 (tautan KPI membawa `&mine=1`), Admin semua.
  Definisi: `urgent` = `isActionNeeded` (h30, h14, h7, expired, rejected, special_overdue, dan menunggu hasil DENGAN 追加資料); `waiting` = menunggu hasil TANPA 追加資料 (tidak ganda dengan `urgent`); `prepare` = prepare + can_apply; `missing` = pekerja aktif tanpa kartu aktif. Seed: w0 = H-14 dengan rantai kartu (lama diterima staf lalu diserahkan), w1 = 追加資料, w2 = tanpa data.
- **T-020: nomor dan foto kartu** (jawaban TSK no. 6: HARUS disimpan): kolom dienkripsi, hanya yang berhak, akses tercatat, tidak masuk daftar/ekspor/log; desain enkripsi dan siapa yang berhak dikerjakan di tugas itu.
- **T-021: isi awal/massal** mengikuti form PDF imigrasi (perorangan + grup), DITAHAN sampai Ipal mengirim form PDF-nya.
- Terpisah dan belum dijadwalkan: tampilan LPK (§3.3), email pengingat (jawaban no. 12: hanya untuk pengingat daftar/perbarui kartu ke staf, Admin, pekerja; menunggu keputusan Ipal soal layanan email berbiaya dan email pekerja sebagai data pribadi).

## 7. Risiko dan keputusan yang perlu dijaga

- Pengingat salah waktu = pelanggaran izin tinggal bagi pekerja: fungsi tahap WAJIB dites dengan semua kasus 4.3, dan zona waktu dihitung di satu tempat (`ymdIn` dengan zona organisasi).
- Pengingat tanpa data kartu tidak ada: karena itu KPI "tanpa data" (`kpi-card-missing`) dan T-D penting sebelum dipakai sungguhan.
- Data kartu = data pribadi: tidak masuk daftar/ekspor/log kandidat umum; cadangan di luar server tetap WAJIB berjalan sebelum data nyata masuk (`docs/backup.md`).

## 8. Perubahan glosarium

Ditambahkan ke `docs/glossary.md`: 在留資格, 在留期間, 在留期限, 在留期間更新許可申請, 特例期間, 担当 (penanggung jawab pekerja); T-017: 結果待ち, 追加資料, 不許可.

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

### 9.1 Jawaban staf TSK (Ghulam, 2026-10-07) dan akibatnya *(T-017)*

| No | Jawaban | Akibat |
|---|---|---|
| 1 | Pengingat ke 担当 **wajib**; salinan ke manajer/Admin | Penerima = 担当 efektif + semua TSK_ADMIN (`cardRecipients`) |
| 2 | Setelah diajukan cukup tampil **結果待ち** | Tahap `waiting_result` (tidak naik lagi) |
| 3 | 特例期間 ditampilkan bila diperlukan (tafsiran PM) | `specialUntil` bila tanggal habis lewat; lewat batas = `special_overdue` |
| 4 | Hanya **特定技能1号** + bidangnya; **在留期間 dicatat** | `residence_status = ssw1`, `skill_field_id`, `period_months` |
| 5 | Status: belum mulai, persiapan, diajukan, **追加資料**, diterima, **ditolak** | Enam nilai `renewal_status` |
| 6 | Nomor dan foto kartu **harus disimpan** | T-020 (enkripsi + akses terbatas); T-017 TIDAK menyimpannya |
| 7 | Yang boleh mengubah: **担当 + Admin** | RLS lewat `card_editor` |
| 8 | Isian mengikuti form PDF imigrasi (perorangan + grup) | T-021 (ditahan, menunggu form PDF dari Ipal) |
| 9 | LPK hanya melihat yang dibuat TSK | Tetap §3.3 (belum dijadwalkan) |
| 10 | Kartu diambil **staf** lalu diserahkan; opsi **pekerja mengambil sendiri** | `received_by`, `handed_over_on` |
| 11 | Tanggal Jepang | Zona organisasi TSK (Tokyo) |
| 12 | Email hanya untuk pengingat daftar/perbarui kartu; progres cukup di Hashi | Tugas email terpisah, menunggu keputusan Ipal; T-017 s.d. T-019 hanya dalam aplikasi |


## 10. Email pengingat (T-022)

Jawaban TSK no. 12: email HANYA untuk pengingat mendaftarkan/memperbarui kartu; progres setelah diajukan cukup di Hashi (imigrasi mengirim email sendiri).

- **Pemicu**: tahap kartu (`cardStage`) masuk `prepare`, `can_apply`, `h30`, `h14`, `h7`, `expired`, `special_overdue`, `rejected`, atau tanda 追加資料 (`additional_docs`; tahap `waiting_result` biasa tidak dikirim). Hanya tahap SAAT INI yang dipertimbangkan (tahap yang terlewat tidak dikejar).
- **Sekali per (kartu, tahap, penerima)**: tabel `card_reminder_log` (migration 0028, unik; tanpa isi email/alamat; hanya jalur sistem yang membaca/menulis, RLS tanpa policy untuk peran aplikasi). Penerima sendiri bagian dari kuncinya supaya kegagalan kirim ke satu penerima bisa dicoba ulang tanpa mengirim ganda ke yang lain. Dicatat SETELAH email ke penerima itu berhasil terkirim.
- **Satu email ringkasan per penerima per hari** (bukan satu per kartu). Penerima = `cardRecipients` (担当 efektif + semua Admin TSK aktif). Bahasa mengikuti `users.locale` (id atau ja). Isi: nama pekerja, tahap, sisa hari, tautan ke halaman pekerja (bila `APP_URL` terisi). TIDAK memuat nomor kartu, catatan, atau data lain; pekerja belum menerima email (butuh email pekerja + persetujuan: tugas terpisah).
- **Penjadwal**: service `worker` di project compose `hashi` (`scripts/reminder-worker.ts`, image `tools`), jalan terus; tiap hari 08:00 Asia/Tokyo (tanpa cron/systemd sistem). Saat mulai (mis. setelah deploy) dan sudah lewat 08:00 menyusul sekali (aman karena log unik). Data dibaca lewat `withTenant` sebagai Admin TSK organisasi itu (aturan dan fungsi yang SAMA dengan daftar/KPI: `loadCardRows`).
- **SMTP** dari env: `SMTP_URL`, `MAIL_FROM`, `APP_URL`. **Tanpa `SMTP_URL` = mode kering**: tidak ada email dan tidak ada log pengiriman; hanya baris log "akan dikirim" tanpa alamat. Produksi tetap kering sampai akun SMTP siap. Uji: Mailpit (`compose.dev.yaml`, juga service CI).
- **Audit** `residence_card.reminder_sent` (per kartu+tahap: tahap + jumlah penerima, tanpa alamat; pelaku = sistem).


## 11. Data perpanjangan online siap salin (T-021)

Keputusan Ipal (7 Okt 2026): perpanjangan diajukan **online** (在留申請オンラインシステム), **hanya perorangan** (form grup = COE ditunda). Acuan: 在留期間更新許可申請書, halaman 申請人等作成用1. Keluarannya BUKAN PDF formulir, melainkan halaman per pekerja berisi isian yang tinggal disalin.

- **Halaman** `/records/workers/<id>/renewal` (`src/app/(app)/records/workers/[candidateId]/renewal/page.tsx`): hanya 担当 efektif + TSK_ADMIN (staf lain, LPK, sensei, super admin: 404). Butir 1-14 berlabel Jepang (+ Indonesia kecil), tiap nilai punya tombol **Salin**; butir 15 (riwayat pidana) dan 16 (keluarga di Jepang) HANYA pengingat, tidak disimpan. Membuka halaman dicatat `residence_card.renewal_view` (tanpa nilai).
- **Pemetaan** (murni, dites): `src/db/renewal.ts` `buildRenewal`: 1 国籍 (インドネシア), 2 生年月日 (西暦 `yyyy/mm/dd` + 和暦), 3 氏名 (KAPITAL tanpa aksen; marga/nama = PERKIRAAN: kata terakhir marga, nama tunggal = marga saja; cocokkan dengan paspor), 4 性別 (男/女), 5 配偶者の有無 (menikah = 有, selain itu 無), 6 職業 (会社員), 7 本国における居住地 (alamat Indonesia dari profil), 8-9 alamat dan telepon di Jepang, 10 paspor (nomor + masa berlaku), 11 在留資格 (特定技能1号) + 在留期間 + 満了日 dari kartu, 12 nomor kartu, 13 在留期間 yang diminta (bawaan = 在留期間 kartu sekarang), 14 alasan (templat bawaan; bisa diubah di halaman dan TIDAK disimpan).
- **Butir kosong** ditandai "Belum terisi" + tautan ke tempat mengisinya (profil kandidat, data kartu, data Jepang). Peringatan: paspor sudah kedaluwarsa, atau habis sebelum/pada 満了日 kartu, atau belum ada data kartu.
- **Nomor kartu (butir 12)** tidak pernah ada di halaman: hanya lewat tombol "Tampilkan" yang sama dengan T-020 (audit `residence_card.number_view` sebelum nilai kembali), lalu bisa disalin.
- **Data Jepang pekerja**: tabel `worker_jp_profiles` (migration 0029; alamat tinggal + telepon/HP; milik TSK, satu baris per pekerja; baca = staf TSK organisasi sama, tulis = 担当 + Admin lewat `card_editor`; BUKAN di `candidate_private` karena LPK tidak perlu melihatnya). Form ubah di `/records/workers/<id>` (`JpProfileSection`); audit `worker_jp_profile.update` hanya NAMA kolom. `verify-rls` bagian AA.
- **Tautan** ke halaman ini dari bagian kartu di detail pekerja dan dari baris `/records/cards` pada tahap `prepare` s.d. `expired` (hanya yang berhak).
- **Pengambilan kartu (結果待ち)**: teks bantuan statis di bagian kartu (pemberitahuan hasil, paspor, kartu lama, biaya).
- **手数料納付書 (PDF) TIDAK dibuat**: sejak **1 Oktober 2026** pengajuan ONLINE membayar biaya lewat **pembayaran konbini atau bank** setelah email panduan dari imigrasi (pengirim resmi no-reply@service-dgft.com); **収入印紙 tidak berlaku** untuk pengajuan online (sumber: halaman resmi 出入国在留管理庁 tentang perubahan biaya per 2026-10-01). Surat pembayaran biaya + materai hanya masih dipakai untuk pengajuan di LOKET. Karena alur yang diputuskan Ipal adalah online, formulir itu tidak relevan; daftar pengambilan kartu disesuaikan. Bila TSK masih butuh cadangan jalur loket, dibuat sebagai tugas terpisah.
