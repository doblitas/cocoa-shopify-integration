import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";

/**
 * Suma `inventory_quantity` de todas las variantes (valores null o no numéricos = 0).
 * Requiere datos de Admin API / webhook con cantidades; si todo viene null, el total es 0.
 */
export function getTotalInventoryQuantity(payload: ShopifyProductWebhookPayload): number {
  let sum = 0;
  for (const v of payload.variants) {
    const q = v.inventory_quantity;
    if (q != null && Number.isFinite(q)) {
      sum += Math.max(0, q);
    }
  }
  return sum;
}

/** True si hay al menos una unidad disponible en el producto (suma de variantes > 0). */
export function productHasInventoryAvailability(payload: ShopifyProductWebhookPayload): boolean {
  return getTotalInventoryQuantity(payload) > 0;
}
