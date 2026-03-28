"use client";

import { useAppBridge } from "@shopify/app-bridge-react";
import {
  AppProvider,
  BlockStack,
  Card,
  InlineStack,
  Page,
  Spinner,
  Text,
  Badge,
} from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { useCallback, useEffect, useState } from "react";

type ApiOk = {
  ok: true;
  tenantId: string;
  shopDomain?: string;
  status: {
    updatedAt: string;
    source: "webhook" | "bulk_sync";
    ok: boolean;
    shopifyProductId?: number;
    action?: "create" | "update";
    error?: string;
    bulk?: {
      fetched: number;
      created: number;
      updated: number;
      failed: number;
    };
  } | null;
};

type ApiErr = { ok: false; error: string };

type SyncOk = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  fetched: number;
  created: number;
  updated: number;
  failed: number;
};

export function DashboardClient() {
  const shopify = useAppBridge();
  const [data, setData] = useState<ApiOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const token = await shopify.idToken();
        const res = await fetch("/api/dashboard/sync-status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || !json.ok) {
          setError("error" in json ? json.error : "Error al cargar el estado");
          setData(null);
          return;
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
        setData(null);
      } finally {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [shopify],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const handleSyncAll = useCallback(async () => {
    setSyncError(null);
    setSyncing(true);
    try {
      const token = await shopify.idToken();
      const res = await fetch("/api/sync/products", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as SyncOk | ApiErr;

      if (!res.ok || !("ok" in json) || !json.ok) {
        const msg =
          "error" in json && typeof json.error === "string"
            ? json.error
            : "Error en la sincronización masiva";
        shopify.toast.show(msg, { isError: true, duration: 8000 });
        setSyncError(msg);
        return;
      }

      const summary = `Sincronizado: ${json.fetched} en Shopify · ${json.created} creados · ${json.updated} actualizados${
        json.failed > 0 ? ` · ${json.failed} con error` : ""
      }`;
      shopify.toast.show(summary, { duration: 7000 });
      await load("refresh");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      shopify.toast.show(msg, { isError: true, duration: 8000 });
      setSyncError(msg);
    } finally {
      setSyncing(false);
    }
  }, [shopify, load]);

  return (
    <AppProvider i18n={en}>
      <Page
        title="Cocoa — sincronización de productos"
        primaryAction={{
          content: "Sincronizar todo",
          loading: syncing,
          disabled: loading || syncing,
          onAction: handleSyncAll,
        }}
        secondaryActions={[
          {
            content: loading ? "Cargando…" : "Actualizar estado",
            loading: refreshing,
            disabled: loading || refreshing || syncing,
            onAction: () => void load("refresh"),
          },
        ]}
      >
        <BlockStack gap="400">
          {loading ? (
            <InlineStack align="center" blockAlign="center">
              <Spinner accessibilityLabel="Cargando" size="large" />
            </InlineStack>
          ) : null}

          {error ? (
            <Card>
              <BlockStack gap="200">
                <Text as="p" tone="critical">
                  {error}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Abre esta app desde el administrador de Shopify (Apps) para obtener un token válido.
                </Text>
              </BlockStack>
            </Card>
          ) : null}

          {!loading && !error && data ? (
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" tone="subdued">
                  La sincronización masiva puede tardar varios minutos si tienes muchos productos (límite del
                  servidor en Vercel).
                </Text>

                {syncError ? (
                  <Text as="p" tone="critical">
                    {syncError}
                  </Text>
                ) : null}

                <Text as="h2" variant="headingMd">
                  Tienda
                </Text>
                <Text as="p">
                  <strong>Tenant:</strong> {data.tenantId}
                </Text>
                {data.shopDomain ? (
                  <Text as="p">
                    <strong>Dominio Shopify:</strong> {data.shopDomain}
                  </Text>
                ) : null}

                <Text as="h2" variant="headingMd">
                  Última actividad
                </Text>
                {!data.status ? (
                  <Text as="p" tone="subdued">
                    Aún no hay sincronizaciones registradas (webhooks o sync inicial).
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={data.status.ok ? "success" : "critical"}>
                        {data.status.ok ? "OK" : "Error"}
                      </Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {data.status.source === "webhook" ? "Webhook" : "Sync masivo"}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm">
                      {new Date(data.status.updatedAt).toLocaleString()}
                    </Text>
                    {data.status.action && data.status.shopifyProductId ? (
                      <Text as="p" variant="bodySm">
                        Producto Shopify #{data.status.shopifyProductId} — {data.status.action}
                      </Text>
                    ) : null}
                    {data.status.error ? (
                      <Text as="p" tone="critical">
                        {data.status.error}
                      </Text>
                    ) : null}
                    {data.status.bulk ? (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">
                          Obtenidos: {data.status.bulk.fetched} · Creados: {data.status.bulk.created} ·
                          Actualizados: {data.status.bulk.updated} · Fallidos: {data.status.bulk.failed}
                        </Text>
                      </BlockStack>
                    ) : null}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          ) : null}
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
