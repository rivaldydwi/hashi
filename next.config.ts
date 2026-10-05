import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Build mandiri (standalone) supaya image Docker kecil.
  output: "standalone",
  poweredByHeader: false,
  // sharp memuat binary native: tidak boleh di-bundle. pdfkit SENGAJA ikut di-bundle: dengan tracing standalone, dependensi bersarangnya (@noble/*) hilang di image produksi.
  serverExternalPackages: ["sharp"],
  // Font Jepang untuk PDF (assets/fonts) dibaca lewat fs dinamis: ikutkan di build standalone.
  outputFileTracingIncludes: { "/records/**": ["./assets/fonts/**"] },
  experimental: {
    // Unggah dokumen lewat server action: batas 10 MB (dicek lagi di aksi) + sedikit ruang untuk field form.
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
