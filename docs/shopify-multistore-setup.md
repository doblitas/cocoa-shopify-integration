# Shopify Custom App Multi-Store Setup (solo productos)

Este checklist aplica a la integración **solo de productos** (catálogo), según la documentación Cocoa de API de producto.

## Goal

Use the same integration backend for many Shopify stores to sync **products only** into Cocoa.
Each store is a tenant with its own credentials and webhook secret.

## Per-store setup (repeat for each store)

1. Open Shopify Admin for the store.
2. Go to **Apps** -> **App and sales channel settings** -> **Develop apps**.
3. Create a **Custom App** (one app per store).
4. Grant Admin API scopes:
   - `read_products`
   - `write_products`
   - `read_inventory` (if stock sync is needed)
5. Install the app and copy:
   - Access token (`adminAccessToken`)
   - Webhook secret (`webhookSecret`)
   - Store domain (`shopDomain`, e.g. `store-a.myshopify.com`)
6. Create product webhooks:
   - Topic `products/create`
   - Topic `products/update`
   - Delivery URL: `https://<your-vercel-domain>/api/webhooks/shopify/products`

## Tenant registration in environment variable

Add one object per store into `SHOPIFY_TENANTS_JSON`.

```json
[
  {
    "tenantId": "store_a",
    "shopDomain": "store-a.myshopify.com",
    "webhookSecret": "replace_me",
    "adminAccessToken": "replace_me",
    "cocoa": {
      "baseUrl": "app-z3gjk55rwa-uc.a.run.app",
      "user": "1234",
      "password": "1234"
    },
    "defaultCategoryKey": "dEDtC5EoKxdtwHqIhi8a",
    "categoryMap": {
      "lo mas vendido": "dEDtC5EoKxdtwHqIhi8a"
    }
  }
]
```

## Validation flow

1. Update one product in Shopify.
2. Check Vercel logs for webhook request and tenant resolution.
3. Confirm product was created/updated in Cocoa.

