import { markProductDeletedInCocoa } from "@/lib/cocoa/client";
import { listAllSyncedProductLinks, removeCocoaProductKey } from "@/lib/productLinks/store";
import { saveSyncStatus } from "@/lib/syncStatus/store";
import type { TenantConfig } from "@/lib/tenants";
import { getOverallSyncMaxMs } from "@/lib/shopify/runBulkProductSync";

const DELAY_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cursor v3: procesar solo productos con shopifyProductId > afterId (estable al borrar vínculos en Redis). */
function encodeAfterIdCursor(afterId: number): string {
  return Buffer.from(JSON.stringify({ v: 3, afterId }), "utf8").toString("base64url");
}

function decodeAfterIdCursor(cursor: string | null): number {
  if (!cursor) return -1;
  try {
    const j = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: number; afterId?: unknown };
    if (j.v === 3 && typeof j.afterId === "number" && Number.isFinite(j.afterId)) {
      return j.afterId;
    }
  } catch {
    /* ignore */
  }
  return -1;
}

export type UninstallCocoaApiResponse = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  deleted: number;
  failed: number;
  remainingAfterBatch: number;
  errors: { shopifyProductId: number; message: string }[];
  errorsTruncated: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  stalled?: boolean;
  warning?: string;
};

/**
 * Marca como eliminados en Cocoa todos los productos con vínculo en Redis y borra las claves.
 * Cursor por `afterId` (Shopify product id), estable entre peticiones aunque cambie el tamaño de la lista.
 */
export async function runUninstallCocoaConnection(
  tenant: TenantConfig,
  options: { cursor: string | null },
): Promise<UninstallCocoaApiResponse> {
  const categoryKey = tenant.defaultCategoryKey?.trim();
  if (!categoryKey) {
    throw new Error(
      `defaultCategoryKey is required in tenant ${tenant.tenantId} to remove products from Cocoa.`,
    );
  }

  let baseAfterId = decodeAfterIdCursor(options.cursor);
  const deadline = Date.now() + getOverallSyncMaxMs() - 5000;
  let deleted = 0;
  let failed = 0;
  const errors: { shopifyProductId: number; message: string }[] = [];

  const allLinks = await listAllSyncedProductLinks(tenant.tenantId);
  if (allLinks.length === 0) {
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "uninstall",
      ok: true,
      bulk: {
        fetched: 0,
        created: 0,
        updated: 0,
        failed: 0,
      },
    });
    return {
      ok: true,
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      deleted: 0,
      failed: 0,
      remainingAfterBatch: 0,
      errors: [],
      errorsTruncated: false,
      hasMore: false,
      nextCursor: null,
    };
  }

  let work = allLinks.filter((l) => l.shopifyProductId > baseAfterId);
  if (work.length === 0 && allLinks.length > 0 && baseAfterId !== -1) {
    baseAfterId = -1;
    work = allLinks.filter((l) => l.shopifyProductId > baseAfterId);
  }

  const countBefore = work.length;

  if (countBefore === 0) {
    const remainingAfter = (await listAllSyncedProductLinks(tenant.tenantId)).length;
    return {
      ok: true,
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      deleted: 0,
      failed: 0,
      remainingAfterBatch: remainingAfter,
      errors: [],
      errorsTruncated: false,
      hasMore: remainingAfter > 0,
      nextCursor: remainingAfter > 0 ? encodeAfterIdCursor(-1) : null,
      warning: remainingAfter > 0 ? "Quedan vínculos; pulsa de nuevo para continuar." : undefined,
    };
  }

  for (let i = 0; i < work.length; i++) {
    if (Date.now() > deadline) {
      const afterIdNext = i > 0 ? work[i - 1]!.shopifyProductId : baseAfterId;
      await saveSyncStatus(tenant.tenantId, {
        updatedAt: new Date().toISOString(),
        source: "uninstall",
        ok: true,
        error: "Desinstalación en curso: límite de tiempo; vuelve a repetir la acción.",
        bulk: {
          fetched: deleted + failed,
          created: 0,
          updated: 0,
          failed,
        },
      });
      return {
        ok: true,
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        deleted,
        failed,
        remainingAfterBatch: Math.max(0, work.length - i),
        errors: errors.slice(0, 50),
        errorsTruncated: errors.length > 50,
        hasMore: true,
        nextCursor: encodeAfterIdCursor(afterIdNext),
        warning:
          "Tiempo máximo alcanzado; pulsa de nuevo «Desinstalar conexión» para continuar hasta que no queden vínculos.",
      };
    }

    const link = work[i]!;
    try {
      await markProductDeletedInCocoa(tenant.cocoa, tenant.tenantId, link.cocoaKey, {
        nombre: `Producto ${link.shopifyProductId}`,
        sku: String(link.shopifyProductId),
        key_categoria: categoryKey,
      });
      await removeCocoaProductKey(tenant.tenantId, link.shopifyProductId);
      deleted += 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 100) {
        errors.push({
          shopifyProductId: link.shopifyProductId,
          message: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    await sleep(DELAY_MS);
  }

  const remainingAfter = (await listAllSyncedProductLinks(tenant.tenantId)).length;
  const allFailedInBatch = deleted === 0 && failed === countBefore && countBefore > 0;
  const stalled = allFailedInBatch && remainingAfter > 0;

  if (stalled) {
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "uninstall",
      ok: false,
      error:
        "Desinstalación detenida: Cocoa rechazó todos los productos de este lote. Revisa credenciales o el panel de Cocoa.",
      bulk: {
        fetched: deleted + failed,
        created: 0,
        updated: 0,
        failed,
      },
    });
    return {
      ok: true,
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      deleted,
      failed,
      remainingAfterBatch: remainingAfter,
      errors: errors.slice(0, 50),
      errorsTruncated: errors.length > 50,
      hasMore: false,
      nextCursor: null,
      stalled: true,
      warning:
        "Ningún producto pudo marcarse como eliminado en Cocoa. Corrige el error y vuelve a intentar o borra los vínculos manualmente.",
    };
  }

  const hasMore = remainingAfter > 0;

  if (!hasMore) {
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "uninstall",
      ok: failed === 0,
      error: failed > 0 ? `${failed} producto(s) no pudieron borrarse en Cocoa antes de terminar` : undefined,
      bulk: {
        fetched: deleted + failed,
        created: 0,
        updated: 0,
        failed,
      },
    });
  } else {
    await saveSyncStatus(tenant.tenantId, {
      updatedAt: new Date().toISOString(),
      source: "uninstall",
      ok: true,
      error: "Desinstalación en curso: hay más vínculos pendientes.",
      bulk: {
        fetched: deleted + failed,
        created: 0,
        updated: 0,
        failed,
      },
    });
  }

  return {
    ok: true,
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    deleted,
    failed,
    remainingAfterBatch: remainingAfter,
    errors: errors.slice(0, 50),
    errorsTruncated: errors.length > 50,
    hasMore,
    nextCursor: hasMore ? encodeAfterIdCursor(-1) : null,
    warning: hasMore
      ? "Quedan vínculos por procesar; pulsa de nuevo «Desinstalar conexión» para continuar."
      : undefined,
  };
}
