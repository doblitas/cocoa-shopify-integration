import "@shopify/shopify-api/adapters/web-api";

import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

/** Debe coincidir con la ruta `src/app/api/auth/callback/route.ts` y con Redirect URLs en Shopify. */
export const SHOPIFY_OAUTH_CALLBACK_PATH = "/api/auth/callback";

let instance: ReturnType<typeof shopifyApi> | null = null;

function parseScopes(): string[] {
  const raw = process.env.SHOPIFY_APP_SCOPES?.trim();
  if (raw) {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return ["read_products", "write_products", "read_inventory"];
}

function getHostName(): string {
  const explicit = process.env.SHOPIFY_APP_HOST?.trim();
  if (explicit) {
    return explicit.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    return vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  return "localhost:3000";
}

export function getShopifyApi(): ReturnType<typeof shopifyApi> {
  if (instance) {
    return instance;
  }

  const apiSecretKey = process.env.SHOPIFY_API_SECRET?.trim();
  const apiKey =
    process.env.NEXT_PUBLIC_SHOPIFY_API_KEY?.trim() ?? process.env.SHOPIFY_API_KEY?.trim();

  if (!apiSecretKey || !apiKey) {
    throw new Error("SHOPIFY_API_SECRET and NEXT_PUBLIC_SHOPIFY_API_KEY (or SHOPIFY_API_KEY) are required");
  }

  instance = shopifyApi({
    apiKey,
    apiSecretKey,
    hostName: getHostName(),
    apiVersion: ApiVersion.October24,
    isEmbeddedApp: true,
    scopes: parseScopes(),
  });

  return instance;
}
