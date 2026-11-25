import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, defaultNature, household } from "../test/harness.js";

const h = createHarness();
afterAll(() => h.sql.end());

// Four lines: Boulangerie Dupont -7.20, Supermarche Test -19.15, a transfer in +5.00,
// Energie Test -1234.56.
const statement = new Uint8Array(
  readFileSync(new URL("../test/fixtures/statements/boursorama.csv", import.meta.url)),
);

interface Rule {
  id: string;
  position: number;
  name: string;
  subCategoryId: string | null;
  ignore: boolean;
}
interface Line {
  id: string;
  counterparty: string;
  status: string;
  subCategoryId: string | null;
  paymentTypeId: string | null;
  description: string | null;
  ruleId: string | null;
}

async function setup() {
  const owner = await h.signedInUser();
  const created = async (path: string, body: unknown) => {
    const res = await owner.request("POST", path, body);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const bookId = await created("/books", household);
  const ref = `/books/${bookId}/reference`;
  const accountId = await created(`${ref}/accounts`, {
    names: { fr: "Compte" },
    kind: "bank",
    currency: "EUR",
  });
  const groupId = await created(`${ref}/groups`, { names: { fr: "Vie" } });
  const categoryId = await created(`${ref}/categories`, {
    code: "1",
    names: { fr: "Courses" },
    groupId,
    natureId: await defaultNature(owner, bookId, "expense"),
  });
  const sub = (name: string) =>
    created(`${ref}/sub-categories`, { categoryId, names: { fr: name } });
  const payment = (name: string) => created(`${ref}/payment-types`, { names: { fr: name } });
  const rules = `/books/${bookId}/statements/rules`;
  const batches = `/books/${bookId}/statements/batches`;
  const keep = async () =>
    (await (
      await owner.request(
        "POST",
        `${batches}?preset=boursorama&account=${accountId}&name=a.csv`,
        statement,
      )
    ).json()) as { id: string; proposed: number };
  const lines = async (id: string) =>
    ((await (await owner.request("GET", `${batches}/${id}`)).json()) as { lines: Line[] }).lines;
  const listed = async () => (await (await owner.request("GET", rules)).json()) as Rule[];
  return {
    owner,
    bookId,
    accountId,
    rules,
    batches,
    sub,
    payment,
    keep,
    lines,
    listed,
    add: (body: unknown) => owner.request("POST", rules, body),
  };
}

describe("import rules", () => {
  it("creates, lists in order, changes, reorders and deletes rules", async () => {
    const b = await setup();
    const food = await b.sub("Alimentation");
    const first = (await (
      await b.add({ name: "Super", text: "super", subCategoryId: food })
    ).json()) as Rule;
    const second = (await (
      await b.add({ name: "Boulangerie", text: "boulangerie", subCategoryId: food })
    ).json()) as Rule;
    expect((await b.listed()).map((r) => [r.name, r.position])).toEqual([
      ["Super", 1],
      ["Boulangerie", 2],
    ]);

    const put = (id: string, body: unknown) => b.owner.request("PUT", `${b.rules}/${id}`, body);
    const changed = await put(first.id, {
      name: "Super U",
      text: "super u",
      description: "Courses",
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      name: "Super U",
      subCategoryId: null,
      description: "Courses",
    });

    expect(
      (await b.owner.request("PUT", `${b.rules}/order`, { ids: [second.id, first.id] })).status,
    ).toBe(204);
    expect((await b.listed()).map((r) => r.name)).toEqual(["Boulangerie", "Super U"]);
    // Every rule, once.
    expect((await b.owner.request("PUT", `${b.rules}/order`, { ids: [second.id] })).status).toBe(
      400,
    );

    expect((await b.owner.request("DELETE", `${b.rules}/${second.id}`)).status).toBe(204);
    expect((await b.owner.request("DELETE", `${b.rules}/${second.id}`)).status).toBe(404);
    expect(await b.listed()).toHaveLength(1);
  });

  it("refuses a rule with no condition, no action, or an unknown sub-category", async () => {
    const b = await setup();
    const food = await b.sub("Alimentation");
    expect((await b.add({ name: "x", subCategoryId: food })).status).toBe(400);
    expect((await b.add({ name: "x", text: "a" })).status).toBe(400);
    expect((await b.add({ name: "x", text: "a", subCategoryId: crypto.randomUUID() })).status).toBe(
      400,
    );
    expect((await b.add({ name: "x", text: "a", ignore: true, subCategoryId: food })).status).toBe(
      400,
    );
  });

  it("proposes the first rule that fits to each line of a new batch, leaving it to review", async () => {
    const b = await setup();
    const food = await b.sub("Alimentation");
    const energy = await b.sub("Energie");
    const broad = (await (
      await b.add({ name: "Test", text: "test", subCategoryId: energy })
    ).json()) as Rule;
    const super_ = (await (
      await b.add({
        name: "Super",
        text: "supermarche",
        subCategoryId: food,
        description: "Courses",
      })
    ).json()) as Rule;
    const skip = (await (
      await b.add({ name: "Virements", text: "virement", ignore: true })
    ).json()) as Rule;
    // The broader rule comes first: it wins on "Supermarche Test" until they are reordered.
    const batch = await b.keep();
    expect(batch.proposed).toBe(3);
    const find = async (name: string) =>
      (await b.lines(batch.id)).find((l) => l.counterparty.startsWith(name))!;
    expect(await find("Supermarche")).toMatchObject({
      status: "review",
      subCategoryId: energy,
      ruleId: broad.id,
    });
    expect(await find("Energie")).toMatchObject({ subCategoryId: energy, ruleId: broad.id });
    expect(await find("Vir")).toMatchObject({
      status: "review",
      subCategoryId: null,
      ruleId: skip.id,
    });
    expect(await find("Boulangerie")).toMatchObject({ ruleId: null });

    // A new order is tried again on the lines to review: only the line it changes moves.
    await b.owner.request("PUT", `${b.rules}/order`, { ids: [super_.id, broad.id, skip.id] });
    const again = await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {});
    expect(await again.json()).toEqual({ applied: 1 });
    expect(await find("Supermarche")).toMatchObject({ subCategoryId: food, ruleId: super_.id });
    const second = await b.keep();
    const line = (await b.lines(second.id)).find((l) => l.counterparty.startsWith("Supermarche"))!;
    expect(line).toMatchObject({ subCategoryId: food, description: "Courses", ruleId: super_.id });

    // Accepting a proposal is choosing its sub-category: the line is validated.
    const res = await b.owner.request("PATCH", `${b.batches}/${second.id}/lines`, {
      changes: [{ id: line.id, subCategoryId: food }],
    });
    expect(res.status).toBe(204);
    expect((await b.lines(second.id)).find((l) => l.id === line.id)).toMatchObject({
      status: "validated",
      description: "Courses",
    });
  });

  it("applies new rules to the lines of an existing batch, and skips an archived sub-category", async () => {
    const b = await setup();
    const food = await b.sub("Alimentation");
    const batch = await b.keep();
    expect(batch.proposed).toBe(0);
    await b.add({ name: "Boulangerie", text: "boulangerie", subCategoryId: food });
    const res = await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {});
    expect(await res.json()).toEqual({ applied: 1 });

    const old = await b.sub("Ancienne");
    await b.add({ name: "Energie", text: "energie", subCategoryId: old });
    await b.owner.request("PATCH", `/books/${b.bookId}/reference/sub-categories/${old}`, {
      archived: true,
    });
    const retry = await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {});
    expect(await retry.json()).toEqual({ applied: 0 });
  });

  it("gives the entry a payment type, and follows the rules when they change", async () => {
    const b = await setup();
    const food = await b.sub("Alimentation");
    const card = await b.payment("Carte");
    const transfer = await b.payment("Virement");
    const rule = (await (
      await b.add({ name: "Super", text: "supermarche", subCategoryId: food, paymentTypeId: card })
    ).json()) as Rule;
    // A payment type alone is an action.
    await b.add({ name: "Cartes", text: "CARTE", paymentTypeId: card });
    expect((await b.add({ name: "x", text: "a", paymentTypeId: crypto.randomUUID() })).status).toBe(
      400,
    );

    const batch = await b.keep();
    const line = async (name: string) =>
      (await b.lines(batch.id)).find((l) => l.counterparty.startsWith(name))!;
    expect(await line("Supermarche")).toMatchObject({ subCategoryId: food, paymentTypeId: card });

    // Editing the rule reaches the proposal the user has not touched.
    const edit = (body: object) =>
      b.owner.request("PUT", `${b.rules}/${rule.id}`, {
        name: "Super",
        text: "supermarche",
        subCategoryId: food,
        ...body,
      });
    await edit({ paymentTypeId: transfer });
    expect(
      await (await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {})).json(),
    ).toEqual({
      applied: 1,
    });
    expect(await line("Supermarche")).toMatchObject({ paymentTypeId: transfer, ruleId: rule.id });

    // A change by hand is not a proposal any more, and the rules leave it alone.
    const l = await line("Supermarche");
    await b.owner.request("PATCH", `${b.batches}/${batch.id}/lines`, {
      changes: [{ id: l.id, paymentTypeId: card }],
    });
    await edit({ text: "supermarche", paymentTypeId: transfer, description: "Changed" });
    await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {});
    expect(await line("Supermarche")).toMatchObject({ paymentTypeId: card, ruleId: null });

    // A rule that no longer fits takes its proposal back.
    const other = await line("Boulangerie");
    expect(other).toMatchObject({ paymentTypeId: card });
    await b.owner.request(
      "DELETE",
      `${b.rules}/${(await b.listed()).find((r) => r.name === "Cartes")!.id}`,
    );
    await b.owner.request("POST", `${b.batches}/${batch.id}/rules`, {});
    expect(await line("Boulangerie")).toMatchObject({ paymentTypeId: null, ruleId: null });

    // Importing writes the payment type on the new entry.
    const validated = await b.owner.request("PATCH", `${b.batches}/${batch.id}/lines`, {
      changes: [{ id: l.id, subCategoryId: food }],
    });
    expect(validated.status).toBe(204);
    await b.owner.request("POST", `${b.batches}/${batch.id}/import`, {});
    const journal = (await (await b.owner.request("GET", `/books/${b.bookId}/journal`)).json()) as {
      entries: { paymentTypeId: string | null }[];
    };
    expect(journal.entries.map((e) => e.paymentTypeId)).toEqual([card]);
  });

  it("is closed to a stranger", async () => {
    const b = await setup();
    const stranger = await h.signedInUser();
    for (const [method, path, body] of [
      ["GET", b.rules, undefined],
      ["POST", b.rules, { name: "x", text: "a", ignore: true }],
      ["PUT", `${b.rules}/order`, { ids: [crypto.randomUUID()] }],
    ] as const) {
      expect([403, 404]).toContain((await stranger.request(method, path, body)).status);
    }
  });
});
