import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "LexGuard — Protección Ciudadana MX",
        short_name: "LexGuard",
        description: "App de auxilio ciudadano con IA para derechos en México",
        theme_color: "#dc2626",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ],
        categories: ["utilities", "legal"],
        lang: "es-MX",
        shortcuts: [
          {
            name: "Activar SOS",
            short_name: "SOS",
            description: "Ir directo al botón de emergencia",
            url: "/?screen=home",
            icons: [{ src: "icon-192.png", sizes: "192x192" }]
          }
        ]
      },
      workbox: {
        // Cachea la app para uso offline
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          }
        ]
      }
    })
  ]
});
