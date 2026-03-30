import { RequestedTokenType } from "@shopify/shopify-api";
import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { enrichSyncedProductItems } from "@/lib/shopify/fetchShopifyProductSummary";
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
    const { items, truncated, totalKeys } = await listSyncedProductLinks(tenant.tenantId);
    const access = tenant.adminAccessToken?.trim();
    if (!access) {
      return NextResponse.json({
        ok: true,
        auth: "sync_secret",
        tenantId: tenant.tenantId,
        items,
        truncated,
        totalKeys,
        enrichment: "skipped" as const,
        enrichmentNote:
          "adminAccessToken (shpat_...) is required in SHOPIFY_TENANTS_JSON to load titles/SKU, or use the embedded app session.",
      });
    }
    try {
      const enriched = await enrichSyncedProductItems(items, {
        shopDomain: tenant.shopDomain,
        accessToken: access,
        apiVersion,
      });
      return NextResponse.json({
        ok: true,
        auth: "sync_secret",
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        items: enriched,
        truncated,
        totalKeys,
        enrichment: "ok" as const,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Shopify product fetch failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
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
        { status: 502 },
      );
    }
    accessToken = session.accessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange failed";
    return NextResponse.json({ ok: false, error: `Session token exchange failed: ${msg}` }, { status: 502 });
  }

  const { items, truncated, totalKeys } = await listSyncedProductLinks(tenant.tenantId);

  try {
    const enriched = await enrichSyncedProductItems(items, {
      shopDomain: tenant.shopDomain,
      accessToken,
      apiVersion,
    });
    return NextResponse.json({
      ok: true,
      auth: "session_token",
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      items: enriched,
      truncated,
      totalKeys,
      enrichment: "ok" as const,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Shopify product fetch failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
