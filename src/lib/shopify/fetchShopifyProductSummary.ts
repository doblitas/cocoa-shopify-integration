const DEFAULT_API_VERSION = "2024-10";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProductJson = {
  product?: {
    title?: unknown;
    image?: { src?: unknown } | null;
    images?: { src?: unknown }[];
  };
};

function parseProductSummary(raw: unknown): { title: string; imageUrl: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = (raw as ProductJson).product;
  if (!p || typeof p !== "object") return null;
  const title = typeof p.title === "string" ? p.title : "";

  let imageUrl: string | null = null;
  if (p.image && typeof p.image === "object" && typeof p.image.src === "string" && p.image.src) {
    imageUrl = p.image.src;
  } else if (Array.isArray(p.images) && p.images.length > 0) {
    const first = p.images[0];
    if (first && typeof first === "object" && typeof first.src === "string" && first.src) {
      imageUrl = first.src;
    }
  }

  return { title: title || "—", imageUrl };
}

/**
 * GET /admin/api/{version}/products/{id}.json — título e imagen para el dashboard.
 */
export async function fetchShopifyProductSummary(options: {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  productId: number;
}): Promise<{ title: string; imageUrl: string | null } | null> {
  const shop = options.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const url = `https://${shop}/admin/api/${apiVersion}/products/${options.productId}.json`;
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": options.accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as ProductJson;
  return parseProductSummary(data);
}

export type SyncedLinkInput = {
  shopifyProductId: number;
  cocoaKey: string;
};

export type EnrichedSyncedItem = SyncedLinkInput & {
  title?: string;
  imageUrl?: string | null;
};

/**
 * Enriquece cada vínculo con título e imagen (peticiones en pequeños lotes para respetar límites).
 */
export async function enrichSyncedProductItems(
  items: SyncedLinkInput[],
  options: {
    shopDomain: string;
    accessToken: string;
    apiVersion?: string;
    concurrency?: number;
    delayBetweenBatchesMs?: number;
  },
): Promise<EnrichedSyncedItem[]> {
  if (items.length === 0) return [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const delayMs = options.delayBetweenBatchesMs ?? 80;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const { shopDomain, accessToken } = options;

  const out: EnrichedSyncedItem[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const chunk = await Promise.all(
      batch.map(async (item) => {
        const summary = await fetchShopifyProductSummary({
          shopDomain,
          accessToken,
          apiVersion,
          productId: item.shopifyProductId,
        });
        if (!summary) {
          return { ...item };
        }
        return {
          ...item,
          title: summary.title,
          imageUrl: summary.imageUrl,
        };
      }),
    );
    out.push(...chunk);
    if (i + concurrency < items.length) {
      await sleep(delayMs);
    }
  }

  return out;
}
