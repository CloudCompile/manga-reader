import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/service-worker";

export const metadata: Metadata = {
  title: "Manga Reader",
  description: "Ad-free manga reader",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
