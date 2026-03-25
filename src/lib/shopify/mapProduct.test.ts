import { describe, expect, it } from "vitest";

import { mapShopifyProductToCocoaDraft } from "@/lib/shopify/mapProduct";
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
  it("maps title, price, sku and default category", () => {
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
    expect(draft.precio).toBe(12.5);
    expect(draft.have_stock).toBe(true);
    expect(draft.stock).toBe(3);
    expect(draft.key_categoria).toBe("cat-default");
    expect(draft.descripcion).toBe("Hello");
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
});
