import type { Format } from "tsup";
import { defineConfig } from "tsup";

const entry = ["src/index.ts", "src/core.ts", "src/client.ts", "src/server.ts"];
const formats: Record<Format, string> = {
  cjs: "c",
  esm: "m",
  iife: "",
};

export default defineConfig([
  {
    entry,
    format: ["cjs", "esm"],
    splitting: false,
    sourcemap: true,
    clean: true,
    outExtension: ({ format }) => ({ js: `.${formats[format]}js` }),
  },
  {
    entry,
    format: "esm",
    dts: {
      only: true,
    },
  },
]);
