import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Regenta", template: "%s · Regenta" },
  description: "Regenta by Farmagenéricos Colombia: caja, facturación electrónica DIAN e inventario por lote para droguerías.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#102a43" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-CO"><body>{children}</body></html>;
}
