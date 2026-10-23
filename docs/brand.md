# Merek Hashi

Sumber (hanya dibaca, jangan diubah): `design/brand-source/`. Aset turunan dibangun ulang dengan `npm run build:brand` (`scripts/build-brand.ts`, memakai `sharp`) dan di-commit.

| Aset | Dipakai untuk |
|---|---|
| `public/brand/logo-light.png` (+`@2x`) | logo penuh di latar TERANG (sidebar, login kolom kiri, halaman ganti sandi) |
| `public/brand/logo-dark.png` (+`@2x`) | logo penuh di latar GELAP (navy `#0F1424`) |
| `public/brand/mark-light-{96,192,384}.png` | simbol saja, latar terang, transparan |
| `public/brand/mark-dark-{96,192,384}.png` | simbol saja, OPAK navy `#0F1424`: hanya di atas permukaan `#0F1424` (panel merek login) |
| `src/app/icon.png`, `apple-icon.png`, `favicon.ico`, `public/icons/icon-{192,512}.png`, `src/app/manifest.ts` | ikon situs, iOS, PWA |

Komponen: `src/components/brand/BrandLogo.tsx` (`variant` full/mark, `tone` light = untuk latar terang). Beri `decorative` (alt kosong) bila berdampingan dengan teks "Hashi".

Warna merek (token `--color-brand-*` di `globals.css`): navy `#0F1424`, navy ikon `#1B2547`, periwinkle `#C9D3FF`, biru `#5B7CFA`, coral `#FF6B5E` (latar gelap) / `#F2574B` (latar terang), teks logo `#2B3A67`.
**Sejak T-034 (keputusan Ipal 2026-10-23) seluruh aplikasi memakai keluarga warna merek** (sebelumnya krem + terakota `#C2410C`). Komponen tidak memakai
nilai merek mentah, tetapi token PERAN di `globals.css` yang diturunkan darinya:

| Token | Nilai | Dari merek | Untuk |
|---|---|---|---|
| `accent` / `accent-dark` | `#3653D6` / `#2840A8` | biru `#5B7CFA` digelapkan (teks putih 6,2:1; biru mentah hanya 3,7:1) | tombol utama, tautan aktif, fokus, menu terpilih |
| `accent-soft` / `accent-text` | `#E6EAFF` / `#2C45B8` | periwinkle `#C9D3FF` | latar menu terpilih, teks tautan |
| `attn-*` | `#FFF1EF` / `#A4291F` / ikon `#E04A3E` | coral `#F2574B` | HANYA "perlu tindakan" (KPI, penanda) |
| `ink` / `blue` / `role-text` | `#141A2E` / `#2B3A67` | navy `#0F1424`, teks logo `#2B3A67` | teks utama, peran |
| `page`, `line`, `muted`, ... | `#F5F7FB`, `#E1E6EF`, `#EEF1F7` | netral sedikit kebiruan | latar halaman, garis, chip |

Bahaya (`danger-*`, merah tua) dan peringatan (`warn-*`, kuning) sengaja BUKAN coral supaya "perlu tindakan" tidak tertukar dengan "hapus". Kontras setiap pasangan
teks/latar dites (`tests/unit/no-raw-colors.test.ts`); palet lama tidak boleh kembali (dites). Radius: kartu 8px (`rounded-card`), kontrol 6px (`rounded-ctl`).

Aturan: logo penuh tinggi minimal 24px, simbol minimal 20px (BrandLogo menegakkannya). Jangan mewarnai ulang, memutar, atau meregangkan. Jangan menaruh `mark-dark` di atas warna selain navy.
