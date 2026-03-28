import { NextResponse } from "next/server";

import { destToShopDomain } from "@/lib/shopify/destToShopDomain";
import { getShopifyApi } from "@/lib/shopify/app";
import { getSyncStatus } from "@/lib/syncStatus/store";
import { getTenantByShopDomain } from "@/lib/tenants";

export const runtime = "nodejs";

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

  if (syncSecret && token === syncSecret) {
    if (!tenantIdParam) {
      return NextResponse.json(
        { ok: false, error: "With SYNC_SECRET auth, query param tenantId is required" },
        { status: 400 },
      );
    }
    const status = await getSyncStatus(tenantIdParam);
    return NextResponse.json({
      ok: true,
      auth: "sync_secret",
      tenantId: tenantIdParam,
      status,
    });
  }

  let shopDomain: string;
  try {
    const shopify = getShopifyApi();
    const payload = await shopify.session.decodeSessionToken(token);
    shopDomain = destToShopDomain(payload.dest);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session token" }, { status: 401 });
  }

  const tenant = getTenantByShopDomain(shopDomain);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "No tenant configured for this shop" }, { status: 404 });
  }

  const status = await getSyncStatus(tenant.tenantId);
  return NextResponse.json({
    ok: true,
    auth: "session_token",
    tenantId: tenant.tenantId,
    shopDomain: tenant.shopDomain,
    status,
  });
}
