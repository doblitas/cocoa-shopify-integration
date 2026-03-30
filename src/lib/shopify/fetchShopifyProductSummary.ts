const DEFAULT_API_VERSION = "2024-10";

/** Productos por petición GraphQL (evita timeouts con miles de enlaces). */
const GRAPHQL_NODES_BATCH = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toProductGid(productId: number): string {
  return `gid://shopify/Product/${productId}`;
}

type GraphQLNodesResponse = {
  data?: {
    nodes?: unknown[];
  };
  errors?: unknown;
};

/**
 * Varias peticiones GraphQL con `nodes` (título + SKU primera variante), sin imágenes.
 */
async function fetchProductTitleAndSkuBatch(options: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  productIds: number[];
}): Promise<Map<number, { title: string; sku: string | null }>> {
  const shop = options.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${shop}/admin/api/${options.apiVersion}/graphql.json`;
  const ids = options.productIds.map(toProductGid);

  const query = `
    query SyncedProductsBatch($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          variants(first: 1) {
            edges {
              node {
                sku
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": options.accessToken,
    },
    body: JSON.stringify({ query, variables: { ids } }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL ${response.status}: ${text.slice(0, 400)}`);
  }

  const body = (await response.json()) as GraphQLNodesResponse;
  if (body.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors).slice(0, 400)}`);
  }

  const map = new Map<number, { title: string; sku: string | null }>();
  const nodes = body.data?.nodes ?? [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const gid = typeof n.id === "string" ? n.id : "";
    const m = /Product\/(\d+)/.exec(gid);
    const pid = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(pid)) continue;

    const title = typeof n.title === "string" ? n.title : "";
    let sku: string | null = null;
    const variants = n.variants as Record<string, unknown> | undefined;
    const edges = variants?.edges as unknown[] | undefined;
    const firstEdge = edges?.[0] as Record<string, unknown> | undefined;
    const vnode = firstEdge?.node as Record<string, unknown> | undefined;
    if (vnode?.sku != null && String(vnode.sku).trim() !== "") {
      sku = String(vnode.sku);
    }

    map.set(pid, { title: title.trim() ? title : "—", sku });
  }

  return map;
}

export type SyncedLinkInput = {
  shopifyProductId: number;
  cocoaKey: string;
};

export type EnrichedSyncedItem = SyncedLinkInput & {
  title?: string;
  sku?: string | null;
};

/**
 * Enriquece vínculos con título y SKU (Admin GraphQL por lotes; sin imágenes).
 */
export async function enrichSyncedProductItems(
  items: SyncedLinkInput[],
  options: {
    shopDomain: string;
    accessToken: string;
    apiVersion?: string;
    /** Pausa entre lotes GraphQL (ms). */
    delayBetweenBatchesMs?: number;
  },
): Promise<EnrichedSyncedItem[]> {
  if (items.length === 0) return [];

  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const delayMs = options.delayBetweenBatchesMs ?? 100;
  const { shopDomain, accessToken } = options;

  const merged = new Map<number, EnrichedSyncedItem>();
  for (const it of items) {
    merged.set(it.shopifyProductId, { ...it });
  }

  for (let i = 0; i < items.length; i += GRAPHQL_NODES_BATCH) {
    const slice = items.slice(i, i + GRAPHQL_NODES_BATCH);
    const ids = slice.map((s) => s.shopifyProductId);
    const batchMap = await fetchProductTitleAndSkuBatch({
      shopDomain,
      accessToken,
      apiVersion,
      productIds: ids,
    });
    for (const id of ids) {
      const row = merged.get(id);
      const info = batchMap.get(id);
      if (!row) continue;
      if (info) {
        merged.set(id, {
          ...row,
          title: info.title,
          sku: info.sku,
        });
      }
    }
    if (i + GRAPHQL_NODES_BATCH < items.length) {
      await sleep(delayMs);
    }
  }

  return items.map((it) => merged.get(it.shopifyProductId)!);
}
