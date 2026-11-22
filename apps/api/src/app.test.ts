import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("GET /api/health", () => {
  it("is ok when the database answers", async () => {
    const app = createApp({ pingDatabase: async () => {} });
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("is 503 when the database does not answer", async () => {
    const app = createApp({
      pingDatabase: async () => {
        throw new Error("down");
      },
    });
    const response = await app.request("/api/health");
    expect(response.status).toBe(503);
  });
});
