# Cocoa Shopify Integration — solo productos (Multi-tenant)

Integración **exclusivamente de productos** Shopify → Cocoa, alineada con la documentación Cocoa de API de producto (login + create/update). No incluye pedidos ni otros dominios.

Referencias:

- `../docs/Webservice - Api producto Cocoa..docx`
- `../docs/Webservice - Api producto Cocoa..md`
- Alcance detallado: [`docs/SCOPE.md`](docs/SCOPE.md)

## What is implemented

- Next.js API endpoint to receive Shopify **product** webhooks:
  - `POST /api/webhooks/shopify/products`
- Supported webhook topics (único alcance de catálogo):
  - `products/create`
  - `products/update`
- Cocoa authentication + create/update product calls
- Tenant isolation by `shopDomain` (custom app model for multiple stores)
- Webhook HMAC validation per tenant
- Product link persistence (`shopifyProductId -> cocoaProductKey`) using Upstash Redis
  - If Redis env vars are missing, the app falls back to in-memory storage
- Webhook idempotency via `x-shopify-webhook-id` (Redis or in-memory; avoids duplicate Cocoa calls on retries)
- **Initial sync** of existing catalog: `POST /api/sync/products` (Shopify Admin API + same Cocoa mapping as webhooks). Auth: **`SYNC_SECRET`** + `?tenantId=...`, or **Shopify session JWT** (embedded admin).
- **Embedded dashboard** (`/dashboard`): muestra el último estado de sync (Redis) y botones **Actualizar estado** y **Sincronizar todo** usando el JWT del admin (no expone `SYNC_SECRET` al navegador).

## Initial sync (productos ya existentes en Shopify)

Para importar el catálogo **antes** de que disparen webhooks:

1. **Autenticación**
   - **Admin embebido** (`/dashboard` → **Sincronizar todo**): usa **token exchange** (JWT → Admin API). Requiere `NEXT_PUBLIC_SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET`. No hace falta `adminAccessToken` en el JSON para este flujo.
   - **curl / CI** con **`SYNC_SECRET`**: `Authorization: Bearer …` y `?tenantId=…`. Aquí sigue haciendo falta **`adminAccessToken`** (`shpat_...`) en el tenant para la Admin API.

2. **Lotes (evita timeout en Vercel)**  
   Cada `POST` procesa como mucho **`batch`** productos (por defecto 35 o `SHOPIFY_SYNC_BATCH_SIZE`). La respuesta incluye `hasMore` y `nextCursor`; el dashboard encadena peticiones automáticamente. Con curl, repite el POST pasando `?cursor=…` hasta que `hasMore` sea `false`.

Ejemplo curl (un solo lote):

```bash
curl -sS -X POST \
  "https://TU-DOMINIO.vercel.app/api/sync/products?tenantId=JI&batch=40" \
  -H "Authorization: Bearer TU_SYNC_SECRET"
```

Siguiente lote (copia `nextCursor` de la respuesta JSON anterior):

```bash
curl -sS -X POST \
  "https://TU-DOMINIO.vercel.app/api/sync/products?tenantId=JI&batch=40&cursor=PASTE_AQUI" \
  -H "Authorization: Bearer TU_SYNC_SECRET"
```

- Con **`SYNC_SECRET`**, `tenantId` debe coincidir con `SHOPIFY_TENANTS_JSON`.
- Con **JWT de sesión**, el servidor infiere la tienda desde el token.
- Opcional: `SHOPIFY_ADMIN_API_VERSION` (por defecto `2024-10`).

## Tests

```bash
npm run test
```

## Offline steps (Vercel, Shopify, secrets)

See [`docs/OFFLINE_CHECKLIST.md`](docs/OFFLINE_CHECKLIST.md).

## Environment variables

Create a `.env.local` file based on `.env.example`.

Key variable:

- `SHOPIFY_TENANTS_JSON`: JSON array with one object per store/tenant.

Example:

```json
[
  {
    "tenantId": "cocoa_bo",
    "shopDomain": "my-store-bolivia.myshopify.com",
    "webhookSecret": "shopify_webhook_secret_here",
    "adminAccessToken": "shpat_xxxxx",
    "cocoa": {
      "baseUrl": "app-z3gjk55rwa-uc.a.run.app",
      "user": "1234",
      "password": "1234"
    },
    "defaultCategoryKey": "dEDtC5EoKxdtwHqIhi8a",
    "categoryMap": {
      "lo mas vendido": "dEDtC5EoKxdtwHqIhi8a",
      "unico en tu tienda": "pEfPrAFQ4O569IEOjCsd",
      "otros": "rpRif5eUwaxCr1AT6aD6",
      "lo nuevo": "rxC6t41HWRt8ddM1Hjzk"
    }
  }
]
```

Optional Redis variables for durable mappings:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

For **bulk sync** and **embedded dashboard** (validar JWT del admin):

- `NEXT_PUBLIC_SHOPIFY_API_KEY` (Client ID de la app en Partners)
- `SHOPIFY_API_SECRET` (Client secret)

Optional:

- `SYNC_SECRET` — solo necesario si quieres llamar `POST /api/sync/products` con Bearer fijo + `?tenantId=` (curl/CI). Si solo usas el dashboard embebido, puedes omitirlo.
- `SHOPIFY_APP_HOST` — hostname público de la app sin esquema (por defecto `VERCEL_URL` en producción).
- `SHOPIFY_ADMIN_API_VERSION` (default `2024-10`)

## Shopify configuration checklist (per store)

1. In Shopify Admin, create/install a **Custom App** for that store.
2. Grant minimum Admin API scopes for **product sync only**:
   - `read_products`
   - `write_products`
   - `read_inventory` (if stock sync is required)
3. Configure webhooks:
   - `products/create` -> `https://your-vercel-domain/api/webhooks/shopify/products`
   - `products/update` -> `https://your-vercel-domain/api/webhooks/shopify/products`
4. Copy webhook secret and set it in that tenant object.
5. Ensure products include data needed by Cocoa mapping:
   - title, description, sku, price, inventory, image, product type/tags.

## Run locally

```bash
npm install
npm run dev
```

Useful endpoints:

- Health: `GET /api/health`
- Webhook receiver: `POST /api/webhooks/shopify/products`
- Embedded UI: `GET /dashboard` (App URL en Partners)

## Notes about Cocoa payload

The integration sends `multipart/form-data` with the `datos` field as JSON string.
When `url_imagen` is present, the file upload is optional according to the documentation update.
