import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  // Workspace packages are TypeScript sources: bundle them into the build.
  noExternal: [/^@cash-scout\//],
});
