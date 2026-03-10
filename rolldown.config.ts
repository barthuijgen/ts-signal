import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  output: [
    {
      file: "dist/index.js",
      format: "esm",
      sourcemap: true,
    },
    {
      file: "dist/index.min.js",
      format: "esm",
      minify: true,
      sourcemap: true,
    },
  ],
});
