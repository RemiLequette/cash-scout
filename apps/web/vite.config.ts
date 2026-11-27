import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

/**
 * The version shown in About. A release is a Git tag `vX.Y.Z`: the deployment
 * passes it in APP_VERSION, the image being built without the repository.
 * Elsewhere it is read from Git: the last tag, and what came after it.
 */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const described = execFileSync("git", ["describe", "--tags", "--long", "--match", "v[0-9]*"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const [, tag, ahead] = /^v(.+)-(\d+)-g[0-9a-f]+$/.exec(described) ?? [];
    if (tag) return ahead === "0" ? tag : `${tag} + ${ahead} commits`;
  } catch {
    // No Git, or no release tag yet.
  }
  return "dev";
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  server: {
    port: 5173,
    // In dev, the API runs on the host at API_PORT.
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
