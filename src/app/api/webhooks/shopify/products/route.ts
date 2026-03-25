import { NextResponse } from "next/server";

import { createProductInCocoa, updateProductInCocoa } from "@/lib/cocoa/client";
import { getCocoaProductKey, saveCocoaProductKey } from "@/lib/productLinks/store";
import { mapShopifyProductToCocoaDraft } from "@/lib/shopify/mapProduct";
import type { ShopifyProductWebhookPayload } from "@/lib/shopify/types";
import { verifyShopifyWebhookSignature } from "@/lib/shopify/verifyWebhook";
import { getTenantByShopDomain } from "@/lib/tenants";
import { claimShopifyWebhookOnce } from "@/lib/webhookIdempotency";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopDomain = request.headers.get("x-shopify-shop-domain") ?? "";
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!topic || !shopDomain || !hmac) {
    return jsonError("Missing required Shopify webhook headers", 400);
  }

  const tenant = getTenantByShopDomain(shopDomain);
  if (!tenant) {
    return jsonError(`Unknown tenant for shop domain ${shopDomain}`, 404);
  }

  const rawBody = await request.text();
  const isValidHmac = verifyShopifyWebhookSignature(rawBody, tenant.webhookSecret, hmac);
  if (!isValidHmac) {
    return jsonError("Invalid webhook signature", 401);
  }

  if (topic !== "products/create" && topic !== "products/update") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `Only product webhooks are supported (products/create, products/update); topic was ${topic}`,
    });
  }

  let payload: ShopifyProductWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ShopifyProductWebhookPayload;
  } catch {
    return jsonError("Invalid webhook JSON body", 400);
  }

  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "";
  if (webhookId) {
    const firstDelivery = await claimShopifyWebhookOnce(tenant.tenantId, webhookId);
    if (!firstDelivery) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        tenantId: tenant.tenantId,
        webhookId,
      });
    }
  }

  try {
    const draft = mapShopifyProductToCocoaDraft(payload, tenant);
    const existingCocoaKey = await getCocoaProductKey(tenant.tenantId, payload.id);

    if (existingCocoaKey) {
      await updateProductInCocoa(tenant.cocoa, tenant.tenantId, existingCocoaKey, draft);
      return NextResponse.json({
        ok: true,
        action: "update",
        tenantId: tenant.tenantId,
        shopDomain: tenant.shopDomain,
        shopifyProductId: payload.id,
        cocoaProductKey: existingCocoaKey,
      });
    }

    const newCocoaKey = await createProductInCocoa(tenant.cocoa, tenant.tenantId, draft);
    if (newCocoaKey) {
      await saveCocoaProductKey(tenant.tenantId, payload.id, newCocoaKey);
    }

    return NextResponse.json({
      ok: true,
      action: "create",
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      shopifyProductId: payload.id,
      cocoaProductKey: newCocoaKey,
    });
  } catch (error) {
    console.error("Product sync failed", {
      tenantId: tenant.tenantId,
      shopDomain: tenant.shopDomain,
      topic,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return jsonError("Product synchronization failed", 500);
  }
}

