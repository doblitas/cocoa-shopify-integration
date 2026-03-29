"use client";

import { AppProvider, BlockStack, Card, InlineStack, Spinner, Text } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { DashboardBridge } from "@/components/dashboard/DashboardBridge";

function firstQueryParam(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

/**
 * Espera a que App Bridge defina window.shopify antes de montar useAppBridge
 * (evita error en hidratación y recargas en bucle dentro del iframe).
 *
 * El contexto embebido (iframe + host/shop) solo se calcula en useEffect para no
 * leer `window` durante el render: así servidor y primer paint del cliente coinciden (evita React #418).
 */
export function DashboardClient() {
  const router = useRouter();
  /** null = aún no evaluado en el cliente (misma UI que SSR / primer hidrato). */
  const [embedOk, setEmbedOk] = useState<boolean | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;

    const host = firstQueryParam(router.query.host).trim();
    const shop = firstQueryParam(router.query.shop).trim();
    const inIframe = window.parent !== window;
    const isLocalDev =
      process.env.NODE_ENV === "development" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const ok = isLocalDev || (inIframe && Boolean(host && shop));
    queueMicrotask(() => setEmbedOk(ok));
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (embedOk !== true) return;
    if (typeof window === "undefined") return;

    const key = document.querySelector('meta[name="shopify-api-key"]')?.getAttribute("content")?.trim();
    if (!key) {
      queueMicrotask(() =>
        setInitError(
          "Falta NEXT_PUBLIC_SHOPIFY_API_KEY en Vercel (Environment Variables → Production). Sin la Client ID, App Bridge no crea window.shopify y el admin puede reintentar la carga en bucle.",
        ),
      );
      return;
    }

    const hasBridge = () =>
      typeof (window as unknown as { shopify?: unknown }).shopify !== "undefined";

    if (hasBridge()) {
      queueMicrotask(() => setBridgeReady(true));
      return;
    }

    const id = window.setInterval(() => {
      if (hasBridge()) {
        setBridgeReady(true);
        window.clearInterval(id);
      }
    }, 50);

    const timeout = window.setTimeout(() => {
      window.clearInterval(id);
      if (!hasBridge()) {
        setInitError(
          "App Bridge no terminó de cargar (window.shopify sigue vacío). Revisa la consola, la API key y que abras la app desde Apps en el admin (URL con ?host= y ?shop=).",
        );
      }
    }, 15_000);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
    };
  }, [embedOk]);

  if (!router.isReady || embedOk === null) {
    return (
      <AppProvider i18n={en}>
        <InlineStack align="center" blockAlign="center">
          <Spinner accessibilityLabel="Cargando" size="large" />
        </InlineStack>
      </AppProvider>
    );
  }

  if (!embedOk) {
    return (
      <AppProvider i18n={en}>
        <Card>
          <BlockStack gap="300">
            <Text as="p" tone="critical">
              Abre esta app desde el administrador de Shopify: <strong>Tienda → Apps → Cocoa Integration</strong> (o el
              nombre de tu app). No uses la URL del dashboard en una pestaña suelta sin el contexto embebido.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              La URL debe incluir los parámetros <code>host</code> y <code>shop</code> que añade Shopify al cargar la app
              dentro del admin. Así evitas errores de App Bridge y avisos de <code>postMessage</code> en la consola.
            </Text>
          </BlockStack>
        </Card>
      </AppProvider>
    );
  }

  if (initError) {
    return (
      <AppProvider i18n={en}>
        <Card>
          <BlockStack gap="300">
            <Text as="p" tone="critical">
              {initError}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              En Vercel: Settings → Environment Variables → añade NEXT_PUBLIC_SHOPIFY_API_KEY (Client ID de la app) y
              vuelve a desplegar.
            </Text>
          </BlockStack>
        </Card>
      </AppProvider>
    );
  }

  if (!bridgeReady) {
    return (
      <AppProvider i18n={en}>
        <InlineStack align="center" blockAlign="center">
          <Spinner accessibilityLabel="Iniciando App Bridge" size="large" />
        </InlineStack>
      </AppProvider>
    );
  }

  return <DashboardBridge />;
}
