import { restProductToWebhookPayload, parseNextPageUrlFromLinkHeader } from "@/lib/shopify/restProduct";
import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";

const DEFAULT_API_VERSION = "2024-10";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProductsResponse = {
  products?: unknown[];
};

type ProductsCountResponse = {
  count?: number;
};

/**
 * Conteo total de productos (REST Admin). Misma versión que el sync.
 */
export async function fetchShopifyProductCount(options: {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<number> {
  const shop = options.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const url = `https://${shop}/admin/api/${apiVersion}/products/count.json`;
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": options.accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify products count ${response.status}: ${text}`);
  }
  const data = (await response.json()) as ProductsCountResponse;
  return typeof data.count === "number" && data.count >= 0 ? data.count : 0;
}

/**
 * Una sola petición GET a la URL de productos (página de Shopify).
 */
export async function fetchProductsPageRaw(options: {
  pageUrl: string;
  accessToken: string;
}): Promise<{
  productsRaw: unknown[];
  nextPageUrl: string | null;
}> {
  const response = await fetch(options.pageUrl, {
    headers: {
      "X-Shopify-Access-Token": options.accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify products API ${response.status}: ${text}`);
  }

  const data = (await response.json()) as ProductsResponse;
  const productsRaw = data.products ?? [];
  const nextPageUrl = parseNextPageUrlFromLinkHeader(response.headers.get("link"));
  return { productsRaw, nextPageUrl };
}

/**
 * Lista todos los productos vía Admin REST API con paginación por Link header.
 */
export async function fetchAllShopifyProductsForSync(options: {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  maxProducts?: number;
  delayMsBetweenPages?: number;
}): Promise<ShopifyProductWebhookPayload[]> {
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const maxProducts = options.maxProducts ?? 10_000;
  const delayMs = options.delayMsBetweenPages ?? 300;

  const shop = options.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let nextUrl: string | null = `https://${shop}/admin/api/${apiVersion}/products.json?limit=250`;

  const out: ShopifyProductWebhookPayload[] = [];

  while (nextUrl && out.length < maxProducts) {
    const response = await fetch(nextUrl, {
      headers: {
        "X-Shopify-Access-Token": options.accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify products API ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ProductsResponse;
    const products = data.products ?? [];

    for (const raw of products) {
      if (out.length >= maxProducts) {
        break;
      }
      const payload = restProductToWebhookPayload(raw);
      if (payload) {
        out.push(payload);
      }
    }

    nextUrl = parseNextPageUrlFromLinkHeader(response.headers.get("link"));
    if (nextUrl) {
      await sleep(delayMs);
    }
  }

  return out;
}
