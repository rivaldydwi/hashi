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
| 業務記録 | Gyōmu Kiroku | Catatan kerja harian | Laporan pekerjaan yang dikerjakan hari itu (Catatan kegiatan, tab 1) |
| 議事録・面談記録 | Gijiroku / Mendan Kiroku | Notulen dan catatan pertemuan | Laporan rapat/pertemuan, terutama dengan klien (tab 2) |
| 時系列 | Jikeiretsu | Kronologi kasus | Urutan kejadian satu kasus; bisa dikirim ke klien (tab 3) |
| 担当者 | Tantōsha | Penanggung jawab | Staf yang mengisi/menangani |
| 対象者 | Taishōsha | Pekerja yang terlibat | Subjek catatan: pekerja yang sedang bekerja di Jepang |
| 対応者 | Taiōsha | Staf yang hadir | Peserta pertemuan dari sisi TSK |
| 対応内容 | Taiō naiyō | Tindakan yang dilakukan | Isi penanganan |
| 結果・状況 | Kekka / jōkyō | Hasil dan keadaan | |
| 未対応・継続事項 | Mi-taiō / keizoku jikō | Yang belum selesai / berlanjut | Menjadi tugas tindak lanjut |
| 今後の対応 | Kongo no taiō | Rencana berikutnya | |
| 共有・報告先 | Kyōyū / hōkoku-saki | Dibagikan / dilaporkan ke | |
| 備考 | Bikō | Catatan tambahan | |
| 件名 | Kenmei | Perihal | |
| 日時 | Nichiji | Tanggal dan jam | |
| 所属先 | Shozoku-saki | Lokasi klien | Perusahaan/lokasi penempatan |
| 対象外 | Taishōgai | Tidak berlaku | Bulan yang tidak perlu wawancara berkala |
| 問題なし / 要フォロー / 問題あり / 未実施 | Mondai nashi / yō fōrō / mondai ari / mijisshi | Tidak ada masalah / perlu tindak lanjut / ada masalah / belum dilaksanakan | Status wawancara berkala |
| 定期面談 | Teiki Mendan | Wawancara berkala | Wawancara berkala pekerja (Catatan kegiatan, tab 4; langkah 7A) |
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
