import { afterAll, describe, expect, it } from "vitest";
import { createHarness, household } from "../test/harness.js";
import { scopeOfPath } from "./events.js";

const h = createHarness();
afterAll(() => h.sql.end());

async function json<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

/** A book with a payment type, a simple versioned row, and two windows (members) on it. */
async function sharedBook() {
  const owner = await h.signedInUser();
  const { id: bookId } = await json<{ id: string }>(
    owner.request("POST", "/books", household),
    201,
  );
  const type = await json<{ id: string; version: number }>(
    owner.request("POST", `/books/${bookId}/reference/payment-types`, { names: { fr: "Carte" } }),
    201,
  );
  return { owner, bookId, type, ref: (path: string) => `/books/${bookId}/reference${path}` };
}

describe("concurrent changes", () => {
  it("raises the version at each change", async () => {
    const b = await sharedBook();
    expect(b.type.version).toBe(1);
    const renamed = await json<{ version: number }>(
      b.owner.request("PATCH", b.ref(`/payment-types/${b.type.id}`), { names: { fr: "CB" } }),
    );
    expect(renamed.version).toBe(2);
  });

  it("refuses a change made from a stale version", async () => {
    const b = await sharedBook();
    const path = b.ref(`/payment-types/${b.type.id}`);
    // Window A saves first, from version 1.
    const a = await json<{ version: number }>(
      b.owner.request("PATCH", path, { names: { fr: "CB" }, version: 1 }),
    );
    expect(a.version).toBe(2);
    // Window B still holds version 1: its change is refused and nothing is lost.
    const stale = await b.owner.request("PATCH", path, { names: { fr: "Visa" }, version: 1 });
    expect(stale.status).toBe(409);
    const list = await json<{ paymentTypes: { names: { fr: string }; version: number }[] }>(
      b.owner.request("GET", b.ref("")),
    );
    expect(list.paymentTypes[0]).toMatchObject({ names: { fr: "CB" }, version: 2 });
    // After reloading, B saves from version 2.
    const retried = await b.owner.request("PATCH", path, { names: { fr: "Visa" }, version: 2 });
    expect(retried.status).toBe(200);
  });

  it("lets a change without version win, and answers 404 for a missing row", async () => {
    const b = await sharedBook();
    const path = b.ref(`/payment-types/${b.type.id}`);
    expect((await b.owner.request("PATCH", path, { names: { fr: "CB" } })).status).toBe(200);
    expect((await b.owner.request("PATCH", path, { names: { fr: "Visa" } })).status).toBe(200);
    const unknown = b.ref("/payment-types/00000000-0000-4000-8000-000000000000");
    expect((await b.owner.request("PATCH", unknown, { archived: true })).status).toBe(404);
    // With a version, a row deleted elsewhere is a conflict to reload, not an unknown row.
    expect((await b.owner.request("DELETE", path)).status).toBe(204);
    expect((await b.owner.request("PATCH", path, { archived: true, version: 3 })).status).toBe(409);
  });
});

describe("book events", () => {
  /** Opens the stream of a book; `until` reads it up to what the test waits for. */
  async function listen(b: Awaited<ReturnType<typeof sharedBook>>) {
    const response = await b.owner.request("GET", `/books/${b.bookId}/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      return text;
    };
    // The first ping is sent once the stream is subscribed: from then on changes are heard.
    await until("event: ping");
    return { until, close: () => reader.cancel() };
  }

  it("announces the scope of a change to the windows open on the book", async () => {
    const b = await sharedBook();
    const events = await listen(b);
    await b.owner.request("PATCH", b.ref(`/payment-types/${b.type.id}`), { names: { fr: "CB" } });
    expect(await events.until("event: change")).toContain("event: change\ndata: reference");
    await events.close();
  });

  it("does not announce a failed change, nor a read", async () => {
    const b = await sharedBook();
    const events = await listen(b);
    await b.owner.request("GET", b.ref(""));
    await b.owner.request("PATCH", b.ref(`/payment-types/${b.type.id}`), {
      names: { fr: "CB" },
      version: 99,
    });
    // The first change announced is the next one that succeeds: here, the book itself.
    await b.owner.request("PATCH", `/books/${b.bookId}`, {
      name: "Renamed",
      defaultLanguage: "fr",
      languages: ["fr"],
    });
    const text = await events.until("event: change");
    expect(text).toContain("event: change\ndata: book");
    expect(text).not.toContain("data: reference");
    await events.close();
  });

  it("is closed to people who are not members of the book", async () => {
    const b = await sharedBook();
    const stranger = await h.signedInUser();
    expect((await stranger.request("GET", `/books/${b.bookId}/events`)).status).toBe(404);
  });

  it("names the scope from the path of the request", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(scopeOfPath(`/api/books/${id}/journal/reconcile`)).toBe("journal");
    expect(scopeOfPath(`/api/books/${id}/reference/accounts/${id}`)).toBe("reference");
    expect(scopeOfPath(`/api/books/${id}/budgets`)).toBe("budgets");
    expect(scopeOfPath(`/api/books/${id}/members/someone`)).toBe("members");
    expect(scopeOfPath(`/api/books/${id}`)).toBe("book");
  });
});
