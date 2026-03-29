import { createProductInCocoa, updateProductInCocoa } from "@/lib/cocoa/client";
import { getCocoaProductKey, saveCocoaProductKey } from "@/lib/productLinks/store";
import { saveSyncStatus } from "@/lib/syncStatus/store";
import type { TenantConfig } from "@/lib/tenants";

import { fetchProductsPageRaw } from "./fetchAdminProducts";
import { mapShopifyProductToCocoaDraft } from "./mapProduct";
import { restProductToWebhookPayload } from "./restProduct";
import type { ShopifyProductWebhookPayload } from "./types";
import {
  decodeBulkSyncCursor,
  encodeBulkSyncCursor,
  initialBulkSyncCursor,
  type BulkSyncCursorV1,
} from "./syncCursor";

export type BulkSyncApiResponse = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  /** Productos procesados en este lote */
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  errors: { shopifyProductId: number; message: string }[];
  errorsTruncated: boolean;
  /** Si true, el cliente debe llamar POST de nuevo con nextCursor */
  hasMore: boolean;
  nextCursor: string | null;
};

const DEFAULT_BATCH_SIZE = 12;
const DELAY_MS_PER_PRODUCT = 30;

function getBatchSize(requested?: number): number {
  const fromEnv = Number(process.env.SHOPIFY_SYNC_BATCH_SIZE?.trim());
  const base = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_BATCH_SIZE;
  const n = requested && requested > 0 ? requested : base;
  return Math.min(Math.max(1, Math.floor(n)), 250);
}

/**
 * Un lote de sincronización: una o varias páginas de Shopify, como máximo `batchSize` productos por petición HTTP.
 *
 * @param shopifyAccessTokenOverride - Token Admin API (token exchange o shpat en JSON).
 * @param cursorParam - Cursor base64url del lote anterior; si null, primera página.
 */
export async function runBulkProductSync(
  tenant: TenantConfig,
  shopifyAccessTokenOverride: string | undefined,
  options: {
    cursor?: string | null;
    batchSize?: number;
  } = {},
): Promise<BulkSyncApiResponse> {
  const accessToken = shopifyAccessTokenOverride ?? tenant.adminAccessToken;
  if (!accessToken) {
    throw new Error(
      "No Shopify Admin API access token: use embedded admin (session token exchange) or add adminAccessToken (shpat_...) to SHOPIFY_TENANTS_JSON for SYNC_SECRET.",
    );
  }

  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  const batchSize = getBatchSize(options.batchSize);

  const cursor: BulkSyncCursorV1 =
    decodeBulkSyncCursor(options.cursor ?? null) ?? initialBulkSyncCursor(tenant.shopDomain, apiVersion);

  const { productsRaw, nextPageUrl } = await fetchProductsPageRaw({
    pageUrl: cursor.pageUrl,
    accessToken,
  });

  const payloads: ShopifyProductWebhookPayload[] = [];
  for (const raw of productsRaw) {
    const p = restProductToWebhookPayload(raw);
    if (p) payloads.push(p);
  }

  /** Página vacía: avanzar a siguiente URL si existe */
  if (payloads.length === 0) {
    if (nextPageUrl) {
      const nextCur: BulkSyncCursorV1 = { v: 1, pageUrl: nextPageUrl, skip: 0 };
      return emptyBatchResponse(tenant, true, encodeBulkSyncCursor(nextCur));
    }
    await saveFinalStatus(tenant.tenantId, 0, 0, 0, 0, true);
    return {
      ok: true,
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      fetched: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      errorsTruncated: false,
      hasMore: false,
      nextCursor: null,
    };
  }

  const slice = payloads.slice(cursor.skip, cursor.skip + batchSize);
  const processedEnd = cursor.skip + slice.length;

  const errors: { shopifyProductId: number; message: string }[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const payload of slice) {
    try {
      const draft = mapShopifyProductToCocoaDraft(payload, tenant);
      const existing = await getCocoaProductKey(tenant.tenantId, payload.id);

      if (existing) {
        await updateProductInCocoa(tenant.cocoa, tenant.tenantId, existing, draft);
        updated += 1;
      } else {
        const cocoaKey = await createProductInCocoa(tenant.cocoa, tenant.tenantId, draft);
        if (cocoaKey) {
          await saveCocoaProductKey(tenant.tenantId, payload.id, cocoaKey);
        }
        created += 1;
      }
    } catch (error) {
      failed += 1;
      errors.push({
        shopifyProductId: payload.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    await new Promise((r) => setTimeout(r, DELAY_MS_PER_PRODUCT));
  }

  let hasMore = false;
  let nextCursor: string | null = null;

  if (processedEnd < payloads.length) {
    hasMore = true;
    nextCursor = encodeBulkSyncCursor({ v: 1, pageUrl: cursor.pageUrl, skip: processedEnd });
  } else if (nextPageUrl) {
    hasMore = true;
    nextCursor = encodeBulkSyncCursor({ v: 1, pageUrl: nextPageUrl, skip: 0 });
  }

  if (!hasMore) {
    await saveFinalStatus(tenant.tenantId, slice.length, created, updated, failed, failed === 0);
  } else {
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "bulk_sync",
      ok: true,
      error: "Sincronización en curso: hay más lotes pendientes.",
      bulk: {
        fetched: slice.length,
        created,
        updated,
        failed,
      },
    });
  }

  return {
    ok: true,
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    fetched: slice.length,
    created,
    updated,
    failed,
    errors: errors.slice(0, 50),
    errorsTruncated: errors.length > 50,
    hasMore,
    nextCursor,
  };
}

function emptyBatchResponse(
  tenant: TenantConfig,
  hasMore: boolean,
  nextCursor: string | null,
): BulkSyncApiResponse {
  return {
    ok: true,
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    fetched: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    errorsTruncated: false,
    hasMore,
    nextCursor,
  };
}

async function saveFinalStatus(
  tenantId: string,
  fetched: number,
  created: number,
  updated: number,
  failed: number,
  ok: boolean,
): Promise<void> {
  await saveSyncStatus(tenantId, {
    updatedAt: new Date().toISOString(),
    source: "bulk_sync",
    ok,
    error: failed > 0 ? `${failed} product(s) failed in last batch` : undefined,
    bulk: {
      fetched,
      created,
      updated,
      failed,
    },
  });
}
