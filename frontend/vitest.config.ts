import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": rootDirectory,
      "server-only": path.join(rootDirectory, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
  },
});
