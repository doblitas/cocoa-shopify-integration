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
    action?: "create" | "update" | "remove" | "skip";
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

type SyncedProductsOk = {
  ok: true;
  items: {
    shopifyProductId: number;
    cocoaKey: string;
    title?: string;
    sku?: string | null;
  }[];
  truncated?: boolean;
  totalKeys?: number;
};

type CoverageOk = {
  ok: true;
  shopifyProductCount: number;
  linkedCount: number;
  notLinkedCount: number;
  moreLinksThanProducts?: boolean;
};

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
  /** Si el servidor cortó por tiempo global (catálogo muy grande). */
  warning?: string;
};

async function parseJsonFromSyncResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const hint = res.status === 504 || res.status === 502 ? " Timeout del servidor." : "";
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
  const [syncedRows, setSyncedRows] = useState<
    { shopifyProductId: number; cocoaKey: string; title?: string; sku?: string | null }[]
  >([]);
  const [syncedMeta, setSyncedMeta] = useState<{ truncated: boolean; totalKeys: number } | null>(null);
  const [syncedError, setSyncedError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{
    shopifyProductCount: number;
    linkedCount: number;
    notLinkedCount: number;
    moreLinksThanProducts?: boolean;
  } | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      setSyncedError(null);
      setCoverageError(null);
      try {
        const token = await shopify.idToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [resStatus, resSynced, resCoverage] = await Promise.all([
          fetch("/api/dashboard/sync-status", { headers }),
          fetch("/api/dashboard/synced-products", { headers }),
          fetch("/api/dashboard/sync-coverage", { headers }),
        ]);
        const json = (await resStatus.json()) as ApiOk | ApiErr;
        if (!resStatus.ok || !json.ok) {
          setError("error" in json ? json.error : "Error al cargar el estado");
          setData(null);
          setSyncedRows([]);
          setSyncedMeta(null);
          setCoverage(null);
          return;
        }
        setData(json);

        const syncedParsed = (await resSynced.json()) as SyncedProductsOk | ApiErr;
        if (resSynced.ok && "ok" in syncedParsed && syncedParsed.ok && Array.isArray(syncedParsed.items)) {
          setSyncedRows(syncedParsed.items);
          setSyncedMeta({
            truncated: Boolean(syncedParsed.truncated),
            totalKeys: typeof syncedParsed.totalKeys === "number" ? syncedParsed.totalKeys : syncedParsed.items.length,
          });
        } else {
          setSyncedRows([]);
          setSyncedMeta(null);
          setSyncedError(
            "error" in syncedParsed && typeof syncedParsed.error === "string"
              ? syncedParsed.error
              : "No se pudo cargar el listado de productos enlazados",
          );
        }

        const coverageParsed = (await resCoverage.json()) as CoverageOk | ApiErr;
        if (resCoverage.ok && "ok" in coverageParsed && coverageParsed.ok) {
          setCoverage({
            shopifyProductCount: coverageParsed.shopifyProductCount,
            linkedCount: coverageParsed.linkedCount,
            notLinkedCount: coverageParsed.notLinkedCount,
            moreLinksThanProducts: Boolean(coverageParsed.moreLinksThanProducts),
          });
        } else {
          setCoverage(null);
          setCoverageError(
            "error" in coverageParsed && typeof coverageParsed.error === "string"
              ? coverageParsed.error
              : "No se pudo calcular la cobertura (Shopify vs enlaces)",
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
        setData(null);
        setSyncedRows([]);
        setSyncedMeta(null);
        setCoverage(null);
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
      const totalCreated = json.created;
      const totalUpdated = json.updated;
      const totalFailed = json.failed;

      if (json.hasMore && json.nextCursor) {
        const base = `Progreso: ${totalCreated} creados · ${totalUpdated} actualizados${
          totalFailed > 0 ? ` · ${totalFailed} con error` : ""
        }.`;
        const summary = json.warning ? `${base} ${json.warning}` : `${base} Vuelve a pulsar «Sincronizar todo» para continuar.`;
        shopify.toast.show(summary, { duration: 10000 });
        setSyncError(null);
      } else {
        const summary = `Listo: ${totalCreated} creados · ${totalUpdated} actualizados${
          totalFailed > 0 ? ` · ${totalFailed} con error` : ""
        }`;
        shopify.toast.show(summary, { duration: 8000 });
        setSyncError(null);
      }

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

          {!loading && !error && data ? (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Productos enlazados con Cocoa
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Productos de Shopify que ya tienen clave en Cocoa (tras crear o actualizar correctamente en
                  sync o webhook). No incluye productos que aún no se han sincronizado.
                </Text>
                {coverage ? (
                  <Text as="p" variant="bodySm">
                    En Shopify: <strong>{coverage.shopifyProductCount}</strong> productos · Con enlace Cocoa:{" "}
                    <strong>{coverage.linkedCount}</strong> · Sin enlace (pendientes de sync):{" "}
                    <strong>{coverage.notLinkedCount}</strong>
                    {coverage.moreLinksThanProducts ? (
                      <span>
                        {" "}
                        · Hay más enlaces guardados que productos visibles (p. ej. productos borrados en
                        Shopify).
                      </span>
                    ) : null}
                  </Text>
                ) : null}
                {coverageError ? (
                  <Text as="p" variant="bodySm" tone="critical">
                    Cobertura: {coverageError}
                  </Text>
                ) : null}
                {syncedError ? (
                  <Text as="p" tone="critical">
                    {syncedError}
                  </Text>
                ) : null}
                {!syncedError && syncedMeta && syncedMeta.totalKeys === 0 ? (
                  <Text as="p" tone="subdued">
                    Aún no hay productos enlazados. Ejecuta &quot;Sincronizar todo&quot; o espera webhooks.
                  </Text>
                ) : null}
                {!syncedError && syncedRows.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      Total: <strong>{syncedMeta?.totalKeys ?? syncedRows.length}</strong>
                      {syncedMeta?.truncated ? (
                        <span>
                          {" "}
                          (mostrando los primeros {syncedRows.length}; hay más en el servidor — sube el límite en
                          código o contacta soporte si necesitas export completo)
                        </span>
                      ) : null}
                    </Text>
                    <div style={{ maxHeight: 420, overflowY: "auto" }}>
                      <BlockStack gap="200">
                        {syncedRows.map((row) => (
                          <BlockStack key={row.shopifyProductId} gap="100">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {row.title?.trim() ? row.title : "—"}
                            </Text>
                            <InlineStack gap="300" blockAlign="center" wrap>
                              <Text as="span" variant="bodySm" tone="subdued">
                                SKU: <strong>{row.sku?.trim() ? row.sku : "—"}</strong>
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                Cocoa: <code>{row.cocoaKey}</code>
                              </Text>
                              {data.shopDomain ? (
                                <a
                                  href={`https://${data.shopDomain}/admin/products/${row.shopifyProductId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Text as="span" variant="bodySm">
                                    Editar en Shopify
                                  </Text>
                                </a>
                              ) : null}
                            </InlineStack>
                          </BlockStack>
                        ))}
                      </BlockStack>
                    </div>
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>
          ) : null}
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
