import { createProductInCocoa, updateProductInCocoa } from "@/lib/cocoa/client";
import { getCocoaProductKey, saveCocoaProductKey } from "@/lib/productLinks/store";
import { saveSyncStatus } from "@/lib/syncStatus/store";
import type { TenantConfig } from "@/lib/tenants";

import { fetchAllShopifyProductsForSync } from "./fetchAdminProducts";
import { mapShopifyProductToCocoaDraft } from "./mapProduct";

export type BulkSyncApiResponse = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  errors: { shopifyProductId: number; message: string }[];
  errorsTruncated: boolean;
};

/**
 * Fetches all Shopify products for the tenant and creates/updates them in Cocoa.
 * Persists bulk sync status in Redis (or memory fallback).
 *
 * @param shopifyAccessTokenOverride - Admin API token from `auth.tokenExchange` (embedded app / Dev Dashboard).
 *   If omitted, uses `tenant.adminAccessToken` (e.g. curl with SYNC_SECRET).
 */
export async function runBulkProductSync(
  tenant: TenantConfig,
  maxProducts: number,
  shopifyAccessTokenOverride?: string,
): Promise<BulkSyncApiResponse> {
  const accessToken = shopifyAccessTokenOverride ?? tenant.adminAccessToken;
  if (!accessToken) {
    throw new Error(
      "No Shopify Admin API access token: use embedded admin (session token exchange) or add adminAccessToken (shpat_...) to SHOPIFY_TENANTS_JSON for SYNC_SECRET.",
    );
  }

  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  let payloads;
  try {
    payloads = await fetchAllShopifyProductsForSync({
      shopDomain: tenant.shopDomain,
      accessToken,
      apiVersion,
      maxProducts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Shopify products";
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "bulk_sync",
      ok: false,
      error: message,
    });
    throw new Error(message);
  }

  const errors: { shopifyProductId: number; message: string }[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const payload of payloads) {
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

    await new Promise((r) => setTimeout(r, 75));
  }

  await saveSyncStatus(tenant.tenantId, {
    updatedAt: new Date().toISOString(),
    source: "bulk_sync",
    ok: failed === 0,
    error: failed > 0 ? `${failed} product(s) failed to sync` : undefined,
    bulk: {
      fetched: payloads.length,
      created,
      updated,
      failed,
    },
  });

  return {
    ok: true,
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    fetched: payloads.length,
    created,
    updated,
    failed,
    errors: errors.slice(0, 50),
    errorsTruncated: errors.length > 50,
  };
}
