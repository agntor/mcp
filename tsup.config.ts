import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  noExternal: ["@agntor/database"], // Bundle the database package
});
