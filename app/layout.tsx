import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./admin-elder-friendly.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { OfflineRuntime } from "./components/OfflineRuntime";

export const metadata: Metadata = {
  title: "MetroWaste Admin",
  description: "Catbalogan City Waste Management System",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/pwa-icons/wastetrack-192.png",
    apple: "/pwa-icons/wastetrack-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "MetroWaste Admin",
    statusBarStyle: "default",
  },
};

// Next.js 15 requires themeColor to be exported through `viewport`, not metadata.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#087a59",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <OfflineRuntime />
      </body>
    </html>
  );
}
