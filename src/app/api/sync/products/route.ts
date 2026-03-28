import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { getShopifyApi } from "@/lib/shopify/app";
import { runBulkProductSync } from "@/lib/shopify/runBulkProductSync";
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
  const maxProducts = Math.min(Number(url.searchParams.get("max") ?? "10000") || 10000, 50_000);

  let tenant = null as ReturnType<typeof getTenantByTenantId>;

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
  }

  if (!tenant) {
    return unauthorized();
  }

  try {
    const result = await runBulkProductSync(tenant, maxProducts);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isMissingAdminToken = message.includes("adminAccessToken");
    return NextResponse.json(
      { ok: false, error: message },
      { status: isMissingAdminToken ? 400 : 502 },
    );
  }
}
