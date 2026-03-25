import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryClaimed = new Set<string>();

const TTL_SECONDS = 60 * 60 * 24;

/**
 * Returns true if this webhook id was not seen before (claim succeeded).
 * Returns false if duplicate delivery (Shopify retry) — caller should short-circuit with 200.
 */
export async function claimShopifyWebhookOnce(
  tenantId: string,
  webhookId: string,
): Promise<boolean> {
  const key = `tenant:${tenantId}:shopify-webhook:${webhookId}`;
  if (redis) {
    const set = await redis.set(key, "1", { nx: true, ex: TTL_SECONDS });
    return set === "OK";
  }
  if (memoryClaimed.has(key)) {
    return false;
  }
  memoryClaimed.add(key);
  return true;
}
