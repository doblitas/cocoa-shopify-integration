import { RequestedTokenType } from "@shopify/shopify-api";
import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { getShopifyApi } from "@/lib/shopify/app";
import { runBulkProductSync, runBulkProductSyncUntilDone } from "@/lib/shopify/runBulkProductSync";
import { getTenantByShopDomain, getTenantByTenantId } from "@/lib/tenants";

export const runtime = "nodejs";
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 });
  }

  const syncSecret = process.env.SYNC_SECRET?.trim() ?? "";
  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId")?.trim() ?? "";
  const cursorParam = url.searchParams.get("cursor")?.trim() ?? null;
  const batchParam = url.searchParams.get("batch")?.trim();
  const batchSize =
    batchParam && Number(batchParam) > 0 ? Math.min(Math.floor(Number(batchParam)), 250) : undefined;
  /** Un solo lote (depuración / compat); por defecto el servidor hace todo el catálogo en una petición. */
  const stepMode =
    url.searchParams.get("step") === "1" || url.searchParams.get("single") === "1";

  let tenant = null as ReturnType<typeof getTenantByTenantId>;
  /** Set when auth is session JWT: online access token from token exchange (Dev Dashboard / embedded app). */
  let sessionExchangeAccessToken: string | undefined;

  if (syncSecret && token === syncSecret) {
    if (!tenantIdParam) {
      return NextResponse.json(
        { ok: false, error: "Query param tenantId is required when using SYNC_SECRET" },
        { status: 400 },
      );
    }
    tenant = getTenantByTenantId(tenantIdParam);
    if (!tenant) {
      return NextResponse.json({ ok: false, error: `Unknown tenantId: ${tenantIdParam}` }, { status: 404 });
    }
  } else {
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

    tenant = getTenantByShopDomain(shopDomain);
    if (!tenant) {
      return NextResponse.json({ ok: false, error: "No tenant configured for this shop" }, { status: 404 });
    }

    if (tenantIdParam && tenantIdParam !== tenant.tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId does not match the authenticated shop" },
        { status: 403 },
      );
    }

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
      sessionExchangeAccessToken = session.accessToken;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Token exchange failed";
      return NextResponse.json(
        { ok: false, error: `Session token exchange failed: ${msg}` },
        { status: 503 },
      );
    }
  }

  if (!tenant) {
    return unauthorized();
  }

  try {
    const result = stepMode
      ? await runBulkProductSync(tenant, sessionExchangeAccessToken, {
          cursor: cursorParam,
          batchSize,
        })
      : await runBulkProductSyncUntilDone(tenant, sessionExchangeAccessToken, {
          batchSize,
        });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("POST /api/sync/products", message);
    const isMissingAccess = message.includes("No Shopify Admin API access token");
    return NextResponse.json(
      { ok: false, error: message },
      { status: isMissingAccess ? 400 : 500 },
    );
  }
}
