import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memoryStore = new Map<string, string>();

export type SyncStatusSnapshot = {
  updatedAt: string;
  source: "webhook" | "bulk_sync";
  ok: boolean;
  shopifyProductId?: number;
  action?: "create" | "update";
  error?: string;
  bulk?: {
    fetched: number;
    created: number;
    updated: number;
    failed: number;
  };
};

function buildKey(tenantId: string): string {
  return `tenant:${tenantId}:sync:status`;
}

export async function getSyncStatus(tenantId: string): Promise<SyncStatusSnapshot | null> {
  const key = buildKey(tenantId);
  if (redis) {
    const raw = await redis.get<string>(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SyncStatusSnapshot;
    } catch {
      return null;
    }
  }
  const raw = memoryStore.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncStatusSnapshot;
  } catch {
    return null;
  }
}

export async function saveSyncStatus(tenantId: string, snapshot: SyncStatusSnapshot): Promise<void> {
  const key = buildKey(tenantId);
  const value = JSON.stringify(snapshot);
  if (redis) {
    await redis.set(key, value);
    return;
  }
  memoryStore.set(key, value);
}
