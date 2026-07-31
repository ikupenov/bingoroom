import { defineConfig } from "vite";

// Served from https://ikupenov.github.io/bingoroom/ on GitHub Pages,
// so assets must resolve under the /bingoroom/ subpath in production.
// Local dev (vite / vite preview) stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/bingoroom/" : "/",
}));
