import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manga Reader",
  description: "Ad-free manga reader",
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
      </body>
    </html>
  );
}
