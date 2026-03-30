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
- **Inventario y publicación:** solo se **crea o mantiene** en Cocoa si (1) la **suma de `inventory_quantity` de todas las variantes** es **> 0**, y (2) el producto está **publicado en canal de ventas** según Shopify: `status === active` y **`published_at`** no vacío; **`draft`** y **`archived`** no se sincronizan. Si deja de cumplirse (sin stock, borrador, despublicado, etc.), **no** se crea en Cocoa o, si ya había vínculo, se marca **eliminado en Cocoa** y se borra el vínculo en Redis. Para esa baja hace falta **`defaultCategoryKey`** en el tenant (además del mapeo habitual para altas).

## Initial sync (productos ya existentes en Shopify)

Para importar el catálogo **antes** de que disparen webhooks:

1. **Autenticación**
   - **Admin embebido** (`/dashboard` → **Sincronizar todo**): usa **token exchange** (JWT → Admin API). Requiere `NEXT_PUBLIC_SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET`. No hace falta `adminAccessToken` en el JSON para este flujo.
   - **curl / CI** con **`SYNC_SECRET`**: `Authorization: Bearer …` y `?tenantId=…`. Aquí sigue haciendo falta **`adminAccessToken`** (`shpat_...`) en el tenant para la Admin API.

2. **Un solo POST (por defecto)**  
   El servidor encadena lotes internamente hasta terminar el catálogo o hasta **`SHOPIFY_SYNC_OVERALL_MAX_MS`** (por defecto **280000** ms, por debajo del `maxDuration` 300s de Vercel). El dashboard solo hace **una** petición. Si el catálogo no cabe en ese tiempo, la respuesta trae `hasMore: true` y `nextCursor`; vuelve a ejecutar el mismo `POST` para continuar (o sube `SHOPIFY_SYNC_OVERALL_MAX_MS` si tu plan lo permite).  
   Cada sub-lote usa `SHOPIFY_SYNC_BATCH_SIZE` (por defecto **12**) y **`SHOPIFY_SYNC_BUDGET_MS`** por iteración interna. Si ves **504**, baja `SHOPIFY_SYNC_BATCH_SIZE` y/o los tiempos en el despliegue.

3. **Modo paso a paso (opcional, depuración)**  
   Añade **`step=1`** (o `single=1`) para el comportamiento antiguo: un lote por `POST` y `cursor` para el siguiente.

Ejemplo curl (sync completo en un solo POST, comportamiento por defecto):

```bash
curl -sS -X POST \
  "https://TU-DOMINIO.vercel.app/api/sync/products?tenantId=JI" \
  -H "Authorization: Bearer TU_SYNC_SECRET"
```

Un solo lote (modo paso):

```bash
curl -sS -X POST \
  "https://TU-DOMINIO.vercel.app/api/sync/products?tenantId=JI&step=1&batch=12" \
  -H "Authorization: Bearer TU_SYNC_SECRET"
```

Siguiente lote en modo paso (`nextCursor` de la respuesta anterior):

```bash
curl -sS -X POST \
  "https://TU-DOMINIO.vercel.app/api/sync/products?tenantId=JI&step=1&batch=12&cursor=PASTE_AQUI" \
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

## Troubleshooting (admin embebido, consola, 502)

- **`postMessage` / orígenes (`admin.shopify.com` vs tu dominio):** En el iframe del admin, App Bridge comunica padre e iframe; a veces el navegador muestra avisos en consola que **no bloquean** la app (comportamiento conocido con el admin unificado). Si la UI y los toasts funcionan, puedes ignorarlos. Abre la app desde **Tienda admin → Apps** (la URL debe incluir `host` y `shop` en la query).

- **502 Bad Gateway:** Lo emite Vercel o el runtime, no es el mismo problema que el mensaje de `postMessage`. En el proyecto en Vercel: **Logs** (o **Runtime Logs**), filtra por código **502** y por ruta (`/dashboard`, `/api/sync/products`, etc.) y revisa el mensaje de error de esa petición y el deployment activo. Comprueba también que el último deploy terminó bien y que no hay variables de entorno faltantes en producción.

- **500 en `POST …/autenticacion/api/login` (Cocoa):** Ese endpoint lo sirve **tu backend Cocoa** (p. ej. Cloud Run `app-…run.app`), no Shopify. La integración ya envía el body como en la doc (`usuario`, `password`, JSON). Si Vercel “External APIs” muestra **500** en login, revisa **logs de Cloud Run**, credenciales en `SHOPIFY_TENANTS_JSON` (`cocoa.user` / `cocoa.password`), y que `cocoa.baseUrl` sea el ambiente correcto (test `app-z3gjk55rwa-uc.a.run.app` vs prod en `docs/Webservice - Api producto Cocoa..md`). El mensaje de error del sync puede incluir ahora el cuerpo de respuesta de Cocoa para ayudar a diagnosticar.

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

The integration sends `multipart/form-data` with `archivo` before `datos` (order per doc). When `url_imagen` is **not** in the JSON, it sends a **minimal PNG** as `archivo` (some backends reject 0-byte files). With `url_imagen`, only `datos` is required per the 13/10/2025 doc note.
