import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * App Bridge CDN exige ser el primer <script> del documento, o que los anteriores tengan
 * data-app-bridge-compatible. Next.js inyecta muchos <script async> antes del nuestro → App Bridge
 * aborta → window.shopify no existe → el admin reintenta el iframe en bucle.
 * @see https://github.com/Shopify/shopify-app-bridge/issues/311
 */
const INTERNAL_HEADER = "x-shopify-ab-patched";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function patchHtmlForAppBridge(html: string): string {
  return html.replace(/<script(\s[^>]*)?>/gi, (full, attrs = "") => {
    const a = attrs || "";
    if (a.includes("data-app-bridge-compatible")) return full;
    if (a.includes("shopifycloud/app-bridge.js")) return full;
    return `<script data-app-bridge-compatible${a}>`;
  });
}

function contentSecurityPolicyFrameAncestors(request: NextRequest): string {
  const shop = request.nextUrl.searchParams.get("shop");
  const hasHost = request.nextUrl.searchParams.has("host");
  if (shop && SHOP_RE.test(shop)) {
    return `frame-ancestors https://${shop} https://admin.shopify.com;`;
  }
  if (hasHost) {
    return "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
  }
  return "frame-ancestors https://admin.shopify.com;";
}

function withCsp(res: NextResponse, request: NextRequest): NextResponse {
  res.headers.set("Content-Security-Policy", contentSecurityPolicyFrameAncestors(request));
  return res;
}

export async function middleware(request: NextRequest) {
  if (request.headers.get(INTERNAL_HEADER) === "1") {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const wantsHtml = request.headers.get("accept")?.includes("text/html");

  if (isDashboard && request.method === "GET" && wantsHtml) {
    const url = request.nextUrl.toString();
    const headers = new Headers(request.headers);
    headers.set(INTERNAL_HEADER, "1");

    const res = await fetch(url, { method: "GET", headers, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        return withCsp(NextResponse.redirect(loc, res.status), request);
      }
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      const out = new NextResponse(res.body, { status: res.status });
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() === "content-encoding") return;
        out.headers.set(k, v);
      });
      return withCsp(out, request);
    }

    const html = await res.text();
    const patched = patchHtmlForAppBridge(html);
    const out = new NextResponse(patched, { status: res.status });
    res.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (lower === "content-length" || lower === "content-encoding") return;
      out.headers.set(k, v);
    });
    return withCsp(out, request);
  }

  return withCsp(NextResponse.next(), request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
