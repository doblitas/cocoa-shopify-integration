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
  hasMore?: boolean;
  nextCursor?: string | null;
};

const SYNC_BATCH_SIZE = 12;
const SYNC_MAX_BATCHES = 500;

async function parseJsonFromSyncResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const hint =
      res.status === 504 || res.status === 502 ? " Timeout del servidor (los lotes lo evitan)." : "";
    throw new Error(`Respuesta no JSON (${res.status})${hint}: ${text.slice(0, 160)}`);
  }
}

/**
 * Solo monta useAppBridge cuando window.shopify ya existe (evita crash y reintentos en hidratación).
 */
export function DashboardBridge() {
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
      let cursor: string | undefined;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalFailed = 0;
      let batchNum = 0;

      for (;;) {
        if (batchNum >= SYNC_MAX_BATCHES) {
          const msg = `Límite de ${SYNC_MAX_BATCHES} lotes alcanzado. Reduce el catálogo o sube el tamaño de lote (batch).`;
          shopify.toast.show(msg, { isError: true, duration: 10000 });
          setSyncError(msg);
          return;
        }
        // Session JWT expires ~60s; refresh each batch so token exchange on the server succeeds.
        const token = await shopify.idToken();
        const params = new URLSearchParams();
        params.set("batch", String(SYNC_BATCH_SIZE));
        if (cursor) {
          params.set("cursor", cursor);
        }
        const res = await fetch(`/api/sync/products?${params.toString()}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const parsed = (await parseJsonFromSyncResponse(res)) as SyncOk | ApiErr;

        if (!res.ok || !("ok" in parsed) || !parsed.ok) {
          const msg =
            "error" in parsed && typeof parsed.error === "string"
              ? parsed.error
              : "Error en la sincronización masiva";
          shopify.toast.show(msg, { isError: true, duration: 8000 });
          setSyncError(msg);
          return;
        }

        const json = parsed as SyncOk;
        totalCreated += json.created;
        totalUpdated += json.updated;
        totalFailed += json.failed;
        batchNum += 1;

        if (json.hasMore && json.nextCursor) {
          shopify.toast.show(
            `Lote ${batchNum}: ${json.created} creados, ${json.updated} actualizados… (siguiente lote)`,
            { duration: 4000 },
          );
          cursor = json.nextCursor;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        const summary = `Listo (${batchNum} lote(s)): ${totalCreated} creados · ${totalUpdated} actualizados${
          totalFailed > 0 ? ` · ${totalFailed} con error` : ""
        }`;
        shopify.toast.show(summary, { duration: 8000 });
        await load("refresh");
        return;
      }
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
