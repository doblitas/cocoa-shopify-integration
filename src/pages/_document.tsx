import Document, { Head, Html, Main, NextScript } from "next/document";

/** Mismo Client ID que `client_id` en shopify.app.toml (inyectado en build). */
const SHOPIFY_API_KEY = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY?.trim() ?? "";

/**
 * Orden explícito para App Bridge: charset → viewport → meta shopify-api-key → script CDN.
 * @see https://shopify.dev/docs/api/app-bridge-library
 */
export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {SHOPIFY_API_KEY ? (
            <>
              <meta name="shopify-api-key" content={SHOPIFY_API_KEY} />
              {/* eslint-disable-next-line @next/next/no-sync-scripts -- Shopify CDN: script bloqueante para App Bridge. */}
              <script
                src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
                suppressHydrationWarning
              />
            </>
          ) : null}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
