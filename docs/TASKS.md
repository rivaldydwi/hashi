# Tugas engineer

Ditulis dan diurutkan oleh **PM**. Engineer hanya membaca berkas ini (laporan ke `docs/STATUS.md`). Aturan siklus ada di `CLAUDE.md`,
bagian "Peran dan aturan kerja".

**Status:** `SIAP` (boleh diambil) · `DITAHAN` (menunggu keputusan Ipal/pihak luar, jangan diambil) · `SELESAI` (PR sudah di-merge).
Ambil tugas `SIAP` **paling atas**. Satu tugas = satu branch `eng/<ID>-<slug>` = satu PR berjudul `[<ID>] …`.

Terakhir diperbarui PM: 2026-10-06 (setelah review T-003).

---

## Antrean

### T-006 · Skrip deploy + `.gitignore` izin lokal · `SIAP`

Dari usulan T-005: perintah deploy mudah lupa `GIT_SHA`, dan `.claude/settings.local.json` belum diabaikan git.

Kerjakan:
- `scripts/deploy.sh`: hanya produksi (project compose `hashi`): menolak jalan bila working tree kotor atau bukan di `main`, `git pull --ff-only`,
  `GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` (tanpa `--remove-orphans`), menunggu `/api/health` sampai `commit` = sha itu
  (batas waktu, gagal dengan kode ≠ 0 dan pesan jelas), lalu mencetak commit yang berjalan. Opsional `--backup`: jalankan `scripts/backup.sh` dulu.
- `.gitignore`: tambah `.claude/settings.local.json`.
- Catatan dari review T-003: timer cadangan menjalankan skrip dari working tree repo, jadi bila engineer sedang di branch fitur pukul 02:00, versi skrip
  branch itulah yang jalan. Cukup tulis peringatan ini di `docs/backup.md` §3 (tidak perlu mengubah mekanisme sekarang).
- README, `CLAUDE.md` (siklus engineer langkah 7 dan "Alur kerja"), `docs/HISTORY.md`: perintah deploy produksi menjadi `scripts/deploy.sh`.

**Kriteria selesai**
- [ ] Deploy produksi lewat `scripts/deploy.sh` berhasil dan mencetak commit yang sama dengan `main`; STATUS mencatat output-nya.
- [ ] Uji tolak: working tree kotor → menolak tanpa menyentuh container.
- [ ] `git check-ignore .claude/settings.local.json` → diabaikan.
- [ ] CI hijau.

---

### T-004 · Pelacak zairyū kādo (在留カード): desain · `SIAP` (setelah T-006)

Hanya dokumen desain `docs/zairyu-card.md`, **belum ada kode atau migrasi**. Tujuannya supaya Ipal bisa menanyakan hal yang tepat ke staf TSK
sebelum skema dibuat. Bahan: `CLAUDE.md` bagian "Keputusan untuk langkah 7", model `placements`, catatan kegiatan (7A), dashboard.

Isi dokumen:
- **Data:** tabel usulan (kolom, tipe, wajib/opsional), relasi ke `candidates`/`placements`, riwayat kartu (perpanjangan berulang = baris baru, bukan menimpa).
  Kolom: tanggal habis, jenis status tinggal (在留資格), status proses perpanjangan, tanggal pengajuan ke 入管, tanggal terima kartu baru, penanggung jawab (担当).
  Nomor kartu dan foto kartu: tulis pro/kontra + rekomendasi (bawaan: TIDAK disimpan sampai terbukti perlu).
- **Hak akses:** RLS hanya TSK (pola `activity_member()` / `client_owner`), siapa boleh mengubah, tidak ada DELETE, audit tanpa isi; LPK tidak melihat apa pun
  (status visa + tanggal tiba untuk LPK adalah tugas terpisah, sebutkan batasnya saja).
- **Pengingat:** tabel tahap per tanggal (H-4 bulan persiapan, H-3 bulan bisa mengajukan, H-30, H-14, H-7, lewat; berhenti saat kartu baru diterima) sebagai
  fungsi murni (input: tanggal habis, tanggal terima, hari ini menurut zona organisasi; output: tahap). Sertakan contoh kasus tepi (tanggal sudah lewat saat
  data dimasukkan, kartu diterima sebelum habis, akhir bulan, zona Tokyo vs Jakarta).
- **Tampilan:** KPI dashboard + daftar "perlu tindakan" + bagian di detail pekerja; tidak ada email/LINE dulu (dalam aplikasi saja).
- **Rencana pemecahan** jadi 2-4 tugas implementasi kecil, masing-masing dengan kriteria selesai.
- **Pertanyaan untuk staf TSK** (bernomor, bisa langsung diteruskan Ipal), termasuk penerima pengingat (担当 + salinan Admin TSK) yang belum dikonfirmasi.

**Kriteria selesai**
- [ ] `docs/zairyu-card.md` memuat semua bagian di atas; istilah sesuai `docs/glossary.md` (tambahkan istilah baru ke glosarium).
- [ ] Tidak ada perubahan kode, skema, atau migrasi.
- [ ] Daftar pertanyaan TSK juga disalin ke STATUS dengan label `BUTUH IPAL` (untuk diteruskan ke TSK).

---

## Cadangan (belum diurutkan; PM yang memindahkan ke antrean)

- **Cadangan luar-server** (ditunda atas keputusan Ipal; WAJIB sebelum data nyata/pilot): pilihan di `docs/backup.md` §5.
- Pelacak 在留カード: implementasi (setelah desain T-004 disetujui).
- Langkah 8 siap pilot: seed 200 siswa dummy, cek kecepatan halaman daftar/detail, `SHOW_DEMO_ACCOUNTS=false`, daftar periksa sebelum data nyata.
- Langkah 7 sisanya: checklist keberangkatan/kedatangan, bagian 管理・報告 di lembar 定期面談, profil pekerja lengkap, status visa + tanggal tiba untuk LPK (baca-saja), notifikasi email/LINE.
- Telusuri peringatan `pg` "client.query() ... already executing" di log e2e (lihat `docs/HISTORY.md` §4).
- Langkah 9: demo ke TSK.

## Selesai

- **T-003** Cadangan lokal terjadwal (PR #5): systemd user timer 02:00 JST (`Persistent=true`), `backup-run.sh` (log + `LAST_FAILED`), `decrypt.sh`, uji pulih
  dari set hasil jadwal cocok dengan produksi. Deploy T-005 tercatat: produksi `6a03395`. Linger belum aktif (menunggu Ipal).
- **T-005** Commit yang berjalan terbaca (PR #4): label image + env `GIT_SHA`, `/api/health` memuat `commit`, label "Hashi · <sha>" di sidebar, dicek di CI.
- **T-002** Cadangan terenkripsi lokal (PR #3): `docs/backup.md`, `scripts/backup.sh`, `scripts/restore.sh`; uji restore ke db-dev cocok dengan produksi
  dan aplikasi bisa membuka dokumen hasil restore. Belum ada jadwal dan salinan luar-server (T-003).
- **T-001** Laporan kondisi Mini PC (PR #2). Hasil penting: produksi sehat dan kodenya setara `main`; **belum ada cadangan otomatis maupun cadangan
  `docs-data`** (prioritas T-002); `/loop` jalan di VS Code. Pengukuran volume lewat container `alpine` sementara (baca-saja) diterima,
  tapi lain kali pakai `docker exec` ke container `hashi` yang sudah ada.

---

## Cara engineer berjalan otomatis (catatan untuk Ipal)

Engineer hanya bekerja saat sesinya hidup. Supaya Ipal tidak perlu mengetik apa-apa setiap ada tugas, buka sesi Claude Code di VS Code
di folder repo ini sekali, lalu ketik:

```
/loop 1h Jalankan satu putaran siklus engineer sesuai CLAUDE.md bagian "Peran dan aturan kerja".
```

VS Code dan Mini PC harus tetap menyala. PM memeriksa repo secara berkala dari sisi cloud.
