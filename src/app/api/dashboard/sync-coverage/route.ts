import { RequestedTokenType } from "@shopify/shopify-api";
import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { fetchShopifyProductCount } from "@/lib/shopify/fetchAdminProducts";
import { getShopifyApi } from "@/lib/shopify/app";
import { listSyncedProductLinks } from "@/lib/productLinks/store";
import { getTenantByShopDomain, getTenantByTenantId } from "@/lib/tenants";

export const runtime = "nodejs";
export const maxDuration = 60;

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

/**
 * HTTP 200 + { ok: false } en fallos recuperables para que el dashboard no reciba 502 opacos de Vercel.
 */
async function buildCoverageResponse(
  tenantId: string,
  shopDomain: string,
  accessToken: string,
  apiVersion: string,
): Promise<NextResponse> {
  try {
    const { totalKeys: linkedCount } = await listSyncedProductLinks(tenantId);
    let shopifyProductCount = 0;
    try {
      shopifyProductCount = await fetchShopifyProductCount({
        shopDomain,
        accessToken,
        apiVersion,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Shopify count failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }

    const notLinkedCount = Math.max(0, shopifyProductCount - linkedCount);
    const moreLinksThanProducts = linkedCount > shopifyProductCount;

    return NextResponse.json({
      ok: true,
      tenantId,
      shopDomain,
      shopifyProductCount,
      linkedCount,
      notLinkedCount,
      moreLinksThanProducts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Coverage failed";
    console.error("sync-coverage buildCoverageResponse", { tenantId, msg });
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
            "adminAccessToken (shpat_...) is required in SHOPIFY_TENANTS_JSON for SYNC_SECRET coverage, or use the embedded app session.",
        },
        { status: 400 },
      );
    }
    return buildCoverageResponse(tenant.tenantId, tenant.shopDomain, access, apiVersion);
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

  return buildCoverageResponse(tenant.tenantId, tenant.shopDomain, accessToken, apiVersion);
}
