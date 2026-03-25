# Qué debes hacer tú (fuera del IDE / en tus cuentas)

Estos pasos requieren **tu cuenta**, **credenciales** o **navegador**. El código ya está listo; esto conecta tu entorno real.

## 1. Vercel

1. Instala la CLI si quieres desplegar desde terminal: `npm i -g vercel` (opcional).
2. En la carpeta `cocoa-shopify-integration`, ejecuta `vercel login` (abre el navegador) **o** define `VERCEL_TOKEN` en tu entorno con un token creado en [Vercel Account Settings → Tokens](https://vercel.com/account/tokens).
3. Despliega: `vercel` (preview) o `vercel --prod` (producción).
4. Anota la URL pública (ej. `https://tu-proyecto.vercel.app`).

### Variables de entorno en Vercel

En el proyecto → **Settings → Environment Variables**, añade al menos:

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_TENANTS_JSON` | JSON con un objeto por tienda (ver `.env.example` y `README.md`). Incluye `shopDomain`, `webhookSecret`, credenciales Cocoa y categorías. |
| `UPSTASH_REDIS_REST_URL` | (Recomendado) URL REST de Redis/Upstash para mapeos `Shopify product id → Cocoa key` e idempotencia de webhooks. |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST asociado. |

Sin Redis, el servidor usa memoria en caliente (se pierde al reiniciar y no escala entre instancias).

Vuelve a desplegar tras guardar variables.

## 2. Shopify (por cada tienda)

1. **Admin** → **Configuración** → **Apps y canales de ventas** → **Desarrollar apps** → crea una **app personalizada** para esa tienda.
2. **Scopes** mínimos para productos: `read_products`, `write_products`, y si sincronizas stock: `read_inventory`.
3. Instala la app y copia el **Admin API access token**.
4. **Configuración** → **Notificaciones** (webhooks) o desde la app: crea webhooks con URL:

   `https://<tu-dominio-vercel>/api/webhooks/shopify/products`

   Topics: `Product creation`, `Product update` (equivalente a `products/create` y `products/update`).

5. Copia el **secreto de firma** del webhook (para HMAC) y el dominio de la tienda (`xxx.myshopify.com`).
6. Completa ese objeto en `SHOPIFY_TENANTS_JSON` en Vercel.

## 3. Cocoa (test)

- Confirma con quien te dio el documento: **URL base** (test vs producción), **usuario/contraseña** válidos y **keys de categoría** (`key_categoria`) para pruebas.
- Si el create falla por formato de `archivo`/`datos`, revisa el `.md` en `Integracion Cocoa/docs/` y ajusta el cliente si Cocoa exige cambios.

## 4. Prueba rápida

1. `GET https://<tu-url>/api/health` → debe responder `ok: true`.
2. Edita un producto en Shopify y revisa **logs** en Vercel y en Cocoa que el producto se cree/actualice.

## 5. Git (opcional)

Si quieres despliegues automáticos con Git: conecta el repo en Vercel y empuja a la rama de producción. Esto lo haces en tu cuenta de GitHub/GitLab y en el dashboard de Vercel.
