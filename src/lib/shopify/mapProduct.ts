import type { TenantConfig } from "@/lib/tenants";
import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";

export type CocoaProductDraft = {
  nombre: string;
  sku: string;
  descripcion: string;
  precio: number;
  have_stock: boolean;
  stock: number;
  key_categoria: string;
  url_imagen?: string;
};

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Redondeo a 2 decimales para precios enviados a Cocoa. */
function roundPriceForCocoa(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aplica `tenant.shopifyPriceToCocoaMultiplier` al precio del variant de Shopify (p. ej. USD → BOB).
 * Sin multiplicador o multiplicador 1: mismo número que Shopify (redondeado a 2 decimales).
 */
export function applyShopifyPriceToCocoa(shopifyPrice: number, tenant: TenantConfig): number {
  const raw = Number.isFinite(shopifyPrice) ? shopifyPrice : 0;
  const mult = tenant.shopifyPriceToCocoaMultiplier;
  if (mult == null || mult === 1) {
    return roundPriceForCocoa(raw);
  }
  return roundPriceForCocoa(raw * mult);
}

function normalizeCategoryKey(value: string): string {
  return value.trim().toLowerCase();
}

function getCategoryKey(payload: ShopifyProductWebhookPayload, tenant: TenantConfig): string {
  const categoryMap = tenant.categoryMap ?? {};

  const candidateKeys: string[] = [];
  if (payload.product_type) {
    candidateKeys.push(payload.product_type);
  }
  if (payload.tags) {
    candidateKeys.push(...payload.tags.split(","));
  }

  for (const key of candidateKeys) {
    const mapped = categoryMap[normalizeCategoryKey(key)];
    if (mapped) {
      return mapped;
    }
  }

  if (tenant.defaultCategoryKey) {
    return tenant.defaultCategoryKey;
  }

  throw new Error(
    `No category mapping found for product "${payload.title}". Add categoryMap or defaultCategoryKey for tenant ${tenant.tenantId}.`,
  );
}

/**
 * Campos mínimos para marcar un producto como eliminado en Cocoa (sin mapeo por tags).
 * Requiere `defaultCategoryKey` en el tenant.
 */
export function getMinimalCocoaDeleteFields(
  payload: ShopifyProductWebhookPayload,
  tenant: TenantConfig,
): { nombre: string; sku: string; key_categoria: string } {
  const firstVariant = payload.variants[0];
  if (!firstVariant) {
    throw new Error(`Product ${payload.id} does not contain variants`);
  }
  const key = tenant.defaultCategoryKey?.trim();
  if (!key) {
    throw new Error(
      `defaultCategoryKey is required in tenant ${tenant.tenantId} to remove products from Cocoa when inventory is zero.`,
    );
  }
  return {
    nombre: payload.title,
    sku: firstVariant.sku || String(payload.id),
    key_categoria: key,
  };
}

export function mapShopifyProductToCocoaDraft(
  payload: ShopifyProductWebhookPayload,
  tenant: TenantConfig,
): CocoaProductDraft {
  const firstVariant = payload.variants[0];
  if (!firstVariant) {
    throw new Error(`Product ${payload.id} does not contain variants`);
  }

  const parsedPrice = Number(firstVariant.price ?? "0");
  const stock = Number(firstVariant.inventory_quantity ?? 0);
  const imageUrl = payload.image?.src ?? payload.images?.[0]?.src;

  return {
    nombre: payload.title,
    sku: firstVariant.sku || String(payload.id),
    descripcion: stripHtml(payload.body_html ?? ""),
    precio: applyShopifyPriceToCocoa(parsedPrice, tenant),
    have_stock: stock > 0,
    stock: Number.isFinite(stock) ? stock : 0,
    key_categoria: getCategoryKey(payload, tenant),
    url_imagen: imageUrl,
  };
}

