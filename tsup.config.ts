import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
  },
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
