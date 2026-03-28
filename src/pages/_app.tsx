import "@/app/globals.css";
import "@shopify/polaris/build/esm/styles.css";

import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Solo rutas bajo `src/pages/` (p. ej. /dashboard embebido). El resto usa App Router (`src/app/`).
 */
export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}>
      <Component {...pageProps} />
    </div>
  );
}
