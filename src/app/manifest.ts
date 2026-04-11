import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PosanMeal — 포산고 석식 관리",
    short_name: "PosanMeal",
    description: "포산고등학교 Smart QR 석식 관리 시스템",
    start_url: "/",
    display: "standalone",
    background_color: "#fef8f1",
    theme_color: "#f59e0b",
    // "any" lets students/teachers use their phones in portrait and the
    // /check tablet kiosk rotate freely into landscape. Locking to portrait
    // here disables rotation app-wide even when the device is sideways.
    orientation: "any",
    lang: "ko",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
