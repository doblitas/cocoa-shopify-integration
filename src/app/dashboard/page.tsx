import "@shopify/polaris/build/esm/styles.css";

import { DashboardClient } from "./DashboardClient";

/** Evita HTML estático en caché que ignore el contexto embebido (query host/shop). */
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardClient />;
}
