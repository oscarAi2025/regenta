import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SITIO } from "@/lib/sitio";
import { GuardiaNavegacion } from "@/components/GuardiaNavegacion";
import { OrigenVisita } from "@/components/OrigenVisita";

export const metadata: Metadata = {
  title: { default: "Regenta", template: "%s · Regenta" },
  description: "Regenta by Farmagenéricos Colombia: software de facturación electrónica y gestión para droguerías, farmacias y distribuidoras farmacéuticas.",
  metadataBase: new URL(SITIO),
  // Propiedad de regenta.pro en Google Search Console (etiqueta HTML de verificación).
  verification: { google: ["cg1KhVm39vQAMo3MqtwhE2n6ThhYyXnZ51Lc8-DWgWw", "sLiLQBTcjfIxeXokNKkBXYRpOMzye1DV2BlnWZAsTIY"] }, // dos cuentas de Google de Oscar
};
export const viewport: Viewport = { themeColor: "#102a43" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es-CO"><body>{children}<GuardiaNavegacion /><OrigenVisita /></body></html>;
}
