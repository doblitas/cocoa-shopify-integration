import { describe, expect, it } from "vitest";

import { parseNextPageUrlFromLinkHeader } from "@/lib/shopify/restProduct";

describe("parseNextPageUrlFromLinkHeader", () => {
  it("extracts next URL from Shopify Link header", () => {
    const link =
      '<https://shop.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=abc>; rel="next", <https://shop.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=prev>; rel="previous"';
    expect(parseNextPageUrlFromLinkHeader(link)).toBe(
      "https://shop.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=abc",
    );
  });

  it("returns null when there is no next page", () => {
    expect(parseNextPageUrlFromLinkHeader(null)).toBeNull();
    expect(
      parseNextPageUrlFromLinkHeader('<https://x.com/a>; rel="previous"'),
    ).toBeNull();
  });
});
