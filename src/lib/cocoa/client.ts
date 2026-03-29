/**
 * Cliente HTTP para la API Cocoa descrita en la documentación de producto:
 * login + create/update de producto únicamente.
 *
 * @see docs/Webservice - Api producto Cocoa..md
 * - Body: multipart form-data con `datos` (string JSON) y `archivo` (file).
 * - Si `url_imagen` va en `datos`, no es obligatorio subir archivo (actualización doc 13/10/2025).
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

/**
 * PNG 1×1 transparente (bytes válidos). Varios backends rechazan archivo 0 bytes;
 * la doc exige `archivo` salvo si `url_imagen` va en `datos`.
 */
const MINIMAL_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function placeholderImageBlob(): Blob {
  return new Blob([MINIMAL_PNG_BYTES], { type: "image/png" });
}

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

/** Doc 3.2: mismo shape que el ejemplo (have_stock, stock, nombre, sku, …). */
function buildCreateDatosObject(draft: CocoaProductDraft): Record<string, unknown> {
  const o: Record<string, unknown> = {
    have_stock: draft.have_stock,
    stock: draft.stock,
    nombre: draft.nombre,
    sku: draft.sku,
    descripcion: draft.descripcion,
    precio: draft.precio,
    key_categoria: draft.key_categoria,
  };
  if (draft.url_imagen?.trim()) {
    o.url_imagen = draft.url_imagen.trim();
  }
  return o;
}

/**
 * Doc 3.3: ejemplo con nombre, key, activo, deleted, have_oferta, ofertas, key_categoria.
 * Sin fechas de oferta cuando have_oferta es false (evitar null que algunos backends rechazan).
 */
function buildUpdateDatosObject(draft: CocoaProductDraft, cocoaKey: string): Record<string, unknown> {
  const o: Record<string, unknown> = {
    nombre: draft.nombre,
    sku: draft.sku,
    descripcion: draft.descripcion,
    precio: draft.precio,
    have_stock: draft.have_stock,
    stock: draft.stock,
    key_categoria: draft.key_categoria,
    key: cocoaKey,
    activo: true,
    deleted: false,
    have_oferta: false,
    precio_oferta: 0,
    porcentaje_oferta: 0,
  };
  if (draft.url_imagen?.trim()) {
    o.url_imagen = draft.url_imagen.trim();
  }
  return o;
}

function datosRequiresArchivoFile(datosObj: { url_imagen?: unknown }): boolean {
  const u = datosObj.url_imagen;
  return typeof u !== "string" || !u.trim();
}

function buildFormData(datosObj: Record<string, unknown>): FormData {
  const form = new FormData();
  const datosJson = JSON.stringify(datosObj);
  // Doc 3.2/3.3: orden archivo (1) → datos (2); algunos parsers son estrictos.
  if (datosRequiresArchivoFile(datosObj)) {
    form.append("archivo", placeholderImageBlob(), "placeholder.png");
  }
  form.append("datos", datosJson);
  return form;
}

async function sendProductRequest(
  credentials: CocoaCredentials,
  tenantId: string,
  path: "/producto/rolComercio/create" | "/producto/rolComercio/update",
  datosObj: Record<string, unknown>,
): Promise<CocoaUpsertResponse> {
  const token = await getAuthToken(credentials, tenantId);
  const url = buildUrl(credentials.baseUrl, path);

  const doRequest = async (accessToken: string): Promise<Response> =>
    fetch(url, {
      method: "POST",
      headers: { token: accessToken },
      body: buildFormData(datosObj),
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
  const datosObj = buildCreateDatosObject(draft);
  const response = await sendProductRequest(credentials, tenantId, "/producto/rolComercio/create", datosObj);
  return response.data?.key ?? null;
}

export async function updateProductInCocoa(
  credentials: CocoaCredentials,
  tenantId: string,
  cocoaKey: string,
  draft: CocoaProductDraft,
): Promise<void> {
  const datosObj = buildUpdateDatosObject(draft, cocoaKey);
  await sendProductRequest(credentials, tenantId, "/producto/rolComercio/update", datosObj);
}
