import { describe, expect, it } from "vitest";

import { applyShopifyPriceToCocoa, mapShopifyProductToCocoaDraft } from "@/lib/shopify/mapProduct";
import type { TenantConfig } from "@/lib/tenants";
import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";

const baseTenant: TenantConfig = {
  tenantId: "t1",
  shopDomain: "test.myshopify.com",
  webhookSecret: "s",
  cocoa: { baseUrl: "x", user: "u", password: "p" },
  defaultCategoryKey: "cat-default",
};

describe("mapShopifyProductToCocoaDraft", () => {
  it("maps title, price (USD×6.96→BOB por defecto), sku and default category", () => {
    const payload: ShopifyProductWebhookPayload = {
      id: 99,
      title: "Test product",
      body_html: "<p>Hello</p>",
      variants: [
        {
          id: 1,
          sku: "SKU-1",
          price: "12.50",
          inventory_quantity: 3,
        },
      ],
    };
    const draft = mapShopifyProductToCocoaDraft(payload, baseTenant);
    expect(draft.nombre).toBe("Test product");
    expect(draft.sku).toBe("SKU-1");
    expect(draft.precio).toBe(87);
    expect(draft.have_stock).toBe(true);
    expect(draft.stock).toBe(3);
    expect(draft.key_categoria).toBe("cat-default");
    expect(draft.descripcion).toBe("Hello");
  });

  it("uses shopifyPriceToCocoaMultiplier 1 to skip conversion when Shopify is already BOB", () => {
    const tenant: TenantConfig = {
      ...baseTenant,
      shopifyPriceToCocoaMultiplier: 1,
    };
    const payload: ShopifyProductWebhookPayload = {
      id: 1,
      title: "P",
      variants: [{ id: 1, sku: "S", price: "12.50", inventory_quantity: 1 }],
    };
    expect(mapShopifyProductToCocoaDraft(payload, tenant).precio).toBe(12.5);
  });

  it("uses categoryMap from product_type when present", () => {
    const tenant: TenantConfig = {
      ...baseTenant,
      categoryMap: { vendidos: "cat-vend" },
    };
    const payload: ShopifyProductWebhookPayload = {
      id: 1,
      title: "P",
      product_type: "Vendidos",
      variants: [{ id: 1, sku: null, price: "1", inventory_quantity: 0 }],
    };
    const draft = mapShopifyProductToCocoaDraft(payload, tenant);
    expect(draft.key_categoria).toBe("cat-vend");
  });

  it("applies shopifyPriceToCocoaMultiplier to precio when set", () => {
    const tenant: TenantConfig = {
      ...baseTenant,
      shopifyPriceToCocoaMultiplier: 6.96,
    };
    const payload: ShopifyProductWebhookPayload = {
      id: 1,
      title: "USD item",
      body_html: "",
      variants: [{ id: 1, sku: "X", price: "100", inventory_quantity: 1 }],
    };
    const draft = mapShopifyProductToCocoaDraft(payload, tenant);
    expect(draft.precio).toBe(696);
  });

  it("rounds converted precio to two decimals", () => {
    const tenant: TenantConfig = {
      ...baseTenant,
      shopifyPriceToCocoaMultiplier: 6.966666,
    };
    expect(applyShopifyPriceToCocoa(10, tenant)).toBe(69.67);
  });
});
