import { describe, expect, it } from "vitest";

import { getTotalInventoryQuantity, productHasInventoryAvailability } from "./productInventory";
import type { ShopifyProductWebhookPayload } from "./types";

function payload(
  quantities: (number | null)[],
): ShopifyProductWebhookPayload {
  return {
    id: 1,
    title: "T",
    variants: quantities.map((inventory_quantity, i) => ({
      id: i + 1,
      sku: `s${i}`,
      price: "10",
      inventory_quantity,
    })),
  };
}

describe("productInventory", () => {
  it("sums variant quantities", () => {
    expect(getTotalInventoryQuantity(payload([2, 3]))).toBe(5);
  });

  it("treats null as zero", () => {
    expect(getTotalInventoryQuantity(payload([null, 1]))).toBe(1);
  });

  it("has availability when sum > 0", () => {
    expect(productHasInventoryAvailability(payload([0, 1]))).toBe(true);
  });

  it("no availability when all zero or null", () => {
    expect(productHasInventoryAvailability(payload([0, 0]))).toBe(false);
    expect(productHasInventoryAvailability(payload([null, null]))).toBe(false);
  });
});
