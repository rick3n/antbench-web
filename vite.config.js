import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Statische build naar dist/, geserveerd onder `base` (pas aan voor een andere
// plek). De LiteRT- en ONNX-runtimes en het Tongue-model komen uit node_modules
// via public/ (npm run assets), zodat niets van een CDN hoeft te komen.
export default defineConfig({
  base: "/antbench/",
  // Versie uit package.json; zichtbaar in de voettekst en in rapporten/notulen.
  // Bump hem in elke PR die de app verandert.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
