import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// This project keeps its HTML entry at public/index.html (per the required layout) instead of Vite's
// default ./index.html. This tiny plugin (1) serves it at "/" in dev and (2) emits it as dist/index.html.
function htmlEntryInPublic() {
  return {
    name: "html-entry-in-public",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url.startsWith("/?")) req.url = "/public/index.html";
        next();
      });
    },
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_opts, bundle) {
        const asset = bundle["public/index.html"];
        if (asset) {
          delete bundle["public/index.html"];
          bundle["index.html"] = { ...asset, fileName: "index.html" };
        }
      },
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: false,
  plugins: [react(), htmlEntryInPublic()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.VITE_PROXY_TARGET || "http://localhost:8000", changeOrigin: true } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(here, "public/index.html") },
  },
});
