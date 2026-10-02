import Image from "next/image";

// Logo Hashi. tone = latar tempat logo dipakai: "light" untuk latar terang, "dark" untuk latar gelap (navy #0F1424; varian simbol dark opak, jangan di atas warna lain).
// Ukuran minimum: logo penuh tinggi 24px, simbol 20px (lihat docs/brand.md). Berkas dibangun oleh scripts/build-brand.ts.
const RATIO = 640 / 151; // logo penuh setelah dipangkas

export function BrandLogo({ variant = "full", tone = "light", height = 32, priority = false, decorative = false, className }: { variant?: "full" | "mark"; tone?: "light" | "dark"; height?: number; priority?: boolean; decorative?: boolean; className?: string }) {
  const min = variant === "full" ? 24 : 20;
  const h = Math.max(height, min);
  if (variant === "mark") {
    return <Image src={`/brand/mark-${tone}-192.png`} width={h} height={h} alt={decorative ? "" : "Hashi"} priority={priority} className={className} style={{ height: h, width: h }} />;
  }
  const w = Math.round(h * RATIO);
  return <Image src={`/brand/logo-${tone}@2x.png`} width={w} height={h} alt={decorative ? "" : "Hashi"} priority={priority} className={className} style={{ height: h, width: w }} />;
}
