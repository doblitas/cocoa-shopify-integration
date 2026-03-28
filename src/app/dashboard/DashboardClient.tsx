"use client";

import { AppProvider, BlockStack, Card, InlineStack, Spinner, Text } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { useEffect, useState } from "react";

import { DashboardBridge } from "./DashboardBridge";

/**
 * Espera a que App Bridge defina window.shopify antes de montar useAppBridge
 * (evita error en hidratación y recargas en bucle dentro del iframe).
 */
export function DashboardClient() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const key = document.querySelector('meta[name="shopify-api-key"]')?.getAttribute("content")?.trim();
    if (!key) {
      setInitError(
        "Falta NEXT_PUBLIC_SHOPIFY_API_KEY en Vercel (Environment Variables → Production). Sin la Client ID, App Bridge no crea window.shopify y el admin puede reintentar la carga en bucle.",
      );
      return;
    }

    const hasBridge = () =>
      typeof (window as unknown as { shopify?: unknown }).shopify !== "undefined";

    if (hasBridge()) {
      setBridgeReady(true);
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
  }, []);

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
