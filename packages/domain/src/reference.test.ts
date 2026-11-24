import { describe, expect, it } from "vitest";
import { bookUpdateSchema } from "./book.js";
import { checkNames, defaultNatures, displayName, parseThreshold } from "./reference.js";

describe("displayName", () => {
  const names = { fr: "Alimentation", en: "Food" };

  it("uses the reader's language, then the default one", () => {
    expect(displayName(names, "en", "fr")).toBe("Food");
    expect(displayName(names, "en-GB", "fr")).toBe("Food");
    expect(displayName(names, "ms", "fr")).toBe("Alimentation");
    expect(displayName({ en: "Food" }, "ms", "fr")).toBe("Food");
  });
});

describe("checkNames", () => {
  it("requires the default language and only book languages", () => {
    expect(checkNames({ fr: "A", en: "B" }, ["fr", "en"], "fr")).toBeUndefined();
    expect(checkNames({ en: "B" }, ["fr", "en"], "fr")).toMatch(/default language/);
    expect(checkNames({ fr: "A", de: "C" }, ["fr", "en"], "fr")).toMatch(/de/);
  });
});

describe("bookUpdateSchema", () => {
  it("requires the default language among the languages", () => {
    const base = { name: "Household", defaultLanguage: "fr" };
    expect(bookUpdateSchema.safeParse({ ...base, languages: ["fr", "en"] }).success).toBe(true);
    expect(bookUpdateSchema.safeParse({ ...base, languages: ["en"] }).success).toBe(false);
    expect(bookUpdateSchema.safeParse({ ...base, languages: ["fr", "fr"] }).success).toBe(false);
  });
});

describe("parseThreshold", () => {
  it("parses in the account currency", () => {
    expect(parseThreshold("-500", "EUR")).toBe(-50000n);
    expect(parseThreshold("", "EUR")).toBeNull();
    expect(parseThreshold(null, "JPY")).toBeNull();
  });
});

describe("defaultNatures", () => {
  it("gives one nature per direction, named in each language of the book", () => {
    const natures = defaultNatures(["fr", "en"], "fr");
    expect(natures.map((n) => [n.behavior, n.sign])).toEqual([
      ["income", 1],
      ["expense", -1],
      ["saving", -1],
      ["transfer", 1],
    ]);
    expect(natures[1]!.names).toEqual({ fr: "Dépenses", en: "Expenses" });
  });

  it("falls back to English for a language it has no words for, and always names the default one", () => {
    expect(defaultNatures(["de"], "de")[0]!.names).toEqual({ de: "Income" });
    expect(defaultNatures(["fr"], "de")[0]!.names).toEqual({ de: "Income", fr: "Revenus" });
  });
});
