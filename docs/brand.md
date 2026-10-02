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
Dipakai HANYA untuk logo dan panel merek login; aksen aplikasi tetap `#C2410C`.

Aturan: logo penuh tinggi minimal 24px, simbol minimal 20px (BrandLogo menegakkannya). Jangan mewarnai ulang, memutar, atau meregangkan. Jangan menaruh `mark-dark` di atas warna selain navy.
