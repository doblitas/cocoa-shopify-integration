import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * App Bridge CDN: scripts antes deben llevar data-app-bridge-compatible; el meta shopify-api-key
 * debe ir antes del script app-bridge.js (Next suele poner muchos <script> antes del meta).
 * @see https://github.com/Shopify/shopify-app-bridge/issues/311
 *
 * Fase 1 — Diagnóstico en el iframe (DevTools del iframe, no del admin):
 * - Network: expandir el GET repetido y anotar la URL completa (¿/dashboard?… vs solo admin.shopify.com).
 * - Console: errores en rojo; `typeof window.shopify` (y `window.shopify?.config` si existe).
 * - View source de /dashboard?shop=…&host=…: orden meta shopify-api-key → scripts /_next (con parche) → app-bridge.js.
 *
 * Fase 2 — A/B: `SHOPIFY_SKIP_DASHBOARD_HTML_PATCH=1` en Vercel → sin fetch interno ni regex; solo CSP + next().
 * Tras redeploy: si el bucle para → el post-procesado HTML era problemático (revisar regex o otra estrategia).
 * Si el bucle sigue → no es (solo) el middleware; ver Fase 3 del plan (layout embebido / Pages _document / plantilla Shopify).
 *
 * Fase 4 — Coherencia: en Vercel Production, `NEXT_PUBLIC_SHOPIFY_API_KEY` = Client ID = `client_id` en shopify.app.toml;
 * en Partners, App URL = application_url del TOML. Abrir la app desde Apps (URL con ?host= y ?shop=).
 *
 * Plan B si nada es estable: plantilla `shopify app init` o Pages Router + `_document.tsx`.
 */
const INTERNAL_HEADER = "x-shopify-ab-patched";

/** Si es "1" o "true", no reescribir HTML de /dashboard (experimento A/B frente al bucle del iframe). */
function skipDashboardHtmlPatch(): boolean {
  const v = process.env.SHOPIFY_SKIP_DASHBOARD_HTML_PATCH?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

const META_SHOPIFY_KEY_RE = /<meta\s+[^>]*name=["']shopify-api-key["'][^>]*\/?>/gi;

/**
 * Deja una sola meta shopify-api-key lo antes posible en <head> (tras charset/viewport si existen).
 */
function ensureShopifyMetaFirst(html: string): string {
  const matches = [...html.matchAll(META_SHOPIFY_KEY_RE)];
  if (matches.length === 0) return html;

  const metaTag = matches[0][0];
  const without = html.replace(META_SHOPIFY_KEY_RE, "");

  const afterViewport = /<meta\s+name=["']viewport["'][^>]*\/>/i;
  const vp = without.match(afterViewport);
  if (vp && vp.index !== undefined) {
    const insertAt = vp.index + vp[0].length;
    return without.slice(0, insertAt) + metaTag + without.slice(insertAt);
  }

  const charsetRe = /<meta\s+[^>]*charSet=["']utf-8["'][^>]*\/?>/i;
  const cs = without.match(charsetRe);
  if (cs && cs.index !== undefined) {
    const insertAt = cs.index + cs[0].length;
    return without.slice(0, insertAt) + metaTag + without.slice(insertAt);
  }

  const headOpen = /<head[^>]*>/i;
  const ho = without.match(headOpen);
  if (ho && ho.index !== undefined) {
    const insertAt = ho.index + ho[0].length;
    return without.slice(0, insertAt) + metaTag + without.slice(insertAt);
  }

  return html;
}

function patchHtmlForAppBridge(html: string): string {
  return html.replace(/<script(\s[^>]*)?>/gi, (full, attrs = "") => {
    const a = attrs || "";
    if (a.includes("data-app-bridge-compatible")) return full;
    if (a.includes("shopifycloud/app-bridge.js")) return full;
    return `<script data-app-bridge-compatible${a}>`;
  });
}

function patchDashboardHtml(html: string): string {
  return patchHtmlForAppBridge(ensureShopifyMetaFirst(html));
}

/**
 * URL absoluta para el fetch interno en Vercel Edge (host/proto correctos tras proxy).
 * Cada GET /dashboard ejecuta middleware + subrequest (documentado; posible optimización futura).
 */
function getInternalFetchUrl(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const pathAndQuery = request.nextUrl.pathname + request.nextUrl.search;
  return `${proto}://${host}${pathAndQuery}`;
}

/** CSP mínimo estable: admin + tienda cuando conocemos ?shop= (sin wildcard *.myshopify en CSP3). */
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

export async function middleware(request: NextRequest) {
  if (request.headers.get(INTERNAL_HEADER) === "1") {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const wantsHtml = request.headers.get("accept")?.includes("text/html");

  if (isDashboard && request.method === "GET" && wantsHtml && !skipDashboardHtmlPatch()) {
    const url = getInternalFetchUrl(request);
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
    const patched = patchDashboardHtml(html);
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
