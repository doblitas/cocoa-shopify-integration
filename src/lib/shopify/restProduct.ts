import type { ShopifyProductImage, ShopifyProductVariant, ShopifyProductWebhookPayload } from "@/lib/shopify/types";

function normalizeVariant(v: unknown): ShopifyProductVariant | null {
  if (!v || typeof v !== "object") {
    return null;
  }
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "number" ? o.id : Number(o.id);
  if (!Number.isFinite(id)) {
    return null;
  }
  const inv = o.inventory_quantity;
  let stock: number | null = null;
  if (typeof inv === "number" && Number.isFinite(inv)) {
    stock = inv;
  } else if (inv != null) {
    const n = Number(inv);
    stock = Number.isFinite(n) ? n : null;
  }
  return {
    id,
    sku: o.sku != null ? String(o.sku) : null,
    price: String(o.price ?? "0"),
    inventory_quantity: stock,
  };
}

function normalizeImage(v: unknown): ShopifyProductImage | null {
  if (!v || typeof v !== "object") {
    return null;
  }
  const o = v as Record<string, unknown>;
  const src = o.src != null ? String(o.src) : "";
  if (!src) {
    return null;
  }
  return { src };
}

/**
 * Convierte un producto devuelto por la Admin REST API al shape usado por el mapper Cocoa.
 */
export function restProductToWebhookPayload(raw: unknown): ShopifyProductWebhookPayload | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const p = raw as Record<string, unknown>;
  const id = typeof p.id === "number" ? p.id : Number(p.id);
  if (!Number.isFinite(id)) {
    return null;
  }

  const variantList = Array.isArray(p.variants) ? p.variants.map(normalizeVariant).filter(Boolean) : [];
  const variants = variantList as ShopifyProductVariant[];
  if (variants.length === 0) {
    return null;
  }

  const imagesRaw = Array.isArray(p.images) ? p.images.map(normalizeImage).filter(Boolean) : [];
  const images = imagesRaw as ShopifyProductImage[];

  const imageObj = p.image && typeof p.image === "object" ? normalizeImage(p.image) : null;
  const image = imageObj ?? images[0] ?? null;

  const status = p.status == null ? null : typeof p.status === "string" ? p.status : String(p.status);
  const publishedAt =
    p.published_at == null ? null : typeof p.published_at === "string" ? p.published_at : String(p.published_at);

  return {
    id,
    title: String(p.title ?? ""),
    body_html: p.body_html != null ? String(p.body_html) : null,
    product_type: p.product_type != null ? String(p.product_type) : null,
    tags: p.tags != null ? String(p.tags) : null,
    status,
    published_at: publishedAt,
    variants,
    image,
    images: images.length > 0 ? images : undefined,
  };
}

export function parseNextPageUrlFromLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const m = part.trim().match(/<([^>]+)>;\s*rel="next"/);
    if (m?.[1]) {
      return m[1];
    }
  }
  return null;
}
