/**
 * Cliente HTTP para la API Cocoa descrita en la documentación de producto:
 * login + create/update de producto únicamente.
 */
import type { CocoaCredentials } from "@/lib/tenants";

type CocoaAuthResponse = {
  token: string;
};

type CocoaUpsertResponse = {
  data?: {
    key?: string;
  };
};

export type CocoaProductDraft = {
  nombre: string;
  sku: string;
  descripcion: string;
  precio: number;
  have_stock: boolean;
  stock: number;
  key_categoria: string;
  url_imagen?: string;
};

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();
const TOKEN_TTL_MS = 1000 * 60 * 20;

function buildUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  return `${normalized}${path}`;
}

async function getAuthToken(credentials: CocoaCredentials, tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const response = await fetch(buildUrl(credentials.baseUrl, "/autenticacion/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usuario: credentials.user,
      password: credentials.password,
    }),
  });

  if (!response.ok) {
    throw new Error(`Cocoa login failed with status ${response.status}`);
  }

  const payload = (await response.json()) as CocoaAuthResponse;
  if (!payload.token) {
    throw new Error("Cocoa login did not return token");
  }

  tokenCache.set(tenantId, {
    token: payload.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return payload.token;
}

function buildFormData(draft: CocoaProductDraft & { key?: string }): FormData {
  const form = new FormData();
  form.append("datos", JSON.stringify(draft));
  return form;
}

async function sendProductRequest(
  credentials: CocoaCredentials,
  tenantId: string,
  path: "/producto/rolComercio/create" | "/producto/rolComercio/update",
  body: CocoaProductDraft & { key?: string },
): Promise<CocoaUpsertResponse> {
  const token = await getAuthToken(credentials, tenantId);
  const url = buildUrl(credentials.baseUrl, path);

  const doRequest = async (accessToken: string): Promise<Response> =>
    fetch(url, {
      method: "POST",
      headers: { token: accessToken },
      body: buildFormData(body),
    });

  let response = await doRequest(token);
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(tenantId);
    const refreshed = await getAuthToken(credentials, tenantId);
    response = await doRequest(refreshed);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Cocoa product request failed ${response.status}: ${errorBody}`);
  }

  return (await response.json()) as CocoaUpsertResponse;
}

export async function createProductInCocoa(
  credentials: CocoaCredentials,
  tenantId: string,
  draft: CocoaProductDraft,
): Promise<string | null> {
  const response = await sendProductRequest(credentials, tenantId, "/producto/rolComercio/create", draft);
  return response.data?.key ?? null;
}

export async function updateProductInCocoa(
  credentials: CocoaCredentials,
  tenantId: string,
  cocoaKey: string,
  draft: CocoaProductDraft,
): Promise<void> {
  await sendProductRequest(credentials, tenantId, "/producto/rolComercio/update", {
    ...draft,
    key: cocoaKey,
    activo: true,
    deleted: false,
    have_oferta: false,
    fecha_inicial_oferta: null,
    fecha_final_oferta: null,
    precio_oferta: 0,
    porcentaje_oferta: 0,
  } as CocoaProductDraft & { key: string });
}

