import { describe, expect, it } from "vitest";
import { bookInputSchema, hasRole } from "./book.js";

describe("hasRole", () => {
  it("orders owner > editor > viewer", () => {
    expect(hasRole("owner", "editor")).toBe(true);
    expect(hasRole("editor", "editor")).toBe(true);
    expect(hasRole("viewer", "editor")).toBe(false);
  });
});

describe("bookInputSchema", () => {
  it("accepts a valid book and trims the name", () => {
    expect(
      bookInputSchema.parse({ name: " Household ", currency: "EUR", defaultLanguage: "fr" }),
    ).toEqual({ name: "Household", currency: "EUR", defaultLanguage: "fr" });
  });

  it("rejects unknown currencies and empty names", () => {
    expect(
      bookInputSchema.safeParse({ name: "x", currency: "XYZ1", defaultLanguage: "fr" }).success,
    ).toBe(false);
    expect(
      bookInputSchema.safeParse({ name: " ", currency: "EUR", defaultLanguage: "fr" }).success,
    ).toBe(false);
  });
});
