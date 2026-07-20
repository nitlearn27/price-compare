import { describe, expect, it } from "vitest";

import { filterRelevant, minRelevance, rankAndGroup } from "../src/lib/product_search";
import type { ProductListing } from "../src/models/schemas";

const rec = (id: string, title: string, source = "Flipkart") => ({
  Id: id,
  Title__c: title,
  Source__c: source,
  Current_Price__c: 100,
});

const listing = (id: string, title: string): ProductListing => ({
  id,
  title,
  source: "Amazon",
  origin: "live",
});

describe("relevance filtering", () => {
  it("drops brand-only partials once a full-token match exists", () => {
    const out = rankAndGroup(
      [
        rec("1", "Nandini Butter 100g"),
        rec("2", "Nandini Curd 500g"),
        rec("3", "Nandini Paneer 200g"),
      ],
      "nandini butter",
    );
    expect(out.map((p) => p.title)).toEqual(["Nandini Butter 100g"]);
  });

  it("keeps a partial match only when nothing matches all tokens", () => {
    const out = rankAndGroup([rec("1", "Nandini Curd"), rec("2", "Amul Cheese")], "nandini butter");
    // "Nandini Curd" matches 1 token, "Amul Cheese" matches 0 → only the former survives.
    expect(out.map((p) => p.title)).toEqual(["Nandini Curd"]);
  });

  it("minRelevance requires a full match when one is present, else >=1, else 0", () => {
    expect(minRelevance([2, 1, 1], 2)).toBe(2);
    expect(minRelevance([1, 1, 0], 2)).toBe(1);
    expect(minRelevance([0, 0], 2)).toBe(0);
    expect(minRelevance([1, 1], 0)).toBe(0);
  });

  it("filterRelevant prunes live rows the store returned loosely", () => {
    const out = filterRelevant([listing("a", "Amul Butter"), listing("b", "Amul Curd")], "amul butter");
    expect(out.map((p) => p.title)).toEqual(["Amul Butter"]);
  });

  it("filterRelevant is a no-op when the query has no meaningful tokens", () => {
    const rows = [listing("a", "Amul Butter"), listing("b", "Amul Curd")];
    expect(filterRelevant(rows, "")).toEqual(rows);
  });
});
