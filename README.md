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

## Notes about Cocoa payload

The integration sends `multipart/form-data` with the `datos` field as JSON string.
When `url_imagen` is present, the file upload is optional according to the documentation update.
