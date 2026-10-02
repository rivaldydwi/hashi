# Kamus istilah Hashi

Aturan: **teks Indonesia tidak memuat huruf Jepang telanjang** (`npm run test:i18n` menolaknya; satu-satunya pengecualian adalah
nama bahasa "日本語" di pemilih bahasa). Pengguna LPK membaca bahasa Indonesia; istilah Jepang ditulis sebagai istilah Indonesia/Inggris
yang jelas, lalu cara baca (romaji) dalam tanda kurung bila perlu supaya bisa dicocokkan dengan dokumen atau staf TSK.
Teks Jepang (`messages/ja.json`) memakai istilah Jepang aslinya. Istilah baru: tambahkan di sini DAN di kedua berkas pesan.

| Jepang | Cara baca | Teks Indonesia di UI | Keterangan |
|---|---|---|---|
| 登録支援機関 | Tōroku Shien Kikan | TSK | Lembaga pendukung terdaftar; pengguna Hashi sisi Jepang |
| 監理団体・LPK | — | LPK | Lembaga pelatihan kerja di Indonesia |
| 配属先 | haizoku-saki | Klien / perusahaan penerima | Perusahaan tempat kandidat ditempatkan |
| 配属 | haizoku | Penempatan | Catatan penempatan aktif seorang pekerja |
| 法人 / 法人名 | hōjin / hōjin-mei | Perusahaan / nama perusahaan | Badan hukum klien |
| 事業所 / 事業所名 | jigyōsho / jigyōsho-mei | Lokasi kerja / nama lokasi | Cabang atau fasilitas klien |
| 求人 / 求人名 | kyūjin / kyūjin-mei | Job order (lowongan) | Permintaan tenaga kerja dari klien |
| 面談 | mendan | Wawancara | Wawancara bulanan LPK, wawancara TSK, wawancara berkala |
| 評価 | hyōka | Penilaian | |
| 就労開始日 | shūrō kaishibi | Tanggal mulai kerja | Kolom penempatan |
| 自己PR | jiko PR | Promosi diri | Bagian "Tentang kandidat" |
| 特定技能 | Tokutei Ginō | SSW (Specified Skilled Worker) | Program visa kerja terampil |
| 技能実習・育成就労 | Ginō Jisshū / Ikusei Shūrō | Magang / Ikusei | Program magang dan penggantinya |
| 管理者 / 施設長 | kanrisha / shisetsuchō | Manajer / kepala fasilitas | Contoh jabatan PIC klien |
| 在留カード | Zairyū Kādo | Residence Card | Kartu izin tinggal (fitur langkah 7) |
| 定期面談 | Teiki Mendan | Wawancara berkala | Fitur langkah 7 |
| 入管 | Nyūkan | Imigrasi | |
| 行政書士 | Gyōsei Shoshi | Pengurus administrasi hukum (Gyōsei Shoshi) | Dipakai di catatan internal saja |

## Istilah status (Indonesia ⇄ Jepang)

| Kode | Indonesia | Jepang |
|---|---|---|
| STUDYING | Belajar | 学習中 |
| READY | Siap seleksi | 選考準備完了 |
| WITHDRAWN | Mundur | 辞退 |
| NONE | Belum diputuskan | 未判断 |
| SHORTLISTED | Masuk shortlist | 候補リスト入り |
| PASSED_TSK_INTERVIEW | Lulus wawancara TSK | 支援機関面接合格 |
| SUBMITTED_TO_CLIENT | Diajukan ke klien | 企業へ推薦済み |
| PASSED_CLIENT_INTERVIEW | Lulus interview klien | 企業面接合格 |
| DOCUMENT_PROCESS | Proses dokumen | 書類手続き中 |
| DEPARTED | Berangkat | 渡航済み |
| REJECTED | Ditolak | 見送り |
