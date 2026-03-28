import { NextResponse } from "next/server";

import { getShopifyApi, SHOPIFY_OAUTH_CALLBACK_PATH } from "@/lib/shopify/app";

export const runtime = "nodejs";

/**
 * Inicia OAuth: GET /api/auth?shop=tu-tienda.myshopify.com
 * Redirige a Shopify para autorizar y luego a /api/auth/callback.
 */
export async function GET(request: Request) {
  const shop = new URL(request.url).searchParams.get("shop")?.trim();
  if (!shop) {
    return NextResponse.json(
      { error: "Falta el parámetro shop (ej. ?shop=tu-tienda.myshopify.com)" },
      { status: 400 },
    );
  }

  let shopify;
  try {
    shopify = getShopifyApi();
  } catch {
    return NextResponse.json(
      { error: "SHOPIFY_API_SECRET y NEXT_PUBLIC_SHOPIFY_API_KEY no están configurados" },
      { status: 500 },
    );
  }

  try {
    return await shopify.auth.begin({
      rawRequest: request,
      shop,
      callbackPath: SHOPIFY_OAUTH_CALLBACK_PATH,
      isOnline: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al iniciar OAuth";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
