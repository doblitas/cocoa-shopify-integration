"use client";

import { useAppBridge } from "@shopify/app-bridge-react";
import {
  AppProvider,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
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
    source: "webhook" | "bulk_sync" | "uninstall";
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

type ReconciliationOk = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  shopifyCountFromApi: number;
  shopifyIdsFetched: number;
  countMatchesFetched: boolean;
  redisLinkedCount: number;
  inShopifyNotInRedisCount: number;
  orphanLinksInRedisCount: number;
  sampleShopifyNotLinked: number[];
  sampleOrphanShopifyIds: number[];
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

type UninstallOk = {
  ok: true;
  tenantId: string;
  shopDomain: string;
  deleted: number;
  failed: number;
  remainingAfterBatch: number;
  hasMore: boolean;
  nextCursor: string | null;
  stalled?: boolean;
  warning?: string;
};

const UNINSTALL_CONFIRM_PHRASE = "DESINSTALAR";

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
  const [reconciliation, setReconciliation] = useState<ReconciliationOk | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [uninstallConfirm, setUninstallConfirm] = useState("");
  const [uninstalling, setUninstalling] = useState(false);

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

  const handleReconcile = useCallback(async () => {
    setReconciliationError(null);
    setReconciliation(null);
    setReconciliationLoading(true);
    try {
      const token = await shopify.idToken();
      const res = await fetch("/api/dashboard/sync-reconciliation", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const parsed = (await res.json()) as ReconciliationOk | ApiErr;
      if (!res.ok || !("ok" in parsed) || !parsed.ok) {
        setReconciliationError(
          "error" in parsed && typeof parsed.error === "string"
            ? parsed.error
            : "No se pudo reconciliar (Shopify vs enlaces)",
        );
        return;
      }
      setReconciliation(parsed);
      void load("refresh");
    } catch (e) {
      setReconciliationError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setReconciliationLoading(false);
    }
  }, [shopify, load]);

  const handleUninstall = useCallback(async () => {
    setUninstallModalOpen(false);
    setUninstallConfirm("");
    setUninstalling(true);
    try {
      let cursor: string | null = null;
      let totalDeleted = 0;
      let totalFailed = 0;
      let step = 0;
      const maxSteps = 5000;

      while (step < maxSteps) {
        step += 1;
        const token = await shopify.idToken();
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const res = await fetch(`/api/dashboard/uninstall-connection${qs}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirm: true }),
        });
        const parsed = (await parseJsonFromSyncResponse(res)) as UninstallOk | ApiErr;

        if (!res.ok || !("ok" in parsed) || !parsed.ok) {
          const msg =
            "error" in parsed && typeof parsed.error === "string"
              ? parsed.error
              : "Error al desinstalar la conexión";
          shopify.toast.show(msg, { isError: true, duration: 10000 });
          return;
        }

        const json = parsed as UninstallOk;
        totalDeleted += json.deleted;
        totalFailed += json.failed;

        if (json.stalled) {
          shopify.toast.show(json.warning ?? "Desinstalación detenida por errores en Cocoa.", {
            isError: true,
            duration: 12000,
          });
          break;
        }

        if (json.warning && json.hasMore) {
          shopify.toast.show(json.warning, { duration: 9000 });
        }

        if (!json.hasMore) {
          shopify.toast.show(
            `Desinstalación: ${totalDeleted} producto(s) marcados en Cocoa y vínculos borrados${
              totalFailed > 0 ? ` · ${totalFailed} con error` : ""
            }`,
            { duration: 10000 },
          );
          break;
        }

        cursor = json.nextCursor;
        if (cursor === null && json.hasMore) {
          shopify.toast.show("Continúa: quedan vínculos por procesar.", { duration: 8000 });
          break;
        }
      }

      if (step >= maxSteps) {
        shopify.toast.show("Límite de pasos alcanzado; recarga y vuelve a intentar si falta algo.", {
          isError: true,
          duration: 10000,
        });
      }

      await load("refresh");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      shopify.toast.show(msg, { isError: true, duration: 10000 });
    } finally {
      setUninstalling(false);
    }
  }, [shopify, load]);

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
          disabled: loading || syncing || uninstalling,
          onAction: handleSyncAll,
        }}
        secondaryActions={[
          {
            content: loading ? "Cargando…" : "Actualizar estado",
            loading: refreshing,
            disabled: loading || refreshing || syncing || uninstalling,
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
                        {data.status.source === "webhook"
                          ? "Webhook"
                          : data.status.source === "uninstall"
                            ? "Desinstalación"
                            : "Sync masivo"}
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
                  Reconciliación Shopify ↔ enlaces de la app
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  El conteo en el panel de Cocoa (p. ej. «Mi tienda») puede ser distinto: puede incluir
                  artículos creados manualmente, duplicados o históricos que no pasaron por Shopify. Esta
                  herramienta solo compara el catálogo de Shopify Admin con los vínculos guardados aquí
                  (Shopify → clave Cocoa).
                </Text>
                <Button
                  onClick={() => void handleReconcile()}
                  loading={reconciliationLoading}
                  disabled={loading || refreshing || syncing || uninstalling}
                >
                  Reconciliar ahora
                </Button>
                {reconciliationError ? (
                  <Text as="p" variant="bodySm" tone="critical">
                    {reconciliationError}
                  </Text>
                ) : null}
                {reconciliation ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      Shopify (count.json): <strong>{reconciliation.shopifyCountFromApi}</strong> · IDs
                      listados: <strong>{reconciliation.shopifyIdsFetched}</strong>
                      {!reconciliation.countMatchesFetched ? (
                        <span>
                          {" "}
                          (difiere del count: revisa o repite en unos minutos)
                        </span>
                      ) : null}
                    </Text>
                    <Text as="p" variant="bodySm">
                      Enlaces en esta app: <strong>{reconciliation.redisLinkedCount}</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      En Shopify sin enlace guardado: <strong>{reconciliation.inShopifyNotInRedisCount}</strong>{" "}
                      (pendientes de sync o no elegibles según reglas: inventario, publicado, etc.)
                    </Text>
                    <Text as="p" variant="bodySm">
                      Enlaces huérfanos (ID en Redis que ya no existe en Shopify):{" "}
                      <strong>{reconciliation.orphanLinksInRedisCount}</strong> — suelen limpiarse al
                      sincronizar o al borrar el producto en Shopify.
                    </Text>
                    {reconciliation.sampleShopifyNotLinked.length > 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Muestra IDs Shopify sin enlace:{" "}
                        <code>{reconciliation.sampleShopifyNotLinked.join(", ")}</code>
                        {reconciliation.inShopifyNotInRedisCount > reconciliation.sampleShopifyNotLinked.length
                          ? " …"
                          : null}
                      </Text>
                    ) : null}
                    {reconciliation.sampleOrphanShopifyIds.length > 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Muestra IDs huérfanos:{" "}
                        <code>{reconciliation.sampleOrphanShopifyIds.join(", ")}</code>
                        {reconciliation.orphanLinksInRedisCount > reconciliation.sampleOrphanShopifyIds.length
                          ? " …"
                          : null}
                      </Text>
                    ) : null}
                    {reconciliation.inShopifyNotInRedisCount === 0 &&
                    reconciliation.orphanLinksInRedisCount === 0 ? (
                      <Text as="p" variant="bodySm" tone="success">
                        Coincidencia: todos los productos de Shopify tienen enlace y no hay huérfanos en Redis.
                      </Text>
                    ) : null}
                  </BlockStack>
                ) : null}
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

          {!loading && !error && data ? (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Zona peligrosa
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Desinstalar la conexión marca como eliminados en Cocoa todos los productos que esta app
                  sincronizó (misma acción que al quitar stock según reglas) y borra los vínculos en el servidor.
                  No elimina artículos creados solo en Cocoa ni el catálogo completo del panel Cocoa si existía
                  fuera de esta integración.
                </Text>
                <Button
                  tone="critical"
                  loading={uninstalling}
                  disabled={loading || refreshing || syncing || uninstalling}
                  onClick={() => {
                    setUninstallConfirm("");
                    setUninstallModalOpen(true);
                  }}
                >
                  Desinstalar conexión
                </Button>
              </BlockStack>
            </Card>
          ) : null}
        </BlockStack>
      </Page>

      <Modal
        open={uninstallModalOpen}
        onClose={() => {
          setUninstallModalOpen(false);
          setUninstallConfirm("");
        }}
        title="¿Desinstalar conexión con Cocoa?"
        primaryAction={{
          content: "Confirmar desinstalación",
          destructive: true,
          disabled: uninstallConfirm.trim() !== UNINSTALL_CONFIRM_PHRASE,
          onAction: () => void handleUninstall(),
        }}
        secondaryActions={[
          {
            content: "Cancelar",
            onAction: () => {
              setUninstallModalOpen(false);
              setUninstallConfirm("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Esta acción intentará marcar como eliminados en Cocoa <strong>todos</strong> los productos con
              vínculo guardado por esta app y borrará esos vínculos. Puede tardar varios minutos y requerir
              varios intentos si el servidor corta por tiempo (Vercel).
            </Text>
            <TextField
              label={`Escribe ${UNINSTALL_CONFIRM_PHRASE} para habilitar el botón`}
              value={uninstallConfirm}
              onChange={setUninstallConfirm}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </AppProvider>
  );
}
