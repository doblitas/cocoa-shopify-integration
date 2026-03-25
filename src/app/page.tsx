export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Cocoa + Shopify — productos
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Backend solo para sincronizar <strong>productos</strong> con la API Cocoa documentada. Configure tenants en{" "}
          <code>SHOPIFY_TENANTS_JSON</code> y apunte los webhooks de producto a{" "}
          <code>/api/webhooks/shopify/products</code>.
        </p>
        <ul className="mt-6 list-disc space-y-2 pl-6 text-sm text-zinc-700 dark:text-zinc-300">
          <li>Health check: <code>/api/health</code></li>
          <li>Webhook endpoint: <code>/api/webhooks/shopify/products</code></li>
          <li>Product mapping persistence: Upstash Redis (or in-memory fallback)</li>
        </ul>
      </main>
    </div>
  );
}
