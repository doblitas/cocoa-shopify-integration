import { NextResponse } from "next/server";

import { getShopifyApi } from "@/lib/shopify/app";

export const runtime = "nodejs";

/**
 * Callback OAuth de Shopify (Redirect URL en el dev dashboard).
 * Tras éxito, redirige al admin embebido o a la página de la app en Shopify.
 */
export async function GET(request: Request) {
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
    const { headers: oauthHeaders, session } = await shopify.auth.callback({
      rawRequest: request,
    });

    const url = new URL(request.url);
    const host = url.searchParams.get("host");
    const apiKey = shopify.config.apiKey;

    const redirectTarget = host
      ? shopify.auth.buildEmbeddedAppUrl(host)
      : `https://${session.shop}/admin/apps/${apiKey}`;

    const out = new Headers(oauthHeaders as Headers);
    out.set("Location", redirectTarget);

    return new Response(null, { status: 302, headers: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : "OAuth callback failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
