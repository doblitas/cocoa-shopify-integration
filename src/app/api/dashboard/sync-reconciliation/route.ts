import { RequestedTokenType } from "@shopify/shopify-api";
import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { fetchAllShopifyProductIds, fetchShopifyProductCount } from "@/lib/shopify/fetchAdminProducts";
import { getShopifyApi } from "@/lib/shopify/app";
import { listAllLinkedShopifyProductIds } from "@/lib/productLinks/store";
import { getTenantByShopDomain, getTenantByTenantId } from "@/lib/tenants";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAMPLE_IDS = 30;

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

async function buildReconciliationResponse(
  tenantId: string,
  shopDomain: string,
  accessToken: string,
  apiVersion: string,
): Promise<NextResponse> {
  try {
    const [shopifyCountFromApi, shopifyIds, redisIds] = await Promise.all([
      fetchShopifyProductCount({ shopDomain, accessToken, apiVersion }),
      fetchAllShopifyProductIds({ shopDomain, accessToken, apiVersion }),
      listAllLinkedShopifyProductIds(tenantId),
    ]);

    const shopifySet = new Set(shopifyIds);
    const redisSet = new Set(redisIds);

    const inShopifyNotInRedis: number[] = [];
    for (const id of shopifyIds) {
      if (!redisSet.has(id)) inShopifyNotInRedis.push(id);
    }

    const orphanLinksInRedis: number[] = [];
    for (const id of redisIds) {
      if (!shopifySet.has(id)) orphanLinksInRedis.push(id);
    }

    return NextResponse.json({
      ok: true,
      tenantId,
      shopDomain,
      shopifyCountFromApi,
      shopifyIdsFetched: shopifyIds.length,
      countMatchesFetched: shopifyCountFromApi === shopifyIds.length,
      redisLinkedCount: redisIds.length,
      inShopifyNotInRedisCount: inShopifyNotInRedis.length,
      orphanLinksInRedisCount: orphanLinksInRedis.length,
      sampleShopifyNotLinked: inShopifyNotInRedis.slice(0, SAMPLE_IDS),
      sampleOrphanShopifyIds: orphanLinksInRedis.slice(0, SAMPLE_IDS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reconciliation failed";
    console.error("sync-reconciliation", { tenantId, msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}

export async function GET(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 });
  }

  const syncSecret = process.env.SYNC_SECRET;
  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId")?.trim() ?? "";

  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  if (syncSecret && token === syncSecret) {
    if (!tenantIdParam) {
      return NextResponse.json(
        { ok: false, error: "With SYNC_SECRET auth, query param tenantId is required" },
        { status: 400 },
      );
    }
    const tenant = getTenantByTenantId(tenantIdParam);
    if (!tenant) {
      return NextResponse.json({ ok: false, error: `Unknown tenantId: ${tenantIdParam}` }, { status: 404 });
    }
    const access = tenant.adminAccessToken?.trim();
    if (!access) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "adminAccessToken (shpat_...) is required in SHOPIFY_TENANTS_JSON for SYNC_SECRET reconciliation, or use the embedded app session.",
        },
        { status: 400 },
      );
    }
    return buildReconciliationResponse(tenant.tenantId, tenant.shopDomain, access, apiVersion);
  }

  let shopify;
  try {
    shopify = getShopifyApi();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Shopify API credentials are not configured on the server" },
      { status: 500 },
    );
  }

  let shopDomain: string;
  try {
    const payload = await shopify.session.decodeSessionToken(token);
    shopDomain = destToShopDomain(payload.dest);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session token" }, { status: 401 });
  }

  const tenant = getTenantByShopDomain(shopDomain);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "No tenant configured for this shop" }, { status: 404 });
  }

  const tenantIdParamCheck = url.searchParams.get("tenantId")?.trim() ?? "";
  if (tenantIdParamCheck && tenantIdParamCheck !== tenant.tenantId) {
    return NextResponse.json(
      { ok: false, error: "tenantId does not match the authenticated shop" },
      { status: 403 },
    );
  }

  let accessToken: string;
  try {
    const { session } = await shopify.auth.tokenExchange({
      shop: shopDomain,
      sessionToken: token,
      requestedTokenType: RequestedTokenType.OnlineAccessToken,
    });
    if (!session.accessToken) {
      return NextResponse.json(
        { ok: false, error: "Token exchange returned no access token" },
        { status: 503 },
      );
    }
    accessToken = session.accessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange failed";
    return NextResponse.json(
      { ok: false, error: `Session token exchange failed: ${msg}` },
      { status: 503 },
    );
  }

  return buildReconciliationResponse(tenant.tenantId, tenant.shopDomain, accessToken, apiVersion);
}
