import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";

import { productHasInventoryAvailability } from "./productInventory";

/**
 * Producto publicado en al menos un canal de ventas (REST Admin / webhook).
 * - `draft` y `archived` nunca van a Cocoa.
 * - Con `active`, exige `published_at` no vacío (Shopify: publicado en canal).
 * - Sin `status` en el payload (payloads viejos): solo acepta si hay `published_at`.
 */
export function productIsPublishedForCocoaSync(payload: ShopifyProductWebhookPayload): boolean {
  const status = payload.status?.trim().toLowerCase() ?? "";
  if (status === "draft" || status === "archived") {
    return false;
  }

  const publishedRaw = payload.published_at;
  const hasPublishedAt =
    publishedRaw != null && String(publishedRaw).trim() !== "";

  if (status === "active") {
    return hasPublishedAt;
  }

  if (!status) {
    return hasPublishedAt;
  }

  return false;
}

/** Inventario disponible y publicado en canal de ventas (no borrador). */
export function productShouldSyncToCocoa(payload: ShopifyProductWebhookPayload): boolean {
  return productHasInventoryAvailability(payload) && productIsPublishedForCocoaSync(payload);
}
