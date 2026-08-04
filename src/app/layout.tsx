import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME } from "@/lib/config";
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
  title: APP_NAME,
  description: "Sistema de stock y ventas",
  manifest: "/manifest.webmanifest",
  // Instalada en iOS no hay manifest: estas dos hacen que abra en ventana
  // propia en vez de Safari, que es lo que evita cerrar la pestaña con la cola
  // de ventas pendientes adentro.
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME },
};

export const viewport: Viewport = {
  themeColor: "#3b5bd6",
  // La pantalla de venta se usa con los dedos y a las apuradas: bloquear el
  // zoom evitaría el doble-tap accidental, pero también rompe la
  // accesibilidad de quien necesita agrandar. Se deja habilitado.
  initialScale: 1,
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster richColors position="top-right" theme="light" />
      </body>
    </html>
  );
}
