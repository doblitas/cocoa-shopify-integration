import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cocoa + Shopify",
  description: "Sincronización de productos Shopify → Cocoa",
};

const shopifyApiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY?.trim() ?? "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Sin API key no cargamos App Bridge: evita iframe reintentando sin window.shopify. */}
        {shopifyApiKey ? (
          <>
            <meta name="shopify-api-key" content={shopifyApiKey} />
            {/* App Bridge: primer script sin async/defer/module */}
            {/* eslint-disable-next-line @next/next/no-sync-scripts -- Shopify CDN requiere script bloqueante para orden correcto. */}
            <script
              src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
              suppressHydrationWarning
            />
          </>
        ) : null}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
