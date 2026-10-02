import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hashi",
    short_name: "Hashi",
    start_url: "/",
    display: "standalone",
    theme_color: "#0F1424",
    background_color: "#FAF8F5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
