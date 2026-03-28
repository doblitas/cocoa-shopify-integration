"use client";

import { AppProvider, InlineStack, Spinner } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { useEffect, useState } from "react";

import { DashboardBridge } from "./DashboardBridge";

/**
 * Espera a que App Bridge defina window.shopify antes de montar useAppBridge
 * (evita error en hidratación y recargas en bucle dentro del iframe).
 */
export function DashboardClient() {
  const [bridgeReady, setBridgeReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

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

    const timeout = window.setTimeout(() => window.clearInterval(id), 15_000);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
    };
  }, []);

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
