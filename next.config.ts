import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      /**
       * tw-animate-css eksportuje swój CSS wyłącznie przez warunek "style"
       * w mapie `exports`, a resolver Turbopacka go nie stosuje — import
       * pakietu po nazwie kończy się błędem "Module not found", i to samo
       * dotyczy ścieżki `./dist/...`, bo mapa `exports` jej nie wystawia.
       * Alias wskazuje plik bezpośrednio, omijając mapę.
       */
      "tw-animate-css": "./node_modules/tw-animate-css/dist/tw-animate.css",
    },
  },
};

export default nextConfig;
