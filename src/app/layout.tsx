import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

// `display: "swap"` es el default de next/font y acá se nota: la interfaz es
// una grilla de cifras, así que el intercambio de fuente le cambia el ancho a
// cada número y la tabla entera salta cuando termina de cargar. Con "optional"
// el navegador usa la de sistema si la web no llegó a tiempo y no reflowea.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "optional",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Sistema de stock y ventas",
  manifest: "/manifest.webmanifest",
  // iOS ignora el manifest para el ícono de inicio y no acepta SVG: sin este
  // PNG, agregar la app a la pantalla de inicio muestra una captura de la web.
  icons: {
    icon: [
      { url: "/icono-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icono.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
