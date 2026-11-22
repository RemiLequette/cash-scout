import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "api",
    globalSetup: ["./test/global-setup.ts"],
    // Tests share one database; run files one after another.
    fileParallelism: false,
  },
});
