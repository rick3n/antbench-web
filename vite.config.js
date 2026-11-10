import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Gebouwd door Nix (pakketten/antbench-web/default.nix) naar dist/, dat Caddy
// op dev.3n.nl onder /antbench/ serveert (modules/antbench.nix). De LiteRT-
// wasm-bestanden en het Tongue-model komen uit node_modules via public/, zodat
// niets van een CDN hoeft te komen.
export default defineConfig({
  base: "/antbench/",
  // Versie uit package.json; zichtbaar in de voettekst en in rapporten/notulen.
  // Bump hem in elke PR die de app verandert.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: "dist", emptyOutDir: true, target: "es2022",
    // Twee pagina's: de app zelf en de menukaart (werkbank/) met de klussen.
    rollupOptions: { input: { main: "index.html", werkbank: "werkbank/index.html" } },
  },
});
