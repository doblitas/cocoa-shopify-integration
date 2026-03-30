import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryStore = new Map<string, string>();

/** Máximo de filas devueltas al dashboard (evita respuestas enormes). */
export const MAX_SYNCED_PRODUCTS_LIST = 5000;

export type SyncedProductLink = {
  shopifyProductId: number;
  cocoaKey: string;
};

export type ListSyncedProductLinksResult = {
  items: SyncedProductLink[];
  truncated: boolean;
  totalKeys: number;
};

function buildKey(tenantId: string, shopifyProductId: number): string {
  return `tenant:${tenantId}:shopify-product:${shopifyProductId}:cocoa-key`;
}

function parseProductIdFromRedisKey(tenantId: string, key: string): number | null {
  const escaped = tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^tenant:${escaped}:shopify-product:(\\d+):cocoa-key$`);
  const m = key.match(re);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Lista vínculos Shopify product id → Cocoa key (SCAN en Redis / iteración en memoria).
 */
export async function listSyncedProductLinks(tenantId: string): Promise<ListSyncedProductLinksResult> {
  const pattern = `tenant:${tenantId}:shopify-product:*:cocoa-key`;

  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, found] = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== "0");

    keys.sort();
    const totalKeys = keys.length;
    const truncated = totalKeys > MAX_SYNCED_PRODUCTS_LIST;
    const capped = keys.slice(0, MAX_SYNCED_PRODUCTS_LIST);
    const items: SyncedProductLink[] = [];

    for (let i = 0; i < capped.length; i += 100) {
      const batch = capped.slice(i, i + 100);
      const vals = await redis.mget<(string | null)[]>(...batch);
      batch.forEach((key, idx) => {
        const cocoaKey = vals[idx];
        const shopifyProductId = parseProductIdFromRedisKey(tenantId, key);
        if (shopifyProductId != null && cocoaKey) {
          items.push({ shopifyProductId, cocoaKey });
        }
      });
    }

    items.sort((a, b) => a.shopifyProductId - b.shopifyProductId);
    return { items, truncated, totalKeys };
  }

  const prefix = `tenant:${tenantId}:shopify-product:`;
  const suffix = `:cocoa-key`;
  const raw: SyncedProductLink[] = [];
  for (const [key, cocoaKey] of memoryStore.entries()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const shopifyProductId = parseProductIdFromRedisKey(tenantId, key);
    if (shopifyProductId != null) {
      raw.push({ shopifyProductId, cocoaKey });
    }
  }
  raw.sort((a, b) => a.shopifyProductId - b.shopifyProductId);
  const totalKeys = raw.length;
  const truncated = totalKeys > MAX_SYNCED_PRODUCTS_LIST;
  const items = raw.slice(0, MAX_SYNCED_PRODUCTS_LIST);
  return { items, truncated, totalKeys };
}

/**
 * Todos los vínculos (sin tope del dashboard). Para desinstalación masiva u operaciones internas.
 */
export async function listAllSyncedProductLinks(tenantId: string): Promise<SyncedProductLink[]> {
  const pattern = `tenant:${tenantId}:shopify-product:*:cocoa-key`;

  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, found] = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== "0");

    keys.sort();
    const items: SyncedProductLink[] = [];

    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      const vals = await redis.mget<(string | null)[]>(...batch);
      batch.forEach((key, idx) => {
        const cocoaKey = vals[idx];
        const shopifyProductId = parseProductIdFromRedisKey(tenantId, key);
        if (shopifyProductId != null && cocoaKey) {
          items.push({ shopifyProductId, cocoaKey });
        }
      });
    }

    items.sort((a, b) => a.shopifyProductId - b.shopifyProductId);
    return items;
  }

  const prefix = `tenant:${tenantId}:shopify-product:`;
  const suffix = `:cocoa-key`;
  const raw: SyncedProductLink[] = [];
  for (const [key, cocoaKey] of memoryStore.entries()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const shopifyProductId = parseProductIdFromRedisKey(tenantId, key);
    if (shopifyProductId != null) {
      raw.push({ shopifyProductId, cocoaKey });
    }
  }
  raw.sort((a, b) => a.shopifyProductId - b.shopifyProductId);
  return raw;
}

/**
 * Todos los `shopifyProductId` con vínculo en Redis (scan completo; solo IDs, sin límite de listado del dashboard).
 */
export async function listAllLinkedShopifyProductIds(tenantId: string): Promise<number[]> {
  const pattern = `tenant:${tenantId}:shopify-product:*:cocoa-key`;
  const ids: number[] = [];

  if (redis) {
    let cursor = "0";
    do {
      const [nextCursor, found] = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = nextCursor;
      for (const key of found) {
        const id = parseProductIdFromRedisKey(tenantId, key);
        if (id != null) ids.push(id);
      }
    } while (cursor !== "0");
  } else {
    const prefix = `tenant:${tenantId}:shopify-product:`;
    const suffix = `:cocoa-key`;
    for (const key of memoryStore.keys()) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const id = parseProductIdFromRedisKey(tenantId, key);
      if (id != null) ids.push(id);
    }
  }

  ids.sort((a, b) => a - b);
  return ids;
}

export async function getCocoaProductKey(
  tenantId: string,
  shopifyProductId: number,
): Promise<string | null> {
  const key = buildKey(tenantId, shopifyProductId);
  if (redis) {
    return (await redis.get<string>(key)) ?? null;
  }
  return memoryStore.get(key) ?? null;
}

export async function saveCocoaProductKey(
  tenantId: string,
  shopifyProductId: number,
  cocoaProductKey: string,
): Promise<void> {
  const key = buildKey(tenantId, shopifyProductId);
  if (redis) {
    await redis.set(key, cocoaProductKey);
    return;
  }
  memoryStore.set(key, cocoaProductKey);
}

export async function removeCocoaProductKey(tenantId: string, shopifyProductId: number): Promise<void> {
  const key = buildKey(tenantId, shopifyProductId);
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryStore.delete(key);
}
