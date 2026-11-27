import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { StatementPreview } from "@cash-scout/domain";
import { createHarness, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../test/fixtures/statements/${name}`, import.meta.url)));

async function bookWithAccount() {
  const owner = await h.signedInUser();
  const book = await owner.request("POST", "/books", household);
  const { id: bookId } = (await book.json()) as { id: string };
  const account = await owner.request("POST", `/books/${bookId}/reference/accounts`, {
    names: { fr: "Compte" },
    currency: "EUR",
  });
  const { id: accountId } = (await account.json()) as { id: string };
  const preview = (preset: string, file: Uint8Array, account = accountId, by = owner) =>
    by.request(
      "POST",
      `/books/${bookId}/statements/preview?preset=${preset}&account=${account}`,
      file,
    );
  return { owner, bookId, accountId, preview };
}

describe("statement preview", () => {
  it("lists the presets", async () => {
    const b = await bookWithAccount();
    const res = await b.owner.request("GET", `/books/${b.bookId}/statements/presets`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "boursorama", name: "Boursorama" },
      { id: "caisse-epargne", name: "Caisse d'Epargne" },
      { id: "abn-amro", name: "ABN AMRO" },
    ]);
  });

  it("reads a file with the chosen preset and writes nothing", async () => {
    const b = await bookWithAccount();
    const res = await b.preview("boursorama", fixture("boursorama.csv"));
    expect(res.status).toBe(200);
    const preview = (await res.json()) as StatementPreview;
    expect(preview).toMatchObject({
      currency: "EUR",
      total: "-1255.91",
      accountNumbers: ["00000000001"],
      errors: [],
      balanceBreaks: [],
    });
    expect(preview.lines).toHaveLength(4);
    expect(preview.lines[0]).toMatchObject({
      date: "2026-10-30",
      amount: "-7.20",
      balance: "541.80",
    });
    const journal = await b.owner.request("GET", `/books/${b.bookId}/journal`);
    expect(((await journal.json()) as { total: number }).total).toBe(0);
  });

  it("refuses a file that is not the preset's", async () => {
    const b = await bookWithAccount();
    const res = await b.preview("boursorama", fixture("caisse-epargne.csv"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Boursorama");
  });

  it("refuses an unknown preset, an unknown account and an empty file", async () => {
    const b = await bookWithAccount();
    expect((await b.preview("nope", fixture("boursorama.csv"))).status).toBe(400);
    expect(
      (await b.preview("boursorama", fixture("boursorama.csv"), crypto.randomUUID())).status,
    ).toBe(400);
    expect((await b.preview("boursorama", new Uint8Array())).status).toBe(400);
  });

  it("is refused to someone who is not an editor of the book", async () => {
    const b = await bookWithAccount();
    const stranger = await h.signedInUser();
    const res = await b.preview("boursorama", fixture("boursorama.csv"), b.accountId, stranger);
    expect([403, 404]).toContain(res.status);
  });
});

describe("import batches", () => {
  const text = (name: string) => new TextDecoder().decode(fixture(name));
  const bytes = (content: string) => new TextEncoder().encode(content);

  async function setup() {
    const b = await bookWithAccount();
    const keep = (file: Uint8Array, name = "export.csv", preset = "boursorama") =>
      b.owner.request(
        "POST",
        `/books/${b.bookId}/statements/batches?preset=${preset}&account=${b.accountId}&name=${name}`,
        file,
      );
    const detail = async (id: string) => {
      const res = await b.owner.request("GET", `/books/${b.bookId}/statements/batches/${id}`);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        fileName: string;
        currency: string;
        lines: { date: string; amount: string; status: string; duplicate: boolean }[];
      };
    };
    return { ...b, keep, detail };
  }

  it("keeps the lines of a file, to review", async () => {
    const b = await setup();
    const res = await b.keep(fixture("boursorama.csv"), "october.csv");
    expect(res.status).toBe(201);
    const { id, lines } = (await res.json()) as { id: string; lines: number };
    expect(lines).toBe(4);

    const list = (await (
      await b.owner.request("GET", `/books/${b.bookId}/statements/batches`)
    ).json()) as Record<string, unknown>[];
    expect(list).toEqual([
      expect.objectContaining({
        id,
        fileName: "october.csv",
        preset: "boursorama",
        lines: 4,
        toReview: 4,
        from: "2026-10-27",
        to: "2026-10-30",
      }),
    ]);

    const batch = await b.detail(id);
    expect(batch.currency).toBe("EUR");
    expect(batch.lines.map((l) => [l.date, l.amount, l.status, l.duplicate])).toEqual([
      ["2026-10-30", "-7.20", "review", false],
      ["2026-10-30", "-19.15", "review", false],
      ["2026-10-28", "5.00", "review", false],
      ["2026-10-27", "-1234.56", "review", false],
    ]);
  });

  it("flags the lines an earlier batch of the account already holds", async () => {
    const b = await setup();
    const lines = text("boursorama.csv").split("\n");
    // A first export with the three newest lines, then the whole file.
    const first = (await (await b.keep(bytes(lines.slice(0, 4).join("\n")))).json()) as {
      id: string;
    };
    const second = (await (await b.keep(fixture("boursorama.csv"))).json()) as { id: string };
    expect((await b.detail(first.id)).lines.map((l) => l.duplicate)).toEqual([false, false, false]);
    expect((await b.detail(second.id)).lines.map((l) => l.duplicate)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("deletes a batch with its lines", async () => {
    const b = await setup();
    const { id } = (await (await b.keep(fixture("boursorama.csv"))).json()) as { id: string };
    const url = `/books/${b.bookId}/statements/batches/${id}`;
    expect((await b.owner.request("DELETE", url)).status).toBe(204);
    expect((await b.owner.request("GET", url)).status).toBe(404);
    expect((await b.owner.request("DELETE", url)).status).toBe(404);
  });

  it("refuses a file with no line, and a file of another format", async () => {
    const b = await setup();
    const header = text("boursorama.csv").split("\n")[0]!;
    expect((await b.keep(bytes(header))).status).toBe(400);
    expect((await b.keep(fixture("caisse-epargne.csv"))).status).toBe(400);
  });

  it("is closed to someone who is not an editor of the book", async () => {
    const b = await setup();
    const { id } = (await (await b.keep(fixture("boursorama.csv"))).json()) as { id: string };
    const stranger = await h.signedInUser();
    const base = `/books/${b.bookId}/statements/batches`;
    for (const [method, path] of [
      ["GET", base],
      ["GET", `${base}/${id}`],
      ["DELETE", `${base}/${id}`],
    ] as const) {
      expect([403, 404]).toContain((await stranger.request(method, path)).status);
    }
  });
});
