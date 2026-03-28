#!/usr/bin/env bash
# Despliega la configuración de la app (shopify.app.toml) a Shopify Partners.
# Requisitos: `shopify auth login` al menos una vez en esta máquina.
# Uso: crea .env.local con NEXT_PUBLIC_SHOPIFY_API_KEY=... o exporta la variable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

CID="${NEXT_PUBLIC_SHOPIFY_API_KEY:-}"
if [[ -z "$CID" ]]; then
  echo "NEXT_PUBLIC_SHOPIFY_API_KEY no está definido."
  echo "Añádelo a .env.local (mismo Client ID que en Vercel) o ejecuta:"
  echo "  export NEXT_PUBLIC_SHOPIFY_API_KEY=tu_client_id"
  exit 1
fi

exec shopify app deploy --force --client-id "$CID"
