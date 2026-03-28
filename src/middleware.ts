import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Solo CSP para iframe embebido (admin + tienda). La UI embebida vive en Pages Router
 * (`pages/_document.tsx`) para orden correcto de App Bridge sin reescritura HTML aquí.
 */
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function contentSecurityPolicyFrameAncestors(request: NextRequest): string {
  const shop = request.nextUrl.searchParams.get("shop");
  if (shop && SHOP_RE.test(shop)) {
    return `frame-ancestors https://${shop} https://admin.shopify.com;`;
  }
  return "frame-ancestors https://admin.shopify.com;";
}

function withCsp(res: NextResponse, request: NextRequest): NextResponse {
  res.headers.set("Content-Security-Policy", contentSecurityPolicyFrameAncestors(request));
  return res;
}

export function middleware(request: NextRequest) {
  return withCsp(NextResponse.next(), request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
