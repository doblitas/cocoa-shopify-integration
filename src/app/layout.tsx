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

const shopifyApiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {shopifyApiKey ? <meta name="shopify-api-key" content={shopifyApiKey} /> : null}
        {/* App Bridge exige el primer <script> sin async/defer/module; next/script añade async y rompe la carga. */}
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          suppressHydrationWarning
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
