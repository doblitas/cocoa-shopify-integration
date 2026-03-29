/** Cursor v1: una página de Shopify + offset dentro del array de productos devuelto. */
export type BulkSyncCursorV1 = {
  v: 1;
  pageUrl: string;
  skip: number;
};

export function initialBulkSyncCursor(shopDomain: string, apiVersion: string): BulkSyncCursorV1 {
  const shop = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    v: 1,
    pageUrl: `https://${shop}/admin/api/${apiVersion}/products.json?limit=250`,
    skip: 0,
  };
}

export function encodeBulkSyncCursor(c: BulkSyncCursorV1): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeBulkSyncCursor(raw: string | null | undefined): BulkSyncCursorV1 | null {
  if (!raw?.trim()) return null;
  try {
    const json = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const o = JSON.parse(json) as BulkSyncCursorV1;
    if (o.v !== 1 || typeof o.pageUrl !== "string" || typeof o.skip !== "number" || o.skip < 0) {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}
