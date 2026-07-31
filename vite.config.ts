import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Served from https://ikupenov.github.io/bingoroom/ on GitHub Pages,
// so assets must resolve under the /bingoroom/ subpath in production.
// Local dev (vite / vite preview) stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/bingoroom/" : "/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Squad Bingo",
        short_name: "Bingo",
        description: "Retro meeting buzzword bingo for your squad.",
        theme_color: "#8a4fc7",
        background_color: "#2b2440",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
}));
