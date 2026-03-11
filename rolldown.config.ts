import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig([
  // Regular build with `index.d.ts` types
  {
    input: "src/index.ts",
    output: [
      {
        dir: "dist",
        format: "es",
        sourcemap: true,
      },
    ],
    plugins: [
      dts({
        compilerOptions: {
          declaration: true,
          declarationMap: true,
        },
      }),
    ],
  },
  // Minified build `index.min.js` for cdn usage
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/index.min.js",
        format: "es",
        sourcemap: true,
        minify: true,
      },
    ],
  },
]);
