import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { PreviewStoreProvider } from "@/store/preview-store";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Industry design system type: Barlow Condensed headings over Barlow body text.
const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: { default: "SalesFlow", template: "%s · SalesFlow" },
  description: "Sales management for wholesale and distribution: customers, orders, invoices and payments.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme before React hydrates.
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-body text-text">
        <PreviewStoreProvider>{children}</PreviewStoreProvider>
      </body>
    </html>
  );
}
