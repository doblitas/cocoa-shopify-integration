import {
  createProductInCocoa,
  markProductDeletedInCocoa,
  updateProductInCocoa,
} from "@/lib/cocoa/client";
import { getCocoaProductKey, removeCocoaProductKey, saveCocoaProductKey } from "@/lib/productLinks/store";
import { saveSyncStatus } from "@/lib/syncStatus/store";
import type { TenantConfig } from "@/lib/tenants";

import { fetchProductsPageRaw } from "./fetchAdminProducts";
import {
  getMinimalCocoaDeleteFields,
  mapShopifyProductToCocoaDraft,
} from "./mapProduct";
import { productShouldSyncToCocoa } from "./productSyncEligibility";
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
  /** Productos procesados en este lote (o el total si fue un sync completo en servidor) */
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  errors: { shopifyProductId: number; message: string }[];
  errorsTruncated: boolean;
  /** Si true, el cliente debe llamar POST de nuevo con nextCursor */
  hasMore: boolean;
  nextCursor: string | null;
  /** Solo cuando el servidor corta por tiempo global (catálogo muy grande). */
  warning?: string;
  /** Sin stock y sin vínculo previo: no se creó en Cocoa. */
  skippedNoInventory?: number;
  /** Sin stock pero había vínculo: marcado deleted en Cocoa y borrado vínculo. */
  removedFromCocoa?: number;
};

const DEFAULT_BATCH_SIZE = 12;
const DELAY_MS_PER_PRODUCT = 30;
/** Stop Cocoa loop before Vercel kills the function (default 300s). */
const DEFAULT_SYNC_BUDGET_MS = 240_000;
/** Tiempo máximo para un solo POST que hace todo el bucle en servidor (por debajo de maxDuration). */
const DEFAULT_OVERALL_SYNC_MAX_MS = 280_000;

function getSyncBudgetMs(): number {
  const raw = process.env.SHOPIFY_SYNC_BUDGET_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_SYNC_BUDGET_MS;
  if (!Number.isFinite(n) || n < 10_000) {
    return DEFAULT_SYNC_BUDGET_MS;
  }
  return Math.min(Math.floor(n), 295_000);
}

function getBatchSize(requested?: number): number {
  const fromEnv = Number(process.env.SHOPIFY_SYNC_BATCH_SIZE?.trim());
  const base = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_BATCH_SIZE;
  const n = requested && requested > 0 ? requested : base;
  return Math.min(Math.max(1, Math.floor(n)), 250);
}

function getOverallSyncMaxMs(): number {
  const raw = process.env.SHOPIFY_SYNC_OVERALL_MAX_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_OVERALL_SYNC_MAX_MS;
  if (!Number.isFinite(n) || n < 60_000) {
    return DEFAULT_OVERALL_SYNC_MAX_MS;
  }
  return Math.min(Math.floor(n), 295_000);
}

function getSliceBudgetMs(override?: number): number {
  if (override != null) {
    return Math.max(5_000, Math.min(Math.floor(override), 295_000));
  }
  return getSyncBudgetMs();
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
    /** No escribir Redis; el caller agrega varios lotes y guarda al final. */
    suppressStatusWrites?: boolean;
    /** Tiempo restante para procesar el slice (p. ej. bucle en servidor). */
    budgetMsOverride?: number;
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
  const suppressStatusWrites = Boolean(options.suppressStatusWrites);

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
    if (!suppressStatusWrites) {
      await saveFinalStatus(tenant.tenantId, 0, 0, 0, 0, true);
    }
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
      skippedNoInventory: 0,
      removedFromCocoa: 0,
    };
  }

  const slice = payloads.slice(cursor.skip, cursor.skip + batchSize);
  const budgetMs = getSliceBudgetMs(options.budgetMsOverride);
  const started = Date.now();

  const errors: { shopifyProductId: number; message: string }[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  let skippedNoInventory = 0;
  let removedFromCocoa = 0;

  /** First index in `slice` not yet processed (set when we hit the time budget). */
  let budgetStopIndexInSlice: number | null = null;

  for (let i = 0; i < slice.length; i++) {
    if (Date.now() - started > budgetMs) {
      budgetStopIndexInSlice = i;
      break;
    }

    const payload = slice[i]!;
    try {
      if (!productShouldSyncToCocoa(payload)) {
        const existing = await getCocoaProductKey(tenant.tenantId, payload.id);
        if (existing) {
          const minimal = getMinimalCocoaDeleteFields(payload, tenant);
          await markProductDeletedInCocoa(tenant.cocoa, tenant.tenantId, existing, minimal);
          await removeCocoaProductKey(tenant.tenantId, payload.id);
          removedFromCocoa += 1;
        } else {
          skippedNoInventory += 1;
        }
      } else {
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

  const completedInSlice =
    budgetStopIndexInSlice === null ? slice.length : budgetStopIndexInSlice;
  const processedEnd = cursor.skip + completedInSlice;

  if (budgetStopIndexInSlice !== null) {
    const nextCur: BulkSyncCursorV1 = { v: 1, pageUrl: cursor.pageUrl, skip: processedEnd };
    if (!suppressStatusWrites) {
      await saveSyncStatus(tenant.tenantId, {
        updatedAt: new Date().toISOString(),
        source: "bulk_sync",
        ok: true,
        error: "Sincronización en curso: límite de tiempo por petición; continúa el siguiente lote.",
        bulk: {
          fetched: completedInSlice,
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
      fetched: completedInSlice,
      created,
      updated,
      failed,
      errors: errors.slice(0, 50),
      errorsTruncated: errors.length > 50,
      hasMore: true,
      nextCursor: encodeBulkSyncCursor(nextCur),
      skippedNoInventory,
      removedFromCocoa,
    };
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

  if (!suppressStatusWrites) {
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
    skippedNoInventory,
    removedFromCocoa,
  };
}

const MAX_SERVER_SYNC_ITERATIONS = 100_000;

/**
 * Una sola petición HTTP: encadena lotes en el servidor hasta terminar el catálogo o agotar el tiempo global
 * (Vercel maxDuration). El cliente ya no tiene que llamar en bucle con cursor.
 */
export async function runBulkProductSyncUntilDone(
  tenant: TenantConfig,
  shopifyAccessTokenOverride: string | undefined,
  options: { batchSize?: number } = {},
): Promise<BulkSyncApiResponse> {
  const deadline = Date.now() + getOverallSyncMaxMs();
  let cursor: string | null = null;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalFetched = 0;
  let totalSkippedNoInventory = 0;
  let totalRemovedFromCocoa = 0;
  const allErrors: { shopifyProductId: number; message: string }[] = [];

  for (let iter = 0; iter < MAX_SERVER_SYNC_ITERATIONS; iter += 1) {
    const remaining = deadline - Date.now() - 5_000;
    if (remaining < 5_000) {
      await saveSyncStatus(tenant.tenantId, {
        updatedAt: new Date().toISOString(),
        source: "bulk_sync",
        ok: totalFailed === 0,
        error:
          "Sincronización incompleta: tiempo máximo del servidor. Pulsa «Sincronizar todo» de nuevo para continuar.",
        bulk: {
          fetched: totalFetched,
          created: totalCreated,
          updated: totalUpdated,
          failed: totalFailed,
        },
      });
      return {
        ok: true,
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        failed: totalFailed,
        errors: allErrors.slice(0, 50),
        errorsTruncated: allErrors.length > 50,
        hasMore: true,
        nextCursor: cursor,
        warning:
          "Tiempo máximo alcanzado; pulsa de nuevo «Sincronizar todo» para continuar desde donde quedó.",
        skippedNoInventory: totalSkippedNoInventory,
        removedFromCocoa: totalRemovedFromCocoa,
      };
    }

    const result = await runBulkProductSync(tenant, shopifyAccessTokenOverride, {
      cursor,
      batchSize: options.batchSize,
      suppressStatusWrites: true,
      budgetMsOverride: Math.min(getSyncBudgetMs(), remaining),
    });

    totalCreated += result.created;
    totalUpdated += result.updated;
    totalFailed += result.failed;
    totalFetched += result.fetched;
    totalSkippedNoInventory += result.skippedNoInventory ?? 0;
    totalRemovedFromCocoa += result.removedFromCocoa ?? 0;
    for (const e of result.errors) {
      if (allErrors.length < 100) allErrors.push(e);
    }

    if (!result.hasMore) {
      await saveSyncStatus(tenant.tenantId, {
        updatedAt: new Date().toISOString(),
        source: "bulk_sync",
        ok: totalFailed === 0,
        error: totalFailed > 0 ? `${totalFailed} product(s) failed` : undefined,
        bulk: {
          fetched: totalFetched,
          created: totalCreated,
          updated: totalUpdated,
          failed: totalFailed,
        },
      });
      return {
        ok: true,
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        failed: totalFailed,
        errors: allErrors.slice(0, 50),
        errorsTruncated: allErrors.length > 50,
        hasMore: false,
        nextCursor: null,
        skippedNoInventory: totalSkippedNoInventory,
        removedFromCocoa: totalRemovedFromCocoa,
      };
    }

    /** Evita bucle infinito si el cursor no cambia (fallo de datos / API). */
    const next = result.nextCursor;
    if (next === cursor) {
      await saveSyncStatus(tenant.tenantId, {
        updatedAt: new Date().toISOString(),
        source: "bulk_sync",
        ok: false,
        error: "El cursor de sync no avanzó; sincronización detenida para evitar un bucle.",
        bulk: {
          fetched: totalFetched,
          created: totalCreated,
          updated: totalUpdated,
          failed: totalFailed,
        },
      });
      return {
        ok: true,
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        failed: totalFailed,
        errors: allErrors.slice(0, 50),
        errorsTruncated: allErrors.length > 50,
        hasMore: false,
        nextCursor: null,
        warning: "Cursor sin avance; revisa logs o contacta soporte.",
        skippedNoInventory: totalSkippedNoInventory,
        removedFromCocoa: totalRemovedFromCocoa,
      };
    }

    cursor = next;
  }

  await saveSyncStatus(tenant.tenantId, {
    updatedAt: new Date().toISOString(),
    source: "bulk_sync",
    ok: false,
    error: "Límite interno de iteraciones de sync; contacta soporte.",
    bulk: {
      fetched: totalFetched,
      created: totalCreated,
      updated: totalUpdated,
      failed: totalFailed,
    },
  });
  return {
    ok: true,
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    fetched: totalFetched,
    created: totalCreated,
    updated: totalUpdated,
    failed: totalFailed,
    errors: allErrors.slice(0, 50),
    errorsTruncated: allErrors.length > 50,
    hasMore: true,
    nextCursor: cursor,
    warning: "Límite interno de iteraciones; vuelve a intentar o reduce el catálogo.",
    skippedNoInventory: totalSkippedNoInventory,
    removedFromCocoa: totalRemovedFromCocoa,
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
    skippedNoInventory: 0,
    removedFromCocoa: 0,
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
