import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Apps embebidas en el admin deben declarar frame-ancestors o el navegador puede bloquear
 * el iframe y el admin reintenta la carga (varios GET en bucle).
 * @see https://shopify.dev/docs/apps/build/security/set-up-iframe-protection
 */
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function contentSecurityPolicyFrameAncestors(shop: string | null, hasHost: boolean): string {
  if (shop && SHOP_RE.test(shop)) {
    return `frame-ancestors https://${shop} https://admin.shopify.com;`;
  }
  // Sin ?shop= en la URL (a veces el log de Vercel no muestra query): si viene ?host= (embebido), permitir tiendas myshopify + admin.
  if (hasHost) {
    return "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
  }
  return "frame-ancestors https://admin.shopify.com;";
}

export function middleware(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get("shop");
  const hasHost = request.nextUrl.searchParams.has("host");
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", contentSecurityPolicyFrameAncestors(shop, hasHost));
  return res;
}

export const config = {
  matcher: [
    /*
     * Páginas HTML; excluir API y estáticos de Next (patrón habitual en la doc de Next.js).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
