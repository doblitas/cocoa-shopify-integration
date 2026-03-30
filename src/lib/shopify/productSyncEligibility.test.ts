import { describe, expect, it } from "vitest";

import {
  productIsPublishedForCocoaSync,
  productShouldSyncToCocoa,
} from "./productSyncEligibility";
import type { ShopifyProductWebhookPayload } from "./types";

function basePayload(
  overrides: Partial<ShopifyProductWebhookPayload> = {},
): ShopifyProductWebhookPayload {
  return {
    id: 1,
    title: "T",
    variants: [{ id: 1, sku: "s", price: "1", inventory_quantity: 5 }],
    ...overrides,
  };
}

describe("productIsPublishedForCocoaSync", () => {
  it("rejects draft", () => {
    expect(
      productIsPublishedForCocoaSync(
        basePayload({ status: "draft", published_at: "2024-01-01T00:00:00Z" }),
      ),
    ).toBe(false);
  });

  it("rejects archived", () => {
    expect(
      productIsPublishedForCocoaSync(
        basePayload({ status: "archived", published_at: "2024-01-01T00:00:00Z" }),
      ),
    ).toBe(false);
  });

  it("accepts active with published_at", () => {
    expect(
      productIsPublishedForCocoaSync(
        basePayload({ status: "active", published_at: "2024-01-01T00:00:00Z" }),
      ),
    ).toBe(true);
  });

  it("rejects active without published_at", () => {
    expect(productIsPublishedForCocoaSync(basePayload({ status: "active", published_at: null }))).toBe(
      false,
    );
  });

  it("accepts legacy payload without status but with published_at", () => {
    expect(
      productIsPublishedForCocoaSync(
        basePayload({ status: undefined, published_at: "2024-01-01T00:00:00Z" }),
      ),
    ).toBe(true);
  });
});

describe("productShouldSyncToCocoa", () => {
  it("requires inventory and publication", () => {
    expect(
      productShouldSyncToCocoa(
        basePayload({
          status: "active",
          published_at: "2024-01-01T00:00:00Z",
          variants: [{ id: 1, sku: "s", price: "1", inventory_quantity: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      productShouldSyncToCocoa(
        basePayload({
          status: "active",
          published_at: "2024-01-01T00:00:00Z",
          variants: [{ id: 1, sku: "s", price: "1", inventory_quantity: 0 }],
        }),
      ),
    ).toBe(false);
    expect(
      productShouldSyncToCocoa(
        basePayload({
          status: "draft",
          published_at: "2024-01-01T00:00:00Z",
          variants: [{ id: 1, sku: "s", price: "1", inventory_quantity: 5 }],
        }),
      ),
    ).toBe(false);
  });
});
