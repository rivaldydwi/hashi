# Lembar klien (langkah 6): profil klien dan lembar job order (PDF)

> **Status: DRAFT.** TSK belum punya format baku untuk lembar klien. Format ini rancangan pertama kita; label, urutan bagian, dan bagian yang tampil
> akan dikoreksi setelah staf TSK melihat hasilnya. Semua yang perlu diubah ada di SATU berkas: [`src/lib/pdf/client-sheet.config.ts`](../src/lib/pdf/client-sheet.config.ts).

## Fungsi
Dua dokumen PDF A4 berbahasa Jepang (font Noto Sans JP tersemat, header organisasi TSK, "n / N", tanggal pembuatan menurut zona waktu organisasi), dibuat dari data
Klien dan Job order yang sudah ada. Khusus TSK_ADMIN dan TSK_STAFF; LPK, sensei, dan super admin mendapat **404** pada rute ekspor (dan tidak melihat menu Klien/Job order).

| Dokumen | Dibuat dari | Tombol "Ekspor PDF" ada di | Rute |
|---|---|---|---|
| 取引先プロフィール (profil klien) | satu perusahaan (atau satu lokasi) | halaman perusahaan; halaman lokasi (membatasi ke lokasi itu) | `/sheet/company/<id>?mode=…&lang=…[&site=<id>]` |
| 求人票 (lembar job order) | satu job order | halaman job order | `/sheet/job-order/<id>?mode=…&lang=…` |

Tombol membuka dialog: **mode**, **bahasa label**, pratinjau isi PDF (dari model yang SAMA dengan PDF), petunjuk kelengkapan, dan (mode dibagikan) daftar yang sengaja tidak disertakan
serta centang konfirmasi. Nama berkas netral: `profil-klien-YYYYMMDD.pdf`, `lembar-job-order-YYYYMMDD.pdf`.

## Dua mode
| | 社内用 (Hanya internal) | 提供用 (Untuk dibagikan) |
|---|---|---|
| Telepon PIC | ya | **tidak** (hanya nama dan jabatan; di lembar job order PIC tidak ada sama sekali) |
| Catatan internal TSK (catatan perusahaan, lokasi, job order) | ya, bagian "備考（社内用）" | **tidak** |
| Syarat jenis kelamin | ya | **tidak** |
| Nama staf penyusun | ya | **tidak** |
| Tanda di header | 社内用 | 提供用 |

Mode dibagikan WAJIB centang "Saya sudah memeriksa bahwa dokumen ini boleh dikirim ke pihak luar (LPK, calon pekerja, atau klien)." Tanpa itu tombol unduh nonaktif, dan server menolak (`400`) permintaan
`mode=share` tanpa `confirm=1`. Bagian yang datanya kosong dilewati (tanpa "N/A" atau garis kosong); di pratinjau bagian yang dilewati ditandai, dan isian "Informasi untuk lembar" yang belum diisi
muncul sebagai petunjuk (tidak menghalangi ekspor).

**Opsi bahasa label:** *Jepang* (bawaan) atau *Jepang + Indonesia* ("法人名 / Nama badan usaha"). Isi data yang diketik tetap apa adanya (tidak diterjemahkan).

## Catatan hukum: syarat jenis kelamin
Syarat jenis kelamin pada dokumen yang dibagikan bisa bermasalah di Jepang untuk lowongan tertentu. Karena itu HANYA muncul pada versi internal. **Kebijakan ini perlu dikonfirmasi ke
行政書士 (gyōsei shoshi) atau penasihat hukum TSK sebelum dipakai untuk data nyata.**

## Data yang dipakai
- Kolom lama dipakai ulang, tidak digandakan: 業務内容 = `job_orders.description`, 基本給 = `job_orders.monthly_salary`, 補足 = `salary_note`, 勤務地 = `work_place` (bila kosong, alamat lokasi),
  catatan internal = `note`. Telepon lokasi = `client_sites.phone`. Tabel PIC = `client_site_contacts` (hanya nama, jabatan, telepon; **tidak ada email**).
- Kolom baru (migration 0021, semuanya opsional): `client_companies.industry / employee_count / foreign_worker_experience / public_intro`, `client_sites.access_note`,
  `job_orders.work_hours / days_off / housing (provided|allowance|none|unspecified) / housing_note / commute_note / benefits_note`. Diisi lewat bagian lipat "Informasi untuk lembar" di form perusahaan, lokasi, dan job order.
- "Lowongan terbuka" di profil klien = job order berstatus OPEN pada lokasi aktif; jumlah = posisi dikurangi yang sudah terpilih. Lokasi/PIC nonaktif tidak ikut.

## Audit
Setiap unduhan dicatat sebagai `client_sheet_export`: jenis dokumen, mode, bahasa label, jumlah halaman. **Tanpa** nama perusahaan, PIC, atau isi. Perubahan kolom baru memakai jejak yang ada
(`client_company.update`, `client_site.update`, `job_order.update`): hanya NAMA kolom, ditambah nilai pilihan `housing`; gaji dan teks bebas tidak pernah tersimpan di audit.

## Mengubah label dan urutan (`client-sheet.config.ts`)
- `LABELS`: pasangan `[Jepang, Indonesia]` untuk semua judul, bagian, dan kolom. Ubah teks Jepangnya di sini; pasangan Indonesia mengikuti `docs/glossary.md`.
- `SECTIONS`: urutan bagian tiap dokumen. Pindahkan/hapus baris untuk mengubah urutan/menyembunyikan bagian; `internalOnly: true` = hanya mode internal.
- `OPENING_COLUMNS`: kolom tabel lowongan di profil klien (dan `internalOnly`).
- `SHARE_EXCLUDES`: daftar yang ditampilkan dialog sebagai "sengaja tidak disertakan" (HARUS selaras dengan isi aturan di `client-sheet-model.ts`).
- `COMPLETENESS`: isian yang dicek untuk petunjuk kelengkapan (kunci pesan `sheet.missing.<kunci>`).
- Baris isi per bagian (kolom apa dalam tiap bagian) ada di `src/lib/pdf/client-sheet-model.ts` (`buildCompanySheet`, `buildJobOrderSheet`).

## Data demo
`npm run seed:client-sheet` MENGISI kolom baru yang masih kosong pada klien/job order dummy (tanpa reseed; idempoten; menolak bila ada organisasi non-dummy). Satu perusahaan (北斗) dan satu job order
OPEN (ホール・キッチンスタッフ) sengaja dibiarkan kosong untuk menguji bagian kosong dan petunjuk kelengkapan. `db:seed` memakai logika yang sama untuk lingkungan baru.
