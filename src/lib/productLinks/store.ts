import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryStore = new Map<string, string>();

function buildKey(tenantId: string, shopifyProductId: number): string {
  return `tenant:${tenantId}:shopify-product:${shopifyProductId}:cocoa-key`;
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

