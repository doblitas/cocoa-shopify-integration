# Alcance del proyecto

Este repositorio implementa **únicamente la integración de productos** entre Shopify y Cocoa, según la documentación oficial en la raíz del workspace (carpeta `Integracion Cocoa`):

- `../../docs/Webservice - Api producto Cocoa..md`

## Qué cubre

- Autenticación Cocoa (`/autenticacion/api/login`).
- Creación y actualización de productos (`/producto/rolComercio/create`, `/producto/rolComercio/update`).
- Webhooks de Shopify solo para catálogo: `products/create`, `products/update`.
- Sync inicial opcional: `POST /api/sync/products` (Admin API + mismo mapeo a Cocoa; requiere `adminAccessToken` y `SYNC_SECRET`).

## Qué no cubre

- Pedidos, clientes, envíos, pagos u otros recursos de Shopify que no estén en esa documentación.
- Cualquier endpoint Cocoa que no figure en el documento de API de producto.

Si en el futuro necesitas ampliar el alcance, conviene un nuevo documento de contrato y un proyecto o módulo aparte para no mezclar responsabilidades.
