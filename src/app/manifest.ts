import type { MetadataRoute } from "next";

// Web instalable y base de la app de Android (Trusted Web Activity), 28/11/2026.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Regenta · Facturación electrónica y POS para droguerías",
    short_name: "Regenta",
    description: "Caja, facturación electrónica DIAN e inventario por lote y vencimiento para droguerías, farmacias y distribuidoras.",
    lang: "es-CO",
    id: "/",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    background_color: "#102a43",
    theme_color: "#102a43",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Abrir la caja", short_name: "Caja", url: "/caja", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Inventario", short_name: "Inventario", url: "/inventario", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Ventas", short_name: "Ventas", url: "/ventas", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
